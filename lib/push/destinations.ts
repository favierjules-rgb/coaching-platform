/**
 * LES SEULES DESTINATIONS QU'UNE NOTIFICATION A LE DROIT D'OUVRIR.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UNE LISTE, ET PAS UNE VALIDATION D'URL
 * ════════════════════════════════════════════════════════════════════════
 * Une notification est un lien cliquable qui s'ouvre HORS du navigateur,
 * sans barre d'adresse. Laisser saisir une URL libre, c'est offrir un
 * hameçonnage parfait : le message vient de SETH, l'icône vient de SETH, et
 * la page qui s'ouvre vient d'ailleurs.
 *
 * La liste est donc fermée. Elle existe en DEUX endroits, volontairement :
 *   • ici, pour l'interface et le service worker ;
 *   • en base, dans la contrainte CHECK de `notification_campaigns`
 *     (migration 20260828090000) — pour qu'une insertion directe, hors de
 *     ce code, ne puisse pas la contourner.
 *
 * `scripts/tests/push-socle.mts` compare les deux et échoue si elles
 * divergent : une liste doublée qui dérive serait pire qu'une seule.
 */

/** Les routes statiques autorisées. */
export const DESTINATIONS_STATIQUES = [
  "/dashboard",
  "/entrainement",
  "/nutrition",
  "/documents",
  "/profil",
  "/progression",
  "/rendez-vous",
] as const;

/** Une séance précise : `/entrainement/seance/<uuid>`. */
const SEANCE = /^\/entrainement\/seance\/[0-9a-fA-F-]{36}$/;

/**
 * `true` si ce chemin peut être ouvert par une notification.
 *
 * Rien d'autre ne passe : ni URL absolue, ni protocole, ni `//evil.example`
 * (que `new URL(x, origine)` résoudrait vers un autre domaine), ni chemin
 * relatif, ni fragment.
 */
export function estDestinationInterne(destination: unknown): destination is string {
  if (typeof destination !== "string" || destination.length === 0) {
    return false;
  }
  // `//` en tête = URL protocole-relative : elle CHANGE de domaine.
  if (!destination.startsWith("/") || destination.startsWith("//")) {
    return false;
  }
  if (destination.includes("\\") || destination.includes("\n") || destination.includes("\r")) {
    return false;
  }
  return (
    (DESTINATIONS_STATIQUES as readonly string[]).includes(destination) || SEANCE.test(destination)
  );
}

/** La destination par défaut, quand rien n'est précisé. */
export const DESTINATION_PAR_DEFAUT = "/dashboard";
