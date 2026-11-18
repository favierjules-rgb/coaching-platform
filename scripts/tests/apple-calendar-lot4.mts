/**
 * Harnais — LOT 4 : compatibilité Apple Calendar.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️ CE FICHIER NE VALIDE PAS APPLE CALENDAR. IL NE PEUT PAS.          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Il contient DEUX choses, à ne pas confondre :
 *
 *  1. Des tests de CONFORMITÉ automatisés (`CONF-*`). Ils vérifient que le
 *     fichier produit et son type MIME portent ce qu'un client iTIP a besoin
 *     de lire : `method` MIME aligné sur `METHOD:`, UID stable, `SEQUENCE`
 *     croissante, `STATUS` cohérent, `ORGANIZER`/`ATTENDEE` bien formés,
 *     pliage à 75 octets, terminaison CRLF.
 *
 *  2. Un AGENDA iTIP SIMULÉ (`AGENDA-*`). Il applique les règles d'un client
 *     conforme — un UID identifie un événement, un REQUEST de `SEQUENCE`
 *     supérieure ou égale remplace, un CANCEL retire — et prouve qu'une
 *     SÉQUENCE de nos notifications aboutit au bon état final, sans doublon.
 *     ⚠️ C'EST UN MODÈLE, PAS APPLE. Apple Calendar a ses propres tolérances
 *     et ses propres refus ; un fichier qui passe ici peut encore être mal
 *     interprété par lui.
 *
 * Les scénarios A, B, C et D du lot 4 exigent un essai RÉEL sur macOS, iPhone
 * ou iPad. `docs/lot4-apple-calendar/` contient les fichiers .ics à ouvrir
 * pour les jouer, et la marche à suivre.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/apple-calendar-lot4.mts
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

const ICS_SOURCE = sansCommentairesTs(lire("../../lib/ics.ts"));
const ROUTE_CODE = sansCommentairesTs(lire("../../app/api/email/appointment-notification/route.ts"));
const RECOMPOSE_CODE = sansCommentairesTs(lire("../../lib/email/recompose.ts"));

const ENCODEUR = new TextEncoder();

/* ═════════════════════════ Jeu de données ═════════════════════════ */

const ELEVE = { prenom: "Thomas", nom: "Martin", email: "eleve@example.test" };
const COACH_A = { name: "Jules Favier", email: "jules@example.test" };
const COACH_B = { name: "Sophie Bernard", email: "sophie@example.test" };

const IDENTITE_ELEVE = formaterIdentiteEleve(ELEVE.prenom, ELEVE.nom);

const UID_INITIAL = "1f0c9e22-4a7b-4c21-9d3e-0a1b2c3d4e5f@seth-coaching";
const UID_REPORT = "9b7d4411-8e2c-4fa5-b6d7-112233445566@seth-coaching";

interface Creneau {
  uid: string;
  debut: string;
  fin: string;
  lieu: string;
  dtstamp: string;
}

const CRENEAU_INITIAL: Creneau = {
  uid: UID_INITIAL,
  debut: "2026-11-20T09:00:00.000Z",
  fin: "2026-11-20T10:00:00.000Z",
  lieu: "Salle Nord, Lyon",
  dtstamp: "2026-11-17T08:00:00.000Z",
};
const CRENEAU_REPORTE: Creneau = {
  uid: UID_REPORT,
  debut: "2026-11-24T14:00:00.000Z",
  fin: "2026-11-24T15:30:00.000Z",
  lieu: "Salle Nord, Lyon",
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
    location: creneau.lieu,
    meetingUrl: "https://visio.example.test/abc",
    organizerName: identiteCoach,
    organizerEmail: coach.email,
    attendeeName: ELEVE.prenom,
    attendeeEmail: ELEVE.email,
    dtstamp: creneau.dtstamp,
  };
}

/** Une pièce jointe telle que la route la produit : contenu + type MIME dérivé. */
interface PieceJointe {
  filename: string;
  content: string;
  contentType: string;
}
function invitation(creneau: Creneau, destinataire: Destinataire, coach: { name: string; email: string }): PieceJointe {
  const contenu = buildConfirmationIcs(entree(creneau, destinataire, coach));
  return { filename: "rendez-vous.ics", content: contenu, contentType: typeMimeIcs(contenu) };
}
function annulation(creneau: Creneau, destinataire: Destinataire, coach: { name: string; email: string }): PieceJointe {
  const contenu = buildCancellationIcs(entree(creneau, destinataire, coach));
  return { filename: "annulation-ancien-rendez-vous.ics", content: contenu, contentType: typeMimeIcs(contenu) };
}

/* ═════════════════════════ Outils d'inspection ═════════════════════════ */

