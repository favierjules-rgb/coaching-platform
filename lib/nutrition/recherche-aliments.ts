/**
 * CLASSEMENT DES RÉSULTATS DE RECHERCHE (ALIMENTS A3, PHASE 5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN CLASSEMENT, ET POURQUOI CELUI-LÀ
 * ────────────────────────────────────────────────────────────────────────────
 * MESURÉ sur la table Ciqual 2025 réellement importée, le 13/08/2026 :
 *
 *   terme      aliments contenant le terme     dont le nom COMMENCE par lui
 *   « oeuf »              137                              22
 *   « pomme »              97                              35
 *   « poulet »             68                              27
 *   « riz »                46                              22
 *   « banane »              7                               4
 *
 * Rendre les vingt premiers PAR ORDRE ALPHABÉTIQUE, comme le faisait A2, donne
 * donc — pour « oeuf » — vingt aliments pris entre « Bar… » et « Cake… », sans
 * un seul œuf. Ce n'est pas un défaut d'ergonomie, c'est une recherche qui ne
 * répond pas à la question posée.
 *
 * La règle ci-dessous est volontairement PAUVRE : quatre rangs, aucun score,
 * aucune pondération, aucun apprentissage. Elle tient en une phrase — « ce qui
 * s'appelle exactement comme ta recherche d'abord, ce qui commence par elle
 * ensuite, ce qui la contient enfin » — et elle est entièrement déterministe :
 * deux exécutions sur les mêmes données rendent le même ordre, dans le même
 * ordre. Un moteur de pertinence est un chantier à part (A5) ; en attendre un
 * pour rendre « banane » utile serait laisser l'écran inutilisable en attendant.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA TÊTE DU NOM, ET POURQUOI ELLE FAIT LE RANG 0
 * ────────────────────────────────────────────────────────────────────────────
 * Un nom Ciqual est construit « aliment, précisions, précisions » :
 *
 *   Banane, chair sans peau, crue      ← la banane
 *   Banane plantain, crue              ← une autre banane
 *   Dessert lacté à la banane          ← pas une banane
 *
 * La TÊTE — ce qui précède la première virgule — est donc l'aliment lui-même,
 * et le reste en est la préparation. Comparer le terme à cette tête, plutôt
 * qu'au nom entier, est ce qui met « Banane, chair sans peau, crue » avant
 * « Banane plantain » sans avoir à connaître un seul aliment.
 *
 * Ce module est une FEUILLE : ni React, ni Supabase, ni réseau.
 */

/**
 * Normalisation pour comparer, jamais pour afficher.
 *
 * Elle reproduit ce que fait `public.food_slug` en base — et c'est
 * indispensable, parce que la recherche interroge le `slug` :
 *
 *   MESURÉ : « pates » ne trouve RIEN par le nom (Ciqual écrit « Pâtes »),
 *   et trouve 39 aliments par le slug. « oeuf » trouve les 137 œufs, ligature
 *   « Œ » comprise. Chercher dans le nom seul, comme le faisait A2, laissait
 *   donc un élève sans pâtes — sur une table qui en contient trente-neuf.
 */
export function normaliserPourRecherche(texte: string): string {
  return texte
    .normalize("NFD")
    // Retire les diacritiques décomposés par NFD.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // NFD ne décompose pas les ligatures : elles se remplacent à la main,
    // exactement comme le fait `food_slug`.
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    // Tout ce qui n'est ni lettre ni chiffre devient une séparation. Les
    // virgules, parenthèses, apostrophes et tirets de Ciqual disparaissent
    // ainsi de la comparaison sans disparaître de l'affichage.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** La TÊTE du nom : ce qui précède la première virgule. */
export function teteDuNom(nom: string): string {
  const virgule = nom.indexOf(",");
  return virgule === -1 ? nom : nom.slice(0, virgule);
}

/**
 * Rang de correspondance, du plus proche au plus lointain. `null` quand le
 * terme n'apparaît pas du tout — l'élément est alors écarté, pas classé
 * dernier.
 *
 *   0  la tête EST le terme                  « banane » → Banane, chair…
 *   1  la tête COMMENCE par le terme         « banane » → Banane plantain, crue
 *   2  le nom commence par le terme          « chair » → rien ici, mais utile
 *                                             pour les produits, qui n'ont pas
 *                                             de virgule structurante
 *   3  le terme apparaît ailleurs            « banane » → Dessert à la banane
 */
export function rangDeCorrespondance(nom: string, terme: string): number | null {
  const t = normaliserPourRecherche(terme);
  if (t === "") return null;
  const complet = normaliserPourRecherche(nom);
  const tete = normaliserPourRecherche(teteDuNom(nom));

  if (tete === t) return 0;
  if (tete.startsWith(`${t} `)) return 1;
  if (complet.startsWith(`${t} `) || complet === t) return 2;
  if (complet.includes(t)) return 3;
  return null;
}

/** Nombre de mots de la tête — 1 pour « Banane », 3 pour « Pomme de terre ». */
export function motsDeLaTete(nom: string): number {
  const tete = normaliserPourRecherche(teteDuNom(nom));
  return tete === "" ? 0 : tete.split(" ").length;
}

export interface Classable {
  readonly id: string;
  readonly name: string;
}

/**
 * Trie et borne. Les départages sont eux aussi déterministes, et dans cet
 * ordre : rang, puis LONGUEUR du nom (un nom court est un aliment plus
 * générique — « Riz blanc, cru » avant « Riz blanc étuvé, cuit à l'eau,
 * non salé »), puis ordre alphabétique, puis identifiant. Le dernier critère
 * ne sert jamais à départager deux aliments réels ; il est là pour qu'aucune
 * exécution ne puisse rendre deux ordres différents.
 */
export function classerResultats<T extends Classable>(
  items: readonly T[],
  terme: string,
  limite: number,
): readonly T[] {
  const classés = items
    .map((item) => ({ item, rang: rangDeCorrespondance(item.name, terme) }))
    .filter((c): c is { item: T; rang: number } => c.rang !== null);

  classés.sort((a, b) => {
    if (a.rang !== b.rang) return a.rang - b.rang;
    // MOTS DE LA TÊTE avant longueur du nom. Mesuré sur « riz » : la tête
    // « Riz » (1 mot) précède « Riz blanc » (2 mots), qui précède « Riz au
    // lait vanille » (4 mots) — alors qu'un classement par longueur totale
    // aurait mis « Riz blanc, cru » (14 caractères) devant « Riz, mélange de
    // variétés…, cru » (67), c'est-à-dire une variété devant l'aliment
    // générique.
    const motsA = motsDeLaTete(a.item.name);
    const motsB = motsDeLaTete(b.item.name);
    if (motsA !== motsB) return motsA - motsB;
    if (a.item.name.length !== b.item.name.length) return a.item.name.length - b.item.name.length;
    const parNom = a.item.name.localeCompare(b.item.name, "fr");
    if (parNom !== 0) return parNom;
    return a.item.id.localeCompare(b.item.id);
  });

  return classés.slice(0, limite).map((c) => c.item);
}
