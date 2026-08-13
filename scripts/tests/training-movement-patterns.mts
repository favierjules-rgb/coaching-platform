import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ExerciseFeedbackCard } from "../../components/student/ExerciseFeedbackCard";
import { ExerciseSubstitutionPicker } from "../../components/student/ExerciseSubstitutionPicker";
import { workoutFeedbackPayloadSchema } from "../../lib/api/schemas/workout-feedback";
import { matchesExerciseSearch } from "../../lib/admin";
import {
  movementPatternExamples,
  movementPatternLabels,
  movementPatternOrder,
  movementPatternRegions,
  movementPatternRegionLabels,
  movementPatternDisplayLabel,
  movementPatternSelectLabel,
  normalizeMovementPattern,
} from "../../lib/movement-patterns";
import { parseExerciseSubstitutes } from "../../lib/supabase/exercise-substitutes";
import { creerBase } from "./helpers/supabase-double";
import { saveWorkoutFeedback } from "../../lib/supabase/workout-feedback";
import type {
  Exercise,
  ExerciseFeedback,
  ExerciseLibraryItem,
  ExerciseSubstituteOption,
  MovementPattern,
  WorkoutFeedbackPayload,
} from "../../types";

/**
 * F3 — PATTERNS DE MOUVEMENT ET REMPLACEMENT D'EXERCICE
 *
 * CE QUE CETTE SUITE PROUVE
 *   - que le vocabulaire TypeScript et le CHECK SQL sont RIGOUREUSEMENT le
 *     même ensemble : la liste SQL est relue depuis le fichier de migration
 *     et comparée valeur par valeur, dans les deux sens ;
 *   - que l'application n'envoie JAMAIS le nom du remplaçant, seulement son
 *     identifiant, et qu'elle affiche le nom que la BASE a écrit ;
 *   - que la carte d'exercice change le nom et la vidéo, et RIEN d'autre :
 *     séries, répétitions, RPE cible et repos restent ceux de la
 *     prescription ;
 *   - que le schéma strict de la route accepte les deux nouvelles clés et
 *     refuse toujours un `substituteExerciseName` venu du navigateur.
 *
 * CE QU'ELLE NE PEUT PAS PROUVER
 *   Le comportement réel des triggers et de la RPC : c'est le rôle de
 *   `supabase/tests/training_movement_patterns_checklist.sql`, exécuté
 *   contre un vrai PostgreSQL (54 contrôles, quatre acteurs).
 */

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

const MIGRATION = lire("../../supabase/migrations/20260820090000_training_movement_patterns.sql");
/**
 * Le vocabulaire a évolué en TROIS temps, parce que les migrations sont
 * appliquées avant le merge et que la Production servait encore l'ancien
 * frontend pendant la fenêtre de déploiement :
 *   - 20260820 (APPLIQUÉE, IMMUABLE) : les 36 valeurs d'origine ;
 *   - 20260824 (TRANSITION) : 46 valeurs courantes PLUS 4 clés DEPRECATED
 *     encore tolérées, le temps que le nouveau frontend soit servi et que
 *     les fiches restantes soient réétiquetées à la main ;
 *   - 20260825 (NETTOYAGE, état FINAL) : plus que les 46. C'est ELLE qui
 *     fait désormais autorité — c'est son CHECK que la suite compare au
 *     vocabulaire TypeScript.
 * Les trois fichiers coexistent : une migration appliquée ne se réécrit
 * jamais, elle se corrige par une suivante.
 */
const MIGRATION_TRANSITION = lire("../../supabase/migrations/20260824090000_training_movement_patterns_v2.sql");
const MIGRATION_FINALE = lire("../../supabase/migrations/20260825090000_training_movement_patterns_remove_legacy.sql");

/** Les 4 clés retirées du vocabulaire, tolérées seulement pendant la transition. */
const CLÉS_DEPRECATED = ["tirage_horizontal", "flexion_coude", "extension_coude", "charniere_de_hanche"];
const MIGRATION_AUTORITAIRE = lire("../../supabase/migrations/20260821090000_workout_feedback_authoritative.sql");
const MIGRATION_METADONNEES = lire("../../supabase/migrations/20260822090000_workout_feedback_session_metadata.sql");
/**
 * La matrice de propriété vit en tête des migrations qui posent des colonnes
 * sur les trois tables de retour. Elle s'ÉTEND, elle ne se réécrit pas : une
 * migration appliquée est immuable, donc une colonne ajoutée plus tard se
 * classe dans la migration qui l'ajoute. Le contrôle BB1 lit l'ensemble.
 */
const MIGRATION_VIDEO = lire("../../supabase/migrations/20260826090000_student_feedback_video.sql");
const MIGRATION_REPONSE_VIDEO = lire("../../supabase/migrations/20260827090000_coach_reply_video.sql");
const MATRICE = [MIGRATION_AUTORITAIRE, MIGRATION_METADONNEES, MIGRATION_VIDEO, MIGRATION_REPONSE_VIDEO].join("\n");
const COUCHE_ECRITURE = lire("../../lib/supabase/workout-feedback.ts");
const CHECKLIST = lire("../../supabase/tests/training_movement_patterns_checklist.sql");
const CARTE = lire("../../components/student/ExerciseFeedbackCard.tsx");
const SECTION = lire("../../components/student/SessionFeedbackSection.tsx");
const SÉLECTEUR = lire("../../components/student/ExerciseSubstitutionPicker.tsx");
const MODALE_COACH = lire("../../components/admin/FeedbackDetailModal.tsx");
const MODALE_EXERCICE = lire("../../components/admin/ExerciseLibraryItemModal.tsx");
const ROUTE = lire("../../app/api/student/workout-feedback/route.ts");
const TYPES_SUPABASE = lire("../../types/supabase.ts");

/** Retire les commentaires TS pour n'affirmer que sur du code exécutable. */
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}


/* ════════════════════════════════════════════════════════════════════════
 * A. LE VOCABULAIRE — une seule liste, deux langages
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Extrait les valeurs du CHECK `exercise_library_movement_pattern_check`.
 * On découpe sur la région exacte du `array[...]` : la migration contient
 * d'autres littéraux (« active », « a-traiter »…) qu'il ne faut pas ramasser.
 */
