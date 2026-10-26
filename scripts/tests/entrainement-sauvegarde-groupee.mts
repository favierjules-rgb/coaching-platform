/**
 * Harnais — ENREGISTREMENT GROUPÉ D'UNE PROGRAMMATION (chantier
 * feat/entrainement-performances, lots A/B/C).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QU'IL PROUVE, ET CE QU'IL NE PEUT PAS PROUVER
 * ════════════════════════════════════════════════════════════════════════════
 * Il mesure le CHEMIN D'ÉCRITURE RÉEL du dépôt — `updateProgram` et
 * `calculerDiffProgrammation`, pas des copies — à travers un client Supabase
 * factice qui enregistre chaque requête. Ce qui est compté est donc ce qui
 * partirait vraiment sur le réseau.
 *
 * Il ne remplace PAS PostgreSQL. L'atomicité, la RLS, l'isolation entre coachs
 * et la préservation réelle des identifiants sont prouvées par
 * `supabase/tests/save_training_program_sessions_checklist.sql`, sur une base
 * locale reconstruite. Ici on prouve le comportement de l'APPLICATION :
 * combien de requêtes, avec quelle charge, et comment un refus est classé.
 *
 * ⚠️ AUCUNE ÉCRITURE RÉELLE. Aucun client Supabase n'est construit.
 *
 * Lancement : npx tsx scripts/tests/entrainement-sauvegarde-groupee.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  calculerDiffProgrammation,
  diffVide,
  empreinteSeance,
  seancesIdentiques,
} from "../../lib/program-diff";
import { updateProgram } from "../../lib/supabase/programs";
import {
  classerEchecGroupe,
  EchecEnregistrementGroupe,
} from "../../lib/supabase/training-program-save";
import { builderSaveUserMessage, isStaleTrainingSessionError } from "../../lib/admin-builder-save";
import type { AdminProgram, AdminWorkoutSession, TrainingBlock } from "../../types";

let réussis = 0;
let échecs = 0;
async function test(nom: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (e) {
    échecs += 1;
    console.log(`ÉCHEC - ${nom}`);
    console.log(e);
  }
}

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/**
 * Le SQL DÉBARRASSÉ de ses commentaires.
 *
 * ⚠️ INDISPENSABLE POUR TOUTE ASSERTION « CE MOT N'APPARAÎT PAS ». Les
 * migrations de ce chantier DOCUMENTENT longuement le plafond
 * `statement_timeout = 8s` — c'est le chiffre qui justifie leur existence. Une
 * assertion « aucune manipulation de statement_timeout » appliquée au fichier
 * BRUT attrapait donc sa propre documentation et rendait le test rouge alors
 * que la migration était juste. On mesure le CODE, jamais la prose.
 */
/**
 * Accès indexé qui ÉCHOUE BRUYAMMENT plutôt que de rendre `undefined`.
 *
 * ⚠️ PRÉFÉRÉ À `!`. Sous `noUncheckedIndexedAccess`, `sessions[3]` est
 * `T | undefined` — et c'est une bonne chose. Le `!` ferait taire le
 * compilateur sans rien garantir : si un jour le décor change de forme, le test
 * planterait sur un `undefined` au milieu d'une assertion, avec un message
 * incompréhensible. Ici il dit immédiatement quel index manquait.
 */
function element<T>(liste: readonly (T | undefined)[] | undefined, index: number, quoi: string): T {
  if (liste === undefined) throw new Error(`décor de test incomplet : ${quoi} absent`);
  const valeur = liste[index];
  if (valeur === undefined) throw new Error(`décor de test incomplet : ${quoi}[${index}] absent`);
  return valeur;
}

const sansProse = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*--.*$/gm, " ");

/* ══════════════════════════════════════════════════════════════════════════
 * DÉCOR
 * ══════════════════════════════════════════════════════════════════════════ */

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function bloc(i: number, nbEx = 3): TrainingBlock {
  return {
    id: uuid(500000 + i),
    category: "strength",
    title: `Bloc ${i}`,
    colorKey: "blue",
    position: 0,
    exercises: Array.from({ length: nbEx }, (_, k) => ({
      id: uuid(600000 + i * 20 + k),
      name: `Exercice ${k}`,
      sets: 4,
      reps: "8-10",
      restSeconds: 90,
      tempo: "2-0-2",
      recommendedLoad: "70%",
      recommendedRpe: "8",
      videoUrl: "",
      notes: "",
      muscleGroup: "pectoraux",
      libraryExerciseId: null,
      order: k,
    })),
  } as unknown as TrainingBlock;
}

