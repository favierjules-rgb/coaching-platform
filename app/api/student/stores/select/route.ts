import { NextResponse } from "next/server";

import { choixMagasinOsmBodySchema } from "@/lib/api/schemas/magasins";
import { parseJsonBody } from "@/lib/api/validate";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import { lirePontOsm, pontPourEcriture } from "@/lib/open-prices/pont-osm";
import { httpDecouverte, lireElementCanonique } from "@/lib/openstreetmap/decouverte";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { STORES_SELECT } from "@/lib/security/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enregistrerMagasinChoisi } from "@/lib/supabase/magasins";
import { upserterMagasinOsm, type PontConnu } from "@/lib/supabase/magasins-osm";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES C4.3c — POST /api/student/stores/select
 *
 * L'élève choisit son magasin. C'est la SEULE route par laquelle une ligne
 * entre dans le référentiel partagé `stores`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE NAVIGATEUR DÉSIGNE, IL NE DÉCRIT PAS
 * ════════════════════════════════════════════════════════════════════════════
 * Le corps ne contient qu'une IDENTITÉ : `{ osmType, osmId }`. Rien d'autre
 * n'est accepté — le schéma est `.strict()`, un corps qui porterait `name`,
 * `lat` ou `brand` est un 400. Puis le serveur RELIT la fiche chez
 * OpenStreetMap, par cette identité, et n'écrit que ce qu'il a relu.
 *
 * Sans cette relecture, n'importe qui ferait apparaître « Mon faux magasin »,
 * aux coordonnées de son choix, dans un catalogue que TOUS les élèves lisent.
 *
 * ⚠️ ET `opLocationId` NE VIENT PLUS DU NAVIGATEUR — IL N'Y EST MÊME PLUS
 * ACCEPTÉ. Le laisser voyager permettrait de rattacher son magasin aux prix
 * d'un autre : un commerce cher affiché aux prix d'un discounter, en base,
 * pour tout le monde. Le pont est établi ici, par un appel EXACT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE PONT EST TENTÉ, PAS EXIGÉ
 * ════════════════════════════════════════════════════════════════════════════
 * OpenStreetMap est l'identité primaire ; Open Prices n'est qu'une source de
 * prix. Un magasin réel qu'Open Prices ignore doit pouvoir être choisi — c'est
 * le cas ORDINAIRE, mesuré à Toulon : deux lieux connus pour ~180 000 habitants.
 *
 * Et une PANNE d'Open Prices à cet instant ne doit pas davantage empêcher le
 * choix. Elle ne doit surtout pas être enregistrée comme une absence prouvée :
 * un 404 est une preuve, un 503 n'en est pas une, et la différence est portée
 * jusqu'à l'écriture par `PontConnu`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX CLIENTS, DEUX PORTÉES — inchangé depuis C4.3a
 * ────────────────────────────────────────────────────────────────────────────
 *   `admin`    (service_role) → `stores` seulement, dont la serrure de C4.2
 *                               n'accorde que `select` à `authenticated` ;
 *   `supabase` (l'élève)      → `student_selected_store`, pour que la RLS reste
 *                               le dernier rempart de l'isolation entre élèves.
 */

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }
  const { data: eleve } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!eleve) {
    return NextResponse.json({ error: "Aucun profil élève." }, { status: 403 });
  }
  const studentId = (eleve as { id: string }).id;

  const quota = await consumeRateLimit(rateLimitKey([STORES_SELECT.name, user.id]), STORES_SELECT);
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de changements de magasin. Réessaie dans une minute.");
  }

  const parsed = await parseJsonBody(request, choixMagasinOsmBodySchema);
  if (!parsed.success) return parsed.response;
  const { osmType, osmId } = parsed.data;

  // ── 1. LA FICHE CANONIQUE, RELUE CHEZ OPENSTREETMAP ──────────────────────
  let canonique;
  try {
    canonique = await lireElementCanonique(osmType, osmId);
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      console.error(`[Magasins] ${erreur.message}`);
      return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
    }
    console.error("[Magasins] échec inattendu de la relecture d'un magasin");
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // ⚠️ TROIS REFUS DIFFÉRENTS, TROIS MESSAGES — la correction de l'audit C4.3a,
  // conservée. « Ce lieu n'existe pas », « ce lieu n'est pas un magasin » et
  // « je n'ai pas pu vérifier » mènent à trois conduites différentes.
  if (canonique.statut === "absent") {
    return NextResponse.json({ error: "Magasin introuvable.", code: "ABSENT" }, { status: 404 });
  }
  if (canonique.statut === "non_exploitable") {
    return NextResponse.json(
      { error: "Ce lieu ne peut pas être choisi comme magasin.", code: "NON_EXPLOITABLE" },
      { status: 404 },
    );
  }
  if (canonique.statut === "echec") {
    const { status, code } = httpDecouverte(canonique.raison);
    console.error("[Magasins] vérification du magasin impossible — aucune écriture.");
    return NextResponse.json(
      { error: "Vérification du magasin impossible pour le moment.", code },
      { status },
    );
  }
  const magasin = canonique.magasin;

  // ── 2. LE PONT OPEN PRICES — TENTÉ, JAMAIS EXIGÉ ─────────────────────────
  //
  // ⚠️ AUCUN `return` D'ERREUR NE SUIT CE BLOC, ET C'EST LE CONTRAT. Le pont
  // renseigne les PRIX ; il ne conditionne pas le CHOIX. Un 429 ou un 503 ici
  // laisse simplement le magasin sans pont connu — un état que C4.4 sait dire.
  let pont: PontConnu = { statut: "indetermine" };
  try {
    // ⚠️ UNE FONCTION TOTALE, ET AUCUN AIGUILLAGE ÉCRIT ICI. `pontPourEcriture`
    // ne peut pas rendre « refuse » : la garantie « une panne n'empêche pas de
    // choisir » est portée par le TYPE, pas par la vigilance de cette route.
    // Seul le 404 y devient `absent` — traduire une panne en absence ferait
    // écrire une PREUVE fausse, qui survivrait à la panne.
    pont = pontPourEcriture(await lirePontOsm(osmType, osmId));
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      // La configuration manque : on le trace, et on continue SANS pont.
      console.error(`[Magasins] ${erreur.message}`);
    } else {
      console.error("[Magasins] pont Open Prices indisponible — sélection maintenue.");
    }
  }

  // ── 3. L'ÉCRITURE, PAR IDENTITÉ OSM ──────────────────────────────────────
  const upsert = await upserterMagasinOsm(admin, magasin, pont);

  // ⚠️ LA DIVERGENCE EST TRAITÉE, PAS MASQUÉE. Le pont désigne une ligne dont
  // l'identité OSM n'est pas celle-ci, ou contredit un pont déjà connu :
  // trancher reviendrait à décider à la place des élèves déjà rattachés.
  if (upsert.divergence) {
    console.error("[Magasins] divergence d'identité — aucune écriture.");
    return NextResponse.json(
      { error: "Ce magasin est en double dans notre référentiel.", code: "CONFLIT_IDENTITE" },
      { status: 409 },
    );
  }
  if (upsert.erreur !== null || upsert.storeId === null) {
    console.error(`[Magasins] échec d'écriture du magasin : ${upsert.erreur ?? "aucun identifiant"}`);
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 503 });
  }

  const choix = await enregistrerMagasinChoisi(supabase, studentId, upsert.storeId);
  if (!choix.ok) {
    console.error(`[Magasins] échec d'enregistrement du choix : ${choix.erreur}`);
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 503 });
  }

  return NextResponse.json({
    magasin: {
      storeId: upsert.storeId,
      name: magasin.name,
      brand: magasin.brand,
      city: magasin.city,
    },
    // ⚠️ L'ÉTAT DE COUVERTURE, PAS L'IDENTIFIANT AMONT. L'écran a besoin de
    // savoir s'il y aura des prix ; il n'a aucun usage d'un identifiant Open
    // Prices, et le lui donner l'inviterait à s'en servir.
    couvertureMagasin:
      upsert.opLocationId === null ? "magasin_sans_couverture_prix" : "magasin_ponte",
  });
}
