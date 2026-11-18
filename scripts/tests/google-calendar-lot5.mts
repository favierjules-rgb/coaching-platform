/**
 * Harnais — LOT 5 : compatibilité Google Calendar.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️ CE FICHIER NE VALIDE PAS GOOGLE CALENDAR. IL NE PEUT PAS.         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Trois catégories, à ne jamais confondre :
 *
 *  1. `GCONF-*` — CONFORMITÉ AUTOMATISÉE. Propriétés que Gmail et Google
 *     Calendar lisent réellement pour décider s'ils ont affaire à une
 *     invitation, et à laquelle : paramètre MIME `method`, `UID`, `SEQUENCE`,
 *     `ORGANIZER`, `ATTENDEE`, `DTSTAMP`, encodage, pliage, fuseaux.
 *
 *  2. `GSIM-*` — SIMULATION. Un modèle de client qui applique une règle
 *     SUPPLÉMENTAIRE par rapport au modèle Apple du lot 4 : il ne traite une
 *     invitation que si l'adresse du destinataire figure dans le fichier
 *     comme `ATTENDEE`. C'est le comportement documenté et observé de Gmail,
 *     et c'est là que Google et Apple divergent.
 *     ⚠️ C'EST UN MODÈLE, PAS GOOGLE.
 *
 *  3. `JOURNAL-*` / `CODE-*` — cohérence entre ce qui est envoyé, ce qui est
 *     écrit dans `email_logs`, et ce que le code de production fait vraiment.
 *
 * Les scénarios A à E du lot 5 exigent un essai RÉEL dans Gmail puis dans
 * Google Calendar. `docs/lot5-google-calendar/` porte la marche à suivre.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/google-calendar-lot5.mts
 */
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCancellationIcs,
  buildConfirmationIcs,
  type IcsAppointmentInput,
  methodeDeclaree,
  typeMimeIcs,
} from "../../lib/ics";
import { construireIntituleIcs, formaterIdentiteCoach, formaterIdentiteEleve } from "../../lib/ics-intitules";

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
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const ROUTE_CODE = sansCommentairesTs(lire("../../app/api/email/appointment-notification/route.ts"));
const ENVOI_CODE = sansCommentairesTs(lire("../../lib/email/send-transactional-email.ts"));
const RECOMPOSE_CODE = sansCommentairesTs(lire("../../lib/email/recompose.ts"));
const SDK_RESEND = lire("../../node_modules/resend/dist/index.mjs");

const ENCODEUR = new TextEncoder();

/* ═════════════════════════ Jeu de données ═════════════════════════ */

const ELEVE = { prenom: "Thomas", nom: "Martin", email: "eleve@exemple.invalid" };
const COACH_A = { name: "Jules Favier", email: "coach-a@exemple.invalid" };
const COACH_B = { name: "Sophie Bernard", email: "coach-b@exemple.invalid" };
const IDENTITE_ELEVE = formaterIdentiteEleve(ELEVE.prenom, ELEVE.nom);

const UID_INITIAL = "1f0c9e22-4a7b-4c21-9d3e-0a1b2c3d4e5f@seth-coaching";
const UID_REPORT = "9b7d4411-8e2c-4fa5-b6d7-112233445566@seth-coaching";

interface Creneau {
  id: string;
  uid: string;
  debut: string;
  fin: string;
  dtstamp: string;
}
const INITIAL: Creneau = {
  id: "rdv-1",
  uid: UID_INITIAL,
  debut: "2026-12-08T09:00:00.000Z",
  fin: "2026-12-08T10:00:00.000Z",
  dtstamp: "2026-11-17T08:00:00.000Z",
};
const REPORTE: Creneau = {
  id: "rdv-2",
  uid: UID_REPORT,
  debut: "2026-12-11T14:00:00.000Z",
  fin: "2026-12-11T15:30:00.000Z",
  dtstamp: "2026-11-17T09:00:00.000Z",
};

type Destinataire = "eleve" | "coach";

function entree(creneau: Creneau, destinataire: Destinataire, coach: { name: string; email: string }): IcsAppointmentInput {
  const identiteCoach = formaterIdentiteCoach(coach.name);
  return {
    uid: creneau.uid,
    title: construireIntituleIcs({ destinataire, identiteEleve: IDENTITE_ELEVE, identiteCoach }),
    description: "Séance de 60 minutes — préparation physique.",
    startAt: creneau.debut,
    endAt: creneau.fin,
    location: "Salle Nord, Lyon",
    meetingUrl: "",
    organizerName: identiteCoach,
    organizerEmail: coach.email,
    attendeeName: ELEVE.prenom,
    attendeeEmail: ELEVE.email,
    dtstamp: creneau.dtstamp,
  };
}

/** Un envoi tel que la route le produit : destinataire, journal et pièce jointe. */
interface Envoi {
  etape: "annulation_ancien" | "evenement_courant";
  role: "student" | "coach";
  recipientEmail: string;
  emailType: "appointment_created" | "appointment_cancelled";
  relatedEntityId: string;
  metadata: { role: string; etape: string };
  piece: { filename: string; content: string; contentType: string };
}

