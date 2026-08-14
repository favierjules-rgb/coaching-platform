import type { ConsumedMeal, ConsumedUnit, MacroTotals } from "@/lib/nutrition/consumed";
import { totalsForEntries } from "@/lib/nutrition/consumed";

/**
 * L'HISTORIQUE ALIMENTAIRE HEBDOMADAIRE (ALIMENTS A5.7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IL EST DÉRIVÉ, IL N'EST PAS STOCKÉ
 * ────────────────────────────────────────────────────────────────────────────
 * Aucune table d'historique, aucun agrégat persisté, aucune duplication de
 * `meal_entries`. Ce module lit ce qui existe déjà — les repas consommés et
 * leurs instantanés — et n'en fait que des sommes.
 *
 * Créer une seconde source de vérité aurait un coût que rien ne compense : une
 * entrée corrigée, un repas supprimé, et la copie ment. Les mesures le
 * confirment (voir `docs/aliments-a5.7-livrable.md`) : une semaine se lit en
 * 0,33 ms sur les index existants.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA RÈGLE QUI GOUVERNE TOUT LE FICHIER
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ UN JOUR SANS SAISIE N'EST PAS UN JOUR À ZÉRO.
 *
 * « L'élève n'a rien noté » et « l'élève a mangé 0 kcal » sont deux faits
 * différents, et les confondre fabrique une moyenne fausse : cinq jours suivis
 * à 2 000 kcal donnent 2 000 de moyenne, pas 1 428. C'est aussi une question de
 * respect — afficher « 0 kcal » à quelqu'un qui a simplement oublié de noter
 * son dîner lui reproche quelque chose qu'il n'a pas fait.
 *
 * Toute la structure de ce module découle de là : `aSaisie` est un booléen
 * explicite, jamais déduit d'un total à zéro.
 *
 * Ce module est une FEUILLE : ni React, ni Supabase, ni réseau.
 */

/* ══════════════════════════════════════════════════════════════════════════
   LES SEMAINES — ARITHMÉTIQUE DE CALENDRIER, SANS FUSEAU HORAIRE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ AUCUN `new Date("2026-08-13")` DANS CE FICHIER.
 *
 * Cette forme est interprétée en UTC par la spécification ECMAScript : à Paris,
 * en heure d'été, elle rend le 13 août à 02 h locales — ce qui est encore le
 * 13, mais la moindre soustraction fait basculer d'un jour. Les dates sont donc
 * découpées en (année, mois, jour) et reconstruites en heure LOCALE, comme le
 * fait déjà `getCurrentWeekDates`.
 */
function versParties(iso: string): { a: number; m: number; j: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { a: Number(m[1]), m: Number(m[2]), j: Number(m[3]) };
}

function versIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function versDateLocale(iso: string): Date | null {
  const p = versParties(iso);
  return p === null ? null : new Date(p.a, p.m - 1, p.j);
}

export interface Semaine {
  /** Le lundi, au format ISO. */
  readonly debut: string;
  /** Le dimanche, au format ISO. */
  readonly fin: string;
  /** Les sept dates, lundi → dimanche. */
  readonly dates: readonly string[];
}

/**
 * La semaine (lundi → dimanche) qui CONTIENT une date donnée.
 *
 * Le lundi comme premier jour, parce que c'est ce que fait déjà
 * `getCurrentWeekDates` : deux conventions de début de semaine dans la même
 * application produiraient deux découpages qui se recouvrent mal, et personne
 * ne verrait la différence avant un dimanche.
 */
export function semaineContenant(iso: string): Semaine | null {
  const date = versDateLocale(iso);
  if (date === null) return null;
  const jourDeLaSemaine = date.getDay(); // 0 = dimanche
  const versLundi = jourDeLaSemaine === 0 ? -6 : 1 - jourDeLaSemaine;
  const lundi = new Date(date.getFullYear(), date.getMonth(), date.getDate() + versLundi);

  const dates: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    dates.push(versIso(new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + i)));
  }
  return { debut: dates[0], fin: dates[6], dates };
}

