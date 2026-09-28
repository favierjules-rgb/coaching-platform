/**
 * Harnais — LE BLOC CARDIO : intensités, dates, enregistrement, extraction.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER REFUSE DE LAISSER PASSER
 * ════════════════════════════════════════════════════════════════════════
 *   1. une zone ou un pourcentage converti SANS SPORT — « Z4 » n'a pas la même
 *      vitesse en course, à vélo et à la nage ;
 *   2. une conversion faite alors que la référence physiologique manque
 *      (l'écran doit dire « — », pas « 0 km/h ») ;
 *   3. une formule de vitesse, d'allure, de watts ou de bpm réécrite hors de
 *      `lib/physiologie.ts` ;
 *   4. `scheduled_date` écrasée par le calcul historique, ou effacée par un
 *      enregistrement de blocs qui ne parle pas de date ;
 *   5. un enregistrement cardio qui n'enverrait PAS les blocs de musculation de
 *      la séance — la RPC supprime tout bloc absent du payload ;
 *   6. le cardio qui reviendrait vivre dans `components/admin/ProgramBuilder.tsx`.
 *
 * Lancement : npm run test:cardio-builder
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { weekDays } from "../../lib/admin";
import {
  ajouterJours,
  dateDeLaSeance,
  decalageDeLaSeance,
  grilleDuMois,
  indexDuJour,
  libelleDuMois,
  positionDansLeProgramme,
} from "../../lib/calendrier-athlete";
import { blocsCardioPourEnregistrement } from "../../components/admin/cardio/EditeurBlocsCardio";
import { cibleDuSegment, sportDesZones } from "../../lib/cardio-zones";
import { cardioSegmentTypeLabels, intensityTargetTypeLabels } from "../../lib/cardio";
import { numeroDeSemaine } from "../../lib/semaine-individuelle";
import {
  buildCanonicalSessionBlocksInput,
  buildLegacySessionBlocksInput,
  saveTrainingSessionBlocks,
} from "../../lib/supabase/training-session-blocks";
import { valeurPhysio, VALEUR_ABSENTE } from "../../lib/physiologie";
import type { ReferencesAthlete } from "../../lib/zones-physiologiques";
import type { AdminCardioSegment, TrainingBlock } from "../../types";

const RACINE = new URL("../../", import.meta.url).pathname;
const lireSource = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");
const sansCommentaires = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

let réussis = 0;
let échecs = 0;
async function test(nom: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

/* ── L'athlète de référence (mêmes valeurs que les captures iDO) ─────────── */
const JULES: ReferencesAthlete = {
  fcMax: valeurPhysio(190, "mesuree"),
  fcRepos: valeurPhysio(48, "mesuree"),
  vmaCourseKmh: valeurPhysio(11, "mesuree"),
  vmaNatationKmh: valeurPhysio(3, "mesuree"),
  ftpWatts: valeurPhysio(210, "mesuree"),
  pmaWatts: valeurPhysio(320, "mesuree"),
};
const SANS_REFERENCES: ReferencesAthlete = {
  fcMax: VALEUR_ABSENTE, fcRepos: VALEUR_ABSENTE, vmaCourseKmh: VALEUR_ABSENTE,
  vmaNatationKmh: VALEUR_ABSENTE, ftpWatts: VALEUR_ABSENTE, pmaWatts: VALEUR_ABSENTE,
};

function segment(partiel: Partial<AdminCardioSegment>): AdminCardioSegment {
  return {
    id: partiel.id ?? "seg",
    order: partiel.order ?? 0,
    segmentType: partiel.segmentType ?? "work",
    title: partiel.title ?? "",
    intensityTargetType: partiel.intensityTargetType ?? "free",
    ...partiel,
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * I. LE VOCABULAIRE
 * ════════════════════════════════════════════════════════════════════════ */

await test("VOCAB1. effort et contre-effort réutilisent `work` et `recovery`, déjà en base", () => {
  assert.equal(cardioSegmentTypeLabels.work, "Effort");
  assert.equal(cardioSegmentTypeLabels.recovery, "Contre-effort");
  assert.equal(cardioSegmentTypeLabels.warmup, "Échauffement");
  assert.equal(cardioSegmentTypeLabels.cooldown, "Retour au calme");
  // Aucun type `effort` / `counter_effort` n'a été inventé.
  assert.equal((cardioSegmentTypeLabels as Record<string, string>).effort, undefined);
  assert.equal((cardioSegmentTypeLabels as Record<string, string>).counter_effort, undefined);
});

await test("VOCAB2. les quatre nouveaux segments sont autorisés par la migration, les anciens conservés", () => {
  const sql = lireSource("supabase/migrations/20260930100000_cardio_builder_et_calendrier.sql");
  const contrainte = /training_prescriptions_segment_type_check[\s\S]*?\]\)\);/.exec(sql)?.[0] ?? "";
  for (const valeur of ["single", "repeat_group", "work", "recovery", "ramp_up", "ramp_down", "warmup", "cooldown"]) {
    assert.ok(contrainte.includes(`'${valeur}'`), `${valeur} absent du CHECK`);
  }
  // Toutes les valeurs du type TypeScript sont couvertes par le CHECK.
  for (const valeur of Object.keys(cardioSegmentTypeLabels)) {
    assert.ok(contrainte.includes(`'${valeur}'`), `${valeur} refusé par la base`);
  }
});

