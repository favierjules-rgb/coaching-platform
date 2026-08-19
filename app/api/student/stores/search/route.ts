import { NextResponse } from "next/server";

import { magasinsParVilleBodySchema } from "@/lib/api/schemas/magasins";
import { parseJsonBody } from "@/lib/api/validate";
import { PAYS_CODE, villeValide } from "@/lib/nutrition/magasin-proche";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import { decouvrirParVille, httpDecouverte } from "@/lib/openstreetmap/decouverte";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { STORES_SEARCH } from "@/lib/security/rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES C4.3c — POST /api/student/stores/search
 *
 * Les magasins alimentaires d'une VILLE — le chemin de repli de l'élève qui a
 * refusé la géolocalisation, dont l'appareil ne sait pas le situer, ou qui
 * préfère simplement taper le nom de sa ville.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUNE GÉOLOCALISATION N'EST REQUISE ICI
 * ────────────────────────────────────────────────────────────────────────────
 * Pas de latitude, pas de longitude, pas de rayon. C'est tout l'intérêt : un
 * refus de permission ne doit pas fermer la fonctionnalité.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CHERCHER N'EST PAS CHOISIR — LA MÊME RÈGLE QU'EN C4.3a
 * ────────────────────────────────────────────────────────────────────────────
 * Aucun insert, aucun upsert, aucun client de service. Le magasin choisi passe
 * par POST /api/student/stores/select, déjà écrite, déjà éprouvée, et qui relit
 * la fiche canonique chez la source. C4.3b n'ouvre AUCUN second chemin
 * d'écriture.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ C4.3c — LA SOURCE A CHANGÉ : OPENSTREETMAP, PLUS OPEN PRICES
 * ────────────────────────────────────────────────────────────────────────────
 * Mesuré le 19/08/2026 : Open Prices connaît DEUX lieux dans tout Toulon, dont
 * un marchand de journaux. Ce n'est pas un annuaire de magasins, et l'utiliser
 * comme tel enfermait l'élève toulonnais dans un choix unique.
 *
 * ⚠️ ET CHERCHER N'INTERROGE PAS OPEN PRICES, PAS MÊME UNE FOIS PAR RÉSULTAT.
 * Trente magasins trouvés feraient trente appels au pont — trente allers-retours
 * pour afficher une liste, et vingt-neuf réponses « inconnu » à interpréter. Le
 * pont se fait à la SÉLECTION, sur UN magasin.
 *
 * ET PAS DE CODE POSTAL : la zone administrative résout la commune, et c'est
 * elle qui décide — jamais l'étiquette `addr:city` du commerçant, qu'un
 * contributeur peut avoir oubliée.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ET PAS DE PAYS NON PLUS : C4.3b EST UNE RECHERCHE MANUELLE **FRANCE**
 * ────────────────────────────────────────────────────────────────────────────
 * Le corps ne porte QUE `ville`. Le pays est une constante serveur, envoyée à
 * l'amont sous forme de nom (`osm_address_country__like=France`) pour borner
 * le domaine AVANT pagination, puis reconfirmée au retour sur le code ISO.
 */

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
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

  const quota = await consumeRateLimit(rateLimitKey([STORES_SEARCH.name, user.id]), STORES_SEARCH);
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de recherches à la suite. Réessaie dans une minute.");
  }

  const parsed = await parseJsonBody(request, magasinsParVilleBodySchema);
  if (!parsed.success) return parsed.response;

  // Seconde barrière, volontairement redondante — même doctrine que le rayon en
  // C4.3a. Le schéma connaît les bornes ; ce sont ces fonctions qui portent la
  // RÈGLE, et c'est la règle qui doit gagner si les deux venaient à diverger.
  const ville = parsed.data.ville.trim();
  if (!villeValide(ville)) {
    return NextResponse.json({ error: "Nom de ville invalide." }, { status: 400 });
  }

  // ⚠️ LE PAYS N'EST PAS LU DANS LA REQUÊTE — IL N'Y EST PAS. C'est une
  // constante serveur, et le corps `.strict()` refuse tout champ `pays`. Le
  // navigateur ne choisit donc pas le pays de recherche d'un lot qui n'en
  // connaît qu'un.
  try {
    const resultat = await decouvrirParVille(ville);

    // ⚠️ SEPT ISSUES, SEPT RÉPONSES — ET AUCUNE PANNE NE DIT « INTROUVABLE ».
    // C'est la correction faite en C4.3a sur la sélection, appliquée ici : un
    // élève dont l'appel a expiré ne doit pas conclure que sa ville n'existe
    // pas. « Cette ville n'existe pas », « il y en a plusieurs », « je n'ai pas
    // pu chercher » et « aucun magasin cartographié » sont quatre phrases.
    if (resultat.statut === "echec") {
      const { status, code } = httpDecouverte(resultat.raison);
      return NextResponse.json({ error: messageDe(resultat.raison), code }, { status });
    }

    return NextResponse.json({
      magasins: resultat.magasins,
      tronque: resultat.tronque,
      ville,
      // Renvoyé pour que l'écran puisse le dire, jamais reçu : c'est le serveur
      // qui l'énonce.
      pays: PAYS_CODE,
    });
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      console.error(`[Magasins] ${erreur.message}`);
      return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
    }
    // ⚠️ AUCUNE VILLE DANS LES JOURNAUX. Ce n'est pas une coordonnée, mais
    // c'est tout de même une indication d'endroit.
    console.error("[Magasins] échec inattendu de la recherche par ville");
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }
}

/**
 * Un message pour l'élève — et rien qui décrive notre plomberie.
 *
 * ⚠️ « PRÉCISE TA RECHERCHE » EST UNE PHRASE UTILE ; « zone administrative
 * ambiguë » n'en est pas une. Le code technique voyage à part, pour les
 * journaux et les tests ; le texte, lui, dit quoi faire.
 */
function messageDe(raison: Parameters<typeof httpDecouverte>[0]): string {
  switch (raison) {
    case "ville_introuvable":
      return "Aucune commune française de ce nom.";
    case "ville_ambigue":
      return "Plusieurs communes portent ce nom. Précise ta recherche.";
    case "rate_limited":
      return "Trop de recherches en cours. Réessaie dans une minute.";
    case "timeout":
      return "La recherche a été trop longue. Réessaie.";
    default:
      return "La recherche de magasins a échoué.";
  }
}
