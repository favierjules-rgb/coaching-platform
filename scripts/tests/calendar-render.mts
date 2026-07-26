/**
 * Harnais de RENDU réel — composants du calendrier admin (montés avec
 * react-dom/server, comme cardio-block-form-render.mts) : états
 * chargement/erreur/vide, grille horaire avec les 5 natures d'événements
 * (distinctions par la forme), vue mois avec repli « +n », modales de
 * création (3 natures, élève obligatoire) et de détail (annulation avec
 * motif, suppression réservée aux événements privés).
 *
 * Lancement : npx tsx scripts/tests/calendar-render.mts
 * (sans la condition react-server — react-dom/server est requis.)
 */
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { AdminCalendar } from "../../components/admin/calendar/AdminCalendar";
import { CalendarEventDetailModal, CalendarEventFormModal } from "../../components/admin/calendar/CalendarEventModal";
import { MonthGrid } from "../../components/admin/calendar/MonthGrid";
import { TimeGrid } from "../../components/admin/calendar/TimeGrid";
import { buildCalendarEvents } from "../../lib/admin-calendar-events";
import type { AdminAppointment, AdminStudent, CoachUnavailability } from "../../types";

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
    title: "Bilan mensuel",
    description: "",
    appointmentType: "Bilan mensuel",
    startAt: "2026-07-20T09:00:00+02:00",
    endAt: "2026-07-20T10:00:00+02:00",
    timezone: "Europe/Paris",
    location: "Salle A",
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
    startAt: "2026-07-21T14:00:00+02:00",
    endAt: "2026-07-21T15:00:00+02:00",
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

const students: AdminStudent[] = [
  { id: "stu-1", firstName: "Marie", lastName: "Dupont", email: "m@example.test" } as AdminStudent,
  { id: "stu-2", firstName: "Paul", lastName: "Martin", email: "p@example.test" } as AdminStudent,
];

// Semaine fixe du lundi 20 au dimanche 26 juillet 2026.
const weekDaysFixture = Array.from({ length: 7 }, (_, i) => new Date(2026, 6, 20 + i));

const events = buildCalendarEvents({
  appointments: [
    appointment({}),
    appointment({ id: "apt-2", status: "cancelled", cancellationReason: "Imprévu", startAt: "2026-07-20T11:00:00+02:00", endAt: "2026-07-20T12:00:00+02:00" }),
  ],
  coachEvents: [
    coachEvent({}),
    coachEvent({ id: "evt-2", category: "personal", title: "Médecin", startAt: "2026-07-22T10:00:00+02:00", endAt: "2026-07-22T11:00:00+02:00" }),
    coachEvent({ id: "evt-3", category: "professional", title: "Formation", allDay: true, startAt: "2026-07-23T00:00:00+02:00", endAt: "2026-07-24T00:00:00+02:00" }),
  ],
  studentNameById: new Map([["stu-1", "Marie Dupont"]]),
  includeCancelled: true,
});

const noop = () => undefined;

test("AdminCalendar : état chargement (spinner, aucune grille)", () => {
  const html = renderToString(
    createElement(AdminCalendar, {
      events: [],
      loading: true,
      error: null,
      onRangeChange: noop,
      onSelectEvent: noop,
      onCreateAt: noop,
      onRetry: noop,
    }),
  );
  assert.ok(html.includes("Chargement du calendrier"));
  assert.ok(!html.includes("Aucun événement"));
});

test("AdminCalendar : état erreur avec bouton Réessayer", () => {
  const html = renderToString(
    createElement(AdminCalendar, {
      events: [],
      loading: false,
      error: "Impossible de charger le calendrier. Vérifie ta connexion.",
      onRangeChange: noop,
      onSelectEvent: noop,
      onCreateAt: noop,
      onRetry: noop,
    }),
  );
  assert.ok(html.includes("Impossible de charger le calendrier"));
  assert.ok(html.includes("Réessayer"));
});

test("AdminCalendar : état vide + barre d'outils complète (Semaine par défaut) + légende", () => {
  const raw = renderToString(
    createElement(AdminCalendar, {
      events: [],
      loading: false,
      error: null,
      onRangeChange: noop,
      onSelectEvent: noop,
      onCreateAt: noop,
      onRetry: noop,
    }),
  );
  const html = raw.replace(/<!--.*?-->/g, "");
  assert.ok(html.includes("Aucun événement sur cette période"));
  for (const label of ["Aujourd&#x27;hui", "Jour", "Semaine", "Mois", "Période précédente", "Période suivante"]) {
    assert.ok(html.includes(label), `barre d'outils : ${label}`);
  }
  // Vue semaine par défaut (bouton pressé)
  assert.match(html, /aria-pressed="true"[^>]*>Semaine|Semaine<[\s\S]{0,80}aria-pressed="true"/);
  for (const legend of ["Rendez-vous élève", "Rendez-vous annulé", "Événement personnel", "Événement professionnel", "Indisponibilité"]) {
    assert.ok(html.includes(legend), `légende : ${legend}`);
  }
});

