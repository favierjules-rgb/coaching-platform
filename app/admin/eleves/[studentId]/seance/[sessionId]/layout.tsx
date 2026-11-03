import type { ReactNode } from "react";

import { ChronometreSeance } from "@/components/student/ChronometreSeance";

/**
 * LE CHRONOMÈTRE, SUR LA SÉANCE EN PRÉSENTIEL — ET SUR ELLE SEULE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN SECOND POINT DE MONTAGE, ALORS QU'IL N'Y EN AVAIT QU'UN
 * ════════════════════════════════════════════════════════════════════════
 * Le minuteur de repos était monté par
 * `app/(student)/entrainement/seance/[sessionId]/layout.tsx`, et
 * `scripts/tests/chronometre-seance.mts` interdisait explicitement sa
 * présence dans tout `app/admin/**` — parce que, jusqu'ici, « admin » voulait
 * dire « le Builder et les écrans de gestion », où un minuteur n'a rien à
 * faire. Le mode présentiel ouvre une route d'`app/admin` qui est, elle, une
 * SÉANCE en salle : le coach y a besoin de minuter les repos exactement comme
 * l'élève. La règle n'a pas été affaiblie, son périmètre a été précisé : le
 * chronomètre vit sur les routes de SÉANCE, pas sur les routes d'un espace.
 *
 * ⚠️ UN LAYOUT, PAS LA PAGE. Le contenu présentiel a plusieurs branches de
 * `return` (programme absent, chargement, séance introuvable, contenu réel).
 * Monté dans le composant, le chronomètre serait à répéter dans chacune, et
 * se remonterait à chaque changement d'état — un compte à rebours lancé
 * serait perdu au premier chargement terminé. Ici, sa présence est une
 * propriété de l'arborescence, et le compte survit.
 *
 * ⚠️ IL NE DÉMARRE PAS TOUT SEUL, ICI PAS PLUS QU'AILLEURS, et il ne mesure
 * PAS la durée de séance : celle-ci reste déclarée dans le bilan final. Le
 * composant n'écrit dans aucun champ de retour et ne persiste rien, pas même
 * dans le navigateur — il n'y a donc rien qui puisse atterrir dans les
 * données de l'élève.
 */
export default function SeancePresentielLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ChronometreSeance />
    </>
  );
}
