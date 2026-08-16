import {
  cleDeLigne,
  formatQuantite,
  type IdentityType,
  type LigneDeCourses,
} from "@/lib/nutrition/liste-de-courses";
import { NBSP } from "@/lib/nutrition/basis-points";
import { MOIS_FR, partiesDeDate } from "@/lib/nutrition/historique";
import type { ColorKey } from "@/lib/ui/color-keys";

/**
 * COURSES C2 — LA LISTE PERSISTÉE, ET SA COMPARAISON AVEC LE PLAN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE NE RÉ-AGRÈGE RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * L'agrégation est faite par `agregerListeDeCourses` (C1), et il n'en existe
 * qu'une. Ici on compare ce qu'elle produit MAINTENANT avec ce qui est ÉCRIT en
 * base, et on assemble les deux origines pour l'affichage.
 *
 * ⚠️ LA COMPARAISON NE PORTE JAMAIS SUR LES NOMS (§14). Deux aliments peuvent
 * avoir le même libellé, un libellé peut être corrigé côté catalogue sans que
 * rien n'ait changé pour l'élève. On compare des IDENTITÉS, des UNITÉS et des
 * QUANTITÉS — c'est-à-dire ce qui change réellement ce qu'il faut acheter.
 *
 * ⚠️ AUCUNE CONVERSION D'UNITÉ, NULLE PART. Ni g↔kg, ni ml↔L, ni pièce↔g. Deux
 * unités différentes pour la même identité sont deux lignes, ici comme en base
 * et comme dans C1.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 */

export type OrigineDeLigne = "plan" | "manual";

/** Une ligne telle qu'elle est EN BASE — avant toute hydratation. */
export interface LignePersistee {
  readonly id: string;
  readonly source: OrigineDeLigne;
  readonly catalogFoodId: string | null;
  readonly productId: string | null;
  /** Le libellé d'un article MANUEL. `null` pour une ligne PLAN. */
  readonly label: string | null;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly checked: boolean;
  readonly creeLe: string;
}

export interface ListePersistee {
  readonly id: string;
  readonly debut: string;
  readonly fin: string;
  readonly majLe: string;
  readonly lignes: readonly LignePersistee[];
}

/** Une ligne prête pour l'écran : origine, libellé résolu, état. */
export interface LigneAffichee {
  readonly id: string;
  readonly source: OrigineDeLigne;
  /**
   * PLAN : `catalog_food:UUID|g`. MANUEL : `manual:UUID-de-la-ligne`.
   *
   * ⚠️ UN ARTICLE MANUEL N'A PAS D'IDENTITÉ, donc pas de clé d'agrégation. Sa
   * clé d'affichage est son identifiant de ligne — deux « Éponges » saisis deux
   * fois sont deux articles, et c'est le comportement voulu : personne n'a
   * demandé qu'ils fusionnent.
   */
  readonly cle: string;
  readonly libelle: string;
  /** Déjà formatée (« 300 g »), ou `null` quand il n'y en a pas. */
  readonly quantite: string | null;
  readonly colorKey: ColorKey | null;
  readonly checked: boolean;
}

