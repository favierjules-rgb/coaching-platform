/*
 * ════════════════════════════════════════════════════════════════════════════
 * REPRISE DE L'INTERFACE APRÈS « SAUVEGARDE RÉUSSIE + RELECTURE ÉCHOUÉE »
 * ════════════════════════════════════════════════════════════════════════════
 * Lot D du chantier feat/entrainement-performances.
 *
 * `reprise-relecture-echouee.mts` prouve que les DONNÉES sont protégées dans ce
 * scénario : aucun doublon, aucune perte, et la seconde sauvegarde refusée par
 * le verrou optimiste. Cette suite-ci traite l'AUTRE moitié — ce que
 * l'interface dit, ce qu'elle permet, et ce qu'elle ne détruit pas.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CES TESTS PROUVENT — ET CE QU'ILS NE PROUVENT PAS
 * ════════════════════════════════════════════════════════════════════════════
 * AUCUN NAVIGATEUR N'EST DISPONIBLE sur ce poste (pas de Chromium ; c'est aussi
 * la raison des 3 tests Playwright non exécutables de `builder-save-path`).
 * La frontière est donc nette, et il faut la lire avant de lire les résultats.
 *
 * PROUVÉ, en appelant les fonctions RÉELLES :
 *   · la décision de sauvegarde de la page — `executerSauvegardeDeLaPage`, qui
 *     enchaîne le refus préventif, `orchestrateBuilderSave`, `updateProgram`,
 *     `calculerDiffProgrammation`, la RPC groupée (faux dépôt modélisant le
 *     diff) et `nextBuilderState`. La page ne contient plus cette logique :
 *     elle appelle cette fonction. Les tests traversent donc le vrai chemin,
 *     pas une reconstitution ;
 *   · la transition d'état — `nextBuilderState`, `nextBuilderStateApresResync` ;
 *   · la dérivation du programme affiché — `programmeActifDeLaPage`, dont la
 *     valeur `undefined` était la cause du démontage ;
 *   · le réducteur de relecture du hook — `conserverProgrammeSiRelectureVide` ;
 *   · la resynchronisation — `executerResynchronisationDeLaPage` ;
 *   · les messages rendus au coach — `builderSaveUserMessage`,
 *     `refusPourDesynchronisation`.
 *
 * NON PROUVÉ ICI, et aucun test de cette suite ne doit être lu comme le disant :
 *   · le RENDU React. Que la `key` inchangée n'entraîne effectivement aucun
 *     remount est le contrat de React, vérifié ici par l'égalité de la `key`
 *     calculée, pas par un rendu réel ;
 *   · les pixels : la couleur ambre, le libellé affiché et la présence du
 *     bouton sont vérifiés par ASSERTION STRUCTURELLE sur le source du
 *     composant (section D), ce qui attrape une régression mais ne remplace pas
 *     un œil humain ni une capture ;
 *   · le `window.confirm` de la resynchronisation et le garde `beforeunload` :
 *     structurels également ;
 *   · le comportement réel du réseau. `refetch: async () => null` modélise
 *     l'échec de relecture tel que `getProgramById` le rend (il rend `null`, il
 *     ne lève pas) — c'est fidèle, mais ce n'est pas une panne réseau réelle.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  builderSaveUserMessage,
  executerResynchronisationDeLaPage,
  executerSauvegardeDeLaPage,
  nextBuilderState,
  nextBuilderStateApresResync,
  programmeActifDeLaPage,
  refusPourDesynchronisation,
  type BuilderState,
} from "../../lib/admin-builder-save";
import { conserverProgrammeSiRelectureVide } from "../../hooks/useSupabaseProgram";
import { updateProgram } from "../../lib/supabase/programs";
import { isUuid } from "../../lib/training-blocks";
import type { AdminProgram } from "../../types";
import {
  blocCardio,
  creerBase,
  donnees,
  etatServeur,
  instantane,
  seance,
} from "./_faux-depot-prescriptions";

const PROG = "prog-1";
const TEMP_BLOC = "new-block:aaaaaaaa-1111-4111-8111-111111111111";
const TEMP_PRESC = "new-prescription:bbbbbbb1-1111-4111-8111-111111111111";

/** L'état local du coach : un bloc cardio neuf, une prescription neuve. */
function etatLocalAvecPrescriptionNeuve(updatedAt: string) {
  return seance(updatedAt, [blocCardio(TEMP_BLOC, [{ id: TEMP_PRESC, title: "Segment 1" }])]);
}