await test("VOCAB3. les trois nouvelles intensités sont autorisées, les dix anciennes conservées", () => {
  const sql = lireSource("supabase/migrations/20260930100000_cardio_builder_et_calendrier.sql");
  const contrainte = /training_prescriptions_intensity_target_type_check[\s\S]*?\]\)\);/.exec(sql)?.[0] ?? "";
  for (const valeur of Object.keys(intensityTargetTypeLabels)) {
    assert.ok(contrainte.includes(`'${valeur}'`), `${valeur} refusé par la base`);
  }
  for (const ancien of ["vma_percentage", "speed_kmh", "pace", "heart_rate_zone", "heart_rate_percentage", "rpe", "power", "race_pace", "free", "custom"]) {
    assert.ok(contrainte.includes(`'${ancien}'`), `${ancien} a disparu du CHECK`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LA TRADUCTION DES INTENSITÉS
 * ════════════════════════════════════════════════════════════════════════ */

await test("CIBLE1. Z4 en course : bornes, vitesses, allures et FC de l'athlète", () => {
  const cible = cibleDuSegment(segment({ intensityTargetType: "zone", targetZone: 4 }), "course", JULES);
  assert.equal(cible.consigne, "Z4 — Seuil");
  /*
   * ⚠️ DEUX BARÈMES DIFFÉRENTS DANS LA MÊME LIGNE, ET C'EST VOULU. Les
   * pourcentages affichés sont ceux de la VMA (Z4 = 85-92 %), la FC vient du
   * barème FC (Z4 = 92-96 % de FCmax). Les confondre était mon erreur
   * initiale ; les valeurs ci-dessous sont celles des captures iDO :
   * 9,35 et 10,12 km/h, 6:25 et 5:56 /km pour une VMA de 11, et 175-182 bpm
   * pour une FCmax de 190.
   */
  assert.deepEqual(cible.valeurs, ["85% - 92%", "9.35 - 10.12 km/h", "6:25 - 5:56 /km", "175 - 182 bpm"]);
  assert.equal(cible.referenceManquante, false);
  assert.equal(cible.sportManquant, false);
});

await test("CIBLE2. Z4 à vélo : des WATTS, pas une vitesse", () => {
  const cible = cibleDuSegment(segment({ intensityTargetType: "zone", targetZone: 4 }), "velo", JULES);
  assert.ok(cible.valeurs.includes("189 - 221 w"), JSON.stringify(cible.valeurs));
  assert.ok(!cible.valeurs.some((v) => v.includes("km/h")), "aucune vitesse à vélo");
});

await test("CIBLE3. Z4 en natation : l'allure est aux 100 m", () => {
  const cible = cibleDuSegment(segment({ intensityTargetType: "zone", targetZone: 4 }), "natation", JULES);
  assert.ok(cible.valeurs.some((v) => v.includes("/100 m")), JSON.stringify(cible.valeurs));
  assert.ok(!cible.valeurs.some((v) => v.includes("/km")), "l'allure au km serait fausse en natation");
});

await test("CIBLE4. SANS SPORT, aucune conversion n'est tentée — et c'est signalé", () => {
  for (const sport of [undefined, "autre" as const]) {
    const zone = cibleDuSegment(segment({ intensityTargetType: "zone", targetZone: 4 }), sport, JULES);
    assert.equal(zone.sportManquant, true, `sport=${String(sport)}`);
    assert.deepEqual(zone.valeurs, [], "rien ne doit être inventé sans sport");
    const vma = cibleDuSegment(segment({ intensityTargetType: "vma_percentage", targetVmaPercentage: 105 }), sport, JULES);
    assert.equal(vma.sportManquant, true);
    assert.equal(vma.consigne, "105 % VMA", "la consigne reste lisible");
  }
});

await test("CIBLE5. % VMA à vélo n'a pas de sens : signalé, jamais converti contre le FTP", () => {
  const cible = cibleDuSegment(segment({ intensityTargetType: "vma_percentage", targetVmaPercentage: 105 }), "velo", JULES);
  assert.equal(cible.sportManquant, true);
  assert.deepEqual(cible.valeurs, []);
});

await test("CIBLE6. 105 % VMA en course → 11.55 km/h et 5:12 /km (valeurs des captures)", () => {
  const cible = cibleDuSegment(segment({ intensityTargetType: "vma_percentage", targetVmaPercentage: 105 }), "course", JULES);
  assert.deepEqual(cible.valeurs, ["11.55 km/h", "5:12 /km"]);
});

await test("CIBLE7. une référence manquante rend « — », jamais zéro", () => {
  const vma = cibleDuSegment(segment({ intensityTargetType: "vma_percentage", targetVmaPercentage: 105 }), "course", SANS_REFERENCES);
  assert.equal(vma.referenceManquante, true);
  assert.deepEqual(vma.valeurs, []);
  const ftp = cibleDuSegment(segment({ intensityTargetType: "ftp_percentage", targetPowerPercentage: 90 }), "velo", SANS_REFERENCES);
  assert.equal(ftp.referenceManquante, true);
  const fc = cibleDuSegment(segment({ intensityTargetType: "heart_rate_percentage", targetHrPercentage: 85 }), "course", SANS_REFERENCES);
  assert.equal(fc.referenceManquante, true);
});

await test("CIBLE8. %FTP et %PMA sont deux référentiels DISTINCTS", () => {
  const ftp = cibleDuSegment(segment({ intensityTargetType: "ftp_percentage", targetPowerPercentage: 90 }), "velo", JULES);
  const pma = cibleDuSegment(segment({ intensityTargetType: "pma_percentage", targetPowerPercentage: 90 }), "velo", JULES);
  assert.deepEqual(ftp.valeurs, ["189 W"], "90 % de 210 W");
  assert.deepEqual(pma.valeurs, ["288 W"], "90 % de 320 W");
  assert.notDeepEqual(ftp.valeurs, pma.valeurs);
});

await test("CIBLE9. % FC max suit la FC DU SPORT quand elle existe", () => {
  const avecFcVelo: ReferencesAthlete = { ...JULES, fcMaxParSport: { velo: valeurPhysio(182, "mesuree") } };
  const velo = cibleDuSegment(segment({ intensityTargetType: "heart_rate_percentage", targetHrPercentage: 85 }), "velo", avecFcVelo);
  assert.deepEqual(velo.valeurs, ["155 bpm"], "85 % de 182");
  const course = cibleDuSegment(segment({ intensityTargetType: "heart_rate_percentage", targetHrPercentage: 85 }), "course", avecFcVelo);
  assert.deepEqual(course.valeurs, ["162 bpm"], "85 % de 190 — aucune FC spécifique inventée pour la course");
});

await test("CIBLE10. le RPE est lu dans `intensityMin` — là où le builder existant l'écrit", () => {
  const cible = cibleDuSegment(segment({ intensityTargetType: "rpe", intensityMin: 7 }), "course", JULES);
  assert.equal(cible.consigne, "RPE 7");
  // `targetZone` ne doit pas être confondu avec le RPE.
  const sansRpe = cibleDuSegment(segment({ intensityTargetType: "rpe", targetZone: 5 }), "course", JULES);
  assert.equal(sansRpe.consigne, "RPE non précisé");
});

await test("CIBLE11. vitesse et allure absolues se déduisent l'une de l'autre, sans référence", () => {
  const vitesse = cibleDuSegment(segment({ intensityTargetType: "speed_kmh", targetSpeedKmh: 12 }), "course", SANS_REFERENCES);
  assert.equal(vitesse.consigne, "12 km/h");
  assert.deepEqual(vitesse.valeurs, ["5:00 /km"]);
  const allure = cibleDuSegment(segment({ intensityTargetType: "pace", targetPaceSecondsPerKm: 300 }), "course", SANS_REFERENCES);
  assert.equal(allure.consigne, "5:00 /km");
  assert.deepEqual(allure.valeurs, ["12 km/h"]);
});

await test("CIBLE12. la zone libre historique (`target_hr_zone`) reste lisible telle quelle", () => {
  const cible = cibleDuSegment(segment({ intensityTargetType: "heart_rate_zone", targetHrZone: "Zone 3" }), "course", JULES);
  assert.equal(cible.consigne, "Zone 3");
  assert.equal(cible.referenceManquante, false);
});

await test("CIBLE13. ISOLATION — deux athlètes, deux résultats, aucune contamination", () => {
  const marco: ReferencesAthlete = { ...JULES, vmaCourseKmh: valeurPhysio(16.5, "mesuree") };
  const s = segment({ intensityTargetType: "vma_percentage", targetVmaPercentage: 100 });
  assert.deepEqual(cibleDuSegment(s, "course", JULES).valeurs[0], "11 km/h");
  assert.deepEqual(cibleDuSegment(s, "course", marco).valeurs[0], "16.5 km/h");
  assert.deepEqual(cibleDuSegment(s, "course", JULES).valeurs[0], "11 km/h", "le premier athlète n'a pas bougé");
});

await test("CIBLE14. aucune formule n'est réécrite dans lib/cardio-zones.ts", () => {
  const source = sansCommentaires(lireSource("lib/cardio-zones.ts"));
  assert.ok(!/3600\s*\/|360\s*\/|\/\s*100\b.*vitesse/i.test(source), "une conversion d'allure a été recopiée");
  assert.ok(!/\*\s*\w*[Pp]ourcentage\s*\)?\s*\/\s*100/.test(source), "un calcul de pourcentage a été recopié");
  assert.match(source, /from "@\/lib\/physiologie"/);
  assert.match(source, /from "@\/lib\/zones-physiologiques"/);
  assert.match(source, /speedKmhFromPaceSeconds/, "la conversion allure→vitesse reste celle de lib/cardio.ts");
});

await test("CIBLE15. sportDesZones ne ment pas sur « autre »", () => {
  assert.equal(sportDesZones("course"), "course");
  assert.equal(sportDesZones("velo"), "velo");
  assert.equal(sportDesZones("natation"), "natation");
  assert.equal(sportDesZones("autre"), null);
  assert.equal(sportDesZones(undefined), null);
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LA DATE D'UNE SÉANCE
 * ════════════════════════════════════════════════════════════════════════ */

await test("DATE1. sans `scheduled_date`, la date est CALCULÉE depuis le début du programme", () => {
  // Début lundi 21/09/2026. Semaine 1 lundi = 21/09 ; semaine 3 mercredi = 07/10.
  assert.deepEqual(dateDeLaSeance({ weekNumber: 1, day: "Lundi" }, "2026-09-21"), { date: "2026-09-21", origine: "calculee" });
  assert.deepEqual(dateDeLaSeance({ weekNumber: 1, day: "Dimanche" }, "2026-09-21"), { date: "2026-09-27", origine: "calculee" });
  assert.deepEqual(dateDeLaSeance({ weekNumber: 3, day: "Mercredi" }, "2026-09-21"), { date: "2026-10-07", origine: "calculee" });
});

await test("DATE2. `scheduled_date` GAGNE TOUJOURS sur le calcul", () => {
  const resultat = dateDeLaSeance({ weekNumber: 3, day: "Mercredi", scheduledDate: "2026-10-12" }, "2026-09-21");
  assert.deepEqual(resultat, { date: "2026-10-12", origine: "planifiee" });
});

await test("DATE3. sans date de début ET sans date planifiée, aucune date n'est inventée", () => {
  assert.deepEqual(dateDeLaSeance({ weekNumber: 3, day: "Mercredi" }, null), { date: null, origine: "indeterminee" });
  assert.deepEqual(dateDeLaSeance({ weekNumber: 3, day: "Mercredi" }, undefined), { date: null, origine: "indeterminee" });
  // Mais une séance DATÉE reste datée, même sans date de début de programme.
  assert.deepEqual(dateDeLaSeance({ weekNumber: 3, day: "Mercredi", scheduledDate: "2026-10-12" }, null), {
    date: "2026-10-12", origine: "planifiee",
  });
});

await test("DATE4. un jour inconnu ne produit pas une date au hasard", () => {
  assert.equal(indexDuJour("Lundi"), 0);
  assert.equal(indexDuJour("Dimanche"), 6);
  assert.equal(indexDuJour("Funday"), null);
  assert.deepEqual(dateDeLaSeance({ weekNumber: 1, day: "Funday" }, "2026-09-21"), { date: null, origine: "indeterminee" });
});

await test("DATE5. le décalage est l'INVERSE EXACT de numeroDeSemaine", () => {
  for (let semaine = 1; semaine <= 24; semaine += 1) {
    const decalage = decalageDeLaSeance(semaine, "Lundi");
    assert.equal(numeroDeSemaine(decalage as number), semaine, `semaine ${semaine}`);
  }
  // Et chaque jour de la semaine reste dans SA semaine.
  for (const jour of weekDays) {
    assert.equal(numeroDeSemaine(decalageDeLaSeance(5, jour) as number), 5, jour);
  }
});

await test("DATE6. le passage à l'heure d'hiver ne décale aucune séance", () => {
  // En France, l'heure d'hiver 2026 arrive le dimanche 25 octobre.
  assert.equal(ajouterJours("2026-10-24", 1), "2026-10-25");
  assert.equal(ajouterJours("2026-10-25", 1), "2026-10-26");
  assert.equal(ajouterJours("2026-10-20", 14), "2026-11-03");
  // Et l'heure d'été, le 29 mars 2026.
  assert.equal(ajouterJours("2026-03-28", 2), "2026-03-30");
  assert.equal(ajouterJours("2026-12-31", 1), "2027-01-01");
  assert.equal(ajouterJours("pas une date", 1), null);
});

await test("DATE7. positionDansLeProgramme répond au déplacement, et refuse l'avant-programme", () => {
  assert.deepEqual(positionDansLeProgramme("2026-10-07", "2026-09-21"), { semaine: 3, jour: "Mercredi" });
  assert.deepEqual(positionDansLeProgramme("2026-09-21", "2026-09-21"), { semaine: 1, jour: "Lundi" });
  assert.equal(positionDansLeProgramme("2026-09-20", "2026-09-21"), null, "aucune semaine 0");
  assert.equal(positionDansLeProgramme("2026-10-07", null), null);
});

await test("DATE8. aller-retour : une date calculée se replace sur la même semaine et le même jour", () => {
  for (let semaine = 1; semaine <= 12; semaine += 1) {
    for (const jour of weekDays) {
      const { date } = dateDeLaSeance({ weekNumber: semaine, day: jour }, "2026-09-21");
      assert.deepEqual(positionDansLeProgramme(date as string, "2026-09-21"), { semaine, jour }, `${semaine}/${jour}`);
    }
  }
});

await test("GRILLE1. la grille du mois fait toujours 42 cases et commence un lundi", () => {
  for (const [annee, mois] of [[2026, 2], [2026, 5], [2026, 10], [2027, 1]] as const) {
    const cases = grilleDuMois(annee, mois);
    assert.equal(cases.length, 42, `${annee}-${mois}`);
    assert.deepEqual(positionDansLeProgramme(cases[0].date, cases[0].date)?.jour, "Lundi");
    assert.ok(cases.some((c) => c.dansLeMois), "aucun jour du mois");
  }
  assert.equal(libelleDuMois(2026, 10), "octobre 2026");
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. L'ENREGISTREMENT
 * ════════════════════════════════════════════════════════════════════════ */

function clientFactice() {
  const appels: { fn: string; payload: Record<string, unknown> }[] = [];
  const client = {
    rest: {},
    rpc(fn: string, args: { p_payload: Record<string, unknown> }) {
      appels.push({ fn, payload: args.p_payload });
      return Promise.resolve({
        data: {
          session_id: args.p_payload.session_id,
          updated_at: "2026-09-28T12:00:00.000Z",
          session_type: "mixed",
          scheduled_date: "2026-10-05",
          blocks: [],
          id_mapping: { blocks: {}, exercises: {} },
          warnings: { detached_exercise_feedback_count: 0 },
        },
        error: null,
      });
    },
  };
  return { client: client as never, appels };
}

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const BLOC_MUSCU = "44444444-4444-4444-8444-444444444444";
const EXO = "55555555-5555-4555-8555-555555555555";
const BLOC_CARDIO = "66666666-6666-4666-8666-666666666666";

function blocsMixtes(): TrainingBlock[] {
  return [
    {
      id: BLOC_MUSCU, category: "strength", position: 0, title: "Muscu", colorKey: "gray",
      exercises: [{ id: EXO, order: 0, name: "Squat", sets: 5, reps: "5", restSeconds: 120, tempo: "", recommendedLoad: "100kg", videoUrl: "", notes: "" }],
    },
    {
      id: BLOC_CARDIO, category: "cardio", position: 1, title: "VMA", colorKey: "red",
      cardioType: "vma_intervals", sport: "course", rounds: 3,
      prescriptions: [
        segment({ id: "s1", segmentType: "warmup", intensityTargetType: "zone", targetZone: 2, durationSeconds: 600 }),
        segment({ id: "s2", segmentType: "work", intensityTargetType: "vma_percentage", targetVmaPercentage: 105, distanceMeters: 400 }),
        segment({ id: "s3", segmentType: "recovery", intensityTargetType: "rpe", intensityMin: 3, durationSeconds: 90 }),
        segment({ id: "s4", segmentType: "cooldown", intensityTargetType: "ftp_percentage", targetPowerPercentage: 55, durationSeconds: 480 }),
      ],
    },
  ];
}

await test("RPC1. le payload cardio porte sport, rounds, zone et % de puissance", async () => {
  const { client, appels } = clientFactice();
  await saveTrainingSessionBlocks(client, buildCanonicalSessionBlocksInput({
    sessionId: SESSION_ID, expectedUpdatedAt: "2026-09-28T11:00:00.000Z", blocks: blocsMixtes(),
  }));
  const blocs = appels[0].payload.blocks as Record<string, unknown>[];
  const cardio = blocs.find((b) => b.category === "cardio") as Record<string, unknown>;
  assert.equal(cardio.sport, "course");
  assert.equal(cardio.rounds, 3);
  const prescriptions = cardio.prescriptions as Record<string, unknown>[];
  assert.deepEqual(prescriptions.map((p) => p.segment_type), ["warmup", "work", "recovery", "cooldown"]);
  assert.equal(prescriptions[0].target_zone, 2);
  assert.equal(prescriptions[3].target_power_percentage, 55);
  assert.equal(prescriptions[1].target_vma_percentage, 105);
});

await test("RPC2. PORTÉE — un enregistrement cardio DÉCLARE sa portée, et refuse un bloc de musculation", async () => {
  const { client, appels } = clientFactice();
  const cardio = blocsMixtes().filter((b) => b.category === "cardio");
  await saveTrainingSessionBlocks(client, buildCanonicalSessionBlocksInput({
    sessionId: SESSION_ID, expectedUpdatedAt: "2026-09-28T11:00:00.000Z", blocks: cardio, scope: "cardio",
  }));
  assert.equal(appels[0].payload.scope, "cardio", "la portée doit partir dans le payload");
  const blocs = appels[0].payload.blocks as Record<string, unknown>[];
  assert.equal(blocs.length, 1);
  assert.equal(blocs[0].position, 1, "hors portée « all », la position de la séance est OBLIGATOIRE dans le payload");

  /*
   * ⚠️ REFUS AVANT LE RÉSEAU. La garantie vient de la RPC (SCOPE_VIOLATION,
   * prouvé sur PostgreSQL 16 par
   * supabase/tests/save_training_session_blocks_scope_test.sql) ; ce contrôle-ci
   * échoue plus tôt et nomme le bloc fautif.
   */
  const second = clientFactice();
  await assert.rejects(
    () => saveTrainingSessionBlocks(second.client, buildCanonicalSessionBlocksInput({
      sessionId: SESSION_ID, expectedUpdatedAt: "2026-09-28T11:00:00.000Z", blocks: blocsMixtes(), scope: "cardio",
    })),
    /le payload contient un bloc "strength"/,
  );
  assert.equal(second.appels.length, 0, "aucun appel réseau ne doit partir pour un payload hors portée");
});

await test("RPC2-bis. la portée par défaut reste « all » — aucun appelant existant n'est modifié", async () => {
  const { client, appels } = clientFactice();
  await saveTrainingSessionBlocks(client, buildCanonicalSessionBlocksInput({
    sessionId: SESSION_ID, expectedUpdatedAt: "2026-09-28T11:00:00.000Z", blocks: blocsMixtes(),
  }));
  assert.equal(appels[0].payload.scope, "all");
  assert.equal((appels[0].payload.blocks as unknown[]).length, 2, "en portée complète, la séance entière part");
});

await test("RPC2-ter. la RPC borne ses suppressions à la portée — lu dans la migration", () => {
  const sql = lireSource("supabase/migrations/20260930100000_cardio_builder_et_calendrier.sql");
  assert.match(sql, /v_scope := coalesce\(nullif\(p_payload->>'scope', ''\), 'all'\)/);
  assert.match(sql, /raise exception 'INVALID_SCOPE/);
  assert.match(sql, /raise exception 'SCOPE_VIOLATION/);
  assert.match(sql, /raise exception 'MISSING_BLOCK_POSITION/);
  // En portée cardio, AUCUN exercice n'est candidat à la suppression.
  assert.match(sql, /if v_scope = 'cardio' then\s+v_ex_ids_to_delete := array\[\]::uuid\[\];/);
  // Les suppressions de blocs sont filtrées par catégorie.
  assert.match(sql, /block_type = 'cardio' and id <> all\(v_kept_block_uuids\)/);
  assert.match(sql, /block_type <> 'cardio' and id <> all\(v_kept_block_uuids\)/);
  // Le type de séance est dérivé de la BASE, pas du payload.
  assert.match(sql, /into v_has_strength, v_has_cardio\s+from public\.training_blocks where session_id = v_session_id/);
});

await test("RPC2-quater. les cas A à E sont prouvés par un test SQL, pas seulement par le client", () => {
  const sql = lireSource("supabase/tests/save_training_session_blocks_scope_test.sql");
  for (const cas of ["CAS A", "CAS B", "CAS C", "CAS D", "CAS E", "REFUS"]) {
    assert.ok(sql.includes(cas), `${cas} absent du test SQL`);
  }
  const assertions = (sql.match(/assert /g) ?? []).length;
  assert.ok(assertions >= 25, `seulement ${assertions} assertions dans le test SQL`);
  assert.match(sql, /rollback;/, "le test ne doit rien laisser derrière lui");
});

await test("BUILDER1. l'éditeur cardio ne renvoie QUE le cardio, positions de la séance préservées", () => {
  /*
   * ⚠️ LA GARANTIE A CHANGÉ DE CAMP, ET C'EST LE POINT. Avant, l'éditeur
   * renvoyait TOUTE la séance et il fallait lui faire confiance pour recopier la
   * musculation fidèlement. Maintenant il ne renvoie que le cardio et
   * l'enregistrement part en portée « cardio » : la musculation n'est PAS dans
   * le payload, donc la RPC n'a structurellement rien à supprimer.
   */
  const blocs = blocsCardioPourEnregistrement(blocsMixtes());
  assert.equal(blocs.length, 1, "seul le cardio doit partir");
  assert.equal(blocs.every((b) => b.category === "cardio"), true);
  assert.equal(blocs[0].position, 1, "la position dans la SÉANCE est préservée, pas renumérotée à 0");
});

await test("BUILDER2. l'éditeur cardio n'expose aucun champ de musculation", () => {
  const source = sansCommentaires(lireSource("components/admin/cardio/EditeurBlocsCardio.tsx"));
  for (const champ of ["recommendedLoad", "recommendedRpe", "sets:", "reps:"]) {
    assert.ok(!source.includes(champ), `l'éditeur cardio touche à « ${champ} », qui appartient à la musculation`);
  }
  assert.match(source, /conservé tel quel/, "la musculation doit être VISIBLE, pour montrer l'ordre réel");
  assert.match(source, /blocsCardioPourEnregistrement/);
});

await test("BUILDER3. l'enregistrement d'un bloc cardio part en portée « cardio »", () => {
  const hook = sansCommentaires(lireSource("hooks/useCalendrierAthlete.ts"));
  assert.match(hook, /scope: "cardio"/, "la sauvegarde cardio doit déclarer sa portée");
  assert.ok(!/scope: "all"/.test(hook), "aucun chemin du calendrier ne doit enregistrer du cardio en portée complète");
});

await test("RPC3. le chemin legacy envoie aussi les deux familles", () => {
  const entree = buildLegacySessionBlocksInput({
    sessionId: SESSION_ID,
    expectedUpdatedAt: "2026-09-28T11:00:00.000Z",
    session: {
      exercises: [{ id: EXO, order: 0, name: "Squat", sets: 5, reps: "5", restSeconds: 120, tempo: "", recommendedLoad: "", videoUrl: "", notes: "" }],
      cardioBlocks: [{ id: BLOC_CARDIO, order: 1, title: "VMA", cardioType: "vma_intervals", sport: "course", rounds: 3, segments: [] }],
    },
    strengthBlockId: BLOC_MUSCU,
  });
  assert.equal(entree.blocks.length, 2);
  const cardio = entree.blocks.find((b) => b.category === "cardio");
  assert.equal(cardio?.category === "cardio" ? cardio.sport : null, "course", "le sport survit à la conversion legacy");
  assert.equal(cardio?.category === "cardio" ? cardio.rounds : null, 3);
});

await test("RPC4. `scheduled_date` n'entre dans le patch QUE si l'appelant la fournit", async () => {
  const { client, appels } = clientFactice();
  await saveTrainingSessionBlocks(client, {
    sessionId: SESSION_ID, expectedUpdatedAt: "2026-09-28T11:00:00.000Z", blocks: [],
    sessionPatch: { name: "Sortie longue" },
  });
  const patchSansDate = appels[0].payload.session_patch as Record<string, unknown>;
  assert.ok(!("scheduled_date" in patchSansDate), "une clé absente est ce qui protège la date existante");

  const second = clientFactice();
  await saveTrainingSessionBlocks(second.client, {
    sessionId: SESSION_ID, expectedUpdatedAt: "2026-09-28T11:00:00.000Z", blocks: [],
    sessionPatch: { scheduledDate: "2026-10-12" },
  });
  assert.equal((second.appels[0].payload.session_patch as Record<string, unknown>).scheduled_date, "2026-10-12");

  const troisieme = clientFactice();
  await saveTrainingSessionBlocks(troisieme.client, {
    sessionId: SESSION_ID, expectedUpdatedAt: "2026-09-28T11:00:00.000Z", blocks: [],
    sessionPatch: { scheduledDate: null },
  });
  assert.equal((troisieme.appels[0].payload.session_patch as Record<string, unknown>).scheduled_date, null,
    "null EFFACE la date : la séance revient au calcul historique");
});

await test("RPC5. la RPC est appelée UNE seule fois, et la date revient dans le résultat", async () => {
  const { client, appels } = clientFactice();
  const resultat = await saveTrainingSessionBlocks(client, buildCanonicalSessionBlocksInput({
    sessionId: SESSION_ID, expectedUpdatedAt: "2026-09-28T11:00:00.000Z", blocks: blocsMixtes(),
  }));
  assert.equal(appels.length, 1);
  assert.equal(appels[0].fn, "save_training_session_blocks");
  assert.equal(resultat.scheduledDate, "2026-10-05");
});

await test("MIGRATION2. la migration cardio reste non destructive et documente la portée", () => {
  const brut = lireSource("supabase/migrations/20260930100000_cardio_builder_et_calendrier.sql");
  const sql = brut.replace(/^\s*--.*$/gm, " ");
  /*
   * ⚠️ LE `delete from` DE LA RPC EST LÉGITIME : c'est ainsi qu'un bloc
   * supprimé par le coach disparaît. La garde porte donc sur la partie DDL,
   * avant la recréation de la fonction — c'est là qu'un `drop column` ou un
   * `delete from` détruirait des données de production.
   */
  const ddl = sql.slice(0, sql.indexOf("create or replace function"));
  assert.ok(ddl.length > 100, "la partie DDL n'a pas été trouvée");
  assert.ok(!/drop table|drop column|delete from|truncate|update public\./i.test(ddl), "la migration détruit ou réécrit des données");
  assert.ok(!/create table/i.test(sql), "aucune table nouvelle : les colonnes existantes portent la donnée");
  assert.match(sql, /add column if not exists scheduled_date date/);
  assert.match(sql, /create index if not exists workout_sessions_scheduled_date_idx/);
  assert.match(sql, /where scheduled_date is not null/, "index partiel : 847 séances NULL n'ont rien à y faire");
  assert.match(sql, /add column if not exists sport text/);
  assert.match(sql, /add column if not exists target_zone smallint/);
  assert.match(sql, /add column if not exists target_power_percentage numeric/);
  // Les gardes de la RPC sont CONSERVÉES.
  assert.match(sql, /security invoker/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /is_coach_or_admin\(\)/);
  assert.match(sql, /STALE_TRAINING_SESSION/);
  assert.match(sql, /revoke execute on function public\.save_training_session_blocks\(jsonb\) from anon;/);
  assert.match(sql, /grant execute on function public\.save_training_session_blocks\(jsonb\) to authenticated;/);
  // La portée est ÉCRITE dans l'en-tête, pas seulement dans le code.
  assert.match(brut, /POUVOIR IMPLICITE de supprimer/, "le défaut corrigé doit être nommé dans l'en-tête");
  assert.match(brut, /scope = 'cardio'/, "la portée doit être documentée dans l'en-tête");
  assert.match(brut, /LA POSITION DE CHAQUE BLOC EST OBLIGATOIRE/);
  // `rounds` d'un bloc de musculation n'est pas écrasé.
  assert.match(sql, /rounds = case when v_category = 'cardio' then \(v_block->>'rounds'\)::int else rounds end/);
});

await test("MIGRATION3. aucune version de migration en doublon, et les nouvelles sont les DERNIÈRES", () => {
  /*
   * ⚠️ CE TEST FERME UN DÉFAUT RÉEL DE CE CHANTIER. La migration du profil
   * physiologique portait d'abord la version 20260928090000 — DÉJÀ PRISE par
   * `program_review_flags_grants`, appliquée en production. `supabase db push`
   * aurait lu cette version dans l'historique, conclu que la migration était
   * faite, et n'aurait créé AUCUNE colonne : l'application aurait échoué à
   * l'écriture sans qu'aucune commande n'ait signalé quoi que ce soit.
   *
   * ⚠️ ET UNE MIGRATION ANTÉRIEURE À LA DERNIÈRE APPLIQUÉE EST REFUSÉE. Les
   * nouvelles doivent donc être les plus récentes du dossier.
   */
  const dossier = join(RACINE, "supabase/migrations");
  const versions = readdirSync(dossier)
    .filter((nom) => nom.endsWith(".sql"))
    .map((nom) => ({ nom, version: nom.split("_")[0] }));

  const vues = new Map<string, string>();
  for (const { nom, version } of versions) {
    const deja = vues.get(version);
    assert.equal(deja, undefined, `version ${version} en doublon : ${deja} et ${nom}`);
    vues.set(version, nom);
  }

  const triees = versions.map((v) => v.version).sort();
  const deuxDernieres = triees.slice(-2);
  assert.deepEqual(
    deuxDernieres,
    ["20260930090000", "20260930100000"],
    "les deux migrations de ce chantier doivent être les plus récentes du dossier",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * V. L'EXTRACTION HORS DU BUILDER MUSCULATION
 * ════════════════════════════════════════════════════════════════════════ */

await test("EXTRACTION1. ProgramBuilder.tsx ne déclare plus AUCUN formulaire cardio", () => {
  const builder = lireSource("components/admin/ProgramBuilder.tsx");
  assert.ok(!/export function CardioSegmentRow/.test(builder), "CardioSegmentRow est revenu dans le builder muscu");
  assert.ok(!/export function CardioBlockRow/.test(builder), "CardioBlockRow est revenu dans le builder muscu");
  const sansNotes = sansCommentaires(builder);
  for (const vocabulaire of [
    "cardioSegmentTypeLabels", "intensityTargetTypeLabels", "machineTypeLabels", "segmentIntensityPreview",
    "targetVmaPercentage", "targetPaceSecondsPerKm", "intensityTargetType", "segmentType",
  ]) {
    assert.ok(!sansNotes.includes(vocabulaire), `le vocabulaire cardio « ${vocabulaire} » est réapparu dans ProgramBuilder.tsx`);
  }
  // Il importe le bloc cardio, il ne le réimplémente pas.
  assert.match(sansNotes, /import \{ CardioBlockRow \} from "@\/components\/admin\/cardio\/CardioBlockRow"/);
});

await test("EXTRACTION2. le builder MUSCULATION est toujours entier", () => {
  const builder = lireSource("components/admin/ProgramBuilder.tsx");
  for (const garde of ["export function ExerciseRow", "export function DayCard", "export function blankExercise", "export function exerciseFromLibrary", "export function restDaySession", "export interface ProgramBuilderData"]) {
    assert.ok(builder.includes(garde), `${garde} a disparu du builder de musculation`);
  }
  assert.match(builder, /parsePrescribedRpe\(exercise\.recommendedRpe/, "la validation du RPE cible est intacte");
});

await test("EXTRACTION3. le module cardio porte les deux composants, sans cycle d'import", () => {
  const moduleCardio = lireSource("components/admin/cardio/CardioBlockRow.tsx");
  assert.match(moduleCardio, /export function CardioSegmentRow\(/);
  assert.match(moduleCardio, /export function CardioBlockRow\(/);
  assert.ok(!/from "@\/components\/admin\/ProgramBuilder"/.test(moduleCardio), "cycle d'import avec le builder muscu");
  // Plus AUCUN consommateur ne prend le cardio dans ProgramBuilder.
  for (const chemin of ["components/admin/blocks/CardioBlockEditor.tsx"]) {
    const source = lireSource(chemin);
    assert.ok(!/CardioBlockRow \} from "@\/components\/admin\/ProgramBuilder"/.test(source), `${chemin} importe encore du builder muscu`);
    assert.match(source, /from "@\/components\/admin\/cardio\/CardioBlockRow"/);
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
