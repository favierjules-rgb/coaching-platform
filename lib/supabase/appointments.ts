import type { SupabaseClient } from "@supabase/supabase-js";

import { computeAvailableSlots } from "@/lib/booking";
import {
  sendAppointmentCancellationEmail,
  sendAppointmentConfirmationEmail,
  sendAppointmentRescheduleEmail,
  type AppointmentEmailContext,
} from "@/lib/email/appointment-emails";
import type {
  AdminAppointment,
  AppointmentStatus,
  AvailableSlot,
  BookingSettings,
  CoachAvailability,
  CoachUnavailability,
  Weekday,
} from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès Supabase pour le calendrier/réservation (tables
 * `coach_availabilities`, `coach_unavailabilities`, `appointments`,
 * `booking_settings` — voir supabase/schema.sql, chantier
 * "supabase-calendar-booking-system"). Même principe que le reste de
 * lib/supabase/* : toute lecture renvoie un résultat "vide" en cas
 * d'absence de données ou d'erreur (jamais d'exception), warning dev
 * uniquement.
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type AvailabilityRow = Database["public"]["Tables"]["coach_availabilities"]["Row"];
type UnavailabilityRow = Database["public"]["Tables"]["coach_unavailabilities"]["Row"];
type AppointmentRow = Database["public"]["Tables"]["appointments"]["Row"];
type BookingSettingsRow = Database["public"]["Tables"]["booking_settings"]["Row"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

/* ─── Composition ─── */