/** Valeurs acceptées par le CHECK posé par une migration donnée. */
function valeursDuCheck(sql: string): string[] {
  const début = sql.indexOf("add constraint exercise_library_movement_pattern_check");
  assert.ok(début > 0, "le CHECK est introuvable dans cette migration");
  const ouverture = sql.indexOf("array[", début);
  const fermeture = sql.indexOf("])", ouverture);
  assert.ok(ouverture > 0 && fermeture > ouverture, "bornes du tableau SQL introuvables");
  return [...sql.slice(ouverture, fermeture).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/**
 * Le vocabulaire COURANT : ce que le CHECK FINAL accepte, tel quel. Plus
 * aucun filtrage — la migration de nettoyage a retiré les 4 tolérances, donc
 * ce que porte le fichier EST le vocabulaire. Si une clé DEPRECATED y
 * réapparaissait, A0quater le verrait ; si elle divergeait du TypeScript,
 * A1 le verrait.
 */
function valeursDuCheckSql(): string[] {
  return valeursDuCheck(MIGRATION_FINALE);
}

/** Les 36 valeurs de la version 1, telles qu'appliquées en Production. */
const VOCABULAIRE_V1 = [
  "poussee_horizontale", "poussee_verticale", "tirage_horizontal", "tirage_vertical",
  "elevation_laterale", "elevation_frontale", "elevation_posterieure",
  "rotation_externe_epaule", "rotation_interne_epaule",
  "flexion_coude", "extension_coude", "flexion_poignet", "extension_poignet", "pronosupination",
  "squat", "fente", "charniere_de_hanche", "extension_de_hanche",
  "extension_genou", "flexion_genou", "abduction_hanche", "adduction_hanche", "rotation_hanche",
  "flexion_plantaire", "flexion_dorsale",
  "flexion_tronc", "extension_tronc", "rotation_tronc",
  "anti_extension", "anti_rotation", "anti_flexion_laterale",
  "port_de_charge", "haltero", "pliometrie", "locomotion", "mobilite",
];
await test("A0. la migration APPLIQUÉE (20260820090000) n'a pas été retouchée", () => {
  // Elle a tourné sur le projet distant : son contenu doit rester le reflet
  // exact de ce qui a été exécuté. Faire évoluer le vocabulaire en la
  // réécrivant produirait un fichier qui ment sur l'état réel de la base.
  const début = MIGRATION.indexOf("exercise_library_movement_pattern_check\n      check (");
  assert.ok(début > 0, "le CHECK d'origine est introuvable");
  const région = MIGRATION.slice(MIGRATION.indexOf("array[", début), MIGRATION.indexOf("])", début));
  const v1 = [...région.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...v1].sort(), [...VOCABULAIRE_V1].sort(),
    "20260820090000 doit porter EXACTEMENT les 36 valeurs d'origine");
  assert.ok(MIGRATION.includes("vocabulaire contrôlé de 36"), "son en-tête aussi");
  // Y compris les quatre clés retirées depuis : elles ont réellement existé.
  for (const retirée of ["tirage_horizontal", "flexion_coude", "extension_coude", "charniere_de_hanche"]) {
    assert.ok(v1.includes(retirée), `la version 1 portait ${retirée}`);
  }
});
await test("A0ter. ÉTAT TRANSITOIRE (20260824) : 46 valeurs + les 4 clés DEPRECATED", () => {
  // Cette migration a été appliquée : son contenu est figé, y compris ses
  // quatre tolérances. Ce n'est pas l'état courant de la base — 20260825 les
  // a retirées depuis — mais c'est l'état qu'elle a réellement produit, et
  // le fichier doit continuer à le dire.
  const acceptées = valeursDuCheck(MIGRATION_TRANSITION);
  assert.equal(acceptées.length, 50, "46 courantes + 4 tolérées");
  // Le vocabulaire courant est intégralement là…
  for (const p of movementPatternOrder) {
    assert.ok(acceptées.includes(p), `valeur courante absente du CHECK de transition : ${p}`);
  }
  // …et les 4 anciennes AUSSI. Leur absence serait le bug : PostgreSQL
  // revalide un CHECK sur la ligne entière à chaque UPDATE, donc une fiche
  // portant encore une ancienne clé deviendrait immodifiable par l'ancien
  // frontend pendant la fenêtre de déploiement.
  for (const legacy of CLÉS_DEPRECATED) {
    assert.ok(acceptées.includes(legacy), `clé DEPRECATED absente du CHECK de transition : ${legacy}`);
  }
  // Elles sont signalées comme telles, pas glissées en douce.
  assert.ok(MIGRATION_TRANSITION.includes("DEPRECATED — COMPATIBILITÉ DE DÉPLOIEMENT UNIQUEMENT"));
});

await test("A0quater. ÉTAT FINAL (20260825) : exactement 46 valeurs, aucune clé retirée", () => {
  const acceptées = valeursDuCheck(MIGRATION_FINALE);
  assert.equal(acceptées.length, 46, "le CHECK final ne porte que le vocabulaire");
  assert.equal(new Set(acceptées).size, 46, "doublon dans le CHECK final");
  for (const p of movementPatternOrder) {
    assert.ok(acceptées.includes(p), `valeur courante absente du CHECK final : ${p}`);
  }
  // La tolérance de déploiement est bel et bien refermée. On compare des
  // valeurs EXTRAITES, pas du texte brut : `flexion_coude` est un préfixe de
  // `flexion_coude_anterieur`, et le précheck cite légitimement les 4 clés
  // plus haut dans le fichier — une recherche textuelle mentirait deux fois.
  for (const legacy of CLÉS_DEPRECATED) {
    assert.ok(!acceptées.includes(legacy), `clé retirée encore acceptée : ${legacy}`);
  }
  // La transition, elle, garde sa trace : on ne réécrit pas une migration.
  assert.ok(MIGRATION_TRANSITION.includes("20260825090000_training_movement_patterns_remove_legacy.sql"),
    "la transition doit toujours nommer la migration qui la referme");
});

await test("A0quinquies. le nettoyage ne touche AUCUNE donnée : contrainte, et rien d'autre", () => {
  // On raisonne sur le CODE seul : les commentaires expliquent justement
  // qu'aucune conversion n'est faite, ils ne doivent pas déclencher le test.
  const code = MIGRATION_FINALE.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  for (const verbe of ["update", "delete", "insert", "truncate"]) {
    assert.ok(!new RegExp(`\\b${verbe}\\b`, "i").test(code),
      `la migration de nettoyage ne doit contenir aucun ${verbe.toUpperCase()}`);
  }
  assert.ok(!/set movement_pattern/i.test(code), "aucune valeur ne doit être réécrite");
  assert.ok(!/movement_pattern\s*=\s*null/i.test(code), "aucune valeur ne doit être vidée");
  // Un précheck qui REFUSE, et qui nomme ce qu'il a trouvé.
  assert.ok(MIGRATION_FINALE.includes("MIGRATION REFUSÉE"), "précheck de refus absent");
  assert.ok(/Exemples\s*:/.test(MIGRATION_FINALE), "le refus doit citer des fiches");
  for (const legacy of CLÉS_DEPRECATED) {
    assert.ok(new RegExp(`'${legacy}'`).test(MIGRATION_FINALE),
      `le précheck doit chercher ${legacy}`);
  }
  // Et la promesse est vérifiée par la migration elle-même : empreinte de la
  // colonne avant, empreinte après, échec si quoi que ce soit a bougé.
  assert.ok(code.includes("f3.empreinte_avant") && code.includes("f3.fiches_avant"),
    "la migration doit mesurer son propre effet sur les données");
  assert.ok(code.includes("MIGRATION INVALIDE"), "et refuser de conclure si une valeur a changé");
  // L'ordre : précheck → empreinte → drop → add → contrôle.
  const iPrecheck = MIGRATION_FINALE.indexOf("MIGRATION REFUSÉE");
  const iEmpreinte = MIGRATION_FINALE.indexOf("f3.empreinte_avant");
  const iDrop = MIGRATION_FINALE.indexOf("drop constraint if exists exercise_library_movement_pattern_check");
  const iAdd = MIGRATION_FINALE.indexOf("add constraint exercise_library_movement_pattern_check");
  const iControle = MIGRATION_FINALE.indexOf("MIGRATION INCOMPLÈTE");
  assert.ok(iPrecheck > 0 && iEmpreinte > iPrecheck && iDrop > iEmpreinte && iAdd > iDrop && iControle > iAdd,
    "ordre précheck → empreinte → drop → add → contrôle non respecté");
});

await test("A0sexies. transition et état final ne diffèrent QUE des 4 tolérances", () => {
  // La transition doit être un sur-ensemble STRICT du final : rien n'a été
  // ajouté ni perdu en chemin, seules les 4 clés de compatibilité tombent.
  const transition = valeursDuCheck(MIGRATION_TRANSITION);
  const finale = valeursDuCheck(MIGRATION_FINALE);
  const enTrop = transition.filter((v) => !finale.includes(v));
  const perdues = finale.filter((v) => !transition.includes(v));
  assert.deepEqual([...enTrop].sort(), [...CLÉS_DEPRECATED].sort(),
    "la seule différence doit être les 4 clés DEPRECATED");
  assert.deepEqual(perdues, [], "le nettoyage n'a le droit d'ajouter aucune valeur");
});

await test("A0bis. la migration corrective ne convertit AUCUNE donnée d'office", () => {
  const sql = MIGRATION_TRANSITION;
  // Un précheck qui refuse, et DEUX mappings nommément validés — pas un de plus.
  assert.ok(sql.includes("MIGRATION REFUSÉE"), "précheck de refus absent");
  assert.equal([...sql.matchAll(/^  update public\.exercise_library$/gm)].length, 2,
    "exactement deux mappings, ceux qui ont été validés");
  assert.ok(sql.includes("set movement_pattern = 'tirage_horizontal_coudes_ouverts'"));
  assert.ok(sql.includes("set movement_pattern = 'hinge'\n   where movement_pattern = 'charniere_de_hanche';"));
  // NI `flexion_coude` NI `extension_coude` ne sont convertis : l'ambiguïté
  // antérieur/postérieur n'appartient qu'au coach, qui réétiquette lui-même.
  for (const clé of ["flexion_coude", "extension_coude"]) {
    assert.ok(!new RegExp(`where movement_pattern = '${clé}'`).test(sql),
      `${clé} ne doit être converti par aucune règle automatique`);
  }
  // AUCUNE valeur n'est mise à NULL : tant que la clé DEPRECATED est
  // acceptée, la fiche garde la trace de ce qu'elle était.
  assert.ok(!/set movement_pattern = null/i.test(sql),
    "cette migration ne doit vider aucun pattern");
  // Rien n'est jamais supprimé.
  assert.ok(!/delete\s+from/i.test(sql), "aucune suppression de ligne");
  // Et la contrainte tombe AVANT le remappage, sinon la nouvelle valeur
  // violerait l'ancien CHECK.
  const iDrop = sql.indexOf("drop constraint if exists exercise_library_movement_pattern_check");
  const iMap = sql.indexOf("set movement_pattern = 'tirage_horizontal_coudes_ouverts'");
  const iAdd = sql.indexOf("add constraint exercise_library_movement_pattern_check");
  assert.ok(iDrop > 0 && iMap > iDrop && iAdd > iMap, "ordre drop → remappage → add non respecté");
});


await test("A1. le CHECK SQL et movementPatternOrder sont le MÊME ensemble", () => {
  const sql = valeursDuCheckSql();
  const ts = [...movementPatternOrder];
  assert.deepEqual(
    [...sql].sort(),
    [...ts].sort(),
    `divergence SQL/TS — seulement en SQL : ${sql.filter((v) => !ts.includes(v as MovementPattern))} / seulement en TS : ${ts.filter((v) => !sql.includes(v))}`,
  );
});

await test("A2. 46 valeurs, aucun doublon, aucune valeur vide", () => {
  assert.equal(movementPatternOrder.length, 46);
  assert.equal(new Set(movementPatternOrder).size, 46, "doublon dans le vocabulaire");
  assert.equal(valeursDuCheckSql().length, 46, "le CHECK SQL n'a pas 46 valeurs");
  for (const p of movementPatternOrder) {
    assert.match(p, /^[a-z][a-z_]*[a-z]$/, `clé mal formée : ${p}`);
  }
});

await test("A3. chaque pattern a un libellé, une région et un exemple — aucun trou", () => {
  for (const p of movementPatternOrder) {
    assert.ok(movementPatternLabels[p]?.trim(), `libellé manquant : ${p}`);
    assert.ok(movementPatternRegions[p], `région manquante : ${p}`);
    assert.ok(movementPatternRegionLabels[movementPatternRegions[p]]?.trim(), `libellé de région manquant : ${p}`);
    assert.ok(movementPatternExamples[p]?.trim(), `exemple manquant : ${p}`);
  }
  // Et rien en trop : les tables ne portent QUE le vocabulaire.
  assert.deepEqual(Object.keys(movementPatternLabels).sort(), [...movementPatternOrder].sort());
  assert.deepEqual(Object.keys(movementPatternExamples).sort(), [...movementPatternOrder].sort());
  assert.deepEqual(Object.keys(movementPatternRegions).sort(), [...movementPatternOrder].sort());
});

await test("A4. toutes les articulations demandées sont couvertes", () => {
  // La demande était explicite : « liste de tous les mouvements possibles
  // pour toutes les articulations ». On vérifie qu'aucune région n'est vide.
  for (const région of Object.keys(movementPatternRegionLabels)) {
    const membres = movementPatternOrder.filter((p) => movementPatternRegions[p] === région);
    assert.ok(membres.length > 0, `région sans aucun pattern : ${région}`);
  }
  // Les deux exemples cités par l'utilisateur existent bien.
  assert.ok(movementPatternOrder.includes("elevation_laterale"), "« élévation » absente");
  assert.ok(movementPatternOrder.includes("hinge"), "« hinge » absent");

  // AUCUN DOUBLON SÉMANTIQUE. Deux entrées pour le même mouvement seraient
  // pires que pas de pattern du tout : deux exercices identiques ne se
  // proposeraient jamais l'un l'autre. « Charnière de hanche » a été retiré
  // au profit de « Hinge », qui désigne exactement la même chose.
  assert.ok(
    !(movementPatternOrder as readonly string[]).includes("charniere_de_hanche"),
    "« charniere_de_hanche » et « hinge » sont le même mouvement : une seule entrée",
  );
  // Les découpages fins doivent rester des mouvements DISTINCTS, jamais des
  // synonymes : on vérifie que chaque libellé est unique.
  const libellés = movementPatternOrder.map((p) => movementPatternLabels[p]);
  assert.equal(new Set(libellés).size, libellés.length, "deux patterns portent le même libellé");
});

await test("A5. normalizeMovementPattern refuse tout ce qui n'est pas du vocabulaire", () => {
  assert.equal(normalizeMovementPattern("squat"), "squat");
  assert.equal(normalizeMovementPattern("  squat  "), "squat");
  assert.equal(normalizeMovementPattern(""), null);
  assert.equal(normalizeMovementPattern("   "), null);
  assert.equal(normalizeMovementPattern(null), null);
  assert.equal(normalizeMovementPattern(undefined), null);
  assert.equal(normalizeMovementPattern("hinge"), "hinge");
  // Une clé RETIRÉE du vocabulaire doit être refusée, pas tolérée en douce :
  // « charniere_de_hanche » a été fusionnée dans « hinge ».
  assert.equal(normalizeMovementPattern("charniere_de_hanche"), null, "clé retirée du vocabulaire");
  assert.equal(normalizeMovementPattern("tirage_horizontal"), null, "clé scindée en coudes ouverts/fermés");
  assert.equal(normalizeMovementPattern("flexion_coude"), null, "clé scindée en antérieur/postérieur");
  assert.equal(normalizeMovementPattern("SQUAT"), null, "la casse n'est pas normalisée : c'est une clé, pas du texte");
  assert.equal(normalizeMovementPattern(42 as unknown as string), null);
});

await test("A6. les libellés d'affichage sont honnêtes, y compris sans pattern", () => {
  assert.equal(movementPatternDisplayLabel("hinge"), "Hinge");
  assert.equal(movementPatternDisplayLabel(null), "Pattern non renseigné");
  assert.equal(movementPatternSelectLabel("hinge"), "Hanche / genou · Hinge");
  assert.equal(movementPatternSelectLabel("poussee_horizontale"), "Haut du corps · Poussée horizontale");
  assert.equal(movementPatternSelectLabel("tirage_horizontal_coudes_fermes"), "Haut du corps · Tirage horizontal coudes fermés");
  assert.equal(movementPatternSelectLabel("flexion_coude_anterieur"), "Coude / poignet · Flexion de coude antérieur");
});


/* ════════════════════════════════════════════════════════════════════════
 * B. LA MIGRATION — additive, idempotente, verrouillée
 * ════════════════════════════════════════════════════════════════════════ */

await test("B1. la migration est strictement additive : aucun DROP de table, colonne ou policy", () => {
  const sql = MIGRATION.toLowerCase();
  assert.ok(!/drop\s+table/.test(sql), "drop table interdit");
  assert.ok(!/drop\s+column/.test(sql), "drop column interdit");
  assert.ok(!/drop\s+policy/.test(sql), "drop policy interdit");
  assert.ok(!/alter\s+policy/.test(sql), "alter policy interdit");
  // Les seuls DROP tolérés sont ceux qui rendent la migration rejouable.
  const drops = [...sql.matchAll(/^\s*drop\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(drops)], ["trigger"], `DROP inattendu : ${drops}`);
});

await test("B2. idempotente : rejouable sans effet", () => {
  assert.ok(MIGRATION.includes("add column if not exists movement_pattern"));
  assert.ok(MIGRATION.includes("add column if not exists substitute_exercise_library_id"));
  assert.ok(MIGRATION.includes("add column if not exists substitute_exercise_name"));
  assert.equal([...MIGRATION.matchAll(/create index if not exists/g)].length, 2);
  // Contraintes : posées sous garde `if not exists (select 1 from pg_constraint …)`.
  for (const c of [
    "exercise_library_movement_pattern_check",
    "exercise_feedback_substitute_shape_check",
    "exercise_feedback_substitute_exercise_library_id_fkey",
  ]) {
    assert.ok(
      MIGRATION.includes(`where conname = '${c}'`),
      `contrainte posée sans garde d'idempotence : ${c}`,
    );
  }
});

await test("B3. la colonne du pattern est NULLABLE — la banque existante reste valide", () => {
  // Aucun `not null`, aucun `default` : une migration qui imposerait un
  // pattern casserait toutes les fiches déjà créées.
  const région = MIGRATION.slice(
    MIGRATION.indexOf("alter table public.exercise_library"),
    MIGRATION.indexOf("comment on column public.exercise_library.movement_pattern"),
  );
  assert.ok(!/not null/i.test(région), "la colonne ne doit pas être NOT NULL");
  assert.ok(!/default/i.test(région), "la colonne ne doit pas avoir de défaut");
});

await test("B4. la trace du remplacement survit à la suppression de la fiche de banque", () => {
  assert.ok(
    MIGRATION.includes("references public.exercise_library (id) on delete set null"),
    "le FK doit être ON DELETE SET NULL, jamais CASCADE : supprimer une fiche ne doit pas effacer l'histoire",
  );
  assert.ok(!/on delete cascade/i.test(MIGRATION), "aucun CASCADE dans cette migration");
  // La contrainte de forme est à SENS UNIQUE : un identifiant impose un nom,
  // un nom seul reste légitime (fiche supprimée depuis).
  assert.ok(
    MIGRATION.includes("substitute_exercise_library_id is null\n        or (substitute_exercise_name is not null"),
    "la contrainte de forme doit tolérer « nom sans identifiant »",
  );
});

await test("B5. les trois fonctions sont durcies comme le veut le dépôt", () => {
  // search_path figé sur les trois.
  assert.equal([...MIGRATION.matchAll(/^set search_path = ''$/gm)].length, 3, "search_path vide sur les trois fonctions");
  // Deux gardes SECURITY DEFINER (autoritaires) + une lecture INVOKER (RLS).
  assert.equal([...MIGRATION.matchAll(/^security definer$/gm)].length, 2);
  assert.equal([...MIGRATION.matchAll(/^security invoker$/gm)].length, 1);
  // Propriété postgres.
  assert.equal([...MIGRATION.matchAll(/^alter function public\.\w+\([^)]*\) owner to postgres;$/gm)].length, 3);
  // Les deux fonctions de trigger ne sont appelables par personne.
  for (const f of ["enforce_exercise_feedback_substitution", "protect_workout_feedback_coach_columns"]) {
    assert.ok(MIGRATION.includes(`revoke all on function public.${f}() from public;`), `revoke public manquant : ${f}`);
    assert.ok(MIGRATION.includes(`revoke execute on function public.${f}() from anon;`), `revoke anon manquant : ${f}`);
    assert.ok(MIGRATION.includes(`revoke execute on function public.${f}() from authenticated;`), `revoke authenticated manquant : ${f}`);
  }
  // La RPC de lecture, elle, doit être accordée à authenticated et à personne d'autre.
  assert.ok(MIGRATION.includes("revoke execute on function public.list_exercise_substitutes(uuid) from anon;"));
  assert.ok(MIGRATION.includes("grant execute on function public.list_exercise_substitutes(uuid) to authenticated;"));
  assert.ok(
    !/grant execute on function public\.list_exercise_substitutes\(uuid\) to [^;]*anon/.test(MIGRATION),
    "anon ne doit jamais recevoir cette RPC",
  );
});

