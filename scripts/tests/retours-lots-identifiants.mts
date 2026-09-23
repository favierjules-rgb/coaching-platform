/**
 * Harnais — LE DÉTAIL DES RETOURS NE DOIT PLUS FAIRE EXPLOSER L'URL.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Que `loadExercisesAndSets` n'envoie plus jamais une liste d'identifiants
 * entière dans la ligne de requête ; que le découpage rend EXACTEMENT les
 * mêmes lignes, dans le même ordre, sans doublon ; que la concurrence est
 * BORNÉE et non simplement « parallèle » ; et qu'un lot en erreur ne devient
 * jamais un lot vide silencieux.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE TEST EXISTE — LA PANNE MESURÉE SUR PREVIEW
 * ════════════════════════════════════════════════════════════════════════
 * `/admin/retours` lisait 129 retours, en tirait 660 identifiants d'exercices
 * et les passait d'un bloc à `.in("exercise_feedback_id", …)`. Les `edge_logs`
 * du projet, sur `/rest/v1/exercise_set_feedback`, séparent parfaitement deux
 * régimes : 91 requêtes de 185 à 4 514 caractères d'URL → 200 ; 15 requêtes de
 * 25 028 à 25 847 → 400, sans une seule ligne entre les deux. La requête était
 * rejetée par la passerelle AVANT la base.
 *
 * Et elle l'était EN SILENCE : `(setRows ?? [])` rendait `[]`, la modale du
 * coach s'ouvrait sans son détail par exercice, et `devWarn` ne journalisait
 * qu'en développement. Une panne complète, invisible, sur l'écran principal du
 * coach.
 *
 * ⚠️ LE PLAFOND DU TEST (10 000 CARACTÈRES) EST ENCADRÉ DES DEUX CÔTÉS, comme
 * celui de scripts/tests/lots-identifiants.mts. Il est SUPÉRIEUR au pire lot
 * légitime (100 identifiants ≈ 4 000 caractères) et TRÈS INFÉRIEUR à ce que
 * produit une liste non découpée (660 identifiants ≈ 25 800). Entre les deux,
 * il distingue exactement ce qu'il doit distinguer — et le test 7 vérifie que
 * la passerelle du harnais refuse bien la requête d'un seul tenant, sans quoi
 * tout le reste serait vert pour de mauvaises raisons.
 *
 * Lancement : npm run test:retours-lots
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = class {} as never;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://faux.supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "cle-de-test";
// ⚠️ LE TEST TOURNE EN « PRODUCTION » DÉLIBÉRÉMENT. C'est le réglage exact de
// Preview et de la production, et c'est lui qui rendait `devWarn` muet.
// (`NODE_ENV` est en lecture seule pour TypeScript : même cast que
// scripts/tests/authz-behaviour.mts.)
(process.env as Record<string, string | undefined>).NODE_ENV = "production";

/* ── Le faux PostgREST, derrière une passerelle qui MESURE l'URL ─────────── */

type Ligne = Record<string, unknown>;

interface Appel {
  readonly table: string;
  readonly longueurUrl: number;
  readonly nbIdentifiants: number;
  readonly rendu: number;
}

/** Plafond de la fausse passerelle, en caractères d'URL. */
const PLAFOND_URL = 10_000;
/** Plafond de lignes du serveur, comme `db-max-rows` (1 000 par défaut chez Supabase). */
const PLAFOND_DE_LIGNES = 1000;

let appels: Appel[] = [];
let base: Record<string, Ligne[]> = {};
let refusees = 0;
let appelsParTable: Record<string, number> = {};
/** Fait échouer le n-ième appel (et les suivants) d'une table — UN lot, pas tous. */
let tableEnPanneApres: { table: string; apres: number } | null = null;
/** Requêtes SIMULTANÉMENT en vol, et le maximum atteint : la concurrence est une mesure. */
let enVol = 0;
let maxEnVol = 0;
/** Rend les lignes à l'envers : l'ordre final ne doit rien devoir à l'ordre d'arrivée. */
let renduAlEnvers = false;

