/**
 * Harnais — SÉANCES MIXTES, ISOLATION, FC PAR SPORT, ARCHIVAGE À LA COMPLÉTION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER REFUSE DE LAISSER PASSER
 * ════════════════════════════════════════════════════════════════════════
 *   1. un enregistrement cardio qui partirait en portée complète (il
 *      supprimerait la musculation de la séance) ;
 *   2. une modification du calendrier d'un athlète qui atteindrait le PROGRAMME
 *      SOURCE, ou l'athlète d'à côté ;
 *   3. une FC de zone calculée contre la mauvaise référence, ou une FC inventée
 *      quand l'athlète n'en a aucune ;
 *   4. un retour de séance qui n'archiverait PAS les consignes réellement lues
 *      au moment de l'enregistrement — ou qui en inventerait sans références ;
 *   5. une deuxième convention de stockage du RPE cardio.
 *
 * Lancement : npm run test:cardio-mixte
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { orderedStudentSessionBlocks } from "../../lib/student-session-blocks";
import { cardioBlockPrescribedSnapshot, parseCardioResults, serializeCardioBlockResult, CARDIO_BLOCK_RESULT_VERSION } from "../../lib/cardio-feedback";
import { valeurPhysio, VALEUR_ABSENTE } from "../../lib/physiologie";
import { deplacerSeance, seancesDuCalendrier, supprimerSeance } from "../../lib/supabase/calendrier-seances";
import { fcMaxDuSport, ligneZone, tableauZones, type ReferencesAthlete } from "../../lib/zones-physiologiques";
import type { AdminWorkoutSession, TrainingBlock } from "../../types";
import type { StudentCardioBlockView, StudentSessionBlockView } from "../../lib/student-session-blocks";

const RACINE = new URL("../../", import.meta.url).pathname;
const lireSource = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");
const sansCommentaires = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

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

/* ── L'athlète de référence ────────────────────────────────────────────────── */
const JULES: ReferencesAthlete = {
  fcMax: valeurPhysio(190, "mesuree"),
  fcRepos: valeurPhysio(50, "mesuree"),
  vmaCourseKmh: valeurPhysio(11, "mesuree"),
  vmaNatationKmh: valeurPhysio(3, "mesuree"),
  ftpWatts: valeurPhysio(210, "mesuree"),
  pmaWatts: valeurPhysio(320, "mesuree"),
};

/* ════════════════════════════════════════════════════════════════════════
 * I. FC PAR SPORT — les trois sports, les trois replis, et l'absence
 * ════════════════════════════════════════════════════════════════════════ */

await test("FC1. COURSE : hr_max_run si renseignée, sinon la FC max générale", () => {
  const avec: ReferencesAthlete = { ...JULES, fcMaxParSport: { course: valeurPhysio(196, "mesuree") } };
  assert.equal(fcMaxDuSport("course", avec).valeur, 196);
  assert.equal(ligneZone("course", 2, avec).fc.libelle, "147 - 167", "85 % de 196 = 166,6 → 167");
  assert.equal(ligneZone("course", 2, avec).fcSpecifiqueAuSport, true);

  assert.equal(fcMaxDuSport("course", JULES).valeur, 190, "sans hr_max_run, c'est la FC max générale");
  assert.equal(ligneZone("course", 2, JULES).fc.libelle, "143 - 162");
  assert.equal(ligneZone("course", 2, JULES).fcSpecifiqueAuSport, false);
});

await test("FC2. VÉLO : hr_max_bike si renseignée, sinon la FC max générale", () => {
  const avec: ReferencesAthlete = { ...JULES, fcMaxParSport: { velo: valeurPhysio(182, "mesuree") } };
  assert.equal(fcMaxDuSport("velo", avec).valeur, 182);
  assert.equal(ligneZone("velo", 2, avec).fc.libelle, "137 - 155");
  assert.equal(fcMaxDuSport("velo", JULES).valeur, 190);
  assert.equal(ligneZone("velo", 2, JULES).fc.libelle, "143 - 162");
});

