/**
 * Harnais — LES PAGES ADMIN N'AFFICHENT JAMAIS DE DONNÉES DE DÉMONSTRATION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Que AUCUNE page sous `app/admin` ne rende de fixtures tant que les listes
 * Supabase sont en vol ; qu'une liste vide après chargement veut dire « aucune
 * donnée » et non « montre les fixtures » ; et qu'une affectation ne peut plus
 * être déclarée réussie sans avoir atteint Supabase.
 *
 * ⚠️ LA COUVERTURE EST PASSÉE DE 4 PAGES À TOUT `app/admin`, et c'est la leçon
 * du lot « anti-mock ». Ce fichier énonçait le bon contrat depuis le 08/09/2026,
 * mais sa liste `PAGES` n'avait jamais été étendue : `/admin/retours`,
 * `/admin` (tableau de bord), `/admin/notifications`, `/admin/exercices`,
 * `/admin/programmes/[programId]`, son builder, la fiche élève — et jusqu'à
 * l'onglet « Banque d'exercices » de `/admin/programmes`, pourtant déjà
 * « corrigée » — portaient encore le défaut. Le contrôle BALAYAGE ci-dessous
 * ne se fie plus à une liste écrite à la main : il PARCOURT le dossier.
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
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
const RETOURS = lire("../../app/admin/retours/page.tsx");
const DASHBOARD = lire("../../app/admin/page.tsx");
const NOTIFICATIONS = lire("../../app/admin/notifications/page.tsx");
const EXERCICES = lire("../../app/admin/exercices/page.tsx");
const PROGRAMME_DETAIL = lire("../../app/admin/programmes/[programId]/page.tsx");
const PROGRAMME_BUILDER = lire("../../app/admin/programmes/[programId]/builder/page.tsx");
const FICHE_ELEVE = lire("../../app/admin/eleves/[studentId]/page.tsx");
const FIXTURES = lire("../../data/admin.ts");

/**
 * Les pages admin qui choisissent une source, et le drapeau qui la commande.
 *
 * ⚠️ DEUX NOMS DE DRAPEAU, ET CE N'EST PAS DU LAXISME. Les pages « programme »
 * nommaient déjà le leur `isSupabaseProgramsActive` / `isSupabaseActive` avant
 * ce lot, et le renommer aurait brassé du code hors périmètre. Ce qui compte
 * est qu'il vienne de `isSupabaseConfigured()`, et c'est ce que CONTRAT1
 * vérifie.
 */
const PAGES_A_SOURCE = [
  ["/admin/retours", RETOURS, "supabaseActive"],
  ["/admin", DASHBOARD, "supabaseActive"],
  ["/admin/notifications", NOTIFICATIONS, "supabaseActive"],
  ["/admin/exercices", EXERCICES, "isLibrarySupabaseActive"],
  ["/admin/programmes", PROGRAMMES, "supabaseActive"],
  ["/admin/programmes/[programId]", PROGRAMME_DETAIL, "isSupabaseProgramsActive"],
  ["/admin/programmes/[programId]/builder", PROGRAMME_BUILDER, "isSupabaseActive"],
  ["/admin/eleves", ELEVES, "supabaseActive"],
  ["/admin/eleves/[studentId]", FICHE_ELEVE, "supabaseProgramsActive"],
  ["/admin/nutrition", NUTRITION, "supabaseActive"],
  ["/admin/documents", DOCUMENTS, "supabaseActive"],
] as const;

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

/**
 * Le corps de la garde de chargement d'une page, quel que soit son FORMATAGE.
 *
 * ⚠️ L'EXTRACTION PAR `indexOf("if (supabaseActive &&")` ÉPINGLAIT LA MISE EN
 * PAGE, et c'est ce qui a rendu ce test rouge au lot « anti-mock » : ajouter une
 * troisième liste à la garde de /admin/programmes l'a fait passer sur plusieurs
 * lignes, `indexOf` a rendu -1, la fenêtre est devenue VIDE — et le test
 * signalait « programmes non couverts » alors qu'ils l'étaient. Un test qui se
 * casse sur un retour à la ligne ne protège pas la propriété qu'il annonce.
 * On cherche donc le `if` qui mène à un `<Loader`, sans rien supposer de sa
 * forme.
 */