function filtrer(table: string, params: URLSearchParams): Ligne[] {
  let lignes = base[table] ?? [];
  for (const [cle, valeur] of params) {
    if (["select", "order", "offset", "limit"].includes(cle)) continue;
    if (valeur.startsWith("eq.")) {
      lignes = lignes.filter((l) => String(l[cle]) === valeur.slice(3));
    } else if (valeur.startsWith("in.")) {
      const ensemble = new Set(
        valeur
          .slice(3)
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((v) => v.replace(/^"|"$/g, "")),
      );
      lignes = lignes.filter((l) => ensemble.has(String(l[cle])));
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

globalThis.fetch = (async (entree: unknown, init?: RequestInit) => {
  const brute = typeof entree === "string" ? entree : String((entree as { url: string }).url);
  const url = new URL(brute);
  const table = url.pathname.split("/rest/v1/")[1] ?? "?";

  // ⚠️ LA PASSERELLE REFUSE AVANT DE REGARDER LA REQUÊTE — comme en vrai :
  // aucune trace côté base, seulement un statut d'erreur.
  if (brute.length > PLAFOND_URL) {
    refusees += 1;
    return new Response(
      JSON.stringify({ message: "URI too long", code: "", details: null, hint: null }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  appelsParTable[table] = (appelsParTable[table] ?? 0) + 1;

  enVol += 1;
  maxEnVol = Math.max(maxEnVol, enVol);
  // Une vraie latence : sans elle, deux requêtes « parallèles » se
  // succéderaient sans jamais se chevaucher et la mesure ne vaudrait rien.
  await new Promise((r) => setTimeout(r, 5));
  enVol -= 1;

  if (tableEnPanneApres && tableEnPanneApres.table === table && appelsParTable[table] > tableEnPanneApres.apres) {
    return new Response(
      JSON.stringify({
        message: "panne simulée sur un seul lot",
        code: "PGRST999",
        details: "détail exploitable",
        hint: "indice exploitable",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const toutes = filtrer(table, url.searchParams);
  const rendues = toutes.slice(0, PLAFOND_DE_LIGNES);
  const corps = renduAlEnvers ? [...rendues].reverse() : rendues;

  const filtreIn = [...url.searchParams.values()].find((v) => v.startsWith("in."));
  appels.push({
    table,
    longueurUrl: brute.length,
    nbIdentifiants: filtreIn
      ? filtreIn
          .slice(3)
          .replace(/^\(|\)$/g, "")
          .split(",").length
      : 0,
    rendu: rendues.length,
  });

  // `maybeSingle()` demande un objet, pas un tableau.
  const veutUnObjet = entete(init, "Accept").includes("pgrst.object");
  return new Response(JSON.stringify(veutUnObjet ? (corps[0] ?? null) : corps), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

const { createSupabaseBrowserClient } = await import("../../lib/supabase/browser");
const {
  getAdminWorkoutFeedbackList,
  getWorkoutFeedbackForStudent,
  getWorkoutFeedbackBySession,
  decouperEnLots,
  TAILLE_DE_LOT_IDS,
  LOTS_EN_PARALLELE,
} = await import("../../lib/supabase/workout-feedback");

const client = createSupabaseBrowserClient();
assert.ok(client, "client Supabase non construit");

/* ── Harnais ─────────────────────────────────────────────────────────────── */

let réussis = 0;
let échecs = 0;
/** Ce que `console.error` a journalisé pendant le test courant. */
let journal: string[] = [];
const erreurOriginale = console.error;

async function test(nom: string, fn: () => Promise<void> | void) {
  appels = [];
  refusees = 0;
  appelsParTable = {};
  tableEnPanneApres = null;
  enVol = 0;
  maxEnVol = 0;
  renduAlEnvers = false;
  journal = [];
  console.error = (...args: unknown[]) => {
    journal.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await fn();
    réussis += 1;
    console.error = erreurOriginale;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error = erreurOriginale;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

/* ── Une base de la TAILLE de la production ──────────────────────────────── */

const ELEVE = "11111111-1111-4111-8111-111111111111";
/** 132 retours × 5 exercices = 660 identifiants de séries : le volume exact de la panne. */
const NB_RETOURS = 132;
const EXERCICES_PAR_RETOUR = 5;

// Des identifiants de la LONGUEUR d'un vrai UUID : le test mesure des
// caractères, et un identifiant court masquerait exactement le défaut.
const uuid = (prefixe: string, n: number) =>
  `${prefixe}${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

let nbSeriesAttendu = 0;

function poserBase() {
  const workout_feedback: Ligne[] = [];
  const exercise_feedback: Ligne[] = [];
  const exercise_set_feedback: Ligne[] = [];
  let nExercice = 0;
  let nSerie = 0;

  for (let r = 1; r <= NB_RETOURS; r += 1) {
    const idR = uuid("a", r);
    workout_feedback.push({
      id: idR,
      student_id: ELEVE,
      session_id: uuid("s", r),
      program_id: null,
      session_key: `seance-${r}`,
      session_ref_label: `Séance ${r}`,
      completed: true,
      global_rpe: null,
      global_comment: "",
      pain: "",
      status: "a-traiter",
      coach_reply: "",
      coach_reply_video_path: null,
      coach_reply_video_uploaded_at: null,
      coach_reply_video_annotations: null,
      submitted_at: `2026-0${(r % 9) + 1}-0${(r % 9) + 1}T10:00:00Z`,
      created_at: "2026-01-01T10:00:00Z",
      updated_at: "2026-01-01T10:00:00Z",
      prescribed_snapshot: null,
      performed_at: null,
      duration_minutes: null,
      session_status: null,
    });

    for (let e = 1; e <= EXERCICES_PAR_RETOUR; e += 1) {
      nExercice += 1;
      const idE = uuid("b", nExercice);
      exercise_feedback.push({
        id: idE,
        workout_feedback_id: idR,
        student_id: ELEVE,
        exercise_id: null,
        exercise_name: `Exercice ${e}`,
        exercise_order: e,
        rpe: null,
        comment: "",
        substitute_exercise_library_id: null,
        substitute_exercise_name: null,
        video_path: null,
        video_uploaded_at: null,
        created_at: "2026-01-01T10:00:00Z",
        updated_at: "2026-01-01T10:00:00Z",
      });

      // 2, 3 ou 4 séries : un volume irrégulier, comme en vrai.
      const nbSeries = (nExercice % 3) + 2;
      for (let s = 1; s <= nbSeries; s += 1) {
        nSerie += 1;
        exercise_set_feedback.push({
          id: uuid("c", nSerie),
          exercise_feedback_id: idE,
          student_id: ELEVE,
          set_number: s,
          load_used: `${40 + s} kg`,
          reps_done: String(8 + s),
          rpe: null,
          created_at: "2026-01-01T10:00:00Z",
          updated_at: "2026-01-01T10:00:00Z",
        });
      }
    }
  }

  nbSeriesAttendu = exercise_set_feedback.length;
  base = { workout_feedback, exercise_feedback, exercise_set_feedback };
}

poserBase();

const NB_EXERCICES = NB_RETOURS * EXERCICES_PAR_RETOUR;
assert.equal(NB_EXERCICES, 660, "la fixture doit reproduire les 660 identifiants de la panne");

/* ── Les tests ───────────────────────────────────────────────────────────── */

await (async () => {
  await test("1. DÉCOUPAGE — 0, 1, 100, 101 et 660 identifiants", () => {
    assert.equal(TAILLE_DE_LOT_IDS, 100, "la taille de lot annoncée n'est plus 100");
    const ids = (n: number) => Array.from({ length: n }, (_, i) => uuid("d", i));

    assert.deepEqual(decouperEnLots(ids(0), TAILLE_DE_LOT_IDS), [], "0 identifiant ne doit produire aucun lot");
    assert.equal(decouperEnLots(ids(1), TAILLE_DE_LOT_IDS).length, 1);
    assert.equal(decouperEnLots(ids(1), TAILLE_DE_LOT_IDS)[0]?.length, 1);
    assert.equal(decouperEnLots(ids(100), TAILLE_DE_LOT_IDS).length, 1, "100 identifiants tiennent en UN lot");
    assert.equal(decouperEnLots(ids(101), TAILLE_DE_LOT_IDS).length, 2, "101 identifiants en font DEUX");
    assert.deepEqual(
      decouperEnLots(ids(101), TAILLE_DE_LOT_IDS).map((l) => l.length),
      [100, 1],
      "le dernier lot porte le reste, pas une part égale",
    );

    const lots660 = decouperEnLots(ids(660), TAILLE_DE_LOT_IDS);
    assert.equal(lots660.length, 7, "660 identifiants doivent produire 7 lots");
    assert.deepEqual(lots660.map((l) => l.length), [100, 100, 100, 100, 100, 100, 60]);
  });

  await test("2. DÉCOUPAGE — aucun identifiant perdu, aucun dupliqué, ordre conservé", () => {
    const ids = Array.from({ length: 660 }, (_, i) => uuid("d", i));
    const plat = decouperEnLots(ids, TAILLE_DE_LOT_IDS).flat();
    assert.deepEqual(plat, ids, "le découpage doit être une partition ordonnée de la liste");
    assert.equal(new Set(plat).size, 660, "un identifiant est apparu deux fois");
  });

  await test("3. DÉCOUPAGE — une taille de lot absurde est refusée, pas silencieusement corrigée", () => {
    assert.throws(() => decouperEnLots([1, 2, 3], 0), /au moins 1/);
    assert.throws(() => decouperEnLots([1, 2, 3], -5), /au moins 1/);
  });

  await test("4. AUCUNE REQUÊTE N'APPROCHE LE PLAFOND — 660 séries lues en lots de 100", async () => {
    const liste = await getAdminWorkoutFeedbackList(client!);
    assert.equal(liste.length, NB_RETOURS);
    assert.equal(refusees, 0, "la passerelle a refusé au moins une requête : une URL est encore trop longue");

    const lotsDeSeries = appels.filter((a) => a.table === "exercise_set_feedback");
    assert.equal(lotsDeSeries.length, 7, "660 identifiants doivent produire exactement 7 requêtes");
    for (const appel of lotsDeSeries) {
      assert.ok(appel.nbIdentifiants <= TAILLE_DE_LOT_IDS, `un lot porte ${appel.nbIdentifiants} identifiants`);
      // ⚠️ LA VRAIE BORNE EST EN CARACTÈRES. 25 028 est le plus petit rejet
      // observé dans les journaux ; on se tient à un ordre de grandeur en
      // dessous, pas « juste sous le mur ».
      assert.ok(
        appel.longueurUrl < 5_000,
        `URL de ${appel.longueurUrl} caractères : la cible mesurée est ~4 000 pour 100 identifiants`,
      );
    }

    const lotsDExercices = appels.filter((a) => a.table === "exercise_feedback");
    assert.equal(lotsDExercices.length, 2, "132 retours → 2 lots (l'autre `.in()` est traitée pareil)");
    for (const appel of lotsDExercices) {
      assert.ok(appel.nbIdentifiants <= TAILLE_DE_LOT_IDS);
      assert.ok(appel.longueurUrl < 5_000);
    }
  });

  await test("5. AUCUN RÉSULTAT PERDU — 660 exercices, toutes les séries, aucun doublon", async () => {
    const liste = await getAdminWorkoutFeedbackList(client!);
    const toutes = liste.flatMap((f) => f.exerciseEntries);
    assert.equal(
      toutes.length,
      nbSeriesAttendu,
      `${toutes.length} séries rendues au lieu de ${nbSeriesAttendu} : un lot a été perdu`,
    );
    for (const retour of liste) {
      const exercices = new Set(retour.exerciseEntries.map((e) => e.exerciseName));
      assert.equal(exercices.size, EXERCICES_PAR_RETOUR, "un retour a perdu (ou dupliqué) des exercices");
      // ⚠️ UN LOT FUSIONNÉ DEUX FOIS SE VOIT ICI : le couple (exercice, série)
      // est unique par retour, et une fusion en double le répéterait à
      // l'identique sans rien casser d'autre.
      const couples = retour.exerciseEntries.map((e) => `${e.exerciseName}::${e.setNumber}`);
      assert.equal(new Set(couples).size, couples.length, "une série est rendue deux fois : lots fusionnés en double");
    }
  });

  await test("6. ORDRE DES SÉRIES — il ne doit RIEN devoir à l'ordre d'arrivée des lots", async () => {
    renduAlEnvers = true;
    const liste = await getAdminWorkoutFeedbackList(client!);
    for (const retour of liste) {
      let precedent = { exercice: "", serie: 0 };
      for (const entree of retour.exerciseEntries) {
        if (entree.exerciseName === precedent.exercice) {
          assert.ok(
            entree.setNumber > precedent.serie,
            `séries dans le désordre : ${entree.exerciseName} ${precedent.serie} puis ${entree.setNumber}`,
          );
        }
        precedent = { exercice: entree.exerciseName, serie: entree.setNumber };
      }
      // Les exercices restent dans l'ordre de séance, pas dans l'ordre du serveur.
      const noms = [...new Set(retour.exerciseEntries.map((e) => e.exerciseName))];
      assert.deepEqual(noms, ["Exercice 1", "Exercice 2", "Exercice 3", "Exercice 4", "Exercice 5"]);
    }
  });

  await test("7. LE HARNAIS SAIT DÉTECTER LE DÉFAUT — la liste d'un seul tenant est refusée", async () => {
    const tous = (base.exercise_feedback ?? []).map((l) => String(l.id));
    assert.equal(tous.length, 660);
    const { error } = await client!.from("exercise_set_feedback").select("*").in("exercise_feedback_id", tous);
    assert.ok(error, "la passerelle du harnais a laissé passer 660 identifiants : le plafond ne sert à rien");
    assert.equal(refusees, 1);
  });

  await test("8. CONCURRENCE BORNÉE — jamais plus de trois requêtes en vol, et jamais une seule", async () => {
    await getAdminWorkoutFeedbackList(client!);
    assert.equal(LOTS_EN_PARALLELE, 3, "la borne annoncée n'est plus 3");
    assert.ok(
      maxEnVol <= LOTS_EN_PARALLELE,
      `${maxEnVol} requêtes simultanées : la concurrence n'est plus bornée`,
    );
    assert.ok(maxEnVol >= 2, "les lots partent un par un : la borne est respectée par accident, pas par conception");
  });

  await test("9. UN LOT EN ERREUR REMONTE UNE ERREUR EXPLOITABLE — et n'est jamais un lot vide", async () => {
    // Le 4e appel de la table échoue : trois lots réussissent, un échoue.
    tableEnPanneApres = { table: "exercise_set_feedback", apres: 3 };
    const liste = await getAdminWorkoutFeedbackList(client!);

    assert.ok(liste.length > 0, "la liste ne doit PAS devenir vide : le repli mock prendrait la main");
    const trace = journal.join("\n");
    assert.ok(trace.includes("panne simulée sur un seul lot"), "l'erreur n'a pas été journalisée du tout");
    assert.ok(trace.includes("PGRST999"), "`code` est encore jeté en silence");
    assert.ok(trace.includes("détail exploitable"), "`details` est encore jeté en silence");
    assert.ok(trace.includes("indice exploitable"), "`hint` est encore jeté en silence");
    assert.ok(
      /lot 4\/7/.test(trace),
      "la trace ne dit pas QUEL lot a échoué : « une erreur quelque part » n'est pas exploitable",
    );
    assert.ok(
      trace.includes("détail par exercice incomplet"),
      "la CONSÉQUENCE n'est pas nommée : l'écran affiche un détail partiel sans le dire",
    );
  });

  await test("10. APRÈS UN ÉCHEC, LES VAGUES SUIVANTES NE PARTENT PAS", async () => {
    tableEnPanneApres = { table: "exercise_set_feedback", apres: 1 };
    await getAdminWorkoutFeedbackList(client!);
    const emises = appelsParTable.exercise_set_feedback ?? 0;
    assert.ok(
      emises <= LOTS_EN_PARALLELE,
      `${emises} requêtes émises alors que la lecture était déjà connue comme incomplète`,
    );
  });

  await test("11. JOURNALISATION EN PRODUCTION — le silence de `NODE_ENV` est fini", async () => {
    assert.equal(process.env.NODE_ENV, "production", "ce test ne vaut qu'en production");
    tableEnPanneApres = { table: "exercise_feedback", apres: 1 };
    await getAdminWorkoutFeedbackList(client!);
    assert.ok(journal.length > 0, "aucune trace en production : c'est exactement la panne silencieuse d'origine");
  });

  await test("12. LES AUTRES LECTURES EMPRUNTENT LE MÊME CHEMIN", async () => {
    const parEleve = await getWorkoutFeedbackForStudent(client!, ELEVE);
    assert.equal(parEleve.length, NB_RETOURS);
    assert.equal(parEleve.flatMap((f) => f.exerciseEntries).length, nbSeriesAttendu);
    assert.equal(refusees, 0);
    for (const appel of appels) assert.ok(appel.nbIdentifiants <= TAILLE_DE_LOT_IDS);

    appels = [];
    const unSeul = await getWorkoutFeedbackBySession(client!, ELEVE, "seance-1");
    assert.ok(unSeul, "le retour d'une séance précise n'est plus lu");
    assert.equal(unSeul!.exerciseEntries.length > 0, true, "un seul identifiant doit rester un seul lot qui rend ses lignes");
    const lots = appels.filter((a) => a.table === "exercise_feedback");
    assert.equal(lots.length, 1, "un identifiant unique ne doit pas produire plusieurs requêtes");
  });

  await test("13. AUCUNE RÉPONSE N'ATTEINT LE PLAFOND DE LIGNES DU SERVEUR", async () => {
    await getAdminWorkoutFeedbackList(client!);
    const pire = Math.max(...appels.map((a) => a.rendu));
    console.log(`     (plus grande réponse observée : ${pire} lignes pour un plafond de ${PLAFOND_DE_LIGNES})`);
    for (const appel of appels) {
      assert.ok(
        appel.rendu < PLAFOND_DE_LIGNES,
        `une requête rend ${appel.rendu} lignes : au plafond, PostgREST tronque SANS erreur`,
      );
    }
  });

  await test("14. LA RÈGLE EST ÉCRITE DANS LE CODE QUI L'APPLIQUE", () => {
    const source = readFileSync("lib/supabase/workout-feedback.ts", "utf8");
    assert.ok(source.includes("lireParLots"), "l'utilitaire de découpage a disparu");
    assert.ok(/TAILLE_DE_LOT_IDS\s*=\s*\d+/.test(source), "la taille de lot n'est plus une constante nommée");
    assert.ok(/LOTS_EN_PARALLELE\s*=\s*\d+/.test(source), "la borne de concurrence n'est plus une constante nommée");

    const corps = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // ⚠️ AUCUNE LISTE GLOBALE NE DOIT REVENIR DANS UN `.in(`.
    for (const variable of ["workoutFeedbackIds", "exerciseIds"]) {
      assert.ok(
        !new RegExp(`\\.in\\(\\s*"[a-z_]+"\\s*,\\s*${variable}\\s*\\)`).test(corps),
        `\`.in(..., ${variable})\` passe encore la liste entière dans l'URL`,
      );
    }
    // ⚠️ ET AUCUNE ERREUR NE DOIT REDEVENIR UN TABLEAU VIDE.
    for (const masque of ["exerciseRows ?? []", "setRows ?? []"]) {
      assert.ok(!corps.includes(masque), `\`${masque}\` masque de nouveau une erreur de lecture`);
    }
    assert.ok(
      !/NODE_ENV\s*===\s*"development"/.test(corps),
      "la journalisation est de nouveau conditionnée au mode développement",
    );
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
