import type { ConsumedUnit } from "@/lib/nutrition/consumed";
import type { CatalogFood, ProduitLocal } from "@/lib/supabase/consumed-meals";

/**
 * LES TROIS DÉCISIONS DE L'ÉCRAN D'AJOUT (ALIMENTS A3, PHASE 5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CES RÈGLES NE VIVENT PAS DANS LE COMPOSANT
 * ────────────────────────────────────────────────────────────────────────────
 * Écrites dans `AddFoodSheet`, elles ne seraient vérifiables qu'en simulant des
 * taps — et le dépôt n'a ni jsdom ni bibliothèque de test DOM : ses harnais de
 * rendu s'arrêtent à `renderToString`, qui n'exécute aucun effet et ne clique
 * sur rien. Ces trois règles resteraient donc éprouvées par de la lecture de
 * code, c'est-à-dire pas éprouvées.
 *
 * Sorties ici, elles se prouvent sur des fonctions de trois lignes, y compris
 * le cas qui compte : « produit trouvé par son nom, unité provisoire g, fiche
 * complète en ml ».
 */

/**
 * Faut-il charger la fiche complète avant de laisser consommer ce produit ?
 *
 * ⚠️ Un produit trouvé par son NOM arrive sans `nutrition_data_per` : son unité
 * vaut « g » par DÉFAUT — un repli, pas une observation. Le consommer tel quel
 * écrirait 250 g là où la fiche dit 250 ml, et l'instantané resterait faux
 * pour toujours, puisqu'il ne suit jamais sa source.
 *
 * La question n'est donc pas « cette fiche est-elle vieille ? » mais « a-t-elle
 * jamais été chargée ? ». C'est exactement la distinction posée en phase 4.1
 * entre `source_fetched_at` et `detail_fetched_at`.
 */
export function doitHydrater(produit: ProduitLocal): boolean {
  return !produit.hydratee;
}

/**
 * Les unités proposées, qui sont EXACTEMENT celles que le serveur sait
 * convertir.
 *
 * Pour un produit : son unité nutritionnelle, et elle seule. Proposer des
 * grammes sur une fiche « pour 100 ml » demanderait une densité — nous n'en
 * inventons aucune, et la RPC refuserait de toute façon. Un choix qui se ferait
 * refuser n'est pas une liberté, c'est un piège.
 *
 * Pour un aliment générique : ce que dit le catalogue, pièce comprise quand il
 * sait ce qu'une pièce pèse.
 */
export function unitesPourProduit(produit: ProduitLocal): readonly ConsumedUnit[] {
  return [produit.nutritionUnit];
}

export function unitesPourAliment(aliment: CatalogFood): readonly ConsumedUnit[] {
  const unités: ConsumedUnit[] = [aliment.nutritionUnit];
  if (aliment.nutritionUnit === "g" && aliment.pieceWeightG !== null) unités.push("piece");
  return unités;
}

/**
 * Fusionne les produits trouvés en ligne avec ceux déjà affichés.
 *
 * ⚠️ LES RÉSULTATS LOCAUX NE SONT JAMAIS REMPLACÉS. La tentation inverse est
 * réelle — « la recherche externe est plus complète, remplaçons » — et elle
 * ferait disparaître de l'écran des produits déjà en cache, parfois déjà
 * consommés hier, au moment précis où l'élève en cherche un autre.
 *
 * La déduplication se fait par IDENTIFIANT : un produit déjà en cache qui
 * revient de la recherche externe est LA MÊME LIGNE `food_products`, pas un
 * doublon. C'est le GTIN unique qui le garantit, depuis la phase 3.
 *
 * L'ordre est préservé : les locaux d'abord, dans leur ordre, puis les
 * nouveaux dans celui du fournisseur. Aucun score maison ne s'y glisse.
 */
export function fusionnerProduits(
  actuels: readonly ProduitLocal[],
  trouvés: readonly ProduitLocal[],
): readonly ProduitLocal[] {
  const parId = new Map(actuels.map((p) => [p.id, p]));
  for (const p of trouvés) if (!parId.has(p.id)) parId.set(p.id, p);
  return [...parId.values()];
}

/**
 * Remplace une fiche partielle par sa version hydratée, en place.
 *
 * « En place » n'est pas un détail de style : la fiche garde son
 * `food_products.id`, donc sa position dans la liste et son identité pour la
 * RPC. Un ajout en fin de liste ferait apparaître le même produit deux fois,
 * l'un consommable et l'autre non.
 */
export function remplacerParFicheHydratee(
  actuels: readonly ProduitLocal[],
  complet: ProduitLocal,
): readonly ProduitLocal[] {
  return actuels.map((p) => (p.id === complet.id ? complet : p));
}
