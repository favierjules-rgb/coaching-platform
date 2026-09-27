/**
 * Harnais — LES QUATRE CORRECTIFS PRÉ-FUSION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER DÉFEND
 * ════════════════════════════════════════════════════════════════════════
 *   1. les PRIVILÈGES de `program_review_flags` — sans eux, Postgres refuse
 *      avant même de lire la policy ;
 *   2. les PRIVILÈGES des deux tables de notifications lues depuis le
 *      navigateur, au plus juste : pas un droit d'écriture de trop ;
 *   3. l'ISOLATION PAR ÉLÈVE du rappel d'entraînement — un élève dont le
 *      programme ne se lit pas ne prive pas les autres de leur rappel ;
 *   4. l'IDEMPOTENCE de l'activation — activer deux fois n'est pas une erreur.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI LES DEUX PREMIERS SONT DES TESTS DE SQL, ET NON D'EXÉCUTION
 * ════════════════════════════════════════════════════════════════════════
 * Un `grant` ne se prouve pour de vrai que contre un vrai Postgres, avec un
 * vrai rôle `authenticated`. Ce harnais n'en a pas, et fabriquer un faux
 * moteur de privilèges ne prouverait que la fidélité du faux. Ce qu'il
 * vérifie donc, c'est ce qui est vérifiable sans base : que les migrations
 * correctives accordent EXACTEMENT l'ensemble de privilèges que le chemin
 * navigateur exige, ni plus, ni moins — et les tests de sabotage montrent
 * qu'un droit retiré ou un droit de trop rougit.
 *
 * ⚠️ CE QUE CES DEUX TESTS NE PROUVENT PAS : que la base distante a bien reçu
 * ces `grant`. Cela se vérifie après `supabase db push`, par
 * `information_schema.role_table_grants`. C'est dit ici pour que personne ne
 * lise « vert » comme « appliqué ».
 *
 * Lancement : npm run test:correctifs-pre-merge
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const lire = (relatif: string) => readFileSync(join(RACINE, relatif), "utf8");

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

/* ═════════════════ Lecture des privilèges d'une migration ═════════════════ */

const MIGRATION_FLAGS = "supabase/migrations/20260928090000_program_review_flags_grants.sql";
const MIGRATION_NOTIFS = "supabase/migrations/20260929090000_notifications_grants.sql";

