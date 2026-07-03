import "server-only";

import type { User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthProfile, UserRole } from "@/types";

/**
 * Utilisateur Supabase actuellement connecté (Server Components / Server
 * Actions / Route Handlers uniquement). Renvoie `null` si Supabase n'est
 * pas configuré ou si personne n'est connecté — jamais d'erreur bloquante,
 * à l'appelant de décider quoi faire (voir lib/supabase/guards.ts).
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return data.user;
}

/**
 * Ligne `profiles` correspondant à un user_id donné. Renvoie `null` si
 * Supabase n'est pas configuré, si aucun profil n'existe encore pour ce
 * compte (cas normal juste après une inscription tant que le coach n'a pas
 * validé l'accès — voir README.md), ou en cas d'erreur réseau/RLS — jamais
 * de crash.
 */
export async function getProfileByUserId(userId: string): Promise<AuthProfile | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, user_id, role, first_name, last_name, email, phone, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    userId: data.user_id,
    role: data.role,
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    phone: data.phone,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/** Profil `profiles` de l'utilisateur actuellement connecté, ou `null`. */
export async function getCurrentProfile(): Promise<AuthProfile | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }
  return getProfileByUserId(user.id);
}

/**
 * Rôle de l'utilisateur actuellement connecté, ou `null` si Supabase n'est
 * pas configuré, si personne n'est connecté, ou si le compte n'a pas
 * encore de profil (rôle "inconnu" — à traiter distinctement d'un rôle
 * valide par l'appelant, jamais planter dessus).
 */
export async function getCurrentUserRole(): Promise<UserRole | null> {
  const profile = await getCurrentProfile();
  return profile?.role ?? null;
}

export async function isAdminOrCoach(): Promise<boolean> {
  const role = await getCurrentUserRole();
  return role === "admin" || role === "coach";
}

export async function isStudent(): Promise<boolean> {
  const role = await getCurrentUserRole();
  return role === "student";
}
