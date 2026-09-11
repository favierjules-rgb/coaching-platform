/**
 * Harnais — LA LISTE D'IDENTIFIANTS NE DOIT JAMAIS FAIRE EXPLOSER L'URL.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Qu'aucune lecture de programmes n'envoie une URL plus longue que ce qu'une
 * passerelle accepte, QUEL QUE SOIT le nombre de séances en base ; que le
 * découpage rend EXACTEMENT les mêmes lignes qu'une lecture d'un seul tenant ;
 * qu'un lot interrompu rend la lecture entière incomplète ; et que la page de
 * détail comme le builder ne lisent plus que LE programme demandé.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE TEST EXISTE — LA PANNE DU 11/09
 * ════════════════════════════════════════════════════════════════════════
 * postgrest-js traduit `.in("session_id", ids)` en paramètre d'URL. Les 749
 * séances de production pesaient 27 712 caractères d'identifiants ; les
 * journaux `edge_logs` du projet montrent, pour `workout_exercises` et
 * `training_blocks`, des 200 jusqu'à 6 678 caractères d'URL et des 400 à
 * partir de 26 059 — sans aucune trace côté `postgres_logs`, la requête étant
 * rejetée avant d'atteindre la base. Ouvrir le builder devenait impossible.
 *
 * ⚠️ LA PAGINATION NE PROTÉGEAIT PAS DE ÇA. `lireToutesLesLignes` découpe le
 * RÉSULTAT, pas la liste envoyée : chaque page réémettait la même URL trop
 * longue. C'est précisément ce que le faux serveur ci-dessous refuse.
 *
 * ⚠️ LE PLAFOND DU TEST (10 000 caractères) N'EST PAS ARBITRAIRE, ET IL EST
 * ENCADRÉ DES DEUX CÔTÉS. Il doit être :
 *   • SUPÉRIEUR au pire lot légitime — 200 identifiants de 36 caractères font
 *     environ 7 400 caractères, plus le chemin et les paramètres ;
 *   • INFÉRIEUR à ce que produirait une liste NON découpée — les 840 séances
 *     de la fixture pèsent plus de 30 000 caractères.
 * Entre les deux, le test distingue exactement ce qu'il doit distinguer. Un
 * plafond sous le premier seuil condamnerait une lecture correcte ; au-dessus
 * du second, il laisserait passer la panne.
 *
 * Il ne prétend pas reproduire le seuil exact de la passerelle (mesuré entre
 * 20 000 et 26 000 caractères avec les en-têtes d'un navigateur) : il rend la
 * règle observable sans exiger une fixture de taille réelle.
 *
 * Lancement : npm run test:lots-identifiants
 */
import assert from "node:assert/strict";

if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = class {} as never;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://faux.supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "cle-de-test";

/* ── Le faux PostgREST, DERRIÈRE UNE PASSERELLE QUI MESURE L'URL ─────────── */

type Ligne = Record<string, unknown>;

interface Appel {
  readonly table: string;
  readonly longueurUrl: number;
  readonly nbIdentifiants: number;
  readonly offset: number;
  readonly rendu: number;
}

const PLAFOND_URL = 10_000;
/** Taille de page du code lu : le faux serveur plafonne par défaut au même. */
const TAILLE_DE_PAGE_ATTENDUE = 1000;

let appels: Appel[] = [];
let base: Record<string, Ligne[]> = {};
let tableEnPanne: string | null = null;
/**
 * Plafond de lignes du serveur, comme `db-max-rows` de PostgREST : il coupe la
 * réponse même quand la plage demandée est plus large. Mesuré à 1 000 sur le
 * projet ; réglable ici pour éprouver le cas où il descend SOUS la page.
 */
let plafondDeLignes = TAILLE_DE_PAGE_ATTENDUE;
/** Nombre de requêtes ayant réclamé `count=exact` — une par lot, jamais plus. */
let requetesAvecCompte = 0;
/** Simule un serveur qui ne rend pas de total, même demandé. */
let masquerLeTotal = false;
/**
 * Simule un serveur qui répond 200 avec ZÉRO ligne alors que son total annonce
 * qu'il en reste. Distinct d'une panne : aucune erreur, juste des lignes qui
 * n'arrivent pas — c'est le visage exact d'une troncature.
 */
