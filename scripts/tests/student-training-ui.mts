/**
 * Harnais — feat/student-training-apple-ui (refonte visuelle espace élève).
 *
 * HONNÊTETÉ DU PÉRIMÈTRE : ces tests valident la STRUCTURE rendue (SSR) et
 * les invariants de code — classes responsives, zones tactiles, aria,
 * placeholders, absence d'écriture métier. Ils ne MESURENT PAS des pixels :
 * les contrôles « aucun overflow à 320/375/430/768/1024/1440 px », les
 * zooms 80-150 % et les thèmes réels se font via la checklist manuelle
 * Chrome/Safari fournie avec le chantier (les garanties structurelles
 * correspondantes — min-w-0, grilles responsives, tokens, largeur max —
 * sont, elles, vérifiées ici).
 *
 * Lancement : npx tsx scripts/tests/student-training-ui.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ExerciseFeedbackCard } from "../../components/student/ExerciseFeedbackCard";
import type { Exercise, ExerciseFeedback } from "../../types";
import type { PreviousExercisePerf as PerfType } from "../../lib/previous-performance";

let réussis = 0;
let échecs = 0;
function test(nom: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      réussis += 1;
      console.log(`ok - ${nom}`);
    })
    .catch((erreur) => {
      échecs += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(erreur);
    });
}

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sourceCarte = lire("../../components/student/ExerciseFeedbackCard.tsx");
const sourceSection = lire("../../components/student/SessionFeedbackSection.tsx");
const sourceShell = lire("../../components/student/StudentShell.tsx");
const sourceSidebar = lire("../../components/student/StudentSidebar.tsx");
const sourceHistorique = lire("../../app/(student)/entrainement/historique/page.tsx");
const sourceGlobals = lire("../../app/globals.css");

function rendreCarte(options: {
  sets?: number;
  nom?: string;
  commentaire?: string;
  recommendedRpe?: string;
  previous?: PerfType | null;
  videoUrl?: string;
}): string {
  const nb = options.sets ?? 3;
  const exercice: Exercise = {
    id: "ex-1", name: options.nom ?? "Butterfly arrière d'épaule", sets: nb, reps: "13-12-11",
    restSeconds: 180, tempo: "2-0-1-0", recommendedLoad: "30", videoUrl: options.videoUrl ?? "https://exemple.test/demo",
    recommendedRpe: options.recommendedRpe ?? "",
  };
  const saisie: ExerciseFeedback = {
    studentId: "e", sessionId: "s", exerciseId: "ex-1", exerciseName: exercice.name,
    sets: Array.from({ length: nb }, (_, i) => ({
      studentId: "e", sessionId: "s", exerciseId: "ex-1", setNumber: i + 1, loadUsed: "", repsDone: "", rpe: "",
    })),
    rpe: null, comment: options.commentaire ?? "",
  };
  return renderToString(createElement(ExerciseFeedbackCard, {
    exercise: exercice, index: 1, feedback: saisie,
    previous: options.previous ?? null,
    onSetChange: () => {}, onCommentChange: () => {},
  }));
}

const historiqueComplet: PerfType = {
  sets: {
    1: { loadUsed: "32", repsDone: "10", rpe: 8 },
    2: { loadUsed: "32", repsDone: "10", rpe: 8 },
    3: { loadUsed: "32", repsDone: "10", rpe: 9 },
  },
  exerciseRpe: null, performedAt: "2026-07-27", matchedBy: "library",
};

await (async () => {
  await test("1. rendu sans historique : aucune ligne repère, structure complète", () => {
    const html = rendreCarte({});
    assert.equal(html.split("Dernières perfs").length - 1, 0);
    // SSR : React insère un nœud-commentaire entre « Série » et le numéro.
    assert.ok(html.includes("Retour élève") && /Série (<!-- -->)?1/.test(html));
    assert.ok(html.includes("rounded-card") && html.includes("shadow-soft"), "surface arrondie, ombre légère");
  });

  await test("2. historique complet : une ligne « Dernières perfs » par série, alignée sur le groupe de champs", () => {
    const html = rendreCarte({ previous: historiqueComplet });
    assert.equal(html.split("Dernières perfs").length - 1, 3, "une ligne par série");
    // Alignement : la ligne saute la colonne libellé et se centre au-dessus
    // des champs (≥ sm) — structure [72px | 1fr] + sm:text-center.
    assert.equal(html.split("sm:grid-cols-[72px_1fr]").length - 1, 3);
    assert.equal(html.split("sm:text-center").length - 1, 3);
    assert.ok(html.includes("32 × 10 · RPE 8") && html.includes("32 × 10 · RPE 9"), "chaque série garde SA valeur");
  });

  await test("3. historique partiel : la ligne reste visible avec les seules données présentes", () => {
    const html = rendreCarte({
      previous: { sets: { 2: { loadUsed: "", repsDone: "9", rpe: null } }, exerciseRpe: null, performedAt: null, matchedBy: "name" },
    });
    assert.equal(html.split("Dernières perfs").length - 1, 1, "série 2 seulement");
    assert.ok(/Dernières perfs : (<!-- -->)?9/.test(html), "donnée partielle affichée telle quelle");
  });

  await test("4. RPE prescrit unique : placeholder sur toutes les séries", () => {
    const html = rendreCarte({ recommendedRpe: "8" });
    assert.equal(html.split('placeholder="RPE 8"').length - 1, 3);
  });

  await test("5. séquence RPE : placeholder par index", () => {
    const html = rendreCarte({ recommendedRpe: "8-8-9" });
    assert.equal(html.split('placeholder="RPE 8"').length - 1, 2);
    assert.equal(html.split('placeholder="RPE 9"').length - 1, 1);
  });

  await test("6. sans prescription : placeholder exactement « RPE » (l'historique reste dans la ligne repère)", () => {
    const html = rendreCarte({ previous: historiqueComplet });
    assert.equal(html.split('placeholder="RPE"').length - 1, 3);
    assert.ok(!html.includes('placeholder="RPE 8"'));
  });

  await test("7. quatre séries et plus : structure stable, une grille par série", () => {
    const html = rendreCarte({ sets: 5 });
    assert.equal(html.split("sm:grid-cols-[72px_1fr_1fr_84px]").length - 1, 5);
    assert.equal(html.split("<input").length - 1, 16, "5 séries × 3 champs + commentaire");
  });

  await test("8. nom d'exercice long : conteneur min-w-0 + retour à la ligne (jamais d'overflow structurel)", () => {
    const html = rendreCarte({ nom: "Développé militaire haltères assis prise neutre avec pause en bas d'amplitude" });
    assert.ok(html.includes("min-w-0"), "le bloc titre peut rétrécir");
    assert.ok(html.includes("leading-snug"), "titre multi-lignes propre");
  });

  await test("9. commentaire long : champ contrôlé pleine largeur, valeur rendue", () => {
    const long = "Très bonnes sensations sur les deux premières séries, ".repeat(4);
    const html = rendreCarte({ commentaire: long });
    assert.ok(html.includes("Très bonnes sensations"), "value rendue");
    assert.ok(html.includes("Commentaire exercice (optionnel)"));
  });

  await test("10. bouton démonstration : lien 44px, état désactivé honnête sans vidéo", () => {
    const avec = rendreCarte({});
    assert.ok(avec.includes("Voir la démo") && avec.includes("min-h-11"), "zone tactile ≥ 44px");
    assert.ok(avec.includes('rel="noopener noreferrer"'));
    const sans = rendreCarte({ videoUrl: " " });
    assert.ok(sans.includes("Aucune vidéo") && !sans.includes("Voir la démo"));
  });

  await test("11-12. thèmes clair et sombre : uniquement des tokens, aucune couleur codée en dur", () => {
    for (const source of [sourceCarte, sourceShell, sourceSidebar]) {
      const code = sansCommentaires(source);
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), "aucun hexadécimal en dur");
      assert.ok(!/rgb\(/.test(code), "aucun rgb() en dur");
    }
    const html = rendreCarte({ previous: historiqueComplet });
    for (const token of ["bg-card", "border-border", "text-foreground", "text-muted-foreground", "bg-background"]) {
      assert.ok(html.includes(token), `token ${token} présent (le thème pilote les deux modes)`);
    }
  });

  await test("13-15. téléphone (320/375/430) : garanties structurelles anti-overflow", () => {
    const html = rendreCarte({ previous: historiqueComplet });
    // Aucune largeur fixe en px sur les champs ; tout est en fractions/min-w-0.
    assert.ok(!/w-\[\d+px\]/.test(sourceCarte), "aucune largeur px figée");
    assert.equal(html.split("min-w-0").length - 1 >= 7, true, "champs et textes rétrécissables");
    // Mobile : libellé pleine largeur, charge+reps côte à côte, RPE pleine largeur.
    assert.equal(html.split("grid-cols-2").length - 1, 3);
    assert.equal(html.split("col-span-2").length - 1, 6, "libellé + RPE en pleine largeur sur mobile, par série");
  });

  await test("16-18. tablette et desktop (768/1024/1440) : colonne principale et grille 4 colonnes", () => {
    const html = rendreCarte({});
    assert.ok(html.includes("sm:grid-cols-[72px_1fr_1fr_84px]"), "≥ sm : [libellé | charge | reps | RPE étroit]");
    const section = sansCommentaires(sourceSection);
    assert.equal(section.split("max-w-3xl").length - 1, 2, "formulaire ET récapitulatif recentrés");
    assert.ok(sansCommentaires(sourceShell).includes("max-w-5xl"), "contenu global borné sur grand écran");
    assert.ok(sansCommentaires(sourceHistorique).includes("max-w-3xl"), "historique recentré");
  });

  await test("19-20. navigation clavier et focus visible", () => {
    const html = rendreCarte({});
    assert.equal(html.split("focus-visible:ring-2").length - 1 >= 10, true, "focus visible sur chaque champ");
    const sidebar = sansCommentaires(sourceSidebar);
    assert.ok(sidebar.includes("focus-visible:ring-2"), "liens de navigation focusables visiblement");
    assert.ok(!/<div[^>]*onClick(?!.*aria)/.test(sansCommentaires(sourceCarte)), "aucun bouton transformé en div dans la carte");
    assert.ok(sidebar.includes('aria-label={locked'), "libellés d'accès conservés");
  });

  await test("21. zones tactiles minimales 44px (champs, boutons, navigation)", () => {
    const html = rendreCarte({});
    assert.ok(html.includes("py-2.5"), "champs ≥ 44px (py-2.5 + text-sm + bordures)");
    assert.ok(html.includes("min-h-11"), "boutons ≥ 44px");
    const shell = sansCommentaires(sourceShell);
    assert.ok(shell.includes("min-h-11 min-w-11"), "bouton menu mobile ≥ 44×44");
    assert.ok(sansCommentaires(sourceSidebar).includes("min-h-11"), "liens de navigation ≥ 44px");
  });

  await test("22. prefers-reduced-motion respecté (règles globales + aucune animation ajoutée)", () => {
    assert.equal(sourceGlobals.split("prefers-reduced-motion").length - 1 >= 2, true, "règles globales en place");
    for (const source of [sourceCarte, sourceShell, sourceSidebar]) {
      const code = sansCommentaires(source);
      assert.ok(!code.includes("animate-") || code.includes("animate-fade-in") === false, "aucune animation décorative ajoutée");
      assert.ok(!code.includes("keyframes"), "aucune keyframe locale");
    }
    assert.ok(sansCommentaires(sourceCarte).split("transition-colors").length - 1 >= 1, "transitions discrètes uniquement (couleurs)");
  });

  await test("23. aucun changement du payload de sauvegarde", () => {
    const section = sansCommentaires(sourceSection);
    assert.equal(section.split(".filter(hasRealizedSetInput)").length - 1, 2, "filtre de saisie réelle intact (2 chemins)");
    assert.ok(section.includes("rpe: rpeParSerie.get("), "RPE par série intact");
    assert.ok(section.includes("serializeCardioBlockResult"), "contrat cardio intact");
    assert.ok(!/value=\{[^}]*previous/.test(sansCommentaires(sourceCarte)), "placeholders jamais transformés en valeurs");
  });

  await test("24. aucun changement des fonctions Supabase depuis la carte/le shell", () => {
    for (const source of [sourceCarte, sourceShell]) {
      assert.ok(!/from \"@\/lib\/supabase/.test(source), "aucun import Supabase dans les composants purement visuels");
    }
    const section = sansCommentaires(sourceSection);
    assert.ok(section.includes("useSupabaseWorkoutFeedback(sessionId)"), "hook métier inchangé");
    assert.ok(section.includes("supabaseFeedback.submit("), "chemin de sauvegarde inchangé");
  });

  await test("25. aucune régression cardio (formulaire bloc par bloc et parsing intacts)", () => {
    const section = sansCommentaires(sourceSection);
    assert.ok(section.includes("CardioBlockFeedbackForm"), "formulaire cardio branché tel quel");
    assert.ok(section.includes("parseCardioResults"), "parsing cardio intact");
    assert.ok(section.includes("cardioBlockPrescribedSnapshot"), "repères prescrits cardio intacts");
  });

  await test("26. aucune régression de l'historique élève (lecture et mentions honnêtes)", () => {
    const histo = sansCommentaires(sourceHistorique);
    assert.ok(histo.includes("getWorkoutFeedbackForStudent"), "lecture par student_id inchangée");
    assert.ok(histo.includes("exerciseGlobalRpeMentions"), "mention RPE global unique conservée");
    assert.ok(histo.includes("describeCardioBlockResult"), "rendu cardio lisible conservé");
  });

  await test("27. aucune régression de la réponse coach", () => {
    const histo = sansCommentaires(sourceHistorique);
    assert.ok(histo.includes("coachReply"), "réponse du coach toujours affichée dans l'historique");
    const section = sansCommentaires(sourceSection);
    assert.ok(section.includes("startEditing"), "modification d'un retour conservée");
  });

  await test("28. zoom 150 % : garanties structurelles (tailles relatives, aucun texte figé en px)", () => {
    // Le zoom réel se contrôle manuellement ; structurellement, aucun
    // font-size en px figé ni hauteur fixe susceptible de couper le texte.
    for (const source of [sourceCarte, sourceShell, sourceSidebar]) {
      const code = sansCommentaires(source);
      assert.ok(!/text-\[\d+px\]/.test(code), "aucune taille de texte en px figé");
      assert.ok(!/h-\[\d+px\]/.test(code), "aucune hauteur figée en px");
    }
  });
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
