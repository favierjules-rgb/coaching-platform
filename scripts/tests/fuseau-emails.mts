/**
 * Harnais — FUSEAU DES DATES DANS LES E-MAILS.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️ CETTE SUITE DOIT TOURNER EN TZ=UTC, ET LE SCRIPT NPM L'IMPOSE.    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ C'EST LA CONDITION QUI A MANQUÉ, ET C'EST POURQUOI LE DÉFAUT A ATTEINT
 * LA PRODUCTION. 22 fichiers de test de ce dépôt posent
 * `process.env.TZ = "Europe/Paris"` pour être déterministes. Le runtime
 * serveur de Vercel, lui, est en UTC. Une assertion écrite sous
 * `Europe/Paris` aurait donc validé un e-mail que la production rend
 * différemment. Cette suite reproduit le runtime réel : UTC.
 *
 * ⚠️ AUCUN APPEL DE `composeAppointment*` N'EXISTAIT DANS LES TESTS avant le
 * 22/11/2026 — mesuré : zéro occurrence sur plus de 200 suites. Le contenu
 * rendu de ces quatre e-mails n'était couvert par rien.
 *
 * Lancement : TZ=UTC NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/fuseau-emails.mts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

import {
  composeAppointmentCancelledEmail,
  composeAppointmentCreatedCoachEmail,
  composeAppointmentCreatedStudentEmail,
  composeAppointmentReminderEmail,
  composeSubscriptionCancelledEmail,
} from "../../lib/email/templates";
import { buildConfirmationIcs } from "../../lib/ics";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      failed += 1;
      console.error(`ÉCHEC - ${name}`);
      console.error(error);
    });
}

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
const GABARITS_SOURCE = lire("../../lib/email/templates/index.ts");

/* ═════════════════════════ Jeu de données ═════════════════════════ */

/**
 * ⚠️ VALEUR RÉELLEMENT LUE EN BASE pour le rendez-vous de test du 22/11/2026
 * (`appointments.start_at`), celui dont l'e-mail annonçait 07:30 alors que
 * l'application et Apple Calendar affichaient 08:30.
 */
const DEBUT_HIVER = "2026-11-23T07:30:00+00:00"; // 08:30 à Paris (UTC+1)
const FIN_HIVER = "2026-11-23T08:15:00+00:00";
const DEBUT_ETE = "2026-07-15T07:30:00+00:00"; // 09:30 à Paris (UTC+2)
/** 23:30Z le 23 = 00:30 le 24 à Paris : le JOUR bascule, pas seulement l'heure. */
const DEBUT_MINUIT = "2026-11-23T23:30:00+00:00";

type Gabarit = (debut: string) => { subject: string; html: string; text: string };

const GABARITS_RENDEZ_VOUS: [string, Gabarit][] = [
  [
    "appointment_created / élève",
    (d) =>
      composeAppointmentCreatedStudentEmail({
        firstName: "Thomas",
        appointmentType: "Coaching en salle",
        startAt: d,
        location: "Salle Nord",
        meetingUrl: "",
        coachName: "Jules Favier",
        appointmentUrl: "https://exemple.invalid/rendez-vous",
        isReschedule: false,
      }),
  ],
  [
    "appointment_created / coach",
    (d) =>
      composeAppointmentCreatedCoachEmail({
        coachFirstName: "Jules",
        studentName: "Thomas Martin",
        appointmentType: "Coaching en salle",
        startAt: d,
        appointmentUrl: "https://exemple.invalid/admin/calendrier",
        isReschedule: false,
      }),
  ],
  [
    "appointment_cancelled",
    (d) =>
      composeAppointmentCancelledEmail({
        recipientFirstName: "Thomas",
        appointmentType: "Coaching en salle",
        startAt: d,
        profileOrCalendarUrl: "https://exemple.invalid/rendez-vous",
      }),
  ],
  [
    "appointment_reminder",
    (d) =>
      composeAppointmentReminderEmail({
        firstName: "Thomas",
        appointmentType: "Coaching en salle",
        startAt: d,
        location: "Salle Nord",
        meetingUrl: "",
        hoursBefore: 24,
        appointmentUrl: "https://exemple.invalid/rendez-vous",
      }),
  ],
];

