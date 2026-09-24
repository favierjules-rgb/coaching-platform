/**
 * Harnais — LA PROGRESSION SE COMPTE EN SÉANCES TERMINÉES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Qu'une séance prévue et non faite ne compte pas ; qu'un retour envoyé sans
 * la case « Séance terminée » ne compte pas ; que le dénominateur suit l'état
 * ACTUEL du programme (ajout, suppression, modification) ; que 100 % n'arrive
 * qu'à la dernière séance validée ; et que la semaine courante est la première
 * semaine encore inachevée, jamais un numéro dérivé de la date.
 *
 * ⚠️ LE TEST CENTRAL EST CELUI QUI SÉPARE LES DEUX FORMULES (test 12). Sur un
 * programme de 4 semaines dont l'élève a fini la première, l'ancienne règle
 * (semaine calendaire ÷ durée) et la nouvelle ne rendent pas le même nombre.
 * Un test construit sur un cas où les deux coïncident ne prouverait rien.
 *
 * Lancement : npm run test:progression-programme
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  libelleProgression,
  progressionDuProgramme,
  type SeancePlanifiee,
} from "../../lib/progression-programme";

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

/* ─── Fabriques ─── */

/** Une semaine : `seances` séances réelles + `repos` jours de repos. */
function semaine(weekNumber: number, seances: number, repos = 0): SeancePlanifiee[] {
  const lignes: SeancePlanifiee[] = [];
  for (let n = 1; n <= seances; n += 1) {
    lignes.push({ id: `s${weekNumber}-${n}`, weekNumber, isRestDay: false });
  }
  for (let n = 1; n <= repos; n += 1) {
    lignes.push({ id: `r${weekNumber}-${n}`, weekNumber, isRestDay: true });
  }
  return lignes;
}

/** Un programme de 4 semaines × 3 séances + 4 jours de repos par semaine. */
function programme4x3(): SeancePlanifiee[] {
  return [semaine(1, 3, 4), semaine(2, 3, 4), semaine(3, 3, 4), semaine(4, 3, 4)].flat();
}

const calculer = (seances: readonly SeancePlanifiee[], terminees: readonly string[]) =>
  progressionDuProgramme({ seances, seancesTerminees: new Set(terminees) });

/* ─── Les tests ─── */

test("1. ZÉRO séance terminée — 0 %, semaine 1, jamais « terminé »", () => {
  const p = calculer(programme4x3(), []);
  assert.equal(p.seancesPrevues, 12, "les jours de repos ne sont pas des séances");
  assert.equal(p.seancesTerminees, 0);
  assert.equal(p.pourcentage, 0);
  assert.equal(p.semaineDeProgression, 1);
  assert.equal(p.termine, false);
  assert.equal(libelleProgression(p), "Sem. 1 / 4");
});

test("2. UNE séance terminée — une fraction, pas un saut de semaine", () => {
  const p = calculer(programme4x3(), ["s1-1"]);
  assert.equal(p.seancesTerminees, 1);
  assert.equal(p.pourcentage, 8, "1/12 = 8 %");
  assert.equal(p.semaineDeProgression, 1, "la semaine 1 n'est pas finie : on y reste");
});

test("3. SEMAINE PARTIELLEMENT terminée — la semaine ne bascule pas", () => {
  const p = calculer(programme4x3(), ["s1-1", "s1-2"]);
  assert.equal(p.pourcentage, 17, "2/12 = 17 %");
  assert.equal(
    p.semaineDeProgression,
    1,
    "il reste une séance en semaine 1 : passer en semaine 2 serait faux",
  );
});

test("4. TOUTE une semaine terminée — et là seulement, la semaine suivante", () => {
  const p = calculer(programme4x3(), ["s1-1", "s1-2", "s1-3"]);
  assert.equal(p.pourcentage, 25);
  assert.equal(p.semaineDeProgression, 2);
  assert.equal(p.termine, false);
});

test("5. PLUSIEURS semaines terminées", () => {
  const p = calculer(programme4x3(), [
    "s1-1", "s1-2", "s1-3",
    "s2-1", "s2-2", "s2-3",
    "s3-1", "s3-2", "s3-3",
  ]);
  assert.equal(p.pourcentage, 75);
  assert.equal(p.semaineDeProgression, 4);
  assert.equal(libelleProgression(p), "Sem. 4 / 4");
});

test("6. UN TROU dans une semaine passée retient la semaine courante", () => {
  // Semaines 2 et 3 finies, mais une séance de la semaine 1 manque : la
  // PREMIÈRE semaine inachevée est la 1, pas la 4.
  const p = calculer(programme4x3(), [
    "s1-1", "s1-2",
    "s2-1", "s2-2", "s2-3",
    "s3-1", "s3-2", "s3-3",
  ]);
  assert.equal(p.semaineDeProgression, 1, "la semaine courante est la première inachevée");
  assert.equal(p.pourcentage, 67);
});

