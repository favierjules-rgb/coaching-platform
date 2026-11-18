/**
 * Harnais — LOT 3 : cycle de vie REQUEST/CANCEL des invitations calendrier.
 *
 * Ce que ce fichier prouve, et comment :
 *
 *  1. `buildConfirmationIcs`, `buildCancellationIcs` et le module d'intitulés
 *     du lot 2 sont importés POUR DE VRAI. Les fichiers .ics inspectés sont
 *     ceux que le code de production émet.
 *  2. Un mini-moteur reproduit la COMPOSITION de
 *     `app/api/email/appointment-notification/route.ts` : quel fichier, pour
 *     qui, avec quel UID et quelles dates, selon l'état du rendez-vous en
 *     base. Chaque étape du cycle de vie y est jouée.
 *  3. Des assertions de TEXTE ancrent ce moteur à la vraie route : si la route
 *     cesse de relire l'original, recalcule un UID, ou inverse l'ordre des
 *     pièces jointes, elles rougissent.
 *  4. Les deux corrections RFC 5545 sont vérifiées sur la SORTIE : aucun
 *     `METHOD` dans un `VEVENT`, et toutes les lignes pliées à 75 octets sans
 *     jamais couper une séquence UTF-8.
 *  5. Chaque famille a sa CONTRE-ÉPREUVE, dont les deux demandées
 *     explicitement : ancien UID remplacé par le nouveau, et annulation
 *     disparue.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. Aucune base n'est touchée et aucun
 * email n'est envoyé. Qu'Apple Calendar et Google Calendar retirent
 * effectivement l'ancien événement relève de la recette, boîte en main — le
 * moteur ci-dessous est une reproduction de la route, pas la route.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/ics-cycle-de-vie.mts
 */
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCancellationIcs, buildConfirmationIcs, type IcsAppointmentInput, typeMimeIcs } from "../../lib/ics";
import {
  construireIntituleIcs,
  type DestinataireIcs,
  formaterIdentiteCoach,
  formaterIdentiteEleve,
} from "../../lib/ics-intitules";

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

