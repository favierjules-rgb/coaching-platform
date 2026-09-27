/**
 * Harnais — LES RAPPELS AUTOMATIQUES N'ENVOIENT QUE CE QUI A UN SENS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 *   • un rappel d'entraînement part quand une séance est prévue AUJOURD'HUI et
 *     qu'elle n'est PAS déjà validée — et jamais autrement ;
 *   • un rappel nutrition part quand la journée alimentaire est INCOMPLÈTE, et
 *     jamais quand elle est complète ou vide ;
 *   • un élève dont le réglage est OFF n'est même pas candidat ;
 *   • deux passages du planificateur sur la même échéance ne produisent qu'UNE
 *     occurrence ;
 *   • les campagnes système n'apparaissent pas dans la liste du coach et ne se
 *     modifient pas comme un message ponctuel ;
 *   • une campagne ORDINAIRE n'est pas filtrée : son comportement est celui
 *     d'avant, à la ligne près.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST RÉEL, ET CE QUI EST DOUBLÉ
 * ════════════════════════════════════════════════════════════════════════
 * RÉELS : les règles (lib/rappels-automatiques.ts), la résolution des cibles et
 * le filtre (lib/notifications/rappels.ts), le traitement d'échéance
 * (lib/notifications/execution.ts), la lecture des programmes assignés
 * (lib/supabase/programs.ts) et le calcul de la semaine
 * (`computeCurrentWeekNumber`, INCHANGÉ par ce chantier).
 *
 * DOUBLÉS : le transport push (aucun message ne part) et la base, au niveau
 * HTTP — le vrai client Supabase, le vrai encodage PostgREST, des lignes en
 * mémoire. Doubler la base plus haut aurait laissé `getAssignedProgramsForStudent`
 * hors du test, c'est-à-dire précisément la partie qui décide QUELLE semaine et
 * QUELLE séance.
 *
 * Lancement : npm run test:rappels-automatiques
 */
import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RACINE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const moduleUrl = (relatif: string) => pathToFileURL(join(RACINE, relatif)).href;
const lire = (relatif: string) => readFileSync(join(RACINE, relatif), "utf8");

if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = class {} as never;
}
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://faux.supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "cle-de-test";

/* ═══════════════ Le transport push, doublé : rien ne part ═══════════════ */

const envois: { endpoints: string[]; titre: string }[] = [];
mock.module(moduleUrl("lib/push/envoyer.ts"), {
  namedExports: {
    envoyerNotifications: async (
      abonnements: { endpoint: string }[],
      contenu: { titre: string; corps: string; destination: string },
    ) => {
      envois.push({ endpoints: abonnements.map((a) => a.endpoint), titre: contenu.titre });
      return abonnements.map((a) => ({
        endpoint: a.endpoint,
        statut: "envoyee" as const,
        codeErreur: null,
        suite: "aucune" as const,
      }));
    },
  },
});

/* ═══════════════════ La base, doublée au niveau HTTP ═══════════════════ */

type Ligne = Record<string, unknown>;
let base: Record<string, Ligne[]> = {};

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
    } else if (valeur.startsWith("lte.")) {
      const borne = valeur.slice(4);
      lignes = lignes.filter((l) => String(l[cle]) <= borne);
    }
  }
  return lignes;
}

function entete(init: RequestInit | undefined, nom: string): string {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return h.get(nom) ?? "";
  if (Array.isArray(h)) return h.find(([c]) => c.toLowerCase() === nom.toLowerCase())?.[1] ?? "";
  const cle = Object.keys(h).find((c) => c.toLowerCase() === nom.toLowerCase());
  return cle ? String((h as Record<string, string>)[cle]) : "";
}

let compteur = 0;
/**
 * LES VALEURS PAR DÉFAUT DU SCHÉMA, APPLIQUÉES POUR DE VRAI.
 *
 * ⚠️ SANS ELLES, LE VERROU NE VERROUILLE RIEN. `reserverOccurrence` fait
 * `update … where status = 'en_attente'` : une occurrence insérée sans statut
 * (parce que la base était censée poser le défaut) ne serait jamais réservée,
 * et le test d'anti-doublon passerait pour de mauvaises raisons.
 */
