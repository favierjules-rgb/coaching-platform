import "server-only";

import { OFF_TIMEOUT_MS } from "@/lib/open-food-facts/contrat";
import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";
import type { TypeOsm } from "@/lib/nutrition/magasins-osm";
import { OPEN_PRICES_API_VERSION, OPEN_PRICES_BASE_URL } from "@/lib/open-prices/apercu";

/**
 * COURSES C4.3c — LE PONT EXACT ENTRE UNE IDENTITÉ OSM ET UN LIEU OPEN PRICES.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CE PONT EXISTE VRAIMENT, ET IL EST EXACT
 * ════════════════════════════════════════════════════════════════════════════
 * Open Prices recopie les identifiants OpenStreetMap de ses lieux et expose une
 * route dédiée pour les interroger :
 *
 *     @action(detail=False, methods=["GET"],
 *             url_path=r"osm/(?P<osm_type>\w+)/(?P<osm_id>\d+)")
 *     → get_object_or_drf_404(Location, osm_type=…, osm_id=…)
 *
 * Vérifié en production le 19/08/2026 : `GET /api/v1/locations/osm/NODE/
 * 9928912836` rend 200, l'identifiant 4877, « Naturalia », `price_count: 1`.
 *
 * C'est un `get_object_or_404` sur DEUX colonnes — donc une correspondance
 * exacte, ou rien. C'est ce qui rend la découverte par OSM possible sans
 * jamais rapprocher deux magasins par leur nom.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUN RAPPROCHEMENT APPROCHANT, ICI NI AILLEURS
 * ════════════════════════════════════════════════════════════════════════════
 * `osm_id` et `osm_type` NE SONT PAS filtrables sur `/api/v1/locations` —
 * mesuré : seuls `osm_name`, `osm_address_city`, `osm_address_country` et
 * `price_count` le sont. La tentation serait donc de chercher « Naturalia » à
 * « Toulon » et de prendre le premier. Ce serait rattacher un magasin aux prix
 * d'un autre, en silence, dans un référentiel partagé. Cette route exacte est
 * précisément ce qui rend cette tentation inutile.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ TROIS ISSUES, ET LA DISTINCTION EST LA RAISON D'ÊTRE DU MODULE
 * ════════════════════════════════════════════════════════════════════════════
 *   `ponte`       — 200 avec un identifiant exploitable ;
 *   `absent`      — 404, et c'est une ABSENCE PROUVÉE : Open Prices a répondu,
 *                   il ne connaît pas ce lieu ;
 *   `indetermine` — tout le reste. Nous ne savons pas.
 *
 * Confondre les deux derniers serait le défaut le plus grave que ce lot puisse
 * porter : une panne de réseau ferait écrire en base « ce magasin n'a pas de
 * prix » comme un FAIT ÉTABLI — et cette fausse preuve survivrait à la panne,
 * silencieusement, jusqu'à ce que quelqu'un se demande pourquoi un supermarché
 * bien renseigné n'affiche jamais rien.
 */

/** `GET /api/v1/locations/osm/{TYPE}/{ID}` — le préfixe, sans identité. */
export const OPEN_PRICES_PONT_OSM_URL = `${OPEN_PRICES_BASE_URL}/api/${OPEN_PRICES_API_VERSION}/locations/osm`;

export type CausePontIndetermine = "rate_limited" | "unavailable" | "timeout" | "corps_illisible";

export type ResultatPontOsm =
  | { readonly statut: "ponte"; readonly opLocationId: number }
  | { readonly statut: "absent" }
  | { readonly statut: "indetermine"; readonly cause: CausePontIndetermine };

export interface OptionsPont {
  readonly transport?: Transport;
  readonly timeoutMs?: number;
}

function estAbandon(erreur: unknown): boolean {
  return (
    typeof erreur === "object" &&
    erreur !== null &&
    (erreur as { name?: unknown }).name === "AbortError"
  );
}

/**
 * L'identifiant Open Prices de CE lieu OSM — ou la preuve qu'il n'y en a pas.
 *
 * ⚠️ AUCUNE CHAÎNE DE REQUÊTE. L'identité voyage dans le CHEMIN, et rien
 * d'autre n'est envoyé : ni nom, ni ville, ni pays. Une URL sans `?` est la
 * forme la plus courte de la promesse « je ne cherche pas, je demande ».
 */
