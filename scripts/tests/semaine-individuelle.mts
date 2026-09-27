/**
 * Harnais — LE CALENDRIER INDIVIDUEL D'UN ÉLÈVE, ET CE QUE LA CARTE EN DIT.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Que « Sem. X / Y » suit la DATE DE DÉBUT individuelle et rien d'autre ; que
 * deux élèves d'un même programme peuvent être à deux semaines différentes ;
 * que 35 jours donnent la semaine 6 et 28 la semaine 5 ; qu'une date future
 * affiche « À venir » et une date absente « — / Y » au lieu d'une semaine
 * inventée ; que « Terminé » passe devant le calendrier mais que le calendrier
 * ne termine rien ; et qu'une modification de date ne déplace pas d'un point le
 * pourcentage d'avancement.
 *
 * ⚠️ LE FUSEAU EST FORCÉ À Europe/Paris PAR LE SCRIPT NPM. Sans cela, les cas
 * de bascule seraient verts sans rien démontrer — même raison que dans
 * scripts/tests/calendrier-semaines.mts.
 *
 * Lancement : npm run test:semaine-individuelle
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ProgressionElevesProgramme } from "../../components/admin/ProgressionElevesProgramme";

import { progressionDuProgramme, type SeancePlanifiee } from "../../lib/progression-programme";
import {
  MESSAGE_DATE_ABSENTE,
  affichageSemaineDeLEleve,
  etatSemaineIndividuelle,
  numeroDeSemaine,
  semaineDepuis,
} from "../../lib/semaine-individuelle";

const lireSource = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sansCommentaires = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

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

const FUSEAU = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (FUSEAU !== "Europe/Paris") {
  console.error(
    `ARRÊT — fuseau « ${FUSEAU} » au lieu de Europe/Paris.\n` +
      "Lancer avec : npm run test:semaine-individuelle",
  );
  process.exit(1);
}

/* ── Fixtures ───────────────────────────────────────────────────────────── */

/** Un instant réel correspondant à une heure de PARIS. */
const aParis = (annee: number, mois: number, jour: number, h = 12) =>
  new Date(annee, mois - 1, jour, h, 0, 0, 0);

/** Le 27/09/2026, date de l'observation en production. */
const AUJOURDHUI = aParis(2026, 9, 27);

/** Le programme réel : 12 semaines × 4 séances + 3 jours de repos. */
function programme12x4(): SeancePlanifiee[] {
  const lignes: SeancePlanifiee[] = [];
  for (let semaine = 1; semaine <= 12; semaine += 1) {
    for (let n = 1; n <= 4; n += 1) lignes.push({ id: `s${semaine}-${n}`, weekNumber: semaine, isRestDay: false });
    for (let n = 1; n <= 3; n += 1) lignes.push({ id: `r${semaine}-${n}`, weekNumber: semaine, isRestDay: true });
  }
  return lignes;
}

const carte = (dateDebut: string | null, faites: readonly string[] = [], reference = AUJOURDHUI) => {
  const seances = programme12x4();
  const progression = progressionDuProgramme({ seances, seancesTerminees: new Set(faites) });
  return {
    progression,
    affichage: affichageSemaineDeLEleve({
      termine: progression.termine,
      dateDebut,
      durationWeeks: 12,
      reference,
    }),
  };
};

/* ════════════════════════════════════════════════════════════════════════
 * I. LA FORMULE — floor(jours / 7) + 1, ET ELLE NE VIT QU'À UN ENDROIT
 * ════════════════════════════════════════════════════════════════════════ */

test("FORMULE. jour 0 = semaine 1, jour 7 = semaine 2, et les bornes entre les deux", () => {
  const attendus: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 1], [6, 1],
    [7, 2], [13, 2],
    [14, 3], [20, 3],
    [21, 4], [27, 4],
    [28, 5], [34, 5],
    [35, 6],
    [70, 11],
  ];
  for (const [jours, semaine] of attendus) {
    assert.equal(numeroDeSemaine(jours), semaine, `J+${jours}`);
  }
});