const DEFAUTS: Record<string, Ligne> = {
  notification_occurrences: { status: "en_attente", claimed_at: null, finished_at: null },
  notification_deliveries: { status: "en_attente", error_code: null, attempted_at: null, sent_at: null },
};

/** Contraintes d'unicité réellement appliquées — c'est elles qu'on teste. */
const UNIQUES: Record<string, string[][]> = {
  notification_occurrences: [["campaign_id", "scheduled_for"]],
  notification_deliveries: [["occurrence_id", "subscription_id"]],
};

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
    const aInserer = JSON.parse(String(init?.body ?? "[]")) as Ligne | Ligne[];
    const lot = Array.isArray(aInserer) ? aInserer : [aInserer];
    const creees: Ligne[] = [];
    for (const brute_ of lot) {
      const ligne: Ligne = { ...(DEFAUTS[table] ?? {}), ...brute_ };
      if (ligne.id === undefined) {
        compteur += 1;
        ligne.id = `${table}-${compteur}`;
      }
      for (const cles of UNIQUES[table] ?? []) {
        if ((base[table] as Ligne[]).some((l) => cles.every((c) => l[c] === ligne[c]))) {
          return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
        }
      }
      (base[table] as Ligne[]).push(ligne);
      creees.push(ligne);
    }
    // `insert().select().maybeSingle()` demande UN objet, pas un tableau :
    // rendre un tableau ferait échouer l'ouverture d'occurrence en silence.
    if (entete(init, "Accept").includes("pgrst.object")) return json(creees[0] ?? null, 201);
    return json(creees, 201);
  }

  if (methode === "PATCH") {
    const patch = JSON.parse(String(init?.body ?? "{}")) as Ligne;
    const touchees = filtrer(table, url.searchParams);
    for (const l of touchees) Object.assign(l, patch);
    if (entete(init, "Accept").includes("pgrst.object")) return json(touchees[0] ?? null);
    return json(touchees);
  }

  if (methode === "DELETE") {
    const restantes = (base[table] as Ligne[]).filter((l) => !filtrer(table, url.searchParams).includes(l));
    base[table] = restantes;
    return json([]);
  }

  const toutes = filtrer(table, url.searchParams);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 1000);
  const tranche = toutes.slice(offset, offset + limit);
  const accept = entete(init, "Accept");
  const entetes: Record<string, string> = {};
  if (entete(init, "Prefer").includes("count=exact")) {
    entetes["Content-Range"] =
      tranche.length > 0 ? `${offset}-${offset + tranche.length - 1}/${toutes.length}` : `*/${toutes.length}`;
  }
  if (accept.includes("pgrst.object")) return json(tranche[0] ?? null, 200, entetes);
  return json(tranche, 200, entetes);
}) as typeof fetch;

/* ═══════════════════════════ Les modules réels ═══════════════════════════ */

const {
  DEFINITIONS_RAPPEL,
  GENRES_RAPPEL,
  jourDeLaSemaineFr,
  rappelEntrainementDu,
  rappelNutritionDu,
  seancesDuJour,
} = await import("../../lib/rappels-automatiques");
const { estDestinationInterne } = await import("../../lib/push/destinations");
const { createSupabaseBrowserClient } = await import("../../lib/supabase/browser");
const { elevesVises, listerCampagnes, campagneDeRappel } = await import("../../lib/notifications/depot");
const { elevesAAvertir } = await import("../../lib/notifications/rappels");
const { traiterEcheance } = await import("../../lib/notifications/execution");

const client = createSupabaseBrowserClient();
assert.ok(client, "client Supabase non construit");

/* ═══════════════════════════════ Harnais ═══════════════════════════════ */

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

const ELEVE_ACTIF = "11111111-1111-4111-8111-111111111111";
const ELEVE_A_JOUR = "22222222-2222-4222-8222-222222222222";
const ELEVE_SANS_SEANCE = "33333333-3333-4333-8333-333333333333";
const ELEVE_OFF = "44444444-4444-4444-8444-444444444444";
const COMPTE = (n: string) => `compte-${n}`;

