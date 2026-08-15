"use client";

import { ColorKeyPicker } from "@/components/ui/ColorKeyPicker";
import type { BlockColorKey } from "@/lib/training-block-editing";

/**
 * Sélecteur de couleur d'un bloc (Lot 4.2).
 *
 * ⚠️ N1.6A — CE COMPOSANT A ÉTÉ VIDÉ DE SA MÉCANIQUE, PAS DE SON CONTRAT. Le
 * comportement (bouton nommé, focus visible, nom TEXTUEL de chaque couleur,
 * `aria-checked`, fermeture Échap) vit désormais dans `ColorKeyPicker`, parce
 * que les listes d'aliments réutilisent exactement le même sélecteur. Recopier
 * la mécanique aurait donné deux composants à corriger à chaque bug
 * d'accessibilité.
 *
 * ⚠️ LA COULEUR D'UN BLOC RESTE OBLIGATOIRE (`training_blocks.color_key` est
 * `not null default 'gray'`) : pas d'entrée « Aucune » ici. C'est la seule
 * différence avec les listes d'aliments, et elle vient du schéma.
 */
export function BlockColorPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: BlockColorKey;
  onChange: (color: BlockColorKey) => void;
  ariaLabel: string;
}) {
  return (
    <ColorKeyPicker
      value={value}
      ariaLabel={ariaLabel}
      onChange={(couleur) => {
        // `autoriserAucune` est faux : `couleur` ne peut pas être `null`.
        if (couleur !== null) onChange(couleur);
      }}
    />
  );
}
