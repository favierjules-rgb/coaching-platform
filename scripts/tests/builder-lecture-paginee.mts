process.env.TZ = "Europe/Paris";

/**
 * Harnais — LECTURE PAGINÉE DU BUILDER DE PROGRAMME (incident du 25/08/2026).
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'INCIDENT, EN CHIFFRES MESURÉS EN PRODUCTION
 * ════════════════════════════════════════════════════════════════════════
 * Un exercice ajouté depuis la banque était correctement ÉCRIT en base,
 * l'enregistrement se déclarait réussi, et l'exercice disparaissait de
 * l'écran. Relevé du jour, base de production :
 *
 *     workout_exercises   1 224 lignes    ← 224 au-delà du plafond
 *     training_blocks       369 lignes
 *     workout_sessions      315 lignes
 *
 * L'exercice perdu était au rang physique 1044. PostgREST plafonne une
 * réponse à `max_rows` (1 000) et TRONQUE EN SILENCE — aucune erreur, rien à
 * journaliser. `loadPrograms` lisait `workout_exercises` sans borne.
 *
 * Les blocs passaient sous le plafond, les exercices non : d'où le symptôme
 * exact rapporté par le coach — le bloc survit, son contenu disparaît.
 *
 * ⚠️ ET C'ÉTAIT AUTO-AGGRAVANT. Le builder se remonte sur cette lecture, puis
 * la renvoie à `save_training_session_blocks`, dont la dernière étape
 * supprime tout ce qui n'est pas dans la charge. Les lignes seulement
 * INVISIBLES devenaient réellement DÉTRUITES à l'enregistrement suivant.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI AUCUN TEST NE L'AVAIT VU
 * ════════════════════════════════════════════════════════════════════════
 * Tous les harnais existants peuplent une poignée de lignes. Un plafond à
 * 1 000 est INVISIBLE en dessous de 1 000. Ce fichier est donc le seul du
 * dépôt qui franchit délibérément le plafond — c'est sa raison d'être, et
 * réduire ses volumes le rendrait décoratif.
 *
 * Lancement : npx tsx scripts/tests/builder-lecture-paginee.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getPrograms } from "../../lib/supabase/programs";

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

type Ligne = Record<string, unknown>;

/**
 * BASE FACTICE QUI PLAFONNE COMME POSTGREST.
 *
 * ⚠️ LE PLAFOND EST LE CŒUR DU HARNAIS. `max_rows` tronque la réponse SANS
 * erreur : `{ data: <1000 lignes>, error: null }`. Une base factice qui
 * rendrait tout ne pourrait pas reproduire l'incident, et ce fichier ne
 * prouverait rien.
 *
 * Elle sait aussi `.order()` et `.range()` — sans quoi le code paginé ne
 * pourrait pas s'exécuter du tout.
 */
function creerBasePlafonnee(plafond: number) {
  const tables = new Map<string, Ligne[]>();
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };
  /** Combien de requêtes chaque table a reçues — sert à prouver la pagination. */
  const requetes = new Map<string, number>();

  function from(nom: string) {
    const état: {
      filtres: [string, unknown][];
      tris: string[];
      plage: { debut: number; fin: number } | null;
    } = { filtres: [], tris: [], plage: null };

    const correspond = (l: Ligne) =>
      état.filtres.every(([c, v]) =>
        c.startsWith("__in__") ? (v as unknown[]).includes(l[c.slice(6)]) : l[c] === v,
      );

    const exécuter = () => {
      requetes.set(nom, (requetes.get(nom) ?? 0) + 1);
      let lignes = table(nom).filter(correspond);

      // Le tri demandé. ⚠️ SANS TRI EXPLICITE, ON MÉLANGE. PostgreSQL ne
      // garantit aucun ordre stable entre deux requêtes : une pagination sans
      // `.order()` saute et répète des lignes. La base factice reproduit donc
      // ce piège au lieu de le masquer — c'est ce qui rend le test 3 sévère.
      if (état.tris.length > 0) {
        const colonnes = état.tris;
        lignes = lignes
          .slice()
          .sort((a, b) =>
            colonnes.reduce(
              (ordre, c) => (ordre !== 0 ? ordre : String(a[c] ?? "").localeCompare(String(b[c] ?? ""))),
              0,
            ),
          );
      } else {
        lignes = melangerDeterministe(lignes);
      }

      const debut = état.plage?.debut ?? 0;
      // Le plafond s'applique APRÈS la plage, exactement comme PostgREST.
      const demandees = état.plage ? état.plage.fin - état.plage.debut + 1 : lignes.length;
      return lignes.slice(debut, debut + Math.min(demandees, plafond)).map((l) => ({ ...l }));
    };

    const chaîne: Record<string, unknown> = {
      select: () => chaîne,
      eq(c: string, v: unknown) {
        état.filtres.push([c, v]);
        return chaîne;
      },
      in(c: string, v: unknown[]) {
        état.filtres.push([`__in__${c}`, v]);
        return chaîne;
      },
      order(c: string) {
        état.tris.push(c);
        return chaîne;
      },
      range(debut: number, fin: number) {
        état.plage = { debut, fin };
        return chaîne;
      },
      limit: () => chaîne,
      then: (résoudre: (v: { data: Ligne[]; error: null }) => void) => résoudre({ data: exécuter(), error: null }),
    };
    return chaîne;
  }

  return { client: { from } as never, table, requetes };
}

