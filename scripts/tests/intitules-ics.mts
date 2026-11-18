/**
 * Harnais — LOT 2 : invitations calendrier personnalisées par destinataire.
 *
 * Ce que ce fichier prouve, et comment :
 *
 *  1. Les fonctions de `lib/ics-intitules.ts` et de `lib/ics.ts` sont
 *     importées POUR DE VRAI : les intitulés et les deux fichiers .ics sont
 *     construits par le code de production, pas reproduits ici.
 *  2. Les deux invitations d'un même rendez-vous sont comparées LIGNE À
 *     LIGNE : l'exigence « seul le SUMMARY diffère » est vérifiée comme un
 *     écart unique, pas comme une liste de champs qu'on aurait pensé à citer.
 *  3. Des assertions de TEXTE figent ce que les fonctions pures ne peuvent
 *     pas attraper : la disparition de `getPrimaryCoachInfo` des trois
 *     parcours, deux tableaux de pièces jointes distincts, l'absence de tout
 *     repli sur un coach arbitraire, et l'emplacement de la nouvelle fonction
 *     dans `lib/supabase/appointments.ts`.
 *  4. Chaque famille d'assertions a sa CONTRE-ÉPREUVE : on réintroduit le
 *     défaut et on vérifie que le test passe au rouge.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. Aucune base n'est touchée et aucun
 * email n'est envoyé : que la bonne adresse reçoive le bon fichier se vérifie
 * à la recette, boîte en main. Ici on prouve que le CODE compose deux
 * invitations distinctes et ne nomme jamais un coach qu'il n'a pas lu.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/intitules-ics.mts
 */
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCancellationIcs, buildConfirmationIcs, type IcsAppointmentInput } from "../../lib/ics";
import {
  construireIntituleIcs,
  decouperNomCoach,
  formaterIdentiteCoach,
  formaterIdentiteEleve,
  formaterPrenomNom,
  INTITULE_SECOURS_COACH,
  INTITULE_SECOURS_ELEVE,
  type DestinataireIcs,
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

/**
 * ⚠️ LES ASSERTIONS D'ABSENCE SE FONT SUR LE CODE, PAS SUR LA PROSE. La
 * route, `recompose.ts` et la carte EXPLIQUENT en commentaire ce qu'elles
 * cessent de faire (« getPrimaryCoachInfo », « coach principal », « Coaching
 * en salle »…). Chercher ces chaînes dans le texte brut les trouverait dans
 * les commentaires et rendrait l'assertion toujours verte.
 */
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const ROUTE = lire("../../app/api/email/appointment-notification/route.ts");
const ROUTE_CODE = sansCommentairesTs(ROUTE);
const RECOMPOSE = lire("../../lib/email/recompose.ts");
const RECOMPOSE_CODE = sansCommentairesTs(RECOMPOSE);
const CARTE = lire("../../components/student/AppointmentCard.tsx");
const CARTE_CODE = sansCommentairesTs(CARTE);
const APPOINTMENTS = lire("../../lib/supabase/appointments.ts");
const APPOINTMENTS_CODE = sansCommentairesTs(APPOINTMENTS);
const PAGE_ELEVE = lire("../../app/(student)/rendez-vous/page.tsx");
const ICS = lire("../../lib/ics.ts");
const INTITULES = lire("../../lib/ics-intitules.ts");

/* ───────────────────────── Outils d'inspection .ics ───────────────────────── */

function lignes(ics: string): string[] {
  return ics.split("\r\n");
}

/** Toutes les lignes qui diffèrent entre deux invitations, dans l'ordre. */
function ecarts(a: string, b: string): { indice: number; gauche: string; droite: string }[] {
  const la = lignes(a);
  const lb = lignes(b);
  const total = Math.max(la.length, lb.length);
  const sortie: { indice: number; gauche: string; droite: string }[] = [];
  for (let i = 0; i < total; i += 1) {
    if (la[i] !== lb[i]) sortie.push({ indice: i, gauche: la[i] ?? "∅", droite: lb[i] ?? "∅" });
  }
  return sortie;
}

function champ(ics: string, nom: string): string {
  const trouve = lignes(ics).find((l) => l.startsWith(`${nom}:`) || l.startsWith(`${nom};`));
  assert.ok(trouve !== undefined, `propriété ${nom} absente de l'invitation`);
  return trouve;
}

function sommaire(ics: string): string {
  return champ(ics, "SUMMARY").slice("SUMMARY:".length);
}

/** Instant UTC d'une ligne DTSTART/DTEND au format `YYYYMMDDTHHMMSSZ`. */
function instant(ligne: string): number {
  const brut = ligne.slice(ligne.indexOf(":") + 1);
  const iso = `${brut.slice(0, 4)}-${brut.slice(4, 6)}-${brut.slice(6, 8)}T${brut.slice(9, 11)}:${brut.slice(11, 13)}:${brut.slice(13, 15)}Z`;
  const t = Date.parse(iso);
  assert.ok(Number.isFinite(t), `horodatage illisible : ${ligne}`);
  return t;
}

const ELEVE = { prenom: "Thomas", nom: "Martin" };
const COACH_A = "Jules Favier";
const COACH_B = "Sophie Bernard";
const DTSTAMP_FIGE = "2026-11-16T08:30:00.000Z";

/** Les deux invitations d'un même rendez-vous, telles que la route les compose. */
function construireLesDeux(options: {
  nomCoach: string;
  prenomEleve?: string;
  nomEleve?: string;
  annulation?: boolean;
  dtstamp?: string | null;
}): { eleve: string; coach: string; titreEleve: string; titreCoach: string } {
  const identiteEleve = formaterIdentiteEleve(options.prenomEleve ?? ELEVE.prenom, options.nomEleve ?? ELEVE.nom);
  const identiteCoach = formaterIdentiteCoach(options.nomCoach);
  const titreEleve = construireIntituleIcs({ destinataire: "eleve", identiteEleve, identiteCoach });
  const titreCoach = construireIntituleIcs({ destinataire: "coach", identiteEleve, identiteCoach });
  const commun: Omit<IcsAppointmentInput, "title"> = {
    uid: "rdv-2026-11-16-0001",
    description: "Séance de 60 minutes.",
    startAt: "2026-11-20T09:00:00.000Z",
    endAt: "2026-11-20T10:00:00.000Z",
    location: "Salle Nord, Lyon",
    meetingUrl: "https://visio.example.test/abc",
    organizerName: identiteCoach,
    organizerEmail: "coach@example.test",
    attendeeName: options.prenomEleve ?? ELEVE.prenom,
    attendeeEmail: "eleve@example.test",
    ...(options.dtstamp === null ? {} : { dtstamp: options.dtstamp ?? DTSTAMP_FIGE }),
  };
  const bati = (titre: string): string => {
    const entree: IcsAppointmentInput = { ...commun, title: titre };
    return options.annulation ? buildCancellationIcs(entree) : buildConfirmationIcs(entree);
  };
  return { eleve: bati(titreEleve), coach: bati(titreCoach), titreEleve, titreCoach };
}

/* ═════════════════════════ A. Formatage des identités ═════════════════════════ */

await test("FMT-01 élève complet : prénom tel quel, nom en majuscules", () => {
  assert.equal(formaterIdentiteEleve("Thomas", "Martin"), "Thomas MARTIN");
});

await test("FMT-02 élève sans nom de famille : on rend le prénom, sans rien inventer", () => {
  assert.equal(formaterIdentiteEleve("Thomas", ""), "Thomas");
  assert.equal(formaterIdentiteEleve("Thomas", "   "), "Thomas");
});

await test("FMT-03 élève sans prénom : on rend le nom seul, en majuscules", () => {
  assert.equal(formaterIdentiteEleve("", "Martin"), "MARTIN");
});

await test("FMT-04 élève entièrement vide : chaîne vide, pas un libellé bricolé", () => {
  assert.equal(formaterIdentiteEleve("", ""), "");
  assert.equal(formaterIdentiteEleve("  ", "\t"), "");
});

await test("FMT-05 espaces parasites normalisés aux deux extrémités", () => {
  assert.equal(formaterIdentiteEleve("  Thomas ", " Martin  "), "Thomas MARTIN");
});

await test("FMT-06 les accents passent en majuscules accentuées", () => {
  assert.equal(formaterIdentiteEleve("Élise", "Lefèvre"), "Élise LEFÈVRE");
  assert.equal(formaterPrenomNom("Noé", "Çağlar"), "Noé ÇAĞLAR");
});

await test("FMT-07 coach en deux mots : découpage au premier espace", () => {
  assert.equal(formaterIdentiteCoach("Jules Favier"), "Jules FAVIER");
});

await test("FMT-08 un nom déjà en majuscules reste stable (idempotence)", () => {
  assert.equal(formaterIdentiteCoach("Jules FAVIER"), "Jules FAVIER");
  assert.equal(formaterIdentiteEleve("Thomas", "MARTIN"), "Thomas MARTIN");
});

await test("FMT-09 coach en trois mots : tout le reste est le nom", () => {
  assert.equal(formaterIdentiteCoach("Jean-Pierre De La Tour"), "Jean-Pierre DE LA TOUR");
  assert.deepEqual(decouperNomCoach("Jean-Pierre De La Tour"), { prenom: "Jean-Pierre", nom: "De La Tour" });
});

await test("FMT-10 coach en un seul mot : nom complet conservé, jamais complété", () => {
  // ⚠️ ÉCART MESURÉ AVEC LE SQL, assumé. `get_my_coach_public_profile`
  // (migration 20260726220000) rend le mot DEUX fois pour un nom sans espace
  // (`strpos` vaut 0, donc `substr(name, 1)` rend la chaîne entière), et
  // getMyCoachPublicInfo les recolle en « Jules Jules ». Ici le nom de
  // famille est vide et l'intitulé rend « Jules » : c'est la convention
  // ÉNONCÉE (« reste = nom »), pas l'accident du strpos. La migration n'est
  // pas touchée par ce lot.
  assert.deepEqual(decouperNomCoach("Jules"), { prenom: "Jules", nom: "" });
  assert.equal(formaterIdentiteCoach("Jules"), "Jules");
});

await test("FMT-11 coach sans nom : chaîne vide, pas de coach fabriqué", () => {
  assert.equal(formaterIdentiteCoach(""), "");
  assert.equal(formaterIdentiteCoach("   "), "");
  assert.deepEqual(decouperNomCoach(""), { prenom: "", nom: "" });
});

await test("FMT-12 espaces de tête : normalisés ici, contrairement au SQL", () => {
  // Le SQL ne `trim()` pas avant de découper : « ␣Jules FAVIER » lui donne un
  // prénom VIDE. La normalisation déplace la propreté, pas le point de
  // découpe — c'est le seul écart, et il est testé plutôt que supposé.
  assert.deepEqual(decouperNomCoach("  Jules FAVIER"), { prenom: "Jules", nom: "FAVIER" });
  assert.deepEqual(decouperNomCoach("Jules  FAVIER"), { prenom: "Jules", nom: "FAVIER" });
});

/* ═════════════════════════ B. Intitulés par destinataire ═════════════════════════ */

await test("INT-01 agenda du coach : « Coaching — Prénom NOM » de l'élève", () => {
  assert.equal(
    construireIntituleIcs({ destinataire: "coach", identiteEleve: "Thomas MARTIN", identiteCoach: "Jules FAVIER" }),
    "Coaching — Thomas MARTIN",
  );
});

await test("INT-02 agenda de l'élève : « Séance de coaching — Prénom NOM » du coach", () => {
  assert.equal(
    construireIntituleIcs({ destinataire: "eleve", identiteEleve: "Thomas MARTIN", identiteCoach: "Jules FAVIER" }),
    "Séance de coaching — Jules FAVIER",
  );
});

await test("INT-03 élève non identifié : intitulé de secours explicite côté coach", () => {
  assert.equal(
    construireIntituleIcs({ destinataire: "coach", identiteEleve: "", identiteCoach: "Jules FAVIER" }),
    INTITULE_SECOURS_COACH,
  );
  assert.equal(INTITULE_SECOURS_COACH, "Coaching — élève non identifié");
});

await test("INT-04 coach non identifié : intitulé de secours explicite côté élève", () => {
  assert.equal(
    construireIntituleIcs({ destinataire: "eleve", identiteEleve: "Thomas MARTIN", identiteCoach: "" }),
    INTITULE_SECOURS_ELEVE,
  );
  assert.equal(INTITULE_SECOURS_ELEVE, "Séance de coaching — coach non identifié");
});

await test("INT-05 chacun voit l'AUTRE partie, jamais lui-même", () => {
  const args = { identiteEleve: "Thomas MARTIN", identiteCoach: "Jules FAVIER" };
  const titreCoach = construireIntituleIcs({ destinataire: "coach", ...args });
  const titreEleve = construireIntituleIcs({ destinataire: "eleve", ...args });
  assert.ok(!titreCoach.includes("FAVIER"), "l'agenda du coach ne doit pas porter le nom du coach");
  assert.ok(!titreEleve.includes("MARTIN"), "l'agenda de l'élève ne doit pas porter le nom de l'élève");
  assert.notEqual(titreCoach, titreEleve);
});

await test("INT-06 un troisième destinataire est refusé, pas deviné", () => {
  assert.throws(
    () =>
      construireIntituleIcs({
        destinataire: "assistant" as DestinataireIcs,
        identiteEleve: "Thomas MARTIN",
        identiteCoach: "Jules FAVIER",
      }),
    /Destinataire d'invitation inconnu/,
  );
});

/* ═════════════════════════ C. Les deux fichiers .ics ═════════════════════════ */

await test("ICS-01 confirmation : EXACTEMENT une ligne diffère, et c'est SUMMARY", () => {
  const { eleve, coach } = construireLesDeux({ nomCoach: COACH_A });
  const d = ecarts(eleve, coach);
  assert.equal(d.length, 1, `une seule ligne doit différer, or ${d.length} : ${JSON.stringify(d)}`);
  assert.ok(d[0].gauche.startsWith("SUMMARY:"), `la ligne différente doit être SUMMARY, or « ${d[0].gauche} »`);
  assert.ok(d[0].droite.startsWith("SUMMARY:"), `la ligne différente doit être SUMMARY, or « ${d[0].droite} »`);
});

await test("ICS-02 UID, horaires, durée, lieu, visio, statut et séquence partagés", () => {
  const { eleve, coach } = construireLesDeux({ nomCoach: COACH_A });
  for (const nom of ["UID", "DTSTAMP", "DTSTART", "DTEND", "DESCRIPTION", "LOCATION", "URL", "ORGANIZER", "ATTENDEE", "STATUS", "SEQUENCE"]) {
    assert.equal(champ(eleve, nom), champ(coach, nom), `${nom} doit être identique dans les deux invitations`);
  }
  // La durée est recalculée depuis les fichiers, pas supposée depuis l'entrée.
  const dureeEleve = instant(champ(eleve, "DTEND")) - instant(champ(eleve, "DTSTART"));
  const dureeCoach = instant(champ(coach, "DTEND")) - instant(champ(coach, "DTSTART"));
  assert.equal(dureeEleve, 60 * 60 * 1000, "la durée doit valoir 60 minutes");
  assert.equal(dureeEleve, dureeCoach, "les deux invitations doivent porter la même durée");
  // Fuseau : suffixe Z des deux côtés, aucun VTIMEZONE (choix documenté de lib/ics.ts).
  assert.match(champ(eleve, "DTSTART"), /Z$/);
  assert.match(champ(coach, "DTSTART"), /Z$/);
  assert.ok(!eleve.includes("VTIMEZONE") && !coach.includes("VTIMEZONE"));
});

await test("ICS-03 les deux SUMMARY attendus, dans le bon fichier", () => {
  const { eleve, coach } = construireLesDeux({ nomCoach: COACH_A });
  assert.equal(sommaire(coach), "Coaching — Thomas MARTIN");
  assert.equal(sommaire(eleve), "Séance de coaching — Jules FAVIER");
});

await test("ICS-04 annulation : même UID, STATUS:CANCELLED, SEQUENCE incrémentée, un seul écart", () => {
  const { eleve, coach } = construireLesDeux({ nomCoach: COACH_A, annulation: true });
  const confirme = construireLesDeux({ nomCoach: COACH_A });
  assert.equal(champ(eleve, "UID"), champ(confirme.eleve, "UID"), "l'annulation doit porter le même UID");
  assert.equal(champ(eleve, "STATUS"), "STATUS:CANCELLED");
  assert.equal(champ(eleve, "SEQUENCE"), "SEQUENCE:1");
  assert.ok(eleve.includes("METHOD:CANCEL") && coach.includes("METHOD:CANCEL"));
  const d = ecarts(eleve, coach);
  assert.equal(d.length, 1, `une seule ligne doit différer à l'annulation, or ${JSON.stringify(d)}`);
  assert.ok(d[0].gauche.startsWith("SUMMARY:"));
  assert.equal(sommaire(coach), "Coaching — Thomas MARTIN");
  assert.equal(sommaire(eleve), "Séance de coaching — Jules FAVIER");
});

await test("ICS-05 deux coachs différents : deux intitulés élève différents, même élève", () => {
  const a = construireLesDeux({ nomCoach: COACH_A });
  const b = construireLesDeux({ nomCoach: COACH_B });
  assert.equal(sommaire(a.eleve), "Séance de coaching — Jules FAVIER");
  assert.equal(sommaire(b.eleve), "Séance de coaching — Sophie BERNARD");
  assert.notEqual(sommaire(a.eleve), sommaire(b.eleve));
  // Le côté coach ne bouge pas : c'est le même élève qui est reçu.
  assert.equal(sommaire(a.coach), sommaire(b.coach));
});

await test("ICS-06 coach introuvable : l'élève reçoit l'intitulé de secours, le reste intact", () => {
  const { eleve, coach } = construireLesDeux({ nomCoach: "" });
  assert.equal(sommaire(eleve), INTITULE_SECOURS_ELEVE);
  assert.equal(sommaire(coach), "Coaching — Thomas MARTIN");
  assert.ok(!eleve.includes("Favier") && !eleve.includes("FAVIER"), "aucun nom de coach ne doit apparaître");
  assert.equal(champ(eleve, "DTSTART"), champ(coach, "DTSTART"));
});

await test("ICS-07 élève sans nom : secours côté coach, l'élève garde son titre", () => {
  const { eleve, coach } = construireLesDeux({ nomCoach: COACH_A, prenomEleve: "", nomEleve: "" });
  assert.equal(sommaire(coach), INTITULE_SECOURS_COACH);
  assert.equal(sommaire(eleve), "Séance de coaching — Jules FAVIER");
});

await test("ICS-08 sans `dtstamp` fourni, DTSTAMP reste présent (non-régression)", () => {
  const { eleve } = construireLesDeux({ nomCoach: COACH_A, dtstamp: null });
  assert.match(champ(eleve, "DTSTAMP"), /^DTSTAMP:\d{8}T\d{6}Z$/);
});

await test("ICS-09 un nom à virgule ou point-virgule est échappé dans SUMMARY", () => {
  const { coach } = construireLesDeux({ nomCoach: COACH_A, prenomEleve: "Thomas", nomEleve: "Martin, Jr; test" });
  const ligne = champ(coach, "SUMMARY");
  assert.ok(ligne.includes("\\,"), `la virgule doit être échappée : ${ligne}`);
  assert.ok(ligne.includes("\\;"), `le point-virgule doit être échappé : ${ligne}`);
});

/* ═════════════════ D. Les trois parcours, assertions de texte ═════════════════ */

await test("TEXTE-01 la route n'utilise plus le coach principal", () => {
  assert.ok(!ROUTE_CODE.includes("getPrimaryCoachInfo"), "la route ne doit plus appeler getPrimaryCoachInfo");
  assert.ok(!ROUTE_CODE.includes('from("coaches")'), "la route ne doit pas lire coaches à la main");
});

await test("TEXTE-02 la route résout le coach par `appointments.coach_id`, au service role", () => {
  assert.match(
    ROUTE_CODE,
    /getCoachProprietaireRendezVous\(adminSupabase,\s*appointment\.coachId\)/,
    "le propriétaire doit être lu depuis appointment.coachId avec le client service role",
  );
});

await test("TEXTE-03 un fichier par destinataire, jamais un fichier partagé", () => {
  /*
   * ⚠️ FORME REMPLACÉE DEUX FOIS, EXIGENCE INTACTE. Au lot 2, deux littéraux
   * `piecesJointesEleve` / `piecesJointesCoach`. Au lot 3, une fonction
   * `piecesJointesPour(destinataire)`. Au lot 3-bis (17/11/2026), une LISTE
   * D'ENVOIS : un e-mail par événement et par destinataire, chacun avec une
   * seule pièce jointe — deux parties `text/calendar` dans un même message
   * étant traitées de façon imprévisible par les clients de messagerie.
   *
   * Ce qui est vérifié depuis le début ne change pas : aucun fichier n'est
   * partagé entre les deux destinataires, et chacun reçoit un intitulé
   * construit pour lui.
   */
  assert.match(ROUTE_CODE, /attachments: \[envoi\.piece\]/, "une seule pièce jointe par e-mail");
  assert.match(ROUTE_CODE, /const envois: EnvoiPrevu\[\] = \[\]/, "la liste d'envois part vide");
  assert.match(ROUTE_CODE, /destinataire: destinataire\.cle/, "l'intitulé est construit par destinataire");
  assert.ok(!/const attachments = \[/.test(ROUTE_CODE), "aucun tableau partagé entre deux envois");
  assert.ok(!ROUTE_CODE.includes("piecesJointesEleve"), "les deux tableaux du lot 2 ont été remplacés");
});

await test("TEXTE-04 chaque envoi porte SON destinataire et SON intitulé", () => {
  assert.match(ROUTE_CODE, /recipientEmail: envoi\.recipientEmail/, "un destinataire par envoi");
  assert.match(ROUTE_CODE, /relatedEntityId: envoi\.relatedEntityId/, "et sa propre entité de journal");
  // L'élève est servi avant le coach, et l'annulation avant l'invitation.
  const posEleve = ROUTE_CODE.indexOf('role: "student"');
  const posCoach = ROUTE_CODE.indexOf('role: "coach"');
  assert.ok(posEleve > 0 && posCoach > posEleve, "l'élève est empilé avant le coach");
  const posAnnulation = ROUTE_CODE.indexOf('etape: "annulation_ancien"');
  const posCourant = ROUTE_CODE.indexOf('etape: "evenement_courant"');
  assert.ok(posAnnulation > 0 && posCourant > posAnnulation, "l'annulation est empilée avant l'invitation");
  // Le coach n'est ajouté à la liste que si son adresse existe.
  assert.match(ROUTE_CODE, /if \(coach\?\.email\) \{/, "pas de coach sans adresse dans la liste");
});

await test("TEXTE-05 un propriétaire introuvable n'est remplacé par personne", () => {
  /*
   * ⚠️ MÊME EXIGENCE, NOUVEAU POINT D'APPLICATION (lot 3-bis). La garde
   * `if (coachProprietaire?.email)` est devenue `destinatairesPour(coach)` :
   * un coach sans adresse — ou introuvable — n'entre tout simplement pas dans
   * la liste des destinataires, et l'élève y est ajouté indépendamment.
   */
  assert.match(ROUTE_CODE, /function destinatairesPour\(coach: CoachProprietaire \| null\)/);
  assert.match(ROUTE_CODE, /if \(coach\?\.email\) \{/, "le coach n'est servi que s'il a une adresse");
  assert.match(ROUTE_CODE, /if \(student\?\.email\) \{/, "l'élève est ajouté indépendamment du coach");
  assert.ok(
    !/coachProprietaire \?\?[\s\S]{0,80}getPrimaryCoachInfo/.test(ROUTE_CODE),
    "aucun repli sur le coach principal",
  );
  // La liste de l'élève est construite AVANT celle du coach, et rien n'arrête
  // la notification de l'élève quand le coach manque.
  const corps = ROUTE_CODE.slice(ROUTE_CODE.indexOf("function destinatairesPour"));
  const bloc = corps.slice(0, corps.indexOf("return liste;"));
  assert.ok(bloc.indexOf('role: "student"') < bloc.indexOf('role: "coach"'), "l'élève d'abord");
  assert.ok(!/\breturn liste\b[\s\S]{0,40}if \(student/.test(bloc), "aucune sortie anticipée avant l'élève");
});

await test("TEXTE-06 l'anomalie est journalisée explicitement et remontée dans la réponse", () => {
  assert.match(ROUTE_CODE, /if \(!coachProprietaire\) \{[\s\S]{0,400}console\.error\(/, "un avertissement doit être journalisé");
  assert.match(ROUTE, /coach propriétaire introuvable/, "l'avertissement doit nommer la cause");
  assert.match(ROUTE_CODE, /skipped_coach_proprietaire_introuvable/, "la réponse doit signaler l'envoi coach non effectué");
});

await test("TEXTE-07 le renvoi administratif suit la même source de vérité", () => {
  assert.ok(!RECOMPOSE_CODE.includes("getPrimaryCoachInfo"), "recompose ne doit plus lire le coach principal");
  assert.match(RECOMPOSE_CODE, /getCoachProprietaireRendezVous\(supabase,\s*appointment\.coachId\)/);
  assert.match(
    RECOMPOSE_CODE,
    /destinataire: isCoachRecipient \? "coach" : "eleve"/,
    "l'intitulé du renvoi doit suivre le rôle journalisé",
  );
});

await test("TEXTE-08 le téléchargement élève vérifie que le titulaire EST le propriétaire", () => {
  assert.match(
    CARTE_CODE,
    /appointment\.coachId === coachTitulaireId/,
    "la carte doit comparer le propriétaire du rendez-vous au coach titulaire",
  );
  assert.match(CARTE_CODE, /construireIntituleIcs\(\{/, "la carte doit utiliser le même constructeur d'intitulé");
  assert.ok(!/title: appointment\.title/.test(CARTE_CODE), "le titre brut du rendez-vous ne doit plus servir d'intitulé");
});

await test("TEXTE-09 la carte ne peut pas retomber sur un coach arbitraire", () => {
  assert.ok(!CARTE_CODE.includes("getPrimaryCoachInfo"), "aucun coach principal côté navigateur");
  assert.ok(!CARTE_CODE.includes('from("coaches")'), "aucune lecture directe de coaches côté navigateur");
  assert.ok(!CARTE_CODE.includes('"Ton coach"'), "le libellé d'attente ne doit pas servir d'identité");
  // La page transmet bien l'identifiant aux DEUX listes (à venir et passés).
  assert.equal(
    (PAGE_ELEVE.match(/coachTitulaireId=\{coachInfo\.coachId\}/g) ?? []).length,
    2,
    "les deux listes de rendez-vous doivent recevoir l'identifiant du coach titulaire",
  );
});

await test("TEXTE-10 la nouvelle fonction est placée APRÈS getPrimaryCoachInfo", () => {
  /*
   * ⚠️ CONTRAINTE DE TEST, PAS PRÉFÉRENCE DE STYLE. Le cas 30 de
   * scripts/tests/security-hardening.mts découpe appointments.ts ENTRE
   * getMyCoachPublicInfo et getPrimaryCoachInfo et asserte qu'aucun
   * `from("coaches")` n'y figure. Une fonction qui lit coaches posée dans cet
   * intervalle rendrait ce test rouge à tort.
   */
  const posPublic = APPOINTMENTS.indexOf("export async function getMyCoachPublicInfo");
  const posPrimary = APPOINTMENTS.indexOf("export async function getPrimaryCoachInfo");
  const posNouvelle = APPOINTMENTS.indexOf("export async function getCoachProprietaireRendezVous");
  assert.ok(posPublic > 0 && posPrimary > posPublic, "ordre historique conservé");
  assert.ok(posNouvelle > posPrimary, "getCoachProprietaireRendezVous doit suivre getPrimaryCoachInfo");
  const tranche = APPOINTMENTS.slice(posPublic, posPrimary);
  assert.ok(!tranche.includes('from("coaches")'), "la tranche surveillée par security-hardening doit rester propre");
});

await test("TEXTE-11 la résolution du propriétaire ne contient aucun repli", () => {
  const corps = APPOINTMENTS_CODE.slice(
    APPOINTMENTS_CODE.indexOf("export async function getCoachProprietaireRendezVous"),
  ).slice(0, 700);
  assert.match(corps, /if \(!coachId\) return null/, "un coach_id nul rend null");
  assert.match(corps, /\.eq\("id", coachId\)/, "la lecture est filtrée sur l'identifiant du propriétaire");
  assert.ok(!corps.includes("getPrimaryCoachInfo"), "aucun repli sur le coach principal");
  assert.ok(!corps.includes("order("), "aucun tri : on ne prend pas « le premier » coach");
  assert.ok(!corps.includes("limit("), "aucune limite : on ne prend pas « le premier » coach");
});

await test("TEXTE-12 getMyCoachPublicInfo rend l'identifiant sans exposer l'email", () => {
  const corps = APPOINTMENTS.slice(
    APPOINTMENTS.indexOf("export async function getMyCoachPublicInfo"),
    APPOINTMENTS.indexOf("export async function getPrimaryCoachInfo"),
  );
  assert.match(corps, /coachId: ligne\.coach_id \?\? null/, "l'identifiant du coach titulaire doit sortir de la RPC");
  assert.match(corps, /email: ""/, "l'email du coach ne doit toujours pas sortir vers le navigateur");
  assert.ok(!corps.includes('from("coaches")'), "toujours aucune lecture directe de coaches");
});

await test("TEXTE-13 les deux défauts gelés par le lot 2 ont été corrigés au lot 3", () => {
  /*
   * ⚠️ ASSERTION RETOURNÉE, PAS SUPPRIMÉE (17/11/2026). Au lot 2 elle était
   * INVERSE à dessein : le doublon `METHOD` dans le `VEVENT` et le pliage à
   * 75 caractères ne devaient PAS être corrigés, et ce test interdisait de les
   * toucher en silence. Le lot 3 les a corrigés sur décision explicite, donc
   * la même assertion interdit maintenant leur RETOUR. La couverture
   * détaillée des deux correctifs vit dans scripts/tests/ics-cycle-de-vie.mts
   * (RFC-01 à RFC-05) ; ici on garde la sentinelle.
   */
  assert.ok(!/method === "CANCEL" \? "METHOD:CANCEL" : null/.test(ICS), "METHOD ne doit plus être émis dans le VEVENT");
  assert.ok(!/if \(line\.length <= 75\) return line/.test(ICS), "le pliage ne doit plus se mesurer en caractères");
  assert.match(ICS, /const LIMITE_OCTETS_PAR_LIGNE = 75/, "la limite est désormais exprimée en octets");
  // Et la ligne ORGANIZER reste conditionnée à la présence de l'email
  // (exigence du cas 30 de security-hardening, non touchée).
  assert.match(ICS, /input\.organizerEmail\s*\n?\s*\?\s*`ORGANIZER/);
});

await test("TEXTE-14 le module d'intitulés ne lit rien et n'invente rien", () => {
  const code = sansCommentairesTs(INTITULES);
  assert.ok(!code.includes("supabase"), "le module d'intitulés ne doit toucher à aucune base");
  assert.ok(!code.includes("fetch("), "ni au réseau");
  assert.match(code, /const jamais: never = entree\.destinataire/, "exhaustivité confiée au compilateur");
  for (const attendu of ["Coaching", "Séance de coaching", "élève non identifié", "coach non identifié"]) {
    assert.ok(INTITULES.includes(attendu), `le libellé « ${attendu} » doit être défini ici`);
  }
});

/* ═════════════════════════ E. Contre-épreuves ═════════════════════════ */

await test("CONTRE-01 sans majuscules sur le nom, FMT-01 passe au rouge", () => {
  const fautif = (prenom: string, nom: string): string => `${prenom} ${nom}`.trim();
  assert.notEqual(fautif("Thomas", "Martin"), "Thomas MARTIN");
  assert.throws(() => assert.equal(fautif("Thomas", "Martin"), "Thomas MARTIN"));
});

await test("CONTRE-02 sans intitulé de secours, un titre tronqué passerait", () => {
  const fautif = (identite: string): string => `Séance de coaching — ${identite}`;
  assert.equal(fautif(""), "Séance de coaching — ");
  assert.notEqual(fautif(""), INTITULE_SECOURS_ELEVE);
  // Le vrai constructeur refuse ce titre.
  assert.equal(
    construireIntituleIcs({ destinataire: "eleve", identiteEleve: "Thomas MARTIN", identiteCoach: "" }),
    INTITULE_SECOURS_ELEVE,
  );
});

await test("CONTRE-03 deux DTSTAMP différents : ICS-01 détecte le second écart", () => {
  const commun = {
    uid: "u", description: "d", startAt: "2026-11-20T09:00:00.000Z", endAt: "2026-11-20T10:00:00.000Z",
    location: "L", meetingUrl: "", organizerName: "Jules FAVIER", organizerEmail: "c@e.test",
    attendeeName: "Thomas", attendeeEmail: "e@e.test",
  };
  const a = buildConfirmationIcs({ ...commun, title: "Séance de coaching — Jules FAVIER", dtstamp: "2026-11-16T08:30:00.000Z" });
  const b = buildConfirmationIcs({ ...commun, title: "Coaching — Thomas MARTIN", dtstamp: "2026-11-16T08:30:01.000Z" });
  const d = ecarts(a, b);
  assert.equal(d.length, 2, "deux écarts attendus : DTSTAMP et SUMMARY");
  assert.throws(() => assert.equal(ecarts(a, b).length, 1), "ICS-01 doit échouer sur cette paire");
});

await test("CONTRE-04 un titre unique pour les deux : ICS-03 passe au rouge", () => {
  const identiteEleve = formaterIdentiteEleve(ELEVE.prenom, ELEVE.nom);
  const identiteCoach = formaterIdentiteCoach(COACH_A);
  // Le défaut d'origine : le même titre pour tout le monde.
  const titreUnique = construireIntituleIcs({ destinataire: "eleve", identiteEleve, identiteCoach });
  assert.throws(
    () => assert.equal(titreUnique, construireIntituleIcs({ destinataire: "coach", identiteEleve, identiteCoach })),
    "deux destinataires doivent produire deux titres",
  );
});

await test("CONTRE-05 le coach principal réintroduit dans la route : TEXTE-01 passe au rouge", () => {
  const fautif = ROUTE_CODE.replace(
    "getCoachProprietaireRendezVous(adminSupabase, appointment.coachId)",
    "getPrimaryCoachInfo(adminSupabase)",
  );
  assert.notEqual(fautif, ROUTE_CODE, "la mutation doit s'appliquer");
  assert.throws(() => assert.ok(!fautif.includes("getPrimaryCoachInfo")), "TEXTE-01 doit échouer sur la version fautive");
});

await test("CONTRE-06 une pièce jointe partagée : TEXTE-03 passe au rouge", () => {
  // Le défaut d'avant le lot 2 : un seul tableau, construit une fois, passé
  // aux deux envois.
  const fautif = ROUTE_CODE
    .replace("attachments: [envoi.piece]", "attachments")
    .replace("const envois: EnvoiPrevu[] = []", "const attachments = [envoi.piece]");
  assert.notEqual(fautif, ROUTE_CODE, "la mutation doit s'appliquer");
  assert.throws(() => assert.match(fautif, /attachments: \[envoi\.piece\]/), "TEXTE-03 doit échouer");
  assert.throws(() => assert.ok(!/const attachments = \[/.test(fautif)), "et détecter le tableau partagé");
});

await test("CONTRE-07 la fonction déplacée avant getPrimaryCoachInfo : TEXTE-10 passe au rouge", () => {
  const posPrimary = APPOINTMENTS.indexOf("export async function getPrimaryCoachInfo");
  const fautif =
    APPOINTMENTS.slice(0, posPrimary) +
    'export async function getCoachProprietaireRendezVous() { return supabase.from("coaches"); }\n\n' +
    APPOINTMENTS.slice(posPrimary);
  const tranche = fautif.slice(
    fautif.indexOf("export async function getMyCoachPublicInfo"),
    fautif.indexOf("export async function getPrimaryCoachInfo"),
  );
  assert.throws(() => assert.ok(!tranche.includes('from("coaches")')), "la tranche surveillée doit devenir rouge");
});

await test("CONTRE-08 un titre coach portant le nom du coach : INT-05 passe au rouge", () => {
  const fautif = "Coaching — Jules FAVIER";
  assert.throws(() => assert.ok(!fautif.includes("FAVIER")), "INT-05 doit échouer sur ce titre");
  assert.equal(
    construireIntituleIcs({ destinataire: "coach", identiteEleve: "Thomas MARTIN", identiteCoach: "Jules FAVIER" }),
    "Coaching — Thomas MARTIN",
  );
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
