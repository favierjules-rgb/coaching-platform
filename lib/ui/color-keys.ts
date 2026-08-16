/**
 * N1.6A — LE VOCABULAIRE DE COULEUR DU PROJET, EN UN SEUL ENDROIT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ────────────────────────────────────────────────────────────────────────────
 * Ce vocabulaire n'est pas né avec N1.6. Il vivait déjà dans
 * `lib/training-block-editing.ts` et `components/admin/blocks/block-view-model.ts`,
 * au service des blocs d'entraînement, et il est le SEUL système de couleurs
 * stocké du projet — vérifié : une seule colonne `%color%` en base avant ce
 * lot, `training_blocks.color_key`.
 *
 * ⚠️ LES LISTES D'ALIMENTS NE MÉRITAIENT PAS UN SECOND SYSTÈME. Recopier la
 * table de styles aurait produit deux vérités qui divergent au premier ajout de
 * teinte, et le design system — strictement monochrome plus trois accents
 * sémantiques (`--destructive`, `--warning`, `--success`) — n'en porte aucune
 * autre. On EXTRAIT donc, on ne duplique pas : les blocs d'entraînement
 * ré-exportent ce fichier sous leurs anciens noms, et rien de leur code
 * n'a bougé.
 *
 * ⚠️ AUCUNE COULEUR N'EST UNE DONNÉE MÉTIER. Ni ici, ni ailleurs : une clé de
 * couleur ne dit rien d'un bloc d'entraînement, et ne dira rien d'une liste
 * d'aliments. Elle ne porte aucun rôle, aucune catégorie, aucune sémantique
 * nutritionnelle — c'est une aide visuelle, et le jour où elle deviendrait
 * autre chose, ce fichier serait le mauvais endroit pour l'écrire.
 */

/**
 * Les clés autorisées, miroir strict des contraintes SQL
 * `training_blocks.color_key` et — depuis N1.6A — `food_lists.color_key` et
 * `meal_choice_slots.color_key`.
 *
 * ⚠️ PAS DE `pink`, ET CE N'EST PAS UN OUBLI. Il n'existe dans aucune des trois
 * contraintes ; l'ajouter demanderait d'étendre la table de styles ET de
 * valider son contraste dans les deux thèmes. Une couleur qu'on n'a pas mesurée
 * n'entre pas.
 *
 * ⚠️ PAS DE CHAÎNE CSS ARBITRAIRE NON PLUS. Un `text` libre autoriserait
 * `#000` sur fond noir, et il n'existe aucun endroit où le valider.
 */
export const COLOR_KEYS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/**
 * Styles d'accent par clé, TABLE STATIQUE EXHAUSTIVE.
 *
 * ⚠️ LES CLASSES SONT DES LITTÉRAUX COMPLETS, jamais construites dynamiquement
 * (`bg-${color}-500`) : le moteur Tailwind ne détecte que ce qu'il peut lire.
 *
 * ⚠️ ACCENTS DISCRETS, ET C'EST UNE RÈGLE. Pastille, fine bordure latérale,
 * fond très léger — jamais de remplissage fortement coloré. L'identité du
 * projet est monochrome ; la couleur s'y invite en accent, pas en fond.
 */
export const COLOR_STYLES: Record<ColorKey, {
  readonly dot: string;
  readonly borderLeft: string;
  readonly softBg: string;
  readonly label: string;
}> = {
  gray: { dot: "bg-neutral-400", borderLeft: "border-l-neutral-400/70", softBg: "bg-neutral-400/5", label: "Gris" },
  red: { dot: "bg-red-500", borderLeft: "border-l-red-500/70", softBg: "bg-red-500/5", label: "Rouge" },
  orange: { dot: "bg-orange-500", borderLeft: "border-l-orange-500/70", softBg: "bg-orange-500/5", label: "Orange" },
  yellow: { dot: "bg-yellow-500", borderLeft: "border-l-yellow-500/70", softBg: "bg-yellow-500/5", label: "Jaune" },
  green: { dot: "bg-green-500", borderLeft: "border-l-green-500/70", softBg: "bg-green-500/5", label: "Vert" },
  blue: { dot: "bg-blue-500", borderLeft: "border-l-blue-500/70", softBg: "bg-blue-500/5", label: "Bleu" },
  purple: { dot: "bg-purple-500", borderLeft: "border-l-purple-500/70", softBg: "bg-purple-500/5", label: "Violet" },
};

/** Ordre stable d'affichage dans un sélecteur — miroir de l'énumération. */
export const COLOR_ORDER: readonly ColorKey[] = COLOR_KEYS;

/** Libellé humain d'une couleur. Le sélecteur le montre TOUJOURS : une pastille seule n'est pas accessible. */
export function colorLabel(key: ColorKey): string {
  return COLOR_STYLES[key].label;
}

/** `true` si `value` appartient au vocabulaire. */
export function isColorKey(value: unknown): value is ColorKey {
  return typeof value === "string" && (COLOR_KEYS as readonly string[]).includes(value);
}

/**
 * N1.6A — LA COULEUR D'UNE LISTE D'ALIMENTS EST FACULTATIVE, ET `null` N'EST
 * PAS `gray`.
 *
 * ⚠️ DEUX ÉTATS DISTINCTS, ET ILS SE VOIENT. `null` = le coach n'a choisi
 * AUCUNE couleur : aucun accent n'est rendu, la ligne reste exactement telle
 * qu'avant N1.6A. `gray` = il a choisi le gris : une pastille grise s'affiche.
 * Les confondre ferait de `null` une couleur, et interdirait de revenir en
 * arrière.
 *
 * (Les blocs d'entraînement, eux, sont `not null default 'gray'` : la couleur
 * y est obligatoire depuis l'origine. Les deux règles cohabitent sans se
 * contredire — ce sont deux colonnes différentes.)
 */
export function colorStyleOrNull(value: string | null | undefined): (typeof COLOR_STYLES)[ColorKey] | null {
  return isColorKey(value) ? COLOR_STYLES[value] : null;
}
