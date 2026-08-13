import "server-only";

import {
  OffErreur,
  type ProduitSeth,
  erreurEstTemporaire,
  estOffErreur,
  exigerGtin,
} from "@/lib/open-food-facts/contrat";
import type { ProduitEnCache } from "@/lib/supabase/food-products";

/**
 * LA RÈGLE DE RÉSOLUTION D'UN CODE-BARRES (ALIMENTS A3, PHASE 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE RÈGLE VIT SEULE, AVEC SES DÉPENDANCES INJECTÉES
 * ────────────────────────────────────────────────────────────────────────────
 * Écrite dans la route, elle n'aurait été vérifiable qu'en montant un serveur
 * Next, une base et un faux Open Food Facts. Écrite ici, avec le cache et le
 * réseau passés en paramètres, elle se prouve sur des fonctions de trois
 * lignes — y compris le cas qui compte le plus et qu'on ne sait pas provoquer
 * à la demande : « fiche vieille de cinq semaines ET Open Food Facts en
 * panne ».
 *
 * L'ordre est LOCAL D'ABORD, et le contrat « périmé » est explicite :
 *
 *   frais en cache            → rendu tel quel, aucun appel réseau
 *   périmé + OFF répond       → mis à jour, rendu frais
 *   périmé + OFF en panne     → RENDU QUAND MÊME, `stale: true`
 *   absent + OFF répond       → enregistré, rendu frais
 *   absent + OFF en panne     → erreur franche, rien à rendre
 *
 * Une seule exception à la tolérance : si OFF répond clairement que le produit
 * n'existe plus (PRODUCT_NOT_FOUND), ou que sa fiche est devenue inexploitable
 * (PRODUCT_NUTRITION_INCOMPLETE), ce n'est pas une panne — c'est une réponse.
 * On ne se replie alors PAS sur la copie périmée : la source dit que la fiche
 * n'est plus valable, et servir une valeur qu'elle vient de démentir serait
 * pire que de ne rien servir.
 */

export interface DependancesResolution {
  /**
   * Lit le cache local. `null` si le produit n'y est pas.
   *
   * `detailFrais` répond à UNE question et une seule : la fiche COMPLÈTE
   * a-t-elle été chargée depuis `/api/v3.4/product/{gtin}` dans le TTL ?
   * Ce n'est pas « avons-nous vu ce produit récemment » — une recherche texte
   * fait voir un code-barres sans rien apprendre de sa fiche.
   */
  readonly lireCache: (
    gtin: string,
  ) => Promise<{ produit: ProduitEnCache; detailFrais: boolean } | null>;
  /** Interroge Open Food Facts. Lève une `OffErreur` en cas d'échec. */
  readonly interrogerOff: (gtin: string) => Promise<{ produit: ProduitSeth; brut: unknown }>;
  /** Écrit la fiche en cache. `null` si l'écriture a échoué. */
  readonly ecrireCache: (produit: ProduitSeth, brut: unknown) => Promise<ProduitEnCache | null>;
}

