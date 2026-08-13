/**
 * Harnais — ALIMENTS A3 PHASE 2 : SCHÉMA SOURCES + TABLE CIQUAL 2025.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Il prouve les FAITS DE FICHIER — provenance, empreintes, déterminisme du jeu
 * normalisé, cohérence entre le manifeste, le jeu et la migration générée — et
 * il vérifie que chacun des seize contrats A3-CIQ est démontré quelque part.
 *
 * Il ne prouve PAS le comportement de PostgreSQL. Qu'un upsert soit réellement
 * idempotent, qu'une contrainte refuse un doublon, qu'un instantané survive à
 * une mise à jour du catalogue : cela s'exécute, et c'est
 * supabase/tests/aliments_a3_ciqual_checklist.sql qui le fait, sur une base
 * reconstruite baseline → toutes les migrations, avec cinq contrôles négatifs.
 *
 * Lancement : npm run test:aliments-a3
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const DOSSIER = "../../data/ciqual/2025";
const MIGRATION_SCHEMA = "20260902090000_food_catalog_sources.sql";
const MIGRATION_DONNEES = "20260902090100_ciqual_2025_food_catalog.sql";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sha256(contenu: string): string {
  return createHash("sha256").update(contenu).digest("hex");
}

/**
 * Retire la PROSE d'un fichier avant d'y chercher un mot interdit.
 *
 * Sans cela, une assertion « le mot X n'apparaît pas » échoue à cause de la
 * phrase même qui énonce la règle : la migration explique qu'elle ne crée
 * « aucune table de produits », et la checklist contient le contrôle
 * `to_regclass('public.food_products') is null` qui PROUVE l'absence. Chercher
 * le mot dans le fichier entier confondrait la règle avec sa violation.
 *
 * Les `comment on … is '…'` sont retirés aussi : ce sont des instructions
 * exécutables, et elles survivent au retrait des « -- ».
 */
function sansProseSql(source: string): string {
  return source
    .replace(/comment on [\s\S]*?is\s+'(?:[^']|'')*';/g, "")
    .replace(/--[^\n]*/g, "");
}
function sansProseTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const manifeste = JSON.parse(lire(`${DOSSIER}/manifeste.json`)) as {
  source: Record<string, string | number>;
  regles: Record<string, string>;
  compteurs: {
    lignes_source: number;
    aliments_importables: number;
    aliments_exclus: number;
    exclusions_par_motif: Record<string, number>;
    aliments_avec_valeur_censuree: number;
    cellules_pgl: Record<string, number>;
  };
  sorties: Record<string, { lignes: number; sha256: string; octets: number }>;
  generateur: string;
};

const alimentsBrut = lire(`${DOSSIER}/aliments.jsonl`);
const exclusionsBrut = lire(`${DOSSIER}/exclusions.jsonl`);
const schema = lire(`../../supabase/migrations/${MIGRATION_SCHEMA}`);
const donnees = lire(`../../supabase/migrations/${MIGRATION_DONNEES}`);
const checklist = lire("../../supabase/tests/aliments_a3_ciqual_checklist.sql");

interface Aliment {
  alim_code: string;
  name: string;
  ssgrp_code: string;
  ssgrp_nom: string;
  protein_per_100: number;
  carb_per_100: number;
  fat_per_100: number;
  censures: Record<string, string>;
  energie_ciqual_kcal: number | null;
}
interface Exclusion {
  alim_code: string;
  name: string;
  motif: string;
  macro: string | null;
  brut: string | null;
}

const aliments = alimentsBrut
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Aliment);
const exclusions = exclusionsBrut
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Exclusion);

/** « Ce contrat est-il démontré par des contrôles EXÉCUTÉS en base ? » */
function couvertParLaChecklist(numero: string, minimum = 1): void {
  const n = checklist.split(`noter('${numero}',`).length - 1;
  assert.ok(
    n >= minimum,
    `${numero} : ${n} contrôle(s) dans la checklist SQL, ${minimum} attendu(s) au minimum`,
  );
}

/* ═══════════════════ A3-CIQ — LES SEIZE CONTRATS ═══════════════════ */