/** Une programmation de `nbSemaines` × 7 jours (5 travaillés, 2 de repos). */
function programme(nbSemaines: number): AdminProgram {
  const sessions: AdminWorkoutSession[] = [];
  let n = 1;
  for (let w = 1; w <= nbSemaines; w += 1) {
    for (let d = 0; d < 7; d += 1) {
      const repos = d >= 5;
      sessions.push({
        id: uuid(10000 + n),
        programId: "prog",
        weekNumber: w,
        day: JOURS[d],
        isRestDay: repos,
        name: repos ? "Repos" : `Séance ${n}`,
        muscleGroup: "haut du corps",
        durationMinutes: 60,
        warmup: "10 min vélo",
        coachNotes: "Garde le dos droit",
        sessionType: "strength",
        bannerUrl: null,
        exercises: [],
        cardioBlocks: [],
        blocks: repos ? [] : [bloc(n)],
        updatedAt: "2026-10-01T00:00:00.000Z",
        scheduledDate: null,
      } as unknown as AdminWorkoutSession);
      n += 1;
    }
  }
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    name: "Programme",
    goal: "hypertrophie",
    level: "intermédiaire",
    durationWeeks: nbSemaines,
    description: "",
    status: "actif",
    assignedStudentIds: [],
    sessions,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    bannerUrl: null,
    programMode: "individuel",
    groupStartDate: null,
    isPublic: false,
    publicSubscriptionTemplateId: null,
  } as unknown as AdminProgram;
}

/** Copie profonde — pour muter la version sortante sans toucher l'instantané. */
const copie = (p: AdminProgram): AdminProgram => JSON.parse(JSON.stringify(p)) as AdminProgram;

const donneesBuilder = (p: AdminProgram) => ({
  name: p.name,
  goal: p.goal,
  level: p.level,
  durationWeeks: p.durationWeeks,
  description: p.description,
  status: p.status,
  sessions: p.sessions,
  bannerUrl: p.bannerUrl ?? null,
  programMode: p.programMode ?? "individuel",
  groupStartDate: p.groupStartDate ?? null,
  isPublic: p.isPublic ?? false,
  publicSubscriptionTemplateId: p.publicSubscriptionTemplateId ?? null,
});

interface Trace {
  requetes: { verbe: string; cible: string; octets: number }[];
  charges: Record<string, unknown>[];
}

function faireClient(opts?: { erreur?: string }): { db: unknown; trace: Trace } {
  const trace: Trace = { requetes: [], charges: [] };
  let seq = 900000;

  function constructeur(table: string) {
    const ctx: { verbe: string } = { verbe: "select" };
    const self: Record<string, unknown> = {};
    for (const k of ["eq", "in", "order", "range", "neq", "is", "not", "limit"]) self[k] = () => self;
    const note = (verbe: string, charge?: unknown) =>
      trace.requetes.push({
        verbe,
        cible: table,
        octets: charge === undefined ? 0 : Buffer.byteLength(JSON.stringify(charge)),
      });
    self.select = () => {
      if (ctx.verbe === "select") note("select");
      return self;
    };
    self.insert = (p: unknown) => { ctx.verbe = "insert"; note("insert", p); return self; };
    self.update = (p: unknown) => { ctx.verbe = "update"; note("update", p); return self; };
    self.delete = () => { ctx.verbe = "delete"; note("delete"); return self; };
    self.single = () => self;
    self.then = (r: (v: unknown) => unknown) =>
      Promise.resolve(r({ data: ctx.verbe === "select" ? [] : [{ id: "x" }], error: null, count: 0 }));
    return self;
  }

  const db = {
    from: (t: string) => constructeur(t),
    rpc: async (_fn: string, args: { p_payload: Record<string, unknown> }) => {
      const charge = args.p_payload;
      trace.requetes.push({ verbe: "rpc", cible: "save_training_program_sessions", octets: Buffer.byteLength(JSON.stringify(charge)) });
      trace.charges.push(charge);
      if (opts?.erreur) return { data: null, error: { message: opts.erreur } };
      const maj = (charge.sessions_to_update ?? []) as { session_id: string }[];
      const crees = (charge.sessions_to_create ?? []) as { client_id: string }[];
      return {
        data: {
          program_id: charge.program_id,
          program_updated_at: "2026-10-24T12:00:00.000Z",
          weeks: Object.fromEntries(((charge.weeks_to_create ?? []) as number[]).map((n) => [String(n), uuid(seq++)])),
          week_count: 12,
          session_count: maj.length + crees.length,
          sessions: [
            ...maj.map((x) => ({ client_id: null, session_id: x.session_id, updated_at: "2026-10-24T12:00:00.000Z", session_type: "strength", created: false, id_mapping: { blocks: {}, exercises: {} }, warnings: { detached_exercise_feedback_count: 0 } })),
            ...crees.map((x) => ({ client_id: x.client_id, session_id: uuid(seq++), updated_at: "2026-10-24T12:00:00.000Z", session_type: "strength", created: true, id_mapping: { blocks: {}, exercises: {} }, warnings: { detached_exercise_feedback_count: 0 } })),
          ],
        },
        error: null,
      };
    },
  };
  return { db, trace };
}

/* ══════════════════════════════════════════════════════════════════════════
 * I. LES QUATRE SCÉNARIOS D'ÉDITION — UNE REQUÊTE, ET SEULEMENT LE CHANGEMENT
 * ══════════════════════════════════════════════════════════════════════════ */

