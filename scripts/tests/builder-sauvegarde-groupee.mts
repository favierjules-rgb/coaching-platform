/**
 * Harnais — OPTIMISATION DE LA SAUVEGARDE DU BUILDER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE HARNAIS MESURE, ET CE QU'IL NE MESURE PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il compte les REQUÊTES RÉELLEMENT ÉMISES par le chemin d'écriture des
 * réglages, à travers un client Supabase factice qui enregistre chaque appel.
 * Les deux chemins sont exercés : l'ANCIEN (`setProgressionReglage`, une
 * écriture par réglage — toujours présent dans le module, donc mesurable pour
 * de vrai) et le NOUVEAU (`setProgressionReglagesEnLot`). La comparaison
 * avant/après n'est donc pas un modèle : ce sont deux exécutions du code.
 *
 * Il ne remplace pas PostgreSQL : l'unicité, la RLS et les grants font foi
 * dans les checklists SQL. Ici on prouve le comportement de l'APPLICATION —
 * combien de requêtes, avec quelle charge utile, et dans quel ordre.
 *
 * Le TEMPS est mesuré avec une latence injectée par requête : ce n'est pas la
 * latence réelle du réseau, mais le rapport avant/après ne dépend pas d'elle,
 * puisque les deux chemins subissent la même.
 *
 * ⚠️ AUCUNE ÉCRITURE RÉELLE. Aucun client Supabase n'est construit.
 *
 * Lancement : npx tsx scripts/tests/builder-sauvegarde-groupee.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  cleReglageDeLExercice,
  lotsDEcriture,
  type ExercicePourReglage,
  type IdentifiantsReglages,
} from "../../lib/progression-reglage";
import {
  getProgressionReglages,
  setProgressionReglage,
  setProgressionReglagesEnLot,
} from "../../lib/supabase/progression-reglage";
import { creerGardeDeSauvegarde, DEJA_EN_COURS } from "../../lib/garde-sauvegarde";

const PROGRAMME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sourceBuilder = lire("../../components/admin/ProgramBuilderFullscreen.tsx");
const sourceToggle = lire("../../components/admin/ProgressionAutomatiqueToggle.tsx");
const sourceEcriture = lire("../../lib/supabase/progression-reglage.ts");

/* ══════════════════════════════════════════════════════════════════════
 * CLIENT SUPABASE FACTICE — IL NE FAIT QUE COMPTER
 * ══════════════════════════════════════════════════════════════════════ */

interface Appel {
  readonly table: string;
  readonly operation: "select" | "update" | "insert" | "upsert";
  /** Les lignes envoyées, quand il y en a. */
  readonly lignes: readonly Record<string, unknown>[];
  /** Les options passées à `upsert`, `onConflict` compris. */
  readonly options: Record<string, unknown> | null;
  readonly filtres: readonly [string, unknown][];
}

interface ClientFactice {
  readonly appels: Appel[];
  /** Nombre d'allers-retours réseau : un par requête terminale. */
  readonly requetes: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly client: any;
}

/**
 * Un client qui enregistre chaque requête au lieu de l'émettre.
 *
 * `lignesExistantes` sert à l'ancien chemin : un `update` qui « touche » une
 * ligne rend un identifiant, ce qui lui évite l'`insert` de repli. C'est ce
 * qui fait que l'ancien chemin coûte 1 ou 2 requêtes par réglage, selon que
 * la ligne existe déjà — les deux cas sont exercés.
 */
function creerClientFactice(options: { lignesExistantes?: Set<string>; latenceMs?: number } = {}): ClientFactice {
  const appels: Appel[] = [];
  const existantes = options.lignesExistantes ?? new Set<string>();
  const latence = options.latenceMs ?? 0;
  const attendre = () => (latence > 0 ? new Promise((r) => setTimeout(r, latence)) : Promise.resolve());

  function constructeur(table: string) {
    const filtres: [string, unknown][] = [];
    let operation: Appel["operation"] = "select";
    let lignes: Record<string, unknown>[] = [];
    let optionsUpsert: Record<string, unknown> | null = null;

    const terminer = async () => {
      await attendre();
      appels.push({ table, operation, lignes, options: optionsUpsert, filtres: [...filtres] });
      if (operation === "update") {
        // L'ancien chemin lit `data.length` pour décider de l'insertion.
        const identite = filtres.find(([colonne]) => colonne !== "program_id")?.[1];
        const touchee = typeof identite === "string" && existantes.has(identite);
        return { data: touchee ? [{ id: "ligne" }] : [], error: null };
      }
      return { data: [], error: null };
    };

    const chaine = {
      // La liste des colonnes ne change rien au comptage : seul le nombre
      // d'allers-retours nous intéresse.
      select() {
        if (operation === "select") return chaine;
        return terminer();
      },
      eq(colonne: string, valeur: unknown) {
        filtres.push([colonne, valeur]);
        return chaine;
      },
      update(valeurs: Record<string, unknown>) {
        operation = "update";
        lignes = [valeurs];
        return chaine;
      },
      insert(valeurs: Record<string, unknown> | Record<string, unknown>[]) {
        operation = "insert";
        lignes = Array.isArray(valeurs) ? valeurs : [valeurs];
        return terminer();
      },
      upsert(valeurs: Record<string, unknown>[], opts?: Record<string, unknown>) {
        operation = "upsert";
        lignes = valeurs;
        optionsUpsert = opts ?? null;
        return terminer();
      },
      // `getProgressionReglages` termine sur `.eq(...)` : la chaîne est donc
      // aussi une promesse pour le chemin de LECTURE.
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return terminer().then(resolve, reject);
      },
    };
    return chaine;
  }

  return {
    appels,
    get requetes() {
      return appels.length;
    },
    client: { from: (table: string) => constructeur(table) },
  };
}