function envoi(
  etape: Envoi["etape"],
  role: Envoi["role"],
  recipientEmail: string,
  creneau: Creneau,
  coach: { name: string; email: string },
): Envoi {
  const destinataire: Destinataire = role === "coach" ? "coach" : "eleve";
  const annulation = etape === "annulation_ancien";
  const contenu = annulation
    ? buildCancellationIcs(entree(creneau, destinataire, coach))
    : buildConfirmationIcs(entree(creneau, destinataire, coach));
  return {
    etape,
    role,
    recipientEmail,
    emailType: annulation ? "appointment_cancelled" : "appointment_created",
    relatedEntityId: creneau.id,
    metadata: { role, etape },
    piece: {
      filename: annulation ? "annulation-ancien-rendez-vous.ics" : "rendez-vous.ics",
      content: contenu,
      contentType: typeMimeIcs(contenu),
    },
  };
}

/** Les quatre envois d'un report, dans l'ordre de la route. */
function envoisDuReport(coachAncien = COACH_A, coachNouveau = COACH_A): Envoi[] {
  return [
    envoi("annulation_ancien", "student", ELEVE.email, INITIAL, coachAncien),
    envoi("annulation_ancien", "coach", coachAncien.email, INITIAL, coachAncien),
    envoi("evenement_courant", "student", ELEVE.email, REPORTE, coachNouveau),
    envoi("evenement_courant", "coach", coachNouveau.email, REPORTE, coachNouveau),
  ];
}

/* ═════════════════════════ Outils d'inspection ═════════════════════════ */

function lignesPhysiques(ics: string): string[] {
  const brut = ics.split("\r\n");
  if (brut[brut.length - 1] === "") brut.pop();
  return brut;
}
function deplie(ics: string): string[] {
  return lignesPhysiques(ics.replace(/\r\n[ \t]/g, ""));
}
function champ(ics: string, nom: string): string {
  const trouve = deplie(ics).find((l) => l.startsWith(`${nom}:`) || l.startsWith(`${nom};`));
  assert.ok(trouve !== undefined, `propriété ${nom} absente`);
  return trouve;
}
function indexValeur(ligne: string): number {
  let cite = false;
  for (let i = 0; i < ligne.length; i += 1) {
    if (ligne[i] === '"') cite = !cite;
    else if (ligne[i] === ":" && !cite) return i;
  }
  return ligne.length;
}
function valeur(ics: string, nom: string): string {
  const ligne = champ(ics, nom);
  return ligne.slice(indexValeur(ligne) + 1);
}
function adresse(ics: string, propriete: "ORGANIZER" | "ATTENDEE"): string | null {
  const ligne = deplie(ics).find((l) => l.startsWith(`${propriete};`) || l.startsWith(`${propriete}:`));
  if (ligne === undefined) return null;
  const v = ligne.slice(indexValeur(ligne) + 1);
  return v.startsWith("mailto:") ? v.slice("mailto:".length).toLowerCase() : null;
}
function adressesAttendees(ics: string): string[] {
  return deplie(ics)
    .filter((l) => l.startsWith("ATTENDEE;") || l.startsWith("ATTENDEE:"))
    .map((l) => l.slice(indexValeur(l) + 1))
    .filter((v) => v.startsWith("mailto:"))
    .map((v) => v.slice("mailto:".length).toLowerCase());
}
function instant(ics: string, nom: string): number {
  const brut = valeur(ics, nom);
  const iso = `${brut.slice(0, 4)}-${brut.slice(4, 6)}-${brut.slice(6, 8)}T${brut.slice(9, 11)}:${brut.slice(11, 13)}:${brut.slice(13, 15)}Z`;
  return Date.parse(iso);
}
function heureLocale(ics: string, nom: string, zone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: zone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(
    new Date(instant(ics, nom)),
  );
}

/* ═══════════ 1. CONFORMITÉ AUTOMATISÉE, ORIENTÉE GOOGLE (GCONF-*) ═══════════ */

await test("GCONF-01 paramètre MIME `method` présent et aligné sur le METHOD du fichier", () => {
  /*
   * ⚠️ C'EST LE DÉCLENCHEUR CÔTÉ GMAIL, exactement comme côté Apple Mail.
   * Sans `method`, Gmail affiche au mieux un lien « Ajouter au calendrier » et
   * n'applique JAMAIS un CANCEL.
   */
  for (const e of envoisDuReport()) {
    const methodeFichier = methodeDeclaree(e.piece.content);
    assert.ok(methodeFichier !== null, "le fichier doit déclarer un METHOD");
    assert.ok(
      e.piece.contentType.endsWith(`method=${methodeFichier}`),
      `MIME « ${e.piece.contentType} » contre « METHOD:${methodeFichier} »`,
    );
    assert.match(e.piece.contentType, /^text\/calendar; charset=utf-8; method=(REQUEST|CANCEL)$/);
  }
});