test("TimeGrid : 5 natures rendues avec des formes distinctes", () => {
  const raw = renderToString(
    createElement(TimeGrid, { days: weekDaysFixture, events, onSelectEvent: noop, onCreateAt: noop }),
  );
  const html = raw.replace(/<!--.*?-->/g, "");
  assert.ok(html.includes("Bilan mensuel"), "RDV élève présent");
  assert.ok(html.includes("Marie Dupont"), "nom de l'élève en sous-titre");
  assert.ok(html.includes("line-through"), "RDV annulé barré");
  assert.ok(html.includes("border-dashed"), "RDV annulé en pointillés");
  assert.ok(html.includes("calendar-hatched"), "indisponibilité hachurée");
  assert.ok(html.includes("Médecin"), "événement personnel présent");
  assert.ok(html.includes("Formation"), "événement professionnel présent");
  assert.ok(html.includes("Journée"), "bandeau toute la journée présent");
  assert.ok(html.includes("toute la journée"), "aria de l'événement toute la journée");
  // Gouttière horaire
  assert.ok(html.includes("07:00") && html.includes("18:00"), "heures de la gouttière");
});

test("MonthGrid : repli « +n autres » au-delà de 3 événements le même jour", () => {
  const crowded = buildCalendarEvents({
    appointments: [0, 1, 2, 3, 4].map((i) =>
      appointment({
        id: `apt-${i}`,
        startAt: `2026-07-20T${String(9 + i).padStart(2, "0")}:00:00+02:00`,
        endAt: `2026-07-20T${String(10 + i).padStart(2, "0")}:00:00+02:00`,
      }),
    ),
    coachEvents: [],
    studentNameById: new Map(),
    includeCancelled: true,
  });
  const raw = renderToString(
    createElement(MonthGrid, { anchor: new Date(2026, 6, 1), events: crowded, onSelectEvent: noop, onOpenDay: noop }),
  );
  const html = raw.replace(/<!--.*?-->/g, "");
  assert.ok(html.includes("+2 autres"), "repli +2 autres attendu (5 événements, 3 affichés)");
});

test("CalendarEventFormModal : création avec les 3 natures et élève obligatoire", () => {
  const raw = renderToString(
    createElement(CalendarEventFormModal, {
      students,
      defaultDurationMinutes: 60,
      busyPeriods: [],
      initialStart: new Date(2026, 6, 20, 9, 0),
      onSave: async () => ({ ok: true }),
      onClose: noop,
    }),
  );
  const html = raw.replace(/<!--.*?-->/g, "");
  for (const label of ["Rendez-vous élève", "Événement personnel (privé)", "Événement professionnel (privé)"]) {
    assert.ok(html.includes(label), `nature : ${label}`);
  }
  assert.ok(html.includes("Marie Dupont") && html.includes("Paul Martin"), "liste réelle des élèves");
  assert.ok(html.includes("Type de rendez-vous"));
});

test("CalendarEventDetailModal RDV actif : annulation proposée, suppression ABSENTE", () => {
  const event = events.find((e) => e.kind === "student");
  assert.ok(event);
  const raw = renderToString(
    createElement(CalendarEventDetailModal, {
      event,
      studentName: "Marie Dupont",
      onCancelAppointment: async () => undefined,
      onRescheduleAppointment: async () => ({ ok: true }),
      onEditCoachEvent: noop,
      onDeleteCoachEvent: async () => undefined,
      onClose: noop,
    }),
  );
  const html = raw.replace(/<!--.*?-->/g, "");
  assert.ok(html.includes("Annuler ce rendez-vous"));
  assert.ok(html.includes("Reporter ce rendez-vous"), "le report doit rester disponible (fonctionnalité existante préservée)");
  assert.ok(!html.includes("Supprimer"), "un RDV élève ne doit jamais proposer de suppression");
});

test("CalendarEventDetailModal événement privé : Modifier + Supprimer présents, motif du RDV absent", () => {
  const event = events.find((e) => e.kind === "personal");
  assert.ok(event);
  const raw = renderToString(
    createElement(CalendarEventDetailModal, {
      event,
      studentName: null,
      onCancelAppointment: async () => undefined,
      onRescheduleAppointment: async () => ({ ok: true }),
      onEditCoachEvent: noop,
      onDeleteCoachEvent: async () => undefined,
      onClose: noop,
    }),
  );
  const html = raw.replace(/<!--.*?-->/g, "");
  assert.ok(html.includes("Modifier"));
  assert.ok(html.includes("Supprimer"));
  assert.ok(!html.includes("Annuler ce rendez-vous"));
});

test("CalendarEventDetailModal RDV annulé : motif affiché, aucune action d'annulation", () => {
  const event = events.find((e) => e.kind === "student_cancelled");
  assert.ok(event);
  const raw = renderToString(
    createElement(CalendarEventDetailModal, {
      event,
      studentName: "Marie Dupont",
      onCancelAppointment: async () => undefined,
      onRescheduleAppointment: async () => ({ ok: true }),
      onEditCoachEvent: noop,
      onDeleteCoachEvent: async () => undefined,
      onClose: noop,
    }),
  );
  const html = raw.replace(/<!--.*?-->/g, "");
  assert.ok(html.includes("Imprévu"), "motif d'annulation affiché");
  assert.ok(!html.includes("Annuler ce rendez-vous"));
  assert.ok(!html.includes("Reporter ce rendez-vous"));
  assert.ok(!html.includes("Supprimer"));
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
