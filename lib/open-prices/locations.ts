import "server-only";

import { OFF_TIMEOUT_MS } from "@/lib/open-food-facts/contrat";
import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";
import {
  NEARBY_PAGES_MAX,
  NEARBY_RESULTATS_CIBLE,
  NEARBY_TAILLE_PAGE,
  PAYS_CODE,
  PAYS_NOM_AMONT,
  VILLE_PAGES_MAX,
  VILLE_RESULTATS_CIBLE,
  VILLE_TAILLE_PAGE,
  type LieuBrut,
  type MagasinProche,
  magasinsCoherents,
  magasinsParPertinenceVille,
  normaliserLieu,
  retenirCandidats,
} from "@/lib/nutrition/magasin-proche";
import { OPEN_PRICES_API_VERSION, OPEN_PRICES_BASE_URL } from "@/lib/open-prices/apercu";

/**
 * COURSES C4.3a — LES MAGASINS PROCHES, LUS CHEZ OPEN PRICES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE NE DÉCIDE RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * Il construit une URL, appelle, annule au bout d'un temps borné, et rend des
 * objets déjà filtrés par `lib/nutrition/magasin-proche.ts`. Toutes les règles
 * — quel rayon, quel lieu est un magasin, combien de pages — vivent dans le
 * module PUR, où elles se prouvent sans réseau.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ `server-only`, ET CE N'EST PAS DÉCORATIF
 * ────────────────────────────────────────────────────────────────────────────
 * La position d'un élève transite par ici. Si un composant client pouvait
 * importer ce fichier, la même position partirait du navigateur directement
 * vers un tiers, avec l'adresse IP de l'élève et sans que nous puissions ni
 * borner le rayon, ni limiter le débit, ni filtrer la réponse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE CLÉ, ET C'EST MESURÉ
 * ────────────────────────────────────────────────────────────────────────────
 * `DEFAULT_PERMISSION_CLASSES` et `DEFAULT_AUTHENTICATION_CLASSES` sont des
 * listes VIDES dans la configuration d'Open Prices : les lectures se font sans
 * jeton. Aucun en-tête `Authorization` n'est donc émis — et il n'y a aucun
 * secret à exposer, ni côté client, ni côté serveur.
 */

/** `GET /api/v1/locations/nearby` — ajouté en amont le 15/05/2026 (v1.104.0). */
export const OPEN_PRICES_NEARBY_URL = `${OPEN_PRICES_BASE_URL}/api/${OPEN_PRICES_API_VERSION}/locations/nearby`;

/** `GET /api/v1/locations/{id}` — la fiche canonique d'un lieu, par identifiant. */
export const OPEN_PRICES_LOCATION_URL = `${OPEN_PRICES_BASE_URL}/api/${OPEN_PRICES_API_VERSION}/locations`;

export interface PositionRecherche {
  readonly lat: number;
  readonly lon: number;
  readonly rayonKm: number;
}

export interface OptionsRecherche {
  readonly transport?: Transport;
  readonly timeoutMs?: number;
}

export interface ResultatRecherche {
  /**
   * ⚠️ `false` = LA LECTURE A ÉCHOUÉ, ce n'est PAS « aucun magasin ». Même
   * distinction qu'en C4.1 : confondre les deux ferait dire « aucun magasin
   * près de vous » à quelqu'un dont le réseau a lâché.
   */
  readonly ok: boolean;
  readonly magasins: readonly MagasinProche[];
  /** La recherche s'est arrêtée sur sa borne, pas sur la fin des résultats. */
  readonly tronque: boolean;
  /** Pages réellement lues chez l'amont — jamais plus de `NEARBY_PAGES_MAX`. */
  readonly pagesLues: number;
}

