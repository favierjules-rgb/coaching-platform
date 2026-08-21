/**
 * Harnais — chemin d'enregistrement du builder (incident production 02/08).
 *
 * Cause démontrée par les logs Postgres/auth : trois « NOT_AUTHORIZED » émis
 * par save_training_session_blocks pendant que la session du navigateur
 * appartenait au compte élève de test (connexions alternées admin/élève).
 * Sous RLS, l'UPDATE de tête d'updateProgram ne renvoyait NI erreur NI ligne
 * → true, puis la structure échouait derrière un libellé générique.
 *
 * Correctif testé ici : 0 ligne modifiée = échec NET avant toute écriture de
 * structure + message actionnable (builderSaveUserMessage) au lieu du
 * générique. Le VRAI updateProgram tourne sur une base factice dont la RPC
 * save_training_session_blocks est émulée (verrou optimiste compris).
 *
 * Lancement : npx tsx scripts/tests/builder-save-path.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { builderSaveUserMessage, orchestrateBuilderSave } from "../../lib/admin-builder-save";
import { updateProgram } from "../../lib/supabase/programs";
import type { ProgramBuilderData } from "../../components/admin/ProgramBuilder";
import type { AdminWorkoutSession } from "../../types";

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

/* ─── Base factice : chaînes Supabase + RPC save_training_session_blocks ─── */
type Ligne = Record<string, unknown>;
function creerBase() {
  const tables = new Map<string, Ligne[]>();
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };
  let compteur = 0;
  let horloge = 1;

  function from(nom: string) {
    const état: { op: "select" | "insert" | "update" | "delete"; valeurs?: Ligne; filtres: Array<[string, unknown]>; } = { op: "select", filtres: [] };
    const correspond = (l: Ligne) =>
      état.filtres.every(([c, v]) => (c.startsWith("__in__") ? (v as unknown[]).includes(l[c.slice(6)]) : l[c] === v));
    const exécuter = () => {
      const lignes = table(nom);
      if (état.op === "select") return lignes.filter(correspond).map((l) => ({ ...l }));
      if (état.op === "insert") {
        const ligne = { id: `${nom}-${(compteur += 1)}`, updated_at: `t${(horloge += 1)}`, ...état.valeurs };
        lignes.push(ligne);
        return [{ ...ligne }];
      }
      if (état.op === "update") {
        const touchées = lignes.filter(correspond);
        for (const l of touchées) Object.assign(l, état.valeurs);
        return touchées.map((l) => ({ ...l }));
      }
      const gardées = lignes.filter((l) => !correspond(l));
      const n = lignes.length - gardées.length;
      tables.set(nom, gardées);
      return new Array(n).fill({});
    };
    const chaîne: Record<string, unknown> = {
      select: () => chaîne,
      insert(v: Ligne) { état.op = "insert"; état.valeurs = v; return chaîne; },
      update(v: Ligne) { état.op = "update"; état.valeurs = v; return chaîne; },
      delete() { état.op = "delete"; return chaîne; },
      eq(c: string, v: unknown) { état.filtres.push([c, v]); return chaîne; },
      in(c: string, v: unknown[]) { état.filtres.push([`__in__${c}`, v]); return chaîne; },
      limit: () => chaîne,
      maybeSingle: () => Promise.resolve({ data: exécuter()[0] ?? null, error: null }),
      single: () => {
        const r = exécuter();
        return Promise.resolve({ data: r[0] ?? null, error: r[0] ? null : { message: "aucune ligne" } });
      },
      then: (résoudre: (v: { data: Ligne[]; error: null }) => void) => résoudre({ data: exécuter(), error: null }),
    };
    return chaîne;
  }

  /** Émulation fidèle de save_training_session_blocks : garde staff, verrou optimiste, patch de séance, bump updated_at. */
  let sansDroitsStaff = false;
  function rpc(fn: string, args: { p_payload: Record<string, unknown> }) {
    if (fn !== "save_training_session_blocks") return Promise.resolve({ data: null, error: { message: `fonction inconnue ${fn}` } });
    if (sansDroitsStaff) return Promise.resolve({ data: null, error: { message: "NOT_AUTHORIZED" } });
    const p = args.p_payload;
    const session = table("workout_sessions").find((s) => s.id === p.session_id);
    if (!session) return Promise.resolve({ data: null, error: { message: "SESSION_NOT_FOUND_OR_FORBIDDEN" } });
    if (session.updated_at !== p.expected_updated_at) return Promise.resolve({ data: null, error: { message: "STALE_TRAINING_SESSION" } });
    const patch = (p.session_patch ?? {}) as Record<string, unknown>;
    if (typeof patch.name === "string") session.name = patch.name;
    session.updated_at = `t${(horloge += 1)}`;
    return Promise.resolve({
      data: {
        session_id: session.id, updated_at: session.updated_at, session_type: "rest",
        blocks: [], id_mapping: { blocks: {}, exercises: {} }, warnings: { detached_exercise_feedback_count: 0 },
      },
      error: null,
    });
  }

  return { client: { from, rpc } as never, table, setSansDroits: (v: boolean) => { sansDroitsStaff = v; } };
}

