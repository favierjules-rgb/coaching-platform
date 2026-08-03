/**
 * Harnais — fix/student-profile-content-assignment.
 *
 * Bug corrigé : la modale « Attribuer un contenu à [élève] » (fiche élève
 * admin) écrivait à CHAQUE clic et dérivait l'état coché de
 * student.assignedProgramIds — or depuis l'individualisation, l'assignation
 * d'un programme individuel vise la COPIE de l'élève, donc la case du
 * modèle ne se cochait jamais ; et la liste proposait le modèle ET sa copie
 * (même programme en double). Désormais : sélection LOCALE par type de
 * contenu, écritures uniquement au « Terminer » (diff), copies exclues de
 * la liste, coche = assignation ACTIVE vers le modèle ou vers la copie de
 * l'élève, fermeture sans écriture, aucun email déclenché.
 *
 * Lancement : npx tsx scripts/tests/student-content-assignment.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  filterAssignableProgramModels,
  initialContentSelection,
  isProgramCheckedForStudent,
  terminerAssignation,
  toggleStudentSelection,
  type ContentSelection,
} from "../../lib/assignment-selection";
import { CheckboxField } from "../../components/admin/AdminFormFields";
import { setNutritionAssignment } from "../../lib/supabase/nutrition";
import { setDocumentAssignment } from "../../lib/supabase/documents";

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

/** Retire les commentaires d'une source avant les gardes textuelles — les
 * commentaires qui DOCUMENTENT un anti-pattern ne doivent pas déclencher de
 * faux positif (pattern maison des suites précédentes). */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const sourceModale = readFileSync(new URL("../../components/admin/AssignContentToStudentModal.tsx", import.meta.url), "utf8");
const sourceModaleProgrammes = readFileSync(new URL("../../components/admin/AssignStudentsModal.tsx", import.meta.url), "utf8");
const sourceHook = readFileSync(new URL("../../hooks/useContentAssignment.ts", import.meta.url), "utf8");
const sourcePageEleve = readFileSync(new URL("../../app/admin/eleves/[studentId]/page.tsx", import.meta.url), "utf8");

/* ─── Base factice minimale (pattern de program-assignment-checkbox.mts,
   étendue avec update) ─── */
type Ligne = Record<string, unknown>;
function creerBase() {
  const tables = new Map<string, Ligne[]>();
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };
  let compteur = 0;
  function from(nom: string) {
    const état: {
      op: "select" | "insert" | "delete" | "update";
      valeurs?: Ligne;
      filtres: [string, unknown][];
      limite?: number;
    } = { op: "select", filtres: [] };
    const correspond = (l: Ligne) => état.filtres.every(([c, v]) => l[c] === v);
    const exécuter = () => {
      const lignes = table(nom);
      if (état.op === "select") {
        let r = lignes.filter(correspond);
        if (état.limite !== undefined) r = r.slice(0, état.limite);
        return r.map((l) => ({ ...l }));
      }
      if (état.op === "insert") {
        const ligne = { id: `${nom}-${(compteur += 1)}`, ...état.valeurs };
        lignes.push(ligne);
        return [{ ...ligne }];
      }
      if (état.op === "update") {
        const touchées = lignes.filter(correspond);
        for (const l of touchées) Object.assign(l, état.valeurs);
        return touchées.map((l) => ({ ...l }));
      }
      const gardées = lignes.filter((l) => !correspond(l));
      const supprimées = lignes.length - gardées.length;
      tables.set(nom, gardées);
      return new Array(supprimées).fill({});
    };
    const chaîne: Record<string, unknown> = {
      select: () => chaîne,
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
      order: () => chaîne,
      limit(n: number) {
        état.limite = n;
        return chaîne;
      },
      maybeSingle: () => Promise.resolve({ data: exécuter()[0] ?? null, error: null }),
      then: (résoudre: (v: { data: Ligne[]; error: null }) => void) => résoudre({ data: exécuter(), error: null }),
    };
    return chaîne;
  }
  return { client: { from } as never, table };
}

/* ─── Jeux de données ─── */
const élève = {
  id: "eleve-1",
  assignedProgramIds: [] as string[],
  assignedNutritionPlanIds: [] as string[],
  assignedDocumentIds: [] as string[],
};
const modèle = { id: "prog-modele", ownerStudentId: null, assignedStudentIds: [] as string[] };
const copie = { id: "prog-copie", ownerStudentId: "eleve-1", assignedStudentIds: ["eleve-1"] };

