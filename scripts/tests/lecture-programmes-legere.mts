/**
 * Harnais — LA LECTURE LÉGÈRE DES PROGRAMMES, ET CE QU'ELLE NE LIT PAS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Que `getProgramsSummary` n'émet AUCUNE requête vers `workout_exercises`,
 * `training_blocks` ni `training_prescriptions` ; que `getPrograms` — celle du
 * builder — les lit toujours toutes ; que la pagination s'arrête sur un lot
 * incomplet sans requête vide ; et que les deux lectures rendent EXACTEMENT
 * les mêmes élèves assignés et les mêmes comptes de séances.
 *
 * ════════════════════════════════════════════════════════════════════════
 * COMMENT — UN FAUX POSTGREST, PAS UNE IMITATION DES FONCTIONS
 * ════════════════════════════════════════════════════════════════════════
 * `globalThis.fetch` est remplacé par un serveur en mémoire qui applique la
 * sémantique réelle de PostgREST : `select` de colonnes, filtres `in`/`eq`,
 * et surtout `offset`/`limit` — car c'est ainsi que postgrest-js traduit
 * `.range()`, et non par un en-tête `Range`. Le client `@supabase/supabase-js`
 * est le vrai ; les fonctions testées sont les vraies.
 *
 * ⚠️ COMPTER LES REQUÊTES EST LE SEUL MOYEN HONNÊTE. Vérifier que le code ne
 * contient pas la chaîne « workout_exercises » serait contournable par une
 * variable ; compter ce qui part sur le réseau ne l'est pas.
 *
 * Lancement : npm run test:lecture-programmes-legere
 */
import assert from "node:assert/strict";

// Node 20 n'a pas de WebSocket natif ; le client Supabase en exige un à la
// construction. Jamais utilisé ici : aucun Realtime n'est ouvert.
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = class {} as never;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://faux.supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "cle-de-test";

/* ── Le faux PostgREST ───────────────────────────────────────────────────── */

type Ligne = Record<string, unknown>;

interface Appel {
  readonly table: string;
  readonly colonnes: string;
  readonly offset: number;
  readonly limit: number;
  readonly rendu: number;
}

let appels: Appel[] = [];
let base: Record<string, Ligne[]> = {};
/** Simule un serveur qui ne rend PAS `Content-Range`, même demandé (voir PAG4). */
let masquerLeTotal = false;

/** Table + filtres → lignes, dans l'ordre d'insertion. */
function filtrer(table: string, params: URLSearchParams): Ligne[] {
  let lignes = base[table] ?? [];
  for (const [cle, valeur] of params) {
    if (["select", "order", "offset", "limit"].includes(cle)) continue;
    if (valeur.startsWith("eq.")) {
      const attendu = valeur.slice(3);
      lignes = lignes.filter((l) => String(l[cle]) === attendu);
    } else if (valeur.startsWith("in.")) {
      const ensemble = new Set(valeur.slice(3).replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")));
      lignes = lignes.filter((l) => ensemble.has(String(l[cle])));
    }
  }
  return lignes;
}

/**
 * Lit un en-tête quelle que soit la forme que fetch a reçue (objet simple,
 * tableau de paires, ou `Headers`).
 */
function entete(init: RequestInit | undefined, nom: string): string {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return h.get(nom) ?? "";
  if (Array.isArray(h)) return h.find(([c]) => c.toLowerCase() === nom.toLowerCase())?.[1] ?? "";
  const cle = Object.keys(h).find((c) => c.toLowerCase() === nom.toLowerCase());
  return cle ? String((h as Record<string, string>)[cle]) : "";
}

globalThis.fetch = (async (entree: unknown, init?: RequestInit) => {
  const url = new URL(typeof entree === "string" ? entree : String((entree as { url: string }).url));
  const table = url.pathname.split("/rest/v1/")[1] ?? "?";
  const colonnes = url.searchParams.get("select") ?? "*";
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 1000);

  const toutes = filtrer(table, url.searchParams);
  const tranche = toutes.slice(offset, offset + limit);
  // ⚠️ LE `select` EST HONORÉ : une colonne non demandée n'est pas rendue.
  // C'est ce qui permet au test des colonnes restreintes de mordre.
  const projetees =
    colonnes === "*"
      ? tranche
      : tranche.map((l) => Object.fromEntries(colonnes.split(",").map((c) => [c.trim(), l[c.trim()]])));

  appels.push({ table, colonnes, offset, limit, rendu: tranche.length });

  /*
   * ⚠️ `Content-Range` N'EST RENDU QUE S'IL EST DEMANDÉ — COMME LE VRAI.
   *
   * PostgREST ne calcule le total que sur `Prefer: count=exact` ; sans cet
   * en-tête il répond `*` et le client ne sait rien du volume restant.
   * Reproduire cette conditionnalité est ce qui rend le harnais capable de
   * distinguer le chemin normal (compte connu) du repli prudent.
   */
  const entetes: Record<string, string> = { "Content-Type": "application/json" };
  if (!masquerLeTotal && entete(init, "Prefer").includes("count=exact")) {
    const dernier = offset + tranche.length - 1;
    entetes["Content-Range"] = tranche.length > 0 ? `${offset}-${dernier}/${toutes.length}` : `*/${toutes.length}`;
  }

  return new Response(JSON.stringify(projetees), { status: 200, headers: entetes });
}) as typeof fetch;

