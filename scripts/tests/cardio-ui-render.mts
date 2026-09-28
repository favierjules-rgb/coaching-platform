/**
 * Harnais de RENDU RÉEL — les écrans du chantier cardio s'affichent, et ils
 * disent la vérité.
 *
 * Monte avec le vrai React (`renderToString`), corps des composants exécuté :
 *   · le tableau des zones d'un athlète (7 zones, ses valeurs, son bouton de
 *     réinitialisation) ;
 *   · le builder cardio sur une séance MIXTE — il doit annoncer que la
 *     musculation est conservée, parce que la RPC supprimerait ce qu'il
 *     n'enverrait pas ;
 *   · les calculateurs de tests terrain.
 *
 * Lancement : npm run test:cardio-ui-render
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { EditeurBlocsCardio } from "../../components/admin/cardio/EditeurBlocsCardio";
import { CalculateursTests } from "../../components/admin/physio/CalculateursTests";
import { TableauZonesSport } from "../../components/admin/physio/TableauZonesSport";
import { cardioSegmentTypeLabels, cardioTypeLabels, intensityTargetTypeLabels } from "../../lib/cardio";
import { valeurPhysio, VALEUR_ABSENTE } from "../../lib/physiologie";
import { StudentCardioBlockCard } from "../../components/student/StudentCardioBlockCard";
import type { StudentCardioBlockView } from "../../lib/student-session-blocks";
import type { ReferencesAthlete } from "../../lib/zones-physiologiques";
import type { TrainingBlock } from "../../types";

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

/**
 * `renderToString` insère `<!-- -->` entre deux expressions adjacentes : le
 * retirer permet de chercher une phrase telle qu'elle est LUE à l'écran.
 */
