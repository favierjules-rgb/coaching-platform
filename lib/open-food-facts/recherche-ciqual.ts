import "server-only";

import {
  OFF_BASE_URL,
  OFF_FIELDS,
  OFF_SEARCH_API_VERSION,
  OFF_TIMEOUT_MS,
  OffErreur,
  type ProduitSeth,
  estOffErreur,
  gtinEstValide,
  versProduitSeth,
} from "@/lib/open-food-facts/contrat";
import { type Transport, userAgentOff } from "@/lib/open-food-facts/client";
import {
  type RefusCandidat,
  codeCiqualEstValide,
} from "@/lib/nutrition/pont-retail";

/**
 * COURSES C4.1 — RECHERCHE DE PRODUITS PAR CODE CIQUAL STRUCTURÉ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI CE MODULE N'EST **PAS** `recherche.ts`, ET NE DOIT JAMAIS Y ÊTRE
 *    FUSIONNÉ
 * ════════════════════════════════════════════════════════════════════════════
 * Le projet possède déjà un adaptateur de recherche Open Food Facts :
 * `lib/open-food-facts/recherche.ts`. Il vise **Search-a-licious**, à l'hôte
 * `search.openfoodfacts.org`, et il fait bien son travail : chercher un produit
 * par un TEXTE que l'élève tape.
 *
 * Il est INUTILISABLE ici, et l'ajout d'un paramètre ne le rendrait pas
 * utilisable — il le rendrait FAUX EN SILENCE. Mesuré le 17/08/2026 sur
 * `search-a-licious/data/config/openfoodfacts.yml`, la configuration d'index du
 * service : les champs indexés sont `code, product_name, categories, labels,
 * brands, …`. Ne sont indexés **ni `categories_properties`, ni
 * `categories_properties_tags`, ni `ciqual_food_code`**.
 *
 * Filtrer sur un champ non indexé ne rend pas d'erreur : ça rend des résultats
 * qui n'ont pas été filtrés. Un développeur pressé qui « ajoute juste un
 * paramètre » à `recherche.ts` obtiendrait donc des produits plausibles et
 * faux, sans aucun signal — le pire des deux mondes.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ recherche.ts         search.openfoodfacts.org   texte libre     élève  │
 * │ recherche-ciqual.ts  world.openfoodfacts.org    code Ciqual     admin  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Deux services, deux hôtes, deux besoins. Ils partagent le NORMALISEUR
 * (`versProduitSeth`) et rien d'autre — comme `recherche.ts` le fait déjà,
 * et pour la même raison : deux implémentations d'une même règle
 * nutritionnelle finissent toujours par diverger, et la divergence se voit
 * d'abord dans l'assiette d'un élève.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE CONTRAT UTILISÉ, MESURÉ ET NON DEVINÉ
 * ════════════════════════════════════════════════════════════════════════════
 * L'API produit v2 expose, sur chaque fiche, les propriétés héritées de sa
 * catégorie :
 *
 *   categories_properties      { "ciqual_food_code:en": "31032", … }
 *   categories_properties_tags [ …, "ciqual-food-code-31032",
 *                                   "ciqual-food-code-known", … ]
 *
 * et `categories_properties_tags` est FILTRABLE. Vérifié le 17/08/2026 :
 * `?categories_properties_tags=ciqual-food-code-31032` rend 2 348 pâtes à
 * tartiner réelles.
 *
 * ⚠️ LA PROPRIÉTÉ EST PORTÉE PAR LA CATÉGORIE, PAS PAR LE PRODUIT — le produit
 * en hérite. Deux causes de silence, donc, et il ne faut pas les confondre :
 * un produit mal catégorisé, ou une catégorie qui ne porte aucun code Ciqual.
 * Ni l'une ni l'autre ne se répare de notre côté ; toutes deux rendent zéro
 * candidat, et zéro candidat n'est pas une panne.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. LE SERVICE — MÊME HÔTE QUE LE LOOKUP, AUTRE ROUTE
// ────────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ `world.openfoodfacts.org`, comme le lookup GTIN — et NON
 * `search.openfoodfacts.org`. C'est le point de départ de tout ce fichier.
 */
