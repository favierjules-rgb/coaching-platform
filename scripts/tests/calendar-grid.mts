/**
 * Harnais — logique pure du calendrier admin (lib/calendar-grid.ts).
 *
 * Couvre : bornes de période (semaine lun→dim, jour, mois en semaines
 * complètes), navigation, titres, placement des événements (bornage,
 * colonnes de chevauchement, continuité multi-jours), ligne heure actuelle,
 * règle de chevauchement, et les jours de changement d'heure Europe/Paris
 * (29 mars 2026 passage à l'heure d'été, 25 octobre 2026 retour à l'heure
 * d'hiver).
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/calendar-grid.mts
 */
process.env.TZ = "Europe/Paris"; // fuseau métier du projet (appointments.timezone) — AVANT tout new Date()

import assert from "node:assert/strict";

import {
  DAY_MINUTES,
  addDays,
  allDayEventsForDay,
  currentTimeMinutes,
  dayKeyLocal,
  eventsInRange,
  findConflict,
  layoutDayEvents,
  monthGridDays,
  periodTitle,
  periodsOverlap,
  shiftAnchor,
  startOfWeek,
  viewPeriod,
  weekDays,
} from "../../lib/calendar-grid";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${name}`);
    console.error(error);
  }
}

function ev(id: string, startAt: string, endAt: string, allDay = false) {
  return { id, startAt, endAt, allDay };
}

/* ─── Périodes ─── */

test("semaine : lundi 00:00 → lundi suivant (samedi 25 juillet 2026)", () => {
  const { start, end } = viewPeriod("week", new Date(2026, 6, 25)); // samedi
  assert.equal(dayKeyLocal(start), "2026-07-20"); // lundi
  assert.equal(dayKeyLocal(end), "2026-07-27");
  assert.equal(start.getDay(), 1);
});

test("semaine : un lundi reste son propre début de semaine", () => {
  assert.equal(dayKeyLocal(startOfWeek(new Date(2026, 6, 20))), "2026-07-20");
});

test("semaine : dimanche appartient à la semaine commencée le lundi précédent", () => {
  assert.equal(dayKeyLocal(startOfWeek(new Date(2026, 6, 26))), "2026-07-20");
});

test("jour : [00:00, 00:00 lendemain)", () => {
  const { start, end } = viewPeriod("day", new Date(2026, 6, 25, 15, 30));
  assert.equal(dayKeyLocal(start), "2026-07-25");
  assert.equal(dayKeyLocal(end), "2026-07-26");
});

test("mois : grille en semaines complètes (juillet 2026 : 29 juin → 3 août)", () => {
  const { start, end } = viewPeriod("month", new Date(2026, 6, 25));
  assert.equal(dayKeyLocal(start), "2026-06-29"); // lundi avant le 1er juillet (mercredi)
  assert.equal(dayKeyLocal(end), "2026-08-03"); // lundi après le 31 juillet (vendredi)
  assert.equal(monthGridDays(new Date(2026, 6, 25)).length, 35);
});

test("weekDays : 7 jours lun → dim", () => {
  const days = weekDays(new Date(2026, 6, 25));
  assert.equal(days.length, 7);
  assert.equal(dayKeyLocal(days[0]), "2026-07-20");
  assert.equal(dayKeyLocal(days[6]), "2026-07-26");
});

/* ─── Navigation ─── */

test("navigation semaine : ±7 jours", () => {
  const next = shiftAnchor("week", new Date(2026, 6, 25), 1);
  assert.equal(dayKeyLocal(next), "2026-08-01");
  const prev = shiftAnchor("week", new Date(2026, 6, 25), -1);
  assert.equal(dayKeyLocal(prev), "2026-07-18");
});

test("navigation mois : 31 juillet → 1er août (pas de débordement)", () => {
  const next = shiftAnchor("month", new Date(2026, 6, 31), 1);
  assert.equal(dayKeyLocal(next), "2026-08-01");
  const prev = shiftAnchor("month", new Date(2026, 0, 31), -1);
  assert.equal(dayKeyLocal(prev), "2025-12-01");
});

/* ─── Titres ─── */

test("titres de période en français", () => {
  assert.equal(periodTitle("month", new Date(2026, 6, 25)), "Juillet 2026");
  assert.equal(periodTitle("week", new Date(2026, 6, 25)), "20 – 26 juillet 2026");
  assert.equal(periodTitle("week", new Date(2026, 7, 1)), "27 juillet – 2 août 2026"); // semaine à cheval
  assert.equal(periodTitle("week", new Date(2026, 0, 1)), "29 décembre 2025 – 4 janvier 2026"); // années différentes
  assert.equal(periodTitle("day", new Date(2026, 6, 25)), "Samedi 25 juillet 2026");
});

/* ─── Sélection ─── */

test("eventsInRange : chevauchement partiel inclus, bornes qui se touchent exclues", () => {
  const events = [
    ev("avant", "2026-07-24T10:00:00+02:00", "2026-07-24T11:00:00+02:00"),
    ev("touche-debut", "2026-07-24T23:00:00+02:00", "2026-07-25T00:00:00+02:00"),
    ev("dedans", "2026-07-25T09:00:00+02:00", "2026-07-25T10:00:00+02:00"),
    ev("a-cheval", "2026-07-25T23:30:00+02:00", "2026-07-26T01:00:00+02:00"),
  ];
  const day = new Date(2026, 6, 25);
  const found = eventsInRange(events, day, addDays(day, 1)).map((e) => e.id);
  assert.deepEqual(found, ["dedans", "a-cheval"]);
});

/* ─── Placement ─── */

test("placement simple : minutes locales exactes", () => {
  const day = new Date(2026, 6, 25);
  const [l] = layoutDayEvents([ev("a", "2026-07-25T09:30:00+02:00", "2026-07-25T10:45:00+02:00")], day);
  assert.equal(l.startMinutes, 9 * 60 + 30);
  assert.equal(l.endMinutes, 10 * 60 + 45);
  assert.equal(l.column, 0);
  assert.equal(l.columnCount, 1);
  assert.equal(l.continuesBefore, false);
  assert.equal(l.continuesAfter, false);
});

test("chevauchement : deux événements simultanés → 2 colonnes", () => {
  const day = new Date(2026, 6, 25);
  const layouts = layoutDayEvents(
    [
      ev("a", "2026-07-25T09:00:00+02:00", "2026-07-25T10:00:00+02:00"),
      ev("b", "2026-07-25T09:30:00+02:00", "2026-07-25T10:30:00+02:00"),
      ev("c", "2026-07-25T14:00:00+02:00", "2026-07-25T15:00:00+02:00"),
    ],
    day,
  );
  const byId = new Map(layouts.map((l) => [l.event.id, l]));
  assert.equal(byId.get("a")?.column, 0);
  assert.equal(byId.get("b")?.column, 1);
  assert.equal(byId.get("a")?.columnCount, 2);
  assert.equal(byId.get("b")?.columnCount, 2);
  // c est seul dans son groupe : pleine largeur
  assert.equal(byId.get("c")?.column, 0);
  assert.equal(byId.get("c")?.columnCount, 1);
});

test("chevauchement : réutilisation de colonne après libération", () => {
  const day = new Date(2026, 6, 25);
  const layouts = layoutDayEvents(
    [
      ev("long", "2026-07-25T09:00:00+02:00", "2026-07-25T12:00:00+02:00"),
      ev("c1", "2026-07-25T09:00:00+02:00", "2026-07-25T10:00:00+02:00"),
      ev("c2", "2026-07-25T10:00:00+02:00", "2026-07-25T11:00:00+02:00"),
    ],
    day,
  );
  const byId = new Map(layouts.map((l) => [l.event.id, l]));
  // c2 reprend la colonne libérée par c1 (bornes qui se touchent = pas de conflit)
  assert.equal(byId.get("c1")?.column, byId.get("c2")?.column);
  assert.notEqual(byId.get("long")?.column, byId.get("c1")?.column);
  assert.equal(byId.get("long")?.columnCount, 2);
});

test("événement à cheval sur minuit : borné au jour, continuité marquée", () => {
  const day = new Date(2026, 6, 26);
  const [l] = layoutDayEvents([ev("nuit", "2026-07-25T23:00:00+02:00", "2026-07-26T01:30:00+02:00")], day);
  assert.equal(l.startMinutes, 0);
  assert.equal(l.endMinutes, 90);
  assert.equal(l.continuesBefore, true);
  assert.equal(l.continuesAfter, false);
});

test("toute la journée : exclu de la grille horaire, présent dans le bandeau", () => {
  const day = new Date(2026, 6, 25);
  const events = [
    ev("journee", "2026-07-25T00:00:00+02:00", "2026-07-26T00:00:00+02:00", true),
    ev("horaire", "2026-07-25T09:00:00+02:00", "2026-07-25T10:00:00+02:00"),
  ];
  assert.deepEqual(
    layoutDayEvents(events, day).map((l) => l.event.id),
    ["horaire"],
  );
  assert.deepEqual(
    allDayEventsForDay(events, day).map((e) => e.id),
    ["journee"],
  );
});

test("hauteur minimale : événement de 5 min rendu sur 15 min", () => {
  const day = new Date(2026, 6, 25);
  const [l] = layoutDayEvents([ev("court", "2026-07-25T09:00:00+02:00", "2026-07-25T09:05:00+02:00")], day);
  assert.equal(l.endMinutes - l.startMinutes, 15);
});

/* ─── Changements d'heure Europe/Paris ─── */

test("DST été (29 mars 2026, 23 h réelles) : un RDV à 15 h se place à 900 min", () => {
  const day = new Date(2026, 2, 29);
  const [l] = layoutDayEvents([ev("dst", "2026-03-29T15:00:00+02:00", "2026-03-29T16:00:00+02:00")], day);
  assert.equal(l.startMinutes, 15 * 60);
  assert.equal(l.endMinutes, 16 * 60);
});

test("DST hiver (25 octobre 2026, 25 h réelles) : un RDV à 15 h se place à 900 min", () => {
  const day = new Date(2026, 9, 25);
  const [l] = layoutDayEvents([ev("dst", "2026-10-25T15:00:00+01:00", "2026-10-25T16:00:00+01:00")], day);
  assert.equal(l.startMinutes, 15 * 60);
  assert.equal(l.endMinutes, 16 * 60);
});

test("DST : la semaine du 29 mars garde 7 jours et des clés cohérentes", () => {
  const days = weekDays(new Date(2026, 2, 29));
  assert.equal(days.length, 7);
  assert.equal(dayKeyLocal(days[0]), "2026-03-23");
  assert.equal(dayKeyLocal(days[6]), "2026-03-29");
});

/* ─── Ligne heure actuelle ─── */

test("ligne heure actuelle : présente le bon jour, absente ailleurs", () => {
  const now = new Date(2026, 6, 25, 14, 30);
  assert.equal(currentTimeMinutes(now, new Date(2026, 6, 25)), 14 * 60 + 30);
  assert.equal(currentTimeMinutes(now, new Date(2026, 6, 26)), null);
});

/* ─── Règle de chevauchement ─── */

test("periodsOverlap : règle exacte de la directive", () => {
  // partiel avant, partiel après, inclusion, identique → conflit
  assert.equal(periodsOverlap(0, 60, 30, 90), true);
  assert.equal(periodsOverlap(30, 90, 0, 60), true);
  assert.equal(periodsOverlap(10, 20, 0, 60), true);
  assert.equal(periodsOverlap(0, 60, 0, 60), true);
  // bornes qui se touchent → pas de conflit
  assert.equal(periodsOverlap(0, 60, 60, 120), false);
  assert.equal(periodsOverlap(60, 120, 0, 60), false);
});

test("findConflict : détecte, exclut l'événement déplacé lui-même, DAY_MINUTES export", () => {
  const busy = [
    { id: "x", startAt: "2026-07-25T09:00:00+02:00", endAt: "2026-07-25T10:00:00+02:00" },
    { id: "y", startAt: "2026-07-25T11:00:00+02:00", endAt: "2026-07-25T12:00:00+02:00" },
  ];
  const hit = findConflict("2026-07-25T09:30:00+02:00", "2026-07-25T10:30:00+02:00", busy);
  assert.equal(hit?.id, "x");
  // déplacement de x sur lui-même : pas de conflit avec sa propre période
  assert.equal(findConflict("2026-07-25T09:30:00+02:00", "2026-07-25T10:30:00+02:00", busy, "x"), null);
  // bornes qui se touchent
  assert.equal(findConflict("2026-07-25T10:00:00+02:00", "2026-07-25T11:00:00+02:00", busy), null);
  assert.equal(DAY_MINUTES, 1440);
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
