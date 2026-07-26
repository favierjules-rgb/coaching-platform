"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Plus } from "lucide-react";

import { AdminCalendar } from "@/components/admin/calendar/AdminCalendar";
import {
  CalendarEventDetailModal,
  CalendarEventFormModal,
  type CalendarEventSaveData,
} from "@/components/admin/calendar/CalendarEventModal";
import { AvailabilityManager } from "@/components/admin/AvailabilityManager";
import { BookingSlotPicker } from "@/components/student/BookingSlotPicker";
import { useAdminCalendarRange } from "@/hooks/useAdminCalendarRange";
import { useSupabaseAppointments } from "@/hooks/useSupabaseAppointments";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { buildCalendarEvents, busyPeriodsFrom, type AdminCalendarEvent } from "@/lib/admin-calendar-events";
import { fullName } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  cancelAppointment,
  createAppointmentAtomic,
  createCoachAvailability,
  createCoachEventAtomic,
  createCoachUnavailability,
  deleteCoachAvailability,
  deleteCoachUnavailability,
  getAvailableSlots,
  getBookingSettings,
  getPrimaryCoachInfo,
  notifyAppointmentCancellation,
  notifyAppointmentConfirmation,
  notifyAppointmentReschedule,
  rescheduleAppointment,
  updateBookingSettings,
  updateCoachAvailability,
  updateCoachEventAtomic,
} from "@/lib/supabase/appointments";
import type { AdminAppointment, AvailableSlot, CoachAvailability } from "@/types";

type Tab = "rendez-vous" | "disponibilites";

const CONFLICT_MESSAGE =
  "Ce créneau vient d'être occupé (rendez-vous ou événement existant). Choisis un autre horaire.";

/** Prochaine demi-heure pleine — début proposé du bouton « Créer ». */
function nextHalfHour(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + (30 - (d.getMinutes() % 30 || 30)) + 30);
  return d;
}

interface FormState {
  initialStart: Date;
  editedEvent?: AdminCalendarEvent;
  prefilledStudent?: { appointmentType: AvailableSlot["appointmentType"]; location: string; durationMinutes: number };
}