/** ⚠️ Les assertions d'absence portent sur le CODE, jamais sur la prose : la
 * route et lib/ics.ts expliquent en commentaire les défauts qu'ils
 * suppriment (« METHOD:CANCEL », « 75 caractères », « getPrimaryCoachInfo »). */
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
function sansCommentairesSql(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const ROUTE = lire("../../app/api/email/appointment-notification/route.ts");
const ROUTE_CODE = sansCommentairesTs(ROUTE);
const RECOMPOSE = lire("../../lib/email/recompose.ts");
const RECOMPOSE_CODE = sansCommentairesTs(RECOMPOSE);
const ICS = lire("../../lib/ics.ts");
const ICS_CODE = sansCommentairesTs(ICS);
const APPOINTMENTS_CODE = sansCommentairesTs(lire("../../lib/supabase/appointments.ts"));
const EMAILS_CODE = sansCommentairesTs(lire("../../lib/email/appointment-emails.ts"));

/* ═════════════════════ Mini-moteur : la composition de la route ═════════════════════ */

interface RendezVous {
  id: string;
  icsUid: string;
  description: string;
  startAt: string;
  endAt: string;
  location: string;
  meetingUrl: string;
  status: "confirmed" | "pending" | "cancelled";
  rescheduledFromId: string | null;
  coachId: string | null;
  /** ⚠️ Sert de `DTSTAMP` : la route le lit sur la ligne, pas sur l'horloge. */
  updatedAt: string;
}

interface Piece {
  filename: string;
  content: string;
  contentType: string;
}

const ELEVE = { prenom: "Thomas", nom: "Martin", email: "eleve@example.test" };
const COACHS: Record<string, { name: string; email: string }> = {
  "coach-A": { name: "Jules Favier", email: "jules@example.test" },
  "coach-B": { name: "Sophie Bernard", email: "sophie@example.test" },
};
const DTSTAMP = "2026-11-17T08:00:00.000Z";

interface Envoi {
  etape: "annulation_ancien" | "evenement_courant";
  role: "student" | "coach";
  emailType: "appointment_created" | "appointment_cancelled";
  relatedEntityId: string;
  recipientEmail: string;
  idempotencyKey: string;
  piece: Piece;
}

/**
 * Reproduit la LISTE D'ENVOIS de la route, dans son ordre d'émission.
 *
 * ⚠️ UN ENVOI = UN E-MAIL = UNE PIÈCE JOINTE (arbitrage du 17/11/2026). Un
 * report produit donc quatre e-mails : annulation à l'élève, annulation au
 * coach qui POSSÉDAIT l'ancien créneau, puis invitation à l'élève et au coach
 * actuel. Les annulations passent toutes avant les invitations.
 *
 * ⚠️ L'ÉTAT EN BASE DÉCIDE DE TOUT, pas l'appelant. Ce moteur ne reçoit NI
 * rôle, NI `actorType`, NI titre venu du navigateur — exactement comme la
 * route, qui ne reçoit que `{ appointmentId }` et relit tout. C'est ce qui
 * rend l'annulation identique quel que soit celui qui l'a déclenchée.
 */
function envoisPrevus(base: { rendezVous: RendezVous; original?: RendezVous | null }): Envoi[] {
  const { rendezVous } = base;
  const isCancelled = rendezVous.status === "cancelled";
  const isReschedule = !isCancelled && !!rendezVous.rescheduledFromId;
  const original = isReschedule ? (base.original ?? null) : null;
  const emailType: Envoi["emailType"] = isCancelled ? "appointment_cancelled" : "appointment_created";

  const identiteEleve = formaterIdentiteEleve(ELEVE.prenom, ELEVE.nom);
  const coachCourant = rendezVous.coachId ? COACHS[rendezVous.coachId] : undefined;
  const coachAncien = original?.coachId ? COACHS[original.coachId] : undefined;
  const identiteCoach = formaterIdentiteCoach(coachCourant?.name ?? "");
  const identiteCoachAncien = formaterIdentiteCoach(coachAncien?.name ?? "");

  /** L'élève, plus le coach qui POSSÈDE l'événement concerné. */
  function destinatairesPour(coach?: { name: string; email: string }) {
    const liste: { role: Envoi["role"]; cle: DestinataireIcs; email: string }[] = [
      { role: "student", cle: "eleve", email: ELEVE.email },
    ];
    if (coach) liste.push({ role: "coach", cle: "coach", email: coach.email });
    return liste;
  }

  const entree = (rdv: RendezVous, titre: string, nomCoach: string, emailCoach: string): IcsAppointmentInput => ({
    uid: rdv.icsUid,
    title: titre,
    description: rdv.description,
    startAt: rdv.startAt,
    endAt: rdv.endAt,
    location: rdv.location,
    meetingUrl: rdv.meetingUrl,
    organizerName: nomCoach,
    organizerEmail: emailCoach,
    attendeeName: ELEVE.prenom,
    attendeeEmail: ELEVE.email,
    dtstamp: rdv.updatedAt,
  });

  const envois: Envoi[] = [];

  if (original) {
    for (const d of destinatairesPour(coachAncien)) {
      envois.push({
        etape: "annulation_ancien",
        role: d.role,
        emailType: "appointment_cancelled",
        relatedEntityId: original.id,
        recipientEmail: d.email,
        idempotencyKey: `appointment-cancelled/${original.id}/${d.role}`,
        piece: ((): Piece => {
          const contenu = buildCancellationIcs(
            entree(
              original,
              construireIntituleIcs({ destinataire: d.cle, identiteEleve, identiteCoach: identiteCoachAncien }),
              identiteCoachAncien,
              coachAncien?.email ?? "",
            ),
          );
          // ⚠️ Comme la route : le type MIME est dérivé du contenu.
          return { filename: "annulation-ancien-rendez-vous.ics", content: contenu, contentType: typeMimeIcs(contenu) };
        })(),
      });
    }
  }

  for (const d of destinatairesPour(coachCourant)) {
    const courante = entree(
      rendezVous,
      construireIntituleIcs({ destinataire: d.cle, identiteEleve, identiteCoach }),
      identiteCoach,
      coachCourant?.email ?? "",
    );
    envois.push({
      etape: "evenement_courant",
      role: d.role,
      emailType,
      relatedEntityId: rendezVous.id,
      recipientEmail: d.email,
      idempotencyKey: `${emailType}/${rendezVous.id}/${d.role}`,
      piece: ((): Piece => {
        const contenu = isCancelled ? buildCancellationIcs(courante) : buildConfirmationIcs(courante);
        return { filename: "rendez-vous.ics", content: contenu, contentType: typeMimeIcs(contenu) };
      })(),
    });
  }

  return envois;
}

/**
 * Vue par rôle, pour les cas qui n'inspectent que le CONTENU des fichiers.
 *
 * ⚠️ REGROUPE PAR RÔLE, PAS PAR PERSONNE. En cas de réaffectation, `coach`
 * mélange l'annulation envoyée à l'ANCIEN coach et l'invitation envoyée au
 * NOUVEAU : les cas qui portent sur les destinataires travaillent sur
 * `envoisPrevus`, jamais sur cette vue.
 */
function composer(base: { rendezVous: RendezVous; original?: RendezVous | null }): { eleve: Piece[]; coach: Piece[] } {
  const envois = envoisPrevus(base);
  return {
    eleve: envois.filter((e) => e.role === "student").map((e) => e.piece),
    coach: envois.filter((e) => e.role === "coach").map((e) => e.piece),
  };
}

/* ═════════════════════════ Outils d'inspection ═════════════════════════ */

const ENCODEUR = new TextEncoder();

function lignes(ics: string): string[] {
  return ics.split("\r\n");
}

function champ(ics: string, nom: string): string {
  const trouve = deplie(ics).find((l) => l.startsWith(`${nom}:`) || l.startsWith(`${nom};`));
  assert.ok(trouve !== undefined, `propriété ${nom} absente`);
  return trouve;
}

/** "Unfolding" de RFC 5545 : CRLF suivi d'une espace disparaît. */
function deplie(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n");
}

function sommaire(ics: string): string {
  return champ(ics, "SUMMARY").slice("SUMMARY:".length);
}

function uid(ics: string): string {
  return champ(ics, "UID").slice("UID:".length);
}

/** Le bloc VEVENT, lignes dépliées. */
function corpsVevent(ics: string): string[] {
  const l = deplie(ics);
  const debut = l.indexOf("BEGIN:VEVENT");
  const fin = l.indexOf("END:VEVENT");
  assert.ok(debut >= 0 && fin > debut, "VEVENT introuvable");
  return l.slice(debut, fin + 1);
}

/** Substituts orphelins = une paire UTF-16 coupée en deux. */
const SUBSTITUT_ORPHELIN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/* ══════════════════════ Jeux de données du cycle de vie ══════════════════════ */

const RDV_INITIAL: RendezVous = {
  id: "rdv-1",
  updatedAt: "2026-11-17T08:00:00.000Z",
  icsUid: "uid-initial-0001@seth-coaching",
  description: "Séance de 60 minutes.",
  startAt: "2026-11-20T09:00:00.000Z",
  endAt: "2026-11-20T10:00:00.000Z",
  location: "Salle Nord, Lyon",
  meetingUrl: "https://visio.example.test/abc",
  status: "confirmed",
  rescheduledFromId: null,
  coachId: "coach-A",
};

const RDV_REPORTE: RendezVous = {
  ...RDV_INITIAL,
  id: "rdv-2",
  updatedAt: "2026-11-17T09:00:00.000Z",
  icsUid: "uid-report-0002@seth-coaching",
  startAt: "2026-11-24T14:00:00.000Z",
  endAt: "2026-11-24T15:00:00.000Z",
  rescheduledFromId: "rdv-1",
};

/** L'original, tel que `reschedule_appointment_atomic` l'a laissé : annulé, `updated_at` rafraîchi. */
const ORIGINAL_ANNULE: RendezVous = { ...RDV_INITIAL, status: "cancelled", updatedAt: "2026-11-17T09:00:00.000Z" };

/* ═════════════════════════ A. Cycle de vie ═════════════════════════ */

await test("CYCLE-01 création initiale : un seul événement, REQUEST / CONFIRMED / SEQUENCE:0", () => {
  const { eleve, coach } = composer({ rendezVous: RDV_INITIAL });
  assert.equal(eleve.length, 1, "un seul fichier pour l'élève");
  assert.equal(coach.length, 1, "un seul fichier pour le coach");
  for (const p of [eleve[0], coach[0]]) {
    assert.equal(p.filename, "rendez-vous.ics");
    assert.ok(p.content.includes("METHOD:REQUEST"));
    assert.ok(!p.content.includes("METHOD:CANCEL"));
    assert.equal(champ(p.content, "STATUS"), "STATUS:CONFIRMED");
    assert.equal(champ(p.content, "SEQUENCE"), "SEQUENCE:0");
    assert.equal(uid(p.content), RDV_INITIAL.icsUid);
  }
});

await test("CYCLE-02 report : CANCEL sur l'ANCIEN uid, REQUEST sur le NOUVEAU", () => {
  const { eleve, coach } = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  for (const [qui, pieces] of [["élève", eleve], ["coach", coach]] as const) {
    assert.equal(pieces.length, 2, `${qui} doit recevoir deux fichiers`);
    const [annulation, invitation] = pieces;
    assert.equal(annulation.filename, "annulation-ancien-rendez-vous.ics");
    assert.equal(invitation.filename, "rendez-vous.ics");
    // L'ANCIEN uid, strictement celui de l'événement initial.
    assert.equal(uid(annulation.content), RDV_INITIAL.icsUid, `${qui} : l'annulation doit porter l'ancien UID`);
    assert.ok(annulation.content.includes("METHOD:CANCEL"));
    assert.equal(champ(annulation.content, "STATUS"), "STATUS:CANCELLED");
    // Le NOUVEL uid, et lui seul, dans l'invitation.
    assert.equal(uid(invitation.content), RDV_REPORTE.icsUid, `${qui} : l'invitation doit porter le nouvel UID`);
    assert.ok(invitation.content.includes("METHOD:REQUEST"));
    assert.equal(champ(invitation.content, "STATUS"), "STATUS:CONFIRMED");
    // Et surtout : aucun croisement.
    assert.ok(!annulation.content.includes(RDV_REPORTE.icsUid), `${qui} : le nouvel UID n'a rien à faire dans l'annulation`);
    assert.ok(!invitation.content.includes(RDV_INITIAL.icsUid), `${qui} : l'ancien UID n'a rien à faire dans l'invitation`);
  }
});

await test("CYCLE-03 annulation classique : CANCEL sur le bon UID, un seul fichier", () => {
  const { eleve, coach } = composer({ rendezVous: ORIGINAL_ANNULE });
  for (const pieces of [eleve, coach]) {
    assert.equal(pieces.length, 1);
    assert.equal(uid(pieces[0].content), RDV_INITIAL.icsUid);
    assert.ok(pieces[0].content.includes("METHOD:CANCEL"));
    assert.equal(champ(pieces[0].content, "STATUS"), "STATUS:CANCELLED");
    assert.equal(champ(pieces[0].content, "SEQUENCE"), "SEQUENCE:1");
  }
});

await test("CYCLE-04 annulation par l'élève, le coach ou l'administrateur : fichier identique", () => {
  /*
   * ⚠️ RIEN DU RÔLE N'ENTRE DANS L'ICS, et c'est la démonstration. Les trois
   * parcours appellent `cancelAppointment` puis la même route avec le seul
   * `appointmentId` ; l'état relu en base est le même, donc le fichier aussi.
   * `actorType` ne sert qu'au journal d'activité (assertion TEXTE-11).
   */
  const resultats = ["student", "coach", "admin"].map(() => composer({ rendezVous: ORIGINAL_ANNULE }));
  for (const r of resultats.slice(1)) {
    assert.equal(r.eleve[0].content, resultats[0].eleve[0].content, "le fichier élève ne doit pas dépendre du rôle");
    assert.equal(r.coach[0].content, resultats[0].coach[0].content, "le fichier coach ne doit pas dépendre du rôle");
  }
  assert.equal(uid(resultats[0].eleve[0].content), RDV_INITIAL.icsUid);
});

await test("CYCLE-05 même ancien UID pour le coach et pour l'élève", () => {
  const { eleve, coach } = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  assert.equal(uid(eleve[0].content), uid(coach[0].content), "l'annulation doit porter le même UID des deux côtés");
  assert.equal(uid(eleve[1].content), uid(coach[1].content), "l'invitation aussi");
  assert.equal(uid(eleve[0].content), RDV_INITIAL.icsUid);
});

await test("CYCLE-06 deux SUMMARY distincts, dans l'annulation ET dans l'invitation", () => {
  const { eleve, coach } = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  assert.equal(sommaire(coach[0].content), "Coaching — Thomas MARTIN");
  assert.equal(sommaire(eleve[0].content), "Séance de coaching — Jules FAVIER");
  assert.equal(sommaire(coach[1].content), "Coaching — Thomas MARTIN");
  assert.equal(sommaire(eleve[1].content), "Séance de coaching — Jules FAVIER");
  assert.notEqual(sommaire(coach[0].content), sommaire(eleve[0].content));
  assert.ok(!sommaire(coach[0].content).includes("FAVIER"), "l'agenda du coach ne porte pas son propre nom");
  assert.ok(!sommaire(eleve[0].content).includes("MARTIN"), "l'agenda de l'élève ne porte pas son propre nom");
});

await test("CYCLE-07 le CANCEL conserve les ANCIENNES dates", () => {
  const { eleve } = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  assert.equal(champ(eleve[0].content, "DTSTART"), "DTSTART:20261120T090000Z");
  assert.equal(champ(eleve[0].content, "DTEND"), "DTEND:20261120T100000Z");
});

await test("CYCLE-08 le REQUEST porte les NOUVELLES dates", () => {
  const { eleve } = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  assert.equal(champ(eleve[1].content, "DTSTART"), "DTSTART:20261124T140000Z");
  assert.equal(champ(eleve[1].content, "DTEND"), "DTEND:20261124T150000Z");
});

await test("CYCLE-09 SEQUENCE cohérente : 0 à l'invitation, 1 à l'annulation", () => {
  const { eleve } = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  assert.equal(champ(eleve[0].content, "SEQUENCE"), "SEQUENCE:1", "l'annulation révise l'événement : séquence supérieure");
  assert.equal(champ(eleve[1].content, "SEQUENCE"), "SEQUENCE:0", "le nouvel événement part de zéro");
});

await test("CYCLE-10 report répété : trois UID, chaque ancien annulé une seule fois", () => {
  const troisieme: RendezVous = {
    ...RDV_INITIAL,
    id: "rdv-3",
    icsUid: "uid-report-0003@seth-coaching",
    startAt: "2026-11-27T09:00:00.000Z",
    endAt: "2026-11-27T10:00:00.000Z",
    rescheduledFromId: "rdv-2",
  };
  const premier = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  const second = composer({ rendezVous: troisieme, original: { ...RDV_REPORTE, status: "cancelled" } });

  const annules = [uid(premier.eleve[0].content), uid(second.eleve[0].content)];
  const invites = [uid(premier.eleve[1].content), uid(second.eleve[1].content)];
  assert.deepEqual(annules, [RDV_INITIAL.icsUid, RDV_REPORTE.icsUid], "chaque report annule SON prédécesseur");
  assert.deepEqual(invites, [RDV_REPORTE.icsUid, troisieme.icsUid]);
  assert.equal(new Set([...annules, ...invites]).size, 3, "trois UID distincts au total");
  // Aucun UID à la fois annulé et invité DANS LE MÊME envoi.
  for (const envoi of [premier, second]) {
    assert.notEqual(uid(envoi.eleve[0].content), uid(envoi.eleve[1].content));
  }
  // Nouvelle tentative de notification du même état : contenu identique,
  // donc aucun doublon d'événement côté client (même UID, même SEQUENCE).
  const rejeu = composer({ rendezVous: troisieme, original: { ...RDV_REPORTE, status: "cancelled" } });
  assert.deepEqual(rejeu.eleve.map((p) => p.content), second.eleve.map((p) => p.content));
  assert.deepEqual(rejeu.coach.map((p) => p.content), second.coach.map((p) => p.content));
});

await test("CYCLE-11 report dont l'original est introuvable : une seule pièce jointe", () => {
  const { eleve, coach } = composer({ rendezVous: RDV_REPORTE, original: null });
  assert.equal(eleve.length, 1, "l'invitation part quand même");
  assert.equal(coach.length, 1);
  assert.equal(uid(eleve[0].content), RDV_REPORTE.icsUid);
  // Et la route le signale (TEXTE-06).
});

await test("CYCLE-12 l'annulation précède l'invitation dans l'ordre des pièces jointes", () => {
  const { eleve, coach } = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  for (const pieces of [eleve, coach]) {
    assert.ok(pieces[0].content.includes("METHOD:CANCEL"), "la première pièce jointe doit être l'annulation");
    assert.ok(pieces[1].content.includes("METHOD:REQUEST"), "la seconde doit être l'invitation");
    assert.notEqual(pieces[0].filename, pieces[1].filename, "deux noms de fichiers distincts");
  }
});

await test("CYCLE-13 un report avec réaffectation de coach garde l'ANCIEN coach dans l'annulation", () => {
  // Cas limite : l'original appartenait à Coach A, le report à Coach B.
  const reporteChezB: RendezVous = { ...RDV_REPORTE, coachId: "coach-B" };
  const { eleve } = composer({ rendezVous: reporteChezB, original: ORIGINAL_ANNULE });
  assert.equal(sommaire(eleve[0].content), "Séance de coaching — Jules FAVIER", "l'annulation garde l'ancien coach");
  assert.equal(sommaire(eleve[1].content), "Séance de coaching — Sophie BERNARD", "l'invitation porte le nouveau");
});

/* ═════════════════════════ B. Conformité RFC 5545 ═════════════════════════ */

const TOUS_LES_FICHIERS: string[] = [
  ...composer({ rendezVous: RDV_INITIAL }).eleve.map((p) => p.content),
  ...composer({ rendezVous: ORIGINAL_ANNULE }).coach.map((p) => p.content),
  ...composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE }).eleve.map((p) => p.content),
  ...composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE }).coach.map((p) => p.content),
];