function mapAvailabilityRow(row: AvailabilityRow): CoachAvailability {
  return {
    id: row.id,
    coachId: row.coach_id,
    weekday: row.weekday as Weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    slotDurationMinutes: row.slot_duration_minutes,
    appointmentType: (row.appointment_type?.trim() || "Autre") as CoachAvailability["appointmentType"],
    location: row.location ?? "",
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUnavailabilityRow(row: UnavailabilityRow): CoachUnavailability {
  return {
    id: row.id,
    coachId: row.coach_id,
    startAt: row.start_at,
    endAt: row.end_at,
    reason: row.reason ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAppointmentRow(row: AppointmentRow): AdminAppointment {
  return {
    id: row.id,
    studentId: row.student_id,
    coachId: row.coach_id,
    title: row.title ?? "",
    description: row.description ?? "",
    appointmentType: (row.appointment_type?.trim() || "Autre") as AdminAppointment["appointmentType"],
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone || "Europe/Paris",
    location: row.location ?? "",
    meetingUrl: row.meeting_url ?? "",
    status: row.status,
    cancellationReason: row.cancellation_reason ?? "",
    rescheduledFromId: row.rescheduled_from_id,
    icsUid: row.ics_uid || row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBookingSettingsRow(row: BookingSettingsRow): BookingSettings {
  return {
    id: row.id,
    minLeadMinutes: row.min_lead_minutes,
    maxDaysAhead: row.max_days_ahead,
    defaultDurationMinutes: row.default_duration_minutes,
  };
}

const DEFAULT_BOOKING_SETTINGS: BookingSettings = { id: null, minLeadMinutes: 120, maxDaysAhead: 30, defaultDurationMinutes: 60 };
const DEFAULT_COACH_INFO = { name: "Ton coach", email: "" };

/** Coach principal (première fiche `coaches` créée) — utilisé comme organisateur des invitations .ics/emails, faute d'un vrai modèle multi-coach dans l'app (voir docs/supabase-calendar-booking-model.md). */
export async function getPrimaryCoachInfo(supabase: TypedSupabaseClient): Promise<{ name: string; email: string }> {
  const { data, error } = await supabase.from("coaches").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle();
  devWarn("getPrimaryCoachInfo", error);
  if (!data) return DEFAULT_COACH_INFO;
  return { name: data.name || DEFAULT_COACH_INFO.name, email: data.email || DEFAULT_COACH_INFO.email };
}

/** Rendez-vous qui bloquent encore un créneau (annulé = créneau libéré, voir règle du chantier). */
const BLOCKING_STATUSES: AppointmentStatus[] = ["pending", "confirmed"];

/* ─── Disponibilités récurrentes ─── */

export async function getCoachAvailabilities(supabase: TypedSupabaseClient): Promise<CoachAvailability[]> {
  const { data, error } = await supabase.from("coach_availabilities").select("*").order("weekday").order("start_time");
  devWarn("getCoachAvailabilities", error);
  return (data ?? []).map(mapAvailabilityRow);
}

export async function createCoachAvailability(
  supabase: TypedSupabaseClient,
  data: Omit<CoachAvailability, "id" | "createdAt" | "updatedAt" | "coachId">,
): Promise<string | null> {
  const { data: row, error } = await supabase
    .from("coach_availabilities")
    .insert({
      weekday: data.weekday,
      start_time: data.startTime,
      end_time: data.endTime,
      slot_duration_minutes: data.slotDurationMinutes,
      appointment_type: data.appointmentType,
      location: data.location,
      is_active: data.isActive,
    })
    .select("id")
    .single();
  devWarn("createCoachAvailability", error);
  return row?.id ?? null;
}

export async function updateCoachAvailability(
  supabase: TypedSupabaseClient,
  id: string,
  partial: Partial<Omit<CoachAvailability, "id" | "createdAt" | "updatedAt" | "coachId">>,
): Promise<boolean> {
  const update: Database["public"]["Tables"]["coach_availabilities"]["Update"] = { updated_at: new Date().toISOString() };
  if (partial.weekday !== undefined) update.weekday = partial.weekday;
  if (partial.startTime !== undefined) update.start_time = partial.startTime;
  if (partial.endTime !== undefined) update.end_time = partial.endTime;
  if (partial.slotDurationMinutes !== undefined) update.slot_duration_minutes = partial.slotDurationMinutes;
  if (partial.appointmentType !== undefined) update.appointment_type = partial.appointmentType;
  if (partial.location !== undefined) update.location = partial.location;
  if (partial.isActive !== undefined) update.is_active = partial.isActive;
  const { error } = await supabase.from("coach_availabilities").update(update).eq("id", id);
  devWarn("updateCoachAvailability", error);
  return !error;
}

export async function deleteCoachAvailability(supabase: TypedSupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("coach_availabilities").delete().eq("id", id);
  devWarn("deleteCoachAvailability", error);
  return !error;
}

/* ─── Indisponibilités ponctuelles ─── */

export async function getCoachUnavailabilities(supabase: TypedSupabaseClient): Promise<CoachUnavailability[]> {
  const { data, error } = await supabase.from("coach_unavailabilities").select("*").order("start_at", { ascending: true });
  devWarn("getCoachUnavailabilities", error);
  return (data ?? []).map(mapUnavailabilityRow);
}

export async function createCoachUnavailability(
  supabase: TypedSupabaseClient,
  data: { startAt: string; endAt: string; reason: string },
): Promise<string | null> {
  const { data: row, error } = await supabase
    .from("coach_unavailabilities")
    .insert({ start_at: data.startAt, end_at: data.endAt, reason: data.reason })
    .select("id")
    .single();
  devWarn("createCoachUnavailability", error);
  return row?.id ?? null;
}

export async function deleteCoachUnavailability(supabase: TypedSupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("coach_unavailabilities").delete().eq("id", id);
  devWarn("deleteCoachUnavailability", error);
  return !error;
}

/* ─── Réglages de réservation ─── */

export async function getBookingSettings(supabase: TypedSupabaseClient): Promise<BookingSettings> {
  const { data, error } = await supabase.from("booking_settings").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle();
  devWarn("getBookingSettings", error);
  return data ? mapBookingSettingsRow(data) : DEFAULT_BOOKING_SETTINGS;
}

export async function updateBookingSettings(
  supabase: TypedSupabaseClient,
  id: string,
  partial: Partial<Omit<BookingSettings, "id">>,
): Promise<boolean> {
  const update: Database["public"]["Tables"]["booking_settings"]["Update"] = { updated_at: new Date().toISOString() };
  if (partial.minLeadMinutes !== undefined) update.min_lead_minutes = partial.minLeadMinutes;
  if (partial.maxDaysAhead !== undefined) update.max_days_ahead = partial.maxDaysAhead;
  if (partial.defaultDurationMinutes !== undefined) update.default_duration_minutes = partial.defaultDurationMinutes;
  const { error } = await supabase.from("booking_settings").update(update).eq("id", id);
  devWarn("updateBookingSettings", error);
  return !error;
}

/* ─── Rendez-vous ─── */

/** Tous les rendez-vous (vue admin), plus récents en premier par date de début. */
export async function getAllAppointments(supabase: TypedSupabaseClient): Promise<AdminAppointment[]> {
  const { data, error } = await supabase.from("appointments").select("*").order("start_at", { ascending: false });
  devWarn("getAllAppointments", error);
  return (data ?? []).map(mapAppointmentRow);
}

/** Rendez-vous d'un élève précis (vue élève), plus proches en premier. */
export async function getAppointmentsForStudent(supabase: TypedSupabaseClient, studentId: string): Promise<AdminAppointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("student_id", studentId)
    .order("start_at", { ascending: true });
  devWarn("getAppointmentsForStudent", error);
  return (data ?? []).map(mapAppointmentRow);
}

/** Calcule les créneaux disponibles pour les prochains jours à partir des disponibilités/indisponibilités/réservations réelles. */
export async function getAvailableSlots(supabase: TypedSupabaseClient): Promise<AvailableSlot[]> {
  const [availabilities, unavailabilities, settings] = await Promise.all([
    getCoachAvailabilities(supabase),
    getCoachUnavailabilities(supabase),
    getBookingSettings(supabase),
  ]);

  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + settings.maxDaysAhead + 1);
  const { data: bookedRows, error: bookedError } = await supabase
    .from("appointments")
    .select("start_at, end_at, status")
    .in("status", BLOCKING_STATUSES)
    .lte("start_at", windowEnd.toISOString());
  devWarn("getAvailableSlots (appointments)", bookedError);

  return computeAvailableSlots({
    availabilities: availabilities.map((a) => ({
      weekday: a.weekday,
      startTime: a.startTime,
      endTime: a.endTime,
      slotDurationMinutes: a.slotDurationMinutes,
      appointmentType: a.appointmentType,
      location: a.location,
      isActive: a.isActive,
    })),
    unavailabilities: unavailabilities.map((u) => ({ startAt: u.startAt, endAt: u.endAt })),
    bookedRanges: (bookedRows ?? []).map((r) => ({ startAt: r.start_at, endAt: r.end_at })),
    minLeadMinutes: settings.minLeadMinutes,
    maxDaysAhead: settings.maxDaysAhead,
  });
}

export interface CreateAppointmentInput {
  studentId: string;
  title: string;
  description: string;
  appointmentType: string;
  startAt: string;
  endAt: string;
  location: string;
  meetingUrl: string;
  status?: AppointmentStatus;
}

/** Crée un rendez-vous (réservation élève ou création manuelle admin) et renvoie l'id créé, ou null en cas d'échec. */
export async function createAppointment(supabase: TypedSupabaseClient, input: CreateAppointmentInput): Promise<string | null> {
  const icsUid = `${crypto.randomUUID()}@seth-coaching`;
  const { data: row, error } = await supabase
    .from("appointments")
    .insert({
      student_id: input.studentId,
      title: input.title,
      description: input.description,
      appointment_type: input.appointmentType,
      start_at: input.startAt,
      end_at: input.endAt,
      location: input.location,
      meeting_url: input.meetingUrl,
      status: input.status ?? "confirmed",
      ics_uid: icsUid,
    })
    .select("id")
    .single();
  devWarn("createAppointment", error);
  return row?.id ?? null;
}

export async function cancelAppointment(
  supabase: TypedSupabaseClient,
  id: string,
  reason: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("appointments")
    .update({ status: "cancelled", cancellation_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", id);
  devWarn("cancelAppointment", error);
  return !error;
}

/**
 * Reporte un rendez-vous : crée un nouveau rendez-vous au nouveau créneau
 * (référence `rescheduled_from_id` vers l'original) et annule l'original —
 * plus simple et plus sûr qu'un déplacement en place (garde l'historique,
 * cohérent avec le choix déjà fait pour updateProgram : remplacer plutôt
 * que modifier finement).
 */
export async function rescheduleAppointment(
  supabase: TypedSupabaseClient,
  appointment: AdminAppointment,
  newStartAt: string,
  newEndAt: string,
): Promise<string | null> {
  const icsUid = `${crypto.randomUUID()}@seth-coaching`;
  const { data: row, error: insertError } = await supabase
    .from("appointments")
    .insert({
      student_id: appointment.studentId,
      title: appointment.title,
      description: appointment.description,
      appointment_type: appointment.appointmentType,
      start_at: newStartAt,
      end_at: newEndAt,
      location: appointment.location,
      meeting_url: appointment.meetingUrl,
      status: "confirmed",
      rescheduled_from_id: appointment.id,
      ics_uid: icsUid,
    })
    .select("id")
    .single();
  devWarn("rescheduleAppointment (insert)", insertError);
  if (!row) {
    return null;
  }
  const { error: cancelError } = await supabase
    .from("appointments")
    .update({ status: "cancelled", cancellation_reason: "Reporté", updated_at: new Date().toISOString() })
    .eq("id", appointment.id);
  devWarn("rescheduleAppointment (cancel original)", cancelError);
  return row.id;
}

/* ─── Emails (best-effort, ne bloque jamais l'action principale) ─── */

export interface EmailRecipientInfo {
  studentFirstName: string;
  studentEmail: string;
  coachName: string;
  coachEmail: string;
}

function emailContextFrom(appointment: AdminAppointment, recipient: EmailRecipientInfo): AppointmentEmailContext {
  return {
    appointmentId: appointment.id,
    icsUid: appointment.icsUid,
    title: appointment.title,
    description: appointment.description,
    appointmentType: appointment.appointmentType,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    location: appointment.location,
    meetingUrl: appointment.meetingUrl,
    studentFirstName: recipient.studentFirstName,
    studentEmail: recipient.studentEmail,
    coachName: recipient.coachName,
    coachEmail: recipient.coachEmail,
  };
}

export async function notifyAppointmentConfirmation(
  supabase: TypedSupabaseClient,
  appointment: AdminAppointment,
  recipient: EmailRecipientInfo,
): Promise<void> {
  await sendAppointmentConfirmationEmail(supabase, emailContextFrom(appointment, recipient));
}

export async function notifyAppointmentCancellation(
  supabase: TypedSupabaseClient,
  appointment: AdminAppointment,
  recipient: EmailRecipientInfo,
): Promise<void> {
  await sendAppointmentCancellationEmail(supabase, emailContextFrom(appointment, recipient));
}

export async function notifyAppointmentReschedule(
  supabase: TypedSupabaseClient,
  appointment: AdminAppointment,
  recipient: EmailRecipientInfo,
): Promise<void> {
  await sendAppointmentRescheduleEmail(supabase, emailContextFrom(appointment, recipient));
}
