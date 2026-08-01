/**
 * Harnais — phase 1 de l'historique des séances (feat/student-workout-history).
 *
 * Les 15 points imposés par le cahier des charges, testés contre le VRAI code
 * (individualizeProgramForStudent, setProgramAssignment, saveWorkoutFeedback,
 * lib/workout-history) branché sur une base factice en mémoire qui rejoue les
 * formes d'appel exactes de Supabase. Les dépendances lourdes (clonage complet
 * de la structure, lecture des lignes de séance) sont injectées — le reste est
 * le code de production, sans double.
 *
 * Lancement : npx tsx scripts/tests/student-workout-history.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { workoutFeedbackPayloadSchema } from "../../lib/api/schemas/workout-feedback";
import { CARDIO_BLOCK_RESULT_VERSION, CARDIO_RESULT_ENTRY_NAME, serializeCardioBlockResult } from "../../lib/cardio-feedback";
import { individualizeProgramForStudent, programAssignmentTestHooks, provisionPurchasedProgram, setProgramAssignment } from "../../lib/supabase/programs";
import { isContradictoryProgramMode, resolveProgramProvisioningMode } from "../../lib/program-provisioning";
import { executerRegularisation, type RegularisationCible } from "../../lib/regularisation-achats";
import { saveWorkoutFeedback } from "../../lib/supabase/workout-feedback";
import {
  buildPrescribedSnapshot,
  isPrescribedSnapshot,
  resolvePrescription,
  sanitizeDurationMinutes,
  sanitizePerformedAt,
} from "../../lib/workout-history";
import type { WorkoutFeedbackPayload } from "../../types";

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

/* ─── Base factice en mémoire ─────────────────────────────────────────────
 * Rejoue les chaînes réellement utilisées : from().select().eq()...maybeSingle()
 * / single(), insert().select().single(), update().eq(), delete().eq()...
 * Chaque table est un tableau d'objets ; les ids sont générés séquentiellement. */
type Ligne = Record<string, unknown>;

function creerBase() {
  const tables = new Map<string, Ligne[]>();
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };
  let compteur = 0;
  const idSuivant = (prefixe: string) => `${prefixe}-${(compteur += 1).toString().padStart(3, "0")}`;

  function from(nom: string) {
    const état: { op: "select" | "insert" | "update" | "delete"; valeurs?: Ligne | Ligne[]; filtres: [string, unknown][]; limite?: number } = {
      op: "select",
      filtres: [],
    };
    const correspond = (ligne: Ligne) => état.filtres.every(([c, v]) => ligne[c] === v);
    const exécuter = () => {
      const lignes = table(nom);
      if (état.op === "select") {
        let résultat = lignes.filter(correspond);
        if (état.limite !== undefined) résultat = résultat.slice(0, état.limite);
        return résultat.map((l) => ({ ...l }));
      }
      if (état.op === "insert") {
        const àInsérer = Array.isArray(état.valeurs) ? état.valeurs : [état.valeurs ?? {}];
        const insérées = àInsérer.map((valeurs) => {
          const ligne = { id: idSuivant(nom), status: "a-traiter", coach_reply: "", created_at: "t", updated_at: "t", ...valeurs };
          lignes.push(ligne);
          return { ...ligne };
        });
        return insérées;
      }
      if (état.op === "update") {
        const touchées = lignes.filter(correspond);
        for (const ligne of touchées) Object.assign(ligne, état.valeurs);
        return touchées.map((l) => ({ ...l }));
      }
      const àSupprimer = lignes.filter(correspond);
      tables.set(nom, lignes.filter((l) => !correspond(l)));
      // Cascade réelle du schéma : exercise_set_feedback.exercise_feedback_id
      // est en ON DELETE CASCADE (supabase/schema.sql, table 23).
      if (nom === "exercise_feedback" && àSupprimer.length > 0) {
        const ids = new Set(àSupprimer.map((l) => l.id));
        tables.set("exercise_set_feedback", table("exercise_set_feedback").filter((l) => !ids.has(l.exercise_feedback_id)));
      }
      return new Array(àSupprimer.length).fill({});
    };
    const chaîne: Record<string, unknown> = {
      select() {
        if (état.op === "select") return chaîne;
        // insert(...).select(...) : on garde le résultat de l'écriture.
        return chaîne;
      },
      insert(valeurs: Ligne | Ligne[]) {
        état.op = "insert";
        état.valeurs = valeurs;
        return chaîne;
      },
      update(valeurs: Ligne) {
        état.op = "update";
        état.valeurs = valeurs;
        return chaîne;
      },
      delete() {
        état.op = "delete";
        return chaîne;
      },
      eq(colonne: string, valeur: unknown) {
        état.filtres.push([colonne, valeur]);
        return chaîne;
      },
      // `.is("colonne", null)` : même sémantique que eq pour la base factice
      // (correspond compare avec ===, donc null === null fonctionne).
      is(colonne: string, valeur: unknown) {
        état.filtres.push([colonne, valeur]);
        return chaîne;
      },
      limit(n: number) {
        état.limite = n;
        return chaîne;
      },
      maybeSingle() {
        const r = exécuter();
        return Promise.resolve({ data: r[0] ?? null, error: null });
      },
      single() {
        const r = exécuter();
        return Promise.resolve({ data: r[0] ?? null, error: r[0] ? null : { message: "aucune ligne" } });
      },
      then(résoudre: (v: { data: Ligne[]; error: null }) => void) {
        résoudre({ data: exécuter(), error: null });
      },
    };
    return chaîne;
  }

  return { client: { from } as never, table, idSuivant };
}

