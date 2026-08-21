import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrixEstime, UnitePrix } from "@/lib/nutrition/budget-courses";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * COURSES C3 — LES PRIX ESTIMATIFS ET LE BUDGET, CÔTÉ BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TROIS RÉGIMES D'ÉCRITURE, ET CHACUN A SA RAISON
 * ────────────────────────────────────────────────────────────────────────────
 *   BUDGET               → `update` direct sur `shopping_lists`. Une colonne,
 *                          une ligne, aucun arbitrage. Le privilège est un
 *                          `grant update (budget_cents)` : toucher `starts_on`
 *                          échoue sur un « permission denied for column ».
 *   PRIX D'UN MANUEL     → RPC. Non pour l'atomicité, mais parce qu'élargir le
 *                          grant de colonne l'ouvrirait AUSSI aux lignes PLAN.
 *   PRIX GLOBAUX (admin) → `insert`/`update` directs, gardés par la policy
 *                          `is_admin()`. Un élève n'a que `select`.
 *
 * ⚠️ AUCUN CALCUL ICI. Ce module lit et écrit ; l'estimation est faite par
 * `budget-courses.ts`, qui est pur et testable sans base.
 */

export class RpcPrixError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "RpcPrixError";
    this.code = code;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * LECTURE DES PRIX
 * ════════════════════════════════════════════════════════════════════════ */

interface LignePrixBrute {
  catalog_food_id: string | null;
  product_id: string | null;
  price_cents: number;
  quantity: number | string;
  unit: string;
}

