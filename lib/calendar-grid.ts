/**
 * Logique pure du calendrier admin (chantier "admin-apple-calendar").
 *
 * Tout ce qui relève des dates, périodes et du placement des événements dans
 * la grille vit ici, sans React ni Supabase, pour être testé par harnais
 * (scripts/tests/calendar-grid.mts) — même approche que lib/booking.ts.
 *
 * Conventions :
 *  - semaine du lundi au dimanche (comme BookingSlotPicker) ;
 *  - toutes les bornes de période sont [start, end) — end exclusif ;
 *  - les calculs se font en heure LOCALE (même postulat que lib/booking.ts :
 *    navigateur en Europe/Paris, fuseau métier du projet — colonne
 *    appointments.timezone, défaut 'Europe/Paris') ;
 *  - le positionnement vertical utilise getHours()/getMinutes() locaux, ce qui
 *    reste correct les jours de changement d'heure (un événement à 15 h se
 *    dessine à 15 h, même si la journée fait 23 ou 25 heures réelles).
 */

export type CalendarView = "week" | "day" | "month";

/** Nombre de minutes affichées par jour dans les grilles Semaine/Jour. */
export const DAY_MINUTES = 24 * 60;

/** Événement minimal positionnable dans la grille. */
export interface CalendarEventInput {
  id: string;
  /** ISO 8601 (timestamptz Supabase). */
  startAt: string;
  endAt: string;
  /** Événement « toute la journée » — rendu en bandeau, jamais dans la grille horaire. */
  allDay?: boolean;
}

/** Placement d'un événement dans la colonne d'un jour (vue Semaine/Jour). */
export interface DayEventLayout<T extends CalendarEventInput> {
  event: T;
  /** Minutes depuis minuit local, bornées à [0, DAY_MINUTES]. */
  startMinutes: number;
  endMinutes: number;
  /** Colonne occupée dans son groupe de chevauchement (0-based). */
  column: number;
  /** Largeur du groupe : nombre total de colonnes à répartir. */
  columnCount: number;
  /** L'événement a commencé avant ce jour (continuité visuelle). */
  continuesBefore: boolean;
  /** L'événement se termine après ce jour. */
  continuesAfter: boolean;
}

/* ─── Dates de base ─── */

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Lundi 00:00 de la semaine contenant `date` (convention lun → dim du projet). */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const mondayIndex = (d.getDay() + 6) % 7; // 0 = lundi
  return addDays(d, -mondayIndex);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Clé "YYYY-MM-DD" en heure locale — même convention que lib/booking.ts. */
export function dayKeyLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/* ─── Périodes et navigation ─── */

/** Bornes [start, end) de la période *chargée* pour une vue et une date d'ancrage. */
export function viewPeriod(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === "day") {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1) };
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  // Mois : la grille affiche des semaines complètes — on charge du lundi
  // précédant le 1er au lundi suivant la fin du mois.
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const nextMonthStart = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  const lastDay = addDays(nextMonthStart, -1);
  const gridEnd = addDays(startOfWeek(lastDay), 7);
  return { start: gridStart, end: gridEnd };
}

/** Date d'ancrage après navigation précédent (-1) / suivant (+1). */
export function shiftAnchor(view: CalendarView, anchor: Date, delta: -1 | 1): Date {
  if (view === "day") return addDays(anchor, delta);
  if (view === "week") return addDays(anchor, delta * 7);
  // Mois : toujours le 1er du mois cible (évite les débordements type 31 → 3).
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
}

const MONTH_LABELS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const WEEKDAY_LABELS_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function weekdayShortLabel(dayIndexMonday0: number): string {
  return WEEKDAY_LABELS_SHORT[dayIndexMonday0] ?? "";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Titre de période affiché dans l'en-tête du calendrier. */
export function periodTitle(view: CalendarView, anchor: Date): string {
  if (view === "day") {
    return capitalize(
      anchor.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    );
  }
  if (view === "month") {
    return `${capitalize(MONTH_LABELS[anchor.getMonth()])} ${anchor.getFullYear()}`;
  }
  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} ${MONTH_LABELS[start.getMonth()]} ${start.getFullYear()}`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()} ${MONTH_LABELS[start.getMonth()]} – ${end.getDate()} ${MONTH_LABELS[end.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTH_LABELS[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()} ${MONTH_LABELS[end.getMonth()]} ${end.getFullYear()}`;
}

/** Les 7 jours (lun → dim) de la semaine contenant `anchor`. */
export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Jours de la grille mensuelle (semaines complètes lun → dim couvrant le mois). */
export function monthGridDays(anchor: Date): Date[] {
  const { start, end } = viewPeriod("month", anchor);
  const days: Date[] = [];
  for (let d = start; d.getTime() < end.getTime(); d = addDays(d, 1)) {
    days.push(d);
  }
  return days;
}

/* ─── Sélection et placement des événements ─── */

