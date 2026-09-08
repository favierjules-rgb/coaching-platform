/**
 * Harnais — LA SEMAINE D'UN PROGRAMME, ET LA DATE DONT ELLE DÉPEND.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Qu'un programme individuel se compte depuis SA date de début et non depuis
 * l'inscription de l'élève ; qu'un programme de groupe garde son calendrier
 * partagé ; qu'une affectation sans date retombe sur un repli NOMMÉ plutôt que
 * silencieux ; que la semaine bascule à MINUIT et non à 02:00 ; et qu'un seul
 * bloc de semaine porte le repère « aujourd'hui ».
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE CAS DE RÉFÉRENCE — ERWAN
 * ════════════════════════════════════════════════════════════════════════
 * Mesuré en production le 08/09/2026 : l'élève, inscrit le 11/08, a reçu son
 * programme le 27/08 pour un démarrage réel le 17/08. L'application lui
 * annonçait « Semaine 5 / 12 ». La réponse est 4. Le test ERWAN ci-dessous
 * échoue avec l'ancienne ancre et réussit avec la nouvelle.
 *
 * ⚠️ LE FUSEAU EST FORCÉ À Europe/Paris PAR LE SCRIPT NPM. Sans cela, un
 * conteneur en UTC rendrait les tests de bascule à minuit toujours verts —
 * ils ne prouveraient rien, puisque le défaut n'existe qu'avec un décalage.
 *
 * Lancement : npm run test:calendrier-semaines
 */
import assert from "node:assert/strict";

import { daysBetween, studentsWithoutRecentLogin } from "../../lib/admin";
import {
  ancreDeSemaine,
  buildScheduleForWeek,
  computeCurrentWeekNumber,
} from "../../lib/training-schedule";
import type { AdminProgram, AdminStudent } from "../../types";

import { readFileSync } from "node:fs";

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

/* ── Garde-fou : sans le bon fuseau, la moitié de ce fichier ne prouve rien ── */

const FUSEAU = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (FUSEAU !== "Europe/Paris") {
  console.error(
    `ARRÊT — fuseau « ${FUSEAU} » au lieu de Europe/Paris.\n` +
      "Les tests de bascule à minuit seraient verts sans rien démontrer.\n" +
      "Lancer avec : npm run test:calendrier-semaines",
  );
  process.exit(1);
}

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const programme = (surcharge: Partial<AdminProgram> = {}): AdminProgram =>
  ({
    id: "prog-1",
    name: "ERWAN",
    goal: "",
    level: "",
    durationWeeks: 12,
    description: "",
    status: "actif",
    assignedStudentIds: [],
    sessions: [],
    createdAt: "2026-08-27",
    updatedAt: "2026-08-27",
    programMode: "individuel",
    ...surcharge,
  }) as unknown as AdminProgram;

const eleve = (startDate: string): AdminStudent => ({ startDate }) as AdminStudent;

/** Un instant réel correspondant à une heure de PARIS. */
function aParis(annee: number, mois: number, jour: number, h = 12, m = 0): Date {
  // On construit par sondage : `Date` interprète les composants en heure
  // locale du runtime, qui EST Paris (garde-fou ci-dessus).
  return new Date(annee, mois - 1, jour, h, m, 0, 0);
}

const DEBUT = "2026-08-10"; // un lundi

/* ════════════════════════════════════════════════════════════════════════
 * I. LA FORMULE — elle était juste, elle le reste
 * ════════════════════════════════════════════════════════════════════════ */

const progressions: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 1],
  [6, 1],
  [7, 2],
  [13, 2],
  [14, 3],
  [21, 4],
  [70, 11],
];

for (const [jours, attendue] of progressions) {
  test(`CAL${String(jours).padStart(2, "0")}. J+${jours} depuis le début → semaine ${attendue}`, () => {
    const ref = aParis(2026, 8, 10 + jours);
    const obtenue = computeCurrentWeekNumber(
      programme({ programStartDate: DEBUT }),
      eleve("2000-01-01"),
      ref,
    );
    assert.equal(obtenue, attendue);
  });
}

