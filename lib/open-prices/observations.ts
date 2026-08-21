import "server-only";

import { OFF_TIMEOUT_MS } from "@/lib/open-food-facts/contrat";
import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";
import { decouperLotsCodesBarres, verifierReponseOpenPrices } from "@/lib/nutrition/pont-retail";
import {
  MAX_OBSERVATIONS_PAGES,
  type LectureObservations,
  type ObservationPrix,
  normaliserObservation,
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
export function urlObservations(params: {
  readonly codes: readonly string[];
  readonly opLocationId: number;
  readonly page: number;
}): string {
  const recherche = new URLSearchParams({
    product_code__in: params.codes.join(","),
    location_id: String(params.opLocationId),
    type: "PRODUCT",
    currency: "EUR",
    price_is_discounted: "false",
    order_by: "-date",
    size: String(OPEN_PRICES_OBSERVATIONS_SIZE),
    page: String(params.page),
  });
  return `${OPEN_PRICES_BASE_URL}/api/${OPEN_PRICES_API_VERSION}/prices?${recherche.toString()}`;
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
