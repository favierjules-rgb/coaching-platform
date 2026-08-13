/**
 * GÉNÉRATEUR DU JEU DE DONNÉES CIQUAL 2025 — hors ligne, rejouable, déterministe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE FAIT CE SCRIPT, ET QUAND
 * ────────────────────────────────────────────────────────────────────────────
 * Il lit le fichier XLSX OFFICIEL de l'Anses, téléchargé À LA MAIN, et produit
 * trois artefacts versionnés dans le dépôt :
 *
 *   data/ciqual/2025/aliments.jsonl    le jeu normalisé, une ligne par aliment
 *   data/ciqual/2025/exclusions.jsonl  ce qui n'a PAS été importé, et pourquoi
 *   data/ciqual/2025/manifeste.json    provenance, empreintes, règles, compteurs
 *
 * Il n'est JAMAIS exécuté par la Production, ni au build, ni à l'exécution. Il
 * se relance à la main le jour où l'Anses publie un nouveau millésime.
 *
 *   npx tsx scripts/ciqual/generer-dataset.mts <chemin-du-xlsx>
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÉTERMINISME
 * ────────────────────────────────────────────────────────────────────────────
 * Même XLSX + même script = mêmes octets. Aucune date d'exécution, aucun
 * horodatage, aucun aléa n'entre dans les fichiers produits : le manifeste
 * porte les dates de la SOURCE (publication, extraction), pas celle de la
 * génération. Les aliments sont triés par `alim_code` numérique, les clés JSON
 * sont écrites dans un ordre fixe. Un `git diff` vide après régénération est
 * donc la preuve que rien n'a bougé — et A3-CIQ2 le vérifie.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LES RÈGLES, VALIDÉES AVANT ÉCRITURE
 * ────────────────────────────────────────────────────────────────────────────
 * PROTÉINES — `Protéines, N x 6.25` (const 25003), et non le facteur de Jones
 * (25000). C'est la base de l'étiquetage réglementaire européen, donc la
 * valeur que l'élève lit sur un emballage. Le choix est explicite ici et dans
 * le manifeste, pour qu'un futur lecteur sache qu'il a été fait.
 *
 * ÉNERGIE — l'énergie Ciqual est conservée en MÉTADONNÉE d'audit uniquement.
 * Elle n'entre pas dans `food_catalog`, qui ne porte que P/G/L : les kcal SETH
 * restent 4×P + 4×G + 9×L, partout, sans exception.
 *
 * VALEURS CENSURÉES ET MANQUANTES — quatre cas, jamais un de plus :
 *   valeur numérique  → parsée
 *   « traces »        → 0 en valeur opérationnelle, brut conservé
 *   « < X », X ≤ 0,5  → 0 en valeur opérationnelle, brut conservé, marqué censuré
 *   « < X », X > 0,5  → AUCUNE valeur inventée, l'aliment est exclu
 *   « - » ou vide     → AUCUNE valeur inventée, l'aliment est exclu
 * Jamais de milieu d'intervalle, jamais un zéro à la place d'un inconnu.
 *
 * BOISSONS ALCOOLISÉES — le sous-groupe Ciqual `0603` est exclu en entier.
 * L'énergie de l'alcool ne passe par aucune des trois macros : le 4/4/9 rendrait
 * 0 kcal pour une vodka. Plutôt que d'afficher un chiffre faux ou de toucher au
 * moteur énergétique, ces aliments ne sont pas proposés. Les aliments d'AUTRES
 * groupes qui contiennent un peu d'alcool (pains, tiramisu, baba au rhum) sont
 * CONSERVÉS : l'exclusion vise la catégorie, pas la molécule.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import { lireFeuilleXlsx } from "./lire-xlsx";

// ── La source, telle que l'Anses la publie ────────────────────────────────
const SOURCE = {
  // `cle` est le FOURNISSEUR, sans millésime : c'est la moitié stable de
  // l'identité d'un aliment, et elle ne doit pas changer d'une table Ciqual à
  // la suivante. Le millésime vit dans `version_dataset`.
  cle: "ciqual",
  version_dataset: "2025",
  version: "Ciqual 2025",
  editeur: "Anses",
  publie_le: "2025-11-19",
  extrait_le: "2025-11-03",
  doi: "10.57745/RDMHWY",
  licence: "Licence Ouverte / Open Licence (Etalab) 2.0",
  attribution: "Anses. 2025. Table de composition nutritionnelle des aliments Ciqual",
  attribution_longue:
    "Anses. 2025. Table de composition nutritionnelle des aliments Ciqual 2025. https://doi.org/10.57745/RDMHWY",
  page: "https://ciqual.anses.fr/",
} as const;

const FEUILLE = "composition nutritionnelle";
const SSGRP_BOISSONS_ALCOOLISEES = "0603";
/** Au-delà de ce seuil, une valeur censurée « < X » n'est plus assimilable à 0. */
const SEUIL_CENSURE_ACCEPTABLE = 0.5;

