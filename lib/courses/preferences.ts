/**
 * COURSES C1 — LES ENVIES, ET CE QU'ELLES NE SONT PAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNE PRÉFÉRENCE N'EST PAS UN ALIMENT
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ C'est la règle la plus importante du module, et elle est MESURÉE, pas
 * supposée : dans le catalogue Ciqual du produit, « bœuf » recouvre 51 aliments
 * dont les protéines vont de 17,2 à 39,2 g pour 100 g — un facteur 2,3. Écrire
 * « Bœuf » sur une liste de courses ne désigne donc rien d'achetable, et
 * choisir la mauvaise variante fausserait les macros du simple au double.
 *
 * Une envie est un FILTRE et un SIGNAL DE CHOIX : elle oriente la sélection
 * parmi des aliments qui, eux, ont une identité réelle. Elle ne crée jamais de
 * ligne de courses par elle-même. Un test le vérifie (C1-07).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ET ELLE NE TOUCHE JAMAIS AUX OBJECTIFS
 * ────────────────────────────────────────────────────────────────────────────
 * Le plan du coach est une CONTRAINTE. Une envie ne peut que départager deux
 * candidats qui satisfont déjà la cible — jamais déplacer la cible.
 */

/** Les neuf catégories du §2, dans l'ordre d'affichage. */
export const CATEGORIES_ENVIES = [
  "viandes",
  "poissons",
  "feculents",
  "legumes",
  "fruits",
  "laitiers",
  "petits_dejeuners",
  "collations",
  "autres",
] as const;

export type CategorieEnvie = (typeof CATEGORIES_ENVIES)[number];

export const LIBELLES_CATEGORIES: Readonly<Record<CategorieEnvie, string>> = {
  viandes: "Viandes / volailles",
  poissons: "Poissons / fruits de mer",
  feculents: "Féculents",
  legumes: "Légumes",
  fruits: "Fruits",
  laitiers: "Produits laitiers / équivalents",
  petits_dejeuners: "Petits-déjeuners",
  collations: "Collations",
  autres: "Autres",
};

/**
 * Suggestions rapides. Ce sont des MOTS, pas des aliments : elles servent à
 * remplir le filtre sans taper, et rien de plus.
 */
export const SUGGESTIONS: Readonly<Record<CategorieEnvie, readonly string[]>> = {
  viandes: ["Poulet", "Dinde", "Bœuf", "Steak haché 5 %", "Porc", "Jambon"],
  poissons: ["Saumon", "Cabillaud", "Thon", "Crevettes", "Sardines"],
  feculents: ["Riz", "Pâtes", "Pommes de terre", "Patate douce", "Quinoa", "Semoule"],
  legumes: ["Courgette", "Brocoli", "Haricots verts", "Épinards", "Carotte", "Poivron"],
  fruits: ["Banane", "Pomme", "Fruits rouges", "Orange", "Kiwi"],
  laitiers: ["Skyr", "Fromage blanc", "Yaourt grec", "Lait", "Mozzarella"],
  petits_dejeuners: ["Flocons d'avoine", "Œufs", "Pain complet", "Beurre de cacahuète"],
  collations: ["Whey", "Amandes", "Galettes de riz", "Barre protéinée"],
  autres: ["Huile d'olive", "Miel", "Épices"],
};

export type EnviesParCategorie = Readonly<Record<CategorieEnvie, readonly string[]>>;

export interface PreferencesCourses {
  /** Ce que l'élève AIMERAIT manger. Facultatif, catégorie par catégorie. */
  readonly envies: EnviesParCategorie;
  /**
   * « Je préfère éviter cette fois-ci ».
   *
   * ⚠️ TEMPORAIRE PAR CONSTRUCTION. Cette liste vit dans la génération en
   * cours et nulle part ailleurs : aucun profil, aucune allergie, aucune
   * préférence persistante n'est touchée. C'est le §7, et c'est aussi pourquoi
   * C1 n'a besoin d'aucune table.
   */
  readonly exclusions: readonly string[];
}

export const ENVIES_VIDES: EnviesParCategorie = Object.freeze({
  viandes: [],
  poissons: [],
  feculents: [],
  legumes: [],
  fruits: [],
  laitiers: [],
  petits_dejeuners: [],
  collations: [],
  autres: [],
});

export const PREFERENCES_VIDES: PreferencesCourses = Object.freeze({
  envies: ENVIES_VIDES,
  exclusions: [],
});

/**
 * Normalise un libellé pour la COMPARAISON — jamais pour l'affichage.
 *
 * Minuscules, accents retirés, ponctuation et espaces réduits. « Bœuf » et
 * « boeuf » doivent se rencontrer ; « Steak haché 5 % » et « steak hache 5% »
 * aussi. La forme d'origine reste seule affichée.
 */
export function normaliserLibelle(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Toutes les envies, toutes catégories confondues, normalisées. */
export function enviesNormalisees(prefs: PreferencesCourses): readonly string[] {
  const vues = new Set<string>();
  for (const categorie of CATEGORIES_ENVIES) {
    for (const envie of prefs.envies[categorie] ?? []) {
      const n = normaliserLibelle(envie);
      if (n !== "") vues.add(n);
    }
  }
  return [...vues].sort();
}

export function aDesEnvies(prefs: PreferencesCourses): boolean {
  return enviesNormalisees(prefs).length > 0;
}

/**
 * Un libellé correspond-il à un terme ?
 *
 * ⚠️ CORRESPONDANCE PAR MOT ENTIER, ET C'EST DÉLIBÉRÉ. Une comparaison par
 * sous-chaîne ferait correspondre « riz » à « chorizo » et « thon » à
 * « python » — au mieux ridicule, au pire un aliment exclu qui passe. On
 * compare donc des mots, en tolérant le pluriel simple (« bananes » ↔
 * « banane »).
 */
export function correspond(libelle: string, terme: string): boolean {
  const motsLibelle = normaliserLibelle(libelle).split(" ").filter(Boolean);
  const motsTerme = normaliserLibelle(terme).split(" ").filter(Boolean);
  if (motsTerme.length === 0 || motsLibelle.length === 0) return false;

  const egal = (a: string, b: string) =>
    a === b || (a.length > 3 && a === `${b}s`) || (b.length > 3 && b === `${a}s`);

  // Tous les mots du terme doivent se retrouver : « steak haché » ne
  // correspond pas à un libellé qui ne contient que « steak ».
  return motsTerme.every((mt) => motsLibelle.some((ml) => egal(ml, mt)));
}

/**
 * Cet aliment est-il écarté pour cette génération ?
 *
 * Le refus est FERME : une exclusion l'emporte sur une envie. Un élève qui
 * exclut le poulet et coche « poulet » par ailleurs a probablement changé
 * d'avis, et la lecture la plus sûre est de ne pas lui en proposer.
 */
export function estExclu(libelle: string, exclusions: readonly string[]): boolean {
  return exclusions.some((e) => correspond(libelle, e));
}

/** Combien de termes d'envie ce libellé satisfait-il ? */
export function compterEnvies(libelle: string, envies: readonly string[]): number {
  return envies.filter((e) => correspond(libelle, e)).length;
}
