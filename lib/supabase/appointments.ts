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
export async function getMyCoachPublicInfo(
  supabase: TypedSupabaseClient,
): Promise<{ coachId: string | null; name: string; email: string }> {
  // RPC ajoutée par la migration 20260726220000, pas encore dans les types
  // générés (`Functions: Record<string, never>`) : `data` arrive en `never`,
  // d'où la normalisation explicite ci-dessous.
  const { data, error } = await supabase.rpc("get_my_coach_public_profile");
  devWarn("getMyCoachPublicInfo", error as { message: string } | null);
  const ligne = (Array.isArray(data) ? data[0] : data) as
    | { coach_id?: string | null; first_name?: string | null; last_name?: string | null }
    | null
    | undefined;
  if (!ligne) return { coachId: null, ...DEFAULT_COACH_INFO };
  const nom = [ligne.first_name, ligne.last_name].filter(Boolean).join(" ").trim();
  return { coachId: ligne.coach_id ?? null, name: nom || DEFAULT_COACH_INFO.name, email: "" };
}

/** Coach principal (première fiche `coaches` créée) — utilisé comme organisateur des invitations .ics/emails, faute d'un vrai modèle multi-coach dans l'app (voir docs/supabase-calendar-booking-model.md). RÉSERVÉ au staff et au serveur : un élève lit zéro ligne dans `coaches` depuis la migration 20260726220000, il doit appeler `getMyCoachPublicInfo`. */
export async function getPrimaryCoachInfo(supabase: TypedSupabaseClient): Promise<{ name: string; email: string }> {
  const { data, error } = await supabase.from("coaches").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle();
  devWarn("getPrimaryCoachInfo", error);
  if (!data) return DEFAULT_COACH_INFO;
  return { name: data.name || DEFAULT_COACH_INFO.name, email: data.email || DEFAULT_COACH_INFO.email };
}

/** Identité du coach PROPRIÉTAIRE d'un rendez-vous, telle qu'elle sert d'organisateur. */
export interface CoachProprietaire {
  id: string;
  name: string;
  email: string;
}

/**
 * Coach RÉELLEMENT propriétaire du rendez-vous — lu sur `appointments.coach_id`.
 *
 * ⚠️ C'EST LA SEULE SOURCE DE VÉRITÉ DU PROPRIÉTAIRE, et elle remplace
 * `getPrimaryCoachInfo` partout où un rendez-vous est en jeu (invitations
 * .ics et emails transactionnels, lot 2). `getPrimaryCoachInfo` rend la
 * PREMIÈRE fiche `coaches` créée : correcte par accident tant qu'un seul
 * coach est actif, fausse dès qu'il y en a deux.
 *
 * ⚠️ AUCUN REPLI SUR UN AUTRE COACH. `coach_id` nul ou introuvable rend
 * `null`, et l'appelant doit alors s'abstenir de nommer qui que ce soit
 * (intitulé de secours) plutôt que de désigner un coach arbitraire. Une
 * notification adressée au mauvais coach lui révélerait l'élève d'un
 * confrère.
 *
 * Réservée au SERVEUR : la policy `coaches_select_staff` (migration
 * 20260726220000) ferme `coaches` aux élèves — appelée depuis un navigateur
 * d'élève, cette lecture rendrait zéro ligne. Les deux colonnes lues sont
 * `NOT NULL` d'après types/supabase.ts ; un `email` vide reste possible, et
 * lib/ics.ts omet alors la ligne `ORGANIZER`.
 */
