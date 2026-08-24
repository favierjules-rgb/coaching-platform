/**
 * RÉPARTITIONS PAR HORAIRE D'ENTRAÎNEMENT — SOURCE UNIQUE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA RÈGLE FONDAMENTALE
 * ════════════════════════════════════════════════════════════════════════
 * DEUX PARAMÈTRES INDÉPENDANTS choisissent une table, et rien d'autre :
 *
 *     horaire d'entraînement  ×  NOMBRE de repas  →  une table
 *
 * La COMBINAISON des repas cochés n'intervient jamais dans ce choix. Aucun
 * horaire n'est donc jamais indisponible : les quatre raccourcis restent
 * cliquables à 3, 4, 5 et 6 repas, quels que soient les créneaux cochés.
 *
 * ⚠️ C'EST UNE CORRECTION DE BUG, PAS UNE PRÉFÉRENCE. La version précédente
 * exigeait que le jeu de créneaux cochés corresponde exactement à celui de
 * la table, et grisait le bouton sinon — ce qui rendait les quatre horaires
 * inaccessibles à 6 repas et n'en laissait passer que certains à 4 ou 5.
 * Toute réintroduction d'une comparaison « créneaux cochés vs créneaux de
 * la table » pour décider de la DISPONIBILITÉ ramènerait ce bug.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE FAIT CE MODULE, ET CE QU'IL NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il ne contient QUE des tables et une fonction de sélection totale — elle
 * rend toujours une table, jamais un refus. Aucune dépendance à React, à
 * Supabase ou à l'état du formulaire.
 *
 * Ce sont des PRÉSETS D'AIDE AU RÉGLAGE. Appliquer un préset ne déclenche
 * aucune écriture : il déplace les curseurs, rien de plus. La persistance
 * reste le seul fait du bouton « Enregistrer ».
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE JEU DE CRÉNEAUX FAIT PARTIE DE LA PRESCRIPTION
 * ════════════════════════════════════════════════════════════════════════
 * Le document de référence est explicite :
 *
 *   « Les repas sont toujours puisés dans cette trame, dans l'ordre :
 *     petit-déjeuner, collation du matin, déjeuner, collation de
 *     l'après-midi, dîner, collation du soir. Le nombre de repas retenu
 *     détermine lesquels sont conservés, EN PRIORISANT CEUX QUI ENCADRENT
 *     LA SÉANCE. »
 *
 * À nombre de repas égal, deux horaires ne retiennent donc pas forcément
 * les mêmes créneaux :
 *
 *   • 4 repas — MATIN garde la collation du MATIN (elle est le repas post
 *     immédiat) ; MIDI, APRÈS-MIDI et SOIR gardent celle de l'APRÈS-MIDI ;
 *   • 5 repas — MATIN, MIDI et APRÈS-MIDI gardent la collation du matin ;
 *     SOIR garde la collation du SOIR à la place (elle prolonge la recharge
 *     glucidique post-séance) ;
 *   • 3 et 6 repas — les quatre horaires retiennent le même jeu.
 *
 * `slotsPour()` expose ce jeu. C'est le formulaire qui aligne les cases sur
 * lui au moment d'appliquer — à NOMBRE DE REPAS CONSTANT, puisque la table
 * a exactement autant de lignes que de repas demandés.
 *
 * ⚠️ `dessert` : SEULE l'étiquette affichée est « Collation du soir » (voir
 * `MEAL_SLOT_LABELS_FR`). La clé technique reste `dessert` : c'est une
 * valeur d'enum PostgreSQL, et elle sert aussi aux recettes
 * (`recipe_meal_slots`). La renommer demanderait une migration.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ORDRE DES TRIPLETS
 * ════════════════════════════════════════════════════════════════════════
 * Le document écrit GLUCIDES / PROTÉINES / LIPIDES. Les champs ci-dessous
 * sont nommés, jamais positionnels : aucune inversion silencieuse n'est
 * possible entre la table et le code.
 *
 * Les valeurs sont des POINTS DE BASE (10 000 = 100 %), l'unité déjà
 * utilisée par tout le module de répartition. 30 % s'écrit 3 000.
 */