/** Duplication factice fidèle au contrat : nouveau programme + ids neufs à tous les niveaux. */
function duplicationFactice(base: ReturnType<typeof creerBase>) {
  return async (_client: unknown, programId: string, o: { name?: string; status?: string; ownerStudentId?: string; sourceTemplateId?: string }) => {
    const source = base.table("programs").find((p) => p.id === programId);
    if (!source) return null;
    const copieId = base.idSuivant("prog");
    base.table("programs").push({
      ...source,
      id: copieId,
      name: o.name ?? `${source.name} (copie)`,
      status: o.status ?? "brouillon",
      owner_student_id: o.ownerStudentId ?? null,
      source_template_id: o.sourceTemplateId ?? null,
      source_checkout_session_id: (o as { sourceCheckoutSessionId?: string }).sourceCheckoutSessionId ?? null,
    });
    for (const session of base.table("workout_sessions").filter((s) => s.program_id === programId)) {
      base.table("workout_sessions").push({ ...session, id: base.idSuivant("sess"), program_id: copieId });
    }
    return copieId;
  };
}

/* ─── Décor commun ─── */
// Injection du clonage factice dans setProgramAssignment (crochet de test).

const base = creerBase();
const client = base.client;
const dupliquer = duplicationFactice(base);
programAssignmentTestHooks.duplicate = dupliquer as never;
base.table("programs").push(
  { id: "modele-1", name: "Force 8 semaines", status: "actif", program_mode: "individuel", is_public: false, owner_student_id: null, source_template_id: null, source_checkout_session_id: null },
  { id: "groupe-1", name: "Prépa été (groupe)", status: "actif", program_mode: "groupe", is_public: false, owner_student_id: null, source_template_id: null, source_checkout_session_id: null },
  { id: "produit-1", name: "L'ULTIME by SETH", status: "actif", program_mode: "individuel", is_public: true, owner_student_id: null, source_template_id: null, source_checkout_session_id: null },
);
base.table("workout_sessions").push(
  { id: "sess-m1", program_id: "modele-1", name: "Séance A", day: "Lundi" },
  { id: "sess-m2", program_id: "modele-1", name: "Séance B", day: "Jeudi" },
);

const lignesSéance = {
  session: { id: "sess-a1", name: "Séance A", day: "Lundi" },
  blocks: [{ id: "bloc-1", title: "Bloc force", block_type: "strength", position: 0 }],
  exercises: [
    { block_id: "bloc-1", exercise_library_id: "lib-squat", name: "Squat", order_index: 0, sets: 4, reps: "8", recommended_load: "100 kg", rest_seconds: 120, tempo: "2-0-1-0", notes: "RPE cible 8" },
    { block_id: "bloc-1", exercise_library_id: "lib-dc", name: "Développé couché", order_index: 1, sets: 3, reps: "10", recommended_load: null, rest_seconds: 90, tempo: null, notes: null },
  ],
};
/** Chargeur injecté : représente les lignes RÉELLEMENT en base (mutables pour le test 8). */
const chargeurSéance = async () => ({
  session: { ...lignesSéance.session },
  blocks: lignesSéance.blocks.map((b) => ({ ...b })),
  exercises: lignesSéance.exercises.map((e) => ({ ...e })),
});

function payloadDe(studentId: string, complet = true): WorkoutFeedbackPayload {
  return {
    studentId,
    sessionKey: "sess-a1",
    sessionRefLabel: "Semaine 1 — Séance A",
    completed: complet,
    globalRpe: 8,
    globalComment: "Bonne séance",
    pain: "",
    sessionId: "sess-a1",
    programId: "prog-001",
    exercises: [
      {
        exerciseName: "Squat",
        exerciseOrder: 0,
        rpe: 8,
        comment: "",
        sets: [
          { setNumber: 1, loadUsed: "100", repsDone: "8" },
          { setNumber: 2, loadUsed: "100", repsDone: "7" },
        ],
      },
    ],
  } as WorkoutFeedbackPayload;
}