await test("A3-CIQ1. la version, le DOI et l'empreinte de la source sont identifiés", () => {
  // L'identité est SÉPARÉE du millésime : `cle` est le fournisseur, stable,
  // et `version_dataset` le millésime, qui bouge.
  assert.equal(manifeste.source.cle, "ciqual", "la source ne porte PAS le millésime");
  assert.equal(manifeste.source.version_dataset, "2025");
  assert.equal(manifeste.source.version, "Ciqual 2025");
  assert.equal(manifeste.source.editeur, "Anses");
  assert.equal(manifeste.source.doi, "10.57745/RDMHWY");
  assert.equal(manifeste.source.publie_le, "2025-11-19");
  assert.equal(manifeste.source.extrait_le, "2025-11-03");

  // L'empreinte du FICHIER OFFICIEL téléchargé à la main. C'est elle qui rend
  // la provenance vérifiable : un autre XLSX produirait un autre hash, et la
  // régénération ne pourrait plus se prétendre issue de la même source.
  assert.match(String(manifeste.source.sha256_source), /^[0-9a-f]{64}$/);
  assert.equal(
    manifeste.source.sha256_source,
    "d2082938522d909119fbdc8772c028017163650dd81e31d13fdb8a8bd702f32e",
    "le SHA-256 du XLSX officiel Ciqual 2025 (FR, extraction 2025-11-03)",
  );
  assert.equal(manifeste.source.octets_source, 1544342);

  // La licence et l'attribution, au mot près demandé par l'Anses.
  assert.match(String(manifeste.source.licence), /Licence Ouverte.*Etalab.*2\.0/);
  assert.equal(
    manifeste.source.attribution,
    "Anses. 2025. Table de composition nutritionnelle des aliments Ciqual",
  );
  assert.ok(String(manifeste.source.attribution_longue).includes("https://doi.org/10.57745/RDMHWY"));

  // Et la migration livrée porte cette provenance, pour qu'elle voyage avec
  // les données plutôt que de vivre dans un fichier annexe.
  assert.ok(donnees.includes("10.57745/RDMHWY"), "le DOI doit figurer dans la migration");
  assert.ok(
    donnees.includes("Anses. 2025. Table de composition nutritionnelle des aliments Ciqual"),
    "l'attribution doit figurer dans la migration",
  );
  assert.ok(donnees.includes(String(manifeste.source.sha256_source)), "et l'empreinte de la source");
});

await test("A3-CIQ2. le jeu normalisé est déterministe et conforme à son manifeste", () => {
  // Le manifeste porte l'empreinte de CE QU'IL DÉCRIT. Si le jeu était
  // régénéré différemment — ordre instable, horodatage, arrondi flottant — les
  // deux divergeraient immédiatement.
  assert.equal(sha256(alimentsBrut), manifeste.sorties["aliments.jsonl"].sha256);
  assert.equal(sha256(exclusionsBrut), manifeste.sorties["exclusions.jsonl"].sha256);
  assert.equal(aliments.length, manifeste.sorties["aliments.jsonl"].lignes);
  assert.equal(exclusions.length, manifeste.sorties["exclusions.jsonl"].lignes);

  // Tri strictement croissant sur `alim_code` numérique : c'est ce qui rend la
  // sortie indépendante de l'ordre des lignes du tableur.
  for (let i = 1; i < aliments.length; i += 1) {
    assert.ok(
      Number(aliments[i - 1].alim_code) < Number(aliments[i].alim_code),
      `ordre non déterministe entre ${aliments[i - 1].alim_code} et ${aliments[i].alim_code}`,
    );
  }

  // Aucune date de génération n'entre dans les artefacts : seules les dates de
  // la SOURCE y figurent. Une horodatation ferait diverger deux régénérations
  // identiques.
  for (const artefact of [alimentsBrut, exclusionsBrut]) {
    assert.ok(!/20\d\d-\d\d-\d\dT/.test(artefact), "aucun horodatage dans le jeu normalisé");
  }
  assert.ok(!("genere_le" in manifeste.source), "le manifeste ne porte aucune date de génération");

  // Les clés de chaque ligne sont dans un ordre fixe — un objet JSON dont
  // l'ordre des clés varierait produirait des octets différents à contenu égal.
  const clesAttendues = [
    "alim_code", "name", "grp_code", "grp_nom", "ssgrp_code", "ssgrp_nom",
    "protein_per_100", "carb_per_100", "fat_per_100", "censures", "energie_ciqual_kcal",
  ];
  const premiere = JSON.parse(alimentsBrut.split("\n")[0]) as Record<string, unknown>;
  assert.deepEqual(Object.keys(premiere), clesAttendues);
});