function lignesPhysiques(ics: string): string[] {
  // Le flux se termine par CRLF : le dernier élément du découpage est vide.
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
function valeur(ics: string, nom: string): string {
  const ligne = champ(ics, nom);
  return ligne.slice(ligne.indexOf(":") + 1);
}
function instant(ics: string, nom: string): number {
  const brut = valeur(ics, nom);
  const iso = `${brut.slice(0, 4)}-${brut.slice(4, 6)}-${brut.slice(6, 8)}T${brut.slice(9, 11)}:${brut.slice(11, 13)}:${brut.slice(13, 15)}Z`;
  const t = Date.parse(iso);
  assert.ok(Number.isFinite(t), `horodatage illisible : ${brut}`);
  return t;
}
/**
 * Paramètres d'une propriété, tels qu'un analyseur CONFORME les découpe.
 *
 * ⚠️ LE DÉCOUPAGE DOIT RESPECTER LES GUILLEMETS, sinon il ne prouve rien.
 * Une première version coupait sur `;` sans les regarder : `CN="Thomas; Jr"`
 * donnait cinq paramètres au lieu de quatre, et le test accusait le code
 * alors que le fichier était juste. C'est exactement l'erreur que la citation
 * est censée EMPÊCHER chez le client — l'outil de mesure doit donc être au
 * moins aussi correct que lui.
 */
function parametres(ligne: string): string[] {
  return decouperHorsGuillemets(ligne.slice(0, indexValeur(ligne)), ";").slice(1);
}

/**
 * Découpe sur un séparateur, en ignorant ceux placés entre guillemets.
 *
 * ⚠️ UN OUTIL DE MESURE NAÏF ACCUSE LE CODE À TORT. J'ai écrit deux fois la
 * version sans guillemets — une pour `;`, une pour `,` — et les deux fois le
 * test a dénoncé un fichier correct. La citation sert précisément à empêcher
 * ce découpage : l'outil doit la respecter, sinon il ne mesure rien.
 */
function decouperHorsGuillemets(texte: string, separateur: string): string[] {
  const sortie: string[] = [];
  let courant = "";
  let cite = false;
  for (const caractere of texte) {
    if (caractere === '"') {
      cite = !cite;
      courant += caractere;
    } else if (caractere === separateur && !cite) {
      sortie.push(courant);
      courant = "";
    } else {
      courant += caractere;
    }
  }
  sortie.push(courant);
  return sortie;
}

/** Valeurs d'un paramètre : `CN=a,b` en porte deux, `CN="a,b"` une seule. */
function valeursDuParametre(parametre: string): string[] {
  return decouperHorsGuillemets(parametre.slice(parametre.indexOf("=") + 1), ",");
}
/** Position du « : » qui ouvre la valeur, en ignorant ceux des paramètres cités. */
function indexValeur(ligne: string): number {
  let cite = false;
  for (let i = 0; i < ligne.length; i += 1) {
    if (ligne[i] === '"') cite = !cite;
    else if (ligne[i] === ":" && !cite) return i;
  }
  return ligne.length;
}
function heureLocale(ics: string, nom: string, zone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(instant(ics, nom)));
}

/* ════════════ 1. TESTS DE CONFORMITÉ AUTOMATISÉS (CONF-*) ════════════ */

await test("CONF-01 le type MIME porte `method`, aligné sur le METHOD du fichier", () => {
  const inv = invitation(CRENEAU_INITIAL, "eleve", COACH_A);
  const ann = annulation(CRENEAU_INITIAL, "eleve", COACH_A);
  assert.equal(inv.contentType, "text/calendar; charset=utf-8; method=REQUEST");
  assert.equal(ann.contentType, "text/calendar; charset=utf-8; method=CANCEL");
  // L'alignement est la propriété vraiment utile : on le vérifie en relisant
  // le fichier, pas en recopiant la constante.
  for (const piece of [inv, ann]) {
    const methodeFichier = methodeDeclaree(piece.content);
    assert.ok(methodeFichier !== null, "le fichier doit déclarer un METHOD");
    assert.ok(
      piece.contentType.endsWith(`method=${methodeFichier}`),
      `MIME « ${piece.contentType} » contre fichier « METHOD:${methodeFichier} »`,
    );
  }
});

await test("CONF-02 le charset UTF-8 est annoncé en MIME", () => {
  for (const piece of [invitation(CRENEAU_INITIAL, "eleve", COACH_A), annulation(CRENEAU_INITIAL, "coach", COACH_A)]) {
    assert.match(piece.contentType, /^text\/calendar; charset=utf-8; method=(REQUEST|CANCEL)$/);
  }
});

await test("CONF-03 METHOD une seule fois, au niveau VCALENDAR, jamais dans le VEVENT", () => {
  for (const piece of [invitation(CRENEAU_INITIAL, "eleve", COACH_A), annulation(CRENEAU_INITIAL, "eleve", COACH_A)]) {
    const l = deplie(piece.content);
    const positions = l.map((ligne, i) => ({ ligne, i })).filter(({ ligne }) => ligne.startsWith("METHOD"));
    assert.equal(positions.length, 1, "un seul METHOD");
    assert.ok(positions[0].i < l.indexOf("BEGIN:VEVENT"), "avant le VEVENT");
    assert.ok(positions[0].i > l.indexOf("BEGIN:VCALENDAR"), "dans le composant calendrier");
  }
});

await test("CONF-04 CRLF partout, et le flux se TERMINE par CRLF", () => {
  for (const piece of [invitation(CRENEAU_INITIAL, "eleve", COACH_A), annulation(CRENEAU_INITIAL, "eleve", COACH_A)]) {
    assert.ok(piece.content.endsWith("END:VCALENDAR\r\n"), "RFC 5545 §3.1 : la dernière ligne est terminée");
    // Aucun LF nu : tous les sauts de ligne sont des CRLF.
    assert.equal(piece.content.replace(/\r\n/g, "").includes("\n"), false, "aucun LF orphelin");
    assert.equal(piece.content.replace(/\r\n/g, "").includes("\r"), false, "aucun CR orphelin");
  }
});

