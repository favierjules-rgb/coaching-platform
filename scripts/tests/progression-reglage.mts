/**
 * Harnais — LOT C : réglage « progression automatique » ON/OFF.
 *
 * ⚠️ LA PROPRIÉTÉ CENTRALE EST STRUCTURELLE, PAS COMPORTEMENTALE.
 * Le réglage est global au couple (programme, exercice) parce que sa clé ne
 * contient NI semaine, NI séance, NI bloc. Ces tests le vérifient de deux
 * façons : en calculant la clé de deux occurrences distantes de plusieurs
 * semaines (elle doit être identique), et en rendant réellement deux boutons
 * pour deux occurrences du même exercice (ils doivent basculer ensemble).
 *
 * Lancement : npx tsx scripts/tests/progression-reglage.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  PROGRESSION_ACTIVE_PAR_DEFAUT,
  cleReglageDeLExercice,
  ecritureDuReglage,
  identiteReglage,
  indexApresBascule,
  indexerReglages,
  progressionActivePour,
  type ExercicePourReglage,
  type LigneReglage,
} from "../../lib/progression-reglage";
import {
  ProgressionAutomatiqueToggle,
  ProgressionReglageProvider,
} from "../../components/admin/ProgressionAutomatiqueToggle";
import { indicateursDExercice } from "../../lib/indicateurs-progression";

let réussis = 0;
let échecs = 0;
function test(nom: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      réussis += 1;
      console.log(`ok - ${nom}`);
    })
    .catch((erreur) => {
      échecs += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(erreur);
    });
}

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sourceMigration = lire("../../supabase/migrations/20260925090000_progression_automatique_par_exercice.sql");
const sourceReglage = lire("../../lib/progression-reglage.ts");
const sourceToggle = lire("../../components/admin/ProgressionAutomatiqueToggle.tsx");
const sourceEditeur = lire("../../components/admin/blocks/StrengthBlockEditor.tsx");
const sourceBuilder = lire("../../components/admin/ProgramBuilderFullscreen.tsx");

const LIB_ELEV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIB_DC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROGRAMME = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * Deux occurrences du MÊME exercice, dans deux semaines différentes. Les
 * identifiants de ligne diffèrent — c'est le cas réel : le builder régénère
 * un `new-exercise:<uuid>` à chaque duplication de semaine.
 */
const ELEV_S1 = { id: "new-exercise:s1", name: "Élévations latérales", libraryExerciseId: LIB_ELEV };
const ELEV_S5 = { id: "new-exercise:s5", name: "Élévations latérales", libraryExerciseId: LIB_ELEV };
const DC_S1 = { id: "new-exercise:dc", name: "Développé couché", libraryExerciseId: LIB_DC };
/** Exercice en texte libre : aucune fiche de banque. */
const LIBRE_S1 = { id: "new-exercise:l1", name: "Gainage latéral maison" };
const LIBRE_S4 = { id: "new-exercise:l4", name: "  GAINAGE  Latéral   Maison " };

/** Rend N boutons dans UN fournisseur, avec un écrivain qui note les appels. */
function rendreBoutons(
  exercices: ExercicePourReglage[],
  options: { lignes?: LigneReglage[]; programId?: string | null } = {},
) {
  const lignes = options.lignes ?? [];
  const html = renderToString(
    createElement(
      ProgressionReglageProvider,
      {
        programId: options.programId === undefined ? PROGRAMME : options.programId,
        // Un rendu serveur n'exécute aucun effet : l'index doit donc être
        // connu avant le premier rendu, sinon aucun bouton ne pourrait
        // jamais apparaître allumé dans un test de rendu.
        indexInitial: indexerReglages(lignes),
        lire: async () => indexerReglages(lignes),
        ecrire: async () => ({ ok: true as const }),
      },
      ...exercices.map((exercice, i) => createElement(ProgressionAutomatiqueToggle, { key: i, exercise: exercice })),
    ),
  );
  return html;
}