test("7. PROGRAMME ENTIÈREMENT terminé — 100 %, état terminé, plus de semaine", () => {
  const seances = programme4x3();
  const p = calculer(seances, seances.filter((s) => !s.isRestDay).map((s) => s.id));
  assert.equal(p.pourcentage, 100);
  assert.equal(p.termine, true);
  assert.equal(p.semaineDeProgression, null);
  assert.equal(libelleProgression(p), "Terminé");
});

test("8. AJOUT d'une séance — nouveau dénominateur, pourcentage qui BAISSE", () => {
  const avant = calculer(programme4x3(), ["s1-1", "s1-2", "s1-3"]);
  const apres = calculer(
    [...programme4x3(), { id: "s4-4", weekNumber: 4, isRestDay: false }],
    ["s1-1", "s1-2", "s1-3"],
  );
  assert.equal(avant.seancesPrevues, 12);
  assert.equal(apres.seancesPrevues, 13, "la séance ajoutée entre au dénominateur");
  assert.equal(avant.pourcentage, 25);
  assert.equal(apres.pourcentage, 23, "3/13 = 23 % : le pourcentage doit bouger");
  assert.ok(apres.pourcentage < avant.pourcentage);
});

test("9. AJOUT d'une séance dans une semaine DÉJÀ finie — elle redevient courante", () => {
  const p = calculer(
    [...programme4x3(), { id: "s1-4", weekNumber: 1, isRestDay: false }],
    ["s1-1", "s1-2", "s1-3"],
  );
  assert.equal(p.semaineDeProgression, 1, "une séance neuve est NON terminée par construction");
});

test("10. SUPPRESSION d'une séance — elle cesse de compter des deux côtés", () => {
  const reduit = programme4x3().filter((s) => s.id !== "s2-3");
  const p = calculer(reduit, ["s1-1", "s1-2", "s1-3", "s2-1", "s2-2", "s2-3"]);
  assert.equal(p.seancesPrevues, 11, "la séance supprimée quitte le dénominateur");
  assert.equal(
    p.seancesTerminees,
    5,
    "sa complétion quitte AUSSI le numérateur : compter une séance qui n'existe plus pourrait donner plus de 100 %",
  );
  assert.equal(p.pourcentage, 45);
  assert.ok(p.pourcentage <= 100);
});

test("11. SUPPRESSION de la dernière séance NON faite — le programme devient terminé", () => {
  const seances = programme4x3();
  const faites = seances.filter((s) => !s.isRestDay && s.id !== "s4-3").map((s) => s.id);
  assert.equal(calculer(seances, faites).termine, false);
  const sansLaDerniere = seances.filter((s) => s.id !== "s4-3");
  assert.equal(calculer(sansLaDerniere, faites).termine, true);
  assert.equal(calculer(sansLaDerniere, faites).pourcentage, 100);
});

test("12. MODIFICATION d'une séance — la complétion survit à l'identité conservée", () => {
  // Même id, tout le reste change (le coach a renommé la séance, changé les
  // exercices…) : `diffProgramStructure` préserve l'id, la complétion suit.
  const modifie = programme4x3().map((s) => (s.id === "s1-1" ? { ...s, weekNumber: 1 } : s));
  const p = calculer(modifie, ["s1-1"]);
  assert.equal(p.seancesTerminees, 1, "modifier une séance ne doit pas effacer sa complétion");

  // Et si l'identité change (séance recréée sous un nouvel id), la complétion
  // ne suit pas — c'est la limite connue, testée pour qu'elle reste consciente.
  const recree = programme4x3().map((s) => (s.id === "s1-1" ? { ...s, id: "s1-1-bis" } : s));
  assert.equal(calculer(recree, ["s1-1"]).seancesTerminees, 0);
});

test("13. LA PROGRESSION N'EST PAS LA SEMAINE CALENDAIRE — les deux formules divergent", () => {
  /*
   * Le cas qui sépare les deux règles : 4 semaines, l'élève a fini la semaine 1
   * et rien d'autre. L'ancienne formule (semaine calendaire ÷ durée) rendrait
   * 25 % en semaine 1, 50 % en semaine 2, etc. — sans qu'aucune séance de plus
   * ne soit faite. La nouvelle reste à 25 % tant que rien n'est validé.
   */
  const faites = ["s1-1", "s1-2", "s1-3"];
  const p = calculer(programme4x3(), faites);
  for (const semaineCalendaire of [1, 2, 3, 4]) {
    const ancienne = Math.round((Math.min(semaineCalendaire, 4) / 4) * 100);
    if (semaineCalendaire === 1) continue; // le seul point où elles coïncident
    assert.notEqual(
      p.pourcentage,
      ancienne,
      `semaine calendaire ${semaineCalendaire} : la progression ne doit pas suivre le calendrier`,
    );
  }
  assert.equal(p.pourcentage, 25, "3 séances sur 12, quelle que soit la date");
});