function corpsDeLaGarde(source: string, drapeau: string): string {
  const net = sansCommentaires(source);
  const motif = new RegExp(`if \\(\\s*${drapeau} &&[\\s\\S]{0,400}?\\)\\s*\\{\\s*return <Loader[\\s\\S]{0,200}?\\}`);
  const trouve = motif.exec(net);
  assert.ok(trouve, `garde de chargement introuvable (drapeau ${drapeau})`);
  return trouve[0];
}

await test("PAGE2. la garde couvre TOUTES les listes que la page et sa modale affichent", async () => {
  // ⚠️ LES ÉLÈVES COMPTENT AUTANT QUE LES PROGRAMMES : la modale « Assigner »
  // les liste, et une liste d'élèves encore vide y ferait apparaître les 7
  // fixtures `@mail.mock` — à l'endroit précis où un clic écrit.
  //
  // ⚠️ ET LA BANQUE D'EXERCICES AUSSI, depuis le lot « anti-mock » : l'onglet
  // « Banque » de cette page affiche `exerciseLibrary` et ses trois boutons
  // écrivent. Elle avait échappé au premier correctif.
  const garde = corpsDeLaGarde(PROGRAMMES, "supabaseActive");
  for (const liste of ["supabasePrograms.loading", "supabaseStudents.loading", "supabaseExerciseLibrary.loading"]) {
    assert.ok(garde.includes(liste), `/admin/programmes : ${liste} non couvert`);
  }

  const gardeE = corpsDeLaGarde(ELEVES, "supabaseActive");
  for (const liste of ["supabaseStudents.loading", "supabasePrograms.loading", "supabaseNutritionPlans.loading"]) {
    assert.ok(gardeE.includes(liste), `/admin/eleves : ${liste} non couvert`);
  }

  /*
   * Les pages ajoutées par le lot « anti-mock » : chaque liste qui DÉCIDE d'une
   * source, ou qui remplit un sélecteur où un clic écrit, doit être dans la
   * garde de sa page.
   */
  const COUVERTURE_ATTENDUE: readonly (readonly [string, string, string, readonly string[]])[] = [
    ["/admin/retours", RETOURS, "supabaseActive", ["supabaseFeedback.loading", "supabaseStudents.loading"]],
    [
      "/admin",
      DASHBOARD,
      "supabaseActive",
      [
        "supabaseStudents.loading",
        "supabaseFeedback.loading",
        "supabasePrograms.loading",
        "supabaseNutritionPlans.loading",
        "supabaseDocuments.loading",
      ],
    ],
    ["/admin/notifications", NOTIFICATIONS, "supabaseActive", ["supabaseStudents.loading"]],
    ["/admin/exercices", EXERCICES, "isLibrarySupabaseActive", ["supabaseExerciseLibrary.loading"]],
    [
      "/admin/programmes/[programId]",
      PROGRAMME_DETAIL,
      "isSupabaseProgramsActive",
      ["supabaseProgram.loading", "supabaseStudents.loading"],
    ],
    ["/admin/programmes/[programId]/builder", PROGRAMME_BUILDER, "isSupabaseActive", ["supabaseExerciseLibrary.loading"]],
    [
      "/admin/eleves/[studentId]",
      FICHE_ELEVE,
      "supabaseProgramsActive",
      ["supabaseProgramsSummary.loading", "supabaseNutritionPlans.loading", "supabaseDocuments.loading"],
    ],
  ];
  for (const [nom, source, drapeau, listes] of COUVERTURE_ATTENDUE) {
    const corps = corpsDeLaGarde(source, drapeau);
    for (const liste of listes) {
      assert.ok(corps.includes(liste), `${nom} : ${liste} non couvert par la garde`);
    }
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

/* ════════════════════════════════════════════════════════════════════════
 * IV. LE CONTRAT, SUR TOUTES LES PAGES ADMIN — lot « anti-mock »
 * ════════════════════════════════════════════════════════════════════════ */

await test("CONTRAT1. chaque page à source lit la CONFIGURATION, et nulle part ailleurs", () => {
  for (const [nom, source, drapeau] of PAGES_A_SOURCE) {
    const code = sansCommentaires(source);
    assert.match(
      code,
      new RegExp(`const ${drapeau.replace(/[$]/g, "\\$&")} = isSupabaseConfigured\\(\\)`),
      `${nom} : le drapeau de source ne vient pas de isSupabaseConfigured()`,
    );
  }
});

await test("CONTRAT2. CAS « chargement » — chaque page refuse de rendre, donc aucun mock", () => {
  /*
   * ⚠️ C'EST LE CAS 1 DU CAHIER DES CHARGES. Supabase configuré + requête en
   * vol ⇒ Loader. Sans cette garde, la page rend quelque chose : soit des
   * fixtures (l'ancien défaut), soit des zéros qui ressemblent à une base vide.
   */
  for (const [nom, source, drapeau] of PAGES_A_SOURCE) {
    const code = sansCommentaires(source);
    const motif = new RegExp(`if \\(\\s*${drapeau} &&[\\s\\S]{0,400}?\\.loading[\\s\\S]{0,400}?\\)\\s*\\{\\s*return <Loader`);
    assert.match(code, motif, `${nom} : aucune garde de chargement rendant un <Loader>`);
  }
});

await test("CONTRAT3. CAS « données » et CAS « 0 résultat » — la source est le ternaire, jamais un compte", () => {
  /*
   * ⚠️ UN SEUL CONTRÔLE COUVRE LES CAS 2 ET 3, et c'est volontaire : la forme
   * `drapeau ? supabase : state` rend MÉCANIQUEMENT la liste Supabase dès que
   * le drapeau est vrai — qu'elle contienne 26 lignes ou zéro. C'est
   * précisément ce que l'ancien ternaire ne faisait pas.
   */
  for (const [nom, source, drapeau] of PAGES_A_SOURCE) {
    const code = sansCommentaires(source);
    assert.match(
      code,
      new RegExp(`${drapeau} \\? [\\w.]+ : (state\\.|documents)`),
      `${nom} : la source n'est plus choisie par le drapeau de configuration`,
    );
  }
});

await test("CONTRAT4. CAS « Supabase non configuré » — les fixtures restent atteignables", () => {
  // ⚠️ ON NE SUPPRIME PAS LE MODE DÉMO. La branche `else` du ternaire EST ce
  // mode : si elle disparaissait, un développement local sans `.env`
  // afficherait une application vide.
  assert.ok(FIXTURES.includes("@mail.mock"), "les fixtures élèves ont disparu");
  assert.ok(FIXTURES.includes('id: "fb-1"'), "les fixtures de retours ont disparu");
  for (const [nom, source] of PAGES_A_SOURCE) {
    /*
     * ⚠️ APPELÉ, PAS SEULEMENT IMPORTÉ. `source.includes("useAdminData")` était
     * satisfait par la seule ligne d'import : on pouvait remplacer l'appel par
     * un objet vide — donc arracher le mode démonstration — sans que ce test
     * bronche. On exige l'APPEL du hook, et une lecture réelle de son état.
     */
    assert.match(
      sansCommentaires(source),
      /useAdminData\(\)/,
      `${nom} : \`useAdminData()\` n'est plus appelé — le mode démonstration a été arraché`,
    );
    assert.match(
      sansCommentaires(source),
      /: (state\.[\w.]+|documents\b)/,
      `${nom} : plus aucune branche de repli vers l'état de démonstration`,
    );
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * V. TESTS NÉGATIFS — la forme exacte du défaut, partout sous app/admin
 * ════════════════════════════════════════════════════════════════════════ */

/** Toutes les pages sous `app/admin`, trouvées en PARCOURANT le dossier. */
async function pagesAdmin(): Promise<{ chemin: string; code: string }[]> {
  const racine = fileURLToPath(new URL("../../app/admin", import.meta.url));
  const trouvees: { chemin: string; code: string }[] = [];
  async function parcourir(dossier: string) {
    for (const entree of await readdir(dossier, { withFileTypes: true })) {
      const complet = join(dossier, entree.name);
      if (entree.isDirectory()) await parcourir(complet);
      else if (entree.name.endsWith(".tsx")) {
        trouvees.push({ chemin: complet.slice(complet.indexOf("app/admin")), code: await readFile(complet, "utf8") });
      }
    }
  }
  await parcourir(racine);
  return trouvees;
}

await test("BALAYAGE. NÉGATIF — aucune page admin ne choisit sa source sur le NOMBRE DE LIGNES", async () => {
  /*
   * ⚠️ CE CONTRÔLE NE SE FIE À AUCUNE LISTE ÉCRITE À LA MAIN, et c'est la seule
   * leçon qui compte de ce lot. Le contrat était juste depuis un mois ; ce qui
   * a laissé le défaut vivre, c'est que `PAGES` ne listait que 4 pages sur 11.
   * Un balayage du dossier attrape la page suivante avant qu'elle n'existe.
   */
  const motifs: readonly { readonly regex: RegExp; readonly quoi: string }[] = [
    {
      regex: /\.length > 0\s*\?\s*[\w.]+\s*:\s*(state\.|documents\b)/,
      quoi: "choisit sa source sur le nombre de lignes (`xxx.length > 0 ? supabase : state`)",
    },
    {
      regex: /(const|let)\s+\w*[Aa]ctive\w*\s*=\s*[\w.]+\.(length|items|plans|programs|students|feedback|documents)[\w.]*\.length > 0/,
      quoi: "déduit « Supabase est actif » d'un nombre de lignes",
    },
    {
      regex: /(programme|nutrition|document)\s*:\s*[^,}\n]*\.length > 0/,
      quoi: "commande une écriture réelle sur un nombre de lignes (clé de `useContentAssignment`)",
    },
    {
      /*
       * ⚠️ LE MÊME DÉFAUT SOUS UN AUTRE NOM, et il avait survécu à ce balayage.
       * La fiche élève ne passe pas d'objet littéral à `useContentAssignment` :
       * elle nomme ses drapeaux (`canAssignRealPrograms`, …) et les passe en
       * props. Ne chercher que la forme `nutrition: …` laissait donc intact
       * `canAssignRealNutrition = … && plans.length > 0` — exactement le faux
       * succès d'écriture que DANGER1 rejoue.
       */
      regex: /(can[A-Z]\w*|\w*[Aa]ssignReal\w*|\w*[Pp]eut\w*)\s*=\s*[^;\n]*\.length > 0/,
      quoi: "nomme un drapeau d'écriture déduit d'un nombre de lignes",
    },
    {
      regex: /isSupabaseStudent=\{[\w.]+\.length > 0\}/,
      quoi: "passe un drapeau d'écriture déduit d'un nombre de lignes",
    },
  ];
  const pages = await pagesAdmin();
  assert.ok(pages.length >= 25, `balayage suspect : seulement ${pages.length} fichiers trouvés sous app/admin`);
  for (const { chemin, code } of pages) {
    const net = sansCommentaires(code);
    for (const { regex, quoi } of motifs) {
      assert.ok(!regex.test(net), `${chemin} ${quoi}`);
    }
  }
});

await test("BALAYAGE2. NÉGATIF — `adminFeedback` n'est jamais atteignable quand Supabase est configuré", async () => {
  /*
   * ⚠️ LE SYMPTÔME SIGNALÉ PAR L'UTILISATEUR, VÉRIFIÉ À LA SOURCE. Les sept
   * retours `fb-1` … `fb-7` n'arrivent dans une page que par `state.feedback`
   * (useAdminData → data/admin.ts::adminFeedback). Toute page qui lit
   * `state.feedback` doit donc le faire derrière un drapeau de configuration.
   */
  for (const { chemin, code } of await pagesAdmin()) {
    const net = sansCommentaires(code);
    if (!net.includes("state.feedback")) continue;
    for (const lecture of net.match(/[\w.]*\s*\?\s*[\w.]+\s*:\s*state\.feedback/g) ?? []) {
      assert.match(
        lecture,
        /^(supabaseActive|isSupabase\w*Active)\s*\?/,
        `${chemin} : \`state.feedback\` est atteint autrement que par un drapeau de configuration (${lecture})`,
      );
    }
    assert.ok(
      /(supabaseActive|isSupabase\w*Active) \? \w+[\w.]* : state\.feedback/.test(net),
      `${chemin} : lit state.feedback sans drapeau de configuration`,
    );
  }
});

await test("BALAYAGE3. NÉGATIF — aucune fixture `fb-1 … fb-7` ne peut atteindre le chemin Supabase", () => {
  /*
   * ⚠️ ON REMONTE JUSQU'AU SEUL PRODUCTEUR. `adminFeedback` est exporté par
   * `data/admin.ts` et consommé par `useAdminData` seul : si une page voulait
   * ces fixtures par un autre chemin, elle devrait importer l'un des deux.
   */
  const retours = sansCommentaires(RETOURS);
  assert.ok(!retours.includes("adminFeedback"), "/admin/retours importe les fixtures directement");
  assert.ok(!retours.includes("data/admin"), "/admin/retours importe data/admin directement");
  for (const marque of ["fb-1", "fb-2", "fb-7"]) {
    assert.ok(!retours.includes(marque), `/admin/retours cite la fixture ${marque}`);
  }
  // Et l'unique porte restante est bien derrière la configuration.
  assert.match(
    retours,
    /const feedback = supabaseActive \? supabaseFeedback\.feedback : state\.feedback;/,
    "/admin/retours : la porte des fixtures n'est pas celle attendue",
  );
  // L'ÉCRITURE suit la même source — sinon un changement de statut part dans
  // localStorage en annonçant un succès (voir DANGER1).
  assert.ok(
    !/\buseSupabase\b/.test(retours),
    "/admin/retours garde un second drapeau `useSupabase`, distinct de la source",
  );
  assert.equal(
    (retours.match(/supabaseActive \? supabaseFeedback\./g) ?? []).length,
    4,
    "/admin/retours : les 4 écritures (réponse + 3 statuts) doivent suivre le drapeau de configuration",
  );
});

await test("BALAYAGE4. NÉGATIF — la liste PAGES_A_SOURCE ne peut pas se vider en silence", () => {
  /*
   * ⚠️ UNE LISTE QUI RÉTRÉCIT EST UN TEST QUI S'ÉTEINT. C'est exactement
   * comment ce fichier a cessé de protéger 7 pages sur 11 : rien ne disait
   * combien il devait en couvrir.
   */
  assert.equal(PAGES_A_SOURCE.length, 11, "une page à source a été retirée de la couverture");
  const chemins = new Set<string>(PAGES_A_SOURCE.map(([nom]) => nom));
  for (const attendu of [
    "/admin",
    "/admin/retours",
    "/admin/notifications",
    "/admin/exercices",
    "/admin/eleves",
    "/admin/eleves/[studentId]",
    "/admin/programmes",
    "/admin/programmes/[programId]",
    "/admin/programmes/[programId]/builder",
    "/admin/nutrition",
    "/admin/documents",
  ]) {
    assert.ok(chemins.has(attendu), `${attendu} n'est plus couvert`);
  }
});

/* ── Verdict ─────────────────────────────────────────────────────────────── */

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
