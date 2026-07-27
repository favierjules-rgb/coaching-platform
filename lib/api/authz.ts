import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/types";

/**
 * Autorisation des routes `/api/admin/*` — correctif H-3 (audit du
 * 27/07/2026).
 *
 * ---------------------------------------------------------------------
 * Le problème corrigé
 * ---------------------------------------------------------------------
 * Les dix routes d'administration se contentaient toutes de
 * `if (role !== "admin" && role !== "coach") return 403`. Un compte coach
 * disposait donc exactement des mêmes pouvoirs que l'administrateur : il
 * pouvait supprimer le compte de l'admin principal, effacer n'importe quel
 * élève, ou supprimer des lignes de facturation. La couche SQL avait
 * pourtant déjà été durcie (migration 20260726220000, introduction de
 * `public.is_admin()`) : c'est la couche API qui n'avait pas suivi.
 *
 * ---------------------------------------------------------------------
 * Règle métier retenue (arbitrage Jules, 27/07/2026)
 * ---------------------------------------------------------------------
 *   - l'administrateur a les droits globaux ;
 *   - le coach ne gère QUE les élèves qui lui sont affectés, et leurs
 *     données ;
 *   - le coach ne peut jamais supprimer ni modifier un administrateur ;
 *   - le coach ne gère jamais globalement les coachs ;
 *   - le coach ne touche jamais aux données de facturation globales ;
 *   - le coach n'agit jamais sur un élève qui ne lui est pas affecté.
 *
 * Chaque route relève d'une des trois catégories :
 *   1. `requireAdmin()`          — action globale ou destructive ;
 *   2. `requireStaffForStudent()` — action liée à UN élève, avec contrôle
 *      d'affectation obligatoire ;
 *   3. `requireStaff()`          — lecture non destructive, sans ressource
 *      nominative à rattacher.
 *
 * Le contrôle d'appartenance est délibérément fait ressource par ressource
 * plutôt que par une condition globale : remplacer `admin || coach` par un
 * autre test unique aurait reproduit le même défaut sous une autre forme.
 */

export interface ContexteAutorise {
  ok: true;
  user: User;
  role: UserRole;
  /** `true` si l'appelant est administrateur (jamais vrai pour un coach). */
  estAdmin: boolean;
}

export interface AutorisationRefusee {
  ok: false;
  response: NextResponse;
}

export type ResultatAutorisation = ContexteAutorise | AutorisationRefusee;

function refus(message: string, status: number): AutorisationRefusee {
  return { ok: false, response: NextResponse.json({ error: message }, { status }) };
}

/** Identité + rôle, sans décision d'accès. Base des trois gardes ci-dessous. */
async function contexte(): Promise<ContexteAutorise | AutorisationRefusee> {
  const user = await getCurrentUser();
  if (!user) return refus("Authentification requise.", 401);

  const role = await getCurrentUserRole();
  if (!role) return refus("Accès refusé.", 403);

  return { ok: true, user, role, estAdmin: role === "admin" };
}

/**
 * Actions globales ou destructives : gestion des coachs, facturation,
 * catalogue d'abonnements, suppression définitive de données.
 *
 * Un coach reçoit 403 — le même code qu'un élève. La réponse ne distingue
 * pas les deux : inutile de confirmer à un coach que la route existe et
 * qu'il lui manque « juste » un rôle.
 */
export async function requireAdmin(): Promise<ResultatAutorisation> {
  const ctx = await contexte();
  if (!ctx.ok) return ctx;
  if (!ctx.estAdmin) return refus("Accès refusé.", 403);
  return ctx;
}

/**
 * Lecture non destructive ouverte au staff (admin ou coach), quand aucune
 * ressource nominative n'est en jeu — par exemple consulter un modèle
 * d'abonnement avant de l'attribuer à un élève.
 */
export async function requireStaff(): Promise<ResultatAutorisation> {
  const ctx = await contexte();
  if (!ctx.ok) return ctx;
  if (ctx.role !== "admin" && ctx.role !== "coach") return refus("Accès refusé.", 403);
  return ctx;
}

/**
 * Action portant sur UN élève précis.
 *
 * L'administrateur passe sans condition. Le coach doit être celui à qui
 * l'élève est affecté (`students.coach_id` → sa propre fiche `coaches`).
 *
 * La vérification passe par le client service role, volontairement : elle
 * doit donner le même verdict quelles que soient les policies RLS en
 * vigueur. Faire dépendre un contrôle d'autorisation de la RLS reviendrait à
 * ce qu'un assouplissement futur d'une policy élargisse silencieusement les
 * droits de l'API.
 *
 * Un élève introuvable renvoie 404, sans distinction entre « n'existe pas »
 * et « ne vous est pas affecté » pour un coach : les deux donnent 403 côté
 * coach, afin de ne pas transformer la route en oracle d'existence.
 */
export async function requireStaffForStudent(studentId: string): Promise<ResultatAutorisation> {
  const ctx = await contexte();
  if (!ctx.ok) return ctx;
  if (ctx.role !== "admin" && ctx.role !== "coach") return refus("Accès refusé.", 403);
  if (ctx.estAdmin) return ctx;

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return refus("Client Supabase service role indisponible.", 503);
  }

  // Fiche `coaches` du compte connecté. Un coach sans fiche ne gère aucun
  // élève : refus, plutôt que de retomber sur un coach « par défaut ».
  const { data: ficheCoach } = await supabase
    .from("coaches")
    .select("id")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (!ficheCoach) return refus("Accès refusé.", 403);

  const { data: eleve } = await supabase
    .from("students")
    .select("coach_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!eleve || eleve.coach_id !== ficheCoach.id) return refus("Accès refusé.", 403);

  return ctx;
}

/**
 * Empêche un coach d'agir sur la fiche d'un administrateur.
 *
 * Utilisée en complément de `requireAdmin()` là où la cible est un compte
 * de staff. Défense en profondeur : aujourd'hui ces routes sont déjà
 * réservées à l'admin, mais la règle « un coach ne touche jamais un admin »
 * est explicite dans le code plutôt que déduite du garde-fou d'appel.
 */
export async function cibleEstAdministrateur(coachId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return true; // fail-closed : sans certitude, on refuse.

  const { data: coach } = await supabase.from("coaches").select("user_id").eq("id", coachId).maybeSingle();
  if (!coach?.user_id) return false;

  const { data: profil } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", coach.user_id)
    .maybeSingle();
  return profil?.role === "admin";
}