await test("B6. les deux triggers sont BEFORE, et le contrôle final existe", () => {
  assert.ok(MIGRATION.includes("before insert or update on public.exercise_feedback"));
  assert.ok(MIGRATION.includes("before insert or update on public.workout_feedback"));
  assert.ok(MIGRATION.includes("MIGRATION INCOMPLÈTE"), "la migration doit se relire elle-même");
  // Le contrôle final vérifie AUSSI les privilèges, pas seulement l'existence.
  assert.ok(MIGRATION.includes("has_function_privilege('authenticated', 'public.enforce_exercise_feedback_substitution()', 'execute')"));
  assert.ok(MIGRATION.includes("has_function_privilege('anon', 'public.list_exercise_substitutes(uuid)', 'execute')"));
});

await test("B7. aucune migration déjà appliquée n'est touchée", () => {
  const fichiers = readdirSync(new URL("../../supabase/migrations", import.meta.url).pathname)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(fichiers.length, 72, "72 migrations attendues depuis ALIMENTS A5");
  // On ancre sur la migration qui PRÉCÈDE le chantier plutôt que sur la fin
  // du dossier : ce qui doit rester vrai, c'est que les six migrations F3 se
  // suivent sans rien d'intercalé — pas qu'elles soient les dernières. Un
  // chantier suivant (F4…) ne doit pas faire échouer un test de F3.
  const départ = fichiers.indexOf("20260819090000_nutrition_recipe_images.sql");
  assert.ok(départ >= 0, "la migration des images de recettes a disparu");
  assert.deepEqual(
    fichiers.slice(départ, départ + 7),
    [
      "20260819090000_nutrition_recipe_images.sql",
      "20260820090000_training_movement_patterns.sql",
      "20260821090000_workout_feedback_authoritative.sql",
      "20260822090000_workout_feedback_session_metadata.sql",
      "20260823090000_workout_feedback_unique_session.sql",
      "20260824090000_training_movement_patterns_v2.sql",
      "20260825090000_training_movement_patterns_remove_legacy.sql",
    ],
    "les six migrations du chantier viennent APRÈS celle des images, sans rien intercaler",
  );

  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  // 35 depuis 20260828090000_web_push_notifications.sql (socle Web Push).
  assert.equal(attendues.length, 45);
  assert.ok(attendues.includes("20260820090000_training_movement_patterns.sql"), "manifeste non mis à jour");
  assert.ok(attendues.includes("20260821090000_workout_feedback_authoritative.sql"), "manifeste non mis à jour");
  assert.ok(attendues.includes("20260822090000_workout_feedback_session_metadata.sql"), "manifeste non mis à jour");
  assert.ok(attendues.includes("20260823090000_workout_feedback_unique_session.sql"), "manifeste non mis à jour");
  assert.ok(attendues.includes("20260824090000_training_movement_patterns_v2.sql"), "manifeste non mis à jour");
  assert.ok(attendues.includes("20260825090000_training_movement_patterns_remove_legacy.sql"), "manifeste non mis à jour");
  assert.deepEqual(
    [...attendues].sort(),
    fichiers.filter((f) => f >= "20260724214500"),
    "le manifeste et le dossier divergent",
  );
});

