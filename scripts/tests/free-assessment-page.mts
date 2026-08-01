/**
 * Harnais — section « Mon bilan offert » : RENDU et POSITION dans la page
 * d'accueil (chantier feat/free-assessment-form, juillet 2026).
 *
 * Monté avec react-dom/server, donc SANS la condition `react-server` — la
 * logique serveur (envoi d'email) est couverte par
 * scripts/tests/free-assessment-email.mts. Aucun email ne peut partir d'ici :
 * ce fichier n'importe aucune fonction d'envoi.
 *
 * Lancement : npx tsx scripts/tests/free-assessment-page.mts
 */
process.env.TZ = "Europe/Paris";
process.env.EMAILS_ENABLED = "false";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FreeAssessmentForm } from "../../components/sections/FreeAssessmentForm";
import { FreeAssessment } from "../../components/sections/FreeAssessment";

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

const formHtml = renderToStaticMarkup(createElement(FreeAssessmentForm));
const sectionHtml = renderToStaticMarkup(createElement(FreeAssessment));
const homeSource = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
/** Feuille de styles globale — lue une seule fois, partagée par les tests 9, 10 et 11. */
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const formSource = readFileSync(
  new URL("../../components/sections/FreeAssessmentForm.tsx", import.meta.url),
  "utf8",
);
const sectionSource = readFileSync(
  new URL("../../components/sections/FreeAssessment.tsx", import.meta.url),
  "utf8",
);

/* ─── 1-3. Position dans la page d'accueil ─── */

test("1. la section est placée APRÈS les transformations", () => {
  const transformations = homeSource.indexOf("<Transformations />");
  const bilan = homeSource.indexOf("<FreeAssessment />");
  assert.ok(transformations > 0, "section Transformations absente de la home");
  assert.ok(bilan > 0, "section FreeAssessment absente de la home");
  assert.ok(bilan > transformations, "le bilan doit venir après les transformations");
});

test("2. la section est placée AVANT les programmes", () => {
  const bilan = homeSource.indexOf("<FreeAssessment />");
  const programmes = homeSource.indexOf("<PublicPrograms />");
  assert.ok(programmes > 0, "section PublicPrograms absente de la home");
  assert.ok(bilan < programmes, "le bilan doit venir avant les programmes");

  // Ordre complet attendu de la page d'accueil.
  const ordre = ["<Hero />", "<MethodStorytelling />", "<Transformations />", "<FreeAssessment />", "<PublicPrograms />", "<Newsletter />"];
  let position = -1;
  for (const balise of ordre) {
    const index = homeSource.indexOf(balise);
    assert.ok(index > position, `« ${balise} » absent ou mal ordonné`);
    position = index;
  }
});

test("3. titre, introduction, mention sans engagement et ancre stable", () => {
  assert.ok(sectionHtml.includes("Mon bilan offert"), "titre principal absent");
  assert.ok(sectionHtml.includes('id="bilan-offert"'), "ancre #bilan-offert absente");
  assert.ok(sectionHtml.includes("scroll-mt-24"), "décalage sous le header fixe absent");
  assert.ok(
    sectionHtml.includes("comprendre ton objectif et les difficultés que tu"),
    "texte d'introduction absent",
  );
  // Depuis la mise en avant, la mention est une pastille (« Sans engagement »)
  // plutôt qu'une phrase : on teste la présence, pas la capitalisation.
  assert.ok(/sans engagement/i.test(sectionHtml), "mention « sans engagement » absente");
  // Aucun prix, aucune promesse de résultat.
  assert.ok(!/\d+\s*(€|euros)/i.test(sectionHtml), "aucun prix ne doit être affiché");
  assert.ok(!/garanti/i.test(sectionHtml), "aucune promesse de résultat garanti");
});

/* ─── 4-6. Questionnaire ─── */