await test("1. MODIFICATION D'UN CHAMP : une seule requête, une seule séance envoyée", async () => {
  const instantane = programme(12);
  const sortant = copie(instantane);
  sortant.sessions[3].name = "Séance renommée";

  const { db, trace } = faireClient();
  const ok = await updateProgram(db as never, instantane.id, donneesBuilder(sortant) as never, instantane);

  assert.equal(ok, true);
  assert.equal(trace.requetes.length, 1, `une seule requête attendue, ${trace.requetes.length} émise(s)`);
  assert.equal(trace.requetes[0].verbe, "rpc", "et c'est l'appel groupé");

  const charge = trace.charges[0] as { sessions_to_update: unknown[]; sessions_to_create: unknown[]; program_patch?: unknown };
  assert.equal(charge.sessions_to_update.length, 1, "UNE séance modifiée, pas 84");
  assert.equal(charge.sessions_to_create.length, 0);
  assert.equal(charge.program_patch, undefined, "la tête est inchangée : elle n'est pas envoyée");

  // ⚠️ LE CHIFFRE DU CHANTIER. L'ancien chemin émettait 87 requêtes dont 87
  // séquentielles pour ce même changement (mesuré par instrumentation).
  assert.ok(trace.requetes[0].octets < 5000, `charge utile ${trace.requetes[0].octets} o — elle doit rester minuscule`);
});

await test("2. AJOUT D'UN EXERCICE : une requête, la séance concernée seule", async () => {
  const instantane = programme(12);
  const sortant = copie(instantane);
  const b = element(element(sortant.sessions, 3, "sessions").blocks, 0, "blocks") as unknown as { exercises: unknown[] };
  b.exercises.push({
    id: "new-exercise:11111111-1111-4111-8111-111111111111",
    name: "Développé incliné", sets: 3, reps: "10", restSeconds: 90, tempo: "",
    recommendedLoad: "", recommendedRpe: "", videoUrl: "", notes: "",
    muscleGroup: null, libraryExerciseId: null, order: 3,
  });

  const { db, trace } = faireClient();
  await updateProgram(db as never, instantane.id, donneesBuilder(sortant) as never, instantane);

  assert.equal(trace.requetes.length, 1);
  const charge = trace.charges[0] as { sessions_to_update: { session_id: string; blocks: { exercises: { id: string }[] }[] }[] };
  assert.equal(charge.sessions_to_update.length, 1);
  assert.equal(charge.sessions_to_update[0].session_id, instantane.sessions[3].id);
  const ids = charge.sessions_to_update[0].blocks[0].exercises.map((e) => e.id);
  assert.ok(ids.includes("new-exercise:11111111-1111-4111-8111-111111111111"), "le nouvel exercice part");
  assert.equal(ids.length, 4, "et les trois existants sont conservés");
});

await test("3. AJOUT D'UNE SEMAINE À 12 SEMAINES : une requête, 7 créations, 84 intactes", async () => {
  const instantane = programme(12);
  const sortant = copie(instantane);
  const semaine12 = sortant.sessions.filter((s) => s.weekNumber === 12);
  for (const [k, s] of semaine12.entries()) {
    sortant.sessions.push({
      ...JSON.parse(JSON.stringify(s)),
      id: `sess-neuve-${k}`,
      weekNumber: 13,
      updatedAt: undefined,
      blocks: (s.blocks as unknown as { exercises: { id: string }[] }[]).map((b, bi) => ({
        ...b,
        id: `new-block:2222222${bi}-2222-4222-8222-222222222222`,
        exercises: b.exercises.map((e, ei) => ({ ...e, id: `new-exercise:3333333${ei}-3333-4333-8333-333333333333` })),
      })),
    } as unknown as AdminWorkoutSession);
  }
  sortant.durationWeeks = 13;

  const { db, trace } = faireClient();
  await updateProgram(db as never, instantane.id, donneesBuilder(sortant) as never, instantane);

  assert.equal(trace.requetes.length, 1, "UNE requête — l'ancien chemin en émettait 100, toutes séquentielles");
  const charge = trace.charges[0] as {
    weeks_to_create: number[]; weeks_to_delete: number[];
    sessions_to_create: { week_number: number; client_id: string }[];
    sessions_to_update: unknown[]; sessions_to_delete: string[];
    program_patch?: { duration_weeks?: number };
  };
  assert.deepEqual(charge.weeks_to_create, [13], "la semaine 13 est créée");
  assert.deepEqual(charge.weeks_to_delete, [], "aucune semaine supprimée");
  assert.equal(charge.sessions_to_create.length, 7, "ses 7 jours sont créés");
  assert.ok(charge.sessions_to_create.every((s) => s.week_number === 13));
  assert.equal(charge.sessions_to_update.length, 0, "AUCUNE des 84 séances existantes n'est réécrite");
  assert.deepEqual(charge.sessions_to_delete, [], "et aucune n'est supprimée");
  assert.equal(charge.program_patch?.duration_weeks, 13, "la durée est mise à jour");
});