await test("GCONF-02 le type MIME atteint réellement le fil : le SDK mappe contentType → content_type", () => {
  /*
   * ⚠️ VÉRIFICATION QUI MANQUAIT AU LOT 4. Notre couche d'envoi passe
   * `contentType` (camel) au SDK Resend ; si le SDK attendait `content_type`,
   * le correctif MIME du lot 4 serait silencieusement perdu et aucun test ne
   * l'aurait vu. Mesuré dans le SDK installé (resend ^6.17.2).
   */
  assert.match(ENVOI_CODE, /contentType: a\.contentType/, "notre couche transmet bien le champ");
  assert.match(SDK_RESEND, /function parseAttachments\(attachments\)/, "le SDK normalise les pièces jointes");
  assert.match(SDK_RESEND, /content_type: attachment\.contentType/, "et mappe camelCase vers snake_case");
});

await test("GCONF-03 UID stable, globalement unique, de forme adressable", () => {
  const invitationInitiale = buildConfirmationIcs(entree(INITIAL, "eleve", COACH_A));
  const annulationInitiale = buildCancellationIcs(entree(INITIAL, "eleve", COACH_A));
  assert.equal(valeur(annulationInitiale, "UID"), valeur(invitationInitiale, "UID"));
  // Google exige un identifiant unique au monde : la forme `uuid@domaine` le
  // garantit mieux qu'un entier ou un UUID nu.
  for (const ics of [invitationInitiale, buildConfirmationIcs(entree(REPORTE, "eleve", COACH_A))]) {
    assert.match(valeur(ics, "UID"), /^[0-9a-f-]{36}@[\w.-]+$/, "forme uuid@domaine");
  }
  assert.notEqual(valeur(invitationInitiale, "UID"), valeur(buildConfirmationIcs(entree(REPORTE, "eleve", COACH_A)), "UID"));
});

await test("GCONF-04 SEQUENCE : 0 à l'invitation, strictement supérieure à l'annulation", () => {
  const inv = buildConfirmationIcs(entree(INITIAL, "eleve", COACH_A));
  const ann = buildCancellationIcs(entree(INITIAL, "eleve", COACH_A));
  assert.equal(valeur(inv, "SEQUENCE"), "0");
  assert.equal(valeur(ann, "SEQUENCE"), "1");
  assert.ok(Number(valeur(ann, "SEQUENCE")) > Number(valeur(inv, "SEQUENCE")));
});

await test("GCONF-05 ORGANIZER IDENTIQUE entre une invitation et son annulation", () => {
  /*
   * ⚠️ GOOGLE APPARIE SUR (UID, ORGANIZER). Une annulation présentée avec un
   * autre organisateur que celui de l'invitation d'origine est traitée comme
   * venant d'un tiers, donc ignorée — l'ancien créneau resterait affiché.
   * Dans un report avec réaffectation, c'est l'ANCIEN coach qui doit figurer
   * dans l'annulation : c'est bien ce que fait la route.
   */
  const envois = envoisDuReport(COACH_A, COACH_B);
  const invInitiale = buildConfirmationIcs(entree(INITIAL, "eleve", COACH_A));
  const annulationEleve = envois[0].piece.content;
  assert.equal(adresse(annulationEleve, "ORGANIZER"), adresse(invInitiale, "ORGANIZER"));
  assert.equal(adresse(annulationEleve, "ORGANIZER"), COACH_A.email);
  // Et l'invitation du report porte bien le NOUVEAU coach.
  assert.equal(adresse(envois[2].piece.content, "ORGANIZER"), COACH_B.email);
});

await test("GCONF-06 ORGANIZER présent dans TOUTES les notifications d'un report", () => {
  for (const e of envoisDuReport(COACH_A, COACH_B)) {
    assert.ok(adresse(e.piece.content, "ORGANIZER") !== null, `${e.etape}/${e.role} sans ORGANIZER exploitable`);
  }
  // ⚠️ Sans adresse de coach, la ligne est OMISE (choix du lot 2) : Google ne
  // peut alors pas apparier l'événement. Risque documenté, non corrigé ici.
  const sans = buildConfirmationIcs({ ...entree(INITIAL, "eleve", COACH_A), organizerEmail: "" });
  assert.equal(adresse(sans, "ORGANIZER"), null);
});

await test("GCONF-07 ATTENDEE : RSVP, PARTSTAT et ROLE renseignés, adresse exploitable", () => {
  const inv = buildConfirmationIcs(entree(INITIAL, "eleve", COACH_A));
  const ligne = champ(inv, "ATTENDEE");
  for (const parametre of ["ROLE=REQ-PARTICIPANT", "PARTSTAT=NEEDS-ACTION", "RSVP=TRUE"]) {
    assert.ok(ligne.includes(parametre), `${parametre} manquant : ${ligne}`);
  }
  assert.deepEqual(adressesAttendees(inv), [ELEVE.email]);
});

await test("GCONF-08 DTSTAMP présent, en UTC, non antérieur à celui de l'invitation", () => {
  const inv = buildConfirmationIcs(entree(INITIAL, "eleve", COACH_A));
  const ann = buildCancellationIcs(entree({ ...INITIAL, dtstamp: REPORTE.dtstamp }, "eleve", COACH_A));
  for (const ics of [inv, ann]) assert.match(champ(ics, "DTSTAMP"), /^DTSTAMP:\d{8}T\d{6}Z$/);
  assert.ok(instant(ann, "DTSTAMP") >= instant(inv, "DTSTAMP"), "une annulation ne doit pas sembler plus ancienne");
});

