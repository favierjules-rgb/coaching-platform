import { requirePresentielAccess } from "@/lib/supabase/guards";
import { SeancePresentielContenu } from "@/components/admin/presentiel/SeancePresentielContenu";

export const dynamic = "force-dynamic";

/**
 * MODE PRÉSENTIEL — la séance d'un élève, saisie par son coach.
 *
 * ⚠️ COMPOSANT SERVEUR, ET C'EST TOUT L'INTÉRÊT. `studentId` vient de l'URL :
 * c'est une donnée du client. `requirePresentielAccess` la confronte aux
 * droits réels du compte connecté AVANT que la moindre ligne ne soit rendue.
 * Un garde posé dans le composant client n'aurait rien gardé — le HTML serait
 * déjà parti.
 *
 * Le contenu, lui, est client : il réutilise les composants de séance de
 * l'élève tels quels, parce que c'est exactement la même séance.
 */
export default async function SeancePresentielPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string; sessionId: string }>;
  searchParams: Promise<{ programme?: string }>;
}) {
  const { studentId, sessionId } = await params;
  const { programme } = await searchParams;

  await requirePresentielAccess(studentId);

  return (
    <SeancePresentielContenu
      studentId={studentId}
      sessionId={sessionId}
      programId={programme ?? null}
    />
  );
}