await (async () => {
  /* ══════════════════════════════════════════════════════════════════════
   * B2 — LES SIX CAS EXIGÉS
   * ══════════════════════════════════════════════════════════════════════ */

  await test("1. ON active la progression, et le moteur en tient compte", () => {
    const index = indexerReglages([
      { exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: true },
    ]);
    assert.equal(progressionActivePour(index, ELEV_S1), true);
    const lue = indicateursDExercice({
      progressionActive: progressionActivePour(index, ELEV_S1),
      groupe: "épaules",
      repsPrescrites: "8-13",
      reference: { chargeKg: 10, reps: 13 },
    });
    assert.ok(lue.ok, "ON : une recommandation est produite");
    assert.equal(lue.indicateurs.recommandation.chargeKg, 11, "épaules : +1 kg");
  });

  await test("2. OFF désactive la progression, et AUCUNE recommandation n'est produite", () => {
    const index = indexerReglages([
      { exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: false },
    ]);
    assert.equal(progressionActivePour(index, ELEV_S1), false);
    const lue = indicateursDExercice({
      progressionActive: progressionActivePour(index, ELEV_S1),
      groupe: "épaules",
      repsPrescrites: "8-13",
      reference: { chargeKg: 10, reps: 13 },
    });
    assert.equal(lue.ok, false);
    assert.equal(lue.ok === false && lue.motif, "progression-desactivee");
  });

  await test("3. deux occurrences du même exercice PARTAGENT le réglage", () => {
    // La preuve structurelle : la clé est identique, alors que les
    // identifiants de ligne diffèrent.
    assert.equal(cleReglageDeLExercice(ELEV_S1), cleReglageDeLExercice(ELEV_S5));
    assert.notEqual(ELEV_S1.id, ELEV_S5.id, "ce sont bien deux lignes distinctes");
    const index = indexerReglages([
      { exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: true },
    ]);
    assert.equal(progressionActivePour(index, ELEV_S1), true);
    assert.equal(progressionActivePour(index, ELEV_S5), true, "la semaine 5 lit le même réglage");
    // Et la preuve rendue : deux boutons, deux fois « activée ».
    const html = rendreBoutons([ELEV_S1, ELEV_S5], {
      lignes: [{ exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: true }],
    });
    assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 2, "les deux boutons sont allumés");
    assert.equal((html.match(/aria-checked="false"/g) ?? []).length, 0);
  });

  await test("4. une bascule en SEMAINE 1 est visible en SEMAINE 2", () => {
    const depart = indexerReglages([]);
    assert.equal(progressionActivePour(depart, ELEV_S1), false);
    assert.equal(progressionActivePour(depart, ELEV_S5), false);
    // Bascule opérée sur l'occurrence de la semaine 1…
    const apres = indexApresBascule(depart, ELEV_S1, true);
    // …et lue sur celle de la semaine 5.
    assert.equal(progressionActivePour(apres, ELEV_S5), true, "l'autre occurrence a suivi");
    assert.equal(apres.size, 1, "UNE seule entrée modifiée : il n'y a qu'un réglage");
  });

  await test("5. une bascule en SEMAINE 5 est visible sur TOUTES les autres occurrences", () => {
    const allume = indexerReglages([
      { exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: true },
    ]);
    // Extinction depuis la semaine 5.
    const eteint = indexApresBascule(allume, ELEV_S5, false);
    for (const occurrence of [ELEV_S1, ELEV_S5, { id: "autre", name: "Élévations latérales", libraryExerciseId: LIB_ELEV }]) {
      assert.equal(progressionActivePour(eteint, occurrence), false, "toutes les occurrences sont éteintes");
    }
    assert.equal(eteint.size, 1);
  });

  await test("6. deux exercices DIFFÉRENTS ne partagent PAS leur réglage", () => {
    assert.notEqual(cleReglageDeLExercice(ELEV_S1), cleReglageDeLExercice(DC_S1));
    const index = indexerReglages([
      { exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: true },
    ]);
    assert.equal(progressionActivePour(index, ELEV_S1), true);
    assert.equal(progressionActivePour(index, DC_S1), false, "le développé couché reste au défaut");
    const apres = indexApresBascule(index, DC_S1, true);
    assert.equal(progressionActivePour(apres, ELEV_S1), true, "le premier n'a pas bougé");
    assert.equal(apres.size, 2, "deux réglages distincts");
    // Et au rendu : un bouton allumé, un éteint.
    const html = rendreBoutons([ELEV_S1, DC_S1], {
      lignes: [{ exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: true }],
    });
    assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
    assert.equal((html.match(/aria-checked="false"/g) ?? []).length, 1);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * IDENTITÉ
   * ══════════════════════════════════════════════════════════════════════ */

  await test("7. l'identité de banque PRIME sur le nom", () => {
    const identite = identiteReglage({ name: "Élévations latérales", libraryExerciseId: LIB_ELEV });
    assert.deepEqual(identite, { genre: "banque", exerciseLibraryId: LIB_ELEV });
    // Renommé dans le programme, même fiche : même réglage.
    assert.equal(
      cleReglageDeLExercice({ name: "Élévations (variante)", libraryExerciseId: LIB_ELEV }),
      cleReglageDeLExercice(ELEV_S1),
      "un renommage ne perd pas le réglage",
    );
  });

  await test("8. un exercice en TEXTE LIBRE est identifié par son nom normalisé", () => {
    assert.deepEqual(identiteReglage(LIBRE_S1), {
      genre: "nom",
      exerciseNameNormalized: "gainage lateral maison",
    });
    // Casse, accents et espaces multiples ne créent pas un second réglage.
    assert.equal(cleReglageDeLExercice(LIBRE_S1), cleReglageDeLExercice(LIBRE_S4));
    const index = indexApresBascule(indexerReglages([]), LIBRE_S1, true);
    assert.equal(progressionActivePour(index, LIBRE_S4), true, "la même clé, donc le même réglage");
  });

  await test("9. un exercice sans nom ET sans fiche n'a AUCUNE identité", () => {
    assert.equal(identiteReglage({ name: "" }), null);
    assert.equal(identiteReglage({ name: "   ", libraryExerciseId: null }), null);
    assert.equal(cleReglageDeLExercice({ name: "" }), null);
    // Il ne partage donc pas un réglage avec les autres exercices sans nom.
    const index = indexApresBascule(indexerReglages([]), { name: "" }, true);
    assert.equal(index.size, 0, "rien n'est écrit");
    assert.equal(progressionActivePour(index, { name: "" }), false);
    assert.equal(ecritureDuReglage(PROGRAMME, { name: "" }, true), null, "rien à persister");
  });

  await test("10. une fiche de banque et un nom ne se confondent jamais", () => {
    // Cas pathologique : un identifiant de banque qui vaudrait littéralement
    // le nom normalisé d'un autre exercice. Le préfixe de clé l'empêche.
    const parBanque = cleReglageDeLExercice({ name: "peu importe", libraryExerciseId: "squat" });
    const parNom = cleReglageDeLExercice({ name: "Squat" });
    assert.notEqual(parBanque, parNom);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * DÉFAUT ET ÉCRITURE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("11. le défaut est OFF, et il est écrit UNE seule fois", () => {
    assert.equal(PROGRESSION_ACTIVE_PAR_DEFAUT, false);
    assert.equal(progressionActivePour(indexerReglages([]), ELEV_S1), false, "aucune ligne = OFF");
    // La constante est la SEULE source du défaut : aucun `?? true` ni
    // `|| true` ne traîne dans le module.
    const code = sansCommentaires(sourceReglage);
    assert.ok(!/\?\?\s*true|\|\|\s*true/.test(code), "aucun défaut ON en dur");
    assert.equal(
      (code.match(/PROGRESSION_ACTIVE_PAR_DEFAUT/g) ?? []).length,
      3,
      "la constante, et ses deux seuls usages",
    );
  });

  await test("12. l'écriture porte EXACTEMENT une identité", () => {
    const banque = ecritureDuReglage(PROGRAMME, ELEV_S1, true);
    assert.deepEqual(banque, {
      programId: PROGRAMME,
      exerciseLibraryId: LIB_ELEV,
      exerciseNameNormalized: null,
      progressionActive: true,
    });
    const nom = ecritureDuReglage(PROGRAMME, LIBRE_S4, false);
    assert.deepEqual(nom, {
      programId: PROGRAMME,
      exerciseLibraryId: null,
      exerciseNameNormalized: "gainage lateral maison",
      progressionActive: false,
    });
    assert.equal(ecritureDuReglage("", ELEV_S1, true), null, "sans programme, rien à écrire");
  });

  await test("13. une ligne AMBIGUË est ignorée, jamais interprétée", () => {
    const index = indexerReglages([
      // Les deux identités : interdit par le CHECK, mais une réponse réseau
      // ou un jeu de test peut en produire. On n'en déduit rien.
      { exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: "elevations laterales", progressionActive: true },
      // Aucune identité.
      { exerciseLibraryId: null, exerciseNameNormalized: null, progressionActive: true },
      { exerciseLibraryId: "  ", exerciseNameNormalized: "  ", progressionActive: true },
    ]);
    assert.equal(index.size, 0, "aucune ligne ambiguë retenue");
    assert.equal(progressionActivePour(index, ELEV_S1), false, "retour au défaut, pas au « true » de la ligne");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * INTERFACE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("14. le bouton est présent sur CHAQUE carte d'exercice du builder", () => {
    const code = sansCommentaires(sourceEditeur);
    assert.ok(code.includes("<ProgressionAutomatiqueToggle exercise={exercise} />"), "un bouton par exercice rendu");
    // Il est DANS la boucle sur les exercices du bloc, pas à côté d'elle.
    const boucle = code.indexOf("block.exercises.map");
    const bouton = code.indexOf("ProgressionAutomatiqueToggle exercise=");
    assert.ok(boucle >= 0 && bouton > boucle, "le bouton est rendu par exercice");
  });

  await test("15. UN SEUL fournisseur pour tout le builder — la garantie structurelle", () => {
    const code = sansCommentaires(sourceBuilder);
    assert.equal(
      (code.match(/<ProgressionReglageProvider/g) ?? []).length,
      1,
      "un seul fournisseur : deux boutons du même exercice ne peuvent pas diverger",
    );
    // Il n'est pas monté par semaine ni par séance.
    assert.ok(
      !/selectedWeek[^\n]*ProgressionReglageProvider|ProgressionReglageProvider[^\n]*weekNumber/.test(code),
      "le fournisseur n'est pas paramétré par la semaine",
    );
  });

  await test("16. le libellé accessible dit que le réglage est commun à toutes les semaines", () => {
    const html = rendreBoutons([ELEV_S1]);
    assert.ok(html.includes('role="switch"'), "un interrupteur, pas un bouton muet");
    assert.ok(html.includes("réglage commun à toutes les semaines du programme"), "l'étendue est annoncée");
    assert.ok(html.includes("Progression automatique de Élévations latérales"), "l'exercice est nommé");
  });

  await test("17. sans programme enregistré, le bouton est désactivé et le dit", () => {
    const html = rendreBoutons([ELEV_S1], { programId: null });
    assert.ok(html.includes("disabled"), "aucun réglage possible sans programme en base");
    assert.ok(html.includes("Enregistrez le programme"), "la raison est donnée");
    assert.ok(html.includes('aria-checked="false"'), "et l'état affiché est le défaut");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * MIGRATION
   * ══════════════════════════════════════════════════════════════════════ */

  await test("18. la migration ne porte AUCUNE colonne de semaine, de séance ni de bloc", () => {
    const sql = sourceMigration.replace(/--[^\n]*/g, "");
    assert.ok(sql.includes("create table if not exists public.program_exercise_progression"));
    for (const interdit of ["week_number", "program_week_id", "session_id", "block_id", "workout_exercise_id"]) {
      assert.ok(!sql.includes(interdit), `aucune colonne ${interdit} : le réglage resterait par semaine`);
    }
    // La clé est bien (programme, identité), sur DEUX index partiels.
    assert.ok(/unique index[\s\S]*\(program_id, exercise_library_id\)[\s\S]*where exercise_library_id is not null/.test(sql));
    assert.ok(/unique index[\s\S]*\(program_id, exercise_name_normalized\)[\s\S]*where exercise_name_normalized is not null/.test(sql));
  });

  await test("19. la migration impose EXACTEMENT une identité, et par défaut OFF", () => {
    const sql = sourceMigration.replace(/--[^\n]*/g, "");
    assert.ok(sql.includes("program_exercise_progression_identite_exclusive"), "le CHECK existe");
    assert.ok(/progression_active boolean not null default false/.test(sql), "défaut false");
    // AUCUNE écriture de données : pas de backfill.
    assert.ok(!/\binsert\s+into\b/i.test(sql), "aucune ligne écrite par la migration");
    assert.ok(!/\bupdate\s+public\./i.test(sql), "aucune donnée existante modifiée");
    // RLS activée, et l'élève ne peut que LIRE.
    assert.ok(sql.includes("enable row level security"));
    assert.ok(/create policy program_exercise_progression_select_assigned_student[\s\S]*for select/.test(sql));
    assert.ok(
      !/program_exercise_progression_select_assigned_student[\s\S]*with check/.test(sql),
      "aucune écriture élève",
    );
  });

  await test("20. la migration est déclarée aux DEUX registres", () => {
    const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json")) as {
      migrations_post_baseline_attendues: string[];
    };
    const nom = "20260925090000_progression_automatique_par_exercice.sql";
    assert.ok(manifeste.migrations_post_baseline_attendues.includes(nom), "déclarée au manifeste");
    assert.equal(
      manifeste.migrations_post_baseline_attendues[manifeste.migrations_post_baseline_attendues.length - 1],
      nom,
      "et en dernière position : l'ordre d'application est lexicographique",
    );
    const contrat = lire("../../scripts/tests/contrat-migrations.mts");
    assert.ok(contrat.includes(nom), "déclarée au contrat");
    assert.ok(contrat.includes("MIGRATION_PROGRESSION_AUTOMATIQUE"), "et nommée");
    assert.ok(/NOMBRE_DE_MIGRATIONS = 91/.test(contrat), "le compte est à jour");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * CHEMIN RÉEL SUPABASE — PRIVILÈGES ET POLICIES
   * ══════════════════════════════════════════════════════════════════════ */

  await test("21bis. les PRIVILÈGES de table couvrent exactement les commandes émises", () => {
    const sql = sourceMigration.replace(/--[^\n]*/g, "");
    // ⚠️ SANS `grant`, LA RLS N'EST MÊME JAMAIS CONSULTÉE : Postgres refuse sur
    // les privilèges de table avant d'évaluer une policy. Cette garde existe
    // parce que la première version de la migration n'en posait aucun.
    assert.ok(
      /revoke all on table public\.program_exercise_progression from public, anon, authenticated;/.test(sql),
      "les privilèges hérités sont d'abord révoqués",
    );
    assert.ok(
      /grant select, insert, update on table public\.program_exercise_progression to authenticated;/.test(sql),
      "`authenticated` peut lire, insérer et mettre à jour — ce que la couche d'accès émet",
    );
    assert.ok(
      /grant all on table public\.program_exercise_progression to service_role;/.test(sql),
      "service_role conserve tous les droits",
    );
    assert.ok(!/grant[^;]*delete[^;]*to authenticated/.test(sql), "aucun delete à `authenticated`");
    assert.ok(!/grant[^;]*to anon/.test(sql), "rien pour un visiteur non connecté");

    // Et la couche d'accès n'émet QUE ces trois commandes.
    const acces = sansCommentaires(lire("../../lib/supabase/progression-reglage.ts"));
    assert.ok(acces.includes(".select("), "select émis");
    assert.ok(acces.includes(".update("), "update émis");
    assert.ok(acces.includes(".insert("), "insert émis");
    assert.ok(!acces.includes(".delete("), "aucun delete émis : le privilège manquant ne peut pas gêner");
    // Pas d'`upsert` : deux index uniques partiels, PostgREST ne sait viser
    // qu'une contrainte nommée à la fois.
    assert.ok(!acces.includes(".upsert("), "aucun upsert, donc aucun onConflict à choisir de travers");
  });

  await test("21ter. les POLICIES correspondent aux rôles réels des deux chemins", () => {
    const sql = sourceMigration.replace(/--[^\n]*/g, "");
    assert.ok(/alter table public\.program_exercise_progression enable row level security;/.test(sql), "RLS activée");

    // COACH — le builder écrit depuis le NAVIGATEUR, en rôle `authenticated`.
    // La policy de gestion doit donc couvrir insert ET update ET select : elle
    // est écrite sans `for`, donc elle porte sur toutes les commandes, avec un
    // `with check` sans lequel tout insert serait refusé.
    const gestion = /create policy program_exercise_progression_manage_staff\s+on public\.program_exercise_progression\s+using \(public\.is_coach_or_admin\(\)\)\s+with check \(public\.is_coach_or_admin\(\)\);/;
    assert.ok(gestion.test(sql), "policy staff : aucune restriction `for`, et un `with check`");
    assert.ok(!/create policy program_exercise_progression_manage_staff[\s\S]{0,120}for (select|insert|update)/.test(sql),
      "la policy staff n'est pas restreinte à une seule commande");

    // ÉLÈVE — lecture SEULE, et seulement sur un programme qui lui est
    // réellement affecté et publié. C'est exactement la policy de
    // `program_weeks` : un élève qui ne peut pas lire son programme ne doit
    // pas pouvoir lire les réglages de ce programme.
    const eleve = sql.slice(sql.indexOf("program_exercise_progression_select_assigned_student"));
    assert.ok(/for select/.test(eleve), "élève : lecture seule");
    assert.ok(!/with check/.test(eleve.slice(0, eleve.indexOf(";"))), "élève : aucune écriture");
    for (const condition of [
      "a.content_type = 'programme'",
      "a.student_id = public.current_student_id()",
      "p.publication_status = 'published'",
    ]) {
      assert.ok(eleve.includes(condition), `la condition « ${condition} » est présente`);
    }
    assert.ok(
      eleve.includes("a.content_id = program_exercise_progression.program_id"),
      "l'affectation porte bien sur CE programme",
    );

    // Les deux fonctions utilisées existent dans le schéma et sont accessibles
    // à `authenticated` — sans quoi la policy lèverait à l'évaluation.
    const baseline = lire("../../supabase/baseline/00_baseline_remote_schema.sql");
    for (const fonction of ["is_coach_or_admin", "current_student_id"]) {
      assert.ok(
        baseline.includes(`CREATE OR REPLACE FUNCTION "public"."${fonction}"()`),
        `${fonction} existe`,
      );
      assert.ok(
        baseline.includes(`GRANT ALL ON FUNCTION "public"."${fonction}"() TO "authenticated"`),
        `${fonction} est appelable par authenticated`,
      );
    }
  });

  await test("21quinquies. le champ d'identité porte le MÊME nom des deux côtés de la chaîne", () => {
    // ⚠️ PIÈGE CONNU DU DÉPÔT : la colonne s'appelle `exercise_library_id`, le
    // champ TypeScript `libraryExerciseId`. Les confondre rendrait `undefined`,
    // donc un repli silencieux sur le nom normalisé — et deux exercices de
    // banque différents portant le même nom partageraient alors leur réglage.
    const types = lire("../../types/index.ts");
    assert.ok(/AdminExercise[\s\S]{0,2000}libraryExerciseId\?: string/.test(types), "AdminExercise (builder)");
    assert.ok(/export interface Exercise \{[\s\S]{0,2000}libraryExerciseId\?: string \| null/.test(types), "Exercise (élève)");
    const reglage = sansCommentaires(sourceReglage);
    // Les DEUX noms existent légitimement dans ce module : `libraryExerciseId`
    // sur l'objet exercice, `exerciseLibraryId` sur la LIGNE de base (miroir
    // camelCase de la colonne). Ce qui doit être vrai, c'est qu'ils ne sont
    // jamais échangés. (Mon premier jet interdisait `exerciseLibraryId` tout
    // court : c'est le test qui était faux, pas le module.)
    assert.ok(reglage.includes("exercice.libraryExerciseId"), "l'objet exercice est lu par `libraryExerciseId`");
    assert.ok(!/exercice\.exerciseLibraryId/.test(reglage), "jamais le nom de colonne sur l'objet exercice");
    assert.ok(!/ligne\.libraryExerciseId/.test(reglage), "jamais le nom d'objet sur une ligne de base");
    assert.ok(/ligne\.exerciseLibraryId/.test(reglage), "la ligne de base est lue par `exerciseLibraryId`");
    // Et la couche d'accès fait bien le pont colonne → champ, dans ce sens.
    const acces = sansCommentaires(lire("../../lib/supabase/progression-reglage.ts"));
    assert.ok(
      /exerciseLibraryId: ligne\.exercise_library_id/.test(acces),
      "la colonne `exercise_library_id` alimente `exerciseLibraryId`",
    );
    // Le bouton reçoit l'objet exercice TEL QUEL, sans remappage intermédiaire
    // qui pourrait perdre le champ.
    const editeur = sansCommentaires(sourceEditeur);
    assert.ok(editeur.includes("<ProgressionAutomatiqueToggle exercise={exercise} />"), "objet passé tel quel");
    // Et côté élève, c'est l'exercice de la séance qui est interrogé.
    const section = sansCommentaires(lire("../../components/student/SessionFeedbackSection.tsx"));
    assert.ok(
      section.includes("progressionActivePourExercice(exercise)"),
      "le réglage est demandé pour l'exercice courant",
    );
  });

  await test("21quater. l'identifiant passé à la lecture élève est bien un `programs.id`", () => {
    // La policy joint `assignments.content_id` à `programs.id`. Si la page de
    // séance passait un identifiant de SÉANCE ou de SEMAINE, la lecture
    // rendrait zéro ligne — donc tout OFF, silencieusement.
    const page = sansCommentaires(lire("../../app/(student)/entrainement/seance/[sessionId]/page.tsx"));
    assert.ok(
      /useProgressionReglages\(\s*seance\.etat === "online" \|\| seance\.etat === "offline" \? \(seance\.contenu\?\.programId \?\? null\) : null,\s*\)/.test(page),
      "c'est `contenu.programId` qui est passé, pas un identifiant de séance",
    );
    assert.ok(!/useProgressionReglages\([^)]*sessionId/.test(page), "jamais un identifiant de séance");
    assert.ok(!/useProgressionReglages\([^)]*weekNumber/.test(page), "jamais un numéro de semaine");
    // Et le hook filtre lui-même l'identifiant vide avant toute requête.
    const hook = sansCommentaires(lire("../../hooks/useProgressionReglages.ts"));
    assert.ok(hook.includes("if (!programId) return;"), "aucune requête sans programme");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * SABOTAGE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("21. SABOTAGE — un réglage stocké PAR SEMAINE est pris en défaut", () => {
    // Le jeu d'essai discrimine : deux occurrences du même exercice, dans
    // deux semaines différentes, avec des identifiants de ligne différents.
    // Une clé contenant la semaine ou l'identifiant de ligne les séparerait.
    assert.equal(
      cleReglageDeLExercice(ELEV_S1),
      cleReglageDeLExercice(ELEV_S5),
      "même clé malgré des identifiants de ligne différents",
    );
    const apres = indexApresBascule(indexerReglages([]), ELEV_S1, true);
    assert.equal(progressionActivePour(apres, ELEV_S5), true, "la semaine 5 a suivi la semaine 1");
    assert.equal(apres.size, 1, "UNE entrée, pas une par semaine");
    // Et la clé ne mentionne littéralement aucune composante de semaine.
    const cle = cleReglageDeLExercice(ELEV_S1) ?? "";
    assert.ok(!cle.includes("new-exercise"), "l'identifiant de ligne n'entre pas dans la clé");
    assert.ok(!/\bs1\b|\bs5\b|semaine|week/i.test(cle), "aucune composante de semaine dans la clé");
    // Au rendu, les deux boutons affichent le même état.
    const html = rendreBoutons([ELEV_S1, ELEV_S5], {
      lignes: [{ exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: true }],
    });
    assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 2);
  });

  await test("22. SABOTAGE — une progression produite malgré OFF est prise en défaut", () => {
    const index = indexerReglages([
      { exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: false },
    ]);
    // Une référence PARFAITEMENT exploitable : si le OFF n'était pas
    // respecté, une recommandation sortirait — le jeu d'essai ne masque donc
    // pas le défaut par une absence de données.
    const entree = {
      groupe: "épaules" as const,
      repsPrescrites: "8-13",
      reference: { chargeKg: 10, reps: 13 },
    };
    assert.ok(indicateursDExercice({ ...entree, progressionActive: true }).ok, "ON : recommandation produite");
    const off = indicateursDExercice({ ...entree, progressionActive: progressionActivePour(index, ELEV_S1) });
    assert.equal(off.ok, false, "OFF : aucune recommandation");
    assert.equal(off.ok === false && off.motif, "progression-desactivee");
    // Et le OFF court-circuite AVANT tout calcul : même sans référence et
    // sans groupe tarifé, le motif reste celui du bouton.
    const offSansRien = indicateursDExercice({
      progressionActive: false,
      groupe: "cardio",
      repsPrescrites: "",
      reference: null,
    });
    assert.equal(offSansRien.ok === false && offSansRien.motif, "progression-desactivee");
  });

  await test("23. SABOTAGE — un défaut ON est pris en défaut", () => {
    // Aucune ligne pour cet exercice : la réponse DOIT être false.
    const vide = indexerReglages([]);
    assert.equal(progressionActivePour(vide, ELEV_S1), false);
    assert.equal(progressionActivePour(vide, LIBRE_S1), false);
    assert.equal(progressionActivePour(vide, { name: "" }), false);
    // Un autre exercice réglé à ON ne contamine pas celui qui n'a pas de ligne.
    const partiel = indexerReglages([
      { exerciseLibraryId: LIB_ELEV, exerciseNameNormalized: null, progressionActive: true },
    ]);
    assert.equal(progressionActivePour(partiel, DC_S1), false, "sans ligne, OFF — même si un voisin est ON");
    // Au rendu, un builder sans aucun réglage n'allume rien.
    const html = rendreBoutons([ELEV_S1, DC_S1, LIBRE_S1], { lignes: [] });
    assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 0, "aucun bouton allumé par défaut");
    assert.equal((html.match(/aria-checked="false"/g) ?? []).length, 3);
  });

  await test("24. l'historique reste accessible même lorsque OFF", () => {
    // Le réglage ne conditionne QUE la recommandation. La lecture de
    // l'historique — « Dernières perfs », placeholders — ne passe pas par
    // lui : aucun des deux modules d'historique ne le connaît.
    for (const chemin of ["../../lib/previous-performance.ts", "../../lib/reference-progression.ts"]) {
      const code = sansCommentaires(lire(chemin));
      assert.ok(!code.includes("progressionActive"), `${chemin} ignore le réglage`);
      assert.ok(!code.includes("progression_active"), `${chemin} ignore la colonne`);
    }
    // Et la carte élève affiche « Dernières perfs » indépendamment des
    // indicateurs : la prop `previous` n'est pas conditionnée par eux.
    const carte = sansCommentaires(lire("../../components/student/ExerciseFeedbackCard.tsx"));
    assert.ok(
      /previousLabel && \(/.test(carte) && !/indicateurs[^\n]*previousLabel/.test(carte),
      "la ligne d'historique ne dépend pas des indicateurs",
    );
  });

  await test("25. le module de réglage n'écrit jamais dans la base lui-même", () => {
    const code = sansCommentaires(sourceReglage);
    assert.ok(!code.includes("supabase") && !code.includes("createClient"), "module PUR, testable sans base");
    // Et la couche d'accès ne réinvente ni l'identité ni le défaut.
    const acces = sansCommentaires(lire("../../lib/supabase/progression-reglage.ts"));
    assert.ok(acces.includes("indexerReglages("), "l'indexation vient du module pur");
    assert.ok(!/\?\?\s*true|\|\|\s*true/.test(acces), "aucun défaut ON dans la couche d'accès");
  });

  await test("26. le bouton ne s'affiche pas hors de son fournisseur", () => {
    // Un interrupteur qui ne commande rien est pire qu'un interrupteur absent.
    const html = renderToString(createElement(ProgressionAutomatiqueToggle, { exercise: ELEV_S1 }));
    assert.equal(html, "", "aucun rendu sans contexte");
    const code = sansCommentaires(sourceToggle);
    assert.ok(code.includes("if (!contexte) return null;"), "la garde est explicite");
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