/**
 * Les colonnes sont repérées par POSITION, jamais par libellé.
 *
 * Raison mesurée : Excel a remplacé les « / » des en-têtes par des retours à la
 * ligne. La colonne des glucides ne s'appelle pas `Glucides (g/100 g)` mais
 * `"Glucides\r\n(g\r\n100 g)"`. Un mapping par égalité de nom échouerait en
 * silence — et l'aliment sortirait sans glucides.
 *
 * `verifierEntetes` ci-dessous contrôle que ces positions sont toujours les
 * bonnes : si l'Anses réordonne ses colonnes, la génération s'arrête net.
 */
const COL = {
  grp_code: 0,
  ssgrp_code: 1,
  ssssgrp_code: 2,
  grp_nom: 3,
  ssgrp_nom: 4,
  ssssgrp_nom: 5,
  alim_code: 6,
  alim_nom: 7,
  energie_kcal_ue: 10,
  proteines_625: 15,
  glucides: 16,
  lipides: 17,
} as const;

/** Fragments attendus dans chaque en-tête, une fois les blancs normalisés. */
const ENTETES_ATTENDUES: readonly (readonly [number, string])[] = [
  [COL.grp_code, "alim_grp_code"],
  [COL.ssgrp_code, "alim_ssgrp_code"],
  [COL.grp_nom, "alim_grp_nom_fr"],
  [COL.ssgrp_nom, "alim_ssgrp_nom_fr"],
  [COL.alim_code, "alim_code"],
  [COL.alim_nom, "alim_nom_fr"],
  [COL.energie_kcal_ue, "Energie, Règlement UE N° 1169 2011 (kcal 100 g)"],
  [COL.proteines_625, "Protéines, N x 6.25 (g 100 g)"],
  [COL.glucides, "Glucides (g 100 g)"],
  [COL.lipides, "Lipides (g 100 g)"],
];

function normaliserEntete(brut: string): string {
  return brut.split(/\s+/).join(" ").trim();
}

function verifierEntetes(entetes: readonly string[]): void {
  for (const [position, attendu] of ENTETES_ATTENDUES) {
    const trouve = normaliserEntete(entetes[position] ?? "");
    if (trouve !== attendu) {
      throw new Error(
        `Colonne ${position} : attendu « ${attendu} », trouvé « ${trouve} ». ` +
          `La structure du fichier Anses a changé — NE PAS régénérer à l'aveugle.`,
      );
    }
  }
}

type Lecture =
  | { readonly etat: "valeur"; readonly valeur: number; readonly brut: string }
  | { readonly etat: "traces"; readonly valeur: 0; readonly brut: string }
  | { readonly etat: "censure_acceptable"; readonly valeur: 0; readonly seuil: number; readonly brut: string }
  | { readonly etat: "censure_trop_haute"; readonly seuil: number; readonly brut: string }
  | { readonly etat: "manquant"; readonly brut: string }
  | { readonly etat: "illisible"; readonly brut: string };

