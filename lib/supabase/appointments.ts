import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import { computeAvailableSlots } from "@/lib/booking";
import {
  sendAppointmentCancellationEmail,
  sendAppointmentConfirmationEmail,
  sendAppointmentRescheduleEmail,
  type AppointmentEmailContext,
} from "@/lib/email/appointment-emails";
import type {
  ActivityActorType,
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
  // Colonnes du chantier "admin-apple-calendar" (category/title/notes/
  // location/all_day) : replis sûrs tant que la migration n'est pas
  // appliquée sur l'environnement courant (select("*") renvoie alors
  // simplement des champs absents).
  const extended = row as UnavailabilityRow & {
    category?: string | null;
    title?: string | null;
    notes?: string | null;
    location?: string | null;
    all_day?: boolean | null;
  };
  const category = extended.category === "personal" || extended.category === "professional" ? extended.category : "unavailability";
  return {
    id: row.id,
    coachId: row.coach_id,
    startAt: row.start_at,
    endAt: row.end_at,
    reason: row.reason ?? "",
    category,
    title: extended.title ?? "",
    notes: extended.notes ?? "",
    location: extended.location ?? "",
    allDay: extended.all_day ?? false,
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

/**
 * Identité du coach telle qu'un ÉLÈVE peut la connaître.
 *
 * Passe par la RPC `get_my_coach_public_profile()` (migration 20260726220000)
 * et jamais par un `select` sur `coaches` : depuis l'audit du 26/07/2026, la
 * policy `coaches_select_staff` réserve la lecture de cette table aux coachs
 * et aux administrateurs, un élève y lit zéro ligne.
 *
 * Deux différences assumées avec `getPrimaryCoachInfo` :
 *   - la RPC renvoie le coach RÉELLEMENT associé à l'élève (students.coach_id),
 *     et non la première fiche créée — c'est plus juste ;
 *   - l'email n'est pas exposé. Il ne servait côté élève qu'à remplir
 *     `ORGANIZER` dans le .ics, ligne désormais omise (lib/ics.ts). Les emails
 *     transactionnels, eux, rechargent le coach côté serveur en service role
 *     (app/api/email/appointment-notification/route.ts) : ce chemin est intact.
 */
export async function getMyCoachPublicInfo(supabase: TypedSupabaseClient): Promise<{ name: string; email: string }> {
  // RPC ajoutée par la migration 20260726220000, pas encore dans les types
  // générés (`Functions: Record<string, never>`) : `data` arrive en `never`,
  // d'où la normalisation explicite ci-dessous.
  const { data, error } = await supabase.rpc("get_my_coach_public_profile");
  devWarn("getMyCoachPublicInfo", error as { message: string } | null);
  const ligne = (Array.isArray(data) ? data[0] : data) as { first_name?: string | null; last_name?: string | null } | null | undefined;
  if (!ligne) return DEFAULT_COACH_INFO;
  const nom = [ligne.first_name, ligne.last_name].filter(Boolean).join(" ").trim();
  return { name: nom || DEFAULT_COACH_INFO.name, email: "" };
}

/** Coach principal (première fiche `coaches` créée) — utilisé comme organisateur des invitations .ics/emails, faute d'un vrai modèle multi-coach dans l'app (voir docs/supabase-calendar-booking-model.md). RÉSERVÉ au staff et au serveur : un élève lit zéro ligne dans `coaches` depuis la migration 20260726220000, il doit appeler `getMyCoachPublicInfo`. */
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

/** Événements du coach (toutes catégories) intersectant [from, to) — calendrier admin, période affichée uniquement. */
export async function getCoachEventsInRange(
  supabase: TypedSupabaseClient,
  from: Date,
  to: Date,
): Promise<CoachUnavailability[]> {
  const { data, error } = await supabase
    .from("coach_unavailabilities")
    .select("*")
    .lt("start_at", to.toISOString())
    .gt("end_at", from.toISOString())
    .order("start_at", { ascending: true });
  devWarn("getCoachEventsInRange", error);
  return (data ?? []).map(mapUnavailabilityRow);
}

/** La RPC calendrier n'existe pas encore sur l'environnement (migrations "admin-apple-calendar" non appliquées). */
function isMissingRpc(error: { code?: string; message: string } | null): boolean {
  return Boolean(error && (error.code === "PGRST202" || /could not find the function/i.test(error.message)));
}

/** L'écriture a été refusée pour cause de chevauchement (RPC ou contrainte d'exclusion). */
function isConflictError(error: { code?: string; message: string } | null): boolean {
  return Boolean(error && (error.code === "23P01" || error.message.includes("calendar_conflict")));
}

/**
 * Indisponibilité simple (onglet Disponibilités — comportement préservé, y
 * compris le droit de se bloquer par-dessus un RDV existant) : passe par la
 * RPC atomique avec p_allow_overlap, avec repli sur l'INSERT historique tant
 * que les migrations calendrier ne sont pas appliquées.
 */
export async function createCoachUnavailability(
  supabase: TypedSupabaseClient,
  data: { startAt: string; endAt: string; reason: string },
): Promise<string | null> {
  // @ts-expect-error — RPC ajoutée par la migration 20260726121000, pas encore dans les types générés.
  const { data: rpcId, error } = await supabase.rpc("create_coach_event_atomic", {
    p_category: "unavailability",
    p_title: "",
    p_notes: "",
    p_location: "",
    p_all_day: false,
    p_start_at: data.startAt,
    p_end_at: data.endAt,
    p_reason: data.reason,
    p_allow_overlap: true,
  });
  if (!error) return (rpcId as string | null) ?? null;
  if (!isMissingRpc(error)) {
    devWarn("createCoachUnavailability", error);
    return null;
  }
  // Repli pré-migration (sera inerte après application : RLS sans policy INSERT).
  const { data: row, error: insertError } = await supabase
    .from("coach_unavailabilities")
    .insert({ start_at: data.startAt, end_at: data.endAt, reason: data.reason })
    .select("id")
    .single();
  devWarn("createCoachUnavailability (repli pré-migration)", insertError);
  return row?.id ?? null;
}

export interface CoachEventInput {
  category: "personal" | "professional";
  title: string;
  notes: string;
  location: string;
  allDay: boolean;
  startAt: string;
  endAt: string;
}

export interface AtomicWriteResult {
  id: string | null;
  /** true si l'écriture a été refusée parce que la période chevauche une période occupée. */
  conflict: boolean;
}

/** Événement personnel/professionnel de l'admin — contrôle de conflit STRICT côté serveur. */
export async function createCoachEventAtomic(
  supabase: TypedSupabaseClient,
  input: CoachEventInput,
): Promise<AtomicWriteResult> {
  // @ts-expect-error — RPC ajoutée par la migration 20260726121000, pas encore dans les types générés.
  const { data, error } = await supabase.rpc("create_coach_event_atomic", {
    p_category: input.category,
    p_title: input.title,
    p_notes: input.notes,
    p_location: input.location,
    p_all_day: input.allDay,
    p_start_at: input.startAt,
    p_end_at: input.endAt,
    p_reason: "",
    p_allow_overlap: false,
  });
  if (error) {
    if (!isConflictError(error)) devWarn("createCoachEventAtomic", error);
    return { id: null, conflict: isConflictError(error) };
  }
  return { id: (data as string | null) ?? null, conflict: false };
}

/** Modification (déplacement/durée/contenu) d'un événement du coach — même contrôle strict. */
export async function updateCoachEventAtomic(
  supabase: TypedSupabaseClient,
  id: string,
  input: Omit<CoachEventInput, "category">,
): Promise<AtomicWriteResult> {
  // @ts-expect-error — RPC ajoutée par la migration 20260726121000, pas encore dans les types générés.
  const { data, error } = await supabase.rpc("update_coach_event_atomic", {
    p_id: id,
    p_title: input.title,
    p_notes: input.notes,
    p_location: input.location,
    p_all_day: input.allDay,
    p_start_at: input.startAt,
    p_end_at: input.endAt,
  });
  if (error) {
    if (!isConflictError(error)) devWarn("updateCoachEventAtomic", error);
    return { id: null, conflict: isConflictError(error) };
  }
  return { id: data === true ? id : null, conflict: false };
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

/** Un rendez-vous précis par id — utilisé notamment par app/api/email/appointment-notification (chantier "supabase-resend-transactional-emails") pour relire l'état réel avant d'envoyer l'email correspondant. */
export async function getAppointmentById(supabase: TypedSupabaseClient, appointmentId: string): Promise<AdminAppointment | null> {
  const { data, error } = await supabase.from("appointments").select("*").eq("id", appointmentId).maybeSingle();
  devWarn("getAppointmentById", error);
  return data ? mapAppointmentRow(data) : null;
}

/** Tous les rendez-vous (vue admin), plus récents en premier par date de début. */
export async function getAllAppointments(supabase: TypedSupabaseClient): Promise<AdminAppointment[]> {
  const { data, error } = await supabase.from("appointments").select("*").order("start_at", { ascending: false });
  devWarn("getAllAppointments", error);
  return (data ?? []).map(mapAppointmentRow);
}

/**
 * Rendez-vous intersectant [from, to) — vue calendrier admin : on ne charge
 * QUE la période affichée (directive §11), jamais tout l'historique.
 */
export async function getAppointmentsInRange(
  supabase: TypedSupabaseClient,
  from: Date,
  to: Date,
): Promise<AdminAppointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .lt("start_at", to.toISOString())
    .gt("end_at", from.toISOString())
    .order("start_at", { ascending: true });
  devWarn("getAppointmentsInRange", error);
  return (data ?? []).map(mapAppointmentRow);
}

/**
 * Périodes occupées [from, to) via la RPC neutre `get_busy_ranges`
 * (bornes anonymes uniquement — aucun titre/motif/identité). Repli
 * pré-migration : lectures directes historiques (mêmes données que
 * l'ancien calcul).
 */
export async function getBusyRanges(
  supabase: TypedSupabaseClient,
  from: Date,
  to: Date,
): Promise<{ startAt: string; endAt: string }[]> {
  // @ts-expect-error — RPC ajoutée par la migration 20260726120500, pas encore dans les types générés.
  const { data, error } = await supabase.rpc("get_busy_ranges", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (!error) {
    return ((data ?? []) as { start_at: string; end_at: string }[]).map((r) => ({ startAt: r.start_at, endAt: r.end_at }));
  }
  if (!isMissingRpc(error)) {
    devWarn("getBusyRanges", error);
    return [];
  }
  // Repli pré-migration : mêmes sources que l'ancien getAvailableSlots.
  const [{ data: bookedRows, error: bookedError }, unavailabilities] = await Promise.all([
    supabase
      .from("appointments")
      .select("start_at, end_at, status")
      .in("status", BLOCKING_STATUSES)
      .lt("start_at", to.toISOString())
      .gt("end_at", from.toISOString()),
    getCoachUnavailabilities(supabase),
  ]);
  devWarn("getBusyRanges (repli pré-migration)", bookedError);
  return [
    ...(bookedRows ?? []).map((r) => ({ startAt: r.start_at, endAt: r.end_at })),
    ...unavailabilities
      .filter((u) => new Date(u.startAt).getTime() < to.getTime() && new Date(u.endAt).getTime() > from.getTime())
      .map((u) => ({ startAt: u.startAt, endAt: u.endAt })),
  ];
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

/**
 * Calcule les créneaux disponibles pour les prochains jours.
 *
 * Depuis le chantier "admin-apple-calendar", les périodes occupées viennent
 * de la RPC neutre `get_busy_ranges` (RDV bloquants de TOUS les élèves +
 * événements du coach, sans aucune donnée privée) — même calcul pur
 * (computeAvailableSlots), mêmes règles, même rendu côté élève. Corrige au
 * passage l'angle mort où l'élève ne « voyait » que ses propres RDV comme
 * réservés (RLS) et pouvait donc croire libre un créneau déjà pris.
 */
export async function getAvailableSlots(supabase: TypedSupabaseClient): Promise<AvailableSlot[]> {
  const [availabilities, settings] = await Promise.all([
    getCoachAvailabilities(supabase),
    getBookingSettings(supabase),
  ]);

  const windowStart = new Date();
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + settings.maxDaysAhead + 1);
  const busy = await getBusyRanges(supabase, windowStart, windowEnd);

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
    unavailabilities: [],
    bookedRanges: busy,
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
  /** Qui déclenche la création — "student" (réservation élève, par défaut) ou "coach" (création manuelle admin). */
  actorType?: ActivityActorType;
}

/**
 * Crée un rendez-vous via la RPC transactionnelle `create_appointment_atomic`
 * (verrou consultatif + contrôle de chevauchement inter-tables + contrainte
 * d'exclusion en filet) : deux réservations simultanées du même intervalle ne
 * peuvent jamais réussir toutes les deux. Renvoie l'id créé et, en cas de
 * refus, si la cause est un conflit de créneau.
 */
export async function createAppointmentAtomic(
  supabase: TypedSupabaseClient,
  input: CreateAppointmentInput,
): Promise<AtomicWriteResult> {
  const icsUid = `${crypto.randomUUID()}@seth-coaching`;
  // @ts-expect-error — RPC ajoutée par la migration 20260726121000, pas encore dans les types générés.
  const { data, error } = await supabase.rpc("create_appointment_atomic", {
    p_student_id: input.studentId,
    p_title: input.title,
    p_description: input.description,
    p_appointment_type: input.appointmentType,
    p_start_at: input.startAt,
    p_end_at: input.endAt,
    p_location: input.location,
    p_meeting_url: input.meetingUrl,
    p_ics_uid: icsUid,
    p_status: input.status ?? "confirmed",
  });
  let id: string | null = (data as string | null) ?? null;
  if (error) {
    if (isConflictError(error)) return { id: null, conflict: true };
    if (!isMissingRpc(error)) {
      devWarn("createAppointmentAtomic", error);
      return { id: null, conflict: false };
    }
    // Repli pré-migration : INSERT historique (deviendra inerte après
    // application — plus aucune policy INSERT sur appointments).
    const { data: row, error: insertError } = await supabase
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
    devWarn("createAppointment (repli pré-migration)", insertError);
    id = row?.id ?? null;
  }
  if (id) {
    await logActivityEvent(supabase, {
      studentId: input.studentId,
      actorType: input.actorType ?? "student",
      eventType: "appointment_booked",
      title: "Rendez-vous réservé",
      description: `${input.appointmentType} le ${new Date(input.startAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.`,
      metadata: buildStudentActivityLink(input.studentId),
    });
  }
  return { id, conflict: false };
}

/** Compat : même signature qu'avant le chantier calendrier (réservation élève, page /rendez-vous inchangée). */
export async function createAppointment(supabase: TypedSupabaseClient, input: CreateAppointmentInput): Promise<string | null> {
  return (await createAppointmentAtomic(supabase, input)).id;
}

export async function cancelAppointment(
  supabase: TypedSupabaseClient,
  id: string,
  reason: string,
  studentId: string | null = null,
  actorType: ActivityActorType = "student",
): Promise<boolean> {
  // @ts-expect-error — RPC ajoutée par la migration 20260726121000, pas encore dans les types générés.
  const { data, error: rpcError } = await supabase.rpc("cancel_appointment_atomic", { p_appointment_id: id, p_reason: reason });
  let error: { message: string; code?: string } | null = null;
  if (rpcError) {
    if (!isMissingRpc(rpcError)) {
      error = rpcError;
    } else {
      // Repli pré-migration : UPDATE historique.
      const { error: updateError } = await supabase
        .from("appointments")
        .update({ status: "cancelled", cancellation_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", id);
      error = updateError;
    }
  } else if (data !== true) {
    error = { message: "cancel_appointment_atomic : rendez-vous introuvable" };
  }
  devWarn("cancelAppointment", error);
  if (!error && studentId) {
    await logActivityEvent(supabase, {
      studentId,
      actorType,
      eventType: "appointment_cancelled",
      title: "Rendez-vous annulé",
      description: reason ? `Rendez-vous annulé : ${reason}` : "Rendez-vous annulé.",
      metadata: buildStudentActivityLink(studentId),
    });
  }
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
  // RPC transactionnelle : annulation de l'original + contrôle de conflit +
  // création du nouveau dans UNE transaction (l'implémentation historique en
  // deux requêtes séparées pouvait laisser un état incohérent).
  // @ts-expect-error — RPC ajoutée par la migration 20260726121000, pas encore dans les types générés.
  const { data, error } = await supabase.rpc("reschedule_appointment_atomic", {
    p_appointment_id: appointment.id,
    p_new_start_at: newStartAt,
    p_new_end_at: newEndAt,
    p_ics_uid: icsUid,
  });
  if (!error) return (data as string | null) ?? null;
  if (!isMissingRpc(error)) {
    if (!isConflictError(error)) devWarn("rescheduleAppointment", error);
    return null;
  }
  // Repli pré-migration : séquence historique.
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
  devWarn("rescheduleAppointment (repli insert)", insertError);
  if (!row) {
    return null;
  }
  const { error: cancelError } = await supabase
    .from("appointments")
    .update({ status: "cancelled", cancellation_reason: "Reporté", updated_at: new Date().toISOString() })
    .eq("id", appointment.id);
  devWarn("rescheduleAppointment (repli cancel original)", cancelError);
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