export async function getCoachProprietaireRendezVous(
  supabase: TypedSupabaseClient,
  coachId: string | null,
): Promise<CoachProprietaire | null> {
  if (!coachId) return null;
  const { data, error } = await supabase.from("coaches").select("id, name, email").eq("id", coachId).maybeSingle();
  devWarn("getCoachProprietaireRendezVous", error);
  if (!data) return null;
  return { id: data.id, name: data.name, email: data.email };
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

/*
 * ⚠️ LES MOTIFS DE REFUS SONT UNE LISTE NOMMÉE, PAS UN `catch` FOURRE-TOUT.
 * Avant le lot 1, tout refus de la RPC qui n'était pas un conflit remontait
 * en `{ id: null, conflict: false }` : l'écran affichait « Création
 * impossible. Réessaie. » pour un créneau désactivé comme pour un créneau
 * appartenant à un autre coach. La RPC lève désormais des exceptions
 * distinctes ; chacune a ici son motif et sa phrase.
 */
export const MOTIFS_DE_REFUS = {
  conflit: "Ce créneau vient d'être occupé. Choisis un autre horaire.",
  creneau_requis: "Ce créneau n'est plus identifiable. Recharge la page et réessaie.",
  creneau_introuvable: "Ce créneau n'existe plus. Recharge la page pour voir les disponibilités à jour.",
  creneau_inactif: "Ce créneau n'est plus proposé par ton coach.",
  creneau_sans_proprietaire: "Ce créneau n'est rattaché à aucun coach. Contacte ton coach.",
  creneau_incoherent: "L'horaire demandé ne correspond pas à ce créneau. Recharge la page et réessaie.",
  droit_refuse: "Ce créneau n'est pas proposé par ton coach.",
  identite_eleve_requise: "Cette réservation doit être faite depuis un compte élève.",
  staff_requis: "Seul un membre du staff peut créer manuellement une séance.",
  /*
   * ⚠️ CES DEUX MOTIFS NE VIENNENT PAS DE LA NOUVELLE APPLICATION. Ils sont
   * levés par l'ancienne RPC que M1 conserve en garde-fou, et un onglet resté
   * ouvert sur l'ancienne page `/rendez-vous` les déclenchera pendant la
   * fenêtre de bascule. Sans eux, l'élève lirait « Création impossible.
   * Réessaie. » et recliquerait indéfiniment : le message doit lui dire de
   * recharger.
   */
  parcours_obsolete: "Cette page n'est plus à jour. Recharge-la pour réserver.",
  identite_ambigue: "Ton compte porte deux identités (élève et coach) : contacte ton coach pour réserver.",
  proprietaire_indetermine:
    "Aucun coach ne peut être désigné pour cette séance. Vérifie le rattachement de l'élève.",
  autre: "Création impossible. Réessaie.",
} satisfies Record<string, string>;

export type MotifDeRefus = keyof typeof MOTIFS_DE_REFUS;

/*
 * ⚠️ L'ORDRE DE CETTE LISTE EST SIGNIFIANT : le premier fragment trouvé dans
 * le message gagne. `calendar_slot_not_found` contient `calendar_slot`, donc
 * les motifs les plus précis viennent d'abord.
 */
const FRAGMENTS_DE_REFUS: readonly { readonly fragment: string; readonly motif: MotifDeRefus }[] = [
  { fragment: "calendar_conflict", motif: "conflit" },
  { fragment: "calendar_slot_required", motif: "creneau_requis" },
  { fragment: "calendar_slot_not_found", motif: "creneau_introuvable" },
  { fragment: "calendar_slot_inactive", motif: "creneau_inactif" },
  { fragment: "calendar_slot_unowned", motif: "creneau_sans_proprietaire" },
  { fragment: "calendar_slot_mismatch", motif: "creneau_incoherent" },
  { fragment: "calendar_slot_forbidden", motif: "droit_refuse" },
  { fragment: "calendar_owner_unresolved", motif: "proprietaire_indetermine" },
  { fragment: "calendar_student_required", motif: "identite_eleve_requise" },
  { fragment: "calendar_staff_required", motif: "staff_requis" },
  { fragment: "calendar_identite_ambigue", motif: "identite_ambigue" },
  { fragment: "calendar_parcours_obsolete", motif: "parcours_obsolete" },
  { fragment: "calendar_not_allowed", motif: "droit_refuse" },
];

/** Traduit l'erreur PostgreSQL remontée par PostgREST en motif métier nommé. */
export function motifDeRefus(error: { code?: string; message: string } | null): MotifDeRefus {
  if (!error) return "autre";
  if (error.code === "23P01") return "conflit";
  for (const { fragment, motif } of FRAGMENTS_DE_REFUS) {
    if (error.message.includes(fragment)) return motif;
  }
  return "autre";
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
  /** Motif nommé du refus, `null` en cas de succès. Voir `MOTIFS_DE_REFUS`. */
  motif: MotifDeRefus | null;
}

/** Événement personnel/professionnel de l'admin — contrôle de conflit STRICT côté serveur. */
export async function createCoachEventAtomic(
  supabase: TypedSupabaseClient,
  input: CoachEventInput,
): Promise<AtomicWriteResult> {
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
    return { id: null, conflict: isConflictError(error), motif: motifDeRefus(error) };
  }
  return { id: (data as string | null) ?? null, conflict: false, motif: null };
}

