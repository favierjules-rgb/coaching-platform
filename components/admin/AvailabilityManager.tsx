"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Field, SelectField } from "@/components/admin/AdminFormFields";
import { formatDateTime } from "@/lib/admin";
import { appointmentTypes, weekdayLabels } from "@/types";
import type { AppointmentType, BookingSettings, CoachAvailability, CoachUnavailability, Weekday } from "@/types";

const weekdayOptions = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((w) => ({ value: String(w), label: weekdayLabels[w] }));

function AvailabilityRow({
  availability,
  onToggleActive,
  onDelete,
}: {
  availability: CoachAvailability;
  onToggleActive: (isActive: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-border p-3">
      <div className="text-sm text-foreground">
        <span className="font-bold">{weekdayLabels[availability.weekday]}</span>{" "}
        {availability.startTime.slice(0, 5)}–{availability.endTime.slice(0, 5)} ·{" "}
        <span className="text-muted-foreground">{availability.slotDurationMinutes} min/créneau · {availability.appointmentType}</span>
        {availability.location && <span className="text-muted-foreground"> · {availability.location}</span>}
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={availability.isActive}
            onChange={(e) => onToggleActive(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Active
        </label>
        <button type="button" onClick={onDelete} className="text-red-400 hover:text-red-300">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function NewAvailabilityForm({
  defaultDurationMinutes,
  onCreate,
}: {
  defaultDurationMinutes: number;
  onCreate: (data: Omit<CoachAvailability, "id" | "createdAt" | "updatedAt" | "coachId">) => void;
}) {
  const [weekday, setWeekday] = useState<Weekday>(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(defaultDurationMinutes);
  const [appointmentType, setAppointmentType] = useState<AppointmentType>("Coaching en salle");
  const [location, setLocation] = useState("");

  function submit() {
    onCreate({ weekday, startTime, endTime, slotDurationMinutes, appointmentType, location, isActive: true });
    setStartTime("09:00");
    setEndTime("12:00");
    setLocation("");
  }

  return (
    <div className="flex flex-col gap-3 border border-dashed border-border p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SelectField label="Jour" value={String(weekday)} onChange={(v) => setWeekday(Number(v) as Weekday)} options={weekdayOptions} />
        <Field label="Début" type="time" value={startTime} onChange={setStartTime} />
        <Field label="Fin" type="time" value={endTime} onChange={setEndTime} />
        <Field label="Durée créneau (min)" type="number" value={String(slotDurationMinutes)} onChange={(v) => setSlotDurationMinutes(Number(v) || defaultDurationMinutes)} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          label="Type par défaut"
          value={appointmentType}
          onChange={(v) => setAppointmentType(v as AppointmentType)}
          options={appointmentTypes.map((t) => ({ value: t, label: t }))}
        />
        <Field label="Lieu par défaut" value={location} onChange={setLocation} placeholder="Salle, adresse, visio..." />
      </div>
      <button
        type="button"
        onClick={submit}
        className="flex items-center justify-center gap-2 border border-primary bg-primary py-2.5 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <Plus size={14} />
        Ajouter cette disponibilité
      </button>
    </div>
  );
}

function NewUnavailabilityForm({ onCreate }: { onCreate: (data: { startAt: string; endAt: string; reason: string }) => void }) {
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:59");
  const [reason, setReason] = useState("");

  function submit() {
    if (!startDate || !endDate) return;
    const startAt = new Date(`${startDate}T${startTime}:00`);
    const endAt = new Date(`${endDate}T${endTime}:00`);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) return;
    onCreate({ startAt: startAt.toISOString(), endAt: endAt.toISOString(), reason: reason.trim() });
    setStartDate("");
    setEndDate("");
    setReason("");
  }

  return (
    <div className="flex flex-col gap-3 border border-dashed border-border p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Début (date)" type="date" value={startDate} onChange={setStartDate} />
        <Field label="Début (heure)" type="time" value={startTime} onChange={setStartTime} />
        <Field label="Fin (date)" type="date" value={endDate} onChange={setEndDate} />
        <Field label="Fin (heure)" type="time" value={endTime} onChange={setEndTime} />
      </div>
      <Field label="Motif" value={reason} onChange={setReason} placeholder="Vacances, jour férié, déplacement, rendez-vous personnel..." />
      <button
        type="button"
        onClick={submit}
        className="flex items-center justify-center gap-2 border border-primary bg-primary py-2.5 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <Plus size={14} />
        Bloquer ce créneau
      </button>
    </div>
  );
}

export function AvailabilityManager({
  availabilities,
  unavailabilities,
  bookingSettings,
  onCreateAvailability,
  onUpdateAvailability,
  onDeleteAvailability,
  onCreateUnavailability,
  onDeleteUnavailability,
  onUpdateSettings,
}: {
  availabilities: CoachAvailability[];
  unavailabilities: CoachUnavailability[];
  bookingSettings: BookingSettings;
  onCreateAvailability: (data: Omit<CoachAvailability, "id" | "createdAt" | "updatedAt" | "coachId">) => void;
  onUpdateAvailability: (id: string, partial: Partial<CoachAvailability>) => void;
  onDeleteAvailability: (id: string) => void;
  onCreateUnavailability: (data: { startAt: string; endAt: string; reason: string }) => void;
  onDeleteUnavailability: (id: string) => void;
  onUpdateSettings: (partial: { minLeadMinutes?: number; maxDaysAhead?: number; defaultDurationMinutes?: number }) => void;
}) {
  const sortedAvailabilities = [...availabilities].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  const upcomingUnavailabilities = [...unavailabilities].sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <div className="flex flex-col gap-8">
      <div className="border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Réglages de réservation</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label="Délai minimum avant réservation (min)"
            type="number"
            value={String(bookingSettings.minLeadMinutes)}
            onChange={(v) => onUpdateSettings({ minLeadMinutes: Number(v) || 0 })}
          />
          <Field
            label="Limite de réservation dans le futur (jours)"
            type="number"
            value={String(bookingSettings.maxDaysAhead)}
            onChange={(v) => onUpdateSettings({ maxDaysAhead: Number(v) || 1 })}
          />
          <Field
            label="Durée par défaut d'un rendez-vous (min)"
            type="number"
            value={String(bookingSettings.defaultDurationMinutes)}
            onChange={(v) => onUpdateSettings({ defaultDurationMinutes: Number(v) || 30 })}
          />
        </div>
      </div>

      <div className="border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Disponibilités récurrentes</h2>
        <div className="mb-4 flex flex-col gap-2">
          {sortedAvailabilities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune disponibilité récurrente définie.</p>
          ) : (
            sortedAvailabilities.map((a) => (
              <AvailabilityRow
                key={a.id}
                availability={a}
                onToggleActive={(isActive) => onUpdateAvailability(a.id, { isActive })}
                onDelete={() => onDeleteAvailability(a.id)}
              />
            ))
          )}
        </div>
        <NewAvailabilityForm defaultDurationMinutes={bookingSettings.defaultDurationMinutes} onCreate={onCreateAvailability} />
      </div>

      <div className="border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Exceptions / indisponibilités</h2>
        <div className="mb-4 flex flex-col gap-2">
          {upcomingUnavailabilities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune exception bloquée.</p>
          ) : (
            upcomingUnavailabilities.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 border border-border p-3">
                <div className="text-sm text-foreground">
                  {formatDateTime(u.startAt)} → {formatDateTime(u.endAt)}
                  {u.reason && <span className="text-muted-foreground"> · {u.reason}</span>}
                </div>
                <button type="button" onClick={() => onDeleteUnavailability(u.id)} className="text-red-400 hover:text-red-300">
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
        <NewUnavailabilityForm onCreate={onCreateUnavailability} />
      </div>
    </div>
  );
}
