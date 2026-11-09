import { PlanningLiveContenu } from "@/components/admin/presentiel/PlanningLiveContenu";
import { requireAffectationDirecte, requirePresentielAccess } from "@/lib/supabase/guards";

export const dynamic = "force-dynamic";

/**
 * MODE LIVE — le planning d'un élève sur une programmation donnée.
 *
 * ⚠️ COMPOSANT SERVEUR, ET C'EST TOUT L'INTÉRÊT. Les deux identifiants
 * viennent de l'URL : ce sont des données du client, et elles ne valent rien
 * avant d'avoir été confrontées à l'état réel de la base.
 *
 * DEUX GARDES, QUI NE DISENT PAS LA MÊME CHOSE, DANS CET ORDRE :
 *
 *   1. `requirePresentielAccess(studentId)` — LES DROITS. Staff connecté, puis
 *      `requireStaffForStudent` avec la permission entraînement / ÉCRITURE : un
 *      admin de cabinet passe, un coach autonome seulement sur ses élèves, un
 *      collaborateur seulement sur un élève affecté ET avec cette permission.
 *      C'est ce qui ferme la manipulation d'URL.
 *   2. `requireAffectationDirecte(programId, studentId)` — LES DONNÉES. La
 *      programmation est-elle bien celle de cet élève ? Un coach a le droit de
 *      saisir pour son élève sans avoir pour autant le droit de lui ouvrir le
 *      planning d'une programmation qu'il ne suit pas : on y choisirait des
 *      séances qu'il ne fait pas, et la base refuserait l'écriture au moment
 *      de valider — en salle, après la séance.
 *
 * L'ordre compte : on ne révèle l'existence d'une affectation qu'à un compte
 * qui a déjà le droit de voir cet élève.
 *
 * Le contenu est client : il réutilise les composants de planning de l'élève
 * tels quels, parce que c'est exactement le même planning.
 */
export default async function PlanningLivePage({
  params,
}: {
  params: Promise<{ programId: string; studentId: string }>;
}) {
  const { programId, studentId } = await params;

  await requirePresentielAccess(studentId);
  await requireAffectationDirecte(programId, studentId);

  return <PlanningLiveContenu studentId={studentId} programId={programId} />;
}