/** Modification (déplacement/durée/contenu) d'un événement du coach — même contrôle strict. */
export async function updateCoachEventAtomic(
  supabase: TypedSupabaseClient,
  id: string,
  input: Omit<CoachEventInput, "category">,
): Promise<AtomicWriteResult> {
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
    return { id: null, conflict: isConflictError(error), motif: motifDeRefus(error) };
  }
  return { id: data === true ? id : null, conflict: false, motif: null };
}

export async function deleteCoachUnavailability(supabase: TypedSupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("coach_unavailabilities").delete().eq("id", id);
  devWarn("deleteCoachUnavailability", error);
  return !error;
}

/* ─── Réglages de réservation ─── */

/**
 * Réglages de réservation de L'APPELANT.
 *
 * ⚠️ IL N'Y EN AVAIT QU'UN, POUR TOUT LE MONDE. `booking_settings` ne portait
 * aucune colonne de propriétaire : la première ligne créée servait au cabinet
 * entier, et un coach qui changeait son délai de prévenance changeait celui de
 * l'administrateur. La migration 20261022090000 ajoute `coach_id` (nullable)
 * et borne les policies ; cette fonction choisit la bonne ligne.
 *
 * La RLS ne laisse voir que SA ligne et le DÉFAUT DU CABINET (`coach_id`
 * NULL) : on préfère donc la sienne, et on retombe sur le défaut tant qu'il
 * n'en a pas. Aucun filtre `coach_id` envoyé depuis le navigateur — ce serait
 * déclaratif, donc faux par construction.
 */
export async function getBookingSettings(supabase: TypedSupabaseClient): Promise<BookingSettings> {
  const { data, error } = await supabase
    .from("booking_settings")
    .select("*")
    .order("created_at", { ascending: true });
  devWarn("getBookingSettings", error);
  const lignes = data ?? [];
  const sienne = lignes.find((ligne) => ligne.coach_id !== null);
  const defaut = lignes.find((ligne) => ligne.coach_id === null);
  const retenue = sienne ?? defaut ?? null;
  return retenue ? mapBookingSettingsRow(retenue) : DEFAULT_BOOKING_SETTINGS;
}

/**
 * Enregistre les réglages de réservation de l'appelant.
 *
 * ⚠️ TROIS CAS, ET LE PLUS IMPORTANT EST LE TROISIÈME.
 *   · il a déjà SA ligne              → on la met à jour ;
 *   · c'est l'administrateur          → il met à jour le DÉFAUT DU CABINET,
 *                                       exactement comme avant ce lot ;
 *   · c'est un coach sans ligne       → on CRÉE la sienne, à partir des
 *                                       valeurs du défaut.
 *
 * ⚠️ `coach_id` N'EST PAS ENVOYÉ. Le déclencheur `poser_proprietaire_staff`
 * le pose à `current_staff_id()`, et le `with check` de la policy refuse toute
 * autre valeur : un coach ne peut pas créer les réglages d'un autre, même en
 * forgeant la requête PostgREST.
 */
