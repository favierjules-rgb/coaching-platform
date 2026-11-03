/**
 * MODE PRÉSENTIEL — LES VINGT CONTRÔLES DU CAHIER DES CHARGES.
 *
 *   npm run test:mode-presentiel
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE PEUT PROUVER, ET CE QU'ELLE NE PEUT PAS
 * ════════════════════════════════════════════════════════════════════════════
 * Elle EXÉCUTE tout ce qui peut l'être dans Node :
 *   · les schémas zod des deux routes, sur de vrais corps de requête ;
 *   · le dépôt local réel (`DepotOffline` sur `MoteurMemoire`), avec deux
 *     élèves, une seule séance et un seul compte coach ;
 *   · le rendu React du bouton d'accès et du bandeau permanent.
 *
 * Elle LIT la source là où il n'y a rien à exécuter : l'ordre des gardes dans
 * une route serveur, l'absence d'un helper de rôle dans un trigger SQL,
 * l'absence d'un second formulaire. Chacun de ces contrôles est doublé d'un
 * SABOTAGE qui lui présente la régression qu'il prétend détecter — un contrôle
 * textuel qui ne mord pas ne protège de rien.
 *
 * ⚠️ CE QU'ELLE NE PEUT PAS PROUVER, ET QUI EST NOMMÉ PLUTÔT QUE MASQUÉ :
 *   · le comportement du trigger de traçabilité. Il vit dans PostgreSQL ;
 *     la table de vérité correspondante est
 *     `supabase/tests/mode_presentiel_tracabilite_checklist.sql`, à jouer sur
 *     une base LOCALE. Ici, on ne vérifie que le CONTENU de la migration.
 *
 *     ⚠️ ET CETTE LIMITE A UN PRIX, PAYÉ UNE FOIS. La revue de sécurité a
 *     trouvé sur une base ce que cette suite ne pouvait pas voir : la
 *     migration réécrivait le gardien à partir du dernier
 *     `create or replace function` VISIBLE dans le dépôt, alors que
 *     20261011110000 l'avait réécrit DYNAMIQUEMENT depuis `prosrc`. Elle
 *     annulait donc le prédicat d'autorisation de P13-B — et cette suite
 *     affirmait l'inverse, en exigeant la présence de l'ancien helper de
 *     rôles comme s'il s'agissait d'une garde à conserver.
 *
 *     Ce qui a changé depuis : `auditMigration` garde le prédicat de P13-B et
 *     interdit le retour du helper DANS LE CORPS de la fonction, T26/T27
 *     fixent le search_path et l'horodatage, T28 exige que la checklist SQL
 *     porte les contrôles correspondants ET leurs sabotages. Un contrôle qui
 *     n'a jamais été mis à l'épreuve ne protège de rien : c'est vrai des
 *     contrôles SQL comme de ceux-ci.
 *   · les politiques RLS, pour la même raison, et parce que cette migration
 *     n'en touche aucune — ce qui est, lui, vérifiable ici.
 *   · le rendu réel des effets React (restauration de brouillon à
 *     l'ouverture) : `renderToString` n'exécute aucun `useEffect`. La
 *     décision qui compte — la CLÉ du brouillon — a donc été extraite en
 *     fonction pure (`cleSeanceBrouillon`), et c'est elle qui est exécutée.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { BandeauPresentiel } from "../../components/admin/presentiel/BandeauPresentiel";
import { cleSeanceBrouillon } from "../../hooks/useBrouillonSeance";
import { DepotOffline, MoteurMemoire } from "../../lib/offline/depot";
import { workoutFeedbackPayloadSchema } from "../../lib/api/schemas/workout-feedback";

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
 * ⚠️ LES COMMENTAIRES SONT RETIRÉS AVANT TOUTE ANALYSE DE SOURCE.
 *
 * Tous les fichiers de ce lot DOCUMENTENT ce qu'ils ne font pas : la route
 * présentielle explique pourquoi elle ne fait pas confiance au client, le
 * trigger explique pourquoi il n'appelle pas `is_coach_or_admin()`. Un
 * contrôle qui chercherait ces mots dans le texte brut les trouverait — dans
 * l'explication — et échouerait. Interdire d'EXPLIQUER un piège force à
 * effacer la mémoire du piège.
 */