function urlPage(position: PositionRecherche, page: number): string {
  // ⚠️ CINQ PARAMÈTRES, ET PAS UN DE PLUS. Rien de ce que le navigateur envoie
  // n'est recopié ici : ni champ libre, ni `fields`, ni tri. La position est
  // la seule donnée qui vienne de l'élève, et elle est validée avant d'arriver.
  const params = new URLSearchParams({
    lat: String(position.lat),
    lon: String(position.lon),
    radius_km: String(position.rayonKm),
    page: String(page),
    size: String(NEARBY_TAILLE_PAGE),
  });
  return `${OPEN_PRICES_NEARBY_URL}?${params.toString()}`;
}

interface Enveloppe {
  readonly items?: unknown;
  readonly pages?: unknown;
}

/**
 * ⚠️ « ABSENT » ET « INDISPONIBLE » SONT DEUX RÉPONSES DIFFÉRENTES, ET LES
 * CONFONDRE ÉTAIT UN VRAI DÉFAUT DE CE LOT.
 *
 * Une première version rendait `null` pour tout — 404, 429, 500, timeout, JSON
 * illisible — et la route de sélection répondait « Magasin introuvable ». Un
 * élève dont l'appel avait expiré cherchait donc un magasin qui existait, en
 * concluant qu'il n'existait pas. Le seul cas où « introuvable » est VRAI est
 * le 404.
 */
type Lecture =
  | { readonly statut: "corps"; readonly corps: unknown }
  | { readonly statut: "absent" }
  | { readonly statut: "indisponible"; readonly cause: "http" | "reseau" | "corps_illisible" };