/** Mélange stable et sans hasard : même entrée, même sortie, mais pas l'ordre d'insertion. */
function melangerDeterministe(lignes: Ligne[]): Ligne[] {
  const copie = lignes.slice();
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = (i * 7919 + 104729) % (i + 1);
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/** Identifiant trié lexicographiquement dans le même ordre que numériquement. */
const idNumerote = (prefixe: string, n: number) => `${prefixe}-${String(n).padStart(6, "0")}`;

/**
 * Un programme dont le contenu FRANCHIT le plafond, aux proportions réelles
 * de l'incident : beaucoup d'exercices, peu de blocs, peu de séances.
 */
function peuplerAuDelaDuPlafond(base: ReturnType<typeof creerBasePlafonnee>, nbExercices: number) {
  base.table("programs").push({
    id: "prog-1",
    name: "Programme volumineux",
    status: "actif",
    program_mode: "individuel",
    is_public: false,
    owner_student_id: null,
    source_template_id: null,
    created_at: "2026-01-01",
  });
  base.table("program_weeks").push({ id: "w-000001", program_id: "prog-1", week_number: 1 });

  const parSeance = 4;
  const nbSeances = Math.ceil(nbExercices / parSeance);
  for (let s = 0; s < nbSeances; s += 1) {
    const sessionId = idNumerote("s", s);
    base.table("workout_sessions").push({
      id: sessionId,
      program_id: "prog-1",
      program_week_id: "w-000001",
      day: "Lundi",
      name: `Séance ${s}`,
      updated_at: "t1",
      is_rest_day: false,
      session_type: "strength",
      order_index: s,
    });
    const blockId = idNumerote("b", s);
    base.table("training_blocks").push({
      id: blockId,
      session_id: sessionId,
      category: "strength",
      title: "Bloc musculation",
      color_key: "red",
      position: 0,
    });
    for (let e = 0; e < parSeance; e += 1) {
      const n = s * parSeance + e;
      if (n >= nbExercices) break;
      base.table("workout_exercises").push({
        id: idNumerote("e", n),
        session_id: sessionId,
        block_id: blockId,
        name: `Exercice ${n}`,
        sets: 3,
        reps: "8-10",
        rest_seconds: 60,
        tempo: "2-0-1-0",
        order_index: e,
      });
    }
  }
  return { nbSeances };
}

function compterExercices(programme: { sessions: { blocks?: { exercises?: unknown[] }[] }[] }): number {
  return programme.sessions.reduce(
    (total, s) => total + (s.blocks ?? []).reduce((t, b) => t + (b.exercises?.length ?? 0), 0),
    0,
  );
}

/* ═══════════════ 1-3. LA LECTURE EST COMPLÈTE AU-DELÀ DU PLAFOND ═══════════════ */

await test("1. 1 224 exercices — les chiffres EXACTS de l'incident — sont tous relus", async () => {
  const base = creerBasePlafonnee(1000);
  peuplerAuDelaDuPlafond(base, 1224);

  const programmes = await getPrograms(base.client);
  assert.equal(programmes.length, 1, "le programme est rendu");
  const lus = compterExercices(programmes[0] as never);
  assert.equal(
    lus,
    1224,
    `1 224 exercices attendus, ${lus} relus — ${1224 - lus} perdus par troncature silencieuse`,
  );
});

await test("2. l'exercice au rang 1044 — celui que le coach a perdu — est bien là", async () => {
  const base = creerBasePlafonnee(1000);
  peuplerAuDelaDuPlafond(base, 1224);

  const programmes = await getPrograms(base.client);
  const noms = (programmes[0] as never as { sessions: { blocks?: { exercises?: { name: string }[] }[] }[] }).sessions
    .flatMap((s) => s.blocks ?? [])
    .flatMap((b) => b.exercises ?? [])
    .map((e) => e.name);

  // Le rang 1044 de l'incident, et les bornes de part et d'autre du plafond.
  for (const rang of [999, 1000, 1001, 1044, 1223]) {
    assert.ok(noms.includes(`Exercice ${rang}`), `« Exercice ${rang} » manque — troncature au rang ${rang}`);
  }
  assert.equal(new Set(noms).size, noms.length, "aucun exercice n'est rendu deux fois par la pagination");
});

await test("3. la pagination émet PLUSIEURS requêtes, et pas une seule tronquée", async () => {
  const base = creerBasePlafonnee(1000);
  peuplerAuDelaDuPlafond(base, 1224);
  await getPrograms(base.client);

  // 1 224 lignes, plafond 1 000 → au moins deux pages, plus la page vide qui
  // clôt la boucle.
  const requetesExercices = base.requetes.get("workout_exercises") ?? 0;
  assert.ok(
    requetesExercices >= 2,
    `la lecture des exercices doit être paginée — ${requetesExercices} requête(s) émise(s)`,
  );
});

/* ═══════════════ 4-5. LES CAS LIMITES DE LA PAGINATION ═══════════════ */

await test("4. un serveur qui plafonne PLUS BAS que la page demandée ne perd rien", async () => {
  /*
   * ⚠️ LE PIÈGE QUE CE TEST GARDE. Une pagination qui avancerait de la TAILLE
   * DEMANDÉE (1 000) alors que le serveur n'en rend que 250 sauterait 750
   * lignes à chaque tour. Et une pagination qui s'arrêterait sur « lot plus
   * court que demandé » s'arrêterait dès la première page.
   *
   * La seule règle correcte est : avancer du nombre RÉELLEMENT reçu, et ne
   * s'arrêter que sur un lot VIDE. Ce test le vérifie sur un plafond
   * volontairement bas.
   */
  const base = creerBasePlafonnee(250);
  peuplerAuDelaDuPlafond(base, 1224);

  const programmes = await getPrograms(base.client);
  assert.equal(compterExercices(programmes[0] as never), 1224, "un plafond bas ne doit rien coûter");
});

await test("5. exactement le plafond, à une ligne près — les trois cas", async () => {
  for (const n of [999, 1000, 1001]) {
    const base = creerBasePlafonnee(1000);
    peuplerAuDelaDuPlafond(base, n);
    const programmes = await getPrograms(base.client);
    assert.equal(compterExercices(programmes[0] as never), n, `${n} exercices attendus`);
  }
});

/* ═══════════════ 6-7. LES GARDES QUI ONT MANQUÉ ═══════════════ */

await test("6. AUCUNE lecture non bornée ne subsiste sur ce chemin", async () => {
  const source = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
  const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // Les tables qui grandissent avec l'usage. Chacune DOIT être lue par la
  // boucle paginée — jamais par un `.select()` nu.
  for (const table of [
    "program_weeks",
    "workout_sessions",
    "workout_exercises",
    "training_blocks",
    "training_prescriptions",
  ]) {
    const appels = [...sansCommentaires.matchAll(new RegExp(`from\\("${table}"\\)[\\s\\S]{0,400}?(?=\\n\\s*\\n|;)`, "g"))].map(
      (m) => m[0],
    );
    assert.ok(appels.length > 0, `aucune lecture de ${table} trouvée`);
    for (const appel of appels) {
      // Une écriture (insert/update/delete) n'a pas à être paginée.
      if (/\.(insert|update|delete)\(/.test(appel)) continue;
      assert.ok(
        appel.includes(".range("),
        `lecture non bornée de ${table} — elle sera tronquée en silence :\n${appel.slice(0, 200)}`,
      );
      assert.ok(appel.includes(".order("), `lecture de ${table} sans tri — pagination instable`);
    }
  }
  assert.ok(sansCommentaires.includes("lireToutesLesLignes"), "le helper de pagination est utilisé");
});

await test("7. une lecture INCOMPLÈTE n'alimente jamais le builder", async () => {
  const source = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
  const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // C'est la garde qui empêche le pire enchaînement : rendre un programme
  // amputé, que le prochain enregistrement renverrait à la RPC, laquelle
  // supprime tout ce qui n'est pas dans la charge.
  assert.ok(sansCommentaires.includes("lecturesIncompletes"), "les lectures partielles sont recensées");
  assert.ok(
    /if \(lecturesIncompletes\.length > 0\) \{\s*throw new Error/.test(sansCommentaires),
    "une lecture partielle doit LEVER, jamais rendre un programme amputé",
  );

  // Et `complet` est réellement calculé par le helper, pas figé à true.
  assert.ok(
    sansCommentaires.includes("return { rows, complet: false };"),
    "le helper sait rendre une lecture incomplète",
  );
});

/* ═══════════════ 8-9. L'ENREGISTREMENT NE MENT PLUS ═══════════════ */

await test("8. updateProgram ne rend plus `true` sans regarder la structure", async () => {
  const source = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
  const bloc = source
    .slice(source.indexOf("export async function updateProgram"), source.indexOf("export async function deleteProgram"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // ⚠️ LA LIGNE EXACTE DE L'INCIDENT. Elle valait
  // `await diffProgramStructure(...);` suivie de `return true;` — le
  // compte-rendu était jeté et une séance sautée passait pour un succès.
  assert.ok(
    !/await diffProgramStructure\([^)]*\);\s*return true;/.test(bloc),
    "le résultat de diffProgramStructure ne doit plus être jeté",
  );
  assert.ok(bloc.includes("const bilan = await diffProgramStructure("), "le compte-rendu est recueilli");
  assert.ok(bloc.includes("if (!bilan.complet)"), "et il est regardé");
  assert.ok(bloc.includes("STRUCTURE_INCOMPLETE"), "un échec de structure porte un code distinct");
});

await test("9. une séance sautée est NOMMÉE, jamais tue", async () => {
  const source = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
  const bloc = source
    .slice(source.indexOf("async function diffProgramStructure"), source.indexOf("export async function updateProgram"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // Chaque saut de séance doit s'inscrire au compte-rendu. On compte les
  // `continue` qui abandonnent une séance et les `ignorees.push` en regard.
  const pousses = (bloc.match(/ignorees\.push\(/g) ?? []).length;
  assert.ok(pousses >= 6, `chaque abandon de séance doit être nommé — ${pousses} trouvé(s)`);
  assert.ok(bloc.includes("return { complet: ignorees.length === 0, ignorees };"), "le bilan est rendu");

  // Et le message utilisateur ne confond plus ce cas avec un problème de droits.
  const orchestrateur = readFileSync(new URL("../../lib/admin-builder-save.ts", import.meta.url), "utf8");
  assert.ok(
    orchestrateur.includes('message.startsWith("STRUCTURE_INCOMPLETE")'),
    "un échec de structure a son propre message",
  );
  const iStructure = orchestrateur.indexOf('startsWith("STRUCTURE_INCOMPLETE")');
  const iDroits = orchestrateur.indexOf("NOT_AUTHORIZED|42501|SAVE_FAILED");
  assert.ok(
    iStructure > -1 && iStructure < iDroits,
    "il doit être testé AVANT le message de droits, sinon il serait absorbé",
  );
  assert.ok(
    /n'enregistre pas par-dessus/i.test(orchestrateur),
    "et il doit dire au coach de NE PAS réenregistrer par-dessus",
  );
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
