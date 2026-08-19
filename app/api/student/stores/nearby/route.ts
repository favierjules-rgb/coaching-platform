import { NextResponse } from "next/server";

import { magasinsProchesBodySchema } from "@/lib/api/schemas/magasins";
import { parseJsonBody } from "@/lib/api/validate";
import { bornerRayon } from "@/lib/nutrition/magasin-proche";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import { decouvrirAutour, httpDecouverte } from "@/lib/openstreetmap/decouverte";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { STORES_NEARBY } from "@/lib/security/rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES C4.3c — POST /api/student/stores/nearby
 *
 * Les magasins alimentaires autour d'une position, pour que l'élève en
 * choisisse un.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ CHERCHER N'EST PAS CHOISIR : CETTE ROUTE N'ÉCRIT RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * Aucun `insert`, aucun `upsert`, aucun client `service_role`. Une recherche
 * qui déposerait au passage les magasins rencontrés remplirait le référentiel
 * partagé de lieux que personne n'a choisis — et ferait d'un simple regard un
 * acte d'écriture.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI UN POST POUR UNE LECTURE
 * ────────────────────────────────────────────────────────────────────────────
 * Parce que le corps de la requête porte la POSITION de quelqu'un. En chaîne de
 * requête, elle finirait dans les journaux d'accès, l'historique du navigateur
 * et l'en-tête `Referer` de la page suivante. La sémantique HTTP cède ici
 * devant la confidentialité, et c'est un arbitrage assumé.
 *
 * ⚠️ ELLE N'EST PAS UN PROXY. Le client envoie une position et, au plus, un
 * rayon — validé contre NOTRE borne. Ni la taille de page, ni le numéro de
 * page, ni un champ libre ne traversent : sans quoi n'importe qui pourrait
 * interroger l'amont à sa guise à travers SETH, avec notre débit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ C4.3c — L'ANNUAIRE EST DÉSORMAIS OPENSTREETMAP
 * ────────────────────────────────────────────────────────────────────────────
 * Rien d'autre ne change : même écran, même position, même confidentialité,
 * mêmes trois barrières sur le rayon. Seule la source des magasins est
 * remplacée, parce qu'Open Prices est une source de PRIX et n'a jamais été un
 * annuaire — mesuré à Toulon : deux lieux pour ~180 000 habitants.
 *
 * ⚠️ ET AUCUN PONT OPEN PRICES N'EST TENTÉ ICI. Vingt magasins autour de soi
 * feraient vingt appels sortants pour afficher une liste. Le pont se fait à la
 * SÉLECTION, sur UN magasin.
 */

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // 1. L'identité vient de la session, jamais du corps.
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

  const quota = await consumeRateLimit(rateLimitKey([STORES_NEARBY.name, user.id]), STORES_NEARBY);
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de recherches à la suite. Réessaie dans une minute.");
  }

  // 2. L'entrée est bornée ICI, et le schéma refuse toute clé inconnue.
  const parsed = await parseJsonBody(request, magasinsProchesBodySchema);
  if (!parsed.success) return parsed.response;

  // ⚠️ SECONDE BARRIÈRE, VOLONTAIREMENT REDONDANTE. Le schéma connaît déjà les
  // bornes, mais c'est `bornerRayon` qui porte la règle produit — et c'est lui
  // qui pose le défaut quand le client n'a rien demandé. Un jour où les deux
  // divergeraient, c'est la règle qui doit gagner, pas la validation d'entrée.
  const rayonKm = bornerRayon(parsed.data.rayonKm);
  if (rayonKm === null) {
    return NextResponse.json({ error: "Rayon de recherche hors bornes." }, { status: 400 });
  }

  try {
    const resultat = await decouvrirAutour({
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      rayonKm,
    });

    // ⚠️ « AUCUN MAGASIN » ET « LECTURE ÉCHOUÉE » SONT DEUX RÉPONSES
    // DIFFÉRENTES. Les confondre ferait dire « aucun magasin près de vous » à
    // quelqu'un dont le réseau a lâché — et il chercherait ailleurs pour rien.
    // Chaque panne garde ici son code propre : attendre, réessayer, ou signaler.
    if (resultat.statut === "echec") {
      const { status, code } = httpDecouverte(resultat.raison);
      return NextResponse.json({ error: "La recherche de magasins a échoué.", code }, { status });
    }

    // ⚠️ LA POSITION REÇUE NE REVIENT PAS DANS LA RÉPONSE. La renvoyer la
    // ferait entrer dans le cache du navigateur et dans tout intermédiaire du
    // chemin. Le rayon, lui, est CELUI QUE NOUS AVONS RETENU — pas celui qui a
    // été demandé : l'écran doit pouvoir dire ce qui a réellement été cherché.
    return NextResponse.json({
      magasins: resultat.magasins,
      tronque: resultat.tronque,
      rayonKm,
    });
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      console.error(`[Magasins] ${erreur.message}`);
      return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
    }
    // ⚠️ AUCUNE COORDONNÉE DANS LES JOURNAUX. Le message d'erreur est
    // volontairement muet sur ce qui a été cherché : une trace serveur qui
    // contiendrait la position de l'élève serait exactement la persistance
    // qu'on s'interdit.
    console.error("[Magasins] échec inattendu de la recherche de magasins proches");
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }
}