/** Le SQL sans commentaires, espaces normalisés — pour analyser des instructions. */
function instructions(chemin: string): string {
  return lire(chemin)
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `table` → `rôle` → ensemble des privilèges accordés. `all` reste « all ». */
function grantsDe(sql: string): Map<string, Map<string, Set<string>>> {
  const parTable = new Map<string, Map<string, Set<string>>>();
  const motif = /grant\s+([a-z, ]+?)\s+on\s+table\s+public\.(\w+)\s+to\s+([a-z_, ]+?)\s*;/g;
  for (const trouve of sql.matchAll(motif)) {
    const privileges = (trouve[1] as string).split(",").map((p) => p.trim()).filter(Boolean);
    const table = trouve[2] as string;
    const roles = (trouve[3] as string).split(",").map((r) => r.trim()).filter(Boolean);
    const parRole = parTable.get(table) ?? new Map<string, Set<string>>();
    for (const role of roles) {
      const deja = parRole.get(role) ?? new Set<string>();
      for (const p of privileges) deja.add(p);
      parRole.set(role, deja);
    }
    parTable.set(table, parRole);
  }
  return parTable;
}

/** `table` → ensemble des rôles dont TOUT a été révoqué. */
function revocationsDe(sql: string): Map<string, Set<string>> {
  const parTable = new Map<string, Set<string>>();
  const motif = /revoke\s+all\s+on\s+(?:table\s+)?public\.(\w+)\s+from\s+([a-z_, ]+?)\s*;/g;
  for (const trouve of sql.matchAll(motif)) {
    const table = trouve[1] as string;
    const roles = (trouve[2] as string).split(",").map((r) => r.trim()).filter(Boolean);
    const deja = parTable.get(table) ?? new Set<string>();
    for (const r of roles) deja.add(r);
    parTable.set(table, deja);
  }
  return parTable;
}

const privileges = (sql: string, table: string, role: string): Set<string> =>
  grantsDe(sql).get(table)?.get(role) ?? new Set<string>();

/* ═══════════ Un faux PostgREST : contraintes et `on_conflict` réels ═══════ */

type Ligne = Record<string, unknown>;
let base: Record<string, Ligne[]> = {};
/** Le n-ième GET de cette table échoue — pour isoler UN élève, pas tous. */
let echecAuNieme: { table: string; rang: number } | null = null;
let compteurs: Record<string, number> = {};
let conflitsIgnores = 0;

/** Clés uniques réellement appliquées, comme en base. */
const UNIQUES: Record<string, string[][]> = {
  notification_campaign_targets: [["campaign_id", "student_id"]],
  notification_occurrences: [["campaign_id", "scheduled_for"]],
};

function entete(init: RequestInit | undefined, nom: string): string {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return h.get(nom) ?? "";
  if (Array.isArray(h)) return h.find(([c]) => c.toLowerCase() === nom.toLowerCase())?.[1] ?? "";
  const cle = Object.keys(h).find((c) => c.toLowerCase() === nom.toLowerCase());
  return cle ? String((h as Record<string, string>)[cle]) : "";
}

function filtrer(table: string, params: URLSearchParams): Ligne[] {
  let lignes = base[table] ?? [];
  for (const [cle, valeur] of params) {
    if (["select", "order", "offset", "limit", "columns", "on_conflict"].includes(cle)) continue;
    if (valeur.startsWith("eq.")) {
      const attendu = valeur.slice(3);
      lignes = lignes.filter((l) => String(l[cle]) === attendu);
    } else if (valeur.startsWith("in.")) {
      const ensemble = new Set(
        valeur.slice(3).replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")),
      );
      lignes = lignes.filter((l) => ensemble.has(String(l[cle])));
    } else if (valeur === "is.null") {
      lignes = lignes.filter((l) => l[cle] === null || l[cle] === undefined);
    } else if (valeur === "not.is.null") {
      lignes = lignes.filter((l) => l[cle] !== null && l[cle] !== undefined);
    }
  }
  return lignes;
}

globalThis.fetch = (async (entree: unknown, init?: RequestInit) => {
  const brute = typeof entree === "string" ? entree : String((entree as { url: string }).url);
  const url = new URL(brute);
  const table = url.pathname.split("/rest/v1/")[1] ?? "?";
  const methode = (init?.method ?? "GET").toUpperCase();
  base[table] ??= [];

  const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) =>
    new Response(JSON.stringify(corps), {
      status: statut,
      headers: { "Content-Type": "application/json", ...entetes },
    });

  if (methode === "POST") {
    const lot = JSON.parse(String(init?.body ?? "[]")) as Ligne | Ligne[];
    const aInserer = Array.isArray(lot) ? lot : [lot];
    const prefer = entete(init, "Prefer");
    const ignorerDoublons = prefer.includes("resolution=ignore-duplicates");
    const fusionner = prefer.includes("resolution=merge-duplicates");
    const creees: Ligne[] = [];
    for (const brute_ of aInserer) {
      const ligne: Ligne = { ...brute_ };
      const conflit = (UNIQUES[table] ?? []).some((cles) =>
        (base[table] as Ligne[]).some((l) => cles.every((c) => l[c] === ligne[c])),
      );
      if (conflit) {
        /*
         * ⚠️ LE FAUX SERVEUR DISTINGUE LES TROIS RÉSOLUTIONS, comme PostgREST.
         * Sans `on_conflict`, un doublon est un 23505 — c'est le défaut que le
         * correctif 4 supprime. `ignore-duplicates` ne fait rien et répond
         * 201 : aucune ligne modifiée, donc aucun privilège `update` requis.
         * `merge-duplicates` ferait un `do update`, qu'on refuse (voir la
         * migration 20260929090000) — on le laisse passer ici pour que le test
         * 8 puisse prouver que le code ne l'utilise PAS.
         */
        if (ignorerDoublons) {
          conflitsIgnores += 1;
          continue;
        }
        if (!fusionner) {
          return json(
            { code: "23505", message: "duplicate key value violates unique constraint" },
            409,
          );
        }
      }
      if (ligne.id === undefined && table !== "notification_campaign_targets") {
        ligne.id = `${table}-${(base[table] as Ligne[]).length + 1}`;
      }
      (base[table] as Ligne[]).push(ligne);
      creees.push(ligne);
    }
    if (entete(init, "Accept").includes("pgrst.object")) return json(creees[0] ?? null, 201);
    return json(creees, 201);
  }

  if (methode === "DELETE") {
    const aSupprimer = filtrer(table, url.searchParams);
    base[table] = (base[table] as Ligne[]).filter((l) => !aSupprimer.includes(l));
    return json([]);
  }

  compteurs[table] = (compteurs[table] ?? 0) + 1;
  if (echecAuNieme && echecAuNieme.table === table && compteurs[table] === echecAuNieme.rang) {
    // Une lecture interrompue : c'est exactement ce qui fait LEVER `loadPrograms`.
    return json({ code: "57P01", message: "server closed the connection unexpectedly" }, 500);
  }

  const toutes = filtrer(table, url.searchParams);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 1000);
  const tranche = toutes.slice(offset, offset + limit);
  const entetes: Record<string, string> = {};
  if (entete(init, "Prefer").includes("count=exact")) {
    entetes["Content-Range"] =
      tranche.length > 0 ? `${offset}-${offset + tranche.length - 1}/${toutes.length}` : `*/${toutes.length}`;
  }
  if (entete(init, "Accept").includes("pgrst.object")) return json(tranche[0] ?? null, 200, entetes);
  return json(tranche, 200, entetes);
}) as typeof fetch;