await test("RFC-01 défaut A : aucun METHOD à l'intérieur d'un VEVENT", () => {
  for (const fichier of TOUS_LES_FICHIERS) {
    const dedans = corpsVevent(fichier).filter((l) => l.startsWith("METHOD"));
    assert.deepEqual(dedans, [], `METHOD ne doit pas figurer dans le VEVENT : ${dedans.join(" | ")}`);
  }
});

await test("RFC-02 METHOD exactement une fois, dans VCALENDAR, avant le VEVENT", () => {
  for (const fichier of TOUS_LES_FICHIERS) {
    const l = deplie(fichier);
    const positions = l.map((ligne, i) => ({ ligne, i })).filter(({ ligne }) => ligne.startsWith("METHOD:"));
    assert.equal(positions.length, 1, `un seul METHOD attendu, or ${positions.length}`);
    assert.ok(positions[0].i < l.indexOf("BEGIN:VEVENT"), "METHOD doit précéder BEGIN:VEVENT");
    assert.ok(positions[0].i > l.indexOf("BEGIN:VCALENDAR"), "METHOD doit être dans le composant calendrier");
    assert.match(positions[0].ligne, /^METHOD:(REQUEST|CANCEL)$/);
  }
});

await test("RFC-03 défaut B : toutes les lignes tiennent en 75 octets après pliage", () => {
  const longue = "Séance de préparation physique — bilan complet des charges, mobilité, "
    + "gainage et récupération, à confirmer avec l'élève ; durée estimée 1 h 30. 🏋️‍♀️ Côte d'Azur, œufs, naïveté.";
  const avecTexteLong: RendezVous = { ...RDV_INITIAL, description: longue, location: longue };
  const fichiers = [
    ...composer({ rendezVous: avecTexteLong }).eleve.map((p) => p.content),
    ...composer({ rendezVous: { ...avecTexteLong, status: "cancelled" } }).coach.map((p) => p.content),
  ];
  let pliees = 0;
  for (const fichier of fichiers) {
    for (const ligne of lignes(fichier)) {
      const taille = ENCODEUR.encode(ligne).length;
      assert.ok(taille <= 75, `ligne de ${taille} octets (> 75) : ${JSON.stringify(ligne.slice(0, 40))}…`);
      if (ligne.startsWith(" ")) pliees += 1;
    }
  }
  assert.ok(pliees > 0, "le jeu de données doit réellement provoquer des pliages");
});

await test("RFC-04 aucun caractère UTF-8 coupé, et le dépliage restitue le texte à l'identique", () => {
  const accents = "Noël à Besançon : évaluation de la mobilité, échauffement spécifique, étirements — "
    + "préparation « hors saison », œdème, 🤸 emoji multioctet, caractères français àâäçéèêëîïôöùûü.";
  const avec: RendezVous = { ...RDV_INITIAL, description: accents };
  const fichier = composer({ rendezVous: avec }).eleve[0].content;

  // 1. Aucun substitut orphelin : une paire UTF-16 n'a pas été tranchée.
  for (const ligne of lignes(fichier)) {
    assert.ok(!SUBSTITUT_ORPHELIN.test(ligne), `séquence UTF-8 coupée dans : ${JSON.stringify(ligne)}`);
  }
  // 2. Chaque ligne survit à un aller-retour d'encodage strict.
  const decodeur = new TextDecoder("utf-8", { fatal: true });
  for (const ligne of lignes(fichier)) {
    assert.equal(decodeur.decode(ENCODEUR.encode(ligne)), ligne, "ligne non décodable en UTF-8 strict");
  }
  // 3. Le "unfolding" rend EXACTEMENT le texte d'origine (échappements compris).
  const attendu = `DESCRIPTION:${accents.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")}`;
  assert.equal(champ(fichier, "DESCRIPTION"), attendu, "le dépliage doit restituer la description à l'identique");
  // 4. Le format de continuation est bien CRLF + une espace.
  assert.match(fichier, /\r\n /, "les lignes de continuation doivent commencer par CRLF puis une espace");
});

await test("RFC-05 une ligne exactement à 75 octets n'est pas pliée", () => {
  // 75 octets pile : « SUMMARY: » (8) + 67 caractères ASCII.
  const titre = "x".repeat(67);
  const ics = buildConfirmationIcs({
    uid: "u", title: titre, description: "", startAt: RDV_INITIAL.startAt, endAt: RDV_INITIAL.endAt,
    location: "", meetingUrl: "", organizerName: "", organizerEmail: "", attendeeName: "", attendeeEmail: "",
    dtstamp: DTSTAMP,
  });
  const ligne = lignes(ics).find((l) => l.startsWith("SUMMARY:"));
  assert.ok(ligne !== undefined);
  assert.equal(ENCODEUR.encode(ligne).length, 75, "le cas limite doit bien peser 75 octets");
  assert.ok(!ics.includes(`${ligne}\r\n `), "une ligne de 75 octets ne doit pas être pliée");
});

/* ═════════════════ C. Ancrage à la vraie route et à lib/ics.ts ═════════════════ */

