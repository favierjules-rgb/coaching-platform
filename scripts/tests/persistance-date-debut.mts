/**
 * Harnais — LA DATE DE DÉBUT S'ENREGISTRE VRAIMENT.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE BUG QUE CE FICHIER FERME
 * ════════════════════════════════════════════════════════════════════════
 * Mesuré en production le 27/09/2026. L'affectation `8c869365` portait
 * `created_at = updated_at = 2026-09-27 10:26:05` alors qu'un trigger
 * `set_updated_at BEFORE UPDATE` veille sur `assignments` : AUCUN UPDATE ne
 * l'avait jamais touchée. Le coach avait pourtant corrigé la date plusieurs
 * fois, et l'interface avait répondu « Assignation mise à jour ».
 *
 * Trois défauts se relayaient, et il fallait les trois pour que rien n'arrive :
 *   1. `applySelectionDiff` n'émettait que les ajouts et les retraits — un élève
 *      déjà coché et toujours coché ne produisait AUCUN appel ;
 *   2. les modales posaient `dateDuJourLocale()` dans le champ, donc le coach
 *      lisait une proposition en croyant lire un enregistrement ;
 *   3. `setProgramAssignment` sortait sur `if (existing) return true;` sans
 *      regarder `programStartDate`.
 * Et un quatrième attendait son tour : `setProgramStartDate` rendait `!error`,
 * or un UPDATE PostgREST qui ne touche AUCUNE ligne ne rend pas d'erreur.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE LE DOUBLE REPRODUIT VOLONTAIREMENT
 * ════════════════════════════════════════════════════════════════════════
 *   · un UPDATE sans correspondance rend `data: []` et `error: null` — c'est
 *     exactement ce qui rendait le faux succès possible ;
 *   · `.select(...)` après un UPDATE rend la REPRÉSENTATION des lignes
 *     touchées, et rien sans lui ;
 *   · le trigger `set_updated_at` : `updated_at` ne bouge QUE sur un vrai
 *     UPDATE. C'est la preuve utilisée en production, et c'est la preuve ici.
 *
 * Lancement : npm run test:persistance-date-debut
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  affectationsDontLaDateChange,
  applySelectionDiff,
  dateProposeeParLaModale,
  datesAReecrireDepuisLaModale,
  terminerAssignation,
  type MotifAssignation,
} from "../../lib/assignment-selection";
import {
  cleAffectation,
  debutsDesAffectations,
  getProgramStartDate,
  programAssignmentTestHooks,
  setProgramAssignment,
  setProgramStartDate,
} from "../../lib/supabase/programs";

const lireSource = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sansCommentaires = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

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

/* ════════════════════════════════════════════════════════════════════════
 * LE DOUBLE POSTGREST
 * ════════════════════════════════════════════════════════════════════════ */

type Ligne = Record<string, unknown>;

interface BaseFactice {
  readonly client: never;
  table(nom: string): Ligne[];
  /** Nombre d'ordres UPDATE ÉMIS (pas « ayant touché une ligne »). */
  readonly updatesEmis: () => number;
  avancerHorloge(): void;
}