/** Toutes les heures `HH:MM` distinctes d'un e-mail, sujet et corps confondus. */
function heures(corps: { subject: string; html: string; text: string }): string[] {
  const tout = `${corps.subject}\n${corps.text}\n${corps.html}`;
  return [...new Set([...tout.matchAll(/\b([0-2]\d:[0-5]\d)\b/g)].map((m) => m[1]))].sort();
}
/** Tous les libellés « jour N mois » distincts. */
function jours(corps: { subject: string; html: string; text: string }): string[] {
  const tout = `${corps.subject}\n${corps.text}\n${corps.html}`;
  const motif = /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) (\d{1,2}) (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)/g;
  return [...new Set([...tout.matchAll(motif)].map((m) => m[0]))].sort();
}

/* ═══════════════════ 1. Le fuseau rendu (FUSEAU-*) ═══════════════════ */

await test("FUSEAU-00 le processus tourne bien en UTC, sinon cette suite ne prouve rien", () => {
  /*
   * ⚠️ GARDE-FOU DE LA SUITE ELLE-MÊME. Sous `Europe/Paris`, toutes les
   * assertions ci-dessous passeraient même avec le défaut : c'est exactement
   * ce qui s'est produit pendant des mois. On refuse donc de tourner ailleurs
   * qu'en UTC.
   */
  assert.equal(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    "UTC",
    "lancer cette suite avec TZ=UTC (voir le script npm) : elle doit reproduire le runtime Vercel",
  );
});

await test("FUSEAU-01 heure d'hiver : 07:30Z s'affiche 08:30, dans les quatre gabarits", () => {
  for (const [nom, gabarit] of GABARITS_RENDEZ_VOUS) {
    const corps = gabarit(DEBUT_HIVER);
    assert.deepEqual(heures(corps), ["08:30"], `${nom} : heure de Paris attendue, pas l'heure UTC`);
  }
});

await test("FUSEAU-02 heure d'été : 07:30Z s'affiche 09:30 (UTC+2), dans les quatre gabarits", () => {
  // Le décalage n'est pas une constante : +1 h en hiver, +2 h en été.
  for (const [nom, gabarit] of GABARITS_RENDEZ_VOUS) {
    assert.deepEqual(heures(gabarit(DEBUT_ETE)), ["09:30"], `${nom} : heure d'été`);
  }
});

await test("FUSEAU-03 bascule de jour : 23:30Z annonce « mardi 24 », pas « lundi 23 »", () => {
  /*
   * ⚠️ LE DÉFAUT NE DÉCALAIT PAS SEULEMENT L'HEURE. Mesuré le 22/11/2026 :
   * sous UTC, un créneau à 00:30 heure de Paris sortait « lundi 23 novembre,
   * 23:30 » — mauvais jour ET mauvaise heure, dans le sujet comme dans le
   * corps.
   */
  for (const [nom, gabarit] of GABARITS_RENDEZ_VOUS) {
    const corps = gabarit(DEBUT_MINUIT);
    assert.deepEqual(heures(corps), ["00:30"], `${nom} : heure après bascule`);
    assert.deepEqual(jours(corps), ["mardi 24 novembre"], `${nom} : jour après bascule`);
    assert.ok(!`${corps.subject}${corps.text}`.includes("lundi 23"), `${nom} : la veille ne doit plus apparaître`);
  }
});

