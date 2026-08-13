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

/* ══════════════════════════════════════════════════════════════════════════
   A5 — DEUX DÉPARTAGES DE PLUS, ET AUCUN N'EST UNE INVENTION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * L'entrée REPRÉSENTATIVE d'une famille, selon Ciqual elle-même.
 *
 * `(aliment moyen)` est la désignation de l'Anses — 163 lignes sur les 3 330
 * importées. Ce n'est pas une heuristique maison : c'est la source qui dit
 * « voici l'entrée à prendre quand on ne précise rien ».
 *
 * ⚠️ SA PLACE DANS LE TRI A ÉTÉ MESURÉE, ET LA PREMIÈRE ÉTAIT FAUSSE. Placée
 * juste après le rang, cette règle corrigeait « pomme » mais CASSAIT « pates » :
 * « Pâtes fraîches farcies (ex : raviolis, tortellinis), cuites (aliment
 * moyen) » passait devant « Pâtes sèches, standard, crues ». La cause : sa tête
 * fait sept mots. Déplacée APRÈS le comptage des mots de la tête, elle ne
 * dégrade plus rien. L'ordre des départages n'est donc pas décoratif.
 */
export function estAlimentMoyen(nom: string): boolean {
  return /\(aliment moyen\)/i.test(nom);
}

/**
 * Les formes TRANSFORMÉES, rétrogradées à rang et tête égaux.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE LISTE EXISTE
 * ────────────────────────────────────────────────────────────────────────────
 * MESURÉ : à rang et tête égaux, c'était le nom le plus COURT qui gagnait — et
 * le nom le plus court est souvent une préparation marginale. « Pomme, sèche »
 * (12 caractères) passait devant « Pomme, chair sans peau, crue » ; « Oeuf, en
 * poudre » devant « Oeuf, blanc (blanc d'oeuf), cru ». Quelqu'un qui tape
 * « pomme » ne cherche presque jamais une pomme séchée.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELLE EST FERMÉE, COURTE, ET NE REGARDE QUE LES QUALIFICATIFS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ La recherche se fait APRÈS la tête, jamais dedans — et c'est ce qui
 * protège « Pâtes **sèches** ». Là, « sèches » n'est pas une préparation : c'est
 * l'aliment lui-même, et le rétrograder ferait remonter les pâtes fraîches
 * farcies à sa place. Le même mot, deux natures, distinguées par sa POSITION
 * dans le nom Ciqual — pas par une exception écrite à la main.
 *
 * Aucun score, aucune pondération : un booléen, appliqué en dernier recours
 * entre deux aliments par ailleurs équivalents.
 */
const FORMES_TRANSFORMEES: readonly string[] = [
  "en poudre",
  "seche",
  "seches",
  "sechee",
  "sechees",
  "deshydrate",
  "deshydratee",
  "appertise",
  "appertisee",
  "surgele",
  "surgelee",
  "fume",
  "fumee",
  "confit",
  "confite",
  "au sirop",
  "lyophilise",
];

export function estFormeTransformee(nom: string): boolean {
  // On ne regarde QUE ce qui suit la tête : voir l'encadré ci-dessus.
  const qualificatifs = normaliserPourRecherche(nom.slice(teteDuNom(nom).length));
  if (qualificatifs === "") return false;
  const mots = qualificatifs.split(" ");
  return FORMES_TRANSFORMEES.some((forme) =>
    forme.includes(" ") ? qualificatifs.includes(forme) : mots.includes(forme),
  );
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
    // A5, et DANS CET ORDRE — voir `estAlimentMoyen` : placés avant le comptage
    // des mots de la tête, ces deux départages dégradaient « pates ».
    const moyenA = estAlimentMoyen(a.item.name) ? 0 : 1;
    const moyenB = estAlimentMoyen(b.item.name) ? 0 : 1;
    if (moyenA !== moyenB) return moyenA - moyenB;
    const transA = estFormeTransformee(a.item.name) ? 1 : 0;
    const transB = estFormeTransformee(b.item.name) ? 1 : 0;
    if (transA !== transB) return transA - transB;
    if (a.item.name.length !== b.item.name.length) return a.item.name.length - b.item.name.length;
    const parNom = a.item.name.localeCompare(b.item.name, "fr");
    if (parNom !== 0) return parNom;
    return a.item.id.localeCompare(b.item.id);
  });

  return classés.slice(0, limite).map((c) => c.item);
}

/* ══════════════════════════════════════════════════════════════════════════
   A5 — LE CLASSEMENT DES PRODUITS COMMERCIAUX
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un produit n'est pas un aliment Ciqual, et ne se classe pas comme lui.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX DIFFÉRENCES DE NATURE
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Pas de virgule structurante. « Skyr nature », pas « Skyr, nature » : la
 *    notion de TÊTE n'a aucun sens ici, et `classerResultats` s'appuie dessus.
 * 2. Une MARQUE, qui est un second chemin de recherche légitime — quelqu'un
 *    qui tape « danone » cherche des produits Danone, pas un produit dont le
 *    nom contiendrait ce mot.
 *
 * ⚠️ CE QUE CE CLASSEMENT CORRIGE. Avant A5, les correspondances de marque
 * étaient ajoutées À LA SUITE de toutes les correspondances de nom, y compris
 * les plus faibles : un produit de la marque exacte cherchée passait derrière
 * un produit dont le nom contenait vaguement le terme. Le rang 2 ci-dessous
 * remet la marque exacte devant la simple occurrence.
 */