function sansMarqueursReact(html: string): string {
  return html.replace(/<!--\s*-->/g, "");
}
const texte = (html: string) => sansMarqueursReact(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const JULES: ReferencesAthlete = {
  fcMax: valeurPhysio(190, "mesuree"),
  fcRepos: valeurPhysio(48, "mesuree"),
  vmaCourseKmh: valeurPhysio(11, "mesuree"),
  vmaNatationKmh: valeurPhysio(3, "mesuree"),
  ftpWatts: valeurPhysio(210, "mesuree"),
  pmaWatts: valeurPhysio(320, "mesuree"),
};
const SANS_RIEN: ReferencesAthlete = {
  fcMax: VALEUR_ABSENTE, fcRepos: VALEUR_ABSENTE, vmaCourseKmh: VALEUR_ABSENTE,
  vmaNatationKmh: VALEUR_ABSENTE, ftpWatts: VALEUR_ABSENTE, pmaWatts: VALEUR_ABSENTE,
};

const sansEffet = async () => ({ ok: true, erreur: null });

test("ZONES-UI. les 7 zones, leurs noms et les valeurs de l'athlète sont à l'écran", () => {
  const html = texte(
    renderToString(
      createElement(TableauZonesSport, {
        sport: "course",
        references: JULES,
        reglages: {},
        onEnregistrerZones: sansEffet,
        onReinitialiser: sansEffet,
      }),
    ),
  );
  for (const zone of ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6", "Z7"]) {
    assert.ok(html.includes(zone), `${zone} absente du tableau`);
  }
  for (const nom of ["Régénération", "Endurance", "Tempo", "Seuil", "VO2Max", "Anaérobie", "Vitesse"]) {
    assert.ok(html.includes(nom), `${nom} absent`);
  }
  // Valeurs des captures iDO pour VMA 11 / FCmax 190 / FCrepos 48.
  assert.ok(html.includes("9.35 - 10.12 km/h"), "vitesses de la Z4 absentes");
  assert.ok(html.includes("175 - 182"), "FC de la Z4 absente");
  assert.ok(html.includes("48 - 143"), "la Z1 doit partir de la FC de repos réelle");
  assert.ok(html.includes("Non significatif"), "Z6/Z7 en FC doivent être non significatives");
  assert.ok(html.includes("Barème de référence iDO"), "l'origine des bornes doit être dite");
  assert.ok(html.includes("Réinitialiser mes zones iDO"), "le bouton de réinitialisation manque");
});

test("ZONES-UI2. une référence absente affiche « — », jamais 0 km/h", () => {
  const html = texte(
    renderToString(
      createElement(TableauZonesSport, {
        sport: "course",
        references: SANS_RIEN,
        reglages: {},
        onEnregistrerZones: sansEffet,
        onReinitialiser: sansEffet,
      }),
    ),
  );
  assert.ok(!html.includes("0 - 0 km/h"), "des vitesses nulles sont présentées comme des consignes");
  assert.ok(!html.includes("0 bpm"), "une FC nulle est affichée");
  assert.ok(html.includes("—"), "l'absence de référence doit être marquée");
});

test("ZONES-UI3. des bornes personnalisées sont annoncées comme telles", () => {
  const html = texte(
    renderToString(
      createElement(TableauZonesSport, {
        sport: "course",
        references: JULES,
        reglages: { vmaCourse: { 3: [72, 86] } },
        onEnregistrerZones: sansEffet,
        onReinitialiser: sansEffet,
      }),
    ),
  );
  assert.ok(html.includes("Bornes personnalisées pour cet athlète"), "la personnalisation doit être visible");
  assert.ok(html.includes("72% - 86%"), "la borne personnalisée doit être appliquée");
});

test("ZONES-UI4. le vélo montre %FTP ET %PMA, pas de vitesse", () => {
  const html = texte(
    renderToString(
      createElement(TableauZonesSport, {
        sport: "velo",
        references: JULES,
        reglages: {},
        onEnregistrerZones: sansEffet,
        onReinitialiser: sansEffet,
      }),
    ),
  );
  assert.ok(html.includes("% FTP"), "colonne %FTP absente");
  assert.ok(html.includes("% PMA"), "colonne %PMA absente");
  assert.ok(html.includes("189 - 221 w"), "puissances FTP de la Z4 absentes");
  assert.ok(html.includes("240 - 272 w"), "puissances PMA de la Z4 absentes");
  assert.ok(!html.includes("km/h"), "une vitesse à vélo n'a pas de sens ici");
});

test("TESTS-UI. les calculateurs annoncent leur formule et ne s'enregistrent pas tout seuls", () => {
  const course = texte(renderToString(createElement(CalculateursTests, { sport: "course", onEnregistrer: sansEffet })));
  assert.ok(course.includes("Test 6 minutes"));
  assert.ok(course.includes("distance × 0,01"), "la formule doit être écrite à l'écran");
  assert.ok(course.includes("Saisis une valeur valide"), "aucun résultat sans saisie");

  const natation = texte(renderToString(createElement(CalculateursTests, { sport: "natation", onEnregistrer: sansEffet })));
  assert.ok(natation.includes("Test 400 m"));
  assert.ok(natation.includes("1440 / temps"), "la formule du 400 m doit être écrite");
  assert.ok(natation.includes("Aucun coefficient"), "l'absence de coefficient correcteur doit être dite");
});

const SEANCE_MIXTE: TrainingBlock[] = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    category: "strength",
    position: 0,
    title: "Bas du corps",
    colorKey: "gray",
    exercises: [
      { id: "55555555-5555-4555-8555-555555555555", order: 0, name: "Squat", sets: 5, reps: "5", restSeconds: 120, tempo: "", recommendedLoad: "100kg", videoUrl: "", notes: "" },
    ],
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    category: "cardio",
    position: 1,
    title: "VMA courte",
    colorKey: "red",
    cardioType: "vma_intervals",
    sport: "course",
    rounds: 3,
    prescriptions: [
      { id: "s1", order: 0, segmentType: "work", title: "Effort", intensityTargetType: "vma_percentage", targetVmaPercentage: 105, distanceMeters: 400 },
    ],
  },
];

test("BUILDER-UI. l'éditeur cardio annonce que la musculation est CONSERVÉE, et montre l'ordre réel", () => {
  const html = texte(
    renderToString(
      createElement(EditeurBlocsCardio, {
        meta: { name: "Mixte", durationMinutes: 60, coachNotes: "" },
        blocks: SEANCE_MIXTE,
        references: JULES,
        onEnregistrer: () => {},
      }),
    ),
  );
  assert.ok(html.includes("un bloc de musculation"), "le coach doit savoir que la musculation est là");
  // Les apostrophes JSX sortent en entités HTML : on cherche un fragment qui n'en contient pas.
  assert.ok(html.includes("ne peut pas les supprimer"), "la garantie de portée doit être écrite à l'écran");
  assert.ok(html.includes("que le cardio"), "l'écran doit dire que l'enregistrement ne porte que le cardio");
  assert.ok(html.includes("conservé tel quel"), "le bloc de musculation doit apparaître à sa place dans l'ordre");
  assert.ok(!html.includes("Squat"), "aucun champ de musculation ne doit être éditable ici");
  assert.ok(html.includes("Enregistrer également dans ma bibliothèque"), "la case bibliothèque manque");
  assert.ok(html.includes("Sport"), "le sport du bloc doit être saisissable");
  assert.ok(html.includes("Séries du bloc"), "les séries du bloc doivent être saisissables");
  assert.ok(html.includes("Ajouter un bloc cardio"));
});