function versNombre(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

function versPrix(l: LignePrixBrute): PrixEstime | null {
  if (l.unit !== "g" && l.unit !== "ml" && l.unit !== "piece") return null;
  const quantite = versNombre(l.quantity);
  if (!Number.isFinite(quantite) || quantite <= 0) return null;
  // La base garantit « exactement une cible » par contrainte. On le revérifie
  // plutôt que de faire confiance : une ligne incohérente doit disparaître de
  // l'estimation, pas y produire un coût bancal.
  if (l.catalog_food_id !== null && l.product_id === null) {
    return {
      identityType: "catalog_food",
      identityId: l.catalog_food_id,
      priceCents: l.price_cents,
      quantite,
      unite: l.unit as UnitePrix,
    };
  }
  if (l.product_id !== null && l.catalog_food_id === null) {
    return {
      identityType: "product",
      identityId: l.product_id,
      priceCents: l.price_cents,
      quantite,
      unite: l.unit as UnitePrix,
    };
  }
  return null;
}

export interface LecturePrix {
  /** `false` = la lecture a ÉCHOUÉ. Ce n'est PAS « aucun prix connu ». */
  readonly ok: boolean;
  readonly prix: readonly PrixEstime[];
}

/**
 * Les prix ACTIFS des identités demandées.
 *
 * ⚠️ `ok: false` N'EST PAS « AUCUN PRIX ». Un réseau coupé afficherait sinon
 * « 0 / 20 articles estimés » comme si aucun prix n'existait — et l'élève
 * croirait que le catalogue de prix est vide.
 *
 * ⚠️ ON NE CHARGE QUE LES IDENTITÉS DE LA LISTE. Rapatrier tout le catalogue de
 * prix pour en utiliser vingt serait payer un transfert pour rien.
 */
export async function lirePrixEstimes(
  supabase: TypedSupabaseClient,
  catalogFoodIds: readonly string[],
  productIds: readonly string[],
): Promise<LecturePrix> {
  if (catalogFoodIds.length === 0 && productIds.length === 0) return { ok: true, prix: [] };

  const requetes: Promise<{ data: unknown; error: unknown }>[] = [];
  if (catalogFoodIds.length > 0) {
    requetes.push(
      supabase
        .from("food_price_estimates")
        .select("catalog_food_id, product_id, price_cents, quantity, unit")
        .eq("status", "active")
        .in("catalog_food_id", catalogFoodIds as string[]) as unknown as Promise<{
        data: unknown;
        error: unknown;
      }>,
    );
  }
  if (productIds.length > 0) {
    requetes.push(
      supabase
        .from("food_price_estimates")
        .select("catalog_food_id, product_id, price_cents, quantity, unit")
        .eq("status", "active")
        .in("product_id", productIds as string[]) as unknown as Promise<{
        data: unknown;
        error: unknown;
      }>,
    );
  }

  const reponses = await Promise.all(requetes);
  if (reponses.some((r) => r.error)) return { ok: false, prix: [] };

  const prix: PrixEstime[] = [];
  for (const r of reponses) {
    for (const l of (r.data ?? []) as LignePrixBrute[]) {
      const p = versPrix(l);
      if (p !== null) prix.push(p);
    }
  }
  return { ok: true, prix };
}

/* ══════════════════════════════════════════════════════════════════════════
 * LE BUDGET
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Pose, modifie ou EFFACE (`null`) le budget d'une liste.
 *
 * ⚠️ `null` N'EST PAS ZÉRO. Effacer son budget rend l'écran à l'état
 * « ESTIMATION seule », alors qu'un budget de 0 € afficherait un dépassement de
 * la totalité du panier. La colonne est nullable exactement pour ça.
 *
 * ⚠️ SEULE `budget_cents` EST ÉCRITE, et ce n'est pas ce code qui le garantit :
 * `authenticated` n'a le privilège d'`update` que sur cette colonne.
 */
export async function definirBudget(
  supabase: TypedSupabaseClient,
  listeId: string,
  budgetCents: number | null,
): Promise<boolean> {
  if (budgetCents !== null && (!Number.isInteger(budgetCents) || budgetCents < 0)) return false;
  const { data, error } = await supabase
    .from("shopping_lists")
    .update({ budget_cents: budgetCents } as never)
    .eq("id", listeId)
    .select("id");
  if (error) return false;
  // ⚠️ « AUCUNE ERREUR » N'EST PAS « ÉCRIT ». La liste d'un autre élève passe la
  // requête sans être vue par la policy : zéro ligne rendue, aucune erreur.
  return (data ?? []).length === 1;
}

/* ══════════════════════════════════════════════════════════════════════════
 * LE PRIX D'UN ARTICLE MANUEL
 * ════════════════════════════════════════════════════════════════════════ */

export async function definirPrixArticleManuel(
  supabase: TypedSupabaseClient,
  ligneId: string,
  priceCents: number | null,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- les RPC de C3 ne sont pas dans les types générés tant que `supabase gen types` n'a pas été rejoué après le db push.
  const { error } = await (supabase as any).rpc("definir_prix_article_manuel", {
    p_item_id: ligneId,
    p_price_cents: priceCents,
  });
  if (error) throw new RpcPrixError(error.message ?? "ERREUR_INCONNUE");
}

/* ══════════════════════════════════════════════════════════════════════════
 * ADMINISTRATION DES PRIX — RÉSERVÉE À L'ADMIN PAR LA POLICY
 * ════════════════════════════════════════════════════════════════════════ */

export interface PrixAEnregistrer {
  readonly catalogFoodId: string | null;
  readonly productId: string | null;
  readonly priceCents: number;
  readonly quantite: number;
  readonly unite: UnitePrix;
}

/**
 * Publie un prix : archive l'ancien actif pour ce couple (identité, unité),
 * puis insère le nouveau.
 *
 * ⚠️ ARCHIVER PLUTÔT QUE REMPLACER. L'index unique partiel n'admet qu'un seul
 * prix ACTIF par (identité, unité) : sans l'archivage préalable, l'insertion
 * échouerait sur un « 23505 » illisible. Et l'ancien prix reste lisible, ce qui
 * permettra à C4 de raconter une évolution.
 *
 * ⚠️ DEUX ÉCRITURES, PAS UNE TRANSACTION. C'est assumé : si la seconde échoue,
 * l'identité se retrouve SANS prix actif — donc « non estimée », un état que
 * l'écran sait afficher honnêtement. L'inverse (deux prix actifs) serait, lui,
 * refusé par l'index. On dégrade vers l'absence, jamais vers l'ambiguïté.
 */
export async function publierPrix(
  supabase: TypedSupabaseClient,
  prix: PrixAEnregistrer,
): Promise<boolean> {
  const colonne = prix.catalogFoodId !== null ? "catalog_food_id" : "product_id";
  const valeur = prix.catalogFoodId ?? prix.productId;
  if (valeur === null) return false;
  if (!Number.isInteger(prix.priceCents) || prix.priceCents < 0) return false;
  if (!Number.isFinite(prix.quantite) || prix.quantite <= 0) return false;

  const { error: erreurArchive } = await supabase
    .from("food_price_estimates")
    .update({ status: "archived" } as never)
    .eq(colonne, valeur)
    .eq("unit", prix.unite)
    .eq("status", "active");
  if (erreurArchive) return false;

  const { error } = await supabase.from("food_price_estimates").insert({
    catalog_food_id: prix.catalogFoodId,
    product_id: prix.productId,
    price_cents: prix.priceCents,
    quantity: prix.quantite,
    unit: prix.unite,
  } as never);
  return !error;
}
