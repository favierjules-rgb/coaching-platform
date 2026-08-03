import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";
import {
  assignSharedProgram,
  programAssignmentTestHooks,
  type DuplicateOverrides,
} from "@/lib/supabase/programs";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Régularisation des achats/affectations ANTÉRIEURS à la correction produit
 * (contrôle technique §8-§10, feat/student-workout-history).
 *
 * NE S'EXÉCUTE JAMAIS TOUTE SEULE : ce module ne fait que planifier
 * (dry-run, défaut) ou appliquer (opt-in explicite) — et l'application en
 * production reste soumise à validation. Voir scripts/regularisation-achats.mts.
 *
 * ── Les deux stratégies ──────────────────────────────────────────────────
 *
 * "copy-and-move" (ULTIME) : l'élève est assigné DIRECTEMENT au programme
 * commercial du catalogue (is_public=true). On lui crée sa copie individuelle
 * (clonage transactionnel, session Stripe Checkout rattachée quand elle est
 * retrouvable dans billing_events → idempotence des futurs rejeux de
 * webhook), on l'assigne à la copie, puis on retire l'assignation directe au
 * programme source. PRÉCONDITION VÉRIFIÉE AU MOMENT DE L'EXÉCUTION (pas
 * seulement à l'audit) : AUCUN feedback de cet élève ne référence une séance
 * du programme source — sinon la bascule casserait ces références et la
 * stratégie est REFUSÉE (voir mapping ci-dessous).
 *
 * "claim-in-place" (Dos & Pecs, TEST CARDIO BLOC) : l'élève a déjà un
 * historique (workout_feedback → workout_sessions du programme). On ne copie
 * RIEN : on pose owner_student_id sur le programme EXISTANT, qui devient sa
 * copie individuelle de fait. Zéro nouvelle ligne, zéro référence déplacée,
 * donc zéro risque pour l'historique. Un seul UPDATE, atomique par nature.
 *
 * ── §8 : stratégie de correspondance des références (documentée) ─────────
 *
 * Si un jour une bascule AVEC historique devait être faite (copie + re-mappage
 * des feedbacks), la correspondance ancienne séance → nouvelle séance devrait
 * être STRUCTURELLE, jamais fondée sur les seuls noms :
 *   semaine (week_number) → jour (day) → bloc (position) → exercice
 *   (order_index + exercise_library_id, l'identité stable de la bibliothèque).
 * Ce module ne l'implémente volontairement PAS : aucun des trois cas réels
 * n'en a besoin (ULTIME : zéro feedback ; les deux autres : claim-in-place
 * sans déplacement). Refuser > re-mapper tant que ce besoin n'existe pas.
 *
 * ── §9 : garanties d'exécution ───────────────────────────────────────────
 *
 * - dry-run PAR DÉFAUT : même chemin de décision que l'application réelle,
 *   zéro écriture (chaque action est calculée puis, en dry-run, jamais jouée) ;
 * - idempotent : chaque action re-vérifie l'état courant — un second passage
 *   ne fait rien (statut "deja-fait" partout) ; une reprise après échec
 *   partiel ne rejoue QUE les étapes manquantes ;
 * - transactionnel là où ça compte : la création de copie passe par le
 *   crochet de clonage par défaut (RPC provision_program_copy une fois la
 *   migration appliquée — tout ou rien, assignation comprise) ; la
 *   revendication est un UPDATE unique ; le retrait d'assignation est un
 *   DELETE unique. Entre deux étapes, tout état intermédiaire est rattrapable
 *   par un simple re-run.
 */

export type RegularisationKind = "copy-and-move" | "claim-in-place";

export interface RegularisationCible {
  label: string;
  programId: string;
  kind: RegularisationKind;
}

/**
 * Les trois cas réels identifiés par l'audit lecture seule du 2026-08-01
 * (ids de programmes — aucune donnée personnelle) :
 *   - L'ULTIME UPPER / LOWER by SETH : achat public, 1 acheteur, 0 feedback ;
 *   - Dos & Pecs - Test 2 semaines : 1 élève, 1 feedback → sur place ;
 *   - TEST CARDIO BLOC : 1 élève, 1 feedback → sur place.
 */
export const CIBLES_REGULARISATION_2026_08: RegularisationCible[] = [
  { label: "L'ULTIME UPPER / LOWER by SETH", programId: "1b67fc3b-031d-4088-adac-d98b04d2cf95", kind: "copy-and-move" },
  { label: "Dos & Pecs - Test 2 semaines", programId: "54a49ced-4872-452b-b50d-8d4d06797f55", kind: "claim-in-place" },
  { label: "TEST CARDIO BLOC", programId: "7763fc28-564b-4666-91fc-a500c23f2aaf", kind: "claim-in-place" },
];

