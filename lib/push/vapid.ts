import "server-only";

/**
 * LA CONFIGURATION VAPID — CÔTÉ SERVEUR, ET NULLE PART AILLEURS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * `import "server-only"` EN PREMIÈRE LIGNE
 * ════════════════════════════════════════════════════════════════════════
 * Ce n'est pas décoratif : le build ÉCHOUE si ce fichier est importé depuis
 * un composant `"use client"`. C'est la seule garantie mécanique qu'une clé
 * privée ne peut pas partir dans un bundle navigateur — une revue humaine
 * finit toujours par laisser passer un import.
 *
 * La clé PUBLIQUE, elle, est faite pour être vue : elle vit dans
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` et le navigateur en a besoin pour
 * s'abonner. La clé privée n'a AUCUNE raison de porter ce préfixe, et
 * `scripts/tests/push-socle.mts` échoue si elle en porte un.
 */

export interface ConfigurationVapid {
  cliquePublique: string;
  clePrivee: string;
  sujet: string;
}

/**
 * La configuration complète, ou `null` si l'environnement n'est pas prêt.
 *
 * Jamais d'exception : une Preview sans clés doit afficher « notifications
 * indisponibles », pas planter la page.
 */
export function configurationVapid(): ConfigurationVapid | null {
  const cliquePublique = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const clePrivee = process.env.VAPID_PRIVATE_KEY;
  const sujet = process.env.VAPID_SUBJECT;

  if (!cliquePublique || !clePrivee || !sujet) {
    return null;
  }
  // `mailto:` ou `https:` — la spécification VAPID n'accepte que ces deux.
  if (!sujet.startsWith("mailto:") && !sujet.startsWith("https://")) {
    return null;
  }
  return { cliquePublique, clePrivee, sujet };
}
