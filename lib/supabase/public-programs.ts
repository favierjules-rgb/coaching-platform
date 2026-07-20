import type { SupabaseClient } from "@supabase/supabase-js";

import type { PublicProgramSummary, PublicProgramsResult } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Lecture du catalogue public de programmes (chantier module Programmation,
 * étape 6) : uniquement les programmes marqués `is_public = true` ET
 * `status = 'actif'` (correctif : un programme archivé ou encore en
 * brouillon ne doit jamais rester achetable depuis la home page, même s'il
 * a été publié un jour — voir aussi la policy RLS `programs_select_public`,
 * mise à jour en miroir), avec les champs marketing (nom, objectif,
 * description, niveau, durée, bannière, prix) — jamais le détail séance/
 * exercice, réservé aux élèves assignés + staff (RLS
 * `programs_select_assigned_student` / `programs_manage_staff`, inchangées).
 * Utilisable avec le client anonyme (visiteur non connecté, RLS
 * `programs_select_public` + `subscription_templates_select_active_or_staff`)
 * comme avec un client staff.
 *
 * Correctif chantier /programmes (juillet 2026) : `getPublicPrograms`
 * renvoie désormais un `PublicProgramsResult` typé (voir types/index.ts) au
 * lieu d'un simple tableau — un succès (avec ou sans programme) n'est plus
 * jamais confondu avec un échec de récupération. Une seule nouvelle
 * tentative est effectuée quand l'appel réseau lève une exception (erreur
 * transitoire probable) ; une erreur métier renvoyée par Supabase dans
 * `{ error }` (RLS, requête invalide, etc.) est en revanche définitive :
 * jamais retentée, jamais masquée en tableau vide.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

interface PublicProgramRow {
  id: string;
  name: string;
  goal: string;
  description: string;
  level: string;
  duration_weeks: number;
  banner_url: string | null;
  public_subscription_template_id: string | null;
  subscription_templates: { amount_cents: number; currency: string } | { amount_cents: number; currency: string }[] | null;
}

function mapPublicProgramRow(row: PublicProgramRow): PublicProgramSummary {
  const template = Array.isArray(row.subscription_templates) ? row.subscription_templates[0] : row.subscription_templates;
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    description: row.description,
    level: row.level,
    durationWeeks: row.duration_weeks,
    bannerUrl: row.banner_url,
    priceCents: row.public_subscription_template_id ? (template?.amount_cents ?? null) : null,
    currency: template?.currency ?? "eur",
  };
}

const PUBLIC_PROGRAM_SELECT =
  "id, name, goal, description, level, duration_weeks, banner_url, public_subscription_template_id, subscription_templates(amount_cents, currency)";

function fetchPublicPrograms(supabase: TypedSupabaseClient) {
  return supabase
    .from("programs")
    .select(PUBLIC_PROGRAM_SELECT)
    .eq("is_public", true)
    .eq("status", "actif")
    .order("created_at", { ascending: false });
}

const PUBLIC_PROGRAMS_ERROR_MESSAGE = "Impossible de charger les programmes pour le moment.";

/**
 * Tous les programmes publics — bibliothèque /programmes et sections home
 * page. Voir le commentaire en tête de fichier : succès (vide ou non) et
 * erreur sont désormais deux issues explicitement distinctes.
 */
export async function getPublicPrograms(supabase: TypedSupabaseClient): Promise<PublicProgramsResult> {
  let response: Awaited<ReturnType<typeof fetchPublicPrograms>>;

  try {
    response = await fetchPublicPrograms(supabase);
  } catch {
    // Exception levée par l'appel réseau lui-même (pas une erreur métier
    // renvoyée par Supabase) : erreur transitoire probable, une seule
    // nouvelle tentative, jamais de boucle.
    try {
      response = await fetchPublicPrograms(supabase);
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      console.error(`[Supabase] getPublicPrograms (réseau, après nouvelle tentative) : ${message}`);
      return { status: "error", message: PUBLIC_PROGRAMS_ERROR_MESSAGE };
    }
  }

  const { data, error } = response;
  if (error) {
    // Erreur métier renvoyée par Supabase (RLS, requête invalide, etc.) :
    // définitive, jamais retentée, jamais masquée en tableau vide.
    console.error(`[Supabase] getPublicPrograms : ${error.message}`);
    return { status: "error", message: PUBLIC_PROGRAMS_ERROR_MESSAGE };
  }

  return {
    status: "success",
    programs: ((data ?? []) as unknown as PublicProgramRow[]).map(mapPublicProgramRow),
  };
}

/** Un programme public par id — page détail /programmes/[id]. `null` si introuvable, non public ou pas actif. */
export async function getPublicProgramById(supabase: TypedSupabaseClient, id: string): Promise<PublicProgramSummary | null> {
  const { data, error } = await supabase
    .from("programs")
    .select(PUBLIC_PROGRAM_SELECT)
    .eq("id", id)
    .eq("is_public", true)
    .eq("status", "actif")
    .maybeSingle();
  if (error) {
    console.error(`[Supabase] getPublicProgramById : ${error.message}`);
    return null;
  }
  return data ? mapPublicProgramRow(data as unknown as PublicProgramRow) : null;
}