await test("CONF-05 VERSION et PRODID présents, avant METHOD", () => {
  const l = deplie(invitation(CRENEAU_INITIAL, "eleve", COACH_A).content);
  assert.equal(l[0], "BEGIN:VCALENDAR");
  assert.equal(champ(invitation(CRENEAU_INITIAL, "eleve", COACH_A).content, "VERSION"), "VERSION:2.0");
  assert.match(champ(invitation(CRENEAU_INITIAL, "eleve", COACH_A).content, "PRODID"), /^PRODID:-\/\/.+\/\/.+$/);
  assert.ok(l.indexOf("VERSION:2.0") < l.findIndex((x) => x.startsWith("METHOD:")));
  assert.ok(l.findIndex((x) => x.startsWith("PRODID:")) < l.findIndex((x) => x.startsWith("METHOD:")));
});

await test("CONF-06 l'annulation porte le MÊME UID que l'invitation initiale", () => {
  const inv = invitation(CRENEAU_INITIAL, "eleve", COACH_A).content;
  const ann = annulation(CRENEAU_INITIAL, "eleve", COACH_A).content;
  assert.equal(valeur(ann, "UID"), valeur(inv, "UID"), "c'est l'UID qui fait la correspondance");
  assert.equal(valeur(ann, "UID"), UID_INITIAL);
  // Et l'invitation du report en porte un AUTRE.
  assert.notEqual(valeur(invitation(CRENEAU_REPORTE, "eleve", COACH_A).content, "UID"), UID_INITIAL);
});

await test("CONF-07 SEQUENCE strictement croissante entre l'invitation et son annulation", () => {
  const seqInv = Number(valeur(invitation(CRENEAU_INITIAL, "eleve", COACH_A).content, "SEQUENCE"));
  const seqAnn = Number(valeur(annulation(CRENEAU_INITIAL, "eleve", COACH_A).content, "SEQUENCE"));
  assert.equal(seqInv, 0);
  assert.equal(seqAnn, 1);
  assert.ok(seqAnn > seqInv, "une révision doit porter une séquence supérieure");
});

await test("CONF-08 STATUS cohérent avec METHOD", () => {
  const inv = invitation(CRENEAU_INITIAL, "eleve", COACH_A).content;
  const ann = annulation(CRENEAU_INITIAL, "eleve", COACH_A).content;
  assert.equal(methodeDeclaree(inv), "REQUEST");
  assert.equal(champ(inv, "STATUS"), "STATUS:CONFIRMED");
  assert.equal(methodeDeclaree(ann), "CANCEL");
  assert.equal(champ(ann, "STATUS"), "STATUS:CANCELLED");
});

await test("CONF-09 DTSTAMP présent, en UTC, et non antérieur à celui de l'invitation", () => {
  const inv = invitation(CRENEAU_INITIAL, "eleve", COACH_A).content;
  // L'annulation porte le `updated_at` postérieur, comme la route le fait.
  const ann = annulation({ ...CRENEAU_INITIAL, dtstamp: "2026-11-17T09:00:00.000Z" }, "eleve", COACH_A).content;
  for (const fichier of [inv, ann]) {
    assert.match(champ(fichier, "DTSTAMP"), /^DTSTAMP:\d{8}T\d{6}Z$/);
  }
  assert.ok(instant(ann, "DTSTAMP") >= instant(inv, "DTSTAMP"), "l'annulation ne doit pas sembler plus ancienne");
});

await test("CONF-10 DTSTART/DTEND en UTC, durée préservée, aucun VTIMEZONE", () => {
  const inv = invitation(CRENEAU_REPORTE, "eleve", COACH_A).content;
  assert.match(champ(inv, "DTSTART"), /^DTSTART:\d{8}T\d{6}Z$/);
  assert.match(champ(inv, "DTEND"), /^DTEND:\d{8}T\d{6}Z$/);
  assert.equal(instant(inv, "DTEND") - instant(inv, "DTSTART"), 90 * 60 * 1000, "90 minutes");
  assert.ok(!inv.includes("VTIMEZONE"), "pas de bloc VTIMEZONE : tout est en UTC absolu");
  assert.ok(!inv.includes("TZID"), "aucun TZID, donc aucune base de fuseau à embarquer");
});

await test("CONF-11 fuseaux : heure d'hiver ET heure d'été rendent la bonne heure à Paris", () => {
  /*
   * ⚠️ CE TEST VÉRIFIE LA CONVERSION, PAS L'AFFICHAGE D'APPLE. Un instant UTC
   * n'est pas ambigu : c'est tout l'intérêt du suffixe Z. On prouve ici que
   * l'instant écrit dans le fichier correspond bien à l'heure locale attendue
   * de part et d'autre du changement d'heure — un décalage d'une heure se
   * verrait immédiatement.
   */
  const hiver = invitation(CRENEAU_INITIAL, "eleve", COACH_A).content; // 20/11, UTC+1
  assert.equal(heureLocale(hiver, "DTSTART", "Europe/Paris"), "20/11 10:00");
  const ete = invitation(
    { ...CRENEAU_INITIAL, debut: "2026-07-15T09:00:00.000Z", fin: "2026-07-15T10:00:00.000Z" },
    "eleve",
    COACH_A,
  ).content; // 15/07, UTC+2
  assert.equal(heureLocale(ete, "DTSTART", "Europe/Paris"), "15/07 11:00");
  // Et un agenda réglé sur un autre fuseau lit le même instant.
  assert.equal(heureLocale(hiver, "DTSTART", "UTC"), "20/11 09:00");
});