/** N bascules à activer, dont `dejaEnBase` correspondent à des lignes existantes. */
function bascules(nombre: number, dejaEnBase = 0, actif = true) {
  const tampon = new Map<string, { exercice: ExercicePourReglage; progressionActive: boolean }>();
  const identifiants = new Map<string, string>();
  for (let i = 0; i < nombre; i += 1) {
    const exercice: ExercicePourReglage = { name: `Exercice ${i}`, libraryExerciseId: `lib-${i}` };
    const cle = cleReglageDeLExercice(exercice);
    assert.ok(cle, "l'exercice a une identité");
    tampon.set(cle, { exercice, progressionActive: actif });
    if (i < dejaEnBase) identifiants.set(cle, `ligne-${i}`);
  }
  return { tampon, identifiants: identifiants as IdentifiantsReglages };
}

/** Le NOUVEAU chemin : N réglages, écriture groupée. Rend le nombre de requêtes. */
async function ecrireGroupe(nombre: number, dejaEnBase = 0, actif = true) {
  const { tampon, identifiants } = bascules(nombre, dejaEnBase, actif);
  const lots = lotsDEcriture(PROGRAMME, tampon, identifiants);
  const faux = creerClientFactice();
  const resultat = await setProgressionReglagesEnLot(faux.client, lots);
  assert.ok(resultat.ok, "l'écriture groupée réussit");
  return { requetes: faux.requetes, rapportees: resultat.requetes, appels: faux.appels, lots };
}

/** L'ANCIEN chemin, tel qu'il est encore écrit dans le module : une écriture PAR réglage. */
async function ecrireUnParUn(nombre: number, dejaEnBase = 0, actif = true) {
  const { tampon, identifiants } = bascules(nombre, dejaEnBase, actif);
  const lots = lotsDEcriture(PROGRAMME, tampon, identifiants);
  const existantes = new Set<string>();
  for (const ligne of lots.aMettreAJour) if (ligne.exerciseLibraryId) existantes.add(ligne.exerciseLibraryId);
  const faux = creerClientFactice({ lignesExistantes: existantes });
  for (const ligne of [...lots.aMettreAJour, ...lots.aInserer]) {
    const r = await setProgressionReglage(faux.client, {
      programId: ligne.programId,
      exerciseLibraryId: ligne.exerciseLibraryId,
      exerciseNameNormalized: ligne.exerciseNameNormalized,
      progressionActive: ligne.progressionActive,
    });
    assert.ok(r.ok);
  }
  return { requetes: faux.requetes, appels: faux.appels };
}