await test("B8. la faille visée est nommée et corrigée : status et coach_reply", () => {
  const sql = MIGRATION;
  assert.ok(sql.includes("new.status := old.status;"), "status non restauré");
  assert.ok(sql.includes("new.coach_reply := old.coach_reply;"), "coach_reply non restauré");
  // À l'INSERT aussi : un retour ne naît jamais « traité ».
  assert.ok(sql.includes("new.status := 'a-traiter';"));
  assert.ok(sql.includes("new.coach_reply := '';"));
  // Le staff et les contextes service passent au travers, sinon le coach ne
  // pourrait plus répondre.
  assert.ok(sql.includes("if public.is_coach_or_admin() then\n    return new;"));
  assert.ok(sql.includes("coalesce(auth.role(), '') = 'service_role'"));
});

await test("B9. la checklist SQL couvre les trois questions posées", () => {
  for (const marqueur of [
    "B1. la colonne movement_pattern existe",
    "B4bis. « charniere_de_hanche » (fusionnée dans « hinge ») est REFUSÉE",
    "B4quater. « flexion_coude » (scindée antérieur/postérieur) est REFUSÉE",
    "B4sexies. aucune fiche legacy n''a survécu au refus",
    "B4septies. le CHECK en base ne mentionne plus aucune clé retirée",
    "C1. l''élève obtient 2 remplaçants",
    "C7. un UUID inexistant ne rend AUCUNE ligne",
    "C9. la banque est GLOBALE",
    "D1. le snapshot fourni par l''élève est IGNORÉ",
    "D5. identique à build_prescribed_snapshot()",
    "D8. l''élève A ne peut pas créer un retour sur la séance de B",
    "E0. le harnais détecte bien une colonne NON protégée",
    "E1. workout_feedback.status",
    "E2. workout_feedback.coach_reply",
    "E3. workout_feedback.session_status",
    "E11. workout_feedback.prescribed_snapshot",
    "F1. le nom du remplaçant est DÉRIVÉ",
    "F3bis. le nom PRESCRIT est dérivé de l''exercice de séance",
    "F3quater. le contrat cardio",
    "G11. aucune ligne écrite par les dix tentatives",
    "H3b. mais le NOM réalisé survit",
    "I3. l''élève B ne peut pas GREFFER une ligne d''exercice sur le retour de A",
    "J2. le coach marque « traité » et répond",
    "J5. même le coach ne peut pas réécrire le snapshot",
    "M1. program_id est DÉRIVÉ de la séance",
    "M3. session_key falsifiée : dérivée de session_id",
    "M4. session_ref_label falsifié : dérivé du nom réel",
    "M5. aucun des trois ne se réécrit après création",
    "M8. sans session_id, les trois champs restent libres",
    "M9b. aucun écart session_id ↔ program_id/session_key",
    "K3. list_exercise_substitutes",
  ]) {
    assert.ok(CHECKLIST.includes(marqueur), `contrôle absent de la checklist : ${marqueur}`);
  }
  // La leçon d'E.1 : on mesure la VALEUR, pas le nombre de lignes.
  assert.ok(CHECKLIST.includes("On mesure la VALEUR, jamais le nombre de lignes"));
  // Et le harnais se prouve capable de DÉTECTER une colonne non protégée :
  // sans cet auto-contrôle, vingt « inchangé » ne vaudraient rien.
  assert.ok(CHECKLIST.includes("auto-contrôle"));
  // Et un verdict NULL est un échec, jamais un succès silencieux.
  assert.ok(CHECKLIST.includes("coalesce(p_ok, false)"), "un verdict NULL doit compter comme un échec");
  assert.ok(CHECKLIST.includes("rollback;"), "la checklist ne doit rien laisser derrière elle");
});


/* ════════════════════════════════════════════════════════════════════════
 * B-bis. LE RETOUR DE SÉANCE SERVEUR-AUTORITAIRE (migration 20260821090000)
 * ════════════════════════════════════════════════════════════════════════ */

/** Colonnes réellement déclarées pour une table dans types/supabase.ts. */
function colonnesDe(table: string, suivante: string): string[] {
  const bloc = TYPES_SUPABASE.slice(
    TYPES_SUPABASE.indexOf(`${table}: {`),
    TYPES_SUPABASE.indexOf(`${suivante}: {`),
  );
  const rows = bloc.slice(bloc.indexOf("Row: {"), bloc.indexOf("Insert: {"));
  return [...rows.matchAll(/^\s{10}([a-z_]+)\??:/gm)].map((m) => m[1]);
}

await test("BB1. l'inventaire des colonnes est COMPLET — aucune n'échappe au classement", () => {
  // La matrice de propriété vit en tête de la migration. Ce contrôle est ce
  // qui l'empêche de vieillir : ajouter demain une colonne à l'une des trois
  // tables sans la classer fera échouer cette suite.
  const tables: [string, string][] = [
    ["exercise_feedback", "exercise_library"],
    ["exercise_set_feedback", "exercise_tags"],
    ["workout_feedback", "workout_sessions"],
  ];
  for (const [table, suivante] of tables) {
    const colonnes = colonnesDe(table, suivante);
    assert.ok(colonnes.length >= 8, `lecture des colonnes de ${table} échouée (${colonnes.length})`);
    for (const colonne of colonnes) {
      assert.ok(
        new RegExp(`^--\\s+${colonne}\\s`, "m").test(MATRICE),
        `colonne non classée dans la matrice de propriété : ${table}.${colonne}`,
      );
    }
  }
});