export interface ClassableProduit extends Classable {
  readonly brand: string | null;
}

/**
 * Les cinq rangs du §6, du plus proche au plus lointain. `null` quand le terme
 * n'apparaît ni dans le nom ni dans la marque : l'élément est écarté.
 *
 *   0  le nom EST le terme                    « skyr »   → Skyr
 *   1  le nom COMMENCE par le terme           « skyr »   → Skyr nature
 *   2  la marque est le terme, ou commence    « danone » → n'importe quel Danone
 *   3  le terme apparaît dans le nom          « nature » → Skyr nature
 *   4  le terme apparaît dans la marque       « one »    → Danone
 */
export function rangProduit(produit: ClassableProduit, terme: string): number | null {
  const t = normaliserPourRecherche(terme);
  if (t === "") return null;
  const nom = normaliserPourRecherche(produit.name);
  const marque = normaliserPourRecherche(produit.brand ?? "");

  if (nom === t) return 0;
  if (nom.startsWith(`${t} `)) return 1;
  if (marque !== "" && (marque === t || marque.startsWith(`${t} `))) return 2;
  if (nom.includes(t)) return 3;
  if (marque !== "" && marque.includes(t)) return 4;
  return null;
}

/**
 * Trie et borne les produits. Départages, après le rang : nom le plus court —
 * « Skyr nature » avant « Skyr nature vanille édition limitée » —, puis ordre
 * alphabétique, puis identifiant, pour qu'aucune exécution ne puisse rendre
 * deux ordres différents.
 *
 * Aucune notion d'« aliment moyen » ni de forme transformée ici : ce sont des
 * conventions de nommage Ciqual, et un produit commercial n'en suit aucune.
 */
export function classerProduits<T extends ClassableProduit>(
  items: readonly T[],
  terme: string,
  limite: number,
): readonly T[] {
  const classés = items
    .map((item) => ({ item, rang: rangProduit(item, terme) }))
    .filter((c): c is { item: T; rang: number } => c.rang !== null);

  classés.sort((a, b) => {
    if (a.rang !== b.rang) return a.rang - b.rang;
    if (a.item.name.length !== b.item.name.length) return a.item.name.length - b.item.name.length;
    const parNom = a.item.name.localeCompare(b.item.name, "fr");
    if (parNom !== 0) return parNom;
    return a.item.id.localeCompare(b.item.id);
  });

  return classés.slice(0, limite).map((c) => c.item);
}

/**
 * DÉDOUBLONNAGE PAR IDENTITÉ, ET RIEN D'AUTRE (§7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX GTIN DIFFÉRENTS RESTENT DEUX PRODUITS
 * ────────────────────────────────────────────────────────────────────────────
 * Aucune fusion sur un nom qui se ressemble. « Yaourt nature 500 g » et
 * « Yaourt nature 1 kg » sont deux produits, avec deux codes-barres, deux
 * fiches et parfois deux compositions — les confondre ferait consommer les
 * macros de l'un sous l'étiquette de l'autre, définitivement, puisque
 * l'instantané ne suit jamais sa source.
 *
 * L'identité est donc l'identifiant de la ligne `food_products`, et le GTIN est
 * unique dans cette table : un produit remonté par la recherche externe est
 * ÉCRIT EN CACHE avant d'être rendu, il ressort donc avec le MÊME identifiant
 * que sa version locale. C'est ce qui fait qu'un produit trouvé deux fois —
 * une fois en local, une fois en ligne — n'apparaît qu'une seule fois.
 *
 * Le premier vu gagne : l'ordre d'arrivée porte du sens (le local d'abord),
 * et une déduplication qui inverserait cet ordre déplacerait des lignes sous
 * les yeux de l'élève.
 */
export function dedupliquerProduits<T extends { readonly id: string; readonly gtin?: string }>(
  produits: readonly T[],
): readonly T[] {
  const vus = new Set<string>();
  const gardés: T[] = [];
  for (const p of produits) {
    // Le GTIN est vérifié EN PLUS de l'identifiant : si deux lignes portaient un
    // jour le même code-barres — ce que l'index unique interdit, mais qu'un
    // fournisseur externe pourrait rendre deux fois avant écriture —, elles ne
    // seraient affichées qu'une fois.
    const clés = [`id:${p.id}`, ...(p.gtin ? [`gtin:${p.gtin}`] : [])];
    if (clés.some((c) => vus.has(c))) continue;
    for (const c of clés) vus.add(c);
    gardés.push(p);
  }
  return gardés;
}
