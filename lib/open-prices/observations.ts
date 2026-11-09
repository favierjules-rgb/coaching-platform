import "server-only";

import { OFF_TIMEOUT_MS } from "@/lib/open-food-facts/contrat";
import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";
import { decouperLotsCodesBarres, verifierReponseOpenPrices } from "@/lib/nutrition/pont-retail";
import {
  MAX_OBSERVATIONS_PAGES,
  type LectureCategorie,
  type LectureObservations,
  type ObservationCategorie,
  type ObservationPrix,
  normaliserObservation,
  normaliserObservationCategorie,
  verifierMagasinDesObservations,
} from "@/lib/nutrition/prix-observes";
import { OPEN_PRICES_API_VERSION, OPEN_PRICES_BASE_URL } from "@/lib/open-prices/apercu";

/**
 * COURSES C4.4 — OPEN PRICES, EN LECTURE, POUR UN MAGASIN DONNÉ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN SECOND MODULE, ET PAS UNE OPTION SUR `apercu.ts`
 * ────────────────────────────────────────────────────────────────────────────
 * `lib/open-prices/apercu.ts` répond à la question de la CURATION : « ce
 * produit est-il relevé quelque part, et à quelle date ? ». Il ne rend aucun
 * montant, ne filtre aucun magasin, lit une seule page, et tolère volontairement
 * les relevés de ticket de caisse pour les COMPTER.
 *
 * C4.4 répond à une question différente : « que coûte ce produit DANS CE
 * MAGASIN ? ». Il rend des montants, filtre un `location_id`, pagine, et refuse
 * tout ce qui n'est pas un prix normal en euros.
 *
 * Les fusionner derrière un drapeau donnerait une fonction dont la moitié des
 * paramètres est inerte selon l'appelant — et l'écran de curation, éprouvé,
 * hériterait des régressions de l'écran de courses. Deux questions, deux
 * modules ; les GARDE-FOUS, eux, sont partagés (`decouperLotsCodesBarres`,
 * `verifierReponseOpenPrices`), parce que ce sont eux qu'il ne faut jamais
 * réécrire deux fois.
 *
 * ⚠️ CE MODULE NE FAIT QUE LIRE. Aucune écriture, aucun cache, aucune
 * persistance. Une observation vit le temps d'un affichage.
 */

/**
 * `size` demandé par page. Le maximum amont est 100
 * (`open_prices/api/pagination.py` : `max_page_size = 100`) ; demander plus est
 * silencieusement ramené, autant l'écrire.
 */
export const OPEN_PRICES_OBSERVATIONS_SIZE = 100;

/**
 * L'URL d'une page de relevés, pour un lot de code-barres et UN magasin.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES SIX FILTRES, ET POURQUOI CHACUN EST LÀ
 * ════════════════════════════════════════════════════════════════════════════
 *   `product_code__in`     les code-barres du lot — TOUS ceux de l'aliment,
 *                          jamais un seul choisi à leur place ;
 *   `location_id`          le magasin de l'élève (`stores.op_location_id`).
 *                          ⚠️ Un identifiant inexistant rend 400, pas une liste
 *                          vide : la validation de clé étrangère est amont ;
 *   `type=PRODUCT`         Open Prices porte aussi 9 755 prix `CATEGORY`, qui
 *                          sont des prix au kilo de catégories entières. Les
 *                          mélanger à des prix de produits donnerait des
 *                          montants sans rapport ;
 *   `currency=EUR`         87 devises cohabitent dans la base. Afficher 3,20
 *                          sans savoir si ce sont des euros ou des francs
 *                          suisses est pire que ne rien afficher ;
 *   `price_is_discounted=false`  une promotion n'est pas le prix normal. Elle
 *                          existera peut-être un jour à l'écran, étiquetée
 *                          comme telle — pas aujourd'hui, et jamais confondue ;
 *   `order_by=-date`       ⚠️ `order_by`, PAS `ordering` : Open Prices redéfinit
 *                          `ORDERING_PARAM`. Sans lui, le tri par défaut est
 *                          `["id"]` et l'on obtiendrait les relevés les PLUS
 *                          ANCIENS.
 */
export type TypeReleve = "PRODUCT" | "CATEGORY";

