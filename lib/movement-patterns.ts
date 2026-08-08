import type { MovementPattern } from "@/types";

/**
 * PATTERNS DE MOUVEMENT — vocabulaire contrôlé de la banque d'exercices.
 *
 * POURQUOI. Deux exercices sont interchangeables quand ils sollicitent la
 * MÊME action articulaire, pas quand ils partagent un groupe musculaire :
 * « pectoraux » réunit le développé couché et l'écarté, qui ne se
 * remplacent pas l'un l'autre. Le pattern est donc la clé de regroupement
 * du remplacement élève (« exercice indisponible »).
 *
 * OÙ VIT LA VÉRITÉ. Le vocabulaire est ici ET dans le CHECK SQL de
 * `exercise_library.movement_pattern` (migration 20260820090000). Les deux
 * listes DOIVENT rester identiques — c'est vérifié par une assertion de
 * scripts/tests/training-movement-patterns.mts qui relit le CHECK réel.
 * Le pattern est FACULTATIF (colonne nullable) : la banque existante n'en
 * a aucun, et un exercice sans pattern n'offre simplement aucun remplaçant.
 *
 * POURQUOI DES CLÉS ASCII. `MuscleGroup` utilise des clés françaises
 * accentuées (« épaules »), héritage assumé. Pour ce nouveau vocabulaire,
 * qui voyage dans un CHECK SQL, dans des filtres et potentiellement dans
 * des URL, les clés sont en snake_case sans accent ; seuls les LIBELLÉS
 * portent l'orthographe française.
 *
 * MODULE PUR : aucune dépendance React ni Supabase, importable côté
 * serveur, côté client et par les tests.
 */

/** Régions articulaires — sert uniquement à regrouper visuellement le sélecteur. */
export type MovementPatternRegion =
  | "haut_du_corps"
  | "epaule"
  | "coude_poignet"
  | "hanche_genou"
  | "cheville"
  | "tronc"
  | "global";

export const movementPatternRegionLabels: Record<MovementPatternRegion, string> = {
  haut_du_corps: "Haut du corps",
  epaule: "Épaule",
  coude_poignet: "Coude / poignet",
  hanche_genou: "Hanche / genou",
  cheville: "Cheville",
  tronc: "Tronc",
  global: "Global",
};

/**
 * ORDRE CANONIQUE — de la poussée/tirage global vers l'isolation, région par
 * région. C'est cet ordre qui pilote le sélecteur admin : jamais un tri
 * alphabétique, qui séparerait « flexion_coude » de « extension_coude ».
 */
export const movementPatternOrder: readonly MovementPattern[] = [
  // Haut du corps — poussée / tirage
  "poussee_horizontale",
  "poussee_verticale",
  "tirage_horizontal",
  "tirage_vertical",
  // Épaule — isolation
  "elevation_laterale",
  "elevation_frontale",
  "elevation_posterieure",
  "rotation_externe_epaule",
  "rotation_interne_epaule",
  // Coude / poignet
  "flexion_coude",
  "extension_coude",
  "flexion_poignet",
  "extension_poignet",
  "pronosupination",
  // Hanche / genou
  "squat",
  "fente",
  "charniere_de_hanche",
  "extension_de_hanche",
  "extension_genou",
  "flexion_genou",
  "abduction_hanche",
  "adduction_hanche",
  "rotation_hanche",
  // Cheville
  "flexion_plantaire",
  "flexion_dorsale",
  // Tronc
  "flexion_tronc",
  "extension_tronc",
  "rotation_tronc",
  "anti_extension",
  "anti_rotation",
  "anti_flexion_laterale",
  // Global
  "port_de_charge",
  "haltero",
  "pliometrie",
  "locomotion",
  "mobilite",
] as const;

export const movementPatternRegions: Record<MovementPattern, MovementPatternRegion> = {
  poussee_horizontale: "haut_du_corps",
  poussee_verticale: "haut_du_corps",
  tirage_horizontal: "haut_du_corps",
  tirage_vertical: "haut_du_corps",
  elevation_laterale: "epaule",
  elevation_frontale: "epaule",
  elevation_posterieure: "epaule",
  rotation_externe_epaule: "epaule",
  rotation_interne_epaule: "epaule",
  flexion_coude: "coude_poignet",
  extension_coude: "coude_poignet",
  flexion_poignet: "coude_poignet",
  extension_poignet: "coude_poignet",
  pronosupination: "coude_poignet",
  squat: "hanche_genou",
  fente: "hanche_genou",
  charniere_de_hanche: "hanche_genou",
  extension_de_hanche: "hanche_genou",
  extension_genou: "hanche_genou",
  flexion_genou: "hanche_genou",
  abduction_hanche: "hanche_genou",
  adduction_hanche: "hanche_genou",
  rotation_hanche: "hanche_genou",
  flexion_plantaire: "cheville",
  flexion_dorsale: "cheville",
  flexion_tronc: "tronc",
  extension_tronc: "tronc",
  rotation_tronc: "tronc",
  anti_extension: "tronc",
  anti_rotation: "tronc",
  anti_flexion_laterale: "tronc",
  port_de_charge: "global",
  haltero: "global",
  pliometrie: "global",
  locomotion: "global",
  mobilite: "global",
};

