import { AVIS_DEMONSTRATION } from "@/lib/reviews/google-reviews.mock";
import { avisPubliables, moyenne, type ReviewsPayload } from "@/lib/reviews/types";

/**
 * LA SOURCE DES AVIS — LE SEUL POINT À CHANGER EN PHASE B.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'INTERFACE NE SAIT PAS D'OÙ VIENNENT LES AVIS
 * ════════════════════════════════════════════════════════════════════════
 * `GoogleReviews` appelle `getReviews()` et reçoit un `ReviewsPayload`.
 * Elle ignore si les avis sortent d'un tableau écrit à la main, d'une table
 * Supabase ou de l'API Google. C'est délibéré, et c'est ce qui rend la
 * bascule indolore.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE LA PHASE B CHANGERA — ET RIEN D'AUTRE
 * ════════════════════════════════════════════════════════════════════════
 * Le corps de cette fonction. Concrètement :
 *
 *   1. remplacer `AVIS_DEMONSTRATION` par la lecture de la source réelle
 *      (table miroir alimentée par une synchronisation serveur) ;
 *   2. passer `demonstration` à `false` ;
 *   3. lire la note moyenne CHEZ GOOGLE plutôt que de la recalculer — voir
 *      l'avertissement sur `moyenne()` dans `types.ts` : la moyenne des avis
 *      AFFICHÉS n'est pas la moyenne de la fiche.
 *
 * Le filtre 5 étoiles, lui, ne bouge pas : il est déjà appliqué ici et il
 * restera appliqué là. Aucun composant visuel n'est concerné.
 *
 * ⚠️ `async` DÈS MAINTENANT, alors que rien n'attend. C'est volontaire : la
 * Phase B lira une base ou un réseau, et une signature qui changerait de
 * synchrone à asynchrone obligerait à retoucher la section — exactement ce
 * que cette frontière existe pour éviter.
 *
 * ⚠️ NE LÈVE JAMAIS. Une source indisponible rend une charge vide, et la
 * section ne rend alors rien du tout. Une page d'accueil ne tombe pas parce
 * qu'un service annexe est en panne.
 */
export async function getReviews(): Promise<ReviewsPayload> {
  try {
    // ── PHASE A : données de démonstration. Voir google-reviews.mock.ts.
    const bruts = AVIS_DEMONSTRATION;

    // Le filtre 5 étoiles est appliqué ICI, une seule fois, avant que
    // quoi que ce soit d'autre voie les avis. Les 3★, les 4★ et les avis
    // sans texte n'existent pas au-delà de cette ligne.
    const reviews = avisPubliables(bruts);

    return {
      reviews,
      // ⚠️ LE JOUR OÙ CE DRAPEAU PASSE À `false`, LE BANDEAU DISPARAÎT.
      // Tant qu'il vaut `true`, la section dit à l'écran que ces avis sont
      // des exemples. C'est la garde qui empêche de publier de faux
      // témoignages en oubliant une étape.
      demonstration: true,
      average: moyenne(reviews),
      count: reviews.length,
    };
  } catch {
    return { reviews: [], demonstration: true, average: null, count: 0 };
  }
}