if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = class {} as never;
}
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://faux.supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "cle-de-test";

const { createSupabaseBrowserClient } = await import("../../lib/supabase/browser");
const { elevesAAvertir } = await import("../../lib/notifications/rappels");
const { definirRappelEleve, lireRappelsEleve } = await import("../../lib/supabase/rappels-eleve");

const client = createSupabaseBrowserClient();
assert.ok(client, "client Supabase non construit");

/* ════════════════════════════ Le monde de test ════════════════════════════ */

const ELEVE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ELEVE_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CAMPAGNE = "camp-entrainement";
const LUNDI = new Date(2026, 8, 7, 8, 0, 0);
const DEBUT = "2026-09-07";

function programme(id: string, weekId: string, sessionId: string): Ligne[] {
  return [
    {
      id, name: "Force", goal: "Force", level: "Intermédiaire", duration_weeks: 4,
      status: "actif", created_at: "2026-09-01", updated_at: "2026-09-01", banner_url: null,
      program_mode: "individuel", group_start_date: null, is_public: false,
      public_subscription_template_id: null, owner_student_id: null, source_template_id: null,
      description: "", program_start_date: DEBUT,
    },
    { id: weekId, program_id: id, week_number: 1 },
    {
      id: sessionId, program_id: id, program_week_id: weekId, day: "Lundi", is_rest_day: false,
      name: "Haut du corps", muscle_group: "Pectoraux", duration_minutes: 60, warmup: "",
      coach_notes: "", session_type: "strength", banner_url: null,
      created_at: "2026-09-01", updated_at: "2026-09-01",
    },
  ];
}

