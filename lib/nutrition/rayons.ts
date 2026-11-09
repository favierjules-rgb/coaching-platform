import type { IdentityType } from "@/lib/nutrition/liste-de-courses";
import {
  SSGRP_PAR_CODE_CIQUAL,
  SURGELES_CIQUAL,
} from "@/lib/nutrition/rayons-ciqual.generated";

/**
 * COURSES — LES RAYONS DE LA LISTE. CLASSÉS, JAMAIS DEVINÉS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * D'OÙ VIENT LA CLASSIFICATION, ET POURQUOI PAS D'AILLEURS
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUNE COLONNE « CATÉGORIE » N'EXISTE EN BASE, et on n'en a pas créé une.
 * Ni `food_catalog`, ni `food_products` ne portent de rayon ; une migration
 * aurait ajouté une colonne que personne n'aurait remplie pour 3 330 lignes.
 *
 * ⚠️ ET SURTOUT : LE RAYON NE SE DEVINE PAS SUR LE NOM. « Lait de coco » n'est
 * pas un produit laitier, « beurre de cacahuète » n'est pas un beurre, et
 * « steak de soja » n'est pas une viande. Une règle par mots-clés se tromperait
 * exactement sur les aliments les plus fréquents d'un plan de nutrition.
 *
 * LA CLASSIFICATION EST CELLE DE L'ANSES, et elle est DÉJÀ dans le dépôt.
 * `data/ciqual/2025/aliments.jsonl` — le jeu normalisé d'où sort la migration
 * d'import — porte pour chaque aliment son `grp_code` et son `ssgrp_code`
 * officiels. `food_catalog.source_ref` EST l'`alim_code` Ciqual (100 %
 * renseigné : les 3 330 lignes viennent toutes de `source = 'ciqual'`), donc
 * chaque aliment du catalogue se relie à son sous-groupe officiel sans rien
 * inventer et sans rien demander à personne.
 *
 *   Anses. 2025. Table de composition nutritionnelle des aliments Ciqual
 *   DOI 10.57745/RDMHWY — Licence Ouverte / Open Licence (Etalab) 2.0
 *
 * CE QUI RESTE UN CHOIX, ET QUI EST DONC ÉCRIT ICI À LA MAIN : le passage des
 * 65 sous-groupes de l'Anses aux 7 rayons demandés. Ce choix est relisible
 * ligne par ligne dans `RAYON_PAR_SSGRP` ci-dessous ; il n'est pas noyé dans un
 * fichier généré, et le fichier généré ne contient, lui, QUE des faits du
 * fichier de l'Anses (`alim_code → ssgrp_code`, et la liste des aliments dont
 * le nom officiel porte « surgelé »).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ IL NE REGROUPE RIEN. Le rayon est un INTERTITRE d'affichage : deux
 * aliments du même rayon restent deux lignes, avec leurs quantités propres.
 * L'agrégation reste celle de `liste-de-courses.ts` — identité + unité — et ce
 * module n'y touche pas.
 *
 * ⚠️ IL N'INVENTE PAS DE RAYON POUR CE QU'IL NE CONNAÎT PAS. Un aliment sans
 * code Ciqual, un produit commercial non rapproché, un sous-groupe que l'Anses
 * ajouterait demain : tout cela tombe dans « Divers », visiblement, plutôt que
 * d'être rangé au hasard dans un rayon plausible.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 */

/* ══════════════════════════════════════════════════════════════════════════
   LES SEPT RAYONS
   ══════════════════════════════════════════════════════════════════════════ */

export type RayonId =
  | "fruits-legumes"
  | "viandes-poissons-oeufs"
  | "feculents-cereales"
  | "produits-laitiers"
  | "epicerie"
  | "surgeles"
  | "divers";

export interface Rayon {
  readonly id: RayonId;
  readonly libelle: string;
}

/**
 * L'ORDRE EST CELUI DE L'ÉNONCÉ, et c'est aussi l'ordre d'un parcours de
 * magasin : le frais d'abord, le surgelé en dernier pour qu'il reste froid.
 * « Divers » ferme la liste parce qu'un rayon inconnu ne doit pas s'intercaler
 * entre deux rayons connus.
 */
export const RAYONS: readonly Rayon[] = [
  { id: "fruits-legumes", libelle: "Fruits et légumes" },
  { id: "viandes-poissons-oeufs", libelle: "Viandes, poissons et œufs" },
  { id: "feculents-cereales", libelle: "Féculents et céréales" },
  { id: "produits-laitiers", libelle: "Produits laitiers" },
  { id: "epicerie", libelle: "Épicerie" },
  { id: "surgeles", libelle: "Surgelés" },
  { id: "divers", libelle: "Divers" },
];

const ORDRE_DES_RAYONS: ReadonlyMap<RayonId, number> = new Map(
  RAYONS.map((rayon, index) => [rayon.id, index]),
);

export function libelleDuRayon(id: RayonId): string {
  return RAYONS.find((rayon) => rayon.id === id)?.libelle ?? "Divers";
}