/** Lundi 7 septembre 2026, 08:00 — la date de référence de tout ce fichier. */
const LUNDI = new Date(2026, 8, 7, 8, 0, 0);
const DEBUT_PROGRAMME = "2026-09-07"; // semaine 1 = celle du lundi ci-dessus

const CAMPAGNE_ENTRAINEMENT = "camp-entrainement";
const CAMPAGNE_NUTRITION = "camp-nutrition";
const CAMPAGNE_ORDINAIRE = "camp-ordinaire";

function poserBase() {
  compteur = 0;
  envois.length = 0;
  base = {
    students: [
      { id: ELEVE_ACTIF, user_id: COMPTE(ELEVE_ACTIF), start_date: DEBUT_PROGRAMME },
      { id: ELEVE_A_JOUR, user_id: COMPTE(ELEVE_A_JOUR), start_date: DEBUT_PROGRAMME },
      { id: ELEVE_SANS_SEANCE, user_id: COMPTE(ELEVE_SANS_SEANCE), start_date: DEBUT_PROGRAMME },
      { id: ELEVE_OFF, user_id: COMPTE(ELEVE_OFF), start_date: DEBUT_PROGRAMME },
    ],
    programs: [
      {
        id: "prog-1", name: "Force", goal: "Force", level: "Intermédiaire", duration_weeks: 4,
        status: "actif", created_at: "2026-09-01", updated_at: "2026-09-01", banner_url: null,
        program_mode: "individuel", group_start_date: null, is_public: false,
        public_subscription_template_id: null, owner_student_id: null, source_template_id: null,
        description: "", program_start_date: DEBUT_PROGRAMME,
      },
    ],
    // Trois élèves partagent le même programme : la différence vient de ce
    // qu'ils ont VALIDÉ, pas de ce qui leur est prescrit.
    assignments: [
      { id: "a1", content_type: "programme", content_id: "prog-1", student_id: ELEVE_ACTIF },
      { id: "a2", content_type: "programme", content_id: "prog-1", student_id: ELEVE_A_JOUR },
      { id: "a4", content_type: "programme", content_id: "prog-1", student_id: ELEVE_OFF },
    ],
    program_weeks: [{ id: "w1", program_id: "prog-1", week_number: 1 }],
    workout_sessions: [
      {
        id: "seance-lundi", program_id: "prog-1", program_week_id: "w1", day: "Lundi",
        is_rest_day: false, name: "Haut du corps", muscle_group: "Pectoraux",
        duration_minutes: 60, warmup: "", coach_notes: "", session_type: "strength",
        banner_url: null, created_at: "2026-09-01", updated_at: "2026-09-01",
      },
      {
        id: "seance-mardi", program_id: "prog-1", program_week_id: "w1", day: "Mardi",
        is_rest_day: false, name: "Bas du corps", muscle_group: "Quadriceps",
        duration_minutes: 60, warmup: "", coach_notes: "", session_type: "strength",
        banner_url: null, created_at: "2026-09-01", updated_at: "2026-09-01",
      },
    ],
    workout_exercises: [],
    training_blocks: [],
    training_prescriptions: [],
    // ELEVE_A_JOUR a déjà validé la séance du lundi, avant 08:00.
    workout_feedback: [
      {
        id: "wf-1", student_id: ELEVE_A_JOUR, session_id: "seance-lundi", completed: true,
        program_id: "prog-1", session_key: "seance-lundi",
      },
    ],
    planned_meals: [],
    push_subscriptions: [
      { id: "sub-1", user_id: COMPTE(ELEVE_ACTIF), endpoint: "https://push.test/1", p256dh: "P", auth: "A", disabled_at: null },
      { id: "sub-2", user_id: COMPTE(ELEVE_A_JOUR), endpoint: "https://push.test/2", p256dh: "P", auth: "A", disabled_at: null },
      { id: "sub-3", user_id: COMPTE(ELEVE_SANS_SEANCE), endpoint: "https://push.test/3", p256dh: "P", auth: "A", disabled_at: null },
      { id: "sub-4", user_id: COMPTE(ELEVE_OFF), endpoint: "https://push.test/4", p256dh: "P", auth: "A", disabled_at: null },
    ],
    notification_campaigns: [
      {
        id: CAMPAGNE_ENTRAINEMENT, created_by: null, title: "Séance du jour",
        body: "Ta séance t'attend aujourd'hui.", destination: "/entrainement",
        target_kind: "students", schedule_kind: "recurring", timezone: "Europe/Paris",
        recurrence: { freq: "daily", hour: 8, minute: 0 }, next_run_at: LUNDI.toISOString(),
        active: true, status: "programmee", created_at: "2026-09-01", rappel_auto: "entrainement",
      },
      {
        id: CAMPAGNE_NUTRITION, created_by: null, title: "Journée alimentaire",
        body: "Il reste des repas à compléter pour aujourd'hui.", destination: "/nutrition",
        target_kind: "students", schedule_kind: "recurring", timezone: "Europe/Paris",
        recurrence: { freq: "daily", hour: 20, minute: 30 }, next_run_at: LUNDI.toISOString(),
        active: true, status: "programmee", created_at: "2026-09-01", rappel_auto: "nutrition",
      },
      {
        id: CAMPAGNE_ORDINAIRE, created_by: "coach-1", title: "Message du coach",
        body: "Bonne semaine !", destination: "/dashboard", target_kind: "students",
        schedule_kind: "once", timezone: "Europe/Paris", recurrence: null,
        next_run_at: LUNDI.toISOString(), active: true, status: "programmee",
        created_at: "2026-09-02", rappel_auto: null,
      },
    ],
    // ⚠️ L'APPARTENANCE EST LE RÉGLAGE : ELEVE_OFF n'y figure pas.
    notification_campaign_targets: [
      { campaign_id: CAMPAGNE_ENTRAINEMENT, student_id: ELEVE_ACTIF },
      { campaign_id: CAMPAGNE_ENTRAINEMENT, student_id: ELEVE_A_JOUR },
      { campaign_id: CAMPAGNE_ENTRAINEMENT, student_id: ELEVE_SANS_SEANCE },
      { campaign_id: CAMPAGNE_NUTRITION, student_id: ELEVE_ACTIF },
      { campaign_id: CAMPAGNE_NUTRITION, student_id: ELEVE_A_JOUR },
      { campaign_id: CAMPAGNE_ORDINAIRE, student_id: ELEVE_ACTIF },
      { campaign_id: CAMPAGNE_ORDINAIRE, student_id: ELEVE_OFF },
    ],
    notification_occurrences: [],
    notification_deliveries: [],
    exercise_library: [],
  };
}