await test("A3-CIQ3. l'identifiant Ciqual est conservé tel quel", () => {
  couvertParLaChecklist("A3-CIQ3", 3);
  assert.ok(schema.includes("add column if not exists source_ref text"));
  assert.ok(
    donnees.includes("('ciqual', '13005', '2025', null, 'Banane, chair sans peau, crue'"),
    "la migration doit porter (fournisseur, alim_code, millésime)",
  );
  // Tous les identifiants sont des entiers en TEXTE, jamais castés.
  for (const a of aliments) assert.match(a.alim_code, /^\d+$/);
  assert.equal(new Set(aliments.map((a) => a.alim_code)).size, aliments.length);
});

await test("A3-CIQ4. source et source_ref forment la clé d'un import idempotent", () => {
  couvertParLaChecklist("A3-CIQ4", 9);
  assert.ok(schema.includes("add column if not exists source text"));
  assert.ok(schema.includes("add column if not exists source_version text"));
  assert.ok(schema.includes("check ((source is null) = (source_ref is null))"));

  // Le millésime est obligatoire POUR CIQUAL, et pour Ciqual seulement : une
  // future source pourra n'avoir aucune notion de version.
  assert.ok(
    schema.includes("check (source is distinct from 'ciqual' or source_version is not null)"),
    "la contrainte de millésime doit viser Ciqual, pas toutes les sources",
  );
  assert.ok(
    !/source_version is not null\s*\)\s*;/.test(
      schema.replace("check (source is distinct from 'ciqual' or source_version is not null)", ""),
    ),
    "source_version ne doit pas être rendue globalement obligatoire",
  );
  // L'index est PARTIEL : sans la clause, tous les aliments saisis à la main —
  // qui n'ont pas de source — entreraient en collision.
  assert.ok(
    schema.includes("create unique index if not exists food_catalog_source_unique") &&
      schema.includes("where source is not null"),
    "l'unicité doit être partielle",
  );

  // LE POINT DE LA PHASE 2.1 : l'index porte sur DEUX colonnes. S'il incluait
  // source_version, une table Ciqual 2027 ne serait plus en conflit avec 2025
  // et créerait un doublon — exactement le défaut qu'on corrige.
  const indexUnique = /create unique index if not exists food_catalog_source_unique[\s\S]*?;/.exec(schema)?.[0] ?? "";
  assert.ok(indexUnique.includes("(source, source_ref)"), "l'identité est (source, source_ref)");
  assert.ok(!indexUnique.includes("source_version"), "le millésime ne fait PAS partie de l'identité");
  // Et c'est bien cet index que l'upsert infère.
  assert.ok(donnees.includes("on conflict (source, source_ref) where source is not null do update"));
});

await test("A3-CIQ5. P/G/L viennent des constituants validés", () => {
  couvertParLaChecklist("A3-CIQ5", 4);
  assert.match(manifeste.regles.proteines, /25003.*6\.25/);
  assert.match(manifeste.regles.proteines, /et non le facteur de Jones/);
  assert.match(manifeste.regles.glucides, /31000/);
  assert.match(manifeste.regles.lipides, /40000/);

  // Le contrôle DISCRIMINANT : là où Jones et 6,25 divergent, c'est bien 6,25.
  const soja = aliments.find((a) => a.alim_code === "20903");
  assert.ok(soja, "l'isolat de soja doit être importé");
  assert.equal(soja.protein_per_100, 88.3, "N × 6,25");
  assert.notEqual(soja.protein_per_100, 80.5, "et surtout pas le facteur de Jones");

  // Aucune macro absurde n'a traversé la normalisation.
  for (const a of aliments) {
    for (const champ of ["protein_per_100", "carb_per_100", "fat_per_100"] as const) {
      const v = a[champ];
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 100, `${a.alim_code} · ${champ} = ${v}`);
    }
  }
});