await test("GCONF-09 DTSTART/DTEND en UTC absolu, durée préservée, aucun VTIMEZONE", () => {
  const inv = buildConfirmationIcs(entree(REPORTE, "eleve", COACH_A));
  assert.match(champ(inv, "DTSTART"), /^DTSTART:\d{8}T\d{6}Z$/);
  assert.equal(instant(inv, "DTEND") - instant(inv, "DTSTART"), 90 * 60 * 1000);
  assert.ok(!inv.includes("VTIMEZONE") && !inv.includes("TZID"));
});

await test("GCONF-10 fuseaux : Google affiche l'heure locale du destinataire, pas la nôtre", () => {
  /*
   * Un instant UTC n'est pas ambigu, c'est tout l'intérêt du suffixe Z : un
   * destinataire dont l'agenda Google est réglé sur un autre fuseau verra son
   * heure locale, et l'événement restera au bon instant absolu.
   */
  const hiver = buildConfirmationIcs(entree(INITIAL, "eleve", COACH_A));
  assert.equal(heureLocale(hiver, "DTSTART", "Europe/Paris"), "08/12 10:00");
  assert.equal(heureLocale(hiver, "DTSTART", "UTC"), "08/12 09:00");
  assert.equal(heureLocale(hiver, "DTSTART", "America/New_York"), "08/12 04:00");
  const ete = buildConfirmationIcs(
    entree({ ...INITIAL, debut: "2026-07-15T09:00:00.000Z", fin: "2026-07-15T10:00:00.000Z" }, "eleve", COACH_A),
  );
  assert.equal(heureLocale(ete, "DTSTART", "Europe/Paris"), "15/07 11:00");
});

await test("GCONF-11 UTF-8 et pliage : 75 octets par ligne, aucun caractère coupé", () => {
  const long = "Séance de préparation physique — bilan des charges, mobilité, œdème, Côte d'Azur 🤸 naïveté.";
  const ics = buildConfirmationIcs({ ...entree(INITIAL, "eleve", COACH_A), description: long });
  const orphelin = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  let pliees = 0;
  for (const ligne of lignesPhysiques(ics)) {
    assert.ok(ENCODEUR.encode(ligne).length <= 75, `ligne de ${ENCODEUR.encode(ligne).length} octets`);
    assert.ok(!orphelin.test(ligne));
    if (ligne.startsWith(" ")) pliees += 1;
  }
  assert.ok(pliees > 0, "le jeu de données doit provoquer un pliage");
  assert.equal(valeur(ics, "DESCRIPTION"), long.replace(/,/g, "\\,"), "le dépliage restitue le texte");
});

await test("GCONF-12 SUMMARY personnalisé : chacun voit l'autre partie, annulation comprise", () => {
  const envois = envoisDuReport();
  const parCle = new Map(envois.map((e) => [`${e.etape}/${e.role}`, valeur(e.piece.content, "SUMMARY")]));
  assert.equal(parCle.get("annulation_ancien/student"), "Séance de coaching — Jules FAVIER");
  assert.equal(parCle.get("annulation_ancien/coach"), "Coaching — Thomas MARTIN");
  assert.equal(parCle.get("evenement_courant/student"), "Séance de coaching — Jules FAVIER");
  assert.equal(parCle.get("evenement_courant/coach"), "Coaching — Thomas MARTIN");
});

/* ═══════ 2. SIMULATION — modèle Gmail, PLUS STRICT qu'Apple (GSIM-*) ═══════ */

interface EvenementAgenda {
  uid: string;
  sequence: number;
  summary: string;
  debut: string;
  organisateur: string | null;
}

/**
 * Modèle d'agenda Google.
 *
 * ⚠️ UNE RÈGLE DE PLUS QUE LE MODÈLE APPLE DU LOT 4, et c'est tout l'objet de
 * ce lot : une invitation n'est traitée que si l'adresse du TITULAIRE de
 * l'agenda figure dans le fichier comme `ATTENDEE`. C'est le comportement
 * documenté de Gmail — on ne traite pas une invitation adressée à quelqu'un
 * d'autre. S'y ajoute l'appariement sur (`UID`, `ORGANIZER`) pour les
 * annulations : une annulation signée d'un autre organisateur est ignorée.
 *
 * ⚠️ C'EST UN MODÈLE, PAS GOOGLE. Google est plus tolérant sur certains
 * points (il reconnaît aussi le titulaire via `ORGANIZER`, avec un
 * comportement variable selon le compte et le réglage « ajouter
 * automatiquement les invitations ») et plus exigeant sur d'autres. Ce modèle
 * sert à montrer OÙ le format est fragile, pas à certifier Google.
 */
class AgendaGoogle {
  evenements = new Map<string, EvenementAgenda>();
  ignores: string[] = [];