test("BUILDER-UI2. l'aperçu traduit la consigne avec les références de L'ATHLÈTE", () => {
  const html = texte(
    renderToString(
      createElement(EditeurBlocsCardio, {
        meta: { name: "VMA", durationMinutes: 45, coachNotes: "" },
        blocks: SEANCE_MIXTE,
        references: JULES,
        onEnregistrer: () => {},
      }),
    ),
  );
  assert.ok(html.includes("105 % VMA"), "la consigne doit être rappelée");
  assert.ok(html.includes("11.55 km/h"), "la vitesse de CET athlète doit être affichée");
  assert.ok(html.includes("5:12 /km"), "l'allure de CET athlète doit être affichée");
});

test("BUILDER-UI3. sans références d'athlète, aucune vitesse n'est inventée", () => {
  const html = texte(
    renderToString(
      createElement(EditeurBlocsCardio, {
        meta: { name: "VMA", durationMinutes: 45, coachNotes: "" },
        blocks: SEANCE_MIXTE,
        onEnregistrer: () => {},
      }),
    ),
  );
  assert.ok(!html.includes("11.55 km/h"), "une vitesse est affichée alors qu'aucun athlète n'est connu");
});

test("BUILDER-UI4. un bloc sans sport le signale au lieu de convertir au hasard", () => {
  const sansSport: TrainingBlock[] = [
    { ...(SEANCE_MIXTE[1] as Extract<TrainingBlock, { category: "cardio" }>), sport: undefined },
  ];
  const html = texte(
    renderToString(
      createElement(EditeurBlocsCardio, {
        meta: { name: "VMA", durationMinutes: 45, coachNotes: "" },
        blocks: sansSport,
        references: JULES,
        onEnregistrer: () => {},
      }),
    ),
  );
  assert.ok(html.includes("sport du bloc non renseigné"), "l'absence de sport doit être dite");
  assert.ok(!html.includes("11.55 km/h"), "aucune conversion ne doit être faite sans sport");
});

/* ════════════════════════════════════════════════════════════════════════
 * L'ÉCRAN DE L'ATHLÈTE — simple, en français, sans un terme interne
 * ════════════════════════════════════════════════════════════════════════ */

const BLOC_ATHLETE: StudentCardioBlockView = {
  kind: "cardio",
  id: "66666666-6666-4666-8666-666666666666",
  colorKey: "red",
  title: "VMA courte",
  cardioType: "vma_intervals",
  sport: "course",
  rounds: 4,
  segments: [
    { id: "s1", order: 0, segmentType: "warmup", title: "Échauffement", intensityTargetType: "zone", targetZone: 2, durationSeconds: 600 },
    { id: "s2", order: 1, segmentType: "repeat_group", title: "800 m", intensityTargetType: "zone", targetZone: 4, repetitions: 4, distanceMeters: 800, recoveryDurationSeconds: 120 },
    { id: "s3", order: 2, segmentType: "cooldown", title: "Retour au calme", intensityTargetType: "zone", targetZone: 1, durationSeconds: 300 },
  ],
};

/**
 * Les termes qui n'ont RIEN à faire sous les yeux d'un athlète.
 *
 * ⚠️ LA LISTE SE CONSTRUIT DEPUIS LE CODE, elle n'est pas recopiée. Les CLÉS des
 * tables de libellés SONT le vocabulaire interne (`vma_percentage`, `repeat_group`,
 * `zone`…) : les énumérer à la main laisserait passer chaque valeur ajoutée plus
 * tard. Un sabotage l'a montré — afficher « Intensité (zone) » ne réveillait
 * aucune liste écrite à la main.
 */
const TERMES_INTERNES = [
  ...Object.keys(intensityTargetTypeLabels),
  ...Object.keys(cardioSegmentTypeLabels),
  ...Object.keys(cardioTypeLabels),
  "target_zone", "intensity_target_type", "segment_type", "targetZone", "intensityTargetType",
  "targetPowerPercentage", "training_prescriptions", "block_id", "colorKey", "cardioType",
  "66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777",
];

