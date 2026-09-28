/**
 * Harnais — LE BUILDER CARDIO COMPACT (une ligne par segment).
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER REFUSE DE LAISSER PASSER
 * ════════════════════════════════════════════════════════════════════════
 *   1. un champ SUPPRIMÉ pour rendre la ligne plus courte — compacter l'écran ne
 *      doit pas retirer de la donnée : échauffement/travail/récupération/retour
 *      au calme, durée, distance, %VMA, %FTP, %PMA, %FCmax, RPE, vitesse,
 *      allure, watts, cadence, notes, séries, intervalles doivent TOUS rester
 *      saisissables ;
 *   2. une donnée renseignée CACHÉE dans un panneau replié — le coach la
 *      croirait perdue ;
 *   3. un type d'intensité dont la valeur irait dans la mauvaise colonne (le RPE
 *      cardio vit dans `intensityMin`, décision du 28/09/2026) ;
 *   4. une ligne qui n'afficherait pas la valeur CALCULÉE pour l'athlète, ou qui
 *      en inventerait une sans référence ;
 *   5. une action manquante : déplacer, dupliquer, supprimer un segment.
 *
 * Lancement : npm run test:cardio-builder-compact
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { CardioBlockRow } from "../../components/admin/cardio/CardioBlockRow";
import { cardioSegmentTypeLabels, intensityTargetTypeLabels } from "../../lib/cardio";
import { formatMinutesSecondes, secondesDepuisMinutesSecondes, valeurPhysio, VALEUR_ABSENTE } from "../../lib/physiologie";
import type { ReferencesAthlete } from "../../lib/zones-physiologiques";
import type { AdminCardioBlock, AdminCardioSegment, IntensityTargetType } from "../../types";

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

const RACINE = new URL("../../", import.meta.url).pathname;
const lireSource = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

const sansMarqueursReact = (html: string) => html.replace(/<!--\s*-->/g, "");
/**
 * ⚠️ LES APOSTROPHES SONT ÉCHAPPÉES PAR REACT. « Durée de l'effort » sort en
 * `Durée de l&#x27;effort` : chercher la phrase telle qu'elle est écrite dans le
 * composant échouerait alors que le champ est bien là — un test faussement rouge.
 */