/**
 * SUR QUOI porte une lecture de relevés. Quatre portées, exclusives.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ `location_osm_id__in` N'EXISTE PAS, ET CE N'EST PAS UN OUBLI
 * ════════════════════════════════════════════════════════════════════════════
 * Mesuré sur l'API le 08/11/2026 :
 *
 *   location_osm_type=NODE                                   → 172 764
 *   location_osm_id__in=9928912836,7743505189&…_type=NODE     → 172 764  ⚠️
 *   location_osm_id__in=9928912836&…_type=NODE                → 172 764  ⚠️
 *   location_osm_id=9928912836&…_type=NODE                    →       1
 *   location_osm_id=9928912836,7743505189&…_type=NODE          → HTTP 400
 *
 * `location_osm_id__in` est **silencieusement ignoré** : la requête rend tous
 * les relevés de tous les lieux de ce type OSM. L'employer pour grouper des
 * magasins afficherait les prix de la France entière en croyant filtrer.
 *
 * Pour interroger PLUSIEURS magasins, il n'y a donc qu'une voie :
 * `location_id__in`, qui lui fonctionne (mesuré : `4877,621` → 10 relevés,
 * répartis 9 et 1). C'est la seule chose que le pont `op_location_id` sache
 * faire et que l'identité OSM ne sache pas — raison pour laquelle le pont
 * n'est pas supprimé.
 */
export type PorteeReleves =
  /** UN magasin, par son pont Open Prices. */
  | { readonly par: "magasin"; readonly opLocationId: number }
  /**
   * UN magasin, par son identité OpenStreetMap — SANS pont.
   *
   * ⚠️ ÉQUIVALENCE VÉRIFIÉE, sur les identifiants de relevés et pas seulement
   * sur les totaux : `location_id=4877` et `NODE/9928912836` rendent le même
   * ensemble ; idem pour `621`/`NODE/7743505189` et `360`/`NODE/25211512`.
   */
  | { readonly par: "identite_osm"; readonly osmType: TypeOsmReleve; readonly osmId: number }
  /** PLUSIEURS magasins — la seule portée groupée possible (voir ci-dessus). */
  | { readonly par: "magasins"; readonly opLocationIds: readonly number[] }
  /** Une ZONE géographique, sans aucun magasin désigné ni aucun pont. */
  | { readonly par: "zone"; readonly lat: number; readonly lon: number; readonly rayonKm: number };

export type TypeOsmReleve = "NODE" | "WAY" | "RELATION";

/**
 * L'URL d'une page de relevés.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES FILTRES TOUJOURS POSÉS, ET POURQUOI CHACUN EST LÀ
 * ════════════════════════════════════════════════════════════════════════════
 *   `currency=EUR`         87 devises cohabitent dans la base. Afficher 3,20
 *                          sans savoir si ce sont des euros ou des francs
 *                          suisses est pire que ne rien afficher ;
 *   `price_is_discounted=false`  une promotion n'est pas le prix normal ;
 *   `duplicate_of__isnull=true`  ⚠️ SUR `CATEGORY` SEULEMENT, PAS SUR
 *                          `PRODUCT` — voir `DUPLICATES_PAR_DEFAUT`. Mesuré :
 *                          `en:carrots` rend 288 relevés, 285 une fois les
 *                          doublons écartés — 1 %. Une MÉDIANE pondérerait deux
 *                          fois le même ticket ; un MINIMUM y est indifférent,
 *                          et son chemin n'avait rien demandé ;
 *   `order_by=-date`       ⚠️ `order_by`, PAS `ordering` : Open Prices redéfinit
 *                          `ORDERING_PARAM`. Sans lui, le tri par défaut est
 *                          `["id"]` et l'on obtiendrait les relevés les PLUS
 *                          ANCIENS.
 *
 * ⚠️ `type` N'EST PLUS FIGÉ À `PRODUCT`. Il l'était, et c'était une limitation
 * structurelle : les 10 619 relevés `CATEGORY` — des prix au kilo ou à la pièce
 * rattachés à une catégorie Open Food Facts plutôt qu'à un code-barres —
 * étaient hors de portée du code. Or une liste de courses faite d'aliments
 * génériques n'a pas de code-barres : c'est exactement ce qu'il lui faut.
 * Les deux types restent SÉPARÉS à la lecture ; ils ne sont jamais mélangés
 * dans une même réponse.
 */