await (async () => {
  /* ══════════════════════════════════════════════════════════════════════
   * AUDIT — OÙ LE TEMPS PASSE VRAIMENT
   * ══════════════════════════════════════════════════════════════════════ */

  await test("1. AUDIT — la table des réglages a ZÉRO empreinte dans le chemin de sauvegarde", () => {
    for (const chemin of [
      "../../lib/supabase/programs.ts",
      "../../lib/supabase/training-session-blocks.ts",
      "../../lib/admin-builder-save.ts",
      "../../hooks/useSupabaseProgram.ts",
    ]) {
      assert.ok(
        !lire(chemin).includes("program_exercise_progression"),
        `${chemin} n'écrit ni ne lit la table des réglages`,
      );
    }
    // Et côté base : le SEUL déclencheur porté par la table est `set_updated_at`
    // sur la table elle-même. Rien ne se déclenche depuis la sauvegarde.
    const migration = lire("../../supabase/migrations/20260925090000_progression_automatique_par_exercice.sql");
    const declencheurs = migration.match(/create trigger\s+(\S+)/g) ?? [];
    assert.equal(declencheurs.length, 1, "un seul déclencheur");
    assert.ok(declencheurs[0].includes("set_updated_at"), "et c'est l'horodatage, pas un effet de bord");
    assert.ok(!/create trigger[\s\S]*on public\.(workout_sessions|training_blocks|programs)/.test(migration));
  });

  await test("2. AUDIT — la sauvegarde est SÉQUENTIELLE par séance : d'où le coût multiplié", () => {
    // C'est le fait qui rend une sauvegarde concurrente si chère : chaque
    // séance attend la précédente. K sauvegardes simultanées ne se
    // parallélisent pas, elles font la queue.
    const code = sansCommentaires(lire("../../lib/supabase/programs.ts"));
    const diff = code.slice(code.indexOf("async function diffProgramStructure"));
    const corps = diff.slice(0, diff.indexOf("\nexport "));
    assert.ok(/for \(const session of sessions\)/.test(corps), "une boucle par séance");
    assert.ok(/await saveTrainingSessionBlocks\(/.test(corps), "et un appel ATTENDU à l'intérieur");
    assert.ok(!/Promise\.all\(\s*sessions/.test(corps), "aucune parallélisation des séances");
    // Le builder n'émet AUCUNE requête de réglage pendant la sauvegarde.
    const codeBuilder = sansCommentaires(sourceBuilder);
    assert.ok(!codeBuilder.includes("setProgressionReglage"), "le builder n'écrit aucun réglage lui-même");
    assert.ok(!codeBuilder.includes("program_exercise_progression"));
  });

  /* ══════════════════════════════════════════════════════════════════════
   * LE COÛT RÉSEAU DES RÉGLAGES — MESURÉ, PAS DÉDUIT
   * ══════════════════════════════════════════════════════════════════════ */

  await test("3. UN réglage : une seule requête", async () => {
    const neuf = await ecrireGroupe(1, 0);
    assert.equal(neuf.requetes, 1, "une ligne neuve : un insert");
    assert.equal(neuf.rapportees, 1, "et le module rapporte le même compte");
    assert.equal(neuf.appels[0].operation, "insert");
    const existant = await ecrireGroupe(1, 1);
    assert.equal(existant.requetes, 1, "une ligne existante : un upsert");
    assert.equal(existant.appels[0].operation, "upsert");
  });

  await test("4. PLUSIEURS réglages : toujours au plus deux requêtes", async () => {
    for (const nombre of [2, 3, 5, 9]) {
      const tousNeufs = await ecrireGroupe(nombre, 0);
      assert.equal(tousNeufs.requetes, 1, `${nombre} lignes neuves : un seul insert`);
      assert.equal(tousNeufs.appels[0].lignes.length, nombre, "toutes les lignes dans la même requête");
      const tousExistants = await ecrireGroupe(nombre, nombre);
      assert.equal(tousExistants.requetes, 1, `${nombre} lignes existantes : un seul upsert`);
      assert.equal(tousExistants.appels[0].lignes.length, nombre);
    }
  });

  await test("5. CINQUANTE réglages : deux requêtes au lieu de 50 à 100", async () => {
    const apres = await ecrireGroupe(50, 25);
    assert.equal(apres.requetes, 2, "un upsert + un insert, et rien d'autre");
    assert.equal(apres.rapportees, 2);
    const upsert = apres.appels.find((a) => a.operation === "upsert");
    const insert = apres.appels.find((a) => a.operation === "insert");
    assert.ok(upsert && insert, "les deux lots sont réellement peuplés");
    assert.equal(upsert.lignes.length, 25);
    assert.equal(insert.lignes.length, 25);
    // ⚠️ ET LE MÊME TRAVAIL PAR L'ANCIEN CHEMIN, RÉELLEMENT EXÉCUTÉ.
    const avant = await ecrireUnParUn(50, 25);
    assert.equal(avant.requetes, 75, "25 update touchés + 25 update à vide + 25 insert de repli");
    assert.ok(avant.requetes / apres.requetes >= 35, `facteur de réduction mesuré : ${avant.requetes} → ${apres.requetes}`);
    // Le coût réseau ne suit PLUS le nombre d'exercices.
    const cinqCents = await ecrireGroupe(500, 250);
    assert.equal(cinqCents.requetes, 2, "500 réglages coûtent le même prix que 50");
  });

  await test("6. ACTIVATION et DÉSACTIVATION coûtent le même prix, et c'est l'état final qui part", async () => {
    const active = await ecrireGroupe(10, 5, true);
    const desactive = await ecrireGroupe(10, 5, false);
    assert.equal(active.requetes, 2);
    assert.equal(desactive.requetes, 2, "désactiver n'est pas plus cher qu'activer");
    for (const appel of desactive.appels) {
      for (const ligne of appel.lignes) {
        assert.equal(ligne.progression_active, false, "l'état écrit est bien OFF");
      }
    }
    for (const appel of active.appels) {
      for (const ligne of appel.lignes) assert.equal(ligne.progression_active, true);
    }
    // Un aller-retour sur le MÊME exercice n'écrit qu'une ligne, l'état final.
    const exercice: ExercicePourReglage = { name: "Élévations latérales", libraryExerciseId: "lib-elev" };
    const cle = cleReglageDeLExercice(exercice)!;
    const tampon = new Map([[cle, { exercice, progressionActive: true }]]);
    tampon.set(cle, { exercice, progressionActive: false });
    const lots = lotsDEcriture(PROGRAMME, tampon, new Map());
    const faux = creerClientFactice();
    await setProgressionReglagesEnLot(faux.client, lots);
    assert.equal(faux.requetes, 1, "une seule requête");
    assert.equal(faux.appels[0].lignes.length, 1, "une seule ligne");
    assert.equal(faux.appels[0].lignes[0].progression_active, false, "et c'est l'état final");
  });

  await test("7. MÉLANGE de lignes neuves et existantes : deux requêtes, jamais 2N", async () => {
    for (const [total, existantes] of [
      [2, 1],
      [10, 3],
      [50, 25],
      [50, 49],
    ] as const) {
      const r = await ecrireGroupe(total, existantes);
      assert.equal(r.requetes, 2, `${existantes}/${total} existantes : deux requêtes`);
      assert.equal(r.lots.aMettreAJour.length, existantes);
      assert.equal(r.lots.aInserer.length, total - existantes);
    }
  });

  await test("8. AUCUN réglage modifié : AUCUNE requête", async () => {
    const lots = lotsDEcriture(PROGRAMME, new Map(), new Map());
    const faux = creerClientFactice();
    const r = await setProgressionReglagesEnLot(faux.client, lots);
    assert.ok(r.ok);
    assert.equal(faux.requetes, 0, "un tampon vide n'émet rien");
    assert.equal(r.requetes, 0);
    // Et un exercice SANS identité n'entre dans aucun lot : toujours zéro.
    const sansIdentite = new Map([["bidon", { exercice: { name: "" }, progressionActive: true }]]);
    const rien = lotsDEcriture(PROGRAMME, sansIdentite, new Map());
    const faux2 = creerClientFactice();
    await setProgressionReglagesEnLot(faux2.client, rien);
    assert.equal(faux2.requetes, 0);
  });

  await test("9. SAUVEGARDE NORMALE sans progression automatique : rien ne change", async () => {
    // Aucune bascule : le chemin des réglages n'émet aucune requête, et le
    // chemin de sauvegarde n'en émet aucune de réglage (test 1). Une
    // sauvegarde sans progression coûte donc exactement ce qu'elle coûtait.
    const faux = creerClientFactice();
    await setProgressionReglagesEnLot(faux.client, lotsDEcriture(PROGRAMME, new Map(), new Map()));
    assert.equal(faux.requetes, 0);
    // La LECTURE au montage, elle, reste d'UNE requête — pas une par exercice.
    const lecture = creerClientFactice();
    await getProgressionReglages(lecture.client, PROGRAMME);
    assert.equal(lecture.requetes, 1, "une seule lecture pour tout le programme");
    assert.equal(lecture.appels[0].operation, "select");
    assert.deepEqual(lecture.appels[0].filtres, [["program_id", PROGRAMME]]);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * LE MODÈLE FONCTIONNEL N'A PAS BOUGÉ
   * ══════════════════════════════════════════════════════════════════════ */

  await test("10. CLÉ GLOBALE PAR EXERCICE conservée, et EXACTEMENT une identité par ligne", async () => {
    const r = await ecrireGroupe(6, 3);
    for (const appel of r.appels) {
      for (const ligne of appel.lignes) {
        assert.equal(ligne.program_id, PROGRAMME, "toujours rattachée au programme");
        const parBanque = ligne.exercise_library_id !== null && ligne.exercise_library_id !== undefined;
        const parNom = ligne.exercise_name_normalized !== null && ligne.exercise_name_normalized !== undefined;
        assert.ok(parBanque !== parNom, "exactement une identité : banque OU nom normalisé");
      }
    }
    // Un exercice en texte libre passe par le nom normalisé.
    const libre: ExercicePourReglage = { name: "Tirage Horizontal" };
    const texteLibre = new Map([[cleReglageDeLExercice(libre)!, { exercice: libre, progressionActive: true }]]);
    const lots = lotsDEcriture(PROGRAMME, texteLibre, new Map());
    const faux = creerClientFactice();
    await setProgressionReglagesEnLot(faux.client, lots);
    const ligne = faux.appels[0].lignes[0];
    assert.equal(ligne.exercise_library_id, null);
    assert.equal(ligne.exercise_name_normalized, "tirage horizontal", "normalisé, pas brut");
  });

  await test("11. AUCUN réglage PAR SEMAINE, par séance ni par bloc n'est écrit", async () => {
    const r = await ecrireGroupe(20, 10);
    const interdites = ["week", "week_number", "session", "session_id", "block", "block_id", "workout_exercise_id"];
    for (const appel of r.appels) {
      for (const ligne of appel.lignes) {
        for (const colonne of Object.keys(ligne)) {
          assert.ok(
            !interdites.some((mot) => colonne.includes(mot)),
            `la charge utile ne porte pas « ${colonne} »`,
          );
        }
      }
    }
    // Et la clé de tampon elle-même ne contient ni semaine ni séance.
    const exercice: ExercicePourReglage = { name: "Squat", libraryExerciseId: "lib-squat" };
    // La clé est l'identité SEULE : un préfixe de genre, puis l'identifiant de
    // banque ou le nom normalisé. Ni semaine, ni séance, ni bloc.
    assert.equal(cleReglageDeLExercice(exercice), "banque:lib-squat");
    assert.equal(cleReglageDeLExercice({ name: "Tirage Horizontal" }), "nom:tirage horizontal");
    for (const cle of ["banque:lib-squat", "nom:tirage horizontal"]) {
      assert.ok(!/semaine|week|session|bloc|block/.test(cle), `« ${cle} » ne porte aucune portée`);
    }
  });

  await test("12. l'`onConflict` ne vise JAMAIS un index unique partiel", async () => {
    const r = await ecrireGroupe(4, 4);
    const upsert = r.appels.find((a) => a.operation === "upsert");
    assert.ok(upsert);
    assert.deepEqual(upsert.options, { onConflict: "id" }, "la clé primaire, et rien d'autre");
    // Les deux colonnes d'identité portent des index PARTIELS (prédicat
    // `where`) : PostgREST ne transmet que des noms de colonnes, jamais le
    // prédicat, donc les viser rendrait 42P10. Elles ne doivent jamais
    // apparaître dans un onConflict.
    const code = sansCommentaires(sourceEcriture);
    assert.ok(!/onConflict:\s*"[^"]*exercise_library_id/.test(code));
    assert.ok(!/onConflict:\s*"[^"]*exercise_name_normalized/.test(code));
    assert.ok(!/onConflict:\s*"[^"]*program_id/.test(code));
    const migration = lire("../../supabase/migrations/20260925090000_progression_automatique_par_exercice.sql");
    const partiels = migration.match(/create unique index[\s\S]*?;/g) ?? [];
    assert.equal(partiels.length, 2, "deux index uniques, tous deux partiels");
    for (const index of partiels) assert.ok(/where/i.test(index), "et chacun porte bien un prédicat");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * MESURE DE TEMPS — MÊME LATENCE POUR LES DEUX CHEMINS
   * ══════════════════════════════════════════════════════════════════════ */

  await test("13. MESURE — 50 réglages, latence identique : le temps suit le nombre de requêtes", async () => {
    const LATENCE = 4;
    const { tampon, identifiants } = bascules(50, 25);
    const lots = lotsDEcriture(PROGRAMME, tampon, identifiants);

    const clientApres = creerClientFactice({ latenceMs: LATENCE });
    const debutApres = Date.now();
    await setProgressionReglagesEnLot(clientApres.client, lots);
    const apresMs = Date.now() - debutApres;

    const existantes = new Set<string>();
    for (const ligne of lots.aMettreAJour) if (ligne.exerciseLibraryId) existantes.add(ligne.exerciseLibraryId);
    const clientAvant = creerClientFactice({ lignesExistantes: existantes, latenceMs: LATENCE });
    const debutAvant = Date.now();
    for (const ligne of [...lots.aMettreAJour, ...lots.aInserer]) {
      await setProgressionReglage(clientAvant.client, {
        programId: ligne.programId,
        exerciseLibraryId: ligne.exerciseLibraryId,
        exerciseNameNormalized: ligne.exerciseNameNormalized,
        progressionActive: ligne.progressionActive,
      });
    }
    const avantMs = Date.now() - debutAvant;

    console.log(
      `     → 50 réglages : AVANT ${clientAvant.requetes} requêtes / ${avantMs} ms` +
        ` — APRÈS ${clientApres.requetes} requêtes / ${apresMs} ms (latence injectée ${LATENCE} ms)`,
    );
    assert.equal(clientApres.requetes, 2);
    assert.equal(clientAvant.requetes, 75);
    assert.ok(avantMs > apresMs * 5, `le temps s'effondre avec le nombre d'allers-retours (${avantMs} vs ${apresMs})`);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * GARDE CONTRE LES SAUVEGARDES CONCURRENTES
   * ══════════════════════════════════════════════════════════════════════ */

  await test("14. COMPORTEMENTAL — deux sauvegardes NE PEUVENT PAS partir en même temps", async () => {
    let executions = 0;
    /* Les résolveurs sont COLLECTÉS, pas écrasés. Une variable unique
       réaffectée ne libérerait que la dernière sauvegarde entrée, et un
       sabotage qui laisse passer les cinq appels ferait alors PENDRE ce test
       au lieu de le faire échouer. Un test qui pend n'apprend rien. */
    const resolveurs: (() => void)[] = [];
    const garde = creerGardeDeSauvegarde();
    const sauvegarde = () =>
      garde.executer(async () => {
        executions += 1;
        await new Promise<void>((r) => resolveurs.push(r));
        return "fini";
      });

    try {
      // Cinq Cmd+S pendant une sauvegarde qui n'a pas rendu la main.
      const premiere = sauvegarde();
      const suivantes = [sauvegarde(), sauvegarde(), sauvegarde(), sauvegarde()];
      // Laisser les micro-tâches s'écouler : chaque appel a eu sa chance.
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(executions, 1, "UNE seule sauvegarde est partie");
      assert.equal(resolveurs.length, 1, "et une seule est réellement en vol");
      assert.ok(garde.enCours, "la garde est fermée pendant ce temps");
      for (const refus of await Promise.all(suivantes)) {
        assert.equal(refus, DEJA_EN_COURS, "chaque appui suivant est refusé, explicitement");
      }

      // La première finit ; le drapeau retombe ; un nouvel appui repart.
      resolveurs.shift()?.();
      assert.equal(await premiere, "fini");
      assert.equal(garde.enCours, false, "le drapeau est relâché");
      const relance = sauvegarde();
      await Promise.resolve();
      assert.equal(executions, 2, "une sauvegarde ultérieure est bien possible");
      resolveurs.shift()?.();
      assert.equal(await relance, "fini");
    } finally {
      // Rien ne doit rester en vol, même si une assertion a échoué.
      for (const liberer of resolveurs.splice(0)) liberer();
    }
  });

  await test("15. le drapeau est relâché même si la sauvegarde LÈVE", async () => {
    const garde = creerGardeDeSauvegarde();
    await assert.rejects(
      garde.executer(async () => {
        throw new Error("réseau coupé");
      }),
      /réseau coupé/,
    );
    assert.equal(garde.enCours, false, "sans cela, un seul échec condamnerait le bouton et le raccourci");
    let repartie = false;
    await garde.executer(async () => {
      repartie = true;
    });
    assert.ok(repartie, "et la sauvegarde suivante repart");
  });

  await test("16. CÂBLAGE — Cmd+S, le bouton et « Enregistrer et fermer » passent TOUS par la garde", () => {
    const code = sansCommentaires(sourceBuilder);
    // La garde existe, et elle survit aux rendus.
    assert.ok(code.includes("creerGardeDeSauvegarde()"), "la garde est créée");
    assert.ok(/useRef\(creerGardeDeSauvegarde\(\)\)/.test(code), "dans un useRef : elle survit aux rendus");
    // `handleSave` passe par elle, et c'est la PREMIÈRE chose qu'il fait.
    const debut = code.indexOf("async function handleSave()");
    assert.ok(debut > 0, "handleSave existe");
    const corps = code.slice(debut, code.indexOf("\n  }", debut));
    assert.ok(/executer\(/.test(corps), "handleSave passe par la garde");
    const posGarde = corps.indexOf("executer(");
    const posEtat = corps.indexOf('setSaveStatus("saving")');
    assert.ok(posGarde < posEtat, "la garde est franchie AVANT tout changement d'état");
    assert.ok(posGarde < corps.indexOf("onSave("), "et avant tout appel réseau");
    // ⚠️ AUCUN point d'entrée ne contourne `handleSave`.
    const appels = code.match(/void handleSave\(\)|await handleSave\(\)|handleSave\(\)/g) ?? [];
    assert.ok(appels.length >= 3, `les trois points d'entrée appellent handleSave (${appels.length} appels)`);
    assert.ok(!/onSave\(\{[\s\S]{0,400}\}\);/.test(code.replace(corps, "")), "onSave n'est appelé que dans handleSave");
    // Le raccourci clavier existe toujours et n'appelle rien d'autre.
    const effetClavier = code.slice(code.indexOf("function handleKeyDown"), code.indexOf("addEventListener"));
    assert.ok(/metaKey \|\| event\.ctrlKey/.test(effetClavier) && /=== "s"/.test(effetClavier), "Cmd/Ctrl+S est bien là");
    assert.ok(/handleSave\(\)/.test(effetClavier), "et il passe par handleSave, donc par la garde");
    // Le bouton reste désactivé : la garde s'ajoute, elle ne remplace pas.
    assert.ok(code.includes('disabled={saveStatus === "saving"}'), "le bouton reste désactivé pendant la sauvegarde");
  });

  await test("17. le module de garde ne se fonde PAS sur l'état React", () => {
    const code = sansCommentaires(lire("../../lib/garde-sauvegarde.ts"));
    assert.ok(!/useState|useRef|saveStatus/.test(code), "aucune dépendance à React : la garde est pure et testable");
    assert.ok(/finally/.test(code), "le drapeau est relâché dans un finally");
    // La garde ne met rien en file d'attente : un refus est un refus.
    assert.ok(!/queue|file|setTimeout/.test(code), "aucune mise en file : l'appel surnuméraire est ignoré");
  });

  await test("18bis. LE FOURNISSEUR N'ÉCRIT QU'UNE FOIS, avec le LOT ENTIER", () => {
    /* ⚠️ TEST AJOUTÉ APRÈS UN SABOTAGE RESTÉ VERT. Le sabotage « réintroduire
       une écriture individuelle par réglage » remplaçait, dans `vider()`,
       l'unique `await ecrire(lots)` par une boucle appelant `ecrire` une fois
       par ligne. Aucun test ne le voyait : les compteurs de requêtes
       exerçaient `setProgressionReglagesEnLot` en direct, et la garde
       textuelle ne surveillait que l'ancien nom de fonction. Le trou est ici.

       Faute de DOM dans ces suites, la garde est STRUCTURELLE — mais elle
       porte sur le fait qui compte : le LOT ENTIER est passé tel quel, une
       seule fois, et aucune boucle ne précède l'appel. */
    const code = sansCommentaires(sourceToggle);
    const appels = code.match(/await ecrire\(/g) ?? [];
    assert.equal(appels.length, 1, "UN SEUL appel d'écriture dans tout le fournisseur");
    assert.ok(code.includes("await ecrire(lots)"), "et il reçoit le LOT ENTIER, jamais une ligne reconstruite");
    assert.ok(!/ecrire\(\s*\{/.test(code), "jamais un lot fabriqué à la volée pour une seule ligne");
    // Aucune boucle entre l'ouverture de `vider` et l'écriture : c'est ce qui
    // rendrait le coût proportionnel au nombre de réglages.
    const debutVider = code.indexOf("const enregistrerLesReglages = useCallback");
    assert.ok(debutVider > 0, "la persistance groupée existe");
    const avantEcriture = code.slice(debutVider, code.indexOf("await ecrire(lots)"));
    for (const boucle of ["for (", "while (", ".forEach(", ".map("]) {
      assert.ok(!avantEcriture.includes(boucle), `aucune boucle « ${boucle} » avant l'écriture`);
    }
    // Et le lot part d'un SEUL calcul, sur le tampon entier.
    assert.equal((code.match(/lotsDEcriture\(/g) ?? []).length, 1, "un seul calcul de lots");
  });

  await test("18. l'écriture unitaire n'a AUCUN appelant en production", () => {
    // Elle reste exportée (API publique du module), mais plus rien ne l'appelle :
    // c'est ce qui garantit que le chemin N+1 ne peut pas revenir par la porte
    // de service.
    const codeToggle = sansCommentaires(sourceToggle);
    assert.ok(!codeToggle.includes("setProgressionReglage("), "le fournisseur n'écrit plus réglage par réglage");
    assert.ok(codeToggle.includes("setProgressionReglagesEnLot"), "il écrit en lot");
    assert.ok(!sansCommentaires(sourceBuilder).includes("setProgressionReglage"), "le builder non plus");
    // Et le tampon differé est toujours en place.
    assert.ok(codeToggle.includes("enAttente"), "un tampon de bascules existe");
    /* ⚠️ MISE À JOUR DU 23/09/2026 — OBJECTIF 2 : le clic n'écrit plus du tout.
       Les deux anciennes affirmations portaient sur le DÉCLENCHEUR (minuterie,
       vidage au démontage) ; toutes deux ont disparu sur consigne. Ce qui est
       vérifié maintenant est plus strict : aucune minuterie nulle part, et la
       persistance est une poignée que « Enregistrer » appelle. */
    assert.ok(!/setTimeout\(|setInterval\(/.test(codeToggle), "aucune écriture programmée dans le temps");
    assert.ok(codeToggle.includes("enregistrerRef.current = enregistrerLesReglages"), "poignée de persistance posée");
    const codeBuilder = sansCommentaires(sourceBuilder);
    assert.ok(codeBuilder.includes("await enregistrerReglages.current?.()"), "et « Enregistrer » l'appelle");
  });
  /* ══════════════════════════════════════════════════════════════════════
   * LES DEUX IDENTITÉS EXCLUSIVES, DANS UN MÊME LOT
   * ══════════════════════════════════════════════════════════════════════ */

  await test("20. MÉLANGE DES DEUX IDENTITÉS — banque et nom normalisé dans les mêmes requêtes", async () => {
    /* Le schéma porte deux index uniques PARTIELS, un par identité. Un lot qui
       mélange les deux doit rester à deux requêtes : c'est possible parce que
       l'upsert vise la CLÉ PRIMAIRE et l'insert ne vise rien du tout. Un
       `onConflict` sur l'une des deux identités aurait obligé à séparer les
       chemins — et se serait trompé une fois sur deux. */
    const tampon = new Map<string, { exercice: ExercicePourReglage; progressionActive: boolean }>();
    const identifiants = new Map<string, string>();
    const attendus: { banque: number; nom: number } = { banque: 0, nom: 0 };
    for (let i = 0; i < 20; i += 1) {
      // Un exercice sur deux vient de la banque, l'autre est en texte libre.
      const exercice: ExercicePourReglage =
        i % 2 === 0 ? { name: `Exercice ${i}`, libraryExerciseId: `lib-${i}` } : { name: `Exercice Libre ${i}` };
      if (i % 2 === 0) attendus.banque += 1;
      else attendus.nom += 1;
      const cle = cleReglageDeLExercice(exercice);
      assert.ok(cle);
      tampon.set(cle, { exercice, progressionActive: i % 3 !== 0 });
      // Un tiers des lignes existe déjà : les deux lots sont peuplés des DEUX
      // identités, ce qui est le cas que ce test veut vraiment couvrir.
      if (i % 3 === 0) identifiants.set(cle, `ligne-${i}`);
    }
    const lots = lotsDEcriture(PROGRAMME, tampon, identifiants as IdentifiantsReglages);
    const faux = creerClientFactice();
    const r = await setProgressionReglagesEnLot(faux.client, lots);
    assert.ok(r.ok);
    assert.equal(faux.requetes, 2, "deux requêtes, identités mélangées comprises");
    let parBanque = 0;
    let parNom = 0;
    for (const appel of faux.appels) {
      for (const ligne of appel.lignes) {
        const b = ligne.exercise_library_id !== null;
        const n = ligne.exercise_name_normalized !== null;
        assert.ok(b !== n, "exactement une identité par ligne, jamais les deux");
        if (b) parBanque += 1;
        else parNom += 1;
      }
    }
    assert.equal(parBanque, attendus.banque, "toutes les identités de banque sont écrites");
    assert.equal(parNom, attendus.nom, "et tous les noms normalisés aussi");
    // Les deux lots contiennent bien un mélange, sinon le test ne prouverait rien.
    const upsert = faux.appels.find((x) => x.operation === "upsert");
    const insert = faux.appels.find((x) => x.operation === "insert");
    assert.ok(upsert && insert);
    for (const appel of [upsert, insert]) {
      const genres = new Set(appel.lignes.map((l) => (l.exercise_library_id !== null ? "banque" : "nom")));
      assert.equal(genres.size, 2, "chaque lot porte les deux identités");
    }
  });

  await test("21. DEUX EXERCICES DIFFÉRENTS gardent DEUX réglages différents", async () => {
    const squat: ExercicePourReglage = { name: "Squat", libraryExerciseId: "lib-squat" };
    const souleve: ExercicePourReglage = { name: "Soulevé de terre", libraryExerciseId: "lib-sdt" };
    const tampon = new Map([
      [cleReglageDeLExercice(squat)!, { exercice: squat, progressionActive: true }],
      [cleReglageDeLExercice(souleve)!, { exercice: souleve, progressionActive: false }],
    ]);
    const faux = creerClientFactice();
    await setProgressionReglagesEnLot(faux.client, lotsDEcriture(PROGRAMME, tampon, new Map()));
    assert.equal(faux.requetes, 1, "une seule requête pour les deux");
    const lignes = faux.appels[0].lignes;
    assert.equal(lignes.length, 2);
    const parId = new Map(lignes.map((l) => [l.exercise_library_id as string, l.progression_active]));
    assert.equal(parId.get("lib-squat"), true, "le squat reste ON");
    assert.equal(parId.get("lib-sdt"), false, "et le soulevé reste OFF");
    // Les clés ne se confondent pas : deux exercices, deux clés.
    assert.notEqual(cleReglageDeLExercice(squat), cleReglageDeLExercice(souleve));
  });

  /* ══════════════════════════════════════════════════════════════════════
   * OBJECTIF 2 — LE CLIC N'ÉMET AUCUNE REQUÊTE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("22. LE CLIC EST PUREMENT LOCAL — la persistance appartient à « Enregistrer »", () => {
    const codeToggle = sansCommentaires(sourceToggle);
    // Aucune minuterie : plus rien ne part « tout seul », à aucun moment.
    assert.ok(!/setTimeout\(|setInterval\(/.test(codeToggle), "aucune écriture programmée dans le temps");
    // `basculer` ne fait que de l'état local et un signal.
    const debut = codeToggle.indexOf("const basculer = useCallback");
    assert.ok(debut > 0);
    const corps = codeToggle.slice(debut, codeToggle.indexOf("[programId],", debut));
    for (const interdit of ["await ", "ecrire(", "enregistrerLesReglages", "setProgressionReglage"]) {
      assert.ok(!corps.includes(interdit), `le clic ne fait pas « ${interdit} »`);
    }
    assert.ok(corps.includes("enAttente.current.set("), "il dépose la bascule dans le tampon");
    assert.ok(corps.includes("signalerModification.current?.()"), "et signale « non enregistré »");
    // Plus aucun vidage au démontage : abandonner sans enregistrer ne persiste
    // rien, comme pour n'importe quel autre champ du builder.
    assert.ok(!codeToggle.includes("viderRef"), "aucun vidage au démontage");
    // Côté builder : la persistance part AVANT la structure, dans handleSave,
    // et derrière la garde de réentrance.
    const codeBuilder = sansCommentaires(sourceBuilder);
    const posGarde = codeBuilder.indexOf("executer(");
    const posReglages = codeBuilder.indexOf("await enregistrerReglages.current?.()");
    const posStructure = codeBuilder.indexOf("await onSave(");
    assert.ok(posReglages > 0, "« Enregistrer » persiste les réglages");
    assert.ok(posGarde < posReglages, "derrière la garde de réentrance");
    assert.ok(posReglages < posStructure, "et AVANT les 56 RPC de la structure");
    // Le toggle rend le programme « modifié », comme tout autre champ.
    assert.ok(codeBuilder.includes("onModificationLocale={marquerModifieParReglage}"), "le statut passe à « dirty »");
    assert.ok(codeBuilder.includes('setSaveStatus("dirty")'), "et c'est bien le même statut que les autres champs");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * OBJECTIF 4 — LE SCÉNARIO REPRÉSENTATIF, 8 SEMAINES ET 50 RÉGLAGES
   * ══════════════════════════════════════════════════════════════════════ */

  await test("23. MESURE — 8 semaines, 50 réglages : trois architectures comparées", async () => {
    /* ⚠️ CE QUI EST MESURÉ ET CE QUI EST MODÉLISÉ, SANS CONFUSION.
       MESURÉ : le nombre de requêtes émises par le chemin des réglages — les
       deux chemins sont réellement exécutés (l'ancien `setProgressionReglage`
       est toujours dans le module).
       MODÉLISÉ : la sauvegarde du programme elle-même (1 UPDATE + 2 SELECT +
       56 RPC + ~9 de refetch = 68 requêtes, dont 59 séquentielles), qu'aucun
       test ne peut exécuter sans base. Le modèle est un service SÉRIALISÉ :
       une requête à la fois, temps de service constant. C'est le modèle qui
       correspond à « les requêtes font la queue », et il ne prétend pas
       reproduire la seconde près le chiffre observé en production. */
    const SEMAINES = 8;
    const RPC = SEMAINES * 7; // une par séance : 56
    const REQUETES_SAUVEGARDE = 1 + 2 + RPC + 9; // 68
    assert.equal(REQUETES_SAUVEGARDE, 68, "le compte de l'audit est reproduit");

    // AVANT — une écriture par clic, réellement exécutée.
    const avant = await ecrireUnParUn(50, 0);
    // APRÈS — le lot, réellement exécuté.
    const apres = await ecrireGroupe(50, 25);

    const cheminCritiqueAvant = REQUETES_SAUVEGARDE + avant.requetes;
    const cheminCritiqueApres = REQUETES_SAUVEGARDE + apres.requetes;
    console.log(
      `     → réglages : ${avant.requetes} requêtes AVANT / ${apres.requetes} APRÈS` +
        ` — chemin critique de la sauvegarde : ${cheminCritiqueAvant} → ${cheminCritiqueApres} requêtes`,
    );
    assert.equal(avant.requetes, 100, "50 lignes neuves : 50 update à vide + 50 insert de repli");
    assert.equal(apres.requetes, 2);
    assert.ok(
      cheminCritiqueApres <= REQUETES_SAUVEGARDE + 2,
      "la sauvegarde avec 50 réglages coûte la sauvegarde normale + 2 requêtes",
    );
    // L'objectif du chantier, chiffré : revenir PRÈS du coût d'une sauvegarde
    // normale. 2 requêtes de plus sur 68, soit moins de 3 %.
    const surcout = (cheminCritiqueApres - REQUETES_SAUVEGARDE) / REQUETES_SAUVEGARDE;
    assert.ok(surcout < 0.03, `surcoût des réglages : ${(surcout * 100).toFixed(1)} %`);
    const surcoutAvant = (cheminCritiqueAvant - REQUETES_SAUVEGARDE) / REQUETES_SAUVEGARDE;
    assert.ok(surcoutAvant > 1, `surcoût d'avant : ${(surcoutAvant * 100).toFixed(0)} %`);
    console.log(
      `     → surcoût des réglages sur la sauvegarde : ${(surcoutAvant * 100).toFixed(0)} % → ` +
        `${(surcout * 100).toFixed(1)} %`,
    );
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