const { createSupabaseBrowserClient } = await import("../../lib/supabase/browser");
const { getPrograms, getProgramsSummary } = await import("../../lib/supabase/programs");
const { totalSessions, totalWeeks } = await import("../../lib/admin");

const client = createSupabaseBrowserClient();
assert.ok(client, "client Supabase non construit");

/* ── Harnais ─────────────────────────────────────────────────────────────── */

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => Promise<void> | void) {
  appels = [];
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

const TABLES_LOURDES = ["workout_exercises", "training_blocks", "training_prescriptions"] as const;
const requetesVers = (table: string) => appels.filter((a) => a.table === table).length;

/* ── Un jeu de données couvrant les trois modes ──────────────────────────── */

function poserBase() {
  base = {
    programs: [
      // Modèle INDIVIDUEL, avec une copie d'élève liée.
      { id: "P1", name: "Modèle individuel", goal: "Force", level: "Intermédiaire", duration_weeks: 12,
        status: "actif", created_at: "2026-09-01", updated_at: "2026-09-01", banner_url: null,
        program_mode: "individuel", group_start_date: null, is_public: false,
        public_subscription_template_id: null, owner_student_id: null, source_template_id: null, description: "" },
      // Modèle PUBLIC.
      { id: "P2", name: "Catalogue public", goal: "Masse", level: "Débutant", duration_weeks: 8,
        status: "actif", created_at: "2026-08-01", updated_at: "2026-08-01", banner_url: null,
        program_mode: "individuel", group_start_date: null, is_public: true,
        public_subscription_template_id: null, owner_student_id: null, source_template_id: null, description: "" },
      // Programme de GROUPE.
      { id: "P3", name: "Cohorte", goal: "Sèche", level: "Avancé", duration_weeks: 6,
        status: "actif", created_at: "2026-07-01", updated_at: "2026-07-01", banner_url: null,
        program_mode: "groupe", group_start_date: "2026-07-15", is_public: false,
        public_subscription_template_id: null, owner_student_id: null, source_template_id: null, description: "" },
      // COPIE individuelle de P1, possédée par l'élève E2.
      { id: "C1", name: "Modèle individuel", goal: "Force", level: "Intermédiaire", duration_weeks: 12,
        status: "actif", created_at: "2026-09-02", updated_at: "2026-09-02", banner_url: null,
        program_mode: "individuel", group_start_date: null, is_public: false,
        public_subscription_template_id: null, owner_student_id: "E2", source_template_id: "P1", description: "" },
    ],
    program_weeks: [
      { id: "W1", program_id: "P1", week_number: 1 },
      { id: "W2", program_id: "P1", week_number: 2 },
      { id: "W3", program_id: "P2", week_number: 1 },
      { id: "W4", program_id: "P3", week_number: 1 },
      { id: "W5", program_id: "C1", week_number: 1 },
    ],
    workout_sessions: [
      { id: "S1", program_id: "P1", program_week_id: "W1", is_rest_day: false, day: "Lundi", name: "Push",
        muscle_group: "pecs", duration_minutes: 60, warmup: "", coach_notes: "", session_type: "strength", banner_url: null, updated_at: "x" },
      { id: "S2", program_id: "P1", program_week_id: "W1", is_rest_day: true, day: "Mardi", name: "Repos",
        muscle_group: "", duration_minutes: 0, warmup: "", coach_notes: "", session_type: "strength", banner_url: null, updated_at: "x" },
      { id: "S3", program_id: "P1", program_week_id: "W2", is_rest_day: false, day: "Lundi", name: "Pull",
        muscle_group: "dos", duration_minutes: 60, warmup: "", coach_notes: "", session_type: "strength", banner_url: null, updated_at: "x" },
      { id: "S4", program_id: "P2", program_week_id: "W3", is_rest_day: false, day: "Lundi", name: "Full",
        muscle_group: "jambes", duration_minutes: 45, warmup: "", coach_notes: "", session_type: "strength", banner_url: null, updated_at: "x" },
      { id: "S5", program_id: "P3", program_week_id: "W4", is_rest_day: false, day: "Mercredi", name: "Cohorte",
        muscle_group: "full", duration_minutes: 50, warmup: "", coach_notes: "", session_type: "strength", banner_url: null, updated_at: "x" },
      { id: "S6", program_id: "C1", program_week_id: "W5", is_rest_day: false, day: "Lundi", name: "Push",
        muscle_group: "pecs", duration_minutes: 60, warmup: "", coach_notes: "", session_type: "strength", banner_url: null, updated_at: "x" },
    ],
    workout_exercises: [
      { id: "X1", session_id: "S1", name: "Développé", sets: 4, reps: "8", rest_seconds: 90, tempo: "",
        recommended_load: "", recommended_rpe: "", video_url: "", muscle_group: "pecs", library_exercise_id: null, position: 1 },
    ],
    training_blocks: [
      { id: "B1", session_id: "S1", block_type: "cardio", position: 1, title: "Cardio", color: "bleu", notes: "" },
    ],
    training_prescriptions: [
      { id: "R1", block_id: "B1", position: 1, duration_seconds: 300, distance_m: null, intensity: "", notes: "" },
    ],
    assignments: [
      // Lien DIRECT sur le modèle de groupe.
      { id: "A1", content_id: "P3", content_type: "programme", student_id: "E1", assigned_at: "2026-07-16", program_start_date: null },
      // Lien sur la COPIE : E2 doit apparaître coché sur le MODÈLE P1.
      { id: "A2", content_id: "C1", content_type: "programme", student_id: "E2", assigned_at: "2026-09-02", program_start_date: "2026-09-02" },
    ],
  };
}

poserBase();

/* ════════════════════════════════════════════════════════════════════════
 * I. CE QUE CHAQUE LECTURE DEMANDE VRAIMENT AU RÉSEAU
 * ════════════════════════════════════════════════════════════════════════ */

await test("LEG1. le résumé n'interroge JAMAIS les exercices, blocs ni prescriptions", async () => {
  await getProgramsSummary(client!);
  for (const table of TABLES_LOURDES) {
    assert.equal(requetesVers(table), 0, `le résumé a interrogé ${table}`);
  }
  // ⚠️ MESURÉ EN PRODUCTION : ces trois tables pèsent 782 276 des 887 641
  // octets d'une lecture complète — 88 %, dont aucun n'atteint une liste.
});

await test("LEG2. le résumé lit exactement les cinq tables dont la liste a besoin", async () => {
  await getProgramsSummary(client!);
  const tables = [...new Set(appels.map((a) => a.table))].sort();
  assert.deepEqual(tables, ["assignments", "program_weeks", "programs", "workout_sessions"]);
  // `programs` sert deux fois (liste + copies), `assignments` deux fois
  // (liens directs + liens des copies) — d'où 6 requêtes pour 4 tables.
  assert.equal(appels.length, 6, `${appels.length} requêtes au lieu de 6`);
});

await test("LEG3. le résumé ne demande PAS `select=*` sur workout_sessions", async () => {
  await getProgramsSummary(client!);
  const sessions = appels.find((a) => a.table === "workout_sessions");
  assert.ok(sessions, "aucune lecture de workout_sessions");
  // ⚠️ `select("*")` y coûterait 91 943 octets pour deux champs utilisés.
  // Mesuré : les colonnes restreintes tombent à 16 401.
  assert.notEqual(sessions.colonnes, "*", "colonnes non restreintes");
  // postgrest-js retire les espaces de la liste avant l'envoi.
  assert.equal(sessions.colonnes.replace(/\s/g, ""), "id,program_week_id,is_rest_day");
});

await test("LEG4. le BUILDER, lui, lit toujours les trois tables lourdes", async () => {
  await getPrograms(client!);
  for (const table of TABLES_LOURDES) {
    assert.ok(requetesVers(table) > 0, `la lecture complète n'interroge plus ${table}`);
  }
  const sessions = appels.find((a) => a.table === "workout_sessions");
  // ⚠️ ET EN COLONNES COMPLÈTES : le builder a besoin de l'échauffement, des
  // notes du coach, du type de séance. Restreindre ici casserait l'éditeur.
  assert.equal(sessions?.colonnes, "*", "la lecture complète a perdu des colonnes");
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LA PAGINATION
 * ════════════════════════════════════════════════════════════════════════ */

await test("PAG1. un lot INCOMPLET arrête la pagination — plus de requête vide", async () => {
  await getProgramsSummary(client!);
  const vides = appels.filter((a) => a.rendu === 0);
  /*
   * ⚠️ MESURÉ AVANT CE LOT : 9 requêtes vides sur 20, soit 45 % des
   * allers-retours de `getPrograms`. Chacune ne rapportait que « il n'y a plus
   * rien » — invisible en local, une latence pleine sur une liaison lente.
   */
  assert.deepEqual(vides, [], `${vides.length} requête(s) vide(s) subsistent`);
});

await test("PAG2. 2 105 lignes = 3 requêtes, pas 4", async () => {
  const beaucoup = Array.from({ length: 2105 }, (_, i) => ({
    id: `X${i}`, session_id: "S1", name: "e", sets: 1, reps: "1", rest_seconds: 0, tempo: "",
    recommended_load: "", recommended_rpe: "", video_url: "", muscle_group: "", library_exercise_id: null, position: i,
  }));
  base.workout_exercises = beaucoup;
  try {
    await getPrograms(client!);
    const pages = appels.filter((a) => a.table === "workout_exercises");
    // 1000 + 1000 + 105 : le troisième lot est incomplet, donc terminal.
    assert.deepEqual(pages.map((p) => p.rendu), [1000, 1000, 105]);
    assert.equal(pages.length, 3, "une quatrième requête vide est revenue");
  } finally {
    poserBase();
  }
});

await test("PAG3. un multiple EXACT de la page ne coûte PLUS de requête de plus", async () => {
  /*
   * ⚠️ CE TEST DISAIT L'INVERSE, ET IL AVAIT RAISON À L'ÉPOQUE. Tant que la
   * fin du jeu était DEVINÉE (« le lot est plus court que demandé, donc c'est
   * fini »), un second lot PLEIN de 1 000 lignes ne prouvait rien : il fallait
   * une troisième requête, dont le résultat vide était la seule preuve
   * d'exhaustivité.
   *
   * Depuis que la première page réclame `count: "exact"`, le serveur ANNONCE
   * son total. À 2 000 lignes lues sur 2 000 annoncées, l'exhaustivité est
   * établie : la troisième requête ne porte plus aucune information, et elle
   * disparaît. On vérifie les DEUX moitiés — qu'elle a disparu, et que rien
   * n'a été perdu au passage.
   */
  base.workout_exercises = Array.from({ length: 2000 }, (_, i) => ({
    id: `X${i}`, session_id: "S1", name: "e", sets: 1, reps: "1", rest_seconds: 0, tempo: "",
    recommended_load: "", recommended_rpe: "", video_url: "", muscle_group: "", library_exercise_id: null, position: i,
  }));
  try {
    const programmes = await getPrograms(client!);
    const pages = appels.filter((a) => a.table === "workout_exercises");
    assert.deepEqual(pages.map((p) => p.rendu), [1000, 1000], "une requête vide subsiste sur un multiple exact");
    const lues = programmes.reduce(
      (n, p) => n + p.sessions.reduce((m, s) => m + s.exercises.length, 0),
      0,
    );
    assert.equal(lues, 2000, "des exercices ont été perdus en supprimant la requête de clôture");
  } finally {
    poserBase();
  }
});

await test("PAG4. SANS total annoncé, la requête de clôture reste OBLIGATOIRE", async () => {
  /*
   * ⚠️ LE REPLI DOIT RESTER SÛR, ET C'EST ICI QU'ON LE PROUVE.
   *
   * Si le serveur ne rend aucun `Content-Range` — vieille version, passerelle
   * qui filtre l'en-tête, configuration inattendue — la lecture perd son
   * arrêt positif. Elle ne doit PAS retomber sur « lot plus court = fini » :
   * elle doit revenir à la seule autre règle sûre, l'arrêt sur lot VIDE, et
   * donc payer à nouveau la requête de clôture. Plus lent, jamais faux.
   */
  base.workout_exercises = Array.from({ length: 2000 }, (_, i) => ({
    id: `X${i}`, session_id: "S1", name: "e", sets: 1, reps: "1", rest_seconds: 0, tempo: "",
    recommended_load: "", recommended_rpe: "", video_url: "", muscle_group: "", library_exercise_id: null, position: i,
  }));
  masquerLeTotal = true;
  try {
    const programmes = await getPrograms(client!);
    const pages = appels.filter((a) => a.table === "workout_exercises");
    assert.deepEqual(pages.map((p) => p.rendu), [1000, 1000, 0], "le repli ne s'arrête plus sur un lot vide");
    const lues = programmes.reduce(
      (n, p) => n + p.sessions.reduce((m, s) => m + s.exercises.length, 0),
      0,
    );
    assert.equal(lues, 2000, "le repli a perdu des lignes");
  } finally {
    masquerLeTotal = false;
    poserBase();
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LES DEUX LECTURES DISENT LA MÊME CHOSE
 * ════════════════════════════════════════════════════════════════════════ */

await test("EQ1. mêmes élèves assignés, résumé et lecture complète", async () => {
  const resume = await getProgramsSummary(client!);
  const complet = await getPrograms(client!);
  for (const r of resume) {
    const c = complet.find((p) => p.id === r.id);
    assert.ok(c, `programme ${r.id} absent de la lecture complète`);
    assert.deepEqual(r.assignedStudentIds, c.assignedStudentIds, `élèves assignés divergents sur ${r.id}`);
  }
  // ⚠️ LE CAS QUI COMPTE : E2 est lié à la COPIE C1, pas au modèle P1 — il
  // doit apparaître coché sur P1 dans les DEUX lectures. C'est la règle
  // `mergeAssignedStudentIds` + `keepCopiesWithActiveAssignment`, et ce lot
  // n'y touche pas.
  assert.deepEqual(resume.find((p) => p.id === "P1")?.assignedStudentIds, ["E2"]);
  assert.deepEqual(resume.find((p) => p.id === "P3")?.assignedStudentIds, ["E1"]);
});

await test("EQ2. mêmes comptes de séances et de semaines", async () => {
  const resume = await getProgramsSummary(client!);
  const complet = await getPrograms(client!);
  for (const r of resume) {
    const c = complet.find((p) => p.id === r.id)!;
    assert.equal(totalSessions(r), totalSessions(c), `totalSessions divergent sur ${r.id}`);
    assert.equal(totalWeeks(r), totalWeeks(c), `totalWeeks divergent sur ${r.id}`);
  }
  // P1 : 3 séances dont 1 repos → 2 séances, 2 semaines.
  const p1 = resume.find((p) => p.id === "P1")!;
  assert.equal(totalSessions(p1), 2);
  assert.equal(totalWeeks(p1), 2);
});

await test("EQ3. individuel, public et groupe traversent le résumé intacts", async () => {
  const resume = await getProgramsSummary(client!);
  const p1 = resume.find((p) => p.id === "P1")!;
  const p2 = resume.find((p) => p.id === "P2")!;
  const p3 = resume.find((p) => p.id === "P3")!;
  assert.equal(p1.programMode, "individuel");
  assert.equal(p1.ownerStudentId, null, "un MODÈLE ne porte pas de propriétaire");
  assert.equal(p2.isPublic, true, "le catalogue public doit rester reconnaissable");
  // ⚠️ `groupStartDate` EST DANS LE RÉSUMÉ, et ce n'est pas décoratif : c'est
  // l'ancre de calcul des semaines d'un programme de groupe. L'omettre aurait
  // silencieusement cassé le chantier calendrier.
  assert.equal(p3.programMode, "groupe");
  assert.equal(p3.groupStartDate, "2026-07-15");
  const copie = resume.find((p) => p.id === "C1")!;
  assert.equal(copie.ownerStudentId, "E2", "une COPIE doit rester identifiable comme telle");
});

await test("EQ4. une lecture incomplète est REFUSÉE, dans les deux chemins", async () => {
  // ⚠️ UN COMPTE DE SÉANCES AMPUTÉ EST PIRE QU'UNE ERREUR VISIBLE : il
  // afficherait « 3 séances » là où il y en a 84, sans rien signaler.
  const vraiFetch = globalThis.fetch;
  /*
   * ⚠️ L'ÉCHEC EST PROVOQUÉ SUR `program_weeks`, PAS SUR `programs`, et le
   * sabotage a exigé cette précision. En faisant échouer la PREMIÈRE lecture,
   * c'est la garde de `getProgramsSummary` qui levait — celle de
   * `loadProgramsSummary` n'était jamais atteinte, et la retirer laissait le
   * test vert. Une lecture intermédiaire n'a qu'un seul filet : le bon.
   */
  globalThis.fetch = (async (entree: unknown, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : String((entree as { url: string }).url);
    if (url.includes("/rest/v1/program_weeks")) {
      return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
    }
    return vraiFetch(entree as RequestInfo, init);
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => getProgramsSummary(client!),
      /lecture incomplète/,
      "une lecture partielle doit être refusée, pas rendue amputée",
    );
  } finally {
    globalThis.fetch = vraiFetch;
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. QUI UTILISE QUOI — la répartition ne doit pas dériver
 * ════════════════════════════════════════════════════════════════════════ */

const { readFileSync } = await import("node:fs");
const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

await test("PAGES1. les trois listes utilisent la lecture LÉGÈRE", async () => {
  for (const chemin of [
    "../../app/admin/page.tsx",
    "../../app/admin/programmes/page.tsx",
    "../../app/admin/eleves/page.tsx",
  ]) {
    const code = lire(chemin);
    assert.match(code, /useSupabaseProgramsSummary\(\)/, `${chemin} : lecture légère absente`);
    assert.ok(
      !/useSupabasePrograms\(\)/.test(code),
      `${chemin} : utilise encore la lecture complète`,
    );
  }
});

await test("PAGES2. les trois pages de DÉTAIL gardent la lecture COMPLÈTE", async () => {
  /*
   * ⚠️ LA GARDE QUI EMPÊCHE D'OPTIMISER TROP LOIN. `/admin/eleves/[studentId]`
   * appelle `calculateWeekMetrics(assignedProgram.sessions)`, qui lit
   * `exercises[].sets` : le basculer sur le résumé ne casserait pas la
   * compilation — `AdminProgram` est assignable au résumé, pas l'inverse — mais
   * la page ne compilerait plus du tout, ce qui est justement le but. Ce test
   * le dit à voix haute plutôt que de compter sur la découverte.
   *
   * ⚠️ CE QUI EST ÉPINGLÉ, C'EST « COMPLET », PAS « TOUT LE CATALOGUE ».
   * Ce contrôle exigeait littéralement `useSupabasePrograms()`, c'est-à-dire la
   * lecture de TOUS les programmes. Or c'est précisément cette lecture globale
   * qui a fait tomber le builder le 11/09 : la liste d'identifiants envoyée
   * dans l'URL PostgREST dépassait le plafond de la passerelle. Les trois pages
   * lisent désormais `useSupabaseProgram(id)` — toujours le programme COMPLET,
   * mais un seul. La garantie de fond est inchangée ; seule la source l'est.
   */
  for (const chemin of [
    "../../app/admin/eleves/[studentId]/page.tsx",
    "../../app/admin/programmes/[programId]/page.tsx",
    "../../app/admin/programmes/[programId]/builder/page.tsx",
  ]) {
    const code = lire(chemin);
    assert.match(code, /useSupabaseProgram\(/, `${chemin} : a perdu la lecture complète`);
  }

  /*
   * ⚠️ ET LE RÉSUMÉ NE DOIT PAS S'ÊTRE GLISSÉ DANS LE PROGRAMME AFFICHÉ.
   * La fiche élève lit bien le résumé, mais UNIQUEMENT pour le catalogue de la
   * modale d'attribution ; le programme dont on calcule les métriques vient de
   * la lecture complète ciblée. Sans ce second contrôle, le premier serait
   * satisfait par une page qui garderait le hook sans s'en servir.
   */
  const fiche = lire("../../app/admin/eleves/[studentId]/page.tsx");
  assert.match(
    fiche,
    /const assignedProgram =[\s\S]{0,200}?programmeAssigneComplet\.program/,
    "le programme assigné de la fiche élève ne vient plus de la lecture complète",
  );
  for (const chemin of [
    "../../app/admin/programmes/[programId]/page.tsx",
    "../../app/admin/programmes/[programId]/builder/page.tsx",
  ]) {
    assert.ok(
      !/useSupabaseProgramsSummary\(/.test(lire(chemin)),
      `${chemin} : affiche un programme construit à partir du RÉSUMÉ`,
    );
  }
});

await test("PAGES3. aucun repli mock ne revient pendant le chargement", async () => {
  // Non-régression de `fix(admin): prevent mock data flash during loading`.
  for (const chemin of ["../../app/admin/programmes/page.tsx", "../../app/admin/eleves/page.tsx"]) {
    const code = lire(chemin).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
    assert.match(code, /supabaseActive &&[\s\S]{0,220}?\.loading/, `${chemin} : garde de chargement perdue`);
    assert.ok(
      !/\.length > 0\s*\?\s*[\w.]+\s*:\s*state\./.test(code),
      `${chemin} : la source retombe sur les fixtures quand la liste est vide`,
    );
  }
});

/* ── Verdict ─────────────────────────────────────────────────────────────── */

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
