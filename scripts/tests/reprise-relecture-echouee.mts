/*
 * ════════════════════════════════════════════════════════════════════════════
 * REPRISE APRÈS UN ÉCHEC DE RELECTURE — LE SCÉNARIO COMPLET, CÔTÉ CLIENT
 * ════════════════════════════════════════════════════════════════════════════
 * Lot D du chantier feat/entrainement-performances.
 *
 * ⚠️ CE TEST PASSE PAR LE VRAI GESTIONNAIRE DE SAUVEGARDE, et c'est tout son
 * intérêt. `orchestrateBuilderSave` → `updateProgram` →
 * `calculerDiffProgrammation` → `saveTrainingProgramSessions`, puis
 * `nextBuilderState` : la chaîne que la page du builder exécute, à l'identique.
 * Vérifier la fonction SQL seule ne dirait RIEN du cas qui nous occupe, parce
 * que le cas vient précisément de ce que le CLIENT garde en mémoire.
 *
 * LE SCÉNARIO :
 *   1. une prescription est créée avec un identifiant TEMPORAIRE ;
 *   2. la sauvegarde réussit — la base lui donne un UUID réel ;
 *   3. la RELECTURE échoue juste après (`refetch` rend `null`) ;
 *   4. le coach réenregistre, avec l'état client tel qu'il est resté.
 *
 * CE QU'IL FAUT PROUVER : aucun doublon, aucune prescription perdue, aucune
 * erreur d'identifiant.
 *
 * ⚠️ ET LA PROVENANCE DE LA GARANTIE COMPTE AUTANT QUE LA GARANTIE.
 * Le builder ne consomme PAS `id_mapping` : après un échec de relecture, son
 * état local porte encore les identifiants temporaires ET l'ancien `updatedAt`
 * de la séance. C'est ce dernier qui sauve la situation : le verrou optimiste
 * refuse la seconde sauvegarde EN ENTIER (`STALE_TRAINING_SESSION`), donc rien
 * n'est réécrit — ni dupliqué, ni perdu. La garantie vient du VERROU, pas d'une
 * réconciliation. Les tests 4 et 5 l'établissent, et le test 6 montre ce qui se
 * passerait sans lui.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { orchestrateBuilderSave, builderSaveUserMessage, nextBuilderState } from "../../lib/admin-builder-save";
import { updateProgram } from "../../lib/supabase/programs";
import { isUuid } from "../../lib/training-blocks";
// Le faux dépôt et ses fabriques vivent dans un module partagé : la suite
// `reprise-interface-desynchronisee` s'appuie sur le MÊME modèle de serveur.
import { blocCardio, creerBase, donnees, instantane, seance } from "./_faux-depot-prescriptions";

await test("1. SAUVEGARDE 1 : une prescription temporaire devient une ligne réelle", async () => {
  const base = creerBase();
  const locale = seance("t1", [blocCardio("new-block:aaaaaaaa-1111-4111-8111-111111111111", [
    { id: "new-prescription:bbbbbbb1-1111-4111-8111-111111111111", title: "Segment 1" },
  ])]);
  const snap = instantane([seance("t1", [])]);

  const issue = await orchestrateBuilderSave({
    save: () => updateProgram(base.client, "prog-1", donnees([locale]), snap),
    refetch: async () => instantane([locale]),
  });

  assert.equal(issue.kind, "success", "la sauvegarde doit réussir");
  assert.equal(base.prescriptions.length, 1, "une prescription en base");
  assert.ok(isUuid(base.prescriptions[0]!.id), "elle porte un UUID réel, pas l'id temporaire");
  assert.equal(base.prescriptions[0]!.title, "Segment 1");
});

await test("2. SAUVEGARDE 1 + RELECTURE EN ÉCHEC : l'écriture a eu lieu, l'état client ne bouge pas", async () => {
  const base = creerBase();
  const locale = seance("t1", [blocCardio("new-block:aaaaaaaa-1111-4111-8111-111111111111", [
    { id: "new-prescription:bbbbbbb1-1111-4111-8111-111111111111", title: "Segment 1" },
  ])]);
  const snap = instantane([seance("t1", [])]);

  // ⚠️ `refetch` rend `null` : c'est EXACTEMENT ce que fait `useSupabaseProgram`
  // quand la relecture échoue, et `orchestrateBuilderSave` en fait `refetch-failed`.
  const issue = await orchestrateBuilderSave({
    save: () => updateProgram(base.client, "prog-1", donnees([locale]), snap),
    refetch: async () => null,
  });

  assert.equal(issue.kind, "refetch-failed", "l'issue doit être refetch-failed");
  assert.equal(base.prescriptions.length, 1, "la prescription EST écrite : la sauvegarde avait réussi");

  /*
   * L'état de la page ne REMONTE pas, et il se marque désynchronisé.
   * ⚠️ Ce n'est plus le MÊME objet qu'avant (le drapeau change), donc l'égalité
   * de référence sur l'état n'est plus l'invariant à tester. Les deux invariants
   * qui comptent pour « pas de remount » sont la révision et la référence du
   * PROGRAMME, puisque la `key` du builder est construite sur ces deux-là.
   */
  const etatAvant = { program: snap, revision: 7, desynchronise: false };
  const etatApres = nextBuilderState(etatAvant, issue);
  assert.equal(etatApres.revision, 7, "la révision reste la même : pas de remount");
  assert.equal(etatApres.program, etatAvant.program, "même référence de programme : la key ne change pas");
  assert.equal(etatApres.desynchronise, true, "l'état se marque désynchronisé : plus aucune écriture ne partira");

  // Et le message dit la vérité : écrit, mais synchronisation ratée.
  const message = builderSaveUserMessage(issue) ?? "";
  assert.match(message, /Enregistré/, "le message doit reconnaître que l'écriture a eu lieu");
  assert.match(message, /synchronis/i, "et nommer la synchronisation comme ce qui a échoué");
  assert.doesNotMatch(
    message,
    /échec de l'enregistrement|n'a été enregistré/i,
    "il ne doit JAMAIS laisser croire que la sauvegarde a échoué",
  );
});