await test("FUSEAU-04 sujet et corps portent la MÊME date", () => {
  // Les deux passent par formatDateTimeFr, mais rien ne le garantissait.
  for (const [nom, gabarit] of GABARITS_RENDEZ_VOUS) {
    const corps = gabarit(DEBUT_MINUIT);
    const dansSujet = [...corps.subject.matchAll(/(\d{1,2}) (novembre|décembre)/g)].map((m) => m[0]);
    if (dansSujet.length === 0) continue; // tous les sujets ne portent pas la date
    for (const d of dansSujet) {
      assert.ok(corps.text.includes(d), `${nom} : « ${d} » dans le sujet mais pas dans le corps`);
    }
  }
});

/* ══════════ 2. Cohérence croisée e-mail / ICS (CROISE-*) ══════════ */

await test("CROISE-01 l'heure de l'e-mail = le DTSTART de l'ICS converti à Paris", () => {
  /*
   * ⚠️ L'INVARIANT QUI MANQUAIT. L'e-mail et sa pièce jointe décrivent le même
   * instant : l'un en clair pour un humain, l'autre en UTC absolu pour un
   * client de calendrier. Rien ne les reliait, et ils ont divergé d'une heure
   * en production sans qu'aucun test ne s'en aperçoive.
   */
  for (const debut of [DEBUT_HIVER, DEBUT_ETE, DEBUT_MINUIT]) {
    const ics = buildConfirmationIcs({
      uid: "x@seth-coaching",
      title: "Séance de coaching — Jules FAVIER",
      description: "d",
      startAt: debut,
      endAt: FIN_HIVER,
      location: "",
      meetingUrl: "",
      organizerName: "Jules FAVIER",
      organizerEmail: "coach-a@exemple.invalid",
      attendeeName: "Thomas",
      attendeeEmail: "eleve@exemple.invalid",
      dtstamp: debut,
    });
    const brut = ics.split("\r\n").find((l) => l.startsWith("DTSTART:"))!.slice("DTSTART:".length);
    const iso = `${brut.slice(0, 4)}-${brut.slice(4, 6)}-${brut.slice(6, 8)}T${brut.slice(9, 11)}:${brut.slice(11, 13)}:${brut.slice(13, 15)}Z`;
    const attendu = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
    for (const [nom, gabarit] of GABARITS_RENDEZ_VOUS) {
      assert.deepEqual(heures(gabarit(debut)), [attendu], `${nom} @ ${debut} : e-mail et ICS doivent concorder`);
    }
  }
});

/* ══════════ 3. Indépendance réelle du fuseau du processus ══════════ */

await test("INDEP-01 le rendu ne dépend PAS du fuseau du processus, prouvé en sous-processus", () => {
  /*
   * ⚠️ MESURE, PAS RAISONNEMENT. On relance le même formatage dans TROIS
   * sous-processus, sous trois fuseaux très différents, et on exige le même
   * résultat. C'est la propriété que `timeZone` apporte, et la seule façon
   * honnête de la vérifier : changer `process.env.TZ` à chaud ne réinitialise
   * pas de façon fiable le cache d'`Intl` dans le processus courant.
   */
  const scriptUrl = new URL("./.fuseau-sous-processus.mts", import.meta.url);
  const tsxUrl = new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url);
  const script = [
    'import { composeAppointmentCreatedStudentEmail } from "../../lib/email/templates";',
    'const c = composeAppointmentCreatedStudentEmail({',
    '  firstName: "T", appointmentType: "Coaching", startAt: "' + DEBUT_HIVER + '",',
    '  location: "L", meetingUrl: "", coachName: "C", appointmentUrl: "u", isReschedule: false });',
    'const h = [...new Set([...(c.subject + c.text).matchAll(/\\b([0-2]\\d:[0-5]\\d)\\b/g)].map((m) => m[1]))];',
    "console.log(JSON.stringify(h));",
  ].join("\n");
  writeFileSync(scriptUrl, script, "utf8");
  try {
    const rendus = ["UTC", "Europe/Paris", "Asia/Tokyo"].map((tz) =>
      execFileSync(process.execPath, [tsxUrl.pathname, scriptUrl.pathname], {
        env: { ...process.env, TZ: tz, NODE_OPTIONS: "--conditions=react-server" },
        encoding: "utf8",
      }).trim(),
    );
    assert.deepEqual(
      [...new Set(rendus)],
      ['["08:30"]'],
      `trois fuseaux doivent rendre 08:30 — obtenu : ${JSON.stringify(rendus)}`,
    );
  } finally {
    rmSync(scriptUrl, { force: true });
  }
});