  constructor(private readonly titulaire: string) {}

  recevoir(piece: { content: string; contentType: string }): void {
    const methodeMime = /method=(REQUEST|CANCEL)/.exec(piece.contentType)?.[1] ?? null;
    const methodeFichier = methodeDeclaree(piece.content);
    if (methodeFichier === null || methodeMime === null) {
      this.ignores.push("pas de method exploitable : traité comme pièce jointe");
      return;
    }
    if (methodeMime !== methodeFichier) {
      this.ignores.push(`method=${methodeMime} contre METHOD:${methodeFichier}`);
      return;
    }
    const titulaire = this.titulaire.toLowerCase();
    const attendees = adressesAttendees(piece.content);
    if (!attendees.includes(titulaire)) {
      this.ignores.push(`le titulaire ${titulaire} ne figure pas comme ATTENDEE`);
      return;
    }
    const uid = valeur(piece.content, "UID");
    const sequence = Number(valeur(piece.content, "SEQUENCE"));
    const organisateur = adresse(piece.content, "ORGANIZER");
    const existant = this.evenements.get(uid);
    if (methodeFichier === "CANCEL") {
      if (!existant) {
        this.ignores.push(`CANCEL sur un UID inconnu : ${uid}`);
        return;
      }
      if (existant.organisateur !== organisateur) {
        this.ignores.push(`CANCEL d'un autre organisateur (${organisateur ?? "aucun"}) sur ${uid}`);
        return;
      }
      if (sequence < existant.sequence) {
        this.ignores.push(`CANCEL périmé sur ${uid}`);
        return;
      }
      this.evenements.delete(uid);
      return;
    }
    if (existant && sequence < existant.sequence) {
      this.ignores.push(`REQUEST périmé sur ${uid}`);
      return;
    }
    this.evenements.set(uid, {
      uid,
      sequence,
      summary: valeur(piece.content, "SUMMARY"),
      debut: valeur(piece.content, "DTSTART"),
      organisateur,
    });
  }

  uids(): string[] {
    return [...this.evenements.keys()].sort();
  }
  titres(): string[] {
    return [...this.evenements.values()].map((e) => `${e.summary} @ ${e.debut}`).sort();
  }
}

await test("GSIM-01 scénario A — création : l'élève importe l'événement, une seule fois", () => {
  const agenda = new AgendaGoogle(ELEVE.email);
  agenda.recevoir(envoi("evenement_courant", "student", ELEVE.email, INITIAL, COACH_A).piece);
  assert.deepEqual(agenda.uids(), [UID_INITIAL]);
  assert.deepEqual(agenda.titres(), ["Séance de coaching — Jules FAVIER @ 20261208T090000Z"]);
  assert.deepEqual(agenda.ignores, []);
});

await test("GSIM-02 scénario B — annulation : l'ancien UID est reconnu, rien n'est créé", () => {
  const agenda = new AgendaGoogle(ELEVE.email);
  agenda.recevoir(envoi("evenement_courant", "student", ELEVE.email, INITIAL, COACH_A).piece);
  agenda.recevoir(envoi("annulation_ancien", "student", ELEVE.email, INITIAL, COACH_A).piece);
  assert.deepEqual(agenda.uids(), []);
  assert.deepEqual(agenda.ignores, [], "l'appariement (UID, ORGANIZER) a fonctionné");
});

await test("GSIM-03 scénario C — report : ancien créneau parti, nouveau arrivé, aucun doublon", () => {
  const agenda = new AgendaGoogle(ELEVE.email);
  agenda.recevoir(envoi("evenement_courant", "student", ELEVE.email, INITIAL, COACH_A).piece);
  const envois = envoisDuReport();
  agenda.recevoir(envois[0].piece); // annulation de l'ancien
  agenda.recevoir(envois[2].piece); // invitation du nouveau
  assert.deepEqual(agenda.uids(), [UID_REPORT]);
  assert.equal(agenda.evenements.size, 1, "aucun doublon");
  assert.deepEqual(agenda.titres(), ["Séance de coaching — Jules FAVIER @ 20261211T140000Z"]);
  assert.deepEqual(agenda.ignores, []);
});

await test("GSIM-04 scénario E — réémission : ni doublon, ni effet de bord", () => {
  const agenda = new AgendaGoogle(ELEVE.email);
  const invitation = envoi("evenement_courant", "student", ELEVE.email, INITIAL, COACH_A).piece;
  const annulation = envoi("annulation_ancien", "student", ELEVE.email, INITIAL, COACH_A).piece;
  agenda.recevoir(invitation);
  agenda.recevoir(invitation);
  agenda.recevoir(invitation);
  assert.equal(agenda.evenements.size, 1, "un UID, un événement");
  agenda.recevoir(annulation);
  agenda.recevoir(annulation);
  assert.deepEqual(agenda.uids(), []);
  // La seconde annulation n'a plus de cible : ignorée, sans créer de fantôme.
  assert.deepEqual(agenda.ignores, [`CANCEL sur un UID inconnu : ${UID_INITIAL}`]);
});