function poserBase() {
  compteurs = {};
  echecAuNieme = null;
  conflitsIgnores = 0;
  const [progA, weekA, seanceA] = programme("prog-A", "week-A", "seance-A");
  const [progB, weekB, seanceB] = programme("prog-B", "week-B", "seance-B");
  base = {
    students: [
      { id: ELEVE_A, user_id: "compte-A", start_date: DEBUT },
      { id: ELEVE_B, user_id: "compte-B", start_date: DEBUT },
    ],
    programs: [progA as Ligne, progB as Ligne],
    assignments: [
      { id: "as-A", content_type: "programme", content_id: "prog-A", student_id: ELEVE_A },
      { id: "as-B", content_type: "programme", content_id: "prog-B", student_id: ELEVE_B },
    ],
    program_weeks: [weekA as Ligne, weekB as Ligne],
    workout_sessions: [seanceA as Ligne, seanceB as Ligne],
    workout_exercises: [],
    training_blocks: [],
    training_prescriptions: [],
    workout_feedback: [],
    notification_campaigns: [{ id: CAMPAGNE, rappel_auto: "entrainement" }],
    notification_campaign_targets: [],
    planned_meals: [],
    exercise_library: [],
  };
}

const VISES = [
  { studentId: ELEVE_A, userId: "compte-A" },
  { studentId: ELEVE_B, userId: "compte-B" },
];

/* ══════════════════════════════════ Tests ══════════════════════════════════ */