await test("3. SAUVEGARDE 2 avec l'état client inchangé : REFUSÉE, et c'est le verrou qui refuse", async () => {
  const base = creerBase();
  const locale = seance("t1", [blocCardio("new-block:aaaaaaaa-1111-4111-8111-111111111111", [
    { id: "new-prescription:bbbbbbb1-1111-4111-8111-111111111111", title: "Segment 1" },
  ])]);
  const snap = instantane([seance("t1", [])]);

  await orchestrateBuilderSave({
    save: () => updateProgram(base.client, "prog-1", donnees([locale]), snap),
    refetch: async () => null,
  });
  const idsApresUn = base.prescriptions.map((x) => x.id);
  assert.equal(idsApresUn.length, 1);

  /*
   * Le coach réenregistre. Rien n'a été réconcilié : `locale` porte encore son
   * identifiant temporaire ET son `updatedAt` d'origine ("t1"), alors que la
   * base est passée à une version ultérieure.
   */
  const issue2 = await orchestrateBuilderSave({
    save: () => updateProgram(base.client, "prog-1", donnees([locale]), snap),
    refetch: async () => null,
  });

  assert.equal(issue2.kind, "stale", "la seconde sauvegarde doit être reconnue comme un conflit de version");
  assert.match(builderSaveUserMessage(issue2) ?? "", /recharge/i, "et orienter vers un rechargement");

  // ── LES TROIS PROPRIÉTÉS DEMANDÉES ────────────────────────────────────────
  assert.equal(base.prescriptions.length, 1, "AUCUN DOUBLON");
  assert.deepEqual(base.prescriptions.map((x) => x.id), idsApresUn, "AUCUNE PERTE, mêmes identifiants");
  const derniere = base.appels[base.appels.length - 1]!;
  assert.match(derniere.issue, /STALE_TRAINING_SESSION/,
    "le refus vient du VERROU, pas d'une erreur d'identifiant");
  assert.ok(!/FOREIGN_PRESCRIPTION_ID/.test(derniere.issue),
    "AUCUNE ERREUR D'IDENTIFIANT : le serveur n'est jamais allé jusqu'à chercher la prescription");
});

