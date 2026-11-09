import type { SupabaseClient } from "@supabase/supabase-js";

import type { IdentityType } from "@/lib/nutrition/liste-de-courses";
import type { Database } from "@/types/supabase";

/**
 * COURSES C1 — LIRE LE PLANIFIÉ SUR UNE PÉRIODE, EN QUATRE REQUÊTES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA SOURCE, ET RIEN QU'ELLE
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ `planned_meals` + `planned_meal_items`, POINT. Ce module ne lit ni
 * `meal_choice_options` (le snapshot du coach : ce que l'élève AURAIT PU
 * choisir), ni `consumed_meals` / `meal_entries` (ce qu'il a réellement
 * mangé). Une liste de courses sert à acheter ce qui est PRÉVU : le passé n'y
 * a rien à faire, et les options non choisies non plus.
 *
 * ⚠️ AUCUNE ÉCRITURE. Pas une seule. C1 est `SELECT → hydrate → aggregate →
 * render`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUATRE REQUÊTES, QUELLE QUE SOIT LA PÉRIODE
 * ────────────────────────────────────────────────────────────────────────────
 * 1. les `planned_meals` de l'intervalle    → `.gte` / `.lte` sur `planned_on`
 * 2. leurs `planned_meal_items`             → `.in` sur `planned_meal_id`
 * 3. les noms des aliments du catalogue     → `.in` sur `id`
 * 4. les noms des produits                  → `.in` sur `id`
 *
 * ⚠️ AUCUN N+1, ET C'EST STRUCTUREL : il n'existe dans ce fichier aucune
 * requête à l'intérieur d'une boucle. Sept jours de six repas donnent quatre
 * allers-retours, pas quarante-deux.
 *
 * ⚠️ AUCUN FILTRE `student_id` ÉCRIT ICI, ET C'EST VOULU. La RLS de
 * `planned_meals` / `planned_meal_items` restreint déjà à l'élève connecté —
 * exactement comme `lireCompositionsValidees`. Réécrire le filtre côté client
 * donnerait l'illusion que c'est LUI qui protège la donnée.
 *
 * ⚠️ L'HYDRATATION NE REMPLACE JAMAIS UNE IDENTITÉ. `catalog_food_id` et
 * `product_id` traversent intacts ; le nom est ajouté À CÔTÉ, pour l'écran.
 * C'est la même règle qu'en N1 : l'identité est le snapshot, le nom est
 * relu — et un nom manquant ne fait pas disparaître la ligne.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EXTENSION FUTURE — « REPRENDRE MA SEMAINE PASSÉE » (NON IMPLÉMENTÉE)
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ RIEN DE CE QUI SUIT N'EXISTE. Aucune fonction, aucun écran, aucune
 * migration. Ce bloc dit seulement POURQUOI ce lecteur est déjà la bonne
 * porte d'entrée, pour qu'on n'en écrive pas un second le jour venu.
 *
 * Le mode voulu : l'élève veut remanger la même chose que la semaine dernière
 * et obtenir directement la liste correspondante.
 *
 * LA SOURCE SERA CE LECTEUR, TEL QUEL. `lireRepasPlanifiesSurPeriode` ne
 * connaît que deux dates : lui passer la période PRÉCÉDENTE au lieu de la
 * période courante suffit à obtenir les choix et les quantités réellement
 * validés alors — mêmes identités, mêmes unités, mêmes `choice_slot_id`.
 * Il n'y a donc rien à ajouter ici, et surtout rien à dupliquer.
 *
 * CE QUE CE MODE NE DEVRA JAMAIS FAIRE :
 *   • lire `consumed_meals` ou `meal_entries` — « ce que j'ai mangé » n'est pas
 *     « ce que j'avais prévu », et la liste de courses porte sur le prévu ;
 *   • parcourir toutes les `meal_choice_options` — ce serait acheter les cinq
 *     aliments d'une liste qui en propose un ;
 *   • lire `preferred_quantity` — la portion suggérée par le coach n'est pas
 *     la quantité que l'élève a validée ;
 *   • reconstruire un choix PAR NOM. Deux entrées Ciqual peuvent porter le même
 *     libellé ; la reprise se fait par `(choice_slot_id, identité)`, jamais
 *     autrement.
 *
 * LA RÈGLE QUI DÉCIDE DE TOUT : LE SNAPSHOT ACTUEL FAIT FOI.
 * Un choix repris doit encore exister dans `meal_choice_options` du plan
 * ACTUELLEMENT autorisé, pour l'occurrence visée. Si le coach a retiré cet
 * aliment de la liste depuis, il ne doit PAS être réinjecté silencieusement :
 * l'occurrence concernée reste « À COMPOSER » et l'élève est prévenu de ce qui
 * a changé. Sans cette règle, la reprise contournerait la prescription du
 * coach — exactement ce que C0 et les clés étrangères composites
 * `planned_meal_items_option_autorisee_*` empêchent aujourd'hui.
 *
 * (Ces clés étrangères, d'ailleurs, refuseraient l'écriture en base. La règle
 * ci-dessus n'est donc pas une protection — la base l'a déjà — mais une
 * question d'INTERFACE : il faut le dire à l'élève, pas échouer sous ses yeux.)
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/** Développement seul : une erreur silencieuse est une erreur qui reviendra. */
function devWarn(contexte: string, erreur: { message?: string } | null): void {
  if (erreur && process.env.NODE_ENV !== "production") {
    console.warn(`[repas-planifies] ${contexte}`, erreur.message ?? erreur);
  }
}