/** Une teneur Ciqual, lue selon la politique validée. */
export function lireTeneur(cellule: string): Lecture {
  const brut = (cellule ?? "").trim();
  if (brut === "" || brut === "-") return { etat: "manquant", brut };
  if (brut.toLowerCase() === "traces") return { etat: "traces", valeur: 0, brut };

  const censure = /^<\s*([\d]+(?:[.,][\d]+)?)$/.exec(brut);
  if (censure) {
    const seuil = Number(censure[1].replace(",", "."));
    if (!Number.isFinite(seuil)) return { etat: "illisible", brut };
    return seuil <= SEUIL_CENSURE_ACCEPTABLE
      ? { etat: "censure_acceptable", valeur: 0, seuil, brut }
      : { etat: "censure_trop_haute", seuil, brut };
  }

  // La virgule est le séparateur décimal du fichier. Le point n'apparaît que
  // dans la colonne « Facteur de Jones », que nous n'importons pas — on
  // l'accepte quand même, un nombre reste un nombre.
  if (!/^[\d]+(?:[.,][\d]+)?$/.test(brut)) return { etat: "illisible", brut };
  const valeur = Number(brut.replace(",", "."));
  return Number.isFinite(valeur) ? { etat: "valeur", valeur, brut } : { etat: "illisible", brut };
}

interface AlimentNormalise {
  readonly alim_code: string;
  readonly name: string;
  readonly grp_code: string;
  readonly grp_nom: string;
  readonly ssgrp_code: string;
  readonly ssgrp_nom: string;
  readonly protein_per_100: number;
  readonly carb_per_100: number;
  readonly fat_per_100: number;
  /** Macros dont la valeur opérationnelle 0 vient d'un « traces » ou d'un « < X ». */
  readonly censures: Readonly<Record<string, string>>;
  /** Énergie Ciqual — AUDIT UNIQUEMENT. N'entre jamais dans food_catalog. */
  readonly energie_ciqual_kcal: number | null;
}

interface Exclusion {
  readonly alim_code: string;
  readonly name: string;
  readonly motif: string;
  readonly macro: string | null;
  readonly brut: string | null;
}

const MACROS = [
  ["protein_per_100", COL.proteines_625, "protéines"],
  ["carb_per_100", COL.glucides, "glucides"],
  ["fat_per_100", COL.lipides, "lipides"],
] as const;

