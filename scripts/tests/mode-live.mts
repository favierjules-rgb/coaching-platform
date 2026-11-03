/**
 * MODE LIVE — LE PARCOURS D'ACCÈS AU MODE PRÉSENTIEL.
 *
 *   npm run test:mode-live
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE ÉPROUVE, ET CE QU'ELLE DÉLÈGUE
 * ════════════════════════════════════════════════════════════════════════════
 * Elle EXÉCUTE ce qui peut l'être dans Node :
 *   · les règles d'affectation, en fonctions pures (`lib/presentiel-live.ts`) ;
 *   · le rendu React de l'étiquette, du bandeau et de la grille de semaine ;
 *   · la grille de semaine dans SES DEUX usages, élève et coach, pour prouver
 *     que le parcours élève n'a pas bougé d'un caractère.
 *
 * Elle LIT la source là où il n'y a rien à exécuter : l'ordre des gardes d'une
 * page serveur, la composition d'une route d'API. Chacun de ces contrôles est
 * doublé d'un SABOTAGE.
 *
 * ⚠️ CE QU'ELLE NE PEUT PAS PROUVER, ET QUI EST NOMMÉ PLUTÔT QUE MASQUÉ :
 *   · les droits réels. `requireStaffForStudent` interroge la base avec le
 *     client service role ; la RLS, elle, vit dans PostgreSQL. Les deux sont
 *     éprouvés par `supabase/tests/mode_live_affectations_checklist.sql`, à
 *     jouer sur une base LOCALE — 16 contrôles, dont la preuve qu'un
 *     propriétaire de COPIE n'est pas saisissable sur le MODÈLE.
 *   · le rendu des effets React : `renderToString` n'exécute aucun
 *     `useEffect`, donc ni le chargement du planning, ni l'appel à la route
 *     des élèves. Les décisions qui comptent ont donc été extraites en
 *     fonctions pures, et ce sont elles qu'on exécute.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { BandeauPlanningLive } from "../../components/admin/presentiel/BandeauPlanningLive";
import { ProgramWeekCalendar } from "../../components/student/ProgramWeekCalendar";
import {
  elevesEnAffectationDirecte,
  libelleEleve,
  listeElevesLive,
  programmeEstLivrableEnLive,
  type EleveLive,
} from "../../lib/presentiel-live";
import { buildScheduleForWeek, toEleveWorkoutSession } from "../../lib/training-schedule";
import type { AdminProgram, AdminWorkoutSession } from "../../types";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let reussis = 0;
let echecs = 0;
async function test(nom: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    reussis += 1;
    console.log(`ok - ${nom}`);
  } catch (error) {
    echecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(error);
  }
}

/**
 * ⚠️ LES COMMENTAIRES SONT RETIRÉS AVANT TOUTE ANALYSE DE SOURCE. Les fichiers
 * de ce lot documentent longuement ce qu'ils ne font PAS — « on ne fait jamais
 * confiance à une liste cliente », « le propriétaire d'une copie n'est pas
 * saisissable ici ». Un contrôle qui chercherait ces mots dans le texte brut
 * les trouverait dans l'explication, et passerait pour la mauvaise raison.
 */
