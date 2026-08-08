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
 * GRANULARITÉ. La liste distingue ce qui change RÉELLEMENT le remplaçant :
 * l'inclinaison d'une poussée ou d'un écarté, l'ouverture des coudes sur un
 * tirage horizontal, la position du bras sur un mouvement de coude. Deux
 * exercices d'un même pattern doivent pouvoir se substituer sans que le
 * coach ait à intervenir — c'est le seul critère de découpage.
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
 * ORDRE CANONIQUE — région par région, du mouvement global vers l'isolation.
 * C'est cet ordre qui pilote le sélecteur admin : jamais un tri
 * alphabétique, qui séparerait « flexion_coude_anterieur » de
 * « extension_coude_anterieur ».
 */
export const movementPatternOrder: readonly MovementPattern[] = [
  // Haut du corps — poussée, tirage, écarté
  "poussee_horizontale",
  "poussee_verticale",
  "poussee_inclinee",
  "poussee_declinee",
  "tirage_vertical",
  "tirage_horizontal_coudes_ouverts",
  "tirage_horizontal_coudes_fermes",
  "tirage_diagonal",
  "ecarte_horizontal",
  "ecarte_incline",
  "ecarte_decline",
  // Épaule — isolation
  "elevation_laterale",
  "elevation_frontale",
  "elevation_posterieure",
  "rotation_externe_epaule",
  "rotation_interne_epaule",
  // Coude / poignet
  "flexion_coude_anterieur",
  "flexion_coude_posterieur",
  "extension_coude_anterieur",
  "extension_coude_posterieur",
  "flexion_poignet",
  "extension_poignet",
  "pronosupination",
  // Hanche / genou
  "squat",
  "fente",
  "hinge",
  "extension_de_hanche",
  "flexion_de_hanche",
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
  poussee_inclinee: "haut_du_corps",
  poussee_declinee: "haut_du_corps",
  tirage_vertical: "haut_du_corps",
  tirage_horizontal_coudes_ouverts: "haut_du_corps",
  tirage_horizontal_coudes_fermes: "haut_du_corps",
  tirage_diagonal: "haut_du_corps",
  ecarte_horizontal: "haut_du_corps",
  ecarte_incline: "haut_du_corps",
  ecarte_decline: "haut_du_corps",
  elevation_laterale: "epaule",
  elevation_frontale: "epaule",
  elevation_posterieure: "epaule",
  rotation_externe_epaule: "epaule",
  rotation_interne_epaule: "epaule",
  flexion_coude_anterieur: "coude_poignet",
  flexion_coude_posterieur: "coude_poignet",
  extension_coude_anterieur: "coude_poignet",
  extension_coude_posterieur: "coude_poignet",
  flexion_poignet: "coude_poignet",
  extension_poignet: "coude_poignet",
  pronosupination: "coude_poignet",
  squat: "hanche_genou",
  fente: "hanche_genou",
  hinge: "hanche_genou",
  extension_de_hanche: "hanche_genou",
  flexion_de_hanche: "hanche_genou",
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
  poussee_inclinee: "Poussée inclinée",
  poussee_declinee: "Poussée déclinée",
  tirage_vertical: "Tirage vertical",
  tirage_horizontal_coudes_ouverts: "Tirage horizontal coudes ouverts",
  tirage_horizontal_coudes_fermes: "Tirage horizontal coudes fermés",
  tirage_diagonal: "Tirage diagonal",
  ecarte_horizontal: "Écarté horizontal",
  ecarte_incline: "Écarté incliné",
  ecarte_decline: "Écarté décliné",
  elevation_laterale: "Élévation latérale",
  elevation_frontale: "Élévation frontale",
  elevation_posterieure: "Élévation postérieure",
  rotation_externe_epaule: "Rotation externe d'épaule",
  rotation_interne_epaule: "Rotation interne d'épaule",
  flexion_coude_anterieur: "Flexion de coude antérieur",
  flexion_coude_posterieur: "Flexion de coude postérieur",
  extension_coude_anterieur: "Extension de coude antérieur",
  extension_coude_posterieur: "Extension de coude postérieur",
  flexion_poignet: "Flexion de poignet",
  extension_poignet: "Extension de poignet",
  pronosupination: "Pronosupination",
  squat: "Squat",
  fente: "Fente",
  hinge: "Hinge",
  extension_de_hanche: "Extension de hanche",
  flexion_de_hanche: "Flexion de hanche",
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
  poussee_horizontale: "développé couché, pompes, dips buste droit",
  poussee_verticale: "développé militaire, développé haltères assis",
  poussee_inclinee: "développé incliné barre ou haltères, pompes pieds surélevés",
  poussee_declinee: "développé décliné, dips buste penché",
  tirage_vertical: "tractions, tirage vertical poulie",
  tirage_horizontal_coudes_ouverts: "rowing coudes écartés, T-bar prise large, rowing menton haut",
  tirage_horizontal_coudes_fermes: "rowing coudes serrés, tirage horizontal prise serrée, rowing supination",
  tirage_diagonal: "tirage un bras en diagonale, rowing unilatéral câble haut-bas",
  ecarte_horizontal: "écarté couché haltères, pec-deck, écarté poulie à hauteur d'épaules",
  ecarte_incline: "écarté incliné haltères, poulie basse vers le haut",
  ecarte_decline: "écarté décliné, crossover poulie haute vers le bas",
  elevation_laterale: "élévations latérales, latéral machine",
  elevation_frontale: "élévations frontales",
  elevation_posterieure: "oiseau, reverse pec-deck, face pull",
  rotation_externe_epaule: "rotations externes poulie ou élastique",
  rotation_interne_epaule: "rotations internes poulie ou élastique",
  flexion_coude_anterieur: "curl pupitre, curl prédicateur, curl concentré",
  flexion_coude_posterieur: "curl incliné, curl à la poulie derrière le corps, curl araignée inversé",
  extension_coude_anterieur: "extension nuque, barre au front, extension poulie au-dessus de la tête",
  extension_coude_posterieur: "pushdown poulie, kick-back, dips triceps",
  flexion_poignet: "curl poignets",
  extension_poignet: "extension poignets, reverse curl",
  pronosupination: "rotations avant-bras haltère",
  squat: "squat barre, presse, hack squat, gobelet",
  fente: "fentes, split squat bulgare, montées de banc",
  hinge: "soulevé de terre, roumain, good morning, swing kettlebell",
  extension_de_hanche: "hip thrust, pont fessier, kick-back fessier",
  flexion_de_hanche: "relevés de genoux suspendu, hip flexor poulie, montées de genoux",
  extension_genou: "leg extension",
  flexion_genou: "leg curl allongé ou assis, nordic",
  abduction_hanche: "abducteurs machine, élastique latéral",
  adduction_hanche: "adducteurs machine, copenhagen",
  rotation_hanche: "rotations de hanche, clamshell",
  flexion_plantaire: "mollets debout, mollets assis, presse",
  flexion_dorsale: "tibialis raise",
  flexion_tronc: "crunch, câble crunch, sit-up",
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

/** Libellé du sélecteur : « Hanche / genou · Hinge ». */
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