/** Libellé court, tel qu'il s'affiche sur une fiche d'exercice. */
export const movementPatternLabels: Record<MovementPattern, string> = {
  poussee_horizontale: "Poussée horizontale",
  poussee_verticale: "Poussée verticale",
  tirage_horizontal: "Tirage horizontal",
  tirage_vertical: "Tirage vertical",
  elevation_laterale: "Élévation latérale",
  elevation_frontale: "Élévation frontale",
  elevation_posterieure: "Élévation postérieure",
  rotation_externe_epaule: "Rotation externe d'épaule",
  rotation_interne_epaule: "Rotation interne d'épaule",
  flexion_coude: "Flexion de coude",
  extension_coude: "Extension de coude",
  flexion_poignet: "Flexion de poignet",
  extension_poignet: "Extension de poignet",
  pronosupination: "Pronosupination",
  squat: "Squat",
  fente: "Fente",
  charniere_de_hanche: "Charnière de hanche",
  extension_de_hanche: "Extension de hanche",
  extension_genou: "Extension de genou",
  flexion_genou: "Flexion de genou",
  abduction_hanche: "Abduction de hanche",
  adduction_hanche: "Adduction de hanche",
  rotation_hanche: "Rotation de hanche",
  flexion_plantaire: "Flexion plantaire",
  flexion_dorsale: "Flexion dorsale",
  flexion_tronc: "Flexion du tronc",
  extension_tronc: "Extension du tronc",
  rotation_tronc: "Rotation du tronc",
  anti_extension: "Anti-extension",
  anti_rotation: "Anti-rotation",
  anti_flexion_laterale: "Anti-flexion latérale",
  port_de_charge: "Port de charge",
  haltero: "Haltérophilie",
  pliometrie: "Pliométrie",
  locomotion: "Locomotion",
  mobilite: "Mobilité / étirement",
};

/**
 * Exemples d'exercices — affichés en aide de saisie sous le sélecteur, pour
 * que le coach n'ait jamais à deviner ce que recouvre un pattern. Jamais
 * enregistrés, jamais montrés à l'élève.
 */
export const movementPatternExamples: Record<MovementPattern, string> = {
  poussee_horizontale: "développé couché, pompes, dips",
  poussee_verticale: "développé militaire, développé haltères assis",
  tirage_horizontal: "rowing barre, tirage horizontal poulie",
  tirage_vertical: "tractions, tirage vertical poulie",
  elevation_laterale: "élévations latérales, latéral machine",
  elevation_frontale: "élévations frontales",
  elevation_posterieure: "oiseau, reverse pec-deck, face pull",
  rotation_externe_epaule: "rotations externes poulie ou élastique",
  rotation_interne_epaule: "rotations internes poulie ou élastique",
  flexion_coude: "curl barre, curl incliné, curl marteau",
  extension_coude: "extension poulie, barre au front, kick-back",
  flexion_poignet: "curl poignets",
  extension_poignet: "extension poignets, reverse curl",
  pronosupination: "rotations avant-bras haltère",
  squat: "squat barre, presse, hack squat, gobelet",
  fente: "fentes, split squat bulgare, montées de banc",
  charniere_de_hanche: "soulevé de terre, roumain, good morning",
  extension_de_hanche: "hip thrust, pont fessier, kick-back fessier",
  extension_genou: "leg extension",
  flexion_genou: "leg curl allongé ou assis, nordic",
  abduction_hanche: "abducteurs machine, élastique latéral",
  adduction_hanche: "adducteurs machine, copenhagen",
  rotation_hanche: "rotations de hanche, clamshell",
  flexion_plantaire: "mollets debout, mollets assis, presse",
  flexion_dorsale: "tibialis raise",
  flexion_tronc: "crunch, relevés de jambes, câble crunch",
  extension_tronc: "extension lombaire, hyperextension",
  rotation_tronc: "russian twist, wood chop, rotations poulie",
  anti_extension: "planche, roue abdominale, dead bug",
  anti_rotation: "pallof press, planche à bras tendus décalée",
  anti_flexion_laterale: "gainage latéral, suitcase carry",
  port_de_charge: "farmer walk, marche lestée",
  haltero: "arraché, épaulé-jeté, power clean",
  pliometrie: "sauts, box jump, bondissements",
  locomotion: "course, rameur, vélo, elliptique, ski erg",
  mobilite: "étirements, mobilité articulaire, drills",
};

/** Libellé du sélecteur : « Hanche / genou · Charnière de hanche ». */
export function movementPatternSelectLabel(pattern: MovementPattern): string {
  return `${movementPatternRegionLabels[movementPatternRegions[pattern]]} · ${movementPatternLabels[pattern]}`;
}

/**
 * Normalisation d'une valeur venue de la base (texte libre historique, ou
 * NULL). Renvoie `null` dès que la valeur ne fait pas partie du vocabulaire
 * — jamais une chaîne inconnue déguisée en `MovementPattern`, contrairement
 * à `asMuscleGroup` qui caste sans vérifier.
 */
export function normalizeMovementPattern(value: string | null | undefined): MovementPattern | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return (movementPatternOrder as readonly string[]).includes(trimmed)
    ? (trimmed as MovementPattern)
    : null;
}

/** Libellé affichable, `null` compris (« Non renseigné »). */
export function movementPatternDisplayLabel(pattern: MovementPattern | null): string {
  return pattern ? movementPatternLabels[pattern] : "Pattern non renseigné";
}
