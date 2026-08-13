/**
 * GÉNÉRATEUR DE LA MIGRATION DE DONNÉES CIQUAL — hors ligne, déterministe.
 *
 * Lit le jeu normalisé versionné (`data/ciqual/2025/aliments.jsonl`) et écrit
 * la migration SQL qui l'insère dans `food_catalog`.
 *
 *   npx tsx scripts/ciqual/generer-migration.mts
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE MIGRATION PLUTÔT QU'UN SCRIPT D'IMPORT
 * ────────────────────────────────────────────────────────────────────────────
 * Parce que `supabase db push` est déjà le chemin par lequel le schéma arrive
 * en Production, et qu'un second chemin — un script à lancer à la main après
 * le push — finirait un jour par être oublié. Les données arrivent donc par où
 * le schéma arrive.
 *
 * La Production ne lit JAMAIS le XLSX ni le JSONL : elle applique du SQL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI `on conflict … do update` ET PAS `do nothing`
 * ────────────────────────────────────────────────────────────────────────────
 * `do nothing` rendrait le réimport idempotent, mais figerait le catalogue :
 * une future Ciqual ne pourrait jamais corriger une teneur erronée. `do update`
 * met à jour l'aliment — et cela ne touche AUCUN `meal_entry` historique,
 * parce que A1 a fait de chaque entrée un INSTANTANÉ qui ne suit pas sa source.
 * MEAL-A5, A2-DB10 et A3-CIQ14 le prouvent, chacun à son niveau.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const DOSSIER = "data/ciqual/2025";
const CIBLE = "supabase/migrations/20260902090100_ciqual_2025_food_catalog.sql";
/** Lots d'insertion : un INSERT géant ferait une ligne SQL illisible en diff. */
const TAILLE_LOT = 100;

interface Aliment {
  alim_code: string;
  name: string;
  protein_per_100: number;
  carb_per_100: number;
  fat_per_100: number;
}

/** Littéral SQL : on double les apostrophes, et rien d'autre n'est nécessaire. */
function litteral(texte: string): string {
  return `'${texte.replace(/'/g, "''")}'`;
}

/**
 * Un nombre pour SQL. `JSON.stringify` d'un nombre rend la forme la plus
 * courte qui reparse à l'identique — donc pas de notation exponentielle
 * surprise sur les teneurs Ciqual, qui tiennent toutes en trois chiffres
 * significatifs.
 */
function nombre(valeur: number): string {
  if (!Number.isFinite(valeur) || valeur < 0) {
    throw new Error(`Teneur invalide dans le jeu normalisé : ${String(valeur)}`);
  }
  return JSON.stringify(valeur);
}