/** Un aliment planifié, identité préservée et nom hydraté. */
export interface ItemPlanifie {
  readonly plannedMealId: string;
  readonly plannedOn: string;
  readonly mealId: string;
  readonly slotKey: string;
  readonly label: string;
  readonly choiceSlotId: string;
  readonly identityType: IdentityType;
  readonly identityId: string;
  /** ⚠️ `catalog_food_id` BRUT — `null` si la cible est un produit. */
  readonly catalogFoodId: string | null;
  /** ⚠️ `product_id` BRUT — `null` si la cible est un aliment du catalogue. */
  readonly productId: string | null;
  readonly quantity: number;
  readonly unit: string;
  readonly position: number;
  /** Hydraté. AFFICHAGE SEUL — n'entre dans aucune clé. */
  readonly displayName: string;
  /**
   * COURSES — le code Ciqual (`food_catalog.source_ref` quand
   * `source = 'ciqual'`), d'où se déduit le RAYON de la liste de courses.
   *
   * ⚠️ HYDRATÉ, ET N'ENTRE DANS AUCUNE CLÉ D'AGRÉGATION — exactement comme
   * `displayName`. Deux aliments du même rayon restent deux lignes.
   *
   * ⚠️ POUR UN PRODUIT COMMERCIAL, c'est le code de l'aliment du catalogue
   * auquel il est RAPPROCHÉ (`food_products.food_id`), et `null` s'il ne l'est
   * pas. Un produit non rapproché n'a pas de rayon connu : il va dans
   * « Divers », visiblement, plutôt que dans un rayon plausible.
   */
  readonly codeCiqual: string | null;
}

/** Un repas planifié de la période. */
export interface RepasPlanifie {
  readonly plannedMealId: string;
  readonly plannedOn: string;
  readonly mealId: string;
  readonly slotKey: string;
  readonly label: string;
  /** `true` si ce repas a AUSSI été déclaré consommé (N1.6B). */
  readonly consomme: boolean;
  readonly items: readonly ItemPlanifie[];
  /**
   * N1.7 — les occurrences auxquelles l'élève a répondu « Rien ».
   *
   * ⚠️ SECOND CHEMIN DE LECTURE, MÊME RÈGLE. `lireCompositionsValidees` sert
   * l'écran des repas ; celui-ci sert la liste de courses. Les deux doivent
   * relire `planned_meal_skipped_slots`, sinon la moitié de l'application
   * croit l'élève indécis pendant que l'autre le sait décidé.
   */
  readonly ignorees: readonly string[];
}

