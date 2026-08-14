/**
 * COURSES C1 — L'AGRÉGATION, ET LES QUATRE IDENTITÉS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CLÉ, C'EST L'IDENTITÉ **ET** L'UNITÉ
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Additionner « 200 g » et « 200 ml » du même produit donnerait 400 de
 * quelque chose qui n'existe pas. Le catalogue ne porte AUCUNE densité, et
 * inventer « 1 ml ≈ 1 g » créerait une seconde convention nutritionnelle à
 * côté du 4/4/9. L'unité fait donc partie de la clé — exactement comme dans
 * `agregerConsommation` (A5.7), et pour la même raison.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PRIORITÉ D'IDENTITÉ — §7 DU CAHIER DES CHARGES
 * ────────────────────────────────────────────────────────────────────────────
 *   1. `catalog_food_id`  — identité forte
 *   2. `product_id`       — identité forte, un GTIN par produit
 *   3. identité structurée d'ingrédient, si elle existe un jour
 *   4. libellé normalisé  — UNIQUEMENT pour les ingrédients de recette
 *
 * Le niveau 4 est un pis-aller ASSUMÉ et BORNÉ. Il existe parce que les
 * ingrédients de recette n'ont, aujourd'hui, aucune identité partagée : le même
 * « Riz basmati » dans deux recettes porte deux `id` différents. Mesuré sur la
 * base réelle : 100 ingrédients, 80 libellés distincts, et 16 libellés présents
 * dans PLUSIEURS recettes — sans ce regroupement, ces 16-là produiraient des
 * doublons sur la liste.
 *
 * ⚠️ ET IL NE DOIT PAS CONTAMINER LE RESTE. Un `catalog_food` et un `product`
 * ne sont JAMAIS regroupés par leur nom, même identique : c'est la règle d'A3
 * et d'A5.7, et deux tests la gardent (C1-21, C1-22).
 */

import { normaliserLibelle } from "@/lib/courses/preferences";

export type SourceLigne = "catalog_food" | "product" | "recipe_ingredient";

/** Les rayons de la liste. Ordre d'affichage du §11. */
export const CATEGORIES_COURSES = [
  "proteines",
  "feculents",
  "legumes",
  "fruits",
  "laitiers",
  "autres",
] as const;
export type CategorieCourses = (typeof CATEGORIES_COURSES)[number];

export const LIBELLES_RAYONS: Readonly<Record<CategorieCourses, string>> = {
  proteines: "Protéines",
  feculents: "Féculents",
  legumes: "Légumes",
  fruits: "Fruits",
  laitiers: "Produits laitiers",
  autres: "Autres",
};

/** D'où vient une quantité — le §8. */
export interface ProvenanceLigne {
  readonly date: string;
  readonly slot: string;
  readonly recetteId: string;
  readonly recetteNom: string;
  readonly quantite: number;
  readonly unite: string;
}

export interface BesoinBrut {
  readonly source: SourceLigne;
  readonly catalogFoodId?: string | null;
  readonly productId?: string | null;
  readonly gtin?: string | null;
  /** Le libellé tel qu'il sera AFFICHÉ — jamais normalisé à l'écran. */
  readonly label: string;
  readonly quantite: number;
  /** `g`, `ml`, `piece`, `portion`, ou une unité libre de recette (« wrap »). */
  readonly unite: string;
  readonly categorie: CategorieCourses;
  readonly provenance: ProvenanceLigne;
}

export interface LigneCourses {
  readonly identity: string;
  readonly source: SourceLigne;
  readonly catalogFoodId?: string;
  readonly productId?: string;
  readonly gtin?: string;
  readonly label: string;
  readonly quantite: number;
  readonly unite: string;
  readonly categorie: CategorieCourses;
  readonly provenance: readonly ProvenanceLigne[];
}

/**
 * L'identité d'un besoin, selon la priorité du §7.
 *
 * ⚠️ LE TYPE EST EN PRÉFIXE. Deux `uuid` peuvent coïncider entre
 * `food_catalog` et `food_products` — rien ne garantit le contraire — et un
 * aliment générique n'est pas un produit commercial. Même précaution qu'en
 * A5.7.
 */
export function identiteDuBesoin(besoin: BesoinBrut): string {
  if (besoin.catalogFoodId) return `catalog_food:${besoin.catalogFoodId}`;
  if (besoin.productId) return `product:${besoin.productId}`;
  return `recipe_ingredient:${normaliserLibelle(besoin.label)}`;
}

/**
 * La clé d'agrégation : identité **plus** unité.
 *
 * C'est cette ligne, et elle seule, qui empêche « 200 g » et « 200 ml » de se
 * rencontrer. La retirer serait le contrôle négatif le plus court du lot.
 */
export function cleAgregation(besoin: BesoinBrut): string {
  return `${identiteDuBesoin(besoin)}|${besoin.unite}`;
}

/**
 * Agrège les besoins d'une période en lignes de courses.
 *
 * Ordre de sortie DÉTERMINISTE : rayon, puis quantité décroissante, puis
 * libellé. Sans le dernier critère, deux lignes de même quantité sortiraient
 * dans un ordre variable d'une exécution à l'autre.
 */
export function agregerCourses(besoins: readonly BesoinBrut[]): readonly LigneCourses[] {
  const parCle = new Map<string, LigneCourses>();

  for (const besoin of besoins) {
    if (!Number.isFinite(besoin.quantite) || besoin.quantite <= 0) continue;
    const cle = cleAgregation(besoin);
    const existante = parCle.get(cle);

    if (!existante) {
      parCle.set(cle, {
        identity: identiteDuBesoin(besoin),
        source: besoin.source,
        ...(besoin.catalogFoodId ? { catalogFoodId: besoin.catalogFoodId } : {}),
        ...(besoin.productId ? { productId: besoin.productId } : {}),
        ...(besoin.gtin ? { gtin: besoin.gtin } : {}),
        label: besoin.label,
        quantite: besoin.quantite,
        unite: besoin.unite,
        categorie: besoin.categorie,
        provenance: [besoin.provenance],
      });
      continue;
    }

    parCle.set(cle, {
      ...existante,
      quantite: existante.quantite + besoin.quantite,
      // ⚠️ LA PROVENANCE N'EST PAS DÉCORATIVE. C'est elle qui permettra de dire
      // « ce poulet vient du déjeuner de vendredi et du dîner de samedi », et
      // plus tard de retirer un jour sans tout recalculer.
      provenance: [...existante.provenance, besoin.provenance],
    });
  }

  const rang = (c: CategorieCourses) => CATEGORIES_COURSES.indexOf(c);
  return [...parCle.values()].sort(
    (a, b) =>
      rang(a.categorie) - rang(b.categorie) ||
      b.quantite - a.quantite ||
      a.label.localeCompare(b.label, "fr") ||
      a.identity.localeCompare(b.identity),
  );
}

/** Les lignes d'un rayon, dans l'ordre déjà établi. */
export function lignesParRayon(
  lignes: readonly LigneCourses[],
): readonly (readonly [CategorieCourses, readonly LigneCourses[]])[] {
  return CATEGORIES_COURSES.map(
    (c) => [c, lignes.filter((l) => l.categorie === c)] as const,
  ).filter(([, l]) => l.length > 0);
}
