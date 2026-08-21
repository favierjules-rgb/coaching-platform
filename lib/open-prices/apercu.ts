import "server-only";

import { OFF_TIMEOUT_MS } from "@/lib/open-food-facts/contrat";
import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";
import {
  type ApercuPrix,
  apercuAbsent,
  decouperLotsCodesBarres,
  verifierReponseOpenPrices,
} from "@/lib/nutrition/pont-retail";

/**
 * COURSES C4.1 — OPEN PRICES, EN LECTURE, ET SEULEMENT POUR INFORMER LA
 * CURATION.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE NE CHIFFRE RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * Il répond à UNE question, celle que l'administrateur se pose devant une liste
 * de candidats : « ce produit est-il relevé quelque part, et à quelle date ? »
 *
 * Il ne rend AUCUN montant vers l'écran, n'écrit AUCUNE ligne en base, et ne
 * participe à AUCUN total. Le calcul du panier appartient à C4.3, avec sa
 * propre couche de cache et son propre arbitrage sur le conditionnement.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LE PIÈGE QUI A JUSTIFIÉ CE FICHIER
 * ────────────────────────────────────────────────────────────────────────────
 * Mesuré le 17/08/2026 sur l'API de production : au-delà d'environ 98
 * caractères, la valeur de `product_code__in` n'est pas rejetée, elle est
 * SILENCIEUSEMENT IGNORÉE — et l'API rend les 290 000 lignes de la table. Pas
 * de 400, pas de message.
 *
 * Un client naïf afficherait donc le prix d'un déodorant allemand comme prix du
 * riz de l'élève, et annoncerait « 290 792 prix trouvés » sans sourciller.
 *
 * D'où les deux gardes de `lib/nutrition/pont-retail.ts`, appliquées ici sans
 * exception : lots de 7 codes au plus, et vérification que chaque code rendu
 * appartient bien au lot demandé. Une incohérence est traitée comme une PANNE,
 * jamais comme un résultat.
 */

/** Production. Open Prices ne demande pas de clé pour lire. */
export const OPEN_PRICES_BASE_URL = "https://prices.openfoodfacts.org";

/**
 * La version de l'API Open Prices, dans UNE constante.
 *
 * ⚠️ ELLE N'EST PAS DANS `lib/open-food-facts/contrat.ts`, et c'est délibéré :
 * Open Prices est un SERVICE DIFFÉRENT, déployé séparément, versionné
 * séparément, qui peut changer de version sans qu'Open Food Facts bouge. La
 * ranger avec le contrat OFF ferait croire à un versionnement commun — et le
 * jour où l'un des deux migre, on chercherait longtemps.
 *
 * La règle de fond de A3-OFF1 est respectée à la lettre : une version d'API
 * vit dans une constante unique, et son nom dit de quel service elle parle.
 */
export const OPEN_PRICES_API_VERSION = "v1";

/**
 * `size` maximum accepté par la pagination d'Open Prices
 * (`open_prices/api/pagination.py` : `max_page_size = 100`). Demander plus est
 * silencieusement ramené à 100 — autant l'écrire.
 */
export const OPEN_PRICES_PAGE_MAX = 100;

/**
 * ⚠️ `kind=COMMUNITY` N'EST PAS FILTRÉ À LA REQUÊTE, IL EST COMPTÉ.
 *
 * COMMUNITY regroupe les preuves `PRICE_TAG` et `SHOP_IMPORT` — le prix affiché
 * EN RAYON. CONSUMPTION regroupe `RECEIPT` et `GDPR_REQUEST` — ce que quelqu'un
 * a réellement payé en caisse, remises de fidélité comprises.
 *
 * Pour « combien vais-je payer », COMMUNITY est la bonne famille. Mais en
 * curation, savoir qu'un produit n'a que des relevés de ticket reste une
 * information utile : on la COMPTE et on l'affiche, plutôt que de la faire
 * disparaître de la requête. Le filtrage dur appartiendra à C4.3, quand un prix
 * entrera vraiment dans un total.
 */
export const OPEN_PRICES_KIND_COMMUNITY = "COMMUNITY";

export interface OptionsApercu {
  readonly transport?: Transport;
  readonly timeoutMs?: number;
}

export interface LectureApercus {
  /**
   * ⚠️ `false` = LA LECTURE A ÉCHOUÉ, ce n'est PAS « aucun prix ». Même leçon
   * que `LecturePrix.ok` en C3 : un réseau coupé afficherait sinon « aucun prix
   * connu » sur tous les candidats, et l'administrateur en conclurait que la
   * base Open Prices est vide.
   */
  readonly ok: boolean;
  readonly apercus: ReadonlyMap<string, ApercuPrix>;
  /** Lots dont la réponse a été jugée incohérente — journalisés, jamais utilisés. */
  readonly lotsRejetes: number;
}

interface LigneprixBrute {
  readonly product_code?: unknown;
  readonly date?: unknown;
  readonly proof?: { readonly type?: unknown } | null;
}

/** Les quatre types de preuve regroupés en COMMUNITY par Open Prices. */
const PREUVES_COMMUNITY = new Set(["PRICE_TAG", "SHOP_IMPORT"]);