export interface LecturePeriodePlanifiee {
  /** `false` si une requête a échoué : « rien lu » n'est PAS « rien de prévu ». */
  readonly ok: boolean;
  readonly repas: readonly RepasPlanifie[];
}

const LECTURE_VIDE: LecturePeriodePlanifiee = { ok: false, repas: [] };

/**
 * Les repas planifiés entre deux dates, bornes INCLUSES.
 *
 * ⚠️ `ok: false` N'EST PAS « AUCUN REPAS ». Un réseau coupé afficherait sinon
 * « 12 repas restent à composer » à un élève qui a tout validé, et l'inviterait
 * à tout refaire. L'appelant doit distinguer les deux.
 */
export async function lireRepasPlanifiesSurPeriode(
  supabase: TypedSupabaseClient,
  dateDebut: string,
  dateFin: string,
): Promise<LecturePeriodePlanifiee> {
  if (dateDebut === "" || dateFin === "" || dateFin < dateDebut) return LECTURE_VIDE;

  const { data: repasBruts, error: erreurRepas } = await supabase
    .from("planned_meals")
    .select("id, meal_id, planned_on, slot_key, label, consumed_meal_id")
    .gte("planned_on", dateDebut)
    .lte("planned_on", dateFin)
    .order("planned_on");
  devWarn("planned_meals", erreurRepas);
  if (erreurRepas) return LECTURE_VIDE;

  const lignesRepas = (repasBruts ?? []) as unknown as {
    id: string;
    meal_id: string;
    planned_on: string;
    slot_key: string;
    label: string;
    consumed_meal_id: string | null;
  }[];
  if (lignesRepas.length === 0) return { ok: true, repas: [] };

  const { data: itemsBruts, error: erreurItems } = await supabase
    .from("planned_meal_items")
    .select("planned_meal_id, choice_slot_id, catalog_food_id, product_id, quantity, unit, position")
    .in("planned_meal_id", lignesRepas.map((l) => l.id))
    .order("position");
  devWarn("planned_meal_items", erreurItems);
  if (erreurItems) return LECTURE_VIDE;

  /*
   * ⚠️ N1.7 — LES OCCURRENCES ÉCARTÉES, DANS LEUR PROPRE TABLE. Elles ne
   * peuvent pas vivre dans `planned_meal_items` (`quantity > 0`, exactement
   * une identité) : une absence n'est pas un aliment à zéro gramme.
   *
   * ⚠️ ET UNE LECTURE RATÉE REND `ok: false`, comme pour les items. « Rien lu »
   * n'est pas « rien d'écarté » : le confondre ferait réapparaître dans la
   * liste de courses des aliments que l'élève avait justement retirés.
   */
  const { data: ecarteesBrutes, error: erreurEcartees } = await supabase
    .from("planned_meal_skipped_slots")
    .select("planned_meal_id, choice_slot_id")
    .in("planned_meal_id", lignesRepas.map((l) => l.id));
  devWarn("planned_meal_skipped_slots", erreurEcartees);
  if (erreurEcartees) return LECTURE_VIDE;

  const ignoreesParRepas = new Map<string, string[]>();
  for (const brut of (ecarteesBrutes ?? []) as unknown as {
    planned_meal_id: string;
    choice_slot_id: string;
  }[]) {
    const liste = ignoreesParRepas.get(brut.planned_meal_id) ?? [];
    liste.push(brut.choice_slot_id);
    ignoreesParRepas.set(brut.planned_meal_id, liste);
  }

  const lignesItems = (itemsBruts ?? []) as unknown as {
    planned_meal_id: string;
    choice_slot_id: string;
    catalog_food_id: string | null;
    product_id: string | null;
    quantity: number | string;
    unit: string;
    position: number;
  }[];

  // ── Hydratation des noms — DEUX requêtes, jamais une par ligne ────────────
  const idsAliments = [...new Set(lignesItems.map((i) => i.catalog_food_id).filter((v): v is string => v !== null))];
  const idsProduits = [...new Set(lignesItems.map((i) => i.product_id).filter((v): v is string => v !== null))];
  const noms = await lireIdentitesAffichables(supabase, idsAliments, idsProduits);
  if (!noms.ok) return LECTURE_VIDE;

  const parRepas = new Map<string, ItemPlanifie[]>();
  const metaRepas = new Map(lignesRepas.map((l) => [l.id, l] as const));

  for (const brut of lignesItems) {
    const meta = metaRepas.get(brut.planned_meal_id);
    if (!meta) continue;
    const quantite = Number(brut.quantity);
    if (!Number.isFinite(quantite) || quantite <= 0) continue;

    // ⚠️ EXACTEMENT UNE CIBLE. La contrainte `planned_meal_items_cible_unique`
    // le garantit en base ; on le revérifie plutôt que de choisir au hasard si
    // une écriture directe fautive avait contourné la contrainte.
    const estAliment = brut.catalog_food_id !== null;
    const estProduit = brut.product_id !== null;
    if (estAliment === estProduit) continue;

    const identityType: IdentityType = estAliment ? "catalog_food" : "product";
    const identityId = (estAliment ? brut.catalog_food_id : brut.product_id) as string;

    const liste = parRepas.get(brut.planned_meal_id) ?? [];
    liste.push({
      plannedMealId: brut.planned_meal_id,
      plannedOn: meta.planned_on,
      mealId: meta.meal_id,
      slotKey: meta.slot_key,
      label: meta.label,
      choiceSlotId: brut.choice_slot_id,
      identityType,
      identityId,
      catalogFoodId: brut.catalog_food_id,
      productId: brut.product_id,
      quantity: quantite,
      unit: brut.unit,
      position: brut.position,
      displayName: noms.parCle.get(`${identityType}:${identityId}`)?.nom ?? "",
      codeCiqual: noms.parCle.get(`${identityType}:${identityId}`)?.codeCiqual ?? null,
    });
    parRepas.set(brut.planned_meal_id, liste);
  }

  const repas = lignesRepas.map(
    (ligne): RepasPlanifie => ({
      plannedMealId: ligne.id,
      plannedOn: ligne.planned_on,
      mealId: ligne.meal_id,
      slotKey: ligne.slot_key,
      label: ligne.label,
      consomme: ligne.consumed_meal_id !== null,
      items: parRepas.get(ligne.id) ?? [],
      ignorees: ignoreesParRepas.get(ligne.id) ?? [],
    }),
  );

  return { ok: true, repas };
}

