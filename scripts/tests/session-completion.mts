import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { SessionCompletionCard } from "../../components/student/SessionCompletionCard";
import { DoubleStar } from "../../components/ui/DoubleStar";
import {
  PROGRESSIONS_AFFICHEES,
  construireBilanFinSeance,
  formatDureeSeance,
  formatProgression,
  formatTonnageSeance,
  type BilanFinSeance,
} from "../../lib/session-completion";
import type { AdminExerciseFeedbackEntry, AdminStudentFeedback } from "../../types";

/**
 * F2 — CARTE DE FIN DE SÉANCE
 *
 * CE QUE CETTE SUITE PROUVE
 *   Elle fait tourner le calcul du bilan sur des retours réels, puis MONTE la
 *   carte avec le vrai React et regarde ce qui sort. Rien ici ne se contente
 *   de chercher du texte dans un fichier source, sauf pour ce qu'aucune
 *   exécution ne peut montrer : la règle CSS de `prefers-reduced-motion`.
 *
 *   - un tonnage n'est jamais inventé : le poids du corps ne devient pas des
 *     kilos, et une séance entièrement non chiffrable rend `null` (T4, T5) ;
 *   - une progression est STRICTEMENT une hausse, et une séance ne se compare
 *     jamais à elle-même (P2, P4) ;
 *   - une valeur absente fait DISPARAÎTRE sa tuile, elle ne devient pas un
 *     zéro (R2) ;
 *   - l'emblème ne porte que les deux étoiles, jamais le rectangle plein du
 *     fichier source (R5) ;
 *   - l'animation ne s'attache QUE si l'appelant la demande (R3).
 *
 * CE QU'ELLE NE PEUT PAS PROUVER
 *   Que l'allumage est joli. Le rendu serveur ne joue aucune animation : on
 *   vérifie que les classes sont posées et que la coupure sous
 *   `prefers-reduced-motion` existe. Le reste se regarde.
 */

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

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const CSS = lire("../../app/globals.css");
const SECTION = lire("../../components/student/SessionFeedbackSection.tsx");

const ELEVE = "e1";

/** Une série réalisée. `setNumber` distingue deux séries du même exercice. */
function serie(
  exerciseName: string,
  setNumber: number,
  loadUsed: string,
  repsDone: string,
): AdminExerciseFeedbackEntry {
  return { exerciseName, setNumber, loadUsed, repsDone, rpe: null, comment: "" };
}