export type RegularisationActionType =
  | "creer-copie"
  | "assigner-copie"
  | "retirer-assignation-source"
  | "revendiquer-owner";

export interface RegularisationAction {
  cible: string;
  type: RegularisationActionType;
  detail: string;
  /** a-faire (dry-run), deja-fait (idempotence), applique, echec. */
  statut: "a-faire" | "deja-fait" | "applique" | "echec";
}

/**
 * Décision par cible (refonte suite au dry-run production du 02/08) :
 *  - "ACTION PROPOSÉE" : bascule de l'assignation ACTIVE vers la copie —
 *    les feedbacks ne sont JAMAIS déplacés ni modifiés ;
 *  - "NO-OP" : aucune régularisation nécessaire (aucune assignation active,
 *    ou programme historique supprimé — l'historique est conservé tel quel) ;
 *  - "REFUS" : données ambiguës (cardinalité, propriété), on ne touche à rien.
 */
export interface RegularisationDecision {
  cible: string;
  decision: "ACTION PROPOSÉE" | "NO-OP" | "REFUS";
  raison: string;
  preconditions: string[];
  avant: { assignDirectes: number; assignCopies: number; copies: number; feedbacks: number };
  apresPrevu: { assignDirectes: number; assignCopies: number; copies: number; feedbacks: number };
}

export interface RegularisationRapport {
  dryRun: boolean;
  actions: RegularisationAction[];
  decisions: RegularisationDecision[];
  erreurs: string[];
}

export interface RegularisationOptions {
  /** Défaut TRUE : aucune écriture sans opt-in explicite. */
  dryRun?: boolean;
  /** Clonage injectable (tests hors ligne) — défaut : RPC transactionnelle avec repli. */
  duplicate?: (s: TypedSupabaseClient, id: string, o: DuplicateOverrides) => Promise<string | null>;
}

/** L'unique élève assigné au programme — toute autre cardinalité est une erreur bloquante. */
async function trouverEleveUnique(
  supabase: TypedSupabaseClient,
  programId: string,
): Promise<{ studentId: string | null; erreur: string | null }> {
  const { data, error } = await supabase
    .from("assignments")
    .select("student_id")
    .eq("content_type", "programme")
    .eq("content_id", programId);
  if (error) return { studentId: null, erreur: `lecture assignments impossible (${error.message})` };
  const lignes = data ?? [];
  if (lignes.length !== 1) {
    return { studentId: null, erreur: `${lignes.length} assignation(s) trouvée(s), 1 attendue — cardinalité inattendue, on ne touche à rien` };
  }
  return { studentId: lignes[0].student_id, erreur: null };
}

/** Nombre de feedbacks de CET élève référençant une séance de CE programme (précondition copy-and-move). */
async function compterFeedbacksLies(
  supabase: TypedSupabaseClient,
  programId: string,
  studentId: string,
): Promise<number | null> {
  const { data: sessions, error: sessionsError } = await supabase
    .from("workout_sessions")
    .select("id")
    .eq("program_id", programId);
  if (sessionsError) return null;
  const idsSeances = new Set((sessions ?? []).map((s) => s.id));
  const { data: feedbacks, error: feedbacksError } = await supabase
    .from("workout_feedback")
    .select("id, session_id")
    .eq("student_id", studentId);
  if (feedbacksError) return null;
  return (feedbacks ?? []).filter((f) => f.session_id && idsSeances.has(f.session_id)).length;
}

/**
 * Session Stripe Checkout à rattacher à la copie ULTIME : retrouvée dans
 * billing_events (checkout.session.completed dont la metadata
 * public_program_id désigne ce programme), la plus récente d'abord. NULL si
 * introuvable — la copie reste idempotente par (owner, source), simplement
 * sans la protection supplémentaire de l'index unique par session.
 */
