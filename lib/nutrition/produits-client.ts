import type { ProduitLocal } from "@/lib/supabase/consumed-meals";

/**
 * LE NAVIGATEUR PARLE À SETH, JAMAIS À OPEN FOOD FACTS (ALIMENTS A3, PHASE 5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX APPELS, ET SEULEMENT DEUX
 * ────────────────────────────────────────────────────────────────────────────
 *   rechercherProduitsExternes  →  /api/food-products/search?q=…&external=true
 *   hydraterProduit             →  /api/food-products/{gtin}
 *
 * Ce module est la SEULE porte par laquelle l'écran atteint le réseau. Il ne
 * connaît ni Open Food Facts, ni Search-a-licious, ni aucun code HTTP de
 * tiers : il appelle nos routes, et rend soit des produits, soit un motif de
 * silence. Le jour où la recherche texte changera de fournisseur — le contrat
 * Search-a-licious s'annonce toujours en `version: 0.1.0` —, rien ici ne
 * bougera.
 *
 * `fetch` est INJECTABLE : c'est ce qui rend ces règles éprouvables sans
 * serveur, sans réseau, et sans remplacer `globalThis.fetch` — un remplacement
 * global fuit d'un test à l'autre et finit par masquer un vrai appel.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Résultat d'une recherche externe. `indisponible` n'est PAS une erreur : c'est
 * une information, et l'écran doit continuer à afficher ses résultats locaux.
 */
export interface RechercheExterne {
  readonly produits: readonly ProduitLocal[];
  readonly indisponible: boolean;
}

interface ProduitDTO {
  id: string;
  gtin: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  proteinPer100: number;
  carbPer100: number;
  fatPer100: number;
  nutritionUnit: "g" | "ml";
}

function versProduitLocal(dto: ProduitDTO, hydratee: boolean): ProduitLocal {
  return {
    id: dto.id,
    gtin: dto.gtin,
    name: dto.name,
    brand: dto.brand,
    nutritionUnit: dto.nutritionUnit === "ml" ? "ml" : "g",
    proteinPer100: Number(dto.proteinPer100),
    carbPer100: Number(dto.carbPer100),
    fatPer100: Number(dto.fatPer100),
    imageUrl: dto.imageUrl,
    hydratee,
  };
}

/**
 * Recherche EXTERNE — déclenchée par une action explicite de l'élève, jamais
 * par une frappe.
 *
 * Un produit qui revient d'ici n'est PAS hydraté : la recherche texte ne
 * rapporte ni `nutrition_data_per`, ni quantité nette, ni ingrédients (mesuré,
 * phase 4). `hydratee: false` est donc la vérité, et c'est ce qui déclenchera
 * le chargement de la fiche complète au moment du tap.
 *
 * Toute panne — réseau coupé, 503, réponse illisible — devient
 * `indisponible: true` avec une liste vide. Jamais une exception : l'appelant
 * a des résultats locaux à préserver, et une exception les lui ferait perdre.
 */
export async function rechercherProduitsExternes(
  terme: string,
  fetcher: Fetch,
): Promise<RechercheExterne> {
  const url = `/api/food-products/search?q=${encodeURIComponent(terme)}&external=true`;
  try {
    const réponse = await fetcher(url, { headers: { Accept: "application/json" } });
    if (!réponse.ok) return { produits: [], indisponible: true };
    const corps = (await réponse.json()) as {
      products?: ProduitDTO[];
      externalUnavailable?: boolean;
    };
    const produits = (corps.products ?? []).map((p) => versProduitLocal(p, false));
    return { produits, indisponible: corps.externalUnavailable === true };
  } catch {
    return { produits: [], indisponible: true };
  }
}