export const OFF_CIQUAL_SEARCH_URL = `${OFF_BASE_URL}/api/${OFF_SEARCH_API_VERSION}/search`;

/** Le préfixe du tag hérité. `ciqual-food-code-9119`, jamais autre chose. */
export const CIQUAL_TAG_PREFIX = "ciqual-food-code-";

/**
 * ⚠️ FRANCE SEULEMENT, ET CE N'EST PAS UN CONFORT.
 * Un produit vendu ailleurs a un code-barres, une nutrition, parfois un prix —
 * et l'élève ne le trouvera dans aucun magasin. Le proposer à la curation ferait
 * perdre du temps à l'administrateur, et pire : ferait valider un rapprochement
 * dont aucun prix français ne sortira jamais.
 */
export const CIQUAL_PAYS = "France";

/**
 * Assez large pour que la curation ait de quoi choisir, assez étroit pour que
 * l'appel reste court. La recherche par code Ciqual rend parfois des centaines
 * de candidats (896 pour le riz basmati cru) : l'administrateur n'en regardera
 * jamais 896, et les transférer serait du poids pour rien.
 */
export const CIQUAL_TAILLE_PAGE = 25;

/**
 * L'URL, construite en UN endroit. Aucun paramètre ne vient du navigateur : le
 * code Ciqual est validé de forme avant d'entrer, et tout le reste est
 * constant. Un client ne peut donc pas se servir de SETH pour interroger Open
 * Food Facts à sa guise.
 */