await test("4. MODIFICATION DE PLUSIEURS SÉANCES : une requête, exactement les séances touchées", async () => {
  const instantane = programme(12);
  const sortant = copie(instantane);
  const cibles = [0, 1, 7, 8, 14, 21, 28, 35, 42, 49];
  for (const i of cibles) sortant.sessions[i].coachNotes = "Consigne revue";

  const { db, trace } = faireClient();
  await updateProgram(db as never, instantane.id, donneesBuilder(sortant) as never, instantane);

  assert.equal(trace.requetes.length, 1);
  const charge = trace.charges[0] as { sessions_to_update: { session_id: string }[] };
  assert.equal(charge.sessions_to_update.length, 10, "dix séances, ni plus ni moins");
  const envoyees = new Set(charge.sessions_to_update.map((s) => s.session_id));
  for (const i of cibles) {
    assert.ok(envoyees.has(instantane.sessions[i].id), `la séance ${i} doit être envoyée`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * II. COMPATIBILITÉ ET NON-ÉCRITURE
 * ══════════════════════════════════════════════════════════════════════════ */

await test("5. COMPATIBILITÉ : une programmation existante rechargée telle quelle n'écrit RIEN", async () => {
  /*
   * ⚠️ LE TEST LE PLUS IMPORTANT DE CE FICHIER. Ouvrir une programmation de
   * 12 semaines et cliquer « Enregistrer » sans rien toucher ne doit émettre
   * AUCUNE requête. Si l'empreinte différait pour une raison triviale (un
   * `null` contre `""`, un ordre de clés), tout repartirait — et le chantier
   * n'aurait rien gagné sur le cas le plus courant.
   */
  const instantane = programme(12);
  const sortant = copie(instantane);

  const diff = calculerDiffProgrammation(instantane, sortant.sessions);
  assert.ok(diffVide(diff), "le diff doit être VIDE");
  assert.equal(diff.seancesInchangees, 84, "les 84 séances sont reconnues inchangées");

  const { db, trace } = faireClient();
  const ok = await updateProgram(db as never, instantane.id, donneesBuilder(sortant) as never, instantane);
  assert.equal(ok, true, "et c'est un SUCCÈS, pas une erreur");
  assert.equal(trace.requetes.length, 0, `aucune requête attendue, ${trace.requetes.length} émise(s)`);
});

await test("6. l'empreinte ignore `updatedAt` mais voit tout le contenu", () => {
  const p = programme(1);
  const a = p.sessions[0];
  // Une version serveur différente ne rend PAS la séance « modifiée » : c'est
  // une donnée de LIGNE (le verrou), pas un contenu.
  const b = { ...JSON.parse(JSON.stringify(a)), updatedAt: "2026-12-31T23:59:59.000Z" } as AdminWorkoutSession;
  assert.ok(seancesIdentiques(a, b), "un updatedAt différent ne change pas l'empreinte");

  for (const muter of [
    (s: AdminWorkoutSession) => { s.name = "Autre"; },
    (s: AdminWorkoutSession) => { s.coachNotes = "Autre"; },
    (s: AdminWorkoutSession) => { s.day = "dimanche"; },
    (s: AdminWorkoutSession) => { s.durationMinutes = 99; },
    (s: AdminWorkoutSession) => { s.warmup = "Autre"; },
    (s: AdminWorkoutSession) => { s.muscleGroup = "Autre"; },
    (s: AdminWorkoutSession) => { s.bannerUrl = "https://x/y.jpg"; },
    (s: AdminWorkoutSession) => { (element(s.blocks, 0, "blocks") as unknown as { title: string }).title = "Autre"; },
    (s: AdminWorkoutSession) => { element((element(s.blocks, 0, "blocks") as unknown as { exercises: { sets: number }[] }).exercises, 0, "exercises").sets = 9; },
    (s: AdminWorkoutSession) => { element((element(s.blocks, 0, "blocks") as unknown as { exercises: { reps: string }[] }).exercises, 0, "exercises").reps = "20"; },
    (s: AdminWorkoutSession) => { (element(s.blocks, 0, "blocks") as unknown as { exercises: unknown[] }).exercises.pop(); },
    (s: AdminWorkoutSession) => { s.blocks = []; },
  ]) {
    const modifiee = JSON.parse(JSON.stringify(a)) as AdminWorkoutSession;
    muter(modifiee);
    assert.ok(!seancesIdentiques(a, modifiee), `ce changement doit être VU : ${empreinteSeance(modifiee).slice(0, 40)}…`);
  }
});

await test("7. REPLI PRUDENT : sans instantané, tout est MODIFIÉ — jamais recréé", () => {
  /*
   * ⚠️ CE TEST FERME UN DÉFAUT RÉEL DU CHANTIER, trouvé par la sonde
   * d'instrumentation. Le diff déclarait « à créer » toute séance absente de
   * l'instantané. Sans instantané, les 84 séances d'une programmation existante
   * partaient donc en CRÉATION — et auraient été DUPLIQUÉES en base. Le repli
   * censé être prudent était le plus destructeur des chemins.
   */
  const p = programme(12);
  const diff = calculerDiffProgrammation(null, p.sessions);
  assert.equal(diff.seancesACreer.length, 0, "AUCUNE création : ces séances existent déjà");
  assert.equal(diff.seancesAModifier.length, 84, "les 84 sont déclarées modifiées");
  assert.equal(diff.sessionIdsASupprimer.length, 0, "et rien n'est supprimé sans instantané");
  assert.equal(diff.seancesInchangees, 0, "sans référence, aucune ne peut être déclarée inchangée");

  // Une séance VRAIMENT neuve (id du builder, pas d'updatedAt) reste une création.
  const neuve = { ...JSON.parse(JSON.stringify(p.sessions[0])), id: "sess-1730000000000-1", updatedAt: undefined };
  const diff2 = calculerDiffProgrammation(null, [neuve as unknown as AdminWorkoutSession]);
  assert.equal(diff2.seancesACreer.length, 1, "un id de builder sans updatedAt = création");
  assert.equal(diff2.seancesAModifier.length, 0);
});

await test("8. SUPPRESSIONS EXPLICITES : retirer une semaine nomme ses séances", () => {
  const instantane = programme(12);
  const sortant = copie(instantane);
  sortant.sessions = sortant.sessions.filter((s) => s.weekNumber !== 6);

  const diff = calculerDiffProgrammation(instantane, sortant.sessions);
  assert.deepEqual(diff.semainesASupprimer, [6]);
  assert.equal(diff.sessionIdsASupprimer.length, 7, "les 7 séances de la semaine 6 sont NOMMÉES");
  assert.equal(diff.seancesAModifier.length, 0, "et les 77 autres ne sont pas réécrites");
  assert.equal(diff.seancesInchangees, 77);

  // ⚠️ L'ABSENCE NE SUPPRIME PLUS. Un instantané PARTIEL (comme après une
  // lecture tronquée) ne doit pas faire disparaître ce qu'il n'a pas vu.
  const partiel = copie(instantane);
  partiel.sessions = partiel.sessions.slice(0, 10);
  const diff3 = calculerDiffProgrammation(partiel, instantane.sessions);
  assert.equal(diff3.sessionIdsASupprimer.length, 0, "une lecture partielle ne supprime RIEN");
});

/* ══════════════════════════════════════════════════════════════════════════
 * III. LES REFUS — IDENTIFIABLES, ET JAMAIS UN FAUX SUCCÈS
 * ══════════════════════════════════════════════════════════════════════════ */

await test("9. ÉCHEC EN MILIEU DE SAUVEGARDE : l'erreur remonte, aucun succès n'est déclaré", async () => {
  const instantane = programme(12);
  const sortant = copie(instantane);
  sortant.sessions[3].name = "Renommée";

  const { db, trace } = faireClient({
    erreur: "SESSION_FAILED 00000000-0000-4000-8000-000000002714: STALE_TRAINING_SESSION",
  });

  await assert.rejects(
    () => updateProgram(db as never, instantane.id, donneesBuilder(sortant) as never, instantane),
    (e: unknown) => e instanceof EchecEnregistrementGroupe && e.cause === "seance_perimee",
    "un refus doit LEVER, jamais rendre `false`",
  );
  assert.equal(trace.requetes.length, 1, "et une seule requête a été tentée");
});

await test("10. CONFLIT CONCURRENT : tête et séance périmées sont reconnues et orientent le coach", () => {
  for (const message of [
    "STALE_TRAINING_SESSION",
    "SESSION_FAILED abc: STALE_TRAINING_SESSION",
    "STALE_TRAINING_PROGRAM",
  ]) {
    const echec = classerEchecGroupe(message);
    assert.ok(["seance_perimee", "tete_perimee"].includes(echec.cause), `${message} → ${echec.cause}`);
    assert.ok(
      isStaleTrainingSessionError(new EchecEnregistrementGroupe(echec)),
      "l'orchestrateur doit le reconnaître comme un conflit optimiste",
    );
    const msg = builderSaveUserMessage({ kind: "stale" });
    assert.ok(msg && /recharge/i.test(msg), "et le message doit dire de recharger");
  }
});

await test("11. ACCÈS REFUSÉ hors périmètre : classé comme autorisation, pas comme panne", () => {
  for (const message of ["NOT_AUTHORIZED", "42501", "PROGRAM_HEAD_NOT_WRITABLE"]) {
    const echec = classerEchecGroupe(message);
    assert.ok(
      ["non_autorise", "tete_non_ecrivable"].includes(echec.cause),
      `${message} → ${echec.cause}`,
    );
    const msg = builderSaveUserMessage({ kind: "error", error: new EchecEnregistrementGroupe(echec) });
    assert.ok(msg && msg.length > 0, "un message actionnable est rendu");
    assert.ok(!/temps autorisé/i.test(msg), "et ce n'est PAS le message de délai dépassé");
  }
  const introuvable = classerEchecGroupe("PROGRAM_NOT_FOUND_OR_FORBIDDEN");
  assert.equal(introuvable.cause, "programme_introuvable");
});

await test("12. DÉLAI DÉPASSÉ : son propre message, et il dit que RIEN n'a été écrit", () => {
  /*
   * ⚠️ C'EST LA CONTRAINTE CENTRALE DU CHANTIER. Un dépassement de
   * `statement_timeout` (57014) rangé avec les refus de droits enverrait le
   * coach vérifier ses autorisations — un diagnostic FAUX — et masquerait un
   * problème de performance derrière un message d'erreur sans rapport.
   */
  for (const message of ["57014", "canceling statement due to statement timeout"]) {
    const echec = classerEchecGroupe(message);
    assert.equal(echec.cause, "delai_depasse", `${message} doit être un délai dépassé`);
    const msg = builderSaveUserMessage({ kind: "error", error: new EchecEnregistrementGroupe(echec) });
    assert.ok(msg && /temps autorisé/i.test(msg), "le message nomme le dépassement");
    assert.ok(msg && /Aucune modification n'a été enregistrée/.test(msg), "et affirme que rien n'a été écrit");
  }
});

await test("13. la séance fautive est extraite du message serveur", () => {
  const e = classerEchecGroupe("SESSION_FAILED 00000000-0000-4000-8000-000000002714: FOREIGN_BLOCK_ID");
  assert.equal(e.seance, "00000000-0000-4000-8000-000000002714");
  assert.equal(e.cause, "seance_refusee");
  assert.equal(classerEchecGroupe("INVALID_PAYLOAD: program_id manquant").cause, "charge_invalide");
  assert.equal(classerEchecGroupe("WEEK_INSERT_FAILED: 13").cause, "semaine_refusee");
});

await test("14. un résultat VIDE sans erreur n'est pas un succès", async () => {
  /*
   * Incident du 02/08/2026 : sous RLS, une absence de résultat a déjà voulu
   * dire « refusé ». Le service ne doit donc jamais interpréter `data == null`
   * comme une réussite.
   */
  const instantane = programme(1);
  const sortant = copie(instantane);
  sortant.sessions[0].name = "X";
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ then: (r: (v: unknown) => unknown) => Promise.resolve(r({ data: [], error: null })) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  };
  await assert.rejects(
    () => updateProgram(db as never, instantane.id, donneesBuilder(sortant) as never, instantane),
    (e: unknown) => e instanceof EchecEnregistrementGroupe,
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * IV. PROPRIÉTÉS DE STRUCTURE
 * ══════════════════════════════════════════════════════════════════════════ */

await test("15. le module de diff est PUR : aucune lecture réseau", () => {
  const code = lire("../../lib/program-diff.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const interdit of ["supabase", ".from(", "await ", "fetch(", "createClient"]) {
    assert.ok(!code.includes(interdit), `le diff doit rester pur — « ${interdit} » trouvé`);
  }
});

await test("16. le service groupé ne fait AUCUNE mutation directe, et un seul rpc", () => {
  const code = lire("../../lib/supabase/training-program-save.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const mutation of [".insert(", ".update(", ".delete(", ".upsert("]) {
    assert.ok(!code.includes(mutation), `aucune ${mutation} ne doit subsister`);
  }
  assert.equal((code.match(/rpc\(/g) ?? []).length, 1, "un seul appel rpc");
  assert.ok(code.includes(".bind(supabase)"), "`rpc` doit rester liée au client (sinon `this.rest` est perdu)");
});

await test("17. la RPC groupée est security invoker et délègue au moteur par séance", () => {
  const sql = lire("../../supabase/migrations/20261027090000_save_training_program_sessions_rpc.sql");
  assert.ok(/security invoker/.test(sql), "security invoker — la RLS doit s'appliquer");
  assert.ok(!/security definer/i.test(sql.slice(sql.indexOf("create or replace function public.save_training_program_sessions"), sql.indexOf("comment on function"))),
    "elle ne doit PAS être SECURITY DEFINER");
  assert.ok(sql.includes("public.save_training_session_blocks("), "elle délègue le contenu au moteur existant");
  assert.ok(sql.includes("for update"), "elle verrouille la ligne du programme (sauvegardes concurrentes)");
  assert.ok(sql.includes("STALE_TRAINING_PROGRAM"), "verrou optimiste de tête");
  assert.ok(sql.includes("revoke execute") && sql.includes("grant execute on function public.save_training_program_sessions(jsonb) to authenticated"),
    "droits bornés à authenticated");
  // Aucune augmentation de timeout, nulle part — mesurée sur le CODE : l'en-tête
  // de la migration cite le plafond de 8 s, puisque c'est lui qui la justifie.
  assert.ok(!/statement_timeout/i.test(sansProse(sql)), "aucune manipulation de statement_timeout");
});

await test("18. les prédicats RLS prouvent leur équivalence AVANT de remplacer les policies", () => {
  const sql = lire("../../supabase/migrations/20261028090000_entrainement_predicats_rls_scalaires.sql");
  const code = sansProse(sql);
  // ⚠️ LES DEUX POSITIONS SE MESURENT SUR LA MÊME CHAÎNE. Les chercher l'une
  // dans le SQL brut et l'autre dans le SQL sans commentaires comparait des
  // index de deux textes différents : retirer les commentaires décale tout vers
  // le début, et la comparaison devenait fausse sans rien dire d'utile.
  // « ÉQUIVALENCE ROMPUE » vit dans un `raise exception`, donc dans le CODE :
  // elle survit au nettoyage.
  const iPreuve = code.indexOf("ÉQUIVALENCE ROMPUE");
  // ⚠️ LA PREMIÈRE POLICY RÉÉCRITE, QUELLE QUE SOIT SA TABLE. L'assertion
  // nommait `programs_manage_staff_select` ; cette policy n'est plus réécrite
  // du tout (voir plus bas), et le test est devenu rouge pour une bonne
  // nouvelle. On mesure la PROPRIÉTÉ — la preuve passe avant la première
  // écriture de sécurité — et non le nom d'une policy donnée.
  const iPolicy = code.search(/create policy \w+_manage_staff_/);
  assert.ok(iPreuve > -1, "la preuve d'équivalence existe");
  assert.ok(iPolicy > -1, "au moins une policy est réécrite");
  assert.ok(iPreuve < iPolicy, "la preuve doit s'exécuter AVANT toute réécriture de policy");
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ L'INTERDICTION TOTALE DE `statement_timeout` EST DEVENUE FAUSSE ICI —
   * ET IL FAUT DIRE POURQUOI, PAS SEULEMENT LA RETIRER.
   * ════════════════════════════════════════════════════════════════════════
   * Le garde d'origine servait une règle du chantier : ne jamais faire passer
   * une opération lente en relevant le plafond. Il reste JUSTE pour le lot B
   * (test 17 : zéro occurrence, même pas en commentaire).
   *
   * Mais le lot C doit PROUVER que les 9 prédicats scalaires rendent le même
   * verdict que les fonctions d'ensemble, sur toutes les lignes et toutes les
   * identités, AVANT de remplacer les 20 policies — 34 352 comparaisons,
   * mesurées à 38,8 s sur volumétrie de production (39 identités, 4 classes).
   * Cette preuve est une vérification UNIQUE, pas un chemin d'exécution. Lui
   * imposer le plafond du chemin d'exécution obligerait à la supprimer, ce qui
   * est précisément ce que ce chantier refuse de faire.
   *
   * CE QUI REND LE RÉGLAGE INOFFENSIF, et ce que ce test vérifie désormais :
   * `SET LOCAL` est borné à la TRANSACTION COURANTE (sémantique PostgreSQL :
   * la valeur revient à la fin de la transaction), et `supabase db push`
   * applique chaque fichier de migration dans SA PROPRE transaction — vérifié
   * expérimentalement, pas supposé : sur une base plafonnée à 3 s, un fichier
   * qui crée une table, une fonction et une policy puis dépasse le plafond
   * laisse les trois objets ABSENTS et n'écrit aucune ligne d'historique. Au
   * commit du fichier, le réglage disparaît donc de lui-même. Le plafond de
   * 8 s du rôle `authenticated` — celui qui borne les sauvegardes réelles des
   * coachs — n'est pas touché une seule seconde.
   *
   * On passe donc d'un « aucune occurrence » à cinq contrôles PLUS STRICTS :
   * la forme exacte, l'absence de forme de session, l'absence de réglage de
   * rôle ou global, l'absence de set_config déguisé, et la couverture
   * effective de la preuve par le réglage.
   */
  assert.equal((code.match(/statement_timeout/gi) ?? []).length, 1,
    "un seul réglage de statement_timeout dans le code de la migration");
  assert.match(code, /set\s+local\s+statement_timeout\s*=\s*'300s'\s*;/i,
    "C règle le plafond par `SET LOCAL statement_timeout = '300s'`, borné à la transaction");
  /*
   * ⚠️ `\bset` ne matche NI `set local …` (le mot qui suit est `local`), NI
   * `reset …` (le `s` y est précédé d'une lettre, donc pas de frontière de
   * mot). Le motif ne cible donc que la forme de SESSION — celle qui fuirait
   * sur les migrations appliquées ENSUITE, puisque `db push` peut réutiliser
   * la même connexion d'un fichier au suivant.
   */
  assert.ok(!/\bset\s+statement_timeout/i.test(code),
    "aucun `SET statement_timeout` de session : il fuirait hors de la transaction de migration");
  assert.ok(!/\balter\s+(role|database|system)\b/i.test(code),
    "aucun ALTER ROLE / ALTER DATABASE / ALTER SYSTEM : le plafond des rôles reste celui de la production");
  assert.ok(!/set_config\s*\([^)]*statement_timeout/i.test(code),
    "aucun set_config() sur statement_timeout : sa 3e position `false` serait un réglage de session déguisé");
  assert.ok(!/pg_reload_conf/i.test(code),
    "aucun rechargement de la configuration serveur");
  // Le réglage doit effectivement COUVRIR la preuve : être posé avant elle.
  const iTimeout = code.search(/set\s+local\s+statement_timeout/i);
  assert.ok(iTimeout > -1 && iTimeout < iPreuve,
    "le réglage est posé AVANT la preuve, donc il la couvre");
  // Les fonctions d'ensemble ne sont pas supprimées : d'autres chantiers en dépendent.
  assert.ok(!/drop function[\s\S]*_ids_(ecriture|lecture)/i.test(code), "les fonctions d'ensemble sont conservées");
  // Les policies de l'élève ne sont pas touchées.
  assert.ok(
    !/select_assigned_student/.test(code.replace(/raise exception[^;]*;/g, "").replace(/'[^']*select_assigned_student[^']*'/g, "")),
    "aucune policy élève n'est recréée par ce chantier",
  );
});

await test("18 bis. AUCUNE policy de `programs` n'est réécrite, et c'est une correction", () => {
  /*
   * ⚠️ CE TEST EXISTE PARCE QUE LA PREMIÈRE VERSION A CASSÉ LA CRÉATION DE
   * PROGRAMMATION, et que `programmes_cloisonnement_coach` l'a dit : 70
   * contrôles et 0 échec sur origin/main, 70 contrôles et 10 ÉCHECS avec la
   * migration (D5, D6, D7, D9, E10, puis H1 à H6).
   *
   * Deux fautes distinctes, l'une et l'autre reproduites sur base locale :
   *   1. `for select using (programme_lisible(id))` faisait échouer
   *      `INSERT … RETURNING` — `RETURNING` consulte la policy SELECT, et le
   *      prédicat va chercher dans `programs` une ligne que son instantané
   *      `STABLE` ne contient pas encore. `createProgram` fait
   *      `.insert(…).select("id").single()` : plus aucune création possible.
   *   2. La réécriture « en ligne » perdait un `coalesce(…, false)`, ce qui
   *      faisait remonter le sous-plan en `InitPlan` inconditionnel et faisait
   *      LEVER la vitrine publique pour `anon`
   *      (« permission denied for function student_ids_entrainement_lecture »).
   *
   * La conclusion n'a pas été de corriger la réécriture mais de ne pas
   * réécrire : `programs` compte 29 lignes et `program_ids_*()` s'évalue en
   * 6,7 ms — il n'y a rien à y gagner.
   */
  const code = sansProse(
    lire("../../supabase/migrations/20261028090000_entrainement_predicats_rls_scalaires.sql"),
  );
  assert.ok(
    !/create policy programs_manage_staff_/.test(code),
    "aucune policy manage_staff de `programs` ne doit être recréée : INSERT … RETURNING serait refusé",
  );
  assert.ok(
    !/drop policy if exists programs_manage_staff_/.test(code),
    "aucune policy manage_staff de `programs` ne doit être supprimée",
  );
  // Les cinq tables ENFANTS, elles, sont bien réécrites : 4 commandes chacune.
  assert.equal(
    (code.match(/create policy (program_weeks|workout_sessions|training_blocks|workout_exercises|training_prescriptions)_manage_staff_/g) ?? []).length,
    20,
    "les cinq tables enfants doivent porter leurs 4 policies réécrites",
  );
});

await test("19. les trois index sont additifs et ne touchent aucun index existant", () => {
  const sql = lire("../../supabase/migrations/20261026090000_entrainement_index_cles_etrangeres.sql");
  assert.equal((sql.match(/create index if not exists/g) ?? []).length, 3, "exactement trois index");
  assert.ok(!/drop index/i.test(sql), "aucun index supprimé");
  assert.ok(!/alter table/i.test(sql), "aucune table altérée");
  assert.ok(!/\bdelete\b|\binsert into\b|\bupdate .* set\b/i.test(sql.replace(/--[^\n]*/g, "")), "aucune écriture de données");
  for (const cible of [
    "workout_exercises_session_id_idx\n  on public.workout_exercises (session_id)",
    "workout_sessions_program_week_id_idx\n  on public.workout_sessions (program_week_id)",
    "workout_sessions_program_id_idx\n  on public.workout_sessions (program_id)",
  ]) {
    assert.ok(sql.includes(cible), `index manquant ou mal formé : ${cible.split("\n")[0]}`);
  }
  // Et le contrôle 2 de la migration refuse explicitement un index partiel.
  assert.ok(/index partiel/.test(sql), "la migration refuse un index partiel");
});

console.log(`\n${réussis} réussi(s), ${échecs} échec(s).`);
if (échecs > 0) process.exit(1);