await (async () => {
  /* ─── A. Composition de la liste des programmes proposables ─── */

  await test("1. filterAssignableProgramModels exclut les copies, garde les modèles (null ET absent), sans muter", () => {
    // Programme MOCK : le champ ownerStudentId n'existe pas (optionnel).
    const mock: { id: string; ownerStudentId?: string | null; assignedStudentIds: string[] } = {
      id: "prog-mock",
      assignedStudentIds: [],
    };
    const entrée = [modèle, copie, mock];
    const résultat = filterAssignableProgramModels(entrée);
    assert.deepEqual(résultat.map((p) => p.id), ["prog-modele", "prog-mock"], "copie exclue, ordre préservé");
    assert.equal(entrée.length, 3, "l'entrée n'est jamais mutée");
  });

  await test("2. le doublon modèle + copie du même programme est réduit à la SEULE ligne du modèle", () => {
    const résultat = filterAssignableProgramModels([
      { id: "m1", ownerStudentId: null, name: "TEST CARDIO MUSCU NEW" },
      { id: "c1", ownerStudentId: "eleve-1", name: "TEST CARDIO MUSCU NEW" },
    ]);
    assert.equal(résultat.length, 1);
    assert.equal(résultat[0].id, "m1");
  });

  await test("3. modèle coché via une assignation active DIRECTE (assignments → modèle)", () => {
    assert.equal(
      isProgramCheckedForStudent(
        { id: "prog-modele", assignedStudentIds: [] },
        { id: "eleve-1", assignedProgramIds: ["prog-modele"] },
      ),
      true,
    );
  });

  await test("4. modèle coché via l'assignation active vers la COPIE de l'élève (fusion assignedStudentIds)", () => {
    // Chemin Supabase réel : loadPrograms fusionne dans assignedStudentIds
    // les propriétaires de copies à lien actif — l'assignation vit sur la
    // copie, PAS sur le modèle (student.assignedProgramIds = [id de copie]).
    assert.equal(
      isProgramCheckedForStudent(
        { id: "prog-modele", assignedStudentIds: ["eleve-1"] },
        { id: "eleve-1", assignedProgramIds: ["prog-copie"] },
      ),
      true,
    );
  });

  await test("5. copie conservée SANS lien actif (owner seul) : le modèle n'est PAS coché", () => {
    // Après désassignation la copie reste (owner_student_id + historique)
    // mais n'apparaît plus dans assignedStudentIds (filtre
    // keepCopiesWithActiveAssignment) ni dans assignedProgramIds.
    assert.equal(
      isProgramCheckedForStudent(
        { id: "prog-modele", assignedStudentIds: [] },
        { id: "eleve-1", assignedProgramIds: [] },
      ),
      false,
    );
  });

  await test("6. un id de COPIE dans assignedProgramIds ne coche jamais un AUTRE modèle", () => {
    assert.equal(
      isProgramCheckedForStudent(
        { id: "autre-modele", assignedStudentIds: [] },
        { id: "eleve-1", assignedProgramIds: ["prog-copie"] },
      ),
      false,
    );
  });

  /* ─── B. Sélection initiale de la modale ─── */

  await test("7. initialContentSelection : programme coché via le modèle actif, la copie n'entre JAMAIS dans la sélection", () => {
    const sélection = initialContentSelection(
      { ...élève, assignedProgramIds: ["prog-copie"] },
      {
        programs: [{ ...modèle, assignedStudentIds: ["eleve-1"] }, copie],
        nutritionPlanIds: [],
        documentIds: [],
      },
    );
    assert.deepEqual(sélection.programme, ["prog-modele"], "le MODÈLE est coché, pas la copie");
  });

  await test("8. nutrition et documents : intersection avec les listes AFFICHÉES (id assigné hors liste ignoré)", () => {
    const sélection = initialContentSelection(
      {
        ...élève,
        assignedNutritionPlanIds: ["plan-1", "plan-fantome"],
        assignedDocumentIds: ["doc-2"],
      },
      { programs: [], nutritionPlanIds: ["plan-1", "plan-2"], documentIds: ["doc-1", "doc-2"] },
    );
    assert.deepEqual(sélection.nutrition, ["plan-1"], "plan-fantome (non affiché) jamais dans le diff");
    assert.deepEqual(sélection.document, ["doc-2"]);
  });

  await test("9. élève sans aucune assignation → sélection initiale vide sur les trois types", () => {
    const sélection = initialContentSelection(élève, {
      programs: [modèle],
      nutritionPlanIds: ["plan-1"],
      documentIds: ["doc-1"],
    });
    assert.deepEqual(sélection, { programme: [], nutrition: [], document: [] });
  });

  await test("10. chemin mock : programmes sans ownerStudentId proposables, coche via assignedProgramIds", () => {
    const mock = { id: "prog-mock", assignedStudentIds: [] as string[] };
    const sélection = initialContentSelection(
      { ...élève, assignedProgramIds: ["prog-mock"] },
      { programs: [mock], nutritionPlanIds: [], documentIds: [] },
    );
    assert.deepEqual(sélection.programme, ["prog-mock"]);
  });

  /* ─── C. Comportement « Terminer » (sélection locale, diff, atomicité) ─── */

  await test("11. bascule locale immuable par type : les autres types restent intacts (+ rendu réel de la case)", () => {
    const avant: ContentSelection = { programme: ["prog-modele"], nutrition: ["plan-1"], document: [] };
    // Réplique exacte du `basculer` de la modale.
    const après: ContentSelection = { ...avant, document: toggleStudentSelection(avant.document, "doc-1", true) };
    assert.deepEqual(après.document, ["doc-1"]);
    assert.equal(après.programme, avant.programme, "référence programme inchangée");
    assert.equal(après.nutrition, avant.nutrition, "référence nutrition inchangée");
    assert.deepEqual(avant.document, [], "jamais de mutation");
    // La case rendue est un vrai <input type="checkbox"> dont l'état suit `checked`.
    const cochée = renderToString(createElement(CheckboxField, { label: "Doc", checked: true, onChange: () => {} }));
    const décochée = renderToString(createElement(CheckboxField, { label: "Doc", checked: false, onChange: () => {} }));
    assert.ok(cochée.includes('type="checkbox"') && cochée.includes("checked"), "case cochée rendue avec l'attribut checked");
    assert.ok(décochée.includes('type="checkbox"') && !décochée.includes("checked"), "case décochée rendue sans attribut checked");
  });

  await test("12. sélection inchangée → « Terminer » n'émet AUCUNE écriture (3 types)", async () => {
    const écritures: unknown[] = [];
    const initial: ContentSelection = { programme: ["prog-modele"], nutrition: ["plan-1"], document: [] };
    const résultats = await Promise.all(
      (["programme", "nutrition", "document"] as const).map((type) =>
        terminerAssignation(initial[type], initial[type], (contentId, assigned) => {
          écritures.push([type, contentId, assigned]);
          return true;
        }),
      ),
    );
    assert.deepEqual(écritures, [], "no-op strict — pas de ré-écriture des inchangés");
    assert.ok(résultats.every(({ ok }) => ok));
  });

  await test("13. diff multi-types : exactement les changements, avec les bons arguments", async () => {
    const écritures: Array<[string, string, boolean]> = [];
    const initial: ContentSelection = { programme: [], nutrition: ["plan-1"], document: ["doc-1"] };
    const sélection: ContentSelection = { programme: ["prog-modele"], nutrition: [], document: ["doc-1", "doc-2"] };
    const résultats = await Promise.all(
      (["programme", "nutrition", "document"] as const).map((type) =>
        terminerAssignation(initial[type], sélection[type], (contentId, assigned) => {
          écritures.push([type, contentId, assigned]);
          return true;
        }),
      ),
    );
    assert.deepEqual(
      écritures.sort(),
      [
        ["document", "doc-2", true],
        ["nutrition", "plan-1", false],
        ["programme", "prog-modele", true],
      ],
      "ajout programme + retrait nutrition + ajout document — et RIEN d'autre (doc-1 inchangé)",
    );
    assert.ok(résultats.every(({ ok }) => ok));
  });

  await test("14. une écriture qui rend false → échec global (les autres écritures partent quand même)", async () => {
    const écritures: string[] = [];
    const résultat = await terminerAssignation([], ["a", "b"], (id) => {
      écritures.push(id);
      return id !== "a";
    });
    assert.equal(résultat.ok, false);
    assert.deepEqual(écritures, ["a", "b"], "pas d'arrêt au premier échec — tout est tenté puis attendu");
  });

  await test("15. une promesse REJETÉE → ok:false, jamais d'exception non gérée", async () => {
    const résultat = await terminerAssignation([], ["a"], () => Promise.reject(new Error("réseau")));
    assert.equal(résultat.ok, false);
  });

  /* ─── D. Écritures réelles nutrition / documents (base factice) ─── */

  await test("16. setNutritionAssignment(true) pose student_id sur LE plan visé (source de vérité nutrition_plans)", async () => {
    const { client, table } = creerBase();
    table("nutrition_plans").push({ id: "plan-1", name: "Plan A", student_id: null }, { id: "plan-2", name: "Plan B", student_id: null });
    const ok = await setNutritionAssignment(client, "eleve-1", "plan-1", true);
    assert.equal(ok, true);
    assert.equal(table("nutrition_plans").find((p) => p.id === "plan-1")!.student_id, "eleve-1");
    assert.equal(table("nutrition_plans").find((p) => p.id === "plan-2")!.student_id, null, "l'autre plan n'est pas touché");
    assert.equal(table("activity_events").length, 1, "activité loggée à l'attribution");
  });

  await test("17. setNutritionAssignment(false) remet student_id à null (retrait), sans log d'activité", async () => {
    const { client, table } = creerBase();
    table("nutrition_plans").push({ id: "plan-1", name: "Plan A", student_id: "eleve-1" });
    const ok = await setNutritionAssignment(client, "eleve-1", "plan-1", false);
    assert.equal(ok, true);
    assert.equal(table("nutrition_plans")[0].student_id, null);
    assert.equal(table("activity_events").length, 0, "jamais d'événement au retrait");
  });

  await test("18. setDocumentAssignment : true crée la ligne document_assignments, false la supprime (ciblée)", async () => {
    const { client, table } = creerBase();
    table("documents").push({ id: "doc-1", title: "Guide" });
    table("document_assignments").push({ id: "da-autre", student_id: "eleve-2", document_id: "doc-1" });
    assert.equal(await setDocumentAssignment(client, "eleve-1", "doc-1", true), true);
    assert.equal(table("document_assignments").filter((l) => l.student_id === "eleve-1" && l.document_id === "doc-1").length, 1);
    assert.equal(await setDocumentAssignment(client, "eleve-1", "doc-1", false), true);
    assert.equal(table("document_assignments").filter((l) => l.student_id === "eleve-1").length, 0);
    assert.equal(table("document_assignments").filter((l) => l.student_id === "eleve-2").length, 1, "l'assignation d'un autre élève est préservée");
  });

  /* ─── E. Gardes structurelles sur les sources (sans commentaires) ─── */

  await test("19. modale fiche élève : sélection locale, copies filtrées, Terminer = seul point d'écriture, croix sans écriture", () => {
    const source = sansCommentaires(sourceModale);
    // Les onChange des cases ne déclenchent JAMAIS d'écriture directe.
    assert.ok(!/onChange=\{[^}]*onSetAssignment/.test(source), "aucun onSetAssignment dans un onChange");
    // L'état coché vient de la sélection LOCALE, plus jamais des props serveur.
    assert.ok(source.includes("checked={selection.programme.includes(p.id)}"));
    assert.ok(source.includes("checked={selection.nutrition.includes(p.id)}"));
    assert.ok(source.includes("checked={selection.document.includes(d.id)}"));
    assert.ok(!source.includes("student.assignedProgramIds.includes(p.id)"), "l'ancien checked dérivé des props a disparu");
    // Copies exclues de la liste proposable.
    assert.ok(source.includes("filterAssignableProgramModels(programs)"));
    assert.ok(source.includes("modeles.map((p)"), "la liste rendue est bien la liste filtrée");
    // « Terminer » : diff + attente de TOUTES les écritures + verrou + échec visible.
    assert.ok(source.includes("terminerAssignation(initial[type], selection[type]"));
    assert.ok(source.includes("if (saving) return;"));
    assert.ok(source.includes("setSaveFailed(true)"));
    assert.ok(source.includes("L&apos;enregistrement a échoué"));
    assert.ok(source.includes('{saving ? "Enregistrement…" : "Terminer"}'), "bouton verrouillé pendant l'enregistrement");
    // La fermeture n'écrit rien : close() ne touche que l'état local.
    const corpsClose = source.split("function close()")[1]?.split("}")[0] ?? "";
    assert.ok(!corpsClose.includes("onSetAssignment"), "fermer par la croix n'émet aucune écriture");
    // La sélection initiale est recalculée à CHAQUE ouverture.
    assert.ok(source.includes("initialContentSelection(student"));
  });

  await test("20. hook : email désactivable et coupé pour la fiche élève ; modale programmes intacte", () => {
    const hook = sansCommentaires(sourceHook);
    assert.ok(hook.includes("notifyByEmail?: boolean"), "option exposée");
    assert.ok(hook.includes("ok && assigned && notifyByEmail"), "email conditionné à l'option");
    const page = sansCommentaires(sourcePageEleve);
    assert.ok(page.includes("notifyByEmail: false"), "la fiche élève ne déclenche AUCUN email");
    // Non-régression : la modale « Assigner » de /admin/programmes garde son
    // pattern validé (sélection locale + terminerAssignation) — non cassée.
    const programmes = sansCommentaires(sourceModaleProgrammes);
    assert.ok(programmes.includes("terminerAssignation(assignedStudentIds, selection"));
    assert.ok(programmes.includes("toggleStudentSelection(prev, studentId, checked)"));
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
