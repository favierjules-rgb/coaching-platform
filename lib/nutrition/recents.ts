/**
 * LES ALIMENTS RÉCEMMENT CONSOMMÉS (ALIMENTS A5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÉRIVÉS DU JOURNAL, JAMAIS STOCKÉS
 * ────────────────────────────────────────────────────────────────────────────
 * Un récent n'est pas une donnée : c'est une LECTURE du journal. Créer une
 * table pour le stocker reviendrait à recopier des faits déjà écrits, et à
 * devoir les garder cohérents pour toujours — une entrée corrigée, un repas
 * supprimé, et la copie ment.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE EST UNE FEUILLE, ET C'EST CE QUI LE REND ÉPROUVABLE
 * ────────────────────────────────────────────────────────────────────────────
 * Ni Supabase, ni React, ni réseau. La requête vit dans
 * `lib/supabase/consumed-meals.ts` ; la RÈGLE — quoi dédupliquer, dans quel
 * ordre, combien en garder — vit ici, où elle se prouve sur des tableaux.
 */

/** Ce que la base rend, réduit à ce qui décide de l'ordre et de l'identité. */
export interface LigneRecente {
  readonly sourceType: string;
  readonly foodId: string | null;
  readonly productId: string | null;
  /** Horodatage ISO de l'ajout au journal. */
  readonly creeLe: string;
}

/** L'identité d'un aliment récent — la même notion que la cible d'un favori. */
export type CibleRecente =
  | { readonly type: "aliment"; readonly id: string }
  | { readonly type: "produit"; readonly id: string };

export interface Recent {
  readonly cible: CibleRecente;
  /** Le dernier ajout au journal, qui décide de la position. */
  readonly dernierAjout: string;
}

/**
 * L'identité d'une ligne, ou `null` si elle n'en a pas.
 *
 * ⚠️ LES ALIMENTS SAISIS À LA MAIN SONT VOLONTAIREMENT EXCLUS. Un
 * `source_type = 'free'` n'a pas d'identité stable : deux « Sandwich maison »
 * saisis à deux semaines d'intervalle sont deux textes libres, pas deux
 * occurrences du même aliment. Les dédupliquer par leur libellé confondrait des
 * aliments différents portant le même nom, et proposerait de « réajouter » un
 * aliment dont on ne saurait pas reconstituer les macros — un instantané ne
 * remonte pas à sa source, il n'en a pas.
 *
 * Les recettes (`recipe`) sont exclues pour une autre raison : elles ont bien
 * une identité, mais l'écran d'ajout d'A2/A3 ne sait pas les ajouter. Proposer
 * un raccourci qui n'aboutit à rien serait pire que ne rien proposer.
 */
export function cibleDeLaLigne(ligne: LigneRecente): CibleRecente | null {
  if (ligne.sourceType === "catalog_food" && ligne.foodId !== null) {
    return { type: "aliment", id: ligne.foodId };
  }
  if (ligne.sourceType === "product" && ligne.productId !== null) {
    return { type: "produit", id: ligne.productId };
  }
  return null;
}

export function cleRecent(cible: CibleRecente): string {
  return `${cible.type}:${cible.id}`;
}

/**
 * Déduplique et borne.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE PREMIER VU GAGNE, ET L'APPELANT DOIT TRIER AVANT
 * ────────────────────────────────────────────────────────────────────────────
 * Les lignes arrivent déjà triées du plus récent au plus ancien — c'est ce que
 * l'index `(student_id, created_at desc)` rend gratuitement. Garder la PREMIÈRE
 * occurrence de chaque identité donne donc exactement « le dernier ajout de cet
 * aliment », sans avoir à comparer des dates une seconde fois.
 *
 * Le tri est refait ici malgré tout, sur `dernierAjout` décroissant : une
 * requête dont l'ordre changerait — ou un appelant de test qui passerait un
 * tableau dans le désordre — ne doit pas produire un écran faux en silence.
 *
 * ⚠️ Un aliment mangé trois fois cette semaine apparaît UNE fois. C'est le
 * cœur du besoin : l'élève veut le retrouver vite, pas le voir trois fois
 * occuper la place de deux autres.
 */
export function ordonnerRecents(
  lignes: readonly LigneRecente[],
  limite: number,
): readonly Recent[] {
  const parCle = new Map<string, Recent>();
  for (const ligne of lignes) {
    const cible = cibleDeLaLigne(ligne);
    if (!cible) continue;
    const clé = cleRecent(cible);
    const connu = parCle.get(clé);
    if (!connu || ligne.creeLe > connu.dernierAjout) {
      parCle.set(clé, { cible, dernierAjout: ligne.creeLe });
    }
  }
  return [...parCle.values()]
    .sort((a, b) => {
      if (a.dernierAjout !== b.dernierAjout) return a.dernierAjout < b.dernierAjout ? 1 : -1;
      // Départage stable : sans lui, deux ajouts dans la même milliseconde
      // pourraient rendre deux ordres différents d'une exécution à l'autre.
      return cleRecent(a.cible).localeCompare(cleRecent(b.cible));
    })
    .slice(0, Math.max(0, limite));
}

/**
 * Combien de récents afficher.
 *
 * Douze : assez pour couvrir les habitudes d'une semaine ordinaire, assez peu
 * pour que la section ne pousse pas le champ de recherche et le scanner hors de
 * l'écran sur un téléphone. La borne du §2 est « 8 à 12 » ; on prend le haut,
 * l'écran les affiche en liste compacte.
 */
export const MAX_RECENTS = 12;

/**
 * Combien de lignes de journal relire pour les calculer.
 *
 * 200 entrées couvrent largement les douze aliments distincts les plus récents,
 * même chez quelqu'un qui varie beaucoup — un élève ajoute cinq à dix aliments
 * par jour. Et c'est BORNÉ : sans limite, la requête grandirait avec
 * l'ancienneté du compte, pour un résultat qui, lui, ne change pas.
 */
export const FENETRE_RECENTS = 200;
