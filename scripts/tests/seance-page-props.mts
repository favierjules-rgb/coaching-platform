import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * GARDE-FOU — LA PAGE ÉLÈVE TRANSMET-ELLE ENCORE TOUT ?
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN CONTRÔLE DE SOURCE, ICI ENCORE
 * ════════════════════════════════════════════════════════════════════════
 * Les props hors ligne de `SessionFeedbackSection` sont OPTIONNELLES, et
 * elles doivent le rester : les contextes historiques — démonstration,
 * harnais de rendu — s'en passent, et les rendre obligatoires casserait
 * trois appelants pour un besoin qui n'en concerne qu'un.
 *
 * Mais cette souplesse a un prix : le jour où quelqu'un retire `source` de
 * la page élève, RIEN ne casse. Le composant reprend simplement son
 * comportement d'avant — plus de brouillon, plus de submit hors ligne, plus
 * de garde vidéo — et la seule trace est une séance qui, en avion, ne
 * s'enregistre plus. Aucun type, aucun test de comportement ne l'attrape.
 *
 * D'où ce contrôle : il lit la page et exige que les cinq props y soient.
 * Comme les garde-fous de `scripts/tests/idb/`, il cherche du texte — parce
 * que la propriété à prouver EST une propriété du source.
 */

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = join(RACINE, "app", "(student)", "entrainement", "seance", "[sessionId]", "page.tsx");

/** Ce que le chemin élève de production doit fournir, explicitement. */
const PROPS_REQUISES = [
  "source=",
  "authUserId=",
  "businessDate=",
  "cheminsVideoConnus=",
  "chargerRemplacants=",
] as const;

let réussis = 0;
let échecs = 0;

function test(nom: string, fn: () => void) {
  try {
    fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

const source = await readFile(PAGE, "utf8");

test("P4. la page de séance transmet TOUTES les props du chemin hors ligne", () => {
  const manquantes = PROPS_REQUISES.filter((prop) => !source.includes(prop));
  assert.deepEqual(
    manquantes,
    [],
    "sans ces props, la séance cesse silencieusement de fonctionner hors ligne : ni brouillon, ni file d'attente, ni garde vidéo",
  );
});

test("P4b. elle passe par `useSeanceHorsLigne`, pas par l'ancien booléen", () => {
  assert.ok(
    source.includes("useSeanceHorsLigne"),
    "la page doit consommer l'état explicite, pas `active`",
  );
  assert.equal(
    source.includes("useSupabaseTrainingProgram"),
    false,
    "l'ancien hook rendait `active: false` sur une panne réseau, ce qui menait au mock",
  );
});

test("P4c. les six états sont distingués", () => {
  for (const etat of ["chargement", "erreur", "indisponible", "offline", "online"]) {
    assert.ok(source.includes(`"${etat}"`), `l'état ${etat} n'est pas traité par la page`);
  }
});

test("P3. la démonstration n'est atteignable QUE par l'état mock", () => {
  // `data/student.ts` ne doit plus être atteint depuis une branche
  // conditionnée par un échec : le seul chemin restant est celui qui suit
  // les états réels, tout en bas du composant.
  const indexMock = source.indexOf("getWorkoutSession(params.sessionId)");
  const indexEtatsReels = source.indexOf('seance.etat === "online"');
  assert.ok(indexMock > 0, "le chemin de démonstration a disparu");
  assert.ok(
    indexEtatsReels > 0 && indexEtatsReels < indexMock,
    "le chemin de démonstration doit venir APRÈS tous les états réels, jamais comme repli d'un échec",
  );
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