await test("GSIM-05 ⚠️ LE FICHIER DU COACH N'A PAS LE COACH COMME ATTENDEE", () => {
  /*
   * ⚠️ LA DIVERGENCE GOOGLE / APPLE, MESURÉE. Dans le fichier destiné au
   * coach, le coach est `ORGANIZER` et le seul `ATTENDEE` est l'élève. Le
   * modèle Apple du lot 4 l'acceptait ; ce modèle, qui exige une
   * correspondance d'ATTENDEE comme Gmail, l'ignore.
   *
   * CE TEST CONSTATE L'ÉTAT ACTUEL, il ne le réprouve pas : changer les rôles
   * est un arbitrage produit, pas un correctif. Il échouera le jour où cet
   * arbitrage sera rendu — et c'est voulu, pour que la décision soit visible.
   */
  const pourCoach = envoi("evenement_courant", "coach", COACH_A.email, INITIAL, COACH_A).piece;
  assert.deepEqual(adressesAttendees(pourCoach.content), [ELEVE.email], "seul l'élève est attendee");
  assert.equal(adresse(pourCoach.content, "ORGANIZER"), COACH_A.email, "le coach n'est QUE organisateur");

  const agendaCoach = new AgendaGoogle(COACH_A.email);
  agendaCoach.recevoir(pourCoach);
  assert.deepEqual(agendaCoach.uids(), [], "sous la règle Gmail, rien n'est importé");
  assert.deepEqual(agendaCoach.ignores, [`le titulaire ${COACH_A.email} ne figure pas comme ATTENDEE`]);
});

await test("GSIM-06 l'option recommandée lève le blocage, sans retirer son rôle au coach", () => {
  /*
   * Démonstration de l'option 1 de la recommandation : AJOUTER le coach comme
   * `ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED` tout en le laissant `ORGANIZER`.
   * C'est la forme que Google lui-même émet pour l'organisateur d'un
   * événement. Construit ici À LA MAIN : le code de production n'est PAS
   * modifié tant que l'arbitrage n'est pas rendu.
   */
  const base = envoi("evenement_courant", "coach", COACH_A.email, INITIAL, COACH_A).piece;
  /*
   * ⚠️ LIGNE INSÉRÉE NON PLIÉE, ET C'EST SANS CONSÉQUENCE ICI : le modèle
   * déplie avant de lire, et la variante ne sert qu'à démontrer la règle
   * d'appariement. Les fichiers que la recette enverra réellement à Gmail,
   * eux, sont pliés à 75 octets — vérifié à la génération
   * (docs/lot5-google-calendar/).
   */
  const ligneCoach = `ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED;RSVP=FALSE;CN=${formaterIdentiteCoach(COACH_A.name)}:mailto:${COACH_A.email}`;
  const variante = {
    content: base.content.replace("STATUS:CONFIRMED", `${ligneCoach}\r\nSTATUS:CONFIRMED`),
    contentType: base.contentType,
  };
  assert.deepEqual(adressesAttendees(variante.content).sort(), [COACH_A.email, ELEVE.email].sort());
  const agendaCoach = new AgendaGoogle(COACH_A.email);
  agendaCoach.recevoir(variante);
  assert.deepEqual(agendaCoach.uids(), [UID_INITIAL], "le coach importe son propre créneau");
  assert.deepEqual(agendaCoach.ignores, []);
  // Et l'annulation correspondante s'applique, l'organisateur étant inchangé.
  const baseAnn = envoi("annulation_ancien", "coach", COACH_A.email, INITIAL, COACH_A).piece;
  agendaCoach.recevoir({
    content: baseAnn.content.replace("STATUS:CANCELLED", `${ligneCoach}\r\nSTATUS:CANCELLED`),
    contentType: baseAnn.contentType,
  });
  assert.deepEqual(agendaCoach.uids(), [], "annulation appliquée");
});

await test("GSIM-07 scénario D — réaffectation : les trois agendas restent cohérents", () => {
  /*
   * Joué sur l'élève, seul agenda que le format actuel alimente de façon
   * certaine sous la règle Gmail. Les deux agendas coach sont évalués avec la
   * variante de GSIM-06, pour montrer l'état visé par la recommandation.
   */
  const envois = envoisDuReport(COACH_A, COACH_B);
  const agendaEleve = new AgendaGoogle(ELEVE.email);
  agendaEleve.recevoir(envoi("evenement_courant", "student", ELEVE.email, INITIAL, COACH_A).piece);
  agendaEleve.recevoir(envois[0].piece);
  agendaEleve.recevoir(envois[2].piece);
  assert.deepEqual(agendaEleve.uids(), [UID_REPORT]);
  assert.deepEqual(agendaEleve.titres(), ["Séance de coaching — Sophie BERNARD @ 20261211T140000Z"]);

  const avecCoachAttendee = (piece: { content: string; contentType: string }, coach: { name: string; email: string }) => ({
    content: piece.content.replace(
      /STATUS:(CONFIRMED|CANCELLED)/,
      `ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED;RSVP=FALSE;CN=${formaterIdentiteCoach(coach.name)}:mailto:${coach.email}\r\n$&`,
    ),
    contentType: piece.contentType,
  });
  const agendaA = new AgendaGoogle(COACH_A.email);
  agendaA.recevoir(avecCoachAttendee(envoi("evenement_courant", "coach", COACH_A.email, INITIAL, COACH_A).piece, COACH_A));
  agendaA.recevoir(avecCoachAttendee(envois[1].piece, COACH_A));
  assert.deepEqual(agendaA.uids(), [], "l'ancien coach n'a plus rien");

  const agendaB = new AgendaGoogle(COACH_B.email);
  agendaB.recevoir(avecCoachAttendee(envois[3].piece, COACH_B));
  assert.deepEqual(agendaB.uids(), [UID_REPORT], "le nouveau coach a le nouveau créneau, et lui seul");
  assert.deepEqual([...agendaEleve.ignores, ...agendaA.ignores, ...agendaB.ignores], []);
});