export function urlRechercheParCodeCiqual(code: string): string {
  if (!codeCiqualEstValide(code)) {
    throw new OffErreur("OFF_INVALID_RESPONSE", `Code Ciqual de forme invalide : ${code}`);
  }
  const params = new URLSearchParams({
    categories_properties_tags: `${CIQUAL_TAG_PREFIX}${code}`,
    countries_tags_en: CIQUAL_PAYS,
    fields: OFF_FIELDS.join(","),
    // ⚠️ Ce nom de paramètre est celui de l'API v2 d'Open Food Facts. Il se
    // trouve que Search-a-licious en utilise un homonyme — ce n'est pas une
    // parenté, c'est une coïncidence de vocabulaire HTTP. Voir A3-SEARCH-SUP,
    // qui exempte ce fichier de CE jeton précis et continue d'y interdire
    // Search-a-licious lui-même.
    page_size: String(CIQUAL_TAILLE_PAGE),
    page: "1",
  });
  return `${OFF_CIQUAL_SEARCH_URL}?${params.toString()}`;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. TROUVÉ ≠ IMPORTABLE
// ────────────────────────────────────────────────────────────────────────────
/** Un candidat qui peut entrer dans `food_products`. */
export interface CandidatImportable {
  readonly gtin: string;
  readonly produit: ProduitSeth;
}

/**
 * Un candidat RÉEL, trouvé chez Open Food Facts, mais que `food_products` ne
 * peut pas accueillir.
 *
 * ⚠️ IL EST RENDU, PAS JETÉ. Les trois réponses interdites sont : fabriquer des
 * zéros à la place des macros manquantes, importer en faisant passer
 * l'incomplet pour du complet, et masquer le candidat. La quatrième — le
 * montrer avec sa raison, et laisser l'administrateur passer au suivant — est
 * la seule qui ne ment pas.
 */
export interface CandidatNonImportable {
  readonly gtin: string | null;
  readonly nom: string | null;
  readonly refus: RefusCandidat;
}

export interface ResultatRechercheCiqual {
  readonly code: string;
  readonly importables: readonly CandidatImportable[];
  readonly nonImportables: readonly CandidatNonImportable[];
  /** `count` annoncé par Open Food Facts — la population, pas la page. */
  readonly totalOff: number;
}

function texteOuNull(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const propre = valeur.trim();
  return propre === "" ? null : propre;
}

/**
 * Réponse v2 `/search` → candidats.
 *
 * ⚠️ UNE FICHE INEXPLOITABLE NE FAIT PAS ÉCHOUER LA RECHERCHE. Sur vingt-cinq
 * candidats, plusieurs sans teneurs sont un cas ORDINAIRE : rendre une erreur
 * pour tout le lot priverait la curation de ceux qui marchent. Même doctrine
 * que `produitsDepuisReponse` en Phase 4 — la différence est qu'ici les écartés
 * sont NOMMÉS et rendus, parce que l'administrateur doit voir ce qu'il ne peut
 * pas prendre.
 *
 * L'ORDRE D'OPEN FOOD FACTS EST CONSERVÉ. Aucun score maison : nous ne savons
 * pas mieux que la source quel yaourt vient en premier, et prétendre le
 * contraire demanderait une mesure que personne n'a faite.
 */
export function candidatsDepuisReponse(code: string, corps: unknown): ResultatRechercheCiqual {
  if (corps === null || typeof corps !== "object") {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse de recherche non exploitable.");
  }
  const enveloppe = corps as { products?: unknown; count?: unknown };
  if (!Array.isArray(enveloppe.products)) {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse de recherche sans liste de produits.");
  }

  const importables: CandidatImportable[] = [];
  const nonImportables: CandidatNonImportable[] = [];
  const gtinsVus = new Set<string>();

  for (const brut of enveloppe.products) {
    if (brut === null || typeof brut !== "object") continue;
    const fiche = brut as Record<string, unknown>;
    const nom = texteOuNull(fiche["product_name"]);
    const codeBarres = texteOuNull(fiche["code"]);

    if (codeBarres === null) {
      nonImportables.push({ gtin: null, nom, refus: "gtin_absent" });
      continue;
    }
    // ⚠️ LA FORME DU CODE EST VÉRIFIÉE ICI, comme sur le chemin de la recherche
    // texte (défaut A3-SEARCH7) : `versProduitSeth` reçoit le GTIN déjà validé
    // sur le chemin du lookup, jamais sur celui d'une recherche. Un code hors
    // forme irait jusqu'à l'upsert et ferait échouer le LOT ENTIER contre
    // `food_products_gtin_forme`.
    if (!gtinEstValide(codeBarres)) {
      nonImportables.push({ gtin: codeBarres, nom, refus: "gtin_invalide" });
      continue;
    }
    if (gtinsVus.has(codeBarres)) {
      nonImportables.push({ gtin: codeBarres, nom, refus: "doublon" });
      continue;
    }
    gtinsVus.add(codeBarres);

    try {
      // Le MÊME normaliseur que partout ailleurs, avec l'enveloppe de succès
      // qu'il attend. Il lève `PRODUCT_NUTRITION_INCOMPLETE` quand les trois
      // macros manquent, quand OFF déclare `no_nutrition_data`, ou quand la
      // fiche n'a pas de dénomination — trois cas qui rendent la ligne
      // inacceptable pour `food_products`, dont les macros sont NOT NULL.
      const produit = versProduitSeth(codeBarres, { status: "success", product: fiche });
      importables.push({ gtin: codeBarres, produit });
    } catch (erreur) {
      if (estOffErreur(erreur)) {
        nonImportables.push({ gtin: codeBarres, nom, refus: "nutrition_incomplete" });
        continue;
      }
      throw erreur;
    }
  }

  const total = typeof enveloppe.count === "number" ? enveloppe.count : importables.length;
  return { code, importables, nonImportables, totalOff: total };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. L'INSTRUMENTATION — COURSES C4.1b
// ────────────────────────────────────────────────────────────────────────────

/**
 * COURSES C4.1b — OBSERVABILITÉ, ET RIEN D'AUTRE.
 *
 * ⚠️ CE BLOC NE CHANGE AUCUN COMPORTEMENT. Mêmes paramètres sortants, même
 * délai d'attente, mêmes codes d'erreur, mêmes candidats, même filtre
 * importable, même statut HTTP rendu par la route. Il n'ajoute que des traces.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI IL EXISTE
 * ────────────────────────────────────────────────────────────────────────────
 * Mesuré le 18/08/2026 : la Preview rend `503 / OFF_UNAVAILABLE` sur le code
 * Ciqual 32140, à la seconde où le même appel, depuis un poste de travail,
 * rend `200` en 0,389 s avec trois produits. `OFF_UNAVAILABLE` recouvre
 * TROIS situations très différentes — un `fetch` qui échoue, un abandon au
 * bout de huit secondes, et un statut HTTP non-OK — et rien, dans les
 * journaux, ne permettait de savoir laquelle. On ne corrige pas ce qu'on n'a
 * pas nommé.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUI N'EST JAMAIS ÉCRIT DANS UNE TRACE
 * ────────────────────────────────────────────────────────────────────────────
 * Le User-Agent (il porte une adresse de contact), l'URL (même sans secret
 * aujourd'hui, la journaliser inviterait à y mettre un jeton demain), les
 * en-têtes, le corps de la réponse, et le MESSAGE des exceptions — un message
 * d'erreur réseau peut contenir une URL complète, un hôte interne, ou l'objet
 * d'un certificat. On journalise la CLASSE (`error.name`), jamais le récit.
 */
export type EvenementOffCiqual =
  /** G — tout s'est bien passé. */
  | "success"
  /** C — l'amont a répondu 429. */
  | "upstream_rate_limited"
  /** D — l'amont a répondu un statut non-OK autre que 429. */
  | "upstream_non_ok"
  /** B — notre `AbortController` a coupé : l'amont a dépassé le délai. */
  | "timeout"
  /** A — le `fetch` a été rejeté avant toute réponse. */
  | "fetch_error"
  /** E — statut OK, mais le corps n'est pas du JSON. */
  | "invalid_json"
  /** F — statut OK, JSON lisible, mais l'enveloppe n'est pas exploitable. */
  | "invalid_envelope"
  /**
   * ⚠️ NI A, NI B, NI C, NI D, NI E, NI F — ET C'EST TOUT L'INTÉRÊT.
   *
   * Une exception qui n'est pas un refus d'enveloppe : le normaliseur a levé
   * autre chose, ou un défaut de programmation s'est produit après la lecture
   * du corps. La ranger sous `invalid_envelope` accuserait Open Food Facts
   * d'avoir mal répondu alors que la réponse était bonne — un diagnostic
   * MENSONGER, qui enverrait chercher la panne du mauvais côté.
   *
   * Ce n'est PAS un nouveau code d'erreur métier : le contrat de C4.1 est
   * inchangé, l'exception est relancée telle quelle. C'est un nom de TRACE.
   */
  | "unexpected_error";

/** Le préfixe unique des traces de ce chemin, pour les retrouver d'un grep. */
export const OFF_CIQUAL_TAG = "[OFF_CIQUAL]";

/**
 * Le champ à écrire, ou rien. `undefined` disparaît de la ligne — une trace
 * qui affiche `status=undefined` fait perdre du temps à celui qui la lit.
 */
type ChampTrace = string | number | undefined;

export interface DetailsTraceOffCiqual {
  readonly status?: ChampTrace;
  readonly durationMs?: ChampTrace;
  /** `error.name` — la CLASSE, jamais le message. */
  readonly name?: ChampTrace;
  readonly contentType?: ChampTrace;
  readonly contentLength?: ChampTrace;
  /** L'état de NOTRE signal — ce qui distingue un timeout d'un abandon subi. */
  readonly aborted?: ChampTrace;
  readonly count?: ChampTrace;
  readonly importables?: ChampTrace;
  readonly nonImportables?: ChampTrace;
}

/** Où part la trace. Injectable POUR LES TESTS, `console.warn` en production. */
export type JournalOffCiqual = (ligne: string) => void;

/**
 * ⚠️ `console.warn` ET NON `console.log` : sur Vercel, les traces de niveau
 * `log` sont les plus facilement filtrées. Un diagnostic qu'on ne retrouve pas
 * ne diagnostique rien.
 */
const journalParDefaut: JournalOffCiqual = (ligne) => console.warn(ligne);

/**
 * Construit UNE ligne, dans un ordre stable, sans jamais interpoler autre
 * chose que les champs déclarés ci-dessus.
 */
export function ligneTraceOffCiqual(
  evenement: EvenementOffCiqual,
  code: string,
  details: DetailsTraceOffCiqual = {},
): string {
  const morceaux = [`${OFF_CIQUAL_TAG} ${evenement}`, `code=${code}`];
  for (const [cle, valeur] of Object.entries(details)) {
    if (valeur !== undefined && valeur !== null && valeur !== "") {
      morceaux.push(`${cle}=${valeur}`);
    }
  }
  return morceaux.join(" ");
}

// ────────────────────────────────────────────────────────────────────────────
// 4. LE TRANSPORT
// ────────────────────────────────────────────────────────────────────────────
export interface OptionsRechercheCiqual {
  readonly transport?: Transport;
  readonly timeoutMs?: number;
  /** Injectable pour les tests. Par défaut : `console.warn`. */
  readonly journal?: JournalOffCiqual;
}

/**
 * UNE requête sortante, pas deux. Pas de pagination : l'administrateur choisit
 * parmi les vingt-cinq premiers ou change d'aliment. Une seconde page coûterait
 * un appel de plus sur un quota partagé par toute l'application.
 *
 * Les pannes sont traduites dans le vocabulaire fermé de la Phase 3 :
 * l'appelant n'apprend jamais qu'il existe une API v2.
 */
export async function chercherProduitsParCodeCiqual(
  code: string,
  options: OptionsRechercheCiqual = {},
): Promise<ResultatRechercheCiqual> {
  const url = urlRechercheParCodeCiqual(code);
  const entete = userAgentOff();
  const transport = options.transport ?? ((cible, init) => fetch(cible, init));
  const journal = options.journal ?? journalParDefaut;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), options.timeoutMs ?? OFF_TIMEOUT_MS);

  // ⚠️ C4.1b — LE CHRONOMÈTRE DÉMARRE AVANT LE PREMIER OCTET SORTANT et il
  // est lu à CHAQUE sortie, y compris les sorties en erreur. Une durée n'a de
  // valeur diagnostique que si elle existe aussi quand ça rate : c'est elle
  // qui distingue un refus immédiat d'une passerelle (quelques dizaines de
  // millisecondes) d'un abandon au bout du délai (huit secondes).
  const depart = Date.now();
  const ecoule = () => Date.now() - depart;

  let reponse: Response;
  try {
    reponse = await transport(url, {
      method: "GET",
      headers: { "User-Agent": entete, Accept: "application/json" },
      signal: controleur.signal,
      cache: "no-store",
    });
  } catch (erreur) {
    // ⚠️ DEUX CAUSES TRÈS DIFFÉRENTES ARRIVENT ICI, et les confondre était
    // exactement le trou de diagnostic de C4.1b. Le code d'erreur rendu reste
    // identique dans les deux cas — c'est une trace, pas un changement de
    // contrat.
    //
    // ⚠️ ET `AbortError` NE SUFFIT PAS À DIRE « TIMEOUT ». Un abandon peut
    // venir d'ailleurs que de nous : un signal amont, une coupure de la
    // plateforme, un client qui ferme la connexion. « timeout » doit vouloir
    // dire UNE chose vérifiable — NOTRE minuteur a déclenché — et cela se lit
    // sur `controleur.signal.aborted`, pas sur le nom de l'exception. Un
    // `AbortError` reçu alors que notre signal n'a pas déclenché reste un
    // `fetch_error` : c'est la vérité, et elle enverra chercher ailleurs.
    const nom = erreur instanceof Error ? erreur.name : typeof erreur;
    const estNotreAbandon = nom === "AbortError" && controleur.signal.aborted;
    journal(
      ligneTraceOffCiqual(estNotreAbandon ? "timeout" : "fetch_error", code, {
        durationMs: ecoule(),
        name: nom,
        aborted: String(controleur.signal.aborted),
      }),
    );
    throw new OffErreur(
      "OFF_UNAVAILABLE",
      `Recherche Open Food Facts injoignable : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  } finally {
    clearTimeout(minuteur);
  }

  // Deux en-têtes seulement, et ils sont publics : ils disent la FORME de la
  // réponse. Une page HTML de passerelle et un JSON d'API ne se ressemblent
  // pas, et `content-type` suffit à les séparer sans lire le corps.
  const contentType = reponse.headers.get("content-type") ?? undefined;
  const contentLength = reponse.headers.get("content-length") ?? undefined;

  if (reponse.status === 429) {
    journal(
      ligneTraceOffCiqual("upstream_rate_limited", code, {
        status: reponse.status,
        durationMs: ecoule(),
        contentType,
        contentLength,
      }),
    );
    throw new OffErreur("OFF_RATE_LIMITED", "Limite de recherches Open Food Facts atteinte.");
  }
  if (!reponse.ok) {
    journal(
      ligneTraceOffCiqual("upstream_non_ok", code, {
        status: reponse.status,
        durationMs: ecoule(),
        contentType,
        contentLength,
      }),
    );
    throw new OffErreur(
      "OFF_UNAVAILABLE",
      `La recherche Open Food Facts a répondu ${reponse.status}.`,
    );
  }

  let corps: unknown;
  try {
    corps = await reponse.json();
  } catch (erreur) {
    journal(
      ligneTraceOffCiqual("invalid_json", code, {
        status: reponse.status,
        durationMs: ecoule(),
        name: erreur instanceof Error ? erreur.name : typeof erreur,
        contentType,
        contentLength,
      }),
    );
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse de recherche illisible.");
  }

  // ⚠️ « JSON LISIBLE » N'EST PAS « ENVELOPPE EXPLOITABLE ». Un 200 qui rend
  // `{"error": …}` passe le parseur et échoue ici — deux pannes distinctes qui
  // méritaient deux noms.
  let resultat: ResultatRechercheCiqual;
  try {
    resultat = candidatsDepuisReponse(code, corps);
  } catch (erreur) {
    // ⚠️ `invalid_envelope` EST UNE ACCUSATION CONTRE L'AMONT : elle dit « la
    // réponse d'Open Food Facts n'était pas exploitable ». Elle ne doit donc
    // couvrir QUE le refus d'enveloppe que `candidatsDepuisReponse` énonce
    // lui-même — `OFF_INVALID_RESPONSE`. Toute autre exception vient de CHEZ
    // NOUS et porte un autre nom.
    //
    // L'exception est relancée telle quelle dans les deux cas : le contrat de
    // C4.1 ne bouge pas, seule la trace se précise.
    const estRefusEnveloppe =
      estOffErreur(erreur) && erreur.code === "OFF_INVALID_RESPONSE";
    journal(
      ligneTraceOffCiqual(estRefusEnveloppe ? "invalid_envelope" : "unexpected_error", code, {
        status: reponse.status,
        durationMs: ecoule(),
        name: erreur instanceof Error ? erreur.name : typeof erreur,
        contentType,
      }),
    );
    throw erreur;
  }

  journal(
    ligneTraceOffCiqual("success", code, {
      status: reponse.status,
      durationMs: ecoule(),
      count: resultat.totalOff,
      importables: resultat.importables.length,
      nonImportables: resultat.nonImportables.length,
    }),
  );
  return resultat;
}
