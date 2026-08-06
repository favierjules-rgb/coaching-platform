/**
 * Les sept jours de la semaine — VOCABULAIRE UNIQUE.
 *
 * `nutrition_days.day` stocke une CLÉ technique (`monday` … `sunday`), pas un
 * libellé. La contrainte CHECK posée par la migration 20260811090000 est le
 * miroir exact de `WEEKDAY_KEYS` : ajouter un jour ici sans toucher à la base
 * ferait échouer l'écriture, ce qui est le comportement voulu.
 *
 * Aucune autre liste de jours ne doit exister. `lib/admin.ts` exporte encore
 * `weekDays` en français : c'est un ALIAS d'affichage construit depuis
 * `WEEKDAY_LABELS_FR`, jamais une seconde source de vérité.
 */
export const WEEKDAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** Libellés français complets — affichage uniquement. */
export const WEEKDAY_LABELS_FR: Readonly<Record<WeekdayKey, string>> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
};

/** Libellés courts, pour les sélecteurs compacts sur téléphone. */
export const WEEKDAY_SHORT_LABELS_FR: Readonly<Record<WeekdayKey, string>> = {
  monday: "LUN",
  tuesday: "MAR",
  wednesday: "MER",
  thursday: "JEU",
  friday: "VEN",
  saturday: "SAM",
  sunday: "DIM",
};

/**
 * Ancien libellé français → clé. Utilisé UNIQUEMENT pour lire des données
 * qui n'auraient pas été normalisées par la migration — un import externe,
 * une base restaurée d'avant la PR C. Le chemin normal ne passe jamais ici.
 */
const LIBELLÉ_VERS_CLÉ: Readonly<Record<string, WeekdayKey>> = {
  Lundi: "monday",
  Mardi: "tuesday",
  Mercredi: "wednesday",
  Jeudi: "thursday",
  Vendredi: "friday",
  Samedi: "saturday",
  Dimanche: "sunday",
};

export function isWeekdayKey(valeur: unknown): valeur is WeekdayKey {
  return typeof valeur === "string" && (WEEKDAY_KEYS as readonly string[]).includes(valeur);
}

/**
 * Rend la clé d'un jour, quelle que soit la forme reçue. `null` si la valeur
 * n'est ni une clé ni un libellé connu — on ne devine pas.
 */
export function toWeekdayKey(valeur: string | null | undefined): WeekdayKey | null {
  if (!valeur) return null;
  if (isWeekdayKey(valeur)) return valeur;
  return LIBELLÉ_VERS_CLÉ[valeur] ?? null;
}

/** Position dans la semaine, lundi = 0. `-1` pour une valeur inconnue. */
export function weekdayIndex(cle: string): number {
  return (WEEKDAY_KEYS as readonly string[]).indexOf(cle);
}

/**
 * Comparateur d'ORDRE CANONIQUE : lundi → dimanche, jamais l'ordre
 * alphabétique ni l'ordre d'insertion. Les valeurs inconnues sont rejetées en
 * fin de liste plutôt que masquées.
 */
export function compareWeekdays(a: string, b: string): number {
  const ia = weekdayIndex(a);
  const ib = weekdayIndex(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b, "fr");
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

/** Libellé français d'un jour, ou la valeur brute si elle est inconnue. */
export function describeWeekday(cle: string): string {
  return isWeekdayKey(cle) ? WEEKDAY_LABELS_FR[cle] : cle;
}
