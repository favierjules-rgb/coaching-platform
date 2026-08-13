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
  /** Lit le cache local. `null` si le produit n'y est pas. */
  readonly lireCache: (gtin: string) => Promise<{ produit: ProduitEnCache; frais: boolean } | null>;
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
  if (enCache && enCache.frais) {
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
