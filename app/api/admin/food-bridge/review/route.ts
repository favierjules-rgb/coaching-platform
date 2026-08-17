import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/authz";
import { reviewBodySchema } from "@/lib/api/schemas/food-bridge";
import { parseJsonBody } from "@/lib/api/validate";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enregistrerRevue, lireAlimentDuPont } from "@/lib/supabase/pont-retail";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES C4.1 — POST /api/admin/food-bridge/review
 *
 * Enregistre la décision de curation d'un aliment SANS produit rapproché :
 * hors périmètre, forme cuite, ou à revoir.
 *
 * ⚠️ CETTE ROUTE NE PEUT PAS DÉCLARER UN ALIMENT « RAPPROCHÉ ». Le schéma
 * n'accepte que les trois statuts de `STATUTS_REVUE`, et le CHECK de la
 * migration refuse le reste en base. Le rapprochement se DÉRIVE de
 * `food_products.food_id` — s'il pouvait aussi se déclarer ici, on aurait deux
 * vérités, et le jour où elles divergeraient on croirait la plus lisible.
 *
 * ⚠️ ÉCRITURE PAR `service_role`, comme le reste du lot : la table n'accorde
 * que `select` à `authenticated`, et encore, filtré par `is_admin()`.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, reviewBodySchema);
  if (!parsed.success) return parsed.response;
  const { catalogFoodId, status, note } = parsed.data;

  const acces = await requireAdmin();
  if (!acces.ok) return acces.response;

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  const aliment = await lireAlimentDuPont(supabase, catalogFoodId);
  if (!aliment) {
    return NextResponse.json({ error: "Aliment introuvable." }, { status: 404 });
  }

  const ok = await enregistrerRevue(admin, {
    catalogFoodId,
    status,
    // `note` absente ou nulle → `null`. Jamais une chaîne vide : le CHECK
    // `note_non_vide` la refuserait, et une note blanche serait de toute façon
    // une note qu'on croit avoir écrite.
    note: note && note.trim() !== "" ? note.trim() : null,
    reviewedBy: acces.user.id,
  });

  if (!ok) {
    return NextResponse.json({ error: "L'enregistrement de la décision a échoué." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status });
}
