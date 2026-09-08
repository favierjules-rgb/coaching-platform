/**
 * Harnais — LES PAGES ADMIN N'AFFICHENT JAMAIS DE DONNÉES DE DÉMONSTRATION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Que `/admin/programmes` et `/admin/eleves` ne rendent rien tant que les
 * listes Supabase sont en vol ; qu'une liste vide après chargement veut dire
 * « aucune donnée » et non « montre les fixtures » ; et qu'une affectation
 * ne peut plus être déclarée réussie sans avoir atteint Supabase.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT D'ORIGINE, MESURÉ
 * ════════════════════════════════════════════════════════════════════════
 * Les deux pages choisissaient leur source ainsi :
 *
 *     programs.length > 0 ? supabasePrograms.programs : state.programs
 *
 * Au PREMIER rendu la requête n'a pas répondu : la liste est vide, et la
 * page affichait `data/admin.ts` — « 3 programmes créés », Force &
 * Hypertrophie, Sèche Estivale, Remise en Route, et les 7 élèves
 * `@mail.mock`. L'audit du 08/09/2026 a compté en base 16 programmes et 26
 * élèves, tous réels, et ZÉRO mock : ces noms ne venaient pas de la base.
 *
 * ⚠️ ET LA CONSÉQUENCE GRAVE N'ÉTAIT PAS L'AFFICHAGE. Le même « nombre de
 * lignes chargées » commandait `useContentAssignment` : pendant la fenêtre,
 * l'écriture retombait sur localStorage ET RENDAIT `true`. La modale
 * affichait « Assignation mise à jour » sans qu'une ligne n'atteigne
 * `assignments`. La partie I ci-dessous rejoue ce faux succès sur le VRAI
 * hook ; la partie II prouve que les pages ne peuvent plus l'atteindre.
 *
 * Lancement : npm run test:admin-chargement-mock
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useContentAssignment } from "../../hooks/useContentAssignment";
import type { AssignableContentType } from "../../types";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sansCommentaires = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

const PROGRAMMES = lire("../../app/admin/programmes/page.tsx");
const ELEVES = lire("../../app/admin/eleves/page.tsx");
const NUTRITION = lire("../../app/admin/nutrition/page.tsx");
const DOCUMENTS = lire("../../app/admin/documents/page.tsx");

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => Promise<void> | void) {
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

/* ════════════════════════════════════════════════════════════════════════
 * I. LE FAUX SUCCÈS — sur le VRAI hook, pas sur une imitation
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Exécute `useContentAssignment` dans un rendu React réel et rend la
 * fonction d'écriture qu'il produit.
 *
 * ⚠️ RENDU SERVEUR PLUTÔT QUE NAVIGATEUR, ET C'EST SUFFISANT ICI. Le hook
 * n'est qu'un `useCallback` : aucun effet, aucun DOM. Monter Playwright pour
 * l'observer coûterait cher et ne prouverait rien de plus — alors que
 * réécrire sa logique dans le test ne prouverait rien du tout.
 */
type Ecrivain = ReturnType<typeof useContentAssignment>;

function écrivainRéel(actif: Partial<Record<AssignableContentType, boolean>>) {
  const replis: string[] = [];
  // ⚠️ UN CONTENEUR PLUTÔT QU'UNE VARIABLE NUE. Affectée depuis le corps du
  // composant, une `let` reste `null` pour l'analyse de flot de TypeScript,
  // qui la réduit ensuite à `never` — le build échoue sur un appel pourtant
  // correct à l'exécution. L'objet coupe cette inférence sans mensonge de
  // type : le champ est bien optionnel, et l'assertion ci-dessous le prouve.
  const boite: { ecrire?: Ecrivain } = {};
  function Sonde() {
    boite.ecrire = useContentAssignment(actif, (studentId, contentType) => {
      replis.push(`${contentType}:${studentId}`);
    });
    return null;
  }
  renderToStaticMarkup(createElement(Sonde));
  const ecrire = boite.ecrire;
  assert.ok(ecrire, "le hook n'a pas rendu de fonction");
  return { ecrire, replis };
}