function seance(id: string, updatedAt: string, nom = "Séance A"): AdminWorkoutSession {
  return {
    id, weekNumber: 1, day: "Lundi", name: nom, muscleGroup: "", durationMinutes: 60,
    warmup: "", coachNotes: "", isRestDay: false, updatedAt,
    exercises: [], cardioBlocks: [], blocks: [],
  } as unknown as AdminWorkoutSession;
}

function données(nom: string, sessions: AdminWorkoutSession[], programMode = "individuel"): ProgramBuilderData {
  return {
    name: nom, goal: "", level: "", durationWeeks: 1, description: "", status: "actif",
    programMode, groupStartDate: null, isPublic: false, publicSubscriptionTemplateId: null, sessions,
  } as unknown as ProgramBuilderData;
}

let seedCompteur = 0;
/** Les ids de séance doivent être de VRAIS uuid (validés par saveTrainingSessionBlocks). */
function seedProgramme(base: ReturnType<typeof creerBase>, id: string, extra: Ligne = {}): string {
  const sessionId = `00000000-0000-4000-8000-${String((seedCompteur += 1)).padStart(12, "0")}`;
  base.table("programs").push({ id, name: id, status: "actif", program_mode: "individuel", is_public: false, owner_student_id: null, source_template_id: null, source_checkout_session_id: null, ...extra });
  base.table("program_weeks").push({ id: `w-${id}`, program_id: id, week_number: 1 });
  base.table("workout_sessions").push({ id: sessionId, program_id: id, program_week_id: `w-${id}`, day: "Lundi", name: "Séance A", updated_at: "t1" });
  return sessionId;
}

const sourceProgrammes = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
// Corps d'updateProgram, COMMENTAIRES exclus : les gardes textuelles portent
// sur le code exécutable uniquement (les commentaires citent les colonnes).
const blocUpdateProgram = sourceProgrammes
  .slice(
    sourceProgrammes.indexOf("export async function updateProgram"),
    sourceProgrammes.indexOf("export async function deleteProgram"),
  )
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

