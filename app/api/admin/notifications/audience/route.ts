import { NextResponse } from "next/server";

import { requireAdmin, requireStaff, requireStaffForStudent } from "@/lib/api/authz";
import { appareilsJoignables } from "@/lib/notifications/depot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * COMBIEN DE MONDE, AVANT D'APPUYER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS NOMBRES, PARCE QU'ILS DISENT TROIS CHOSES DIFFÉRENTES
 * ════════════════════════════════════════════════════════════════════════
 *   • ciblés      — les élèves visés par la sélection ;
 *   • joignables  — ceux qui ont AU MOINS un appareil abonné vivant ;
 *   • appareils   — le nombre de pushs qui partiront réellement.
 *
 * Les confondre, c'est promettre « 42 élèves » et en toucher 32. C'est aussi
 * ce qui rend la confirmation d'envoi global honnête plutôt que décorative.
 *
 * Cette route ne rend QUE des nombres. Ni endpoint, ni clé, ni même la liste
 * des élèves joignables — savoir qui n'a pas activé ses notifications n'est
 * pas nécessaire pour appuyer sur le bouton.
 */

interface LigneEleve {
  user_id: string | null;
}

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff.ok) return staff.response;

  let brut: Record<string, unknown> = {};
  try {
    brut = (await request.json()) as Record<string, unknown>;
  } catch {
    brut = {};
  }

  const genre = brut.genre === "all" ? "all" : brut.genre === "students" ? "students" : null;
  if (!genre) return NextResponse.json({ error: "Destinataires non précisés." }, { status: 400 });

  const studentIds = Array.isArray(brut.studentIds)
    ? brut.studentIds.filter((v): v is string => typeof v === "string")
    : [];

  // Mêmes droits que pour un envoi : compter combien de monde on POURRAIT
  // toucher est déjà une information sur des élèves qu'on ne gère peut-être
  // pas.
  if (genre === "all") {
    const acces = await requireAdmin();
    if (!acces.ok) return acces.response;
  } else {
    if (studentIds.length === 0) {
      return NextResponse.json({ ok: true, cibles: 0, joignables: 0, appareils: 0 });
    }
    for (const id of studentIds) {
      const acces = await requireStaffForStudent(id);
      if (!acces.ok) return acces.response;
    }
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  const requete = admin.from("students").select("user_id");
  const { data } =
    genre === "all" ? await requete : await requete.in("id", studentIds);

  const eleves = (data ?? []) as LigneEleve[];
  const comptes = eleves.map((e) => e.user_id).filter((v): v is string => Boolean(v));

  const appareils = await appareilsJoignables(admin, comptes);
  const joignables = new Set(appareils.map((a) => a.userId));

  return NextResponse.json({
    ok: true,
    cibles: eleves.length,
    joignables: joignables.size,
    appareils: appareils.length,
  });
}