export async function saveMyBookingSettings(
  supabase: TypedSupabaseClient,
  partial: Partial<Omit<BookingSettings, "id">>,
): Promise<boolean> {
  const { data, error: lectureError } = await supabase
    .from("booking_settings")
    .select("*")
    .order("created_at", { ascending: true });
  devWarn("saveMyBookingSettings (lecture)", lectureError);
  const lignes = data ?? [];
  const sienne = lignes.find((ligne) => ligne.coach_id !== null) ?? null;
  const defaut = lignes.find((ligne) => ligne.coach_id === null) ?? null;

  const champs: Database["public"]["Tables"]["booking_settings"]["Update"] = { updated_at: new Date().toISOString() };
  if (partial.minLeadMinutes !== undefined) champs.min_lead_minutes = partial.minLeadMinutes;
  if (partial.maxDaysAhead !== undefined) champs.max_days_ahead = partial.maxDaysAhead;
  if (partial.defaultDurationMinutes !== undefined) champs.default_duration_minutes = partial.defaultDurationMinutes;

  if (sienne) {
    const { error } = await supabase.from("booking_settings").update(champs).eq("id", sienne.id);
    devWarn("saveMyBookingSettings (sienne)", error);
    return !error;
  }

  const { data: estAdmin } = await supabase.rpc("is_admin");
  if (estAdmin === true && defaut) {
    const { error } = await supabase.from("booking_settings").update(champs).eq("id", defaut.id);
    devWarn("saveMyBookingSettings (défaut du cabinet)", error);
    return !error;
  }

  const base = defaut ? mapBookingSettingsRow(defaut) : DEFAULT_BOOKING_SETTINGS;
  const { error } = await supabase.from("booking_settings").insert({
    min_lead_minutes: partial.minLeadMinutes ?? base.minLeadMinutes,
    max_days_ahead: partial.maxDaysAhead ?? base.maxDaysAhead,
    default_duration_minutes: partial.defaultDurationMinutes ?? base.defaultDurationMinutes,
  });
  devWarn("saveMyBookingSettings (création)", error);
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
      id: a.id,
      coachId: a.coachId,
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

/** Entrée de la RÉSERVATION AUTONOME par un élève. */
export interface ReservationEleveInput {
  /**
   * Disponibilité réservée — OBLIGATOIRE, c'est tout ce que le navigateur
   * désigne. Ni élève, ni coach : la RPC prend l'élève sur la session
   * (`current_student_id()`) et le coach sur la disponibilité qu'elle relit.
   */
  availabilityId: string;
  startAt: string;
  endAt: string;
}

/** Entrée de la CRÉATION MANUELLE par le staff. */
export interface CreateAppointmentInput {
  /** `null` pour une séance sans élève (l'agenda propre de l'auteur). */
  studentId: string | null;
  title: string;
  description: string;
  appointmentType: string;
  startAt: string;
  endAt: string;
  location: string;
  meetingUrl: string;
  status?: AppointmentStatus;
  /** Qui déclenche la création, pour le journal d'activité. */
  actorType?: ActivityActorType;
}

/*
 * ⚠️ DEUX FONCTIONS, PARCE QU'IL Y A DEUX INTENTIONS.
 * `createAppointmentAtomic` appelait une RPC unique qui choisissait son
 * comportement avec un discriminant serveur (`current_staff_id() is not null`,
 * puis `… or is_admin()`). Une personne portant à la fois une fiche `coaches`
 * et une fiche `students` — rien ne l'interdit, les deux tables référencent
 * `auth.users` — entrait donc dans la branche staff en réservant depuis son
 * espace élève, et échappait à TOUTE validation de disponibilité.
 *
 * Le point d'entrée porte désormais l'intention, et chaque RPC revérifie
 * l'identité côté serveur : `reserver_creneau_eleve` exige
 * `current_student_id()` et une disponibilité ; `creer_rendez_vous_staff`
 * exige d'être staff. Aucun `actorType` ne quitte le navigateur vers le SQL —
 * il n'a jamais servi qu'au journal, et c'est tout ce qu'il fait encore.
 */

/**
 * Journalise une création de rendez-vous en relisant l'élève SUR LE RENDEZ-VOUS
 * EFFECTIVEMENT CRÉÉ.
 *
 * ⚠️ L'IDENTITÉ JOURNALISÉE NE VIENT PLUS DU NAVIGATEUR. Les deux parcours
 * transmettaient un identifiant d'élève au seul usage du journal. Vérifié le
 * 15/11/2026 : ce n'était pas une faille — les deux policies INSERT de
 * `activity_events` (`activity_events_insert_own_student` et
 * `activity_events_student_insert_own`) lient `student_id` à la fiche de
 * l'appelant, donc une valeur falsifiée était REFUSÉE, jamais écrite dans
 * l'historique d'un tiers. Mais c'était une valeur d'identité venue du client,
 * sans raison d'exister : la RPC connaît déjà l'élève, et le rendez-vous le
 * porte.
 *
 * ⚠️ ET LE JOURNAL RESTE BEST-EFFORT. Une relecture qui échoue ne journalise
 * rien et n'annule rien ; un rendez-vous sans élève (séance d'agenda du staff)
 * ne produit simplement aucune ligne. Même principe que `logActivityEvent`,
 * qui avale déjà ses propres erreurs : jamais bloquant.
 */
async function journaliserRendezVousCree(
  supabase: TypedSupabaseClient,
  appointmentId: string,
  actorType: ActivityActorType,
  description: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("appointments")
    .select("student_id")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) {
    devWarn("journaliserRendezVousCree (relecture de l'élève)", error);
    return;
  }
  const studentId = data?.student_id ?? null;
  if (!studentId) return;
  await logActivityEvent(supabase, {
    studentId,
    actorType,
    eventType: "appointment_booked",
    title: "Rendez-vous réservé",
    description,
    metadata: buildStudentActivityLink(studentId),
  });
}