const campagne = async (id: string) => {
  const toutes = await listerCampagnes(client);
  const trouvee = toutes.find((c) => c.id === id);
  if (trouvee) return trouvee;
  // Les campagnes système sont exclues de `listerCampagnes` : on les lit par genre.
  const entr = await campagneDeRappel(client, "entrainement");
  if (entr?.id === id) return entr;
  const nutr = await campagneDeRappel(client, "nutrition");
  if (nutr?.id === id) return nutr;
  throw new Error(`campagne ${id} introuvable`);
};

/* ════════════════════════════════ Tests ════════════════════════════════ */

await (async () => {
  poserBase();

  await test("1. LE NOM DU JOUR est celui que `workout_sessions.day` stocke", () => {
    // Semaine du lundi 7 au dimanche 13 septembre 2026.
    const attendus = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    for (let i = 0; i < 7; i += 1) {
      assert.equal(jourDeLaSemaineFr(new Date(2026, 8, 7 + i)), attendus[i]);
    }
  });

  await test("2. SÉANCES DU JOUR — semaine, jour et repos filtrés", () => {
    const seances = [
      { id: "a", day: "Lundi", weekNumber: 1, isRestDay: false },
      { id: "b", day: "Lundi", weekNumber: 2, isRestDay: false },
      { id: "c", day: "Mardi", weekNumber: 1, isRestDay: false },
      { id: "d", day: "Lundi", weekNumber: 1, isRestDay: true },
    ];
    const duJour = seancesDuJour({ seances, semaineCalendaire: 1, jour: "Lundi" });
    assert.deepEqual(duJour.map((s) => s.id), ["a"], "ni l'autre semaine, ni l'autre jour, ni le repos");
  });

  await test("3. SÉANCE PRÉVUE ET NON TERMINÉE → rappel", () => {
    assert.equal(
      rappelEntrainementDu({
        seances: [{ id: "a", day: "Lundi", weekNumber: 1, isRestDay: false }],
        semaineCalendaire: 1,
        jour: "Lundi",
        seancesTerminees: new Set(),
      }),
      true,
    );
  });

  await test("4. SÉANCE DÉJÀ VALIDÉE AVANT L'HEURE → aucun rappel", () => {
    assert.equal(
      rappelEntrainementDu({
        seances: [{ id: "a", day: "Lundi", weekNumber: 1, isRestDay: false }],
        semaineCalendaire: 1,
        jour: "Lundi",
        seancesTerminees: new Set(["a"]),
      }),
      false,
      "rappeler une séance déjà faite est exactement ce qui fait couper les notifications",
    );
  });

  await test("5. AUCUNE SÉANCE CE JOUR-LÀ → aucun rappel", () => {
    const seances = [{ id: "a", day: "Lundi", weekNumber: 1, isRestDay: false }];
    assert.equal(
      rappelEntrainementDu({ seances, semaineCalendaire: 1, jour: "Mercredi", seancesTerminees: new Set() }),
      false,
    );
    assert.equal(
      rappelEntrainementDu({ seances, semaineCalendaire: 2, jour: "Lundi", seancesTerminees: new Set() }),
      false,
      "la séance du lundi de la semaine 1 ne se rappelle pas en semaine 2",
    );
  });

  await test("6. JOUR DE REPOS → aucun rappel", () => {
    assert.equal(
      rappelEntrainementDu({
        seances: [{ id: "a", day: "Lundi", weekNumber: 1, isRestDay: true }],
        semaineCalendaire: 1,
        jour: "Lundi",
        seancesTerminees: new Set(),
      }),
      false,
    );
  });

  await test("7. DEUX SÉANCES LE MÊME JOUR, UNE FAITE → il reste quelque chose à rappeler", () => {
    const seances = [
      { id: "a", day: "Lundi", weekNumber: 1, isRestDay: false },
      { id: "b", day: "Lundi", weekNumber: 1, isRestDay: false },
    ];
    assert.equal(
      rappelEntrainementDu({ seances, semaineCalendaire: 1, jour: "Lundi", seancesTerminees: new Set(["a"]) }),
      true,
    );
    assert.equal(
      rappelEntrainementDu({ seances, semaineCalendaire: 1, jour: "Lundi", seancesTerminees: new Set(["a", "b"]) }),
      false,
    );
  });

  await test("8. JOURNÉE ALIMENTAIRE INCOMPLÈTE → rappel", () => {
    assert.equal(
      rappelNutritionDu({ repas: [{ id: "r1", consomme: true }, { id: "r2", consomme: false }] }),
      true,
    );
  });

  await test("9. JOURNÉE COMPLÈTE → aucun rappel", () => {
    assert.equal(
      rappelNutritionDu({ repas: [{ id: "r1", consomme: true }, { id: "r2", consomme: true }] }),
      false,
    );
  });

  await test("10. AUCUN REPAS PLANIFIÉ → aucun rappel", () => {
    assert.equal(
      rappelNutritionDu({ repas: [] }),
      false,
      "« complète ta journée » à quelqu'un qui n'a rien de prévu est un reproche sans objet",
    );
  });

  await test("11. LA DÉFINITION DES CAMPAGNES EST LA MÊME ICI ET DANS LA MIGRATION", () => {
    const sql = lire("supabase/migrations/20260927090000_rappels_automatiques.sql");
    for (const genre of GENRES_RAPPEL) {
      const def = DEFINITIONS_RAPPEL[genre];
      assert.ok(sql.includes(`'${def.titre}'`), `titre « ${def.titre} » absent de la migration`);
      assert.ok(sql.includes(`'${def.destination}'`), `destination ${def.destination} absente`);
      assert.ok(
        sql.includes(`'hour', ${def.heure}, 'minute', ${def.minute}`),
        `horaire ${def.heure}:${def.minute} absent de la migration pour ${genre}`,
      );
      assert.ok(sql.includes(`'${genre}'`), `genre ${genre} absent`);
    }
  });

  await test("12. LES DESTINATIONS DES RAPPELS SONT DANS LA LISTE FERMÉE", () => {
    for (const genre of GENRES_RAPPEL) {
      assert.ok(
        estDestinationInterne(DEFINITIONS_RAPPEL[genre].destination),
        `${DEFINITIONS_RAPPEL[genre].destination} n'est pas une destination interne autorisée`,
      );
    }
  });

  await test("13. RÉGLAGE OFF — l'élève n'est même pas candidat", async () => {
    poserBase();
    const vises = await elevesVises(client, await campagne(CAMPAGNE_ENTRAINEMENT));
    const ids = vises.map((e) => e.studentId).sort();
    assert.deepEqual(
      ids,
      [ELEVE_ACTIF, ELEVE_A_JOUR, ELEVE_SANS_SEANCE].sort(),
      "ELEVE_OFF n'a pas de ligne de ciblage : il ne doit pas apparaître",
    );
    assert.ok(!ids.includes(ELEVE_OFF));
  });

  await test("14. ENTRAÎNEMENT — seul l'élève dont la séance du jour reste à faire est retenu", async () => {
    poserBase();
    const vises = await elevesVises(client, await campagne(CAMPAGNE_ENTRAINEMENT));
    const retenus = await elevesAAvertir(client, "entrainement", vises, LUNDI);
    assert.deepEqual(
      retenus.map((e) => e.studentId),
      [ELEVE_ACTIF],
      "ELEVE_A_JOUR a validé sa séance, ELEVE_SANS_SEANCE n'est pas assigné au programme",
    );
  });

  await test("15. ENTRAÎNEMENT — un jour sans séance ne retient personne", async () => {
    poserBase();
    const vises = await elevesVises(client, await campagne(CAMPAGNE_ENTRAINEMENT));
    // Mercredi 9 septembre : le programme n'a que lundi et mardi.
    const retenus = await elevesAAvertir(client, "entrainement", vises, new Date(2026, 8, 9, 8, 0, 0));
    assert.deepEqual(retenus, []);
  });

  await test("16. ENTRAÎNEMENT — un programme NON ACTIF ne déclenche rien", async () => {
    poserBase();
    (base.programs as Ligne[])[0]!.status = "brouillon";
    const vises = await elevesVises(client, await campagne(CAMPAGNE_ENTRAINEMENT));
    const retenus = await elevesAAvertir(client, "entrainement", vises, LUNDI);
    assert.deepEqual(retenus, [], "un brouillon rendrait « semaine 1 » et rappellerait une séance non suivie");
  });

  await test("17. NUTRITION — incomplète retenue, complète et vide écartées", async () => {
    poserBase();
    base.planned_meals = [
      // ELEVE_ACTIF : un repas consommé, un non consommé → incomplet.
      { id: "pm1", student_id: ELEVE_ACTIF, planned_on: "2026-09-07", consumed_meal_id: "cm1" },
      { id: "pm2", student_id: ELEVE_ACTIF, planned_on: "2026-09-07", consumed_meal_id: null },
      // ELEVE_A_JOUR : tout consommé → complet.
      { id: "pm3", student_id: ELEVE_A_JOUR, planned_on: "2026-09-07", consumed_meal_id: "cm2" },
      // Un repas d'un AUTRE jour ne doit pas compter.
      { id: "pm4", student_id: ELEVE_A_JOUR, planned_on: "2026-09-08", consumed_meal_id: null },
    ];
    const vises = await elevesVises(client, await campagne(CAMPAGNE_NUTRITION));
    const retenus = await elevesAAvertir(client, "nutrition", vises, new Date(2026, 8, 7, 20, 30, 0));
    assert.deepEqual(retenus.map((e) => e.studentId), [ELEVE_ACTIF]);
  });

  await test("18. NUTRITION — aucun repas planifié, personne n'est retenu", async () => {
    poserBase();
    const vises = await elevesVises(client, await campagne(CAMPAGNE_NUTRITION));
    const retenus = await elevesAAvertir(client, "nutrition", vises, new Date(2026, 8, 7, 20, 30, 0));
    assert.deepEqual(retenus, []);
  });

  await test("19. ENVOI RÉEL — un seul élève servi, un seul appareil", async () => {
    poserBase();
    const bilan = await traiterEcheance(client, await campagne(CAMPAGNE_ENTRAINEMENT), LUNDI.toISOString());
    assert.equal(bilan.appareilsCibles, 1, "seul l'appareil de l'élève retenu est servi");
    assert.equal(bilan.envoyes, 1);
    assert.deepEqual(envois.map((e) => e.endpoints).flat(), ["https://push.test/1"]);
  });

  await test("20. ANTI-DOUBLON — deux passages sur la même échéance, une seule occurrence", async () => {
    poserBase();
    const c = await campagne(CAMPAGNE_ENTRAINEMENT);
    const premier = await traiterEcheance(client, c, LUNDI.toISOString());
    const second = await traiterEcheance(client, c, LUNDI.toISOString());
    assert.ok(premier.occurrenceId, "le premier passage traite l'échéance");
    assert.equal(second.occurrenceId, null, "le second ne la retraite pas");
    assert.equal(second.raison, "deja-reservee");
    assert.equal((base.notification_occurrences as Ligne[]).length, 1);
    assert.equal(envois.length, 1, "aucun second envoi");
  });

  await test("21. UNE CAMPAGNE ORDINAIRE N'EST PAS FILTRÉE — comportement d'avant", async () => {
    poserBase();
    const bilan = await traiterEcheance(client, await campagne(CAMPAGNE_ORDINAIRE), LUNDI.toISOString());
    assert.equal(
      bilan.appareilsCibles,
      2,
      "ses deux cibles sont servies, sans condition de séance ni de repas",
    );
  });

  await test("22. LES CAMPAGNES SYSTÈME SONT HORS DE LA LISTE DU COACH", async () => {
    poserBase();
    const listees = await listerCampagnes(client);
    assert.deepEqual(listees.map((c) => c.id), [CAMPAGNE_ORDINAIRE]);
    // Mais elles restent lisibles par leur genre, pour le planificateur.
    assert.equal((await campagneDeRappel(client, "entrainement"))?.id, CAMPAGNE_ENTRAINEMENT);
    assert.equal((await campagneDeRappel(client, "nutrition"))?.id, CAMPAGNE_NUTRITION);
  });

  await test("23. UNE CAMPAGNE SYSTÈME NE SE MODIFIE PAS COMME UN MESSAGE", () => {
    const route = lire("app/api/admin/notifications/campaigns/[id]/route.ts");
    const corps = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(
      /campagne\.rappelAuto !== null/.test(corps),
      "la garde qui refuse les campagnes système a disparu de la route PATCH/DELETE",
    );
    // Et elle doit précéder le contrôle de propriété : un admin ne doit pas
    // pouvoir passer là où un coach est arrêté.
    assert.ok(
      corps.indexOf("rappelAuto !== null") < corps.indexOf("estAdmin"),
      "le refus des campagnes système doit précéder le contrôle de propriété",
    );
  });

  await test("24. LE FILTRE N'EST PAS OPTIONNEL DANS L'ENVOI", () => {
    const source = lire("lib/notifications/execution.ts");
    const corps = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(corps.includes("elevesAAvertir"), "le filtre conditionnel a disparu de l'envoi");
    assert.ok(
      corps.includes("campagne.rappelAuto === null"),
      "l'envoi ne distingue plus une campagne ordinaire d'un rappel automatique",
    );
    assert.ok(
      !/filtrer\w*\?:/.test(corps),
      "le filtre est devenu un paramètre optionnel : un appelant qui l'oublie enverrait sans condition",
    );
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