export interface Progression {
  readonly coches: number;
  readonly total: number;
  /** « 12 / 24 articles ». */
  readonly libelle: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * LA CLÉ D'UNE LIGNE PERSISTÉE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * La clé d'agrégation d'une ligne PLAN persistée — la MÊME que celle de C1.
 *
 * Rend `null` pour une ligne manuelle : elle n'entre dans aucune comparaison
 * avec le plan, par construction.
 */
export function cleDeLignePersistee(ligne: LignePersistee): string | null {
  if (ligne.source !== "plan" || ligne.unit === null) return null;
  if (ligne.catalogFoodId !== null && ligne.productId === null) {
    return cleDeLigne("catalog_food", ligne.catalogFoodId, ligne.unit);
  }
  if (ligne.productId !== null && ligne.catalogFoodId === null) {
    return cleDeLigne("product", ligne.productId, ligne.unit);
  }
  // La base garantit « exactement une cible » par contrainte. On le revérifie
  // plutôt que de faire confiance : une ligne incohérente doit sortir des
  // comparaisons, pas y produire une clé bancale.
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * §14 — LA DÉTECTION DE CHANGEMENT, SANS AMBIGUÏTÉ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * La représentation CANONIQUE d'un ensemble de lignes PLAN.
 *
 * ⚠️ TRIÉE, ET SUR TROIS CHAMPS SEULEMENT : identité, unité, quantité. Le tri
 * rend la comparaison indépendante de l'ordre de lecture, qui n'a aucune
 * signification. Les trois champs sont exactement ce qui change ce qu'il faut
 * acheter — un nom corrigé, une couleur d'occurrence ou une nouvelle source
 * n'en font pas partie, et ne doivent donc PAS déclencher « mettre à jour ».
 *
 * ⚠️ LA QUANTITÉ EST NORMALISÉE EN CHAÎNE. `300` et `300.0` sont la même
 * quantité ; `numeric` de PostgreSQL revient parfois avec des décimales, et une
 * comparaison sur des nombres flottants ferait clignoter le bouton « METTRE À
 * JOUR » sans qu'aucune donnée n'ait bougé.
 */
function canonique(entrees: readonly { cle: string; quantite: number }[]): string {
  return entrees
    .map((e) => `${e.cle}=${normaliserQuantite(e.quantite)}`)
    .sort()
    .join(";");
}

function normaliserQuantite(q: number): string {
  if (!Number.isFinite(q)) return "?";
  // 6 décimales : au-delà, c'est du bruit de représentation, pas une quantité.
  return String(Math.round(q * 1e6) / 1e6);
}

/** La signature canonique de ce que le PLAN dit aujourd'hui. */
export function signatureDuPlan(lignes: readonly LigneDeCourses[]): string {
  return canonique(lignes.map((l) => ({ cle: l.cle, quantite: l.quantite })));
}

/** La signature canonique de ce qui est ÉCRIT en base. Les MANUELS en sont exclus. */
export function signatureDeLaListe(liste: ListePersistee | null): string {
  if (liste === null) return "";
  const entrees: { cle: string; quantite: number }[] = [];
  for (const ligne of liste.lignes) {
    const cle = cleDeLignePersistee(ligne);
    if (cle === null || ligne.quantity === null) continue;
    entrees.push({ cle, quantite: ligne.quantity });
  }
  return canonique(entrees);
}

export type EtatDeLaListe = "absente" | "a_jour" | "a_mettre_a_jour";

/**
 * Faut-il proposer « GÉNÉRER », « METTRE À JOUR », ou rien ?
 *
 * ⚠️ AUCUNE RÉGÉNÉRATION SILENCIEUSE (§13). Ouvrir l'écran ne réécrit rien :
 * cette fonction décide seulement quel BOUTON montrer. Écrire à l'ouverture
 * ferait perdre les cases cochées de quelqu'un dont le plan a bougé pendant
 * qu'il faisait ses courses.
 */
export function etatDeLaListe(
  liste: ListePersistee | null,
  lignesDuPlan: readonly LigneDeCourses[],
): EtatDeLaListe {
  if (liste === null) return "absente";
  return signatureDeLaListe(liste) === signatureDuPlan(lignesDuPlan)
    ? "a_jour"
    : "a_mettre_a_jour";
}

/* ══════════════════════════════════════════════════════════════════════════
 * L'ASSEMBLAGE POUR L'ÉCRAN
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Les lignes prêtes à afficher : les PLAN d'abord (hydratées depuis
 * l'agrégation du jour), puis les MANUELS dans leur ordre d'ajout.
 *
 * ⚠️ LE LIBELLÉ D'UNE LIGNE PLAN VIENT DE L'AGRÉGATION, PAS DE LA BASE. C'est
 * la règle « snapshot vs hydratation » : la quantité est figée par la
 * régénération, le nom suit la fiche. Une ligne PLAN dont l'identité n'est plus
 * dans l'agrégation du jour n'a aucun nom à montrer — elle est signalée comme
 * telle plutôt qu'affichée sous un libellé inventé.
 */
export function lignesAAfficher(
  liste: ListePersistee | null,
  lignesDuPlan: readonly LigneDeCourses[],
): readonly LigneAffichee[] {
  if (liste === null) return [];
  const parCle = new Map(lignesDuPlan.map((l) => [l.cle, l] as const));
  const plan: LigneAffichee[] = [];
  const manuels: LigneAffichee[] = [];

  for (const ligne of liste.lignes) {
    if (ligne.source === "manual") {
      manuels.push({
        id: ligne.id,
        source: "manual",
        cle: `manual:${ligne.id}`,
        libelle: ligne.label ?? "",
        quantite:
          ligne.quantity === null
            ? null
            : ligne.unit === null
              ? String(ligne.quantity)
              : formatQuantite(ligne.quantity, ligne.unit),
        colorKey: null,
        checked: ligne.checked,
      });
      continue;
    }
    const cle = cleDeLignePersistee(ligne);
    if (cle === null || ligne.quantity === null || ligne.unit === null) continue;
    const duPlan = parCle.get(cle) ?? null;
    plan.push({
      id: ligne.id,
      source: "plan",
      cle,
      // ⚠️ AUCUN LIBELLÉ INVENTÉ. Une identité absente de l'agrégation du jour
      // (aliment retiré du catalogue, plan recomposé) est nommée pour ce
      // qu'elle est : une ligne à rafraîchir, pas un aliment plausible.
      libelle: duPlan?.displayName ?? "Article à rafraîchir",
      quantite: formatQuantite(ligne.quantity, ligne.unit),
      colorKey: duPlan?.colorKey ?? null,
      checked: ligne.checked,
    });
  }

  plan.sort((a, b) => {
    const parNom = a.libelle.localeCompare(b.libelle, "fr");
    return parNom !== 0 ? parNom : a.cle.localeCompare(b.cle);
  });
  return [...plan, ...manuels];
}

/**
 * « 12 / 24 articles ».
 *
 * ⚠️ LES LIGNES COCHÉES RESTENT COMPTÉES DANS LE TOTAL (§9). Une liste dont le
 * total diminue à mesure qu'on coche ne dit plus combien il y avait à acheter.
 */
export function progression(lignes: readonly LigneAffichee[]): Progression {
  const total = lignes.length;
  const coches = lignes.filter((l) => l.checked).length;
  return {
    coches,
    total,
    // ⚠️ LES ESPACES INSÉCABLES SONT NOMMÉES, PAS TAPÉES. Un U+00A0 invisible
    // dans un littéral est un piège : il se compare mal, se copie mal, et fait
    // échouer un test pour une raison illisible dans le diff.
    libelle: `${coches}${NBSP}/${NBSP}${total} article${total > 1 ? "s" : ""}`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * LA CHARGE UTILE ENVOYÉE À LA RPC
 * ════════════════════════════════════════════════════════════════════════ */

export interface LignePourRpc {
  readonly catalog_food_id: string | null;
  readonly product_id: string | null;
  readonly quantity: number;
  readonly unit: string;
}

/**
 * Traduit l'agrégation C1 en charge utile pour `regenerer_liste_de_courses`.
 *
 * ⚠️ NI NOM, NI COULEUR, NI SOURCES. La base n'a que faire de l'affichage, et
 * lui envoyer un libellé l'inviterait à le stocker — ce que le contrat de la
 * table interdit précisément.
 */
export function lignesPourRpc(lignes: readonly LigneDeCourses[]): readonly LignePourRpc[] {
  return lignes.map((l) => ({
    catalog_food_id: identiteVers(l.identityType, "catalog_food") ? l.identityId : null,
    product_id: identiteVers(l.identityType, "product") ? l.identityId : null,
    quantity: l.quantite,
    unit: l.unit,
  }));
}

function identiteVers(type: IdentityType, attendu: IdentityType): boolean {
  return type === attendu;
}

/* ══════════════════════════════════════════════════════════════════════════
 * LA DATE DE DERNIÈRE MODIFICATION
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * « modifiée le 4 mars », ou `null` si la date est illisible.
 *
 * ⚠️ CETTE DATE DIT LA VÉRITÉ, ET C'EST POURQUOI ELLE EST AFFICHÉE. La RPC
 * n'avance `updated_at` que si une ligne a réellement bougé : une régénération
 * à l'identique — le cas le plus fréquent — ne la touche pas. Une colonne
 * horodatée qui avancerait à chaque ouverture ne serait pas seulement inutile :
 * elle ferait croire à un changement qui n'a pas eu lieu.
 *
 * ⚠️ AUCUN `new Date()` ICI. La date est découpée telle qu'elle vient, avec les
 * helpers du projet : construire un `Date` la ferait glisser d'un jour selon le
 * fuseau du téléphone.
 */
export function libelleDerniereModification(liste: ListePersistee | null): string | null {
  if (liste === null) return null;
  const parties = partiesDeDate(liste.majLe.slice(0, 10));
  if (parties === null) return null;
  const mois = MOIS_FR[parties.m - 1];
  if (mois === undefined) return null;
  return `modifiée le ${parties.j}${NBSP}${mois}`;
}
