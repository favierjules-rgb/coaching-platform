/**
 * Harnais — view-model des événements du calendrier admin
 * (lib/admin-calendar-events.ts) : mapping RDV/événements coach,
 * distinction des natures, RDV annulés visibles mais non bloquants,
 * périodes occupées.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/calendar-events.mts
 */
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";

import {
  CALENDAR_KIND_LABELS,
  appointmentToCalendarEvent,
  buildCalendarEvents,
  busyPeriodsFrom,
  coachEventToCalendarEvent,
} from "../../lib/admin-calendar-events";
import { findConflict } from "../../lib/calendar-grid";
import type { AdminAppointment, CoachUnavailability } from "../../types";

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

function appointment(partial: Partial<AdminAppointment>): AdminAppointment {
  return {
    id: "apt-1",
    studentId: "stu-1",
    coachId: null,
    title: "",
    description: "",
    appointmentType: "Coaching en salle",
    startAt: "2026-07-27T09:00:00+02:00",
    endAt: "2026-07-27T10:00:00+02:00",
    timezone: "Europe/Paris",
    location: "",
    meetingUrl: "",
    status: "confirmed",
    cancellationReason: "",
    rescheduledFromId: null,
    icsUid: "uid",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...partial,
  };
}

function coachEvent(partial: Partial<CoachUnavailability>): CoachUnavailability {
  return {
    id: "evt-1",
    coachId: null,
    startAt: "2026-07-27T14:00:00+02:00",
    endAt: "2026-07-27T15:00:00+02:00",
    reason: "",
    category: "unavailability",
    title: "",
    notes: "",
    location: "",
    allDay: false,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...partial,
  };
}

test("RDV confirmé → kind student, titre = type si titre vide, sous-titre = élève", () => {
  const ev = appointmentToCalendarEvent(appointment({}), "Marie Dupont");
  assert.equal(ev.kind, "student");
  assert.equal(ev.title, "Coaching en salle");
  assert.equal(ev.subtitle, "Marie Dupont");
  assert.equal(ev.allDay, false);
});

test("RDV annulé → kind student_cancelled distinct", () => {
  const ev = appointmentToCalendarEvent(appointment({ status: "cancelled", cancellationReason: "Imprévu" }), "Marie");
  assert.equal(ev.kind, "student_cancelled");
  assert.notEqual(CALENDAR_KIND_LABELS.student_cancelled, CALENDAR_KIND_LABELS.student);
});

test("événement personnel/professionnel/indisponibilité → kinds distincts", () => {
  assert.equal(coachEventToCalendarEvent(coachEvent({ category: "personal", title: "Médecin" })).kind, "personal");
  assert.equal(coachEventToCalendarEvent(coachEvent({ category: "professional", title: "Formation" })).kind, "professional");
  const unav = coachEventToCalendarEvent(coachEvent({ reason: "Vacances" }));
  assert.equal(unav.kind, "unavailability");
  assert.equal(unav.title, "Vacances"); // repli sur reason
});

test("toute la journée transmis au layout", () => {
  const ev = coachEventToCalendarEvent(coachEvent({ category: "personal", allDay: true, title: "Déplacement" }));
  assert.equal(ev.allDay, true);
});

test("buildCalendarEvents : tri par début, annulés selon includeCancelled", () => {
  const appointments = [
    appointment({ id: "b", startAt: "2026-07-27T11:00:00+02:00", endAt: "2026-07-27T12:00:00+02:00" }),
    appointment({ id: "a" }),
    appointment({ id: "c", status: "cancelled" }),
  ];
  const withCancelled = buildCalendarEvents({
    appointments,
    coachEvents: [coachEvent({})],
    studentNameById: new Map([["stu-1", "Marie"]]),
    includeCancelled: true,
  });
  assert.equal(withCancelled.length, 4);
  assert.deepEqual(
    withCancelled.map((e) => e.id),
    ["appointment:a", "appointment:c", "appointment:b", "coach-event:evt-1"],
  );
  const withoutCancelled = buildCalendarEvents({
    appointments,
    coachEvents: [],
    studentNameById: new Map(),
    includeCancelled: false,
  });
  assert.equal(withoutCancelled.length, 2);
  assert.equal(withoutCancelled.some((e) => e.kind === "student_cancelled"), false);
});

test("busyPeriodsFrom : pending/confirmed + événements coach bloquent, annulé libère", () => {
  const busy = busyPeriodsFrom(
    [
      appointment({ id: "ok" }),
      appointment({ id: "pending", status: "pending", startAt: "2026-07-27T16:00:00+02:00", endAt: "2026-07-27T17:00:00+02:00" }),
      appointment({ id: "cancelled", status: "cancelled", startAt: "2026-07-27T18:00:00+02:00", endAt: "2026-07-27T19:00:00+02:00" }),
    ],
    [coachEvent({ id: "perso", category: "personal" })],
  );
  assert.deepEqual(
    busy.map((b) => b.id),
    ["appointment:ok", "appointment:pending", "coach-event:perso"],
  );
  // un nouveau RDV sur le créneau de l'annulé passe (règle métier existante)
  assert.equal(findConflict("2026-07-27T18:00:00+02:00", "2026-07-27T19:00:00+02:00", busy), null);
  // …mais pas sur un créneau bloqué par l'événement personnel
  assert.equal(findConflict("2026-07-27T14:30:00+02:00", "2026-07-27T15:30:00+02:00", busy)?.id, "coach-event:perso");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