await test("A3-CIQ6. « - » n'est jamais devenu zéro", () => {
  couvertParLaChecklist("A3-CIQ6", 3);
  assert.match(manifeste.regles.manquant, /jamais zéro/);

  const manquantes = exclusions.filter((e) => e.motif === "macro_manquante");
  assert.equal(manquantes.length, manifeste.compteurs.exclusions_par_motif.macro_manquante);
  assert.ok(manquantes.length > 0, "il doit y en avoir, sinon le contrôle ne prouve rien");

  // Chaque exclusion nomme la macro et la valeur brute : le rapport est
  // exploitable par un humain, pas seulement par un test.
  for (const e of manquantes) {
    assert.ok(e.macro !== null, `${e.alim_code} : la macro concernée doit être nommée`);
    assert.equal(e.brut, "-", `${e.alim_code} : la valeur brute doit être conservée`);
  }
  // Et aucune d'elles n'a fini dans le jeu importé.
  const codesImportes = new Set(aliments.map((a) => a.alim_code));
  for (const e of manquantes) assert.ok(!codesImportes.has(e.alim_code));
});

await test("A3-CIQ7. « traces » suit la politique validée", () => {
  couvertParLaChecklist("A3-CIQ7", 2);
  assert.match(manifeste.regles.traces, /valeur opérationnelle 0/);
  assert.match(manifeste.regles.traces, /brute conservée/);

  const avecTraces = aliments.filter((a) =>
    Object.values(a.censures).some((brut) => brut.toLowerCase() === "traces"),
  );
  assert.ok(avecTraces.length > 0, "des aliments à « traces » doivent exister");

  for (const a of avecTraces) {
    for (const [champ, brut] of Object.entries(a.censures)) {
      if (brut.toLowerCase() !== "traces") continue;
      // La valeur opérationnelle est 0…
      assert.equal(a[champ as "protein_per_100"], 0, `${a.alim_code} · ${champ}`);
      // …et la trace de la décision est CONSERVÉE, ce qui la rend auditable.
      assert.equal(brut.toLowerCase(), "traces");
    }
  }
});

await test("A3-CIQ8. « < X » avec X ≤ 0,5 suit la politique validée", () => {
  couvertParLaChecklist("A3-CIQ8", 2);
  assert.match(manifeste.regles.censure_acceptable, /≤ 0\.5|<= 0\.5|≤ 0,5/);

  const censures = aliments.flatMap((a) =>
    Object.entries(a.censures)
      .filter(([, brut]) => brut.startsWith("<"))
      .map(([champ, brut]) => ({ a, champ, brut })),
  );
  assert.ok(censures.length > 0);

  for (const { a, champ, brut } of censures) {
    const seuil = Number(/^<\s*([\d.,]+)$/.exec(brut)![1].replace(",", "."));
    // Un seuil censuré retenu ici est forcément ≤ 0,5 : au-delà, l'aliment
    // aurait été exclu (A3-CIQ9).
    assert.ok(seuil <= 0.5, `${a.alim_code} · ${brut} ne devrait pas être ici`);
    // La valeur opérationnelle est 0, JAMAIS le seuil — qui surestimerait.
    assert.equal(a[champ as "fat_per_100"], 0, `${a.alim_code} · ${champ}`);
    assert.notEqual(a[champ as "fat_per_100"], seuil);
  }

  // Le cas nommé dans l'audit : la banane, dont les lipides valent « < 0,5 ».
  const banane = aliments.find((a) => a.alim_code === "13005");
  assert.equal(banane?.fat_per_100, 0);
  assert.equal(banane?.censures.fat_per_100, "< 0,5");
});

await test("A3-CIQ9. « < X » avec X > 0,5 n'est jamais inventé", () => {
  couvertParLaChecklist("A3-CIQ9", 2);
  assert.match(manifeste.regles.censure_trop_haute, /aucune valeur inventée/);

  const trop = exclusions.filter((e) => e.motif === "seuil_trop_haut");
  assert.equal(trop.length, manifeste.compteurs.exclusions_par_motif.seuil_trop_haut);
  assert.ok(trop.length > 0);

  for (const e of trop) {
    const seuil = Number(/^<\s*([\d.,]+)$/.exec(e.brut ?? "")![1].replace(",", "."));
    assert.ok(seuil > 0.5, `${e.alim_code} : ${e.brut} aurait dû être accepté`);
    assert.ok(e.macro !== null, "la macro concernée doit être nommée dans le rapport");
  }

  // Aucun milieu d'intervalle, aucune valeur de repli : ils sont ABSENTS.
  const codesImportes = new Set(aliments.map((a) => a.alim_code));
  for (const e of trop) assert.ok(!codesImportes.has(e.alim_code));
});

