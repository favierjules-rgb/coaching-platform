import type { ReactNode } from "react";

import { ChronometreSeance } from "@/components/student/ChronometreSeance";

/**
 * LE SEUL ENDROIT OÙ LE CHRONOMÈTRE EXISTE.
 *
 * Ce layout ne couvre QUE `/entrainement/seance/[sessionId]` : l'exécution
 * d'une séance. Ni le tableau de bord, ni la liste des programmes, ni la
 * nutrition, ni — surtout — le Builder (`app/admin/programmes/[programId]/
 * builder`), qui vit dans une branche entièrement disjointe de l'arbre des
 * routes. L'absence du chronomètre partout ailleurs n'est donc pas une
 * condition qu'un composant évalue et qu'on pourrait casser : c'est une
 * propriété de l'arborescence des fichiers.
 *
 * Il est ici plutôt que dans `page.tsx` parce que cette page a six branches
 * de `return` (chargement, erreur, séance introuvable, hors ligne, contenu
 * réel, démonstration). Monté dans la page, le chronomètre serait à écrire
 * six fois, et la septième branche ajoutée un jour l'oublierait. Monté ici,
 * il est rendu dans les six — et il ne se remonte pas quand la page passe de
 * « chargement » à « contenu », donc un compte à rebours lancé survit.
 *
 * `scripts/tests/chronometre-seance.mts` échoue si ce fichier cesse de rendre
 * `ChronometreSeance`, ou si un autre fichier de l'application se met à
 * l'importer.
 */
export default function SeanceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ChronometreSeance />
    </>
  );
}