/* ══════════════════════════════════════════════════════════════════════════
   LES 65 SOUS-GROUPES DE L'ANSES → LES 7 RAYONS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ TABLE EXHAUSTIVE SUR LES SOUS-GROUPES PRÉSENTS DANS LE CATALOGUE, et un
 * test le vérifie : si l'Anses publie un sous-groupe de plus, le test rougit
 * au lieu de laisser l'aliment filer silencieusement dans « Divers ».
 *
 * ⚠️ « ENTRÉES ET PLATS COMPOSÉS » (01) ET « ALIMENTS INFANTILES » (11) VONT
 * DÉLIBÉRÉMENT DANS « DIVERS ». L'Anses classe par nature d'aliment, pas par
 * rayon : une « soupe » peut être en brique, au frais ou surgelée, et un
 * sandwich n'a pas de rayon du tout. Les ranger dans « Épicerie » par défaut
 * enverrait l'élève au mauvais endroit avec l'aplomb d'une information sûre ;
 * « Divers » dit la vérité, qui est qu'on ne sait pas.
 */
export const RAYON_PAR_SSGRP: ReadonlyMap<string, RayonId> = new Map<string, RayonId>([
  // 01 — entrées et plats composés : aucun rayon ne les décrit (voir ci-dessus).
  ["0101", "divers"], // salades composées et crudités
  ["0102", "divers"], // soupes
  ["0103", "divers"], // plats composés
  ["0104", "divers"], // pizzas, tartes et crêpes salées
  ["0105", "divers"], // sandwichs
  ["0106", "divers"], // feuilletées et autres entrées

  // 02 — fruits, légumes, légumineuses et oléagineux
  ["0201", "fruits-legumes"], // légumes
  ["0202", "fruits-legumes"], // pommes de terre et autres tubercules
  ["0203", "feculents-cereales"], // légumineuses — des féculents, et en rayon sec
  ["0204", "fruits-legumes"], // fruits
  ["0205", "epicerie"], // fruits à coque et graines oléagineuses

  // 03 — produits céréaliers
  ["0301", "feculents-cereales"], // pâtes, riz et céréales
  ["0302", "feculents-cereales"], // pains et assimilés
  ["0303", "epicerie"], // biscuits apéritifs
  ["0304", "epicerie"], // farines
  ["0305", "epicerie"], // pâtes à tarte

  // 04 — viandes, œufs, poissons
  ["0401", "viandes-poissons-oeufs"], // viandes cuites
  ["0402", "viandes-poissons-oeufs"], // viandes crues
  ["0403", "viandes-poissons-oeufs"], // charcuteries et alternatives végétales
  ["0404", "viandes-poissons-oeufs"], // autres produits à base de viande
  ["0405", "viandes-poissons-oeufs"], // poissons cuits
  ["0406", "viandes-poissons-oeufs"], // poissons crus
  ["0407", "viandes-poissons-oeufs"], // mollusques et crustacés cuits
  ["0408", "viandes-poissons-oeufs"], // mollusques et crustacés crus
  ["0409", "viandes-poissons-oeufs"], // produits à base de poissons
  ["0410", "viandes-poissons-oeufs"], // œufs

  // 05 — produits laitiers
  ["0501", "produits-laitiers"], // laits
  ["0502", "produits-laitiers"], // produits laitiers frais et alternatives végétales
  ["0503", "produits-laitiers"], // fromages et alternatives végétales
  ["0504", "produits-laitiers"], // crèmes et spécialités à base de crème

  // 06 — eaux et autres boissons
  ["0601", "epicerie"], // eaux
  ["0602", "epicerie"], // boissons sans alcool

  // 07 — produits sucrés
  ["0701", "epicerie"], // sucres, miels et assimilés
  ["0702", "epicerie"], // chocolats
  ["0703", "epicerie"], // confiseries non chocolatées
  ["0704", "epicerie"], // confitures et assimilés
  ["0705", "epicerie"], // viennoiseries
  ["0706", "epicerie"], // biscuits sucrés
  ["0707", "feculents-cereales"], // céréales de petit-déjeuner — flocons d'avoine inclus
  ["0708", "epicerie"], // barres céréalières
  ["0709", "epicerie"], // gâteaux et pâtisseries

  // 08 — glaces et sorbets : surgelés PAR NATURE, pas par mention du nom.
  ["0801", "surgeles"], // glaces
  ["0802", "surgeles"], // sorbets
  ["0803", "surgeles"], // desserts glacés

  // 09 — matières grasses
  ["0901", "produits-laitiers"], // beurres — rayon frais, à côté des yaourts
  ["0902", "epicerie"], // huiles et graisses végétales
  ["0903", "epicerie"], // margarines
  ["0904", "epicerie"], // huiles de poissons
  ["0905", "epicerie"], // autres matières grasses

  // 10 — aides culinaires et ingrédients divers
  ["1001", "epicerie"], // sauces
  ["1002", "epicerie"], // condiments
  ["1003", "epicerie"], // aides culinaires
  ["1004", "epicerie"], // sels
  ["1005", "epicerie"], // épices
  ["1006", "epicerie"], // herbes — l'Anses mêle le frais et le séché
  ["1007", "epicerie"], // algues
  ["1008", "epicerie"], // denrées destinées à une alimentation particulière
  ["1009", "epicerie"], // ingrédients pour végétariens
  ["1010", "epicerie"], // tartinables végétariens

  // 11 — aliments infantiles : hors de ce parcours (voir ci-dessus).
  ["1101", "divers"],
  ["1102", "divers"],
  ["1103", "divers"],
  ["1104", "divers"],

  // Sous-groupe vide dans le fichier de l'Anses : on ne le range pas.
  ["0000", "divers"],
]);