export async function resoudreProduitParGtin(
  saisieGtin: string,
  deps: DependancesResolution,
): Promise<ProduitEnCache> {
  // Hors forme : refus immédiat, sans lecture de base ni appel réseau.
  const gtin = exigerGtin(saisieGtin);

  const enCache = await deps.lireCache(gtin);
  // ⚠️ On ne court-circuite le réseau QUE si la fiche complète est fraîche.
  // Une ligne née d'une recherche texte a `detailFrais === false` même si elle
  // a été écrite il y a trente secondes : elle n'a ni `nutrition_data_per`, ni
  // quantité nette, ni ingrédients, et son unité « g » est un repli, pas une
  // observation. Le lookup part donc, et l'hydrate.
  if (enCache && enCache.detailFrais) {
    return enCache.produit;
  }

  try {
    const { produit, brut } = await deps.interrogerOff(gtin);
    const ecrit = await deps.ecrireCache(produit, brut);
    // L'écriture a échoué (base indisponible, contrainte) mais OFF a répondu :
    // on rend quand même la fiche fraîche, SANS identifiant de cache. L'appelant
    // saura qu'elle n'est pas consommable en l'état — la RPC exige un
    // `food_products.id` — et l'élève verra la fiche plutôt qu'une erreur.
    if (ecrit) return ecrit;
    if (enCache) return enCache.produit;
    throw new OffErreur("OFF_UNAVAILABLE", `Produit ${gtin} : enregistrement impossible.`);
  } catch (erreur) {
    const code = estOffErreur(erreur) ? erreur.code : null;

    // Panne du SERVICE, et nous avons une copie : on la sert, datée.
    if (enCache && code !== null && erreurEstTemporaire(code)) {
      return enCache.produit;
    }
    // Réponse du SERVICE (absent, incomplet) ou aucune copie : on remonte.
    throw erreur;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   RECHERCHE TEXTE (PHASE 4) — LOCAL D'ABORD, EXTERNE SUR DEMANDE EXPLICITE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ────────────────────────────────────────────────────────────────────────────
 * LA RÈGLE, ET CE QU'ELLE PROTÈGE
 * ────────────────────────────────────────────────────────────────────────────
 * La recherche LOCALE est toujours faite. La recherche EXTERNE ne l'est que si
 * l'appelant la demande — et l'appelant, c'est la route, qui ne la demande que
 * sur une action explicite de l'élève.
 *
 * Ce n'est pas une préférence d'architecture, c'est une contrainte de survie :
 * Open Food Facts limite les recherches à 10 par minute PAR IP, avec
 * bannissement des récidivistes, et l'IP est celle du serveur — donc partagée
 * par tous les élèves. Une recherche déclenchée à chaque frappe ferait bannir
 * SETH entier au premier élève qui tape « chocolat » lettre par lettre.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNE PANNE EXTERNE NE FAIT JAMAIS PERDRE LE LOCAL
 * ────────────────────────────────────────────────────────────────────────────
 * Quatre produits en cache plus un 503 font quatre produits, pas une erreur.
 * Le cas mérite d'être écrit noir sur blanc parce que la tentation inverse est
 * forte : un `throw` remonté depuis l'appel externe aurait effacé un travail
 * déjà fait et parfaitement valable. `externalUnavailable` dit ce qui s'est
 * passé, sans transformer un incident du fournisseur en panne de SETH.
 */
export interface DependancesRecherche {
  readonly chercherLocal: (q: string) => Promise<readonly ProduitEnCache[]>;
  readonly chercherExterne: (q: string) => Promise<{
    readonly produits: readonly ProduitSeth[];
    readonly ignoredIncompleteCount: number;
  }>;
  readonly lireConnues: (
    gtins: readonly string[],
  ) => Promise<ReadonlyMap<string, { produit: ProduitEnCache; vuRecemment: boolean }>>;
  readonly ecrireLot: (
    produits: readonly ProduitSeth[],
    connues: ReadonlyMap<string, { produit: ProduitEnCache; vuRecemment: boolean }>,
  ) => Promise<{ readonly ecrits: readonly ProduitEnCache[] }>;
}

export interface ResolutionRecherche {
  readonly produits: readonly ProduitEnCache[];
  readonly source: "local" | "local_and_external";
  readonly externalUnavailable: boolean;
  readonly ignoredIncompleteCount: number;
}

export async function resoudreRechercheProduits(
  q: string,
  avecExterne: boolean,
  deps: DependancesRecherche,
): Promise<ResolutionRecherche> {
  const locaux = await deps.chercherLocal(q);

  if (!avecExterne) {
    // Mode local : PAS UN SEUL appel sortant. Ni pour compléter, ni pour
    // vérifier, ni « juste au cas où ».
    return {
      produits: locaux,
      source: "local",
      externalUnavailable: false,
      ignoredIncompleteCount: 0,
    };
  }

  let externes: readonly ProduitSeth[];
  let ignores: number;
  try {
    const resultat = await deps.chercherExterne(q);
    externes = resultat.produits;
    ignores = resultat.ignoredIncompleteCount;
  } catch (erreur) {
    if (estOffErreur(erreur)) {
      return {
        produits: locaux,
        source: "local",
        externalUnavailable: true,
        ignoredIncompleteCount: 0,
      };
    }
    throw erreur;
  }

  // Ce que le cache sait déjà de ces GTIN : de quoi ne pas rafraîchir un
  // produit frais, et ne rien écraser d'une fiche plus riche.
  const connues = await deps.lireConnues(externes.map((p) => p.gtin));
  const { ecrits } = await deps.ecrireLot(externes, connues);
  const parGtin = new Map(ecrits.map((p) => [p.gtin, p]));

  // ORDRE : les résultats locaux d'abord — ils étaient déjà là, l'élève les a
  // peut-être déjà consommés —, puis les résultats du fournisseur DANS SON
  // ORDRE. Aucun score maison ne se glisse ici : nous ne savons pas mieux que
  // l'index ce qui ressemble à « skyr danone », et le prétendre demanderait
  // une mesure que personne n'a faite.
  const produits: ProduitEnCache[] = [];
  const vus = new Set<string>();
  for (const local of locaux) {
    // La version fraîchement écrite prime sur la copie lue avant l'appel :
    // c'est la même ligne, avec des teneurs plus récentes.
    produits.push(parGtin.get(local.gtin) ?? local);
    vus.add(local.gtin);
  }
  for (const externe of externes) {
    if (vus.has(externe.gtin)) continue;
    const ecrit = parGtin.get(externe.gtin);
    // Sans identifiant de cache, le produit ne serait pas consommable par la
    // RPC : on ne le propose pas plutôt que de proposer un bouton qui échoue.
    if (!ecrit) continue;
    vus.add(externe.gtin);
    produits.push(ecrit);
  }

  return {
    produits,
    source: "local_and_external",
    externalUnavailable: false,
    ignoredIncompleteCount: ignores,
  };
}
