/**
 * PRÉSETS DE RÉPARTITION SELON L'HORAIRE D'ENTRAÎNEMENT — SOURCE UNIQUE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE FAIT CE MODULE, ET CE QU'IL NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il ne contient QUE des tables et une fonction de sélection. Aucune
 * dépendance à React, à Supabase ou à l'état du formulaire : il transforme
 * « horaire d'entraînement + créneaux cochés » en « pourcentages par
 * créneau », ou refuse en disant pourquoi.
 *
 * Ce sont des PRÉSETS D'AIDE AU RÉGLAGE. Appliquer un préset ne déclenche
 * aucune écriture : il déplace les curseurs, rien de plus. La persistance
 * reste le seul fait du bouton « Enregistrer ».
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE PROBLÈME DES RÔLES, ET POURQUOI ON NE MAPPE PAS PAR POSITION
 * ════════════════════════════════════════════════════════════════════════
 * Les tables de référence parlent de rôles nutritionnels — « collation
 * pré-training », « collation du soir » — qui ne sont PAS des créneaux du
 * builder. Le builder en a six, fixes, et leurs clés techniques sont
 * écrites en base (`nutrition_day_slots.slot`, enum PostgreSQL) : elles ne
 * peuvent pas changer.
 *
 * Une collation pré-training ne tombe donc pas toujours sur le même
 * créneau : avant une séance de MIDI elle se place le matin
 * (`morning_snack`), avant une séance de l'APRÈS-MIDI ou du SOIR elle se
 * place après le déjeuner (`afternoon_snack`), et lorsque ce créneau est
 * déjà pris — SOIR × 5 repas, qui prescrit une collation d'après-midi ET
 * une collation pré-training — elle occupe `dessert`, affiché « Collation
 * du soir ».
 *
 * Chaque ligne porte donc DEUX informations : le créneau réel (`slot`) et
 * le rôle qu'il joue dans cette table (`role`). Le rôle n'est jamais
 * déduit d'une position dans une liste — il est écrit, donc relisible et
 * discutable.
 *
 * ⚠️ `dessert` : SEULE l'étiquette affichée devient « Collation du soir »
 * (voir `MEAL_SLOT_LABELS_FR`). La clé technique reste `dessert` parce
 * qu'elle est une valeur d'enum en base et qu'elle sert aussi aux recettes
 * (`recipe_meal_slots`). Renommer la clé demanderait une migration ; ce
 * n'est pas l'objet de ce chantier.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ORDRE DES TRIPLETS
 * ════════════════════════════════════════════════════════════════════════
 * Les tables de référence sont écrites GLUCIDES / PROTÉINES / LIPIDES.
 * Les champs ci-dessous sont nommés, jamais positionnels : aucune
 * inversion silencieuse n'est possible entre la table et le code.
 *
 * Les valeurs sont des POINTS DE BASE (10 000 = 100 %), l'unité déjà
 * utilisée par tout le module de répartition. 30 % s'écrit 3 000.
 */

import { MEAL_SLOT_LABELS_FR, type MealSlotKey } from "./meal-distribution";

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
 * Le rôle nutritionnel que joue un créneau dans une table donnée. Sert à
 * expliquer un mapping non évident (pré-training, collation du soir) et à
 * le rendre testable.
 */
export type RoleCreneau =
  | "petit_dejeuner"
  | "collation_matin"
  | "dejeuner"
  | "collation_apres_midi"
  | "collation_pre_training"
  | "collation_soir"
  | "diner";

export interface LignePreset {
  /** Créneau RÉEL du builder — c'est lui qui reçoit les pourcentages. */
  readonly slot: MealSlotKey;
  /** Rôle dans la table de référence. Explicite, jamais déduit. */
  readonly role: RoleCreneau;
  readonly carbBp: number;
  readonly proteinBp: number;
  readonly fatBp: number;
}

/** Nombres de repas couverts par les tables. Rien d'autre n'est inventé. */
export const NOMBRES_DE_REPAS_COUVERTS = [3, 4, 5] as const;
export type NombreDeRepasCouvert = (typeof NOMBRES_DE_REPAS_COUVERTS)[number];