await (async () => {
  /* ─── CORRECTIF 1 — privilèges de program_review_flags ─── */

  await test("1. program_review_flags — `authenticated` obtient select/insert/update/delete", () => {
    const sql = instructions(MIGRATION_FLAGS);
    const accordes = privileges(sql, "program_review_flags", "authenticated");
    assert.deepEqual(
      [...accordes].sort(),
      ["delete", "insert", "select", "update"],
      "les quatre opérations du chemin navigateur (select, upsert = insert+update, delete)",
    );
    assert.ok(
      accordes.has("delete"),
      "`delete` est indispensable : retirerVerification SUPPRIME la ligne quand le coach repasse à « À vérifier »",
    );
  });

  await test("2. program_review_flags — anon et public n'obtiennent RIEN, service_role tout", () => {
    const sql = instructions(MIGRATION_FLAGS);
    assert.equal(privileges(sql, "program_review_flags", "anon").size, 0, "aucun grant à anon");
    assert.equal(privileges(sql, "program_review_flags", "public").size, 0, "aucun grant à public");
    assert.deepEqual([...privileges(sql, "program_review_flags", "service_role")], ["all"]);

    const revoques = revocationsDe(sql).get("program_review_flags") ?? new Set<string>();
    assert.deepEqual(
      [...revoques].sort(),
      ["anon", "authenticated", "public"],
      "la révocation précède les grants et couvre les trois rôles",
    );
    // ⚠️ L'ORDRE COMPTE : un `revoke` après le `grant` annulerait le grant.
    assert.ok(
      sql.indexOf("revoke all on table public.program_review_flags") <
        sql.indexOf("grant select, insert, update, delete"),
      "`revoke` doit précéder les `grant`",
    );
  });

  /* ─── CORRECTIF 2 — privilèges des tables de notifications ─── */

  await test("3. notification_campaigns — `authenticated` obtient SELECT et rien d'autre", () => {
    const sql = instructions(MIGRATION_NOTIFS);
    const accordes = privileges(sql, "notification_campaigns", "authenticated");
    assert.deepEqual([...accordes], ["select"], "lecture seule : le navigateur n'écrit jamais une campagne");
    for (const interdit of ["insert", "update", "delete", "all"]) {
      assert.ok(
        !accordes.has(interdit),
        `\`${interdit}\` sur notification_campaigns laisserait dérégler les rappels de TOUS les élèves`,
      );
    }
    assert.deepEqual([...privileges(sql, "notification_campaigns", "service_role")], ["all"]);
    assert.equal(privileges(sql, "notification_campaigns", "anon").size, 0);
  });

  await test("4. notification_campaign_targets — select/insert/delete, JAMAIS update", () => {
    const sql = instructions(MIGRATION_NOTIFS);
    const accordes = privileges(sql, "notification_campaign_targets", "authenticated");
    assert.deepEqual([...accordes].sort(), ["delete", "insert", "select"]);
    assert.ok(
      !accordes.has("update"),
      "les deux colonnes sont la clé primaire : un `update` ne pourrait que DÉPLACER un réglage d'un élève à un autre",
    );
    assert.deepEqual([...privileges(sql, "notification_campaign_targets", "service_role")], ["all"]);
    assert.equal(privileges(sql, "notification_campaign_targets", "anon").size, 0);

    const revoques = revocationsDe(sql).get("notification_campaign_targets") ?? new Set<string>();
    assert.deepEqual([...revoques].sort(), ["anon", "authenticated", "public"]);
  });

  await test("5. AUCUNE MIGRATION EXISTANTE N'EST TOUCHÉE par les deux correctifs", () => {
    for (const chemin of [MIGRATION_FLAGS, MIGRATION_NOTIFS]) {
      const sql = instructions(chemin);
      for (const interdit of [
        "create table", "alter table", "drop ", "create policy", "drop policy",
        "create trigger", "insert into", "update public.", "delete from",
      ]) {
        assert.ok(
          !sql.includes(interdit),
          `${chemin} ne doit contenir que revoke/grant — trouvé « ${interdit} »`,
        );
      }
    }
  });

  /* ─── CORRECTIF 3 — isolation par élève ─── */

  await test("6. ISOLATION — un élève dont le programme ne se lit pas n'emporte pas les autres", async () => {
    poserBase();
    // La 2e lecture de `workout_sessions` échoue : `loadPrograms` LÈVE pour le
    // second élève traité, et pour lui seul.
    echecAuNieme = { table: "workout_sessions", rang: 2 };

    const retenus = await elevesAAvertir(client!, "entrainement", VISES, LUNDI);

    assert.equal(retenus.length, 1, "un seul élève retenu : l'autre a échoué, il est écarté");
    assert.equal(retenus[0]?.studentId, ELEVE_A, "le premier élève, lu sans erreur, garde son rappel");
  });

  await test("7. ISOLATION — dans l'autre sens : le premier échoue, le second passe", async () => {
    poserBase();
    echecAuNieme = { table: "workout_sessions", rang: 1 };

    const retenus = await elevesAAvertir(client!, "entrainement", VISES, LUNDI);

    assert.deepEqual(
      retenus.map((e) => e.studentId),
      [ELEVE_B],
      "l'échec du premier ne doit pas priver le second de son rappel",
    );
  });

  await test("8. ISOLATION — l'exception ne remonte JAMAIS jusqu'à l'appelant", async () => {
    poserBase();
    // Toutes les lectures de séances échouent : les deux élèves lèvent.
    echecAuNieme = { table: "workout_sessions", rang: 1 };
    const premier = await elevesAAvertir(client!, "entrainement", VISES, LUNDI);
    assert.ok(Array.isArray(premier), "la fonction rend un tableau, elle ne rejette pas");

    poserBase();
    echecAuNieme = { table: "program_weeks", rang: 1 };
    const second = await elevesAAvertir(client!, "entrainement", VISES, LUNDI);
    assert.ok(
      Array.isArray(second),
      "une lecture de semaines interrompue doit aussi être absorbée par élève",
    );
  });

  await test("9. ISOLATION — le `catch` n'entoure QUE la lecture du programme", () => {
    const source = lire("lib/notifications/rappels.ts");
    const corps = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.equal(
      (corps.match(/try\s*\{/g) ?? []).length,
      1,
      "un seul try dans ce module : un second serait un filet trop large",
    );
    assert.ok(
      /try\s*\{\s*programmes = await getAssignedProgramsForStudent\(/.test(corps),
      "le try doit entourer exactement la lecture qui lève",
    );
    assert.ok(
      /catch[\s\S]{0,400}?return false;/.test(corps),
      "en cas d'erreur pour un élève : aucun rappel pour lui",
    );
    assert.ok(/console\.error\(/.test(corps), "la trace de diagnostic doit être conservée");
  });

  /* ─── CORRECTIF 4 — idempotence de l'activation ─── */

  await test("10. IDEMPOTENCE — activer, puis réactiver : toujours ON, aucune erreur", async () => {
    poserBase();
    assert.equal(await definirRappelEleve(client!, ELEVE_A, "entrainement", true), true, "1re activation");
    assert.equal(
      (base.notification_campaign_targets as Ligne[]).length,
      1,
      "une ligne de ciblage, une seule",
    );

    assert.equal(
      await definirRappelEleve(client!, ELEVE_A, "entrainement", true),
      true,
      "2e activation : elle doit RÉUSSIR, pas rendre false sur un 23505",
    );
    assert.equal(
      (base.notification_campaign_targets as Ligne[]).length,
      1,
      "toujours une seule ligne : aucun doublon créé",
    );
    assert.equal(conflitsIgnores, 1, "le conflit a été IGNORÉ par la base, pas transformé en erreur");

    const etat = await lireRappelsEleve(client!, ELEVE_A);
    assert.equal(etat.actifs.entrainement, true, "l'interface lit bien ON après deux activations");
  });

  await test("11. IDEMPOTENCE — l'upsert n'exige aucun privilège `update`", () => {
    const source = lire("lib/supabase/rappels-eleve.ts");
    const corps = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(/\.upsert\(/.test(corps), "l'activation doit passer par un upsert");
    assert.ok(
      /ignoreDuplicates:\s*true/.test(corps),
      "sans `ignoreDuplicates`, PostgREST ferait un `do update` — privilège que la migration refuse",
    );
    assert.ok(
      /onConflict:\s*"campaign_id,student_id"/.test(corps),
      "`onConflict` énumère les COLONNES de la clé primaire, pas le nom de la contrainte",
    );
    assert.ok(
      !/notification_campaign_targets_pkey/.test(corps),
      "PostgREST refuserait un nom de contrainte dans `on_conflict`",
    );
  });

  await test("12. OFF — désactiver retire la ligne, et seulement celle de cet élève", async () => {
    poserBase();
    await definirRappelEleve(client!, ELEVE_A, "entrainement", true);
    await definirRappelEleve(client!, ELEVE_B, "entrainement", true);
    assert.equal((base.notification_campaign_targets as Ligne[]).length, 2);

    assert.equal(await definirRappelEleve(client!, ELEVE_A, "entrainement", false), true);

    const restantes = base.notification_campaign_targets as Ligne[];
    assert.deepEqual(
      restantes.map((l) => l.student_id),
      [ELEVE_B],
      "couper le rappel de A ne doit pas toucher celui de B",
    );
    assert.equal((await lireRappelsEleve(client!, ELEVE_A)).actifs.entrainement, false);
    assert.equal((await lireRappelsEleve(client!, ELEVE_B)).actifs.entrainement, true);
  });

  await test("13. OFF — désactiver deux fois ne casse rien", async () => {
    poserBase();
    await definirRappelEleve(client!, ELEVE_A, "entrainement", true);
    assert.equal(await definirRappelEleve(client!, ELEVE_A, "entrainement", false), true);
    assert.equal(
      await definirRappelEleve(client!, ELEVE_A, "entrainement", false),
      true,
      "un second OFF sur une ligne déjà absente ne supprime rien, sans échouer",
    );
    assert.equal((base.notification_campaign_targets as Ligne[]).length, 0);
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