await (async () => {
  await test("1. sauvegarde d'un programme MODÈLE : tête + structure, réussite nette", async () => {
    const base = creerBase();
    const sid = seedProgramme(base, "prog-t");
    assert.equal(await updateProgram(base.client, "prog-t", données("Modèle V2", [seance(sid, "t1")])), true);
    assert.equal(base.table("programs")[0].name, "Modèle V2", "tête mise à jour");
    assert.notEqual(base.table("workout_sessions")[0].updated_at, "t1", "structure passée par la RPC (bump)");
  });

  await test("2. sauvegarde d'un programme de GROUPE : partagé, aucune copie créée", async () => {
    const base = creerBase();
    const sid = seedProgramme(base, "prog-g", { program_mode: "groupe" });
    assert.ok(await updateProgram(base.client, "prog-g", données("Groupe V2", [seance(sid, "t1")], "groupe")));
    assert.equal(base.table("programs").length, 1, "aucune copie");
    assert.equal(base.table("programs")[0].program_mode, "groupe");
  });

  await test("3. sauvegarde d'une COPIE individuelle : modifiée en place", async () => {
    const base = creerBase();
    const sid = seedProgramme(base, "prog-c", { owner_student_id: "eleve-1", source_template_id: "prog-t" });
    assert.ok(await updateProgram(base.client, "prog-c", données("Copie V2", [seance(sid, "t1")])));
    assert.equal(base.table("programs")[0].name, "Copie V2");
    assert.equal(base.table("programs").length, 1, "jamais une nouvelle copie à la sauvegarde");
  });

  await test("4-5. owner_student_id et source_template_id sont CONSERVÉS", async () => {
    const base = creerBase();
    const sid = seedProgramme(base, "prog-c", { owner_student_id: "eleve-1", source_template_id: "prog-t" });
    await updateProgram(base.client, "prog-c", données("Copie V3", [seance(sid, "t1")]));
    const copie = base.table("programs")[0];
    assert.equal(copie.owner_student_id, "eleve-1", "propriété conservée");
    assert.equal(copie.source_template_id, "prog-t", "rattachement au modèle conservé");
    // Et par construction : le payload d'update ne touche JAMAIS ces colonnes.
    assert.ok(!/owner_student_id|source_template_id|source_checkout_session_id/.test(blocUpdateProgram),
      "updateProgram n'écrit jamais owner/source/session d'achat");
  });

  await test("6. une modification de séance est visible par l'élève (même ligne)", async () => {
    const base = creerBase();
    const sid = seedProgramme(base, "prog-c", { owner_student_id: "eleve-1", source_template_id: "prog-t" });
    const s = seance(sid, "t1", "Séance RENFORCÉE");
    await updateProgram(base.client, "prog-c", données("Copie V2", [s]));
    assert.equal(base.table("workout_sessions")[0].name, "Séance RENFORCÉE",
      "la séance future reflète la modification — l'élève lit cette ligne");
  });

  await test("7. l'ancienne « Prescription au moment de la séance » reste intacte", async () => {
    const base = creerBase();
    const sid = seedProgramme(base, "prog-c", { owner_student_id: "eleve-1", source_template_id: "prog-t" });
    base.table("workout_feedback").push({ id: "fb-1", student_id: "eleve-1", session_id: sid, prescribed_snapshot: { version: 1, sessionName: "Séance A" } });
    await updateProgram(base.client, "prog-c", données("Copie V2", [seance(sid, "t1", "Séance CHANGÉE")]));
    const fb = base.table("workout_feedback")[0];
    assert.deepEqual(fb.prescribed_snapshot, { version: 1, sessionName: "Séance A" },
      "le snapshot figé ne bouge pas quand le builder modifie la séance");
    assert.ok(!/workout_feedback/.test(blocUpdateProgram), "updateProgram ne touche jamais les retours");
  });

  await test("8. aucun doublon de semaine/séance après une seconde sauvegarde", async () => {
    const base = creerBase();
    const sid = seedProgramme(base, "prog-t");
    await updateProgram(base.client, "prog-t", données("V2", [seance(sid, "t1")]));
    const updatedAtFrais = base.table("workout_sessions")[0].updated_at as string;
    await updateProgram(base.client, "prog-t", données("V3", [seance(sid, updatedAtFrais)]));
    assert.equal(base.table("program_weeks").length, 1, "une seule semaine");
    assert.equal(base.table("workout_sessions").length, 1, "une seule séance");
  });

  await test("9. aucune nouvelle copie ni assignation lors d'une sauvegarde", async () => {
    const base = creerBase();
    const sid = seedProgramme(base, "prog-c", { owner_student_id: "eleve-1", source_template_id: "prog-t" });
    await updateProgram(base.client, "prog-c", données("V2", [seance(sid, "t1")]));
    await updateProgram(base.client, "prog-c", données("V3", [seance(sid, base.table("workout_sessions")[0].updated_at as string)]));
    assert.equal(base.table("programs").length, 1);
    assert.equal(base.table("assignments").length, 0, "jamais de réassignation ni d'email depuis le builder");
    assert.ok(!/provisionPurchasedProgram|individualizeProgramForStudent|assignSharedProgram|duplicateProgramCore|content-assigned/.test(blocUpdateProgram),
      "updateProgram n'appelle aucun chemin de provisionnement/email");
  });

  await test("10. le chemin ACHAT UNIQUE est conservé (hors du builder, intact)", () => {
    assert.ok(/export async function provisionPurchasedProgram/.test(sourceProgrammes),
      "le provisionnement d'achat existe toujours");
    assert.ok(!/source_checkout_session_id/.test(blocUpdateProgram),
      "le builder ne touche jamais la référence de session d'achat");
  });

  await test("11. échec sans fausse confirmation : 0 ligne / NOT_AUTHORIZED / STALE", async () => {
    // a. UPDATE silencieux sous RLS (0 ligne) — le cas exact de l'incident :
    //    échec NET, AUCUNE écriture de structure tentée.
    const base = creerBase();
    const sid = seedProgramme(base, "prog-t");
    const ok = await updateProgram(base.client, "prog-inexistant", données("X", [seance(sid, "t1")]));
    assert.equal(ok, false, "0 ligne modifiée → false, jamais true");
    assert.equal(base.table("workout_sessions")[0].updated_at, "t1", "structure jamais tentée");
    // b. L'issue « error » produit le message actionnable, pas un générique.
    const issue = await orchestrateBuilderSave({ save: async () => false, refetch: async () => null });
    assert.equal(issue.kind, "error");
    assert.ok(/droits coach/.test(builderSaveUserMessage(issue) ?? ""), "message : session sans droits coach");
    assert.ok(/NOT_AUTHORIZED|42501|SAVE_FAILED/.test(
      readFileSync(new URL("../../lib/admin-builder-save.ts", import.meta.url), "utf8")),
      "NOT_AUTHORIZED/42501 détectés explicitement");
    // c. STALE → message « recharge », jamais de fausse réussite.
    const stale = await orchestrateBuilderSave({
      save: async () => { throw new Error("saveTrainingSessionBlocks : STALE_TRAINING_SESSION"); },
      refetch: async () => null,
    });
    assert.equal(stale.kind, "stale");
    assert.ok(/recharge/.test(builderSaveUserMessage(stale) ?? ""));
  });

  await test("12. le bouton d'enregistrement est verrouillé pendant l'écriture", () => {
    const composant = readFileSync(new URL("../../components/admin/ProgramBuilderFullscreen.tsx", import.meta.url), "utf8");
    assert.ok(/disabled=\{saveStatus === "saving"\}/.test(composant), "bouton désactivé pendant l'enregistrement");
    assert.ok(/saveStatus === "saving"\) return "Enregistrement…"/.test(composant), "état de chargement visible");
    assert.ok(/saveErrorMessage \?\? "Échec de l'enregistrement"/.test(composant),
      "le message actionnable remplace le libellé générique quand il existe");
  });
})();