export default function AdminCalendrierPage() {
  const supabaseAppointments = useSupabaseAppointments();
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseStudents.students;
  const calendar = useAdminCalendarRange();
  const [tab, setTab] = useState<Tab>("rendez-vous");

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const studentNameById = useMemo(() => new Map(students.map((s) => [s.id, fullName(s)])), [students]);
  const [coachInfo, setCoachInfo] = useState({ name: "Ton coach", email: "" });

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    getPrimaryCoachInfo(supabase).then((info) => {
      if (!cancelled) setCoachInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const coachName = coachInfo.name;
  const coachEmail = coachInfo.email;

  /* ─── Aperçu des créneaux élèves : EXACTEMENT la même source que la page
     élève (getAvailableSlots + BookingSlotPicker), aucune logique dupliquée. */
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsReloadKey, setSlotsReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setSlotsLoading(false);
        return;
      }
      if (!cancelled) setSlotsLoading(true);
      const available = await getAvailableSlots(supabase);
      if (!cancelled) {
        setSlots(available);
        setSlotsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slotsReloadKey]);

  const calendarEvents = useMemo(
    () =>
      buildCalendarEvents({
        appointments: calendar.appointments,
        coachEvents: calendar.coachEvents,
        studentNameById,
        includeCancelled: true,
      }),
    [calendar.appointments, calendar.coachEvents, studentNameById],
  );
  const busyPeriods = useMemo(
    () => busyPeriodsFrom(calendar.appointments, calendar.coachEvents),
    [calendar.appointments, calendar.coachEvents],
  );

  const todayKey = new Date().toDateString();
  const todaysCount = calendar.appointments.filter(
    (a) => (a.status === "pending" || a.status === "confirmed") && new Date(a.startAt).toDateString() === todayKey,
  ).length;

  const [formState, setFormState] = useState<FormState | null>(null);
  const [detailEvent, setDetailEvent] = useState<AdminCalendarEvent | null>(null);

  const refreshAfterMutation = useCallback(() => {
    calendar.refetch();
    setSlotsReloadKey((k) => k + 1);
    void supabaseAppointments.refetch();
  }, [calendar, supabaseAppointments]);

  /* ─── Mutations (toutes via RPC atomiques, voir lib/supabase/appointments) ─── */

  async function handleSaveEvent(data: CalendarEventSaveData): Promise<{ ok: boolean; message?: string }> {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return { ok: false, message: "Connexion à la base indisponible." };

    if (data.kind === "student") {
      if (!data.studentId || !data.appointmentType) return { ok: false, message: "Choisis un élève." };
      const result = await createAppointmentAtomic(supabase, {
        studentId: data.studentId,
        title: data.title,
        description: data.description ?? "",
        appointmentType: data.appointmentType,
        startAt: data.startAt,
        endAt: data.endAt,
        location: data.location,
        meetingUrl: data.meetingUrl ?? "",
        actorType: "coach",
      });
      if (result.conflict) return { ok: false, message: CONFLICT_MESSAGE };
      if (!result.id) return { ok: false, message: "Création impossible. Réessaie." };
      const student = studentById.get(data.studentId);
      if (student?.email) {
        const created: AdminAppointment = {
          id: result.id,
          studentId: data.studentId,
          coachId: null,
          title: data.title,
          description: data.description ?? "",
          appointmentType: data.appointmentType,
          startAt: data.startAt,
          endAt: data.endAt,
          timezone: "Europe/Paris",
          location: data.location,
          meetingUrl: data.meetingUrl ?? "",
          status: "confirmed",
          cancellationReason: "",
          rescheduledFromId: null,
          icsUid: result.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await notifyAppointmentConfirmation(supabase, created, {
          studentFirstName: student.firstName,
          studentEmail: student.email,
          coachName,
          coachEmail,
        });
      }
      refreshAfterMutation();
      return { ok: true };
    }

    if (data.editedCoachEventId) {
      const result = await updateCoachEventAtomic(supabase, data.editedCoachEventId, {
        title: data.title,
        notes: data.notes ?? "",
        location: data.location,
        allDay: data.allDay ?? false,
        startAt: data.startAt,
        endAt: data.endAt,
      });
      if (result.conflict) return { ok: false, message: CONFLICT_MESSAGE };
      if (!result.id) return { ok: false, message: "Modification impossible. Réessaie." };
      refreshAfterMutation();
      return { ok: true };
    }

    if (data.category !== "personal" && data.category !== "professional") return { ok: false };
    const result = await createCoachEventAtomic(supabase, {
      category: data.category,
      title: data.title,
      notes: data.notes ?? "",
      location: data.location,
      allDay: data.allDay ?? false,
      startAt: data.startAt,
      endAt: data.endAt,
    });
    if (result.conflict) return { ok: false, message: CONFLICT_MESSAGE };
    if (!result.id) return { ok: false, message: "Création impossible. Réessaie." };
    refreshAfterMutation();
    return { ok: true };
  }

  async function handleCancelAppointment(event: AdminCalendarEvent, reason: string) {
    const supabase = createSupabaseBrowserClient();
    const appointment = event.appointment;
    if (!supabase || !appointment) return;
    await cancelAppointment(supabase, appointment.id, reason, appointment.studentId, "coach");
    const student = studentById.get(appointment.studentId ?? "");
    if (student?.email) {
      await notifyAppointmentCancellation(supabase, appointment, {
        studentFirstName: student.firstName,
        studentEmail: student.email,
        coachName,
        coachEmail,
      });
    }
    refreshAfterMutation();
  }

  async function handleRescheduleAppointment(
    event: AdminCalendarEvent,
    newStartAt: string,
    newEndAt: string,
  ): Promise<{ ok: boolean; message?: string }> {
    const supabase = createSupabaseBrowserClient();
    const appointment = event.appointment;
    if (!supabase || !appointment) return { ok: false };
    const newId = await rescheduleAppointment(supabase, appointment, newStartAt, newEndAt);
    if (!newId) return { ok: false, message: CONFLICT_MESSAGE };
    const student = studentById.get(appointment.studentId ?? "");
    if (student?.email) {
      await notifyAppointmentReschedule(
        supabase,
        { ...appointment, id: newId, startAt: newStartAt, endAt: newEndAt },
        { studentFirstName: student.firstName, studentEmail: student.email, coachName, coachEmail },
      );
    }
    refreshAfterMutation();
    return { ok: true };
  }

  async function handleDeleteCoachEvent(event: AdminCalendarEvent) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !event.coachEvent) return;
    await deleteCoachUnavailability(supabase, event.coachEvent.id);
    refreshAfterMutation();
  }

  async function withSupabase(action: (supabase: NonNullable<ReturnType<typeof createSupabaseBrowserClient>>) => Promise<void>) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    await action(supabase);
    await supabaseAppointments.refetch();
    refreshAfterMutation();
  }

  const detailStudentName = detailEvent?.appointment?.studentId
    ? studentNameById.get(detailEvent.appointment.studentId) ?? "Élève"
    : null;

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Calendrier</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {calendarEvents.length} événement{calendarEvents.length > 1 ? "s" : ""} sur la période · {todaysCount}
            {" "}rendez-vous aujourd&apos;hui
          </p>
        </div>
        {tab === "rendez-vous" && (
          <button
            type="button"
            onClick={() => setFormState({ initialStart: nextHalfHour() })}
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Plus size={14} />
            Créer
          </button>
        )}
      </div>

      <div className="mb-6 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("rendez-vous")}
          aria-pressed={tab === "rendez-vous"}
          className={`min-h-[44px] rounded-control border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            tab === "rendez-vous" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Rendez-vous
        </button>
        <button
          type="button"
          onClick={() => setTab("disponibilites")}
          aria-pressed={tab === "disponibilites"}
          className={`min-h-[44px] rounded-control border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            tab === "disponibilites" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Disponibilités
        </button>
      </div>

      {tab === "rendez-vous" ? (
        <div className="flex flex-col gap-10">
          <AdminCalendar
            events={calendarEvents}
            loading={calendar.loading}
            error={calendar.error}
            onRangeChange={calendar.onRangeChange}
            onSelectEvent={setDetailEvent}
            onCreateAt={(start) => setFormState({ initialStart: start })}
            onRetry={calendar.refetch}
          />

          {/* Aperçu des créneaux côté élève — mêmes composant, données et
              règles que /rendez-vous (BookingSlotPicker + getAvailableSlots).
              Sélectionner un créneau PRÉREMPLIT la création d'un rendez-vous
              élève, sans jamais enregistrer automatiquement. */}
          <section aria-label="Aperçu des créneaux élèves">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-widest text-primary">
              Aperçu des créneaux élèves
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Exactement ce que voient les élèves sur leur page Rendez-vous. Choisis un créneau pour préremplir la
              création d&apos;un rendez-vous.
            </p>
            {slotsLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarPlus size={16} />
                Chargement des créneaux…
              </p>
            ) : (
              <BookingSlotPicker
                slots={slots}
                onBook={(slot) =>
                  setFormState({
                    initialStart: new Date(slot.startAt),
                    prefilledStudent: {
                      appointmentType: slot.appointmentType,
                      location: slot.location,
                      durationMinutes: Math.max(
                        15,
                        Math.round((new Date(slot.endAt).getTime() - new Date(slot.startAt).getTime()) / 60_000),
                      ),
                    },
                  })
                }
              />
            )}
          </section>
        </div>
      ) : (
        <AvailabilityManager
          availabilities={supabaseAppointments.availabilities}
          // Comportement historique de l'onglet préservé : seules les
          // indisponibilités simples y sont listées — les événements
          // personnels/professionnels (même table, catégorie différente)
          // se gèrent exclusivement dans le calendrier.
          unavailabilities={supabaseAppointments.unavailabilities.filter((u) => u.category === "unavailability")}
          bookingSettings={supabaseAppointments.bookingSettings}
          onCreateAvailability={(data) =>
            withSupabase(async (supabase) => {
              await createCoachAvailability(supabase, data);
            })
          }
          onUpdateAvailability={(id, partial) =>
            withSupabase(async (supabase) => {
              await updateCoachAvailability(supabase, id, partial as Partial<Omit<CoachAvailability, "id" | "createdAt" | "updatedAt" | "coachId">>);
            })
          }
          onDeleteAvailability={(id) =>
            withSupabase(async (supabase) => {
              await deleteCoachAvailability(supabase, id);
            })
          }
          onCreateUnavailability={(data) =>
            withSupabase(async (supabase) => {
              await createCoachUnavailability(supabase, data);
            })
          }
          onDeleteUnavailability={(id) =>
            withSupabase(async (supabase) => {
              await deleteCoachUnavailability(supabase, id);
            })
          }
          onUpdateSettings={(partial) =>
            withSupabase(async (supabase) => {
              const current = supabaseAppointments.bookingSettings.id
                ? supabaseAppointments.bookingSettings
                : await getBookingSettings(supabase);
              if (!current.id) return;
              await updateBookingSettings(supabase, current.id, partial);
            })
          }
        />
      )}

      {formState && (
        <CalendarEventFormModal
          students={students}
          defaultDurationMinutes={supabaseAppointments.bookingSettings.defaultDurationMinutes}
          busyPeriods={busyPeriods}
          initialStart={formState.initialStart}
          editedEvent={formState.editedEvent}
          prefilledStudent={formState.prefilledStudent}
          onSave={handleSaveEvent}
          onClose={() => setFormState(null)}
        />
      )}

      {detailEvent && (
        <CalendarEventDetailModal
          event={detailEvent}
          studentName={detailStudentName}
          onCancelAppointment={(reason) => handleCancelAppointment(detailEvent, reason)}
          onRescheduleAppointment={(newStartAt, newEndAt) => handleRescheduleAppointment(detailEvent, newStartAt, newEndAt)}
          onEditCoachEvent={() => {
            setFormState({ initialStart: new Date(detailEvent.startAt), editedEvent: detailEvent });
            setDetailEvent(null);
          }}
          onDeleteCoachEvent={() => handleDeleteCoachEvent(detailEvent)}
          onClose={() => setDetailEvent(null)}
        />
      )}
    </div>
  );
}
