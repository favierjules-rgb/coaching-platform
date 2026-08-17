import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/authz";
import { detachBodySchema, matchBodySchema } from "@/lib/api/schemas/food-bridge";
import { parseJsonBody } from "@/lib/api/validate";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import { estOffErreur } from "@/lib/open-food-facts/contrat";
import { chercherProduitsParCodeCiqual } from "@/lib/open-food-facts/recherche-ciqual";
import { codeCiqualEstValide } from "@/lib/nutrition/pont-retail";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enregistrerProduit } from "@/lib/supabase/food-products";
import {
  detacherProduit,
  effacerRevue,
  lireAlimentDuPont,
  rapprocherProduits,
} from "@/lib/supabase/pont-retail";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES C4.1 — POST /api/admin/food-bridge/match
 *                DELETE /api/admin/food-bridge/match
 *
 * Rattache — ou détache — des produits Open Food Facts RÉELS à un aliment
 * générique du catalogue.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI CETTE ROUTE, ET PAS UNE RPC
 * ════════════════════════════════════════════════════════════════════════════
 * `food_products` n'accorde AUCUN privilège d'écriture à `authenticated` :
 * `revoke all`, puis `grant select` seul. Une RPC `security definer` serait le
 * PREMIER chemin d'écriture cliente vers ce cache global — donc exactement ce
 * que cette serrure interdit, rouvert par une porte de service. On emprunte
 * donc le chemin qui remplit DÉJÀ cette table : une route serveur, avec le
 * client `service_role`, après vérification du rôle.
 *
 * ⚠️ Le client `service_role` n'a plus de RLS pour le protéger. Tout ce qui
 * suit est donc écrit comme si la base ne défendait plus rien — parce que c'est
 * le cas.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ L'INVARIANT CENTRAL : UN CODE-BARRES POSTÉ NE SUFFIT PAS
 * ════════════════════════════════════════════════════════════════════════════
 * La route NE FAIT PAS CONFIANCE aux codes-barres qu'on lui envoie. Elle
 * relance la recherche structurée par le code Ciqual DE CET ALIMENT, et
 * n'accepte que les codes qui s'y trouvent réellement.
 *
 * Sans cela, un administrateur — ou un jeton d'administrateur volé — pourrait
 * faire écrire n'importe quel produit du monde dans le cache global, et le
 * rattacher à n'importe quel aliment. Le rapprochement serait « manuel », donc
 * crédible, et un élève verrait un jour le prix d'un pot de peinture en face de
 * son riz.
 *
 * Le coût est UN appel sortant de plus. C'est le prix d'un lien qui ne peut pas
 * être fabriqué.
 */

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, matchBodySchema);
  if (!parsed.success) return parsed.response;
  const { catalogFoodId, gtins } = parsed.data;

  const acces = await requireAdmin();
  if (!acces.ok) return acces.response;

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // L'aliment doit exister — sinon la contrainte de clé étrangère refuserait
  // l'écriture, mais avec un message illisible et après un appel réseau inutile.
  const aliment = await lireAlimentDuPont(supabase, catalogFoodId);
  if (!aliment) {
    return NextResponse.json({ error: "Aliment introuvable." }, { status: 404 });
  }
  if (aliment.codeCiqual === null || !codeCiqualEstValide(aliment.codeCiqual)) {
    return NextResponse.json(
      {
        error:
          "Cet aliment n'a pas de code Ciqual exploitable : aucun rapprochement structuré n'est possible.",
        code: "CIQUAL_ABSENT",
      },
      { status: 422 },
    );
  }

  let candidats: Awaited<ReturnType<typeof chercherProduitsParCodeCiqual>>;
  try {
    candidats = await chercherProduitsParCodeCiqual(aliment.codeCiqual);
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      console.error(`[OpenFoodFacts] ${erreur.message}`);
      return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
    }
    if (estOffErreur(erreur)) {
      return NextResponse.json(
        { error: "Impossible de vérifier les candidats auprès d'Open Food Facts.", code: erreur.code },
        { status: erreur.code === "OFF_RATE_LIMITED" ? 429 : 503 },
      );
    }
    throw erreur;
  }

  const parGtin = new Map(candidats.importables.map((c) => [c.gtin, c.produit]));
  const refuses = gtins.filter((g) => !parGtin.has(g));
  if (refuses.length > 0) {
    // ⚠️ ON REFUSE LE LOT ENTIER, pas seulement les codes fautifs. Un
    // rapprochement partiel silencieux laisserait l'administrateur croire que
    // tout est passé, et l'écart ne se verrait qu'à l'usage.
    return NextResponse.json(
      {
        error:
          "Certains codes-barres ne figurent pas parmi les candidats structurés de cet aliment.",
        code: "CANDIDAT_HORS_RECHERCHE",
        refuses,
      },
      { status: 422 },
    );
  }

  // ── 1. HYDRATER — par le chemin existant, sans le réécrire ────────────────
  // `enregistrerProduit` est la fonction du lot A3 : c'est elle qui connaît le
  // `on conflict (gtin)`, le `source_fetched_at` et le stockage d'audit.
  const maintenant = new Date();
  const ecrits: string[] = [];
  for (const gtin of gtins) {
    const produit = parGtin.get(gtin);
    if (!produit) continue;
    // `payloadBrut` reste nul : la charge d'une recherche contient vingt-cinq
    // fiches partielles, et sa seule raison d'être — auditer CE produit — n'est
    // pas remplie. Même arbitrage qu'en Phase 4.
    const ligne = await enregistrerProduit(admin, produit, null, maintenant);
    if (ligne) ecrits.push(gtin);
  }
  if (ecrits.length === 0) {
    return NextResponse.json(
      { error: "Aucun produit n'a pu être enregistré." },
      { status: 502 },
    );
  }

  // ── 2. RAPPROCHER — trois colonnes nommées en dur ─────────────────────────
  const resultat = await rapprocherProduits(admin, ecrits, catalogFoodId);
  if (!resultat.ok) {
    console.error(`[PontRetail] rapprochement refusé : ${resultat.erreur}`);
    return NextResponse.json({ error: "Le rapprochement a échoué." }, { status: 502 });
  }

  // ── 3. NETTOYER LA REVUE DEVENUE CADUQUE ──────────────────────────────────
  // ⚠️ Son échec n'est PAS fatal : l'invariant qui protège est la priorité de
  // `matched` dans `etatRapprochement`, pas ce `delete` de confort.
  const revueEffacee = await effacerRevue(admin, catalogFoodId);
  if (!revueEffacee) {
    console.warn(
      `[PontRetail] revue non effacée pour ${catalogFoodId} — sans conséquence : « matched » prime.`,
    );
  }

  return NextResponse.json({ ok: true, rapproches: resultat.rapproches, gtins: ecrits });
}

/**
 * Détache un produit de son aliment.
 *
 * ⚠️ `food_id` ET `match_status` TOMBENT ENSEMBLE. Laisser `match_status =
 * 'manual'` derrière un `food_id` nul fabriquerait à la main l'état piégeux que
 * seul un `on delete set null` devrait pouvoir produire.
 */
export async function DELETE(request: Request) {
  const parsed = await parseJsonBody(request, detachBodySchema);
  if (!parsed.success) return parsed.response;

  const acces = await requireAdmin();
  if (!acces.ok) return acces.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  const resultat = await detacherProduit(admin, parsed.data.gtin);
  if (!resultat.ok) {
    console.error(`[PontRetail] détachement refusé : ${resultat.erreur}`);
    return NextResponse.json({ error: "Le détachement a échoué." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, detaches: resultat.rapproches });
}
