/**
 * AVIS CLIENTS — LE CONTRAT DE DONNÉES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE FICHIER EST LA FRONTIÈRE ENTRE L'INTERFACE ET SA SOURCE
 * ════════════════════════════════════════════════════════════════════════
 * L'interface (`GoogleReviews`, `GoogleReviewsStack`) ne connaît QUE ce
 * type. Elle ignore d'où viennent les avis : un tableau écrit à la main
 * aujourd'hui, l'API Google Business Profile demain. C'est ce qui permettra
 * à la Phase B de remplacer la source SANS toucher à un seul composant
 * visuel.
 *
 * ⚠️ AUCUN CHAMP N'EST INVENTÉ ICI. Chaque champ correspond à une donnée
 * que l'API Business Profile rend réellement : `reviewId`, `reviewer
 * .displayName`, `reviewer.profilePhotoUrl`, `starRating`, `comment`,
 * `createTime`. Le jour de la bascule, le travail se réduit à une
 * traduction champ à champ — pas à une renégociation du modèle.
 *
 * `googleUrl` est nullable POUR UNE RAISON PRÉCISE : l'API v4 ne rend pas
 * d'URL par avis, seulement un chemin de ressource
 * (`accounts/{a}/locations/{l}/reviews/{r}`) qui n'est pas un lien. On ne
 * fabriquera donc rien ; le champ existe pour le jour où une source en
 * fournira un.
 */

/** Les cinq notes possibles. Un `number` laisserait passer 0, 7 ou 4,5. */
export type NoteAvis = 1 | 2 | 3 | 4 | 5;

export interface GoogleReview {
  /** Identifiant stable de l'avis. Clé de rendu, et clé d'anti-doublon en Phase B. */
  readonly id: string;
  readonly authorName: string;
  /** URL de la photo de profil, ou `null`. Jamais un avatar générique fabriqué. */
  readonly authorPhoto: string | null;
  readonly rating: NoteAvis;
  /** Texte de l'avis, tel quel. Jamais reformulé, jamais tronqué. */
  readonly text: string;
  /** Date de publication, au format ISO 8601. */
  readonly date: string;
  /** Lien vers l'avis chez Google, quand il existe. Jamais fabriqué. */
  readonly googleUrl: string | null;
}

/**
 * CE QUE LA SECTION REÇOIT — les avis ET la provenance.
 *
 * ⚠️ `demonstration` N'EST PAS UN DÉTAIL D'IMPLÉMENTATION, c'est une garde.
 * Tant qu'il vaut `true`, la section affiche un bandeau disant à l'écran que
 * ces avis sont des exemples. Le jour où la Phase B branche Google, le
 * drapeau passe à `false` DANS LA SOURCE et le bandeau disparaît tout seul —
 * personne n'a à penser à le retirer, et il est donc impossible de publier
 * de faux avis en oubliant une étape.
 */
export interface ReviewsPayload {
  readonly reviews: readonly GoogleReview[];
  readonly demonstration: boolean;
  /** Note moyenne, arrondie au dixième. `null` si aucun avis. */
  readonly average: number | null;
  /** Nombre d'avis PUBLIABLES, c'est-à-dire ceux réellement affichés. */
  readonly count: number;
}

/** La seule note affichée publiquement. En dur : un seuil laisserait passer 4. */
export const NOTE_PUBLIABLE = 5 as const;

/**
 * LE FILTRE. Une fonction, pas un `.filter()` recopié à trois endroits.
 *
 * ⚠️ ÉGALITÉ STRICTE, JAMAIS UN SEUIL. `>= 5` serait équivalent aujourd'hui
 * et faux le jour où une source rendrait une note hors barème. `=== 5` ne
 * peut pas dériver.
 *
 * Écarte aussi les avis SANS TEXTE : un client peut noter cinq étoiles sans
 * écrire un mot, et la carte serait vide. Ce n'est pas de la censure — l'avis
 * compte toujours dans la moyenne chez Google — c'est qu'une carte sans
 * contenu n'a rien à montrer.
 */
export function estPubliable(avis: GoogleReview): boolean {
  return avis.rating === NOTE_PUBLIABLE && avis.text.trim().length > 0;
}

/** Les avis affichables, du plus récent au plus ancien. */
export function avisPubliables(avis: readonly GoogleReview[]): readonly GoogleReview[] {
  return avis
    .filter(estPubliable)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * La moyenne des avis affichés, arrondie au dixième.
 *
 * ⚠️ ELLE PORTE SUR LES AVIS AFFICHÉS, ET SUR EUX SEULS. Comme seuls les
 * 5 étoiles sont affichés, elle vaut toujours 5,0 — et c'est cohérent, parce
 * que c'est exactement ce que le visiteur a sous les yeux. Ce n'est PAS la
 * note moyenne de la fiche Google, qui inclut les avis de moins de cinq
 * étoiles et ceux sans texte. La Phase B devra donc lire la vraie moyenne
 * chez Google plutôt que de la recalculer ici.
 */
export function moyenne(avis: readonly GoogleReview[]): number | null {
  if (avis.length === 0) return null;
  const somme = avis.reduce((total, a) => total + a.rating, 0);
  return Math.round((somme / avis.length) * 10) / 10;
}