/** Raccourci de lecture : pourcentages entiers → points de base. */
function ligne(
  slot: MealSlotKey,
  role: RoleCreneau,
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
 * LES TABLES
 * ════════════════════════════════════════════════════════════════════════
 * Reprises telles quelles de la référence. Chaque colonne somme à 100 % —
 * une garde le vérifie au chargement du module (voir plus bas), donc une
 * faute de frappe ne peut pas atteindre l'interface.
 */
export const PRESETS_MACROS: Readonly<
  Record<HoraireEntrainement, Readonly<Record<NombreDeRepasCouvert, readonly LignePreset[]>>>
> = {
  matin: {
    3: [
      ligne("breakfast", "petit_dejeuner", 30, 30, 15),
      ligne("lunch", "dejeuner", 45, 35, 25),
      ligne("dinner", "diner", 25, 35, 60),
    ],
    4: [
      ligne("breakfast", "petit_dejeuner", 30, 25, 10),
      ligne("lunch", "dejeuner", 40, 30, 20),
      ligne("afternoon_snack", "collation_apres_midi", 15, 20, 30),
      ligne("dinner", "diner", 15, 25, 40),
    ],
    5: [
      ligne("breakfast", "petit_dejeuner", 25, 20, 10),
      ligne("morning_snack", "collation_matin", 30, 20, 10),
      ligne("lunch", "dejeuner", 20, 25, 30),
      ligne("afternoon_snack", "collation_apres_midi", 10, 15, 20),
      ligne("dinner", "diner", 15, 20, 30),
    ],
  },
  midi: {
    3: [
      ligne("breakfast", "petit_dejeuner", 25, 30, 35),
      ligne("lunch", "dejeuner", 45, 35, 15),
      ligne("dinner", "diner", 30, 35, 50),
    ],
    4: [
      ligne("breakfast", "petit_dejeuner", 20, 25, 40),
      // Avant une séance de MIDI, la collation pré-training se place le
      // MATIN : c'est le seul créneau qui la précède.
      ligne("morning_snack", "collation_pre_training", 20, 15, 5),
      ligne("lunch", "dejeuner", 35, 35, 15),
      ligne("dinner", "diner", 25, 25, 40),
    ],
    5: [
      ligne("breakfast", "petit_dejeuner", 20, 20, 30),
      ligne("morning_snack", "collation_pre_training", 20, 15, 5),
      ligne("lunch", "dejeuner", 30, 30, 15),
      ligne("afternoon_snack", "collation_apres_midi", 10, 15, 20),
      ligne("dinner", "diner", 20, 20, 30),
    ],
  },
  apres_midi: {
    3: [
      ligne("breakfast", "petit_dejeuner", 25, 30, 40),
      ligne("lunch", "dejeuner", 35, 35, 35),
      ligne("dinner", "diner", 40, 35, 25),
    ],
    4: [
      ligne("breakfast", "petit_dejeuner", 20, 25, 40),
      ligne("lunch", "dejeuner", 25, 30, 40),
      // Séance de l'APRÈS-MIDI : le pré-training tombe entre le déjeuner et
      // le dîner, donc sur `afternoon_snack`.
      ligne("afternoon_snack", "collation_pre_training", 20, 15, 5),
      ligne("dinner", "diner", 35, 30, 15),
    ],
    5: [
      ligne("breakfast", "petit_dejeuner", 20, 20, 30),
      ligne("lunch", "dejeuner", 25, 25, 30),
      ligne("afternoon_snack", "collation_pre_training", 20, 15, 5),
      ligne("dinner", "diner", 30, 25, 15),
      // La collation du soir vient APRÈS le dîner : `dessert`, affiché
      // « Collation du soir ».
      ligne("dessert", "collation_soir", 5, 15, 20),
    ],
  },
  soir: {
    3: [
      ligne("breakfast", "petit_dejeuner", 25, 30, 40),
      ligne("lunch", "dejeuner", 35, 35, 40),
      ligne("dinner", "diner", 40, 35, 20),
    ],
    4: [
      ligne("breakfast", "petit_dejeuner", 20, 25, 40),
      ligne("lunch", "dejeuner", 25, 30, 40),
      ligne("afternoon_snack", "collation_pre_training", 20, 15, 5),
      ligne("dinner", "diner", 35, 30, 15),
    ],
    5: [
      ligne("breakfast", "petit_dejeuner", 15, 20, 30),
      ligne("lunch", "dejeuner", 25, 25, 30),
      ligne("afternoon_snack", "collation_apres_midi", 10, 15, 20),
      // LE CAS QUI OBLIGE À RAISONNER PAR RÔLE. La table prescrit DEUX
      // collations entre le déjeuner et le dîner ; `afternoon_snack` est
      // déjà pris par la première. Le pré-training occupe donc `dessert`,
      // le seul créneau libre, affiché « Collation du soir » — cohérent
      // pour une séance du soir.
      ligne("dessert", "collation_pre_training", 20, 15, 5),
      ligne("dinner", "diner", 30, 25, 15),
    ],
  },
};

/* ════════════════════════════════════════════════════════════════════════
 * GARDE DE CHARGEMENT
 * ════════════════════════════════════════════════════════════════════════
 * Une colonne qui ne somme pas à 100 %, ou un créneau répété dans une même
 * table, produirait une répartition invalide — et le formulaire l'aurait
 * acceptée sans broncher, puisque le préset écrit directement. On refuse
 * donc au chargement du module : la faute de frappe ne franchit jamais la
 * frontière.
 */
function verifierTables(): void {
  for (const horaire of HORAIRES_ENTRAINEMENT) {
    for (const nombre of NOMBRES_DE_REPAS_COUVERTS) {
      const lignes = PRESETS_MACROS[horaire][nombre];
      if (lignes.length !== nombre) {
        throw new Error(`Préset ${horaire}/${nombre} : ${lignes.length} lignes au lieu de ${nombre}.`);
      }
      const creneaux = new Set(lignes.map((l) => l.slot));
      if (creneaux.size !== lignes.length) {
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
 * SÉLECTION
 * ════════════════════════════════════════════════════════════════════════ */

export type ResultatPreset =
  | { readonly ok: true; readonly lignes: readonly LignePreset[] }
  /** Le nombre de repas cochés n'est pas couvert par les tables. */
  | { readonly ok: false; readonly raison: "nombre"; readonly message: string }
  /** Le bon nombre de repas, mais pas les bons — on n'invente rien. */
  | {
      readonly ok: false;
      readonly raison: "creneaux";
      readonly message: string;
      readonly attendus: readonly MealSlotKey[];
    };

function estCouvert(nombre: number): nombre is NombreDeRepasCouvert {
  return (NOMBRES_DE_REPAS_COUVERTS as readonly number[]).includes(nombre);
}

function enumererFr(slots: readonly MealSlotKey[]): string {
  return slots.map((slot) => MEAL_SLOT_LABELS_FR[slot]).join(", ");
}

/**
 * La table qui correspond à cet horaire ET à ces créneaux cochés.
 *
 * DEUX REFUS POSSIBLES, ET AUCUNE INVENTION.
 *   • le nombre de repas n'est pas 3, 4 ou 5 : les tables ne le couvrent
 *     pas, et extrapoler produirait des pourcentages qui n'ont été validés
 *     par personne ;
 *   • le nombre est bon mais le JEU diffère — quatre repas dont la
 *     collation du matin là où la table attend celle de l'après-midi. Poser
 *     les valeurs « dans l'ordre » donnerait à une collation du matin les
 *     parts prévues pour une collation d'après-midi, ce qui est une autre
 *     prescription. On refuse en nommant les créneaux attendus.
 */
export function presetPour(
  horaire: HoraireEntrainement,
  creneauxActifs: readonly MealSlotKey[],
): ResultatPreset {
  const nombre = creneauxActifs.length;
  if (!estCouvert(nombre)) {
    return {
      ok: false,
      raison: "nombre",
      message: `Les répartitions de référence couvrent 3 à 5 repas. Ce jour en compte ${nombre}.`,
    };
  }

  const lignes = PRESETS_MACROS[horaire][nombre];
  const attendus = lignes.map((l) => l.slot);
  const actifs = new Set(creneauxActifs);
  const manquants = attendus.filter((slot) => !actifs.has(slot));

  if (manquants.length > 0) {
    return {
      ok: false,
      raison: "creneaux",
      message: `${HORAIRE_LABELS_FR[horaire]} à ${nombre} repas attend : ${enumererFr(attendus)}.`,
      attendus,
    };
  }

  return { ok: true, lignes };
}
