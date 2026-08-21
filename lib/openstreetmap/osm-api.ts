import "server-only";

import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";
import type { ElementOverpass } from "@/lib/nutrition/magasins-osm";
import type { RaisonEchecOverpass } from "@/lib/openstreetmap/overpass";

/**
 * COURSES C4.3c — L'ADAPTATEUR DE L'API OSM PRINCIPALE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE — UN DÉFAUT MESURÉ EN PREVIEW
 * ════════════════════════════════════════════════════════════════════════════
 * Choisir Naturalia (NODE 9928912836) échouait en `RECHERCHE_TROP_LONGUE`,
 * AVANT même que le pont Open Prices ne soit tenté. La cause n'était ni le
 * pont, ni l'écriture : la relecture canonique passait par Overpass, un moteur
 * de REQUÊTE conçu pour interroger des zones entières, pour une question qui
 * n'en est pas une — « donne-moi CET élément ». Overpass met ce genre de
 * lecture en file d'attente derrière des requêtes lourdes, dépasse son
 * `[timeout:25]`, et rend un 504 que nous traduisons honnêtement en délai
 * dépassé.
 *
 * L'API principale d'OpenStreetMap répond à la même question par une lecture
 * de clé primaire. C'est le bon outil, et c'est aussi la source la plus
 * autorisée qui soit : la base elle-même, pas un miroir d'indexation.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ UN NŒUD, ET RIEN D'AUTRE
 * ════════════════════════════════════════════════════════════════════════════
 * Ce module ne sait lire qu'un NODE, par identité exacte. C'est délibéré :
 * pour un WAY ou une RELATION, l'API principale rend la géométrie brute — une
 * liste de nœuds, ou une liste de membres — sans aucune coordonnée
 * représentative. Calculer un centre nous-mêmes fabriquerait une position que
 * la source ne donne pas, et l'écrirait dans un référentiel partagé.
 * `out center` d'Overpass fait ce calcul CHEZ LA SOURCE : le chemin Overpass
 * reste donc le bon pour ces deux types, et il n'est pas touché.
 *
 * ⚠️ ET LE JSON N'EST JAMAIS CRU SUR PAROLE. Enveloppe vérifiée, éléments
 * vérifiés, puis `normaliserElementOsm` chez l'appelant : la même doctrine des
 * deux barrières qu'Overpass et Open Prices.
 */

/** La racine de lecture d'un élément. Le type et l'identifiant s'y ajoutent. */
export const OSM_API_ELEMENT_URL = "https://api.openstreetmap.org/api/0.6";

/**
 * La borne LOCALE, en millisecondes.
 *
 * ⚠️ ELLE EST TROIS FOIS PLUS COURTE QUE CELLE D'OVERPASS, ET C'EST LE FOND DU
 * CORRECTIF. Une lecture par identifiant qui met dix secondes n'est pas lente :
 * elle est en panne. Attendre trente secondes ne ferait qu'immobiliser l'élève
 * plus longtemps avant de lui dire la même chose.
 */
export const OSM_API_TIMEOUT_MS = 10_000;

/**
 * Le MÊME vocabulaire de panne qu'Overpass — un alias, pas une seconde
 * définition.
 *
 * ⚠️ EN ÉCRIRE UN SECOND CRÉERAIT DEUX DÉFINITIONS DE « PANNE » VOUÉES À
 * DIVERGER, et `httpDecouverte` — qui traduit ces raisons en codes HTTP — ne
 * saurait plus laquelle il traite. C'est la leçon de `erreurEstTemporaire` en
 * C4.1, appliquée ici.
 */
export type RaisonEchecOsm = RaisonEchecOverpass;

export type ReponseElementOsm =
  | { readonly statut: "success"; readonly element: ElementOverpass }
  /** L'élément n'existe pas (404), ou a été supprimé (410). C'est une PREUVE. */
  | { readonly statut: "absent" }
  | { readonly statut: "echec"; readonly raison: RaisonEchecOsm };