export function urlReleves(params: {
  readonly type: TypeReleve;
  /** `PRODUCT` : les code-barres du lot. Ignoré pour `CATEGORY`. */
  readonly codes?: readonly string[];
  /** `CATEGORY` : le tag Open Food Facts, par exemple `en:carrots`. */
  readonly categoryTag?: string;
  readonly portee: PorteeReleves;
  readonly page: number;
  /**
   * Écarter les doublons déclarés par l'amont.
   *
   * ⚠️ PAR DÉFAUT : OUI POUR `CATEGORY`, NON POUR `PRODUCT`. Ce n'est pas une
   * asymétrie gratuite — voir `DUPLICATES_PAR_DEFAUT`.
   */
  readonly duplicatesExclus?: boolean;
}): string {
  const recherche = new URLSearchParams();

  /*
   * ⚠️ L'ORDRE D'INSERTION EST CELUI DU CHEMIN HISTORIQUE, et il est tenu
   * exprès. Pour un relevé PRODUIT dans un magasin, la chaîne produite est
   * octet pour octet celle d'avant ce lot : sélecteur, portée, type, devise,
   * remise, tri, taille, page. Un test l'exige (`CAT-04`).
   */
  if (params.type === "PRODUCT") {
    const codes = params.codes ?? [];
    if (codes.length === 0) throw new Error("urlReleves : un relevé PRODUCT exige des code-barres.");
    recherche.set("product_code__in", codes.join(","));
  } else {
    const tag = (params.categoryTag ?? "").trim();
    if (tag === "") throw new Error("urlReleves : un relevé CATEGORY exige un category_tag.");
    recherche.set("category_tag", tag);
  }

  const portee = params.portee;
  switch (portee.par) {
    case "magasin":
      recherche.set("location_id", String(portee.opLocationId));
      break;
    case "identite_osm":
      recherche.set("location_osm_type", portee.osmType);
      recherche.set("location_osm_id", String(portee.osmId));
      break;
    case "magasins": {
      if (portee.opLocationIds.length === 0) {
        throw new Error("urlReleves : une portée groupée exige au moins un magasin.");
      }
      recherche.set("location_id__in", portee.opLocationIds.join(","));
      break;
    }
    case "zone":
      recherche.set("lat", String(portee.lat));
      recherche.set("lon", String(portee.lon));
      recherche.set("radius_km", String(portee.rayonKm));
      break;
  }

  recherche.set("type", params.type);
  recherche.set("currency", "EUR");
  recherche.set("price_is_discounted", "false");
  if (params.duplicatesExclus ?? DUPLICATES_PAR_DEFAUT[params.type]) {
    recherche.set("duplicate_of__isnull", "true");
  }
  recherche.set("order_by", "-date");
  recherche.set("size", String(OPEN_PRICES_OBSERVATIONS_SIZE));
  recherche.set("page", String(params.page));

  return `${OPEN_PRICES_BASE_URL}/api/${OPEN_PRICES_API_VERSION}/prices?${recherche.toString()}`;
}

/**
 * Faut-il écarter les doublons, selon le type de relevé ?
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ NON POUR `PRODUCT`, ET C'EST UNE CORRECTION DE RÉGRESSION
 * ════════════════════════════════════════════════════════════════════════════
 * Ce lot avait posé `duplicate_of__isnull=true` sur TOUTES les requêtes, donc
 * aussi sur le chemin du PRIX EXACT — éprouvé, scellé, et qui n'avait rien
 * demandé. Changer en silence ce que renvoie l'amont à un chemin en production
 * n'est pas une amélioration : c'est une modification non décidée.
 *
 * ⚠️ ET L'EFFET N'AURAIT PAS ÉTÉ NEUTRE. C4.4 choisit un minimum parmi les
 * relevés d'un magasin ; retirer des lignes change l'ensemble où ce minimum est
 * cherché. Le résultat serait peut-être meilleur — ce n'est pas la question :
 * il n'a pas été mesuré, et le lot ne portait pas sur ce chemin.
 *
 * ⚠️ POUR `CATEGORY`, LE FILTRE EST AU CONTRAIRE NÉCESSAIRE. Mesuré :
 * `en:carrots` rend 288 relevés, 285 une fois les doublons écartés — 1 %. Une
 * MÉDIANE qui compte deux fois le même ticket de caisse est faussée, là où un
 * MINIMUM y est indifférent.
 *
 * Le paramètre reste surchargeable : le jour où quelqu'un VOUDRA l'activer sur
 * le chemin exact, ce sera une décision écrite, mesurée, et visible.
 */
export const DUPLICATES_PAR_DEFAUT: Readonly<Record<TypeReleve, boolean>> = {
  PRODUCT: false,
  CATEGORY: true,
};

/**
 * L'URL d'une page de relevés PRODUIT, pour un lot de code-barres et UN magasin.
 *
 * ⚠️ CONSERVÉE À L'IDENTIQUE, et réécrite au-dessus d'`urlReleves`. C'est le
 * chemin du PRIX EXACT, éprouvé : il rend la MÊME chaîne qu'avant ce lot, mêmes
 * paramètres, même ordre, sans filtre nouveau. `CAT-04` le vérifie, et vérifie
 * aussi l'absence de `duplicate_of__isnull`.
 */
export function urlObservations(params: {
  readonly codes: readonly string[];
  readonly opLocationId: number;
  readonly page: number;
}): string {
  return urlReleves({
    type: "PRODUCT",
    codes: params.codes,
    portee: { par: "magasin", opLocationId: params.opLocationId },
    page: params.page,
  });
}

export interface OptionsObservations {
  readonly gtins: readonly string[];
  readonly opLocationId: number;
  readonly transport?: Transport;
  readonly timeoutMs?: number;
}

interface Enveloppe {
  readonly items: readonly unknown[];
  readonly total: number;
  readonly pages: number;
}