test("4. le formulaire déclare EXACTEMENT six questions, dans l'ordre", () => {
  const libelles = [
    "Quel est ton nom ?",
    "Quel est ton prénom ?",
    "Quel est ton numéro de téléphone ?",
    "Quelle est ton adresse email ?",
    "Quel est ton objectif principal ?",
    "ta plus grande frustration ?",
  ];
  let position = -1;
  for (const libelle of libelles) {
    const index = formSource.indexOf(libelle);
    assert.ok(index > position, `question « ${libelle} » absente ou mal ordonnée`);
    position = index;
  }
  assert.equal((formSource.match(/<QuestionBlock/g) ?? []).length, 6, "six blocs de question");
});

test("5. à l'ouverture, SEULE la première question est montée", () => {
  const numeros = formHtml.match(/>0[1-9]</g) ?? [];
  assert.deepEqual(numeros, [">01<"], "une seule question au premier rendu");
  assert.ok(formHtml.includes("Quel est ton nom ?"), "question 1 présente");
  for (const suivante of [
    "Quel est ton prénom ?",
    "Quel est ton numéro de téléphone ?",
    "Quelle est ton adresse email ?",
    "Quel est ton objectif principal ?",
    "ta plus grande frustration ?",
  ]) {
    assert.ok(!formHtml.includes(suivante), `« ${suivante} » ne doit pas être montée d'emblée`);
  }
  // Compteur et barre de progression.
  assert.ok(/Question\s*1\s*sur\s*6/.test(formHtml.replace(/<[^>]+>/g, " ")), "compteur « Question 1 sur 6 »");
  assert.ok(formHtml.includes("width:25%") || /width:\s*17%/.test(formHtml) || formHtml.includes("bg-primary"),
    "barre de progression présente");
  // Ni consentement ni bouton d'envoi tant que le parcours n'est pas terminé.
  assert.ok(!formHtml.includes("fa-privacyAccepted"), "consentement dévoilé seulement à la fin");
  assert.ok(!formHtml.includes('type="submit"'), "bouton d'envoi dévoilé seulement à la fin");
  assert.ok(formHtml.includes("Le bouton d&#x27;envoi apparaîtra"), "repère de fin de parcours affiché");
});