test("14. RETOUR ENVOYÉ SANS la case « Séance terminée » — il ne compte pas", () => {
  // Le harnais ne peut pas cocher une case : ce que le module reçoit, c'est
  // l'ensemble des séances TERMINÉES. Une séance dont le retour existe mais
  // n'est pas validé n'y figure simplement pas — et c'est la seule chose à
  // prouver : rien d'autre que cet ensemble n'entre dans le numérateur.
  const p = calculer(programme4x3(), []);
  assert.equal(p.seancesTerminees, 0);
  const avecUnIdInconnu = calculer(programme4x3(), ["retour-sans-seance", "s1-1"]);
  assert.equal(
    avecUnIdInconnu.seancesTerminees,
    1,
    "un identifiant qui ne correspond à aucune séance du programme ne gonfle pas le numérateur",
  );
});

test("15. COMPLÉTIONS ORPHELINES — 40 identifiants morts ne changent rien", () => {
  // Mesuré en production : 40 retours complets dont le `session_id` est nul et
  // le `session_key` ne correspond à aucune séance. Ils ne doivent ni compter,
  // ni faire dépasser 100 %.
  const orphelins = Array.from({ length: 40 }, (_, i) => `orphelin-${i}`);
  const seances = programme4x3();
  const tout = seances.filter((s) => !s.isRestDay).map((s) => s.id);
  const p = calculer(seances, [...tout, ...orphelins]);
  assert.equal(p.seancesTerminees, 12);
  assert.equal(p.pourcentage, 100);
  assert.ok(p.pourcentage <= 100, "un orphelin ne doit jamais produire 433 %");
});

test("16. SEMAINE 100 % REPOS — elle n'est jamais la semaine courante", () => {
  const seances = [semaine(1, 2), semaine(2, 0, 7), semaine(3, 2)].flat();
  const p = calculer(seances, ["s1-1", "s1-2"]);
  assert.equal(p.seancesPrevues, 4);
  assert.equal(
    p.semaineDeProgression,
    3,
    "la semaine 2 ne contient rien à terminer : s'y arrêter bloquerait la progression",
  );
  assert.equal(p.semainesPlanifiees, 3, "elle reste une semaine planifiée, en revanche");
});

test("17. PROGRAMME SANS AUCUNE SÉANCE — 0 %, pas 100 %", () => {
  const p = calculer([], []);
  assert.equal(p.seancesPrevues, 0);
  assert.equal(p.pourcentage, 0, "rien à terminer n'est pas « tout terminé »");
  assert.equal(p.termine, false);
  assert.equal(p.semaineDeProgression, null);
  assert.equal(libelleProgression(p), "—");

  // Un programme fait uniquement de jours de repos, de même.
  const reposSeulement = calculer(semaine(1, 0, 7), []);
  assert.equal(reposSeulement.pourcentage, 0);
  assert.equal(reposSeulement.termine, false);
});

test("18. DOUBLONS d'identifiant — une séance ne compte qu'une fois", () => {
  const seances = [...semaine(1, 2), ...semaine(1, 2)];
  const p = calculer(seances, ["s1-1"]);
  assert.equal(p.seancesPrevues, 2, "le même id deux fois reste une seule séance");
  assert.equal(p.pourcentage, 50);
});

test("19. PLUSIEURS ÉLÈVES — des progressions différentes, jamais moyennées", () => {
  const seances = programme4x3();
  const alice = calculer(seances, ["s1-1", "s1-2", "s1-3"]);
  const bruno = calculer(seances, []);
  const chloe = calculer(seances, seances.filter((s) => !s.isRestDay).map((s) => s.id));

  assert.deepEqual(
    [alice.pourcentage, bruno.pourcentage, chloe.pourcentage],
    [25, 0, 100],
    "chaque élève garde SA progression",
  );
  assert.deepEqual(
    [libelleProgression(alice), libelleProgression(bruno), libelleProgression(chloe)],
    ["Sem. 2 / 4", "Sem. 1 / 4", "Terminé"],
  );
  // Et surtout : aucune moyenne ne doit pouvoir être confondue avec l'une des trois.
  const moyenne = Math.round((25 + 0 + 100) / 3);
  assert.notEqual(moyenne, alice.pourcentage);
  assert.notEqual(moyenne, bruno.pourcentage);
  assert.notEqual(moyenne, chloe.pourcentage);
});

test("20. LE MODULE EST PUR — aucune lecture, aucune date, aucun réseau", () => {
  const source = readFileSync("lib/progression-programme.ts", "utf8");
  const corps = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const interdit of ["supabase", "fetch(", "new Date", "Date.now", "durationWeeks", "weekNumber ="]) {
    assert.ok(!corps.includes(interdit), `le module pur ne doit pas contenir \`${interdit}\``);
  }
  // Et il ne doit pas importer la semaine calendaire : ce serait rouvrir la
  // confusion que ce module existe pour fermer.
  assert.ok(
    !corps.includes("computeCurrentWeekNumber") && !corps.includes("training-schedule"),
    "la progression ne doit dépendre d'aucune semaine calendaire",
  );
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
