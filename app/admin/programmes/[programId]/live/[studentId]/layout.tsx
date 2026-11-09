import type { ReactNode } from "react";

import { ChronometreSeance } from "@/components/student/ChronometreSeance";

/**
 * LE CHRONOMÈTRE, SUR LE PLANNING EN MODE LIVE.
 *
 * ⚠️ POURQUOI DÈS LE PLANNING ET PAS SEULEMENT SUR LA SÉANCE ? Parce qu'en
 * salle le minuteur de repos tourne ENTRE deux séances autant que pendant :
 * on finit une série, on ouvre le planning pour vérifier la suite, et un
 * chronomètre qui se remonte à chaque changement de page ne sert à rien. Monté
 * ici, le compte survit à la navigation planning → séance → planning.
 *
 * ⚠️ IL NE DÉMARRE PAS DE LUI-MÊME, et il ne mesure PAS la durée de séance :
 * celle-ci reste déclarée dans le bilan. Le composant n'écrit dans aucun champ
 * de retour et ne persiste rien, pas même dans le navigateur.
 *
 * `scripts/tests/chronometre-seance.mts` connaît les points de montage
 * autorisés un par un : en ajouter un sans l'y déclarer fait rougir la suite.
 */
export default function PlanningLiveLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ChronometreSeance />
    </>
  );
}