function main(): void {
  const chemin = process.argv[2];
  if (!chemin) {
    console.error(
      "Usage : npx tsx scripts/ciqual/generer-dataset.mts <chemin-du-xlsx-officiel>\n" +
        "Le fichier se télécharge à la main depuis https://ciqual.anses.fr/ (onglet Téléchargement).",
    );
    process.exit(1);
  }

  const octets = readFileSync(chemin);
  const sha256 = createHash("sha256").update(octets).digest("hex");
  const lignes = lireFeuilleXlsx(chemin, FEUILLE);
  const entetes = lignes[0] ?? [];
  verifierEntetes(entetes);

  const corps = lignes.slice(1);
  const alimentsParCode = new Map<string, AlimentNormalise>();
  const exclusions: Exclusion[] = [];
  const compteurs = {
    lignes_source: corps.length,
    valeur: 0,
    traces: 0,
    censure_acceptable: 0,
    censure_trop_haute: 0,
    manquant: 0,
    illisible: 0,
  };

  for (const ligne of corps) {
    const alim_code = (ligne[COL.alim_code] ?? "").trim();
    const name = (ligne[COL.alim_nom] ?? "").trim();
    if (alim_code === "" || name === "") continue;

    const ssgrp_code = (ligne[COL.ssgrp_code] ?? "").trim();

    // ── Exclusion de CATÉGORIE, évaluée en premier ────────────────────────
    // Elle prime sur la lecture des macros : une vodka n'est pas exclue parce
    // qu'il lui manquerait une valeur, mais parce que le 4/4/9 ne sait pas
    // exprimer son énergie.
    if (ssgrp_code === SSGRP_BOISSONS_ALCOOLISEES) {
      exclusions.push({
        alim_code,
        name,
        motif: "boisson_alcoolisee",
        macro: null,
        brut: `alim_ssgrp_code=${ssgrp_code}`,
      });
      continue;
    }

    const lues: Record<string, number> = {};
    const censures: Record<string, string> = {};
    let refus: Exclusion | null = null;

    for (const [champ, colonne, libelle] of MACROS) {
      const lecture = lireTeneur(ligne[colonne] ?? "");
      compteurs[lecture.etat] += 1;
      switch (lecture.etat) {
        case "valeur":
          lues[champ] = lecture.valeur;
          break;
        case "traces":
          lues[champ] = 0;
          censures[champ] = lecture.brut;
          break;
        case "censure_acceptable":
          lues[champ] = 0;
          censures[champ] = lecture.brut;
          break;
        case "censure_trop_haute":
          refus ??= { alim_code, name, motif: "seuil_trop_haut", macro: libelle, brut: lecture.brut };
          break;
        case "manquant":
          refus ??= { alim_code, name, motif: "macro_manquante", macro: libelle, brut: lecture.brut };
          break;
        case "illisible":
          refus ??= { alim_code, name, motif: "valeur_illisible", macro: libelle, brut: lecture.brut };
          break;
      }
    }

    if (refus) {
      exclusions.push(refus);
      continue;
    }

    const energie = lireTeneur(ligne[COL.energie_kcal_ue] ?? "");
    alimentsParCode.set(alim_code, {
      alim_code,
      name,
      grp_code: (ligne[COL.grp_code] ?? "").trim(),
      grp_nom: (ligne[COL.grp_nom] ?? "").trim(),
      ssgrp_code,
      ssgrp_nom: (ligne[COL.ssgrp_nom] ?? "").trim(),
      protein_per_100: lues.protein_per_100,
      carb_per_100: lues.carb_per_100,
      fat_per_100: lues.fat_per_100,
      censures,
      energie_ciqual_kcal: energie.etat === "valeur" ? energie.valeur : null,
    });
  }

  // Un `alim_code` en double rendrait l'import non déterministe : la Map en a
  // gardé un seul, il faut le dire plutôt que de le laisser passer.
  const codesVus = corps
    .map((l) => (l[COL.alim_code] ?? "").trim())
    .filter((c) => c !== "");
  if (new Set(codesVus).size !== codesVus.length) {
    throw new Error("alim_code en double dans la source — import non déterministe, génération arrêtée.");
  }

  // Tri numérique sur `alim_code` : stable, lisible dans un diff, et
  // indépendant de l'ordre des lignes du tableur.
  const aliments = [...alimentsParCode.values()].sort(
    (a, b) => Number(a.alim_code) - Number(b.alim_code) || a.alim_code.localeCompare(b.alim_code),
  );
  exclusions.sort(
    (a, b) => Number(a.alim_code) - Number(b.alim_code) || a.alim_code.localeCompare(b.alim_code),
  );

  // JSONL : une ligne par aliment. Un diff Git montre alors exactement les
  // aliments qui ont changé d'un millésime à l'autre, au lieu d'un bloc unique.
  const jsonlAliments =
    aliments
      .map((a) =>
        JSON.stringify({
          alim_code: a.alim_code,
          name: a.name,
          grp_code: a.grp_code,
          grp_nom: a.grp_nom,
          ssgrp_code: a.ssgrp_code,
          ssgrp_nom: a.ssgrp_nom,
          protein_per_100: a.protein_per_100,
          carb_per_100: a.carb_per_100,
          fat_per_100: a.fat_per_100,
          censures: a.censures,
          energie_ciqual_kcal: a.energie_ciqual_kcal,
        }),
      )
      .join("\n") + "\n";

  const jsonlExclusions =
    exclusions
      .map((e) =>
        JSON.stringify({
          alim_code: e.alim_code,
          name: e.name,
          motif: e.motif,
          macro: e.macro,
          brut: e.brut,
        }),
      )
      .join("\n") + "\n";

  const parMotif: Record<string, number> = {};
  for (const e of exclusions) parMotif[e.motif] = (parMotif[e.motif] ?? 0) + 1;
  const avecCensure = aliments.filter((a) => Object.keys(a.censures).length > 0).length;

  const manifeste = {
    $commentaire: [
      "Provenance et règles de génération du jeu de données Ciqual normalisé.",
      "Régénérer :  npx tsx scripts/ciqual/generer-dataset.mts <xlsx officiel>",
      "La Production ne télécharge JAMAIS Ciqual : elle lit la migration générée.",
    ],
    source: {
      ...SOURCE,
      fichier: basename(chemin),
      sha256_source: sha256,
      octets_source: octets.length,
      feuille: FEUILLE,
    },
    regles: {
      proteines: "const 25003 — Protéines, N x 6.25 (base étiquetage UE), et non le facteur de Jones (25000)",
      glucides: "const 31000 — Glucides (g/100 g), fibres exclues",
      lipides: "const 40000 — Lipides (g/100 g)",
      energie:
        "const 328 — conservée en MÉTADONNÉE d'audit uniquement. food_catalog ne porte aucune kcal : les kcal SETH restent 4×P + 4×G + 9×L.",
      unite: "toutes les teneurs Ciqual sont pour 100 g de partie comestible → nutrition_unit = 'g'",
      identite:
        "source = 'ciqual' (fournisseur, stable) + source_ref = alim_code (objet, stable). Le millésime est source_version = '2025', une PROPRIÉTÉ de la ligne : un réimport 2027 met à jour la même ligne au lieu d'en créer une seconde.",
      traces: "valeur opérationnelle 0, chaîne brute conservée dans `censures`",
      censure_acceptable: `« < X » avec X ≤ ${SEUIL_CENSURE_ACCEPTABLE} g/100 g → valeur opérationnelle 0, chaîne brute conservée`,
      censure_trop_haute: `« < X » avec X > ${SEUIL_CENSURE_ACCEPTABLE} g/100 g sur P, G ou L → aucune valeur inventée, aliment exclu`,
      manquant: "« - » ou vide sur P, G ou L → jamais zéro, aliment exclu",
      alcool: `sous-groupe ${SSGRP_BOISSONS_ALCOOLISEES} « boisson alcoolisées » exclu en entier ; les aliments d'autres groupes contenant un peu d'alcool sont conservés`,
      colonnes: "repérées par POSITION — les « / » des en-têtes sont des retours à la ligne dans le fichier Anses",
    },
    compteurs: {
      lignes_source: compteurs.lignes_source,
      aliments_importables: aliments.length,
      aliments_exclus: exclusions.length,
      exclusions_par_motif: parMotif,
      aliments_avec_valeur_censuree: avecCensure,
      cellules_pgl: {
        valeur: compteurs.valeur,
        traces: compteurs.traces,
        censure_acceptable: compteurs.censure_acceptable,
        censure_trop_haute: compteurs.censure_trop_haute,
        manquant: compteurs.manquant,
        illisible: compteurs.illisible,
      },
    },
    sorties: {
      "aliments.jsonl": {
        lignes: aliments.length,
        sha256: createHash("sha256").update(jsonlAliments).digest("hex"),
        octets: Buffer.byteLength(jsonlAliments),
      },
      "exclusions.jsonl": {
        lignes: exclusions.length,
        sha256: createHash("sha256").update(jsonlExclusions).digest("hex"),
        octets: Buffer.byteLength(jsonlExclusions),
      },
    },
    generateur: "scripts/ciqual/generer-dataset.mts",
  };

  const dossier = "data/ciqual/2025";
  mkdirSync(dossier, { recursive: true });
  writeFileSync(`${dossier}/aliments.jsonl`, jsonlAliments);
  writeFileSync(`${dossier}/exclusions.jsonl`, jsonlExclusions);
  writeFileSync(`${dossier}/manifeste.json`, `${JSON.stringify(manifeste, null, 2)}\n`);

  console.log(`source        ${basename(chemin)}  ${octets.length} o  sha256 ${sha256.slice(0, 16)}…`);
  console.log(`lignes source ${compteurs.lignes_source}`);
  console.log(`importables   ${aliments.length}`);
  console.log(`exclus        ${exclusions.length}  ${JSON.stringify(parMotif)}`);
  console.log(`cellules P/G/L ${JSON.stringify(manifeste.compteurs.cellules_pgl)}`);
  console.log(`aliments avec au moins une valeur censurée : ${avecCensure}`);
}

main();
