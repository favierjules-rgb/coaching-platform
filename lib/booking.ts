import type { AppointmentType, AvailableSlot, Weekday } from "@/types";

/**
 * Calcul des créneaux disponibles — fonction pure (aucun accès Supabase ici,
 * voir lib/supabase/appointments.ts pour le chargement des données). Prend
 * en entrée les disponibilités récurrentes, les indisponibilités ponctuelles
 * et les rendez-vous déjà réservés (pending/confirmed uniquement — un
 * rendez-vous annulé libère le créneau), et retourne la liste des créneaux
 * réellement proposables, triés chronologiquement.
 *
 * Fuseau horaire : toutes les dates sont manipulées en heure locale du
 * navigateur/serveur d'exécution, considérée comme Europe/Paris pour cette
 * application (aucune bibliothèque de fuseaux horaires dans le projet,
 * même limite assumée que ADMIN_REFERENCE_DATE/computeDocumentAvailability
 * ailleurs dans le code) — voir docs/supabase-calendar-booking-model.md.
 */

export interface AvailabilityForSlots {
  weekday: Weekday;
  startTime: string; // "HH:mm" ou "HH:mm:ss"
  endTime: string;
  slotDurationMinutes: number;
  appointmentType: AppointmentType;
  location: string;
  isActive: boolean;
}

export interface TimeRange {
  startAt: string;
  endAt: string;
}

export interface ComputeAvailableSlotsParams {
  availabilities: AvailabilityForSlots[];
  unavailabilities: TimeRange[];
  /** Rendez-vous déjà réservés (status pending/confirmed) qui bloquent un créneau. */
  bookedRanges: TimeRange[];
  minLeadMinutes: number;
  maxDaysAhead: number;
  /** Injectable pour les tests ; par défaut l'heure réelle actuelle. */
  now?: Date;
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map((part) => Number.parseInt(part, 10));
  return (h || 0) * 60 + (m || 0);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Construit un Date à minuit local pour un jour donné, en ajoutant `dayOffset` jours à `base`. */
function dayAt(base: Date, dayOffset: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + dayOffset);
  return d;
}

export function computeAvailableSlots(params: ComputeAvailableSlotsParams): AvailableSlot[] {
  const now = params.now ?? new Date();
  const earliestBookableAt = new Date(now.getTime() + params.minLeadMinutes * 60_000);

  const unavailabilityRanges = params.unavailabilities.map((u) => ({
    start: new Date(u.startAt).getTime(),
    end: new Date(u.endAt).getTime(),
  }));
  const bookedRangesMs = params.bookedRanges.map((b) => ({
    start: new Date(b.startAt).getTime(),
    end: new Date(b.endAt).getTime(),
  }));

  const activeAvailabilities = params.availabilities.filter((a) => a.isActive);
  const slots: AvailableSlot[] = [];

  for (let dayOffset = 0; dayOffset <= params.maxDaysAhead; dayOffset += 1) {
    const day = dayAt(now, dayOffset);
    const weekday = day.getDay() as Weekday; // 0 dimanche .. 6 samedi, même convention que la colonne `weekday`

    for (const availability of activeAvailabilities) {
      if (availability.weekday !== weekday) continue;

      const startMinutes = parseTimeToMinutes(availability.startTime);
      const endMinutes = parseTimeToMinutes(availability.endTime);
      const duration = availability.slotDurationMinutes;
      if (duration <= 0 || endMinutes <= startMinutes) continue;

      for (let slotStart = startMinutes; slotStart + duration <= endMinutes; slotStart += duration) {
        const slotStartAt = new Date(day);
        slotStartAt.setMinutes(slotStart);
        const slotEndAt = new Date(slotStartAt.getTime() + duration * 60_000);

        if (slotStartAt < earliestBookableAt) continue;
        if (slotStartAt < now) continue;

        const slotStartMs = slotStartAt.getTime();
        const slotEndMs = slotEndAt.getTime();

        const blockedByUnavailability = unavailabilityRanges.some((u) =>
          rangesOverlap(slotStartMs, slotEndMs, u.start, u.end),
        );
        if (blockedByUnavailability) continue;

        const blockedByBooking = bookedRangesMs.some((b) => rangesOverlap(slotStartMs, slotEndMs, b.start, b.end));
        if (blockedByBooking) continue;

        slots.push({
          startAt: slotStartAt.toISOString(),
          endAt: slotEndAt.toISOString(),
          appointmentType: availability.appointmentType,
          location: availability.location,
        });
      }
    }
  }

  return slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Regroupe une liste de créneaux triés par jour calendaire (clé "YYYY-MM-DD" en heure locale). */
export function groupSlotsByDay(slots: AvailableSlot[]): Map<string, AvailableSlot[]> {
  const map = new Map<string, AvailableSlot[]>();
  for (const slot of slots) {
    const date = new Date(slot.startAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const list = map.get(key);
    if (list) {
      list.push(slot);
    } else {
      map.set(key, [slot]);
    }
  }
  return map;
}