await test("A3-CIQ10. les boissons alcoolisées sont exclues, et elles seules", () => {
  couvertParLaChecklist("A3-CIQ10", 3);
  assert.match(manifeste.regles.alcool, /0603/);

  const alcool = exclusions.filter((e) => e.motif === "boisson_alcoolisee");
  assert.equal(alcool.length, manifeste.compteurs.exclusions_par_motif.boisson_alcoolisee);
  for (const e of alcool) assert.equal(e.brut, "alim_ssgrp_code=0603");

  // AUCUN aliment du sous-groupe 0603 n'a survécu…
  assert.equal(aliments.filter((a) => a.ssgrp_code === "0603").length, 0);

  // …et l'exclusion vise la CATÉGORIE, pas la molécule : les pains, le
  // tiramisu et le baba au rhum, qui contiennent un peu d'alcool mais vivent
  // dans d'autres groupes, restent disponibles.
  const codesImportes = new Set(aliments.map((a) => a.alim_code));
  for (const code of ["19688", "19698", "7111", "7113", "7117"]) {
    assert.ok(codesImportes.has(code), `${code} ne devait PAS être exclu`);
  }
});

await test("A3-CIQ11. « banane » rend un résultat pertinent", () => {
  couvertParLaChecklist("A3-CIQ11", 2);
  const trouves = aliments.filter((a) => a.name.toLowerCase().includes("banane"));
  assert.ok(trouves.length >= 3, `${trouves.length} résultats pour « banane »`);
  assert.ok(trouves.some((a) => a.name === "Banane, chair sans peau, crue"));

  for (const terme of ["riz", "poulet", "saumon", "avocat", "pomme", "oeuf"]) {
    const n = aliments.filter((a) => a.name.toLowerCase().includes(terme)).length;
    assert.ok(n > 0, `« ${terme} » ne rend aucun résultat`);
  }
});

await test("A3-CIQ12. accents et ligature passent la normalisation", () => {
  couvertParLaChecklist("A3-CIQ12", 4);
  // Ciqual écrit « Oeuf » sans ligature : mesuré, zéro Œ dans les 3 330 noms.
  // La ligature est donc éprouvée sur un aliment synthétique, côté base — ce
  // qui fait porter le contrôle sur `food_slug`, et non sur un hasard du
  // référentiel.
  assert.equal(aliments.filter((a) => /[Œœ]/.test(a.name)).length, 0);
  assert.ok(checklist.includes("Œuf entier de caille"), "la ligature est éprouvée en base");
  assert.ok(aliments.some((a) => a.name.startsWith("Oeuf ")), "les œufs Ciqual sont là");
  assert.ok(aliments.some((a) => a.name.startsWith("Pâtes ")), "les pâtes accentuées aussi");

  // Aucun alias fabriqué : mesuré, le slug d'A1 suffit pour les dix termes.
  assert.ok(
    checklist.includes("AUCUN alias heuristique n''a été fabriqué pour Ciqual"),
    "l'absence d'alias doit être éprouvée, pas seulement décidée",
  );
  assert.ok(!donnees.includes("food_aliases"), "la migration de données ne crée aucun alias");
});

await test("A3-CIQ13. un aliment Ciqual s'ajoute par la RPC A2, sans adaptation", () => {
  couvertParLaChecklist("A3-CIQ13", 2);
  // Aucune RPC n'est créée par A3 : un aliment Ciqual est un `catalog_food`
  // global ordinaire, et `ajouter_aliment_catalogue` d'A2 le consomme tel quel.
  for (const migration of [schema, donnees]) {
    assert.ok(
      !/create or replace function/i.test(migration),
      "la phase 2 ne crée AUCUNE fonction : elle réutilise les RPC d'A2",
    );
  }
  assert.ok(checklist.includes("public.ajouter_aliment_catalogue("), "la RPC A2 est éprouvée telle quelle");
});