/**
 * Réservation autonome d'un créneau par l'élève connecté.
 *
 * La RPC `reserver_creneau_eleve` (migration 20261115090000) prend le verrou
 * consultatif, verrouille la disponibilité puis la ligne élève en `for share`,
 * valide jour/horaire/durée/grille/propriétaire sur ces lignes verrouillées,
 * et insère dans la même transaction.
 */
export async function reserverCreneauEleve(
  supabase: TypedSupabaseClient,
  input: ReservationEleveInput,
): Promise<AtomicWriteResult> {
  const icsUid = `${crypto.randomUUID()}@seth-coaching`;
  const { data, error } = await supabase.rpc("reserver_creneau_eleve", {
    p_availability_id: input.availabilityId,
    p_start_at: input.startAt,
    p_end_at: input.endAt,
    p_ics_uid: icsUid,
  });
  if (error) {
    if (isConflictError(error)) return { id: null, conflict: true, motif: "conflit" };
    const motif = motifDeRefus(error);
    // ⚠️ UN REFUS MÉTIER N'EST PAS UNE PANNE. On ne journalise que ce qui n'a
    // pas de motif nommé, sinon la console se remplit de refus normaux.
    if (motif === "autre") devWarn("reserverCreneauEleve", error);
    return { id: null, conflict: false, motif };
  }
  const id: string | null = (data as string | null) ?? null;
  if (id) {
    await journaliserRendezVousCree(
      supabase,
      id,
      "student",
      `Créneau réservé le ${new Date(input.startAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.`,
    );
  }
  return { id, conflict: false, motif: id ? null : "autre" };
}

/**
 * Création manuelle d'un rendez-vous par le staff (horaire libre, hors de
 * toute disponibilité récurrente).
 *
 * Le propriétaire n'est jamais l'auteur de l'action : la RPC le déduit du
 * coach titulaire de l'élève, ou — pour une séance sans élève — de la fiche de
 * l'auteur s'il en a une de rôle `admin`/`assistant`.
 */
export async function creerRendezVousStaff(
  supabase: TypedSupabaseClient,
  input: CreateAppointmentInput,
): Promise<AtomicWriteResult> {
  const icsUid = `${crypto.randomUUID()}@seth-coaching`;
  const { data, error } = await supabase.rpc("creer_rendez_vous_staff", {
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
    if (isConflictError(error)) return { id: null, conflict: true, motif: "conflit" };
    if (!isMissingRpc(error)) {
      const motif = motifDeRefus(error);
      if (motif === "autre") devWarn("creerRendezVousStaff", error);
      return { id: null, conflict: false, motif };
    }
    // Repli pré-migration : INSERT historique (inerte après application —
    // plus aucune policy INSERT sur appointments). Conservé tel quel.
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
    devWarn("creerRendezVousStaff (repli pré-migration)", insertError);
    id = row?.id ?? null;
  }
  if (id) {
    // ⚠️ MÊME SOURCE DE VÉRITÉ QUE LA PORTE ÉLÈVE. `input.studentId` est
    // vérifié par la RPC pour l'autorisation ET pour l'attribution, donc il
    // est contrôlé côté serveur — mais faire reposer les deux parcours sur la
    // même relecture évite d'avoir deux règles à tenir à jour, et couvre sans
    // cas particulier la séance sans élève.
    await journaliserRendezVousCree(
      supabase,
      id,
      input.actorType ?? "coach",
      `${input.appointmentType} le ${new Date(input.startAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.`,
    );
  }
  return { id, conflict: false, motif: id ? null : "autre" };
}

export async function cancelAppointment(
  supabase: TypedSupabaseClient,
  id: string,
  reason: string,
  studentId: string | null = null,
  actorType: ActivityActorType = "student",
): Promise<boolean> {
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
  /**
   * Facultatives : la route d'envoi relit le coach principal en base avec le
   * service role et ignore ce qui vient du navigateur — voir
   * `AppointmentEmailContext` dans lib/email/appointment-emails.ts. L'espace
   * élève les renseigne pour son propre affichage ; l'espace admin ne les
   * renseigne plus, pour ne pas avoir à lire `coaches` côté navigateur.
   */
  coachName?: string;
  coachEmail?: string;
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
