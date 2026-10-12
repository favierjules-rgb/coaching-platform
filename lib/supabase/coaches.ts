import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminCoach } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès à la table Supabase `coaches` — liste des collaborateurs
 * admin/coach affichés sur /admin/parametres (section "Coachs"). Avant ce
 * chantier, cette section était 100% mockée (localStorage, useAdminData) ;
 * la table `coaches` existait déjà dans le schéma (avec RLS déjà en place :
 * `coaches_select_authenticated` en lecture, `coaches_manage_admin` en
 * écriture pour is_coach_or_admin()) mais n'était jamais alimentée.
 *
 * La lecture (`getCoaches`) et l'auto-provisioning de sa propre ligne
 * (`ensureSelfCoachRow`) passent par un client de session classique (RLS
 * suffisante, pas besoin de service role) — même principe que
 * lib/supabase/students.ts::getStudents. La création d'un NOUVEAU
 * collaborateur (compte auth.users + email d'invitation) et la suppression
 * réelle d'un compte restent server-only, service role : voir
 * lib/supabase/coach-account-provisioning.ts.
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type CoachRow = Database["public"]["Tables"]["coaches"]["Row"];

function devWarn(context: string, error: { message: string; code?: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}`);
  }
}

/** Découpage best-effort "Prénom Nom" -> {firstName, lastName} (la table ne stocke qu'un champ `name`). */
function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1) };
}

function mapCoachRow(row: CoachRow): AdminCoach {
  const { firstName, lastName } = splitName(row.name);
  return {
    id: row.id,
    userId: row.user_id,
    firstName,
    lastName,
    email: row.email,
    role: row.role,
    status: row.status,
    speciality: row.specialty,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCoaches(supabase: TypedSupabaseClient): Promise<AdminCoach[]> {
  const { data, error } = await supabase.from("coaches").select("*").order("created_at", { ascending: true });
  devWarn("getCoaches", error);
  return (data ?? []).map(mapCoachRow);
}

/**
 * Mise à jour d'une fiche coach existante (nom, rôle affiché, spécialité,
 * statut) — jamais l'email, qui resterait désynchronisé du vrai compte
 * `auth.users` sans re-provisioning complet (hors périmètre ici). Passe par
 * un client de session classique : la policy RLS `coaches_manage_admin`
 * (ALL, is_coach_or_admin()) autorise déjà l'écriture, pas besoin de
 * service role pour un simple UPDATE de données déjà présentes.
 */
export async function updateCoach(
  supabase: TypedSupabaseClient,
  coachId: string,
  partial: { firstName: string; lastName: string; role: AdminCoach["role"]; status: AdminCoach["status"]; speciality: string },
): Promise<boolean> {
  const { error } = await supabase
    .from("coaches")
    .update({
      name: `${partial.firstName} ${partial.lastName}`.trim(),
      role: partial.role,
      status: partial.status,
      specialty: partial.speciality,
    })
    .eq("id", coachId);
  devWarn("updateCoach", error);
  return !error;
}

/**
 * Garantit qu'une ligne `coaches` existe pour l'ADMINISTRATEUR actuellement
 * connecté — aucune ligne n'était jamais créée avant ce chantier (table vide
 * en production, y compris pour le compte principal de Jules). Sans cette
 * étape : (a) impossible d'identifier "mon profil" pour le protéger contre
 * l'auto-suppression dans l'UI, (b) getPrimaryCoachInfo
 * (lib/supabase/appointments.ts, utilisé par les emails envoyés aux élèves)
 * retombait sur un nom/email par défaut plutôt que les vraies coordonnées du
 * coach. Non bloquant : erreurs journalisées, jamais levées.
 *
 * ---------------------------------------------------------------------
 * POURQUOI L'ADMINISTRATEUR, ET LUI SEUL (P13-B, 11/10/2026)
 * ---------------------------------------------------------------------
 * Les deux requêtes sur `coaches` sont réservées à l'administrateur par la
 * RLS : `coaches_manage_admin_select` / `coaches_manage_admin_insert`
 * opposent `is_admin()`, c'est-à-dire exactement
 * `profiles.role = 'admin'` (migration 20260726220000). Pour un assistant ou
 * un collaborateur, la version précédente faisait donc :
 *
 *   1. un `select` qui renvoyait zéro ligne — non parce qu'aucune fiche
 *      n'existe, mais parce qu'il n'a pas le droit de la voir ;
 *   2. puis, trompée par ce vide, un `insert` refusé (42501), journalisé en
 *      erreur à CHAQUE chargement de /admin/parametres.
 *
 * Le rôle est donc lu D'ABORD, dans `profiles` — la seule table que tout le
 * monde peut lire pour sa propre ligne — et rien n'est tenté sur `coaches`
 * si l'appelant n'est pas administrateur. Aucun contournement par service
 * role : la fonction tourne avec un client de session, et renonce quand elle
 * n'a pas les droits, au lieu de les emprunter.
 *
 * Ce que cela ne casse pas : un assistant ou un collaborateur créé depuis
 * /admin/parametres a DÉJÀ sa ligne `coaches`, écrite par
 * `createCoachAccount` (service role, au moment de l'invitation). Cette
 * fonction ne servait qu'au compte principal historique, antérieur au
 * remplissage de la table.
 */
export async function ensureSelfCoachRow(supabase: TypedSupabaseClient): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("first_name, last_name, email, role")
    .eq("user_id", user.id)
    .maybeSingle();
  devWarn("ensureSelfCoachRow (profile)", profileError);
  // `is_admin()` = `profiles.role = 'admin'`. Tout autre rôle n'a aucun droit
  // sur `coaches` : ni lecture, ni écriture, pas même pour sa propre ligne.
  if (profile?.role !== "admin") return;

  const { data: existing, error: existingError } = await supabase
    .from("coaches")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  devWarn("ensureSelfCoachRow (lookup)", existingError);
  if (existing) return;

  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || (user.email ?? "").split("@")[0];
  const email = profile.email || user.email || "";

  const { error: insertError } = await supabase.from("coaches").insert({
    user_id: user.id,
    name: name || "Coach",
    email,
    role: "admin",
    status: "actif",
    specialty: "",
  });
  devWarn("ensureSelfCoachRow (insert)", insertError);
}