/** La `key` du builder, telle que la page la construit (garde de dérive en D5). */
function cleDuBuilder(programme: AdminProgram | undefined, revision: number): string {
  return `${programme?.id}:${revision}`;
}

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), "utf8");
/** Retire la prose : « ce mot n'apparaît pas » ne doit jamais être satisfait
 *  par un commentaire qui l'explique. Convention du dépôt. */
const sansProse = (texte: string) =>
  texte.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const COMPO = "components/admin/ProgramBuilderFullscreen.tsx";
const PAGE = "app/admin/programmes/[programId]/builder/page.tsx";

/* ══════════════════════════════════════════════════════════════════════════
   A. LE SCÉNARIO DEMANDÉ, DE BOUT EN BOUT
   ══════════════════════════════════════════════════════════════════════════ */

await test("A1. première sauvegarde RÉUSSIE alors que la programmation n'était pas encore dans l'état de la page", async () => {
  const base = creerBase();
  // La page vient d'être montée : `savedProgram` est NULL, le programme affiché
  // vient du cache du hook. C'est exactement la situation du défaut.
  const cache = instantane([seance("t1", [])]);
  const savedProgram: AdminProgram | null = null;
  const actif = programmeActifDeLaPage(savedProgram, cache, PROG);
  assert.equal(actif, cache, "au montage, le programme affiché vient du cache, pas d'un instantané de page");

  const etat: BuilderState = { program: actif!, revision: 0, desynchronise: false };
  const local = etatLocalAvecPrescriptionNeuve("t1");

  const { etat: suivant, resultat, outcome } = await executerSauvegardeDeLaPage({
    etat,
    save: () => updateProgram(base.client, PROG, donnees([local]), etat.program),
    // ⚠️ La relecture échoue : `getProgramById` rend `null`, il ne lève pas.
    refetch: async () => null,
  });

  assert.equal(outcome?.kind, "refetch-failed", "l'issue est bien « enregistré, non relu »");
  assert.equal(base.prescriptions.length, 1, "la prescription EST en base : la sauvegarde a réussi");
  assert.ok(isUuid(base.prescriptions[0]!.id), "et le serveur lui a donné un UUID réel");

  assert.equal(resultat.ok, false, "le builder n'est pas informé d'un succès complet…");
  assert.equal(resultat.desynchronise, true, "…mais d'une DÉSYNCHRONISATION, pas d'un échec");
  assert.equal(suivant.desynchronise, true, "l'état de page porte le drapeau");

  const message = resultat.userMessage ?? "";
  assert.match(message, /Enregistré/, "le message reconnaît que l'écriture a eu lieu");
  assert.match(message, /synchronis/i, "et nomme la synchronisation comme ce qui a échoué");
  assert.doesNotMatch(
    message,
    /échec de l'enregistrement|aucune modification n'a été enregistrée/i,
    "il ne doit JAMAIS laisser croire que la sauvegarde a échoué",
  );
});

await test("A2. l'échec de relecture ne démonte PAS le builder — deux protections, testées séparément", async () => {
  const cache = instantane([seance("t1", [])]);
  const epingle = cache; // ce que la page écrit dans `savedProgram` sur refetch-failed

  /*
   * ⚠️ LE DÉFAUT, D'ABORD : il faut le voir échouer pour savoir ce qu'on
   * protège. Sans aucune des deux protections — cache vidé par la relecture ET
   * instantané non épinglé — la dérivation rend `undefined`, et c'est la
   * branche « Programme introuvable. » de la page, donc le démontage.
   */
  assert.equal(
    programmeActifDeLaPage(null, null, PROG),
    undefined,
    "LE DÉFAUT D'ORIGINE : sans protection, le programme affiché disparaît",
  );

  // PROTECTION 1 — le réducteur du hook conserve la valeur déjà chargée.
  const cacheApresRelectureRatee = conserverProgrammeSiRelectureVide(cache, null);
  assert.equal(cacheApresRelectureRatee, cache, "une relecture vide ne remplace pas un programme déjà chargé");
  assert.notEqual(
    programmeActifDeLaPage(null, cacheApresRelectureRatee, PROG),
    undefined,
    "la protection 1 suffit à elle seule : le builder reste monté",
  );
  // Et elle n'empêche pas une relecture RÉUSSIE de remplacer la valeur.
  const frais = instantane([seance("t2", [])]);
  assert.equal(conserverProgrammeSiRelectureVide(cache, frais), frais, "une relecture réussie remplace bien le cache");

  // PROTECTION 2 — l'instantané épinglé par la page, même si le cache se vidait.
  assert.notEqual(
    programmeActifDeLaPage(epingle, null, PROG),
    undefined,
    "la protection 2 suffit à elle seule : l'instantané épinglé tient",
  );
  // Elle reste correctement bornée au programme affiché.
  const autre = { ...instantane([]), id: "prog-2" } as AdminProgram;
  assert.equal(
    programmeActifDeLaPage(autre, null, PROG),
    undefined,
    "un instantané d'un AUTRE programme ne doit pas être affiché à sa place",
  );
});