test("SOURCE-UNIQUE. la formule n'est écrite QUE dans semaine-individuelle.ts", () => {
  /*
   * ⚠️ LE TEST QUI JUSTIFIE L'EXTRACTION. Avant ce lot, la fiche élève refaisait
   * `floor(jours/7)+1` à la main pendant que l'élève passait par
   * `computeCurrentWeekNumber` : deux implémentations de la même règle, qui ont
   * divergé et ont annoncé « Semaine 5 / 12 » à un élève en semaine 4. La carte
   * admin avait exactement le même besoin. Ce contrôle interdit la troisième.
   */
  const moduleSource = sansCommentaires(lireSource("../../lib/semaine-individuelle.ts"));
  const occurrences = moduleSource.match(/Math\.floor\([^)]*\/ 7\)/g) ?? [];
  assert.equal(occurrences.length, 1, "la formule apparaît plusieurs fois dans son propre module");

  for (const fichier of [
    "../../lib/training-schedule.ts",
    "../../components/admin/ProgressionElevesProgramme.tsx",
    "../../app/admin/programmes/page.tsx",
  ]) {
    const source = sansCommentaires(lireSource(fichier));
    assert.ok(
      !/Math\.floor\([^)]*\/ 7\)/.test(source),
      `la formule a été recopiée dans ${fichier} : deux implémentations vont diverger`,
    );
  }
  // Et `computeCurrentWeekNumber` appelle bien la source unique.
  const schedule = sansCommentaires(lireSource("../../lib/training-schedule.ts"));
  assert.match(schedule, /semaineDepuis\(referenceDate, reference\)/);
});