let videApres: { table: string; apres: number } | null = null;
/*
 * ⚠️ PANNE D'UN SEUL LOT — LE CAS QUE `tableEnPanne` NE COUVRE PAS.
 *
 * Faire échouer TOUTES les requêtes d'une table ne distingue pas un `every`
 * d'un `some` : les deux rendent `complet === false`. Le sabotage l'a montré —
 * remplacer `every` par `some` laissait ce fichier entièrement vert. Il faut
 * qu'un lot RÉUSSISSE et qu'un autre ÉCHOUE pour que l'agrégation soit
 * réellement mise à l'épreuve.
 */
let tableEnPanneApres: { table: string; apres: number } | null = null;
let appelsParTable: Record<string, number> = {};
let refusees = 0;

function filtrer(table: string, params: URLSearchParams): Ligne[] {
  let lignes = base[table] ?? [];
  for (const [cle, valeur] of params) {
    if (["select", "order", "offset", "limit"].includes(cle)) continue;
    if (valeur.startsWith("eq.")) {
      lignes = lignes.filter((l) => String(l[cle]) === valeur.slice(3));
    } else if (valeur.startsWith("in.")) {
      const ensemble = new Set(
        valeur.slice(3).replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")),
      );
      lignes = lignes.filter((l) => ensemble.has(String(l[cle])));
    }
  }
  return lignes;
}

/** Lit un en-tête quelle que soit la forme reçue par fetch. */
function entete(init: RequestInit | undefined, nom: string): string {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return h.get(nom) ?? "";
  if (Array.isArray(h)) return h.find(([c]) => c.toLowerCase() === nom.toLowerCase())?.[1] ?? "";
  const cle = Object.keys(h).find((c) => c.toLowerCase() === nom.toLowerCase());
  return cle ? String((h as Record<string, string>)[cle]) : "";
}