/**
 * Décale d'un nombre entier de semaines. `-1` = la semaine précédente.
 *
 * On décale de 7 × n JOURS et on recalcule la semaine, plutôt que d'ajouter
 * sept jours au lundi : les deux donnent le même résultat, mais passer par
 * `semaineContenant` garantit que la sortie est toujours une semaine complète
 * et alignée, même si l'entrée ne l'était pas.
 */
export function decalerSemaine(semaine: Semaine, n: number): Semaine {
  const debut = versDateLocale(semaine.debut);
  if (debut === null) return semaine;
  const déplacé = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + n * 7);
  return semaineContenant(versIso(déplacé)) ?? semaine;
}

const MOIS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/**
 * « Semaine du 10 au 16 août », « du 30 août au 5 septembre », « du 28 décembre
 * 2026 au 3 janvier 2027 ».
 *
 * Le mois n'est répété que s'il change, et l'année que si elle change : une
 * semaine qui reste dans le même mois n'a pas besoin de l'écrire deux fois, et
 * l'écrire quand même allonge un titre qui doit tenir sur un téléphone.
 */
export function libelleSemaine(semaine: Semaine): string {
  const d = versParties(semaine.debut);
  const f = versParties(semaine.fin);
  if (!d || !f) return "";
  const moisD = MOIS_FR[d.m - 1] ?? "";
  const moisF = MOIS_FR[f.m - 1] ?? "";
  if (d.a !== f.a) return `du ${d.j} ${moisD} ${d.a} au ${f.j} ${moisF} ${f.a}`;
  if (d.m !== f.m) return `du ${d.j} ${moisD} au ${f.j} ${moisF}`;
  return `du ${d.j} au ${f.j} ${moisF}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   LE RÉSUMÉ D'UN JOUR, ET CELUI D'UNE SEMAINE
   ══════════════════════════════════════════════════════════════════════════ */

export interface ResumeJour {
  readonly date: string;
  /**
   * ⚠️ EXPLICITE, JAMAIS DÉDUIT D'UN TOTAL À ZÉRO. Un élève peut très bien
   * avoir noté un thé sans sucre : 0 kcal saisies restent une saisie.
   */
  readonly aSaisie: boolean;
  readonly totaux: MacroTotals;
  /** Nombre d'aliments réellement enregistrés ce jour-là. */
  readonly nbAliments: number;
}

/**
 * Le résumé d'UN jour, à partir des repas de la semaine.
 *
 * Un repas OUVERT mais VIDE ne compte pas comme une saisie : ouvrir un repas
 * prescrit crée un conteneur (`consumed_meals`) sans aucune entrée. Ce qui
 * fait qu'un jour est « suivi », c'est un aliment enregistré — pas un
 * conteneur.
 */
export function resumeDuJour(repas: readonly ConsumedMeal[], date: string): ResumeJour {
  const duJour = repas.filter((r) => r.consumedOn === date);
  const entrées = duJour.flatMap((r) => r.entries);
  return {
    date,
    aSaisie: entrées.length > 0,
    totaux: totalsForEntries(entrées),
    nbAliments: entrées.length,
  };
}

export interface ResumeSemaine {
  readonly semaine: Semaine;
  readonly jours: readonly ResumeJour[];
  /** Somme des jours SUIVIS. Les jours sans saisie n'y ajoutent rien — ils n'existent pas. */
  readonly totaux: MacroTotals;
  readonly joursSuivis: number;
  readonly joursTotal: number;
  /**
   * Moyennes sur les JOURS SUIVIS uniquement. `null` quand aucun jour ne l'est —
   * et non zéro : « aucune donnée » n'est pas « une moyenne de zéro ».
   */
  readonly moyennes: MacroTotals | null;
}

/**
 * Le résumé d'une semaine.
 *
 * ⚠️ LA MOYENNE DIVISE PAR LES JOURS SUIVIS, PAS PAR SEPT. Quelqu'un qui note
 * cinq jours à 2 000 kcal a mangé 2 000 kcal par jour, pas 1 428. Diviser par
 * sept punirait l'oubli d'une saisie en affichant une sous-consommation qui
 * n'a jamais eu lieu — et pousserait à manger davantage pour « rattraper » un
 * chiffre faux.
 */
export function resumeSemaine(
  repas: readonly ConsumedMeal[],
  semaine: Semaine,
): ResumeSemaine {
  const jours = semaine.dates.map((d) => resumeDuJour(repas, d));
  const suivis = jours.filter((j) => j.aSaisie);

  const totaux = totalsForEntries(
    repas.filter((r) => semaine.dates.includes(r.consumedOn)).flatMap((r) => r.entries),
  );

  return {
    semaine,
    jours,
    totaux,
    joursSuivis: suivis.length,
    joursTotal: semaine.dates.length,
    moyennes:
      suivis.length === 0
        ? null
        : {
            kcal: totaux.kcal / suivis.length,
            proteinG: totaux.proteinG / suivis.length,
            carbG: totaux.carbG / suivis.length,
            fatG: totaux.fatG / suivis.length,
          },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   LE CONTRAT COURSES — PRÉPARÉ, PAS IMPLÉMENTÉ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Une ligne agrégée, prête pour une future liste de courses.
 *
 * ⚠️ CE MODULE NE CRÉE AUCUNE LISTE DE COURSES. Il établit le CONTRAT :
 * « donne-moi les aliments réellement consommés du 3 au 9 août ». Ce que
 * Courses en fera — regrouper par rayon, arrondir à un conditionnement,
 * soustraire ce qu'il reste dans le placard — ne regarde pas l'historique.
 */
export interface LigneConsommee {
  /**
   * L'identité, qui décide de ce qui s'additionne. Elle porte le TYPE en
   * préfixe : deux `uuid` peuvent coïncider entre `food_catalog` et
   * `food_products`, et un aliment n'est pas un produit.
   */
  readonly identity: string;
  readonly sourceType: "catalog_food" | "product" | "free";
  readonly catalogFoodId?: string;
  readonly productId?: string;
  /** Le libellé tel qu'il a été FIGÉ — jamais relu dans le catalogue actuel. */
  readonly nameSnapshot: string;
  readonly quantityTotal: number;
  readonly unit: ConsumedUnit;
}

/**
 * Normalise un libellé pour comparer, jamais pour afficher.
 *
 * Volontairement PAUVRE : minuscules, accents retirés, espaces réduits. Rien
 * de plus — pas de racinisation, pas de synonymes, pas de distance
 * d'édition. C'est ce qui la rend prévisible.
 */
function normaliserLibelle(libellé: string): string {
  return libellé
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * L'identité d'une entrée, pour l'agrégation.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TROIS RÈGLES, ET LA TROISIÈME EST LA SEULE QUI DEMANDE UN ARBITRAGE
 * ────────────────────────────────────────────────────────────────────────────
 * 1. `catalog_food` → l'identifiant de l'aliment. Deux aliments différents ne
 *    se rejoignent JAMAIS, même s'ils portent le même nom.
 * 2. `product` → l'identifiant du produit, garanti unique par GTIN depuis A3.
 *    ⚠️ DEUX GTIN DIFFÉRENTS RESTENT DEUX PRODUITS. « Yaourt nature 500 g » et
 *    « Yaourt nature 1 kg » ont deux fiches, parfois deux compositions ;
 *    additionner leurs quantités mettrait sur une liste de courses un produit
 *    qui n'existe pas.
 * 3. `free` → le LIBELLÉ NORMALISÉ, et c'est la seule règle « souple » du
 *    fichier. Elle est sûre parce qu'elle ne s'applique QU'aux aliments saisis
 *    à la main, qui n'ont par définition aucun identifiant : le pire cas est
 *    que deux « pain » écrits par le même élève, à deux jours d'écart, soient
 *    additionnés — ce qui est précisément le comportement voulu.
 *
 *    Elle n'est JAMAIS appliquée à un produit ni à un aliment du catalogue :
 *    fusionner deux fiches sur la ressemblance de leur nom ferait acheter le
 *    mauvais article, et fausserait toute quantité qui en découle.
 *
 * Une entrée dont le pointeur manque — l'aliment a été supprimé du catalogue,
 * `on delete set null` a fait son travail — retombe sur la règle du libellé.
 * Son instantané reste exact ; c'est son identité qui a disparu, et on ne
 * l'invente pas.
 */
export function identiteDeLEntree(entrée: {
  sourceType: string;
  foodId: string | null;
  productId?: string | null;
  label: string;
}): { identity: string; sourceType: LigneConsommee["sourceType"] } {
  if (entrée.sourceType === "catalog_food" && entrée.foodId) {
    return { identity: `catalog_food:${entrée.foodId}`, sourceType: "catalog_food" };
  }
  if (entrée.sourceType === "product" && entrée.productId) {
    return { identity: `product:${entrée.productId}`, sourceType: "product" };
  }
  return { identity: `free:${normaliserLibelle(entrée.label)}`, sourceType: "free" };
}

/**
 * Agrège une période consommée en lignes prêtes pour Courses.
 *
 * ⚠️ L'UNITÉ FAIT PARTIE DE LA CLÉ, ET AUCUNE CONVERSION N'EST FAITE.
 *
 * 200 g et 200 ml du même produit donnent DEUX lignes. C'est volontaire :
 * `food_catalog` ne porte aucune densité, et inventer « 1 ml ≈ 1 g » créerait
 * une seconde convention nutritionnelle à côté du 4/4/9 — celle-là même que la
 * RPC d'A2 refuse depuis le premier jour. Deux lignes dans une liste de
 * courses se lisent ; une conversion inventée ne se voit pas.
 *
 * Le `nameSnapshot` retenu est celui de l'entrée la PLUS RÉCENTE de l'identité.
 * Les instantanés d'une même source peuvent différer si son nom a changé entre
 * deux consommations ; pour une liste de courses, c'est le nom le plus récent
 * qui aide à retrouver le produit en rayon.
 */
export function agregerConsommation(repas: readonly ConsumedMeal[]): readonly LigneConsommee[] {
  const parCle = new Map<string, LigneConsommee & { dernier: string }>();

  for (const r of repas) {
    for (const e of r.entries) {
      const { identity, sourceType } = identiteDeLEntree(e);
      const clé = `${identity}|${e.unit}`;
      const connu = parCle.get(clé);
      if (connu) {
        parCle.set(clé, {
          ...connu,
          quantityTotal: connu.quantityTotal + e.quantity,
          // Le libellé le plus récent gagne ; le reste de la ligne ne bouge pas.
          nameSnapshot: e.createdAt > connu.dernier ? e.label : connu.nameSnapshot,
          dernier: e.createdAt > connu.dernier ? e.createdAt : connu.dernier,
        });
        continue;
      }
      parCle.set(clé, {
        identity,
        sourceType,
        ...(sourceType === "catalog_food" && e.foodId ? { catalogFoodId: e.foodId } : {}),
        ...(sourceType === "product" && e.productId ? { productId: e.productId } : {}),
        nameSnapshot: e.label,
        quantityTotal: e.quantity,
        unit: e.unit,
        dernier: e.createdAt,
      });
    }
  }

  // Ordre déterministe : quantité décroissante, puis identité. Sans ce second
  // critère, deux lignes de même quantité pourraient sortir dans deux ordres
  // différents d'une exécution à l'autre.
  return [...parCle.values()]
    // `dernier` ne servait qu'à départager les libellés : il ne sort pas.
    .map((avecDernier): LigneConsommee => {
      const ligne: LigneConsommee = {
        identity: avecDernier.identity,
        sourceType: avecDernier.sourceType,
        ...(avecDernier.catalogFoodId ? { catalogFoodId: avecDernier.catalogFoodId } : {}),
        ...(avecDernier.productId ? { productId: avecDernier.productId } : {}),
        nameSnapshot: avecDernier.nameSnapshot,
        quantityTotal: avecDernier.quantityTotal,
        unit: avecDernier.unit,
      };
      return ligne;
    })
    .sort((a, b) =>
      a.quantityTotal !== b.quantityTotal
        ? b.quantityTotal - a.quantityTotal
        : a.identity.localeCompare(b.identity),
    );
}