function lireEnveloppe(corps: unknown): Enveloppe | null {
  if (typeof corps !== "object" || corps === null) return null;
  const e = corps as Record<string, unknown>;
  if (!Array.isArray(e["items"])) return null;
  const items = e["items"] as readonly unknown[];
  const total = typeof e["total"] === "number" ? e["total"] : items.length;
  // `pages` absent : on suppose une page unique plutôt que d'en inventer.
  const pages = typeof e["pages"] === "number" && e["pages"] > 0 ? e["pages"] : 1;
  return { items, total, pages };
}

const PANNE = (raison: "rate_limited" | "unavailable"): LectureObservations => ({
  ok: false,
  raison,
  observations: [],
  tronque: false,
  ignores: 0,
});

/**
 * Les relevés de prix normaux de N code-barres, dans UN magasin.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ TROIS BORNES, ET AUCUNE N'EST DÉCORATIVE
 * ════════════════════════════════════════════════════════════════════════════
 *   1. LES LOTS — `decouperLotsCodesBarres` : 7 codes, 97 caractères. MESURÉ le
 *      17/08/2026 : au-delà d'environ 98 caractères, `product_code__in` n'est
 *      pas rejeté, il est SILENCIEUSEMENT IGNORÉ, et l'API rend ses 290 000
 *      lignes. Sous la règle N-GTIN, un aliment BIEN curé atteint cette borne
 *      d'autant plus vite — le garde-fou compte donc davantage ici qu'en C4.1 ;
 *   2. LES PAGES — trois au plus par lot. Un écran de courses ne doit pas
 *      pouvoir déclencher trente allers-retours vers un service bénévole ;
 *   3. LA COHÉRENCE — chaque page est vérifiée deux fois : les code-barres
 *      appartiennent-ils au lot demandé, et les relevés viennent-ils du magasin
 *      demandé ? Un seul écart prouve qu'un filtre a sauté, et le lot entier est
 *      jeté.
 *
 * ⚠️ UNE PANNE N'EST JAMAIS UNE ABSENCE. `ok: false` remonte tel quel, et
 * `etatPrixObserves` le traduit en `indisponible`. Aucun chemin de ce fichier ne
 * peut transformer un 503 en « aucun relevé ».
 *
 * ⚠️ ET LA TRONCATURE SE DIT. Si un lot avait plus de trois pages, `tronque`
 * passe à `true` et l'absence cesse d'être définitive. Taire la borne
 * afficherait « aucun prix » sur un produit qui en a trois cents.
 */
export async function lireObservationsPrix(
  options: OptionsObservations,
): Promise<LectureObservations> {
  const lots = decouperLotsCodesBarres(options.gtins);
  if (lots.length === 0) {
    return { ok: true, observations: [], tronque: false, ignores: 0 };
  }

  const entete = userAgentOff();
  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const observations: ObservationPrix[] = [];
  let tronque = false;
  let ignores = 0;

  for (const lot of lots) {
    for (let page = 1; page <= MAX_OBSERVATIONS_PAGES; page += 1) {
      const controleur = new AbortController();
      const minuteur = setTimeout(() => controleur.abort(), options.timeoutMs ?? OFF_TIMEOUT_MS);
      let corps: unknown;
      try {
        const reponse = await transport(
          urlObservations({ codes: lot, opLocationId: options.opLocationId, page }),
          {
            method: "GET",
            headers: { "User-Agent": entete, Accept: "application/json" },
            signal: controleur.signal,
            cache: "no-store",
          },
        );
        if (reponse.status === 429) return PANNE("rate_limited");
        if (!reponse.ok) return PANNE("unavailable");
        corps = await reponse.json();
      } catch {
        return PANNE("unavailable");
      } finally {
        clearTimeout(minuteur);
      }

      const enveloppe = lireEnveloppe(corps);
      if (enveloppe === null) return PANNE("unavailable");

      // ── LES DEUX GARDES, AVANT TOUTE EXPLOITATION ────────────────────────
      const codesRendus = enveloppe.items
        .map((i) =>
          typeof i === "object" && i !== null &&
          typeof (i as Record<string, unknown>)["product_code"] === "string"
            ? ((i as Record<string, unknown>)["product_code"] as string)
            : "",
        )
        .filter((c) => c !== "");
      const horsLot = verifierReponseOpenPrices({
        total: enveloppe.total,
        codesDemandes: lot,
        codesRendus,
      });
      const horsMagasin = verifierMagasinDesObservations({
        opLocationId: options.opLocationId,
        items: enveloppe.items,
      });
      if (horsLot !== null || horsMagasin !== null) {
        console.error(
          `[OpenPrices] réponse incohérente (${horsLot ?? horsMagasin}) — lot de ${lot.length} codes ignoré.`,
        );
        return PANNE("unavailable");
      }

      for (const item of enveloppe.items) {
        const r = normaliserObservation(item, options.opLocationId);
        if (r.ok) observations.push(r.observation);
        else ignores += 1;
      }

      if (page >= enveloppe.pages) break;
      if (page === MAX_OBSERVATIONS_PAGES && enveloppe.pages > MAX_OBSERVATIONS_PAGES) {
        tronque = true;
      }
    }
  }

  return { ok: true, observations, tronque, ignores };
}