globalThis.fetch = (async (entree: unknown, init?: RequestInit) => {
  const brute = typeof entree === "string" ? entree : String((entree as { url: string }).url);
  const url = new URL(brute);
  const table = url.pathname.split("/rest/v1/")[1] ?? "?";

  // ⚠️ LA PASSERELLE REFUSE AVANT DE REGARDER LA REQUÊTE — comme en vrai :
  // aucune trace côté base, seulement un statut d'erreur.
  if (brute.length > PLAFOND_URL) {
    refusees += 1;
    return new Response(JSON.stringify({ message: "URI too long" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  appelsParTable[table] = (appelsParTable[table] ?? 0) + 1;

  if (tableEnPanne === table) {
    return new Response(JSON.stringify({ message: "panne simulée" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (tableEnPanneApres && tableEnPanneApres.table === table && appelsParTable[table] > tableEnPanneApres.apres) {
    return new Response(JSON.stringify({ message: "panne simulée sur un seul lot" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const colonnes = url.searchParams.get("select") ?? "*";
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 1000);
  const toutes = filtrer(table, url.searchParams);
  // ⚠️ LE PLAFOND S'APPLIQUE APRÈS LA PLAGE, EXACTEMENT COMME POSTGREST.
  const tranche = toutes.slice(offset, offset + Math.min(limit, plafondDeLignes));
  const veutLeCompte = entete(init, "Prefer").includes("count=exact");
  if (veutLeCompte) requetesAvecCompte += 1;
  const tarit = videApres !== null && videApres.table === table && appelsParTable[table] > videApres.apres;
  const rendues = tarit ? [] : tranche;
  const projetees =
    colonnes === "*"
      ? rendues
      : rendues.map((l) => Object.fromEntries(colonnes.split(",").map((c) => [c.trim(), l[c.trim()]])));

  const filtreIn = [...url.searchParams.values()].find((v) => v.startsWith("in."));
  appels.push({
    table,
    longueurUrl: brute.length,
    nbIdentifiants: filtreIn ? filtreIn.slice(3).replace(/^\(|\)$/g, "").split(",").length : 0,
    offset,
    rendu: rendues.length,
  });

  const entetes: Record<string, string> = { "Content-Type": "application/json" };
  if (veutLeCompte && !masquerLeTotal) {
    // ⚠️ LE TOTAL RESTE CELUI DU JEU RÉEL, même quand le serveur tarit : c'est
    // précisément l'écart entre les deux qui doit être détecté.
    entetes["Content-Range"] =
      rendues.length > 0 ? `${offset}-${offset + rendues.length - 1}/${toutes.length}` : `*/${toutes.length}`;
  }
  return new Response(JSON.stringify(projetees), { status: 200, headers: entetes });
}) as typeof fetch;

const { createSupabaseBrowserClient } = await import("../../lib/supabase/browser");
const { getPrograms, getProgramsSummary, getProgramById } = await import("../../lib/supabase/programs");

const client = createSupabaseBrowserClient();
assert.ok(client, "client Supabase non construit");

const { readFileSync: lireFichier } = await import("node:fs");
const sourceProgrammes = lireFichier("lib/supabase/programs.ts", "utf8");
const tailleDeLotDuCode = Number(/TAILLE_DE_LOT_IDS\s*=\s*(\d+)/.exec(sourceProgrammes)?.[1]);
assert.ok(
  Number.isInteger(tailleDeLotDuCode) && tailleDeLotDuCode > 0,
  "TAILLE_DE_LOT_IDS introuvable dans lib/supabase/programs.ts",
);

/* ── Harnais ─────────────────────────────────────────────────────────────── */

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => Promise<void> | void) {
  appels = [];
  refusees = 0;
  tableEnPanne = null;
  tableEnPanneApres = null;
  appelsParTable = {};
  plafondDeLignes = TAILLE_DE_PAGE_ATTENDUE;
  requetesAvecCompte = 0;
  masquerLeTotal = false;
  videApres = null;
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

/* ── Une base VOLUMINEUSE : c'est le volume qui fait la panne ─────────────── */

const NB_PROGRAMMES = 20;
const SEMAINES_PAR_PROGRAMME = 6;
const SEANCES_PAR_SEMAINE = 7;

// Identifiants de la longueur d'un vrai UUID : le test mesure des caractères,
// pas des éléments — un identifiant court masquerait exactement le défaut.
const uuid = (prefixe: string, n: number) =>
  `${prefixe}${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

function poserBase() {
  const programs: Ligne[] = [];
  const program_weeks: Ligne[] = [];
  const workout_sessions: Ligne[] = [];
  const workout_exercises: Ligne[] = [];
  const training_blocks: Ligne[] = [];
  const training_prescriptions: Ligne[] = [];

  let nSemaine = 0;
  let nSeance = 0;
  for (let p = 1; p <= NB_PROGRAMMES; p += 1) {
    const idP = uuid("a", p);
    programs.push({
      id: idP, name: `Programme ${p}`, goal: "Force", level: "Intermédiaire",
      duration_weeks: SEMAINES_PAR_PROGRAMME, status: "actif",
      created_at: `2026-09-${String(p).padStart(2, "0")}`, updated_at: "2026-09-01",
      banner_url: null, program_mode: "individuel", group_start_date: null, is_public: false,
      public_subscription_template_id: null, owner_student_id: null, source_template_id: null, description: "",
    });
    for (let w = 1; w <= SEMAINES_PAR_PROGRAMME; w += 1) {
      nSemaine += 1;
      const idW = uuid("b", nSemaine);
      program_weeks.push({ id: idW, program_id: idP, week_number: w });
      for (let s = 1; s <= SEANCES_PAR_SEMAINE; s += 1) {
        nSeance += 1;
        const idS = uuid("c", nSeance);
        workout_sessions.push({
          id: idS, program_id: idP, program_week_id: idW, is_rest_day: s === 7,
          day: "Lundi", name: `Séance ${s}`, muscle_group: "pecs", duration_minutes: 60,
          warmup: "", coach_notes: "", session_type: "strength", banner_url: null, updated_at: "x",
        });
        workout_exercises.push({
          id: uuid("d", nSeance), session_id: idS, name: "Développé", sets: 4, reps: "8",
          rest_seconds: 90, tempo: "", recommended_load: "", recommended_rpe: "",
          video_url: "", muscle_group: "pecs", library_exercise_id: null, position: 1,
        });
        training_blocks.push({
          id: uuid("e", nSeance), session_id: idS, block_type: "cardio",
          position: 1, title: "Cardio", color: "bleu", notes: "",
        });
        training_prescriptions.push({
          id: uuid("f", nSeance), block_id: uuid("e", nSeance), position: 1,
          duration_seconds: 300, distance_m: null, intensity: "", notes: "",
        });
      }
    }
  }

  base = {
    programs, program_weeks, workout_sessions,
    workout_exercises, training_blocks, training_prescriptions,
    assignments: [
      { id: uuid("g", 1), content_id: uuid("a", 1), content_type: "programme",
        student_id: "E1", assigned_at: "2026-09-01", program_start_date: null },
    ],
  };
}

poserBase();

const NB_SEANCES = NB_PROGRAMMES * SEMAINES_PAR_PROGRAMME * SEANCES_PAR_SEMAINE;
const longueurListeSeances = base.workout_sessions.map((s) => String(s.id)).join(",").length;

/* ════════════════════════════════════════════════════════════════════════
 * I. LE VOLUME DE LA FIXTURE DOIT SUFFIRE À FAIRE MORDRE LE TEST
 * ════════════════════════════════════════════════════════════════════════ */

await test("LOT1. la fixture dépasse VRAIMENT le plafond si on n'y fait rien", () => {
  assert.equal(NB_SEANCES, 840, "volume de fixture inattendu");
  assert.ok(
    longueurListeSeances > PLAFOND_URL,
    `une liste de ${NB_SEANCES} identifiants pèse ${longueurListeSeances} caractères : ` +
      `elle doit dépasser le plafond de test (${PLAFOND_URL}), sinon ce fichier ne prouve rien`,
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * II. AUCUNE REQUÊTE NE DOIT ÊTRE REFUSÉE
 * ════════════════════════════════════════════════════════════════════════ */

await test("LOT2. la lecture COMPLÈTE passe la passerelle", async () => {
  const programmes = await getPrograms(client!);
  assert.equal(refusees, 0, `${refusees} requêtes refusées pour URL trop longue`);
  assert.equal(programmes.length, NB_PROGRAMMES);
});

await test("LOT3. la lecture LÉGÈRE passe la passerelle", async () => {
  const resumes = await getProgramsSummary(client!);
  assert.equal(refusees, 0, `${refusees} requêtes refusées pour URL trop longue`);
  assert.equal(resumes.length, NB_PROGRAMMES);
});

await test("LOT4. aucune URL émise n'approche le plafond", async () => {
  await getPrograms(client!);
  const pire = Math.max(...appels.map((a) => a.longueurUrl));
  assert.ok(pire <= PLAFOND_URL, `URL de ${pire} caractères émise (plafond ${PLAFOND_URL})`);
});

await test("LOT5. aucune requête ne porte plus d'identifiants que la taille de lot", async () => {
  await getPrograms(client!);
  const pire = Math.max(...appels.map((a) => a.nbIdentifiants));
  assert.ok(pire > 0, "aucun filtre `in` observé — le test ne mesure rien");
  // ⚠️ LA BORNE EST LUE DANS LE CODE, PAS RECOPIÉE ICI. Une copie figée
  // laisserait le test vert si quelqu'un doublait la taille de lot.
  assert.ok(
    pire <= tailleDeLotDuCode,
    `un filtre in.() portait ${pire} identifiants pour une taille de lot de ${tailleDeLotDuCode}`,
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LE DÉCOUPAGE NE CHANGE PAS LE RÉSULTAT
 * ════════════════════════════════════════════════════════════════════════ */

await test("LOT6. toutes les séances sont rendues, aucune perdue ni dupliquée", async () => {
  const programmes = await getPrograms(client!);
  const total = programmes.reduce((n, p) => n + p.sessions.length, 0);
  assert.equal(total, NB_SEANCES, "compte de séances faux après découpage");
  const ids = programmes.flatMap((p) => p.sessions.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length, "des séances ont été rendues deux fois");
});

await test("LOT7. exercices et blocs suivent leurs séances, sans mélange", async () => {
  const programmes = await getPrograms(client!);
  const exercices = programmes.reduce(
    (n, p) => n + p.sessions.reduce((m, s) => m + s.exercises.length, 0),
    0,
  );
  const seancesTravail = NB_PROGRAMMES * SEMAINES_PAR_PROGRAMME * SEANCES_PAR_SEMAINE;
  assert.equal(exercices, seancesTravail, "des exercices ont disparu au découpage");
});

await test("LOT8. le résumé compte les mêmes séances que la lecture complète", async () => {
  const complets = await getPrograms(client!);
  const resumes = await getProgramsSummary(client!);
  for (const complet of complets) {
    const resume = resumes.find((r) => r.id === complet.id);
    assert.ok(resume, `programme ${complet.id} absent du résumé`);
    assert.equal(resume!.sessions.length, complet.sessions.length, `compte divergent sur ${complet.id}`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. UN LOT INTERROMPU CONTAMINE TOUTE LA LECTURE
 * ════════════════════════════════════════════════════════════════════════ */

await test("LOT9. un lot en échec rend la lecture INCOMPLÈTE, et elle est refusée", async () => {
  tableEnPanne = "workout_exercises";
  await assert.rejects(
    () => getPrograms(client!),
    /incomplète/i,
    "une lecture partielle a été rendue au lieu d'être refusée",
  );
});

await test("LOT10. le résumé refuse lui aussi une lecture partielle", async () => {
  tableEnPanne = "workout_sessions";
  await assert.rejects(() => getProgramsSummary(client!), /incomplète/i);
});

await test("LOT18. la table visée est BIEN lue en plusieurs lots", async () => {
  /*
   * ⚠️ SANS CETTE VÉRIFICATION, LE TEST SUIVANT NE PROUVE RIEN.
   *
   * Écrit d'abord sur `workout_sessions`, LOT19 passait à tort : 120 semaines
   * tiennent dans UN lot, donc « échouer à partir du deuxième appel » ne
   * déclenchait aucune panne, et l'absence de rejet n'avait rien à voir avec
   * l'agrégation. On s'assure donc que la table choisie est réellement lue en
   * plusieurs lots avant d'en faire échouer un seul.
   */
  await getPrograms(client!);
  const lots = appels.filter((a) => a.table === "training_blocks").length;
  assert.ok(lots > 1, `training_blocks lue en ${lots} lot(s) : le test suivant serait vide de sens`);
});

await test("LOT19. UN SEUL lot en échec suffit à invalider la lecture entière", async () => {
  // Le premier lot réussit, les suivants échouent. Une agrégation qui se
  // contenterait d'« au moins un lot complet » rendrait ici un catalogue
  // amputé en le déclarant sain.
  tableEnPanneApres = { table: "training_blocks", apres: 1 };
  await assert.rejects(
    () => getPrograms(client!),
    /incomplète/i,
    "une lecture dont un seul lot a échoué a été acceptée",
  );
});

await test("LOT20. même chose sur les exercices, l'autre table à gros volume", async () => {
  tableEnPanneApres = { table: "workout_exercises", apres: 1 };
  await assert.rejects(() => getPrograms(client!), /incomplète/i);
});

/* ════════════════════════════════════════════════════════════════════════
 * V. LIRE UN PROGRAMME NE DOIT PLUS LIRE TOUT LE CATALOGUE
 * ════════════════════════════════════════════════════════════════════════ */

await test("LOT11. getProgramById rend le bon programme, complet", async () => {
  const programme = await getProgramById(client!, uuid("a", 3));
  assert.ok(programme, "programme non rendu");
  assert.equal(programme!.id, uuid("a", 3));
  assert.equal(programme!.sessions.length, SEMAINES_PAR_PROGRAMME * SEANCES_PAR_SEMAINE);
  assert.ok(
    programme!.sessions.some((s) => s.exercises.length > 0),
    "les séances sont rendues sans leurs exercices",
  );
});

await test("LOT12. getProgramById ne lit QUE ce programme", async () => {
  await getProgramById(client!, uuid("a", 3));
  const seances = appels.filter((a) => a.table === "workout_sessions").reduce((n, a) => n + a.rendu, 0);
  assert.equal(
    seances,
    SEMAINES_PAR_PROGRAMME * SEANCES_PAR_SEMAINE,
    "des séances d'autres programmes ont été lues",
  );
});

await test("LOT13. la lecture ciblée rapatrie une fraction des lignes", async () => {
  /*
   * ⚠️ CE QUI BAISSE, C'EST LE VOLUME — PAS LE NOMBRE DE REQUÊTES.
   *
   * Une première version de ce test comparait `appels.length` et attendait un
   * facteur 3 : mesuré, l'écart est de 8 contre 20, et c'est NORMAL. Le chemin
   * de lecture a le même nombre d'étapes dans les deux cas (programmes →
   * semaines → séances → exercices/blocs → prescriptions) ; seul le nombre de
   * LIGNES rapatriées change. Compter les requêtes mesurait la mauvaise
   * grandeur : l'assertion a suivi la mesure, pas l'inverse.
   */
  await getProgramById(client!, uuid("a", 3));
  const lignesCiblee = appels.reduce((n, a) => n + a.rendu, 0);
  appels = [];
  await getPrograms(client!);
  const lignesGlobale = appels.reduce((n, a) => n + a.rendu, 0);

  assert.ok(lignesCiblee > 0, "la lecture ciblée n'a rien lu");
  assert.ok(
    lignesCiblee * NB_PROGRAMMES <= lignesGlobale * 1.2,
    `lecture ciblée ${lignesCiblee} lignes contre ${lignesGlobale} pour ${NB_PROGRAMMES} programmes : ` +
      `la ciblée devrait valoir environ un vingtième de la globale`,
  );
});

await test("LOT14. un identifiant inconnu rend null, pas une erreur", async () => {
  const programme = await getProgramById(client!, uuid("a", 999));
  assert.equal(programme, null);
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. L'ARRÊT DE PAGINATION EST PROUVÉ, PAS DEVINÉ
 * ════════════════════════════════════════════════════════════════════════
 * Panne latente identifiée le 11/09. `lireToutesLesLignes` s'arrêtait sur
 * « lot plus court que la page demandée », en affirmant qu'un lot partiel
 * signifie un jeu épuisé. PostgREST rend en réalité
 * `min(plage demandée, db-max-rows)` — mesuré sur ce projet :
 * `exercise_set_feedback`, 1 379 lignes, requête sans `limit` ni `offset` ni
 * en-tête `Range`, réponse `Content-Range: 0-999/*`. L'arrêt ne restait
 * correct que parce que `db-max-rows` (1 000) valait exactement
 * `TAILLE_DE_PAGE` (1 000) : deux constantes sans lien.
 * ════════════════════════════════════════════════════════════════════════ */

await test("CNT1. le total est RÉCLAMÉ, une fois par lot et pas davantage", async () => {
  /*
   * ⚠️ IL FAUT PLUSIEURS PAGES PAR LOT POUR QUE CE TEST MORDE. À plafond
   * normal, chaque lot de la fixture tient en une seule page : « une fois par
   * lot » et « une fois par page » deviennent indiscernables, et réclamer le
   * compte partout passerait inaperçu. On abaisse donc le plafond du serveur
   * pour que chaque lot s'étale sur plusieurs pages.
   */
  plafondDeLignes = 50;
  await getPrograms(client!);
  const premieresPages = appels.filter((a) => a.offset === 0).length;
  const pagesSuivantes = appels.filter((a) => a.offset > 0).length;

  assert.ok(requetesAvecCompte > 0, "aucune requête ne réclame `count=exact` — l'arrêt redevient une devinette");
  assert.ok(pagesSuivantes > 0, "aucune page au-delà de la première : le test ne distingue rien");
  assert.equal(
    requetesAvecCompte,
    premieresPages,
    `le compte est réclamé ${requetesAvecCompte} fois pour ${premieresPages} premières pages ` +
      `(et ${pagesSuivantes} pages suivantes) : il doit l'être exactement une fois par lot`,
  );
});

await test("CNT2. UN PLAFOND SERVEUR SOUS LA PAGE NE FAIT RIEN PERDRE", async () => {
  /*
   * ⚠️ LE CŒUR DE LA CORRECTION, ET LA CONFIGURATION QUI CASSAIT TOUT.
   *
   * Le serveur plafonne à 250 lignes alors que le code en demande 1 000.
   * L'ancien arrêt sur lot partiel rendait 250 lignes sur 840 en déclarant la
   * lecture complète. Avec le total annoncé, la boucle continue jusqu'au
   * bout — sans qu'aucune constante du code n'ait à connaître ce plafond.
   */
  plafondDeLignes = 250;
  const programmes = await getPrograms(client!);
  const seances = programmes.reduce((n, p) => n + p.sessions.length, 0);
  assert.equal(seances, NB_SEANCES, "un plafond serveur sous la taille de page a tronqué la lecture");
  const exercices = programmes.reduce(
    (n, p) => n + p.sessions.reduce((m, s) => m + s.exercises.length, 0),
    0,
  );
  assert.equal(exercices, NB_SEANCES, "des exercices ont été perdus sous un plafond bas");
});

await test("CNT3. un plafond ABSURDEMENT bas ne perd toujours rien", async () => {
  // 7 lignes par réponse : des dizaines de pages par lot, et toujours le compte exact.
  plafondDeLignes = 7;
  const programmes = await getPrograms(client!);
  assert.equal(programmes.reduce((n, p) => n + p.sessions.length, 0), NB_SEANCES);
});

await test("CNT4. SANS total, on ne s'arrête QUE sur un lot vide — jamais sur un lot partiel", async () => {
  /*
   * ⚠️ LE REPLI NE DOIT PAS ÊTRE UNE PORTE DÉROBÉE. Si le serveur ne rend pas
   * de `Content-Range`, la lecture perd son arrêt positif — elle ne doit pas
   * pour autant revenir à l'inférence fautive. Ici le plafond (250) est sous
   * la page (1 000) ET le total est masqué : la seule règle qui sauve les
   * 840 séances est l'arrêt sur lot VIDE.
   */
  masquerLeTotal = true;
  plafondDeLignes = 250;
  const programmes = await getPrograms(client!);
  assert.equal(
    programmes.reduce((n, p) => n + p.sessions.length, 0),
    NB_SEANCES,
    "sans total, la lecture s'est arrêtée sur un lot partiel",
  );
});

await test("CNT5. un serveur qui annonce plus qu'il ne rend est DÉNONCÉ", async () => {
  /*
   * Le total annoncé n'est pas atteint et le serveur cesse de rendre des
   * lignes : c'est exactement le symptôme d'une troncature. La lecture doit
   * être refusée, jamais rendue amputée — le builder réenregistre ce qu'il
   * lit, et ce qui manque serait détruit.
   */
  tableEnPanneApres = { table: "workout_sessions", apres: 0 };
  masquerLeTotal = false;
  await assert.rejects(
    () => getPrograms(client!),
    /incomplète/i,
    "une lecture arrêtée avant le total annoncé a été acceptée",
  );
});

await test("CNT7. un serveur qui TARIT sans erreur est dénoncé, pas cru sur parole", async () => {
  /*
   * ⚠️ LE CAS QUE « TABLE EN PANNE » NE COUVRE PAS, ET C'EST LE PLUS INSIDIEUX.
   *
   * Une panne renvoie une erreur, que la boucle voit. Ici le serveur répond
   * 200 avec zéro ligne alors que son propre total en annonce davantage :
   * aucune erreur, aucun code, rien à journaliser — exactement la signature
   * d'une troncature. Accepter ce lot vide rendrait un catalogue amputé en le
   * déclarant sain, et le builder détruirait le reste au prochain
   * enregistrement.
   */
  plafondDeLignes = 100;
  videApres = { table: "workout_sessions", apres: 1 };
  await assert.rejects(
    () => getPrograms(client!),
    /incomplète/i,
    "un lot vide arrivé AVANT le total annoncé a été accepté comme une fin normale",
  );
});

await test("CNT8. sans total, ce même lot vide reste une fin LÉGITIME", async () => {
  // Le miroir de CNT7 : sans total, un lot vide est la seule fin possible et
  // ne doit surtout pas être traité comme une anomalie.
  masquerLeTotal = true;
  const programmes = await getPrograms(client!);
  assert.equal(programmes.length, NB_PROGRAMMES, "le repli a refusé une lecture pourtant complète");
});

await test("CNT6. la règle de l'arrêt est écrite dans le code, et l'inférence fautive absente", () => {
  // `lireFichier` est importé plus haut (section constante de lot) ; `readFileSync`
  // ne l'est qu'en section VII, après ce test.
  const corps = sourceProgrammes.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  assert.ok(
    /count:\s*"exact"/.test(corps),
    "plus aucune requête ne réclame `count: \"exact\"` — l'arrêt redevient une devinette",
  );
  assert.ok(
    /rows\.length\s*>=\s*total/.test(corps),
    "la condition d'arrêt positive (`rows.length >= total`) a disparu",
  );
  /*
   * ⚠️ L'INFÉRENCE FAUTIVE NE DOIT PAS POUVOIR REVENIR. `lot.length <
   * TAILLE_DE_PAGE` est exactement le test qui tronquait en silence dès que
   * `db-max-rows` passait sous la taille de page.
   */
  assert.ok(
    !/lot\.length\s*<\s*TAILLE_DE_PAGE/.test(corps),
    "l'arrêt sur lot partiel est revenu : une troncature silencieuse est de nouveau possible",
  );
  assert.ok(
    /optionsDePage/.test(corps),
    "les options de page ont disparu — plus rien ne réclame le total",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * VII. LES ÉCRANS ONT VRAIMENT CHANGÉ DE LECTURE
 * ════════════════════════════════════════════════════════════════════════ */

const { readFileSync } = await import("node:fs");
const sansCommentaires = (chemin: string) =>
  readFileSync(chemin, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

await test("LOT15. le builder et la page de détail lisent UN programme, pas la liste", () => {
  for (const chemin of [
    "app/admin/programmes/[programId]/builder/page.tsx",
    "app/admin/programmes/[programId]/page.tsx",
  ]) {
    const code = sansCommentaires(chemin);
    assert.ok(code.includes("useSupabaseProgram("), `${chemin} n'utilise pas la lecture ciblée`);
    assert.ok(
      !/useSupabasePrograms\s*\(/.test(code),
      `${chemin} lit encore TOUS les programmes`,
    );
  }
});

await test("LOT16. la fiche élève lit le résumé, et le programme assigné à part", () => {
  const code = sansCommentaires("app/admin/eleves/[studentId]/page.tsx");
  assert.ok(code.includes("useSupabaseProgramsSummary("), "le catalogue n'est pas lu en résumé");
  assert.ok(code.includes("useSupabaseProgram("), "le programme assigné n'est pas lu séparément");
  assert.ok(!/useSupabasePrograms\s*\(/.test(code), "la fiche élève lit encore tous les programmes complets");
});

await test("LOT17. la règle du découpage est écrite dans le code qui l'applique", () => {
  const source = readFileSync("lib/supabase/programs.ts", "utf8");
  assert.ok(source.includes("lireParLots"), "l'utilitaire de découpage a disparu");
  assert.ok(
    /TAILLE_DE_LOT_IDS\s*=\s*\d+/.test(source),
    "la taille de lot n'est plus une constante nommée",
  );
  const corps = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // ⚠️ AUCUN `.in(` NE DOIT PLUS RECEVOIR DIRECTEMENT UNE LISTE GLOBALE dans
  // les deux lectures de catalogue : si un jour l'un d'eux revient, il
  // rouvrira la panne en silence.
  for (const variable of ["programIds", "weekIds", "sessionIds", "blockIds", "copyIds"]) {
    assert.ok(
      !new RegExp(`\\.in\\(\\s*"[a-z_]+"\\s*,\\s*${variable}\\s*\\)`).test(corps),
      `\`.in(..., ${variable})\` passe encore la liste entière dans l'URL`,
    );
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
