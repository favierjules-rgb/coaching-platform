import "server-only";

import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";
import {
  SHOP_ALIMENTAIRES,
  type ElementOverpass,
  type TypeOsm,
} from "@/lib/nutrition/magasins-osm";

/**
 * COURSES C4.3c — L'ADAPTATEUR OVERPASS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE MODULE NE DÉCIDE RIEN
 * ════════════════════════════════════════════════════════════════════════════
 * Il fait cinq choses, et rien d'autre : construire une requête, l'envoyer,
 * l'annuler au bout d'un temps borné, classer ce qui revient, et vérifier
 * l'enveloppe. Ce qu'est un magasin, comment on le déduplique, à quelle
 * distance il se trouve, ce qu'on en persiste — tout cela vit ailleurs.
 *
 * La frontière est exactement celle de `lib/open-prices/locations.ts` vis-à-vis
 * de `lib/nutrition/magasin-proche.ts`, et elle est là pour la même raison : ce
 * qui se prouve sans réseau doit pouvoir se prouver sans réseau.
 *
 * ⚠️ IL CONSOMME LA DOCTRINE ALIMENTAIRE, IL NE LA DÉTIENT PAS.
 * `SHOP_ALIMENTAIRES` vient du module pur. La recopier ici créerait deux listes
 * qui divergeraient au premier ajout — et c'est exactement l'erreur que l'audit
 * C4.3c a trouvée entre C4.3a et le wiki OSM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ `server-only`, ET CE N'EST PAS DÉCORATIF
 * ════════════════════════════════════════════════════════════════════════════
 * La position d'un élève transite par `requeteMagasinsAutour`. Si un composant
 * client pouvait importer ce fichier, cette position partirait du navigateur
 * vers Overpass avec l'adresse IP de l'élève, sans borne de rayon, sans limite
 * de débit, et sans qu'aucun de nos contrôles ne s'applique.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POLITIQUE D'USAGE D'OVERPASS — CITÉE, PAS DEVINÉE
 * ════════════════════════════════════════════════════════════════════════════
 * L'instance publique demande, en propres termes, de rester sous « less than
 * 10,000 queries per day », d'ajouter un en-tête `User-Agent` ou `Referer`
 * identifiant, et — textuellement — « If you receive an HTTP error code 429,
 * pause for 30 seconds ». D'où trois décisions écrites dans ce fichier :
 * un agent identifiant obligatoire, une borne de sortie sur chaque requête, et
 * AUCUN réessai après un 429.
 */

/** `POST` sur le point d'entrée de l'instance publique. */
export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/**
 * La borne QUE NOUS DEMANDONS À OVERPASS, en secondes (`[timeout:N]`).
 *
 * ⚠️ ELLE EST PLUS COURTE QUE LA NÔTRE, ET C'EST L'ORDRE QUI COMPTE. Overpass
 * abandonne le premier et rend un 504 propre, que nous savons classer ; notre
 * `AbortController` n'intervient qu'après, en dernier recours. L'inverse
 * transformerait chaque requête lente en `timeout` local, sans jamais laisser
 * l'amont dire ce qu'il en pense.
 */
export const OVERPASS_TIMEOUT_S = 25;

/** La borne LOCALE, en millisecondes — le dernier recours. */
export const OVERPASS_TIMEOUT_MS = 30_000;

/**
 * Le nombre maximal d'éléments demandés — et rendus.
 *
 * ⚠️ CETTE BORNE NE COUPE PAS EN SILENCE. Quand elle est atteinte, la réponse
 * porte `tronque: true`, et l'écran doit pouvoir dire « il y en a peut-être
 * d'autres » plutôt que présenter une liste partielle comme exhaustive. C'est
 * la même règle que `tronque` en C4.3a et `MAX_OBSERVATIONS_PAGES` en C4.4 :
 * une borne assumée se déclare.
 */
export const OVERPASS_ELEMENTS_MAX = 400;

/* ── 1. ÉCHAPPEMENT ──────────────────────────────────────────────────────── */

