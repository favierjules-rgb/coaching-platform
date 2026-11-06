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
 * Les points d'entrée à essayer, dans l'ordre.
 *
 * ⚠️ UN SEUL PAR DÉFAUT, ET C'EST DÉLIBÉRÉ. Ajouter un miroir public, c'est
 * ajouter un tiers à l'architecture : ça se décide, ça ne se glisse pas dans un
 * correctif. `OVERPASS_ENDPOINTS` permet d'en déclarer d'autres sans toucher au
 * code, le jour où ce choix sera fait.
 *
 * ⚠️ ET LA VARIABLE N'EST PAS `NEXT_PUBLIC_`. Ces URL ne doivent jamais être
 * lues par le navigateur : c'est le serveur qui parle à Overpass, pour que la
 * position de l'élève n'en sorte pas.
 */
export function pointsDEntreeOverpass(): readonly string[] {
  const brut = (process.env.OVERPASS_ENDPOINTS ?? "").trim();
  if (brut === "") return [OVERPASS_ENDPOINT];
  const listes = brut
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.startsWith("https://"));
  return listes.length > 0 ? listes : [OVERPASS_ENDPOINT];
}

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

/**
 * La borne LOCALE, en millisecondes — le dernier recours.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ 30 s ÉTAIT TROP COURT, ET C'ÉTAIT LA CAUSE DE L'INTERMITTENCE
 * ════════════════════════════════════════════════════════════════════════════
 * Mesuré le 05/11/2026 sur `overpass-api.de`, depuis ce dépôt :
 *
 *   · `/api/status` annonce « Rate limit: 2 » — DEUX créneaux par adresse IP,
 *     et « Slot available after: …, in 21 seconds » ;
 *   · une requête TRIVIALE (`node(1); out ids;`) a mis **20,4 s**. Vingt
 *     secondes pour rendre un nœud : ce n'est pas du calcul, c'est de
 *     l'ATTENTE DE CRÉNEAU ;
 *   · la résolution d'une commune a mis 28 à 32 s, avec ou sans contrainte de
 *     zone France — la forme de la requête n'y change rien.
 *
 * Le chemin « par ville » enchaînait DEUX requêtes : deux attentes de créneau,
 * donc 40 à 60 s, contre une borne de 30 s par requête. Le chemin GPS n'en fait
 * qu'UNE. D'où le symptôme exact observé en Preview : « le GPS marche, la ville
 * échoue une fois sur deux ».
 *
 * La borne monte donc au-dessus de l'attente observée. Elle reste bornée : une
 * fonction serverless qui attend indéfiniment coûte autant qu'une qui échoue.
 */
export const OVERPASS_TIMEOUT_MS = 45_000;

/**
 * Le DÉLAI TOTAL d'un appel, réessais compris.
 *
 * ⚠️ C'EST LUI QUI DÉCIDE S'IL RESTE LE TEMPS DE RÉESSAYER, pas un compteur de
 * tentatives. Un réessai qui démarre alors que la fonction va être coupée
 * consomme un créneau Overpass pour rien — et prend ce créneau à quelqu'un.
 */
export const OVERPASS_DELAI_TOTAL_MS = 55_000;

/** La pause avant le premier réessai. Doublée au suivant. */
export const OVERPASS_BACKOFF_MS = 1_500;

