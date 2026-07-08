"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";

import { AppointmentCard } from "@/components/admin/AppointmentCard";
import { AppointmentModal, type AppointmentModalSaveData } from "@/components/admin/AppointmentModal";
import { AvailabilityManager } from "@/components/admin/AvailabilityManager";
import { useSupabaseAppointments } from "@/hooks/useSupabaseAppointments";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { formatDate } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  cancelAppointment,
  createAppointment,
  createCoachAvailability,
  createCoachUnavailability,
  deleteCoachAvailability,
  deleteCoachUnavailability,
  getBookingSettings,
  getPrimaryCoachInfo,
  notifyAppointmentCancellation,
  notifyAppointmentConfirmation,
  notifyAppointmentReschedule,
  rescheduleAppointment,
  updateBookingSettings,
  updateCoachAvailability,
} from "@/lib/supabase/appointments";
import type { AdminAppointment, CoachAvailability } from "@/types";

type Tab = "rendez-vous" | "disponibilites";

function dayKey(dateIso: string): string {
  const d = new Date(dateIso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AdminCalendrierPage() {
  const supabaseAppointments = useSupabaseAppointments();
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseStudents.students;
  const [tab, setTab] = useState<Tab>("rendez-vous");

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
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

  const todayKey = dayKey(new Date().toISOString());
  const activeAppointments = supabaseAppointments.appointments.filter(
    (a) => a.status === "pending" || a.status === "confirmed",
  );
  const todaysAppointments = activeAppointments.filter((a) => dayKey(a.startAt) === todayKey);
  const upcomingAppointments = activeAppointments
    .filter((a) => new Date(a.startAt).getTime() >= new Date().getTime())
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const pastAppointments = supabaseAppointments.appointments
    .filter((a) => new Date(a.startAt).getTime() < new Date().getTime() || a.status === "cancelled")
    .sort((a, b) => b.startAt.localeCompare(a.startAt));

  async function withSupabase(action: (supabase: NonNullable<ReturnType<typeof createSupabaseBrowserClient>>) => Promise<void>) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    await action(supabase);
    await supabaseAppointments.refetch();
  }

  async function handleCreateAppointment(data: AppointmentModalSaveData) {
    await withSupabase(async (supabase) => {
      const id = await createAppointment(supabase, { ...data, actorType: "coach" });
      if (!id) return;
      const student = studentById.get(data.studentId);
      const created: AdminAppointment = {
        id,
        studentId: data.studentId,
        coachId: null,
        title: data.title,
        description: data.description,
        appointmentType: data.appointmentType,
        startAt: data.startAt,
        endAt: data.endAt,
        timezone: "Europe/Paris",
        location: data.location,
        meetingUrl: data.meetingUrl,
        status: "confirmed",
        cancellationReason: "",
        rescheduledFromId: null,
        icsUid: id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (student?.email) {
        await notifyAppointmentConfirmation(supabase, created, {
          studentFirstName: student.firstName,
          studentEmail: student.email,
          coachName,
          coachEmail,
        });
      }
    });
  }

  async function handleCancel(appointment: AdminAppointment, reason: string) {
    await withSupabase(async (supabase) => {
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
    });
  }

  async function handleReschedule(appointment: AdminAppointment, newStartAt: string, newEndAt: string) {
    await withSupabase(async (supabase) => {
      const newId = await rescheduleAppointment(supabase, appointment, newStartAt, newEndAt);
      const student = studentById.get(appointment.studentId ?? "");
      if (newId && student?.email) {
        await notifyAppointmentReschedule(
          supabase,
          { ...appointment, id: newId, startAt: newStartAt, endAt: newEndAt },
          { studentFirstName: student.firstName, studentEmail: student.email, coachName, coachEmail },
        );
      }
    });
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Calendrier</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {supabaseAppointments.appointments.length} rendez-vous · {todaysAppointments.length} aujourd&apos;hui
          </p>
        </div>
        {tab === "rendez-vous" && (
          <AppointmentModal
            students={students}
            defaultDurationMinutes={supabaseAppointments.bookingSettings.defaultDurationMinutes}
            onSave={handleCreateAppointment}
          />
        )}
      </div>

      <div className="mb-6 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("rendez-vous")}
          className={`border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
            tab === "rendez-vous" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Rendez-vous
        </button>
        <button
          type="button"
          onClick={() => setTab("disponibilites")}
          className={`border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
            tab === "disponibilites" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Disponibilités
        </button>
      </div>

      {tab === "rendez-vous" ? (
        <div className="flex flex-col gap-8">
          <div>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">
              Aujourd&apos;hui — {formatDate(new Date().toISOString())}
            </h2>
            {todaysAppointments.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays size={16} />
                Aucun rendez-vous aujourd&apos;hui.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {todaysAppointments.map((a) => (
                  <AppointmentCard
                    key={a.id}
                    appointment={a}
                    student={studentById.get(a.studentId ?? "")}
                    coachName={coachName}
                    coachEmail={coachEmail}
                    onCancel={(reason) => handleCancel(a, reason)}
                    onReschedule={(start, end) => handleReschedule(a, start, end)}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">Rendez-vous à venir</h2>
            {upcomingAppointments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun rendez-vous à venir.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {upcomingAppointments.map((a) => (
                  <AppointmentCard
                    key={a.id}
                    appointment={a}
                    student={studentById.get(a.studentId ?? "")}
                    coachName={coachName}
                    coachEmail={coachEmail}
                    onCancel={(reason) => handleCancel(a, reason)}
                    onReschedule={(start, end) => handleReschedule(a, start, end)}
                  />
                ))}
              </div>
            )}
          </div>

          {pastAppointments.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Historique</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {pastAppointments.slice(0, 12).map((a) => (
                  <AppointmentCard
                    key={a.id}
                    appointment={a}
                    student={studentById.get(a.studentId ?? "")}
                    coachName={coachName}
                    coachEmail={coachEmail}
                    onCancel={(reason) => handleCancel(a, reason)}
                    onReschedule={(start, end) => handleReschedule(a, start, end)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <AvailabilityManager
          availabilities={supabaseAppointments.availabilities}
          unavailabilities={supabaseAppointments.unavailabilities}
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
    </div>
  );
}