test("PURETÉ. le module ne lit rien, n'appelle aucune horloge, ne touche pas au réseau", () => {
  const source = lireSource("../../lib/semaine-individuelle.ts");
  assert.ok(!/currentDate\(/.test(source), "le module appelle l'horloge : il cesserait d'être déterministe");
  assert.ok(!/new Date\(/.test(source), "le module fabrique une date");
  assert.ok(!/supabase|fetch\(/.test(source), "le module lit des données");
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LES CAS DEMANDÉS — A à F
 * ════════════════════════════════════════════════════════════════════════ */

test("A. début 07/09/2026, au 27/09/2026 → Sem. 3 / 12", () => {
  const { affichage } = carte("2026-09-07");
  assert.equal(affichage.semaine, 3);
  assert.equal(affichage.etat, "en-cours");
  assert.equal(affichage.libelle, "Sem. 3 / 12");
});

test("B. début 21/09/2026, au 27/09/2026 → Sem. 1 / 12", () => {
  const { affichage } = carte("2026-09-21");
  assert.equal(affichage.semaine, 1);
  assert.equal(affichage.libelle, "Sem. 1 / 12");
});

test("C. MÊME PROGRAMME, deux élèves, deux semaines — jamais une valeur partagée", () => {
  /*
   * Le cas qui sépare l'option B de tout ce qui la précède : la semaine ne
   * dépend NI du programme, NI de la date du jour globale, mais de la ligne
   * `assignments` de chaque élève.
   */
  const eleveA = carte("2026-09-07");
  const eleveB = carte("2026-09-21");
  assert.equal(eleveA.affichage.semaine, 3);
  assert.equal(eleveB.affichage.semaine, 1);
  assert.notEqual(eleveA.affichage.libelle, eleveB.affichage.libelle);
  // Et les deux Y sont identiques : c'est le même programme.
  assert.equal(eleveA.affichage.total, 12);
  assert.equal(eleveB.affichage.total, 12);
});

test("D. 28 jours → semaine 5 ; 35 jours → semaine 6", () => {
  // 27/09 − 28 j = 30/08 ; 27/09 − 35 j = 23/08.
  assert.equal(carte("2026-08-30").affichage.semaine, 5, "28 jours");
  assert.equal(carte("2026-08-23").affichage.semaine, 6, "35 jours");
  // Les bornes de la semaine 5, des deux côtés.
  assert.equal(carte("2026-08-31").affichage.semaine, 4, "27 jours → encore la semaine 4");
  assert.equal(carte("2026-08-24").affichage.semaine, 5, "34 jours → encore la semaine 5");
});

test("E. date FUTURE → « À venir », jamais « Sem. 1 »", () => {
  const demain = carte("2026-09-28");
  assert.equal(demain.affichage.etat, "a-venir");
  assert.equal(demain.affichage.libelle, "À venir");
  assert.equal(demain.affichage.semaine, null);
  // Le jour même, en revanche, est bien la semaine 1 — pas « à venir ».
  const aujourdhui = carte("2026-09-27");
  assert.equal(aujourdhui.affichage.etat, "en-cours");
  assert.equal(aujourdhui.affichage.semaine, 1);
});

test("F. date ABSENTE → « — / 12 » et un état nommé, jamais une semaine devinée", () => {
  const sansDate = carte(null);
  assert.equal(sansDate.affichage.etat, "sans-date");
  assert.equal(sansDate.affichage.libelle, "— / 12");
  assert.equal(sansDate.affichage.semaine, null);
  assert.equal(MESSAGE_DATE_ABSENTE, "Date de début non renseignée");
  // Une date illisible n'est pas non plus une semaine.
  const illisible = affichageSemaineDeLEleve({
    termine: false,
    dateDebut: "pas une date",
    durationWeeks: 12,
    reference: AUJOURDHUI,
  });
  assert.equal(illisible.etat, "date-illisible");
  assert.equal(illisible.libelle, "— / 12");
});

test("F-bis. NÉGATIF — students.start_date ne peut plus servir de repli sur la carte", () => {
  /*
   * ⚠️ LE SABOTAGE VISÉ. 12 des 19 affectations de production n'ont pas de date ;
   * elles retombaient en silence sur `students.start_date`, dont le défaut SQL
   * est `CURRENT_DATE` — c'est-à-dire la date d'inscription. Une élève inscrite
   * cinq semaines plus tôt et démarrant lundi lisait « Semaine 5 / 12 ».
   *
   * Le contrôle est double : comportemental (aucune date → « — / Y », quelle que
   * soit la référence) et structurel (le chemin de la carte ne mentionne nulle
   * part une date d'élève).
   */
  for (const reference of [aParis(2026, 1, 1), AUJOURDHUI, aParis(2027, 6, 30)]) {
    assert.equal(carte(null, [], reference).affichage.libelle, "— / 12");
  }
  const moduleSource = sansCommentaires(lireSource("../../lib/semaine-individuelle.ts"));
  assert.ok(!/startDate|start_date/.test(moduleSource), "le module connaît une date d'élève");
  const composant = sansCommentaires(lireSource("../../components/admin/ProgressionElevesProgramme.tsx"));
  assert.ok(!/startDate|start_date/.test(composant), "la carte lit une date d'élève");
});

/* ════════════════════════════════════════════════════════════════════════
 * III. « TERMINÉ », ET LE POURCENTAGE — J, K, L
 * ════════════════════════════════════════════════════════════════════════ */

const TOUTES = programme12x4().filter((s) => !s.isRestDay).map((s) => s.id);

test("J. 48/48 terminées en semaine calendaire 7 → « Terminé »", () => {
  // 27/09 − 42 j = 16/08 → semaine 7.
  const { progression, affichage } = carte("2026-08-16", TOUTES);
  assert.deepEqual(etatSemaineIndividuelle("2026-08-16", 12, AUJOURDHUI), { etat: "en-cours", semaine: 7 });
  assert.equal(progression.seancesTerminees, 48);
  assert.equal(progression.termine, true);
  assert.equal(affichage.libelle, "Terminé", "le calendrier ne doit pas masquer un programme fini");
  assert.equal(affichage.etat, "termine");
});

test("K. 47/48 en semaine calendaire 12 → PAS « Terminé »", () => {
  // 27/09 − 77 j = 12/07 → semaine 12.
  const { progression, affichage } = carte("2026-07-12", TOUTES.slice(0, 47));
  assert.equal(progression.seancesTerminees, 47);
  assert.equal(progression.termine, false);
  assert.equal(affichage.libelle, "Sem. 12 / 12");
  assert.notEqual(affichage.libelle, "Terminé", "une date n'achève pas un programme");
});

test("K-bis. la semaine ne dépasse JAMAIS durationWeeks", () => {
  // 27/09/2026 − 01/01/2026 = 269 jours → semaine 39 « brute ».
  assert.equal(semaineDepuis("2026-01-01", AUJOURDHUI), 39);
  const { affichage } = carte("2026-01-01");
  assert.equal(affichage.semaine, 12, "la semaine brute doit être bornée par la durée déclarée");
  assert.equal(affichage.libelle, "Sem. 12 / 12");
});

test("L. MODIFIER LA DATE NE DÉPLACE PAS LE POURCENTAGE D'UN POINT", () => {
  /*
   * ⚠️ LA SÉPARATION DES DEUX NOTIONS, GARDÉE PAR UN TEST. La barre de
   * progression compte du TRAVAIL, le libellé compte du TEMPS. Si un jour l'un
   * contamine l'autre, c'est ici que ça se voit.
   */
  const faites = ["s1-1", "s2-1", "s2-2", "s4-1"];
  const dates = ["2026-09-07", "2026-09-21", "2026-08-23", null, "2026-09-28", "2027-01-01"];
  const references = dates.map((date) => carte(date, faites));
  const attendu = references[0]!.progression;
  for (const { progression } of references) {
    assert.equal(progression.seancesTerminees, attendu.seancesTerminees);
    assert.equal(progression.seancesPrevues, attendu.seancesPrevues);
    assert.equal(progression.pourcentage, attendu.pourcentage);
  }
  assert.equal(attendu.seancesTerminees, 4);
  assert.equal(attendu.seancesPrevues, 48);
  assert.equal(attendu.pourcentage, 8);
  // Et les libellés, eux, DIFFÈRENT : c'est bien la date qui bouge.
  const libelles = new Set(references.map((r) => r.affichage.libelle));
  assert.ok(libelles.size >= 4, "les libellés ne suivent pas la date");
});

test("L-bis. le cas de production — 4 séances éparpillées, la semaine avance quand même", () => {
  /*
   * Mesuré le 27/09/2026 sur la copie de Jules Favier : semaine 1 → 1/4,
   * semaine 2 → 2/4, semaine 4 → 1/4, début 07/09. L'ancienne règle affichait
   * « Sem. 1 / 12 » (première semaine inachevée) ; la nouvelle affiche la
   * semaine du calendrier. Une séance en retard ne bloque plus rien.
   */
  const { progression, affichage } = carte("2026-09-07", ["s1-1", "s2-1", "s2-2", "s4-1"]);
  assert.equal(affichage.libelle, "Sem. 3 / 12");
  assert.equal(progression.pourcentage, 8, "le pourcentage, lui, reste celui du travail fait");
  assert.equal(progression.semaineDeProgression, 1, "l'ancienne notion existe toujours — elle n'est plus affichée");
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. Y = durationWeeks, PLUS JAMAIS semainesPlanifiees
 * ════════════════════════════════════════════════════════════════════════ */

test("Y1. un programme déclaré 12 semaines dont 6 seulement sont construites affiche « / 12 »", () => {
  /*
   * ⚠️ LE SABOTAGE VISÉ : reprendre `semainesPlanifiees` comme dénominateur.
   * Il vaut 6 ici, et la semaine calendaire 9 donnerait « Sem. 9 / 6 » — un
   * libellé qui ne veut rien dire. Décision du 27/09/2026 : Y = durationWeeks.
   */
  const seances: SeancePlanifiee[] = [];
  for (let semaine = 1; semaine <= 6; semaine += 1) {
    for (let n = 1; n <= 4; n += 1) seances.push({ id: `s${semaine}-${n}`, weekNumber: semaine, isRestDay: false });
  }
  const progression = progressionDuProgramme({ seances, seancesTerminees: new Set() });
  assert.equal(progression.semainesPlanifiees, 6, "la fixture doit bien diverger de la durée déclarée");
  // 27/09 − 56 j = 02/08 → semaine 9.
  const affichage = affichageSemaineDeLEleve({
    termine: false,
    dateDebut: "2026-08-02",
    durationWeeks: 12,
    reference: AUJOURDHUI,
  });
  assert.equal(affichage.libelle, "Sem. 9 / 12");
  assert.notEqual(affichage.libelle, "Sem. 9 / 6");
});

test("Y2. STRUCTUREL — la carte n'utilise plus semainesPlanifiees ni libelleProgression", () => {
  const composant = sansCommentaires(lireSource("../../components/admin/ProgressionElevesProgramme.tsx"));
  assert.ok(!/semainesPlanifiees/.test(composant), "semainesPlanifiees est redevenu le dénominateur");
  assert.ok(!/libelleProgression/.test(composant), "l'ancien libellé « première semaine inachevée » est revenu");
  assert.ok(/durationWeeks/.test(composant), "la durée déclarée n'atteint plus la carte");
});

test("Y3. une durée absurde ne produit jamais « / 0 » ni « / NaN »", () => {
  for (const duree of [0, -5, Number.NaN, 1.7]) {
    const affichage = affichageSemaineDeLEleve({
      termine: false,
      dateDebut: "2026-09-07",
      durationWeeks: duree,
      reference: AUJOURDHUI,
    });
    assert.ok(affichage.total >= 1, `total invalide pour durationWeeks=${duree}`);
    assert.ok(!Number.isNaN(affichage.total));
    assert.ok(!affichage.libelle.includes("NaN"), affichage.libelle);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * V. M — MODÈLE ET COPIE : LA CARTE DU MODÈLE SE TAIT
 * ════════════════════════════════════════════════════════════════════════ */

test("M1. la progression d'un élève n'est JAMAIS calculée sur les séances du modèle", () => {
  /*
   * ⚠️ MESURÉ EN PRODUCTION LE 27/09/2026. Le même élève et le même programme
   * portent DEUX comptes différents : 2 complétions sur les séances du modèle
   * (antérieures à sa copie), 4 sur celles de sa copie. Le modèle et la copie
   * ont 84 lignes chacun, avec des identifiants distincts — croiser les
   * complétions de l'un avec les séances de l'autre produit un chiffre qui ne
   * décrit personne.
   *
   * `loadProgramsSummary` liste donc ces élèves dans `assignedViaCopyStudentIds`,
   * et la carte du modèle les NOMME sans les chiffrer.
   */
  const programs = sansCommentaires(lireSource("../../lib/supabase/programs.ts"));
  assert.match(programs, /assignedViaCopyStudentIds/, "la liste n'est plus calculée");
  assert.match(
    programs,
    /\.filter\(\(studentId\) => !elevesDirects\.has\(studentId\)\)/,
    "les élèves affectés DIRECTEMENT seraient exclus à tort, ou les propriétaires de copie inclus à tort",
  );
  // La date, elle, ne vient que des affectations directes : une copie n'en fournit
  // pas sur la carte du modèle.
  assert.match(programs, /affectationsDirectes\.map\(\(a\) => \[a\.student_id, a\.program_start_date \?\? null\]/);

  const composant = sansCommentaires(lireSource("../../components/admin/ProgressionElevesProgramme.tsx"));
  assert.match(composant, /elevesSansSeancesIndividuelles/, "la carte ignore la liste");
  assert.match(
    composant,
    /!sansSeances\.has\(eleve\.id\)/,
    "la carte chiffre encore des élèves dont elle n'a pas les séances",
  );
});

test("M2. COMPORTEMENTAL — les complétions d'une copie ne comptent pas sur les séances du modèle", () => {
  // Les identifiants de la copie ne recoupent PAS ceux du modèle.
  const modele = programme12x4();
  const completionsSurLaCopie = new Set(["copie-s1-1", "copie-s1-2", "copie-s1-3", "copie-s1-4"]);
  const progression = progressionDuProgramme({ seances: modele, seancesTerminees: completionsSurLaCopie });
  assert.equal(progression.seancesTerminees, 0, "des complétions étrangères ont été comptées");
  assert.equal(progression.pourcentage, 0);
  assert.equal(progression.termine, false);
  // Et c'est bien pour cela que la carte du modèle doit se taire plutôt que
  // d'afficher ce 0 % comme s'il décrivait l'élève.
});

test("M3. un élève affecté DIRECTEMENT reste chiffré — la règle n'assèche pas la carte de sa copie", () => {
  const { progression, affichage } = carte("2026-09-07", ["s1-1", "s1-2", "s1-3", "s1-4"]);
  assert.equal(progression.seancesTerminees, 4);
  assert.equal(affichage.libelle, "Sem. 3 / 12");
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. LA CARTE RENDUE — ce que le coach lit vraiment
 * ════════════════════════════════════════════════════════════════════════ */

const eleve = (id: string, prenom: string, nom: string) =>
  ({ id, firstName: prenom, lastName: nom, startDate: "2026-01-01" }) as never;

/**
 * ⚠️ `renderToString` SÉPARE DEUX EXPRESSIONS VOISINES PAR `<!-- -->`.
 * `{prenom} {nom}` sort donc en « Jules<!-- --> <!-- -->Favier », et un test qui
 * chercherait « Jules Favier » échouerait pour une raison qui n'existe pas dans
 * le navigateur. On retire ces marqueurs, et RIEN d'autre.
 */
function rendre(surcharge: Partial<Parameters<typeof ProgressionElevesProgramme>[0]> = {}): string {
  return sansMarqueursReact(renderToString(
    createElement(ProgressionElevesProgramme, {
      sessions: programme12x4().map((s) => ({ id: s.id, weekNumber: s.weekNumber, isRestDay: s.isRestDay })),
      eleves: [eleve("jules", "Jules", "Favier")],
      seancesParEleve: new Map([["jules", new Set<string>()]]),
      complet: true,
      chargement: false,
      durationWeeks: 12,
      debutParEleve: new Map([["jules", "2026-09-07"]]),
      elevesSansSeancesIndividuelles: [],
      reference: AUJOURDHUI,
      ...surcharge,
    } as Parameters<typeof ProgressionElevesProgramme>[0]),
  ));
}

const sansMarqueursReact = (html: string) => html.replace(/<!-- -->/g, "");

test("RENDU1. le cas signalé — début 07/09, rien de validé → « Sem. 3 / 12 », plus « Sem. 1 / 12 »", () => {
  const html = rendre();
  assert.ok(html.includes("Jules Favier"), "le nom doit rester affiché");
  assert.ok(html.includes("Sem. 3 / 12"), html);
  assert.ok(!html.includes("Sem. 1 / 12"), "l'ancienne règle est revenue");
  assert.ok(/semaine 3 sur 12/.test(html), "le libellé accessible ne dit pas la valeur");
});

test("RENDU2. date absente → « — / 12 » et l'état est dit au survol comme au lecteur d'écran", () => {
  const html = rendre({ debutParEleve: new Map([["jules", null]]) });
  assert.ok(html.includes("— / 12"), html);
  assert.ok(html.includes(MESSAGE_DATE_ABSENTE), "l'état n'est pas explicite");
  assert.ok(!/semaine \d+ sur/.test(html), "une semaine est annoncée alors qu'aucune n'est connue");
});

test("RENDU3. date future → « À venir »", () => {
  const html = rendre({ debutParEleve: new Map([["jules", "2026-09-28"]]) });
  assert.ok(html.includes("À venir"), html);
  assert.ok(!html.includes("Sem. 1"), "« pas encore commencé » ne doit pas se lire « semaine 1 »");
});

test("RENDU4. 48/48 en semaine 7 → « Terminé »", () => {
  const html = rendre({
    debutParEleve: new Map([["jules", "2026-08-16"]]),
    seancesParEleve: new Map([["jules", new Set(TOUTES)]]),
  });
  assert.ok(html.includes("Terminé"), html);
  assert.ok(!html.includes("Sem. 7"), "le calendrier masque un programme fini");
});

test("RENDU5. M — un propriétaire de COPIE est NOMMÉ sans être chiffré sur la carte du modèle", () => {
  /*
   * ⚠️ LE TEST QUI AURAIT ATTRAPÉ LE DÉFAUT DE LA PR PRÉCÉDENTE. Sur la carte
   * d'un modèle, l'élève apparaît parce qu'il possède une copie ; ses séances
   * sont ailleurs. La carte doit dire son nom et se taire sur son avancement.
   */
  const html = rendre({
    eleves: [eleve("jules", "Jules", "Favier"), eleve("naila", "Naila", "Nachkoroh")],
    seancesParEleve: new Map([
      ["jules", new Set<string>()],
      ["naila", new Set<string>()],
    ]),
    debutParEleve: new Map([["jules", "2026-09-07"]]),
    elevesSansSeancesIndividuelles: ["naila"],
  });
  assert.ok(html.includes("Naila Nachkoroh"), "l'élève doit rester visible");
  assert.equal((html.match(/Sem\. /g) ?? []).length, 1, "un seul libellé de semaine : celui de l'élève direct");
  assert.ok(html.includes("Sem. 3 / 12"), "l'élève affecté directement doit garder son avancement");
  assert.ok(!html.includes("— / 12"), "un élève sans séances ici ne doit produire AUCUN libellé, pas même « — »");
});

test("RENDU6. une lecture incomplète fait taire la carte, semaine comprise", () => {
  const html = rendre({ complet: false });
  assert.ok(html.includes("Jules Favier"));
  assert.ok(!html.includes("Sem."), "un chiffre est affiché alors que les complétions sont inconnues");
  const pendant = rendre({ chargement: true });
  assert.ok(!pendant.includes("Sem."), "un chiffre est affiché pendant le chargement");
});

test("RENDU7. deux élèves du même programme, deux semaines différentes, dans la même carte", () => {
  const html = rendre({
    eleves: [eleve("a", "Élève", "A"), eleve("b", "Élève", "B")],
    seancesParEleve: new Map([
      ["a", new Set<string>()],
      ["b", new Set<string>()],
    ]),
    debutParEleve: new Map([
      ["a", "2026-09-07"],
      ["b", "2026-09-21"],
    ]),
  });
  assert.ok(html.includes("Sem. 3 / 12"), html);
  assert.ok(html.includes("Sem. 1 / 12"), html);
});

/* ── Épilogue ───────────────────────────────────────────────────────────── */

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