/** Ce qu'une identité porte pour l'affichage : son nom, et son rayon. */
interface IdentiteAffichable {
  readonly nom: string;
  /** `food_catalog.source_ref` quand `source = 'ciqual'`, sinon `null`. */
  readonly codeCiqual: string | null;
}

/**
 * Les identités affichables, en DEUX OU TROIS requêtes — jamais une par ligne.
 *
 * La règle de nommage est celle de `readNutritionPlanV2Week` : `name` pour un
 * aliment du catalogue, `Marque — Produit` pour un produit commercial. Elle
 * est reprise à l'identique, à dessein — deux écrans qui nomment le même
 * aliment autrement font douter que ce soit le même.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI LE CODE CIQUAL REMONTE ICI
 * ────────────────────────────────────────────────────────────────────────────
 * C'est lui qui donne le RAYON (`lib/nutrition/rayons.ts`), et il est déjà
 * dans la ligne qu'on lit : deux colonnes de plus sur une requête qui part de
 * toute façon, contre une colonne « catégorie » à créer et à remplir pour
 * 3 330 lignes. Aucune migration n'accompagne donc les rayons.
 *
 * ⚠️ LE CODE N'EST REPRIS QUE SI LA SOURCE EST BIEN CIQUAL. Un `source_ref`
 * d'une autre provenance n'est pas un `alim_code` : le lire comme tel
 * rangerait l'aliment dans le rayon d'un homonyme numérique. Même règle que
 * `lireAlimentDuPont` (`lib/supabase/pont-retail.ts`).
 *
 * ⚠️ LA TROISIÈME REQUÊTE N'EXISTE QUE S'IL Y A DES PRODUITS RAPPROCHÉS. Un
 * produit commercial tient son rayon de l'aliment du catalogue auquel il est
 * apparié (`food_products.food_id`) ; sans appariement, pas de rayon, et on ne
 * va pas chercher ailleurs une catégorie qui n'est pas stockée.
 */