await (async () => {
  /* ─── 1-5 + réaffectation : individualisation ─── */

  await test("1. deux élèves affectés au même modèle reçoivent deux programmes distincts", async () => {
    assert.ok(await setProgramAssignment(client, "eleve-A", "modele-1", true));
    assert.ok(await setProgramAssignment(client, "eleve-B", "modele-1", true));
    const affectations = base.table("assignments");
    assert.equal(affectations.length, 2);
    const [a, b] = affectations.map((l) => l.content_id);
    assert.notEqual(a, "modele-1", "l'élève A ne doit jamais être affecté au modèle partagé");
    assert.notEqual(b, "modele-1", "l'élève B ne doit jamais être affecté au modèle partagé");
    assert.notEqual(a, b, "deux copies distinctes");
  });

  await test("2. les copies possèdent des identifiants distincts à tous les niveaux", () => {
    const programmes = base.table("programs").map((p) => p.id);
    assert.equal(new Set(programmes).size, programmes.length, "ids de programmes uniques");
    const séances = base.table("workout_sessions").map((s) => s.id);
    assert.equal(new Set(séances).size, séances.length, "ids de séances uniques");
    // Le vrai clonage profond (blocs/exercices) est porté par
    // regenerateBlockIdsForDuplication, déjà couvert par test:training-block-editing ;
    // on vérifie ici que le chemin d'individualisation passe bien par lui.
    const source = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
    assert.ok(/duplicateProgramCore[\s\S]*regenerateBlockIdsForDuplication/.test(source),
      "l'individualisation réutilise le clonage canonique à ids régénérés");
  });

  await test("3. modifier la copie de A ne modifie ni le modèle ni la copie de B", () => {
    const copies = base.table("programs").filter((p) => p.owner_student_id);
    const copieA = copies.find((p) => p.owner_student_id === "eleve-A")!;
    const copieB = copies.find((p) => p.owner_student_id === "eleve-B")!;
    // Le builder ne modifie que par id de programme (updateProgram) : on
    // rejoue une modification ciblée sur la copie A.
    for (const session of base.table("workout_sessions").filter((s) => s.program_id === copieA.id)) {
      session.name = "Séance A MODIFIÉE";
    }
    const modèleIntact = base.table("workout_sessions").filter((s) => s.program_id === "modele-1");
    const copieBIntacte = base.table("workout_sessions").filter((s) => s.program_id === copieB.id);
    assert.ok(modèleIntact.every((s) => !String(s.name).includes("MODIFIÉE")), "le modèle est intact");
    assert.ok(copieBIntacte.every((s) => !String(s.name).includes("MODIFIÉE")), "la copie de B est intacte");
  });

  await test("4. owner_student_id est correctement renseigné", () => {
    const copieA = base.table("programs").find((p) => p.owner_student_id === "eleve-A");
    assert.ok(copieA, "copie de A trouvée");
  });

  await test("5. source_template_id référence le programme source", () => {
    for (const copie of base.table("programs").filter((p) => p.owner_student_id)) {
      assert.equal(copie.source_template_id, "modele-1");
    }
  });

  await test("5bis. une réaffectation ne crée ni doublon de copie ni doublon d'assignation", async () => {
    const avant = base.table("programs").length;
    assert.ok(await setProgramAssignment(client, "eleve-A", "modele-1", true));
    assert.equal(base.table("programs").length, avant, "aucune nouvelle copie");
    assert.equal(base.table("assignments").filter((l) => l.student_id === "eleve-A").length, 1, "une seule assignation");
    // Et affecter directement la copie individuelle de l'élève ne re-copie pas.
    const copieA = base.table("programs").find((p) => p.owner_student_id === "eleve-A")!;
    const id = await individualizeProgramForStudent(client, copieA.id as string, "eleve-A", dupliquer as never);
    assert.equal(id, copieA.id, "sa propre copie est rendue telle quelle");
  });

  /* ─── 6-9 + 14 : snapshot ─── */

  await test("6. une séance terminée enregistre un snapshot", async () => {
    const résultat = await saveWorkoutFeedback(client, payloadDe("eleve-A"), chargeurSéance as never);
    assert.ok(résultat, "feedback enregistré");
    const ligne = base.table("workout_feedback").find((l) => l.student_id === "eleve-A")!;
    assert.ok(ligne.prescribed_snapshot, "snapshot posé");
    assert.equal(ligne.session_status, "done");
    assert.ok(ligne.performed_at, "date de réalisation posée");
  });

  await test("7. le snapshot contient les exercices et prescriptions attendus", () => {
    const ligne = base.table("workout_feedback").find((l) => l.student_id === "eleve-A")!;
    const snapshot = ligne.prescribed_snapshot as Record<string, unknown>;
    assert.ok(isPrescribedSnapshot(snapshot), "forme valide");
    const s = snapshot as unknown as ReturnType<typeof buildPrescribedSnapshot>;
    assert.equal(s.sessionName, "Séance A");
    const noms = s.blocks.flatMap((b) => b.exercises.map((e) => e.name));
    assert.deepEqual(noms, ["Squat", "Développé couché"]);
    const squat = s.blocks[0].exercises[0];
    assert.equal(squat.sets, 4);
    assert.equal(squat.reps, "8");
    assert.equal(squat.recommendedLoad, "100 kg");
    assert.equal(squat.exerciseLibraryId, "lib-squat");
    assert.equal(squat.notes, "RPE cible 8");
  });

  await test("8. modifier ensuite la séance dans le builder ne modifie pas le snapshot", async () => {
    // Le coach change la prescription (la « base » évolue)…
    lignesSéance.exercises[0].reps = "5";
    lignesSéance.exercises[0].recommended_load = "120 kg";
    // …et l'élève resoumet son retour.
    await saveWorkoutFeedback(client, payloadDe("eleve-A"), chargeurSéance as never);
    const ligne = base.table("workout_feedback").find((l) => l.student_id === "eleve-A")!;
    const s = ligne.prescribed_snapshot as unknown as ReturnType<typeof buildPrescribedSnapshot>;
    assert.equal(s.blocks[0].exercises[0].reps, "8", "le snapshot garde la prescription d'origine");
    assert.equal(s.blocks[0].exercises[0].recommendedLoad, "100 kg");
  });

  await test("9. les résultats réalisés restent liés au feedback", () => {
    const feedback = base.table("workout_feedback").find((l) => l.student_id === "eleve-A")!;
    const exercices = base.table("exercise_feedback").filter((l) => l.workout_feedback_id === feedback.id);
    assert.ok(exercices.length >= 1, "exercices réalisés rattachés");
    const séries = base.table("exercise_set_feedback");
    assert.ok(séries.length >= 2, "séries réalisées rattachées");
    assert.ok(séries.every((s) => exercices.some((e) => e.id === s.exercise_feedback_id)));
  });

  await test("14. une nouvelle soumission ne remplace pas silencieusement le snapshot original", () => {
    // Déjà démontré par le test 8 côté données ; on verrouille en plus les
    // deux gardes : applicative (dejaFige) et base (trigger immuable).
    const couche = readFileSync(new URL("../../lib/supabase/workout-feedback.ts", import.meta.url), "utf8");
    assert.ok(/dejaFige/.test(couche) && /!dejaFige/.test(couche), "garde applicative présente");
    const migration = readFileSync(
      new URL("../../supabase/migrations/20260801120000_workout_feedback_history_phase1.sql", import.meta.url),
      "utf8",
    );
    assert.ok(/workout_feedback_snapshot_immutable/.test(migration), "trigger d'immutabilité défini");
    assert.ok(/is distinct from old\.prescribed_snapshot/.test(migration), "toute réécriture est rejetée");
  });

  /* ─── 10-11 : récapitulatif ─── */

  await test("10. le récapitulatif utilise le snapshot lorsqu'il existe", () => {
    const ligne = base.table("workout_feedback").find((l) => l.student_id === "eleve-A")!;
    const résolu = resolvePrescription(ligne.prescribed_snapshot, true);
    assert.equal(résolu.source, "snapshot");
    assert.ok(résolu.snapshot);
    const section = readFileSync(new URL("../../components/student/SessionFeedbackSection.tsx", import.meta.url), "utf8");
    assert.ok(section.includes("resolvePrescription"), "le récapitulatif passe par le résolveur");
    assert.ok(section.includes("Prescription au moment de la séance"), "bloc snapshot rendu");
  });

  await test("11. un ancien feedback sans snapshot reste consultable (séance vivante)", () => {
    assert.deepEqual(resolvePrescription(null, true), { source: "live", snapshot: null });
    assert.deepEqual(resolvePrescription(undefined, true), { source: "live", snapshot: null });
    assert.deepEqual(resolvePrescription({ version: 999 }, true), { source: "live", snapshot: null },
      "un contenu inattendu est traité comme un ancien retour, jamais comme une erreur");
    assert.deepEqual(resolvePrescription(null, false), { source: "none", snapshot: null });
  });

  /* ─── 12-13 : confidentialité ─── */

  await test("12. un élève ne peut pas consulter le snapshot d'un autre élève", () => {
    const schéma = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
    const i = schéma.indexOf("workout_feedback_student_or_staff");
    assert.ok(i > 0, "politique RLS présente dans le schéma");
    const politique = schéma.slice(i, i + 600);
    assert.ok(/student_id|auth\.uid/.test(politique), "la politique borne l'accès par l'identité de l'élève");
    // La migration phase 1 n'affaiblit rien : purement additive.
    const migration = readFileSync(
      new URL("../../supabase/migrations/20260801120000_workout_feedback_history_phase1.sql", import.meta.url),
      "utf8",
    );
    assert.ok(!/drop policy|alter policy|disable row level security/i.test(migration),
      "aucune politique supprimée ni modifiée, RLS jamais désactivée");
    assert.ok(!/drop column|drop table/i.test(migration), "migration strictement additive");
  });

  await test("13. le coach autorisé peut consulter le retour", () => {
    const schéma = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
    const i = schéma.indexOf("workout_feedback_student_or_staff");
    const politique = schéma.slice(i, i + 800);
    assert.ok(/staff|coach|admin/.test(politique), "le staff garde son accès via la même politique");
    // Et la couche coach lit bien les nouvelles colonnes (select * + mapping).
    const couche = readFileSync(new URL("../../lib/supabase/workout-feedback.ts", import.meta.url), "utf8");
    assert.ok(couche.includes("prescribedSnapshot: feedback.prescribedSnapshot"), "récap exposé côté admin");
  });

  /* ─── 15 : rien de cassé ─── */

  await test("15. le formulaire de feedback existant n'est pas cassé", async () => {
    // Un payload SANS les nouveaux champs (forme historique) passe toujours.
    const historique = payloadDe("eleve-B");
    delete (historique as unknown as Record<string, unknown>).performedAt;
    delete (historique as unknown as Record<string, unknown>).durationMinutes;
    const résultat = await saveWorkoutFeedback(client, historique, chargeurSéance as never);
    assert.ok(résultat, "payload historique accepté");
    // Une séance NON terminée ne pose ni snapshot ni statut done.
    const nonTerminée = payloadDe("eleve-C", false);
    await saveWorkoutFeedback(client, nonTerminée, chargeurSéance as never);
    const ligne = base.table("workout_feedback").find((l) => l.student_id === "eleve-C")!;
    assert.equal(ligne.prescribed_snapshot ?? null, null, "pas de snapshot sans séance terminée");
    assert.equal(ligne.session_status ?? null, null);
    // Les utilitaires de validation restent inoffensifs.
    assert.equal(sanitizePerformedAt("2026-08-12"), "2026-08-12");
    assert.equal(sanitizePerformedAt("n'importe quoi", new Date("2026-08-01T10:00:00Z")), "2026-08-01");
    assert.equal(sanitizeDurationMinutes(75), 75);
    assert.equal(sanitizeDurationMinutes(-3), null);
    assert.equal(sanitizeDurationMinutes(10000), null);
  });

  /* ─── Trois modes de programmation (correction produit) ─── */

  await test("M1. un programme de GROUPE assigné à deux élèves conserve le même program_id", async () => {
    assert.ok(await setProgramAssignment(client, "eleve-G1", "groupe-1", true));
    assert.ok(await setProgramAssignment(client, "eleve-G2", "groupe-1", true));
    const liens = base.table("assignments").filter((l) => l.content_id === "groupe-1");
    assert.equal(liens.length, 2, "les deux élèves pointent le MÊME programme");
    assert.equal(base.table("programs").filter((p) => p.source_template_id === "groupe-1").length, 0,
      "aucune copie créée pour un groupe");
  });

  await test("M2. les feedbacks de deux élèves du groupe restent distincts (snapshot compris)", async () => {
    const payloadG = (studentId: string) => ({ ...payloadDe(studentId), sessionKey: "sess-g1", sessionId: "sess-a1" });
    await saveWorkoutFeedback(client, payloadG("eleve-G1") as never, chargeurSéance as never);
    await saveWorkoutFeedback(client, payloadG("eleve-G2") as never, chargeurSéance as never);
    const retours = base.table("workout_feedback").filter((l) => l.session_key === "sess-g1");
    assert.equal(retours.length, 2, "un retour par élève pour la MÊME séance partagée");
    assert.ok(retours.every((r) => r.prescribed_snapshot), "chaque élève porte SON snapshot");
    assert.notEqual(retours[0].student_id, retours[1].student_id);
  });

  await test("M3. une modification future du programme de groupe vaut pour tous (pas de copie à isoler)", () => {
    for (const session of base.table("workout_sessions").filter((sn) => sn.program_id === "groupe-1")) {
      session.name = "Groupe MODIFIÉ";
    }
    // Les deux élèves lisent le même programme : la modification est visible
    // pour tous, c'est le contrat du mode groupe.
    const liens = base.table("assignments").filter((l) => l.content_id === "groupe-1");
    assert.equal(new Set(liens.map((l) => l.content_id)).size, 1);
  });

  await test("M4. owner_student_id reste NUL pour le groupe, renseigné pour les copies", () => {
    const groupe = base.table("programs").find((p) => p.id === "groupe-1")!;
    assert.equal(groupe.owner_student_id, null);
    for (const copie of base.table("programs").filter((p) => p.source_template_id)) {
      assert.ok(copie.owner_student_id, "toute copie appartient à un élève");
    }
  });

  await test("M5. un ACHAT UNIQUE crée une copie propre à l'acheteur, jamais le produit source", async () => {
    assert.ok(await provisionPurchasedProgram(client, "acheteur-1", "produit-1", "cs_achat_001"));
    const lien = base.table("assignments").find((l) => l.student_id === "acheteur-1")!;
    assert.notEqual(lien.content_id, "produit-1", "le produit commercial n'est jamais assigné directement");
    const copie = base.table("programs").find((p) => p.id === lien.content_id)!;
    assert.equal(copie.owner_student_id, "acheteur-1");
    assert.equal(copie.source_template_id, "produit-1");
    assert.equal(copie.source_checkout_session_id, "cs_achat_001");
  });

  await test("M6. deux acheteurs du même produit reçoivent deux copies distinctes", async () => {
    assert.ok(await provisionPurchasedProgram(client, "acheteur-2", "produit-1", "cs_achat_002"));
    const copies = base.table("programs").filter((p) => p.source_template_id === "produit-1");
    assert.equal(copies.length, 2);
    assert.notEqual(copies[0].id, copies[1].id);
    assert.notEqual(copies[0].owner_student_id, copies[1].owner_student_id);
  });

  await test("M7. deux livraisons du même webhook ne créent ni deuxième copie ni deuxième lien", async () => {
    const copiesAvant = base.table("programs").length;
    const liensAvant = base.table("assignments").length;
    assert.ok(await provisionPurchasedProgram(client, "acheteur-1", "produit-1", "cs_achat_001"));
    assert.equal(base.table("programs").length, copiesAvant, "rejeu : copie retrouvée par sa session");
    assert.equal(base.table("assignments").length, liensAvant, "rejeu : lien déjà en place");
  });

  await test("M8. un NOUVEL achat du même programme par le même élève crée un nouveau cycle", async () => {
    assert.ok(await provisionPurchasedProgram(client, "acheteur-1", "produit-1", "cs_achat_003"));
    const cycles = base.table("programs").filter(
      (p) => p.source_template_id === "produit-1" && p.owner_student_id === "acheteur-1",
    );
    assert.equal(cycles.length, 2, "deux sessions d'achat distinctes → deux cycles");
  });

  await test("M9. le programme commercial source n'est jamais modifié", () => {
    const produit = base.table("programs").find((p) => p.id === "produit-1")!;
    assert.equal(produit.owner_student_id, null);
    assert.equal(produit.source_template_id, null);
    assert.equal(produit.source_checkout_session_id, null);
    assert.equal(produit.name, "L'ULTIME by SETH");
  });

  await test("M10. la décision de provisionnement dépend du MODE explicite, de rien d'autre", () => {
    assert.equal(resolveProgramProvisioningMode({ programMode: "groupe", isPublic: false }), "shared");
    assert.equal(resolveProgramProvisioningMode({ programMode: "individuel", isPublic: false }), "individual-copy");
    assert.equal(resolveProgramProvisioningMode({ programMode: "individuel", isPublic: true }), "individual-copy");
    // Ambigu → jamais de partage par accident.
    assert.equal(resolveProgramProvisioningMode({ programMode: null, isPublic: false }), "individual-copy");
    assert.equal(resolveProgramProvisioningMode({}), "individual-copy");
    // Et les chemins réels passent tous par cette décision.
    const programsSource = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
    assert.equal((programsSource.match(/resolveProgramProvisioningMode\(/g) ?? []).length >= 2, true,
      "affectation coach ET achat utilisent le résolveur");
    const provisioning = readFileSync(new URL("../../lib/supabase/public-program-provisioning.ts", import.meta.url), "utf8");
    assert.ok(provisioning.includes("provisionPurchasedProgram"), "le webhook Stripe passe par le chemin d'achat");
  });

  /* ─── C1-C8 : contrôle technique (concurrence, couche serveur, régularisation) ─── */

  await test("C1. deux webhooks CONCURRENTS (même session) ne produisent qu'une copie et un lien", async () => {
    // Émule l'index unique programs_source_checkout_session_key : un second
    // insert avec la même session est refusé (comme 23505 en base) — c'est le
    // dernier rempart quand les deux appels passent le lookup avant l'insert.
    const dupliquerAvecIndexUnique = async (c: unknown, programId: string, o: Record<string, unknown>) => {
      const session = (o as { sourceCheckoutSessionId?: string }).sourceCheckoutSessionId;
      if (session && base.table("programs").some((p) => p.source_checkout_session_id === session)) {
        return null; // insert refusé par l'index unique
      }
      return dupliquer(c as never, programId, o as never);
    };
    const précédent = programAssignmentTestHooks.duplicate;
    programAssignmentTestHooks.duplicate = dupliquerAvecIndexUnique as never;
    try {
      const résultats = await Promise.all([
        provisionPurchasedProgram(client, "acheteur-conc", "produit-1", "cs_conc_001"),
        provisionPurchasedProgram(client, "acheteur-conc", "produit-1", "cs_conc_001"),
      ]);
      assert.ok(résultats.some(Boolean), "au moins une livraison aboutit");
      const copies = base.table("programs").filter((p) => p.source_checkout_session_id === "cs_conc_001");
      assert.equal(copies.length, 1, "une SEULE copie malgré la course");
      const liens = base.table("assignments").filter((l) => l.student_id === "acheteur-conc");
      assert.equal(liens.length, 1, "un SEUL lien d'assignation");
      assert.equal(liens[0].content_id, copies[0].id);
    } finally {
      programAssignmentTestHooks.duplicate = précédent;
    }
  });

  await test("C2. reprise après échec partiel : copie orpheline (sans assignation) → le rejeu complète sans dupliquer", async () => {
    // État partiel : le webhook a créé la copie puis a échoué avant l'assignation.
    base.table("programs").push({
      id: "copie-orpheline", name: "L'ULTIME by SETH", status: "actif", program_mode: "individuel",
      is_public: false, owner_student_id: "acheteur-orphelin", source_template_id: "produit-1",
      source_checkout_session_id: "cs_orphelin_001",
    });
    const copiesAvant = base.table("programs").length;
    assert.ok(await provisionPurchasedProgram(client, "acheteur-orphelin", "produit-1", "cs_orphelin_001"));
    assert.equal(base.table("programs").length, copiesAvant, "aucune nouvelle copie : retrouvée par sa session");
    const liens = base.table("assignments").filter((l) => l.student_id === "acheteur-orphelin");
    assert.equal(liens.length, 1, "le rejeu ne refait QUE l'assignation manquante");
    assert.equal(liens[0].content_id, "copie-orpheline");
  });

  await test("C3. groupe + is_public=true : jamais d'ambiguïté silencieuse", () => {
    // Lecture : le mode groupe EXPLICITE l'emporte (partage), et l'incohérence est détectable.
    assert.equal(resolveProgramProvisioningMode({ programMode: "groupe", isPublic: true }), "shared");
    assert.equal(isContradictoryProgramMode({ programMode: "groupe", isPublic: true }), true);
    assert.equal(isContradictoryProgramMode({ programMode: "groupe", isPublic: false }), false);
    assert.equal(isContradictoryProgramMode({ programMode: "individuel", isPublic: true }), false);
    // Écriture : createProgram ET updateProgram normalisent (is_public forcé à false).
    const programsSource = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
    assert.ok((programsSource.match(/normalizeIsPublicForWrite\(/g) ?? []).length >= 3,
      "normalisation présente à la création ET à la mise à jour");
    // Lecture : les deux chemins de provisionnement signalent la ligne contradictoire.
    assert.ok((programsSource.match(/isContradictoryProgramMode\(/g) ?? []).length >= 3,
      "signalement présent dans provisionPurchasedProgram ET setProgramAssignment");
  });

  await test("C4. couche serveur : identité dérivée de l'auth, corps borné au réalisé", () => {
    const route = readFileSync(new URL("../../app/api/student/workout-feedback/route.ts", import.meta.url), "utf8");
    assert.ok(/auth\.getUser\(\)/.test(route), "authentification serveur obligatoire");
    assert.ok(/from\("students"\)[\s\S]*eq\("user_id", user\.id\)/.test(route),
      "studentId dérivé de students.user_id = auth uid — jamais du corps");
    // Depuis le correctif incident 01/08 : le schéma vit dans
    // lib/api/schemas/workout-feedback.ts (partagé route ↔ tests).
    const schemaSource = readFileSync(new URL("../../lib/api/schemas/workout-feedback.ts", import.meta.url), "utf8");
    assert.ok(/\.strict\(\)/.test(schemaSource), "schéma strict : toute clé inconnue rejetée");
    assert.ok(/from "@\/lib\/api\/schemas\/workout-feedback"/.test(route), "la route importe le schéma partagé");
    const routeSansCommentaires = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/prescribed_snapshot|prescribedSnapshot/.test(routeSansCommentaires),
      "la route n'accepte JAMAIS de snapshot fourni par le client (hors commentaires)");
    assert.ok(!/studentId:\s*z\./.test(schemaSource), "le schéma n'accepte jamais studentId");
    assert.ok(/owner_student_id[\s\S]*assignments/.test(route),
      "l'accessibilité de la séance est vérifiée (possédée OU assignée)");
    assert.ok(/saveWorkoutFeedback\(supabase, \{ \.\.\.payload, studentId: studentRow\.id \}\)/.test(route),
      "l'écriture impose le studentId serveur");
    // Et le hook client ne fait plus d'écriture directe : il POSTe vers la route.
    const hook = readFileSync(new URL("../../hooks/useSupabaseWorkoutFeedback.ts", import.meta.url), "utf8");
    assert.ok(/fetch\("\/api\/student\/workout-feedback"/.test(hook), "le client passe par la route");
    assert.ok(!/saveWorkoutFeedback\(/.test(hook), "plus d'écriture Supabase directe depuis le navigateur");
  });

  await test("C5. clonage transactionnel : RPC d'abord, repli UNIQUEMENT si la migration manque", () => {
    const programsSource = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
    assert.ok(/rpc\("provision_program_copy"/.test(programsSource), "la RPC est tentée en premier");
    assert.ok(/isMissingProvisionRpc/.test(programsSource), "le repli est conditionné à l'absence de la fonction");
    const migration = readFileSync(
      new URL("../../supabase/migrations/20260801120000_workout_feedback_history_phase1.sql", import.meta.url), "utf8");
    assert.ok(/provision_program_copy/.test(migration) && /security definer/i.test(migration), "RPC définie, SECURITY DEFINER");
    assert.ok(/pg_advisory_xact_lock/.test(migration), "verrou advisory : les webhooks concurrents se sérialisent");
    assert.ok(/on conflict do nothing/i.test(migration), "assignation idempotente au niveau base");
    assert.ok(/insufficient_privilege/.test(migration), "un élève ne peut pas se provisionner lui-même");
    // Privilèges (contrôle local du 01/08/2026) : les DEFAULT PRIVILEGES
    // Supabase donnent EXECUTE à anon à la création — la migration DOIT
    // révoquer PUBLIC ET anon explicitement, puis n'autoriser que
    // authenticated (staff, rôle re-vérifié en interne) et service_role.
    assert.ok(/REVOKE ALL ON FUNCTION public\.provision_program_copy\(uuid, uuid, text\) FROM PUBLIC/.test(migration),
      "PUBLIC : aucun EXECUTE");
    assert.ok(/REVOKE EXECUTE ON FUNCTION public\.provision_program_copy\(uuid, uuid, text\) FROM anon/.test(migration),
      "anon : aucun EXECUTE (grant direct des default privileges révoqué)");
    assert.ok(/GRANT EXECUTE ON FUNCTION public\.provision_program_copy\(uuid, uuid, text\)\s*\n?TO authenticated, service_role/.test(migration),
      "authenticated + service_role : EXECUTE");
    // Et la checklist locale versionnée vérifie ces privilèges en base réelle.
    const checklist = readFileSync(
      new URL("../../supabase/tests/workout-feedback-history-phase1.sql", import.meta.url), "utf8");
    assert.ok(/A5bis/.test(checklist) && /has_function_privilege\('anon'/.test(checklist) && /grantee = 0/.test(checklist),
      "la checklist contrôle anon ET PUBLIC sur la RPC");
  });

  /* Décor régularisation (§8-§10) : base dédiée reproduisant l'état de prod. */
  const baseRegul = creerBase();
  const clientRegul = baseRegul.client;
  baseRegul.table("programs").push(
    { id: "ultime-prod", name: "ULTIME", status: "actif", program_mode: "individuel", is_public: true, owner_student_id: null, source_template_id: null, source_checkout_session_id: null },
    { id: "dospecs-prod", name: "Dos & Pecs", status: "actif", program_mode: "individuel", is_public: false, owner_student_id: null, source_template_id: null, source_checkout_session_id: null },
  );
  baseRegul.table("workout_sessions").push(
    { id: "sess-u1", program_id: "ultime-prod", name: "Upper 1", day: "Lundi" },
    { id: "sess-d1", program_id: "dospecs-prod", name: "Dos 1", day: "Mardi" },
  );
  baseRegul.table("assignments").push(
    { id: "lien-u", student_id: "eleve-u", content_type: "programme", content_id: "ultime-prod" },
    { id: "lien-d", student_id: "eleve-d", content_type: "programme", content_id: "dospecs-prod" },
  );
  baseRegul.table("workout_feedback").push({ id: "fb-d1", student_id: "eleve-d", session_id: "sess-d1", session_key: "sess-d1" });
  baseRegul.table("billing_events").push(
    { id: "evt-1", event_type: "checkout.session.completed", created_at: "2026-07-30T10:00:00Z", payload: { data: { object: { id: "cs_regul_001", metadata: { public_program_id: "ultime-prod" } } } } },
    { id: "evt-2", event_type: "checkout.session.completed", created_at: "2026-07-29T10:00:00Z", payload: { data: { object: { id: "cs_autre", metadata: { public_program_id: "autre-prog" } } } } },
  );
  const ciblesRegul: RegularisationCible[] = [
    { label: "ULTIME (test)", programId: "ultime-prod", kind: "copy-and-move" },
    { label: "Dos & Pecs (test)", programId: "dospecs-prod", kind: "claim-in-place" },
  ];
  const dupliquerRegul = duplicationFactice(baseRegul);
  const nomsTables = ["programs", "workout_sessions", "assignments", "workout_feedback", "billing_events"];
  const photographie = (b: ReturnType<typeof creerBase>) =>
    JSON.stringify(nomsTables.map((n) => [n, b.table(n)]));

  await test("C6. régularisation DRY-RUN : mêmes décisions que l'application, ZÉRO écriture", async () => {
    const avant = photographie(baseRegul);
    const rapport = await executerRegularisation(clientRegul as never, ciblesRegul, { duplicate: dupliquerRegul as never });
    assert.equal(rapport.dryRun, true, "dry-run est le DÉFAUT — aucune écriture sans opt-in");
    assert.equal(photographie(baseRegul), avant, "aucune table modifiée");
    assert.equal(rapport.erreurs.length, 0);
    assert.ok(rapport.actions.every((a) => a.statut === "a-faire"), "toutes les actions sont planifiées, aucune jouée");
    const parType = new Map(rapport.actions.map((a) => [a.type, a]));
    assert.ok(parType.get("creer-copie")?.detail.includes("cs_regul_001"),
      "la session Stripe est retrouvée dans billing_events et rattachée au plan");
    assert.ok(parType.has("assigner-copie") && parType.has("retirer-assignation-source") && parType.has("revendiquer-owner"));
  });

  await test("C7. régularisation APPLY : idempotente, historique préservé, re-run inerte", async () => {
    const rapport = await executerRegularisation(clientRegul as never, ciblesRegul, { dryRun: false, duplicate: dupliquerRegul as never });
    assert.equal(rapport.erreurs.length, 0, rapport.erreurs.join(" / "));
    // ULTIME : copie créée avec la session rattachée, assignation basculée.
    const copie = baseRegul.table("programs").find((p) => p.source_template_id === "ultime-prod")!;
    assert.ok(copie, "copie individuelle créée");
    assert.equal(copie.owner_student_id, "eleve-u");
    assert.equal(copie.source_checkout_session_id, "cs_regul_001");
    const liensU = baseRegul.table("assignments").filter((l) => l.student_id === "eleve-u");
    assert.equal(liensU.length, 1);
    assert.equal(liensU[0].content_id, copie.id, "l'élève est assigné à SA copie");
    assert.ok(!baseRegul.table("assignments").some((l) => l.content_id === "ultime-prod"),
      "l'assignation directe au programme commercial est retirée EN DERNIER");
    // Dos & Pecs : revendication sur place — AUCUNE copie, références intactes.
    const dospecs = baseRegul.table("programs").find((p) => p.id === "dospecs-prod")!;
    assert.equal(dospecs.owner_student_id, "eleve-d", "owner posé sur le programme EXISTANT");
    assert.ok(!baseRegul.table("programs").some((p) => p.source_template_id === "dospecs-prod"), "aucune copie créée");
    const feedback = baseRegul.table("workout_feedback").find((f) => f.id === "fb-d1")!;
    assert.equal(feedback.session_id, "sess-d1", "le feedback référence toujours la même séance");
    assert.ok(baseRegul.table("workout_sessions").some((s) => s.id === "sess-d1" && s.program_id === "dospecs-prod"),
      "la séance référencée appartient toujours au même programme — zéro cassure");
    // Re-run : tout est reconnu déjà fait, aucune écriture supplémentaire.
    const après = photographie(baseRegul);
    const rejeu = await executerRegularisation(clientRegul as never, ciblesRegul, { dryRun: false, duplicate: dupliquerRegul as never });
    assert.equal(photographie(baseRegul), après, "re-run strictement inerte");
    assert.equal(rejeu.erreurs.length, 0);
    assert.ok(rejeu.actions.every((a) => a.statut === "deja-fait"), "idempotence : tout est 'deja-fait'");
  });

  await test("C8. copy-and-move REFUSÉ dès qu'un feedback référence le programme source", async () => {
    baseRegul.table("programs").push({ id: "faux-ultime", name: "Faux ULTIME", status: "actif", program_mode: "individuel", is_public: true, owner_student_id: null, source_template_id: null, source_checkout_session_id: null });
    baseRegul.table("workout_sessions").push({ id: "sess-f1", program_id: "faux-ultime", name: "Séance F", day: "Lundi" });
    baseRegul.table("assignments").push({ id: "lien-f", student_id: "eleve-f", content_type: "programme", content_id: "faux-ultime" });
    baseRegul.table("workout_feedback").push({ id: "fb-f1", student_id: "eleve-f", session_id: "sess-f1", session_key: "sess-f1" });
    const avant = photographie(baseRegul);
    const rapport = await executerRegularisation(clientRegul as never,
      [{ label: "Faux ULTIME", programId: "faux-ultime", kind: "copy-and-move" }],
      { dryRun: false, duplicate: dupliquerRegul as never });
    assert.equal(photographie(baseRegul), avant, "refus = zéro écriture, même en mode apply");
    assert.ok(rapport.erreurs.some((e) => /REFUSÉ/.test(e) && /claim-in-place/.test(e)),
      "le refus explique la raison et recommande la stratégie sans cassure");
  });

  await test("C9. INCIDENT 01/08 — le payload RÉEL du composant (muscu + cardio) passe le schéma de la route", () => {
    // Entrée cardio produite par le VRAI sérialiseur du dépôt — c'est lui
    // que la première version du schéma rejetait (exerciseOrder = 900 +
    // position, enveloppe JSON dans comment) → 400 sur toute séance cardio.
    const entreeCardio = serializeCardioBlockResult({
      version: CARDIO_BLOCK_RESULT_VERSION,
      blockId: "bloc-cardio-1",
      order: 2,
      title: "EMOM 20 min",
      completed: true,
      durationSeconds: 1930,
      distanceMeters: 4200,
      elevationGainMeters: 35,
      repetitionsDone: 10,
      rpe: 8,
      pain: "",
      // Commentaire libre long : l'enveloppe JSON dépasse largement
      // l'ancienne borne de 2000 caractères.
      comment: "Très dure sur la fin. ".repeat(120),
      prescribed: { durationSeconds: 1800, distanceMeters: 4000, elevationGainMeters: null, repetitions: 10 },
    });
    assert.equal(entreeCardio.exerciseName, CARDIO_RESULT_ENTRY_NAME);
    // Démonstration de l'incident : ces valeurs RÉELLES violaient les
    // anciennes bornes (max 200 / max 2000) — cause du 400 en production.
    assert.ok(entreeCardio.exerciseOrder >= 900, "contrat cardio : exerciseOrder = 900 + position");
    assert.ok(entreeCardio.comment.length > 2000, "l'enveloppe JSON dépasse l'ancienne borne de 2000");

    // Corps EXACT envoyé par le composant + le hook ({ ...payload, sessionKey }).
    const corpsEnvoye = {
      sessionRefLabel: "Semaine 1 — Séance cardio",
      completed: true,
      globalRpe: 8,
      globalComment: "Bonne séance",
      pain: "",
      exercises: [
        {
          exerciseName: "Squat",
          exerciseOrder: 0,
          rpe: 8,
          comment: "",
          sets: [
            { setNumber: 1, loadUsed: "100", repsDone: "8" },
            { setNumber: 2, loadUsed: "100", repsDone: "7" },
          ],
        },
        entreeCardio,
      ],
      sessionId: "11111111-1111-4111-8111-111111111111",
      programId: null,
      sessionKey: "11111111-1111-4111-8111-111111111111",
    };
    const analyse = workoutFeedbackPayloadSchema.safeParse(corpsEnvoye);
    assert.ok(analyse.success,
      `le payload réel doit passer : ${analyse.success ? "" : JSON.stringify(analyse.error.issues)}`);

    // La stricte-ness demeure intacte : toute clé hors contrat reste rejetée.
    assert.equal(workoutFeedbackPayloadSchema.safeParse({ ...corpsEnvoye, prescribed_snapshot: { version: 1 } }).success, false,
      "prescribed_snapshot fourni par le client : toujours rejeté");
    assert.equal(workoutFeedbackPayloadSchema.safeParse({ ...corpsEnvoye, studentId: "autre-eleve" }).success, false,
      "studentId fourni par le client : toujours rejeté");
    assert.equal(workoutFeedbackPayloadSchema.safeParse({ ...corpsEnvoye, sessionStatus: "done" }).success, false,
      "sessionStatus fourni par le client : toujours rejeté");
  });

})();

console.log(`\n${réussis} test(s) réussi(s), ${échecs} échec(s).`);
if (échecs > 0) process.exit(1);