/* ══════════ 4. Ancrage au code de production (CODE-*) ══════════ */

await test("CODE-01 aucun formatage de date sans fuseau explicite dans les gabarits", () => {
  /*
   * ⚠️ SCELLÉ DE PRÉVENTION. Le défaut est né d'un appel à `toLocale*` sans
   * `timeZone`. Ce contrôle rougit si un cinquième formatage est ajouté sans
   * fuseau, plutôt que d'attendre qu'un e-mail parte à la mauvaise heure.
   */
  const appels = [...GABARITS_SOURCE.matchAll(/toLocale(?:Date|Time)String\([^)]*\{[^}]*\}/g)].map((m) => m[0]);
  assert.equal(appels.length, 3, `3 formatages attendus dans ce fichier, trouvé ${appels.length}`);
  for (const appel of appels) {
    assert.ok(appel.includes("timeZone: FUSEAU_AFFICHAGE"), `formatage sans fuseau explicite :\n${appel}`);
  }
  assert.match(GABARITS_SOURCE, /const FUSEAU_AFFICHAGE = "Europe\/Paris"/);
});

/* ══════════════════════ 5. Contre-épreuves ══════════════════════ */

await test("CONTRE-F1 formatage SANS timeZone : FUSEAU-01 repasse au rouge", () => {
  /*
   * ⚠️ CONTRE-ÉPREUVE DU DÉFAUT RÉEL. On reconstitue l'expression d'avant le
   * correctif — `toLocaleTimeString("fr-FR", { hour, minute })` sans fuseau —
   * et on prouve qu'en UTC elle rend 07:30, donc que FUSEAU-01 la détecte.
   */
  const d = new Date(DEBUT_HIVER);
  const fautif = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  assert.equal(fautif, "07:30", "sous UTC, l'expression d'avant rend bien l'heure UTC");
  assert.throws(() => assert.equal(fautif, "08:30"), "FUSEAU-01 doit échouer sur l'expression non fuseautée");

  // Et la version corrigée, au même instant, rend l'heure de Paris.
  const correct = d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
  assert.equal(correct, "08:30");
});

await test("CONTRE-F2 formatage de date SANS timeZone : FUSEAU-03 repasse au rouge", () => {
  const d = new Date(DEBUT_MINUIT);
  const fautif = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  assert.match(fautif, /lundi 23 novembre/, "sous UTC, l'expression d'avant annonce la veille");
  assert.throws(() => assert.match(fautif, /mardi 24 novembre/), "FUSEAU-03 doit échouer sur l'expression non fuseautée");

  const correct = d.toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  assert.match(correct, /mardi 24 novembre/);
});

/* ══════════ 6. Les gabarits en date seule (DATE-*) ══════════ */

await test("DATE-01 `formatDateFr` suit le même fuseau : pas de jour décalé", () => {
  /*
   * `formatDateFr` sert aux e-mails en date seule (fin d'accès à un
   * abonnement, début de programme, achat). Le risque y est plus étroit — un
   * basculement de jour sur une valeur proche de minuit — mais la cause est
   * la même, et le correctif aussi.
   */
  const corps = composeSubscriptionCancelledEmail({
    firstName: "Thomas",
    accessEndDate: DEBUT_MINUIT, // 00:30 le 24 à Paris
    profileUrl: "https://exemple.invalid/profil",
  });
  const tout = `${corps.subject}\n${corps.text}\n${corps.html}`;
  assert.ok(tout.includes("24 novembre"), "la date doit être celle du fuseau de Paris");
  assert.ok(!tout.includes("23 novembre"), "la veille ne doit pas apparaître");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