test("CAL-AVANT. une date ANTÉRIEURE au début rend la semaine 1, jamais 0 ni négatif", () => {
  const ref = aParis(2026, 8, 3);
  assert.equal(
    computeCurrentWeekNumber(programme({ programStartDate: DEBUT }), eleve("2000-01-01"), ref),
    1,
  );
});

test("CAL-BORNE. la semaine est bornée par durationWeeks", () => {
  // J+200 sur un programme de 12 semaines : sans borne, semaine 29.
  const ref = aParis(2027, 2, 26);
  assert.equal(
    computeCurrentWeekNumber(
      programme({ programStartDate: DEBUT, durationWeeks: 12 }),
      eleve("2000-01-01"),
      ref,
    ),
    12,
  );
  // ⚠️ ET LA BORNE NE PEUT PAS DESCENDRE SOUS 1, même sur une durée à 0.
  assert.equal(
    computeCurrentWeekNumber(
      programme({ programStartDate: DEBUT, durationWeeks: 0 }),
      eleve("2000-01-01"),
      ref,
    ),
    1,
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * II. L'ANCRE — le cœur du chantier
 * ════════════════════════════════════════════════════════════════════════ */

test("ANCRE1. un programme INDIVIDUEL se compte depuis program_start_date", () => {
  const ancre = ancreDeSemaine(programme({ programStartDate: "2026-08-17" }), eleve("2026-08-11"));
  assert.equal(ancre.origine, "programme");
  assert.equal(ancre.date, "2026-08-17");
});

test("ANCRE2. program_start_date l'emporte sur student.start_date, et le résultat DIFFÈRE", () => {
  const ref = aParis(2026, 9, 8);
  const avecDate = computeCurrentWeekNumber(
    programme({ programStartDate: "2026-08-17" }),
    eleve("2026-08-11"),
    ref,
  );
  const sansDate = computeCurrentWeekNumber(programme(), eleve("2026-08-11"), ref);
  // ⚠️ L'INÉGALITÉ EST LE TEST. Si les deux ancres rendaient la même chose,
  // ce chantier n'aurait rien corrigé — et ce fichier le dirait.
  assert.notEqual(avecDate, sansDate);
  assert.equal(avecDate, 4);
  assert.equal(sansDate, 5);
});

test("ANCRE3. RÉGRESSION ERWAN — 11/08 inscrit, 17/08 démarré, 08/09 → SEMAINE 4", () => {
  /*
   * ⚠️ LE TEST QUI AURAIT ÉTÉ ROUGE AVANT CE LOT. Chiffres réels relevés en
   * production le 08/09/2026 :
   *   students.start_date       2026-08-11   (= son propre created_at)
   *   assignments.assigned_at   2026-08-27
   *   début réel du programme   2026-08-17   (validé par le coach)
   * L'ancienne ancre annonçait 5. `assigned_at` aurait annoncé 2. La réponse
   * est 4, et une seule des trois dates la donne.
   */
  const ref = aParis(2026, 9, 8);
  const erwan = programme({ name: "ERWAN", durationWeeks: 12, programStartDate: "2026-08-17" });
  assert.equal(computeCurrentWeekNumber(erwan, eleve("2026-08-11"), ref), 4);

  // La preuve que l'ancienne logique était fausse, rejouée à la main :
  const ancienneLogique =
    Math.floor(daysBetween("2026-08-11", ref) / 7) + 1;
  assert.equal(ancienneLogique, 5, "l'ancienne ancre donnait bien 5");

  // …et que la date d'attribution n'était pas la réponse non plus :
  const parAttribution = Math.floor(daysBetween("2026-08-27", ref) / 7) + 1;
  assert.equal(parAttribution, 2, "assigned_at aurait donné 2");
});

test("ANCRE4. un programme de GROUPE garde group_start_date, intact", () => {
  const groupe = programme({
    programMode: "groupe",
    groupStartDate: "2026-08-17",
    // ⚠️ UNE DATE D'AFFECTATION EST POSÉE ET DOIT ÊTRE IGNORÉE : en mode
    // groupe, toute la cohorte partage un calendrier. La laisser gagner
    // casserait exactement ce que le mode groupe promet.
    programStartDate: "2026-09-01",
  });
  const ancre = ancreDeSemaine(groupe, eleve("2026-08-11"));
  assert.equal(ancre.origine, "groupe");
  assert.equal(ancre.date, "2026-08-17");
  assert.equal(computeCurrentWeekNumber(groupe, eleve("2026-08-11"), aParis(2026, 9, 8)), 4);
});

test("ANCRE5. sans date d'affectation, le repli est NOMMÉ « repli-suivi »", () => {
  const ancre = ancreDeSemaine(programme(), eleve("2026-08-11"));
  // ⚠️ C'EST LA GARDE ANTI-SILENCE. Le repli reste, mais il se déclare : c'est
  // lui qui permet à la fiche élève d'afficher « aucune date enregistrée »
  // au lieu de laisser 14 affectations fausses passer pour justes.
  assert.equal(ancre.origine, "repli-suivi");
  assert.equal(ancre.date, "2026-08-11");
});

test("ANCRE6. ni date d'affectation ni date de suivi → origine « aucune », semaine 1", () => {
  const ancre = ancreDeSemaine(programme(), null);
  assert.equal(ancre.origine, "aucune");
  assert.equal(ancre.date, null);
  assert.equal(computeCurrentWeekNumber(programme(), null, aParis(2026, 9, 8)), 1);

  // Mode groupe sans group_start_date : même refus, pas de repli vers l'élève.
  const groupeSansDate = ancreDeSemaine(programme({ programMode: "groupe" }), eleve("2026-08-11"));
  assert.equal(groupeSansDate.origine, "aucune");
});

test("ANCRE7. un programme NON ACTIF reste en semaine 1 quelle que soit l'ancre", () => {
  const brouillon = programme({ status: "brouillon", programStartDate: DEBUT });
  assert.equal(computeCurrentWeekNumber(brouillon, eleve("2000-01-01"), aParis(2026, 12, 1)), 1);
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LA BASCULE À MINUIT
 * ════════════════════════════════════════════════════════════════════════ */

test("MINUIT1. RÉGRESSION — 00:30, 01:30 et 02:30 à Paris donnent le MÊME nombre de jours", () => {
  /*
   * ⚠️ LE TEST QUI ÉTAIT ROUGE AVANT CE LOT. `new Date("2026-08-10")` est lue
   * en MINUIT UTC, soit 02:00 à Paris en été ; comparée à un instant local,
   * la différence portait deux heures de décalage. Mesuré avant correction :
   *   00:30 → 6 jours     01:30 → 6 jours     02:30 → 7 jours
   * La semaine basculait donc à 02:00. Les trois valent 7 désormais.
   */
  const j0030 = daysBetween(DEBUT, aParis(2026, 8, 17, 0, 30));
  const j0130 = daysBetween(DEBUT, aParis(2026, 8, 17, 1, 30));
  const j0230 = daysBetween(DEBUT, aParis(2026, 8, 17, 2, 30));
  assert.equal(j0030, 7, "00:30 doit déjà être J+7");
  assert.equal(j0130, 7, "01:30 doit déjà être J+7");
  assert.equal(j0230, 7);
  assert.equal(j0030, j0230, "l'heure de la journée ne doit RIEN changer");
});

test("MINUIT2. la bascule a lieu à 00:00, pas une seconde avant ni deux heures après", () => {
  assert.equal(daysBetween(DEBUT, aParis(2026, 8, 16, 23, 59)), 6, "23:59 la veille = J+6");
  assert.equal(daysBetween(DEBUT, aParis(2026, 8, 17, 0, 0)), 7, "minuit pile = J+7");
});

test("MINUIT3. la semaine de programme bascule elle aussi à minuit", () => {
  const p = programme({ programStartDate: DEBUT });
  assert.equal(computeCurrentWeekNumber(p, null, aParis(2026, 8, 16, 23, 59)), 1);
  assert.equal(computeCurrentWeekNumber(p, null, aParis(2026, 8, 17, 0, 0)), 2);
  assert.equal(computeCurrentWeekNumber(p, null, aParis(2026, 8, 17, 1, 30)), 2);
});

test("MINUIT4. une transition d'heure d'été ne fait pas perdre un jour", () => {
  // 25/10/2026 : Paris repasse en UTC+1. L'écart réel entre les deux minuits
  // vaut 24 h + 1 h ; `Math.floor` aurait rendu 14 au lieu de 15.
  assert.equal(daysBetween("2026-10-18", aParis(2026, 11, 2)), 15);
});

test("MINUIT5. une valeur illisible rend NaN, jamais 0", () => {
  // ⚠️ 0 SERAIT PIRE QU'UNE ERREUR : il signifierait « aujourd'hui », donc
  // semaine 1, pour une donnée corrompue. `computeCurrentWeekNumber` teste
  // `Number.isFinite` précisément pour ça.
  assert.ok(Number.isNaN(daysBetween("pas une date", aParis(2026, 9, 8))));
  assert.ok(Number.isNaN(daysBetween("", aParis(2026, 9, 8))));
});

test("MINUIT6. STRUCTUREL — une date seule ne repasse jamais par new Date()", () => {
  /*
   * ⚠️ CETTE GARDE EST STRUCTURELLE PARCE QU'ELLE NE PEUT PAS ÊTRE
   * COMPORTEMENTALE ICI. Sous un décalage POSITIF (Paris), relire le jour
   * local de `new Date("2026-08-10")` redonne le 10 août : le sabotage passe
   * inaperçu. Le défaut ne réapparaîtrait qu'à décalage négatif — un runtime
   * aux Amériques, où minuit UTC est la veille au soir. Puisque le harnais
   * tourne à Paris, c'est la FORME qui est gardée : la branche `date seule`
   * doit lire les trois nombres, pas les confier au parseur.
   */
  const source = lireSource("../../lib/admin.ts");
  const fonction = source.slice(
    source.indexOf("function jourCalendaireLocal"),
    source.indexOf("export function daysBetween"),
  );
  assert.match(fonction, /\\d\{4\}\)-\(/, "aucune reconnaissance explicite de la forme YYYY-MM-DD");
  assert.match(fonction, /Date\.UTC\(Number\(dateSeule\[1\]\)/, "la date seule n'est pas lue chiffre à chiffre");
});

test("TODAY4. STRUCTUREL — la page de détail transmet bien la semaine courante", () => {
  /*
   * ⚠️ SANS CE TEST, LE CORRECTIF C-min TENAIT À UN SEUL ARGUMENT QUE
   * PERSONNE NE GARDAIT. `buildScheduleForWeek` est correcte et testée
   * (TODAY1) ; mais si la page cesse de lui passer `weekNumber`, elle
   * retombe sur le comportement historique — « aujourd'hui » dans les douze
   * blocs — et aucun test comportemental ne s'en aperçoit, puisque la
   * fonction, elle, reste juste. Le sabotage l'a démontré.
   */
  const page = sansCommentaires(lireSource("../../app/(student)/entrainement/[programId]/page.tsx"));
  assert.match(
    page,
    /buildScheduleForWeek\(realProgram, week, undefined, weekNumber\)/,
    "la semaine courante n'est plus transmise : « aujourd'hui » repasse dans les 12 semaines",
  );
});

test("GARDES. les deux gardes REDONDANTES sont présentes, et assumées comme telles", () => {
  /*
   * ⚠️ DEUX GARDES DE CE LOT SONT INATTEIGNABLES PAR LE COMPORTEMENT, et le
   * sabotage l'a prouvé en restant vert quand on les retire :
   *   · `daysSinceStart < 0` — la borne `Math.max(1, …)` ramène déjà 0 à 1 ;
   *   · `Math.round` — `Date.UTC` rend des minuits exacts, `floor` donnerait
   *     le même nombre.
   * Elles restent parce qu'elles DISENT l'intention plutôt que de la laisser
   * dépendre d'un effet de bord arithmétique. Ce test garde leur présence, et
   * ce commentaire empêche de croire qu'elles corrigent quoi que ce soit.
   */
  // ⚠️ SUR LE CODE DÉPOUILLÉ DE SA PROSE, et le sabotage a exigé cette
  // précision : les commentaires qui EXPLIQUENT ces gardes contiennent leur
  // texte. Sans dépouillement, retirer la garde laissait le test vert —
  // il gardait sa propre documentation.
  const schedule = sansCommentaires(lireSource("../../lib/training-schedule.ts"));
  assert.match(schedule, /daysSinceStart < 0/, "garde d'intention retirée du code");
  const admin = sansCommentaires(lireSource("../../lib/admin.ts"));
  assert.match(admin, /Math\.round\(\(fin - debut\) \/ 86_400_000\)/);
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. NON-RÉGRESSION DES AUTRES APPELANTS DE daysBetween
 * ════════════════════════════════════════════════════════════════════════ */

test("APPELANTS1. un horodatage complet est ramené à son jour LOCAL", () => {
  // 00:30 à Paris = 22:30 UTC la VEILLE. Le jour vécu est celui qui commence.
  const minuitTrente = "2026-08-17T00:30:00+02:00";
  assert.equal(daysBetween(minuitTrente, aParis(2026, 8, 17, 18, 0)), 0, "même jour local");
  assert.equal(daysBetween(minuitTrente, aParis(2026, 8, 18, 9, 0)), 1);
});

test("APPELANTS2. studentsWithoutRecentLogin garde son comportement", () => {
  const eleves = [
    { id: "a", status: "actif", lastLoginAt: "2026-08-01T10:00:00+02:00" },
    { id: "b", status: "actif", lastLoginAt: "2026-09-07T10:00:00+02:00" },
    { id: "c", status: "actif", lastLoginAt: null },
    { id: "d", status: "inactif", lastLoginAt: "2026-01-01T10:00:00+01:00" },
  ] as unknown as AdminStudent[];
  const oublies = studentsWithoutRecentLogin(eleves, 14, aParis(2026, 9, 8));
  // a : 38 jours → oublié. b : 1 jour → non. c : jamais connecté → oublié.
  // d : inactif → hors liste, quel que soit son retard.
  assert.deepEqual(
    oublies.map((e) => e.id),
    ["a", "c"],
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * V. « AUJOURD'HUI » N'EXISTE QUE DANS UNE SEMAINE (C-min)
 * ════════════════════════════════════════════════════════════════════════ */

test("TODAY1. RÉGRESSION — le repère ne se pose QUE dans la semaine courante", () => {
  /*
   * ⚠️ LE DÉFAUT : la page de détail empile les 12 semaines et appelait
   * `buildScheduleForWeek` une fois par semaine, sans jamais dire laquelle
   * était la bonne. Le mardi était donc « aujourd'hui » dans les douze blocs.
   */
  const mardi = aParis(2026, 9, 8); // un mardi
  const p = programme({ programStartDate: "2026-08-17" });
  const semaineCourante = computeCurrentWeekNumber(p, null, mardi);
  assert.equal(semaineCourante, 4);

  for (const semaine of [1, 2, 3, 5, 6, 12]) {
    const jours = buildScheduleForWeek(p, semaine, mardi, semaineCourante);
    assert.equal(
      jours.filter((j) => j.isToday).length,
      0,
      `semaine ${semaine} : aucun jour ne doit porter « aujourd'hui »`,
    );
  }

  const courante = buildScheduleForWeek(p, semaineCourante, mardi, semaineCourante);
  const marques = courante.filter((j) => j.isToday);
  assert.equal(marques.length, 1, "exactement un jour marqué dans la semaine courante");
  assert.equal(marques[0].day, "Mardi");
});

test("TODAY2. sans semaine courante, le comportement historique est PRÉSERVÉ", () => {
  // ⚠️ NON-RÉGRESSION DES APPELANTS QUI NE CONSTRUISENT QU'UNE SEMAINE
  // (bandeau élève, carte de programme) : pour eux la question ne se pose pas,
  // et leur signature à 3 arguments doit continuer de marcher.
  const mardi = aParis(2026, 9, 8);
  const jours = buildScheduleForWeek(programme(), 1, mardi);
  assert.equal(jours.filter((j) => j.isToday).length, 1);
  assert.equal(jours.findIndex((j) => j.isToday), 1, "mardi = index 1");
});

test("TODAY3. le repère suit le vrai jour de la semaine", () => {
  const p = programme();
  const lundi = buildScheduleForWeek(p, 1, aParis(2026, 9, 7), 1);
  assert.equal(lundi.findIndex((j) => j.isToday), 0);
  const dimanche = buildScheduleForWeek(p, 1, aParis(2026, 9, 13), 1);
  assert.equal(dimanche.findIndex((j) => j.isToday), 6);
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. LE PARCOURS D'AFFECTATION — ce que le code écrit vraiment
 * ════════════════════════════════════════════════════════════════════════ */

const PROGRAMS = lireSource("../../lib/supabase/programs.ts");
const MODALE_ELEVES = lireSource("../../components/admin/AssignStudentsModal.tsx");
const MODALE_CONTENU = lireSource("../../components/admin/AssignContentToStudentModal.tsx");
const CHAMP = lireSource("../../components/admin/ProgramStartDateField.tsx");
const HOOK = lireSource("../../hooks/useContentAssignment.ts");
const MIGRATION = lireSource("../../supabase/migrations/20260923090000_date_debut_programme.sql");

test("AFFECT1. une nouvelle affectation écrit program_start_date", () => {
  const code = sansCommentaires(PROGRAMS);
  assert.match(code, /program_start_date: programStartDate \?\? null/);
  assert.match(code, /programStartDate\?: string \| null,/);
});

test("AFFECT2. NÉGATIF — la date n'est JAMAIS remplacée par la date du jour côté serveur", () => {
  // ⚠️ C'EST LE DÉFAUT D'ORIGINE, SOUS UN AUTRE NOM. `students.start_date`
  // portait un `DEFAULT CURRENT_DATE` que personne ne voyait ; poser un
  // `new Date()` ici le recréerait à l'identique.
  const ecriture = sansCommentaires(PROGRAMS).slice(
    PROGRAMS.indexOf("export async function setProgramAssignment"),
  );
  assert.ok(!/new Date\(\)/.test(ecriture), "date du jour fabriquée côté serveur");
  assert.ok(!/CURRENT_DATE/i.test(ecriture));
});

test("AFFECT3. NÉGATIF — aucune date n'est héritée d'une affectation précédente", () => {
  // Une réaffectation est un nouveau départ : l'insert ne relit aucune ligne
  // supprimée pour en reprendre la date.
  const code = sansCommentaires(PROGRAMS);
  const insert = code.slice(code.indexOf('.from("assignments").insert({'));
  assert.ok(
    !/ancienne|previous|precedent/i.test(insert.slice(0, 400)),
    "aucune reprise d'une date antérieure",
  );
});

test("AFFECT4. le champ date n'apparaît QUE pour les programmes", () => {
  for (const [nom, source] of [
    ["AssignStudentsModal", MODALE_ELEVES],
    ["AssignContentToStudentModal", MODALE_CONTENU],
  ] as const) {
    const code = sansCommentaires(source);
    assert.match(code, /type="date"/, `${nom} : champ date absent`);
    // ⚠️ LA GARDE EST CHERCHÉE JUSTE AVANT LE CHAMP, PAS N'IMPORTE OÙ DANS LE
    // FICHIER — le sabotage l'a exigé. Une recherche globale restait verte en
    // remplaçant la condition du champ par `true`, puisque la chaîne
    // `contentType === "programme"` subsistait ailleurs (à l'écriture). On
    // regarde donc les 300 caractères qui PRÉCÈDENT le `type="date"`.
    const champ = code.indexOf('type="date"');
    // 700 caractères : la garde ouvrante précède le champ de ~520 (label,
    // classes Tailwind), et la fenêtre reste trop courte pour attraper par
    // accident une occurrence appartenant à un autre bloc.
    const avantLeChamp = code.slice(Math.max(0, champ - 700), champ);
    assert.ok(
      /contentType === "programme" && \(|selection\.programme\.length > 0 && \(/.test(avantLeChamp),
      `${nom} : le champ date n'est pas conditionné aux programmes`,
    );
    assert.ok(
      /assigned && (contentType|type) === "programme"/.test(code),
      `${nom} : la date part aussi pour nutrition/documents`,
    );
  }
});

test("AFFECT5. NÉGATIF — la date du jour proposée est LOCALE, pas UTC", () => {
  for (const source of [MODALE_ELEVES, MODALE_CONTENU]) {
    const code = sansCommentaires(source);
    // ⚠️ `toISOString().slice(0,10)` rendrait le jour UTC : passé 22h à Paris
    // en été, la modale proposerait DEMAIN. Même confusion instant/jour que
    // celle corrigée dans `daysBetween`.
    assert.ok(!/toISOString\(\)\.slice\(0, ?10\)/.test(code), "date du jour dérivée en UTC");
    assert.match(code, /getFullYear\(\)/);
  }
});

test("AFFECT6. le hook ne transmet la date qu'aux programmes", () => {
  const code = sansCommentaires(HOOK);
  assert.match(code, /contentType === "programme" \? programStartDate : undefined/);
});

test("AFFECT7. la fiche élève permet de corriger la date, et signale son absence", () => {
  const code = sansCommentaires(CHAMP);
  assert.match(code, /setProgramStartDate\(/);
  assert.match(code, /getProgramStartDate\(/);
  // ⚠️ VIDER LE CHAMP DOIT ÉCRIRE `null`, pas la chaîne vide : la colonne est
  // `date`, PostgreSQL refuserait "".
  assert.match(code, /valeur\.trim\(\) === "" \? null : valeur/);
  // ⚠️ L'ABSENCE EST AFFICHÉE. C'est ce qui empêche 14 affectations non
  // régularisées de passer pour justes.
  assert.match(code, /enregistree === null/);
});

test("MIGRATION1. la migration ajoute UNE colonne et ne touche à rien d'autre", () => {
  const sql = MIGRATION.replace(/--[^\n]*/g, " ").replace(/comment on [^;]*;/gi, " ");
  assert.match(sql, /add column if not exists program_start_date date/);
  // ⚠️ `date` ET NON `timestamptz` : un début de programme est une date
  // calendaire. Un instant rouvrirait le défaut de fuseau corrigé ici même.
  assert.ok(!/program_start_date\s+timestamptz/i.test(sql), "colonne en timestamptz");
  // Aucun backfill, aucune policy, aucune autre table.
  assert.ok(!/\binsert\b|\bupdate\b|\bdelete\b/i.test(sql), "la migration écrit des données");
  assert.ok(!/policy|grant|revoke/i.test(sql), "la migration touche aux droits");
  for (const [, cible] of sql.matchAll(/alter table\s+(?:if exists\s+)?([\w.]+)/gi)) {
    assert.equal(cible, "public.assignments", `la migration altère ${cible}`);
  }
  assert.ok(!/not null/i.test(sql.split("comment on")[0]), "colonne NOT NULL : casserait l'existant");
});

/* ── Verdict ─────────────────────────────────────────────────────────────── */

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
