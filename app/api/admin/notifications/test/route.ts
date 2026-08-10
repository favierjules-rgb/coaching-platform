import { NextResponse } from "next/server";

import { requireAdmin, requireStaff } from "@/lib/api/authz";
import { abonnementsActifs, desactiverAbonnement, marquerSucces } from "@/lib/push/depot-abonnements";
import { DESTINATION_PAR_DEFAUT } from "@/lib/push/destinations";
import { envoyerNotifications } from "@/lib/push/envoyer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/notifications/test — « Notification de test SETH ».
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'ELLE EST, ET CE QU'ELLE N'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * Elle sert à PROUVER le socle : une notification réelle, sur un vrai
 * téléphone, application fermée. Elle n'écrit aucune campagne, aucune
 * occurrence, aucun historique — le centre de notifications viendra
 * ensuite, une fois ce test validé.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUTORISATION
 * ════════════════════════════════════════════════════════════════════════
 *   • sans `userId` : envoi à SOI-MÊME — réservé au staff (`requireStaff`) ;
 *   • avec `userId` : envoi à quelqu'un d'autre — administrateur seulement
 *     (`requireAdmin`).
 *
 * Aucune de ces gardes n'est nouvelle : ce sont celles de `lib/api/authz.ts`,
 * déjà utilisées par les autres routes d'administration. Un élève reçoit 403
 * dans les deux cas, même s'il fabrique la requête à la main.
 */
export async function POST(request: Request) {
  let corps: { userId?: unknown } = {};
  try {
    corps = (await request.json()) as { userId?: unknown };
  } catch {
    corps = {};
  }
  const cible = typeof corps.userId === "string" && corps.userId.length > 0 ? corps.userId : null;

  const acces = cible ? await requireAdmin() : await requireStaff();
  if (!acces.ok) return acces.response;

  const destinataire = cible ?? acces.user.id;

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  const abonnements = await abonnementsActifs(admin, destinataire);
  if (abonnements.length === 0) {
    // Ce n'est PAS une erreur : personne n'a activé les notifications sur cet
    // appareil-là. On le dit tel quel, l'interface saura l'expliquer.
    return NextResponse.json({ ok: true, appareils: 0, envoyees: 0, echouees: 0 });
  }

  const resultats = await envoyerNotifications(abonnements, {
    titre: "Notification de test SETH",
    corps: "Si tu vois ce message, les notifications fonctionnent.",
    destination: DESTINATION_PAR_DEFAUT,
    etiquette: "test",
  });

  // Chaque appareil a son propre verdict. Un abonnement mort est désactivé,
  // et lui seul.
  for (const resultat of resultats) {
    if (resultat.statut === "envoyee") {
      await marquerSucces(admin, resultat.endpoint);
    } else if (resultat.suite === "desactiver") {
      await desactiverAbonnement(admin, resultat.endpoint, resultat.codeErreur ?? "inconnue");
    }
  }

  const envoyees = resultats.filter((r) => r.statut === "envoyee").length;
  return NextResponse.json({
    ok: true,
    appareils: abonnements.length,
    envoyees,
    echouees: resultats.length - envoyees,
  });
}
