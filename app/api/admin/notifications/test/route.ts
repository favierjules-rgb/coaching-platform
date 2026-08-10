import { NextResponse } from "next/server";

import { requireStaffForStudent } from "@/lib/api/authz";
import { abonnementsActifs, desactiverAbonnement, marquerSucces } from "@/lib/push/depot-abonnements";
import { DESTINATION_PAR_DEFAUT } from "@/lib/push/destinations";
import { envoyerNotifications } from "@/lib/push/envoyer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * « Notification de test SETH » — VERS UN ÉLÈVE DÉSIGNÉ.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CETTE ROUTE A EU, ET QU'ELLE N'A PLUS
 * ════════════════════════════════════════════════════════════════════════
 * La première version envoyait à `acces.user.id` — le compte STAFF connecté
 * — dès que le corps de la requête ne portait pas d'identifiant. Or le
 * bouton postait `"{}"`. Résultat observé le 10/08/2026 : deux appareils
 * élève bien enregistrés dans `push_subscriptions`, et un tableau de bord
 * qui répondait « Aucun appareil abonné ». Il cherchait les appareils de
 * l'administrateur, qui n'en a aucun.
 *
 * Le destinataire est donc maintenant EXPLICITE et obligatoire. Il n'y a
 * plus de repli implicite : un envoi sans destinataire nommé est un 400, pas
 * un envoi à soi-même.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE NAVIGATEUR DONNE UN `studentId`, JAMAIS UN `user_id`
 * ════════════════════════════════════════════════════════════════════════
 * Un identifiant de compte d'authentification envoyé par le client serait
 * une cible arbitraire : il suffirait de le changer pour pousser une
 * notification vers n'importe quel compte, staff compris. Le client nomme
 * donc une FICHE ÉLÈVE, et le serveur résout lui-même `students.user_id`
 * avec le client service role. Tout `userId` présent dans le corps est
 * ignoré — il n'est même pas lu.
 *
 * `requireStaffForStudent` est la garde qui existait déjà pour toute action
 * portant sur un élève : l'administrateur passe, le coach seulement pour SES
 * élèves, un élève reçoit 403, un anonyme 401.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI SORT D'ICI
 * ════════════════════════════════════════════════════════════════════════
 * Des NOMBRES, et rien d'autre. Ni `endpoint`, ni `p256dh`, ni `auth` : un
 * endpoint identifie un appareil et permettrait à qui lit la réponse de le
 * viser directement. La forme est fixe, à cinq clés.
 */

interface Cible {
  /** `null` quand la fiche existe mais n'a aucun compte rattaché. */
  userId: string | null;
}

function corpsVide(utilisateurs: number) {
  return { ok: true, utilisateursCibles: utilisateurs, appareilsCibles: 0, envoyes: 0, echoues: 0 };
}

/** Lit `studentId` d'un corps JSON ou d'une URL. Rien d'autre n'est retenu. */
function lireStudentId(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim().length > 0 ? valeur.trim() : null;
}

/**
 * Le compte d'authentification de CETTE fiche élève — résolu côté serveur,
 * avec le client service role, pour que le verdict ne dépende d'aucune
 * policy RLS.
 */
async function resoudreCompte(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  studentId: string,
): Promise<Cible | null> {
  const { data } = await admin!.from("students").select("user_id").eq("id", studentId).maybeSingle();
  if (!data) return null;
  return { userId: data.user_id ?? null };
}

/**
 * GET — combien d'appareils sont joignables, SANS rien envoyer.
 *
 * C'est ce qui alimente « 2 appareils joignables » sous le sélecteur : il
 * serait absurde de devoir envoyer une notification pour savoir s'il y a
 * quelqu'un au bout.
 */
export async function GET(request: Request) {
  const studentId = lireStudentId(new URL(request.url).searchParams.get("studentId"));
  if (!studentId) {
    return NextResponse.json({ error: "Élève non précisé." }, { status: 400 });
  }

  const acces = await requireStaffForStudent(studentId);
  if (!acces.ok) return acces.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  const cible = await resoudreCompte(admin, studentId);
  if (!cible || !cible.userId) return NextResponse.json(corpsVide(0));

  const abonnements = await abonnementsActifs(admin, cible.userId);
  return NextResponse.json({ ok: true, utilisateursCibles: 1, appareilsCibles: abonnements.length });
}

export async function POST(request: Request) {
  let corps: { studentId?: unknown } = {};
  try {
    corps = (await request.json()) as { studentId?: unknown };
  } catch {
    corps = {};
  }
  const studentId = lireStudentId(corps.studentId);
  if (!studentId) {
    return NextResponse.json({ error: "Élève non précisé." }, { status: 400 });
  }

  const acces = await requireStaffForStudent(studentId);
  if (!acces.ok) return acces.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  const cible = await resoudreCompte(admin, studentId);
  // Fiche inconnue, ou élève qui n'a jamais activé son compte : zéro cible.
  // Ce n'est pas une panne, et l'interface saura le dire.
  if (!cible || !cible.userId) return NextResponse.json(corpsVide(0));

  const abonnements = await abonnementsActifs(admin, cible.userId);
  if (abonnements.length === 0) {
    // L'élève existe et a un compte : il reste UNE cible, sans appareil.
    return NextResponse.json(corpsVide(1));
  }

  const resultats = await envoyerNotifications(abonnements, {
    titre: "Notification de test SETH",
    corps: "Si tu vois ce message, les notifications fonctionnent.",
    destination: DESTINATION_PAR_DEFAUT,
    etiquette: "test",
  });

  // Chaque appareil a son propre verdict. Un abonnement mort (404/410) est
  // désactivé, et LUI SEUL : la panne d'un iPad n'a jamais empêché un iPhone
  // de recevoir. Une erreur passagère (500, réseau) ne désactive personne.
  for (const resultat of resultats) {
    if (resultat.statut === "envoyee") {
      await marquerSucces(admin, resultat.endpoint);
    } else if (resultat.suite === "desactiver") {
      await desactiverAbonnement(admin, resultat.endpoint, resultat.codeErreur ?? "inconnue");
    }
  }

  const envoyes = resultats.filter((r) => r.statut === "envoyee").length;
  return NextResponse.json({
    ok: true,
    utilisateursCibles: 1,
    appareilsCibles: abonnements.length,
    envoyes,
    echoues: resultats.length - envoyes,
  });
}