function main(): void {
  const manifeste = JSON.parse(readFileSync(`${DOSSIER}/manifeste.json`, "utf8")) as {
    source: { cle: string; version_dataset: string; version: string; sha256_source: string; doi: string; attribution: string; publie_le: string; extrait_le: string; fichier: string };
    compteurs: { aliments_importables: number; aliments_exclus: number };
    sorties: Record<string, { sha256: string; lignes: number }>;
  };

  const brut = readFileSync(`${DOSSIER}/aliments.jsonl`, "utf8");
  const empreinte = createHash("sha256").update(brut).digest("hex");
  if (empreinte !== manifeste.sorties["aliments.jsonl"].sha256) {
    throw new Error(
      "aliments.jsonl ne correspond plus à son empreinte au manifeste — " +
        "régénère le jeu avant de régénérer la migration.",
    );
  }

  const aliments = brut
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Aliment);

  if (aliments.length !== manifeste.compteurs.aliments_importables) {
    throw new Error("Nombre d'aliments incohérent avec le manifeste.");
  }

  const lignes: string[] = [];
  lignes.push(`-- ============================================================================
-- Migration 20260902090100 — ALIMENTS A3, PHASE 2B : LA TABLE CIQUAL ${manifeste.source.version.toUpperCase()}.
--
-- ⚠️ FICHIER GÉNÉRÉ. Ne pas modifier à la main.
--    Régénérer :  npx tsx scripts/ciqual/generer-dataset.mts <xlsx officiel>
--                 npx tsx scripts/ciqual/generer-migration.mts
--
-- ────────────────────────────────────────────────────────────────────────────
-- PROVENANCE
-- ────────────────────────────────────────────────────────────────────────────
--   ${manifeste.source.attribution}
--   DOI ${manifeste.source.doi}
--   Licence Ouverte / Open Licence (Etalab) 2.0
--   Publiée le ${manifeste.source.publie_le}, données extraites le ${manifeste.source.extrait_le}
--   Fichier source   ${manifeste.source.fichier}
--   SHA-256 source   ${manifeste.source.sha256_source}
--   SHA-256 du jeu normalisé  ${empreinte}
--
--   ${manifeste.compteurs.aliments_importables} aliments importés,
--   ${manifeste.compteurs.aliments_exclus} exclus (voir data/ciqual/2025/exclusions.jsonl).
--
--   IDENTITÉ    source = '${manifeste.source.cle}' + source_ref = alim_code
--   MILLÉSIME   source_version = '${manifeste.source.version_dataset}'
--   Un réimport d'une future table Ciqual met à jour CES MÊMES lignes : la clé
--   de conflit ne contient pas le millésime, à dessein.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION GARANTIT
-- ────────────────────────────────────────────────────────────────────────────
--   IDEMPOTENCE — la clé est (source, source_ref) = ('ciqual', alim_code),
--   SANS le millésime.
--   Une réexécution met à jour les lignes existantes ; elle n'en crée aucune
--   en double.
--
--   AUCUN INSTANTANÉ TOUCHÉ — mettre à jour un aliment ne modifie AUCUN
--   meal_entry déjà saisi : A1 en a fait des instantanés indépendants de leur
--   source. Une future Ciqual peut donc corriger le catalogue sans réécrire
--   l'histoire alimentaire des élèves.
--
--   AUCUNE CALORIE — food_catalog ne porte que P/G/L. Les kcal SETH restent
--   4×P + 4×G + 9×L, dérivées à la lecture. L'énergie publiée par l'Anses
--   n'entre pas en base : elle vit dans le jeu normalisé, pour l'audit.
--
--   AUCUN PROPRIÉTAIRE — owner_coach_id reste NULL : ces aliments sont le
--   catalogue GLOBAL, lisible par tous les élèves via la policy
--   food_catalog_select_global d'A1, et consommable par la RPC
--   ajouter_aliment_catalogue d'A2 sans aucune adaptation.
-- ============================================================================
`);

  for (let debut = 0; debut < aliments.length; debut += TAILLE_LOT) {
    const lot = aliments.slice(debut, debut + TAILLE_LOT);
    lignes.push(
      "insert into public.food_catalog\n" +
        "  (source, source_ref, source_version, owner_coach_id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, status)\n" +
        "values",
    );
    lignes.push(
      lot
        .map(
          (a) =>
            `  (${litteral(manifeste.source.cle)}, ${litteral(a.alim_code)}, ${litteral(manifeste.source.version_dataset)}, ` +
            `null, ${litteral(a.name)}, 'g', ` +
            `${nombre(a.protein_per_100)}, ${nombre(a.carb_per_100)}, ${nombre(a.fat_per_100)}, 'active')`,
        )
        .join(",\n"),
    );
    // Le SET met à jour `source_version` : c'est ce qui fait basculer la ligne
    // du millésime précédent au nouveau, SANS toucher à son identité ni à son
    // identifiant food_catalog.
    lignes.push(`on conflict (source, source_ref) where source is not null do update
  set source_version  = excluded.source_version,
      name            = excluded.name,
      nutrition_unit  = excluded.nutrition_unit,
      protein_per_100 = excluded.protein_per_100,
      carb_per_100    = excluded.carb_per_100,
      fat_per_100     = excluded.fat_per_100,
      status          = excluded.status;
`);
  }

  // Contrôle d'arrivée, exécuté à chaque application : si le compte ne tombe
  // pas juste, la migration échoue au lieu de laisser une base à moitié
  // peuplée passer pour une base saine.
  lignes.push(`-- ── Contrôle d'arrivée ────────────────────────────────────────────────────
do $$
declare v_compte int;
begin
  select count(*) into v_compte
    from public.food_catalog
   where source = ${litteral(manifeste.source.cle)}
     and source_version = ${litteral(manifeste.source.version_dataset)};
  if v_compte <> ${aliments.length} then
    raise exception 'IMPORT CIQUAL INCOMPLET : % lignes en base, ${aliments.length} attendues', v_compte;
  end if;
end $$;
`);

  const sql = lignes.join("\n");
  writeFileSync(CIBLE, sql);
  console.log(`${CIBLE}`);
  console.log(`  ${aliments.length} aliments · ${Buffer.byteLength(sql)} o · sha256 ${createHash("sha256").update(sql).digest("hex").slice(0, 16)}…`);
}

main();
