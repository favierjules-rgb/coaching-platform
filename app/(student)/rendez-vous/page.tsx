"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, CheckCircle } from "lucide-react";

import { BookingSlotPicker } from "@/components/student/BookingSlotPicker";
import { StudentAppointmentCard } from "@/components/student/AppointmentCard";
import { useSupabaseAppointmentsForStudent } from "@/hooks/useSupabaseAppointmentsForStudent";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  cancelAppointment,
  createAppointment,
  getPrimaryCoachInfo,
  notifyAppointmentCancellation,
  notifyAppointmentConfirmation,
} from "@/lib/supabase/appointments";
import type { AdminAppointment, AvailableSlot } from "@/types";

export default function RendezVousPage() {
  const supabaseAppointments = useSupabaseAppointmentsForStudent();
  const [coachInfo, setCoachInfo] = useState({ name: "Ton coach", email: "" });
  const [booking, setBooking] = useState(false);
  const [confirmedSlot, setConfirmedSlot] = useState<AvailableSlot | null>(null);

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

  if (!supabaseAppointments.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (!supabaseAppointments.active) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Rendez-vous</h1>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-border py-20 text-center">
          <CalendarPlus size={28} className="text-muted-foreground" />
          <p className="font-heading text-lg font-bold uppercase text-foreground">Calendrier non disponible</p>
          <p className="max-w-md text-sm text-muted-foreground">
            La prise de rendez-vous n&apos;est pas encore configurée pour ton compte. Contacte ton coach.
          </p>
        </div>
      </div>
    );
  }

  const now = new Date().getTime();
  const upcoming = supabaseAppointments.appointments
    .filter((a) => (a.status === "pending" || a.status === "confirmed") && new Date(a.startAt).getTime() >= now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const past = supabaseAppointments.appointments
    .filter((a) => new Date(a.startAt).getTime() < now || a.status === "cancelled")
    .sort((a, b) => b.startAt.localeCompare(a.startAt));

  async function handleBook(slot: AvailableSlot) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !supabaseAppointments.studentId) return;
    setBooking(true);
    const id = await createAppointment(supabase, {
      studentId: supabaseAppointments.studentId,
      title: slot.appointmentType,
      description: "",
      appointmentType: slot.appointmentType,
      startAt: slot.startAt,
      endAt: slot.endAt,
      location: slot.location,
      meetingUrl: "",
    });
    if (id) {
      const created: AdminAppointment = {
        id,
        studentId: supabaseAppointments.studentId,
        coachId: null,
        title: slot.appointmentType,
        description: "",
        appointmentType: slot.appointmentType,
        startAt: slot.startAt,
        endAt: slot.endAt,
        timezone: "Europe/Paris",
        location: slot.location,
        meetingUrl: "",
        status: "confirmed",
        cancellationReason: "",
        rescheduledFromId: null,
        icsUid: id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (supabaseAppointments.studentEmail) {
        await notifyAppointmentConfirmation(supabase, created, {
          studentFirstName: supabaseAppointments.studentFirstName,
          studentEmail: supabaseAppointments.studentEmail,
          coachName: coachInfo.name,
          coachEmail: coachInfo.email,
        });
      }
      setConfirmedSlot(slot);
      await supabaseAppointments.refetch();
    }
    setBooking(false);
  }

  async function handleCancel(appointment: AdminAppointment, reason: string) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    await cancelAppointment(supabase, appointment.id, reason, appointment.studentId, "student");
    if (supabaseAppointments.studentEmail) {
      await notifyAppointmentCancellation(supabase, appointment, {
        studentFirstName: supabaseAppointments.studentFirstName,
        studentEmail: supabaseAppointments.studentEmail,
        coachName: coachInfo.name,
        coachEmail: coachInfo.email,
      });
    }
    await supabaseAppointments.refetch();
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Rendez-vous</h1>
        <p className="mt-1 text-sm text-muted-foreground">Réserve un créneau avec ton coach et gère tes rendez-vous.</p>
      </div>

      {confirmedSlot && (
        <div className="mb-6 flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          <CheckCircle size={18} className="flex-shrink-0" />
          Rendez-vous réservé — tu peux télécharger l&apos;invitation calendrier ci-dessous.
        </div>
      )}

      <div className="mb-8 border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Réserver un créneau</h2>
        <BookingSlotPicker slots={booking ? [] : supabaseAppointments.availableSlots} onBook={handleBook} />
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">Mes rendez-vous à venir</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun rendez-vous à venir.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((a) => (
              <StudentAppointmentCard
                key={a.id}
                appointment={a}
                studentFirstName={supabaseAppointments.studentFirstName}
                studentEmail={supabaseAppointments.studentEmail}
                coachName={coachInfo.name}
                coachEmail={coachInfo.email}
                onCancel={(reason) => handleCancel(a, reason)}
              />
            ))}
          </div>
        )}
      </div>

      {past.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Mes anciens rendez-vous</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {past.map((a) => (
              <StudentAppointmentCard
                key={a.id}
                appointment={a}
                studentFirstName={supabaseAppointments.studentFirstName}
                studentEmail={supabaseAppointments.studentEmail}
                coachName={coachInfo.name}
                coachEmail={coachInfo.email}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