await test("DANGER1. drapeau à FAUX : l'écriture part dans localStorage ET rend un succès", async () => {
  const { ecrire, replis } = écrivainRéel({ programme: false });
  const resultat = await ecrire("stu-1", "programme", "prog-1", true);

  // ⚠️ C'EST LE COMPORTEMENT RÉEL DU HOOK, PAS UNE HYPOTHÈSE. Il rend `true`
  // — la modale affiche donc « Assignation mise à jour » — alors que la
  // seule écriture effectuée est le repli localStorage.
  assert.equal(resultat, true, "le hook rend bien un succès");
  assert.deepEqual(replis, ["programme:stu-1"], "le repli localStorage a bien été appelé");
});

await test("DANGER2. le même faux succès existe pour nutrition et documents", async () => {
  for (const type of ["nutrition", "document"] as const) {
    const { ecrire, replis } = écrivainRéel({ [type]: false });
    assert.equal(await ecrire("stu-1", type, "c-1", true), true);
    assert.deepEqual(replis, [`${type}:stu-1`]);
  }
  // ⚠️ CE N'EST DONC PAS UN DÉFAUT DES PROGRAMMES : c'est le contrat du hook.
  // La correction n'est pas de changer le hook — nutrition et documents s'en
  // servent correctement — mais de ne plus lui mentir sur `actif`.
});