function retour(options: {
  id: string;
  entries: AdminExerciseFeedbackEntry[];
  date?: string;
  durationMinutes?: number | null;
  sessionId?: string;
  completed?: boolean;
}): AdminStudentFeedback {
  return {
    id: options.id,
    studentId: ELEVE,
    type: "entrainement",
    sessionId: options.sessionId ?? `s-${options.id}`,
    refLabel: "Séance",
    date: options.date ?? "2026-08-01",
    performedAt: options.date ?? "2026-08-01",
    completed: options.completed ?? true,
    durationMinutes: options.durationMinutes ?? null,
    rpe: null,
    pain: "",
    comment: "",
    exerciseEntries: options.entries,
    status: "a-traiter",
    coachReply: "",
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
}

const bilan = (feedback: AdminStudentFeedback, historique: AdminStudentFeedback[] = []) =>
  construireBilanFinSeance({ feedback, historique, aujourdhui: "2026-08-20" });

/* ════════════════════════════════════════════════════════════════════════
 * T. LES CHIFFRES DU JOUR
 * ════════════════════════════════════════════════════════════════════════ */

test("T0. le bilan porte la DÉCLARATION de l'élève, pas une supposition", () => {
  const finie = bilan(retour({ id: "a", entries: [serie("Squat", 1, "80 kg", "8")], completed: true }));
  assert.equal(finie.seanceTerminee, true);
  const interrompue = bilan(retour({ id: "b", entries: [serie("Squat", 1, "80 kg", "8")], completed: false }));
  assert.equal(interrompue.seanceTerminee, false);
  assert.equal(interrompue.seriesRealisees, 1, "le travail réalisé compte quand même");
});

test("T1. séries : on compte le RÉALISÉ, jamais le prescrit", () => {
  const b = bilan(
    retour({
      id: "a",
      entries: [
        serie("Développé couché", 1, "80 kg", "8"),
        serie("Développé couché", 2, "80 kg", "8"),
        // Ni charge ni répétitions : l'élève n'a pas fait cette série.
        serie("Développé couché", 3, "", ""),
      ],
    }),
  );
  assert.equal(b.seriesRealisees, 2);
});

test("T2. le cardio a son propre bloc : il ne gonfle pas le compte de séries", () => {
  const b = bilan(
    retour({
      id: "a",
      entries: [serie("Développé couché", 1, "80 kg", "8"), serie("Cardio · Résultats", 1, "", "")],
    }),
  );
  assert.equal(b.seriesRealisees, 1);
});

test("T3. tonnage : charge × répétitions, haltères DOUBLÉS, fourchette moyennée", () => {
  // 80 × 8 = 640
  assert.equal(bilan(retour({ id: "a", entries: [serie("Squat", 1, "80 kg", "8")] })).tonnageKg, 640);
  // 24 kg PAR haltère → 48 kg réels × 10 = 480. Sans le doublement, on
  // annoncerait la moitié de ce que l'élève a réellement soulevé.
  assert.equal(bilan(retour({ id: "b", entries: [serie("Curl", 1, "24 kg / haltère", "10")] })).tonnageKg, 480);
  // « 8-10 » → 9 répétitions moyennes × 50 = 450.
  assert.equal(bilan(retour({ id: "c", entries: [serie("Rowing", 1, "50 kg", "8-10")] })).tonnageKg, 450);
});

test("T4. le poids du corps ne devient JAMAIS des kilos inventés", () => {
  const b = bilan(
    retour({
      id: "a",
      entries: [serie("Squat", 1, "80 kg", "8"), serie("Tractions", 1, "poids du corps", "10")],
    }),
  );
  assert.equal(b.tonnageKg, 640, "seule la série chiffrable compte");
  assert.ok(b.tonnagePartiel, "et le total est annoncé comme un PLANCHER");
});

test("T5. une séance entièrement non chiffrable n'a pas de tonnage — pas un zéro", () => {
  const b = bilan(
    retour({ id: "a", entries: [serie("Tractions", 1, "poids du corps", "10"), serie("Dips", 1, "assisté", "12")] }),
  );
  assert.equal(b.tonnageKg, null, "null, pas 0 : « 0 kg soulevé » serait faux et vexant");
  assert.ok(b.tonnagePartiel);
  assert.equal(b.seriesRealisees, 2, "les séries, elles, ont bien eu lieu");
});

test("T6. mise en forme : durée, tonnage, progression", () => {
  assert.equal(formatDureeSeance(48), "48 min");
  assert.equal(formatDureeSeance(60), "1 h");
  assert.equal(formatDureeSeance(68), "1 h 08");
  assert.equal(formatDureeSeance(null), null);
  assert.equal(formatDureeSeance(0), null, "zéro minute n'est pas une durée");

  assert.equal(formatTonnageSeance(640), "640 kg");
  assert.equal(formatTonnageSeance(4270), "4,3 t");
  assert.equal(formatTonnageSeance(null), null);

  assert.equal(formatProgression({ exerciseName: "x", avantKg: 80, apresKg: 85 }), "80 → 85 kg");
  // Les décimales utiles restent, les inutiles disparaissent.
  assert.equal(formatProgression({ exerciseName: "x", avantKg: 62.5, apresKg: 65 }), "62,5 → 65 kg");
});

/* ════════════════════════════════════════════════════════════════════════
 * P. LA PROGRESSION
 * ════════════════════════════════════════════════════════════════════════ */

const AVANT = retour({
  id: "ancien",
  sessionId: "s-ancien",
  date: "2026-07-25",
  entries: [serie("Développé couché", 1, "80 kg", "8"), serie("Squat barre", 1, "100 kg", "5")],
});

test("P1. une charge qui monte est détectée et nommée", () => {
  const b = bilan(
    retour({ id: "neuf", entries: [serie("Développé couché", 1, "85 kg", "8")] }),
    [AVANT],
  );
  assert.deepEqual(b.progressions, [{ exerciseName: "Développé couché", avantKg: 80, apresKg: 85 }]);
});

test("P2. une charge ÉGALE ou en baisse n'est pas une progression", () => {
  assert.deepEqual(
    bilan(retour({ id: "n1", entries: [serie("Développé couché", 1, "80 kg", "8")] }), [AVANT]).progressions,
    [],
    "annoncer « progression : 80 → 80 » serait une félicitation vide",
  );
  assert.deepEqual(
    bilan(retour({ id: "n2", entries: [serie("Développé couché", 1, "75 kg", "8")] }), [AVANT]).progressions,
    [],
  );
});

test("P3. sans historique, la carte se tait", () => {
  assert.deepEqual(bilan(retour({ id: "n", entries: [serie("Développé couché", 1, "85 kg", "8")] })).progressions, []);
});

test("P4. une séance ne se compare JAMAIS à elle-même", () => {
  // Le retour du jour est présent dans l'historique — c'est le cas réel, la
  // liste vient d'un chargement groupé. S'il n'était pas écarté, chaque
  // progression serait nulle par construction.
  const dujour = retour({ id: "neuf", entries: [serie("Développé couché", 1, "85 kg", "8")] });
  const b = bilan(dujour, [dujour, AVANT]);
  assert.equal(b.progressions.length, 1);
  assert.equal(b.progressions[0]!.avantKg, 80);
});

test("P5. c'est la charge la PLUS LOURDE de chaque séance qui est comparée", () => {
  // Un échauffement à 40 kg suivi d'une série lourde à 90 : la progression
  // porte sur le sommet, pas sur la première série venue.
  const b = bilan(
    retour({
      id: "neuf",
      entries: [serie("Développé couché", 1, "40 kg", "10"), serie("Développé couché", 2, "90 kg", "5")],
    }),
    [AVANT],
  );
  assert.deepEqual(b.progressions, [{ exerciseName: "Développé couché", avantKg: 80, apresKg: 90 }]);
});

test("P6. les plus fortes hausses d'abord, et pas plus de trois", () => {
  const avant = retour({
    id: "ancien",
    sessionId: "s-ancien",
    date: "2026-07-25",
    entries: [1, 2, 3, 4].map((n) => serie(`Exercice ${n}`, 1, "50 kg", "8")),
  });
  const b = bilan(
    retour({
      id: "neuf",
      entries: [
        serie("Exercice 1", 1, "52 kg", "8"),
        serie("Exercice 2", 1, "60 kg", "8"),
        serie("Exercice 3", 1, "55 kg", "8"),
        serie("Exercice 4", 1, "70 kg", "8"),
      ],
    }),
    [avant],
  );
  assert.equal(b.progressions.length, PROGRESSIONS_AFFICHEES, "la carte est un instant, pas un tableau");
  assert.deepEqual(b.progressions.map((p) => p.exerciseName), ["Exercice 4", "Exercice 2", "Exercice 3"]);
});

test("P7. un exercice sans charge chiffrable ne produit aucune progression", () => {
  const avant = retour({
    id: "ancien",
    sessionId: "s-ancien",
    date: "2026-07-25",
    entries: [serie("Tractions", 1, "poids du corps", "8")],
  });
  const b = bilan(retour({ id: "neuf", entries: [serie("Tractions", 1, "poids du corps", "12")] }), [avant]);
  assert.deepEqual(b.progressions, [], "12 répétitions au lieu de 8 est un progrès, mais pas une CHARGE");
});

test("P8. aucun retour du tout : le bilan est vide, pas en erreur", () => {
  const vide = construireBilanFinSeance({ feedback: null, historique: [] });
  assert.deepEqual(vide, {
    seanceTerminee: false,
    dureeMinutes: null,
    seriesRealisees: 0,
    tonnageKg: null,
    tonnagePartiel: false,
    progressions: [],
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * R. LA CARTE, MONTÉE POUR DE VRAI
 * ════════════════════════════════════════════════════════════════════════ */

const BILAN_COMPLET: BilanFinSeance = {
  seanceTerminee: true,
  dureeMinutes: 68,
  seriesRealisees: 18,
  tonnageKg: 4270,
  tonnagePartiel: false,
  progressions: [{ exerciseName: "Développé couché", avantKg: 80, apresKg: 85 }],
};

const rendre = (b: BilanFinSeance, celebre: boolean) =>
  renderToString(createElement(SessionCompletionCard, { bilan: b, celebre })).replace(/<!-- -->/g, "");

test("R1. la carte montre la durée, les séries, le tonnage et la progression", () => {
  const html = rendre(BILAN_COMPLET, true);
  assert.ok(html.includes("1 h 08"));
  assert.ok(html.includes("18"));
  assert.ok(html.includes("4,3 t"));
  assert.ok(html.includes("Développé couché"));
  assert.ok(html.includes("80 → 85 kg"));
  assert.ok(html.includes("SÉANCE TERMINÉE") || html.includes("Séance terminée"));
});

test("R2. une valeur absente fait DISPARAÎTRE sa tuile — elle ne devient pas un zéro", () => {
  const html = rendre(
    { seanceTerminee: true, dureeMinutes: null, seriesRealisees: 12, tonnageKg: null, tonnagePartiel: true, progressions: [] },
    false,
  );
  assert.ok(html.includes("12"));
  assert.ok(!/DURÉE|Durée/.test(html), "aucune tuile de durée");
  assert.ok(!/Soulevé/.test(html), "aucune tuile de tonnage");
  // Et surtout, aucun zéro fabriqué.
  assert.ok(!/>0</.test(html));
  assert.ok(!html.includes("0 kg"));
  assert.ok(!html.includes("0 min"));
});

test("R3. l'animation ne s'attache QUE si l'appelant la demande", () => {
  const allume = rendre(BILAN_COMPLET, true);
  assert.ok(allume.includes("double-star-a"), "à l'envoi : les étoiles s'allument");
  assert.ok(allume.includes("double-star-b"));
  assert.ok(allume.includes("session-completion-in"));

  const calme = rendre(BILAN_COMPLET, false);
  assert.ok(!calme.includes("double-star-a"), "retour rouvert : aucune animation");
  assert.ok(!calme.includes("double-star-b"));
  assert.ok(!calme.includes("session-completion-in"));
  // L'emblème, lui, reste PRÉSENT : c'est l'animation qu'on retire, pas la marque.
  assert.ok(calme.includes("<svg"));
});

test("R3bis. le TITRE n'affirme que ce que l'élève a déclaré", () => {
  // La case « Séance terminée » part décochée et le retour s'envoie sans
  // elle. Annoncer une séance terminée qu'il n'a pas déclarée serait la seule
  // chose fausse de cette carte.
  const terminee = rendre({ ...BILAN_COMPLET, seanceTerminee: true }, false);
  assert.ok(terminee.includes("Séance terminée"));
  assert.ok(!terminee.includes("Retour envoyé"));

  const interrompue = rendre({ ...BILAN_COMPLET, seanceTerminee: false }, false);
  assert.ok(interrompue.includes("Retour envoyé"));
  assert.ok(!interrompue.includes("Séance terminée"), "aucune séance terminée n'est annoncée");
  // Les chiffres, eux, restent : l'élève a bien fait ce travail.
  assert.ok(interrompue.includes("1 h 08") && interrompue.includes("4,3 t"));
});

test("R4. le tonnage partiel est expliqué, jamais présenté comme un total exact", () => {
  const partiel = rendre({ ...BILAN_COMPLET, tonnagePartiel: true }, false);
  assert.ok(/poids du corps/.test(partiel), "la carte dit ce qui n'est pas compté");
  assert.ok(/Total minimum/.test(partiel), "et annonce le chiffre comme un PLANCHER, pas un total exact");
  const exact = rendre({ ...BILAN_COMPLET, tonnagePartiel: false }, false);
  assert.ok(!/poids du corps/.test(exact), "et se tait quand tout est compté");
});

test("R5. l'emblème ne porte QUE les deux étoiles — pas le rectangle du fichier source", () => {
  const html = renderToString(createElement(DoubleStar, {}));
  const tracés = [...html.matchAll(/<path/g)].length;
  assert.equal(tracés, 2, "le premier tracé du SVG officiel couvre tout le canevas : il est écarté");
  assert.ok(html.includes('viewBox="0 0 636 807"'), "le cadrage du fichier officiel est conservé");
  // Il suit la couleur du texte : une seule version pour le thème clair ET
  // sombre, aucune couleur décorative ajoutée.
  assert.ok(html.includes('fill="currentColor"'));
  assert.ok(/role="img"/.test(html) && /aria-label/.test(html), "un lecteur d'écran doit pouvoir le nommer");
});

/* ════════════════════════════════════════════════════════════════════════
 * A. ACCESSIBILITÉ ET SOBRIÉTÉ DU MOUVEMENT
 * ════════════════════════════════════════════════════════════════════════ */

test("A1. l'animation est COUPÉE sous prefers-reduced-motion", () => {
  // Coupée, pas ralentie : les deux étoiles sont là, entières, dès le premier
  // rendu. C'est la règle tenue par les treize autres animations du dépôt.
  const bloc = CSS.slice(CSS.indexOf("@keyframes double-star-allumage"));
  assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,240}\.double-star-a[\s\S]{0,120}animation: none/.test(bloc));
  assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.session-completion-in[\s\S]{0,80}animation: none/.test(bloc));
});

test("A2. le mouvement respecte les règles de la maison", () => {
  const bloc = CSS.slice(CSS.indexOf("@keyframes double-star-allumage"));
  // Entrée ⇒ ease-out, jamais ease-in : ease-in retarde l'instant que l'œil
  // regarde. On réutilise le token existant, on n'invente pas une courbe.
  assert.ok(bloc.includes("var(--ease-out)"));
  assert.ok(!/ease-in[^-]/.test(bloc), "aucun ease-in sur une entrée");
  // Rien n'apparaît de rien : jamais scale(0).
  assert.ok(!bloc.includes("scale(0)"));
  assert.ok(/transform: scale\(0\.8[0-9]\)/.test(bloc), "départ à ~0,86, pas à zéro");
  // Chaque étoile tourne autour de SON centre, sinon les deux glissent en
  // diagonale en grandissant.
  assert.ok(bloc.includes("transform-box: fill-box"));
  // La cascade : sans décalage, les deux étoiles clignotent ensemble.
  assert.ok(/\.double-star-b\s*\{[^}]*animation-delay: 120ms/.test(bloc));
  // Seules `opacity` et `transform` sont animées — les deux propriétés que le
  // compositeur sait traiter sans recalculer la mise en page.
  const cadres = bloc.slice(0, bloc.indexOf("}\n\n"));
  assert.ok(!/(width|height|top|left|margin):/.test(cadres));
});

test("A3. l'allumage ne se rejoue ni au rechargement, ni après une CORRECTION", () => {
  // Une séance se termine une fois. Rouvrir le retour demain, ou corriger une
  // faute de frappe, ne sont pas des fins de séance — et une étincelle qui se
  // rejoue à chaque visite cesse d'être une récompense.
  const source = SECTION.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(source.includes("useState(false)"), "l'état est local : un rechargement le perd");
  assert.ok(source.includes("if (!editing) setCelebration(true)"), "une correction ne rallume rien");
  assert.ok(/celebre=\{celebration\}/.test(source), "et c'est bien lui qui pilote la carte");
});

test("A4. AUCUN second analyseur de charge n'a été écrit", () => {
  // Le tonnage du coach et celui de la carte doivent dire la même chose. Un
  // second analyseur de « 24 kg / haltère », de « 60-70 kg » ou de « poids du
  // corps » finirait par diverger du premier — et c'est l'élève qui verrait
  // deux totaux différents pour la même séance.
  const source = readFileSync(new URL("../../lib/session-completion.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  for (const partagé of ["parseLoad", "getEffectiveLoadKg", "calculateExerciseTonnage", "buildPreviousPerformanceIndex", "findPreviousPerformance", "hasRealizedSetInput", "normalizeExerciseName"]) {
    assert.ok(code.includes(partagé), `helper partagé non réutilisé : ${partagé}`);
  }
  // Et surtout : AUCUNE analyse de chaîne. Le vocabulaire des charges
  // (« poids du corps », « / haltère », « assisté », « machine ») ne doit
  // apparaître nulle part ici — il est reconnu une seule fois, par parseLoad.
  for (const mot of ["haltère", "haltere", "poids du corps", "assisté", "assiste", "machine"]) {
    assert.ok(!code.toLowerCase().includes(mot), `vocabulaire de charge réanalysé ici : ${mot}`);
  }
  assert.ok(!/new RegExp|\.match\(|\.test\(/.test(code), "aucune analyse de chaîne maison");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