await test("FC3. NATATION : hr_max_swim si renseignée, sinon la FC max générale", () => {
  const avec: ReferencesAthlete = { ...JULES, fcMaxParSport: { natation: valeurPhysio(175, "mesuree") } };
  assert.equal(fcMaxDuSport("natation", avec).valeur, 175);
  assert.equal(ligneZone("natation", 2, avec).fc.libelle, "131 - 149");
  assert.equal(fcMaxDuSport("natation", JULES).valeur, 190);
  assert.equal(ligneZone("natation", 2, JULES).fc.libelle, "143 - 162");
});

await test("FC4. UNE FC SPÉCIFIQUE NE CONTAMINE PAS LES DEUX AUTRES SPORTS", () => {
  const references: ReferencesAthlete = {
    ...JULES,
    fcMaxParSport: { velo: valeurPhysio(182, "mesuree"), natation: valeurPhysio(175, "mesuree") },
  };
  assert.equal(fcMaxDuSport("course", references).valeur, 190, "la course n'a pas de FC propre : elle prend la générale");
  assert.equal(fcMaxDuSport("velo", references).valeur, 182);
  assert.equal(fcMaxDuSport("natation", references).valeur, 175);
});

await test("FC5. AUCUNE FC DU TOUT : rien n'est calculé, rien n'est affiché", () => {
  const sansFc: ReferencesAthlete = { ...JULES, fcMax: VALEUR_ABSENTE, fcRepos: VALEUR_ABSENTE };
  for (const sport of ["course", "velo", "natation"] as const) {
    for (const ligne of tableauZones(sport, sansFc)) {
      if (ligne.fc.nonSignificatif) continue;
      assert.equal(ligne.fc.referenceManquante, true, `${sport} Z${ligne.zone} : une FC a été fabriquée`);
      assert.equal(ligne.fc.min, null);
      assert.equal(ligne.fc.max, null);
      assert.equal(ligne.fc.libelle, "—", `${sport} Z${ligne.zone} : un chiffre s'affiche sans référence`);
    }
  }
  // Une FC spécifique à 0 ou négative n'est pas « renseignée ».
  const zero: ReferencesAthlete = { ...sansFc, fcMaxParSport: { course: valeurPhysio(0, "mesuree") } };
  assert.equal(fcMaxDuSport("course", zero).valeur, null);
});