await test("DANGER3. drapeau à VRAI sans Supabase configuré : encore le repli", async () => {
  // ⚠️ SECONDE PORTE, PLUS DISCRÈTE. Même `actif: true`,
  // `createSupabaseBrowserClient()` rend `null` quand l'environnement est
  // absent, et le hook retombe sur le repli — toujours en rendant `true`.
  // C'est pourquoi la garde des pages s'appuie sur `isSupabaseConfigured()`,
  // qui interroge exactement cet environnement.
  const { ecrire, replis } = écrivainRéel({ programme: true });
  const resultat = await ecrire("stu-1", "programme", "prog-1", true);
  assert.equal(resultat, true);
  assert.deepEqual(replis, ["programme:stu-1"]);
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LES DEUX PAGES NE PEUVENT PLUS ATTEINDRE CE CAS
 * ════════════════════════════════════════════════════════════════════════ */

const PAGES = [
  ["/admin/programmes", PROGRAMMES],
  ["/admin/eleves", ELEVES],
] as const;

await test("PAGE1. les deux pages refusent de rendre pendant le chargement", async () => {
  for (const [nom, source] of PAGES) {
    const code = sansCommentaires(source);
    assert.match(
      code,
      /if \(\s*supabaseActive &&[\s\S]{0,200}?\.loading[\s\S]{0,200}?\)\s*\{\s*return <Loader/,
      `${nom} : aucune garde de chargement`,
    );
  }
});

await test("PAGE2. la garde couvre TOUTES les listes que la page et sa modale affichent", async () => {
  const prog = sansCommentaires(PROGRAMMES);
  const garde = prog.slice(prog.indexOf("if (supabaseActive &&"), prog.indexOf("const filtered = programs.filter("));
  // ⚠️ LES ÉLÈVES COMPTENT AUTANT QUE LES PROGRAMMES : la modale « Assigner »
  // les liste, et une liste d'élèves encore vide y ferait apparaître les 7
  // fixtures `@mail.mock` — à l'endroit précis où un clic écrit.
  assert.match(garde, /supabasePrograms\.loading/, "/admin/programmes : programmes non couverts");
  assert.match(garde, /supabaseStudents\.loading/, "/admin/programmes : élèves non couverts");

  const eleves = sansCommentaires(ELEVES);
  const gardeE = eleves.slice(eleves.indexOf("if (\n    supabaseActive &&"), eleves.indexOf("const filtered = students.filter("));
  for (const liste of ["supabaseStudents.loading", "supabasePrograms.loading", "supabaseNutritionPlans.loading"]) {
    assert.ok(gardeE.includes(liste), `/admin/eleves : ${liste} non couvert`);
  }
});

await test("PAGE3. NÉGATIF — la source n'est plus choisie sur le NOMBRE DE LIGNES", async () => {
  for (const [nom, source] of PAGES) {
    const code = sansCommentaires(source);
    /*
     * ⚠️ LA GARDE PORTE SUR LA FORME EXACTE DU DÉFAUT. C'est ce ternaire —
     * `xxx.length > 0 ? supabase : state` — qui produisait le clignotement :
     * au premier rendu la liste est vide, donc « pas encore chargé » et
     * « aucune donnée » deviennent indiscernables. Le remettre, sous
     * n'importe quel nom de variable, rougit ici.
     */
    assert.ok(
      !/\.length > 0\s*\?\s*[\w.]+\s*:\s*state\./.test(code),
      `${nom} : la source retombe encore sur les fixtures quand la liste est vide`,
    );
  }
});

await test("PAGE4. la source est commandée par la CONFIGURATION", async () => {
  const prog = sansCommentaires(PROGRAMMES);
  assert.match(prog, /const supabaseActive = isSupabaseConfigured\(\);/);
  assert.match(prog, /const programs = supabaseActive \? supabasePrograms\.programs : state\.programs;/);
  assert.match(prog, /const students = supabaseActive \? supabaseStudents\.students : state\.students;/);

  const eleves = sansCommentaires(ELEVES);
  assert.match(eleves, /const supabaseActive = isSupabaseConfigured\(\);/);
  assert.match(eleves, /const students = supabaseActive \? supabaseStudents\.students : state\.students;/);
  assert.match(eleves, /const programs = supabaseActive \? supabasePrograms\.programs : state\.programs;/);
  assert.match(eleves, /const nutritionPlans = supabaseActive \? supabaseNutritionPlans\.plans : state\.nutritionPlans;/);

  // ⚠️ CONSÉQUENCE DIRECTE : Supabase configuré + 0 ligne ⇒ `[]`, donc l'état
  // vide honnête. Aucun chemin ne ramène `state.*` dans ce cas.
});

await test("PAGE5. NÉGATIF — le drapeau d'écriture ne dépend plus des lignes chargées", async () => {
  const prog = sansCommentaires(PROGRAMMES);
  assert.match(prog, /\{ programme: supabaseActive \}/, "/admin/programmes : drapeau d'écriture");
  const eleves = sansCommentaires(ELEVES);
  assert.match(eleves, /const canAssignRealPrograms = supabaseActive;/);
  assert.match(eleves, /const canAssignRealNutrition = supabaseActive;/);

  // ⚠️ C'EST CE QUI FERME LE FAUX SUCCÈS DE LA PARTIE I. Le drapeau ne peut
  // plus être faux « parce que la requête n'a pas fini » — seulement parce
  // que Supabase n'est pas configuré, cas où le repli mock est le
  // comportement voulu.
  for (const [nom, source] of PAGES) {
    const code = sansCommentaires(source);
    assert.ok(
      !/(programme|nutrition):\s*[\w.]+\.length > 0/.test(code),
      `${nom} : le drapeau d'écriture regarde encore une longueur de liste`,
    );
  }
});

await test("PAGE6. la garde est placée APRÈS tous les hooks", async () => {
  /*
   * ⚠️ RÈGLE REACT, ET ELLE A MORDU PENDANT CE LOT. Un `return` anticipé posé
   * au-dessus d'un `useMemo` saute ce hook au premier rendu puis l'exécute au
   * second : `react-hooks/rules-of-hooks` refuse, à juste titre. La garde
   * doit donc suivre le dernier hook, comme dans /admin/nutrition.
   */
  for (const [nom, source] of PAGES) {
    const code = sansCommentaires(source);
    const garde = code.indexOf("if (supabaseActive &&") >= 0
      ? code.indexOf("if (supabaseActive &&")
      : code.indexOf("if (\n    supabaseActive &&");
    assert.ok(garde > 0, `${nom} : garde introuvable`);
    const dernierHook = Math.max(
      code.lastIndexOf("useMemo("),
      code.lastIndexOf("useState("),
      code.lastIndexOf("useContentAssignment("),
    );
    assert.ok(dernierHook < garde, `${nom} : un hook est appelé APRÈS la garde de chargement`);
  }
});

await test("PAGE7. les quatre pages admin suivent désormais le même contrat", async () => {
  // ⚠️ C'EST L'INCOHÉRENCE QUI A PRODUIT LE DÉFAUT : deux pages sur quatre
  // avaient la garde. Les deux qui ne l'avaient pas sont exactement celles
  // où des données de démonstration apparaissaient.
  for (const [nom, source] of [
    ["/admin/programmes", PROGRAMMES],
    ["/admin/eleves", ELEVES],
    ["/admin/nutrition", NUTRITION],
    ["/admin/documents", DOCUMENTS],
  ] as const) {
    const code = sansCommentaires(source);
    assert.match(code, /supabaseActive &&[\s\S]{0,220}?\.loading/, `${nom} : pas de garde de chargement`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * III. CE QUI NE DOIT PAS AVOIR BOUGÉ
 * ════════════════════════════════════════════════════════════════════════ */

await test("GARDE1. les fixtures existent toujours et restent importées", async () => {
  // ⚠️ ON NE SUPPRIME RIEN. `data/admin.ts` alimente le mode démonstration
  // (Supabase non configuré) ET quatre suites de tests. Le lot corrige QUAND
  // on l'affiche, pas son existence.
  const fixtures = lire("../../data/admin.ts");
  assert.ok(fixtures.includes("@mail.mock"), "les fixtures élèves ont disparu");
  assert.ok(fixtures.includes("Force & Hypertrophie"), "les fixtures programmes ont disparu");
  for (const [nom, source] of PAGES) {
    assert.ok(source.includes("useAdminData"), `${nom} : le repli mock a été arraché`);
    assert.ok(/state\.(programs|students)/.test(source), `${nom} : plus aucun repli`);
  }
});

await test("GARDE2. le repli mock survit quand Supabase n'est PAS configuré", async () => {
  // La branche `else` du ternaire est le mode démonstration : elle doit
  // rester atteignable, sinon un développement local sans `.env` afficherait
  // une application vide.
  for (const [nom, source] of PAGES) {
    const code = sansCommentaires(source);
    assert.match(code, /supabaseActive \? [\w.]+ : state\./, `${nom} : branche de démonstration perdue`);
  }
});

await test("GARDE3. le tri des programmes n'a pas été touché", async () => {
  // ⚠️ HORS PÉRIMÈTRE, EXPLICITEMENT. `ORDER BY created_at DESC` est correct
  // et voulu ; l'audit l'a confirmé. Ce contrôle empêche de le « corriger »
  // par erreur en même temps que le chargement.
  const programsLib = lire("../../lib/supabase/programs.ts");
  assert.match(
    programsLib,
    /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id"\)/,
    "le tri des programmes a changé",
  );
  const prog = sansCommentaires(PROGRAMMES);
  assert.ok(!/programs\.sort\(|\.sort\(\(a, b\)/.test(prog), "un tri frontend est apparu");
});

await test("GARDE4. nutrition et documents sont inchangées", async () => {
  assert.match(NUTRITION, /if \(supabaseActive && supabaseNutritionPlans\.loading\) \{/);
  assert.match(DOCUMENTS, /if \(supabaseActive && supabaseDocuments\.loading\) \{/);
});

/* ── Verdict ─────────────────────────────────────────────────────────────── */

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
