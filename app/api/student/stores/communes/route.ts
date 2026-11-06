import { NextResponse } from "next/server";

import { communesBodySchema } from "@/lib/api/schemas/magasins";
import { parseJsonBody } from "@/lib/api/validate";
import { suggererCommunes } from "@/lib/communes/annuaire";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { STORES_COMMUNES } from "@/lib/security/rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES — POST /api/student/stores/communes
 *
 * Les communes françaises dont le nom approche la saisie de l'élève. C'est
 * L'ÉTAPE DE GÉOCODAGE : elle transforme une chaîne tapée en communes nommées,
 * chacune avec son code INSEE, parmi lesquelles l'élève choisit explicitement.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI PASSER PAR NOTRE SERVEUR PLUTÔT QU'APPELER L'ANNUAIRE DU NAVIGATEUR
 * ────────────────────────────────────────────────────────────────────────────
 * Un appel direct depuis le navigateur enverrait à un tiers la saisie de
 * l'élève ET son adresse IP, à chaque frappe, hors de toute limite de débit.
 * C'est la même doctrine que `nearby` et `search`, et elle n'a pas d'exception.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CETTE ROUTE NE CHERCHE AUCUN COMMERCE, ET N'ÉCRIT RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN APPEL À OVERPASS. Suggérer une commune et chercher ses commerces
 * sont deux gestes : les fondre en un seul ferait partir une requête Overpass à
 * chaque frappe. La recherche de commerces reste `POST /search`, avec le code
 * INSEE du choix.
 *
 * ⚠️ AUCUNE ÉCRITURE, aucun client de service, aucune table touchée.
 *
 * ⚠️ ET AUCUNE SAISIE DANS LES JOURNAUX. Ce n'est pas une coordonnée, mais
 * c'est une indication d'endroit — même règle que pour la ville.
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
  /*
   * ⚠️ L'EXISTENCE DU PROFIL ÉLÈVE EST VÉRIFIÉE, COMME SUR LES AUTRES ROUTES.
   * Un compte authentifié sans fiche élève n'a rien à faire dans un parcours
   * de courses, et ouvrir un annuaire à tout compte connecté en ferait un
   * service de géocodage gratuit adossé à notre limite de débit.
   */
  const { data: eleve } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!eleve) {
    return NextResponse.json({ error: "Aucun profil élève." }, { status: 403 });
  }

  const quota = await consumeRateLimit(
    rateLimitKey([STORES_COMMUNES.name, user.id]),
    STORES_COMMUNES,
  );
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de recherches à la suite. Réessaie dans un instant.");
  }

  const parsed = await parseJsonBody(request, communesBodySchema);
  if (!parsed.success) return parsed.response;

  try {
    const resultat = await suggererCommunes(parsed.data.saisie);
    if (resultat.statut === "echec") {
      /*
       * ⚠️ TROIS RAISONS, ET AUCUNE NE DIT « AUCUNE COMMUNE ». Une saisie trop
       * courte, un annuaire en panne et un appel trop long sont trois choses ;
       * les confondre avec « cette commune n'existe pas » enverrait l'élève
       * corriger une saisie correcte.
       */
      const status = resultat.raison === "saisie_trop_courte" ? 400 : 503;
      return NextResponse.json(
        { error: messageDe(resultat.raison), code: resultat.raison },
        { status },
      );
    }
    /*
     * ⚠️ UNE LISTE VIDE EST UN SUCCÈS, PAS UNE ERREUR. « Aucune commune ne
     * porte ce nom » est une information utile, et c'est à l'écran de la dire ;
     * un 404 ferait rougir la console du navigateur à chaque frappe.
     */
    return NextResponse.json({ communes: resultat.communes });
  } catch {
    console.error("[Communes] échec inattendu de la suggestion");
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }
}

function messageDe(raison: "saisie_trop_courte" | "indisponible" | "timeout"): string {
  switch (raison) {
    case "saisie_trop_courte":
      return "Tape au moins deux lettres.";
    case "timeout":
      return "La recherche de communes a été trop longue. Réessaie.";
    case "indisponible":
      return "L'annuaire des communes est momentanément indisponible. Tu peux chercher par nom de ville.";
  }
}
