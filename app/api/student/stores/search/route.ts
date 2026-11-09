import { NextResponse } from "next/server";

import { magasinsParVilleBodySchema } from "@/lib/api/schemas/magasins";
import { parseJsonBody } from "@/lib/api/validate";
import { codeInseeValide } from "@/lib/communes/bornes";
import { PAYS_CODE, villeValide } from "@/lib/nutrition/magasin-proche";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import {
  decouvrirParCodeInsee,
  decouvrirParVille,
  httpDecouverte,
} from "@/lib/openstreetmap/decouverte";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { STORES_SEARCH } from "@/lib/security/rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * ⚠️ LA FONCTION DOIT POUVOIR ATTENDRE OVERPASS, SINON LA BORNE NE SERT À RIEN.
 *
 * Mesuré le 05/11/2026 : `overpass-api.de` n'accorde que DEUX créneaux par
 * adresse IP, et une requête triviale a mis 20,4 s en pure attente de créneau.
 * Notre borne interne est à 45 s, avec un budget de 55 s réessais compris.
 * Si la plateforme coupe la fonction à 10 s — le défaut de Vercel — tout ce
 * travail est annulé par l'hébergeur, et l'élève lit « la recherche n'a pas
 * abouti » sans qu'aucun de nos messages n'ait eu la parole.
 *
 * ⚠️ 60 s EST LE PLAFOND DES OFFRES D'ENTRÉE. Le demander plus haut ferait
 * échouer le déploiement au lieu d'allonger le délai.
 */
export const maxDuration = 60;

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

  /*
   * ════════════════════════════════════════════════════════════════════════
   * DEUX ENTRÉES, ET LA PREMIÈRE EST LA BONNE
   * ════════════════════════════════════════════════════════════════════════
   * `codeInsee` — l'élève a CHOISI une commune dans les suggestions. Une
   * commune, un code, aucune ambiguïté possible : c'est le chemin normal, et
   * c'est l'étape de géocodage que l'énoncé demande.
   *
   * `ville` — le repli, quand l'annuaire des communes était indisponible. La
   * résolution par nom reste possible, et peut encore répondre « plusieurs
   * communes portent ce nom » : c'est moins bien, et c'est mieux que rien.
   *
   * ⚠️ LE CODE EST REVÉRIFIÉ ICI. Le schéma l'a déjà filtré ; cette barrière
   * est volontairement redondante — même doctrine que le rayon en C4.3a. Le
   * schéma connaît la forme, c'est cette fonction qui porte la RÈGLE, et c'est
   * la règle qui doit gagner si les deux venaient à diverger.
   */
  const codeInsee = parsed.data.codeInsee;
  const villeSaisie = parsed.data.ville?.trim();

  if (codeInsee !== undefined && !codeInseeValide(codeInsee)) {
    return NextResponse.json({ error: "Commune invalide." }, { status: 400 });
  }
  if (codeInsee === undefined) {
    if (villeSaisie === undefined || !villeValide(villeSaisie)) {
      return NextResponse.json({ error: "Nom de ville invalide." }, { status: 400 });
    }
  }

  // ⚠️ LE PAYS N'EST PAS LU DANS LA REQUÊTE — IL N'Y EST PAS. C'est une
  // constante serveur, et le corps `.strict()` refuse tout champ `pays`. Le
  // navigateur ne choisit donc pas le pays de recherche d'un lot qui n'en
  // connaît qu'un.
  const debutMs = Date.now();
  try {
    const resultat =
      codeInsee !== undefined
        ? await decouvrirParCodeInsee(codeInsee)
        : await decouvrirParVille(villeSaisie as string);

    // ⚠️ SEPT ISSUES, SEPT RÉPONSES — ET AUCUNE PANNE NE DIT « INTROUVABLE ».
    // C'est la correction faite en C4.3a sur la sélection, appliquée ici : un
    // élève dont l'appel a expiré ne doit pas conclure que sa ville n'existe
    // pas. « Cette ville n'existe pas », « il y en a plusieurs », « je n'ai pas
    // pu chercher » et « aucun magasin cartographié » sont quatre phrases.
    if (resultat.statut === "echec") {
      const { status, code } = httpDecouverte(resultat.raison);
      /*
       * ⚠️ UNE TRACE EXPLOITABLE, ET AUCUNE DONNÉE PERSONNELLE DEDANS.
       *
       * On journalise la RAISON, le mode, la durée et le département — de quoi
       * répondre à « pourquoi ça échoue ? » et « est-ce une saturation ou une
       * panne ? » dans les journaux Vercel.
       *
       * ⚠️ NI LE NOM DE LA COMMUNE, NI LE CODE INSEE COMPLET, NI L'IDENTITÉ DE
       * L'ÉLÈVE. Une commune n'est pas une adresse, mais c'est une indication
       * d'endroit, et associée à un identifiant d'élève elle en devient une.
       * Le département suffit à voir si un territoire est plus touché qu'un
       * autre, et ne désigne personne.
       */
      console.warn(
        `[Magasins] recherche échouée raison=${resultat.raison} code=${code} ` +
          `mode=${codeInsee !== undefined ? "insee" : "nom"} ` +
          `dept=${codeInsee !== undefined ? codeInsee.slice(0, 2) : "?"} ` +
          `duree_ms=${Date.now() - debutMs}`,
      );
      return NextResponse.json({ error: messageDe(resultat.raison), code }, { status });
    }

    // ⚠️ LES SUCCÈS LENTS SE JOURNALISENT AUSSI. Une recherche qui aboutit en
    // 40 s n'est pas une panne, mais c'est le signe avant-coureur de celle de
    // demain : sans trace, on ne la verrait qu'une fois cassée.
    const dureeMs = Date.now() - debutMs;
    if (dureeMs > 15_000) {
      console.warn(
        `[Magasins] recherche lente duree_ms=${dureeMs} ` +
          `mode=${codeInsee !== undefined ? "insee" : "nom"} resultats=${resultat.magasins.length}`,
      );
    }

    return NextResponse.json({
      magasins: resultat.magasins,
      tronque: resultat.tronque,
      // ⚠️ CE QUI EST RENVOYÉ EST CE QUI A SERVI À CHERCHER, pas ce que l'élève
      // a tapé : l'écran doit pouvoir dire sur quelle commune il affiche.
      ville: villeSaisie ?? null,
      codeInsee: codeInsee ?? null,
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
    /*
     * ⚠️ « SATURÉ » N'EST PAS « EN PANNE », ET LA NUANCE EST UTILE. Le serveur
     * cartographique est plein pour quelques secondes ; nous avons déjà
     * réessayé. Dire à l'élève que réessayer a des chances de marcher lui
     * évite de conclure que la fonctionnalité est cassée.
     */
    case "at_capacity":
      return "Le service de cartographie est saturé en ce moment. Réessaie dans quelques secondes.";
    case "timeout":
      return "La recherche a été trop longue. Réessaie.";
    default:
      return "La recherche de magasins a échoué.";
  }
}