test("6. progression : dévoilement monotone, sans vol de focus", () => {
  assert.ok(formSource.includes("Math.max(current, atteinte)"), "dévoilement monotone");
  assert.ok(formSource.includes("firstIncompleteQuestion"), "progression déduite du schéma partagé");
  assert.ok(
    !/revealed[\s\S]{0,400}\.focus\(\)/.test(formSource),
    "aucun focus automatique déclenché par le dévoilement",
  );
  // La validation finale et la progression utilisent le MÊME schéma.
  assert.ok(formSource.includes("freeAssessmentSchema.safeParse(values)"), "validation finale par le schéma partagé");
  assert.ok(
    !/z\.(object|string|enum)\(/.test(formSource),
    "aucune validation locale simplifiée dans le composant",
  );
});

/* ─── 7-9. Accessibilité et animation ─── */

test("7. accessibilité : labels, groupe de choix, erreurs reliées, honeypot", () => {
  // Question 1, seule montée : contrôlée sur le rendu réel.
  assert.ok(formHtml.includes('for="fa-lastName"'), "label manquant pour fa-lastName");
  assert.ok(formHtml.includes('id="fa-lastName"'), "champ fa-lastName absent");
  assert.ok(formHtml.includes("aria-invalid"), "état d'erreur exposé aux technologies d'assistance");

  // Questions dévoilées ensuite : contrôlées dans la source.
  for (const id of ["fa-firstName", "fa-phone", "fa-email", "fa-otherGoal", "fa-frustration"]) {
    assert.ok(formSource.includes(`htmlFor="${id}"`), `label manquant pour ${id}`);
    assert.ok(formSource.includes(`id="${id}"`), `champ ${id} absent`);
  }
  assert.equal((formSource.match(/<fieldset/g) ?? []).length, 1, "les objectifs forment un groupe nommé");
  assert.ok(formSource.includes("<legend"), "le groupe porte une légende");

  // Attributs de saisie mobile.
  assert.ok(formSource.includes('autoComplete="tel"') && formSource.includes('inputMode="tel"'), "téléphone");
  assert.ok(formSource.includes('autoComplete="email"') && formSource.includes('inputMode="email"'), "email");
  assert.ok(formSource.includes('autoComplete="family-name"') && formSource.includes('autoComplete="given-name"'), "nom/prénom");

  // Honeypot : monté dès le départ, masqué, hors tabulation.
  assert.ok(/aria-hidden="true"[\s\S]{0,300}fa-website/.test(formHtml), "honeypot masqué aux lecteurs d'écran");
  assert.ok(/tabindex="-1"/i.test(formHtml), "honeypot hors ordre de tabulation");

  // Cibles tactiles et focus visible.
  assert.ok(formHtml.includes("min-h-[44px]"), "champs à hauteur tactile suffisante");
  assert.ok(formHtml.includes("focus-visible:ring"), "focus clavier visible");
  assert.ok(formSource.includes("min-h-[52px]"), "bouton d'envoi confortable");
});

test("8. consentement : obligatoire, jamais précoché, sans finalité marketing", () => {
  assert.ok(
    formSource.includes("utilisées pour me recontacter dans le cadre"),
    "texte de consentement exact",
  );
  assert.ok(formSource.includes("/confidentialite"), "lien vers la politique de confidentialité");
  assert.ok(formSource.includes("privacyAccepted: false"), "case décochée à l'état initial");
  assert.ok(!/newsletter/i.test(formSource), "aucune inscription newsletter détournée");
  assert.ok(!/checked={true}/.test(formSource), "aucune case précochée");
});

test("9. animation : réutilise question-reveal et respecte prefers-reduced-motion", () => {
  const primitives = readFileSync(
    new URL("../../components/ui/ProgressiveQuestions.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(primitives.includes("question-reveal"), "classe d'animation partagée");
  assert.ok(formSource.includes("question-reveal"), "animation appliquée au consentement et au bouton");
  assert.ok(formSource.includes("animate={hasInteracted}"), "pas d'animation au premier rendu");

  const bloc = css.slice(css.indexOf(".question-reveal"));
  assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.question-reveal[\s\S]{0,80}animation: none/.test(css),
    "animation coupée sous prefers-reduced-motion");
  assert.ok(bloc.length > 0, "classe question-reveal définie");
  // La barre de progression aussi.
  assert.ok(primitives.includes("motion-reduce:transition-none"), "barre de progression figée en reduced-motion");

  // Brillance tournante de l'encadré (chantier mise en avant) : elle doit
  // s'immobiliser sous prefers-reduced-motion, pas disparaître.
  assert.ok(/@property --bilan-angle/.test(css), "angle animable déclaré via @property");
  assert.ok(/animation: bilan-tour /.test(css), "anneau principal animé");
  assert.ok(/animation: bilan-tour-inverse /.test(css), "second anneau à contresens");
  const reduit = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".bilan-card")));
  assert.ok(/\.bilan-card::before,\s*\n\s*\.bilan-card::after \{\s*\n\s*animation: none;/.test(reduit),
    "les deux anneaux figés sous prefers-reduced-motion");
  assert.ok(/--bilan-angle: \d+deg/.test(reduit), "angle de repli fixé (brillance conservée, pas supprimée)");
  // Repli si @property n'est pas supporté : la valeur par défaut doit être
  // écrite dans le var(), sinon le dégradé entier devient invalide.
  assert.ok(/conic-gradient\(\s*\n?\s*from var\(--bilan-angle, 0deg\)/.test(css),
    "valeur de repli dans var(--bilan-angle)");
});

/* ─── 10. Responsive ─── */

test("10. responsive : aucune largeur fixe, grille adaptative, colonne bornée", () => {
  assert.ok(!/w-\[\d{3,}px\]/.test(sectionHtml), "aucune largeur fixe en pixels");
  assert.ok(!/style="[^"]*width:\s*\d+px/.test(sectionHtml), "aucune largeur inline en pixels");
  assert.ok(sectionHtml.includes("max-w-7xl") && sectionHtml.includes("px-6"), "colonne centrée avec marges");
  assert.ok(/max-w-\[\d+ch\]/.test(sectionSource), "colonne de texte bornée en mesure (ch)");
  assert.ok(/minmax\(0,\s*1fr\)/.test(sectionSource), "colonnes de grille qui peuvent rétrécir (minmax 0)");
  assert.ok(formSource.includes("sm:grid-cols-2"), "grille d'options responsive");
  assert.ok(/text-\[2\.5rem\][^"]*sm:text-5xl[^"]*md:text-6xl/.test(sectionHtml),
    "titre progressif mobile → desktop, en trois paliers");
  // Rembourrages et rayons de l'encadré en clamp() : jamais d'écrasement
  // sous 360 px ni de boursouflure au-delà de 1440 px.
  const cssCard = css.slice(css.indexOf(".bilan-card {"));
  assert.ok(/padding:\s*clamp\(/.test(cssCard), "rembourrage de l'encadré en clamp()");
  assert.ok(/border-radius:\s*clamp\(/.test(cssCard), "rayon de l'encadré en clamp()");
});

/* ─── 11. Cohérence visuelle avec la page d'accueil ─── */

test("11. la section reprend les codes visuels des sections voisines", () => {
  const transformations = readFileSync(
    new URL("../../components/sections/Transformations.tsx", import.meta.url),
    "utf8",
  );
  // Depuis le thème home, la surface est un token (bg-background) : c'est
  // lui, et non plus bg-black, qui fait le code commun entre voisines.
  for (const classe of ["bg-background", "mx-auto max-w-7xl px-6"]) {
    assert.ok(transformations.includes(classe), `référence : ${classe}`);
    assert.ok(sectionSource.includes(classe), `la nouvelle section doit reprendre ${classe}`);
  }
  assert.ok(sectionSource.includes("SectionLabel"), "même intitulé de section que les voisines");
  assert.ok(
    sectionHtml.includes("font-heading") && sectionHtml.includes("uppercase"),
    "même traitement typographique du titre",
  );
  // Identité monochrome : aucune couleur décorative introduite.
  assert.ok(!/bg-(blue|green|red|yellow|purple|pink|orange)-\d/.test(sectionHtml),
    "aucune classe de couleur utilitaire : l'accent passe par des tokens scopés");
  // L'accent est volontaire (chantier mise en avant) mais doit rester enfermé
  // dans .bilan-highlight — aucune fuite vers le thème global ni vers les voisines.
  assert.ok(/\.bilan-highlight\s*\{[^}]*--bilan-accent:/.test(css),
    "l'accent doit être déclaré DANS .bilan-highlight");

  // Arrivée PROGRESSIVE de la couleur : la section précédente est noire, le
  // haut du bloc doit l'être aussi pour que la couture ne se voie pas.
  const halo = css.slice(css.indexOf(".bilan-highlight::before"), css.indexOf(".bilan-card {"));
  assert.ok(/mask-image:\s*linear-gradient\(\s*\n?\s*to bottom,\s*\n?\s*transparent 0%/.test(halo),
    "halo éteint au bord supérieur par un masque vertical");
  const ancrages = [...halo.matchAll(/radial-gradient\([^)]*at\s+\d+%\s+(\d+)%/g)].map((m) => Number(m[1]));
  assert.ok(ancrages.length > 0, "nappes du halo détectées");
  assert.ok(ancrages.every((y) => y >= 50),
    `aucune nappe ancrée dans la moitié haute (trouvé : ${ancrages.join(", ")})`);
  assert.ok(/lg:mt-\d+/.test(sectionSource),
    "encadré décalé vers le bas en deux colonnes, pas à fleur du bord supérieur");
  const avantSection = css.slice(0, css.indexOf(".bilan-highlight"));
  assert.ok(!/--bilan-accent/.test(avantSection),
    "aucun token d'accent déclaré dans :root ou .light");
  for (const voisine of ["Transformations", "PublicPrograms", "Hero", "Newsletter"]) {
    const src = readFileSync(new URL(`../../components/sections/${voisine}.tsx`, import.meta.url), "utf8");
    assert.ok(!src.includes("bilan-"), `${voisine} ne doit pas consommer l'accent du bilan`);
  }
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