export interface OptionsOsmApi {
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

/** Un élément exploitable a AU MOINS un type et un identifiant. Rien de plus. */
function elementBienForme(valeur: unknown): valeur is ElementOverpass {
  if (typeof valeur !== "object" || valeur === null) return false;
  const e = valeur as { type?: unknown; id?: unknown };
  return typeof e.type === "string" && typeof e.id === "number";
}

/**
 * ⚠️ UNE ENVELOPPE SANS `elements` N'EST PAS UNE ENVELOPPE VIDE — même règle
 * qu'Overpass. Un 200 qui décrirait autre chose ne doit pas se lire « ce nœud
 * n'existe pas » : l'absence a son propre code, et c'est le 404.
 */
function elementsDeLEnveloppe(corps: unknown): readonly unknown[] | null {
  if (typeof corps !== "object" || corps === null || Array.isArray(corps)) return null;
  const brut = (corps as { elements?: unknown }).elements;
  return Array.isArray(brut) ? brut : null;
}

/**
 * UN nœud OSM, par son identité exacte.
 *
 * ⚠️ AUCUN RÉESSAI, ICI NON PLUS. Un adaptateur qui réessaie tout seul
 * multiplie silencieusement la charge que l'appelant croit avoir bornée — et
 * l'API principale d'OpenStreetMap est un service public, pas une ressource
 * élastique.
 *
 * ⚠️ ET AUCUNE TRACE. Ni le corps, ni les étiquettes, ni le nom du magasin ne
 * sont journalisés : ce qu'on lit ici finit dans un référentiel partagé, mais
 * le CHEMIN qui y mène dit où un élève est en train de faire ses courses.
 */
export async function lireNoeudOsm(
  osmId: number,
  options: OptionsOsmApi = {},
): Promise<ReponseElementOsm> {
  // Une identité non entière sûre n'est pas une identité : au-delà de 2⁵³−1,
  // `JSON.parse` arrondit en silence et l'on interrogerait le nœud de personne.
  if (!Number.isSafeInteger(osmId) || osmId <= 0) throw new RangeError("identifiant OSM invalide");

  const transport = options.transport ?? fetch;
  const delai = options.timeoutMs ?? OSM_API_TIMEOUT_MS;
  // L'agent est obligatoire, et son absence lève — même règle qu'Overpass.
  const agent = userAgentOff();

  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), delai);

  let reponse: Response;
  try {
    reponse = await transport(`${OSM_API_ELEMENT_URL}/node/${osmId}.json`, {
      method: "GET",
      headers: { "User-Agent": agent, Accept: "application/json" },
      signal: controleur.signal,
      cache: "no-store",
    });
  } catch (erreur) {
    return { statut: "echec", raison: estAbandon(erreur) ? "timeout" : "unavailable" };
  } finally {
    clearTimeout(minuterie);
  }

  // ⚠️ 404 ET 410 SONT DES PREUVES, LE RESTE N'EN EST PAS UNE. « Jamais
  // existé » et « supprimé » disent tous deux que cet élément n'est plus
  // choisissable ; un 503 ne dit rien du tout.
  if (reponse.status === 404 || reponse.status === 410) return { statut: "absent" };
  if (reponse.status === 429) return { statut: "echec", raison: "rate_limited" };
  if (reponse.status === 504) return { statut: "echec", raison: "timeout" };
  if (!reponse.ok) return { statut: "echec", raison: "unavailable" };

  let corps: unknown;
  try {
    corps = JSON.parse(await reponse.text());
  } catch {
    return { statut: "echec", raison: "invalid_json" };
  }

  const bruts = elementsDeLEnveloppe(corps);
  if (bruts === null) return { statut: "echec", raison: "invalid_envelope" };
  if (bruts.length === 0) return { statut: "absent" };

  const premier = bruts[0];
  // ⚠️ UN ÉLÉMENT MAL FORMÉ N'EST PAS UNE ABSENCE. Rendre « absent » ici
  // afficherait « ce magasin n'existe pas » sur une réponse qu'on n'a pas su
  // lire — une affirmation que rien ne fonde.
  if (!elementBienForme(premier)) return { statut: "echec", raison: "invalid_envelope" };

  return { statut: "success", element: premier };
}