function codeSeul(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Même travail pour le SQL, dont les commentaires commencent par `--`. */
function sqlSeul(source: string): string {
  return source.replace(/(^|[^-])--.*$/gm, "$1");
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

const FICHE_ELEVE = ["app", "admin", "eleves", "[studentId]", "page.tsx"];
const PAGE_PRESENTIEL = ["app", "admin", "eleves", "[studentId]", "seance", "[sessionId]", "page.tsx"];
const LAYOUT_PRESENTIEL = ["app", "admin", "eleves", "[studentId]", "seance", "[sessionId]", "layout.tsx"];
const CONTENU_PRESENTIEL = ["components", "admin", "presentiel", "SeancePresentielContenu.tsx"];
const BANDEAU = ["components", "admin", "presentiel", "BandeauPresentiel.tsx"];
/* L'entrée du mode Live, qui a remplacé l'ancien bouton de la fiche élève. */
const ETIQUETTE = ["components", "admin", "presentiel", "EtiquetteModeLive.tsx"];
const ROUTE_PRESENTIEL = ["app", "api", "admin", "presentiel", "workout-feedback", "route.ts"];
const ROUTE_ELEVE = ["app", "api", "student", "workout-feedback", "route.ts"];
const SECTION_RETOUR = ["components", "student", "SessionFeedbackSection.tsx"];
const HOOK_FEEDBACK = ["hooks", "useSupabaseWorkoutFeedback.ts"];
const HOOK_BROUILLON = ["hooks", "useBrouillonSeance.ts"];
const GARDES = ["lib", "supabase", "guards.ts"];
const MIGRATION = ["supabase", "migrations", "20261102090000_mode_presentiel_tracabilite.sql"];
const TYPES_SUPABASE = ["types", "supabase.ts"];
const PAGE_SEANCE_ELEVE = ["app", "(student)", "entrainement", "seance", "[sessionId]", "page.tsx"];

/* ════════════════════════════════════════════════════════════════════════════
 * LE DÉCOR DE RENDU
 * ════════════════════════════════════════════════════════════════════════════ */

const ELEVE_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ELEVE_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const COACH = "cccccccc-0000-4000-8000-00000000000c";
const SEANCE = "55555555-0000-4000-8000-000000000055";
const PROGRAMME = "77777777-0000-4000-8000-000000000077";

/*
 * ⚠️ LE DÉCOR DE PROGRAMME A DÉMÉNAGÉ dans `scripts/tests/mode-live.mts`, avec
 * le parcours qu'il éprouve : l'ancien bouton de la fiche élève rendait un
 * programme complet, l'étiquette Mode Live ne rend qu'un libellé. Ce qui reste
 * ici sert aux contrôles de brouillon, qui n'ont besoin que d'identifiants.
 */

/* ════════════════════════════════════════════════════════════════════════════
 * A. ACCÈS — T1 à T3
 * ════════════════════════════════════════════════════════════════════════════ */

/*
 * ⚠️ LE POINT D'ENTRÉE A DÉMÉNAGÉ — CHANTIER MODE LIVE.
 *
 * T1, T2 et T2-bis éprouvaient `BoutonPresentiel`, une liste de toutes les
 * séances du programme posée sur la FICHE de l'élève. Le geste réel en salle
 * n'était pas celui-là : on part de la PROGRAMMATION du jour, on choisit
 * l'élève, et on navigue dans son planning comme il le fait lui-même.
 *
 * Le composant a donc été retiré, et l'entrée vit sous chaque programmation de
 * `/admin/programmes`. Ces trois contrôles sont REMPLACÉS, pas supprimés : ils
 * vérifient désormais que l'ancienne entrée a bien disparu de la fiche (sinon
 * deux parcours coexisteraient, dont un qui ne dit ni la semaine ni ce qui est
 * déjà réalisé), et le nouveau parcours est éprouvé de bout en bout par
 * `scripts/tests/mode-live.mts`.
 */
await test("T1 — l'ancienne entrée a quitté la fiche de l'élève", async () => {
  const code = codeSeul(await lire(...FICHE_ELEVE));
  assert.ok(
    !code.includes("BoutonPresentiel"),
    "la fiche ne doit plus porter l'entrée séance par séance : elle vit sous la programmation",
  );
  // Et le composant lui-même n'existe plus : un import mort aurait cassé la
  // compilation, mais un fichier orphelin aurait survécu en silence.
  const fichiers = await readdir(join(RACINE, "components", "admin", "presentiel"));
  assert.ok(
    !fichiers.includes("BoutonPresentiel.tsx"),
    "le composant retiré ne doit pas rester dans le dépôt",
  );
});

await test("T2 — la fiche de l'élève ne propose plus aucune saisie présentielle directe", async () => {
  const code = codeSeul(await lire(...FICHE_ELEVE));
  for (const trace of ["/seance/", "presentiel", "Mode Live", "mode Live"]) {
    assert.ok(
      !code.includes(trace),
      `la fiche ne doit plus construire de lien de saisie (« ${trace} » trouvé)`,
    );
  }
});

await test("T3 — aucune usurpation d'identité : jamais de connexion à la place de l'élève", async () => {
  const suspects = [
    "signInWithPassword",
    "signInWithOtp",
    "generateLink",
    "setSession",
    "admin.createUser",
    "auth.admin",
    "SERVICE_ROLE",
    "service_role",
  ];
  for (const fichier of [PAGE_PRESENTIEL, LAYOUT_PRESENTIEL, CONTENU_PRESENTIEL, BANDEAU, ETIQUETTE, ROUTE_PRESENTIEL]) {
    const code = codeSeul(await lire(...fichier));
    for (const mot of suspects) {
      assert.ok(
        !code.includes(mot),
        `${fichier.join("/")} : « ${mot} » n'a rien à faire sur le chemin présentiel`,
      );
    }
  }
});

await test("T3-bis — l'identité de l'élève est celle de la fiche, portée de bout en bout", async () => {
  const contenu = codeSeul(await lire(...CONTENU_PRESENTIEL));
  assert.ok(
    /studentId=\{studentId\}/.test(contenu),
    "l'élève de l'URL doit être celui passé au formulaire",
  );
  const hook = codeSeul(await lire(...HOOK_FEEDBACK));
  assert.ok(
    hook.includes("const id = pourEleve ?? (await getCurrentStudentId(supabase))"),
    "en présentiel l'identité vient de la fiche ; sinon du compte connecté, comme avant",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * B. L'INDICATEUR PERMANENT — T4 et T5
 * ════════════════════════════════════════════════════════════════════════════ */

function rendreBandeau(options: { enregistre?: boolean; indisponible?: boolean } = {}) {
  return renderToString(
    createElement(BandeauPresentiel, {
      nomEleve: "Léa Martin",
      brouillonEnregistre: options.enregistre ?? false,
      brouillonIndisponible: options.indisponible ?? false,
      onViderBrouillon: () => {},
    }),
  );
}

await test("T4 — le bandeau dit le mode ET nomme l'élève, en permanence", () => {
  const html = rendreBandeau();
  assert.ok(
    /Mode présentiel\s*—\s*saisie par le coach/i.test(html),
    "le libellé exigé par le cahier des charges est absent",
  );
  assert.ok(html.includes("Léa Martin"), "le nom de l'élève doit être à l'écran");
  assert.ok(html.includes("sticky"), "il doit rester visible après défilement : c'est le seul garde-fou");
  assert.ok(html.includes('role="status"'), "annoncé aux technologies d'assistance");
  assert.ok(
    html.includes("Rien n&#x27;est transmis") || html.includes("Rien n'est transmis"),
    "la phrase qui distingue « enregistré sur l'appareil » de « transmis » est absente",
  );
  assert.ok(
    /Fermer la page ou changer d&#x27;écran ne termine pas la séance|Fermer la page ou changer d'écran ne termine pas la séance/.test(html),
    "le cahier des charges exige qu'on ne déclare JAMAIS la séance terminée parce qu'on a quitté la page",
  );
});

await test("T5 — l'état du brouillon se dit, et son effacement demande confirmation", () => {
  const vierge = rendreBandeau({ enregistre: false });
  assert.ok(
    !vierge.includes("Brouillon enregistré sur cet appareil"),
    "rien n'a encore été écrit : ne pas l'annoncer",
  );
  assert.ok(!vierge.includes("Vider le brouillon"), "pas de brouillon, pas de bouton d'effacement");

  const avec = rendreBandeau({ enregistre: true });
  assert.ok(
    avec.includes("Brouillon enregistré sur cet appareil"),
    "le libellé exigé par la décision 2 est absent",
  );
  assert.ok(avec.includes("Vider le brouillon"), "l'effacement doit être offert");
  // La confirmation est en DEUX temps : le premier appui n'efface rien.
  assert.ok(
    !avec.includes("Confirmer l&#x27;effacement") && !avec.includes("Confirmer l'effacement"),
    "le premier rendu ne doit PAS déjà proposer la confirmation : l'effacement serait à un clic",
  );

  const hs = rendreBandeau({ indisponible: true });
  assert.ok(
    hs.includes("Brouillon indisponible sur cet appareil"),
    "un stockage refusé (navigation privée) doit être DIT, pas deviné",
  );
});

await test("T5-bis — le bandeau n'existe QUE sous le drapeau présentiel", async () => {
  const section = codeSeul(await lire(...SECTION_RETOUR));
  assert.match(
    section,
    /presentiel \?\s*\(?\s*<BandeauPresentiel/,
    "le bandeau doit être conditionné : l'élève ne doit jamais le voir",
  );
  const pageEleve = codeSeul(await lire(...PAGE_SEANCE_ELEVE));
  assert.ok(
    !/presentiel/.test(pageEleve),
    "la page de séance de l'élève ne doit jamais passer le drapeau",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * C. RÉUTILISATION DE L'INTERFACE — T6 à T9
 * ════════════════════════════════════════════════════════════════════════════ */

await test("T6 — aucun second formulaire de séance : le composant élève est monté TEL QUEL", async () => {
  const contenu = codeSeul(await lire(...CONTENU_PRESENTIEL));
  assert.ok(contenu.includes("<SessionFeedbackSection"), "le formulaire partagé doit être monté");
  // Un second formulaire se reconnaît à ses champs. S'il y en avait un ici,
  // il divergerait du premier au premier champ ajouté.
  for (const marqueur of ["<input", "<textarea", "ExerciseFeedbackCard", "CardioBlockForm", "SetRow"]) {
    assert.ok(
      !contenu.includes(marqueur),
      `le contenu présentiel ne doit pas réécrire la saisie (« ${marqueur} » trouvé)`,
    );
  }
});

/**
 * Les propriétés passées à `SessionFeedbackSection` par un montage donné.
 * Extraites de la source, parce que c'est là que vit l'oubli qu'on cherche :
 * une propriété non transmise ne provoque aucune erreur, elle retire
 * silencieusement une fonctionnalité.
 */
function proprietesTransmises(code: string, depuis = 0): Set<string> {
  const debut = code.indexOf("<SessionFeedbackSection", depuis);
  if (debut === -1) return new Set();
  const fin = code.indexOf("/>", debut);
  const bloc = code.slice(debut, fin === -1 ? undefined : fin);
  const noms = new Set<string>();
  // `nom={...}` ET `nom="..."` : le second existe bel et bien
  // (`source="supabase"`), et l'oublier faisait croire la propriété absente.
  for (const m of bloc.matchAll(/(?:^|\s)([a-zA-Z][a-zA-Z0-9]*)=[{"]/g)) noms.add(m[1]);
  // Un drapeau booléen s'écrit sans valeur.
  for (const m of bloc.matchAll(/(?:^|\s)(presentiel)(?=\s)/g)) noms.add(m[1]);
  return noms;
}

await test("T7 — le présentiel transmet TOUT ce que transmet la séance de l'élève", async () => {
  const eleve = proprietesTransmises(codeSeul(await lire(...PAGE_SEANCE_ELEVE)));
  const presentiel = proprietesTransmises(codeSeul(await lire(...CONTENU_PRESENTIEL)));
  assert.ok(eleve.size >= 8, `le montage élève n'a pas été lu correctement : ${[...eleve]}`);

  /*
   * ⚠️ QUATRE PROPRIÉTÉS SONT ABSENTES EXPRÈS, ET C'EST NOMMÉ ICI PLUTÔT
   * QUE PASSÉ SOUS SILENCE :
   *
   *   · `businessDate`   — la date métier vient du parcours HORS LIGNE de
   *     l'élève. Absente, `performedAt` retombe sur la date du jour, qui est
   *     exactement la bonne pour une séance faite en salle maintenant.
   *   · `cheminsVideoConnus` et `chargerRemplacants` — deux pré-chargements
   *     du mode hors ligne. Le sélecteur de remplaçant a son propre
   *     chargeur par défaut (`ExerciseSubstitutionPicker.chargeurParDefaut`,
   *     RPC `list_exercise_substitutes`, `security invoker`), donc le
   *     remplacement d'exercice fonctionne en présentiel sans cette
   *     injection.
   *   · `progressionActivePourExercice` — le réglage de progression du
   *     programme. Absent, les indicateurs sont OFF ; la saisie, elle, est
   *     entière.
   *
   * Si l'une d'elles devient nécessaire, ce test le dira en échouant sur la
   * liste ci-dessous, pas en laissant filer un oubli.
   */
  const absencesAssumees = new Set([
    "businessDate",
    "cheminsVideoConnus",
    "chargerRemplacants",
    "progressionActivePourExercice",
  ]);
  const manquantes = [...eleve].filter((p) => !presentiel.has(p) && !absencesAssumees.has(p));
  assert.deepEqual(manquantes, [], `propriétés oubliées en présentiel : ${manquantes.join(", ")}`);

  for (const attendue of ["blocks", "exercises", "cardioBlocks", "studentId", "sessionId", "presentiel", "nomEleve"]) {
    assert.ok(presentiel.has(attendue), `le présentiel doit transmettre « ${attendue} »`);
  }
});

await test("T8 — le remplacement d'exercice passe par les MÊMES contrôles que l'élève", async () => {
  const routeP = codeSeul(await lire(...ROUTE_PRESENTIEL));
  const routeE = codeSeul(await lire(...ROUTE_ELEVE));
  for (const [nom, code] of [["présentielle", routeP], ["élève", routeE]] as const) {
    assert.ok(
      code.includes("controlerContenuRetour("),
      `la route ${nom} doit appeler les contrôles de contenu partagés`,
    );
  }
  // Et ces contrôles sont partagés, pas recopiés : aucune des deux routes ne
  // rejoue la règle du pattern de mouvement.
  for (const [nom, code] of [["présentielle", routeP], ["élève", routeE]] as const) {
    assert.ok(
      !code.includes("movement_pattern"),
      `la route ${nom} ne doit pas recopier la règle de remplacement : deux copies divergent`,
    );
  }
  const partages = codeSeul(await lire("lib", "api", "workout-feedback-controles.ts"));
  assert.ok(
    partages.includes("movement_pattern"),
    "la règle doit vivre dans le module partagé",
  );
});

await test("T9 — le cardio est celui de l'élève : prévu et réalisé, durée et distance", async () => {
  const contenu = codeSeul(await lire(...CONTENU_PRESENTIEL));
  assert.ok(
    /cardioBlocks=\{seance\.cardioBlocks\}/.test(contenu),
    "les blocs cardio de la séance doivent être transmis",
  );
  // Les formulaires cardio appartiennent au composant partagé : s'ils en
  // sortaient, T6 l'aurait déjà dit. Ici on vérifie que le composant les
  // rend bien, et donc que le présentiel en hérite.
  const section = codeSeul(await lire(...SECTION_RETOUR));
  assert.ok(section.includes("CardioBlockFeedback") || section.includes("cardioBlocks"),
    "le composant partagé doit traiter les blocs cardio");
});

/* ════════════════════════════════════════════════════════════════════════════
 * D. CHRONOMÈTRE — T10
 * ════════════════════════════════════════════════════════════════════════════ */

await test("T10 — le chronomètre est disponible en présentiel, sans jamais démarrer seul", async () => {
  const layout = codeSeul(await lire(...LAYOUT_PRESENTIEL));
  assert.ok(layout.includes("<ChronometreSeance />"), "la route présentielle doit monter le chronomètre");
  // Il ne mesure PAS la séance : la durée reste déclarée dans le bilan.
  const chrono = codeSeul(await lire("components", "student", "ChronometreSeance.tsx"));
  for (const interdit of ["durationMinutes", "workout_feedback", "supabase", "localStorage"]) {
    assert.ok(
      !chrono.includes(interdit),
      `le chronomètre ne doit toucher ni aux données de séance ni au stockage (« ${interdit} »)`,
    );
  }
  assert.ok(
    !/useEffect\([^)]*\)\s*=>\s*\{[^}]*demarrer\(/.test(chrono),
    "aucun démarrage automatique",
  );
  // Le détail de la machine à états (pause, reprise, reset, pas de
  // démarrage automatique sur les DEUX routes) est éprouvé par
  // scripts/tests/chronometre-seance.mts, qui monte les deux layouts.
});

/* ════════════════════════════════════════════════════════════════════════════
 * E. BILAN FINAL ET HISTORIQUE — T11 et T12
 * ════════════════════════════════════════════════════════════════════════════ */

await test("T11 — le bilan final est le même, et il est EXPLICITE", async () => {
  const section = codeSeul(await lire(...SECTION_RETOUR));
  for (const champ of ["globalRpe", "globalComment", "pain", "durationMinutes"]) {
    assert.ok(section.includes(champ), `le bilan doit porter « ${champ} »`);
  }
  assert.ok(
    section.includes("onSubmit={handleSubmit}"),
    "l'envoi doit passer par la soumission explicite du formulaire",
  );
  // `completed` n'est jamais posé par une sortie de page : il part avec le
  // payload construit à la soumission.
  const bandeau = codeSeul(await lire(...BANDEAU));
  assert.ok(
    !bandeau.includes("beforeunload") && !bandeau.includes("visibilitychange"),
    "quitter la page ne doit RIEN déclencher : le cahier des charges l'interdit",
  );
  const contenu = codeSeul(await lire(...CONTENU_PRESENTIEL));
  assert.ok(
    !contenu.includes("beforeunload") && !contenu.includes("completed"),
    "la page présentielle ne doit jamais déclarer une séance terminée d'elle-même",
  );
});

await test("T12 — la séance saisie atterrit dans l'historique NORMAL de l'élève", async () => {
  const routeP = codeSeul(await lire(...ROUTE_PRESENTIEL));
  const routeE = codeSeul(await lire(...ROUTE_ELEVE));
  assert.ok(routeP.includes("saveWorkoutFeedback("), "même chemin d'écriture que l'élève");
  assert.ok(routeE.includes("saveWorkoutFeedback("), "la route élève doit être inchangée sur ce point");
  assert.ok(
    /saveWorkoutFeedback\(supabase, \{ \.\.\.payload, studentId \}\)/.test(routeP),
    "l'élève écrit est celui autorisé, imposé au moment de l'écriture",
  );
  // Et la lecture ne filtre pas sur le mode : une séance saisie par le coach
  // est une séance de l'élève, point.
  const lectures = codeSeul(await lire("lib", "supabase", "workout-feedback.ts"));
  assert.ok(
    !lectures.includes("saisie_mode"),
    "aucune lecture d'historique ne doit filtrer sur le mode de saisie",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * F. PRESCRIPTIONS — T13
 * ════════════════════════════════════════════════════════════════════════════ */

await test("T13 — les prescriptions ne sont JAMAIS écrasées par le réalisé", async () => {
  // Deux garanties, et la seconde ne dépend pas de l'application.
  // 1. Le schéma des deux routes refuse `prescribed_snapshot`.
  const schema = codeSeul(await lire("lib", "api", "schemas", "workout-feedback.ts"));
  assert.ok(schema.includes(".strict()"), "le schéma doit être strict");
  assert.ok(
    !schema.includes("prescribed_snapshot") && !schema.includes("prescribedSnapshot"),
    "le snapshot du prescrit ne doit pas pouvoir être envoyé",
  );
  // 2. La base le construit elle-même, et la migration de ce lot ne doit
  //    surtout pas l'avoir perdu en réécrivant le trigger.
  const migration = sqlSeul(await lire(...MIGRATION));
  assert.ok(
    migration.includes("build_prescribed_snapshot"),
    "la réécriture du trigger doit CONSERVER la construction du snapshot",
  );
  // 3. Et rien du présentiel n'écrit dans les tables de prescription.
  for (const fichier of [ROUTE_PRESENTIEL, CONTENU_PRESENTIEL, ETIQUETTE, BANDEAU]) {
    const code = codeSeul(await lire(...fichier));
    for (const table of ["workout_exercises", "workout_sets", "exercise_sets"]) {
      assert.ok(
        !code.includes(`from("${table}")`) && !code.includes(`.update(`),
        `${fichier.join("/")} : aucune écriture de prescription (« ${table} »)`,
      );
    }
  }
});

/* ════════════════════════════════════════════════════════════════════════════
 * G. SAUVEGARDE PROGRESSIVE — T14 à T16 — EXÉCUTÉS SUR LE VRAI DÉPÔT
 * ════════════════════════════════════════════════════════════════════════════ */

await test("T14 — sans portée, la clé de brouillon est INCHANGÉE (aucune perte pour l'élève)", () => {
  assert.equal(
    cleSeanceBrouillon(SEANCE),
    SEANCE,
    "le parcours élève doit retrouver ses brouillons écrits avant ce lot",
  );
  assert.notEqual(cleSeanceBrouillon(SEANCE, ELEVE_A), SEANCE);
  assert.notEqual(cleSeanceBrouillon(SEANCE, ELEVE_A), cleSeanceBrouillon(SEANCE, ELEVE_B));
});

await test("T15 — deux élèves, UNE séance, UN coach : deux brouillons indépendants", async () => {
  const depot = new DepotOffline(new MoteurMemoire());
  const t0 = 1_786_000_000_000;

  const ecrire = (eleve: string, charge: string, revision: number) =>
    depot.ecrireBrouillon({
      userId: COACH,
      sessionId: cleSeanceBrouillon(SEANCE, eleve),
      businessDate: "2026-11-02",
      payload: { charge },
      maintenant: t0,
      revision,
    });

  assert.equal(await ecrire(ELEVE_A, "80", 1), true);
  assert.equal(await ecrire(ELEVE_B, "45", 1), true);

  const a = await depot.lireBrouillon(COACH, cleSeanceBrouillon(SEANCE, ELEVE_A));
  const b = await depot.lireBrouillon(COACH, cleSeanceBrouillon(SEANCE, ELEVE_B));
  assert.deepEqual(a?.payload, { charge: "80" }, "le brouillon de A a été écrasé");
  assert.deepEqual(b?.payload, { charge: "45" }, "le brouillon de B a été écrasé");

  // Le second ne touche pas au premier, même après plusieurs révisions.
  await ecrire(ELEVE_B, "50", 2);
  const aEncore = await depot.lireBrouillon(COACH, cleSeanceBrouillon(SEANCE, ELEVE_A));
  assert.deepEqual(aEncore?.payload, { charge: "80" });

  // Et le brouillon de l'ÉLÈVE lui-même, sur son propre compte, reste à part.
  await depot.ecrireBrouillon({
    userId: ELEVE_A,
    sessionId: SEANCE,
    businessDate: "2026-11-02",
    payload: { charge: "saisie de l'élève" },
    maintenant: t0,
    revision: 1,
  });
  const vuDuCoach = await depot.lireBrouillon(COACH, cleSeanceBrouillon(SEANCE, ELEVE_A));
  assert.deepEqual(
    vuDuCoach?.payload,
    { charge: "80" },
    "les données de l'élève et celles saisies par le coach doivent rester séparées",
  );
});

await test("T16 — le brouillon est restaurable après rechargement, et effaçable", async () => {
  const moteur = new MoteurMemoire();
  const cle = cleSeanceBrouillon(SEANCE, ELEVE_A);

  // Première session : on écrit.
  const avant = new DepotOffline(moteur);
  await avant.ecrireBrouillon({
    userId: COACH,
    sessionId: cle,
    businessDate: "2026-11-02",
    payload: { series: [{ charge: "82.5", reps: "8", rpe: "8" }] },
    maintenant: 1_786_000_000_000,
    revision: 1,
  });

  // Rechargement : un dépôt NEUF sur le même stockage, comme après un F5.
  const apres = new DepotOffline(moteur);
  const restaure = await apres.lireBrouillon(COACH, cle);
  assert.deepEqual(
    restaure?.payload,
    { series: [{ charge: "82.5", reps: "8", rpe: "8" }] },
    "la saisie doit survivre au rechargement",
  );
  assert.equal(restaure?.revision, 1);

  // Une révision inférieure ou égale est REFUSÉE : un différé en retard ne
  // peut pas faire revenir la séance en arrière.
  assert.equal(
    await apres.ecrireBrouillon({
      userId: COACH,
      sessionId: cle,
      businessDate: "2026-11-02",
      payload: { series: [] },
      maintenant: 1_786_000_000_001,
      revision: 1,
    }),
    false,
    "une révision déjà vue doit être refusée",
  );
  assert.deepEqual((await apres.lireBrouillon(COACH, cle))?.payload, {
    series: [{ charge: "82.5", reps: "8", rpe: "8" }],
  });

  await apres.supprimerBrouillon(COACH, cle);
  assert.equal(await apres.lireBrouillon(COACH, cle), null, "l'effacement doit être effectif");
});

await test("T17 — le brouillon ne part JAMAIS au serveur de lui-même", async () => {
  const hook = codeSeul(await lire(...HOOK_BROUILLON));
  for (const mot of ["fetch(", "createSupabaseBrowserClient", "/api/"]) {
    assert.ok(!hook.includes(mot), `le brouillon ne doit parler qu'au stockage local (« ${mot} »)`);
  }
  // Et le drapeau affiché par le bandeau n'est PAS la révision restaurée :
  // c'était le défaut à corriger — « brouillon enregistré » restait muet
  // pendant toute la première saisie, c'est-à-dire quand il sert.
  const section = codeSeul(await lire(...SECTION_RETOUR));
  assert.ok(
    section.includes("brouillonEnregistre={brouillonLocal.enregistreLocalement}"),
    "le bandeau doit refléter une écriture RÉELLE, pas la révision restaurée",
  );
  assert.ok(
    hook.includes("enregistreLocalement"),
    "le hook doit exposer la présence d'un brouillon sur l'appareil",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * H. DROITS — T18 et T19 — SCHÉMAS ZOD RÉELLEMENT EXÉCUTÉS
 * ════════════════════════════════════════════════════════════════════════════ */

const CORPS_VALIDE = {
  sessionKey: SEANCE,
  sessionRefLabel: "Haut du corps A",
  completed: true,
  globalRpe: 7,
  globalComment: "",
  pain: "",
  exercises: [],
  sessionId: SEANCE,
  programId: PROGRAMME,
};

await test("T18 — la route ÉLÈVE refuse catégoriquement un studentId dans le corps", () => {
  assert.equal(workoutFeedbackPayloadSchema.safeParse(CORPS_VALIDE).success, true);
  const avecEleve = workoutFeedbackPayloadSchema.safeParse({ ...CORPS_VALIDE, studentId: ELEVE_B });
  assert.equal(
    avecEleve.success,
    false,
    "le schéma strict de la route élève doit rejeter une identité fournie par le client",
  );
});

await test("T19 — la route PRÉSENTIELLE exige l'élève, le valide, et n'accepte RIEN d'autre", async () => {
  // Le schéma de la route est construit sur place : on le reconstruit à
  // l'identique pour l'EXÉCUTER, et on vérifie sur la source que c'est bien
  // cette construction qui est en service.
  const code = codeSeul(await lire(...ROUTE_PRESENTIEL));
  assert.match(
    code,
    /workoutFeedbackPayloadSchema\.extend\(\{\s*studentId: z\.string\(\)\.uuid\(/,
    "la route doit étendre le schéma partagé d'exactement une clé",
  );
  assert.ok(
    !code.includes("passthrough") && !code.includes(".partial()"),
    "aucun relâchement du schéma : ce serait la faille que la route élève s'interdit",
  );

  const { z } = await import("zod");
  const schemaPresentiel = workoutFeedbackPayloadSchema.extend({
    studentId: z.string().uuid("Élève invalide."),
  });
  assert.equal(schemaPresentiel.safeParse(CORPS_VALIDE).success, false, "sans élève, refus");
  assert.equal(
    schemaPresentiel.safeParse({ ...CORPS_VALIDE, studentId: "pas-un-uuid" }).success,
    false,
    "un élève mal formé doit être refusé avant toute lecture",
  );
  assert.equal(
    schemaPresentiel.safeParse({ ...CORPS_VALIDE, studentId: ELEVE_A }).success,
    true,
  );
  assert.equal(
    schemaPresentiel.safeParse({ ...CORPS_VALIDE, studentId: ELEVE_A, saisie_mode: "autonome" }).success,
    false,
    "la traçabilité ne doit pas pouvoir être dictée par le client",
  );
});

/** Position de la première occurrence, ou +∞ si absente. */
function rang(code: string, aiguille: string): number {
  const i = code.indexOf(aiguille);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}

/**
 * L'ordre des gardes dans la route présentielle. Extrait en fonction pour
 * qu'un SABOTAGE puisse lui présenter la version inversée.
 */
function ordreDesGardes(code: string): string[] {
  const problemes: string[] = [];
  const rAutorisation = rang(code, "requireStaffForStudent(");
  const rClient = rang(code, "createSupabaseServerClient(");
  const rControles = rang(code, "controlerContenuRetour(");
  const rEcriture = rang(code, "saveWorkoutFeedback(");

  if (!Number.isFinite(rAutorisation)) problemes.push("aucune autorisation serveur");
  if (!(rAutorisation < rClient)) problemes.push("le client Supabase est créé avant l'autorisation");
  if (!(rAutorisation < rControles)) problemes.push("du contenu est lu avant l'autorisation");
  if (!(rAutorisation < rEcriture)) problemes.push("une écriture précède l'autorisation");
  if (!(rControles < rEcriture)) problemes.push("l'écriture précède les contrôles de contenu");
  if (!code.includes('categorie: "entrainement"') || !code.includes('niveau: "ecriture"')) {
    problemes.push("l'exigence de catégorie est absente : tout collaborateur serait refusé en bloc");
  }
  return problemes;
}

await test("T20 — côté serveur, l'autorisation tranche AVANT toute lecture et toute écriture", async () => {
  assert.deepEqual(ordreDesGardes(codeSeul(await lire(...ROUTE_PRESENTIEL))), []);
});

await test("T20-bis — la PAGE est gardée côté serveur, avant le moindre rendu", async () => {
  const page = codeSeul(await lire(...PAGE_PRESENTIEL));
  assert.ok(
    rang(page, "requirePresentielAccess(studentId)") < rang(page, "<SeancePresentielContenu"),
    "le garde doit s'exécuter avant le rendu : un garde côté navigateur n'aurait rien gardé",
  );
  const gardes = codeSeul(await lire(...GARDES));
  const bloc = gardes.slice(gardes.indexOf("export async function requirePresentielAccess"));
  assert.ok(bloc.includes("requireAdminOrCoach()"), "le garde doit d'abord exiger un compte de staff");
  assert.ok(
    bloc.includes('categorie: "entrainement"') && bloc.includes('niveau: "ecriture"'),
    "et la permission d'écriture en entraînement, nommément",
  );
  assert.ok(bloc.includes('redirect("/admin/eleves")'), "un refus doit rediriger, sans dire pourquoi");
});

await test("T21 — aucun droit n'est créé, ni emprunté à l'espace élève", async () => {
  const migration = sqlSeul(await lire(...MIGRATION));
  for (const interdit of ["create policy", "alter policy", "drop policy", "grant "]) {
    assert.ok(
      !migration.toLowerCase().includes(interdit),
      `la migration ne doit toucher à aucun droit (« ${interdit} »)`,
    );
  }
  const routeP = codeSeul(await lire(...ROUTE_PRESENTIEL));
  assert.ok(
    routeP.includes("createSupabaseServerClient()"),
    "l'écriture doit passer par le client de l'utilisateur, donc sous RLS",
  );
  assert.ok(
    !routeP.includes("createSupabaseAdminClient") && !routeP.includes("ServiceRole"),
    "jamais de client privilégié : la RLS est le second rempart",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * I. LA MIGRATION DE TRAÇABILITÉ — contrôles exigés par la décision 1
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Le helper de rôles global du schéma, nommé en DEUX MORCEAUX.
 *
 * ⚠️ CE N'EST PAS UNE COQUETTERIE. L'invariant de P13-B interdit cette chaîne
 * dans le corps de toute fonction `security definer` du schéma `public`, et
 * `supabase/tests/mode_presentiel_tracabilite_checklist.sql` (A6d) la cherche
 * littéralement. Ce fichier de test n'est pas une fonction SQL, donc il ne
 * tombe pas sous l'invariant — mais le concaténer documente la règle à
 * l'endroit où on serait tenté de l'oublier, et évite qu'un `grep` lancé sur
 * le dépôt pour traquer l'invariant ne remonte des faux positifs.
 */
const HELPER_GLOBAL = "is_coach_or" + "_admin";

/** Le prédicat d'autorisation exact posé par P13-B. */
const PREDICAT_P13B =
  "v_staff := (not v_systeme) and ('entrainement' in (select public.categories_ecriture()))";

/**
 * Le CORPS de `enforce_workout_feedback_write()` tel que la migration le
 * déclare — c'est-à-dire ce qui finira dans `prosrc`, et sur quoi l'invariant
 * P13-B se juge. L'en-tête du fichier, lui, n'en fait pas partie.
 */
function corpsDeLaFonction(sql: string): string | null {
  const debut = sql.indexOf("as $$\ndeclare");
  if (debut === -1) return null;
  const fin = sql.indexOf("\n$$;", debut);
  if (fin === -1) return null;
  return sql.slice(debut, fin);
}

/**
 * Le contenu de la migration, en fonction pure pour qu'un sabotage puisse
 * lui présenter une version abîmée.
 */
function auditMigration(sql: string): string[] {
  const code = sqlSeul(sql);
  const bas = code.toLowerCase();
  /*
   * ⚠️ LE CORPS DE LA FONCTION, ISOLÉ — ET TOUTES LES AFFIRMATIONS SUR LA
   * FONCTION SE JUGENT SUR LUI, PAS SUR LE FICHIER.
   *
   * Le bloc Z de la migration CITE chacun des motifs qu'il exige ou interdit
   * (`v_src not like '%new.id := old.id%'`, `v_src like '%… := now()%'`…).
   * Un contrôle qui chercherait ces motifs dans tout le fichier serait donc
   * satisfait par le bloc Z lui-même : il passerait même si le corps avait
   * perdu la garde. Constaté en écrivant les sabotages, et c'est exactement
   * le piège de la prose, une couche plus bas.
   */
  const corps = corpsDeLaFonction(sql);
  const corpsBas = (corps ?? "").toLowerCase();
  const problemes: string[] = [];

  for (const colonne of ["saisie_mode", "saisie_par", "saisie_le"]) {
    if (!bas.includes(`add column if not exists ${colonne}`)) problemes.push(`colonne ${colonne} absente`);
  }
  if (!bas.includes("workout_feedback_saisie_mode_valide")) problemes.push("contrainte de vocabulaire absente");
  if (!bas.includes("'autonome'") || !bas.includes("'presentiel'")) problemes.push("vocabulaire incomplet");

  /*
   * ⚠️ LA DÉRIVATION DE LA TRACE N'INTERROGE AUCUN RÔLE.
   *
   * La règle est « l'auteur est-il l'élève de cette ligne ? ». Un helper de
   * rôles hériterait de ses angles morts — le modèle a déjà bougé une fois
   * (P13-B et `coaches.role = 'collaborateur'`).
   */
  const debutMP = code.indexOf("v_saisie := tg_op");
  const finMP = code.indexOf("if v_systeme or v_staff then", debutMP === -1 ? 0 : debutMP);
  if (debutMP === -1 || finMP === -1) {
    problemes.push("le bloc de dérivation MP est introuvable : la migration a changé de forme");
  } else {
    const blocMP = code.slice(debutMP, finMP).toLowerCase();
    for (const helper of [HELPER_GLOBAL, "staff_role()", "is_admin("]) {
      if (blocMP.includes(helper.toLowerCase())) {
        problemes.push(`la dérivation ne doit pas dépendre de ${helper}`);
      }
    }
    if (!blocMP.includes("new.student_id = public.current_student_id()")) {
      problemes.push("la règle de classement attendue est absente du bloc de dérivation");
    }
  }

  /*
   * ⚠️ LE PRÉDICAT D'AUTORISATION — ET C'EST ICI QUE CE TEST SE TROMPAIT.
   *
   * Il exigeait la PRÉSENCE de l'ancien helper de rôles global, qu'il appelait
   * « la garde historique des colonnes du coach ». C'était faux, et le test
   * encodait donc la régression qu'il croyait interdire : la dernière version
   * du gardien ne porte plus ce helper depuis
   * 20261011110000_p13b_durcissement_fonctions_definer.sql, qui l'a remplacé
   * par « entraînement EN ÉCRITURE » — précisément parce que le helper est
   * vrai pour tout collaborateur, y compris sans permission d'entraînement.
   *
   * La revue de sécurité a trouvé la régression sur une base, pas ici. Les
   * deux sens sont donc désormais affirmés séparément, et le second est celui
   * qui manquait.
   */
  if (!corpsBas.includes(PREDICAT_P13B.toLowerCase())) {
    problemes.push("le prédicat d'autorisation P13-B (entrainement en écriture) est absent");
  }
  /*
   * ⚠️ L'ABSENCE SE JUGE SUR LE TEXTE BRUT, PAS SUR LE CODE SEUL.
   *
   * L'invariant posé par P13-B est littéral : son contrôle intégré lit
   * `prosrc` sans retirer les commentaires. « Respecter strictement » veut
   * donc dire que la chaîne n'apparaît nulle part dans le CORPS de la
   * fonction — pas même dans une explication. On vérifie donc le corps, pas
   * le fichier : l'en-tête de la migration a tout à fait le droit de raconter
   * l'histoire, et il le fait.
   */
  if (corps === null) {
    problemes.push("le corps de la fonction est introuvable dans la migration");
  } else if (corps.toLowerCase().includes(HELPER_GLOBAL.toLowerCase())) {
    problemes.push("le helper de rôles global est nommé dans le corps : l'invariant P13-B est rompu");
  }

  // ⚠️ `search_path` : la valeur EXACTE de la convention P13-B. Une chaîne
  // vide est plus stricte mais contredit G27 ; une valeur plus large serait
  // dangereuse. Dans les deux cas, ce n'est pas à cette migration d'en
  // décider.
  if (!bas.includes("set search_path = public, pg_temp")) {
    problemes.push("le search_path n'est pas « public, pg_temp » (convention P13-B)");
  }
  if (/set\s+search_path\s*=\s*''/.test(code)) {
    problemes.push("le search_path a été ramené à une chaîne vide");
  }

  if (!corpsBas.includes("new.saisie_par := auth.uid()")) {
    problemes.push("l'auteur n'est pas dérivé du serveur");
  }

  /*
   * ⚠️ `clock_timestamp()` ET PAS `now()`.
   *
   * `now()` rend l'heure de début de transaction : la question « cette
   * écriture a-t-elle recalculé la date ? » devient indécidable, et les
   * contrôles T7c/T8c de la checklist passaient quoi qu'il arrive — prouvé
   * par sabotage pendant la revue. Même doctrine que
   * `coach_reply_video_uploaded_at`, qui porte déjà ce commentaire.
   */
  if (!corpsBas.includes("new.saisie_le  := clock_timestamp()")) {
    problemes.push("la date de saisie n'est pas dérivée de clock_timestamp()");
  }
  /*
   * ⚠️ JUGÉ SUR LE CORPS, PAS SUR LE FICHIER. Le bloc Z CITE le motif qu'il
   * interdit (`v_src like '%new.saisie_le  := now()%'`) : un contrôle qui
   * lirait tout le fichier se mordrait sur l'interdit lui-même. Même piège
   * que la prose, une couche plus bas.
   */
  if (corps !== null && /new\.saisie_le\s*:=\s*now\(\)/.test(corps)) {
    problemes.push("la date de saisie repose sur now() : la conservation devient invérifiable");
  }
  // Et la règle de CONSERVATION sur les écritures qui ne sont pas des saisies.
  if (!corpsBas.includes("new.saisie_mode := old.saisie_mode")) {
    problemes.push("la conservation de la trace sur un UPDATE non-saisie est absente");
  }

  // ⚠️ TOUTES les règles que la réécriture devait CONSERVER, nommées une par
  // une. La revue a montré qu'une liste de quatre laissait passer ce qu'elle
  // ne nommait pas.
  for (const garde of [
    "build_prescribed_snapshot",
    "student_owns_workout_session",
    "new.student_id := old.student_id",
    "new.id := old.id",
    "new.session_key := old.session_key",
    "new.created_at := old.created_at",
    "new.session_ref_label := old.session_ref_label",
    "new.session_key := new.session_id::text",
    "old.prescribed_snapshot is not null then old.prescribed_snapshot",
    "new.status := old.status",
    "new.coach_reply := old.coach_reply",
    "new.submitted_at := old.submitted_at",
    "coach_reply_video_uploaded_at",
  ]) {
    if (!corpsBas.includes(garde.toLowerCase())) problemes.push(`la réécriture a perdu « ${garde} »`);
  }

  // Les deux contrôles encadrants doivent exister ET juger ce qu'il faut.
  if (!bas.includes("préalable inattendu")) {
    problemes.push("le bloc A ne vérifie pas que la fonction remplacée est bien celle attendue");
  }

  // Les anciennes lignes restent NULL : aucune donnée inventée.
  if (/^\s*update\s+public\.workout_feedback\s+set\s+saisie_mode/im.test(code)) {
    problemes.push("un backfill est EXÉCUTÉ : il inventerait une donnée que personne n'a observée");
  }
  if (bas.includes("default 'autonome'")) problemes.push("un défaut déclarerait tout l'historique autonome");

  // Les deux blocs de contrôle.
  if (!bas.includes("préalable manquant")) problemes.push("bloc A (contrôle avant) absent");
  if (!bas.includes("rollback") && !bas.includes("raise exception") && !bas.includes("raise warning")) {
    problemes.push("bloc Z (contrôle après) absent");
  }
  return problemes;
}

await test("T22 — la migration ajoute la traçabilité SANS rien perdre ni rien inventer", async () => {
  assert.deepEqual(auditMigration(await lire(...MIGRATION)), []);
});

await test("T23 — les types TypeScript portent la règle : lues, jamais écrites", async () => {
  const types = await lire(...TYPES_SUPABASE);
  const debut = types.indexOf("workout_feedback: {");
  assert.ok(debut > 0, "table workout_feedback introuvable dans les types");
  const bloc = types.slice(debut, types.indexOf("\n      };", debut));
  const row = bloc.slice(bloc.indexOf("Row: {"), bloc.indexOf("Insert: {"));
  const ecritures = bloc.slice(bloc.indexOf("Insert: {"));
  for (const colonne of ["saisie_mode", "saisie_par", "saisie_le"]) {
    assert.ok(row.includes(colonne), `« ${colonne} » doit être lisible`);
    assert.ok(
      !ecritures.includes(colonne),
      `« ${colonne} » ne doit figurer ni dans Insert ni dans Update : elle est DÉRIVÉE`,
    );
  }
  assert.ok(
    row.includes('"autonome" | "presentiel" | null'),
    "le vocabulaire doit être porté par le type, pas seulement par la contrainte SQL",
  );
});

await test("T25-bis — la migration ne laisse AUCUN objet derrière elle, même en échouant", async () => {
  const sql = await lire(...MIGRATION);
  const code = sqlSeul(sql);
  /*
   * ⚠️ L'OUTIL DE CONTRÔLE VIT DANS `pg_temp`, PAS DANS `public`.
   *
   * Il a d'abord été créé dans `public` et supprimé en fin de fichier. C'est
   * correct quand tout se passe bien — et ça laisse une fonction orpheline
   * dans le schéma dès que le bloc A refuse de poursuivre, ce qui est
   * précisément son métier. `pg_temp` disparaît avec la session, succès ou
   * échec.
   */
  assert.ok(code.includes("create function pg_temp._mp_code_seul"), "l'outil doit vivre dans pg_temp");
  assert.ok(
    !/create\s+(or\s+replace\s+)?function\s+public\._mp/.test(code),
    "aucun outil de contrôle ne doit être créé dans le schéma public",
  );
  // Et plus généralement : la migration ne crée que ce qu'elle annonce.
  const creations = [...code.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_.]+)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(creations)].sort(),
    ["pg_temp._mp_code_seul", "public.enforce_workout_feedback_write"],
    `fonctions créées par la migration : ${creations.join(", ")}`,
  );
});

await test("T26 — le gardien respecte STRICTEMENT les invariants P13-B", async () => {
  const sql = await lire(...MIGRATION);
  const corps = corpsDeLaFonction(sql);
  assert.ok(corps, "le corps de la fonction doit être identifiable");

  // 1. Le prédicat d'autorisation est celui de P13-B, dans le corps.
  assert.ok(
    corps!.includes(PREDICAT_P13B),
    "le corps doit porter « entrainement en écriture », pas un helper de rôles",
  );
  // 2. Et le helper de rôles global n'apparaît NULLE PART dans le corps —
  //    commentaires compris, puisque l'invariant de P13-B lit `prosrc` brut.
  assert.ok(
    !corps!.toLowerCase().includes(HELPER_GLOBAL.toLowerCase()),
    "l'invariant P13-B est textuel : la chaîne ne doit pas même apparaître dans une explication du corps",
  );
  // 3. L'en-tête du fichier, en revanche, a le droit de raconter l'histoire —
  //    et il DOIT la raconter, sinon le prochain lot refera l'erreur.
  const enTete = sql.slice(0, sql.indexOf("-- ── A0."));
  assert.ok(
    enTete.includes("20261011110000"),
    "l'en-tête doit dire que la fonction a été réécrite dynamiquement par P13-B",
  );
  // 4. Le search_path exact.
  assert.ok(
    sql.includes("set search_path = public, pg_temp"),
    "search_path = public, pg_temp (convention P13-B)",
  );
  // 5. La précondition du bloc A refuse une source inattendue.
  assert.ok(
    sql.includes("PRÉALABLE INATTENDU") && sql.includes("1 exigée"),
    "le bloc A doit exiger exactement une occurrence du prédicat attendu",
  );
});

await test("T27 — la date de saisie est dérivée, et sa conservation est vérifiable", async () => {
  const sql = await lire(...MIGRATION);
  const code = sqlSeul(sql);
  const corps = corpsDeLaFonction(sql);
  assert.ok(corps, "le corps de la fonction doit être identifiable");
  assert.ok(
    corps!.includes("new.saisie_le  := clock_timestamp();"),
    "clock_timestamp() : voir la leçon de coach_reply_video_uploaded_at",
  );
  // ⚠️ SUR LE CORPS : le bloc Z cite `now()` pour l'interdire.
  assert.ok(
    !/new\.saisie_le\s*:=\s*now\(\)/.test(corps!),
    "now() est figé sur la transaction : il rend la conservation invérifiable",
  );
  assert.ok(
    code.includes("new.saisie_le   := old.saisie_le;"),
    "une écriture qui n'est pas une saisie doit conserver la date",
  );
  // Le bloc Z refuse les deux régressions.
  assert.ok(code.includes("saisie_le non dérivée de clock_timestamp()"));
  assert.ok(code.includes("saisie_le repose sur now()"));
});

await test("T28 — la checklist SQL couvre les points trouvés en revue, et se sabote", async () => {
  const checklist = await lire("supabase", "tests", "mode_presentiel_tracabilite_checklist.sql");
  // Les contrôles ajoutés après la revue.
  for (const marqueur of [
    "A6b. search_path EXACTEMENT",
    "A6c. v_staff repose sur",
    "A6d. aucune fonction definer",
    // ⚠️ APOSTROPHES DOUBLÉES : ces libellés sont des littéraux SQL.
    "T7c. et la date de saisie n''a pas bougé",
    "T8c. et la date de saisie est RAFRAÎCHIE",
  ]) {
    assert.ok(checklist.includes(marqueur), `contrôle absent de la checklist : ${marqueur}`);
  }
  // ⚠️ ET LEURS SABOTAGES. C'est la leçon de la revue : T7c passait depuis le
  // début, faute d'avoir jamais été mis à l'épreuve.
  for (const marqueur of ["SAB-A6B.", "SAB-A6C.", "SAB-A6D.", "SAB-T7C.", "SAB-T8C.", "SAB-Z."]) {
    assert.ok(checklist.includes(marqueur), `sabotage absent de la checklist : ${marqueur}`);
  }
  // Le `>=` qui rendait T8c vide ne doit pas revenir.
  assert.ok(
    !checklist.includes("'T8c. et la date de saisie est rafraîchie', v_le2 >= v_le"),
    "T8c ne doit pas se contenter de >= : l'égalité satisfaisait le contrôle",
  );
  // Et la checklist restaure le gardien après ses sabotages.
  assert.ok(
    checklist.includes("pg_temp.restaurer_gardien()"),
    "les sabotages doivent restaurer la fonction réelle",
  );
});

await test("T24 — la migration n'a PAS été appliquée depuis ce dépôt", async () => {
  // Le cahier des charges l'interdit explicitement. On vérifie qu'aucun
  // script du dépôt ne la joue, et que rien n'appelle une application
  // automatique.
  const paquet = await lire("package.json");
  assert.ok(
    !paquet.includes("20261102090000"),
    "aucun script npm ne doit jouer cette migration",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * J. DESIGN ET MOBILE — T25
 * ════════════════════════════════════════════════════════════════════════════ */

await test("T25 — les trois composants suivent les conventions du dépôt (et tiennent sur un téléphone)", async () => {
  for (const fichier of [BANDEAU, ETIQUETTE]) {
    const code = codeSeul(await lire(...fichier));
    const nom = fichier.join("/");
    // Aucune couleur en dur : les jetons sémantiques portent le thème sombre.
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), `${nom} : couleur en dur`);
    assert.ok(!/\brgb\(|\bhsl\(/.test(code), `${nom} : couleur en dur`);
    assert.ok(/rounded-(control|card|panel)/.test(code), `${nom} : rayons non sémantiques`);
    assert.ok(code.includes("focus-visible:ring"), `${nom} : focus clavier non visible`);
  }
  const etiquette = codeSeul(await lire(...ETIQUETTE));
  assert.ok(etiquette.includes("pressable"), "l'étiquette doit avoir le retour d'appui du dépôt");
  assert.ok(etiquette.includes("min-h-[44px]"), "cible tactile insuffisante");
  assert.ok(etiquette.includes("truncate"), "un nom long ne doit pas élargir la fenêtre");

  const bandeau = codeSeul(await lire(...BANDEAU));
  assert.ok(bandeau.includes("truncate"), "un nom d'élève long ne doit pas élargir le bandeau");
  assert.ok(bandeau.includes("flex-wrap"), "le bandeau doit se replier sur un écran étroit");
  assert.ok(/min-h-9|min-h-\[44px\]/.test(bandeau), "cibles tactiles du bandeau");
});

/* ════════════════════════════════════════════════════════════════════════════
 * SABOTAGES — chaque contrôle doit MORDRE
 * ════════════════════════════════════════════════════════════════════════════ */

await test("SAB 1 — une clé de brouillon qui ignore la portée est détectée", async () => {
  // On rejoue T15 avec une clé fautive : les deux élèves se retrouvent sur la
  // même entrée, et le second écrase le premier.
  const depot = new DepotOffline(new MoteurMemoire());
  const cleFautive = (sessionId: string) => sessionId;
  for (const [eleve, charge] of [[ELEVE_A, "80"], [ELEVE_B, "45"]] as const) {
    await depot.ecrireBrouillon({
      userId: COACH,
      sessionId: cleFautive(SEANCE),
      businessDate: "2026-11-02",
      payload: { charge, eleve },
      maintenant: 1_786_000_000_000,
      revision: eleve === ELEVE_A ? 1 : 2,
    });
  }
  const a = await depot.lireBrouillon(COACH, cleFautive(SEANCE));
  assert.notDeepEqual(
    a?.payload,
    { charge: "80", eleve: ELEVE_A },
    "le sabotage doit produire l'écrasement que T15 interdit",
  );
});

await test("SAB 2 — un schéma relâché qui accepte un studentId est détecté", async () => {
  const { z } = await import("zod");
  const relache = z.object({ sessionKey: z.string() }).loose();
  assert.equal(
    relache.safeParse({ ...CORPS_VALIDE, studentId: ELEVE_B }).success,
    true,
    "le sabotage doit passer là où T18 refuse — c'est bien T18 qui protège",
  );
});

await test("SAB 3 — une route qui autorise APRÈS avoir lu est détectée", () => {
  const sabotee = `
    const supabase = await createSupabaseServerClient();
    const refus = await controlerContenuRetour(supabase, studentId, payload);
    const autorisation = await requireStaffForStudent(studentId, {
      categorie: "entrainement", niveau: "ecriture",
    });
    const saved = await saveWorkoutFeedback(supabase, { ...payload, studentId });
  `;
  const problemes = ordreDesGardes(sabotee);
  assert.ok(problemes.length >= 2, `l'inversion doit être signalée : ${problemes.join(" | ")}`);
});

await test("SAB 4 — une route SANS exigence de catégorie est détectée", () => {
  const sabotee = `
    const autorisation = await requireStaffForStudent(studentId);
    const supabase = await createSupabaseServerClient();
    const refus = await controlerContenuRetour(supabase, studentId, payload);
    const saved = await saveWorkoutFeedback(supabase, { ...payload, studentId });
  `;
  const problemes = ordreDesGardes(sabotee);
  assert.ok(
    problemes.some((p) => p.includes("catégorie")),
    "sans exigence, requireStaffForStudent refuse TOUT collaborateur : le contrôle doit le dire",
  );
});

await test("SAB 5 — une DÉRIVATION qui s'appuie sur un helper de rôle est détectée", async () => {
  const vraie = await lire(...MIGRATION);
  const sabotee = vraie.replace(
    "when new.student_id = public.current_student_id() then 'autonome'",
    `when not public.${HELPER_GLOBAL}() then 'autonome'`,
  );
  const problemes = auditMigration(sabotee);
  assert.ok(
    problemes.some((p) => p.includes(HELPER_GLOBAL)),
    `le contrôle doit refuser l'énumération de rôles : ${problemes.join(" | ")}`,
  );
});

await test("SAB 6 — une migration qui PERD une garde du trigger est détectée", async () => {
  const vraie = await lire(...MIGRATION);
  /*
   * ⚠️ LES TREIZE, PAS TROIS. C'est la leçon de la revue : une liste de quatre
   * gardes laissait passer tout ce qu'elle ne nommait pas. Chacune est ici
   * retirée à son tour, et l'audit doit la réclamer.
   */
  for (const garde of [
    "build_prescribed_snapshot",
    "student_owns_workout_session",
    "new.student_id := old.student_id",
    "new.id := old.id",
    "new.session_key := old.session_key",
    "new.created_at := old.created_at",
    "new.session_ref_label := old.session_ref_label",
    "new.session_key := new.session_id::text",
    "old.prescribed_snapshot is not null then old.prescribed_snapshot",
    "new.status := old.status",
    "new.coach_reply := old.coach_reply",
    "new.submitted_at := old.submitted_at",
    "coach_reply_video_uploaded_at",
  ]) {
    const sabotee = vraie.split(garde).join("__retire__");
    assert.notEqual(sabotee, vraie, `motif « ${garde} » absent de la migration`);
    const problemes = auditMigration(sabotee);
    assert.ok(
      problemes.some((p) => p.includes(garde)),
      `la perte de « ${garde} » doit être signalée — obtenu : ${problemes.join(" | ") || "rien"}`,
    );
  }
});

/**
 * ⚠️ CE SABOTAGE EST RETOURNÉ, ET C'EST LE PLUS IMPORTANT DE LA SUITE.
 *
 * Il protégeait l'ancien helper de rôles global en exigeant sa présence. Il
 * garde maintenant le prédicat de P13-B, et éprouve les DEUX manières de le
 * perdre : le remplacer par le helper (la régression réelle, trouvée en revue
 * sur une base) ou le supprimer purement.
 */
await test("SAB 6-bis — le RETOUR du helper de rôles global dans le gardien est détecté", async () => {
  const vraie = await lire(...MIGRATION);
  const sabotee = vraie.replace(
    `  ${PREDICAT_P13B};`,
    `  v_staff := (not v_systeme) and public.${HELPER_GLOBAL}();`,
  );
  assert.notEqual(sabotee, vraie, "le motif de sabotage n'a pas été trouvé dans la migration");
  const problemes = auditMigration(sabotee);
  assert.ok(
    problemes.some((p) => p.includes("prédicat d'autorisation P13-B")),
    `la perte du prédicat doit être signalée : ${problemes.join(" | ")}`,
  );
  assert.ok(
    problemes.some((p) => p.includes("invariant P13-B est rompu")),
    `le retour du helper dans le corps doit être signalé : ${problemes.join(" | ")}`,
  );
});

await test("SAB 6-ter — la SUPPRESSION du prédicat d'autorisation est détectée", async () => {
  const vraie = await lire(...MIGRATION);
  const sabotee = vraie.replace(`  ${PREDICAT_P13B};`, "  v_staff := false;");
  assert.notEqual(sabotee, vraie, "le motif de sabotage n'a pas été trouvé");
  assert.ok(
    auditMigration(sabotee).some((p) => p.includes("prédicat d'autorisation P13-B")),
    "un v_staff constant doit être signalé",
  );
});

await test("SAB 6-quater — un search_path ramené à '' est détecté", async () => {
  const vraie = await lire(...MIGRATION);
  const sabotee = vraie.replace("set search_path = public, pg_temp\n", "set search_path = ''\n");
  assert.notEqual(sabotee, vraie, "le motif de sabotage n'a pas été trouvé");
  const problemes = auditMigration(sabotee);
  assert.ok(
    problemes.some((p) => p.includes("search_path")),
    `le search_path doit être signalé : ${problemes.join(" | ")}`,
  );
});

await test("SAB 6-quinquies — un retour à now() pour la date de saisie est détecté", async () => {
  const vraie = await lire(...MIGRATION);
  const sabotee = vraie.replace(
    "new.saisie_le  := clock_timestamp();",
    "new.saisie_le  := now();",
  );
  assert.notEqual(sabotee, vraie, "le motif de sabotage n'a pas été trouvé");
  const problemes = auditMigration(sabotee);
  assert.ok(
    problemes.some((p) => p.includes("clock_timestamp")),
    `l'absence de clock_timestamp doit être signalée : ${problemes.join(" | ")}`,
  );
  assert.ok(
    problemes.some((p) => p.includes("now()")),
    `le retour à now() doit être signalé : ${problemes.join(" | ")}`,
  );
});

await test("SAB 6-sexies — la perte de la CONSERVATION de la trace est détectée", async () => {
  const vraie = await lire(...MIGRATION);
  const sabotee = vraie.replace("    new.saisie_mode := old.saisie_mode;\n", "");
  assert.notEqual(sabotee, vraie, "le motif de sabotage n'a pas été trouvé");
  assert.ok(
    auditMigration(sabotee).some((p) => p.includes("conservation de la trace")),
    "une réponse de coach réécrirait alors la trace de l'élève : à signaler",
  );
});

await test("SAB 7 — une migration qui remplit l'historique est détectée", async () => {
  const vraie = await lire(...MIGRATION);
  const sabotee = `${vraie}\nupdate public.workout_feedback set saisie_mode = 'autonome' where saisie_mode is null;\n`;
  const problemes = auditMigration(sabotee);
  assert.ok(
    problemes.some((p) => p.includes("backfill")),
    "un backfill exécuté doit être signalé : il rendrait une supposition indiscernable d'une trace",
  );
});

await test("SAB 8 — une migration qui touche une policy est détectée", async () => {
  const sql = `${await lire(...MIGRATION)}\ncreate policy toto on public.workout_feedback for insert to authenticated using (true);\n`;
  const bas = sqlSeul(sql).toLowerCase();
  assert.ok(bas.includes("create policy"), "le contrôle de T21 doit voir la policy ajoutée");
});

console.log(`\n${reussis} réussis, ${echecs} échecs`);
if (echecs > 0) process.exit(1);