/* ═══════════ 3. Cohérence avec le journal d'envoi (JOURNAL-*) ═══════════ */

await test("JOURNAL-01 chaque envoi journalise l'entité dont son .ics porte l'UID", () => {
  /*
   * ⚠️ INVARIANT CROISÉ. Le journal dit « appointment_cancelled sur rdv-1 » ;
   * le fichier joint doit porter l'UID de rdv-1, pas celui du report. Sans ce
   * lien, un renvoi depuis le journal reconstruirait le mauvais événement.
   */
  const uidsAttendus: Record<string, string> = { "rdv-1": UID_INITIAL, "rdv-2": UID_REPORT };
  for (const e of envoisDuReport(COACH_A, COACH_B)) {
    assert.equal(
      valeur(e.piece.content, "UID"),
      uidsAttendus[e.relatedEntityId],
      `${e.emailType} journalisé sur ${e.relatedEntityId} mais .ics d'un autre événement`,
    );
  }
});

await test("JOURNAL-02 les triplets (type, entité, destinataire) sont tous distincts", () => {
  const envois = envoisDuReport(COACH_A, COACH_B);
  const triplets = envois.map((e) => `${e.emailType}|${e.relatedEntityId}|${e.recipientEmail}`);
  assert.equal(new Set(triplets).size, envois.length, "aucun doublon possible dans email_logs");
  // Et le METHOD du fichier est cohérent avec le type d'email journalisé.
  for (const e of envois) {
    assert.equal(
      methodeDeclaree(e.piece.content),
      e.emailType === "appointment_cancelled" ? "CANCEL" : "REQUEST",
      `${e.emailType} devrait porter l'autre METHOD`,
    );
  }
});

await test("JOURNAL-03 le renvoi admin ne dépend que de `role`, absent de `etape`", () => {
  /*
   * ⚠️ MESURÉ EN PRODUCTION (17/11/2026, lecture seule) : les 27 lignes
   * `email_logs` de rendez-vous portent toutes `metadata.role`, AUCUNE ne
   * porte `metadata.etape` — ce champ n'existe que depuis le lot 3-bis. Le
   * renvoi doit donc continuer de se décider sur `role` seul, sinon il
   * casserait sur tout l'historique.
   */
  assert.match(RECOMPOSE_CODE, /const isCoachRecipient = log\.metadata\.role === "coach"/);
  assert.ok(!RECOMPOSE_CODE.includes("metadata.etape"), "le renvoi ne doit pas exiger un champ absent de l'historique");
  assert.match(ROUTE_CODE, /metadata: \{ role: envoi\.role, etape: envoi\.etape, appointmentType: appointment\.appointmentType \}/);
});

await test("CODE-01 les acquis des lots 2 à 4 sont intacts", () => {
  assert.match(ROUTE_CODE, /contentType: typeMimeIcs\(contenu\)/);
  assert.equal((ROUTE_CODE.match(/contentType: typeMimeIcs\(contenu\)/g) ?? []).length, 2);
  assert.match(ROUTE_CODE, /attachments: \[envoi\.piece\]/, "un seul .ics par e-mail");
  assert.match(ROUTE_CODE, /getCoachProprietaireRendezVous\(adminSupabase, original\.coachId\)/);
  assert.ok(!ROUTE_CODE.includes("getPrimaryCoachInfo"));
  assert.match(ROUTE_CODE, /dtstamp: original\.updatedAt/);
  assert.match(ROUTE_CODE, /idempotencyKey: envoi\.idempotencyKey/);
});