/** Au plus deux tentatives supplémentaires, et seulement si le délai total le permet. */
export const OVERPASS_REESSAIS_MAX = 2;

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
 * LA commune française portant ce code INSEE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI UN CODE PLUTÔT QU'UN NOM, ET CE QUE ÇA CHANGE
 * ════════════════════════════════════════════════════════════════════════════
 * `requeteZoneCommune` cherche par NOM, et peut donc rendre plusieurs communes
 * homonymes : l'appelant doit alors répondre « ambigu », et l'élève de
 * Saint-Martin reste sans magasins. Le code INSEE, lui, désigne UNE commune et
 * une seule. Il n'y a plus d'ambiguïté à trancher, parce qu'il n'y en a plus.
 *
 * ⚠️ `ref:INSEE` EST UNE ÉTIQUETTE OSM RÉELLE, pas une convention inventée ici :
 * les relations de communes françaises la portent. Si elle manquait sur une
 * commune, la requête rendrait zéro — ce qui se traduit par « commune
 * introuvable » et laisse le chemin par nom disponible. Aucun repli silencieux.
 *
 * ⚠️ LE CODE EST FILTRÉ AVANT D'ENTRER DANS LA REQUÊTE. Cinq caractères,
 * chiffres et lettres (la Corse s'écrit 2A/2B) : rien d'autre ne peut atteindre
 * Overpass depuis ce chemin.
 */
export function requeteZoneCommuneParInsee(codeInsee: string): string {
  const code = codeInsee.trim().toUpperCase();
  if (!/^[0-9][0-9AB][0-9]{3}$/.test(code)) {
    throw new RangeError("code INSEE invalide");
  }
  return [
    `${ENTETE};`,
    `area["ISO3166-1"="FR"]["admin_level"="2"]->.fr;`,
    `rel(area.fr)["boundary"="administrative"]["admin_level"="8"]["ref:INSEE"="${code}"];`,
    `out ids tags 5;`,
  ].join("\n");
}

/**
 * Les commerces alimentaires d'une commune, EN UNE SEULE REQUÊTE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI UNE, ALORS QUE LA RECHERCHE PAR NOM EN FAIT DEUX
 * ════════════════════════════════════════════════════════════════════════════
 * Les deux temps de `decouvrirParVille` existent pour détecter l'AMBIGUÏTÉ :
 * « Saint-Martin » désigne une trentaine de communes, et il faut pouvoir le
 * dire plutôt que d'en choisir une au hasard.
 *
 * Un CODE INSEE ne peut pas être ambigu. Les deux temps n'ont donc plus de
 * raison d'être — et ils coûtaient cher :
 *
 *   mesuré le 05/11/2026, `overpass-api.de` annonce « Rate limit: 2 » créneaux
 *   par adresse IP, et une requête TRIVIALE a mis 20,4 s en pure attente de
 *   créneau. Deux requêtes, c'est deux attentes : 40 à 60 s là où le chemin GPS
 *   n'en demande qu'une. C'est l'intermittence observée en Preview, et elle
 *   disparaît en supprimant la requête de trop.
 *
 * ⚠️ `area[...]` RÉSOUT LA ZONE PAR SES ÉTIQUETTES, sans passer par une
 * relation puis un identifiant dérivé. Overpass tient un index des zones :
 * c'est fait pour ça, et c'est ce qui permet de tout dire en une fois.
 *
 * ⚠️ ET LE FILTRE SUR LE CODE EST CELUI DE `requeteZoneCommuneParInsee`, mot
 * pour mot. Cinq caractères, chiffres et lettres (la Corse s'écrit 2A/2B) :
 * rien d'autre n'atteint Overpass depuis ce chemin.
 */
export function requeteCommercesDansCommune(codeInsee: string): string {
  const code = codeInsee.trim().toUpperCase();
  if (!/^[0-9][0-9AB][0-9]{3}$/.test(code)) {
    throw new RangeError("code INSEE invalide");
  }
  return [
    `${ENTETE};`,
    `area["boundary"="administrative"]["admin_level"="8"]["ref:INSEE"="${code}"]->.commune;`,
    `nwr(area.commune)["shop"~"^(${alternativeShop()})$"];`,
    `out center tags ${OVERPASS_ELEMENTS_MAX};`,
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
  | "at_capacity"
  | "unavailable"
  | "timeout"
  | "invalid_json"
  | "invalid_envelope";

/**
 * Les raisons TEMPORAIRES — celles qui justifient un réessai.
 *
 * ⚠️ `rate_limited` N'EN FAIT PAS PARTIE, ET C'EST VOLONTAIRE. La politique
 * d'usage dit, textuellement : « If you receive an HTTP error code 429, pause
 * for 30 seconds ». Réessayer tout de suite est exactement ce qu'elle interdit.
 *
 * ⚠️ `invalid_json` ET `invalid_envelope` NON PLUS. Une réponse mal formée ne
 * se répare pas en la redemandant ; la rejouer doublerait la charge sans
 * aucune chance supplémentaire.
 */
export const RAISONS_TEMPORAIRES: ReadonlySet<RaisonEchecOverpass> = new Set<RaisonEchecOverpass>([
  "at_capacity",
  "unavailable",
  "timeout",
]);

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
  /** Le DÉLAI TOTAL, réessais et pauses compris. */
  readonly delaiTotalMs?: number;
  /** Injectées pour que les réessais soient testables sans attendre vraiment. */
  readonly attendre?: (ms: number) => Promise<unknown>;
  readonly maintenant?: () => number;
  readonly pointsDEntree?: readonly string[];
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

/** Une tentative : un point d'entrée, un aller-retour, un classement. */
async function tenterOverpass(
  pointDEntree: string,
  requete: string,
  transport: Transport,
  agent: string,
  delai: number,
): Promise<ReponseOverpass> {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), delai);

  let reponse: Response;
  try {
    reponse = await transport(pointDEntree, {
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
  /*
   * ⚠️ 502 N'EST PAS « SERVICE INDISPONIBLE », ET LE SERVEUR LE DIT LUI-MÊME.
   * Relevé le 05/11/2026, le corps du 502 d'`overpass-api.de` est :
   * « This Overpass API server is currently at capacity. All query workers are
   * busy and the request queue is full. Retry your request using exponential
   * backoff ». C'est une saturation passagère, et l'amont DEMANDE le réessai —
   * à l'inverse du 429, où il demande une pause.
   */
  if (reponse.status === 502) return { statut: "echec", raison: "at_capacity" };
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

/**
 * Envoie une requête Overpass et classe ce qui revient.
 *
 * ⚠️ LA REQUÊTE VOYAGE EN CORPS, JAMAIS EN CHAÎNE DE REQUÊTE. Une requête
 * `around:` en URL contiendrait la position de l'élève, et finirait dans les
 * journaux d'accès de l'amont, dans les nôtres, et dans tout intermédiaire du
 * chemin. C'est le même arbitrage que le POST de `/nearby`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ IL Y A DÉSORMAIS DES RÉESSAIS, ET CE REVIREMENT EST ARGUMENTÉ
 * ════════════════════════════════════════════════════════════════════════════
 * Ce fichier disait « AUCUN RÉESSAI, NULLE PART », et la raison était juste :
 * un adaptateur qui réessaie tout seul multiplie silencieusement la charge que
 * l'appelant croit avoir bornée. Deux faits mesurés l'ont fait changer :
 *
 *   1. le corps du 502 d'`overpass-api.de` demande EXPLICITEMENT un réessai
 *      avec backoff exponentiel — c'est l'amont qui le prescrit ;
 *   2. la saturation est fréquente et brève : la file se vide en quelques
 *      secondes, et l'élève voyait « la recherche n'a pas abouti » pour une
 *      panne qui n'existait déjà plus.
 *
 * La charge reste bornée, et de trois façons :
 *   · AUCUN réessai sur 429 (la politique demande une pause de 30 s) ni sur une
 *     réponse mal formée (la rejouer n'y changerait rien) ;
 *   · deux tentatives supplémentaires au plus, avec une pause qui double ;
 *   · un DÉLAI TOTAL : si le temps restant ne suffit pas à une tentative
 *     complète, on ne la lance pas. Un réessai condamné d'avance prendrait un
 *     créneau à quelqu'un d'autre pour rien.
 */
export async function interrogerOverpass(
  requete: string,
  options: OptionsOverpass = {},
): Promise<ReponseOverpass> {
  const transport = options.transport ?? fetch;
  const delai = options.timeoutMs ?? OVERPASS_TIMEOUT_MS;
  const delaiTotal = options.delaiTotalMs ?? OVERPASS_DELAI_TOTAL_MS;
  const attendre = options.attendre ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maintenant = options.maintenant ?? (() => Date.now());
  const pointsDEntree = options.pointsDEntree ?? pointsDEntreeOverpass();

  // ⚠️ L'AGENT EST OBLIGATOIRE, ET SON ABSENCE LÈVE. OSM demande un agent
  // identifiant ; fabriquer un repli générique ferait passer l'oubli inaperçu
  // jusqu'au jour du blocage. Il ne quitte jamais le serveur, et ne porte
  // aucun secret : c'est un nom d'application et un contact.
  const agent = userAgentOff();
  const debut = maintenant();

  let derniere: ReponseOverpass = { statut: "echec", raison: "unavailable" };

  for (let tentative = 0; tentative <= OVERPASS_REESSAIS_MAX; tentative += 1) {
    /*
     * ⚠️ LES POINTS D'ENTRÉE TOURNENT AVEC LES TENTATIVES. Avec un seul — le
     * cas par défaut — cela revient à réinterroger le même, ce qui est
     * exactement ce que le 502 demande. Avec plusieurs déclarés, la deuxième
     * tentative part ailleurs, ce qui est tout l'intérêt d'en déclarer.
     */
    const pointDEntree = pointsDEntree[tentative % pointsDEntree.length]!;
    const restant = delaiTotal - (maintenant() - debut);
    if (restant <= 0) break;

    derniere = await tenterOverpass(
      pointDEntree,
      requete,
      transport,
      agent,
      Math.min(delai, restant),
    );
    if (derniere.statut !== "echec") return derniere;
    if (!RAISONS_TEMPORAIRES.has(derniere.raison)) return derniere;

    const pause = OVERPASS_BACKOFF_MS * 2 ** tentative;
    const resteApresPause = delaiTotal - (maintenant() - debut) - pause;
    /*
     * ⚠️ ON NE LANCE PAS UNE TENTATIVE QU'ON NE PEUT PAS FINIR. Il faut qu'il
     * reste la pause ET de quoi mener un aller-retour utile ; sinon on rend
     * l'échec tout de suite, ce qui est plus honnête et plus rapide pour
     * l'élève.
     */
    if (tentative === OVERPASS_REESSAIS_MAX || resteApresPause <= 2_000) break;
    await attendre(pause);
  }

  return derniere;
}