async function lireIdentitesAffichables(
  supabase: TypedSupabaseClient,
  idsAliments: readonly string[],
  idsProduits: readonly string[],
): Promise<{ ok: boolean; parCle: ReadonlyMap<string, IdentiteAffichable> }> {
  const parCle = new Map<string, IdentiteAffichable>();
  if (idsAliments.length === 0 && idsProduits.length === 0) return { ok: true, parCle };

  const [aliments, produits] = await Promise.all([
    idsAliments.length > 0
      ? supabase.from("food_catalog").select("id, name, source, source_ref").in("id", [...idsAliments])
      : Promise.resolve({ data: [], error: null }),
    idsProduits.length > 0
      ? supabase
          .from("food_products")
          .select("id, product_name, brand, food_id")
          .in("id", [...idsProduits])
      : Promise.resolve({ data: [], error: null }),
  ]);

  devWarn("food_catalog", aliments.error);
  devWarn("food_products", produits.error);
  if (aliments.error || produits.error) return { ok: false, parCle };

  type LigneCatalogue = { id: string; name: string; source: string | null; source_ref: string | null };
  type LigneProduit = { id: string; product_name: string; brand: string | null; food_id: string | null };

  const lignesAliments = (aliments.data ?? []) as unknown as LigneCatalogue[];
  const lignesProduits = (produits.data ?? []) as unknown as LigneProduit[];

  /** Le code Ciqual d'une ligne de catalogue, ou `null`. */
  const codeDe = (ligne: LigneCatalogue): string | null =>
    ligne.source === "ciqual" ? ligne.source_ref : null;

  const codeParAliment = new Map<string, string | null>();
  for (const f of lignesAliments) {
    codeParAliment.set(f.id, codeDe(f));
    parCle.set(`catalog_food:${f.id}`, { nom: f.name, codeCiqual: codeDe(f) });
  }

  // ── Les aliments de rapprochement qui n'étaient pas déjà demandés ─────────
  const idsAApparier = [
    ...new Set(
      lignesProduits
        .map((p) => p.food_id)
        .filter((v): v is string => v !== null && !codeParAliment.has(v)),
    ),
  ];
  if (idsAApparier.length > 0) {
    const apparies = await supabase
      .from("food_catalog")
      .select("id, name, source, source_ref")
      .in("id", idsAApparier);
    devWarn("food_catalog (rapprochements produits)", apparies.error);
    if (apparies.error) return { ok: false, parCle };
    for (const f of (apparies.data ?? []) as unknown as LigneCatalogue[]) {
      codeParAliment.set(f.id, codeDe(f));
    }
  }

  for (const p of lignesProduits) {
    parCle.set(`product:${p.id}`, {
      nom: p.brand ? `${p.brand} — ${p.product_name}` : p.product_name,
      codeCiqual: p.food_id ? (codeParAliment.get(p.food_id) ?? null) : null,
    });
  }
  return { ok: true, parCle };
}