export async function retrouverCheckoutSession(
  supabase: TypedSupabaseClient,
  programId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("billing_events")
    .select("payload, created_at")
    .eq("event_type", "checkout.session.completed");
  if (error || !data) return null;
  const candidates = data
    .map((row) => {
      const payload = row.payload as {
        data?: { object?: { id?: string; metadata?: { public_program_id?: string } } };
      } | null;
      const objet = payload?.data?.object;
      if (!objet?.id || objet.metadata?.public_program_id !== programId) return null;
      return { id: objet.id, createdAt: row.created_at ?? "" };
    })
    .filter((c): c is { id: string; createdAt: string } => c !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return candidates[0]?.id ?? null;
}

async function regulariserCopyAndMove(
  supabase: TypedSupabaseClient,
  cible: RegularisationCible,
  studentId: string,
  dryRun: boolean,
  duplicate: NonNullable<RegularisationOptions["duplicate"]>,
  rapport: RegularisationRapport,
): Promise<void> {
  // Refonte (dry-run production du 02/08) : des feedbacks liés aux séances
  // SOURCES ne sont PLUS un refus — la stratégie est « copier puis basculer
  // UNIQUEMENT l'assignation active ». Les feedbacks ne sont jamais déplacés
  // ni modifiés : ils restent rattachés aux séances sources, et ce script ne
  // supprime jamais ni le modèle ni ses séances. Le retour avec
  // prescribed_snapshot reste auto-porteur ; l'ancien sans snapshot garde sa
  // séance source vivante (limitation d'affichage héritée documentée).
  const nbFeedbacks = await compterFeedbacksLies(supabase, cible.programId, studentId);
  if (nbFeedbacks === null) {
    rapport.erreurs.push(`${cible.label} : impossible de vérifier les feedbacks liés — on ne touche à rien`);
    return;
  }
  // (le nombre de feedbacks est porté par la DÉCISION — aucune action ne les
  // concerne : ce script n'écrit JAMAIS dans workout_feedback.)

  const checkoutSessionId = await retrouverCheckoutSession(supabase, cible.programId);

  // Copie existante ? (par session d'achat d'abord, par owner+source sinon.)
  let copieId: string | null = null;
  if (checkoutSessionId) {
    const { data } = await supabase
      .from("programs")
      .select("id")
      .eq("source_checkout_session_id", checkoutSessionId)
      .maybeSingle();
    copieId = data?.id ?? null;
  }
  if (!copieId) {
    const { data } = await supabase
      .from("programs")
      .select("id")
      .eq("owner_student_id", studentId)
      .eq("source_template_id", cible.programId)
      .limit(1)
      .maybeSingle();
    copieId = data?.id ?? null;
  }

  if (copieId) {
    rapport.actions.push({ cible: cible.label, type: "creer-copie", detail: `copie déjà existante (${copieId})`, statut: "deja-fait" });
  } else if (dryRun) {
    rapport.actions.push({
      cible: cible.label,
      type: "creer-copie",
      detail: `clonage transactionnel vers l'élève${checkoutSessionId ? `, session ${checkoutSessionId} rattachée` : ", session Stripe introuvable (repli owner+source)"}`,
      statut: "a-faire",
    });
  } else {
    const { data: source } = await supabase
      .from("programs")
      .select("id, name, status")
      .eq("id", cible.programId)
      .maybeSingle();
    if (!source) {
      rapport.erreurs.push(`${cible.label} : programme source introuvable`);
      return;
    }
    copieId = await duplicate(supabase, cible.programId, {
      name: source.name,
      status: source.status,
      ownerStudentId: studentId,
      sourceTemplateId: cible.programId,
      ...(checkoutSessionId ? { sourceCheckoutSessionId: checkoutSessionId } : {}),
    });
    if (!copieId) {
      rapport.actions.push({ cible: cible.label, type: "creer-copie", detail: "échec du clonage — rien d'autre n'est tenté", statut: "echec" });
      rapport.erreurs.push(`${cible.label} : échec du clonage`);
      return;
    }
    rapport.actions.push({ cible: cible.label, type: "creer-copie", detail: `copie ${copieId} créée`, statut: "applique" });
  }

  // Assignation vers la copie (déjà posée par la RPC le cas échéant — idempotent).
  const { data: assignationCopie } = copieId
    ? await supabase
        .from("assignments")
        .select("id")
        .eq("student_id", studentId)
        .eq("content_type", "programme")
        .eq("content_id", copieId)
        .maybeSingle()
    : { data: null };
  if (assignationCopie) {
    rapport.actions.push({ cible: cible.label, type: "assigner-copie", detail: "assignation vers la copie déjà en place", statut: "deja-fait" });
  } else if (dryRun || !copieId) {
    rapport.actions.push({ cible: cible.label, type: "assigner-copie", detail: "assigner l'élève à sa copie", statut: "a-faire" });
  } else {
    const ok = await assignSharedProgram(supabase, studentId, copieId);
    rapport.actions.push({
      cible: cible.label,
      type: "assigner-copie",
      detail: ok ? "assignation vers la copie posée" : "échec de l'assignation vers la copie",
      statut: ok ? "applique" : "echec",
    });
    if (!ok) {
      rapport.erreurs.push(`${cible.label} : échec de l'assignation vers la copie — l'assignation source est CONSERVÉE`);
      return;
    }
  }

  // Retrait de l'assignation directe au programme commercial — en DERNIER :
  // l'élève ne perd jamais l'accès entre deux étapes.
  const { data: assignationSource } = await supabase
    .from("assignments")
    .select("id")
    .eq("student_id", studentId)
    .eq("content_type", "programme")
    .eq("content_id", cible.programId)
    .maybeSingle();
  if (!assignationSource) {
    rapport.actions.push({ cible: cible.label, type: "retirer-assignation-source", detail: "assignation directe déjà retirée", statut: "deja-fait" });
  } else if (dryRun) {
    rapport.actions.push({ cible: cible.label, type: "retirer-assignation-source", detail: "retirer l'assignation directe au programme commercial", statut: "a-faire" });
  } else {
    const { error } = await supabase
      .from("assignments")
      .delete()
      .eq("student_id", studentId)
      .eq("content_type", "programme")
      .eq("content_id", cible.programId);
    rapport.actions.push({
      cible: cible.label,
      type: "retirer-assignation-source",
      detail: error ? `échec du retrait (${error.message})` : "assignation directe retirée",
      statut: error ? "echec" : "applique",
    });
    if (error) rapport.erreurs.push(`${cible.label} : échec du retrait de l'assignation source`);
  }
}

async function regulariserClaimInPlace(
  supabase: TypedSupabaseClient,
  cible: RegularisationCible,
  studentId: string,
  dryRun: boolean,
  rapport: RegularisationRapport,
): Promise<void> {
  const { data: programme, error } = await supabase
    .from("programs")
    .select("id, owner_student_id")
    .eq("id", cible.programId)
    .maybeSingle();
  if (error || !programme) {
    rapport.erreurs.push(`${cible.label} : programme introuvable`);
    return;
  }
  if (programme.owner_student_id === studentId) {
    rapport.actions.push({ cible: cible.label, type: "revendiquer-owner", detail: "déjà revendiqué par cet élève", statut: "deja-fait" });
    return;
  }
  if (programme.owner_student_id) {
    rapport.erreurs.push(`${cible.label} : déjà possédé par un AUTRE élève — on ne touche à rien`);
    return;
  }
  if (dryRun) {
    rapport.actions.push({
      cible: cible.label,
      type: "revendiquer-owner",
      detail: "poser owner_student_id sur le programme existant (aucune copie, aucune référence déplacée)",
      statut: "a-faire",
    });
    return;
  }
  // UPDATE unique, gardé par `owner_student_id is null` relu ci-dessus ; le
  // filtre .is() le re-garantit au niveau base contre une course.
  const { error: updateError } = await supabase
    .from("programs")
    .update({ owner_student_id: studentId })
    .eq("id", cible.programId)
    .is("owner_student_id", null);
  rapport.actions.push({
    cible: cible.label,
    type: "revendiquer-owner",
    detail: updateError ? `échec (${updateError.message})` : "owner_student_id posé — historique intact",
    statut: updateError ? "echec" : "applique",
  });
  if (updateError) rapport.erreurs.push(`${cible.label} : échec de la revendication`);
}

/**
 * Point d'entrée unique. Dry-run par défaut : calcule exactement les actions
 * que l'application réelle jouerait, sans AUCUNE écriture. Avec
 * `dryRun: false`, applique idempotemment (re-run sûr, reprise après échec
 * partiel comprise).
 */
/** État observable d'une cible (compteurs du rapport avant/après). */
async function compterEtat(supabase: TypedSupabaseClient, programId: string) {
  const { data: directes } = await supabase
    .from("assignments").select("student_id").eq("content_type", "programme").eq("content_id", programId);
  const { data: copies } = await supabase
    .from("programs").select("id").eq("source_template_id", programId);
  const copieIds = (copies ?? []).map((c) => c.id);
  let assignCopies = 0;
  for (const id of copieIds) {
    const { data } = await supabase
      .from("assignments").select("student_id").eq("content_type", "programme").eq("content_id", id);
    assignCopies += (data ?? []).length;
  }
  const { data: sessions } = await supabase.from("workout_sessions").select("id").eq("program_id", programId);
  const idsSeances = new Set((sessions ?? []).map((s) => s.id));
  const { data: feedbacks } = await supabase.from("workout_feedback").select("id, session_id");
  const nbFeedbacks = (feedbacks ?? []).filter((f) => f.session_id && idsSeances.has(f.session_id)).length;
  return { assignDirectes: (directes ?? []).length, assignCopies, copies: copieIds.length, feedbacks: nbFeedbacks };
}

export async function executerRegularisation(
  supabase: TypedSupabaseClient,
  cibles: RegularisationCible[] = CIBLES_REGULARISATION_2026_08,
  options: RegularisationOptions = {},
): Promise<RegularisationRapport> {
  const dryRun = options.dryRun ?? true;
  const duplicate = options.duplicate ?? programAssignmentTestHooks.duplicate;
  const rapport: RegularisationRapport = { dryRun, actions: [], decisions: [], erreurs: [] };

  for (const cible of cibles) {
    const avant = await compterEtat(supabase, cible.programId);

    // Programme SUPPRIMÉ : historique orphelin conservé, aucune action —
    // sauf si une copie issue de lui atteste une régularisation déjà faite.
    const { data: programme } = await supabase
      .from("programs").select("id, is_public, owner_student_id").eq("id", cible.programId).maybeSingle();
    if (!programme) {
      const dejaRegularise = avant.copies > 0;
      rapport.decisions.push({
        cible: cible.label,
        decision: "NO-OP",
        raison: dejaRegularise
          ? "régularisation déjà terminée (copie existante), source disparue"
          : "programme historique SUPPRIMÉ — feedbacks orphelins conservés tels quels, aucun accès actif à rétablir",
        preconditions: ["aucune écriture", "feedbacks jamais modifiés"],
        avant,
        apresPrevu: avant,
      });
      continue;
    }

    // Aucune assignation ACTIVE : rien à régulariser — owner_student_id seul
    // ne signifie pas « assigné », et l'historique reste tel quel.
    if (avant.assignDirectes === 0 && cible.kind === "copy-and-move" && avant.copies > 0 && avant.assignCopies > 0) {
      rapport.decisions.push({
        cible: cible.label, decision: "NO-OP",
        raison: "régularisation déjà terminée : l'accès passe par la copie",
        preconditions: ["aucune écriture"], avant, apresPrevu: avant,
      });
      continue;
    }
    if (avant.assignDirectes === 0) {
      rapport.decisions.push({
        cible: cible.label, decision: "NO-OP",
        raison: "aucune assignation active vers le programme — aucune régularisation nécessaire, historique conservé",
        preconditions: ["aucune écriture", "feedbacks jamais modifiés"], avant, apresPrevu: avant,
      });
      continue;
    }
    if (avant.assignDirectes > 1) {
      rapport.decisions.push({
        cible: cible.label, decision: "REFUS",
        raison: `${avant.assignDirectes} assignations directes actives — cardinalité ambiguë, on ne touche à rien`,
        preconditions: [], avant, apresPrevu: avant,
      });
      rapport.erreurs.push(`${cible.label} : cardinalité ambiguë (${avant.assignDirectes} assignations)`);
      continue;
    }

    const { studentId, erreur } = await trouverEleveUnique(supabase, cible.programId);
    if (!studentId) {
      rapport.decisions.push({
        cible: cible.label, decision: "REFUS", raison: erreur ?? "élève introuvable",
        preconditions: [], avant, apresPrevu: avant,
      });
      rapport.erreurs.push(`${cible.label} : ${erreur ?? "élève introuvable"}`);
      continue;
    }

    if (cible.kind === "copy-and-move") {
      rapport.decisions.push({
        cible: cible.label,
        decision: "ACTION PROPOSÉE",
        raison: `copier puis basculer UNIQUEMENT l'assignation active vers la copie — ${avant.feedbacks} feedback(s) historiques restent rattachés aux séances SOURCES (jamais déplacés)`,
        preconditions: [
          "le modèle et ses séances sont CONSERVÉS (aucune suppression)",
          "aucune écriture sur workout_feedback / session_id / prescribed_snapshot",
          "copie réutilisée si déjà existante (aucun doublon)",
          "session Stripe Checkout rattachée si retrouvée dans billing_events",
          "une seule assignation active, retirée EN DERNIER",
        ],
        avant,
        apresPrevu: { assignDirectes: 0, assignCopies: avant.assignCopies + 1, copies: Math.max(avant.copies, 1), feedbacks: avant.feedbacks },
      });
      await regulariserCopyAndMove(supabase, cible, studentId, dryRun, duplicate, rapport);
    } else {
      rapport.decisions.push({
        cible: cible.label,
        decision: "ACTION PROPOSÉE",
        raison: "revendication sur place (owner posé sur le programme existant) — aucune copie, aucune référence déplacée",
        preconditions: ["programme existant, non possédé par un autre élève", "feedbacks jamais modifiés"],
        avant,
        apresPrevu: avant,
      });
      await regulariserClaimInPlace(supabase, cible, studentId, dryRun, rapport);
    }
  }
  return rapport;
}