await test("CONF-12 ORGANIZER présent dès que l'adresse du coach est connue, CN correctement cité", () => {
  const avec = invitation(CRENEAU_INITIAL, "eleve", COACH_A).content;
  const ligne = champ(avec, "ORGANIZER");
  assert.match(ligne, /^ORGANIZER;CN=Jules FAVIER:mailto:jules@example\.test$/);
  // Un nom à virgule doit être CITÉ, pas échappé par barre oblique : un
  // paramètre ne connaît pas l'échappement par barre oblique inverse.
  const virgule = invitation(CRENEAU_INITIAL, "eleve", { name: "Jules Favier, Jr", email: "j@e.test" }).content;
  const ligneCitee = champ(virgule, "ORGANIZER");
  assert.match(ligneCitee, /CN="Jules FAVIER, JR"/, `CN non cité : ${ligneCitee}`);
  assert.ok(!ligneCitee.includes("\\,"), "jamais d'échappement de valeur dans un paramètre");
  // Et le découpage reste juste : un seul paramètre CN, une seule valeur.
  assert.deepEqual(parametres(ligneCitee), ['CN="Jules FAVIER, JR"']);
  assert.equal(ligneCitee.slice(indexValeur(ligneCitee) + 1), "mailto:j@e.test");
  // ⚠️ Sans adresse, la ligne est OMISE (décision de confidentialité du lot 2,
  // figée par security-hardening) — Apple ne peut alors pas traiter le fichier
  // comme une invitation. Conséquence documentée, pas corrigée ici.
  const sans = buildConfirmationIcs({ ...entree(CRENEAU_INITIAL, "eleve", COACH_A), organizerEmail: "" });
  assert.ok(!sans.includes("ORGANIZER"), "ligne omise plutôt que mailto vide");
});

await test("CONF-13 ATTENDEE porte ROLE, PARTSTAT, RSVP et un mailto", () => {
  const inv = invitation(CRENEAU_INITIAL, "coach", COACH_A).content;
  const ligne = champ(inv, "ATTENDEE");
  assert.deepEqual(parametres(ligne), ["ROLE=REQ-PARTICIPANT", "PARTSTAT=NEEDS-ACTION", "RSVP=TRUE", "CN=Thomas"]);
  assert.equal(ligne.slice(indexValeur(ligne) + 1), `mailto:${ELEVE.email}`);
  // Un prénom à point-virgule est cité, donc ne scinde pas la propriété.
  const risque = buildConfirmationIcs({ ...entree(CRENEAU_INITIAL, "coach", COACH_A), attendeeName: "Thomas; Jr" });
  const ligneRisque = champ(risque, "ATTENDEE");
  assert.match(ligneRisque, /CN="Thomas; Jr"/);
  assert.equal(parametres(ligneRisque).length, 4, "toujours quatre paramètres, pas cinq");
});

await test("CONF-14 UTF-8 : 75 octets par ligne, aucun caractère coupé", () => {
  const long = "Séance de préparation physique — bilan complet des charges, mobilité, œdème, Côte d'Azur 🤸 naïveté.";
  const piece = invitation({ ...CRENEAU_INITIAL, lieu: long }, "eleve", COACH_A);
  const orphelin = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  let pliees = 0;
  for (const ligne of lignesPhysiques(piece.content)) {
    assert.ok(ENCODEUR.encode(ligne).length <= 75, `ligne de ${ENCODEUR.encode(ligne).length} octets`);
    assert.ok(!orphelin.test(ligne), `séquence UTF-8 coupée : ${JSON.stringify(ligne)}`);
    if (ligne.startsWith(" ")) pliees += 1;
  }
  assert.ok(pliees > 0, "le jeu de données doit réellement provoquer un pliage");
  // Le dépliage restitue la valeur d'origine, échappements de valeur compris.
  assert.equal(valeur(piece.content, "LOCATION"), long.replace(/,/g, "\\,"));
});

await test("CONF-15 intitulés personnalisés : chacun voit l'autre partie", () => {
  const pourEleve = invitation(CRENEAU_INITIAL, "eleve", COACH_A).content;
  const pourCoach = invitation(CRENEAU_INITIAL, "coach", COACH_A).content;
  assert.equal(valeur(pourEleve, "SUMMARY"), "Séance de coaching — Jules FAVIER");
  assert.equal(valeur(pourCoach, "SUMMARY"), "Coaching — Thomas MARTIN");
  assert.ok(!valeur(pourEleve, "SUMMARY").includes("MARTIN"));
  assert.ok(!valeur(pourCoach, "SUMMARY").includes("FAVIER"));
  // Et l'annulation est personnalisée elle aussi.
  assert.equal(valeur(annulation(CRENEAU_INITIAL, "coach", COACH_A).content, "SUMMARY"), "Coaching — Thomas MARTIN");
});