await test("FC6. AUCUNE FORMULE D'ESTIMATION NULLE PART", () => {
  for (const chemin of ["lib/physiologie.ts", "lib/zones-physiologiques.ts", "lib/cardio-zones.ts", "lib/physiologie-champs.ts"]) {
    const source = sansCommentaires(lireSource(chemin));
    assert.ok(!/220\s*-\s*\w*age|207\s*-|Karvonen|0\.7\s*\*\s*age/i.test(source), `${chemin} contient une estimation de FC`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * II. RPE CARDIO — une seule convention, et pas deux
 * ════════════════════════════════════════════════════════════════════════ */

await test("RPE1. le RPE cardio vit dans `intensity_min`, et NULLE PART AILLEURS", () => {
  /*
   * ⚠️ DÉCISION DU 28/09/2026 : on ne refactore pas. `training_prescriptions.target_rpe`
   * existe (CHECK 0-10, demi-points) mais n'est ni écrite ni lue par
   * l'application, et la RPC ne la connaît pas ; les prescriptions déjà posées
   * portent leur RPE dans `intensity_min`. Ce test interdit à une NOUVELLE partie
   * du builder d'inventer la seconde convention.
   */
  const ecriture = sansCommentaires(lireSource("lib/supabase/training-session-blocks.ts"));
  const bloc = ecriture.slice(ecriture.indexOf("prescriptions: block.prescriptions.map"));
  assert.ok(!bloc.includes("target_rpe"), "le payload cardio écrit target_rpe : deuxième convention de RPE");
  assert.match(bloc, /intensity_min: seg\.intensityMin/, "le RPE cardio doit partir dans intensity_min");

  const lecture = sansCommentaires(lireSource("lib/supabase/programs.ts"));
  assert.ok(!/targetRpe|target_rpe/.test(lecture), "la lecture des segments cardio touche à target_rpe");

  const traduction = sansCommentaires(lireSource("lib/cardio-zones.ts"));
  assert.match(traduction, /const rpe = segment\.intensityMin;/, "la lecture du RPE doit rester intensity_min");

  const affichage = sansCommentaires(lireSource("lib/cardio.ts"));
  assert.match(affichage, /case "rpe":[\s\S]{0,200}segment\.intensityMin/, "l'affichage du RPE doit lire intensity_min");

  const migration = lireSource("supabase/migrations/20260930100000_cardio_builder_et_calendrier.sql");
  const insertion = migration.slice(migration.indexOf("insert into public.training_prescriptions"));
  assert.ok(
    !insertion.slice(0, insertion.indexOf(");")).includes("target_rpe"),
    "la RPC s'est mise à écrire target_rpe pour le cardio",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * III. ARCHIVAGE À LA COMPLÉTION — la prescription reste dynamique
 * ════════════════════════════════════════════════════════════════════════ */

const BLOC_ELEVE: StudentCardioBlockView = {
  kind: "cardio",
  id: "66666666-6666-4666-8666-666666666666",
  colorKey: "red",
  title: "VMA",
  cardioType: "vma_intervals",
  sport: "course",
  rounds: 4,
  segments: [
    { id: "s1", order: 0, segmentType: "warmup", title: "Échauffement", intensityTargetType: "zone", targetZone: 2, durationSeconds: 600 },
    { id: "s2", order: 1, segmentType: "repeat_group", title: "800 m", intensityTargetType: "vma_percentage", targetVmaPercentage: 105, repetitions: 4, distanceMeters: 800, recoveryDurationSeconds: 120 },
  ],
};

await test("ARCHIVE1. la prescription reste DYNAMIQUE : la même consigne suit la VMA de l'athlète", () => {
  const avant = cardioBlockPrescribedSnapshot(BLOC_ELEVE, JULES);
  const apres = cardioBlockPrescribedSnapshot(BLOC_ELEVE, { ...JULES, vmaCourseKmh: valeurPhysio(15, "mesuree") });
  assert.equal(avant.consignes?.[1].consigne, "105 % VMA");
  assert.equal(apres.consignes?.[1].consigne, "105 % VMA", "la consigne, elle, ne change pas");
  assert.deepEqual(avant.consignes?.[1].valeurs, ["11.55 km/h", "5:12 /km"]);
  assert.deepEqual(apres.consignes?.[1].valeurs, ["15.75 km/h", "3:49 /km"], "les valeurs suivent la nouvelle VMA");
});

await test("ARCHIVE2. à la complétion, les consignes LUES CE JOUR-LÀ sont archivées avec leurs références", () => {
  const snapshot = cardioBlockPrescribedSnapshot(BLOC_ELEVE, JULES);
  assert.equal(snapshot.durationSeconds !== null, true, "les totaux historiques restent calculés");
  assert.equal(snapshot.consignes?.length, 2);
  assert.equal(snapshot.consignes?.[0].titre, "Échauffement");
  assert.equal(snapshot.consignes?.[0].consigne, "Z2 — Endurance");
  assert.ok((snapshot.consignes?.[0].valeurs ?? []).some((v) => v.includes("km/h")), "les valeurs concrètes manquent");
  // Les références sont archivées : sans elles, « 11.55 km/h » ne serait pas relisible.
  assert.equal(snapshot.references?.vmaCourseKmh, 11);
  assert.equal(snapshot.references?.fcMax, 190);
  assert.equal(snapshot.references?.fcRepos, 50);
});

await test("ARCHIVE3. SANS références, rien n'est archivé — et rien n'est inventé", () => {
  const snapshot = cardioBlockPrescribedSnapshot(BLOC_ELEVE);
  assert.equal(snapshot.consignes, undefined, "des consignes ont été fabriquées sans références");
  assert.equal(snapshot.references, undefined);
  // Les totaux historiques, eux, restent là : ils ne dépendent d'aucune physiologie.
  assert.equal(snapshot.repetitions, 4);
});

await test("ARCHIVE4. AUCUNE COLONNE NOUVELLE : l'archivage passe par le retour existant", () => {
  const snapshot = cardioBlockPrescribedSnapshot(BLOC_ELEVE, JULES);
  const payload = serializeCardioBlockResult({
    version: CARDIO_BLOCK_RESULT_VERSION,
    blockId: BLOC_ELEVE.id,
    order: 0,
    title: "VMA",
    prescribed: snapshot,
    completed: true,
    durationSeconds: 2400,
    distanceMeters: 5200,
    elevationGainMeters: null,
    repetitionsDone: 4,
    rpe: 8,
    pain: "",
    comment: "",
  });
  // Le snapshot voyage dans le jsonb du retour — pas dans training_prescriptions.
  const relu = JSON.parse(payload.comment ?? "{}") as { prescribed: { consignes?: unknown[] } };
  assert.equal(relu.prescribed.consignes?.length, 2, "les consignes ne survivent pas à la sérialisation");

  // Et la relecture d'historique les retrouve.
  const parse = parseCardioResults([
    {
      id: "fb-1", exerciseName: payload.exerciseName, exerciseOrder: payload.exerciseOrder ?? 900,
      rpe: payload.rpe ?? null, comment: payload.comment ?? "", sets: [],
    } as never,
  ]);
  assert.equal(parse.blocks.length, 1, "le retour cardio n'est plus relisible");
  assert.equal(parse.blocks[0].prescribed.consignes?.length, 2);
  assert.equal(parse.blocks[0].prescribed.references?.vmaCourseKmh, 11);

  // AUCUNE colonne de snapshot n'a été ajoutée à training_prescriptions.
  for (const chemin of [
    "supabase/migrations/20260930100000_cardio_builder_et_calendrier.sql",
    "supabase/migrations/20260930090000_profil_physiologique.sql",
  ]) {
    const sql = lireSource(chemin);
    assert.ok(!/reference_snapshot/i.test(sql), `${chemin} ajoute une colonne de snapshot`);
  }
});

await test("ARCHIVE5. un ancien retour SANS consignes reste relisible", () => {
  /*
   * ⚠️ AUCUN SAUT DE VERSION. Le champ est ADDITIF et OPTIONNEL : les retours
   * déjà en base (format 2, sans `consignes`) se relisent à l'identique. Bumper
   * la version aurait rendu illisible tout l'historique cardio existant.
   */
  const ancien = parseCardioResults([
    {
      id: "fb-0", exerciseName: "Cardio · Résultats", exerciseOrder: 900, rpe: 7,
      comment: JSON.stringify({
        version: 2, blockId: "aaaa", order: 0, title: "Footing", completed: true,
        durationSeconds: 1800, distanceMeters: 5000, elevationGainMeters: null,
        repetitionsDone: null, rpe: 7, pain: "", comment: "",
        prescribed: { durationSeconds: 1800, distanceMeters: 5000, elevationGainMeters: null, repetitions: null },
      }),
      sets: [],
    } as never,
  ]);
  assert.equal(ancien.blocks.length, 1, "un ancien retour cardio n'est plus relisible");
  assert.equal(ancien.blocks[0].prescribed.consignes, undefined);
  assert.equal(CARDIO_BLOCK_RESULT_VERSION, 2, "la version du format ne doit pas changer");
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. ISOLATION — la copie de l'athlète, jamais la source, jamais le voisin
 * ════════════════════════════════════════════════════════════════════════ */

type Ligne = Record<string, unknown>;

function creerBase() {
  const tables = new Map<string, Ligne[]>();
  const ordres: { table: string; op: string; valeurs: Ligne; filtres: [string, unknown][] }[] = [];
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom) as Ligne[];
  };
  function from(nom: string) {
    const état: { op: "select" | "update" | "delete"; valeurs?: Ligne; filtres: [string, unknown][]; representation: boolean } =
      { op: "select", filtres: [], representation: false };
    const correspond = (l: Ligne) => état.filtres.every(([c, v]) => l[c] === v);
    const exécuter = (): Ligne[] => {
      const lignes = table(nom);
      if (état.op === "select") return lignes.filter(correspond).map((l) => ({ ...l }));
      if (état.op === "update") {
        ordres.push({ table: nom, op: "update", valeurs: { ...(état.valeurs ?? {}) }, filtres: [...état.filtres] });
        const touchées = lignes.filter(correspond);
        for (const l of touchées) Object.assign(l, état.valeurs);
        return touchées.map((l) => ({ ...l }));
      }
      const supprimées = lignes.filter(correspond).map((l) => ({ ...l }));
      ordres.push({ table: nom, op: "delete", valeurs: {}, filtres: [...état.filtres] });
      tables.set(nom, lignes.filter((l) => !correspond(l)));
      return supprimées;
    };
    const chaîne: Record<string, unknown> = {
      select: () => { état.representation = true; return chaîne; },
      update(v: Ligne) { état.op = "update"; état.valeurs = v; return chaîne; },
      delete() { état.op = "delete"; return chaîne; },
      eq(c: string, v: unknown) { état.filtres.push([c, v]); return chaîne; },
      then: (résoudre: (v: { data: Ligne[] | null; error: null }) => void) => {
        const lignes = exécuter();
        return Promise.resolve(résoudre({ data: état.op === "select" || état.representation ? lignes : null, error: null }));
      },
    };
    return chaîne;
  }
  return { client: { from } as never, table, ordres };
}

/**
 * Le décor RÉEL de l'individualisation : un MODÈLE et DEUX copies, chacune avec
 * SES propres lignes `workout_sessions`.
 */
function decorIndividualise() {
  const base = creerBase();
  base.table("workout_sessions").push(
    { id: "seance-modele", program_id: "modele", day: "Lundi", name: "Sem 1 Lundi", scheduled_date: null },
    { id: "seance-jules", program_id: "copie-jules", day: "Lundi", name: "Sem 1 Lundi", scheduled_date: null },
    { id: "seance-marco", program_id: "copie-marco", day: "Lundi", name: "Sem 1 Lundi", scheduled_date: null },
  );
  return base;
}

await test("ISO1. DÉPLACER la séance de Jules ne touche ni le modèle ni Marco", async () => {
  const base = decorIndividualise();
  const resultat = await deplacerSeance(base.client, "seance-jules", "2026-10-12");
  assert.equal(resultat.ok, true);
  assert.equal(base.table("workout_sessions").find((l) => l.id === "seance-jules")?.scheduled_date, "2026-10-12");
  assert.equal(base.table("workout_sessions").find((l) => l.id === "seance-modele")?.scheduled_date, null,
    "le PROGRAMME SOURCE a été modifié");
  assert.equal(base.table("workout_sessions").find((l) => l.id === "seance-marco")?.scheduled_date, null,
    "la séance de l'autre athlète a été modifiée");
  // L'ordre émis ne nomme qu'un identifiant de ligne.
  assert.deepEqual(base.ordres.at(-1)?.filtres, [["id", "seance-jules"]]);
});

await test("ISO2. SUPPRIMER la séance de Jules ne touche ni le modèle ni Marco", async () => {
  const base = decorIndividualise();
  await supprimerSeance(base.client, "seance-jules");
  assert.deepEqual(
    base.table("workout_sessions").map((l) => l.id).sort(),
    ["seance-marco", "seance-modele"],
    "la suppression a emporté une autre séance",
  );
});

await test("ISO3. le calendrier n'écrit JAMAIS la date de début du programme", () => {
  const source = sansCommentaires(lireSource("lib/supabase/calendrier-seances.ts"));
  assert.ok(!/program_start_date/.test(source), "le calendrier touche à program_start_date : déplacer UNE séance décalerait tout");
  assert.ok(!/from\("programs"\)/.test(source), "le calendrier écrit dans `programs` : le modèle pourrait être atteint");
  assert.ok(!/from\("assignments"\)/.test(source), "le calendrier écrit dans `assignments`");
  // Les seules tables écrites : workout_sessions (date, suppression, création).
  const ecritures = source.match(/\.from\("(\w+)"\)/g) ?? [];
  assert.deepEqual(
    [...new Set(ecritures)].sort(),
    ['.from("program_weeks")', '.from("workout_sessions")'],
    `le calendrier touche à d'autres tables que prévu : ${[...new Set(ecritures)].join(", ")}`,
  );
});

await test("ISO4. le calendrier lit la copie de l'ÉLÈVE, pas le modèle", () => {
  const source = sansCommentaires(lireSource("lib/supabase/calendrier-seances.ts"));
  assert.match(source, /getAssignedProgramForStudent\(supabase, studentId\)/,
    "la lecture doit partir de l'affectation de CET élève");
  assert.match(source, /getProgramStartDate\(supabase, studentId, programme\.id\)/);
});

/* ════════════════════════════════════════════════════════════════════════
 * V. SÉANCE MIXTE — la projection garde les deux catégories, dans l'ordre
 * ════════════════════════════════════════════════════════════════════════ */

const MUSCU_A: TrainingBlock = {
  id: "b-muscu-a", category: "strength", position: 0, title: "Muscu A", colorKey: "gray",
  exercises: [{ id: "e1", order: 0, name: "Squat", sets: 5, reps: "5", restSeconds: 120, tempo: "", recommendedLoad: "100kg", videoUrl: "", notes: "" }],
};
const CARDIO: TrainingBlock = {
  id: "b-cardio", category: "cardio", position: 1, title: "VMA", colorKey: "red",
  cardioType: "vma_intervals", sport: "course", rounds: 3,
  prescriptions: [{ id: "p1", order: 0, segmentType: "work", title: "Effort", intensityTargetType: "zone", targetZone: 4 }],
};
const MUSCU_B: TrainingBlock = {
  id: "b-muscu-b", category: "strength", position: 2, title: "Muscu B", colorKey: "green",
  exercises: [{ id: "e2", order: 0, name: "Gainage", sets: 3, reps: "45s", restSeconds: 60, tempo: "", recommendedLoad: "", videoUrl: "", notes: "" }],
};

function seance(blocks: TrainingBlock[]): AdminWorkoutSession {
  return {
    id: "s-mixte", programId: "copie-jules", weekNumber: 1, day: "Lundi", isRestDay: false,
    name: "Mixte", muscleGroup: "", durationMinutes: 75, warmup: "", coachNotes: "",
    exercises: [], blocks, updatedAt: "2026-09-28T10:00:00.000Z",
  };
}

await test("MIXTE1. muscu → cardio → muscu : l'entrelacement est conservé par la projection", () => {
  const [projetee] = seancesDuCalendrier([seance([MUSCU_A, CARDIO, MUSCU_B])], "2026-09-21");
  assert.equal(projetee.typeDerive, "mixed");
  assert.deepEqual(projetee.blocks.map((b) => b.category), ["strength", "cardio", "strength"]);
  assert.deepEqual(projetee.blocks.map((b) => b.position), [0, 1, 2]);
  assert.deepEqual(projetee.sports, ["course"]);
});

await test("MIXTE2. l'affichage élève garde les deux catégories, dans l'ordre de la séance", () => {
  const vues: StudentSessionBlockView[] = orderedStudentSessionBlocks({ blocks: [MUSCU_A, CARDIO, MUSCU_B] });
  assert.deepEqual(vues.map((v) => v.kind), ["strength", "cardio", "strength"]);
  const cardio = vues[1];
  assert.equal(cardio.kind === "cardio" ? cardio.sport : null, "course", "le sport doit atteindre l'écran élève");
  assert.equal(cardio.kind === "cardio" ? cardio.rounds : null, 3, "les séries doivent atteindre l'écran élève");
});

await test("MIXTE3. la projection élève N'INVENTE NI sport NI séries pour une ancienne séance", () => {
  /*
   * ⚠️ NON-RÉGRESSION EXIGÉE (décision du 28/09/2026). 441 blocs cardio de
   * production n'ont pas de sport et ne seront PAS migrés. La projection vers
   * l'écran élève doit les laisser vides : un `?? "course"` bien intentionné
   * ferait convertir des zones de vélo contre une VMA de course.
   */
  const ancien: TrainingBlock = {
    id: "b-ancien", category: "cardio", position: 0, title: "Footing", colorKey: "blue",
    cardioType: "easy_run", sport: undefined, rounds: undefined,
    prescriptions: [{ id: "p0", order: 0, segmentType: "single", title: "Footing", intensityTargetType: "heart_rate_zone", targetHrZone: "Zone 2" }],
  };
  const [vue] = orderedStudentSessionBlocks({ blocks: [ancien] });
  assert.equal(vue.kind, "cardio");
  assert.equal(vue.kind === "cardio" ? vue.sport : "x", undefined, "un sport a été inventé pour une ancienne séance");
  assert.equal(vue.kind === "cardio" ? vue.rounds : 0, undefined, "des séries ont été inventées");
  // Le chemin legacy (`cardioBlocks[]`, sans blocks[]) doit se comporter pareil.
  const [legacy] = orderedStudentSessionBlocks({
    cardioBlocks: [{ id: "c1", order: 0, title: "Footing", cardioType: "easy_run", segments: [] }],
  });
  assert.equal(legacy.kind === "cardio" ? legacy.sport : "x", undefined, "le chemin legacy invente un sport");
  assert.equal(legacy.kind === "cardio" ? legacy.rounds : 0, undefined);
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
