/**
 * LE CODE-BARRES, ET RIEN QUE LUI (ALIMENTS A4, PHASE 2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE, ET POURQUOI C'EST UN DÉPLACEMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Ces trois fonctions vivaient dans `lib/open-food-facts/contrat.ts`. Elles y
 * étaient à leur place tant que seul le serveur validait un GTIN — mais le
 * scanner en a besoin DANS LE NAVIGATEUR, et `contrat.ts` exporte aussi
 * `OFF_BASE_URL`, `urlLookupProduit`, `OFF_FIELDS`, `OFF_CACHE_TTL_MS`…
 *
 * L'importer depuis un composant client ferait donc entrer les adresses d'API
 * d'Open Food Facts dans le bundle navigateur — ce que trois garde-fous
 * interdisent explicitement depuis la phase 3 (A3-OFF2, A3-SEARCH-SUP,
 * A2-POLISH10), et pour une raison qui tient toujours : l'interface appelle
 * NOS routes, jamais celles d'un tiers.
 *
 * ⚠️ CE N'EST PAS UNE SECONDE IMPLÉMENTATION. `contrat.ts` réexporte ces
 * fonctions : il n'existe qu'un seul `exigerGtin` dans le dépôt, et le serveur
 * comme le scanner appellent le même. Une règle dupliquée finit toujours par
 * diverger, et la divergence se voit d'abord dans l'assiette d'un élève.
 *
 * Ce module est une FEUILLE ABSOLUE : aucune importation, aucun réseau, aucune
 * variable d'environnement, aucun `server-only`. Il est utilisable partout.
 */

/**
 * Un GTIN est une CHAÎNE de 8, 12, 13 ou 14 chiffres. Deux règles ici, et
 * elles se contredisent en apparence :
 *
 *   - on N'ACCEPTE PAS n'importe quoi : une saisie hors forme est refusée
 *     AVANT tout appel, ce qui économise le quota Open Food Facts et rend une
 *     erreur immédiate ;
 *   - on NE RÉPARE RIEN : pas de complétion à 13 chiffres, pas de recalcul de
 *     clé de contrôle, pas de retrait de zéros. Un code « réparé » désigne un
 *     AUTRE produit, et l'élève n'aurait aucun moyen de s'en apercevoir.
 *
 * La clé de contrôle n'est délibérément pas vérifiée : Open Food Facts
 * contient de vrais produits dont le code imprimé ne la respecte pas, et les
 * refuser rendrait un produit réel inajoutable. Un code inventé se fait de
 * toute façon renvoyer PRODUCT_NOT_FOUND.
 *
 * Seuls les espaces de bord sont retirés — un scanner en ajoute parfois, et
 * un espace n'est pas un chiffre : le retirer ne change aucun produit.
 */
export function normaliserGtin(saisie: string): string {
  return saisie.trim();
}

export function gtinEstValide(gtin: string): boolean {
  return /^[0-9]{8}$/.test(gtin) || /^[0-9]{12,14}$/.test(gtin);
}

/**
 * Erreur de FORME du code-barres.
 *
 * Volontairement distincte de l'`OffErreur` d'A3 : ce module ne connaît pas
 * Open Food Facts, et ne doit pas l'importer pour lever une exception. La
 * couche A3 la retraduit en `INVALID_GTIN` — un seul vocabulaire remonte
 * jusqu'à l'écran.
 */
export class GtinInvalide extends Error {
  readonly code = "INVALID_GTIN" as const;
  constructor(saisie: string) {
    super(`Code-barres invalide : ${JSON.stringify(saisie)}`);
    this.name = "GtinInvalide";
  }
}

/** Refuse hors forme, sans jamais corriger. */
export function exigerGtin(saisie: string): string {
  const gtin = normaliserGtin(saisie);
  if (!gtinEstValide(gtin)) {
    throw new GtinInvalide(saisie);
  }
  return gtin;
}

/**
 * Version NON LEVANTE, pour la boucle de scan.
 *
 * ⚠️ La distinction est le cœur du §14 de la spécification A4 : une caméra
 * peut lire un code-barres qui n'est PAS un GTIN — un code de rayon, un
 * Code 128 de logistique, un QR de promotion. Ce n'est pas une erreur, c'est
 * un objet qui passe devant l'objectif.
 *
 * Le scanner doit donc CONTINUER à scanner, pas s'arrêter sur un échec. Lever
 * une exception à chaque image lue ferait de l'ordinaire un incident, trente
 * fois par seconde.
 */
export function lireGtin(saisie: string): string | null {
  const gtin = normaliserGtin(saisie);
  return gtinEstValide(gtin) ? gtin : null;
}
