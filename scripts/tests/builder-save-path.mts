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
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

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


/* ══════════════════════════════════════════════════════════════════════════
   LA BANDE DES SEMAINES — SOUS L'EN-TÊTE, AVEC SA CORBEILLE
   ══════════════════════════════════════════════════════════════════════════ */

await test("SEM-UI — la bande est sous l'en-tête, la colonne de gauche a disparu, la corbeille supprime", async () => {
  // ⚠️ CE CAS SE JOUE DANS UN VRAI NAVIGATEUR. La bande, la sélection de
  // semaine et la corbeille sont du COMPORTEMENT : un scan de source dirait
  // que le bouton existe, pas qu'il retire la semaine ni que la grille suit.
  const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const DOSSIER = join(RACINE, "scripts", "tests", "builder-semaines-render");
  const executable = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((c): c is string => Boolean(c) && existsSync(c as string));
  assert.ok(executable, "aucun navigateur trouvé — pose CHROMIUM_PATH");

  const construction = await esbuild.build({
    entryPoints: [join(DOSSIER, "entree.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    tsconfig: join(RACINE, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
    banner: { js: "globalThis.process ??= { env: {} };" },
    logLevel: "silent",
  });
  const paquet = construction.outputFiles![0]!.text;
  const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>builder</title></head>
<body><div id="racine"></div><script type="module" src="/paquet.js"></script></body></html>`;
  const serveur = createServer((requete, reponse) => {
    if ((requete.url ?? "/").startsWith("/paquet.js")) {
      reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(paquet);
      return;
    }
    reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  const adresse = serveur.address();
  const origine = `http://127.0.0.1:${typeof adresse === "object" && adresse ? adresse.port : 0}`;

  const { chromium } = await import("playwright-core");
  const navigateur = await chromium.launch({
    executablePath: executable,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await contexte.newPage();
    const erreurs: string[] = [];
    page.on("pageerror", (e) => erreurs.push(e.message));
    await page.goto(origine);
    await page.waitForFunction(() => "__harnais" in window);
    // ⚠️ COMPARAISONS INSENSIBLES À LA CASSE. Les libellés sont mis en
    // majuscules par la feuille de style ; le harnais ne charge pas Tailwind,
    // et le DOM porte donc « Semaine 1 ». Tester la casse ici testerait le CSS.
    await page.waitForFunction(() => /semaine 1/i.test(document.body.innerText));

    // 1. LES TROIS SEMAINES SONT LÀ, et chacune a sa corbeille.
    for (const n of [1, 2, 3]) {
      assert.equal(await page.getByRole("button", { name: `Supprimer la semaine ${n}` }).count(), 1, `corbeille semaine ${n}`);
      assert.equal(await page.getByRole("button", { name: `Dupliquer la semaine ${n}` }).count(), 1, `copie semaine ${n}`);
    }

    // 2. ⚠️ LA COLONNE DE GAUCHE A DISPARU, et rien ne la rouvre. C'est la
    //    demande : rendre la largeur à la grille des sept jours.
    assert.equal(await page.getByRole("button", { name: "Afficher le panneau semaines" }).count(), 0);
    // ⚠️ « Masquer le panneau » EXISTE ENCORE — c'est celui de l'ÉDITION DE LA
    // SÉANCE, à droite, qui n'est pas concerné. On vérifie donc qu'il n'en
    // reste qu'UN seul, et non aucun : une assertion à zéro aurait exigé de
    // supprimer aussi le panneau de droite, que personne n'a demandé.
    assert.equal(await page.getByRole("button", { name: "Masquer le panneau" }).count(), 1, "seul le panneau d'édition se replie encore");
    // Et la source ne porte plus rien du panneau des semaines.
    const composant = readFileSync(
      new URL("../../components/admin/ProgramBuilderFullscreen.tsx", import.meta.url),
      "utf8",
    );
    for (const disparu of ["leftOpen", "PanelLeftClose", "PanelLeftOpen"]) {
      assert.equal(composant.includes(disparu), false, `${disparu} ne doit plus exister`);
    }

    // 3. ⚠️ LA BANDE EST SOUS L'EN-TÊTE, ET AU-DESSUS DE LA GRILLE. Mesuré en
    //    pixels : un test qui se contenterait de l'ordre du DOM passerait sur
    //    une bande repositionnée en CSS au mauvais endroit.
    const yTitre = (await page.getByRole("heading", { name: /^semaine 1$/i }).boundingBox())!.y;
    const bande = (await page.getByRole("button", { name: "Supprimer la semaine 2" }).boundingBox())!;
    const grille = (await page.getByText(/^lundi$/i).first().boundingBox())!;
    assert.ok(bande.y > yTitre, `la bande est sous le titre (${yTitre} → ${bande.y})`);
    assert.ok(bande.y < grille.y, `et au-dessus de la grille (${bande.y} → ${grille.y})`);
    // ⚠️ CE QUE CE HARNAIS NE PEUT PAS PROUVER, ET IL LE DIT. Il ne charge pas
    // Tailwind : « les trois semaines sur une même ligne » dépend entièrement
    // de la feuille de style, et une mesure de pixels ici testerait l'absence
    // de CSS, pas la mise en page. On vérifie donc la classe qui la produit —
    // et la disposition réelle a été contrôlée à l'écran, avec la CSS compilée.
    assert.match(
      composant,
      /mb-4 flex flex-wrap items-center gap-2/,
      "la bande est une ligne qui se replie, jamais une colonne",
    );

    // 4. ⚠️ LA CONFIRMATION EST RESPECTÉE. Refuser ne supprime rien — sinon la
    //    boîte de dialogue ne serait qu'un décor.
    await page.evaluate(() => (window as unknown as { __harnais: { refuserToujours: () => void } }).__harnais.refuserToujours());
    await page.getByRole("button", { name: "Supprimer la semaine 2" }).click();
    assert.equal(await page.getByRole("button", { name: "Supprimer la semaine 2" }).count(), 1, "refus = rien supprimé");

    // 5. LE GESTE. On confirme, la semaine 2 s'en va — et les autres GARDENT
    //    leur numéro : la 3 ne devient pas la 2.
    await page.evaluate(() => (window as unknown as { __harnais: { confirmerToujours: () => void } }).__harnais.confirmerToujours());
    await page.getByRole("button", { name: "Supprimer la semaine 2" }).click();
    await page.waitForFunction(() => !/semaine 2/i.test(document.body.innerText));
    assert.equal(await page.getByRole("button", { name: "Supprimer la semaine 3" }).count(), 1, "la 3 reste la 3");
    assert.equal(await page.getByRole("button", { name: "Supprimer la semaine 2" }).count(), 0);

    // 6. La grille suit : la semaine affichée existe encore, et ses 7 jours
    //    sont là. Une semaine supprimée sous les pieds laisserait un écran vide.
    const texte = (await page.innerText("body")).toLowerCase();
    for (const jour of ["lundi", "mercredi", "dimanche"]) assert.ok(texte.includes(jour), `${jour} affiché`);
    assert.match(texte, /modifications non enregistrées/, "la suppression marque le programme comme modifié");

    assert.deepEqual(erreurs, [], "aucune erreur de page");
  } finally {
    await navigateur.close();
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
});


await test("SEM-EDIT — l'édition est SOUS la grille, sur toute la largeur, exercices de front", async () => {
  // ⚠️ L'ÉDITION OCCUPAIT UNE COLONNE DE 420 px SUR LE CÔTÉ. Un exercice y
  // tenait sur toute la hauteur : comparer la deuxième série de deux
  // exercices d'un même bloc demandait de faire défiler entre les deux.
  // Passée sous la grille, elle a toute la largeur — et les exercices s'y
  // rangent côte à côte.
  const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const composant = readFileSync(join(RACINE, "components/admin/ProgramBuilderFullscreen.tsx"), "utf8");
  const editeur = readFileSync(join(RACINE, "components/admin/blocks/StrengthBlockEditor.tsx"), "utf8");

  // ⚠️ PLUS AUCUNE COLONNE LATÉRALE. La largeur fixe est ce qui empêchait les
  // exercices de tenir de front ; la laisser en place viderait le changement
  // de son sens.
  assert.equal(/lg:w-\[420px\]/.test(composant), false, "la colonne de 420 px a disparu");
  for (const disparu of ["rightOpen", "PanelRightClose", "PanelRightOpen"]) {
    assert.equal(composant.includes(disparu), false, `${disparu} ne doit plus exister`);
  }
  assert.match(composant, /Panneau d'édition — SOUS la grille/, "le panneau est déclaré sous la grille");

  // ⚠️ ET LE SHELL N'EST PLUS UNE RANGÉE. Sans cette assertion, remettre
  // `lg:flex-row` renverrait l'édition sur le côté sans qu'aucun test ne
  // bouge : le harnais ne charge pas Tailwind, la mesure en pixels y est
  // aveugle à la classe. C'est le sabotage SE-B, sorti vert la première fois.
  const shell = composant.slice(composant.indexOf("UNE SEULE COLONNE"));
  assert.equal(
    /flex min-h-0 flex-1 flex-col lg:flex-row/.test(shell),
    false,
    "la grille et l'édition ne sont plus côte à côte",
  );
  assert.match(shell, /relative flex min-h-0 flex-1 flex-col overflow-y-auto/, "une seule colonne, qui défile");
  // ⚠️ SANS PRÉFIXE `lg:`. Le défilement intérieur n'existait qu'à partir de
  // 1024 px : en dessous, plus rien ne défilait à l'intérieur et le document
  // s'allongeait. Voir SEM-SCROLL, qui le mesure.
  assert.equal(/lg:overflow-y-auto/.test(composant), false, "le défilement intérieur vaut à toutes les largeurs");

  // Et les métadonnées de séance profitent bien de la largeur.
  const panneau = readFileSync(join(RACINE, "components/admin/blocks/SessionBlockPanel.tsx"), "utf8");
  assert.match(
    panneau,
    /grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4/,
    "nom, groupe, durée et bannière tiennent sur une ligne",
  );

  // ⚠️ CE QUE CE HARNAIS NE PEUT PAS MESURER, ET IL LE DIT. Il ne charge pas
  // Tailwind : « trois exercices sur une même ligne » dépend entièrement de la
  // feuille de style. On vérifie donc la classe qui le produit — la mise en
  // page réelle a été contrôlée à l'écran, CSS compilée.
  assert.match(
    editeur,
    /grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3/,
    "les exercices se rangent en colonnes, plus en pile",
  );

  const executable = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((c): c is string => Boolean(c) && existsSync(c as string));
  assert.ok(executable, "aucun navigateur trouvé — pose CHROMIUM_PATH");

  const construction = await esbuild.build({
    entryPoints: [join(RACINE, "scripts", "tests", "builder-semaines-render", "entree.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    tsconfig: join(RACINE, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
    banner: { js: "globalThis.process ??= { env: {} };" },
    logLevel: "silent",
  });
  const paquet = construction.outputFiles![0]!.text;
  const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>edition</title></head>
<body><div id="racine"></div><script type="module" src="/paquet.js"></script></body></html>`;
  const serveur = createServer((requete, reponse) => {
    if ((requete.url ?? "/").startsWith("/paquet.js")) {
      reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(paquet);
      return;
    }
    reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  const adresse = serveur.address();
  const origine = `http://127.0.0.1:${typeof adresse === "object" && adresse ? adresse.port : 0}`;

  const { chromium } = await import("playwright-core");
  const navigateur = await chromium.launch({
    executablePath: executable,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1600, height: 1100 } });
    const page = await contexte.newPage();
    const erreurs: string[] = [];
    page.on("pageerror", (e) => erreurs.push(e.message));
    await page.goto(origine);
    await page.waitForFunction(() => "__harnais" in window);
    await page.waitForFunction(() => /semaine 1/i.test(document.body.innerText));

    // 1. LE PANNEAU EST SOUS LA GRILLE — mesuré, pas déduit de l'ordre du DOM.
    const jour = (await page.getByText(/^lundi$/i).first().boundingBox())!;
    const entete = (await page.getByText(/édition de la séance/i).first().boundingBox())!;
    assert.ok(entete.y > jour.y, `l'édition est sous la grille (${jour.y} → ${entete.y})`);

    // 2. LA SÉANCE S'OUVRE, ET SES TROIS EXERCICES SONT LÀ. Le déplacement du
    //    panneau ne devait rien changer aux fonctions : mêmes champs, mêmes
    //    commandes par exercice.
    await page.getByText(/tirage n°1/i).first().click();
    await page.waitForFunction(() => /exercice #3/i.test(document.body.innerText));
    // ⚠️ LES NOMS D'EXERCICES SONT DANS DES CHAMPS, PAS DANS DU TEXTE.
    // `innerText` ne rend pas la valeur d'un `<input>` : chercher là aurait
    // fait échouer un écran pourtant correct.
    const saisies = await page
      .locator("input")
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value.toLowerCase()));
    for (const attendu of ["warm up squat", "back squat", "fentes bulgares"]) {
      assert.ok(saisies.includes(attendu), `« ${attendu} » reste affiché`);
    }
    const texte = (await page.innerText("body")).toLowerCase();
    for (const attendu of ["séries", "répétitions", "tempo", "repos (s)"]) {
      assert.ok(texte.includes(attendu), `le champ « ${attendu} » reste affiché`);
    }
    // Les commandes par exercice n'ont pas bougé.
    assert.ok((await page.getByRole("button", { name: /dupliquer l'exercice/i }).count()) >= 3, "duplication par exercice");

    assert.deepEqual(erreurs, [], "aucune erreur de page");
  } finally {
    await navigateur.close();
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
});


await test("SEM-SCROLL — un seul défilement : celui du builder, jamais celui du document", async () => {
  // ⚠️ LE DÉFAUT MESURÉ EN PREVIEW. Arrivé en bas du builder, la page
  // continuait de descendre sur une bande noire. Deux causes, toutes deux
  // structurelles :
  //
  //   1. Un `<div class="sr-only">` (la zone `aria-live` de SessionBlockList)
  //      est `position:absolute`. `overflow-hidden` ne rogne un tel élément
  //      que si son bloc conteneur est DANS le sous-arbre rogné ; sans
  //      ancêtre positionné il se cale sur le document et allonge
  //      `documentElement.scrollHeight` — invisible, mais défilable.
  //   2. Le builder posait `min-h-dvh` + `lg:h-dvh lg:overflow-hidden` alors
  //      qu'`AdminShell` le monte déjà dans un `<main class="h-dvh
  //      overflow-hidden">` : hauteur du viewport donnée deux fois, et sous
  //      `lg` plus aucun conteneur intérieur ne défilait.
  //
  // ⚠️ CE TEST NE REGARDE AUCUNE CLASSE. Il MESURE, sur plusieurs tailles de
  // fenêtre — dont celles qui reproduisaient le défaut. Une vérification de
  // classe Tailwind aurait été verte avec le bogue en place.
  const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const executable = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((c): c is string => Boolean(c) && existsSync(c as string));
  assert.ok(executable, "aucun navigateur trouvé — pose CHROMIUM_PATH");

  const construction = await esbuild.build({
    entryPoints: [join(RACINE, "scripts", "tests", "builder-semaines-render", "entree.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    tsconfig: join(RACINE, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
    banner: { js: "globalThis.process ??= { env: {} };" },
    logLevel: "silent",
  });
  const paquet = construction.outputFiles![0]!.text;

  // ⚠️ LA FEUILLE DE STYLE EST INDISPENSABLE ICI. Sans elle, `h-full`,
  // `overflow-hidden` et `min-h-0` n'existent pas : toutes les mesures
  // seraient celles d'un document sans mise en page, et le test serait vert
  // quoi qu'il arrive. On compile donc la CSS réelle du projet.
  const postcss = (await import("postcss")).default;
  const tailwind = (await import("@tailwindcss/postcss")).default;
  const css = (
    await postcss([tailwind({ base: RACINE })]).process(readFileSync(join(RACINE, "app/globals.css"), "utf8"), {
      from: join(RACINE, "app/globals.css"),
      to: join(RACINE, "app/globals.css"),
    })
  ).css;

  const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>scroll</title><style>${css}</style></head>
<body><div id="racine"></div><script type="module" src="/paquet.js"></script></body></html>`;
  const serveur = createServer((requete, reponse) => {
    if ((requete.url ?? "/").startsWith("/paquet.js")) {
      reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(paquet);
      return;
    }
    reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
  });
  await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
  const adresse = serveur.address();
  const origine = `http://127.0.0.1:${typeof adresse === "object" && adresse ? adresse.port : 0}`;

  const { chromium } = await import("playwright-core");
  const navigateur = await chromium.launch({
    executablePath: executable,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    // ⚠️ TROIS FENÊTRES, DONT DEUX QUI REPRODUISAIENT LE DÉFAUT. 1600×900 ne
    // le montrait pas : le contenu tenait presque. C'est en raccourcissant la
    // fenêtre — et sous le point de rupture `lg` — qu'il apparaissait.
    for (const vue of [
      { width: 1600, height: 900 },
      { width: 1600, height: 700 },
      { width: 1000, height: 800 },
    ]) {
      const contexte = await navigateur.newContext({ viewport: vue });
      const page = await contexte.newPage();
      const erreurs: string[] = [];
      page.on("pageerror", (e) => erreurs.push(e.message));
      await page.goto(origine);
      await page.waitForFunction(() => "__harnais" in window);
      await page.waitForFunction(() => /semaine 1/i.test(document.body.innerText));
      // Une séance CHARGÉE : c'est elle qui fait dépasser le contenu.
      await page.getByText(/tirage n°1/i).first().click();
      await page.waitForFunction(() => /exercice #3/i.test(document.body.innerText));

      const m = await page.evaluate(() =>
        (window as unknown as { __harnais: { mesures: () => Record<string, number | string> } }).__harnais.mesures(),
      );
      const cadre = `${vue.width}×${vue.height}`;

      // 1. AUCUN SECOND DÉFILEMENT DU DOCUMENT. C'est l'assertion centrale :
      //    la bande noire, c'était exactement cet écart.
      assert.ok(
        (m.docScrollHeight as number) <= (m.docClientHeight as number) + 2,
        `${cadre} : le document ne doit pas défiler (${m.docScrollHeight} > ${m.docClientHeight})`,
      );

      // 2. ET UN SEUL CONTENEUR DÉFILANT — celui du builder, qui déborde.
      assert.equal(m.nbScrollables, 1, `${cadre} : un seul conteneur défilant (vu : ${m.nbScrollables})`);
      assert.ok(
        (m.interneScrollHeight as number) > (m.interneClientHeight as number),
        `${cadre} : le contenu du builder doit dépasser sa boîte (${m.interneScrollHeight} / ${m.interneClientHeight})`,
      );
      assert.ok(
        (m.interneClientHeight as number) <= (m.docClientHeight as number),
        `${cadre} : le conteneur défilant tient dans le viewport`,
      );

      // 3. LE BAS DU BUILDER EST ATTEIGNABLE, et le document n'a toujours pas
      //    bougé une fois arrivé en bas.
      const basAtteint = await page.evaluate(() =>
        (window as unknown as { __harnais: { defilerInterneEnBas: () => number } }).__harnais.defilerInterneEnBas(),
      );
      assert.ok(basAtteint > 0, `${cadre} : le défilement interne fonctionne`);
      const apres = await page.evaluate(() =>
        (window as unknown as { __harnais: { mesures: () => Record<string, number> } }).__harnais.mesures(),
      );
      assert.ok(
        apres.docScrollHeight <= apres.docClientHeight + 2,
        `${cadre} : arrivé en bas, le document ne défile toujours pas`,
      );
      assert.equal(await page.evaluate(() => window.scrollY), 0, `${cadre} : la fenêtre n'a pas bougé`);
      // Le dernier contenu du panneau est bien à l'écran.
      const dernier = await page.getByText(/analyse de la séance/i).first().boundingBox();
      assert.ok(dernier && dernier.y < vue.height, `${cadre} : le bas du panneau est atteignable`);

      assert.deepEqual(erreurs, [], `${cadre} : aucune erreur de page`);
      await contexte.close();
    }
  } finally {
    await navigateur.close();
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
});

console.log(`\n${réussis} test(s) réussi(s), ${échecs} échec(s).`);
if (échecs > 0) process.exit(1);