await test("A3. les modifications locales sont conservées : la key du builder ne change pas", async () => {
  const base = creerBase();
  const cache = instantane([seance("t1", [])]);
  const etat: BuilderState = { program: cache, revision: 5, desynchronise: false };
  const cleAvant = cleDuBuilder(etat.program, etat.revision);

  const { etat: suivant } = await executerSauvegardeDeLaPage({
    etat,
    save: () => updateProgram(base.client, PROG, donnees([etatLocalAvecPrescriptionNeuve("t1")]), etat.program),
    refetch: async () => null,
  });

  assert.equal(suivant.program, etat.program, "MÊME référence de programme");
  assert.equal(suivant.revision, 5, "MÊME révision");
  assert.equal(
    cleDuBuilder(suivant.program, suivant.revision),
    cleAvant,
    "donc MÊME key : React ne remonte pas le builder, l'état local survit",
  );
  // Contre-épreuve : un succès, lui, DOIT changer la key.
  const apresSucces = nextBuilderState(etat, { kind: "success", freshProgram: instantane([seance("t9", [])]) });
  assert.notEqual(
    cleDuBuilder(apresSucces.program, apresSucces.revision),
    cleAvant,
    "un succès change la key : remount volontaire depuis les données fraîches",
  );
});

await test("A4. aucune seconde écriture avec un verrou périmé — `save` n'est même pas appelé", async () => {
  const base = creerBase();
  const cache = instantane([seance("t1", [])]);
  const local = etatLocalAvecPrescriptionNeuve("t1");

  // Sauvegarde 1 : réussie, relecture ratée → état désynchronisé.
  const { etat: desynchro } = await executerSauvegardeDeLaPage({
    etat: { program: cache, revision: 0, desynchronise: false },
    save: () => updateProgram(base.client, PROG, donnees([local]), cache),
    refetch: async () => null,
  });
  assert.equal(desynchro.desynchronise, true);
  const idApresUn = base.prescriptions[0]!.id;
  const appelsApresUn = base.appels.length;

  /*
   * Sauvegarde 2, avec l'état client tel qu'il est resté — `updatedAt` périmé et
   * identifiants temporaires encore en place.
   *
   * ⚠️ CE COMPTEUR EST LE CŒUR DU TEST. Il ne suffit pas que la sauvegarde soit
   * refusée : il faut qu'elle soit refusée AVANT le réseau. Si l'ordre des deux
   * premières lignes de `executerSauvegardeDeLaPage` était inversé, le refus
   * arriverait après l'écriture — les types ne broncheraient pas, et le verrou
   * optimiste masquerait le problème la plupart du temps. Ici, `save` doit avoir
   * été appelé ZÉRO fois.
   */
  let appelsAuSave = 0;
  const { etat: apresDeux, resultat, outcome } = await executerSauvegardeDeLaPage({
    etat: desynchro,
    save: async () => {
      appelsAuSave += 1;
      return updateProgram(base.client, PROG, donnees([local]), desynchro.program);
    },
    refetch: async () => {
      throw new Error("la relecture ne doit même pas être tentée");
    },
  });

  assert.equal(appelsAuSave, 0, "`save` n'a PAS été appelé : rien n'est parti sur le réseau");
  assert.equal(outcome, null, "aucune issue de sauvegarde à rapporter — il n'y a pas eu d'appel");
  assert.equal(base.appels.length, appelsApresUn, "aucun appel RPC supplémentaire côté base");
  assert.equal(base.prescriptions.length, 1, "aucun doublon");
  assert.equal(base.prescriptions[0]!.id, idApresUn, "aucune perte : l'identifiant persisté est intact");

  assert.equal(resultat.ok, false, "le builder est informé du refus");
  assert.equal(resultat.desynchronise, true, "et reste dans l'état désynchronisé");
  assert.match(resultat.userMessage ?? "", /rien n'a été envoyé/i, "le message dit que rien n'est parti");
  assert.match(resultat.userMessage ?? "", /resynchronise/i, "et nomme l'action à faire");
  assert.equal(apresDeux, desynchro, "l'état de page n'a pas bougé : même référence");

  // Et la garde est bien portée par une fonction, pas par un enchaînement fragile.
  assert.equal(refusPourDesynchronisation({ desynchronise: false }), null, "un état sain ne refuse rien");
  assert.ok(refusPourDesynchronisation({ desynchronise: true }), "un état désynchronisé refuse");
});

await test("A5. reprise après une relecture RÉUSSIE : l'état serveur est récupéré, le drapeau tombe", async () => {
  const base = creerBase();
  const cache = instantane([seance("t1", [])]);
  const local = etatLocalAvecPrescriptionNeuve("t1");

  const { etat: desynchro } = await executerSauvegardeDeLaPage({
    etat: { program: cache, revision: 2, desynchronise: false },
    save: () => updateProgram(base.client, PROG, donnees([local]), cache),
    refetch: async () => null,
  });
  const idReel = base.prescriptions[0]!.id;

  // ── d'abord une resynchronisation qui ÉCHOUE : on ne sort pas de l'état ──
  const echec = await executerResynchronisationDeLaPage({ etat: desynchro, refetch: async () => null });
  assert.equal(echec.ok, false, "relecture encore ratée");
  assert.equal(echec.etat, desynchro, "l'état ne bouge pas : on ne sort pas de la désynchronisation sans données");
  assert.equal(echec.etat.desynchronise, true, "le drapeau reste levé");
  // Une relecture qui LÈVE est traitée comme un échec, pas propagée au coach.
  const leve = await executerResynchronisationDeLaPage({
    etat: desynchro,
    refetch: async () => {
      throw new Error("réseau coupé");
    },
  });
  assert.equal(leve.ok, false, "une exception de relecture est un échec, pas un plantage");
  assert.equal(leve.etat.desynchronise, true);

  // ── puis une resynchronisation qui RÉUSSIT ──────────────────────────────
  const serveur = etatServeur(base);
  const reprise = await executerResynchronisationDeLaPage({ etat: desynchro, refetch: async () => serveur });
  assert.equal(reprise.ok, true, "la relecture aboutit");
  assert.equal(reprise.etat.desynchronise, false, "le drapeau tombe : les écritures sont de nouveau autorisées");
  assert.equal(reprise.etat.program, serveur, "l'instantané est remplacé par l'état SERVEUR");
  assert.equal(reprise.etat.revision, 3, "la révision est incrémentée → remount du builder sur les données fraîches");

  // ⚠️ ET LES IDENTIFIANTS PERSISTÉS SONT BIEN LÀ — c'est tout l'objet de la
  // reprise. Aucun `id_mapping` n'a été interprété : l'identifiant vient de la
  // RELECTURE, donc de la base.
  const presc = reprise.etat.program.sessions[0]?.blocks?.[0];
  assert.ok(presc, "la séance reprise porte bien son bloc cardio");
  const ids = (presc as unknown as { prescriptions: { id: string }[] }).prescriptions.map((x) => x.id);
  assert.deepEqual(ids, [idReel], "l'état repris porte l'identifiant RÉEL, plus l'identifiant temporaire");
  assert.ok(isUuid(ids[0]!), "et c'est bien un UUID");
  assert.equal(refusPourDesynchronisation(reprise.etat), null, "une sauvegarde peut repartir");
});

await test("A6. après la reprise, les identifiants sont STABLES : ni doublon, ni perte sur deux sauvegardes de plus", async () => {
  const base = creerBase();
  const cache = instantane([seance("t1", [])]);

  const { etat: desynchro } = await executerSauvegardeDeLaPage({
    etat: { program: cache, revision: 0, desynchronise: false },
    save: () => updateProgram(base.client, PROG, donnees([etatLocalAvecPrescriptionNeuve("t1")]), cache),
    refetch: async () => null,
  });
  const idReel = base.prescriptions[0]!.id;
  const blocReel = base.blocs[0]!.id;

  const reprise = await executerResynchronisationDeLaPage({
    etat: desynchro,
    refetch: async () => etatServeur(base),
  });
  assert.equal(reprise.ok, true);

  /*
   * Le builder remonte sur l'état serveur : son état local EST désormais
   * `reprise.etat.program`. Les deux sauvegardes suivantes partent donc avec les
   * identifiants réels, comme le ferait le coach après avoir cliqué sur
   * « Resynchroniser ».
   */
  let etat = reprise.etat;
  for (const tour of [1, 2]) {
    const sortantes = etat.program.sessions;
    const resultat = await executerSauvegardeDeLaPage({
      etat,
      save: () => updateProgram(base.client, PROG, donnees([...sortantes]), etat.program),
      refetch: async () => etatServeur(base),
    });
    assert.equal(resultat.resultat.ok, true, `sauvegarde ${tour} après reprise : elle aboutit`);
    assert.equal(resultat.etat.desynchronise, false, `sauvegarde ${tour} : toujours synchronisé`);
    assert.equal(base.prescriptions.length, 1, `sauvegarde ${tour} : aucun doublon`);
    assert.equal(base.prescriptions[0]!.id, idReel, `sauvegarde ${tour} : identifiant de prescription CONSERVÉ`);
    assert.equal(base.blocs.length, 1, `sauvegarde ${tour} : aucun bloc accumulé`);
    assert.equal(base.blocs[0]!.id, blocReel, `sauvegarde ${tour} : identifiant de bloc CONSERVÉ`);
    etat = resultat.etat;
  }
  assert.equal(etat.revision, 3, "une révision par sauvegarde réussie, plus celle de la reprise");
});

/* ══════════════════════════════════════════════════════════════════════════
   B. LE CAS QUE LA CONSIGNE ISOLE : le serveur a créé, le client n'a jamais
      reçu la correspondance
   ══════════════════════════════════════════════════════════════════════════ */

await test("B1. serveur ayant créé des prescriptions sans correspondance reçue : la seule issue sûre est la relecture", async () => {
  const base = creerBase();
  const cache = instantane([seance("t1", [])]);
  const local = etatLocalAvecPrescriptionNeuve("t1");

  const { etat: desynchro } = await executerSauvegardeDeLaPage({
    etat: { program: cache, revision: 0, desynchronise: false },
    save: () => updateProgram(base.client, PROG, donnees([local]), cache),
    refetch: async () => null,
  });

  /*
   * ÉTAT DES LIEUX, factuel : la base porte un UUID réel, l'état local porte
   * encore l'identifiant TEMPORAIRE. Rien côté client ne relie les deux —
   * `id_mapping` est bien revenu dans la réponse de la RPC, mais il n'est PAS
   * branché dans la machine à états, et c'est un choix.
   */
  assert.ok(isUuid(base.prescriptions[0]!.id), "la base a un UUID réel");
  const blocLocal = local.blocks?.[0];
  assert.ok(blocLocal, "l'état local porte bien son bloc cardio");
  const idsLocaux = (blocLocal as unknown as { prescriptions: { id: string }[] }).prescriptions.map((p) => p.id);
  assert.deepEqual(idsLocaux, [TEMP_PRESC], "l'état local porte encore l'identifiant temporaire");

  /*
   * POURQUOI NE PAS BRANCHER `id_mapping` ICI. Ce serait réécrire l'état local
   * du coach à partir d'une réponse dont on vient justement de constater qu'on
   * ne sait pas la vérifier : la relecture a échoué, donc on ne peut PAS
   * confronter la correspondance à la base. Et une correspondance partielle —
   * la RPC a créé 3 prescriptions, le client n'en reconcilie que 2 parce que la
   * réponse a été tronquée — produirait exactement le mélange qu'on cherche à
   * éviter : des lignes réelles côtoyant des temporaires dans un même bloc, donc
   * à la sauvegarde suivante des réinsertions ET des suppressions.
   *
   * La garde cliente rend la question sans objet : dans cet état, AUCUNE
   * sauvegarde ne part. La seule sortie est la relecture, qui prend la base pour
   * référence au lieu de faire confiance à une réponse.
   */
  assert.ok(refusPourDesynchronisation(desynchro), "dans cet état, aucune sauvegarde ne peut partir");

  // Et si le coach insiste malgré tout, c'est toujours non — et sans écriture.
  let appels = 0;
  await executerSauvegardeDeLaPage({
    etat: desynchro,
    save: async () => {
      appels += 1;
      return true;
    },
    refetch: async () => null,
  });
  assert.equal(appels, 0, "trois clics ou trois cents : rien ne part");
  assert.equal(base.prescriptions.length, 1, "la ligne créée reste unique");
});

/* ══════════════════════════════════════════════════════════════════════════
   C. LES MESSAGES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C1. le message de désynchronisation ne se confond avec aucun message d'échec", async () => {
  const desync = builderSaveUserMessage({ kind: "refetch-failed" }) ?? "";
  const stale = builderSaveUserMessage({ kind: "stale" }) ?? "";
  assert.notEqual(desync, stale, "« non relu » et « périmé » ne disent pas la même chose");
  assert.match(desync, /Enregistré/);
  assert.doesNotMatch(stale, /^Enregistré/, "un STALE n'a RIEN enregistré : il ne doit pas commencer par « Enregistré »");
});

/* ══════════════════════════════════════════════════════════════════════════
   D. CE QUE L'INTERFACE AFFICHE ET PERMET — assertions STRUCTURELLES
      (aucun navigateur sur ce poste : voir l'en-tête)
   ══════════════════════════════════════════════════════════════════════════ */

await test("D1. l'état « enregistré mais désynchronisé » existe dans SaveStatus", () => {
  const typeSaveStatus = /type SaveStatus =([^;]+);/.exec(lire(COMPO))?.[1] ?? "";
  const etats = [...typeSaveStatus.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(etats.includes("desynchronise"), `états déclarés : ${etats.join(", ")}`);
});

await test("D2. il est peint en ambre, et le rouge reste réservé aux échecs", () => {
  const compo = sansProse(lire(COMPO));
  assert.match(
    compo,
    /desynchroniseEffectif\s*\n?\s*\?\s*"text-amber-400"/,
    "la désynchronisation passe AVANT « error » et prend l'ambre",
  );
  const iAmbre = compo.indexOf('desynchroniseEffectif');
  const iRouge = compo.indexOf('"text-red-400"');
  assert.ok(iAmbre !== -1 && iRouge !== -1 && iAmbre < iRouge, "l'ambre est évalué avant le rouge");
});

await test("D3. le libellé nomme l'enregistrement réussi, et l'horodatage est posé", () => {
  const compo = sansProse(lire(COMPO));
  assert.match(compo, /synchronisation échouée/, "le libellé dit que c'est la SYNCHRONISATION qui a échoué");
  assert.match(compo, /if \(desynchroniseEffectif\) \{/, "et il est évalué avant la branche d'erreur");
  assert.match(compo, /if \(!savedAt\) \{\s*\n\s*setSavedAt\(/, "l'horodatage est posé même sur cette issue");
});

await test("D4. une commande de resynchronisation existe, et la sauvegarde est bloquée tant qu'elle n'a pas abouti", () => {
  const compo = sansProse(lire(COMPO));
  assert.match(compo, /onClick=\{\(\) => void handleResynchroniser\(\)\}/, "un bouton appelle la resynchronisation");
  assert.match(compo, /Resynchroniser/, "et il est libellé");
  assert.match(compo, /await onResynchroniser\(\)/, "qui délègue à la page");
  assert.match(
    compo,
    /disabled=\{saveStatus === "saving" \|\| resynchronisation \|\| desynchroniseEffectif\}/,
    "le bouton Enregistrer est désactivé tant que l'état serveur n'est pas réconcilié",
  );
  // Et le raccourci clavier passe par le MÊME handleSave, donc par le même refus.
  assert.match(compo, /event\.key === "s"[\s\S]{0,120}void handleSave\(\)/, "Cmd/Ctrl+S passe par handleSave");
});

await test("D5. F5 n'emporte plus le travail en silence, et la key du builder est bien celle que A3 calcule", () => {
  const compo = sansProse(lire(COMPO));
  assert.match(compo, /addEventListener\("beforeunload"/, "un garde beforeunload est posé");
  assert.match(
    compo,
    /if \(saveStatus !== "dirty" && !desynchroniseEffectif\) return;/,
    "et il couvre les DEUX états où il y a quelque chose à perdre",
  );
  // Garde de dérive de A3 : la key doit rester `id:revision`.
  assert.match(
    lire(PAGE),
    /key=\{`\$\{activeProgram\.id\}:\$\{builderRevision\}`\}/,
    "la key du builder est bien construite sur l'identifiant et la révision",
  );
});

await test("D6. une modification locale faite après coup n'effface pas l'avertissement", () => {
  const compo = sansProse(lire(COMPO));
  const occurrences = compo.match(/prev === "desynchronise" \? prev : "dirty"/g) ?? [];
  assert.equal(occurrences.length, 2, "les DEUX chemins qui marquent « modifié » respectent l'état désynchronisé");
});

await test("D7. la page refuse AVANT le réseau, et n'écrit l'état que s'il a changé", () => {
  const page = sansProse(lire(PAGE));
  assert.match(page, /executerSauvegardeDeLaPage\(\{/, "la page délègue la décision");
  assert.match(page, /executerResynchronisationDeLaPage\(\{/, "et la resynchronisation aussi");
  assert.match(page, /if \(etat !== etatCourant\)/, "elle n'écrit l'état que lorsqu'il a changé");
  assert.match(page, /desynchronise=\{desynchronise\}/, "elle transmet le drapeau au builder");
  assert.match(page, /onResynchroniser=\{handleResynchroniser\}/, "et l'action de reprise");
  // La garde est dans la fonction extraite, et elle y est AVANT l'appel réseau.
  const gestionnaire = sansProse(lire("lib/admin-builder-save.ts"));
  const iRefus = gestionnaire.indexOf("const refus = refusPourDesynchronisation(args.etat);");
  const iSave = gestionnaire.indexOf("await orchestrateBuilderSave({ save: args.save");
  assert.ok(iRefus !== -1 && iSave !== -1 && iRefus < iSave, "le refus est évalué avant toute sauvegarde");
});

await test("D8. le réducteur de relecture du hook ne peut plus effacer un programme chargé", () => {
  const hook = sansProse(lire("hooks/useSupabaseProgram.ts"));
  assert.match(
    hook,
    /setProgram\(\(precedent\) => conserverProgrammeSiRelectureVide\(precedent, frais\)\)/,
    "`refetch` passe par le réducteur testé en A2",
  );
  assert.doesNotMatch(
    hook.slice(hook.indexOf("const refetch"), hook.indexOf("useEffect")),
    /setProgram\(frais\)/,
    "et plus aucun `setProgram(frais)` nu dans `refetch`",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   E. NON-RÉGRESSION DES TRANSITIONS
   ══════════════════════════════════════════════════════════════════════════ */

await test("E1. seules les bonnes issues changent l'état", () => {
  const base: BuilderState = { program: instantane([seance("t1", [])]), revision: 9, desynchronise: false };
  assert.equal(nextBuilderState(base, { kind: "stale" }), base, "STALE : rien ne change");
  assert.equal(
    nextBuilderState(base, { kind: "error", error: new Error("x") }),
    base,
    "erreur : rien ne change",
  );
  const frais = instantane([seance("t2", [])]);
  assert.equal(nextBuilderState(base, { kind: "success", freshProgram: frais }).revision, 10);
  assert.equal(nextBuilderStateApresResync(base, { kind: "failed" }), base, "reprise ratée : rien ne change");
  assert.equal(nextBuilderStateApresResync(base, { kind: "success", freshProgram: frais }).revision, 10);
  // Un succès de sauvegarde SORT de la désynchronisation (cas du coach qui
  // resynchronise puis réenregistre dans la même session).
  const desync: BuilderState = { ...base, desynchronise: true };
  assert.equal(
    nextBuilderState(desync, { kind: "success", freshProgram: frais }).desynchronise,
    false,
    "un succès complet lève le drapeau",
  );
});
