/**
 * GÉNÉRATEUR — `lib/nutrition/rayons-ciqual.generated.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE SCRIPT PRODUIT, ET CE QU'IL NE PRODUIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Il produit DEUX FAITS, lus dans le jeu normalisé de l'Anses :
 *
 *   1. `alim_code → ssgrp_code` — le sous-groupe officiel de chaque aliment.
 *   2. les `alim_code` dont le NOM OFFICIEL porte « surgelé(e)(s) ».
 *
 * ⚠️ IL NE PRODUIT AUCUN RAYON. Le passage des sous-groupes de l'Anses aux
 * sept rayons de la liste de courses est un CHOIX, et un choix se relit : il
 * vit dans `RAYON_PAR_SSGRP` (`lib/nutrition/rayons.ts`), à la main, commenté
 * ligne par ligne. Le fichier généré ne doit contenir que ce qui est vérifiable
 * dans le fichier de l'Anses.
 *
 * ⚠️ AUCUN APPEL RÉSEAU, ICI NI EN PRODUCTION. La source est le fichier déjà
 * présent dans le dépôt (`data/ciqual/2025/aliments.jsonl`), lui-même produit
 * par `generer-dataset.mts` depuis le XLSX officiel.
 *
 *   Anses. 2025. Table de composition nutritionnelle des aliments Ciqual
 *   DOI 10.57745/RDMHWY — Licence Ouverte / Open Licence (Etalab) 2.0
 *
 * Régénérer :  npx tsx scripts/ciqual/generer-rayons.mts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const JEU = new URL("../../data/ciqual/2025/aliments.jsonl", import.meta.url);
const MANIFESTE = new URL("../../data/ciqual/2025/manifeste.json", import.meta.url);
const SORTIE = new URL("../../lib/nutrition/rayons-ciqual.generated.ts", import.meta.url);

/**
 * ⚠️ TOKEN ENTIER, PAS UNE SOUS-CHAÎNE : on borne la forme accordée
 * (« surgelé », « surgelée », « surgelés », « surgelées ») par l'absence de
 * lettre de part et d'autre. Sans bornes, un nom composé pourrait matcher par
 * accident ; avec elles, on ne reconnaît que l'état de préparation tel que
 * l'Anses l'écrit.
 *
 * ⚠️ PAS `\b`, ET C'EST UN PIÈGE MESURÉ. `\b` est ASCII : après le « é » final
 * de « surgelé, cru », il n'y a AUCUNE frontière de mot, et la moitié des
 * aliments concernés passaient à travers (45 reconnus au lieu de 71). Les
 * classes `\p{L}` en mode `u` voient les lettres accentuées.
 */
const SURGELE = /(?<!\p{L})surgel[eé]{1,2}s?(?!\p{L})/iu;

interface LigneDuJeu {
  readonly alim_code: string;
  readonly name: string;
  readonly ssgrp_code: string;
}

const brut = readFileSync(JEU, "utf8");
const lignes = brut
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as LigneDuJeu);

if (lignes.length === 0) throw new Error("jeu de données vide : rien à générer");

const ssgrpParCode = new Map<string, string>();
const surgeles: string[] = [];
for (const ligne of lignes) {
  if (ssgrpParCode.has(ligne.alim_code)) {
    throw new Error(`alim_code en double dans le jeu : ${ligne.alim_code}`);
  }
  ssgrpParCode.set(ligne.alim_code, ligne.ssgrp_code);
  if (SURGELE.test(ligne.name)) surgeles.push(ligne.alim_code);
}

const parNumero = (a: string, b: string) => Number(a) - Number(b);
const codes = [...ssgrpParCode.keys()].sort(parNumero);
surgeles.sort(parNumero);

const manifeste = JSON.parse(readFileSync(MANIFESTE, "utf8")) as {
  source: { version: string; doi: string; licence: string; attribution: string };
};
const empreinte = createHash("sha256").update(brut).digest("hex");

const sousGroupes = [...new Set(ssgrpParCode.values())].sort();

const corps = `/**
 * FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN.
 * Régénérer :  npx tsx scripts/ciqual/generer-rayons.mts
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PROVENANCE
 * ────────────────────────────────────────────────────────────────────────────
 *   ${manifeste.source.attribution}
 *   DOI ${manifeste.source.doi}
 *   ${manifeste.source.licence}
 *   Source  data/ciqual/2025/aliments.jsonl
 *   SHA-256 ${empreinte}
 *
 *   ${codes.length} aliments, ${sousGroupes.length} sous-groupes,
 *   ${surgeles.length} aliments dont le nom officiel porte « surgelé ».
 *
 * ⚠️ AUCUN RAYON DANS CE FICHIER. Le passage sous-groupe → rayon est un choix,
 * et il se relit dans \`RAYON_PAR_SSGRP\` (lib/nutrition/rayons.ts). Ici, rien
 * que des faits du fichier de l'Anses.
 */

/** \`alim_code\` (= \`food_catalog.source_ref\`) → \`ssgrp_code\` officiel. */
export const SSGRP_PAR_CODE_CIQUAL: Readonly<Record<string, string>> = {
${codes.map((code) => `  "${code}": "${ssgrpParCode.get(code)!}",`).join("\n")}
};

/**
 * Les aliments dont le NOM OFFICIEL porte « surgelé(e)(s) ».
 *
 * ⚠️ CETTE LISTE PASSE DEVANT LE SOUS-GROUPE : l'Anses classe la framboise
 * surgelée dans « fruits », mais on ne l'achète pas au rayon fruits.
 */
export const SURGELES_CIQUAL: ReadonlySet<string> = new Set([
${surgeles.map((code) => `  "${code}",`).join("\n")}
]);
`;

writeFileSync(SORTIE, corps, "utf8");
console.log(
  `rayons-ciqual.generated.ts : ${codes.length} aliments, ${sousGroupes.length} sous-groupes, ${surgeles.length} surgelés`,
);
console.log(`sous-groupes rencontrés : ${sousGroupes.join(" ")}`);