async function lireJson(
  url: string,
  transport: Transport,
  timeoutMs: number,
  entete: string,
): Promise<Lecture> {
  // ⚠️ ON ANNULE, ON N'ATTEND PAS. Sans `AbortController`, une connexion qui
  // ne répond jamais tient une requête serveur ouverte indéfiniment — l'élève
  // voit une roue qui tourne, et nous une ressource bloquée.
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), timeoutMs);
  try {
    const reponse = await transport(url, {
      method: "GET",
      headers: { "User-Agent": entete, Accept: "application/json" },
      signal: controleur.signal,
      cache: "no-store",
    });
    // 404 : la ressource n'existe pas. C'est un FAIT, pas une panne.
    if (reponse.status === 404) return { statut: "absent" };
    // Tout le reste — 429, 5xx, 4xx inattendu — est une indisponibilité. Un
    // 429 surtout : il dit « reviens plus tard », jamais « ça n'existe pas ».
    if (!reponse.ok) return { statut: "indisponible", cause: "http" };
    try {
      return { statut: "corps", corps: (await reponse.json()) as unknown };
    } catch {
      // Une page de maintenance en HTML arrive ici. Ce n'est pas une absence.
      return { statut: "indisponible", cause: "corps_illisible" };
    }
  } catch {
    // Timeout (abort) et coupure réseau.
    return { statut: "indisponible", cause: "reseau" };
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Les magasins alimentaires autour d'une position, triés par distance.
 *
 * ⚠️ LA PAGINATION EST BORNÉE PAR CONSTRUCTION. On avance tant qu'il manque des
 * résultats ET qu'il reste des pages ET qu'on n'a pas atteint `NEARBY_PAGES_MAX`.
 * Les trois conditions sont nécessaires : le filtrage étant chez nous, une page
 * peut ne rien donner, et un arrêt à la première afficherait une liste
 * faussement courte ; mais sans plafond, un secteur sans commerce ferait
 * défiler tout le service.
 *
 * ⚠️ ET LA POSITION NE SORT PAS D'ICI. Elle n'est ni journalisée, ni renvoyée,
 * ni mise en cache : `cache: "no-store"` le dit aussi à la couche fetch.
 */
export async function chercherMagasinsProches(
  position: PositionRecherche,
  options: OptionsRecherche = {},
): Promise<ResultatRecherche> {
  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? OFF_TIMEOUT_MS;
  // ⚠️ HORS DU `try`, ET C'EST VOLONTAIRE. `userAgentOff()` lève quand la
  // variable d'environnement manque : c'est une faute de CONFIGURATION, pas une
  // panne réseau. L'attraper ici la déguiserait en « Open Prices indisponible »,
  // et personne ne chercherait plus jamais la vraie cause.
  const entete = userAgentOff();

  // ⚠️ DEUX ACCUMULATEURS, ET C'EST NÉCESSAIRE. `candidats` garde TOUT ce qui a
  // été vu ; `magasins` n'en est que la projection cohérente. Une ambiguïté
  // révélée à la page 3 doit pouvoir retirer un magasin retenu à la page 1 —
  // impossible si l'on n'avait gardé que la projection.
  let candidats: readonly MagasinProche[] = [];
  let magasins: readonly MagasinProche[] = [];
  let pagesLues = 0;
  let pagesAmont = 1;
  let ok = true;

  for (let page = 1; page <= NEARBY_PAGES_MAX; page += 1) {
    const lecture = await lireJson(urlPage(position, page), transport, timeoutMs, entete);
    if (lecture.statut !== "corps") {
      // ⚠️ MÊME UN 404 EST UNE PANNE ICI. Sur `/nearby`, il ne veut pas dire
      // « aucun magasin » — l'amont rend une enveloppe vide pour cela — mais
      // « cette page n'existe pas », donc une pagination désynchronisée.
      ok = false;
      break;
    }
    pagesLues = page;

    const enveloppe = (lecture.corps ?? {}) as Enveloppe;
    const items = Array.isArray(enveloppe.items) ? (enveloppe.items as LieuBrut[]) : null;
    if (items === null) {
      // Un corps sans `items` n'est pas une page vide : c'est une réponse que
      // nous ne comprenons pas.
      ok = false;
      break;
    }
    pagesAmont = typeof enveloppe.pages === "number" ? enveloppe.pages : page;

    candidats = retenirCandidats(items, candidats);
    magasins = magasinsCoherents(candidats);
    if (magasins.length >= NEARBY_RESULTATS_CIBLE) break;
    if (page >= pagesAmont) break;
  }

  // ⚠️ `tronque` VEUT DIRE : « TOUT CE QUI EXISTE N'A PAS ÉTÉ RENDU ». La
  // première version ne regardait que les pages non lues, et ratait le cas le
  // plus fréquent : une page qui donne 25 magasins valides alors que l'écran
  // n'en montre que 20. Cinq en moins, sans que rien ne le dise.
  //
  // Deux raisons de tronquer, et il suffit de l'une :
  //   · on a retenu PLUS que la cible, donc le `slice` en coupe ;
  //   · l'amont annonce encore des pages qu'on n'a pas lues.
  const tronque = ok && (magasins.length > NEARBY_RESULTATS_CIBLE || pagesAmont > pagesLues);

  return {
    ok,
    magasins: ok ? magasins.slice(0, NEARBY_RESULTATS_CIBLE) : [],
    tronque,
    pagesLues,
  };
}

/**
 * Ce qu'une relecture de fiche peut apprendre — et les quatre réponses sont
 * VRAIMENT différentes, jusque dans le code HTTP que la route en tirera.
 */
export type IssueMagasin =
  | { readonly statut: "trouve"; readonly magasin: MagasinProche }
  /** 404 franc de l'amont : ce lieu n'existe pas. */
  | { readonly statut: "absent" }
  /** La fiche existe mais ne décrit pas un commerce alimentaire exploitable. */
  | { readonly statut: "non_exploitable" }
  /** 429, 5xx, timeout, corps illisible — on ne sait pas, et on le dit. */
  | { readonly statut: "indisponible"; readonly cause: "http" | "reseau" | "corps_illisible" };

/**
 * La fiche CANONIQUE d'un magasin, relue chez l'amont par son identifiant.
 *
 * ⚠️ C'EST LA PIÈCE DE SÉCURITÉ DE LA SÉLECTION. Le navigateur n'envoie qu'un
 * entier ; tout ce qui sera écrit dans `stores` — nom, enseigne, adresse,
 * coordonnées, identité OSM — vient de CETTE relecture, et de nulle part
 * ailleurs. Un client ne peut donc pas faire créer « Mon faux magasin » : il ne
 * peut que désigner un lieu qui existe déjà chez la source.
 *
 * ⚠️ ET ELLE NE REND PLUS `null` POUR TOUT. « Ce magasin n'existe pas » et
 * « je n'ai pas pu le vérifier » ne s'affichent pas de la même façon, et ne
 * méritent pas le même code HTTP.
 */
export async function lireMagasinCanonique(
  opLocationId: number,
  options: OptionsRecherche = {},
): Promise<IssueMagasin> {
  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? OFF_TIMEOUT_MS;
  const entete = userAgentOff();

  const lecture = await lireJson(
    `${OPEN_PRICES_LOCATION_URL}/${opLocationId}`,
    transport,
    timeoutMs,
    entete,
  );
  if (lecture.statut === "absent") return { statut: "absent" };
  if (lecture.statut === "indisponible") return { statut: "indisponible", cause: lecture.cause };
  if (typeof lecture.corps !== "object" || lecture.corps === null) {
    return { statut: "indisponible", cause: "corps_illisible" };
  }

  // ⚠️ `distance_km` N'EXISTE PAS SUR LA FICHE : elle est une propriété de la
  // RECHERCHE, pas du lieu. `normaliserLieu` le sait — elle rend `null` — et
  // aucune distance n'est donc fabriquée ici. Elle n'est de toute façon jamais
  // persistée : C4.2 n'a pas de colonne pour ça, délibérément.
  const magasin = normaliserLieu(lecture.corps as LieuBrut);
  // Une fiche présente mais inexploitable — librairie, lieu sans nom, identité
  // hors bornes sûres — n'est pas une absence : elle n'est pas SÉLECTIONNABLE.
  if (magasin === null) return { statut: "non_exploitable" };
  // L'identité rendue doit être celle demandée : sinon c'est une redirection,
  // une page d'erreur déguisée, ou un lieu fusionné — et on ne devine pas.
  if (magasin.opLocationId !== opLocationId) return { statut: "non_exploitable" };
  return { statut: "trouve", magasin };
}


/* ── COURSES C4.3b — LA RECHERCHE MANUELLE PAR VILLE ────────────────────── */

/** `GET /api/v1/locations` — la liste filtrable. Pas `/nearby`. */
export const OPEN_PRICES_LOCATIONS_URL = OPEN_PRICES_LOCATION_URL;

export interface RechercheVille {
  /** La saisie de l'élève, déjà validée. Envoyée TELLE QUELLE à l'amont. */
  readonly ville: string;
}

function urlVille(recherche: RechercheVille, page: number): string {
  // ⚠️ QUATRE PARAMÈTRES, ET PAS UN DE PLUS.
  //
  // ⚠️ LE PAYS BORNE LA REQUÊTE **AVANT** LA PAGINATION — ET C'ÉTAIT UN VRAI
  // DÉFAUT DE LA PREMIÈRE VERSION.
  //
  // Filtrer le pays chez nous, après coup, arrive trop tard : la pagination
  // amont a déjà choisi ce que nous voyons. Une ville homonyme dans plusieurs
  // pays remplissait alors nos trois pages de résultats étrangers, tous
  // rejetés, et l'écran annonçait « aucun magasin » alors que le magasin
  // français attendait en page 4. Le domaine doit être réduit à la SOURCE.
  //
  // ⚠️ ET LE NOM DU PAYS EST UNE CONSTANTE SERVEUR. `PAYS_NOM_AMONT` ne vient
  // jamais du navigateur : le client envoie une ville, rien d'autre. Un client
  // qui pourrait dicter ce paramètre choisirait le pays de recherche d'un lot
  // qui n'en connaît qu'un.
  //
  // ⚠️ LA VILLE PART NON NORMALISÉE. Le filtre amont est un `icontains`, donc
  // déjà insensible à la casse ; lui envoyer une chaîne dépouillée de ses
  // accents ferait manquer les villes que la source orthographie correctement.
  const params = new URLSearchParams({
    osm_address_city__like: recherche.ville,
    osm_address_country__like: PAYS_NOM_AMONT,
    page: String(page),
    size: String(VILLE_TAILLE_PAGE),
  });
  return `${OPEN_PRICES_LOCATIONS_URL}?${params.toString()}`;
}

/**
 * Les magasins alimentaires d'une ville, pour l'élève qui ne veut — ou ne peut
 * — pas être géolocalisé.
 *
 * ⚠️ MÊMES RÈGLES QUE `chercherMagasinsProches`, ET LITTÉRALEMENT LES MÊMES
 * FONCTIONS : `retenirCandidats` pour l'accumulation et la déduplication,
 * `identitesCoherentes` pour l'ambiguïté, `estCommerceAlimentaire` via
 * `normaliserLieu` pour le périmètre commercial. Deux copies auraient divergé,
 * et l'élève aurait vu un magasin par un chemin mais pas par l'autre.
 *
 * Seul le TRI diffère, et pour une raison de fond : une recherche par ville n'a
 * aucun point de départ, donc aucune distance à ordonner.
 */
export async function chercherMagasinsParVille(
  recherche: RechercheVille,
  options: OptionsRecherche = {},
): Promise<ResultatRecherche> {
  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? OFF_TIMEOUT_MS;
  const entete = userAgentOff();

  let candidats: readonly MagasinProche[] = [];
  let magasins: readonly MagasinProche[] = [];
  let pagesLues = 0;
  let pagesAmont = 1;
  let ok = true;

  for (let page = 1; page <= VILLE_PAGES_MAX; page += 1) {
    const lecture = await lireJson(urlVille(recherche, page), transport, timeoutMs, entete);
    if (lecture.statut !== "corps") {
      ok = false;
      break;
    }
    pagesLues = page;

    const enveloppe = (lecture.corps ?? {}) as Enveloppe;
    const items = Array.isArray(enveloppe.items) ? (enveloppe.items as LieuBrut[]) : null;
    if (items === null) {
      ok = false;
      break;
    }
    pagesAmont = typeof enveloppe.pages === "number" ? enveloppe.pages : page;

    // ⚠️ DÉFENSE EN PROFONDEUR, PAS DOUBLON. Le filtre amont a réduit le
    // domaine ; celui-ci CONFIRME que la réponse respecte bien le pays attendu.
    // Les deux ne portent d'ailleurs pas sur la même donnée : l'amont filtre le
    // NOM en toutes lettres par sous-chaîne, nous vérifions le CODE ISO. Si la
    // source venait à rendre un commerce hors de France malgré le filtre — nom
    // de pays mal renseigné, homonymie de graphie — il ne passe pas ici.
    const duPays = items.filter(
      (i) =>
        typeof i.osm_address_country_code === "string" &&
        i.osm_address_country_code.toUpperCase() === PAYS_CODE,
    );

    candidats = retenirCandidats(duPays, candidats);
    magasins = magasinsParPertinenceVille(candidats, recherche.ville);
    if (magasins.length >= VILLE_RESULTATS_CIBLE) break;
    if (page >= pagesAmont) break;
  }

  const tronque = ok && (magasins.length > VILLE_RESULTATS_CIBLE || pagesAmont > pagesLues);

  return {
    ok,
    magasins: ok ? magasins.slice(0, VILLE_RESULTATS_CIBLE) : [],
    tronque,
    pagesLues,
  };
}