/**
 * HYDRATATION — charge la fiche COMPLÈTE d'un produit par son code-barres.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI L'ÉCRAN DOIT APPELER CECI AVANT DE LAISSER CONSOMMER
 * ────────────────────────────────────────────────────────────────────────────
 * Un produit trouvé par son NOM arrive sans `nutrition_data_per` : son unité
 * vaut « g » PAR DÉFAUT, ce qui est un repli et non une observation. Si la
 * fiche complète dit « pour 100 ml », consommer 250 « g » écrirait un
 * instantané faux — et il resterait faux, puisqu'un instantané ne suit jamais
 * sa source.
 *
 * La route fait le reste : elle sait, elle, si la fiche a déjà été chargée
 * dans les trente jours (`detail_fetched_at`, phase 4.1) et n'appelle Open
 * Food Facts que si nécessaire.
 *
 * `null` en cas d'échec — et l'appelant NE DOIT PAS se rabattre sur la fiche
 * partielle. Mieux vaut dire « impossible pour l'instant, saisis-le à la
 * main » que d'enregistrer une quantité dans une unité qu'on n'a pas vérifiée.
 */
export async function hydraterProduit(gtin: string, fetcher: Fetch): Promise<ProduitLocal | null> {
  const issue = await lireProduitParGtin(gtin, fetcher);
  return issue.type === "produit" ? issue.produit : null;
}

/**
 * LE MÊME APPEL, MAIS AVEC LE MOTIF (ALIMENTS A4, PHASE 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI LE SCANNER A BESOIN DE PLUS QUE `null`
 * ────────────────────────────────────────────────────────────────────────────
 * `hydraterProduit` rend `null` pour tout ce qui n'est pas un succès, et c'était
 * suffisant tant que l'appelant venait de TAPER sur un produit déjà affiché :
 * le produit existait, il ne manquait que sa fiche complète, et le seul message
 * utile était « pas maintenant ».
 *
 * Après un SCAN, la situation est différente : l'élève est debout devant un
 * rayon, il vient de viser un code, et trois issues appellent trois gestes
 * différents —
 *
 *   • le produit n'est pas dans la base    → en scanner un autre, ou le saisir ;
 *   • ses valeurs ne sont pas renseignées  → le saisir depuis l'emballage ;
 *   • le réseau a échoué                   → réessayer.
 *
 * Les confondre en un seul « impossible » enverrait quelqu'un réessayer
 * indéfiniment un produit qui n'existe pas. Le motif est donc REMONTÉ.
 *
 * ⚠️ Ce module reste la seule porte vers le réseau, et il ne connaît toujours
 * pas Open Food Facts : il lit le champ `code` de NOTRE route, dont le
 * vocabulaire est fermé depuis la phase 3 d'A3. Aucun code HTTP de tiers, aucune
 * URL externe, aucun nom de fournisseur.
 */
export type IssueLookup =
  | { readonly type: "produit"; readonly produit: ProduitLocal }
  | { readonly type: "introuvable" }
  | { readonly type: "incomplet" }
  | { readonly type: "indisponible" };

export async function lireProduitParGtin(gtin: string, fetcher: Fetch): Promise<IssueLookup> {
  try {
    const réponse = await fetcher(`/api/food-products/${encodeURIComponent(gtin)}`, {
      headers: { Accept: "application/json" },
    });
    if (!réponse.ok) {
      // Le CODE MÉTIER, jamais le statut HTTP : c'est lui qui est stable, et
      // c'est lui que la route s'est engagée à rendre. Un 404 pourrait un jour
      // venir d'un routage cassé plutôt que d'un produit absent.
      let code: string | null = null;
      try {
        const corps = (await réponse.json()) as { code?: unknown };
        if (typeof corps.code === "string") code = corps.code;
      } catch {
        // Corps illisible : c'est une indisponibilité, traitée comme telle
        // ci-dessous. Rien à réparer.
      }
      if (code === "PRODUCT_NOT_FOUND") return { type: "introuvable" };
      if (code === "PRODUCT_NUTRITION_INCOMPLETE") return { type: "incomplet" };
      // Tout le reste — quota, panne du fournisseur, réponse illisible, session
      // expirée, et même un GTIN refusé — est une INDISPONIBILITÉ pour l'élève.
      // Inventer un quatrième message par code technique ne lui apprendrait rien
      // qu'il puisse utiliser debout dans un rayon.
      return { type: "indisponible" };
    }
    const corps = (await réponse.json()) as { produit?: ProduitDTO };
    if (!corps.produit || typeof corps.produit.id !== "string") return { type: "indisponible" };
    return { type: "produit", produit: versProduitLocal(corps.produit, true) };
  } catch {
    return { type: "indisponible" };
  }
}