await test("A3-CIQ14. mettre à jour le catalogue ne touche aucun instantané", () => {
  couvertParLaChecklist("A3-CIQ14", 3);
  // `do update` plutôt que `do nothing` : une future Ciqual doit pouvoir
  // corriger une teneur. Ce qui protège l'histoire, c'est l'instantané d'A1,
  // pas le refus de mettre à jour.
  assert.ok(donnees.includes("do update"), "l'upsert doit mettre à jour");
  // L'indentation du SET a bougé quand `source_version` est devenu la première
  // colonne mise à jour : on vérifie la MISE À JOUR DU NOM, pas sa colonne
  // d'alignement.
  assert.match(donnees, /set source_version\s+= excluded\.source_version,\s*\n\s+name\s+= excluded\.name,/);
  // Et la migration ne touche à AUCUNE table de consommation.
  for (const interdit of ["meal_entries", "consumed_meals", "nutrition_daily_logs"]) {
    assert.ok(!donnees.includes(interdit), `la migration de données ne doit pas nommer ${interdit}`);
  }
});

await test("A3-CIQ15. les kcal consommées restent 4/4/9", () => {
  couvertParLaChecklist("A3-CIQ15", 2);
  assert.match(manifeste.regles.energie, /MÉTADONNÉE d'audit uniquement/);
  assert.match(manifeste.regles.energie, /4×P \+ 4×G \+ 9×L/);

  // L'énergie Ciqual est conservée dans le JEU — pour l'audit — mais elle
  // n'entre PAS en base : la migration ne l'insère nulle part.
  assert.ok(
    aliments.some((a) => a.energie_ciqual_kcal !== null),
    "l'énergie doit être conservée dans le jeu, pour l'audit",
  );
  assert.ok(
    !/energie|energy|kcal|calorie/i.test(
      donnees.split("insert into public.food_catalog")[1]?.split("on conflict")[0] ?? "",
    ),
    "aucune énergie ne doit entrer dans food_catalog",
  );
  // Le mot « kcal » vit légitimement dans les commentaires du schéma, qui
  // expliquent que les calories restent dérivées. C'est le CODE qu'on inspecte.
  const schemaCode = sansProseSql(schema);
  assert.ok(
    !/kcal|calorie|energ/i.test(schemaCode),
    "le schéma n'ajoute aucune colonne d'énergie",
  );
  // Contrôle négatif du dépouillage : la prose, elle, en parle bien — sinon
  // l'assertion ci-dessus passerait sur un fichier vidé.
  assert.ok(/kcal/i.test(schema), "le dépouillage ne doit pas vider le fichier");

  // Et l'écart mesuré à l'audit est réel : sur la banane, l'énergie Ciqual
  // (87,6) n'est pas le 4/4/9 des macros importées (1,06·4 + 19,7·4 + 0·9).
  const banane = aliments.find((a) => a.alim_code === "13005")!;
  const quatreQuatreNeuf = banane.protein_per_100 * 4 + banane.carb_per_100 * 4 + banane.fat_per_100 * 9;
  assert.equal(Number(quatreQuatreNeuf.toFixed(2)), 83.04);
  assert.equal(banane.energie_ciqual_kcal, 87.6);
  assert.notEqual(Number(quatreQuatreNeuf.toFixed(1)), banane.energie_ciqual_kcal);
});

await test("A3-CIQ16. réimporter ne crée aucun doublon", () => {
  couvertParLaChecklist("A3-CIQ16", 10);
  assert.ok(donnees.includes("on conflict (source, source_ref) where source is not null do update"));
  assert.ok(
    donnees.includes("set source_version  = excluded.source_version"),
    "l'upsert doit faire basculer le millésime de la ligne",
  );

  // Le scénario inter-version est éprouvé EN BASE, pas seulement décrit.
  for (const preuve of [
    "2027 : il n''existe toujours qu''UNE SEULE ligne pour cet aliment",
    "et c''est LE MÊME food_catalog.id qu''avant la mise à jour",
    "le millésime est passé à 2027",
    "et la teneur courante est bien la corrigée : 11",
    "l''instantané consommé AVANT vaut toujours 10, pas 11",
  ]) {
    assert.ok(checklist.includes(preuve), `la checklist doit éprouver : ${preuve}`);
  }

  // Le contrôle d'arrivée : la migration refuse de passer si le compte final
  // n'est pas exactement celui attendu.
  assert.ok(donnees.includes("IMPORT CIQUAL INCOMPLET"), "un contrôle d'arrivée doit exister");
  assert.ok(
    donnees.includes(`raise exception 'IMPORT CIQUAL INCOMPLET : % lignes en base, ${aliments.length} attendues'`),
    "et il doit porter le bon nombre",
  );

  // Chaque aliment n'apparaît qu'une fois dans la migration.
  const occurrences = new Map<string, number>();
  for (const m of donnees.matchAll(/\('ciqual', '(\d+)', '2025'/g)) {
    occurrences.set(m[1], (occurrences.get(m[1]) ?? 0) + 1);
  }
  assert.equal(occurrences.size, aliments.length);
  for (const [code, n] of occurrences) assert.equal(n, 1, `${code} apparaît ${n} fois`);
});

/* ═══════════════════ COHÉRENCE ET PÉRIMÈTRE ═══════════════════ */

await test("A3-SUP. les compteurs du manifeste correspondent aux artefacts", () => {
  const c = manifeste.compteurs;
  assert.equal(c.lignes_source, 3484, "lignes du fichier officiel");
  assert.equal(c.aliments_importables, aliments.length);
  assert.equal(c.aliments_exclus, exclusions.length);
  assert.equal(c.lignes_source, c.aliments_importables + c.aliments_exclus);

  const parMotif: Record<string, number> = {};
  for (const e of exclusions) parMotif[e.motif] = (parMotif[e.motif] ?? 0) + 1;
  assert.deepEqual(parMotif, c.exclusions_par_motif);

  const avecCensure = aliments.filter((a) => Object.keys(a.censures).length > 0).length;
  assert.equal(avecCensure, c.aliments_avec_valeur_censuree);

  // Les cellules P/G/L lues : trois par aliment non alcoolisé.
  const cellules = Object.values(c.cellules_pgl).reduce((s, n) => s + n, 0);
  assert.equal(cellules, (c.lignes_source - c.exclusions_par_motif.boisson_alcoolisee) * 3);
  assert.equal(c.cellules_pgl.illisible, 0, "aucune cellule illisible ne doit subsister");
});

await test("A3-SUP. la phase 2 est bien CIQUAL UNIQUEMENT", () => {
  // On inspecte le CODE, jamais la prose : la checklist contient le contrôle
  // `to_regclass('public.food_products') is null`, qui prouve précisément
  // l'absence de la table. Le confondre avec sa présence serait absurde.
  const codeSql = [schema, donnees].map(sansProseSql).join("\n");
  const codeTs = [lire("../ciqual/generer-dataset.mts"), lire("../ciqual/generer-migration.mts")]
    .map(sansProseTs)
    .join("\n");
  const tout = `${codeSql}\n${codeTs}`;
  for (const interdit of [
    "food_products", "openfoodfacts", "search.?a.?licious",
    "gtin", "barcode", "BarcodeDetector", "ZXing", "getUserMedia", "serviceWorker",
  ]) {
    assert.ok(
      !new RegExp(interdit, "i").test(tout),
      `« ${interdit} » est hors périmètre de la phase 2`,
    );
  }
  // La checklist, elle, DOIT nommer food_products — pour prouver son absence.
  assert.ok(
    checklist.includes("to_regclass('public.food_products') is null"),
    "l'absence de food_products doit être éprouvée en base",
  );
  // Aucun appel réseau au moment du build ni de l'exécution : le générateur
  // lit un fichier LOCAL passé en argument, il ne télécharge rien.
  const generateur = lire("../ciqual/generer-dataset.mts");
  for (const interdit of ["fetch(", "https://ciqual.anses.fr/cms/sites", "axios", "got("]) {
    assert.ok(!generateur.includes(interdit), `le générateur ne doit pas contenir « ${interdit} »`);
  }
});

await test("A3-SUP. les migrations A1 et A2 ne sont pas réécrites", () => {
  // A3 pose DEUX migrations neuves, avec de nouveaux horodatages.
  assert.match(MIGRATION_SCHEMA, /^20260902090000_/);
  assert.match(MIGRATION_DONNEES, /^20260902090100_/);
  // Et elles ne touchent ni aux tables ni aux fonctions d'A2.
  assert.ok(!schema.includes("consumed_meals") || schema.includes("-- "), "aucune modification de consumed_meals");
  assert.ok(!/alter table public\.meal_entries/i.test(schema + donnees));
  assert.ok(!/drop (function|policy|table)/i.test(donnees));
});