function urlLot(codes: readonly string[]): string {
  const params = new URLSearchParams({
    product_code__in: codes.join(","),
    order_by: "-date",
    size: String(OPEN_PRICES_PAGE_MAX),
    page: "1",
  });
  return `${OPEN_PRICES_BASE_URL}/api/${OPEN_PRICES_API_VERSION}/prices?${params.toString()}`;
}

/**
 * Agrège UNE page de relevés en aperçus par code-barres.
 *
 * L'ordre est `-date`, donc la PREMIÈRE occurrence d'un code est son relevé le
 * plus récent : `observeLe` est exact même quand le comptage ne l'est pas.
 *
 * ⚠️ `reponseComplete` DÉCIDE DU SENS DE L'ABSENCE. Si la page portait tout
 * (`total <= items.length`), un code absent n'a réellement aucun prix. Si elle
 * était tronquée, on ne sait pas — et `indetermine` le dit, plutôt que
 * d'afficher un « aucun prix » qui pourrait être faux.
 */
export function agregerApercus(
  codesDemandes: readonly string[],
  items: readonly LigneprixBrute[],
  total: number,
): ReadonlyMap<string, ApercuPrix> {
  const reponseComplete = total <= items.length;
  const parCode = new Map<string, { nombre: number; observeLe: string | null; community: number }>();

  for (const item of items) {
    const code = typeof item.product_code === "string" ? item.product_code : null;
    if (code === null) continue;
    const date = typeof item.date === "string" && item.date !== "" ? item.date : null;
    const typePreuve =
      item.proof && typeof item.proof === "object" && typeof item.proof.type === "string"
        ? item.proof.type
        : null;

    const courant = parCode.get(code) ?? { nombre: 0, observeLe: null, community: 0 };
    courant.nombre += 1;
    // ⚠️ `??=` et non un écrasement : trié par date décroissante, la première
    // date vue est la plus récente. La suivante ne doit pas la remplacer.
    // Et une ligne SANS date ne doit pas non plus effacer celle d'avant :
    // Open Prices tolère `date: null` (mesuré sur des relevés importés).
    if (courant.observeLe === null && date !== null) courant.observeLe = date;
    if (typePreuve !== null && PREUVES_COMMUNITY.has(typePreuve)) courant.community += 1;
    parCode.set(code, courant);
  }

  const apercus = new Map<string, ApercuPrix>();
  for (const code of codesDemandes) {
    const brut = parCode.get(code);
    if (!brut) {
      apercus.set(code, apercuAbsent(code, reponseComplete));
      continue;
    }
    apercus.set(code, {
      gtin: code,
      statut: "connu",
      nombre: brut.nombre,
      observeLe: brut.observeLe,
      nombreCommunity: brut.community,
    });
  }
  return apercus;
}

/**
 * Les aperçus de prix d'une liste de codes-barres.
 *
 * ⚠️ UNE PANNE NE FAIT PAS ÉCHOUER LA CURATION. Open Prices est un service tiers
 * bénévole ; s'il est injoignable, l'administrateur doit quand même pouvoir
 * rapprocher un produit. On rend `ok: false` et une carte vide — l'écran dira
 * « prix indisponibles », pas « aucun prix ».
 */
export async function lireApercusPrix(
  gtins: readonly string[],
  options: OptionsApercu = {},
): Promise<LectureApercus> {
  const lots = decouperLotsCodesBarres(gtins);
  if (lots.length === 0) return { ok: true, apercus: new Map(), lotsRejetes: 0 };

  const entete = userAgentOff();
  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const apercus = new Map<string, ApercuPrix>();
  let ok = true;
  let lotsRejetes = 0;

  for (const lot of lots) {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), options.timeoutMs ?? OFF_TIMEOUT_MS);
    let corps: unknown;
    try {
      const reponse = await transport(urlLot(lot), {
        method: "GET",
        headers: { "User-Agent": entete, Accept: "application/json" },
        signal: controleur.signal,
        cache: "no-store",
      });
      if (!reponse.ok) {
        ok = false;
        continue;
      }
      corps = await reponse.json();
    } catch {
      ok = false;
      continue;
    } finally {
      clearTimeout(minuteur);
    }

    const enveloppe = (corps ?? {}) as { items?: unknown; total?: unknown };
    const items = Array.isArray(enveloppe.items) ? (enveloppe.items as LigneprixBrute[]) : [];
    const total = typeof enveloppe.total === "number" ? enveloppe.total : items.length;

    // ⚠️ LE GARDE-FOU. Une réponse dont un seul code sort du lot prouve que le
    // filtre a sauté : on jette le lot ENTIER plutôt que d'en garder la moitié
    // crédible. Un résultat à moitié faux est plus dangereux qu'une absence.
    const codesRendus = items
      .map((i) => (typeof i.product_code === "string" ? i.product_code : ""))
      .filter((c) => c !== "");
    const incoherence = verifierReponseOpenPrices({ total, codesDemandes: lot, codesRendus });
    if (incoherence !== null) {
      console.error(
        `[OpenPrices] réponse incohérente (${incoherence}) pour ${lot.length} codes, total=${total} — lot ignoré.`,
      );
      lotsRejetes += 1;
      ok = false;
      continue;
    }

    for (const [code, apercu] of agregerApercus(lot, items, total)) {
      apercus.set(code, apercu);
    }
  }

  return { ok, apercus, lotsRejetes };
}