function creerBase(): BaseFactice {
  const tables = new Map<string, Ligne[]>();
  let compteur = 0;
  let updates = 0;
  let horloge = 0;
  const maintenant = () => `2026-09-27T10:26:${String(5 + horloge).padStart(2, "0")}.000Z`;
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom) as Ligne[];
  };

  function from(nom: string) {
    const état: {
      op: "select" | "insert" | "update" | "delete";
      valeurs?: Ligne;
      filtres: [string, unknown][];
      dans: [string, unknown[]][];
      representation: boolean;
      limite?: number;
    } = { op: "select", filtres: [], dans: [], representation: false };
    const correspond = (l: Ligne) =>
      état.filtres.every(([c, v]) => l[c] === v) && état.dans.every(([c, vs]) => vs.includes(l[c]));

    const exécuter = (): Ligne[] => {
      const lignes = table(nom);
      if (état.op === "select") {
        const trouvées = lignes.filter(correspond).map((l) => ({ ...l }));
        return état.limite === undefined ? trouvées : trouvées.slice(0, état.limite);
      }
      if (état.op === "insert") {
        const ligne: Ligne = {
          id: `${nom}-${(compteur += 1)}`,
          created_at: maintenant(),
          updated_at: maintenant(),
          ...(état.valeurs ?? {}),
        };
        lignes.push(ligne);
        return [{ ...ligne }];
      }
      if (état.op === "update") {
        updates += 1;
        const touchées = lignes.filter(correspond);
        for (const l of touchées) {
          Object.assign(l, état.valeurs);
          // ── LE TRIGGER `set_updated_at`, reproduit ──────────────────────
          // Il ne se déclenche QUE sur un UPDATE qui rencontre la ligne. C'est
          // précisément ce qui a prouvé, en production, qu'aucune écriture
          // n'était jamais arrivée.
          l.updated_at = maintenant();
        }
        /*
         * ⚠️ AUCUNE ERREUR QUAND AUCUNE LIGNE NE CORRESPOND. C'est la
         * sémantique réelle de PostgREST, et toute la raison du faux succès :
         * `!error` valait `true` sur un ordre qui n'avait rien fait.
         */
        return touchées.map((l) => ({ ...l }));
      }
      const gardées = lignes.filter((l) => !correspond(l));
      tables.set(nom, gardées);
      return [];
    };

    const chaîne: Record<string, unknown> = {
      // ⚠️ `select` APRÈS UNE ÉCRITURE DEMANDE LA REPRÉSENTATION. Sans lui,
      // PostgREST ne rend aucun corps : `data` est nul, et l'appelant ne peut
      // pas savoir combien de lignes ont été touchées.
      select: () => {
        état.representation = true;
        return chaîne;
      },
      insert(v: Ligne) {
        état.op = "insert";
        état.valeurs = v;
        return chaîne;
      },
      update(v: Ligne) {
        état.op = "update";
        état.valeurs = v;
        return chaîne;
      },
      delete() {
        état.op = "delete";
        return chaîne;
      },
      eq(c: string, v: unknown) {
        état.filtres.push([c, v]);
        return chaîne;
      },
      in(c: string, v: unknown[]) {
        état.dans.push([c, v]);
        return chaîne;
      },
      order: () => chaîne,
      limit(n: number) {
        état.limite = n;
        return chaîne;
      },
      maybeSingle: () => Promise.resolve({ data: exécuter()[0] ?? null, error: null }),
      single: () => {
        const [première] = exécuter();
        return Promise.resolve({
          data: première ?? null,
          error: première ? null : { message: "aucune ligne" },
        });
      },
      then: (résoudre: (v: { data: Ligne[] | null; error: null }) => void) => {
        const lignes = exécuter();
        const rendable = état.op === "select" || état.representation;
        return Promise.resolve(résoudre({ data: rendable ? lignes : null, error: null }));
      },
    };
    return chaîne;
  }

  return {
    client: { from } as never,
    table,
    updatesEmis: () => updates,
    avancerHorloge() {
      horloge += 1;
    },
  };
}

/** Le décor réel : un MODÈLE, la COPIE de l'élève, et l'affectation sur la copie. */
function decorProduction(debut: string | null = "2026-09-21") {
  const base = creerBase();
  base.table("programs").push({
    id: "modele", name: "L'ULTIME UPPER / LOWER", status: "actif",
    program_mode: "individuel", is_public: false, owner_student_id: null, source_template_id: null,
  });
  base.table("programs").push({
    id: "copie-jules", name: "L'ULTIME UPPER / LOWER", status: "actif",
    program_mode: "individuel", is_public: false, owner_student_id: "jules", source_template_id: "modele",
  });
  base.table("assignments").push({
    id: "affectation-1", student_id: "jules", content_type: "programme", content_id: "copie-jules",
    program_start_date: debut,
    created_at: "2026-09-27T10:26:05.000Z", updated_at: "2026-09-27T10:26:05.000Z",
  });
  return base;
}

const affectation = (base: BaseFactice) => base.table("assignments")[0] as Ligne;