function eventOverlapsRange(event: CalendarEventInput, startMs: number, endMs: number): boolean {
  const s = new Date(event.startAt).getTime();
  const e = new Date(event.endAt).getTime();
  return s < endMs && e > startMs;
}

/** Événements (toute nature) qui intersectent [start, end). */
export function eventsInRange<T extends CalendarEventInput>(events: T[], start: Date, end: Date): T[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return events.filter((ev) => eventOverlapsRange(ev, startMs, endMs));
}

/** Événements « toute la journée » qui couvrent le jour donné (bandeau). */
export function allDayEventsForDay<T extends CalendarEventInput>(events: T[], day: Date): T[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return eventsInRange(
    events.filter((ev) => ev.allDay === true),
    dayStart,
    dayEnd,
  );
}

/** Minutes locales depuis minuit — correct aussi les jours de changement d'heure. */
function localMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Positionne les événements horodatés d'un jour : bornage à [0, 1440] pour
 * ceux qui débordent, puis répartition en colonnes par groupe de
 * chevauchement (algorithme classique : tri par début, attribution de la
 * première colonne libre, largeur commune au groupe — lisible même avec
 * plusieurs événements simultanés, comme Calendrier Apple).
 */
export function layoutDayEvents<T extends CalendarEventInput>(events: T[], day: Date): DayEventLayout<T>[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();

  const clamped = events
    .filter((ev) => ev.allDay !== true)
    .filter((ev) => eventOverlapsRange(ev, dayStartMs, dayEndMs))
    .map((ev) => {
      const start = new Date(ev.startAt);
      const end = new Date(ev.endAt);
      const continuesBefore = start.getTime() < dayStartMs;
      const continuesAfter = end.getTime() > dayEndMs;
      const startMinutes = continuesBefore ? 0 : localMinutes(start);
      const endMinutes = continuesAfter ? DAY_MINUTES : Math.max(localMinutes(end), startMinutes);
      return {
        event: ev,
        // Hauteur minimale de 15 min pour rester cliquable/lisible.
        startMinutes,
        endMinutes: Math.max(endMinutes, startMinutes + 15),
        column: 0,
        columnCount: 1,
        continuesBefore,
        continuesAfter,
      };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes || a.event.id.localeCompare(b.event.id));

  // Groupes de chevauchement transitifs + attribution de colonnes.
  let clusterStart = 0;
  let clusterMaxEnd = -1;
  const columnEnds: number[] = []; // fin (minutes) du dernier événement de chaque colonne du groupe courant

  const finalizeCluster = (from: number, to: number, columnCount: number) => {
    for (let i = from; i < to; i += 1) {
      clamped[i].columnCount = columnCount;
    }
  };

  for (let i = 0; i < clamped.length; i += 1) {
    const item = clamped[i];
    if (item.startMinutes >= clusterMaxEnd && i > clusterStart) {
      // Nouveau groupe : figer la largeur du précédent.
      finalizeCluster(clusterStart, i, columnEnds.length);
      clusterStart = i;
      columnEnds.length = 0;
    }
    let column = columnEnds.findIndex((end) => end <= item.startMinutes);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.endMinutes);
    } else {
      columnEnds[column] = item.endMinutes;
    }
    item.column = column;
    clusterMaxEnd = Math.max(clusterMaxEnd, item.endMinutes);
  }
  finalizeCluster(clusterStart, clamped.length, Math.max(columnEnds.length, 1));

  return clamped;
}

/** Position (en minutes locales) de la ligne « heure actuelle », ou null si `now` n'est pas dans le jour affiché. */
export function currentTimeMinutes(now: Date, day: Date): number | null {
  if (!isSameDay(now, day)) return null;
  return localMinutes(now);
}

/* ─── Règle de chevauchement (référence unique côté client) ─── */

/**
 * Règle métier imposée : `nouveau_debut < fin_existante ET nouvelle_fin > debut_existant`
 * — chevauchements partiels inclus, bornes qui se touchent autorisées.
 * Identique à lib/booking.ts::rangesOverlap ; exportée ici pour que l'UI et
 * les tests utilisent UNE seule implémentation.
 */
export function periodsOverlap(aStartMs: number, aEndMs: number, bStartMs: number, bEndMs: number): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

/** Premier conflit entre une période candidate et des périodes occupées, ou null. */
export function findConflict<T extends { startAt: string; endAt: string }>(
  candidateStartAt: string,
  candidateEndAt: string,
  busy: T[],
  excludeId?: string,
): T | null {
  const s = new Date(candidateStartAt).getTime();
  const e = new Date(candidateEndAt).getTime();
  for (const period of busy) {
    if (excludeId && (period as { id?: string }).id === excludeId) continue;
    if (periodsOverlap(s, e, new Date(period.startAt).getTime(), new Date(period.endAt).getTime())) {
      return period;
    }
  }
  return null;
}
