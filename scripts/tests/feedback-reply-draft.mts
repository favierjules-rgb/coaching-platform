/**
 * Harnais — brouillon « Réponse coach » (lib/feedback-reply-draft.ts).
 *
 * Rejoue le contrat de la correction bloquante du 25/07/2026 : la saisie
 * d'une phrase complète (caractère par caractère, avec re-rendus parents
 * simulés entre chaque frappe, comme le vrai composant en subit) doit être
 * intégralement conservée ; la réponse enregistrée n'est chargée qu'au
 * changement de retour sélectionné.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/feedback-reply-draft.mts
 */
import assert from "node:assert/strict";

import {
  shouldLoadReply,
  syncReplyDraft,
  typeIntoDraft,
  type ReplyDraftState,
} from "../../lib/feedback-reply-draft";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${name}`);
    console.error(error);
  }
}

const PHRASE =
  "Bonnes sensations au début, difficulté dans la dernière montée — l'allure était correcte, " +
  "j'ai gardé le contrôle jusqu'au bout ; on ajuste ça la semaine prochaine, d'accord ?"; // > 100 caractères, accents + apostrophes

test("chargement initial : la réponse enregistrée est chargée une fois", () => {
  const s = syncReplyDraft(null, "fb-1", "Réponse déjà enregistrée");
  assert.equal(s.feedbackId, "fb-1");
  assert.equal(s.draft, "Réponse déjà enregistrée");
});

test("saisie continue de 100+ caractères : aucune perte, aucun écrasement", () => {
  let state: ReplyDraftState = syncReplyDraft(null, "fb-1", "");
  for (const char of PHRASE) {
    state = typeIntoDraft(state, state.draft + char);
    // Re-rendu parent entre chaque frappe (liste rechargée, même retour) :
    // l'état doit rester STRICTEMENT identique — pas de reset du brouillon.
    const after = syncReplyDraft(state, "fb-1", "Réponse déjà enregistrée");
    assert.equal(after, state, "le re-rendu ne doit pas recréer l'état pendant la saisie");
  }
  assert.equal(state.draft, PHRASE);
  assert.ok(state.draft.length > 100);
});

test("retour arrière et remplacement de sélection", () => {
  let state: ReplyDraftState = syncReplyDraft(null, "fb-1", "");
  state = typeIntoDraft(state, "Bravo pour ta séancee");
  state = typeIntoDraft(state, state.draft.slice(0, -1)); // retour arrière
  assert.equal(state.draft, "Bravo pour ta séance");
  // remplacement d'une sélection (le navigateur envoie la valeur finale)
  state = typeIntoDraft(state, "Bravo pour cette séance");
  assert.equal(state.draft, "Bravo pour cette séance");
});

test("copier-coller et sauts de ligne (Entrée / Shift+Entrée)", () => {
  let state: ReplyDraftState = syncReplyDraft(null, "fb-1", "");
  state = typeIntoDraft(state, "Ligne 1\nLigne 2\n\nBloc collé : allure 5:30/km, FC 152 bpm");
  const after = syncReplyDraft(state, "fb-1", "");
  assert.equal(after.draft, "Ligne 1\nLigne 2\n\nBloc collé : allure 5:30/km, FC 152 bpm");
});

test("changement de retour sélectionné : la réponse de l'autre retour est chargée", () => {
  let state: ReplyDraftState = syncReplyDraft(null, "fb-1", "");
  state = typeIntoDraft(state, "Brouillon du retour 1");
  assert.equal(shouldLoadReply(state, "fb-2"), true);
  state = syncReplyDraft(state, "fb-2", "Réponse existante du retour 2");
  assert.equal(state.draft, "Réponse existante du retour 2");
  // retour au premier : son brouillon local n'est pas ressuscité (contrat :
  // le brouillon vit tant que la modale du retour reste ouverte)
  state = syncReplyDraft(state, "fb-1", "");
  assert.equal(state.draft, "");
});

test("même id : l'objet feedback recréé (refetch) n'écrase jamais la saisie", () => {
  let state: ReplyDraftState = syncReplyDraft(null, "fb-1", "Ancienne réponse");
  state = typeIntoDraft(state, "Nouvelle réponse en cours de frappe");
  for (let i = 0; i < 50; i += 1) {
    state = syncReplyDraft(state, "fb-1", "Ancienne réponse");
  }
  assert.equal(state.draft, "Nouvelle réponse en cours de frappe");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