await test("4. et sur trois rejeux de plus : toujours aucun doublon, aucune perte", async () => {
  const base = creerBase();
  const locale = seance("t1", [blocCardio("new-block:aaaaaaaa-1111-4111-8111-111111111111", [
    { id: "new-prescription:bbbbbbb1-1111-4111-8111-111111111111", title: "Segment 1" },
    { id: "new-prescription:bbbbbbb2-1111-4111-8111-111111111111", title: "Segment 2" },
  ])]);
  const snap = instantane([seance("t1", [])]);

  await orchestrateBuilderSave({
    save: () => updateProgram(base.client, "prog-1", donnees([locale]), snap),
    refetch: async () => null,
  });
  const reference = base.prescriptions.map((x) => `${x.id}|${x.title}|${x.position}`).sort();
  assert.equal(reference.length, 2);

  for (let i = 0; i < 3; i += 1) {
    const issue = await orchestrateBuilderSave({
      save: () => updateProgram(base.client, "prog-1", donnees([locale]), snap),
      refetch: async () => null,
    });
    assert.equal(issue.kind, "stale", `rejeu ${i + 1} : refusé par le verrou`);
  }
  assert.deepEqual(
    base.prescriptions.map((x) => `${x.id}|${x.title}|${x.position}`).sort(),
    reference,
    "la base est restée EXACTEMENT dans l'état laissé par la première sauvegarde",
  );
  assert.equal(base.blocs.length, 1, "aucun bloc orphelin ne s'accumule");
});

await test("5. LA REPRISE SÛRE : recharger rend la main, et la sauvegarde suivante passe", async () => {
  /*
   * C'est la stratégie de reprise, et elle est déjà celle que le message
   * propose : recharger la page. On la DÉMONTRE ici — après une relecture
   * réussie, l'état client porte les identifiants réels et le bon verrou, et la
   * sauvegarde suivante met à jour EN PLACE sans rien recréer.
   */
  const base = creerBase();
  const locale = seance("t1", [blocCardio("new-block:aaaaaaaa-1111-4111-8111-111111111111", [
    { id: "new-prescription:bbbbbbb1-1111-4111-8111-111111111111", title: "Segment 1" },
  ])]);
  const snap = instantane([seance("t1", [])]);

  await orchestrateBuilderSave({
    save: () => updateProgram(base.client, "prog-1", donnees([locale]), snap),
    refetch: async () => null,
  });
  const idReel = base.prescriptions[0]!.id;

  // Rechargement : on reconstruit l'état client DEPUIS LA BASE, comme le ferait
  // `getProgramById` après un F5.
  const fraiche = seance(base.seances[0]!.updated_at, [
    blocCardio(base.blocs[0]!.id, [{ id: idReel, title: "Segment 1" }]),
  ]);
  const snapFrais = instantane([fraiche]);

  // Le coach modifie le titre, puis enregistre.
  const modifiee = seance(base.seances[0]!.updated_at, [
    blocCardio(base.blocs[0]!.id, [{ id: idReel, title: "Segment 1 modifié" }]),
  ]);
  const issue = await orchestrateBuilderSave({
    save: () => updateProgram(base.client, "prog-1", donnees([modifiee]), snapFrais),
    refetch: async () => instantane([modifiee]),
  });

  assert.equal(issue.kind, "success", "après rechargement, la sauvegarde passe");
  assert.equal(base.prescriptions.length, 1, "aucun doublon");
  assert.equal(base.prescriptions[0]!.id, idReel, "L'IDENTIFIANT EST CONSERVÉ : mise à jour en place");
  assert.equal(base.prescriptions[0]!.title, "Segment 1 modifié", "la modification est écrite");
});