/* ══════════════════════════════════════════════════════════════════════════
   LA GARDE DE PORTÉE — PROUVER QUE CHAQUE RELEVÉ VIENT BIEN D'OÙ ON L'A DEMANDÉ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ POURQUOI CETTE GARDE EXISTE : UN FILTRE IGNORÉ NE SE VOIT PAS.
 *
 * Open Prices n'a pas rejeté `osm_address_city` ni `location_osm_id__in` : il
 * les a IGNORÉS et rendu la base entière. Un filtre de portée qui sauterait
 * produirait donc des prix de la France entière, crédibles et faux. On vérifie
 * la réponse plutôt que de faire confiance à la requête.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LES CHAMPS RÉELLEMENT RENDUS PAR L'AMONT — RELEVÉS, PAS SUPPOSÉS
 * ════════════════════════════════════════════════════════════════════════════
 * Un item `/api/v1/prices` porte, au premier niveau :
 *   `location_id`        int    — toujours présent (clé étrangère) ;
 *   `location_osm_id`    int    — ⚠️ `null` pour un lieu EN LIGNE ;
 *   `location_osm_type`  str    — ⚠️ `null` pour un lieu EN LIGNE ;
 * et un objet `location` de 28 champs, dont `osm_lat` / `osm_lon` — ⚠️ `null`
 * eux aussi pour un lieu en ligne.
 *
 * ⚠️ CES LIEUX EN LIGNE EXISTENT : 144 recensés (`/locations?type=ONLINE`),
 * et leurs prix portent bien `location_osm_id: null`. Ce n'est donc pas un cas
 * théorique, et un code qui supposerait l'identité OSM toujours présente
 * laisserait passer ces relevés sans pouvoir prouver leur provenance.
 */
export type IncoherencePortee =
  | "magasin_hors_portee"
  | "identite_osm_hors_portee"
  | "zone_hors_portee"
  /** ⚠️ L'AMONT N'A PAS RENDU DE QUOI PROUVER L'APPARTENANCE. Ni oui ni non. */
  | "portee_indemontrable";

/**
 * La marge tolérée sur le rayon, en proportion.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI UNE TOLÉRANCE EST INDISPENSABLE — DÉMONTRÉ, PAS SUPPOSÉ
 * ════════════════════════════════════════════════════════════════════════════
 * Une vérification STRICTE rejetterait des relevés que l'amont a légitimement
 * rendus. Mesuré par bisection du rayon sur deux lieux réels, depuis Toulon
 * (43.1214, 5.9280), le 08/11/2026 :
 *
 *   lieu 167 (Intermarché)   haversine 17,8727 km
 *                            l'API bascule entre 17,890 et 17,892
 *                            → distance amont ≈ 17,891 km, soit +0,102 %
 *   lieu 363 (Proxi)         haversine 22,1230 km
 *                            l'API bascule entre 22,12 et 22,14
 *                            → distance amont ≈ 22,13 km, soit +0,032 %
 *
 * L'amont calcule une distance systématiquement PLUS GRANDE que la nôtre —
 * signature d'un calcul géodésique sur l'ellipsoïde WGS84 là où nous utilisons
 * une sphère de rayon moyen. Sans tolérance, ces deux relevés seraient rejetés
 * et une page parfaitement valide deviendrait une fausse panne.
 *
 * ⚠️ 0,5 %, ET PAS 5 % — LA PREMIÈRE VALEUR ÉTAIT CINQUANTE FOIS TROP LARGE.
 *
 * ⚠️ ET CE 0,5 % N'EST PAS UNE BORNE UNIVERSELLE DÉMONTRÉE. Ce qui est
 * démontré, c'est l'écart RELEVÉ À TOULON ci-dessus : +0,03 % et +0,102 %. La
 * marge le couvre avec un facteur cinq, et son ordre de grandeur est cohérent
 * avec une divergence sphère/ellipsoïde — mais cette divergence dépend de la
 * latitude et de l'azimut, et nous ne l'avons mesurée qu'à une latitude et sur
 * deux azimuts. Une mesure à une autre latitude pourrait donner davantage.
 *
 * ⚠️ CE QU'IL FAUT FAIRE SI LE CAS SE PRÉSENTE : REMESURER, PAS ÉLARGIR AU
 * JUGÉ. `ZONE-05` échouera si l'écart mesuré venait à dépasser la marge, et
 * c'est là qu'il faudra reprendre la bisection — éventuellement à plusieurs
 * latitudes — avant de toucher à cette constante.
 *
 * Sur un rayon de 20 km, cela fait CENT MÈTRES. C'est une marge de calcul, pas
 * une échappatoire : un filtre amont qui sauterait rendrait des relevés à des
 * centaines de kilomètres, et ceux-là sont toujours refusés.
 */
