import type { SupabaseClient } from "@supabase/supabase-js";

import type { Conditionnement } from "@/lib/nutrition/conditionnements";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * COURSES C4.5 — LE CONDITIONNEMENT DES RÉFÉRENCES, CÔTÉ BASE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUNE NOUVELLE SOURCE, AUCUN APPEL RÉSEAU — ET C'EST LE RÉSULTAT DE
 * L'AUDIT, PAS UNE PRÉCAUTION DE STYLE
 * ════════════════════════════════════════════════════════════════════════════
 * `food_products` porte DÉJÀ le conditionnement, depuis la migration
 * 20260903090000 :
 *
 *     net_quantity numeric      ← `product_quantity` d'Open Food Facts
 *     net_unit     text         ← `product_quantity_unit`, borné à ('g','ml')
 *
 * Ces deux colonnes sont remplies par `lireQuantiteNette` (lot A3), qui lit les
 * champs STRUCTURÉS d'OFF — jamais le texte libre `quantity` (« 2 x 125 g »),
 * qui est bien demandé mais n'est pas persisté. Et `OFF_FIELDS` les demande sur
 * LES DEUX chemins d'entrée : le lookup au scan ET la recherche par code Ciqual
 * qui alimente la curation C4.1. Toute ligne de `food_products` porte donc son
 * conditionnement dès qu'Open Food Facts le publie.
 *
 * Conséquence directe, et elle comptait : Open Food Facts peut rester en panne.
 * C4.5 n'ajoute AUCUN appel par GTIN, ni ici ni ailleurs.
 *
 * ⚠️ ET AUCUNE ÉCRITURE. Pas un `insert`, pas un `update`, pas une `rpc`. C4.5
 * lit ce que la curation a posé.
 *
 * ⚠️ POURQUOI UNE LECTURE SÉPARÉE PLUTÔT QU'UNE COLONNE DE PLUS DANS CELLE DE
 * C4.4. `lireGtinsDeLaListe` répond à « quels code-barres servent cette
 * liste ? » ; celle-ci répond à « que pèse ce qui est vendu sous ce
 * code-barres ? ». Deux questions, deux fonctions — la même doctrine qui a
 * séparé `observations.ts` d'`apercu.ts`. Le coût est un aller-retour ; le gain
 * est que C4.4, tout juste livré, reste bit-à-bit intact.
 */

export interface LectureConditionnements {
  /** `false` = la lecture a ÉCHOUÉ. Ce n'est PAS « aucun conditionnement connu ». */
  readonly ok: boolean;
  /**
   * Un conditionnement par code-barres DEMANDÉ.
   *
   * ⚠️ LA CLÉ EXISTE MÊME QUAND LA VALEUR EST INCONNUE, et c'est voulu : une
   * entrée absente et une entrée à `null` doivent se lire pareil côté calcul
   * (`conditionnement_absent`), sans que l'appelant ait à distinguer « pas
   * demandé » de « demandé, pas publié ».
   */
  readonly parGtin: ReadonlyMap<string, Conditionnement | null>;
}

/**
 * Les quantités nettes des code-barres demandés.
 *
 * ⚠️ `ok: false` N'EST PAS UNE CARTE VIDE. Un réseau coupé afficherait sinon
 * « conditionnement inconnu » sur toutes les références — et l'élève en
 * conclurait que le catalogue produit est vide. Même leçon que `LecturePrix.ok`
 * en C3 et `LectureObservations.ok` en C4.4.
 */
export async function lireConditionnements(
  supabase: TypedSupabaseClient,
  gtins: readonly string[],
): Promise<LectureConditionnements> {
  const parGtin = new Map<string, Conditionnement | null>();
  for (const gtin of gtins) if (gtin !== "") parGtin.set(gtin, null);
  if (parGtin.size === 0) return { ok: true, parGtin };

  const { data, error } = await supabase
    .from("food_products")
    .select("gtin, net_quantity, net_unit")
    .in("gtin", [...parGtin.keys()]);

  if (error || !Array.isArray(data)) return { ok: false, parGtin: new Map() };

  for (const brut of data as ReadonlyArray<Record<string, unknown>>) {
    const gtin = typeof brut["gtin"] === "string" ? brut["gtin"] : "";
    if (gtin === "" || !parGtin.has(gtin)) continue;

    const quantite = brut["net_quantity"];
    const unite = brut["net_unit"];
    // ⚠️ LA PAIRE EST INDISSOCIABLE, et la base l'impose déjà
    // (`food_products_net_quantity_paire`). On la revérifie plutôt que de faire
    // confiance : une moitié de conditionnement ne vaut rien, et la garder
    // ferait porter au calcul une donnée que le schéma déclare impossible.
    if (unite !== "g" && unite !== "ml") continue;
    if (typeof quantite !== "number" && typeof quantite !== "string") continue;

    // ⚠️ AUCUNE VALIDATION NUMÉRIQUE ICI. Zéro, négatif, trop de décimales :
    // c'est `quantiteMilliDepuis` qui tranche, dans le module PUR, où le refus
    // est testable sans base. Deux endroits qui valident la même chose finissent
    // toujours par diverger.
    parGtin.set(gtin, { netQuantity: quantite, netUnit: unite });
  }

  return { ok: true, parGtin };
}