import type { MealSlotKey } from "./meal-distribution";

/** Les quatre moments d'entraînement proposés. */
export const HORAIRES_ENTRAINEMENT = ["matin", "midi", "apres_midi", "soir"] as const;
export type HoraireEntrainement = (typeof HORAIRES_ENTRAINEMENT)[number];

/** Libellés des boutons — affichage uniquement. */
export const HORAIRE_LABELS_FR: Readonly<Record<HoraireEntrainement, string>> = {
  matin: "Matin",
  midi: "Midi",
  apres_midi: "Après-midi",
  soir: "Soir",
};

/**
 * Position du repas dans la fenêtre péri-entraînement, telle qu'écrite dans
 * le document (les lignes y sont surlignées).
 *
 * ⚠️ CE RÔLE EST UNE DONNÉE, PAS UNE DÉDUCTION. Il n'est jamais calculé à
 * partir de la position de la ligne : APRÈS-MIDI × 4 a son repas PRÉ/POST
 * en troisième position et son POST en quatrième, MATIN × 4 a son PRÉ en
 * première et son POST en deuxième. Aucune règle de position ne rend ces
 * deux cas à la fois.
 *
 * Il sert à expliquer et à vérifier la prescription. Il ne sert JAMAIS à
 * autoriser ou interdire un horaire.
 */
export type RolePeriTraining = "pre" | "post" | "pre_post" | null;

export interface LignePreset {
  /** Créneau du builder qui reçoit ces parts. */
  readonly slot: MealSlotKey;
  /** Position dans la fenêtre péri-entraînement, ou `null` hors fenêtre. */
  readonly role: RolePeriTraining;
  readonly carbBp: number;
  readonly proteinBp: number;
  readonly fatBp: number;
}

/** Nombres de repas couverts — les quatre, sans exception. */
export const NOMBRES_DE_REPAS = [3, 4, 5, 6] as const;
export type NombreDeRepas = (typeof NOMBRES_DE_REPAS)[number];

/** Un nombre de repas est-il dans la trame couverte par les tables ? */
export function estNombreDeRepasCouvert(nombre: number): nombre is NombreDeRepas {
  return (NOMBRES_DE_REPAS as readonly number[]).includes(nombre);
}