/* ══════════════════════════════════════════════════════════════════════════
   LE BUILDER DÉPLACE LA SÉANCE, IL NE RECOPIE PLUS SON CONTENU
   ══════════════════════════════════════════════════════════════════════════ */

await test("MOVE-UI — le glisser-déposer appelle la règle pure, et ne copie plus de blocs", () => {
  const src = readFileSync(
    new URL("../../components/admin/ProgramBuilderFullscreen.tsx", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

  assert.match(src, /echangerJoursDeSeance\(prev, sourceId, targetId\)/, "la règle pure est appelée");

  // ⚠️ ET LE CONTENU NE VOYAGE PLUS. C'est la copie des blocs d'une séance
  // vers l'autre qui envoyait à la RPC des UUID appartenant à une autre
  // séance — `FOREIGN_BLOCK_ID`, et ÉCHEC DE L'ENREGISTREMENT à chaque
  // déplacement. Réécrire cette copie dans le composant réintroduirait le
  // défaut sans toucher à la règle pure.
  assert.equal(/blocks:\s*target\.blocks/.test(src), false, "aucun bloc recopié depuis la cible");
  assert.equal(/blocks:\s*source\.blocks/.test(src), false, "aucun bloc recopié depuis la source");
  assert.equal(/swapSessionContent/.test(src), false, "l'ancien échange de contenu a disparu");

  // ⚠️ ET LE VERROU RESTE CELUI DE LA LIGNE ÉCRITE. Dupliquer une séance vers
  // la semaine suivante écrivait sur la ligne CIBLE avec l'`updatedAt` de la
  // SOURCE : la RPC comparait deux versions étrangères et levait
  // `STALE_TRAINING_SESSION`. Même famille de faute que le déplacement.
  assert.match(src, /updatedAt:\s*target\.updatedAt/, "la duplication garde le verrou de la cible");
});

console.log(`\n${réussis} test(s) réussi(s), ${échecs} échec(s).`);
if (échecs > 0) process.exit(1);