await test("CODE-02 le lot 5 n'a modifié aucun format : lib/ics.ts est inchangé depuis le lot 4", () => {
  /*
   * ⚠️ ASSERTION DÉLIBÉRÉMENT CONSERVATRICE. La consigne du lot 5 est de ne
   * pas toucher au format sans défaut PROUVÉ. Aucun défaut n'a été prouvé :
   * ces marqueurs figent donc l'état du lot 4, et rougissent si une
   * modification de format se glisse sans décision.
   */
  const ics = sansCommentairesTs(lire("../../lib/ics.ts"));
  assert.match(ics, /function envelopper\(methode: MethodeIcs, evenement: string\)/);
  assert.match(ics, /ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=/);
  assert.match(ics, /function echapperParametre\(valeur: string\): string/);
  assert.match(ics, /const LIMITE_OCTETS_PAR_LIGNE = 75/);
  assert.ok(!ics.includes('method === "CANCEL" ? "METHOD:CANCEL" : null'));
  // Aucune ligne ATTENDEE supplémentaire pour le coach : l'arbitrage n'est pas rendu.
  assert.equal((ics.match(/`ATTENDEE;/g) ?? []).length, 1, "une seule ligne ATTENDEE émise");
});

/* ═══════════════════════ 4. Contre-épreuves ═══════════════════════ */

await test("GCONTRE-01 MIME sans `method` : Gmail traite le fichier comme une pièce jointe", () => {
  const piece = envoi("annulation_ancien", "student", ELEVE.email, INITIAL, COACH_A).piece;
  const fautif = { content: piece.content, contentType: "text/calendar" };
  const agenda = new AgendaGoogle(ELEVE.email);
  agenda.recevoir(envoi("evenement_courant", "student", ELEVE.email, INITIAL, COACH_A).piece);
  agenda.recevoir(fautif);
  assert.deepEqual(agenda.uids(), [UID_INITIAL], "l'événement survit : l'annulation n'a pas été appliquée");
  assert.deepEqual(agenda.ignores, ["pas de method exploitable : traité comme pièce jointe"]);
  assert.throws(() => assert.deepEqual(agenda.uids(), []), "GSIM-02 doit échouer");
});

await test("GCONTRE-02 annulation signée d'un AUTRE organisateur : Google l'ignore", () => {
  /*
   * Le cas que GCONF-05 prévient : si l'annulation portait le NOUVEAU coach
   * au lieu de l'ancien, Google ne l'apparierait pas à l'événement existant.
   */
  const agenda = new AgendaGoogle(ELEVE.email);
  agenda.recevoir(envoi("evenement_courant", "student", ELEVE.email, INITIAL, COACH_A).piece);
  const fautive = envoi("annulation_ancien", "student", ELEVE.email, INITIAL, COACH_B).piece;
  assert.equal(adresse(fautive.content, "ORGANIZER"), COACH_B.email, "la mutation doit s'appliquer");
  agenda.recevoir(fautive);
  assert.deepEqual(agenda.uids(), [UID_INITIAL], "l'ancien créneau reste affiché");
  assert.deepEqual(agenda.ignores, [`CANCEL d'un autre organisateur (${COACH_B.email}) sur ${UID_INITIAL}`]);
});

await test("GCONTRE-03 annulation sur un NOUVEL UID : le doublon est reproduit", () => {
  const agenda = new AgendaGoogle(ELEVE.email);
  agenda.recevoir(envoi("evenement_courant", "student", ELEVE.email, INITIAL, COACH_A).piece);
  const fautive = envoi("annulation_ancien", "student", ELEVE.email, { ...INITIAL, uid: UID_REPORT }, COACH_A).piece;
  agenda.recevoir(fautive);
  agenda.recevoir(envoi("evenement_courant", "student", ELEVE.email, REPORTE, COACH_A).piece);
  assert.equal(agenda.evenements.size, 2, "DEUX créneaux : exactement le défaut du lot 3");
  assert.throws(() => assert.equal(agenda.evenements.size, 1), "GSIM-03 doit échouer");
});

await test("GCONTRE-04 ORGANIZER absent : aucun appariement possible", () => {
  const agenda = new AgendaGoogle(ELEVE.email);
  const invSansOrga = buildConfirmationIcs({ ...entree(INITIAL, "eleve", COACH_A), organizerEmail: "" });
  agenda.recevoir({ content: invSansOrga, contentType: typeMimeIcs(invSansOrga) });
  assert.equal(agenda.evenements.get(UID_INITIAL)?.organisateur, null, "importé sans organisateur");
  // L'annulation, elle, en porte un : l'appariement échoue.
  agenda.recevoir(envoi("annulation_ancien", "student", ELEVE.email, INITIAL, COACH_A).piece);
  assert.deepEqual(agenda.uids(), [UID_INITIAL], "l'événement ne peut plus être annulé");
  assert.match(agenda.ignores.join(" "), /CANCEL d'un autre organisateur/);
});

await test("GCONTRE-05 UID non unique entre deux rendez-vous : l'un écrase l'autre", () => {
  const agenda = new AgendaGoogle(ELEVE.email);
  agenda.recevoir(envoi("evenement_courant", "student", ELEVE.email, INITIAL, COACH_A).piece);
  const collision = envoi("evenement_courant", "student", ELEVE.email, { ...REPORTE, uid: UID_INITIAL }, COACH_A).piece;
  agenda.recevoir(collision);
  assert.equal(agenda.evenements.size, 1, "un seul événement là où il en faudrait deux");
  assert.deepEqual(agenda.titres(), ["Séance de coaching — Jules FAVIER @ 20261211T140000Z"], "le second a écrasé le premier");
  assert.throws(() => assert.equal(agenda.evenements.size, 2), "GCONF-03 doit échouer sur un UID réutilisé");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
