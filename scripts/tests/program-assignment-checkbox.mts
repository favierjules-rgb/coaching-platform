/**
 * Harnais — fix/program-assignment-checkbox.
 *
 * Bug corrigé : la modale « Assigner » écrivait à CHAQUE clic et dérivait
 * l'état coché des assignations du programme MODÈLE ; depuis
 * l'individualisation, l'assignation d'un programme individuel vise la COPIE
 * de l'élève → la case ne se cochait jamais. Désormais : sélection LOCALE,
 * écritures uniquement au « Terminer », affichage incluant les copies.
 *
 * Lancement : npx tsx scripts/tests/program-assignment-checkbox.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { applySelectionDiff, keepCopiesWithActiveAssignment, mergeAssignedStudentIds, terminerAssignation, toggleStudentSelection } from "../../lib/assignment-selection";
import { StudentPickerList } from "../../components/admin/StudentPickerList";
import { programAssignmentTestHooks, setProgramAssignment } from "../../lib/supabase/programs";
import type { AdminStudent } from "../../types";

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

const gaelle = { id: "eleve-gaelle", firstName: "Gaelle", lastName: "Balouzat", email: "gaelle@example.test", status: "actif" } as unknown as AdminStudent;
const jules = { id: "eleve-jules", firstName: "Jules", lastName: "Favier", email: "jules@example.test", status: "actif" } as unknown as AdminStudent;

const sourceModale = readFileSync(new URL("../../components/admin/AssignStudentsModal.tsx", import.meta.url), "utf8");

/* ─── Base factice minimale (pattern de student-workout-history.mts) ─── */
type Ligne = Record<string, unknown>;
function creerBase() {
  const tables = new Map<string, Ligne[]>();
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };
  let compteur = 0;
  function from(nom: string) {
    const état: { op: "select" | "insert" | "delete"; valeurs?: Ligne; filtres: [string, unknown][]; limite?: number } = { op: "select", filtres: [] };
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
      delete() {
        état.op = "delete";
        return chaîne;
      },
      eq(c: string, v: unknown) {
        état.filtres.push([c, v]);
        return chaîne;
      },
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

await (async () => {
  await test("1. cliquer sur une checkbox sélectionne l'élève (mise à jour immuable)", () => {
    const avant: string[] = [];
    const après = toggleStudentSelection(avant, "eleve-gaelle", true);
    assert.deepEqual(après, ["eleve-gaelle"]);
    assert.notEqual(après, avant, "nouvelle référence — sinon React ne re-rend pas");
    assert.deepEqual(avant, [], "le tableau initial n'est JAMAIS muté");
  });

  await test("2. un second clic le désélectionne", () => {
    const cochée = toggleStudentSelection([], "eleve-gaelle", true);
    assert.deepEqual(toggleStudentSelection(cochée, "eleve-gaelle", false), []);
  });

  await test("3. sélectionner Gaelle ne sélectionne pas Jules (logique + rendu réel)", () => {
    const sélection = toggleStudentSelection([], "eleve-gaelle", true);
    assert.ok(!sélection.includes("eleve-jules"));
    // Rendu RÉEL de la liste : la case de Gaelle est cochée, pas celle de Jules.
    const html = renderToString(
      createElement(StudentPickerList, { students: [gaelle, jules], selectedIds: ["eleve-gaelle"], onToggle: () => {} }),
    );
    const ligneGaelle = html.split("<label").find((part) => part.includes("Gaelle"))!;
    const ligneJules = html.split("<label").find((part) => part.includes("Jules"))!;
    assert.ok(/checked/.test(ligneGaelle), "Gaelle cochée");
    assert.ok(!/checked/.test(ligneJules), "Jules non coché");
  });

  await test("4. deux élèves sélectionnables (mode groupe)", () => {
    let sélection = toggleStudentSelection([], "eleve-gaelle", true);
    sélection = toggleStudentSelection(sélection, "eleve-jules", true);
    assert.deepEqual(sélection, ["eleve-gaelle", "eleve-jules"]);
    // Idempotence : re-cocher un élève déjà coché ne le duplique pas.
    assert.deepEqual(toggleStudentSelection(sélection, "eleve-jules", true), sélection);
  });

  await test("5. « Terminer » reçoit exactement les identifiants sélectionnés (diff)", () => {
    const appels: Array<[string, boolean]> = [];
    const { added, removed } = applySelectionDiff(
      ["eleve-retire"],
      ["eleve-gaelle", "eleve-jules"],
      (id, assigned) => appels.push([id, assigned]),
    );
    assert.deepEqual(added, ["eleve-gaelle", "eleve-jules"]);
    assert.deepEqual(removed, ["eleve-retire"]);
    assert.deepEqual(appels, [["eleve-gaelle", true], ["eleve-jules", true], ["eleve-retire", false]]);
    // Les inchangés ne sont JAMAIS ré-écrits (pas de ré-envoi d'email).
    const aucunAppel: unknown[] = [];
    applySelectionDiff(["a"], ["a"], (...args) => aucunAppel.push(args));
    assert.deepEqual(aucunAppel, []);
  });

  await test("6. aucune assignation avant « Terminer » (la sélection n'écrit jamais)", () => {
    assert.ok(/onToggle=\{\(studentId, checked\) => setSelection\(\(prev\) => toggleStudentSelection\(prev, studentId, checked\)\)\}/.test(sourceModale),
      "le clic met à jour la sélection LOCALE uniquement");
    // onSetAssignment n'apparaît que DANS le handler du bouton Terminer.
    const occurrences = sourceModale.match(/onSetAssignment\(/g) ?? [];
    assert.equal(occurrences.length, 1, "un seul point d'écriture");
    assert.ok(/terminerAssignation\(assignedStudentIds, selection, \(studentId, assigned\) =>\s*\n?\s*onSetAssignment\(/.test(sourceModale),
      "l'écriture vit dans le diff attendu par Terminer");
  });

  await test("7. une affectation existante apparaît cochée à l'ouverture (copies comprises)", () => {
    // La sélection est initialisée depuis les assignations à CHAQUE ouverture
    // → fermer puis rouvrir recharge l'état réel.
    assert.ok(/setSelection\(assignedStudentIds\);\s*\n?\s*setOpen\(true\)/.test(sourceModale),
      "ouverture = sélection initialisée depuis les assignations existantes");
    // Et un élève individualisé (assignation sur SA copie) apparaît coché :
    assert.deepEqual(mergeAssignedStudentIds(["direct-1"], ["proprio-copie-1", "direct-1"]),
      ["direct-1", "proprio-copie-1"], "liens directs + propriétaires de copies, dédupliqués");
    const programsSource = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
    assert.ok(/mergeAssignedStudentIds\(/.test(programsSource) && /source_template_id", programIds/.test(programsSource),
      "loadPrograms compose les cases cochées avec les copies individuelles");
  });

  await test("8. la sélection ne se réinitialise pas après le clic", () => {
    // Pas de useEffect qui réécrirait la sélection après un re-render parent.
    assert.ok(!/useEffect/.test(sourceModale), "aucun useEffect ne réinitialise la sélection");
    // Et la bascule conserve les autres cases (jamais d'écrasement global).
    const sélection = toggleStudentSelection(["eleve-gaelle"], "eleve-jules", true);
    assert.ok(sélection.includes("eleve-gaelle") && sélection.includes("eleve-jules"));
  });

  await test("9. le clavier peut cocher la case (checkbox native + label lié)", () => {
    const html = renderToString(
      createElement(StudentPickerList, { students: [gaelle], selectedIds: [], onToggle: () => {} }),
    );
    assert.ok(/type="checkbox"/.test(html), "case NATIVE : Espace/focus clavier natifs conservés");
    const idInput = html.match(/<input id="([^"]+)" type="checkbox"/)?.[1];
    const forLabel = html.match(/<label for="([^"]+)"/)?.[1];
    assert.ok(idInput && forLabel && idInput === forLabel, "label htmlFor ↔ input id : ligne entière cliquable, a11y intacte");
  });

  await test("10. le mode individuel conserve son chemin de copie par élève (Terminer → copie, retrait → lien de la copie)", async () => {
    const base = creerBase();
    base.table("programs").push({ id: "prog-modele", name: "Force", status: "actif", program_mode: "individuel", is_public: false, owner_student_id: null, source_template_id: null });
    const précédent = programAssignmentTestHooks.duplicate;
    programAssignmentTestHooks.duplicate = (async (_c: unknown, programId: string, o: { ownerStudentId?: string; sourceTemplateId?: string }) => {
      const copieId = `copie-${o.ownerStudentId}`;
      base.table("programs").push({ id: copieId, name: "Force", status: "actif", program_mode: "individuel", is_public: false, owner_student_id: o.ownerStudentId ?? null, source_template_id: o.sourceTemplateId ?? programId });
      return copieId;
    }) as never;
    try {
      // Terminer → assigner : copie individuelle + lien vers la COPIE, jamais le modèle.
      assert.ok(await setProgramAssignment(base.client, "eleve-gaelle", "prog-modele", true));
      const liens = base.table("assignments");
      assert.equal(liens.length, 1);
      assert.equal(liens[0].content_id, "copie-eleve-gaelle", "l'assignation vise la copie");
      assert.ok(!liens.some((l) => l.content_id === "prog-modele"), "jamais le modèle en mode individuel");
      // Décocher → retirer : le LIEN de la copie saute, la copie (historique) reste.
      assert.ok(await setProgramAssignment(base.client, "eleve-gaelle", "prog-modele", false));
      assert.equal(base.table("assignments").length, 0, "lien retiré");
      assert.ok(base.table("programs").some((p) => p.id === "copie-eleve-gaelle"), "la copie et son historique restent intacts");
      // Re-cocher → la copie existante est RÉUTILISÉE (aucun doublon).
      assert.ok(await setProgramAssignment(base.client, "eleve-gaelle", "prog-modele", true));
      assert.equal(base.table("programs").filter((p) => p.owner_student_id === "eleve-gaelle").length, 1, "une seule copie par élève");
      assert.equal(base.table("assignments")[0].content_id, "copie-eleve-gaelle");
    } finally {
      programAssignmentTestHooks.duplicate = précédent;
    }
  });

  /* ─── 11-16 : intégration Terminer → écriture → relecture (bug Preview) ─── */

  await test("11. flux complet : cocher → Terminer (attendu) → recharger → rouvrir → toujours coché", async () => {
    const base = creerBase();
    base.table("programs").push({ id: "prog-int", name: "Force", status: "actif", program_mode: "individuel", is_public: false, owner_student_id: null, source_template_id: null });
    const précédent = programAssignmentTestHooks.duplicate;
    programAssignmentTestHooks.duplicate = (async (_c: unknown, programId: string, o: { ownerStudentId?: string; sourceTemplateId?: string }) => {
      const copieId = `copie-${o.ownerStudentId}`;
      base.table("programs").push({ id: copieId, name: "Force", status: "actif", program_mode: "individuel", is_public: false, owner_student_id: o.ownerStudentId ?? null, source_template_id: o.sourceTemplateId ?? programId });
      return copieId;
    }) as never;
    try {
      // Relecture EXACTE de loadPrograms : liens directs + propriétaires de
      // copies portant un lien `assignments` ACTIF (fix/program-assignment-
      // active-links — une copie désassignée ne coche plus le modèle).
      const relire = () =>
        mergeAssignedStudentIds(
          base.table("assignments").filter((l) => l.content_id === "prog-int").map((l) => l.student_id as string),
          keepCopiesWithActiveAssignment(
            base.table("programs").filter((p) => p.source_template_id === "prog-int" && p.owner_student_id) as Array<{ id: string; owner_student_id: string }>,
            base.table("assignments").map((l) => l.content_id as string),
          ).map((p) => p.owner_student_id),
        );
      // 1-2. Ouverture : sélection initialisée depuis les assignations (vides).
      let sélection: string[] = relire();
      assert.deepEqual(sélection, []);
      sélection = toggleStudentSelection(sélection, "eleve-gaelle", true);
      // 3-4. Terminer : écritures RÉELLES (setProgramAssignment) toutes attendues.
      const { ok } = await terminerAssignation([], sélection, (studentId, assigned) =>
        setProgramAssignment(base.client, studentId, "prog-int", assigned),
      );
      assert.ok(ok, "les écritures aboutissent");
      // 5-8. Rechargement puis réouverture : l'élève apparaît TOUJOURS coché
      //      (assignation portée par sa copie, relue via source_template_id).
      const rechargé = relire();
      assert.deepEqual(rechargé, ["eleve-gaelle"], "réouverture : élève coché via sa copie");
    } finally {
      programAssignmentTestHooks.duplicate = précédent;
    }
  });

  await test("12. erreur d'affectation → pas de confirmation (la modale reste ouverte)", async () => {
    const { ok } = await terminerAssignation([], ["eleve-gaelle"], () => false);
    assert.equal(ok, false, "échec remonté — jamais avalé");
    // Le handler ne confirme que si ok, sinon message d'erreur et modale ouverte.
    assert.ok(/if \(ok\) \{\s*\n?\s*setConfirmed\(true\);\s*\n?\s*\} else \{\s*\n?\s*setSaveFailed\(true\);/.test(sourceModale),
      "échec → setSaveFailed, la modale ne se ferme pas");
    assert.ok(/saveFailed && \(/.test(sourceModale), "message d'erreur visible");
  });

  await test("13. deux écritures async sont TOUTES attendues avant le résultat", async () => {
    let résolues = 0;
    const lente = (ms: number) => new Promise<boolean>((résoudre) => setTimeout(() => { résolues += 1; résoudre(true); }, ms));
    const { ok } = await terminerAssignation([], ["a", "b"], () => lente(10));
    assert.equal(ok, true);
    assert.equal(résolues, 2, "Terminer n'a rendu la main qu'après LES DEUX écritures");
  });

  await test("14. mode groupe : deux élèves persistent (assignation directe au programme partagé)", async () => {
    const base = creerBase();
    base.table("programs").push({ id: "prog-grp", name: "Groupe", status: "actif", program_mode: "groupe", is_public: false, owner_student_id: null, source_template_id: null });
    const { ok } = await terminerAssignation([], ["eleve-gaelle", "eleve-jules"], (studentId, assigned) =>
      setProgramAssignment(base.client, studentId, "prog-grp", assigned),
    );
    assert.ok(ok);
    const liens = base.table("assignments");
    assert.equal(liens.length, 2, "deux liens");
    assert.ok(liens.every((l) => l.content_id === "prog-grp"), "directement le programme partagé — jamais de copie en groupe");
    assert.equal(base.table("programs").length, 1, "aucune copie créée");
  });

  await test("15. mode individuel : la relecture passe par source_template_id (copie), pas par le modèle", async () => {
    // Aucun lien direct sur le modèle, une copie possédée → l'élève DOIT apparaître coché.
    const cochés = mergeAssignedStudentIds([], ["eleve-gaelle"]);
    assert.deepEqual(cochés, ["eleve-gaelle"]);
    const programsSource = readFileSync(new URL("../../lib/supabase/programs.ts", import.meta.url), "utf8");
    assert.ok(/select\("id, owner_student_id, source_template_id"\)\.in\("source_template_id", programIds\)/.test(programsSource),
      "loadPrograms interroge réellement les copies individuelles");
    assert.ok(/keepCopiesWithActiveAssignment\(/.test(programsSource) && /liens actifs des copies/.test(programsSource),
      "seules les copies au lien assignments ACTIF participent aux cases cochées");
    // Et la RPC corrigée résout le staff par user_id (cause racine du bug Preview).
    const correctif = readFileSync(
      new URL("../../supabase/migrations/20260801210000_fix_provision_program_copy_staff_role.sql", import.meta.url), "utf8");
    const correctifSansCommentaires = correctif.replace(/^\s*--.*$/gm, "");
    assert.ok(/p\.user_id = auth\.uid\(\)/.test(correctifSansCommentaires), "garde d'autorisation sur profiles.user_id");
    assert.ok(!/p\.id = auth\.uid\(\)/.test(correctifSansCommentaires), "plus jamais p.id = auth.uid() (hors commentaires)");
    assert.ok(/REVOKE EXECUTE ON FUNCTION public\.provision_program_copy\(uuid, uuid, text\) FROM anon/.test(correctif),
      "privilèges ré-affirmés (ni anon ni PUBLIC)");
  });

  await test("16. aucune fermeture avant résolution, aucune erreur silencieuse", async () => {
    // Un REJET de promesse devient un échec explicite (jamais une exception perdue).
    const { ok } = await terminerAssignation([], ["eleve-gaelle"], () => Promise.reject(new Error("réseau")));
    assert.equal(ok, false, "rejet → ok:false, la modale affiche l'erreur");
    // Verrou et attente réelle dans le composant.
    assert.ok(/disabled=\{saving\}/.test(sourceModale), "bouton verrouillé pendant l'enregistrement");
    assert.ok(/if \(saving\) return;/.test(sourceModale), "anti double-clic");
    assert.ok(/\{saving \? "Enregistrement…" : "Terminer"\}/.test(sourceModale), "état de chargement visible");
    // Et le hook d'écriture REND sa promesse (plus de fire-and-forget).
    const hook = readFileSync(new URL("../../hooks/useContentAssignment.ts", import.meta.url), "utf8");
    assert.ok(/return write\(supabase, studentId, contentId, assigned\)\.then/.test(hook),
      "useContentAssignment rend la promesse d'écriture à la modale");
    assert.ok(!/void write\(/.test(hook), "plus d'écriture lancée sans être attendue");
  });

  await test("17. cycle désassignation/réassignation : la copie survit, l'affichage suit le lien ACTIF", async () => {
    // 1-2. Pur : copie + lien actif → coché ; copie sans lien → décoché.
    const copies = [{ id: "copie-1", owner_student_id: "eleve-gaelle" }];
    assert.deepEqual(
      mergeAssignedStudentIds([], keepCopiesWithActiveAssignment(copies, ["copie-1"]).map((c) => c.owner_student_id)),
      ["eleve-gaelle"], "copie + assignment actif → élève coché sur le modèle");
    assert.deepEqual(
      mergeAssignedStudentIds([], keepCopiesWithActiveAssignment(copies, []).map((c) => c.owner_student_id)),
      [], "copie SANS assignment → élève décoché (owner seul ≠ assigné)");

    // 3-6. Intégration : assigner → désassigner → réassigner, sur le vrai code.
    const base = creerBase();
    base.table("programs").push({ id: "prog-cycle", name: "Cycle", status: "actif", program_mode: "individuel", is_public: false, owner_student_id: null, source_template_id: null });
    const précédent = programAssignmentTestHooks.duplicate;
    programAssignmentTestHooks.duplicate = (async (_c: unknown, programId: string, o: { ownerStudentId?: string; sourceTemplateId?: string }) => {
      const copieId = `copie-${o.ownerStudentId}`;
      base.table("programs").push({ id: copieId, name: "Cycle", status: "actif", program_mode: "individuel", is_public: false, owner_student_id: o.ownerStudentId ?? null, source_template_id: o.sourceTemplateId ?? programId });
      return copieId;
    }) as never;
    const relire = () =>
      mergeAssignedStudentIds(
        base.table("assignments").filter((l) => l.content_id === "prog-cycle").map((l) => l.student_id as string),
        keepCopiesWithActiveAssignment(
          base.table("programs").filter((p) => p.source_template_id === "prog-cycle" && p.owner_student_id) as Array<{ id: string; owner_student_id: string }>,
          base.table("assignments").map((l) => l.content_id as string),
        ).map((p) => p.owner_student_id),
      );
    try {
      // Assignation : copie créée, élève coché.
      assert.ok(await setProgramAssignment(base.client, "eleve-gaelle", "prog-cycle", true));
      assert.deepEqual(relire(), ["eleve-gaelle"], "assigné → coché via le lien de sa copie");
      // 3. Désassignation : le LIEN saute, la copie et son owner restent.
      assert.ok(await setProgramAssignment(base.client, "eleve-gaelle", "prog-cycle", false));
      assert.equal(base.table("assignments").length, 0, "aucun lien actif vers modèle ou copie");
      const copie = base.table("programs").find((p) => p.id === "copie-eleve-gaelle")!;
      assert.equal(copie.owner_student_id, "eleve-gaelle", "copie conservée avec owner (historique intact)");
      assert.deepEqual(relire(), [], "le modèle affiche l'élève DÉCOCHÉ");
      // 4-6. Réassignation : copie RÉUTILISÉE, pas de doublon, accès rendu.
      assert.ok(await setProgramAssignment(base.client, "eleve-gaelle", "prog-cycle", true));
      assert.equal(base.table("programs").filter((p) => p.owner_student_id === "eleve-gaelle").length, 1, "aucune deuxième copie");
      assert.equal(base.table("assignments").length, 1);
      assert.equal(base.table("assignments")[0].content_id, "copie-eleve-gaelle", "l'accès repasse par la MÊME copie");
      assert.deepEqual(relire(), ["eleve-gaelle"], "re-coché après réassignation");
    } finally {
      programAssignmentTestHooks.duplicate = précédent;
    }
  });
})();

console.log(`\n${réussis} test(s) réussi(s), ${échecs} échec(s).`);
if (échecs > 0) process.exit(1);