export const MARGE_ZONE = 1.005;

/** Haversine, en kilomètres. Rayon moyen terrestre, suffisant à cette échelle. */
export function distanceKm(
  a: { readonly lat: number; readonly lon: number },
  b: { readonly lat: number; readonly lon: number },
): number {
  const R = 6371.0088;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nombre(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
}

/**
 * Une latitude recevable, ou `null`.
 *
 * ⚠️ UNE COORDONNÉE HORS BORNES N'EST PAS UNE COORDONNÉE LOINTAINE : c'est une
 * donnée fausse. Une latitude de 200° ne décrit aucun endroit ; la passer à la
 * haversine rendrait un nombre, et ce nombre n'aurait aucun sens. On refuse de
 * conclure plutôt que de conclure sur du bruit.
 */
export function latitudeValide(valeur: unknown): number | null {
  const n = nombre(valeur);
  return n !== null && n >= -90 && n <= 90 ? n : null;
}

/** Une longitude recevable, ou `null`. Mêmes raisons. */
export function longitudeValide(valeur: unknown): number | null {
  const n = nombre(valeur);
  return n !== null && n >= -180 && n <= 180 ? n : null;
}

/**
 * La portée demandée a-t-elle elle-même un sens ? `null` si oui.
 *
 * ⚠️ LE PIRE MODE DE PANNE D'UN GARDE-FOU EST DE SE DÉSARMER EN SILENCE. Avec
 * un rayon `NaN`, toute comparaison `d > NaN` est fausse : la garde laisserait
 * TOUT passer en croyant vérifier. Avec un rayon nul ou négatif, elle
 * rejetterait tout, y compris le relevé situé exactement au centre — une
 * requête qui n'a pas de sens ne doit pas produire un verdict qui en a l'air.
 *
 * ⚠️ APPELÉE AVANT TOUTE BOUCLE, pour que le verdict soit le même sur une
 * réponse vide et sur une réponse pleine.
 */
function verifierLaPorteeElleMeme(portee: PorteeReleves): IncoherencePortee | null {
  if (portee.par !== "zone") return null;
  const lat = latitudeValide(portee.lat);
  const lon = longitudeValide(portee.lon);
  const rayon = nombre(portee.rayonKm);
  // ⚠️ STRICTEMENT POSITIF : un rayon de zéro ne décrit aucune zone.
  if (lat === null || lon === null || rayon === null || rayon <= 0) {
    return "portee_indemontrable";
  }
  return null;
}

/**
 * Chaque item appartient-il à la portée demandée ? `null` si tout est en règle.
 *
 * ⚠️ UN SEUL ÉCART CONDAMNE LA PAGE ENTIÈRE. Même doctrine que les gardes de
 * C4.1 et C4.4 : un résultat à moitié faux est plus dangereux qu'une absence,
 * parce qu'il est croyable.
 *
 * ⚠️ ET « INDÉMONTRABLE » EST AUSSI UN ÉCHEC. Si l'amont ne rend pas de quoi
 * prouver l'appartenance — un lieu en ligne n'a ni identité OSM ni
 * coordonnées —, on ne présente pas ces relevés comme fiables. Ne pas pouvoir
 * vérifier n'est pas une raison de faire confiance.
 */
export function verifierPorteeDesReleves(params: {
  readonly portee: PorteeReleves;
  readonly items: readonly unknown[];
}): IncoherencePortee | null {
  const portee = params.portee;

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA PORTÉE SE VALIDE AVANT LA BOUCLE — ET C'EST UNE CORRECTION DE PANNE
   * ════════════════════════════════════════════════════════════════════════
   * Cette validation vivait DANS la boucle sur les relevés. Conséquence : sur
   * une réponse `items: []`, le corps de boucle ne s'exécutait jamais et la
   * fonction rendait `null` — « tout est en règle » — pour une portée dont le
   * rayon valait `NaN` ou dont le centre était hors bornes.
   *
   * Autrement dit, le garde-fou se taisait précisément dans le cas où il n'y
   * avait rien pour le réveiller. Une page vide était déclarée conforme à une
   * portée qui n'avait aucun sens.
   *
   * ⚠️ ET LA VALIDITÉ DE LA PORTÉE NE DÉPEND PAS DES RELEVÉS REÇUS. Un rayon
   * négatif est absurde qu'il revienne zéro ou mille relevés : la question se
   * tranche sur les paramètres seuls, donc avant de les regarder.
   */
  const porteeInvalide = verifierLaPorteeElleMeme(portee);
  if (porteeInvalide !== null) return porteeInvalide;

  for (const brut of params.items) {
    if (typeof brut !== "object" || brut === null) return "portee_indemontrable";
    const item = brut as Record<string, unknown>;

    switch (portee.par) {
      case "magasin": {
        const id = nombre(item["location_id"]);
        if (id === null) return "portee_indemontrable";
        if (id !== portee.opLocationId) return "magasin_hors_portee";
        break;
      }
      case "magasins": {
        const id = nombre(item["location_id"]);
        if (id === null) return "portee_indemontrable";
        if (!portee.opLocationIds.includes(id)) return "magasin_hors_portee";
        break;
      }
      case "identite_osm": {
        const osmId = nombre(item["location_osm_id"]);
        const osmType = item["location_osm_type"];
        // ⚠️ `null` SUR UN LIEU EN LIGNE : indémontrable, donc refusé.
        if (osmId === null || typeof osmType !== "string") return "portee_indemontrable";
        if (osmId !== portee.osmId || osmType !== portee.osmType) {
          return "identite_osm_hors_portee";
        }
        break;
      }
      case "zone": {
        /*
         * ⚠️ LE CENTRE ET LE RAYON ONT DÉJÀ ÉTÉ VALIDÉS, AVANT LA BOUCLE (voir
         * `verifierLaPorteeElleMeme`). On les relit ici uniquement pour les
         * typer en nombres sûrs : ils ne peuvent plus être invalides à ce
         * stade, et la double lecture ne coûte rien.
         */
        const centreLat = latitudeValide(portee.lat);
        const centreLon = longitudeValide(portee.lon);
        const rayon = nombre(portee.rayonKm);
        if (centreLat === null || centreLon === null || rayon === null || rayon <= 0) {
          return "portee_indemontrable";
        }
        const lieu = item["location"];
        if (typeof lieu !== "object" || lieu === null) return "portee_indemontrable";
        const lat = latitudeValide((lieu as Record<string, unknown>)["osm_lat"]);
        const lon = longitudeValide((lieu as Record<string, unknown>)["osm_lon"]);
        // ⚠️ ABSENTES, NON NUMÉRIQUES OU HORS BORNES : indémontrable, donc refusé.
        if (lat === null || lon === null) return "portee_indemontrable";
        const d = distanceKm({ lat: centreLat, lon: centreLon }, { lat, lon });
        if (d > rayon * MARGE_ZONE) return "zone_hors_portee";
        break;
      }
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   LES RELEVÉS PAR CATÉGORIE — LA LECTURE
   ══════════════════════════════════════════════════════════════════════════ */

export interface OptionsCategorie {
  /** Le tag Open Food Facts, par exemple `en:carrots`. */
  readonly categoryTag: string;
  readonly portee: PorteeReleves;
  readonly transport?: Transport;
  readonly timeoutMs?: number;
}

const PANNE_CATEGORIE = (
  raison: "rate_limited" | "unavailable" | "portee_invalide",
): LectureCategorie => ({
  ok: false,
  raison,
  observations: [],
  tronque: false,
  ignores: 0,
});

/**
 * Les relevés de prix d'UNE catégorie, sur une portée donnée.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CE QUE CETTE FONCTION NE FAIT PAS, ET NE DOIT JAMAIS FAIRE
 * ════════════════════════════════════════════════════════════════════════════
 * Elle ne rend AUCUN prix exact. Un relevé de catégorie dit « les carottes
 * coûtaient 2,90 € le kilo quelque part » — pas « ton paquet coûte 2,90 € ».
 * Le type rendu (`LectureCategorie`, `ObservationCategorie`) est distinct de
 * celui des prix exacts précisément pour qu'aucune addition ne soit possible
 * par distraction.
 *
 * ⚠️ TROIS BORNES, COMME POUR LES PRIX EXACTS
 *   1. LES PAGES — `MAX_OBSERVATIONS_PAGES` au plus, et la boucle s'arrête à
 *      `pages`. ⚠️ MESURÉ : demander une page au-delà de la dernière rend
 *      **HTTP 404** `{"detail":"Invalid page."}`, que `!reponse.ok`
 *      traduirait en panne. On ne la demande donc jamais ;
 *   2. LA TRONCATURE — au-delà de la borne, `tronque` le dit ;
 *   3. LA COHÉRENCE — chaque ligne doit porter la catégorie demandée. Un seul
 *      écart prouve que `category_tag` a sauté, et l'amont rendrait alors des
 *      centaines de milliers de lignes : la page entière est jetée.
 *
 * ⚠️ UNE RÉPONSE 200 AVEC `items: []` EST UNE ABSENCE, PAS UNE PANNE. Elle
 * rend `ok: true` et une liste vide. Mesuré : l'amont répond bien
 * `{"items": [], "page": 1, "pages": 1, "size": 50, "total": 0}`.
 */
export async function lireRelevesCategorie(
  options: OptionsCategorie,
): Promise<LectureCategorie> {
  const tag = options.categoryTag.trim();
  if (tag === "") return { ok: true, observations: [], tronque: false, ignores: 0 };

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LA PORTÉE EST VALIDÉE AVANT TOUT APPEL RÉSEAU
   * ════════════════════════════════════════════════════════════════════════
   * Elle ne l'était qu'APRÈS la réponse. Conséquence : une requête au rayon
   * `NaN` partait réellement chez Open Prices — `radius_km=NaN` dans l'URL —
   * avant d'être jugée. On envoyait une question absurde à un service bénévole,
   * puis on lisait sa réponse.
   *
   * ⚠️ ET LE REFUS EST NOMMÉ `portee_invalide`, PAS `unavailable`. Un appel mal
   * formé de notre côté n'est pas une panne de l'amont : l'annoncer comme telle
   * enverrait chercher un incident chez quelqu'un d'autre.
   */
  const porteeInvalide = verifierLaPorteeElleMeme(options.portee);
  if (porteeInvalide !== null) {
    console.error(`[OpenPrices] portée invalide (${porteeInvalide}) — aucune requête émise.`);
    return PANNE_CATEGORIE("portee_invalide");
  }

  const entete = userAgentOff();
  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const observations: ObservationCategorie[] = [];
  let tronque = false;
  let ignores = 0;

  for (let page = 1; page <= MAX_OBSERVATIONS_PAGES; page += 1) {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), options.timeoutMs ?? OFF_TIMEOUT_MS);
    let corps: unknown;
    try {
      const reponse = await transport(
        urlReleves({ type: "CATEGORY", categoryTag: tag, portee: options.portee, page }),
        {
          method: "GET",
          headers: { "User-Agent": entete, Accept: "application/json" },
          signal: controleur.signal,
          cache: "no-store",
        },
      );
      if (reponse.status === 429) return PANNE_CATEGORIE("rate_limited");
      if (!reponse.ok) return PANNE_CATEGORIE("unavailable");
      corps = await reponse.json();
    } catch {
      return PANNE_CATEGORIE("unavailable");
    } finally {
      clearTimeout(minuteur);
    }

    const enveloppe = lireEnveloppe(corps);
    if (enveloppe === null) return PANNE_CATEGORIE("unavailable");

    /*
     * ⚠️ LA GARDE DE CATÉGORIE, AVANT TOUTE EXPLOITATION. Si `category_tag`
     * avait été ignoré — c'est exactement ce qui arrive à `osm_address_city` et
     * à `location_osm_id__in` —, l'amont rendrait des relevés d'autres
     * catégories. Une seule ligne étrangère suffit à jeter la page.
     *
     * ⚠️ LA GARDE ÉTAIT OUVERTE, ET C'EST CORRIGÉ ICI. Elle n'accusait une
     * ligne que si son `category_tag` était une CHAÎNE différente. Un champ
     * absent, `null` ou numérique passait donc la garde — puis la
     * normalisation le refusait, et la lecture rendait `ok: true` avec ZÉRO
     * observation. Une réponse incohérente devenait une absence.
     *
     * ⚠️ ON EXIGE DONC LE CHAMP : une chaîne, non vide, égale au tag demandé
     * après le même `trim`. Tout le reste condamne la page.
     */
    const horsCategorie = enveloppe.items.some((i) => {
      if (typeof i !== "object" || i === null) return true;
      const brut = (i as Record<string, unknown>)["category_tag"];
      if (typeof brut !== "string") return true;
      const rendu = brut.trim();
      return rendu === "" || rendu !== tag;
    });
    if (horsCategorie) {
      console.error(`[OpenPrices] réponse incohérente (categorie_hors_lot) — « ${tag} » ignoré.`);
      return PANNE_CATEGORIE("unavailable");
    }

    /*
     * ⚠️ LA SECONDE GARDE : LA PORTÉE. La catégorie peut être la bonne et le
     * MAGASIN le mauvais — ce sont deux filtres indépendants, et chacun peut
     * sauter seul. Vérifier l'un sans l'autre laisserait passer les carottes de
     * la France entière sous couvert d'avoir demandé des carottes.
     */
    const horsPortee = verifierPorteeDesReleves({ portee: options.portee, items: enveloppe.items });
    if (horsPortee !== null) {
      console.error(`[OpenPrices] réponse incohérente (${horsPortee}) — « ${tag} » ignoré.`);
      return PANNE_CATEGORIE("unavailable");
    }

    for (const item of enveloppe.items) {
      const r = normaliserObservationCategorie(item);
      if (r.ok) observations.push(r.observation);
      else ignores += 1;
    }

    // ⚠️ ON NE DEMANDE JAMAIS LA PAGE `pages + 1` : elle rend 404.
    if (page >= enveloppe.pages) break;
    if (page === MAX_OBSERVATIONS_PAGES && enveloppe.pages > MAX_OBSERVATIONS_PAGES) {
      tronque = true;
    }
  }

  return { ok: true, observations, tronque, ignores };
}
