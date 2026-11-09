import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStaff, requireStaffForStudent } from "@/lib/api/authz";
import { parseParams } from "@/lib/api/validate";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentById } from "@/lib/supabase/students";
import type { EleveLive } from "@/lib/presentiel-live";

export const dynamic = "force-dynamic";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MODE LIVE — QUELS ÉLÈVES CE COMPTE PEUT-IL SAISIR SUR CETTE PROGRAMMATION ?
 * ════════════════════════════════════════════════════════════════════════════
 * Le navigateur demande, le serveur répond. C'est tout l'objet de cette route :
 * la fenêtre « Choisir un élève » n'affiche JAMAIS une liste que le navigateur
 * aurait composée lui-même, même s'il a déjà les identifiants sous la main pour
 * décider d'afficher l'étiquette.
 *
 * ⚠️ POURQUOI PAS SIMPLEMENT `program.assignedStudentIds` CÔTÉ CLIENT ?
 * Trois raisons, et chacune suffirait :
 *
 *   1. CETTE LISTE MÉLANGE DEUX POPULATIONS. Les propriétaires d'une COPIE y
 *      figurent alors qu'ils s'entraînent sur une autre structure — ouvrir le
 *      Live pour eux depuis le modèle saisirait une séance qu'ils ne font pas,
 *      et la base refuserait l'écriture au moment de valider, en salle. Voir
 *      `lib/presentiel-live.ts`.
 *   2. LA RLS N'EST PAS LE CONTRÔLE D'AUTORISATION. Elle borne déjà ce que le
 *      compte LIT — un coach ne voit que ses élèves —, mais
 *      `requireStaffForStudent` est plus strict pour un coach autonome
 *      (`students.coach_id` doit être SA fiche) et exige une permission de
 *      catégorie pour un collaborateur. C'est lui qui fait autorité.
 *   3. UNE LISTE CLIENTE SERAIT UNE LISTE MODIFIABLE. Elle décide quel élève
 *      le coach va pouvoir saisir : elle appartient au serveur.
 *
 * ⚠️ CETTE ROUTE N'OUVRE AUCUNE PORTE. Elle ne fait que NOMMER des élèves que
 * le compte connecté peut déjà lire et déjà saisir. La page du planning et la
 * route d'enregistrement revérifient tout, l'une par `requirePresentielAccess`,
 * l'autre par `requireStaffForStudent` — un identifiant obtenu ici ne vaut pas
 * plus qu'un identifiant inventé.
 */

const paramsSchema = z
  .object({ programId: z.string().uuid("Programmation invalide.") })
  .strict();

/** Au-delà, la fenêtre de choix n'est plus un choix : on borne la lecture. */
const MAX_ELEVES = 200;

export async function GET(_request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const parsed = parseParams(await params, paramsSchema);
  if (!parsed.success) return parsed.response;
  const { programId } = parsed.data;

  // 1. Un compte de staff, d'abord. Rien n'est lu avant.
  const staff = await requireStaff();
  if (!staff.ok) return staff.response;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  /*
   * 2. LES AFFECTATIONS DIRECTES, LUES SOUS LA RLS DU COMPTE.
   *
   * ⚠️ `content_type = 'programme'` ET `content_id = programId` : on part de la
   * TABLE DES AFFECTATIONS, pas du nom du programme ni d'une liste reçue. La
   * RLS de `assignments` borne déjà le résultat aux élèves du périmètre du
   * compte (mesuré : un coach n'y voit que ses élèves, un collaborateur que
   * ceux qui lui sont affectés).
   *
   * ⚠️ ET SEULEMENT LES DIRECTES. Une copie individuelle porte sa propre ligne
   * d'affectation vers la copie : son propriétaire remonte donc ici quand on
   * interroge la copie, et PAS quand on interroge le modèle. C'est exactement
   * la règle de `student_owns_workout_session`, et c'est pour cela qu'elle est
   * reprise telle quelle plutôt que réinventée.
   */
  const { data: affectations, error } = await supabase
    .from("assignments")
    .select("student_id, program_start_date")
    .eq("content_type", "programme")
    .eq("content_id", programId)
    .limit(MAX_ELEVES);

  if (error) {
    return NextResponse.json({ error: "Lecture des affectations impossible." }, { status: 500 });
  }

  /*
   * Le propriétaire de la programmation, s'il s'agit d'une copie individuelle.
   * La base l'accepte par `programs.owner_student_id` même sans ligne
   * d'affectation ; le nommer ici ferme le cas d'une copie dont l'affectation
   * aurait été retirée pendant la séance.
   */
  const { data: programme } = await supabase
    .from("programs")
    .select("id, name, owner_student_id")
    .eq("id", programId)
    .maybeSingle();

  if (!programme) {
    // Ni « inexistant », ni « pas à vous » : la distinction ferait de cette
    // route un oracle sur les programmations des autres coachs.
    return NextResponse.json({ error: "Programmation introuvable." }, { status: 404 });
  }

  const candidats = new Set<string>();
  const debutParEleve = new Map<string, string | null>();
  for (const a of affectations ?? []) {
    candidats.add(a.student_id);
    debutParEleve.set(a.student_id, a.program_start_date ?? null);
  }
  if (programme.owner_student_id) candidats.add(programme.owner_student_id);

  /*
   * 3. L'AUTORISATION, ÉLÈVE PAR ÉLÈVE, PAR LA SEULE AUTORITÉ.
   *
   * ⚠️ ON NE REJOUE PAS SA LOGIQUE, ET ON NE LA REMPLACE PAS PAR LA RLS.
   * `requireStaffForStudent` connaît les trois rôles de staff et le modèle de
   * permissions par catégorie de P13-B. L'exigence de catégorie n'est pas
   * décorative : sans elle, elle REFUSE tout collaborateur ; avec un niveau
   * `lecture`, elle accepterait un collaborateur qui ne doit pas saisir. C'est
   * donc bien `entrainement` / `ecriture` — la permission du geste qu'on
   * s'apprête à permettre, pas une permission générique.
   *
   * Séquentiel, et c'est assumé : une programmation concerne quelques élèves,
   * et chaque appel interroge la base. Au-delà, `MAX_ELEVES` borne déjà.
   */
  const autorises: EleveLive[] = [];
  for (const studentId of candidats) {
    const acces = await requireStaffForStudent(studentId, {
      categorie: "entrainement",
      niveau: "ecriture",
    });
    if (!acces.ok) continue;

    // La fiche, pour nommer l'élève. Lue sous RLS : un élève que le compte ne
    // peut pas lire ne peut pas être affiché, même autorisé par ailleurs.
    const eleve = await getStudentById(supabase, studentId);
    if (!eleve) continue;

    autorises.push({
      studentId,
      prenom: eleve.firstName ?? "",
      nom: eleve.lastName ?? "",
      email: eleve.email ?? null,
      debutProgramme: debutParEleve.get(studentId) ?? null,
    });
  }

  return NextResponse.json({
    programme: { id: programme.id, nom: programme.name },
    eleves: autorises,
  });
}