/**
 * Rend une saisie utilisateur inoffensive dans une valeur Overpass.
 *
 * ⚠️ SANS CECI, UN NOM DE VILLE PEUT REFERMER LA VALEUR ET OUVRIR UNE CLAUSE.
 * `Toulon"]["shop"="alcohol` deviendrait un filtre que personne n'a écrit. On
 * échappe donc TOUT ce qui n'est ni une lettre, ni un chiffre, ni une espace,
 * ni une apostrophe — la liste blanche est plus sûre que la liste noire, parce
 * qu'elle n'oublie pas les caractères auxquels on n'a pas pensé.
 *
 * ⚠️ LES LETTRES ACCENTUÉES PASSENT INTACTES. `Saint-Étienne` s'écrit avec un
 * É chez OSM ; le dépouiller ferait manquer la ville. Seul le tiret, qui est un
 * métacaractère d'intervalle en expression régulière, est échappé.
 */
export function echapperValeurOverpass(valeur: string): string {
  return valeur.replace(/[^\p{L}\p{N} ']/gu, (c) => `\\${c}`);
}

/* ── 2. LES CATÉGORIES, EN AMONT ─────────────────────────────────────────── */

/**
 * L'alternative régulière des `shop=*` alimentaires, triée pour être stable.
 *
 * ⚠️ ELLE EXISTE POUR NE PAS ÉCRIRE `nwr(area)["shop"]`. Cette forme-là
 * téléchargerait TOUS les commerces d'une ville — coiffeurs, garages,
 * opticiens, agences bancaires — pour n'en garder qu'une fraction après coup.
 * C'est du débit pris à un service bénévole pour rien, et c'est précisément ce
 * que la politique d'usage demande d'éviter.
 *
 * ⚠️ LE FILTRE LOCAL RESTE EN PLACE MALGRÉ TOUT. Deux barrières, une seule
 * règle — la doctrine d'Open Prices, appliquée ici : l'amont peut changer, se
 * tromper, ou rendre autre chose que ce qu'on a demandé.
 */
function alternativeShop(): string {
  return [...SHOP_ALIMENTAIRES].sort().join("|");
}

const ENTETE = `[out:json][timeout:${OVERPASS_TIMEOUT_S}]`;

/* ── 3. LES REQUÊTES ─────────────────────────────────────────────────────── */

/**
 * Les communes FRANÇAISES portant ce nom.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ « TOULON » N'EST PAS UN IDENTIFIANT MONDIAL
 * ════════════════════════════════════════════════════════════════════════════
 * `area["name"="Toulon"]` seul rendrait toutes les zones du monde portant ce
 * nom — quartiers, lieux-dits, communes homonymes d'autres pays — et il
 * faudrait ensuite en choisir une. « En choisir une » signifie, en pratique,
 * prendre la première : un choix arbitraire, invisible, et faux une fois sur
 * deux pour les noms répandus.
 *
 * Trois bornes sont donc écrites DANS la requête :
 *   · la zone France, par son code ISO (`ISO3166-1=FR`, `admin_level=2`) ;
 *   · `boundary=administrative` + `admin_level=8` — le niveau de la COMMUNE en
 *     France, et pas celui du quartier ni du département ;
 *   · le nom, en comparaison insensible à la casse, ancrée aux deux bouts.
 *
 * ⚠️ ET ELLE PEUT RENDRE PLUSIEURS RÉSULTATS — C'EST VOULU. La France compte
 * des dizaines de communes homonymes. Cette fonction ne tranche pas : elle rend
 * ce qui existe, et l'appelant devra dire « ambigu » plutôt que deviner.
 */
export function requeteZoneCommune(ville: string): string {
  const nom = echapperValeurOverpass(ville.trim());
  return [
    `${ENTETE};`,
    `area["ISO3166-1"="FR"]["admin_level"="2"]->.fr;`,
    `rel(area.fr)["boundary"="administrative"]["admin_level"="8"]["name"~"^${nom}$",i];`,
    `out ids tags 20;`,
  ].join("\n");
}

/**
 * Relation N → zone Overpass 3600000000 + N.
 *
 * ⚠️ REFUS PLUTÔT QUE CALCUL SUR UNE VALEUR DOUTEUSE. Un identifiant non entier
 * sûr donnerait une zone qui n'est celle de personne, et la requête suivante
 * rendrait « aucun magasin » pour une ville qui en a cinquante.
 */
export function idZoneDepuisRelation(relationId: number): number {
  if (!Number.isSafeInteger(relationId) || relationId <= 0) {
    throw new RangeError("identifiant de relation invalide");
  }
  const zone = 3_600_000_000 + relationId;
  if (!Number.isSafeInteger(zone)) throw new RangeError("identifiant de zone hors bornes");
  return zone;
}

/**
 * Les commerces alimentaires d'une zone administrative résolue.
 *
 * ⚠️ AUCUN `addr:city` N'INTERVIENT. Un commerce dont le contributeur a oublié
 * l'adresse disparaîtrait de sa propre ville, alors que sa POSITION la place
 * sans ambiguïté dedans. C'est la zone qui décide, jamais l'étiquette.
 */
export function requeteMagasinsDansZone(areaId: number): string {
  if (!Number.isSafeInteger(areaId) || areaId <= 0) {
    throw new RangeError("identifiant de zone invalide");
  }
  return [
    `${ENTETE};`,
    `area(${areaId})->.commune;`,
    `nwr(area.commune)["shop"~"^(${alternativeShop()})$"];`,
    `out center tags ${OVERPASS_ELEMENTS_MAX};`,
  ].join("\n");
}

export interface AutourDe {
  readonly lat: number;
  readonly lon: number;
  /** En MÈTRES — l'unité d'Overpass. La conversion appartient à l'appelant. */
  readonly rayonM: number;
}

/**
 * Les commerces alimentaires autour d'un point.
 *
 * ⚠️ LES BORNES SONT VÉRIFIÉES ICI AUSSI, ET C'EST DÉLIBÉRÉMENT REDONDANT. Le
 * schéma d'entrée et la règle produit les ont déjà vues ; celle-ci est la
 * dernière avant le réseau. Une coordonnée hors bornes est une erreur de
 * programme, pas une saisie : on lève, on ne rend pas une requête vide.
 */
export function requeteMagasinsAutour(p: AutourDe): string {
  const { lat, lon, rayonM } = p;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new RangeError("latitude hors bornes");
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new RangeError("longitude hors bornes");
  if (!Number.isSafeInteger(rayonM) || rayonM <= 0) throw new RangeError("rayon invalide");
  return [
    `${ENTETE};`,
    `nwr(around:${rayonM},${lat},${lon})["shop"~"^(${alternativeShop()})$"];`,
    `out center tags ${OVERPASS_ELEMENTS_MAX};`,
  ].join("\n");
}

const MOT_OSM: Readonly<Record<TypeOsm, string>> = {
  NODE: "node",
  WAY: "way",
  RELATION: "rel",
};

/**
 * UN élément, par son identité exacte — la requête de la canonicalisation.
 *
 * ⚠️ ELLE NE PORTE AUCUN FILTRE `shop`. C'est voulu : au moment du choix, on
 * veut savoir ce que cet élément EST réellement, y compris s'il n'est pas un
 * commerce alimentaire. Filtrer ici rendrait « introuvable » un élément qui
 * existe mais ne convient pas — deux refus différents, deux messages différents.
 */
export function requeteElement(osmType: TypeOsm, osmId: number): string {
  if (!Number.isSafeInteger(osmId) || osmId <= 0) throw new RangeError("identifiant OSM invalide");
  return [`${ENTETE};`, `${MOT_OSM[osmType]}(${osmId});`, `out center tags 1;`].join("\n");
}

/* ── 4. L'APPEL, ET SES SEPT ISSUES ──────────────────────────────────────── */

/**
 * ⚠️ CINQ ÉCHECS DISTINCTS, ET AUCUN NE SE DÉGUISE EN « AUCUN RÉSULTAT ».
 *
 * C'est la leçon répétée de tout ce chantier — `LecturePrix.ok` en C3,
 * `StatutApercu.indetermine` en C4.1, `MESSAGE_PANNE_OFF` en C4.1b,
 * `indisponible` puis `indetermine` en C4.4. Une panne présentée comme une
 * absence fait conclure à l'élève que la chose n'existe pas, et il cesse de
 * chercher.
 *
 *   `rate_limited`     429 — attendre. Réessayer tout de suite fait bannir ;
 *   `unavailable`      503, autre HTTP, ou réseau — réessayer plus tard a du sens ;
 *   `timeout`          notre annulation, ou le 504 d'Overpass — la requête était
 *                      trop lourde ou l'instance trop chargée ;
 *   `invalid_json`     200 qui n'est pas du JSON — typiquement une page d'erreur
 *                      d'un intermédiaire ;
 *   `invalid_envelope` 200, du JSON, mais pas la forme attendue.
 */
export type RaisonEchecOverpass =
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "invalid_json"
  | "invalid_envelope";

export type ReponseOverpass =
  | {
      readonly statut: "success";
      readonly elements: readonly ElementOverpass[];
      /** La borne de sortie a été atteinte : il y en a PEUT-ÊTRE d'autres. */
      readonly tronque: boolean;
    }
  | { readonly statut: "zero_results" }
  | { readonly statut: "echec"; readonly raison: RaisonEchecOverpass };

export interface OptionsOverpass {
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
 * ⚠️ UNE ENVELOPPE SANS `elements` N'EST PAS UNE ENVELOPPE VIDE.
 *
 * Overpass rend parfois, en 200, un corps qui décrit une erreur. Le lire comme
 * « aucun magasin » ferait conclure à l'absence sur une réponse qui n'a rien
 * mesuré. On exige donc la forme : un objet, non nul, non tableau, dont
 * `elements` est un tableau.
 */
function elementsDeLEnveloppe(corps: unknown): readonly unknown[] | null {
  if (typeof corps !== "object" || corps === null || Array.isArray(corps)) return null;
  const brut = (corps as { elements?: unknown }).elements;
  return Array.isArray(brut) ? brut : null;
}

/** Un élément exploitable a AU MOINS un type et un identifiant. Rien de plus. */
function elementBienForme(valeur: unknown): valeur is ElementOverpass {
  if (typeof valeur !== "object" || valeur === null) return false;
  const e = valeur as { type?: unknown; id?: unknown };
  return typeof e.type === "string" && typeof e.id === "number";
}

/**
 * Envoie une requête Overpass et classe ce qui revient.
 *
 * ⚠️ LA REQUÊTE VOYAGE EN CORPS, JAMAIS EN CHAÎNE DE REQUÊTE. Une requête
 * `around:` en URL contiendrait la position de l'élève, et finirait dans les
 * journaux d'accès de l'amont, dans les nôtres, et dans tout intermédiaire du
 * chemin. C'est le même arbitrage que le POST de `/nearby`.
 *
 * ⚠️ AUCUN RÉESSAI, NULLE PART. Ni sur 429 — la politique demande une PAUSE —
 * ni sur 503, ni sur un timeout. Un adaptateur qui réessaie tout seul multiplie
 * silencieusement la charge que l'appelant croit avoir bornée.
 */
export async function interrogerOverpass(
  requete: string,
  options: OptionsOverpass = {},
): Promise<ReponseOverpass> {
  const transport = options.transport ?? fetch;
  const delai = options.timeoutMs ?? OVERPASS_TIMEOUT_MS;

  // ⚠️ L'AGENT EST OBLIGATOIRE, ET SON ABSENCE LÈVE. OSM demande un agent
  // identifiant ; fabriquer un repli générique ferait passer l'oubli inaperçu
  // jusqu'au jour du blocage. Il ne quitte jamais le serveur, et ne porte
  // aucun secret : c'est un nom d'application et un contact.
  const agent = userAgentOff();

  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), delai);

  let reponse: Response;
  try {
    reponse = await transport(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "User-Agent": agent,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `data=${encodeURIComponent(requete)}`,
      signal: controleur.signal,
      cache: "no-store",
    });
  } catch (erreur) {
    return { statut: "echec", raison: estAbandon(erreur) ? "timeout" : "unavailable" };
  } finally {
    clearTimeout(minuterie);
  }

  if (reponse.status === 429) return { statut: "echec", raison: "rate_limited" };
  if (reponse.status === 504) return { statut: "echec", raison: "timeout" };
  if (!reponse.ok) return { statut: "echec", raison: "unavailable" };

  let corps: unknown;
  try {
    corps = JSON.parse(await reponse.text());
  } catch {
    // ⚠️ AUCUNE TRACE DU CORPS. Il peut contenir la requête, donc la position.
    return { statut: "echec", raison: "invalid_json" };
  }

  const bruts = elementsDeLEnveloppe(corps);
  if (bruts === null) return { statut: "echec", raison: "invalid_envelope" };
  if (bruts.length === 0) return { statut: "zero_results" };

  // ⚠️ LA TRONCATURE SE MESURE SUR LE BRUT, AVANT TOUT FILTRAGE. Sinon un lot
  // d'éléments mal formés ferait passer une réponse pleine pour une réponse
  // complète, et l'écran affirmerait une exhaustivité qu'il n'a pas.
  const tronque = bruts.length >= OVERPASS_ELEMENTS_MAX;
  return {
    statut: "success",
    elements: bruts.filter(elementBienForme).slice(0, OVERPASS_ELEMENTS_MAX),
    tronque,
  };
}
