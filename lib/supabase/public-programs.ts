import type { SupabaseClient } from "@supabase/supabase-js";

import type { PublicProgramSummary } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Lecture du catalogue public de programmes (chantier module Programmation,
 * étape 6) : uniquement les programmes marqués `is_public = true`, avec les
 * champs marketing (nom, objectif, description, niveau, durée, bannière,
 * prix) — jamais le détail séance/exercice, réservé aux élèves assignés +
 * staff (RLS `programs_select_assigned_student` / `programs_manage_staff`,
 * inchangées). Utilisable avec le client anonyme (visiteur non connecté,
 * RLS `programs_select_public` + `subscription_templates_select_active_or_staff`)
 * comme avec un client staff.
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

/** Tous les programmes publics — bibliothèque /programmes et sections home page. */
export async function getPublicPrograms(supabase: TypedSupabaseClient): Promise<PublicProgramSummary[]> {
  const { data, error } = await supabase
    .from("programs")
    .select(PUBLIC_PROGRAM_SELECT)
    .eq("is_public", true)
    .order("created_at", { ascending: false });
  if (error) {
    console.error(`[Supabase] getPublicPrograms : ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as PublicProgramRow[]).map(mapPublicProgramRow);
}

/** Un programme public par id — page détail /programmes/[id]. `null` si introuvable ou non public. */
export async function getPublicProgramById(supabase: TypedSupabaseClient, id: string): Promise<PublicProgramSummary | null> {
  const { data, error } = await supabase.from("programs").select(PUBLIC_PROGRAM_SELECT).eq("id", id).eq("is_public", true).maybeSingle();
  if (error) {
    console.error(`[Supabase] getPublicProgramById : ${error.message}`);
    return null;
  }
  return data ? mapPublicProgramRow(data as unknown as PublicProgramRow) : null;
}