await test("6. CE QUI SE PASSERAIT SANS LE VERROU : la démonstration que la garantie vient de là", async () => {
  /*
   * ⚠️ TEST DE CONTRASTE — il ne valide pas le produit, il NOMME la provenance
   * de la garantie. On rejoue la seconde sauvegarde en présentant cette fois le
   * verrou À JOUR (ce que ferait un client qui relirait `updated_at` sans
   * réconcilier les identifiants de prescription). Le verrou ne refuse plus, et
   * on voit alors le comportement réel du diff.
   */
  const base = creerBase();
  const locale = seance("t1", [blocCardio("new-block:aaaaaaaa-1111-4111-8111-111111111111", [
    { id: "new-prescription:bbbbbbb1-1111-4111-8111-111111111111", title: "Segment 1" },
  ])]);
  const snap = instantane([seance("t1", [])]);

  await orchestrateBuilderSave({
    save: () => updateProgram(base.client, "prog-1", donnees([locale]), snap),
    refetch: async () => null,
  });
  const idApresUn = base.prescriptions[0]!.id;

  // Verrou à jour, identifiants NON réconciliés (bloc et prescription temporaires).
  const malReconciliee = seance(base.seances[0]!.updated_at, [
    blocCardio("new-block:aaaaaaaa-1111-4111-8111-111111111111", [
      { id: "new-prescription:bbbbbbb1-1111-4111-8111-111111111111", title: "Segment 1" },
    ]),
  ]);
  const issue = await orchestrateBuilderSave({
    save: () => updateProgram(base.client, "prog-1", donnees([malReconciliee]), snap),
    refetch: async () => null,
  });

  assert.equal(issue.kind, "refetch-failed", "l'écriture passe : le verrou ne refuse plus");
  // Et même là : pas de doublon. Le bornage de la suppression s'en charge.
  assert.equal(base.prescriptions.length, 1, "TOUJOURS AUCUN DOUBLON, grâce au bornage par bloc");
  assert.notEqual(base.prescriptions[0]!.id, idApresUn,
    "mais l'identifiant a changé : la ligne a été recréée, faute de réconciliation");
  assert.equal(base.blocs.length, 1, "et l'ancien bloc a bien été remplacé, pas accumulé");
});

await test("7. le gestionnaire traversé est bien le vrai, et il porte l'instantané", async () => {
  /*
   * Garde-fou : si la page cessait de passer l'instantané, ou si
   * `nextBuilderState` se mettait à muter l'état sur autre chose qu'un succès,
   * les tests 2 à 5 cesseraient de décrire la réalité sans forcément rougir.
   */
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(
    new URL("../../app/admin/programmes/[programId]/builder/page.tsx", import.meta.url), "utf8");
  assert.match(page, /updateProgramSupabase\(supabase, programId, data, activeProgram\)/,
    "la page doit passer `activeProgram` comme instantané");
  assert.match(page, /refetch: \(\) => supabaseProgram\.refetch\(\)/, "et relire après la sauvegarde");
  /*
   * ⚠️ LA DÉCISION A ÉTÉ EXTRAITE HORS DE REACT. La page ne contient plus de
   * `if (outcome.kind === "success")` : elle délègue à
   * `executerSauvegardeDeLaPage` et n'applique que l'état rendu. Le garde
   * structurel vérifie donc la DÉLÉGATION, et l'invariant « seul un succès
   * remplace l'instantané » est désormais vérifié POUR DE VRAI juste en
   * dessous, sur la fonction elle-même, au lieu d'être deviné dans du texte.
   */
  assert.match(page, /executerSauvegardeDeLaPage\(\{/, "la page délègue la décision au gestionnaire extrait");
  assert.match(page, /if \(etat !== etatCourant\)/,
    "et n'écrit l'état de page que lorsqu'il a réellement changé");

  const base = { program: instantane([seance("u0", [])]), revision: 4, desynchronise: false };
  for (const outcome of [
    { kind: "stale" } as const,
    { kind: "error", error: new Error("peu importe") } as const,
  ]) {
    const apres = nextBuilderState(base, outcome);
    assert.equal(apres, base, `${outcome.kind} ne doit RIEN changer`);
  }
  const apresEchecRelecture = nextBuilderState(base, { kind: "refetch-failed" });
  assert.equal(apresEchecRelecture.program, base.program, "refetch-failed garde l'instantané…");
  assert.equal(apresEchecRelecture.revision, base.revision, "…et la révision (aucun remount)");
  assert.equal(apresEchecRelecture.desynchronise, true, "…mais lève le drapeau");
  const frais = instantane([seance("u1", [])]);
  const apresSucces = nextBuilderState(base, { kind: "success", freshProgram: frais });
  assert.equal(apresSucces.program, frais, "seul un succès remplace l'instantané");
  assert.equal(apresSucces.revision, 5, "et seul un succès incrémente la révision");

  const orch = readFileSync(new URL("../../lib/admin-builder-save.ts", import.meta.url), "utf8");
  assert.match(orch, /if \(!freshProgram\) return \{ kind: "refetch-failed" \}/,
    "une relecture rendant null doit produire `refetch-failed`");
});