await test("CONF-16 aucune donnée personnelle superflue dans le fichier", () => {
  const piece = invitation(CRENEAU_INITIAL, "eleve", COACH_A).content;
  const interdits = ["phone", "telephone", "student_id", "coach_id", "user_id", "last_login"];
  for (const mot of interdits) {
    assert.ok(!piece.toLowerCase().includes(mot), `« ${mot} » n'a rien à faire dans un .ics`);
  }
  /*
   * Les seules adresses présentes sont celles des deux parties.
   *
   * ⚠️ ON LIT LE TEXTE DÉPLIÉ. L'ajout de `ROLE` et `PARTSTAT` a allongé la
   * ligne `ATTENDEE` au-delà de 75 octets : elle est désormais pliée, et une
   * recherche sur le texte brut coupait l'adresse de l'élève en deux. Le
   * pliage est légal et le dépliage du client restitue la ligne entière.
   */
  const adresses = [...deplie(piece).join("\n").matchAll(/mailto:([^\r\n;]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(adresses)].sort(), [COACH_A.email, ELEVE.email].sort());
});

/* ═══════ 2. AGENDA iTIP SIMULÉ — un MODÈLE, pas Apple (AGENDA-*) ═══════ */

interface EvenementAgenda {
  uid: string;
  sequence: number;
  summary: string;
  debut: string;
  statut: "CONFIRMED" | "CANCELLED";
}

/**
 * Agenda appliquant les règles d'un client iTIP conforme.
 *
 * ⚠️ MODÈLE DÉLIBÉRÉMENT STRICT, ET DÉLIBÉRÉMENT PAS APPLE :
 *   - l'UID identifie l'événement : un REQUEST sur un UID connu REMPLACE ;
 *   - une révision de SEQUENCE inférieure est IGNORÉE ;
 *   - un CANCEL retire l'événement de l'UID visé, et ne crée jamais rien ;
 *   - un fichier sans METHOD exploitable est refusé.
 * Apple Calendar est plus tolérant sur certains points et plus exigeant sur
 * d'autres (notamment l'absence d'ORGANIZER et le paramètre MIME `method`) :
 * ce modèle prouve la COHÉRENCE de nos séquences, pas le comportement d'Apple.
 */
class AgendaSimule {
  evenements = new Map<string, EvenementAgenda>();
  refus: string[] = [];

  appliquer(piece: PieceJointe): void {
    const methodeMime = /method=(REQUEST|CANCEL)/.exec(piece.contentType)?.[1] ?? null;
    const methodeFichier = methodeDeclaree(piece.content);
    if (methodeFichier === null) {
      this.refus.push("fichier sans METHOD");
      return;
    }
    if (methodeMime !== null && methodeMime !== methodeFichier) {
      this.refus.push(`MIME method=${methodeMime} contre METHOD:${methodeFichier}`);
      return;
    }
    const uid = valeur(piece.content, "UID");
    const sequence = Number(valeur(piece.content, "SEQUENCE"));
    const existant = this.evenements.get(uid);
    if (methodeFichier === "CANCEL") {
      if (!existant) {
        this.refus.push(`CANCEL sur un UID inconnu : ${uid}`);
        return;
      }
      if (sequence < existant.sequence) {
        this.refus.push(`CANCEL périmé sur ${uid}`);
        return;
      }
      this.evenements.delete(uid);
      return;
    }
    if (existant && sequence < existant.sequence) {
      this.refus.push(`REQUEST périmé sur ${uid}`);
      return;
    }
    this.evenements.set(uid, {
      uid,
      sequence,
      summary: valeur(piece.content, "SUMMARY"),
      debut: valeur(piece.content, "DTSTART"),
      statut: "CONFIRMED",
    });
  }

  uids(): string[] {
    return [...this.evenements.keys()].sort();
  }
  resumes(): string[] {
    return [...this.evenements.values()].map((e) => `${e.summary} @ ${e.debut}`).sort();
  }
}

await test("AGENDA-01 scénario A — création : un seul événement, aux bons horaires", () => {
  const agenda = new AgendaSimule();
  agenda.appliquer(invitation(CRENEAU_INITIAL, "eleve", COACH_A));
  assert.deepEqual(agenda.uids(), [UID_INITIAL]);
  assert.equal(agenda.evenements.size, 1, "créé une seule fois");
  assert.deepEqual(agenda.resumes(), ["Séance de coaching — Jules FAVIER @ 20261120T090000Z"]);
  assert.deepEqual(agenda.refus, []);
});

await test("AGENDA-02 scénario B — annulation : l'événement disparaît, rien n'est créé", () => {
  const agenda = new AgendaSimule();
  agenda.appliquer(invitation(CRENEAU_INITIAL, "eleve", COACH_A));
  agenda.appliquer(annulation(CRENEAU_INITIAL, "eleve", COACH_A));
  assert.deepEqual(agenda.uids(), [], "l'agenda est vide");
  assert.deepEqual(agenda.refus, [], "l'annulation a bien été identifiée par son UID");
});

await test("AGENDA-03 scénario C — report : l'ancien part, le nouveau arrive, aucun doublon", () => {
  const agenda = new AgendaSimule();
  agenda.appliquer(invitation(CRENEAU_INITIAL, "eleve", COACH_A));
  // Ordre réel des deux e-mails : annulation puis invitation.
  agenda.appliquer(annulation(CRENEAU_INITIAL, "eleve", COACH_A));
  agenda.appliquer(invitation(CRENEAU_REPORTE, "eleve", COACH_A));
  assert.deepEqual(agenda.uids(), [UID_REPORT], "exactement un créneau, le nouveau");
  assert.equal(agenda.evenements.size, 1, "aucun doublon");
  assert.deepEqual(agenda.resumes(), ["Séance de coaching — Jules FAVIER @ 20261124T140000Z"]);
  assert.deepEqual(agenda.refus, []);
});

await test("AGENDA-04 scénario C — l'ordre inverse laisse quand même un seul créneau", () => {
  /*
   * Tolérance aux aléas de livraison : si l'invitation arrive avant
   * l'annulation (les deux e-mails partent à la suite mais rien ne garantit
   * l'ordre de réception), l'état final doit rester le bon. Les UID étant
   * distincts, l'annulation ne touche pas le nouveau créneau.
   */
  const agenda = new AgendaSimule();
  agenda.appliquer(invitation(CRENEAU_INITIAL, "eleve", COACH_A));
  agenda.appliquer(invitation(CRENEAU_REPORTE, "eleve", COACH_A));
  agenda.appliquer(annulation(CRENEAU_INITIAL, "eleve", COACH_A));
  assert.deepEqual(agenda.uids(), [UID_REPORT]);
  assert.deepEqual(agenda.refus, []);
});

await test("AGENDA-05 scénario D — réaffectation : chaque coach n'a que son événement", () => {
  const agendaA = new AgendaSimule();
  const agendaB = new AgendaSimule();
  const agendaEleve = new AgendaSimule();

  // État de départ : l'ancien créneau est chez Coach A et chez l'élève.
  agendaA.appliquer(invitation(CRENEAU_INITIAL, "coach", COACH_A));
  agendaEleve.appliquer(invitation(CRENEAU_INITIAL, "eleve", COACH_A));

  // Report avec réaffectation : A reçoit l'annulation, B l'invitation,
  // l'élève les deux.
  agendaA.appliquer(annulation(CRENEAU_INITIAL, "coach", COACH_A));
  agendaEleve.appliquer(annulation(CRENEAU_INITIAL, "eleve", COACH_A));
  agendaB.appliquer(invitation(CRENEAU_REPORTE, "coach", COACH_B));
  agendaEleve.appliquer(invitation(CRENEAU_REPORTE, "eleve", COACH_B));

  assert.deepEqual(agendaA.uids(), [], "l'ancien coach n'a plus rien");
  assert.deepEqual(agendaB.uids(), [UID_REPORT], "le nouveau coach a le nouveau créneau, et lui seul");
  assert.deepEqual(agendaEleve.uids(), [UID_REPORT]);
  assert.deepEqual(agendaEleve.resumes(), ["Séance de coaching — Sophie BERNARD @ 20261124T140000Z"]);
  assert.deepEqual([...agendaA.refus, ...agendaB.refus, ...agendaEleve.refus], []);
});

await test("AGENDA-06 doublon : réappliquer le même fichier ne crée pas un second événement", () => {
  const agenda = new AgendaSimule();
  const piece = invitation(CRENEAU_INITIAL, "eleve", COACH_A);
  agenda.appliquer(piece);
  agenda.appliquer(piece);
  agenda.appliquer(piece);
  assert.equal(agenda.evenements.size, 1, "un UID, un événement");
  assert.equal(agenda.evenements.get(UID_INITIAL)?.sequence, 0);
});

await test("AGENDA-07 réémission : le fichier est identique au bit près", () => {
  const a = invitation(CRENEAU_INITIAL, "eleve", COACH_A);
  const b = invitation(CRENEAU_INITIAL, "eleve", COACH_A);
  assert.equal(a.content, b.content, "DTSTAMP déterministe : aucune dérive entre deux émissions");
  assert.equal(a.contentType, b.contentType);
  const annA = annulation(CRENEAU_INITIAL, "coach", COACH_A);
  const annB = annulation(CRENEAU_INITIAL, "coach", COACH_A);
  assert.equal(annA.content, annB.content);
});

await test("AGENDA-08 une annulation réémise reste sans effet, et sans erreur d'état", () => {
  const agenda = new AgendaSimule();
  agenda.appliquer(invitation(CRENEAU_INITIAL, "eleve", COACH_A));
  agenda.appliquer(annulation(CRENEAU_INITIAL, "eleve", COACH_A));
  agenda.appliquer(annulation(CRENEAU_INITIAL, "eleve", COACH_A));
  assert.deepEqual(agenda.uids(), []);
  // La seconde annulation est refusée faute de cible — refus attendu, pas
  // création d'un événement fantôme.
  assert.deepEqual(agenda.refus, [`CANCEL sur un UID inconnu : ${UID_INITIAL}`]);
  assert.equal(agenda.evenements.size, 0);
});

/* ═══════════════ 3. Ancrage au code de production ═══════════════ */

await test("CODE-01 la route et le renvoi dérivent le type MIME du contenu", () => {
  assert.match(ROUTE_CODE, /contentType: typeMimeIcs\(contenu\)/);
  assert.equal((ROUTE_CODE.match(/contentType: typeMimeIcs\(contenu\)/g) ?? []).length, 2, "les deux pièces jointes");
  assert.ok(!/contentType: "text\/calendar"/.test(ROUTE_CODE), "plus de type MIME nu");
  assert.match(RECOMPOSE_CODE, /contentType: typeMimeIcs\(contenuIcs\)/);
  assert.ok(!/contentType: "text\/calendar"/.test(RECOMPOSE_CODE));
});

await test("CODE-02 le type MIME est DÉDUIT du fichier, jamais passé en paramètre", () => {
  /*
   * ⚠️ C'EST LA PROPRIÉTÉ QUI EMPÊCHE LA DÉSYNCHRONISATION. Si `typeMimeIcs`
   * acceptait une méthode en argument, un appelant pourrait annoncer
   * `method=REQUEST` sur un fichier `METHOD:CANCEL` — pire qu'une absence
   * d'annonce, car le client appliquerait la mauvaise opération.
   */
  assert.match(ICS_SOURCE, /export function typeMimeIcs\(contenuIcs: string\): string/);
  const corps = ICS_SOURCE.slice(ICS_SOURCE.indexOf("export function typeMimeIcs"));
  const bloc = corps.slice(0, corps.indexOf("\n}"));
  assert.match(bloc, /methodeDeclaree\(contenuIcs\)/, "la méthode est relue sur le contenu");
  assert.ok(!/methode: MethodeIcs/.test(bloc), "aucune méthode fournie de l'extérieur");
});

await test("CODE-03 l'échappement des paramètres est distinct de celui des valeurs", () => {
  assert.match(ICS_SOURCE, /function echapperParametre\(valeur: string\): string/);
  assert.match(ICS_SOURCE, /CN=\$\{echapperParametre\(input\.organizerName\)\}/);
  assert.match(ICS_SOURCE, /CN=\$\{echapperParametre\(input\.attendeeName\)\}/);
  assert.ok(
    !/CN=\$\{escapeIcsText\(/.test(ICS_SOURCE),
    "escapeIcsText échappe des VALEURS : l'utiliser sur un paramètre produit un CN invalide",
  );
  // Les valeurs de propriété, elles, gardent bien escapeIcsText.
  assert.match(ICS_SOURCE, /SUMMARY:\$\{escapeIcsText\(input\.title\)\}/);
});

await test("CODE-04 les acquis des lots 2 et 3 sont intacts", () => {
  assert.ok(!ICS_SOURCE.includes('method === "CANCEL" ? "METHOD:CANCEL" : null'), "pas de METHOD dans le VEVENT");
  assert.match(ICS_SOURCE, /const LIMITE_OCTETS_PAR_LIGNE = 75/, "pliage en octets");
  assert.match(ICS_SOURCE, /new TextEncoder\(\)/);
  assert.ok(!ROUTE_CODE.includes("getPrimaryCoachInfo"), "aucun coach principal");
  assert.match(ROUTE_CODE, /getCoachProprietaireRendezVous\(adminSupabase, appointment\.coachId\)/);
  assert.match(ROUTE_CODE, /dtstamp: original\.updatedAt/, "DTSTAMP déterministe");
  assert.match(ROUTE_CODE, /attachments: \[envoi\.piece\]/, "un seul .ics par e-mail");
});

/* ═══════════════════════ 4. Contre-épreuves ═══════════════════════ */

await test("CONTRE-A1 type MIME nu, sans `method` : CONF-01 passe au rouge", () => {
  const piece = annulation(CRENEAU_INITIAL, "eleve", COACH_A);
  const fautif: PieceJointe = { ...piece, contentType: "text/calendar" };
  assert.throws(
    () => assert.ok(fautif.contentType.endsWith(`method=${methodeDeclaree(fautif.content)}`)),
    "CONF-01 doit échouer",
  );
  // L'agenda simulé, lui, est tolérant : c'est précisément pourquoi ce défaut
  // ne peut PAS être détecté par le modèle, seulement par CONF-01 et par un
  // essai réel sur Apple Mail.
  const agenda = new AgendaSimule();
  agenda.appliquer(invitation(CRENEAU_INITIAL, "eleve", COACH_A));
  agenda.appliquer(fautif);
  assert.deepEqual(agenda.uids(), [], "le modèle applique quand même l'annulation");
});

await test("CONTRE-A2 `method=REQUEST` annoncé sur un fichier CANCEL : détecté des deux côtés", () => {
  const piece = annulation(CRENEAU_INITIAL, "eleve", COACH_A);
  const fautif: PieceJointe = { ...piece, contentType: "text/calendar; charset=utf-8; method=REQUEST" };
  assert.throws(
    () => assert.ok(fautif.contentType.endsWith(`method=${methodeDeclaree(fautif.content)}`)),
    "CONF-01 doit échouer",
  );
  const agenda = new AgendaSimule();
  agenda.appliquer(invitation(CRENEAU_INITIAL, "eleve", COACH_A));
  agenda.appliquer(fautif);
  assert.deepEqual(agenda.uids(), [UID_INITIAL], "l'événement reste : l'annulation a été refusée");
  assert.deepEqual(agenda.refus, ["MIME method=REQUEST contre METHOD:CANCEL"]);
});

await test("CONTRE-A3 annulation sur un NOUVEL UID : l'ancien créneau survit", () => {
  const agenda = new AgendaSimule();
  agenda.appliquer(invitation(CRENEAU_INITIAL, "eleve", COACH_A));
  // Le défaut du lot 3 : annuler avec l'UID du report.
  const fautif = annulation({ ...CRENEAU_INITIAL, uid: UID_REPORT }, "eleve", COACH_A);
  agenda.appliquer(fautif);
  agenda.appliquer(invitation(CRENEAU_REPORTE, "eleve", COACH_A));
  assert.deepEqual(agenda.uids(), [UID_INITIAL, UID_REPORT].sort(), "DEUX créneaux : le doublon est reproduit");
  assert.throws(() => assert.equal(agenda.evenements.size, 1), "AGENDA-03 doit échouer");
});

await test("CONTRE-A4 SEQUENCE du CANCEL non incrémentée : la révision reste acceptable", () => {
  /*
   * Mesure honnête : à SEQUENCE égale, un client conforme accepte encore la
   * révision (la RFC n'exige qu'une séquence NON INFÉRIEURE). Le danger réel
   * est une séquence qui RECULE — c'est ce que ce cas démontre.
   */
  const agenda = new AgendaSimule();
  agenda.appliquer(invitation({ ...CRENEAU_INITIAL }, "eleve", COACH_A));
  const recule = buildCancellationIcs({ ...entree(CRENEAU_INITIAL, "eleve", COACH_A), sequence: -3 });
  const piece: PieceJointe = { filename: "x.ics", content: recule, contentType: typeMimeIcs(recule) };
  assert.equal(valeur(recule, "SEQUENCE"), "-2", "séquence inférieure à celle de l'invitation");
  agenda.appliquer(piece);
  assert.deepEqual(agenda.uids(), [UID_INITIAL], "annulation périmée refusée, l'événement reste");
  assert.deepEqual(agenda.refus, [`CANCEL périmé sur ${UID_INITIAL}`]);
});

await test("CONTRE-A5 CN non cité : la virgule scinde la VALEUR, le deux-points détruit la propriété", () => {
  /*
   * ⚠️ PRÉMISSE CORRIGÉE APRÈS MESURE. J'avais écrit que la virgule scindait
   * les PARAMÈTRES : c'est faux. RFC 5545 §3.2 : les paramètres se séparent
   * par `;`, et la virgule sépare les VALEURS d'un même paramètre. Les deux
   * dégâts réels sont donc :
   *   - virgule non citée → le CN devient une liste de deux valeurs, et le
   *     client n'affiche que la première ;
   *   - deux-points non cité → il ferme la section des paramètres, et toute
   *     la valeur de la propriété (le `mailto:`) part à la poubelle.
   */
  // (a) virgule.
  const fautifVirgule = "ORGANIZER;CN=Jules FAVIER, JR:mailto:j@e.test";
  assert.deepEqual(parametres(fautifVirgule), ["CN=Jules FAVIER, JR"], "un seul paramètre, mais…");
  assert.deepEqual(valeursDuParametre(parametres(fautifVirgule)[0]), ["Jules FAVIER", " JR"], "…deux valeurs de CN");
  const citeVirgule = champ(
    invitation(CRENEAU_INITIAL, "eleve", { name: "Jules Favier, Jr", email: "j@e.test" }).content,
    "ORGANIZER",
  );
  assert.deepEqual(valeursDuParametre(parametres(citeVirgule)[0]), ['"Jules FAVIER, JR"'], "cité : une seule valeur");
  assert.throws(
    () => assert.deepEqual(valeursDuParametre(parametres(fautifVirgule)[0]).length, 1),
    "la version non citée doit être détectée",
  );

  // (b) deux-points — le cas destructeur.
  const fautifDeuxPoints = "ORGANIZER;CN=Coach: Jules:mailto:j@e.test";
  assert.deepEqual(parametres(fautifDeuxPoints), ["CN=Coach"], "le CN est tronqué");
  assert.notEqual(
    fautifDeuxPoints.slice(indexValeur(fautifDeuxPoints) + 1),
    "mailto:j@e.test",
    "la valeur de la propriété est détruite",
  );
  const citeDeuxPoints = champ(
    invitation(CRENEAU_INITIAL, "eleve", { name: "Coach: Jules", email: "j@e.test" }).content,
    "ORGANIZER",
  );
  assert.match(citeDeuxPoints, /CN="COACH: JULES"|CN="Coach: JULES"/, `CN non cité : ${citeDeuxPoints}`);
  assert.equal(
    citeDeuxPoints.slice(indexValeur(citeDeuxPoints) + 1),
    "mailto:j@e.test",
    "cité, l'adresse survit : c'est tout l'objet de CONF-12",
  );
});

await test("CONTRE-A6 flux sans CRLF final : CONF-04 passe au rouge", () => {
  const piece = invitation(CRENEAU_INITIAL, "eleve", COACH_A);
  const fautif = piece.content.replace(/\r\n$/, "");
  assert.ok(!fautif.endsWith("END:VCALENDAR\r\n"));
  assert.throws(() => assert.ok(fautif.endsWith("END:VCALENDAR\r\n")), "CONF-04 doit échouer");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