test("ATHLETE1. l'athlète lit sa séance en français : quoi, combien de temps, quelle distance, quelle intensité", () => {
  const html = texte(renderToString(createElement(StudentCardioBlockCard, { block: BLOC_ATHLETE, references: JULES })));
  assert.ok(html.includes("Échauffement"), "le nom du segment manque");
  assert.ok(html.includes("Retour au calme"));
  assert.ok(html.includes("10 min") || html.includes("10:00"), "la durée de l'échauffement manque");
  assert.ok(html.includes("800 m"), "la distance de l'effort manque");
  assert.ok(html.includes("× 4"), "le nombre de répétitions manque");
  assert.ok(html.includes("Récup"), "la récupération manque");
  assert.ok(html.includes("Z4"), "l'intensité de l'effort manque");
  assert.ok(html.includes("Course"), "le sport doit être lisible");
  assert.ok(html.includes("4 séries"), "les séries du bloc doivent être lisibles");
});

test("ATHLETE2. AUCUN terme interne n'apparaît à l'écran de l'athlète", () => {
  const rendu = renderToString(createElement(StudentCardioBlockCard, { block: BLOC_ATHLETE, references: JULES }));
  const lisible = texte(rendu);
  for (const terme of TERMES_INTERNES) {
    assert.ok(!lisible.includes(terme), `« ${terme} » est LU par l'athlète à l'écran`);
  }
  // Et pas non plus caché dans un attribut.
  for (const terme of ["target_zone", "intensity_target_type", "segment_type", "66666666-6666-4666-8666-666666666666"]) {
    assert.ok(!sansMarqueursReact(rendu).includes(terme), `« ${terme} » est présent dans le HTML de l'écran athlète`);
  }
});

test("ATHLETE3. avec ses références, l'athlète lit SES vitesses ; sans elles, rien n'est inventé", () => {
  const avec = texte(renderToString(createElement(StudentCardioBlockCard, { block: BLOC_ATHLETE, references: JULES })));
  assert.ok(avec.includes("9.35 - 10.12 km/h"), "les vitesses de CET athlète manquent");
  assert.ok(avec.includes("175 - 182 bpm"), "la FC de CET athlète manque");

  const sans = texte(renderToString(createElement(StudentCardioBlockCard, { block: BLOC_ATHLETE })));
  assert.ok(sans.includes("Z4"), "la consigne doit rester lisible sans références");
  assert.ok(!sans.includes("km/h"), "une vitesse est affichée alors qu'aucune référence n'a été lue");
});

test("ATHLETE4. ANCIENNE SÉANCE, sport NULL : affichée, jamais complétée d'office", () => {
  /*
   * ⚠️ NON-RÉGRESSION EXIGÉE. 441 blocs cardio de production n'ont pas de sport
   * et ne seront pas migrés. Ils doivent continuer à s'afficher, sans qu'aucune
   * zone ne soit convertie contre une référence choisie au hasard.
   */
  const ancienne: StudentCardioBlockView = {
    kind: "cardio",
    id: "77777777-7777-4777-8777-777777777777",
    colorKey: "blue",
    title: "Footing",
    cardioType: "easy_run",
    sport: undefined,
    rounds: undefined,
    segments: [
      { id: "a1", order: 0, segmentType: "single", title: "Footing", intensityTargetType: "heart_rate_zone", targetHrZone: "Zone 2", durationSeconds: 2400 },
      { id: "a2", order: 1, segmentType: "single", title: "Bloc VMA", intensityTargetType: "vma_percentage", targetVmaPercentage: 100, distanceMeters: 1000 },
    ],
  };
  const html = texte(renderToString(createElement(StudentCardioBlockCard, { block: ancienne, references: JULES })));
  assert.ok(html.includes("Footing"), "l'ancienne séance doit rester affichée");
  assert.ok(html.includes("Zone 2"), "la zone texte libre historique doit rester lisible telle quelle");
  assert.ok(html.includes("40 min") || html.includes("40:00"), "la durée doit rester affichée");
  assert.ok(html.includes("100% VMA"), "la consigne saisie doit rester lisible");
  assert.ok(!html.includes("km/h"), "sans sport, aucune vitesse ne doit être déduite");
  assert.ok(!html.includes("Course"), "aucun sport ne doit être inventé pour une ancienne séance");
  assert.ok(!html.includes("séries"), "aucune série ne doit être inventée");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