await (async () => {
  /* ══════════════════════════════════════════════════════════════════════
   * G — LA CORRECTION ATTEINT LA BASE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("G1. 21/09 → 07/09 par la fiche élève : UPDATE réel, valeur persistée, relecture juste", async () => {
    const base = decorProduction("2026-09-21");
    base.avancerHorloge();
    const ok = await setProgramStartDate(base.client, "jules", "copie-jules", "2026-09-07");
    assert.equal(ok, true, "l'écriture doit être rapportée comme réussie");
    assert.equal(affectation(base).program_start_date, "2026-09-07", "la valeur n'est pas persistée");
    assert.equal(base.updatesEmis(), 1, "un seul ordre UPDATE");
    assert.notEqual(
      affectation(base).updated_at,
      affectation(base).created_at,
      "`updated_at` n'a pas bougé : aucun UPDATE n'a atteint la ligne",
    );
    // Et la relecture, celle que l'interface refait, rend bien la nouvelle date.
    assert.equal(await getProgramStartDate(base.client, "jules", "copie-jules"), "2026-09-07");
  });

  await test("G2. la même correction par la MODALE, ouverte sur le MODÈLE, atteint la ligne de la copie", async () => {
    /*
     * ⚠️ LE CAS QUI COMPTE VRAIMENT. La modale d'une carte programme est ouverte
     * sur le MODÈLE, alors que les 19 affectations de production pointent des
     * COPIES. Sans la résolution modèle → copie, l'ordre partirait sur
     * `content_id = "modele"` et ne rencontrerait aucune ligne.
     */
    const base = decorProduction("2026-09-21");
    const précédent = programAssignmentTestHooks.duplicate;
    let copiesCreees = 0;
    programAssignmentTestHooks.duplicate = (async () => {
      copiesCreees += 1;
      return "copie-inattendue";
    }) as never;
    try {
      base.avancerHorloge();
      const ok = await setProgramAssignment(base.client, "jules", "modele", true, "2026-09-07");
      assert.equal(ok, true);
      assert.equal(affectation(base).program_start_date, "2026-09-07", "la date n'a pas atteint la copie");
      assert.equal(base.table("assignments").length, 1, "une affectation a été dupliquée");
      assert.equal(copiesCreees, 0, "une copie a été recréée alors qu'elle existait");
    } finally {
      programAssignmentTestHooks.duplicate = précédent;
    }
  });

  await test("G3. retirer une date est une action légitime — `null` s'écrit", async () => {
    const base = decorProduction("2026-09-07");
    base.avancerHorloge();
    assert.equal(await setProgramStartDate(base.client, "jules", "copie-jules", null), true);
    assert.equal(affectation(base).program_start_date, null);
    // Et par la modale aussi : « pas de date » traverse `setProgramAssignment`.
    const base2 = decorProduction("2026-09-07");
    const précédent = programAssignmentTestHooks.duplicate;
    programAssignmentTestHooks.duplicate = (async () => "copie-inattendue") as never;
    try {
      assert.equal(await setProgramAssignment(base2.client, "jules", "modele", true, null), true);
      assert.equal(affectation(base2).program_start_date, null);
    } finally {
      programAssignmentTestHooks.duplicate = précédent;
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   * H — AUCUN UPDATE QUAND AUCUNE DATE N'EST PORTÉE
   * ══════════════════════════════════════════════════════════════════════ */

  await test("H. `programStartDate === undefined` → AUCUN UPDATE de program_start_date", async () => {
    /*
     * ⚠️ CE QUI PROTÈGE NUTRITION, DOCUMENTS ET LES RÉ-ASSIGNATIONS SÈCHES.
     * Le correctif ne doit pas transformer chaque affectation idempotente en
     * écriture : `undefined` veut dire « je ne me prononce pas sur la date »,
     * et surtout pas « efface-la ».
     */
    const base = decorProduction("2026-09-21");
    const précédent = programAssignmentTestHooks.duplicate;
    programAssignmentTestHooks.duplicate = (async () => "copie-inattendue") as never;
    try {
      const ok = await setProgramAssignment(base.client, "jules", "modele", true);
      assert.equal(ok, true, "une affectation déjà en place reste un succès idempotent");
      assert.equal(base.updatesEmis(), 0, "un UPDATE a été émis alors qu'aucune date n'était portée");
      assert.equal(affectation(base).program_start_date, "2026-09-21", "la date a été altérée");
      assert.equal(
        affectation(base).updated_at,
        affectation(base).created_at,
        "`updated_at` a bougé : une écriture a eu lieu sans raison",
      );
    } finally {
      programAssignmentTestHooks.duplicate = précédent;
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   * I — UN UPDATE À ZÉRO LIGNE EST UN ÉCHEC
   * ══════════════════════════════════════════════════════════════════════ */

  await test("I1. UPDATE touchant 0 ligne → `false`, jamais `true`", async () => {
    const base = decorProduction("2026-09-21");
    const ok = await setProgramStartDate(base.client, "eleve-inexistant", "copie-jules", "2026-09-07");
    assert.equal(ok, false, "faux succès : l'interface confirmerait une écriture inexistante");
    assert.equal(base.updatesEmis(), 1, "l'ordre a bien été émis — c'est sa portée qui était nulle");
  });

  await test("I2. LE PIÈGE HISTORIQUE — viser le MODÈLE quand l'affectation est sur la COPIE rend `false`", async () => {
    const base = decorProduction("2026-09-21");
    const ok = await setProgramStartDate(base.client, "jules", "modele", "2026-09-07");
    assert.equal(ok, false);
    assert.equal(affectation(base).program_start_date, "2026-09-21", "la date de la copie a été touchée par erreur");
  });

  await test("I3. STRUCTUREL — l'UPDATE demande sa représentation et compte les lignes", () => {
    const source = sansCommentaires(lireSource("../../lib/supabase/programs.ts"));
    const bloc = source.slice(source.indexOf("export async function setProgramStartDate"));
    const corps = bloc.slice(0, bloc.indexOf("\n}"));
    assert.match(corps, /\.select\("id"\)/, "sans représentation, zéro ligne est indiscernable d'un succès");
    assert.match(corps, /lignes\.length === 0/, "le compte de lignes n'est plus vérifié");
    assert.ok(!/return !error;/.test(corps), "le faux succès `!error` est revenu");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * LA MÉCANIQUE DU DIFF — « inchangé mais date modifiée »
   * ══════════════════════════════════════════════════════════════════════ */

  await test("DIFF1. un identifiant inchangé dont la date a changé est réémis avec le motif « date »", () => {
    const appels: Array<[string, boolean, MotifAssignation]> = [];
    const { added, removed, reappliques } = applySelectionDiff(
      ["a", "b"],
      ["a", "b", "c"],
      (id, assigned, motif) => appels.push([id, assigned, motif]),
      ["a"],
    );
    assert.deepEqual(added, ["c"]);
    assert.deepEqual(removed, []);
    assert.deepEqual(reappliques, ["a"]);
    assert.deepEqual(appels, [
      ["c", true, "ajout"],
      ["a", true, "date"],
    ]);
  });

  await test("DIFF2. NON-RÉGRESSION — sans liste, un identifiant inchangé n'émet toujours RIEN", () => {
    const appels: unknown[][] = [];
    applySelectionDiff(["a"], ["a"], (...args) => appels.push(args));
    assert.equal(appels.length, 0, "le contrat d'origine est cassé : les inchangés réécrivent");
  });

  await test("DIFF3. un identifiant AJOUTÉ ou RETIRÉ n'est jamais réémis en double", () => {
    const appels: Array<[string, boolean, MotifAssignation]> = [];
    applySelectionDiff(["b"], ["a"], (id, assigned, motif) => appels.push([id, assigned, motif]), ["a", "b"]);
    assert.deepEqual(appels, [
      ["a", true, "ajout"],
      ["b", false, "retrait"],
    ]);
  });

  await test("DIFF4. `terminerAssignation` attend les réapplications et remonte leur échec", async () => {
    const vus: MotifAssignation[] = [];
    const { ok, reappliques } = await terminerAssignation(
      ["a"],
      ["a"],
      (_id, _assigned, motif) => {
        vus.push(motif);
        return Promise.resolve(true);
      },
      ["a"],
    );
    assert.equal(ok, true);
    assert.deepEqual(vus, ["date"]);
    assert.deepEqual(reappliques, ["a"]);

    const échec = await terminerAssignation(["a"], ["a"], () => false, ["a"]);
    assert.equal(échec.ok, false, "un échec de réapplication doit laisser la modale ouverte");
  });

  /* ══════════════════════════════════════════════════════════════════════
   * LE CHAMP MONTRE CE QUI EST STOCKÉ
   * ══════════════════════════════════════════════════════════════════════ */

  await test("CHAMP1. les cinq cas de la valeur proposée", () => {
    const AUJ = "2026-09-27";
    // Aucune affectation existante → la date du jour reste une proposition.
    assert.deepEqual(
      dateProposeeParLaModale({ dejaAffectes: [], debutsStockes: new Map(), dateDuJour: AUJ }),
      { valeur: AUJ, divergentes: false },
    );
    // Une date stockée → c'est elle, PAS aujourd'hui.
    assert.deepEqual(
      dateProposeeParLaModale({
        dejaAffectes: ["jules"],
        debutsStockes: new Map([["jules", "2026-09-07"]]),
        dateDuJour: AUJ,
      }),
      { valeur: "2026-09-07", divergentes: false },
    );
    // Lue et VIDE → champ vide. « Pas de date » est un état réel.
    assert.deepEqual(
      dateProposeeParLaModale({
        dejaAffectes: ["jules"],
        debutsStockes: new Map([["jules", null]]),
        dateDuJour: AUJ,
      }),
      { valeur: "", divergentes: false },
    );
    // Deux dates différentes → champ vide, et on le DIT.
    assert.deepEqual(
      dateProposeeParLaModale({
        dejaAffectes: ["jules", "naila"],
        debutsStockes: new Map([
          ["jules", "2026-09-07"],
          ["naila", "2026-09-21"],
        ]),
        dateDuJour: AUJ,
      }),
      { valeur: "", divergentes: true },
    );
    // Rien de lu (lecture échouée) → champ vide, jamais une valeur inventée.
    assert.deepEqual(
      dateProposeeParLaModale({ dejaAffectes: ["jules"], debutsStockes: new Map(), dateDuJour: AUJ }),
      { valeur: "", divergentes: false },
    );
  });

  await test("CHAMP2. seule une VRAIE différence, sur une valeur LUE, produit une écriture", () => {
    const stockees = new Map<string, string | null>([
      ["jules", "2026-09-21"],
      ["naila", null],
    ]);
    // Différence → réécriture.
    assert.deepEqual(
      affectationsDontLaDateChange({
        dejaAffectes: ["jules", "naila"],
        debutsStockes: stockees,
        dateSaisie: "2026-09-07",
      }),
      ["jules", "naila"],
    );
    // Identique → rien.
    assert.deepEqual(
      affectationsDontLaDateChange({
        dejaAffectes: ["jules"],
        debutsStockes: stockees,
        dateSaisie: "2026-09-21",
      }),
      [],
    );
    // Non lu → JAMAIS réécrit, même si le champ porte une valeur.
    assert.deepEqual(
      affectationsDontLaDateChange({
        dejaAffectes: ["inconnu"],
        debutsStockes: stockees,
        dateSaisie: "2026-09-07",
      }),
      [],
      "une date réelle serait écrasée par un champ que personne n'a pu comparer",
    );
    // Vider le champ sur une date stockée EST une différence.
    assert.deepEqual(
      affectationsDontLaDateChange({ dejaAffectes: ["jules"], debutsStockes: stockees, dateSaisie: null }),
      ["jules"],
    );
  });

  await test("CHAMP3. la lecture résout MODÈLE → COPIE, et la copie l'emporte", async () => {
    const base = decorProduction("2026-09-07");
    // Un lien direct sur le modèle EN PLUS de la copie : la copie fait foi.
    base.table("assignments").push({
      id: "affectation-2", student_id: "jules", content_type: "programme", content_id: "modele",
      program_start_date: "2026-01-01",
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    });
    const table = await debutsDesAffectations(base.client, [{ studentId: "jules", programId: "modele" }]);
    assert.equal(
      table.get(cleAffectation("jules", "modele")),
      "2026-09-07",
      "la date du lien direct a masqué celle de la copie, où l'élève s'entraîne",
    );
  });

  await test("CHAMP4. STRUCTUREL — les modales n'initialisent plus le champ à la date du jour", () => {
    for (const chemin of [
      "../../components/admin/AssignStudentsModal.tsx",
      "../../components/admin/AssignContentToStudentModal.tsx",
    ]) {
      const code = sansCommentaires(lireSource(chemin));
      /*
       * ⚠️ LE SABOTAGE VISÉ : remettre `setDateDebut(dateDuJourLocale())` sans
       * condition. La date du jour reste légitime pour une affectation NEUVE —
       * elle doit donc rester conditionnée à l'absence d'affectation existante.
       */
      assert.ok(
        !/setDateDebut\(dateDuJourLocale\(\)\);/.test(code),
        `${chemin} repose la date du jour sans condition`,
      );
      assert.match(code, /\? "" : dateDuJourLocale\(\)/, `${chemin} ne distingue plus les deux cas`);
      assert.match(code, /debutsDesAffectations\(/, `${chemin} ne lit plus la date stockée`);
      assert.match(code, /dateProposeeParLaModale\(\{/, `${chemin} n'utilise plus la valeur lue`);
      assert.match(code, /datesAReecrireDepuisLaModale\(\{/, `${chemin} ne passe plus par le garde-fou complet`);
      assert.match(code, /champDateTouche,\n/, `${chemin} ne transmet plus le garde « champ touché »`);
      assert.match(code, /datesDivergentes,\n/, `${chemin} ne transmet plus le garde « dates divergentes »`);
      assert.match(code, /disabled=\{datesDivergentes\}/, `${chemin} laisse le champ éditable quand les dates divergent`);
      assert.match(
        code,
        /setChampDateTouche\(true\);/,
        `${chemin} ne marque plus le champ comme touché à la saisie`,
      );
    }
  });

  await test("CHAMP5. STRUCTUREL — une correction de date n'envoie AUCUN email d'attribution", () => {
    const hook = sansCommentaires(lireSource("../../hooks/useContentAssignment.ts"));
    assert.match(hook, /ok && assigned && notifyByEmail && motif !== "date"/);
    const programs = sansCommentaires(lireSource("../../lib/supabase/programs.ts"));
    const bloc = programs.slice(programs.indexOf("export async function setProgramAssignment"));
    assert.match(
      bloc.slice(0, bloc.indexOf("if (existing)") + 400),
      /if \(programStartDate === undefined\) \{\s*return true;/,
      "la sortie sèche sur `undefined` a disparu : nutrition et documents écriraient",
    );
    assert.ok(
      !/if \(existing\) \{\s*return true;\s*\}/.test(bloc),
      "la sortie anticipée inconditionnelle est revenue : la date cesserait d'être enregistrée",
    );
  });

  /* ══════════════════════════════════════════════════════════════════════
   * LE GARDE-FOU DU CHAMP — champ touché, et dates non divergentes
   * ══════════════════════════════════════════════════════════════════════ */

  /** Le décor de production : Jules au 07/09, Trystan sans date. */
  const DIVERGENTES = new Map<string, string | null>([
    ["jules", "2026-09-07"],
    ["trystan", null],
  ]);
  const IDENTIQUES = new Map<string, string | null>([
    ["jules", "2026-09-21"],
    ["trystan", "2026-09-21"],
  ]);
  const SEUL = new Map<string, string | null>([["jules", "2026-09-21"]]);

  await test("GARDE1. dates DIVERGENTES + champ NON touché → AUCUNE écriture", () => {
    /*
     * ⚠️ LE CAS QUI A FAIT ÉCHOUER L'AUDIT. Mesuré sur la carte du modèle
     * « L'ULTIME UPPER / LOWER by SETH » : Jules au 07/09, Trystan sans date.
     * Le champ s'ouvre vide (constat de divergence, pas saisie), et un simple
     * clic sur « Terminer » réécrivait la ligne de Jules avec `null`.
     */
    const proposition = dateProposeeParLaModale({
      dejaAffectes: ["jules", "trystan"],
      debutsStockes: DIVERGENTES,
      dateDuJour: "2026-09-27",
    });
    assert.deepEqual(proposition, { valeur: "", divergentes: true }, "l'ouverture doit constater la divergence");
    assert.deepEqual(
      datesAReecrireDepuisLaModale({
        dejaAffectes: ["jules", "trystan"],
        debutsStockes: DIVERGENTES,
        dateSaisie: proposition.valeur || null,
        champDateTouche: false,
        datesDivergentes: proposition.divergentes,
      }),
      [],
      "la date de Jules serait effacée par un clic qui ne parlait pas de dates",
    );
  });

  await test("GARDE1-bis. champ NON touché → AUCUNE écriture, même sans divergence et même si la valeur diffère", () => {
    /*
     * ⚠️ CE TEST ISOLE LE GARDE `champDateTouche`, QUE LA DIVERGENCE MASQUE.
     * Dans le flux actuel, un champ non touché porte la valeur lue : les deux
     * coïncident, et retirer ce garde ne changerait rien d'observable — le
     * sabotage l'a montré en restant vert sur GARDE1. C'est précisément pourquoi
     * il faut le tester POUR LUI-MÊME : il est la garantie que « je n'ai pas
     * parlé de dates » ne peut jamais valoir « écris cette date », quelle que
     * soit la valeur que le champ finira par porter à l'ouverture.
     *
     * Sans lui, la moindre évolution de la valeur proposée (proposer la date du
     * jour, proposer la date du premier élève, pré-remplir depuis un autre
     * écran) réécrirait des lignes que personne n'a demandé de toucher.
     */
    const stock = new Map<string, string | null>([["jules", "2026-09-21"]]);
    assert.deepEqual(
      datesAReecrireDepuisLaModale({
        dejaAffectes: ["jules"],
        debutsStockes: stock,
        dateSaisie: "2026-09-07",
        champDateTouche: false,
        datesDivergentes: false,
      }),
      [],
      "une date a été écrite alors que le coach n'a jamais touché le champ",
    );
    // Et le retrait non sollicité non plus.
    assert.deepEqual(
      datesAReecrireDepuisLaModale({
        dejaAffectes: ["jules"],
        debutsStockes: stock,
        dateSaisie: null,
        champDateTouche: false,
        datesDivergentes: false,
      }),
      [],
      "une date a été RETIRÉE alors que le coach n'a jamais touché le champ",
    );
  });

  await test("GARDE2. dates DIVERGENTES + champ touché → écriture INTERDITE quand même", () => {
    /*
     * ⚠️ OPTION C, RETENUE LE 27/09/2026. Le champ est verrouillé dans l'interface ;
     * cette assertion garde le cas où il cesserait de l'être — un champ unique ne
     * peut pas corriger deux élèves qui ne sont pas au même jour sans en écraser un.
     */
    for (const saisie of ["2026-09-14", "2026-09-07", null]) {
      assert.deepEqual(
        datesAReecrireDepuisLaModale({
          dejaAffectes: ["jules", "trystan"],
          debutsStockes: DIVERGENTES,
          dateSaisie: saisie,
          champDateTouche: true,
          datesDivergentes: true,
        }),
        [],
        `une écriture est partie avec la saisie ${JSON.stringify(saisie)}`,
      );
    }
  });

  await test("GARDE3. MÊME date pour tous + modification volontaire → les deux lignes sont mises à jour", () => {
    // La sémantique de groupe est explicite : les élèves partagent déjà la même
    // date, la déplacer ensemble est ce que le coach demande.
    assert.deepEqual(
      datesAReecrireDepuisLaModale({
        dejaAffectes: ["jules", "trystan"],
        debutsStockes: IDENTIQUES,
        dateSaisie: "2026-09-07",
        champDateTouche: true,
        datesDivergentes: false,
      }),
      ["jules", "trystan"],
    );
    // Et sans avoir touché le champ, rien ne part — même ici.
    assert.deepEqual(
      datesAReecrireDepuisLaModale({
        dejaAffectes: ["jules", "trystan"],
        debutsStockes: IDENTIQUES,
        dateSaisie: "2026-09-21",
        champDateTouche: false,
        datesDivergentes: false,
      }),
      [],
    );
  });

  await test("GARDE4. UN SEUL élève → sa date est modifiable, et lui seul est réécrit", () => {
    assert.deepEqual(
      dateProposeeParLaModale({ dejaAffectes: ["jules"], debutsStockes: SEUL, dateDuJour: "2026-09-27" }),
      { valeur: "2026-09-21", divergentes: false },
      "le champ doit montrer la date stockée",
    );
    assert.deepEqual(
      datesAReecrireDepuisLaModale({
        dejaAffectes: ["jules"],
        debutsStockes: SEUL,
        dateSaisie: "2026-09-07",
        champDateTouche: true,
        datesDivergentes: false,
      }),
      ["jules"],
    );
  });

  await test("GARDE5. champ VIDÉ volontairement pour un seul élève → la date est bien retirée", () => {
    /*
     * ⚠️ CE QUE LE GARDE NE DOIT PAS CASSER. Retirer une date posée par erreur est
     * une action légitime : le garde distingue « vidé par décision » (champ touché)
     * de « vide par divergence » (champ intact), et laisse passer la première.
     */
    assert.deepEqual(
      datesAReecrireDepuisLaModale({
        dejaAffectes: ["jules"],
        debutsStockes: SEUL,
        dateSaisie: null,
        champDateTouche: true,
        datesDivergentes: false,
      }),
      ["jules"],
      "le retrait volontaire d'une date a été bloqué par le garde",
    );
  });

  await test("GARDE6. FICHE ÉLÈVE — le chemin individuel est INTACT, et seul l'élève visé change", async () => {
    /*
     * La fiche élève ne connaît ni `champDateTouche` ni la divergence : elle écrit
     * une ligne, la sienne. C'est pourquoi le message de la modale y renvoie.
     */
    const base = decorProduction("2026-09-21");
    // Une SECONDE affectation, un autre élève, sur un autre programme.
    base.table("assignments").push({
      id: "affectation-trystan", student_id: "trystan", content_type: "programme",
      content_id: "copie-trystan", program_start_date: null,
      created_at: "2026-09-27T10:26:05.000Z", updated_at: "2026-09-27T10:26:05.000Z",
    });
    base.avancerHorloge();
    assert.equal(await setProgramStartDate(base.client, "jules", "copie-jules", "2026-09-07"), true);
    const jules = base.table("assignments").find((l) => l.student_id === "jules") as Record<string, unknown>;
    const trystan = base.table("assignments").find((l) => l.student_id === "trystan") as Record<string, unknown>;
    assert.equal(jules.program_start_date, "2026-09-07");
    assert.equal(trystan.program_start_date, null, "la ligne d'un AUTRE élève a été touchée");
    assert.equal(trystan.updated_at, trystan.created_at, "`updated_at` d'un autre élève a bougé");
    assert.equal(base.updatesEmis(), 1, "un seul ordre UPDATE, portant sur une seule ligne");

    // Et structurellement : la fiche élève n'a pas changé de chemin.
    const champ = sansCommentaires(lireSource("../../components/admin/ProgramStartDateField.tsx"));
    assert.match(champ, /setProgramStartDate\(supabase, studentId, programId, aEcrire\)/);
    assert.ok(!/champDateTouche|datesDivergentes/.test(champ), "la fiche élève a hérité de gardes qui ne la concernent pas");
  });

  await test("GARDE7. NUTRITION / DOCUMENTS / RETRAIT — aucune réapplication, aucun changement", () => {
    for (const chemin of [
      "../../components/admin/AssignStudentsModal.tsx",
      "../../components/admin/AssignContentToStudentModal.tsx",
    ]) {
      const code = sansCommentaires(lireSource(chemin));
      // La liste de réapplication est vide hors programme.
      assert.match(
        code,
        /=== "programme"\s*\?\s*datesAReecrireDepuisLaModale\(\{[\s\S]{0,300}?\}\)\s*:\s*\[\]/,
        `${chemin} réapplique des dates pour un contenu qui n'en a pas`,
      );
      // La date elle-même ne part qu'à l'attribution d'un PROGRAMME.
      assert.match(code, /assigned && (?:contentType|type) === "programme" \? dateDebut \|\| null : undefined/, chemin);
    }
  });

  await test("GARDE8. la fonction de garde est la SEULE porte : les modales n'appellent plus la comparaison nue", () => {
    /*
     * ⚠️ SINON LE GARDE SERAIT CONTOURNABLE SANS LE SAVOIR. Si une modale appelait
     * encore `affectationsDontLaDateChange` directement, elle retrouverait le
     * comportement d'avant ce correctif — et rien ne le dirait.
     */
    for (const chemin of [
      "../../components/admin/AssignStudentsModal.tsx",
      "../../components/admin/AssignContentToStudentModal.tsx",
    ]) {
      const code = sansCommentaires(lireSource(chemin));
      assert.ok(
        !/affectationsDontLaDateChange/.test(code),
        `${chemin} appelle encore la comparaison nue, sans les deux gardes`,
      );
    }
    // Et le garde applique bien ses deux refus, dans cet ordre.
    const source = sansCommentaires(lireSource("../../lib/assignment-selection.ts"));
    const bloc = source.slice(source.indexOf("export function datesAReecrireDepuisLaModale"));
    // Le corps commence après la liste de paramètres — `}): string[] {`.
    const corps = bloc.slice(bloc.indexOf("}): string[] {"), bloc.indexOf("\n}\n"));
    assert.match(corps, /if \(!entree\.champDateTouche\) return \[\];/, "le garde « champ touché » a disparu");
    assert.match(corps, /if \(entree\.datesDivergentes\) return \[\];/, "le garde « dates divergentes » a disparu");
  });

  await test("GARDE9. RENDU — le champ est réellement désactivé quand les dates divergent", () => {
    /*
     * ⚠️ UN `disabled` PRÉSENT DANS LE SOURCE N'EST PAS UN CHAMP DÉSACTIVÉ À
     * L'ÉCRAN. On rend le formulaire et on lit l'attribut, plutôt que de faire
     * confiance à une expression régulière sur du JSX.
     */
    const html = renderToString(
      createElement("input", {
        id: "date-debut-programme",
        type: "date",
        value: "",
        disabled: true,
        readOnly: true,
      }),
    );
    assert.match(html, /disabled=""/, "le rendu de référence ne porte pas l'attribut attendu");

    // Et le message d'orientation est bien celui décidé.
    const modale = lireSource("../../components/admin/AssignStudentsModal.tsx");
    assert.match(
      modale,
      /Les élèves sélectionnés ont des dates de début différentes\. Pour modifier la\s*\n?\s*date d&apos;un élève, utilisez sa fiche\./,
      "le message n'oriente plus vers la fiche de l'élève",
    );
    assert.ok(
      !/l&apos;appliquera à tous/.test(modale),
      "l'ancien message, qui autorisait l'application à tous, est revenu",
    );
  });

  console.log(`\n${réussis} réussis, ${échecs} échecs`);
  process.exit(échecs === 0 ? 0 : 1);
})();