await test("BB2. le snapshot est RECALCULÉ par la base, pour tout le monde", () => {
  const sql = MIGRATION_AUTORITAIRE;
  // La valeur reçue n'est jamais lue : l'affectation est inconditionnelle.
  assert.ok(sql.includes("new.prescribed_snapshot := case"), "le snapshot doit être réaffecté");
  assert.ok(sql.includes("build_prescribed_snapshot(new.session_id)"), "depuis la prescription réelle");
  // Aucune exemption : ni staff, ni service_role ne peuvent en fabriquer un.
  const corps = sql.slice(sql.indexOf("create or replace function public.enforce_workout_feedback_write"));
  const iSnapshot = corps.indexOf("new.prescribed_snapshot := case");
  const iExemption = corps.indexOf("if v_systeme or v_staff then");
  assert.ok(iSnapshot > 0 && iExemption > iSnapshot,
    "le snapshot doit être posé AVANT toute sortie anticipée du staff");
});

await test("BB3. la séance visée doit appartenir à l'élève, vérifié en base", () => {
  assert.ok(MIGRATION_AUTORITAIRE.includes("student_owns_workout_session(new.student_id, new.session_id)"));
  assert.ok(MIGRATION_AUTORITAIRE.includes("owner_student_id = p_student_id"), "programme possédé");
  assert.ok(MIGRATION_AUTORITAIRE.includes("a.content_type = 'programme'"), "programme assigné");
});

await test("BB3bis. le nom PRESCRIT d'une ligne d'exercice est dérivé, pas reçu", () => {
  const sql = MIGRATION_AUTORITAIRE;
  assert.ok(sql.includes("new.exercise_name := v_src_name;"),
    "le nom prescrit doit venir de workout_exercises, pas du navigateur");
  assert.ok(sql.includes("new.exercise_name := old.exercise_name;"),
    "et rester figé après création — c'est une photographie");
  // Le contrat cardio, qui n'a pas d'exercise_id, garde son libellé libre :
  // il n'existe aucune ligne de prescription d'où le tirer.
  assert.ok(sql.includes("if new.exercise_id is not null then"),
    "la dérivation ne s'applique QUE quand l'exercice prescrit est identifié");
});

await test("BB4. cohérence parent/enfant : la faille de greffe est fermée", () => {
  const sql = MIGRATION_AUTORITAIRE;
  assert.ok(sql.includes("v_parent_student_id <> new.student_id"),
    "exercise_feedback doit refuser un parent d'un autre élève");
  assert.ok(sql.includes("Série refusée : la ligne d''exercice parente appartient à un autre élève"),
    "exercise_set_feedback aussi");
});

await test("BB5. les colonnes FK figées peuvent tout de même DISPARAÎTRE (on delete set null)", () => {
  // Les figer aveuglément casserait la suppression d'une séance par le coach.
  assert.ok(
    MIGRATION_AUTORITAIRE.includes("if new.session_id is distinct from old.session_id and new.session_id is not null then"),
    "session_id doit pouvoir passer à NULL par cascade",
  );
  assert.ok(
    MIGRATION_AUTORITAIRE.includes("if new.program_id is distinct from old.program_id and new.program_id is not null then"),
    "program_id aussi",
  );
});

await test("BB6. les cinq fonctions sont durcies, et les gardiens partiels remplacés", () => {
  const sql = MIGRATION_AUTORITAIRE;
  assert.equal([...sql.matchAll(/^set search_path = ''$/gm)].length, 5, "search_path figé sur les cinq");
  assert.equal([...sql.matchAll(/^security definer$/gm)].length, 5, "toutes autoritaires");
  assert.equal([...sql.matchAll(/^alter function public\.\w+\([^)]*\) owner to postgres;$/gm)].length, 5);
  for (const f of ["enforce_workout_feedback_write", "enforce_exercise_feedback_write", "enforce_exercise_set_feedback_write"]) {
    assert.ok(sql.includes(`revoke execute on function public.${f}() from authenticated;`), `revoke manquant : ${f}`);
  }
  // Les deux gardiens de la migration précédente sont REMPLACÉS, pas empilés.
  assert.ok(sql.includes("drop function if exists public.protect_workout_feedback_coach_columns();"));
  assert.ok(sql.includes("drop function if exists public.enforce_exercise_feedback_substitution();"));
  assert.ok(sql.includes("MIGRATION INCOMPLÈTE"), "la migration se relit elle-même");
  assert.ok(!/drop\s+(table|column|policy)/i.test(sql), "strictement additive");
});