/** Raccourci de lecture : pourcentages entiers → points de base. */
function ligne(
  slot: MealSlotKey,
  role: RolePeriTraining,
  glucides: number,
  proteines: number,
  lipides: number,
): LignePreset {
  return {
    slot,
    role,
    carbBp: glucides * 100,
    proteinBp: proteines * 100,
    fatBp: lipides * 100,
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * LES SEIZE TABLES
 * ════════════════════════════════════════════════════════════════════════
 * Reprises telles quelles du document de référence : 4 horaires × 4 nombres
 * de repas = 16 tables, 3 + 4 + 5 + 6 = 18 lignes par horaire, 72 lignes au
 * total. Les lignes « Total » du document ne sont évidemment pas stockées :
 * elles sont recalculées et vérifiées au chargement.
 */
export const PRESETS_MACROS: Readonly<
  Record<HoraireEntrainement, Readonly<Record<NombreDeRepas, readonly LignePreset[]>>>
> = {
  /* ── MATIN — après le petit-déjeuner, avant la collation du matin ──
     Le petit-déjeuner est le repas PRÉ, la collation du matin le POST. */
  matin: {
    3: [
      ligne("breakfast", "pre", 35, 30, 15),
      ligne("lunch", null, 40, 35, 30),
      ligne("dinner", null, 25, 35, 55),
    ],
    4: [
      ligne("breakfast", "pre", 25, 22, 10),
      // À 4 repas, MATIN est le seul horaire à retenir la collation du
      // MATIN : c'est elle qui tombe dans la fenêtre post-séance.
      ligne("morning_snack", "post", 30, 23, 5),
      ligne("lunch", null, 25, 28, 40),
      ligne("dinner", null, 20, 27, 45),
    ],
    5: [
      ligne("breakfast", "pre", 25, 18, 8),
      ligne("morning_snack", "post", 28, 20, 5),
      ligne("lunch", null, 22, 24, 35),
      ligne("afternoon_snack", null, 10, 14, 22),
      ligne("dinner", null, 15, 24, 30),
    ],
    6: [
      ligne("breakfast", "pre", 22, 15, 8),
      ligne("morning_snack", "post", 28, 20, 5),
      ligne("lunch", null, 20, 20, 30),
      ligne("afternoon_snack", null, 10, 12, 20),
      ligne("dinner", null, 15, 20, 27),
      ligne("dessert", null, 5, 13, 10),
    ],
  },

  /* ── MIDI — 1 h 30 après le déjeuner ──
     Le déjeuner est le repas PRÉ, la collation de l'après-midi le POST. */
  midi: {
    3: [
      ligne("breakfast", null, 25, 30, 40),
      ligne("lunch", "pre", 45, 35, 10),
      ligne("dinner", null, 30, 35, 50),
    ],
    4: [
      ligne("breakfast", null, 18, 25, 40),
      ligne("lunch", "pre", 32, 28, 10),
      ligne("afternoon_snack", "post", 27, 20, 5),
      ligne("dinner", null, 23, 27, 45),
    ],
    5: [
      ligne("breakfast", null, 15, 20, 32),
      ligne("morning_snack", null, 12, 15, 22),
      ligne("lunch", "pre", 30, 25, 8),
      ligne("afternoon_snack", "post", 25, 17, 5),
      ligne("dinner", null, 18, 23, 33),
    ],
    6: [
      ligne("breakfast", null, 15, 16, 30),
      ligne("morning_snack", null, 10, 12, 20),
      ligne("lunch", "pre", 30, 25, 8),
      ligne("afternoon_snack", "post", 25, 15, 5),
      ligne("dinner", null, 15, 20, 27),
      ligne("dessert", null, 5, 12, 10),
    ],
  },

  /* ── APRÈS-MIDI — au niveau de la collation de l'après-midi ──
     Celle-ci est fractionnée avant/après la séance : elle est donc à la
     fois PRÉ et POST. Le dîner tombe dans la fenêtre des 2 h post. */
  apres_midi: {
    3: [
      ligne("breakfast", null, 25, 30, 40),
      ligne("lunch", null, 35, 35, 35),
      ligne("dinner", "post", 40, 35, 25),
    ],
    4: [
      ligne("breakfast", null, 18, 25, 42),
      ligne("lunch", null, 25, 30, 40),
      ligne("afternoon_snack", "pre_post", 27, 18, 5),
      ligne("dinner", "post", 30, 27, 13),
    ],
    5: [
      ligne("breakfast", null, 15, 20, 30),
      ligne("morning_snack", null, 12, 15, 20),
      ligne("lunch", null, 22, 25, 35),
      ligne("afternoon_snack", "pre_post", 26, 15, 5),
      ligne("dinner", "post", 25, 25, 10),
    ],
    6: [
      ligne("breakfast", null, 15, 18, 28),
      ligne("morning_snack", null, 10, 12, 20),
      ligne("lunch", null, 20, 22, 32),
      ligne("afternoon_snack", "pre_post", 25, 13, 5),
      ligne("dinner", "post", 25, 23, 10),
      ligne("dessert", null, 5, 12, 5),
    ],
  },

  /* ── SOIR — juste avant le repas du soir ──
     La collation de l'après-midi est le repas PRÉ, le dîner le POST
     immédiat. */
  soir: {
    3: [
      ligne("breakfast", null, 25, 30, 40),
      ligne("lunch", null, 35, 35, 42),
      ligne("dinner", "post", 40, 35, 18),
    ],
    4: [
      ligne("breakfast", null, 18, 25, 42),
      ligne("lunch", null, 25, 30, 43),
      ligne("afternoon_snack", "pre", 25, 17, 5),
      ligne("dinner", "post", 32, 28, 10),
    ],
    5: [
      ligne("breakfast", null, 15, 22, 35),
      ligne("lunch", null, 22, 25, 45),
      ligne("afternoon_snack", "pre", 23, 15, 5),
      ligne("dinner", "post", 30, 25, 10),
      // À 5 repas, SOIR est le seul horaire à retenir la collation du SOIR
      // plutôt que celle du matin : elle prolonge la recharge glucidique
      // post-séance sans surcharger le dîner.
      ligne("dessert", null, 10, 13, 5),
    ],
    6: [
      ligne("breakfast", null, 15, 18, 30),
      ligne("morning_snack", null, 10, 12, 22),
      ligne("lunch", null, 20, 22, 30),
      ligne("afternoon_snack", "pre", 20, 13, 5),
      ligne("dinner", "post", 25, 23, 8),
      ligne("dessert", null, 10, 12, 5),
    ],
  },
};

/* ════════════════════════════════════════════════════════════════════════
 * GARDE DE CHARGEMENT
 * ════════════════════════════════════════════════════════════════════════
 * Une colonne qui ne somme pas à 100 %, un créneau répété, ou une table qui
 * n'a pas autant de lignes que de repas, produirait une répartition
 * invalide — et le formulaire l'accepterait sans broncher, puisque le
 * préset écrit directement dans l'état. On refuse donc au chargement du
 * module : la faute de frappe ne franchit jamais la frontière.
 */
function verifierTables(): void {
  for (const horaire of HORAIRES_ENTRAINEMENT) {
    for (const nombre of NOMBRES_DE_REPAS) {
      const lignes = PRESETS_MACROS[horaire][nombre];
      if (lignes.length !== nombre) {
        throw new Error(`Préset ${horaire}/${nombre} : ${lignes.length} lignes au lieu de ${nombre}.`);
      }
      if (new Set(lignes.map((l) => l.slot)).size !== lignes.length) {
        throw new Error(`Préset ${horaire}/${nombre} : un créneau apparaît deux fois.`);
      }
      for (const macro of ["carbBp", "proteinBp", "fatBp"] as const) {
        const total = lignes.reduce((somme, l) => somme + l[macro], 0);
        if (total !== 10_000) {
          throw new Error(`Préset ${horaire}/${nombre} : ${macro} somme à ${total} au lieu de 10 000.`);
        }
      }
    }
  }
}
verifierTables();

/* ════════════════════════════════════════════════════════════════════════
 * SÉLECTION — TOTALE, SANS AUCUN REFUS
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * La table prescrite pour cet horaire et ce NOMBRE de repas.
 *
 * ⚠️ Cette fonction ne connaît PAS les créneaux cochés, et c'est
 * intentionnel : elle ne peut donc pas refuser un horaire à cause d'eux.
 * Elle ne rend `null` que si le nombre de repas sort de la trame 3-6, ce
 * que le builder n'autorise pas — un jour a toujours entre 3 et 6 repas
 * cochés. Le composant n'a aucune décision de disponibilité à prendre.
 */
export function presetPour(
  horaire: HoraireEntrainement,
  nombreDeRepas: number,
): readonly LignePreset[] | null {
  if (!estNombreDeRepasCouvert(nombreDeRepas)) return null;
  return PRESETS_MACROS[horaire][nombreDeRepas];
}

/**
 * Les créneaux que cette table prescrit, dans l'ordre chronologique.
 *
 * C'est le jeu sur lequel le formulaire aligne les cases au moment
 * d'appliquer. Il a toujours exactement `nombreDeRepas` éléments : appliquer
 * un préset ne change donc JAMAIS le nombre de repas du jour.
 */
export function slotsPour(
  horaire: HoraireEntrainement,
  nombreDeRepas: number,
): readonly MealSlotKey[] | null {
  return presetPour(horaire, nombreDeRepas)?.map((l) => l.slot) ?? null;
}