function codeSeul(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const cache = new Map<string, string>();
async function lire(...segments: string[]): Promise<string> {
  const chemin = join(RACINE, ...segments);
  const connu = cache.get(chemin);
  if (connu !== undefined) return connu;
  const contenu = await readFile(chemin, "utf8");
  cache.set(chemin, contenu);
  return contenu;
}

const LISTE_PROGRAMMES = ["app", "admin", "programmes", "page.tsx"];
const ROUTE_ELEVES = [
  "app", "api", "admin", "presentiel", "programmes", "[programId]", "eleves", "route.ts",
];
const PAGE_PLANNING = [
  "app", "admin", "programmes", "[programId]", "live", "[studentId]", "page.tsx",
];
const LAYOUT_PLANNING = [
  "app", "admin", "programmes", "[programId]", "live", "[studentId]", "layout.tsx",
];
const CONTENU_PLANNING = ["components", "admin", "presentiel", "PlanningLiveContenu.tsx"];
const ETIQUETTE = ["components", "admin", "presentiel", "EtiquetteModeLive.tsx"];
const BANDEAU_PLANNING = ["components", "admin", "presentiel", "BandeauPlanningLive.tsx"];
const GRILLE = ["components", "student", "ProgramWeekCalendar.tsx"];
const GARDES = ["lib", "supabase", "guards.ts"];
const HOOK = ["hooks", "usePlanningLive.ts"];
const FICHE_ELEVE = ["app", "admin", "eleves", "[studentId]", "page.tsx"];
const PAGE_SEANCE_ELEVE = ["app", "(student)", "entrainement", "[programId]", "page.tsx"];

/* ════════════════════════════════════════════════════════════════════════════
 * LE DÉCOR
 * ════════════════════════════════════════════════════════════════════════════ */

const PROGRAMME = "77777777-0000-4000-8000-000000000077";
const ELEVE_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ELEVE_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const COPIEUR = "cccccccc-0000-4000-8000-00000000000c";
const SEANCE_S1 = "55555555-0000-4000-8000-000000000051";
const SEANCE_S2 = "55555555-0000-4000-8000-000000000052";

function seanceFactice(
  id: string,
  nom: string,
  semaine: number,
  jour: string,
): AdminWorkoutSession {
  return {
    id,
    programId: PROGRAMME,
    weekNumber: semaine,
    day: jour,
    isRestDay: false,
    name: nom,
    muscleGroup: "pectoraux",
    durationMinutes: 60,
    warmup: "",
    coachNotes: "",
    exercises: [],
  };
}

const PROGRAMME_FACTICE: AdminProgram = {
  id: PROGRAMME,
  name: "Programme de test",
  goal: "force",
  level: "intermédiaire",
  durationWeeks: 4,
  description: "",
  status: "actif",
  assignedStudentIds: [ELEVE_A, ELEVE_B],
  /*
   * ⚠️ « Lundi », AVEC UNE MAJUSCULE. `buildScheduleForWeek` apparie la séance
   * au jour par ÉGALITÉ EXACTE avec `weekDays` (lib/admin.ts), qui est
   * capitalisé. Un décor en minuscules rend sept jours de repos et une grille
   * vide — c'est ce qu'a fait la première version de ce fichier, et le rendu
   * l'a dit tout de suite.
   */
  sessions: [
    seanceFactice(SEANCE_S1, "Haut du corps", 1, "Lundi"),
    seanceFactice(SEANCE_S2, "Bas du corps", 2, "Lundi"),
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function eleve(studentId: string, prenom: string, nom: string, email: string | null = null): EleveLive {
  return { studentId, prenom, nom, email, debutProgramme: null };
}

/* ════════════════════════════════════════════════════════════════════════════
 * A. L'ÉTIQUETTE — cas 1, 2 et 5
 * ════════════════════════════════════════════════════════════════════════════ */

await test("L1 — une programmation attribuée à UN SEUL élève porte l'étiquette", () => {
  assert.equal(
    programmeEstLivrableEnLive({ assignedStudentIds: [ELEVE_A] }),
    true,
  );
  assert.deepEqual(elevesEnAffectationDirecte({ assignedStudentIds: [ELEVE_A] }), [ELEVE_A]);
});

await test("L2 — une programmation attribuée à PLUSIEURS élèves les garde tous", () => {
  const directs = elevesEnAffectationDirecte({ assignedStudentIds: [ELEVE_A, ELEVE_B] });
  assert.deepEqual(directs, [ELEVE_A, ELEVE_B]);
});

await test("L5 — une programmation NON attribuée ne porte AUCUNE étiquette", () => {
  assert.equal(programmeEstLivrableEnLive({ assignedStudentIds: [] }), false);
  // Et un MODÈLE dont tous les « élèves » sont des propriétaires de copie non
  // plus : ils ne s'entraînent pas sur ces séances-là.
  assert.equal(
    programmeEstLivrableEnLive({
      assignedStudentIds: [COPIEUR],
      assignedViaCopyStudentIds: [COPIEUR],
    }),
    false,
  );
});

await test("L5-bis — un MODÈLE ne se confond pas avec une programmation affectée", () => {
  /*
   * ⚠️ LE PIÈGE CENTRAL DE CE CHANTIER. `assignedStudentIds` mélange les
   * affectations DIRECTES et les propriétaires d'une COPIE, qui s'entraînent
   * sur une AUTRE structure. Ouvrir le Live pour un propriétaire de copie
   * depuis le modèle saisirait une séance qu'il ne fait pas — et la base
   * refuserait l'écriture au moment de valider, en salle, après la séance
   * (prouvé par L1/L2 de mode_live_affectations_checklist.sql).
   */
  const directs = elevesEnAffectationDirecte({
    assignedStudentIds: [ELEVE_A, COPIEUR, ELEVE_B],
    assignedViaCopyStudentIds: [COPIEUR],
  });
  assert.deepEqual(directs, [ELEVE_A, ELEVE_B], "le propriétaire de copie doit être écarté");
  // Sur la carte de SA copie, en revanche, il est bien là.
  assert.deepEqual(
    elevesEnAffectationDirecte({ assignedStudentIds: [COPIEUR], ownerStudentId: COPIEUR }),
    [COPIEUR],
  );
});

await test("L4 — aucun doublon, et la déduplication porte sur l'IDENTIFIANT", () => {
  // Un élève peut remonter deux fois : par `assignments` ET par
  // `owner_student_id`. Une seule ligne doit en sortir.
  assert.deepEqual(
    elevesEnAffectationDirecte({ assignedStudentIds: [COPIEUR], ownerStudentId: COPIEUR }),
    [COPIEUR],
  );
  // Et dans la liste affichée : deux entrées du même élève → une ligne.
  const { eleves } = listeElevesLive([
    eleve(ELEVE_A, "Marie", "Dupont"),
    eleve(ELEVE_A, "Marie", "Dupont"),
  ]);
  assert.equal(eleves.length, 1);
});

await test("L4-bis — deux HOMONYMES restent deux élèves distincts", () => {
  /*
   * ⚠️ LE NOM NE DISTINGUE PAS, L'IDENTIFIANT DISTINGUE. Deux élèves peuvent
   * s'appeler pareil : les fondre serait perdre l'un des deux, et c'est
   * explicitement l'un des cas à ne pas confondre.
   */
  const { eleves, homonymes } = listeElevesLive([
    eleve(ELEVE_A, "Marie", "Dupont", "marie1@test.local"),
    eleve(ELEVE_B, "Marie", "Dupont", "marie2@test.local"),
  ]);
  assert.equal(eleves.length, 2, "deux identifiants = deux élèves");
  assert.ok(homonymes.has("marie dupont"), "l'homonymie doit être signalée");
  // Et l'affichage ajoute de quoi les différencier.
  assert.equal(libelleEleve(eleves[0], homonymes), "Marie Dupont · marie1@test.local");
  assert.notEqual(
    libelleEleve(eleves[0], homonymes),
    libelleEleve(eleves[1], homonymes),
    "deux lignes identiques passeraient pour un doublon",
  );
  // Sans homonymie, le nom suffit : on n'encombre pas l'écran pour rien.
  const seul = listeElevesLive([eleve(ELEVE_A, "Marie", "Dupont", "m@test.local")]);
  assert.equal(libelleEleve(seul.eleves[0], seul.homonymes), "Marie Dupont");
});

await test("L1-bis — l'étiquette est montée sous CHAQUE programmation affectée", async () => {
  const code = codeSeul(await lire(...LISTE_PROGRAMMES));
  assert.ok(code.includes("<EtiquetteModeLive"), "la liste des programmations doit monter l'étiquette");
  assert.match(
    code,
    /supabaseActive && programmeEstLivrableEnLive\(program\) \?\s*\(?\s*<EtiquetteModeLive/,
    "deux conditions : une base réelle, et une programmation réellement affectée",
  );
  // ⚠️ DIRECTEMENT SOUS LA PROGRAMMATION, PAS DANS UN MENU : l'étiquette doit
  // précéder la rangée d'actions de gestion (Voir / Modifier / Dupliquer).
  assert.ok(
    code.indexOf("<EtiquetteModeLive") < code.indexOf(">\n                  Voir"),
    "l'étiquette doit être placée avant les actions de gestion",
  );

  /*
   * ⚠️ ET ELLE EST LÀ, PAS AILLEURS. L'entrée vivait sur la FICHE de l'élève,
   * sous la forme d'une liste de toutes les séances du programme. Laisser les
   * deux parcours coexister aurait voulu dire garder celui qui ne dit ni la
   * semaine, ni ce qui est déjà réalisé — et deux chemins vers la même saisie,
   * dont un seul recevrait les corrections suivantes.
   */
  const fiche = codeSeul(await lire(...FICHE_ELEVE));
  assert.ok(
    !fiche.includes("BoutonPresentiel") && !fiche.includes("EtiquetteModeLive"),
    "la fiche de l'élève ne doit plus porter d'entrée de saisie présentielle",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * B. LA FENÊTRE DE CHOIX — cas 2, 3, 6, 7, 8
 * ════════════════════════════════════════════════════════════════════════════ */

await test("L3 — l'étiquette demande la liste au SERVEUR, elle ne la compose jamais", async () => {
  const code = codeSeul(await lire(...ETIQUETTE));
  assert.ok(
    code.includes("/api/admin/presentiel/programmes/${programId}/eleves"),
    "la liste doit venir de la route serveur",
  );
  // ⚠️ AUCUNE DÉCISION D'AUTORISATION DANS LE NAVIGATEUR.
  for (const interdit of ["assignedStudentIds", "coach_id", "collaborateur", "students.filter"]) {
    assert.ok(
      !code.includes(interdit),
      `l'étiquette ne doit pas raisonner sur les droits (« ${interdit} » trouvé)`,
    );
  }
  // Les trois issues, nommées.
  assert.ok(code.includes("eleves.length === 0"), "aucun élève : un message, pas une page");
  assert.ok(code.includes("eleves.length === 1"), "un seul élève : accès direct, sans fenêtre");
  assert.ok(code.includes("setChoix(eleves)"), "plusieurs élèves : la fenêtre de choix");
});

await test("L3-bis — la route serveur tranche élève par élève, avec la BONNE permission", async () => {
  const code = codeSeul(await lire(...ROUTE_ELEVES));

  // L'ordre : staff d'abord, puis lecture, puis autorisation par élève.
  const rStaff = code.indexOf("requireStaff()");
  const rLecture = code.indexOf('.from("assignments")');
  const rAutorisation = code.indexOf("requireStaffForStudent(");
  assert.ok(rStaff > 0 && rStaff < rLecture, "aucune lecture avant d'avoir un compte de staff");
  assert.ok(rAutorisation > rLecture, "l'autorisation porte sur les candidats réellement affectés");

  // ⚠️ LA PERMISSION DU GESTE, PAS UNE PERMISSION GÉNÉRIQUE.
  assert.ok(
    code.includes('categorie: "entrainement"') && code.includes('niveau: "ecriture"'),
    "sans l'exigence de catégorie, requireStaffForStudent refuse TOUT collaborateur ; avec « lecture », elle accepterait un collaborateur qui ne doit pas saisir",
  );
  // La source des candidats : la table des affectations, filtrée sur CE programme.
  assert.ok(code.includes('.eq("content_type", "programme")'));
  assert.ok(code.includes('.eq("content_id", programId)'));
  // Et jamais le nom du programme.
  assert.ok(!/\.eq\("name"/.test(code), "aucune correspondance par nom de programme");
  // Le client est celui de l'utilisateur : la RLS reste le second rempart.
  assert.ok(code.includes("createSupabaseServerClient()"));
  assert.ok(
    !code.includes("createSupabaseAdminClient"),
    "aucun client privilégié : la route n'ouvre rien",
  );
});

await test("L6/L7/L8 — la route ne décide rien elle-même : elle délègue à l'autorité", async () => {
  const code = codeSeul(await lire(...ROUTE_ELEVES));
  /*
   * Les trois cas du cahier des charges — coach sans accès à un élève,
   * collaborateur AVEC la permission entraînement/écriture, collaborateur SANS
   * — ont la même réponse : `requireStaffForStudent` tranche, et la route
   * écarte en silence (`continue`) ce qu'elle refuse. On vérifie donc qu'elle
   * ne rejoue AUCUNE règle de rôle par elle-même : la rejouer, c'est la
   * laisser diverger.
   */
  for (const interdit of ["is_coach_or_admin", "staff_role", "roleStaff ===", 'role === "admin"']) {
    assert.ok(!code.includes(interdit), `la route ne doit pas rejouer les rôles (« ${interdit} »)`);
  }
  assert.match(
    code,
    /if \(!acces\.ok\) continue;/,
    "un élève refusé est écarté de la liste, sans message qui révélerait son existence",
  );
  // Le comportement réel des trois rôles est éprouvé sur une base :
  const checklist = await lire("supabase", "tests", "mode_live_affectations_checklist.sql");
  for (const marqueur of ["collaborateur ÉCRITURE", "collaborateur LECTURE seule", "coach ÉTRANGER"]) {
    assert.ok(checklist.includes(marqueur), `cas absent de la checklist SQL : ${marqueur}`);
  }
});

await test("L2-bis — la fenêtre s'intitule « Choisir un élève » et liste les élèves", async () => {
  const code = await lire(...ETIQUETTE);
  assert.ok(code.includes("Choisir un élève"), "le titre exact du cahier des charges");
  assert.ok(code.includes('role="dialog"') && code.includes('aria-modal="true"'), "fenêtre centrale");
  assert.ok(code.includes("libelleEleve(eleve, liste.homonymes)"), "chaque ligne nomme l'élève");
  assert.ok(
    code.includes("eleve.debutProgramme"),
    "et affiche de quoi différencier quand l'information existe",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * C. LE PLANNING — cas 9, 10, 11, 16
 * ════════════════════════════════════════════════════════════════════════════ */

await test("L9 — le planning réutilise les composants de l'élève, sans copie simplifiée", async () => {
  const contenu = codeSeul(await lire(...CONTENU_PLANNING));
  for (const partage of [
    "ProgramWeekCalendar",
    "WeekAnalysisSection",
    "MuscleHeatmapSection",
    "ProgressBar",
    "buildScheduleForWeek",
    "computeCurrentWeekNumber",
    "toEleveWorkoutSession",
    "toEleveTrainingProgram",
  ]) {
    assert.ok(contenu.includes(partage), `le planning doit réutiliser « ${partage} »`);
  }
  // Et il n'en réécrit aucun : aucune grille de jours à la main.
  for (const marqueur of ["grid-cols-7", "<input", "Repos"]) {
    assert.ok(
      !contenu.includes(marqueur),
      `le planning ne doit pas réécrire la grille (« ${marqueur} » trouvé)`,
    );
  }
});

await test("L10 — toutes les semaines sont affichées, et la semaine en cours est celle de l'ÉLÈVE", async () => {
  const contenu = codeSeul(await lire(...CONTENU_PLANNING));
  assert.ok(
    contenu.includes("semaines.map((semaine)"),
    "les semaines sont empilées : passées, courante, futures",
  );
  // ⚠️ LE QUATRIÈME ARGUMENT DE buildScheduleForWeek : sans lui, chaque semaine
  // affichée aurait son propre « aujourd'hui ».
  assert.ok(
    contenu.includes("buildScheduleForWeek(programme, semaine, undefined, semaineCourante)"),
    "la semaine courante doit être transmise à la grille",
  );
  // La semaine vient de l'affectation de CET élève, pas du programme.
  const hook = codeSeul(await lire(...HOOK));
  assert.ok(
    hook.includes("getAssignedProgramsForStudent(supabase, studentId)"),
    "le programme doit être lu PAR L'AFFECTATION de l'élève : c'est elle qui porte sa date de début",
  );
  assert.ok(
    !hook.includes("useSupabaseProgram("),
    "lire le programme hors affectation perdrait programStartDate, et tout le monde serait en semaine 1",
  );
});

await test("L11 — chaque séance à réaliser mène à la route PRÉSENTIELLE, avec son programme", async () => {
  const contenu = codeSeul(await lire(...CONTENU_PLANNING));
  assert.match(
    contenu,
    /\/admin\/eleves\/\$\{studentId\}\/seance\/\$\{session\.id\}\?programme=\$\{programme\.id\}/,
    "le lien doit transporter l'élève, la séance ET le programme",
  );
  assert.ok(
    contenu.includes('libelleAction="Démarrer en mode Live"'),
    "le libellé d'action exigé par le cahier des charges",
  );
});

await test("L11-bis — la grille rend réellement les liens Live, et marque les séances réalisées", () => {
  /*
   * ⚠️ RENDU, PAS LECTURE. C'est le seul contrôle qui prouve que l'injection de
   * lien fonctionne : un `lienSeance` accepté mais ignoré passerait tous les
   * contrôles textuels.
   */
  const semaine1 = PROGRAMME_FACTICE.sessions.filter((s) => s.weekNumber === 1);
  const html = renderToString(
    createElement(ProgramWeekCalendar, {
      schedule: buildScheduleForWeek(PROGRAMME_FACTICE, 1, new Date("2026-01-05T12:00:00Z"), 1),
      sessions: semaine1.map(toEleveWorkoutSession),
      lienSeance: (s) => `/admin/eleves/${ELEVE_A}/seance/${s.id}?programme=${PROGRAMME}`,
      seancesTerminees: new Set<string>(),
      libelleAction: "Démarrer en mode Live",
    }),
  );
  assert.ok(
    html.includes(`/admin/eleves/${ELEVE_A}/seance/${SEANCE_S1}?programme=${PROGRAMME}`),
    "le lien présentiel doit être rendu",
  );
  assert.ok(!html.includes("/entrainement/seance/"), "aucun lien du parcours élève ne doit subsister");
  assert.ok(html.includes("Démarrer en mode Live"), "l'action doit être visible sur la carte");
  assert.ok(html.includes('data-seance-realisee="non"'), "une séance à faire doit être marquée telle");
});

await test("L16 — une séance DÉJÀ RÉALISÉE est consultable, et ne propose pas de nouvelle saisie", () => {
  const semaine1 = PROGRAMME_FACTICE.sessions.filter((s) => s.weekNumber === 1);
  const html = renderToString(
    createElement(ProgramWeekCalendar, {
      schedule: buildScheduleForWeek(PROGRAMME_FACTICE, 1, new Date("2026-01-05T12:00:00Z"), 1),
      sessions: semaine1.map(toEleveWorkoutSession),
      lienSeance: (s) => `/admin/eleves/${ELEVE_A}/seance/${s.id}?programme=${PROGRAMME}`,
      seancesTerminees: new Set([SEANCE_S1]),
      libelleAction: "Démarrer en mode Live",
    }),
  );
  assert.ok(html.includes("Réalisée · consulter"), "la séance réalisée doit le dire");
  assert.ok(
    !html.includes("Démarrer en mode Live"),
    "elle ne doit pas proposer de démarrer une saisie qui écraserait l'historique",
  );
  assert.ok(html.includes('data-seance-realisee="oui"'));
  // ⚠️ ELLE RESTE OUVRABLE : la route présentielle affiche le RÉCAPITULATIF
  // quand un retour existe, et la correction passe par un bouton explicite
  // (« Modifier mon retour »), qui est le parcours distinct exigé.
  assert.ok(
    html.includes(`/admin/eleves/${ELEVE_A}/seance/${SEANCE_S1}?programme=${PROGRAMME}`),
    "la séance réalisée doit rester consultable",
  );
});

await test("L9-bis — le parcours ÉLÈVE n'a pas bougé d'un caractère", async () => {
  /*
   * ⚠️ LE CONTRÔLE QUI PROTÈGE L'ÉLÈVE. La grille a gagné trois propriétés
   * optionnelles ; si l'une d'elles changeait son comportement par défaut, ce
   * serait l'écran de l'élève qui changerait — et personne ne le verrait.
   */
  const semaine1 = PROGRAMME_FACTICE.sessions.filter((s) => s.weekNumber === 1);
  const html = renderToString(
    createElement(ProgramWeekCalendar, {
      schedule: buildScheduleForWeek(PROGRAMME_FACTICE, 1, new Date("2026-01-05T12:00:00Z"), 1),
      sessions: semaine1.map(toEleveWorkoutSession),
    }),
  );
  assert.ok(html.includes(`/entrainement/seance/${SEANCE_S1}`), "la destination élève est intacte");
  assert.ok(!html.includes("/admin/"), "aucun lien admin ne doit apparaître côté élève");
  assert.ok(!html.includes("data-seance-realisee"), "aucun marquage sans historique fourni");
  assert.ok(!html.includes("Réalisée"), "aucune mention de complétion côté élève");
  assert.ok(!html.includes("À réaliser"), "aucune action ajoutée côté élève");
  // Et la page de programme de l'élève ne passe aucune des nouvelles propriétés.
  const pageEleve = codeSeul(await lire(...PAGE_SEANCE_ELEVE));
  for (const prop of ["lienSeance", "seancesTerminees=", "libelleAction"]) {
    assert.ok(!pageEleve.includes(prop), `la page élève ne doit pas passer « ${prop} »`);
  }
});

/* ════════════════════════════════════════════════════════════════════════════
 * D. IDENTITÉ, BANDEAU, SÉCURITÉ — cas 12, 13, 14, 15
 * ════════════════════════════════════════════════════════════════════════════ */

await test("L12 — le bandeau permanent nomme l'élève, tout au long du parcours", () => {
  const html = renderToString(
    createElement(BandeauPlanningLive, {
      nomEleve: "Léa Martin",
      nomProgramme: "Programme de test",
    }),
  );
  /*
   * ⚠️ LES MARQUEURS DE REACT SONT RETIRÉS AVANT DE LIRE LA PHRASE. `Mode Live
   * — planning de {nomEleve}` produit `…planning de <!-- -->Léa Martin` : le
   * commentaire sépare le texte statique de la variable, et une expression
   * régulière appliquée au HTML brut ne reconnaît donc pas la phrase qui est
   * bel et bien à l'écran.
   */
  const texte = html.replace(/<!--\s*-->/g, "").replace(/<[^>]+>/g, " ");
  assert.match(
    texte,
    /Mode Live\s*—\s*planning de\s+Léa Martin/i,
    `le libellé exigé par le cahier des charges est absent : ${texte.slice(0, 200)}`,
  );
  assert.ok(html.includes("sticky"), "il doit rester visible après défilement");
  assert.ok(html.includes('role="status"'), "annoncé aux technologies d'assistance");
  assert.ok(html.includes("Programme de test"), "la programmation en cours doit être nommée");
});

await test("L12-bis — l'identité de l'élève traverse tout le parcours", async () => {
  const contenu = codeSeul(await lire(...CONTENU_PLANNING));
  // Le planning transmet l'élève au lien de séance…
  assert.ok(contenu.includes("`/admin/eleves/${studentId}/seance/"), "l'élève voyage dans l'URL");
  // … et le bandeau le nomme à partir de la fiche réellement lue.
  assert.ok(contenu.includes("nomEleve={nomEleve}"));
  assert.ok(contenu.includes("etat.eleve.firstName"), "le nom vient de la fiche, pas de l'URL");
  // La séance, elle, continue d'afficher le bandeau de SAISIE (mode présentiel).
  const seance = codeSeul(await lire("components", "admin", "presentiel", "SeancePresentielContenu.tsx"));
  assert.ok(seance.includes("presentiel"), "la séance reste en mode présentiel");
  assert.ok(seance.includes("nomEleve={nomEleve}"), "et nomme l'élève dans son bandeau");
});

/** Position de la première occurrence, ou +∞ si absente. */
function rang(code: string, aiguille: string): number {
  const i = code.indexOf(aiguille);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}

/** L'ordre des gardes de la page de planning, en fonction pure (sabotable). */
function ordreDesGardes(code: string): string[] {
  const problemes: string[] = [];
  const rDroits = rang(code, "requirePresentielAccess(studentId)");
  const rDonnees = rang(code, "requireAffectationDirecte(programId, studentId)");
  const rRendu = rang(code, "<PlanningLiveContenu");

  if (!Number.isFinite(rDroits)) problemes.push("aucun contrôle de droits");
  if (!Number.isFinite(rDonnees)) problemes.push("aucun contrôle d'affectation");
  if (!(rDroits < rDonnees)) {
    problemes.push("l'affectation est lue avant d'avoir vérifié les droits sur l'élève");
  }
  if (!(rDonnees < rRendu)) problemes.push("du HTML est rendu avant les gardes");
  return problemes;
}

await test("L13 — une URL manipulée est refusée côté serveur, avant tout rendu", async () => {
  assert.deepEqual(ordreDesGardes(codeSeul(await lire(...PAGE_PLANNING))), []);

  const gardes = codeSeul(await lire(...GARDES));
  const bloc = gardes.slice(gardes.indexOf("export async function requireAffectationDirecte"));
  // L'affectation est cherchée sur les DEUX cas que la base accepte, et rien
  // d'autre : une ligne `assignments` directe, ou la propriété de la copie.
  assert.ok(bloc.includes('.eq("content_type", "programme")'));
  assert.ok(bloc.includes('.eq("content_id", programId)'));
  assert.ok(bloc.includes("owner_student_id"));
  assert.ok(
    bloc.includes('redirect("/admin/programmes")'),
    "un refus redirige, sans dire si la programmation existe",
  );
  // Et le contrôle des droits reste celui du mode présentiel, inchangé.
  const blocDroits = gardes.slice(gardes.indexOf("export async function requirePresentielAccess"));
  assert.ok(blocDroits.includes('categorie: "entrainement"') && blocDroits.includes('niveau: "ecriture"'));
});

await test("L14 — les prescriptions ne sont pas touchées par ce parcours", async () => {
  for (const fichier of [CONTENU_PLANNING, ETIQUETTE, BANDEAU_PLANNING, HOOK, ROUTE_ELEVES]) {
    const code = codeSeul(await lire(...fichier));
    for (const mot of ["workout_exercises", "workout_sets", "training_prescriptions"]) {
      assert.ok(!code.includes(mot), `${fichier.join("/")} : aucune écriture de prescription (« ${mot} »)`);
    }
    assert.ok(!code.includes(".update("), `${fichier.join("/")} : aucune écriture`);
    assert.ok(!code.includes(".insert("), `${fichier.join("/")} : aucune écriture`);
  }
});

await test("L15 — le brouillon reste indépendant par élève et par séance", async () => {
  /*
   * Ce parcours ne touche pas au brouillon : il ne fait que mener à la route
   * présentielle, qui le cloisonne déjà par `(compte du coach, séance::élève)`.
   * Ce contrôle vérifie que le chemin d'accès n'a pas défait ce cloisonnement —
   * c'est-à-dire que la séance reçoit toujours l'élève ET la séance distincts.
   */
  /*
   * ⚠️ LU SUR LA SOURCE BRUTE, PAS SUR LE CODE DÉ-PROSIFIÉ. Le retrait des
   * commentaires JSX (`{/* … *​/}`) part d'une accolade suivie d'un `/*` : dans
   * un littéral d'objet qui commence par `({` et dont la première ligne est un
   * commentaire de bloc, il avale jusqu'au `*​/` suivi d'une accolade — donc
   * plusieurs lignes de code, dont celle-ci. Ici la chaîne cherchée est du code
   * et n'apparaît dans aucun commentaire : la source brute suffit, et ne mord
   * pas.
   */
  const seance = await lire("components", "student", "SessionFeedbackSection.tsx");
  assert.ok(
    seance.includes("...(presentiel ? { portee: studentId } : {})"),
    "la portée du brouillon doit rester l'élève",
  );
  const contenu = codeSeul(await lire(...CONTENU_PLANNING));
  assert.ok(
    contenu.includes("`/admin/eleves/${studentId}/seance/${session.id}"),
    "chaque lien porte un couple (élève, séance) distinct",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * E. ERGONOMIE ET MOBILE — cas 17
 * ════════════════════════════════════════════════════════════════════════════ */

await test("L17 — ordinateur, tablette et iPhone : cibles, troncature, repli", async () => {
  for (const fichier of [ETIQUETTE, BANDEAU_PLANNING, CONTENU_PLANNING]) {
    const code = codeSeul(await lire(...fichier));
    const nom = fichier.join("/");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), `${nom} : couleur en dur`);
    assert.ok(!/\brgb\(|\bhsl\(/.test(code), `${nom} : couleur en dur`);
  }
  const etiquette = codeSeul(await lire(...ETIQUETTE));
  assert.ok(etiquette.includes("min-h-[44px]"), "cible tactile de l'étiquette");
  assert.ok(etiquette.includes("min-h-[48px]"), "cible tactile des lignes de la fenêtre");
  assert.ok(etiquette.includes("pressable"), "retour d'appui du dépôt");
  assert.ok(etiquette.includes("focus-visible:ring"), "focus clavier visible");
  assert.ok(etiquette.includes("max-h-[85vh]"), "la fenêtre doit tenir dans l'écran");
  assert.ok(etiquette.includes("overflow-y-auto"), "et défiler au-delà");
  assert.ok(etiquette.includes("truncate"), "un nom long ne doit pas élargir la fenêtre");

  const bandeau = codeSeul(await lire(...BANDEAU_PLANNING));
  assert.ok(bandeau.includes("truncate"), "un nom d'élève long ne doit pas élargir le bandeau");
  assert.ok(bandeau.includes("flex-wrap"), "le bandeau doit se replier sur un écran étroit");

  const contenu = codeSeul(await lire(...CONTENU_PLANNING));
  assert.ok(contenu.includes("flex-wrap"), "les titres de semaine doivent se replier");

  // La grille de semaine est responsive depuis toujours : 2 colonnes sur
  // téléphone, 7 sur grand écran. On vérifie que ce chantier ne l'a pas cassée.
  const grille = codeSeul(await lire(...GRILLE));
  assert.ok(
    grille.includes("grid-cols-2") && grille.includes("sm:grid-cols-3") && grille.includes("lg:grid-cols-7"),
    "la grille doit rester responsive",
  );
});

await test("L17-bis — le chronomètre suit le coach du planning à la séance", async () => {
  const layout = codeSeul(await lire(...LAYOUT_PLANNING));
  assert.ok(
    layout.includes("<ChronometreSeance />"),
    "le minuteur de repos doit survivre à la navigation planning → séance → planning",
  );
  // Son périmètre exact est tenu par scripts/tests/chronometre-seance.mts
  // (E1/E3/E4), qui énumère les points de montage autorisés.
});

/* ════════════════════════════════════════════════════════════════════════════
 * SABOTAGES
 * ════════════════════════════════════════════════════════════════════════════ */

await test("SAB 1 — une étiquette posée sur un MODÈLE non affecté est détectée", () => {
  // La règle fautive : « il y a des noms dans assignedStudentIds, donc on peut
  // y aller ». C'est ce que ferait un écran qui ignore les copies.
  const regleFautive = (p: { assignedStudentIds: readonly string[] }) =>
    p.assignedStudentIds.length > 0;
  const modele = { assignedStudentIds: [COPIEUR], assignedViaCopyStudentIds: [COPIEUR] };
  assert.equal(regleFautive(modele), true, "le sabotage doit afficher l'étiquette…");
  assert.equal(programmeEstLivrableEnLive(modele), false, "…là où la vraie règle la refuse");
});

await test("SAB 2 — une déduplication par NOM est détectée", () => {
  const parNom = (eleves: readonly EleveLive[]) => [
    ...new Map(eleves.map((e) => [`${e.prenom} ${e.nom}`, e])).values(),
  ];
  const deux = [
    eleve(ELEVE_A, "Marie", "Dupont", "m1@test.local"),
    eleve(ELEVE_B, "Marie", "Dupont", "m2@test.local"),
  ];
  assert.equal(parNom(deux).length, 1, "le sabotage doit perdre un élève…");
  assert.equal(listeElevesLive(deux).eleves.length, 2, "…là où la vraie règle les garde tous les deux");
});

await test("SAB 3 — une page qui rend avant de garder est détectée", () => {
  const sabotee = `
    return <PlanningLiveContenu studentId={studentId} programId={programId} />;
    await requirePresentielAccess(studentId);
    await requireAffectationDirecte(programId, studentId);
  `;
  const problemes = ordreDesGardes(sabotee);
  assert.ok(problemes.length >= 1, `l'inversion doit être signalée : ${problemes.join(" | ")}`);
});

await test("SAB 4 — une page qui vérifie l'affectation AVANT les droits est détectée", () => {
  const sabotee = `
    await requireAffectationDirecte(programId, studentId);
    await requirePresentielAccess(studentId);
    return <PlanningLiveContenu studentId={studentId} programId={programId} />;
  `;
  const problemes = ordreDesGardes(sabotee);
  assert.ok(
    problemes.some((p) => p.includes("avant d'avoir vérifié les droits")),
    `l'ordre doit être signalé : ${problemes.join(" | ")}`,
  );
});

await test("SAB 5 — une grille qui ignore l'injection de lien est détectée", () => {
  // Si `lienSeance` était accepté puis ignoré, le coach atterrirait sur le
  // parcours élève — et saisirait sous SA propre identité, ou sur rien.
  const semaine1 = PROGRAMME_FACTICE.sessions.filter((s) => s.weekNumber === 1);
  const html = renderToString(
    createElement(ProgramWeekCalendar, {
      schedule: buildScheduleForWeek(PROGRAMME_FACTICE, 1, new Date("2026-01-05T12:00:00Z"), 1),
      sessions: semaine1.map(toEleveWorkoutSession),
      lienSeance: () => "/admin/sentinelle",
    }),
  );
  assert.ok(html.includes("/admin/sentinelle"), "la grille doit réellement utiliser lienSeance");
  assert.ok(!html.includes("/entrainement/seance/"), "et abandonner la destination par défaut");
});

console.log(`\n${reussis} réussis, ${echecs} échecs`);
if (echecs > 0) process.exit(1);