/* ══════════════════════════════════════════════════════════════════════════
   LA RÉSOLUTION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Le rayon d'un aliment, à partir de son code Ciqual.
 *
 * ⚠️ « SURGELÉS » PASSE DEVANT LE SOUS-GROUPE, et c'est voulu : l'Anses classe
 * la framboise surgelée dans « fruits », mais on ne l'achète pas au rayon
 * fruits. La mention vient du NOM OFFICIEL de l'Anses, où « surgelé(e)(s) »
 * est un état de préparation normalisé — ce n'est pas une devinette sur le
 * libellé, et la liste des codes concernés est figée à la génération.
 */
export function rayonDuCodeCiqual(codeCiqual: string | null | undefined): RayonId {
  if (!codeCiqual) return "divers";
  if (SURGELES_CIQUAL.has(codeCiqual)) return "surgeles";
  const ssgrp = SSGRP_PAR_CODE_CIQUAL[codeCiqual];
  if (ssgrp === undefined) return "divers";
  return RAYON_PAR_SSGRP.get(ssgrp) ?? "divers";
}

/** Ce qu'une ligne doit porter pour qu'on sache où la ranger. */
export interface PorteurDeRayon {
  readonly identityType: IdentityType;
  /**
   * `food_catalog.source_ref` quand `source = 'ciqual'`, sinon `null`.
   *
   * ⚠️ POUR UN PRODUIT COMMERCIAL, c'est le code de l'aliment du catalogue
   * auquel il est RAPPROCHÉ (`food_products.food_id`), et `null` s'il ne l'est
   * pas. Open Food Facts porte bien des `categories_tags`, mais le dépôt n'en
   * conserve aucun (`source_payload` ne contient pas la clé) : les lire
   * supposerait un nouvel appel réseau à chaque affichage de liste, pour un
   * intertitre. Un produit non rapproché va donc dans « Divers ».
   */
  readonly codeCiqual: string | null;
}

export function rayonDeLigne(ligne: PorteurDeRayon): RayonId {
  return rayonDuCodeCiqual(ligne.codeCiqual);
}

/* ══════════════════════════════════════════════════════════════════════════
   LE GROUPEMENT POUR L'AFFICHAGE
   ══════════════════════════════════════════════════════════════════════════ */

export interface GroupeDeRayon<L> {
  readonly rayon: RayonId;
  readonly libelle: string;
  readonly lignes: readonly L[];
}

/**
 * Range des lignes par rayon, dans l'ordre de `RAYONS`.
 *
 * ⚠️ UN RAYON VIDE N'APPARAÎT PAS. Sept intertitres dont cinq vides, c'est
 * cinq fois la place perdue sur un écran de téléphone.
 *
 * ⚠️ L'ORDRE DES LIGNES À L'INTÉRIEUR D'UN RAYON EST CELUI D'ENTRÉE. Le tri
 * alphabétique a déjà été fait en amont ; le refaire ici le rendrait dépendant
 * de deux endroits.
 *
 * ⚠️ IL LIT UN RAYON DÉJÀ RÉSOLU, IL NE LE RECALCULE PAS. La résolution
 * (`rayonDeLigne`) a lieu UNE FOIS, à l'hydratation, là où le code Ciqual est
 * disponible. La refaire au rendu ferait dépendre l'affichage d'un champ que
 * la ligne affichée n'a pas à porter, et ferait exister deux réponses possibles
 * à la même question.
 */
export function grouperParRayon<L extends { readonly rayon: RayonId }>(
  lignes: readonly L[],
): readonly GroupeDeRayon<L>[] {
  const parRayon = new Map<RayonId, L[]>();
  for (const ligne of lignes) {
    const rayon = ligne.rayon;
    const groupe = parRayon.get(rayon);
    if (groupe) groupe.push(ligne);
    else parRayon.set(rayon, [ligne]);
  }
  return [...parRayon.entries()]
    .sort((a, b) => (ORDRE_DES_RAYONS.get(a[0]) ?? 99) - (ORDRE_DES_RAYONS.get(b[0]) ?? 99))
    .map(([rayon, lignesDuRayon]) => ({
      rayon,
      libelle: libelleDuRayon(rayon),
      lignes: lignesDuRayon,
    }));
}
