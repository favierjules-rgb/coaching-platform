import { NextResponse } from "next/server";

import { choixMagasinBodySchema } from "@/lib/api/schemas/magasins";
import { parseJsonBody } from "@/lib/api/validate";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import { lireMagasinCanonique } from "@/lib/open-prices/locations";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { STORES_SELECT } from "@/lib/security/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enregistrerMagasinChoisi, upserterMagasin } from "@/lib/supabase/magasins";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES C4.3a — POST /api/student/stores/select
 *
 * L'élève choisit son magasin. C'est la SEULE route par laquelle une ligne
 * entre dans le référentiel partagé `stores`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LE NAVIGATEUR DÉSIGNE, IL NE DÉCRIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Le corps ne contient qu'un entier : `opLocationId`. Rien d'autre n'est
 * accepté — le schéma est `.strict()`, un corps qui porterait `name` ou `brand`
 * est un 400.
 *
 * Puis le serveur RELIT la fiche chez Open Prices, par cet identifiant, et
 * n'écrit que ce qu'il a relu. C'est la différence entre « je choisis ce
 * magasin-là » et « voici un magasin, enregistre-le » : sans cette relecture,
 * n'importe qui pourrait faire apparaître « Mon faux magasin » dans un
 * catalogue que TOUS les élèves lisent.
 *
 * Le coût est d'un appel sortant par sélection — un geste rare. C'est le prix
 * de ne pas faire du navigateur la source de vérité d'une donnée partagée, et
 * il est dérisoire.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX CLIENTS, DEUX PORTÉES
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

  const parsed = await parseJsonBody(request, choixMagasinBodySchema);
  if (!parsed.success) return parsed.response;

  let issue;
  try {
    issue = await lireMagasinCanonique(parsed.data.opLocationId);
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      console.error(`[Magasins] ${erreur.message}`);
      return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
    }
    console.error("[Magasins] échec inattendu de la relecture d'un magasin");
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // ⚠️ QUATRE ISSUES, QUATRE RÉPONSES — ET C'EST LE CORRECTIF DE L'AUDIT.
  //
  // Une première version rendait 404 pour TOUT : 404 amont, mais aussi 429,
  // 500, timeout et corps illisible. Un élève dont l'appel avait expiré lisait
  // « Magasin introuvable » et cherchait ailleurs un magasin qui existait.
  //
  //   `absent`         → 404, et c'est le SEUL cas où « introuvable » est vrai ;
  //   `non_exploitable`→ 404 aussi, mais pour une raison différente et dite :
  //                      la fiche existe, elle ne décrit pas un commerce
  //                      alimentaire (une librairie, un lieu sans nom) ;
  //   `indisponible`   → 503. On ne sait pas, on ne prétend pas savoir.
  if (issue.statut === "absent") {
    return NextResponse.json({ error: "Magasin introuvable.", code: "ABSENT" }, { status: 404 });
  }
  if (issue.statut === "non_exploitable") {
    return NextResponse.json(
      { error: "Ce lieu ne peut pas être choisi comme magasin.", code: "NON_EXPLOITABLE" },
      { status: 404 },
    );
  }
  if (issue.statut === "indisponible") {
    console.error(`[Magasins] relecture impossible (${issue.cause}) — aucune écriture.`);
    return NextResponse.json(
      { error: "Vérification du magasin impossible pour le moment.", code: "OPEN_PRICES_INDISPONIBLE" },
      { status: 503 },
    );
  }

  const canonique = issue.magasin;
  const upsert = await upserterMagasin(admin, canonique);

  // ⚠️ LE CAS DE FUSION EST TRAITÉ, PAS MASQUÉ. Les deux identités amont —
  // `op_location_id` et le couple OSM — désignent deux lignes différentes chez
  // nous : la source a fusionné deux enregistrements. Choisir l'une des deux
  // reviendrait à décider à la place des élèves déjà rattachés à l'autre.
  if (upsert.conflitIdentite) {
    console.error(
      `[Magasins] conflit d'identité pour op_location_id=${canonique.opLocationId} ` +
        `(${canonique.osmType}/${canonique.osmId}) — deux lignes distinctes, aucune écriture.`,
    );
    return NextResponse.json(
      { error: "Ce magasin est en double dans notre référentiel.", code: "CONFLIT_IDENTITE" },
      { status: 409 },
    );
  }
  if (upsert.erreur !== null || upsert.storeId === null) {
    console.error(`[Magasins] échec d'écriture du magasin : ${upsert.erreur ?? "aucun identifiant rendu"}`);
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
      name: canonique.name,
      brand: canonique.brand,
      city: canonique.city,
    },
  });
}