await test("TEXTE-01 la route relit l'original par `rescheduled_from_id`", () => {
  assert.match(
    ROUTE_CODE,
    /isReschedule && appointment\.rescheduledFromId\s*\n?\s*\?\s*await getAppointmentById\(adminSupabase, appointment\.rescheduledFromId\)/,
    "l'original doit être relu en base, au service role",
  );
});

/**
 * Le bloc de l'envoi d'annulation dans la route.
 *
 * ⚠️ LA BORNE DE FIN EST SA CLÉ D'IDEMPOTENCE, PAS L'ÉTAPE SUIVANTE. Découper
 * jusqu'à `etape: "evenement_courant"` engloberait tout le préambule de
 * l'étape 2 (`entreeCourante`, `corpsCourant`), donc des `appointment.startAt`
 * parfaitement légitimes — et l'assertion « jamais les nouvelles dates dans
 * l'annulation » rougissait à tort.
 */
const BLOC_ANNULATION = (() => {
  const debut = ROUTE_CODE.indexOf('etape: "annulation_ancien"');
  const fin = ROUTE_CODE.indexOf("idempotencyKey: `appointment-cancelled/", debut);
  if (debut < 0 || fin < 0) return "";
  return ROUTE_CODE.slice(debut, fin);
})();

await test("TEXTE-02 l'UID de l'annulation vient de l'original, jamais recalculé", () => {
  assert.ok(BLOC_ANNULATION.length > 200, "le bloc d'annulation doit être isolable");
  assert.match(BLOC_ANNULATION, /uid: original\.icsUid/, "l'annulation doit porter l'UID lu sur l'original");
  assert.ok(!BLOC_ANNULATION.includes("randomUUID"), "aucun UID fabriqué dans la composition");
  assert.ok(!ROUTE_CODE.includes("crypto.randomUUID"), "la route ne génère aucun UID");
});

await test("TEXTE-03 les dates de l'annulation viennent de l'original", () => {
  assert.match(BLOC_ANNULATION, /startAt: original\.startAt/, "anciennes dates dans l'annulation");
  assert.match(BLOC_ANNULATION, /endAt: original\.endAt/);
  assert.ok(!BLOC_ANNULATION.includes("startAt: appointment.startAt"), "jamais les nouvelles dates dans l'annulation");
  assert.match(BLOC_ANNULATION, /dtstamp: original\.updatedAt/, "DTSTAMP déterministe, lu sur la ligne");
});

