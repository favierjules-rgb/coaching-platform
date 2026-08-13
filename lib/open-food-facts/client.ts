import "server-only";

import {
  OFF_TIMEOUT_MS,
  OFF_USER_AGENT_ENV,
  OffErreur,
  type ProduitSeth,
  type ReponseOff,
  exigerGtin,
  urlLookupProduit,
  versProduitSeth,
} from "@/lib/open-food-facts/contrat";

/**
 * OPEN FOOD FACTS — LE TRANSPORT (ALIMENTS A3, PHASE 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE NAVIGATEUR NE PARLE JAMAIS À OPEN FOOD FACTS
 * ────────────────────────────────────────────────────────────────────────────
 * `import "server-only"` fait ÉCHOUER LE BUILD si ce fichier se retrouve dans
 * un bundle client. Ce n'est pas une convention de nommage ni un commentaire
 * d'intention : c'est la seule forme de cette règle qui résiste à une
 * distraction. Trois raisons de la tenir :
 *
 *   1. le User-Agent contient une adresse de contact, exigée par OFF ; depuis
 *      le navigateur, elle serait publique et falsifiable ;
 *   2. les limites d'OFF sont PAR IP (15 requêtes/minute en lecture produit).
 *      Depuis le navigateur, chaque élève brûle son propre quota et personne ne
 *      peut ni le mesurer ni le lisser ; depuis le serveur, il y a un seul
 *      point à surveiller ;
 *   3. le jour où la recherche texte devra passer par Search-a-licious — une
 *      API sans SLA, appelée à changer — l'interface ne doit pas avoir à le
 *      savoir. Elle appelle notre route, aujourd'hui et après.
 *
 * Ce module ne fait QUE le transport et la traduction des pannes en erreurs
 * métier. Toute la lecture du contenu vit dans `contrat.ts`, sans réseau.
 */

/** Panne de CONFIGURATION, distincte des six erreurs métier OFF : c'est notre faute. */
export class OffNonConfigure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffNonConfigure";
  }
}

/**
 * Reconnue par son nom, pas par `instanceof` — même raison qu'`estOffErreur`
 * (voir contrat.ts) : un module dupliqué par la résolution produit deux
 * classes, et l'ascendance cesse d'être un critère fiable.
 */
export function estOffNonConfigure(erreur: unknown): erreur is OffNonConfigure {
  return (
    typeof erreur === "object" &&
    erreur !== null &&
    (erreur as { name?: unknown }).name === "OffNonConfigure"
  );
}

/**
 * Le User-Agent, exigé — sans repli silencieux.
 *
 * Open Food Facts documente le format `AppName/Version (ContactEmail)` et se
 * réserve le droit de bloquer les clients anonymes. Un repli du type
 * `SETH/1.0` fabriqué à la volée aurait un défaut précis : il marcherait. Il
 * marcherait jusqu'au jour du blocage, en Production, sans que personne n'ait
 * jamais vu passer l'avertissement — et le déploiement fautif serait vieux de
 * plusieurs semaines. Une variable absente doit se voir tout de suite.
 */
export function userAgentOff(): string {
  const valeur = process.env[OFF_USER_AGENT_ENV]?.trim();
  if (!valeur) {
    throw new OffNonConfigure(
      `${OFF_USER_AGENT_ENV} absente. Open Food Facts exige un User-Agent « AppName/Version (contact) » ; ` +
        "aucun repli générique n'est fabriqué, pour que l'oubli se voie au lieu de préparer un blocage.",
    );
  }
  return valeur;
}

/**
 * Le transport est INJECTABLE — c'est ce qui rend la totalité de ce fichier
 * testable hors ligne, sur des fixtures, sans jamais toucher au réseau ni
 * remplacer `globalThis.fetch` (un remplacement global fuit d'un test à
 * l'autre et finit par masquer un vrai appel).
 */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface OptionsLookup {
  readonly transport?: Transport;
  readonly timeoutMs?: number;
}

/**
 * GTIN → produit SETH. Le seul chemin par lequel SETH interroge Open Food
 * Facts pour un code-barres.
 *
 * Traduction des pannes, une fois pour toutes :
 *   404                 → PRODUCT_NOT_FOUND (v3 rend 404 ; v2 rendait 200)
 *   429                 → OFF_RATE_LIMITED
 *   5xx, timeout, réseau→ OFF_UNAVAILABLE
 *   JSON illisible      → OFF_INVALID_RESPONSE
 *
 * Aucun code HTTP ne remonte au-dessus de cette fonction : l'interface parle
 * le vocabulaire de SETH, jamais celui d'un tiers.
 */
export async function chercherProduitParGtin(
  saisieGtin: string,
  options: OptionsLookup = {},
): Promise<ProduitSeth> {
  // Refus AVANT l'appel : un code hors forme ne consomme pas de quota.
  const gtin = exigerGtin(saisieGtin);
  const entete = userAgentOff();

  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), options.timeoutMs ?? OFF_TIMEOUT_MS);

  let reponse: Response;
  try {
    reponse = await transport(urlLookupProduit(gtin), {
      method: "GET",
      headers: { "User-Agent": entete, Accept: "application/json" },
      signal: controleur.signal,
      // Le cache est le NÔTRE (food_products), avec son TTL de 30 jours. Un
      // second cache HTTP par-dessus rendrait la fraîcheur imprévisible.
      cache: "no-store",
    });
  } catch (erreur) {
    // Abandon sur délai, DNS, TLS, socket : de notre côté c'est le même fait —
    // le service n'a pas répondu.
    throw new OffErreur(
      "OFF_UNAVAILABLE",
      `Open Food Facts injoignable : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  } finally {
    clearTimeout(minuteur);
  }

  if (reponse.status === 404) {
    throw new OffErreur("PRODUCT_NOT_FOUND", `Produit ${gtin} absent d'Open Food Facts.`);
  }
  if (reponse.status === 429) {
    throw new OffErreur("OFF_RATE_LIMITED", "Limite de requêtes Open Food Facts atteinte.");
  }
  if (!reponse.ok) {
    throw new OffErreur("OFF_UNAVAILABLE", `Open Food Facts a répondu ${reponse.status}.`);
  }

  let corps: ReponseOff;
  try {
    corps = (await reponse.json()) as ReponseOff;
  } catch {
    throw new OffErreur("OFF_INVALID_RESPONSE", "Réponse Open Food Facts illisible.");
  }

  return versProduitSeth(gtin, corps);
}