export async function lirePontOsm(
  osmType: TypeOsm,
  osmId: number,
  options: OptionsPont = {},
): Promise<ResultatPontOsm> {
  if (!Number.isSafeInteger(osmId) || osmId <= 0) {
    throw new RangeError("identifiant OSM invalide");
  }
  const transport = options.transport ?? fetch;
  const agent = userAgentOff();
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), options.timeoutMs ?? OFF_TIMEOUT_MS);

  let reponse: Response;
  try {
    reponse = await transport(`${OPEN_PRICES_PONT_OSM_URL}/${osmType}/${osmId}`, {
      method: "GET",
      headers: { "User-Agent": agent, Accept: "application/json" },
      signal: controleur.signal,
      cache: "no-store",
    });
  } catch (erreur) {
    return { statut: "indetermine", cause: estAbandon(erreur) ? "timeout" : "unavailable" };
  } finally {
    clearTimeout(minuterie);
  }

  // ⚠️ LE SEUL CAS OÙ « IL N'Y A PAS DE PONT » EST VRAI.
  if (reponse.status === 404) return { statut: "absent" };
  if (reponse.status === 429) return { statut: "indetermine", cause: "rate_limited" };
  if (reponse.status === 504) return { statut: "indetermine", cause: "timeout" };
  if (!reponse.ok) return { statut: "indetermine", cause: "unavailable" };

  let corps: unknown;
  try {
    corps = JSON.parse(await reponse.text());
  } catch {
    return { statut: "indetermine", cause: "corps_illisible" };
  }

  // ⚠️ UN 200 SANS IDENTIFIANT EXPLOITABLE EST UN DOUTE, PAS UNE ABSENCE. Il
  // signifie que la réponse n'est pas celle qu'on attendait — et une réponse
  // qu'on ne comprend pas ne prouve rien.
  const brut = typeof corps === "object" && corps !== null ? (corps as { id?: unknown }).id : null;
  if (typeof brut !== "number" || !Number.isSafeInteger(brut) || brut <= 0) {
    return { statut: "indetermine", cause: "corps_illisible" };
  }
  return { statut: "ponte", opLocationId: brut };
}

/**
 * Ce qu'on ÉCRIT en base à partir de ce qu'on a LU chez Open Prices.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ FONCTION TOTALE, ET C'EST TOUT SON INTÉRÊT : ELLE NE PEUT PAS REFUSER
 * ════════════════════════════════════════════════════════════════════════════
 * Elle rend toujours un `PontConnu`. Il n'existe aucune valeur de retour
 * signifiant « n'enregistre pas ce magasin », et aucun chemin qui lève. Une
 * panne d'Open Prices au moment du choix ne PEUT donc pas empêcher l'élève de
 * sélectionner son magasin — OpenStreetMap est l'identité primaire, Open Prices
 * n'est qu'une source de prix.
 *
 * ⚠️ ELLE EXISTE PARCE QU'UN SABOTAGE EST PASSÉ AU VERT. Le contrôle qui
 * garantissait « une panne du pont ne refuse pas la sélection » lisait le texte
 * de la route et cherchait une condition écrite d'une certaine façon ; il
 * suffisait de renommer une variable pour l'endormir. La règle vit maintenant
 * dans une fonction qu'on peut appeler, avec toutes ses entrées, et vérifier.
 *
 * ⚠️ ET SEUL LE 404 DEVIENT `absent`. C'est la seule preuve d'absence qui
 * existe ; tout le reste est un doute, et un doute ne s'écrit pas en base comme
 * un fait.
 */
export function pontPourEcriture(
  lu: ResultatPontOsm,
): { readonly statut: "ponte"; readonly opLocationId: number } | { readonly statut: "absent" } | { readonly statut: "indetermine" } {
  if (lu.statut === "ponte") return { statut: "ponte", opLocationId: lu.opLocationId };
  if (lu.statut === "absent") return { statut: "absent" };
  return { statut: "indetermine" };
}