await test("TEXTE-04 l'annulation est empilée AVANT l'invitation, et les envois sont séquentiels", () => {
  const posAnnulation = ROUTE_CODE.indexOf('etape: "annulation_ancien"');
  const posCourant = ROUTE_CODE.indexOf('etape: "evenement_courant"');
  assert.ok(posAnnulation > 0 && posCourant > posAnnulation, "l'annulation doit être empilée en premier");
  /*
   * ⚠️ « AVANT » EXIGE UNE BOUCLE SÉQUENTIELLE. Un `Promise.all` enverrait les
   * quatre e-mails en même temps : l'ordre ne serait plus garanti, et un échec
   * de l'annulation ne retiendrait plus rien.
   */
  assert.match(ROUTE_CODE, /for \(const envoi of envois\) \{/, "boucle d'envoi séquentielle");
  assert.match(ROUTE_CODE, /await sendTransactionalEmail\(adminSupabase, \{/);
  assert.ok(!/Promise\.all\([^)]*envois/.test(ROUTE_CODE), "jamais d'envoi en parallèle");
});

await test("TEXTE-05 un envoi = un e-mail = UNE seule pièce jointe", () => {
  /*
   * ⚠️ EXIGENCE REMPLACÉE SUR DÉCISION (17/11/2026), pas abandonnée. Le lot 2
   * demandait deux TABLEAUX de pièces jointes, un par destinataire ; le lot
   * 3-bis demande un e-mail par événement et par destinataire, chacun avec un
   * seul .ics — deux parties `text/calendar` dans un même message étant
   * traitées de façon imprévisible par les clients. Ce qui reste vérifié est
   * le fond : jamais un fichier partagé entre deux destinataires.
   */
  assert.match(ROUTE_CODE, /attachments: \[envoi\.piece\]/, "une seule pièce jointe par envoi");
  assert.ok(!/const attachments = \[/.test(ROUTE_CODE), "aucun tableau partagé");
  assert.ok(!ROUTE_CODE.includes("piecesJointesEleve"), "la forme à deux tableaux a été remplacée");
  assert.ok(!ROUTE_CODE.includes("piecesJointesCoach"));
  // Chaque envoi porte SON destinataire et SON intitulé.
  assert.match(ROUTE_CODE, /recipientEmail: destinataire\.email/);
  assert.match(ROUTE_CODE, /destinataire: destinataire\.cle/);
});

await test("TEXTE-06 un original introuvable est signalé, l'invitation part quand même", () => {
  assert.match(ROUTE_CODE, /if \(isReschedule && !original\) \{[\s\S]{0,400}console\.error\(/);
  assert.match(ROUTE, /L'ancien événement ne peut pas/, "l'avertissement doit nommer la conséquence");
  assert.match(ROUTE_CODE, /reportAnnulationAncien: original \? "envoi_distinct" : "ancien_rendez_vous_introuvable"/);
  /*
   * L'absence d'original ne coupe aucun envoi : le bloc d'avertissement
   * lui-même ne contient aucun `return`.
   *
   * ⚠️ L'ASSERTION PORTE SUR CE BLOC, PAS SUR L'INTERVALLE. Tester « aucun
   * `return NextResponse` entre l'avertissement et la construction des envois »
   * attrapait d'autres sorties légitimes, sans rapport avec un original
   * manquant.
   */
  const debutBloc = ROUTE_CODE.indexOf("if (isReschedule && !original)");
  assert.ok(debutBloc > 0, "le bloc d'avertissement doit exister");
  const resteBloc = ROUTE_CODE.slice(debutBloc);
  const finBloc = resteBloc.indexOf("\n  }");
  assert.ok(finBloc > 0, "le bloc doit être refermé");
  const bloc = resteBloc.slice(0, finBloc);
  assert.ok(!/\breturn\b/.test(bloc), "un original manquant ne doit pas interrompre la notification");
  assert.match(bloc, /console\.error\(/, "il doit se limiter à journaliser");
});

await test("TEXTE-07 le renvoi administratif joint un seul .ics, et sait annuler l'ancien seul", () => {
  /*
   * ⚠️ EXIGENCE DÉPLACÉE, PAS SUPPRIMÉE. Une version intermédiaire du lot 3
   * faisait rejouer l'annulation DANS l'e-mail du report. Ce n'est plus
   * nécessaire : l'annulation de l'ancien a désormais sa propre ligne
   * `email_logs` (`appointment_cancelled` sur l'ANCIEN `appointment.id`), donc
   * le bouton « Renvoyer » la reconstruit toute seule par le chemin
   * `isCancelled` — `relatedEntityId` pointe sur l'original, dont le statut
   * est `cancelled` et dont `ics_uid` n'a jamais été réécrit.
   */
  const corps = RECOMPOSE_CODE.slice(RECOMPOSE_CODE.indexOf("const attachments ="));
  const bloc = corps.slice(0, corps.indexOf("if (isCancelled)"));
  /*
   * ⚠️ ANCRE DÉPLACÉE AU LOT 4 : la construction du contenu est sortie du
   * littéral pour que le type MIME puisse en être dérivé
   * (`typeMimeIcs(contenuIcs)`). L'exigence est la même — un seul fichier,
   * annulation ou confirmation selon l'entité journalisée.
   */
  assert.match(
    RECOMPOSE_CODE,
    /const contenuIcs = isCancelled \? buildCancellationIcs\(icsInput\) : buildConfirmationIcs\(icsInput\)/,
  );
  assert.match(bloc, /content: contenuIcs/);
  assert.match(bloc, /contentType: typeMimeIcs\(contenuIcs\)/, "le type MIME doit être dérivé du contenu");
  assert.ok(!bloc.includes("annulation-ancien-rendez-vous.ics"), "un renvoi ne joint qu'un seul fichier");
  /*
   * ⚠️ ON INTERDIT LA RELECTURE DE L'ORIGINAL, PAS LE MOT `rescheduledFromId` :
   * celui-ci sert aussi, et depuis toujours, à choisir le libellé « reporté »
   * du corps de l'email. Chercher le mot brut rendait l'assertion fausse.
   */
  assert.ok(
    !/getAppointmentById\(supabase, appointment\.rescheduledFromId\)/.test(RECOMPOSE_CODE),
    "le renvoi ne doit plus relire l'original pour y joindre son annulation",
  );
  assert.match(RECOMPOSE_CODE, /isReschedule: !!appointment\.rescheduledFromId/,
    "mais le libellé « reporté » doit rester piloté par ce champ");
  // Le titre du renvoi suit toujours le rôle journalisé (acquis du lot 2).
  assert.match(RECOMPOSE_CODE, /destinataire: isCoachRecipient \? "coach" : "eleve"/);
  assert.match(RECOMPOSE_CODE, /uid: appointment\.icsUid/, "et l'UID reste celui de l'entité journalisée");
});

await test("TEXTE-08 lib/ics.ts : METHOD a disparu du VEVENT, et son paramètre avec", () => {
  assert.ok(!/METHOD:CANCEL" : null/.test(ICS_CODE), "la ligne fautive doit avoir disparu");
  assert.match(
    ICS_CODE,
    /function buildEvent\(input: IcsAppointmentInput, status: "CONFIRMED" \| "CANCELLED"\)/,
    "le paramètre `method` ne sert plus à rien : il doit être retiré",
  );
  /*
   * ⚠️ COMPTAGE RECIBLÉ AU LOT 4 : les deux enveloppes ont été factorisées en
   * une seule fonction `envelopper(methode, …)`, et `methodeDeclaree` LIT des
   * littéraux « METHOD: » sans en émettre. Compter les chaînes attraperait ces
   * lectures. On compte donc le seul site d'ÉMISSION, et on vérifie qu'il est
   * hors du VEVENT.
   */
  const emissions = (ICS_CODE.match(/`METHOD:\$\{methode\}`/g) ?? []).length;
  assert.equal(emissions, 1, `un seul site d'émission de METHOD, or ${emissions}`);
  const corpsBuildEvent = ICS_CODE.slice(
    ICS_CODE.indexOf("function buildEvent("),
    ICS_CODE.indexOf("function envelopper("),
  );
  assert.ok(corpsBuildEvent.length > 200, "le corps de buildEvent doit être isolable");
  assert.ok(!corpsBuildEvent.includes("METHOD"), "aucun METHOD produit dans le VEVENT");
  assert.match(ICS_CODE, /function envelopper\(methode: MethodeIcs, evenement: string\)/);
});

await test("TEXTE-09 lib/ics.ts : le pliage se mesure en octets, pas en caractères", () => {
  assert.ok(!/line\.length <= 75/.test(ICS_CODE), "la mesure en caractères doit avoir disparu");
  assert.match(ICS_CODE, /const LIMITE_OCTETS_PAR_LIGNE = 75/);
  assert.match(ICS_CODE, /new TextEncoder\(\)/, "TextEncoder, pas Buffer : ce module part aussi dans le navigateur");
  assert.ok(!ICS_CODE.includes("Buffer"), "Buffer n'existe pas dans le navigateur sans polyfill");
  assert.match(ICS_CODE, /for \(const caractere of line\)/, "itération par point de code, pas par unité UTF-16");
  assert.ok(!/rest\.slice\(0, 75\)/.test(ICS_CODE), "plus de découpe sur des unités UTF-16");
});

await test("TEXTE-10 non-régression lot 2 : aucun coach principal nulle part", () => {
  assert.ok(!ROUTE_CODE.includes("getPrimaryCoachInfo"));
  assert.ok(!RECOMPOSE_CODE.includes("getPrimaryCoachInfo"));
  assert.match(ROUTE_CODE, /getCoachProprietaireRendezVous\(adminSupabase, appointment\.coachId\)/);
  assert.match(ROUTE_CODE, /getCoachProprietaireRendezVous\(adminSupabase, original\.coachId\)/);
});

await test("TEXTE-11 le navigateur n'envoie que `appointmentId` ; `actorType` ne sert qu'au journal", () => {
  assert.match(EMAILS_CODE, /body: JSON\.stringify\(\{ appointmentId \}\)/);
  // `actorType` n'apparaît que dans les appels de journalisation.
  const corpsAnnulation = APPOINTMENTS_CODE.slice(
    APPOINTMENTS_CODE.indexOf("export async function cancelAppointment"),
    APPOINTMENTS_CODE.indexOf("export async function rescheduleAppointment"),
  );
  assert.match(corpsAnnulation, /actorType,/, "actorType alimente le journal d'activité");
  assert.ok(!corpsAnnulation.includes("buildCancellationIcs"), "aucun .ics construit côté navigateur ici");
  assert.ok(!corpsAnnulation.includes("ics_uid:"), "l'annulation ne réécrit jamais l'UID");
});

await test("TEXTE-12 `isCancelled` et `isReschedule` dérivent de la base, pas de la requête", () => {
  assert.match(ROUTE_CODE, /const isCancelled = appointment\.status === "cancelled"/);
  assert.match(ROUTE_CODE, /const isReschedule = !isCancelled && !!appointment\.rescheduledFromId/);
  // Le corps de requête ne porte qu'un identifiant.
  assert.match(ROUTE_CODE, /const \{ appointmentId \} = parsed\.data/);
});

await test("TEXTE-13 le report ne fabrique qu'UN nouvel UID, côté création", () => {
  const corps = APPOINTMENTS_CODE.slice(
    APPOINTMENTS_CODE.indexOf("export async function rescheduleAppointment"),
  ).slice(0, 2000);
  assert.equal((corps.match(/crypto\.randomUUID/g) ?? []).length, 1, "un seul UID fabriqué, pour le NOUVEAU rendez-vous");
  assert.match(corps, /p_ics_uid: icsUid/, "il part à la RPC comme UID du nouveau rendez-vous");
  assert.ok(!corps.includes("ics_uid: appointment.icsUid"), "l'ancien UID n'est jamais réécrit");
});

await test("TEXTE-14 l'UID d'un rendez-vous est stable : aucune annulation ne le réécrit", () => {
  /*
   * ⚠️ C'EST CE QUI REND L'ANNULATION POSSIBLE. Si `ics_uid` était réécrit au
   * moment de l'annulation, l'ancien événement deviendrait inatteignable dans
   * les calendriers. Mesuré sur le SQL : les deux `update` qui passent un
   * rendez-vous en `cancelled` ne touchent que `status`,
   * `cancellation_reason` et `updated_at`.
   */
  const sqlCancel = sansCommentairesSql(lire("../../supabase/migrations/20261022090000_espace_coach_isole_agenda_documents_emails.sql"));
  for (const nom of ["cancel_appointment_atomic", "reschedule_appointment_atomic"]) {
    const debut = sqlCancel.indexOf(`create or replace function public.${nom}`);
    assert.ok(debut > 0, `${nom} doit exister dans la migration`);
    const corps = sqlCancel.slice(debut, sqlCancel.indexOf("$$;", debut));
    const misesAJour = corps.split("update public.appointments").slice(1);
    assert.ok(misesAJour.length > 0, `${nom} doit annuler une ligne`);
    for (const maj of misesAJour) {
      const clause = maj.slice(0, maj.indexOf("where"));
      assert.ok(!clause.includes("ics_uid"), `${nom} ne doit jamais réécrire ics_uid à l'annulation`);
    }
  }
  // Et côté TypeScript : un `ics_uid` vide retombe sur l'identifiant de ligne,
  // qui ne change jamais — jamais sur une valeur fraîche.
  assert.match(APPOINTMENTS_CODE, /icsUid: row\.ics_uid \|\| row\.id/, "repli stable, pas un UID fabriqué");
  const corpsAnnulation = APPOINTMENTS_CODE.slice(
    APPOINTMENTS_CODE.indexOf("export async function cancelAppointment"),
    APPOINTMENTS_CODE.indexOf("export async function rescheduleAppointment"),
  );
  assert.ok(!corpsAnnulation.includes("randomUUID"), "aucun UID fabriqué sur le chemin d'annulation");
});

await test("TEXTE-15 un seul chemin d'annulation en base, quel que soit le rôle", () => {
  /*
   * Élève, coach et administrateur passent tous par `cancelAppointment`, qui
   * appelle `cancel_appointment_atomic` — l'autorisation est tranchée dans la
   * RPC et par la RLS, pas par le rôle déclaré côté navigateur. D'où CYCLE-04 :
   * le fichier produit ne peut pas dépendre de qui annule.
   */
  const pageEleve = sansCommentairesTs(lire("../../app/(student)/rendez-vous/page.tsx"));
  const pageAdmin = sansCommentairesTs(lire("../../app/admin/calendrier/page.tsx"));
  assert.match(pageEleve, /cancelAppointment\(supabase, appointment\.id, reason, appointment\.studentId, "student"\)/);
  assert.match(pageAdmin, /cancelAppointment\(supabase, appointment\.id, reason, appointment\.studentId, "coach"\)/);
  for (const page of [pageEleve, pageAdmin]) {
    assert.ok(!page.includes("buildCancellationIcs"), "aucun .ics d'annulation construit dans le navigateur");
    assert.ok(!page.includes("ics_uid"), "le navigateur ne touche jamais à l'UID");
  }
  /*
   * Un seul APPEL de la RPC d'annulation. ⚠️ On compte les sites d'appel
   * (`.rpc("…")`), pas les occurrences du nom : la seconde est le libellé
   * d'une erreur (« cancel_appointment_atomic : rendez-vous introuvable »), et
   * la compter rendrait l'assertion fausse sans qu'aucun chemin n'ait été
   * ajouté.
   */
  assert.equal(
    (APPOINTMENTS_CODE.match(/\.rpc\("cancel_appointment_atomic"/g) ?? []).length,
    1,
    "un seul point d'entrée pour l'annulation",
  );
  assert.equal(
    (APPOINTMENTS_CODE.match(/export async function cancelAppointment/g) ?? []).length,
    1,
    "une seule fonction d'annulation exportée",
  );
});

/* ═══════ D. Deux envois distincts : garde-fou, idempotence, rejeu ═══════ */

interface LigneJournal {
  emailType: string;
  relatedEntityType: string;
  relatedEntityId: string;
  recipientEmail: string;
  status: "sent" | "failed";
  idempotencyKey: string;
  creeA: number;
}

/**
 * Journal d'envoi simulé.
 *
 * ⚠️ REPRODUIT `wasEmailRecentlySent` TEL QU'IL EST ÉCRIT : seules les lignes
 * `status = 'sent'` comptent, la fenêtre est de 30 s, et le filtre porte sur
 * (`email_type`, `related_entity_type`, `related_entity_id`,
 * `recipient_email`). Ces quatre colonnes sont celles de la requête réelle —
 * vérifiées par TEXTE-16 sur le code de lib/email/send-transactional-email.ts.
 */
class JournalSimule {
  lignes: LigneJournal[] = [];
  instant = 1_000_000;

  recemmentEnvoye(p: { emailType: string; relatedEntityId: string; recipientEmail?: string }): boolean {
    const depuis = this.instant - 30_000;
    return this.lignes.some(
      (l) =>
        l.emailType === p.emailType &&
        l.relatedEntityType === "appointment" &&
        l.relatedEntityId === p.relatedEntityId &&
        (p.recipientEmail === undefined || l.recipientEmail === p.recipientEmail) &&
        l.status === "sent" &&
        l.creeA >= depuis,
    );
  }
}

interface Resultat {
  etape: Envoi["etape"];
  role: Envoi["role"];
  destinataire: string;
  status: "sent" | "failed" | "skipped";
  raison?: string;
}

/**
 * Reproduit la boucle d'envoi de la route : séquentielle, garde-fou avant
 * chaque envoi, et aucun arrêt sur échec.
 */
function notifier(
  journal: JournalSimule,
  envois: Envoi[],
  options: { echoue?: (envoi: Envoi) => boolean; ignorerDestinataire?: boolean } = {},
): Resultat[] {
  const resultats: Resultat[] = [];
  for (const envoi of envois) {
    const deja = journal.recemmentEnvoye({
      emailType: envoi.emailType,
      relatedEntityId: envoi.relatedEntityId,
      recipientEmail: options.ignorerDestinataire ? undefined : envoi.recipientEmail,
    });
    if (deja) {
      resultats.push({ etape: envoi.etape, role: envoi.role, destinataire: envoi.recipientEmail, status: "skipped", raison: "already_sent_recently" });
      continue;
    }
    const echec = options.echoue?.(envoi) ?? false;
    journal.lignes.push({
      emailType: envoi.emailType,
      relatedEntityType: "appointment",
      relatedEntityId: envoi.relatedEntityId,
      recipientEmail: envoi.recipientEmail,
      status: echec ? "failed" : "sent",
      idempotencyKey: envoi.idempotencyKey,
      creeA: journal.instant,
    });
    resultats.push({ etape: envoi.etape, role: envoi.role, destinataire: envoi.recipientEmail, status: echec ? "failed" : "sent" });
  }
  return resultats;
}

const REPORT = { rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE };

await test("ENVOI-01 report : quatre e-mails, annulations d'abord, un seul .ics chacun", () => {
  const envois = envoisPrevus(REPORT);
  assert.equal(envois.length, 4, "élève et coach, deux événements chacun");
  assert.deepEqual(
    envois.map((e) => `${e.etape}/${e.role}`),
    ["annulation_ancien/student", "annulation_ancien/coach", "evenement_courant/student", "evenement_courant/coach"],
    "toutes les annulations avant toutes les invitations",
  );
  for (const e of envois) {
    assert.equal(typeof e.piece.content, "string");
    // ⚠️ Le type MIME porte `method`, aligné sur le METHOD du fichier (lot 4).
    assert.equal(
      e.piece.contentType,
      e.etape === "annulation_ancien"
        ? "text/calendar; charset=utf-8; method=CANCEL"
        : "text/calendar; charset=utf-8; method=REQUEST",
    );
  }
  // Un .ics par e-mail : chaque contenu porte exactement un VEVENT.
  for (const e of envois) {
    assert.equal((e.piece.content.match(/BEGIN:VEVENT/g) ?? []).length, 1);
    assert.equal((e.piece.content.match(/BEGIN:VCALENDAR/g) ?? []).length, 1);
  }
});

await test("ENVOI-02 les clés du garde-fou diffèrent : le second envoi ne peut pas être bloqué", () => {
  const envois = envoisPrevus(REPORT);
  const annulations = envois.filter((e) => e.etape === "annulation_ancien");
  const invitations = envois.filter((e) => e.etape === "evenement_courant");
  for (const a of annulations) {
    assert.equal(a.emailType, "appointment_cancelled");
    assert.equal(a.relatedEntityId, RDV_INITIAL.id, "l'annulation est journalisée sur l'ANCIEN rendez-vous");
  }
  for (const i of invitations) {
    assert.equal(i.emailType, "appointment_created");
    assert.equal(i.relatedEntityId, RDV_REPORTE.id, "l'invitation sur le nouveau");
  }
  // Donc aucun couple (type, entité, destinataire) n'est partagé.
  const cles = envois.map((e) => `${e.emailType}|${e.relatedEntityId}|${e.recipientEmail}`);
  assert.equal(new Set(cles).size, 4, "quatre clés de garde-fou distinctes");
});

await test("ENVOI-03 clés d'idempotence : distinctes par destinataire, stables entre deux constructions", () => {
  const cles = envoisPrevus(REPORT).map((e) => e.idempotencyKey);
  assert.deepEqual(cles, [
    "appointment-cancelled/rdv-1/student",
    "appointment-cancelled/rdv-1/coach",
    "appointment_created/rdv-2/student",
    "appointment_created/rdv-2/coach",
  ]);
  assert.equal(new Set(cles).size, 4, "une clé par e-mail");
  // Stables : une seconde construction rend exactement les mêmes clés ET les
  // mêmes charges utiles — condition pour qu'un retry ne soit pas refusé.
  const rejeu = envoisPrevus(REPORT);
  assert.deepEqual(rejeu.map((e) => e.idempotencyKey), cles);
  assert.deepEqual(rejeu.map((e) => e.piece.content), envoisPrevus(REPORT).map((e) => e.piece.content));
});

await test("ENVOI-04 échec du PREMIER envoi : les suivants partent quand même", () => {
  const journal = new JournalSimule();
  const resultats = notifier(journal, envoisPrevus(REPORT), {
    echoue: (e) => e.etape === "annulation_ancien" && e.role === "student",
  });
  assert.deepEqual(resultats.map((r) => r.status), ["failed", "sent", "sent", "sent"]);
  // Et la tentative suivante reprend EXACTEMENT ce qui manque.
  const seconde = notifier(journal, envoisPrevus(REPORT));
  assert.deepEqual(seconde.map((r) => r.status), ["sent", "skipped", "skipped", "skipped"]);
  assert.equal(journal.lignes.filter((l) => l.status === "sent").length, 4, "quatre envois réussis au total");
});

await test("ENVOI-05 succès du premier, échec du second : retry immédiat du second seul", () => {
  const journal = new JournalSimule();
  const premier = notifier(journal, envoisPrevus(REPORT), {
    echoue: (e) => e.etape === "evenement_courant",
  });
  assert.deepEqual(premier.map((r) => r.status), ["sent", "sent", "failed", "failed"]);
  // ⚠️ Le garde-fou ne compte que les lignes `sent` : les deux invitations
  // échouées ne sont pas bloquées, et les annulations déjà parties ne sont
  // pas rejouées.
  const retry = notifier(journal, envoisPrevus(REPORT));
  assert.deepEqual(retry.map((r) => r.status), ["skipped", "skipped", "sent", "sent"]);
  assert.deepEqual(
    retry.filter((r) => r.status === "skipped").map((r) => r.etape),
    ["annulation_ancien", "annulation_ancien"],
    "l'annulation déjà envoyée n'est pas perdue, elle est simplement sautée",
  );
});

await test("ENVOI-06 nouvelle tentative des DEUX notifications réussies : tout est sauté", () => {
  const journal = new JournalSimule();
  notifier(journal, envoisPrevus(REPORT));
  const avant = journal.lignes.length;
  const rejeu = notifier(journal, envoisPrevus(REPORT));
  assert.deepEqual(rejeu.map((r) => r.status), ["skipped", "skipped", "skipped", "skipped"]);
  assert.equal(journal.lignes.length, avant, "aucune ligne ajoutée au journal");
});

await test("ENVOI-07 même destinataire pour les deux événements : deux e-mails, aucun doublon", () => {
  const journal = new JournalSimule();
  const envois = envoisPrevus(REPORT);
  const duCoach = envois.filter((e) => e.role === "coach");
  assert.equal(duCoach.length, 2, "le même coach reçoit l'annulation ET l'invitation");
  assert.equal(duCoach[0].recipientEmail, duCoach[1].recipientEmail, "même adresse");
  assert.notEqual(duCoach[0].idempotencyKey, duCoach[1].idempotencyKey, "mais deux clés distinctes");
  assert.notEqual(uid(duCoach[0].piece.content), uid(duCoach[1].piece.content), "et deux UID distincts");
  notifier(journal, envois);
  const lignesCoach = journal.lignes.filter((l) => l.recipientEmail === COACHS["coach-A"].email);
  assert.equal(lignesCoach.length, 2, "deux lignes de journal, pas une ni trois");
  assert.equal(new Set(lignesCoach.map((l) => l.idempotencyKey)).size, 2);
});

await test("ENVOI-08 changement de coach au report : annulation à l'ANCIEN, invitation au NOUVEAU", () => {
  const reporteChezB: RendezVous = { ...RDV_REPORTE, coachId: "coach-B" };
  const envois = envoisPrevus({ rendezVous: reporteChezB, original: ORIGINAL_ANNULE });
  const annulationCoach = envois.find((e) => e.etape === "annulation_ancien" && e.role === "coach");
  const invitationCoach = envois.find((e) => e.etape === "evenement_courant" && e.role === "coach");
  assert.ok(annulationCoach && invitationCoach);
  assert.equal(annulationCoach.recipientEmail, COACHS["coach-A"].email, "l'ancien coach reçoit l'annulation");
  assert.equal(invitationCoach.recipientEmail, COACHS["coach-B"].email, "le nouveau reçoit l'invitation");
  // Et chacun ne reçoit QUE la sienne.
  const pourA = envois.filter((e) => e.recipientEmail === COACHS["coach-A"].email);
  const pourB = envois.filter((e) => e.recipientEmail === COACHS["coach-B"].email);
  assert.deepEqual(pourA.map((e) => e.etape), ["annulation_ancien"], "l'ancien coach n'est pas invité au nouveau créneau");
  assert.deepEqual(pourB.map((e) => e.etape), ["evenement_courant"], "le nouveau coach ne reçoit pas une annulation qu'il n'a jamais eue");
  // L'intitulé de l'annulation reste celui de l'ANCIEN coach côté élève.
  const annulationEleve = envois.find((e) => e.etape === "annulation_ancien" && e.role === "student");
  const invitationEleve = envois.find((e) => e.etape === "evenement_courant" && e.role === "student");
  assert.ok(annulationEleve && invitationEleve);
  assert.equal(sommaire(annulationEleve.piece.content), "Séance de coaching — Jules FAVIER");
  assert.equal(sommaire(invitationEleve.piece.content), "Séance de coaching — Sophie BERNARD");
  assert.equal(uid(annulationEleve.piece.content), RDV_INITIAL.icsUid, "ancien UID, anciennes dates");
  assert.equal(champ(annulationEleve.piece.content, "DTSTART"), "DTSTART:20261120T090000Z");
});

await test("ENVOI-09 journal : une seule ligne envoyée par (étape, destinataire)", () => {
  const journal = new JournalSimule();
  notifier(journal, envoisPrevus(REPORT));
  notifier(journal, envoisPrevus(REPORT));
  notifier(journal, envoisPrevus(REPORT));
  const envoyees = journal.lignes.filter((l) => l.status === "sent");
  assert.equal(envoyees.length, 4, "trois notifications, quatre e-mails en tout");
  assert.equal(new Set(envoyees.map((l) => l.idempotencyKey)).size, 4, "aucune clé en double");
});

await test("ENVOI-10 au-delà de 30 s, le rejeu repart — sans dupliquer d'événement", () => {
  const journal = new JournalSimule();
  notifier(journal, envoisPrevus(REPORT));
  journal.instant += 31_000;
  const tardif = notifier(journal, envoisPrevus(REPORT));
  assert.deepEqual(tardif.map((r) => r.status), ["sent", "sent", "sent", "sent"], "la fenêtre du garde-fou est passée");
  /*
   * ⚠️ RÉENVOYER N'EST PAS DUPLIQUER. Les clés d'idempotence sont inchangées,
   * donc le fournisseur reconnaît les mêmes messages ; et au niveau du
   * calendrier, un même UID avec la même SEQUENCE et le même STATUS est une
   * mise à jour, pas un second événement.
   */
  const premiers = envoisPrevus(REPORT);
  const seconds = envoisPrevus(REPORT);
  assert.deepEqual(seconds.map((e) => e.idempotencyKey), premiers.map((e) => e.idempotencyKey));
  for (let i = 0; i < premiers.length; i += 1) {
    assert.equal(seconds[i].piece.content, premiers[i].piece.content, "charge utile identique d'une tentative à l'autre");
    assert.equal(champ(seconds[i].piece.content, "SEQUENCE"), champ(premiers[i].piece.content, "SEQUENCE"));
    assert.equal(uid(seconds[i].piece.content), uid(premiers[i].piece.content));
  }
});

await test("TEXTE-16 le garde-fou filtre bien les quatre colonnes, et seulement `sent`", () => {
  const envoi = sansCommentairesTs(lire("../../lib/email/send-transactional-email.ts"));
  const corps = envoi.slice(envoi.indexOf("export async function wasEmailRecentlySent"));
  const bloc = corps.slice(0, corps.indexOf("return !!data"));
  for (const colonne of [
    '.eq("email_type", params.emailType)',
    '.eq("related_entity_type", params.relatedEntityType)',
    '.eq("related_entity_id", params.relatedEntityId)',
    '.eq("status", "sent")',
  ]) {
    assert.ok(bloc.includes(colonne), `le garde-fou doit filtrer sur ${colonne}`);
  }
  assert.match(bloc, /if \(params\.recipientEmail\) requete = requete\.eq\("recipient_email", params\.recipientEmail\)/,
    "le filtre destinataire doit être appliqué quand il est fourni");
  assert.match(bloc, /\.gte\("created_at", since\)/, "fenêtre temporelle conservée");
  // ⚠️ Le paramètre reste FACULTATIF : les autres appelants ne changent pas.
  assert.match(corps, /recipientEmail\?: string;/, "facultatif, pour ne casser aucun appelant existant");
  // Et la route le renseigne, elle.
  assert.match(ROUTE_CODE, /recipientEmail: envoi\.recipientEmail,/);
});

await test("TEXTE-17 la route pose une clé d'idempotence stable, dérivée de l'entité et du rôle", () => {
  assert.match(ROUTE_CODE, /idempotencyKey: `appointment-cancelled\/\$\{original\.id\}\/\$\{destinataire\.role\}`/);
  assert.match(ROUTE_CODE, /idempotencyKey: `\$\{emailType\}\/\$\{appointment\.id\}\/\$\{destinataire\.role\}`/);
  assert.match(ROUTE_CODE, /idempotencyKey: envoi\.idempotencyKey/, "et la transmet à l'envoi");
  /*
   * ⚠️ UNE CLÉ STABLE EXIGE UNE CHARGE UTILE STABLE : le `DTSTAMP` est lu sur
   * `updated_at`, jamais sur l'horloge, sinon deux tentatives présenteraient
   * la même clé avec deux contenus différents.
   */
  assert.match(ROUTE_CODE, /dtstamp: original\.updatedAt/);
  assert.match(ROUTE_CODE, /dtstamp: appointment\.updatedAt/);
  assert.ok(!/dtstamp: new Date\(\)/.test(ROUTE_CODE), "aucun DTSTAMP tiré de l'horloge");
  assert.ok(!ROUTE_CODE.includes("dtstampPartage"), "la variable d'horloge du lot 3 a disparu");
});

/* ═════════════════════════ E. Contre-épreuves ═════════════════════════ */

await test("CONTRE-01 ancien UID remplacé par le nouveau : CYCLE-02 passe au rouge", () => {
  const { eleve } = composer({ rendezVous: RDV_REPORTE, original: { ...ORIGINAL_ANNULE, icsUid: RDV_REPORTE.icsUid } });
  assert.equal(uid(eleve[0].content), RDV_REPORTE.icsUid, "la mutation doit s'appliquer");
  assert.throws(
    () => assert.equal(uid(eleve[0].content), RDV_INITIAL.icsUid),
    "l'assertion sur l'ancien UID doit échouer",
  );
  assert.throws(
    () => assert.notEqual(uid(eleve[0].content), uid(eleve[1].content)),
    "et l'absence de croisement aussi",
  );
});

await test("CONTRE-02 annulation disparue : CYCLE-02 passe au rouge", () => {
  // Le défaut d'origine : un report ne produit qu'une invitation.
  const fautif = composer({ rendezVous: { ...RDV_REPORTE, rescheduledFromId: null }, original: ORIGINAL_ANNULE });
  assert.equal(fautif.eleve.length, 1, "la mutation doit supprimer l'annulation");
  assert.throws(() => assert.equal(fautif.eleve.length, 2), "CYCLE-02 doit échouer");
  assert.ok(!fautif.eleve[0].content.includes("METHOD:CANCEL"));
  assert.ok(!fautif.eleve[0].content.includes(RDV_INITIAL.icsUid), "l'ancien événement n'est plus annulé du tout");
});

await test("CONTRE-03 anciennes dates écrasées par les nouvelles : CYCLE-07 passe au rouge", () => {
  const fautif = composer({
    rendezVous: RDV_REPORTE,
    original: { ...ORIGINAL_ANNULE, startAt: RDV_REPORTE.startAt, endAt: RDV_REPORTE.endAt },
  });
  assert.throws(
    () => assert.equal(champ(fautif.eleve[0].content, "DTSTART"), "DTSTART:20261120T090000Z"),
    "CYCLE-07 doit échouer si l'annulation porte les nouvelles dates",
  );
});

await test("CONTRE-04 METHOD réintroduit dans le VEVENT : RFC-01 et RFC-02 passent au rouge", () => {
  const sain = composer({ rendezVous: ORIGINAL_ANNULE }).eleve[0].content;
  const fautif = sain.replace("STATUS:CANCELLED", "STATUS:CANCELLED\r\nMETHOD:CANCEL");
  assert.notEqual(fautif, sain, "la mutation doit s'appliquer");
  const dedans = deplie(fautif)
    .slice(deplie(fautif).indexOf("BEGIN:VEVENT"), deplie(fautif).indexOf("END:VEVENT"))
    .filter((l) => l.startsWith("METHOD"));
  assert.throws(() => assert.deepEqual(dedans, []), "RFC-01 doit échouer");
  assert.throws(
    () => assert.equal(deplie(fautif).filter((l) => l.startsWith("METHOD:")).length, 1),
    "RFC-02 doit échouer",
  );
});

await test("CONTRE-05 pliage à 75 CARACTÈRES : RFC-03 et RFC-04 passent au rouge", () => {
  /** L'implémentation d'avant le lot 3, reproduite telle quelle. */
  function foldLineFautif(line: string): string {
    if (line.length <= 75) return line;
    const parts: string[] = [];
    let rest = line;
    while (rest.length > 75) {
      parts.push(rest.slice(0, 75));
      rest = " " + rest.slice(75);
    }
    parts.push(rest);
    return parts.join("\r\n");
  }
  // (a) dépassement de la limite d'octets sur du texte accentué.
  const accentue = "SUMMARY:" + "é".repeat(80);
  const plieFautif = foldLineFautif(accentue);
  const tropLongues = plieFautif.split("\r\n").filter((l) => ENCODEUR.encode(l).length > 75);
  assert.ok(tropLongues.length > 0, "l'ancienne implémentation doit produire des lignes hors limite");
  assert.throws(
    () => { for (const l of plieFautif.split("\r\n")) assert.ok(ENCODEUR.encode(l).length <= 75); },
    "RFC-03 doit échouer sur l'ancienne implémentation",
  );
  // (b) paire de substituts tranchée.
  const avecEmoji = "DESCRIPTION:" + "a".repeat(62) + "🤸" + "b".repeat(20);
  const plieEmoji = foldLineFautif(avecEmoji);
  assert.ok(
    plieEmoji.split("\r\n").some((l) => SUBSTITUT_ORPHELIN.test(l)),
    "l'ancienne implémentation doit couper l'emoji en deux",
  );
  assert.throws(
    () => { for (const l of plieEmoji.split("\r\n")) assert.ok(!SUBSTITUT_ORPHELIN.test(l)); },
    "RFC-04 doit échouer sur l'ancienne implémentation",
  );
  // Et la nouvelle, sur les mêmes entrées, tient les deux promesses.
  const sain = composer({
    rendezVous: { ...RDV_INITIAL, description: "a".repeat(62) + "🤸" + "b".repeat(20), location: "é".repeat(80) },
  }).eleve[0].content;
  for (const l of lignes(sain)) {
    assert.ok(ENCODEUR.encode(l).length <= 75, `ligne hors limite : ${l}`);
    assert.ok(!SUBSTITUT_ORPHELIN.test(l), `substitut orphelin : ${JSON.stringify(l)}`);
  }
});

await test("CONTRE-06 SEQUENCE non incrémentée à l'annulation : CYCLE-09 passe au rouge", () => {
  const sain = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE }).eleve[0].content;
  const fautif = sain.replace("SEQUENCE:1", "SEQUENCE:0");
  assert.throws(() => assert.equal(champ(fautif, "SEQUENCE"), "SEQUENCE:1"), "CYCLE-09 doit échouer");
});

await test("CONTRE-07 un SUMMARY unique pour les deux destinataires : CYCLE-06 passe au rouge", () => {
  const { eleve } = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  assert.throws(
    () => assert.equal(sommaire(eleve[0].content), "Coaching — Thomas MARTIN"),
    "l'intitulé de l'élève ne doit pas être celui du coach",
  );
});

await test("CONTRE-08 invitation placée avant l'annulation : CYCLE-12 passe au rouge", () => {
  const { eleve } = composer({ rendezVous: RDV_REPORTE, original: ORIGINAL_ANNULE });
  const inverse = [eleve[1], eleve[0]];
  assert.throws(
    () => assert.ok(inverse[0].content.includes("METHOD:CANCEL")),
    "CYCLE-12 doit échouer si l'invitation passe en premier",
  );
});

await test("CONTRE-09 garde-fou SANS le destinataire : l'envoi au coach est sauté à tort", () => {
  /*
   * Le défaut qu'évite le paramètre `recipientEmail` : les deux annulations
   * partagent (emailType, relatedEntityId), donc sans ce filtre la réussite
   * de l'envoi à l'élève masque celui du coach.
   */
  const journal = new JournalSimule();
  const resultats = notifier(journal, envoisPrevus(REPORT), { ignorerDestinataire: true });
  assert.deepEqual(
    resultats.map((r) => r.status),
    ["sent", "skipped", "sent", "skipped"],
    "sans filtre destinataire, le coach ne reçoit RIEN",
  );
  assert.equal(journal.lignes.filter((l) => l.recipientEmail === COACHS["coach-A"].email).length, 0);
  // Avec le filtre — c'est-à-dire la vraie route — les quatre partent.
  const correct = notifier(new JournalSimule(), envoisPrevus(REPORT));
  assert.deepEqual(correct.map((r) => r.status), ["sent", "sent", "sent", "sent"]);
  assert.throws(
    () => assert.deepEqual(resultats.map((r) => r.status), ["sent", "sent", "sent", "sent"]),
    "ENVOI-04 doit échouer sur la version sans filtre",
  );
});

await test("CONTRE-10 clé d'idempotence SANS le rôle : deux destinataires partagent la même", () => {
  const envois = envoisPrevus(REPORT);
  const clesFautives = envois.map((e) => e.idempotencyKey.replace(/\/(student|coach)$/, ""));
  assert.equal(new Set(clesFautives).size, 2, "la mutation doit fusionner les clés par étape");
  assert.throws(() => assert.equal(new Set(clesFautives).size, 4), "ENVOI-03 doit échouer");
  // Conséquence réelle : le fournisseur reconnaîtrait le second message comme
  // un doublon du premier, et le coach ne recevrait rien.
  assert.equal(clesFautives[0], clesFautives[1], "annulation élève et annulation coach confondues");
});

await test("CONTRE-11 DTSTAMP tiré de l'horloge : deux tentatives, deux charges utiles", () => {
  const entree = (dtstamp: string): string =>
    buildCancellationIcs({
      uid: RDV_INITIAL.icsUid, title: "Séance de coaching — Jules FAVIER", description: "",
      startAt: RDV_INITIAL.startAt, endAt: RDV_INITIAL.endAt, location: "", meetingUrl: "",
      organizerName: "Jules FAVIER", organizerEmail: "jules@example.test",
      attendeeName: "Thomas", attendeeEmail: ELEVE.email, dtstamp,
    });
  // Deux tentatives espacées d'une seconde, DTSTAMP tiré de l'horloge.
  const premier = entree("2026-11-17T09:00:00.000Z");
  const second = entree("2026-11-17T09:00:01.000Z");
  assert.notEqual(premier, second, "la même clé porterait deux contenus différents");
  assert.notEqual(champ(premier, "DTSTAMP"), champ(second, "DTSTAMP"));
  // Avec `updated_at`, les deux tentatives sont identiques au bit près.
  assert.equal(entree(ORIGINAL_ANNULE.updatedAt), entree(ORIGINAL_ANNULE.updatedAt));
  assert.throws(() => assert.equal(premier, second), "ENVOI-03 doit échouer sur un DTSTAMP d'horloge");
});

await test("CONTRE-12 annulation journalisée sur le NOUVEAU rendez-vous : l'invitation est bloquée", () => {
  /*
   * Démonstration que `relatedEntityId` doit être celui de l'ORIGINAL. S'il
   * pointait sur le nouveau rendez-vous, l'annulation et l'invitation
   * partageraient (entité, destinataire) ; seul `emailType` les
   * distinguerait encore — et si l'annulation était journalisée comme
   * `appointment_created`, le garde-fou avalerait l'invitation.
   */
  const fautifs: Envoi[] = envoisPrevus(REPORT).map((e) =>
    e.etape === "annulation_ancien"
      ? { ...e, relatedEntityId: RDV_REPORTE.id, emailType: "appointment_created" as const }
      : e,
  );
  const journal = new JournalSimule();
  const resultats = notifier(journal, fautifs);
  assert.deepEqual(
    resultats.map((r) => r.status),
    ["sent", "sent", "skipped", "skipped"],
    "les invitations sont avalées par l'annulation",
  );
  assert.deepEqual(
    resultats.filter((r) => r.status === "skipped").map((r) => r.etape),
    ["evenement_courant", "evenement_courant"],
    "personne ne reçoit le NOUVEAU créneau",
  );
  // La vraie route sépare les deux : les quatre partent.
  const correct = notifier(new JournalSimule(), envoisPrevus(REPORT));
  assert.deepEqual(correct.map((r) => r.status), ["sent", "sent", "sent", "sent"]);
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