const decode = (html: string) =>
  html
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
const texte = (html: string) => decode(sansMarqueursReact(html)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const JULES: ReferencesAthlete = {
  fcMax: valeurPhysio(190, "mesuree"),
  fcRepos: valeurPhysio(48, "mesuree"),
  vmaCourseKmh: valeurPhysio(16, "mesuree"),
  vmaNatationKmh: valeurPhysio(3, "mesuree"),
  ftpWatts: valeurPhysio(210, "mesuree"),
  pmaWatts: valeurPhysio(320, "mesuree"),
};

function segment(partiel: Partial<AdminCardioSegment>): AdminCardioSegment {
  return {
    id: partiel.id ?? "p1",
    order: partiel.order ?? 0,
    segmentType: partiel.segmentType ?? "work",
    title: partiel.title ?? "",
    intensityTargetType: partiel.intensityTargetType ?? "vma_percentage",
    ...partiel,
  } as AdminCardioSegment;
}

function bloc(segments: AdminCardioSegment[], partiel?: Partial<AdminCardioBlock>): AdminCardioBlock {
  return {
    id: "b1",
    order: 0,
    title: "Bloc",
    cardioType: "vma_intervals",
    sport: "course",
    rounds: 3,
    segments,
    ...partiel,
  } as AdminCardioBlock;
}

function rendre(b: AdminCardioBlock, references?: ReferencesAthlete): string {
  return decode(renderToString(
    createElement(CardioBlockRow, {
      block: b,
      referenceVmaKmh: 15,
      references,
      onChange: () => {},
      showBlockChrome: false,
    }),
  ));
}

/* ════════════════════════════════════════════════════════════════════════
 * I. LA LIGNE — ce qu'elle porte, et dans quel ordre
 * ════════════════════════════════════════════════════════════════════════ */

await Promise.resolve();

test("LIGNE1. la ligne porte type, répétitions, durée, distance, intensité et valeur", () => {
  const html = rendre(
    bloc([
      segment({
        segmentType: "repeat_group",
        repetitions: 8,
        durationSeconds: 30,
        distanceMeters: 200,
        intensityTargetType: "vma_percentage",
        targetVmaPercentage: 105,
      }),
    ]),
  );
  for (const aria of [
    "Type de segment",
    "Nombre de répétitions",
    "Durée de l'effort",
    "Distance de l'effort en mètres",
    "Type d'intensité ciblée",
    "Pourcentage de VMA",
  ]) {
    assert.ok(html.includes(`aria-label="${aria}"`), `« ${aria} » doit rester saisissable sur la ligne`);
  }
  assert.ok(html.includes('value="8"'), "les 8 répétitions doivent être affichées");
  assert.ok(html.includes('value="200"'), "les 200 m doivent être affichés");
  assert.ok(html.includes('value="105"'), "les 105 % de VMA doivent être affichés");
});

test("LIGNE2. les répétitions n'apparaissent QUE sur un segment d'intervalles", () => {
  const avec = rendre(bloc([segment({ segmentType: "repeat_group", repetitions: 4 })]));
  const sans = rendre(bloc([segment({ segmentType: "work" })]));
  assert.ok(avec.includes('aria-label="Nombre de répétitions"'));
  assert.ok(
    !sans.includes('aria-label="Nombre de répétitions"'),
    "un segment continu n'a pas de répétitions : ce champ ne doit pas encombrer sa ligne",
  );
});

test("LIGNE3. les quatre types de segment décidés le 28/09/2026 sont proposés, et pas d'autres", () => {
  assert.deepEqual(
    Object.keys(cardioSegmentTypeLabels).filter((cle) => ["warmup", "work", "recovery", "cooldown"].includes(cle)),
    ["warmup", "work", "recovery", "cooldown"],
    "échauffement / travail / contre-effort / retour au calme",
  );
  assert.ok(
    !("effort" in cardioSegmentTypeLabels) && !("counter_effort" in cardioSegmentTypeLabels),
    "« effort » et « counter_effort » ne doivent PAS être créés : ce serait une seconde nomenclature pour des types déjà en base",
  );
  const html = rendre(bloc([segment({})]));
  for (const cle of ["warmup", "work", "recovery", "cooldown"]) {
    assert.ok(html.includes(`value="${cle}"`), `le type « ${cle} » doit être choisissable`);
  }
});

test("LIGNE4. les actions déplacer / dupliquer / supprimer sont sur la ligne", () => {
  const html = rendre(bloc([segment({ id: "a" }), segment({ id: "b", order: 1 })]));
  for (const aria of [
    "Déplacer le segment vers le haut",
    "Déplacer le segment vers le bas",
    "Dupliquer le segment",
  ]) {
    assert.ok(html.includes(`aria-label="${aria}"`), `l'action « ${aria} » doit rester accessible`);
  }
  assert.ok(/aria-label="Supprimer le segment/.test(html), "la suppression d'un segment doit rester accessible");
});

/**
 * ⚠️ MÊME RAISON QUE POUR `INTENS2bis` : un rendu serveur n'exerce pas l'écriture.
 * Si le champ « distance » écrivait dans `durationSeconds`, la ligne afficherait
 * toujours la bonne valeur et la séance partirait fausse en base.
 */
test("LIGNE5. les contrôles de la ligne écrivent chacun dans SA donnée", () => {
  const source = lireSource("components/admin/cardio/CardioBlockRow.tsx");
  const debut = source.indexOf("{/* ── LA LIGNE ");
  assert.ok(debut !== -1, "la ligne compacte doit rester repérable dans la source");
  const fin = source.indexOf("{detailOuvert && (", debut);
  const ligne = source.slice(debut, fin === -1 ? undefined : fin);

  const attendus: readonly { readonly aria: string; readonly champ: string }[] = [
    { aria: "Type de segment", champ: "segmentType" },
    { aria: "Nombre de répétitions", champ: "repetitions" },
    { aria: "Distance de l'effort en mètres", champ: "distanceMeters" },
    { aria: "Type d'intensité ciblée", champ: "intensityTargetType" },
  ];
  for (const { aria, champ } of attendus) {
    const i = ligne.indexOf(aria.replace("'", "\\'")) !== -1 ? ligne.indexOf(aria.replace("'", "\\'")) : ligne.indexOf(aria);
    assert.ok(i !== -1, `le contrôle « ${aria} » a disparu de la ligne`);
    const suite = ligne.slice(i, i + 400);
    const ecrit = /onChange\(\{\s*(\w+):/.exec(suite)?.[1];
    assert.equal(
      ecrit,
      champ,
      `« ${aria} » écrit dans \`${String(ecrit)}\` : la donnée partirait dans la mauvaise colonne sans que l'écran change`,
    );
  }

  /*
   * La durée passe par `ChampDuree`, qui convertit mm:ss → secondes : on vérifie
   * qu'elle atterrit bien dans `durationSeconds`, et nulle part ailleurs.
   */
  const iDuree = ligne.indexOf("<ChampDuree");
  assert.ok(iDuree !== -1, "la durée doit rester saisissable sur la ligne");
  const brancheDuree = ligne.slice(iDuree, iDuree + 300);
  assert.match(brancheDuree, /onChange=\{\(secondes\) => onChange\(\{ durationSeconds: secondes \}\)\}/);
});

/**
 * ⚠️ DUPLIQUER UN SEGMENT DOIT PRODUIRE UN NOUVEL IDENTIFIANT. Recopier l'id de
 * la source donnerait deux segments identiques pour la RPC : elle refuse un id en
 * double (`id de prescription en double dans le payload`), et l'écran afficherait
 * deux lignes qui se modifient ensemble.
 */
test("DUPLIC1. la duplication d'un segment fabrique un identifiant neuf", () => {
  const source = lireSource("components/admin/cardio/CardioBlockRow.tsx");
  const i = source.indexOf("function duplicateSegment(");
  assert.ok(i !== -1, "la duplication d'un segment doit exister — c'est une action demandée sur la ligne");
  const corps = source.slice(i, source.indexOf("\n  }", i));
  assert.match(
    corps,
    /id:\s*generateId\(/,
    "la copie doit recevoir un id neuf : sans cela la RPC refuse le payload et les deux lignes se modifient ensemble",
  );
  assert.match(corps, /splice\(index \+ 1, 0, copie\)/, "la copie se pose JUSTE APRÈS la source, pas à la fin");
  assert.match(corps, /order: i \+ 1/, "les ordres doivent être renumérotés, sinon deux segments partagent une position");
});

/* ════════════════════════════════════════════════════════════════════════
 * II. CHAQUE TYPE D'INTENSITÉ A SON CONTRÔLE, ET SA COLONNE
 * ════════════════════════════════════════════════════════════════════════ */

const CONTROLE_ATTENDU: Readonly<Partial<Record<IntensityTargetType, { aria: string; champ: keyof AdminCardioSegment; exemple: unknown; affiché: string }>>> = {
  zone: { aria: "Zone d'intensité", champ: "targetZone", exemple: 4, affiché: 'value="4"' },
  vma_percentage: { aria: "Pourcentage de VMA", champ: "targetVmaPercentage", exemple: 95, affiché: 'value="95"' },
  ftp_percentage: { aria: "Pourcentage de FTP", champ: "targetPowerPercentage", exemple: 88, affiché: 'value="88"' },
  pma_percentage: { aria: "Pourcentage de PMA", champ: "targetPowerPercentage", exemple: 70, affiché: 'value="70"' },
  heart_rate_percentage: { aria: "Pourcentage de FC max", champ: "targetHrPercentage", exemple: 82, affiché: 'value="82"' },
  heart_rate_zone: { aria: "Zone de fréquence cardiaque", champ: "targetHrZone", exemple: "Zone 3", affiché: 'value="Zone 3"' },
  speed_kmh: { aria: "Vitesse cible en km/h", champ: "targetSpeedKmh", exemple: 14.5, affiché: 'value="14.5"' },
  pace: { aria: "Allure cible (mm:ss par km)", champ: "targetPaceSecondsPerKm", exemple: 285, affiché: 'value="4:45"' },
  power: { aria: "Puissance cible en watts", champ: "targetPowerWatts", exemple: 240, affiché: 'value="240"' },
  rpe: { aria: "RPE cible", champ: "intensityMin", exemple: 7.5, affiché: 'value="7.5"' },
};

/**
 * ⚠️ TROIS TYPES N'ONT VOLONTAIREMENT AUCUN CONTRÔLE DE VALEUR. « Allure
 * course », « Libre » et « Personnalisé » ne portent pas de nombre : la consigne
 * est le type lui-même. Leur inventer un champ obligerait le coach à remplir
 * quelque chose qui n'a pas de sens.
 */
const SANS_VALEUR: readonly IntensityTargetType[] = ["race_pace", "free", "custom"];

test("INTENS1. TOUS les types d'intensité du modèle sont traités — aucun oublié en silence", () => {
  assert.deepEqual(
    Object.keys(intensityTargetTypeLabels).sort(),
    [...Object.keys(CONTROLE_ATTENDU), ...SANS_VALEUR].sort(),
    "un type non traité ici est un type dont la valeur peut partir dans la mauvaise colonne sans que rien ne le dise",
  );
});

for (const type of SANS_VALEUR) {
  test(`INTENS1.${type} — le type EST la consigne : aucun champ de valeur n'est réclamé`, () => {
    const html = rendre(bloc([segment({ intensityTargetType: type })]));
    assert.ok(html.includes(`value="${type}"`), "le type doit rester choisissable");
    for (const attendu of Object.values(CONTROLE_ATTENDU) as ControleAttendu[]) {
      assert.ok(
        !html.includes(`aria-label="${attendu.aria}"`),
        `« ${attendu.aria} » ne doit pas apparaître pour ${type} : il n'y a pas de nombre à saisir`,
      );
    }
  });
}

type ControleAttendu = { aria: string; champ: keyof AdminCardioSegment; exemple: unknown; affiché: string };

for (const [type, attendu] of Object.entries(CONTROLE_ATTENDU) as [IntensityTargetType, ControleAttendu][]) {
  test(`INTENS2.${type} — le bon contrôle, et la valeur lue dans la bonne colonne`, () => {
    const html = rendre(bloc([segment({ intensityTargetType: type, [attendu.champ]: attendu.exemple } as Partial<AdminCardioSegment>)]));
    assert.ok(html.includes(`aria-label="${attendu.aria}"`), `« ${attendu.aria} » doit être le contrôle de ${type}`);
    assert.ok(
      html.includes(attendu.affiché),
      `${type} : la valeur stockée dans \`${String(attendu.champ)}\` doit être RELUE (${attendu.affiché})`,
    );
  });
}

/**
 * ⚠️ LE SENS ÉCRITURE SE VÉRIFIE DANS LA SOURCE, ET IL LE FAUT.
 *
 * Un rendu serveur n'exerce que la LECTURE : si le contrôle du RPE affiche bien
 * `intensityMin` mais écrit dans `targetZone`, la ligne reste correcte à l'écran
 * et la prescription part dans la mauvaise colonne — silencieusement. C'est
 * exactement le sabotage S38, qui survivait à tous les tests de rendu.
 *
 * On lit donc, pour chaque `case` de `ValeurIntensite`, le champ qu'il ÉCRIT.
 */
test("INTENS2bis. chaque type d'intensité ÉCRIT dans sa propre colonne", () => {
  const source = lireSource("components/admin/cardio/CardioBlockRow.tsx");
  const debut = source.indexOf("function ValeurIntensite(");
  assert.ok(debut !== -1, "`ValeurIntensite` est le seul endroit où un type d'intensité choisit sa colonne");
  const fin = source.indexOf("function ChampAllure(", debut);
  const corps = source.slice(debut, fin === -1 ? undefined : fin);

  /** Le morceau de `ValeurIntensite` qui traite ce type, jusqu'au `case` suivant. */
  function brancheDe(type: IntensityTargetType): string {
    const marque = `case "${type}":`;
    const i = corps.indexOf(marque);
    assert.ok(i !== -1, `aucune branche pour « ${type} » : son contrôle serait absent de la ligne`);
    const suite = corps.slice(i + marque.length);
    const j = suite.search(/\n\s*(case "|default:)/);
    return j === -1 ? suite : suite.slice(0, j);
  }

  for (const [type, attendu] of Object.entries(CONTROLE_ATTENDU) as [IntensityTargetType, ControleAttendu][]) {
    /*
     * `ftp_percentage` et `pma_percentage` partagent une branche (même colonne
     * `targetPowerPercentage`, seul le libellé change) : on lit celle des deux
     * qui porte le corps.
     */
    const branche = brancheDe(type) || brancheDe("pma_percentage");
    const ecrits = [...branche.matchAll(/onChange\(\{\s*(\w+):/g)].map((m) => m[1]);
    assert.ok(
      ecrits.includes(attendu.champ as string),
      `${type} : le contrôle écrit dans ${JSON.stringify(ecrits)} au lieu de \`${String(attendu.champ)}\` — la prescription partirait dans la mauvaise colonne sans que l'écran change`,
    );
    for (const autre of Object.values(CONTROLE_ATTENDU) as ControleAttendu[]) {
      if (autre.champ === attendu.champ) continue;
      assert.ok(
        !ecrits.includes(autre.champ as string),
        `${type} : le contrôle écrit AUSSI dans \`${String(autre.champ)}\`, qui appartient à un autre type d'intensité`,
      );
    }
  }
});

test("INTENS3. le RPE cardio reste dans `intensityMin` — pas de seconde convention", () => {
  const html = rendre(bloc([segment({ intensityTargetType: "rpe", intensityMin: 8 })]));
  assert.ok(html.includes('value="8"'), "`intensityMin` est la convention retenue le 28/09/2026");
  assert.ok(html.includes('aria-label="RPE cible"'));

  /*
   * ⚠️ `targetRpe` NE DOIT PAS EXISTER DANS LE MODÈLE CLIENT. La colonne
   * `target_rpe` est présente en base mais n'est ni lue ni écrite : l'exposer au
   * formulaire créerait deux vérités pour la même prescription, et rendrait
   * illisibles celles déjà posées dans `intensity_min`.
   */
  const gabarit = segment({ intensityTargetType: "rpe", intensityMin: 8 }) as unknown as Record<string, unknown>;
  assert.ok(!("targetRpe" in gabarit), "aucun segment ne doit porter `targetRpe`");
});

/* ════════════════════════════════════════════════════════════════════════
 * III. RIEN N'EST PERDU — le panneau s'ouvre quand il contient de la donnée
 * ════════════════════════════════════════════════════════════════════════ */

const SECONDAIRES: readonly { readonly champ: keyof AdminCardioSegment; readonly valeur: unknown; readonly label: string }[] = [
  { champ: "title", valeur: "Corps de séance", label: "Titre (optionnel)" },
  { champ: "recoveryDurationSeconds", valeur: 45, label: "Durée récup (s)" },
  { champ: "recoveryDistanceMeters", valeur: 150, label: "Distance récup (m)" },
  { champ: "elevationGainMeters", valeur: 120, label: "Dénivelé + (m)" },
  { champ: "inclinePercentage", valeur: 6, label: "Inclinaison (%)" },
  { champ: "targetCadence", valeur: 88, label: "Cadence cible (spm)" },
  { champ: "coachNotes", valeur: "Rester relâché", label: "Notes" },
];

test("DETAIL1. TOUS les paramètres secondaires restent saisissables", () => {
  const html = rendre(
    bloc([
      segment({
        segmentType: "repeat_group",
        repetitions: 6,
        title: "Corps de séance",
        recoveryDurationSeconds: 45,
        recoveryDistanceMeters: 150,
        elevationGainMeters: 120,
        inclinePercentage: 6,
        targetCadence: 88,
        coachNotes: "Rester relâché",
      }),
    ]),
  );
  const lu = texte(html);
  for (const { label } of SECONDAIRES) {
    assert.ok(lu.includes(label), `« ${label} » a disparu : compacter l'écran ne doit pas supprimer de donnée`);
  }
  for (const { valeur } of SECONDAIRES) {
    assert.ok(html.includes(`value="${String(valeur)}"`), `la valeur « ${String(valeur)} » doit être relue`);
  }
});

for (const { champ, valeur, label } of SECONDAIRES) {
  test(`DETAIL2.${String(champ)} — une donnée renseignée OUVRE le panneau au lieu de se cacher`, () => {
    const html = rendre(
      bloc([segment({ segmentType: "repeat_group", repetitions: 4, [champ]: valeur } as Partial<AdminCardioSegment>)]),
    );
    assert.ok(
      texte(html).includes(label),
      `« ${label} » est renseigné mais replié : le coach croirait la donnée perdue`,
    );
    assert.ok(
      html.includes('aria-expanded="true"'),
      "le panneau doit s'ouvrir de lui-même dès qu'il contient quelque chose",
    );
  });
}

test("DETAIL3. un segment SANS paramètre secondaire garde son panneau replié", () => {
  const html = rendre(bloc([segment({ durationSeconds: 300, intensityTargetType: "vma_percentage", targetVmaPercentage: 90 })]));
  assert.ok(
    html.includes('aria-expanded="false"'),
    "c'est tout l'intérêt du format compact : une ligne par segment quand il n'y a rien de plus à dire",
  );
  assert.ok(!texte(html).includes("Dénivelé + (m)"), "les champs vides ne doivent pas occuper la hauteur");
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. LA DURÉE ET L'ALLURE SE SAISISSENT EN mm:ss
 * ════════════════════════════════════════════════════════════════════════ */

test("DUREE1. la durée s'affiche en mm:ss, et un nombre nu vaut des secondes", () => {
  assert.equal(formatMinutesSecondes(90), "1:30");
  assert.equal(secondesDepuisMinutesSecondes("1:30"), 90);
  assert.equal(secondesDepuisMinutesSecondes("600"), 600, "un nombre nu est un nombre de secondes");
  assert.equal(secondesDepuisMinutesSecondes("10:00"), 600);
  assert.equal(secondesDepuisMinutesSecondes("n'importe quoi"), null);

  const html = rendre(bloc([segment({ durationSeconds: 90 })]));
  assert.ok(html.includes('value="1:30"'), "90 s doivent se lire « 1:30 », pas « 90 »");
});

test("ALLURE1. l'allure s'affiche en mm:ss par km et se stocke en secondes", () => {
  const html = rendre(bloc([segment({ intensityTargetType: "pace", targetPaceSecondsPerKm: 225 })]));
  assert.ok(html.includes('value="3:45"'), "225 s/km = 3:45/km");
  assert.equal(secondesDepuisMinutesSecondes("3:45"), 225);
});

/* ════════════════════════════════════════════════════════════════════════
 * V. LA VALEUR CALCULÉE POUR L'ATHLÈTE, SUR LA LIGNE
 * ════════════════════════════════════════════════════════════════════════ */

test("CALC1. avec les références de l'athlète, la ligne montre SA valeur", () => {
  const lu = texte(rendre(bloc([segment({ intensityTargetType: "vma_percentage", targetVmaPercentage: 100 })]), JULES));
  assert.ok(lu.includes("16"), "100 % de 16 km/h de VMA = 16 km/h");
  assert.ok(/3:45/.test(lu), "et l'allure correspondante, 3:45/km");
});

test("CALC2. %FCmax, %FTP et %PMA sont convertis eux aussi", () => {
  const fc = texte(rendre(bloc([segment({ intensityTargetType: "heart_rate_percentage", targetHrPercentage: 80 })]), JULES));
  assert.ok(fc.includes("152"), "80 % de 190 bpm = 152 bpm");

  const ftp = texte(
    rendre(bloc([segment({ intensityTargetType: "ftp_percentage", targetPowerPercentage: 90 })], { sport: "velo" }), JULES),
  );
  assert.ok(ftp.includes("189"), "90 % de 210 W de FTP = 189 W");

  const pma = texte(
    rendre(bloc([segment({ intensityTargetType: "pma_percentage", targetPowerPercentage: 75 })], { sport: "velo" }), JULES),
  );
  assert.ok(pma.includes("240"), "75 % de 320 W de PMA = 240 W");
});

test("CALC3. une référence absente est DITE sur la ligne, jamais remplacée", () => {
  const sansVma: ReferencesAthlete = { ...JULES, vmaCourseKmh: VALEUR_ABSENTE };
  const lu = texte(rendre(bloc([segment({ intensityTargetType: "vma_percentage", targetVmaPercentage: 100 })]), sansVma));
  assert.ok(/référence indisponible/i.test(lu), "le coach doit voir POURQUOI rien n'est calculé");
  /*
   * ⚠️ ON VISE LA VALEUR, PAS L'UNITÉ. « km/h » figure dans le LIBELLÉ du type
   * d'intensité « Vitesse (km/h) », toujours présent dans la liste déroulante :
   * l'interdire tout court rendrait ce test rouge en permanence.
   */
  assert.ok(!/16[,.]?\d* km\/h/.test(lu), "aucune vitesse calculée ne doit apparaître sans VMA");
  assert.ok(!/3:45/.test(lu), "aucune allure ne doit être déduite non plus");
});

test("CALC4. un bloc SANS sport le dit au lieu de choisir une conversion", () => {
  const lu = texte(
    rendre(bloc([segment({ intensityTargetType: "vma_percentage", targetVmaPercentage: 100 })], { sport: undefined }), JULES),
  );
  assert.ok(/sport du bloc non renseign/i.test(lu), "%VMA course et %VMA natation ne donnent pas la même vitesse");
});

test("CALC5. SANS références d'athlète, la ligne retombe sur l'aperçu de rédaction — pas sur du vide silencieux", () => {
  const lu = texte(rendre(bloc([segment({ intensityTargetType: "vma_percentage", targetVmaPercentage: 100 })])));
  assert.ok(lu.includes("VMA réf. 15 km/h"), "dans le builder de programme, l'aperçu dit sur quelle VMA il s'appuie");
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. LE BLOC — sport, séries, et l'ajout de segments
 * ════════════════════════════════════════════════════════════════════════ */

test("BLOC1. le sport et les séries du bloc sont saisissables, et relus", () => {
  const html = decode(
    renderToString(
      createElement(CardioBlockRow, {
        block: bloc([segment({})], { sport: "natation", rounds: 5 }),
        referenceVmaKmh: 15,
        onChange: () => {},
        showBlockChrome: false,
      }),
    ),
  );
  assert.match(html, /<option[^>]*selected[^>]*value="natation"|<option[^>]*value="natation"[^>]*selected/);
  assert.ok(html.includes('value="5"'), "les 5 séries du bloc doivent être relues");
  assert.ok(texte(html).includes("Sport non renseigné"), "l'option vide reste la première : aucun sport n'est choisi d'office");
});

test("BLOC2. on peut ajouter un segment, et l'ordre affiché suit `order`", () => {
  const html = rendre(
    bloc([segment({ id: "a", order: 0, title: "Échauffement" }), segment({ id: "b", order: 1, title: "Corps" })]),
  );
  const lu = texte(html);
  assert.ok(/Ajouter un segment|Ajouter un intervalle/i.test(lu), "il faut pouvoir ajouter un segment");
  assert.ok(lu.indexOf("Échauffement") < lu.indexOf("Corps") || html.indexOf('value="Échauffement"') < html.indexOf('value="Corps"'));
});

/* ── Bilan ─────────────────────────────────────────────────────────────────── */
console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
