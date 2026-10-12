import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CategorieDroit, CoachRole, NiveauDroit, UserRole } from "@/types";

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
 *
 * ---------------------------------------------------------------------
 * Extension P13-B — cloisonnement des collaborateurs (11/10/2026)
 * ---------------------------------------------------------------------
 * `profiles.role` est INCHANGÉ : il vaut toujours "coach" pour tout le staff
 * non-admin. Le rôle fin est porté par `coaches.role` ∈ {admin, assistant,
 * collaborateur}, exactement comme en base (contrainte `coaches_role_check`,
 * migration 20261011090000). Les trois gardes ci-dessus rendaient donc le
 * MÊME verdict pour un collaborateur et pour un coach autonome :
 *
 *   - `requireStaff()` laissait passer un collaborateur sur des routes
 *     globales (catalogue d'abonnements, campagnes, audience) ;
 *   - `requireStaffForStudent()` ne comparait que `students.coach_id`, qu'un
 *     collaborateur ne vaut JAMAIS (l'affectation vit dans
 *     `collaborateur_eleves`) : il était refusé sur ses propres élèves.
 *
 * Règles appliquées ici, identiques à celles de la RLS :
 *   - un collaborateur n'atteint QUE les élèves explicitement affectés ;
 *   - chaque route nominative déclare la catégorie et le niveau qu'elle
 *     exige (`entrainement`, `suivi_eleve`, `agenda_communication`,
 *     `nutrition` × `lecture`, `ecriture`) ;
 *   - `ecriture` implique `lecture` POUR LA MÊME CATÉGORIE, jamais au-delà ;
 *   - une route qui ne déclare AUCUNE catégorie refuse le collaborateur :
 *     l'absence de catégorie n'est pas un laissez-passer, c'est un refus
 *     (facturation, Stripe, comptes, catalogue — rien de tout cela n'est
 *     accordable) ;
 *   - aucun accès global n'est jamais déduit d'une permission.
 *
 * Le comportement de `admin`, `assistant` et `student` est strictement
 * préservé : pour eux, aucune des trois gardes ne change de verdict.
 */

export interface ContexteAutorise {
  ok: true;
  user: User;
  role: UserRole;
  /** `true` si l'appelant est administrateur (jamais vrai pour un coach). */
  estAdmin: boolean;
  /**
   * Rôle P13-B lu dans `coaches.role`, résolu UNIQUEMENT par les gardes qui
   * en ont besoin (`requireStaff`, `requireStaffForStudent`). `null` tant
   * qu'il n'a pas été résolu, ou si le compte n'a aucune fiche `coaches`
   * active. `requireAdmin()` ne le résout pas : il n'a rien à en faire, et
   * cela lui évite une requête de plus.
   */
  roleStaff: CoachRole | null;
  /** Id de la fiche `coaches` active de l'appelant, `null` si aucune. */
  staffId: string | null;
}

/**
 * Catégorie et niveau qu'une route nominative exige d'un collaborateur.
 * Omettre cette exigence vaut refus pour un collaborateur : voir l'en-tête.
 */
export interface ExigenceCategorie {
  categorie: CategorieDroit;
  niveau: NiveauDroit;
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

  return { ok: true, user, role, estAdmin: role === "admin", roleStaff: null, staffId: null };
}

/**
 * Fiches `coaches` de l'appelant, lues au service role — comme
 * `requireStaffForStudent` le faisait déjà, et pour la même raison : le
 * verdict d'autorisation ne doit pas dépendre des policies en vigueur,
 * sinon un assouplissement futur d'une policy élargirait silencieusement les
 * droits de l'API.
 *
 * `active` reproduit EXACTEMENT `public.current_staff_id()` et
 * `public.staff_role()` (statut 'actif', tri `created_at` puis `id`, première
 * ligne) : l'API et la RLS ne peuvent donc pas désigner deux fiches
 * différentes pour un même compte.
 *
 * `estCollaborateur` regarde en revanche TOUTES les lignes, y compris
 * inactives. Sans cela, désactiver la fiche d'un collaborateur le ferait
 * passer pour « staff sans fiche » et lui rendrait les routes globales :
 * un retrait de statut deviendrait une élévation de privilège.
 */
interface FichesStaff {
  active: { id: string; role: CoachRole } | null;
  estCollaborateur: boolean;
}

async function fichesStaff(userId: string): Promise<FichesStaff | "indisponible"> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return "indisponible";

  const { data } = await supabase
    .from("coaches")
    .select("id, role, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  const lignes = data ?? [];
  const active = lignes.find((ligne) => ligne.status === "actif") ?? null;
  return {
    active: active ? { id: active.id, role: active.role } : null,
    estCollaborateur: lignes.some((ligne) => ligne.role === "collaborateur"),
  };
}

/**
 * Le collaborateur est-il affecté à cet élève, AVEC la catégorie et le
 * niveau exigés ? Les deux conditions sont nécessaires et aucune ne supplée
 * l'autre : une affectation sans permission ne donne rien, une permission
 * sans affectation ne donne rien.
 *
 * `ecriture` implique `lecture` dans la même catégorie — et seulement là :
 * la comparaison se fait sur la ligne de CETTE catégorie, jamais sur
 * l'ensemble des permissions.
 */
async function collaborateurAutorise(
  collaborateurId: string,
  studentId: string,
  exigence: ExigenceCategorie,
): Promise<boolean | "indisponible"> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return "indisponible";

  const { data: affectation } = await supabase
    .from("collaborateur_eleves")
    .select("id")
    .eq("collaborateur_id", collaborateurId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!affectation) return false;

  const { data: permission } = await supabase
    .from("collaborateur_permissions")
    .select("niveau")
    .eq("collaborateur_id", collaborateurId)
    .eq("categorie", exigence.categorie)
    .maybeSingle();
  if (!permission) return false;

  return exigence.niveau === "lecture" ? true : permission.niveau === "ecriture";
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
 *
 * P13-B : un COLLABORATEUR est refusé ici. Ces routes ne portent aucune
 * ressource nominative, donc aucune affectation ne peut les justifier, et
 * elles donnent accès à des données d'ensemble (catalogue d'abonnements,
 * audience de campagne, journal d'emails). Aucune des quatre catégories
 * n'ouvre ce périmètre — c'est la règle « aucune permission ne donne accès
 * aux tables globales ou administratives », appliquée au niveau API.
 *
 * Un compte staff SANS fiche `coaches` continue de passer, exactement comme
 * avant P13-B : un collaborateur a toujours une fiche (c'est elle qui porte
 * son rôle), donc ce cas ne peut pas en masquer un.
 */
export async function requireStaff(): Promise<ResultatAutorisation> {
  const ctx = await contexte();
  if (!ctx.ok) return ctx;
  if (ctx.role !== "admin" && ctx.role !== "coach") return refus("Accès refusé.", 403);
  if (ctx.estAdmin) return ctx;

  const fiches = await fichesStaff(ctx.user.id);
  if (fiches === "indisponible") return refus("Client Supabase service role indisponible.", 503);
  if (fiches.estCollaborateur) return refus("Accès refusé.", 403);

  return { ...ctx, roleStaff: fiches.active?.role ?? null, staffId: fiches.active?.id ?? null };
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
export async function requireStaffForStudent(
  studentId: string,
  exigence?: ExigenceCategorie,
): Promise<ResultatAutorisation> {
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
  const fiches = await fichesStaff(ctx.user.id);
  if (fiches === "indisponible") return refus("Client Supabase service role indisponible.", 503);
  const ficheCoach = fiches.active;
  if (!ficheCoach) return refus("Accès refusé.", 403);

  const ctxStaff: ContexteAutorise = { ...ctx, roleStaff: ficheCoach.role, staffId: ficheCoach.id };

  // ── Le COLLABORATEUR (P13-B) ──────────────────────────────────────────
  // Son périmètre ne passe JAMAIS par `students.coach_id` : il ne vaut
  // jamais sa propre fiche, et le comparer l'aurait refusé sur ses propres
  // élèves affectés. L'affectation explicite et la permission de catégorie
  // sont les deux seules sources de son droit.
  if (ficheCoach.role === "collaborateur") {
    // Une route qui n'exige aucune catégorie n'est pas une route ouverte :
    // c'est une route qu'aucune permission ne couvre (facturation, Stripe,
    // création de compte). Refus, sans exception.
    if (!exigence) return refus("Accès refusé.", 403);

    const autorise = await collaborateurAutorise(ficheCoach.id, studentId, exigence);
    if (autorise === "indisponible") return refus("Client Supabase service role indisponible.", 503);
    if (!autorise) return refus("Accès refusé.", 403);
    return ctxStaff;
  }

  // ── L'ADMIN de cabinet et le COACH AUTONOME (assistant) ───────────────
  // Comportement inchangé depuis H-3 : l'élève doit lui être rattaché par
  // `students.coach_id`. Volontairement plus strict que la RLS, qui donne
  // tous les élèves à une fiche `coaches.role = 'admin'` : l'API ne relâche
  // pas un contrôle qu'elle appliquait déjà.
  const { data: eleve } = await supabase
    .from("students")
    .select("coach_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!eleve || eleve.coach_id !== ficheCoach.id) return refus("Accès refusé.", 403);

  return ctxStaff;
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