await test("BB7. la couche d'écriture n'écrit plus AUCUNE colonne dérivée ou réservée", () => {
  const couche = sansCommentairesTs(COUCHE_ECRITURE);
  // On borne au CORPS de saveWorkoutFeedback : plus bas, les fonctions du
  // COACH (updateWorkoutFeedbackStatus, updateWorkoutFeedbackCoachReply)
  // écrivent légitimement status et coach_reply — c'est leur métier.
  const corps = couche.slice(
    couche.indexOf("export async function saveWorkoutFeedback"),
    couche.indexOf("export async function updateWorkoutFeedbackStatus"),
  );
  assert.ok(corps.length > 500, "borne du corps de saveWorkoutFeedback introuvable");

  // On n'affirme pas sur le texte entier — `let status: FeedbackStatus` ou
  // `.select("id, status, …")` sont des LECTURES parfaitement légitimes. On
  // extrait les CHARGES UTILES réellement envoyées : le contenu de chaque
  // `.insert({…})` et `.update({…})`, par comptage d'accolades.
  const charges: string[] = [];
  for (const appel of [".insert(", ".update("]) {
    let i = corps.indexOf(appel);
    while (i >= 0) {
      const ouverture = corps.indexOf("{", i);
      if (ouverture > 0) {
        let profondeur = 0;
        let j = ouverture;
        for (; j < corps.length; j += 1) {
          if (corps[j] === "{") profondeur += 1;
          else if (corps[j] === "}") {
            profondeur -= 1;
            if (profondeur === 0) break;
          }
        }
        charges.push(corps.slice(ouverture, j + 1));
      }
      i = corps.indexOf(appel, i + 1);
    }
  }
  assert.ok(charges.length >= 3, `charges utiles introuvables (${charges.length})`);
  for (const colonne of ["prescribed_snapshot", "session_status", "submitted_at", "status", "coach_reply"]) {
    for (const charge of charges) {
      assert.ok(
        !new RegExp(`\\b${colonne}\\s*:`).test(charge),
        `la couche d'écriture ne doit plus poser ${colonne} — trouvé dans : ${charge.slice(0, 120)}`,
      );
    }
  }
  // Et elle ne construit même plus de snapshot : plus d'autorité fantôme.
  assert.ok(!/buildPrescribedSnapshot|loadSessionRowsForSnapshot/.test(couche));
  // Le coach, lui, garde ses deux écritures — la protection ne l'a pas amputé.
  assert.ok(/\.update\(\{ status, updated_at/.test(couche), "updateWorkoutFeedbackStatus intact");
  assert.ok(/coach_reply: reponse\.texte/.test(couche), "updateWorkoutFeedbackCoachReply intact");
});

await test("BB8. la vidéo du remplaçant est RÉSOLUE à la lecture, jamais stockée dans le retour", () => {
  const couche = sansCommentairesTs(COUCHE_ECRITURE);
  // Aucune URL n'entre dans le retour…
  assert.ok(!/substitute_video|substituteVideoUrl\s*:\s*['"`]/.test(
    couche.slice(couche.indexOf("export async function saveWorkoutFeedback"),
                 couche.indexOf("export async function updateWorkoutFeedbackStatus")),
  ), "aucune URL de vidéo ne doit être écrite dans le retour");
  // …elle est lue depuis la banque, en UNE requête groupée, et seulement
  // s'il y a au moins un remplacement.
  assert.ok(couche.includes("async function loadSubstituteVideos"));
  assert.ok(couche.includes('.select("id, video_url, alternative_video_url")'));
  assert.ok(couche.includes("if (ids.length === 0) return new Map();"),
    "aucune requête quand la séance ne porte aucun remplacement");
  // Et une seule lecture la paie : celle de l'écran de l'élève.
  assert.equal([...couche.matchAll(/loadSubstituteVideos\(/g)].length, 2,
    "définie une fois, appelée une seule fois (getWorkoutFeedbackBySession)");

  const section = sansCommentairesTs(SECTION);
  assert.ok(section.includes("videoUrl: entry.substituteVideoUrl ?? \"\""),
    "la réouverture d'un retour doit réutiliser la vidéo résolue");
});

await test("BB9. les métadonnées de séance sont DÉRIVÉES de session_id, pas déclarées", () => {
  const sql = MIGRATION_METADONNEES;
  // Les trois colonnes redondantes avec `session_id` sont remplacées, pas
  // comparées : aucun écart n'est représentable en base.
  assert.ok(sql.includes("into new.program_id, new.session_ref_label"), "program_id et le libellé dérivés de la séance");
  assert.ok(sql.includes("new.session_key := new.session_id::text"), "session_key dérivée de session_id");
  // …et figées ensuite : ce sont des photographies, comme `exercise_name`.
  assert.ok(sql.includes("new.session_ref_label := old.session_ref_label;"), "libellé figé après création");
  assert.ok(sql.includes("new.session_key := old.session_key;"), "clé figée après création");
  // La dérivation N'A LIEU que si la séance existe : sur le chemin mock
  // (session_id nul) il n'y a aucune ligne de prescription d'où tirer quoi
  // que ce soit, et les trois champs restent ceux de l'appelant.
  const iGarde = sql.indexOf("if tg_op = 'INSERT' and new.session_id is not null then");
  const iDerivation = sql.indexOf("into new.program_id, new.session_ref_label");
  assert.ok(iGarde > 0 && iDerivation > iGarde, "la dérivation est sous la garde `session_id is not null`");
  assert.ok(sql.includes("MIGRATION INCOMPLÈTE"), "la migration se relit elle-même");
  assert.ok(!/drop\s+(table|column|policy)/i.test(sql), "strictement additive");
});

await test("BB10. l'audit des trois champs est écrit, avec source et conséquence", () => {
  // Un champ dérivé sans justification est un champ qu'on re-déclarera un
  // jour « pour simplifier ». La décision et son motif vivent dans le
  // fichier ; ce contrôle empêche qu'ils disparaissent.
  const sql = MIGRATION_METADONNEES;
  for (const champ of ["program_id", "session_key", "session_ref_label"]) {
    assert.ok(new RegExp(`^--\\s+${champ}$`, "m").test(sql), `champ non audité : ${champ}`);
  }
  assert.ok(sql.includes("Source     :"), "chaque champ doit nommer sa source autoritaire");
  assert.ok(sql.includes("Conséquence:"), "et sa conséquence métier");
  // Les champs SANS source autoritaire sont explicitement laissés tels quels.
  assert.ok(/performed_at, duration_minutes[\s\S]{0,400}Inchangés\./.test(sql),
    "les déclarations de l'élève doivent rester documentées comme non dérivables");
});

await test("BB11. la couche d'écriture RELIT les métadonnées retenues par la base", () => {
  const couche = COUCHE_ECRITURE;
  // Renvoyer les valeurs ENVOYÉES afficherait la version du client, pas
  // celle qui a été enregistrée.
  assert.ok(couche.includes('.select("id, status, coach_reply, program_id, session_key, session_ref_label")'));
  assert.ok(couche.includes('.select("id, program_id, session_key, session_ref_label")'));
  assert.ok(couche.includes("refLabel: refLabel || \"Séance\""), "le libellé rendu vient de la base");
  assert.ok(/sessionId: sessionKey,/.test(couche), "la clé rendue vient de la base");
});


/* ════════════════════════════════════════════════════════════════════════
 * C. LE SCHÉMA STRICT DE LA ROUTE
 * ════════════════════════════════════════════════════════════════════════ */

const CORPS_BASE = {
  sessionKey: "36000000-0000-4000-8000-000000000001",
  sessionRefLabel: "Haut du corps",
  completed: true,
  globalRpe: 7,
  globalComment: "",
  pain: "",
};

function corpsAvecExercice(extra: Record<string, unknown>) {
  return {
    ...CORPS_BASE,
    sessionId: "36000000-0000-4000-8000-000000000001",
    exercises: [
      {
        exerciseName: "Développé couché barre",
        exerciseOrder: 0,
        rpe: null,
        comment: "",
        sets: [{ setNumber: 1, loadUsed: "60 kg", repsDone: "8", rpe: 8 }],
        ...extra,
      },
    ],
  };
}

await test("C1. un remplacement bien formé passe le schéma", () => {
  const analyse = workoutFeedbackPayloadSchema.safeParse(
    corpsAvecExercice({
      exerciseId: "38000000-0000-4000-8000-000000000001",
      substituteExerciseLibraryId: "33000000-0000-4000-8000-0000000000a2",
    }),
  );
  assert.ok(analyse.success, analyse.success ? "" : JSON.stringify(analyse.error.issues));
});

await test("C2. le NOM du remplaçant est toujours rejeté — le schéma reste strict", () => {
  const analyse = workoutFeedbackPayloadSchema.safeParse(
    corpsAvecExercice({
      exerciseId: "38000000-0000-4000-8000-000000000001",
      substituteExerciseLibraryId: "33000000-0000-4000-8000-0000000000a2",
      substituteExerciseName: "Ce que je veux",
    }),
  );
  assert.ok(!analyse.success, "un nom de remplaçant envoyé par le navigateur doit faire échouer la requête");
});

await test("C3. les deux nouvelles clés doivent être des uuid, ou nulles", () => {
  assert.ok(
    !workoutFeedbackPayloadSchema.safeParse(corpsAvecExercice({ exerciseId: "pas-un-uuid" })).success,
  );
  assert.ok(
    !workoutFeedbackPayloadSchema.safeParse(corpsAvecExercice({ substituteExerciseLibraryId: "lib-1" })).success,
  );
  assert.ok(
    workoutFeedbackPayloadSchema.safeParse(
      corpsAvecExercice({ exerciseId: null, substituteExerciseLibraryId: null }),
    ).success,
    "null reste accepté : séance mock, bloc cardio",
  );
});

await test("C4. l'ancien contrat reste valide — aucun payload existant n'est cassé", () => {
  // Le contrat cardio historique : exerciseOrder = 900 + position, enveloppe
  // JSON dans `comment`, aucune des nouvelles clés.
  const analyse = workoutFeedbackPayloadSchema.safeParse({
    ...CORPS_BASE,
    exercises: [
      {
        exerciseName: "Cardio · Résultats",
        exerciseOrder: 900,
        rpe: 6,
        comment: JSON.stringify({ version: 2, blockId: "b1" }),
        sets: [{ setNumber: 1, loadUsed: "", repsDone: "" }],
      },
    ],
  });
  assert.ok(analyse.success, analyse.success ? "" : JSON.stringify(analyse.error.issues));
});

await test("C5. la route rejoue la règle du remplacement AVANT toute écriture", () => {
  const route = sansCommentairesTs(ROUTE);
  const iFiltre = route.indexOf("payload.exercises.filter((e) => e.substituteExerciseLibraryId)");
  const iÉcriture = route.indexOf("saveWorkoutFeedback(");
  assert.ok(iFiltre > 0, "la route ne repère pas les remplacements");
  assert.ok(iÉcriture > iFiltre, "la vérification doit précéder l'écriture, pas la suivre");

  // Elle restreint les lignes prescrites à la séance visée : un identifiant
  // emprunté à une autre séance ne remonte pas.
  assert.ok(route.includes('.eq("session_id", payload.sessionId)'));
  // Elle compare les patterns, et refuse un pattern source absent.
  assert.ok(route.includes("!source.movement_pattern || source.movement_pattern !== substitut.movement_pattern"));
  // Elle refuse le remplacement par soi-même et le remplaçant archivé.
  assert.ok(route.includes("sourceId === substitutId"));
  assert.ok(route.includes('substitut.status !== "active"'));
  // Et elle ne fabrique JAMAIS de nom.
  assert.ok(!/substitute_exercise_name/.test(route), "la route ne doit jamais écrire le nom du remplaçant");
});


/* ════════════════════════════════════════════════════════════════════════
 * D. L'ÉCRITURE — l'identifiant part, le nom revient de la base
 * ════════════════════════════════════════════════════════════════════════ */


const ÉLÈVE = "32000000-0000-4000-8000-000000000002";

function payloadAvecRemplacement(): WorkoutFeedbackPayload {
  return {
    studentId: ÉLÈVE,
    sessionKey: "36000000-0000-4000-8000-000000000001",
    sessionId: "36000000-0000-4000-8000-000000000001",
    programId: "34000000-0000-4000-8000-000000000001",
    sessionRefLabel: "Haut du corps",
    completed: true,
    globalRpe: 7,
    globalComment: "",
    pain: "",
    exercises: [
      {
        exerciseName: "Développé couché barre",
        exerciseOrder: 0,
        rpe: null,
        comment: "banc pris",
        exerciseId: "38000000-0000-4000-8000-000000000001",
        substituteExerciseLibraryId: "33000000-0000-4000-8000-0000000000a2",
        sets: [{ setNumber: 1, loadUsed: "30 kg", repsDone: "8", rpe: 8 }],
      },
      {
        exerciseName: "Écarté maison",
        exerciseOrder: 1,
        rpe: null,
        comment: "",
        exerciseId: "38000000-0000-4000-8000-000000000002",
        sets: [{ setNumber: 1, loadUsed: "12 kg", repsDone: "12", rpe: 7 }],
      },
    ],
  };
}

await test("D1. l'écriture envoie l'IDENTIFIANT du remplaçant, jamais son nom", async () => {
  const { client, envoyé } = creerBase();
  await saveWorkoutFeedback(client, payloadAvecRemplacement());

  assert.equal(envoyé.length, 2, "deux exercices insérés");
  assert.equal(envoyé[0].substitute_exercise_library_id, "33000000-0000-4000-8000-0000000000a2");
  for (const ligne of envoyé) {
    assert.ok(
      !("substitute_exercise_name" in ligne),
      "la couche d'écriture ne doit JAMAIS transmettre le nom du remplaçant",
    );
  }
});

await test("D2. `exercise_id` est enfin écrit — c'est lui qui porte le pattern à comparer", async () => {
  const { client, envoyé } = creerBase();
  await saveWorkoutFeedback(client, payloadAvecRemplacement());
  assert.equal(envoyé[0].exercise_id, "38000000-0000-4000-8000-000000000001");
  assert.equal(envoyé[1].exercise_id, "38000000-0000-4000-8000-000000000002");
});

await test("D3. le nom affiché est celui que la BASE a écrit, pas celui du client", async () => {
  const { client } = creerBase();
  const sauvé = await saveWorkoutFeedback(client, payloadAvecRemplacement());
  assert.ok(sauvé, "l'enregistrement doit réussir");
  const remplacé = sauvé!.exerciseEntries.find((e) => e.exerciseName === "Développé couché barre");
  assert.equal(remplacé?.substituteExerciseName, "Développé couché haltères");
  // Le nom PRESCRIT n'est jamais écrasé : le coach doit voir les deux.
  assert.equal(remplacé?.exerciseName, "Développé couché barre");
  const nonRemplacé = sauvé!.exerciseEntries.find((e) => e.exerciseName === "Écarté maison");
  assert.equal(nonRemplacé?.substituteExerciseName, null);
});

await test("D4. un exercice sans remplacement n'écrit aucune trace", async () => {
  const { client, table } = creerBase();
  const payload = payloadAvecRemplacement();
  payload.exercises = [payload.exercises[1]];
  await saveWorkoutFeedback(client, payload);
  const lignes = table("exercise_feedback");
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].substitute_exercise_library_id, null);
  assert.equal(lignes[0].substitute_exercise_name, null);
});

await test("D5. une resoumission REMPLACE les lignes — la trace suit le nouveau choix", async () => {
  const { client, table } = creerBase();
  await saveWorkoutFeedback(client, payloadAvecRemplacement());

  const suivant = payloadAvecRemplacement();
  suivant.exercises[0].substituteExerciseLibraryId = "33000000-0000-4000-8000-0000000000a3";
  await saveWorkoutFeedback(client, suivant);

  const lignes = table("exercise_feedback");
  assert.equal(lignes.length, 2, "les anciennes lignes sont supprimées, pas cumulées");
  assert.equal(lignes[0].substitute_exercise_name, "Pompes lestées");
});


/* ════════════════════════════════════════════════════════════════════════
 * D-bis. LA COURSE ENTRE DEUX SOUMISSIONS
 * ════════════════════════════════════════════════════════════════════════ */

await test("DB1. course perdue : le retour GAGNANT est réutilisé, jamais un second créé", async () => {
  const { client, table } = creerBase();
  // Le retour gagnant, déjà en base, avec une session_key DIVERGENTE : la
  // lecture applicative (par session_key) le MANQUE — c'est exactement ce
  // qui se passe quand deux soumissions se croisent, et aussi le cas d'une
  // ligne héritée dont la clé texte aurait divergé.
  table("workout_feedback").push({
    id: "wf-gagnant",
    student_id: ÉLÈVE,
    session_id: "36000000-0000-4000-8000-000000000001",
    session_key: "CLE-DIVERGENTE",
    session_ref_label: "Haut du corps",
    program_id: "34000000-0000-4000-8000-000000000001",
    status: "traité",
    coach_reply: "Déjà répondu par le coach",
    performed_at: "2026-08-01",
    completed: true,
  });

  const sauvé = await saveWorkoutFeedback(client, payloadAvecRemplacement());

  assert.ok(sauvé, "la soumission doit aboutir, pas échouer");
  assert.equal(table("workout_feedback").length, 1, "AUCUN second retour ne doit être créé");
  assert.equal(sauvé!.id, "wf-gagnant", "c'est le retour gagnant qui est repris");
  // Le travail du coach survit à la collision.
  assert.equal(sauvé!.status, "traité");
  assert.equal(sauvé!.coachReply, "Déjà répondu par le coach");
  // La date de réalisation d'origine est conservée, pas écrasée par celle du
  // perdant : elle est relue sur la ligne RÉELLEMENT visée.
  assert.equal(table("workout_feedback")[0].performed_at, "2026-08-01");
  // Et le réalisé du perdant a bien été enregistré sur ce retour.
  assert.equal(table("exercise_feedback").length, 2);
});

await test("DB2. une erreur qui N'EST PAS une collision n'est jamais réinterprétée", async () => {
  const { client, table, injecterErreur } = creerBase();
  // 42501 = insufficient_privilege (refus RLS). Le rattrapage ne doit pas
  // s'enclencher : on ne veut surtout pas transformer un refus de droits en
  // « le retour existait déjà ».
  injecterErreur({ code: "42501", message: "new row violates row-level security policy" });
  const sauvé = await saveWorkoutFeedback(client, payloadAvecRemplacement());
  assert.equal(sauvé, null, "un refus RLS doit rester un échec franc");
  assert.equal(table("workout_feedback").length, 0, "et rien ne doit être écrit");
});

await test("DB3. collision sans session_id : aucun rattrapage possible, échec franc", async () => {
  const { client, table, injecterErreur } = creerBase();
  injecterErreur({ code: "23505", message: "duplicate key" });
  const payload = payloadAvecRemplacement();
  payload.sessionId = null;
  const sauvé = await saveWorkoutFeedback(client, payload);
  // Sans séance réelle il n'y a pas de couple (élève, séance) à relire :
  // l'index partiel ne s'applique même pas, donc une 23505 ici serait une
  // anomalie. On échoue plutôt que de deviner.
  assert.equal(sauvé, null);
  assert.equal(table("workout_feedback").length, 0);
});

await test("DB4. la couche ne prétend pas empêcher la course — elle la rattrape", () => {
  const couche = COUCHE_ECRITURE;
  assert.ok(couche.includes("function estCollisionUnicite"), "le rattrapage doit être explicite");
  assert.ok(couche.includes('=== "23505"'), "et déclenché par le SEUL code d'unicité");
  // La relecture se fait sur l'IDENTITÉ CANONIQUE, pas sur la clé texte.
  const rattrapage = couche.slice(couche.indexOf("COURSE PERDUE"));
  assert.ok(rattrapage.includes('.eq("session_id", payload.sessionId)'),
    "le retour gagnant se relit par (élève, séance), jamais par session_key");
  assert.ok(!/\.eq\("session_key"/.test(rattrapage.slice(0, 900)),
    "surtout pas par la clé texte, qui peut justement avoir divergé");
});


/* ════════════════════════════════════════════════════════════════════════
 * E. LA LECTURE DES REMPLAÇANTS — fonction pure
 * ════════════════════════════════════════════════════════════════════════ */

await test("E1. parseExerciseSubstitutes traduit une réponse normale", () => {
  const options = parseExerciseSubstitutes([
    {
      id: "33000000-0000-4000-8000-0000000000a2",
      name: "Développé couché haltères",
      video_url: "https://v/dch",
      alternative_video_url: "",
      muscle_group: "pectoraux",
      equipment: "Haltères",
      level: "intermédiaire",
    },
  ]);
  assert.equal(options.length, 1);
  assert.equal(options[0].name, "Développé couché haltères");
  assert.equal(options[0].videoUrl, "https://v/dch");
});

await test("E2. une ligne sans identifiant ou sans nom est ÉCARTÉE, jamais rendue vide", () => {
  const options = parseExerciseSubstitutes([
    { id: "", name: "Sans id" },
    { id: "x", name: "   " },
    { id: "x", name: null },
    null,
    "bruit",
    { id: "ok-1", name: "Correct" },
  ]);
  assert.deepEqual(options.map((o) => o.name), ["Correct"]);
});

await test("E3. une réponse absurde donne une liste vide, jamais une exception", () => {
  assert.deepEqual(parseExerciseSubstitutes(null), []);
  assert.deepEqual(parseExerciseSubstitutes(undefined), []);
  assert.deepEqual(parseExerciseSubstitutes({ pas: "un tableau" }), []);
  assert.deepEqual(parseExerciseSubstitutes("[]"), []);
});


/* ════════════════════════════════════════════════════════════════════════
 * F. L'ÉCRAN ÉLÈVE — le nom et la vidéo changent, RIEN d'autre
 * ════════════════════════════════════════════════════════════════════════ */

const EXERCICE: Exercise = {
  id: "38000000-0000-4000-8000-000000000001",
  name: "Développé couché barre",
  sets: 4,
  reps: "8",
  restSeconds: 120,
  tempo: "3-0-1-0",
  recommendedLoad: "60 kg",
  videoUrl: "https://v/prescrit",
  libraryExerciseId: "33000000-0000-4000-8000-0000000000a1",
  recommendedRpe: "8",
};

const RETOUR: ExerciseFeedback = {
  studentId: ÉLÈVE,
  sessionId: "36000000-0000-4000-8000-000000000001",
  exerciseId: EXERCICE.id,
  exerciseName: EXERCICE.name,
  sets: [1, 2, 3, 4].map((n) => ({
    studentId: ÉLÈVE,
    sessionId: "36000000-0000-4000-8000-000000000001",
    exerciseId: EXERCICE.id,
    setNumber: n,
    loadUsed: "",
    repsDone: "",
    rpe: "",
  })),
  rpe: null,
  comment: "",
};

const REMPLAÇANT: ExerciseSubstituteOption = {
  id: "33000000-0000-4000-8000-0000000000a2",
  name: "Développé couché haltères",
  videoUrl: "https://v/remplacant",
  alternativeVideoUrl: "",
  muscleGroup: "pectoraux",
  equipment: "Haltères",
  level: "intermédiaire",
};

function rendreCarte(substitute: ExerciseSubstituteOption | null, avecAction = true): string {
  return renderToString(
    createElement(ExerciseFeedbackCard, {
      exercise: EXERCICE,
      index: 0,
      feedback: RETOUR,
      onSetChange: () => {},
      onCommentChange: () => {},
      substitute,
      ...(avecAction ? { onSubstituteChange: () => {} } : {}),
    }),
  );
}

await test("F1. sans remplacement : le nom et la vidéo prescrits, et le bouton « Exercice indisponible »", () => {
  const html = rendreCarte(null);
  assert.ok(html.includes("Développé couché barre"));
  assert.ok(html.includes("https://v/prescrit"));
  assert.ok(html.includes("Exercice indisponible"));
  assert.ok(!html.includes("À la place de"));
});

await test("F2. avec remplacement : le nom et la vidéo du REMPLAÇANT s'affichent", () => {
  const html = rendreCarte(REMPLAÇANT);
  assert.ok(html.includes("Développé couché haltères"), "le nom réalisé doit être le titre");
  assert.ok(html.includes("https://v/remplacant"), "la démo doit être celle du remplaçant");
  assert.ok(!html.includes("https://v/prescrit"), "la démo prescrite ne doit plus être proposée");
  assert.ok(html.includes("À la place de"), "l'élève doit voir ce qui était prévu");
});

await test("F3. LA STRUCTURE NE BOUGE PAS — c'est toute la règle demandée", () => {
  const sans = rendreCarte(null);
  const avec = rendreCarte(REMPLAÇANT);
  for (const html of [sans, avec]) {
    assert.ok(html.includes("4 séries"), "séries inchangées");
    assert.ok(html.includes("8 reps"), "répétitions inchangées");
    assert.ok(html.includes("120s repos"), "repos inchangé");
    assert.ok(html.includes("tempo 3-0-1-0"), "tempo inchangé");
    assert.ok(html.includes("charge conseillée 60 kg"), "charge conseillée inchangée");
    assert.ok(html.includes("RPE cible 8"), "RPE cible inchangé");
    // Et toujours quatre lignes de série. `renderToString` insère des
    // marqueurs `<!-- -->` entre texte et expression : on les retire avant
    // de compter, sinon on mesurerait la sérialisation de React.
    assert.equal([...html.replace(/<!-- -->/g, "").matchAll(/Série \d/g)].length, 4);
  }
});

await test("F4. sans gestionnaire de remplacement, aucun bouton n'apparaît (chemin mock)", () => {
  const html = rendreCarte(null, false);
  assert.ok(!html.includes("Exercice indisponible"));
  assert.ok(!html.includes("Aucun remplacement possible"));
});

await test("F5. un exercice HORS BANQUE le dit, au lieu d'un bouton sans issue", () => {
  const html = renderToString(
    createElement(ExerciseSubstitutionPicker, {
      libraryExerciseId: null,
      substitute: null,
      onChoose: () => {},
      onReset: () => {},
    }),
  );
  assert.ok(html.includes("Aucun remplacement possible"));
  assert.ok(!html.includes("Exercice indisponible"));
});

await test("F6. le sélecteur ne charge la liste qu'au clic — aucune requête au montage", () => {
  let appels = 0;
  renderToString(
    createElement(ExerciseSubstitutionPicker, {
      libraryExerciseId: "33000000-0000-4000-8000-0000000000a1",
      substitute: null,
      onChoose: () => {},
      onReset: () => {},
      chargerRemplacants: async () => {
        appels += 1;
        return [REMPLAÇANT];
      },
    }),
  );
  assert.equal(appels, 0, "monter dix exercices ne doit déclencher aucune lecture");
});

await test("F7. le composant de remplacement ne touche jamais l'état des séries", () => {
  const source = sansCommentairesTs(SÉLECTEUR);
  assert.ok(!/\bsets\b/.test(source), "le sélecteur ne connaît pas les séries");
  assert.ok(!/loadUsed|repsDone/.test(source), "ni les charges ou répétitions");
  assert.ok(!/fetch\(/.test(source), "et n'appelle pas fetch directement");
});

await test("F8. la section envoie l'identifiant du remplaçant, et le propose seulement sur le chemin réel", () => {
  const section = sansCommentairesTs(SECTION);
  assert.ok(section.includes("substituteExerciseLibraryId: substitutions[exerciseFb.exerciseId]?.id ?? null"));
  assert.ok(!/substituteExerciseName:/.test(section.split("const exercisesPayload")[1] ?? ""), "aucun nom transmis");
  // Le bouton n'existe que quand Supabase est réellement actif.
  assert.ok(section.includes("supabaseFeedback.active\n              ? { onSubstituteChange"));
  // Et le remplacement est restauré à la réouverture, sinon il serait perdu.
  assert.ok(section.includes("setSubstitutions(() => {"), "les remplacements doivent être restaurés à l'édition");
});


/* ════════════════════════════════════════════════════════════════════════
 * G. L'ÉCRAN COACH ET LA BANQUE D'EXERCICES
 * ════════════════════════════════════════════════════════════════════════ */

await test("G1. le coach voit le remplacement en tête du détail, et sur chaque série", () => {
  const modale = MODALE_COACH;
  assert.ok(modale.includes("Exercices remplacés par l"), "bandeau de tête absent");
  assert.ok(modale.includes("réalisé : {entry.substituteExerciseName}"), "mention par série absente");
  // Le nom prescrit reste affiché : le coach doit pouvoir comparer.
  assert.ok(modale.includes("{entry.exerciseName} — série {entry.setNumber}"));
});

await test("G2. le formulaire d'exercice propose le pattern, facultatif et documenté", () => {
  const modale = MODALE_EXERCICE;
  assert.ok(modale.includes('label="Pattern de mouvement"'));
  assert.ok(modale.includes('{ value: "", label: "— Non renseigné —" }'), "l'option vide doit exister et venir en tête");
  assert.ok(modale.includes("normalizeMovementPattern(form.movementPattern)"), "la valeur est validée avant d'être enregistrée");
  assert.ok(modale.includes("movementPatternExamples"), "des exemples aident le coach à choisir");
});

await test("G3. la recherche de la banque trouve un pattern par sa clé ET par son libellé", () => {
  const fiche: ExerciseLibraryItem = {
    id: "x", name: "Soulevé de terre", description: "",
    muscleGroup: "ischios", secondaryMuscles: [],
    movementPattern: "hinge",
    category: "Force", exerciseType: "Force", equipment: "Barre", level: "avancé",
    videoUrl: "", alternativeVideoUrl: "", technicalNote: "", commonMistakes: "",
    coachInstructions: "", defaultTempo: "", defaultRestSeconds: null, tags: [],
    status: "active", createdAt: "", updatedAt: "",
  };
  assert.ok(matchesExerciseSearch(fiche, "hinge"), "recherche par clé");
  assert.ok(matchesExerciseSearch(fiche, "Hinge"), "recherche insensible à la casse");
  assert.ok(!matchesExerciseSearch(fiche, "squat"), "un autre pattern ne doit pas répondre");
  // Un libellé accentué reste cherchable : « Élévation postérieure ».
  assert.ok(matchesExerciseSearch({ ...fiche, movementPattern: "elevation_posterieure" }, "postérieure"));
  // Une fiche sans pattern ne casse pas la recherche.
  assert.ok(matchesExerciseSearch({ ...fiche, movementPattern: null }, "soulevé"));
  assert.ok(!matchesExerciseSearch({ ...fiche, movementPattern: null }, "hinge"));
});

await test("G4. types/supabase.ts porte les trois nouvelles colonnes", () => {
  assert.ok(TYPES_SUPABASE.includes("movement_pattern: string | null;"));
  assert.ok(TYPES_SUPABASE.includes("substitute_exercise_library_id: string | null;"));
  assert.ok(TYPES_SUPABASE.includes("substitute_exercise_name: string | null;"));
  // `substitute_exercise_name` est DÉRIVÉ : il ne doit pas être écrivable
  // depuis l'application, donc absent de Insert et de Update.
  const bloc = TYPES_SUPABASE.slice(
    TYPES_SUPABASE.indexOf("exercise_feedback: {"),
    TYPES_SUPABASE.indexOf("exercise_set_feedback: {"),
  );
  const insertEtUpdate = bloc.slice(bloc.indexOf("Insert: {"));
  assert.ok(
    !insertEtUpdate.includes("substitute_exercise_name"),
    "le nom du remplaçant ne doit être ni insérable ni modifiable depuis l'application",
  );
  assert.ok(insertEtUpdate.includes("substitute_exercise_library_id?: string | null;"));
});

await test("G5. la carte d'exercice ne déclenche aucune écriture", () => {
  const carte = sansCommentairesTs(CARTE);
  assert.ok(!/fetch\(|\.insert\(|saveWorkoutFeedback/.test(carte), "la carte ne doit rien écrire");
});

console.log("");
console.log(`${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
