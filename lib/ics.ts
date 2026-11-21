/**
 * Génération d'invitations calendrier .ics (RFC 5545), sans dépendance
 * externe. Utilisé pour la confirmation (METHOD:REQUEST) et l'annulation
 * (METHOD:CANCEL, STATUS:CANCELLED) d'un rendez-vous — voir
 * lib/supabase/appointments.ts et lib/email/appointment-emails.ts.
 *
 * Les horaires sont formatés en UTC (suffixe Z, dérivé de l'instant absolu
 * stocké en base) plutôt qu'avec un bloc VTIMEZONE complet : plus simple à
 * générer correctement, et interprété sans ambiguïté par Apple Calendar,
 * Google Calendar et Outlook (ils convertissent l'UTC vers le fuseau local
 * de l'utilisateur à l'affichage).
 */

/** Les deux seules méthodes iTIP produites par ce module. */
export type MethodeIcs = "REQUEST" | "CANCEL";

export interface IcsAppointmentInput {
  uid: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  location: string;
  meetingUrl: string;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
  /** Incrémenté à chaque mise à jour du même événement (report, annulation) — RFC 5545 SEQUENCE. */
  sequence?: number;
  /**
   * `DTSTAMP` imposé, en ISO — facultatif, par défaut l'instant de l'appel.
   *
   * ⚠️ SERT À PROUVER QUE SEUL LE SUMMARY DIFFÈRE. Depuis le lot 2, un même
   * rendez-vous produit DEUX invitations (une par destinataire) construites
   * par deux appels distincts. Sans cette entrée, chacun relirait l'horloge
   * et les deux fichiers pourraient différer d'une seconde sur `DTSTAMP` —
   * un écart inoffensif pour les clients de calendrier, mais qui rendrait
   * indémontrable l'exigence « seul le SUMMARY diffère ». L'appelant passe
   * donc un seul instant pour les deux.
   */
  dtstamp?: string;
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Valeur de PARAMÈTRE (`CN=…`), qui ne s'échappe PAS comme une valeur de
 * propriété.
 *
 * ⚠️ DEUX GRAMMAIRES DIFFÉRENTES, ET `escapeIcsText` NE VAUT QUE POUR L'UNE.
 * RFC 5545 §3.1 : dans une valeur de propriété, `;` et `,` se préfixent d'une
 * barre oblique inverse ; dans un paramètre, la barre oblique inverse n'a
 * AUCUN sens — il faut entourer la valeur de guillemets. « Martin, Jr »
 * produisait donc `CN=Martin\, Jr`, que les analyseurs stricts lisent comme
 * deux paramètres, le second étant invalide. Les guillemets eux-mêmes ne
 * pouvant pas être échappés dans un paramètre cité, ils sont retirés, ainsi
 * que les retours à la ligne.
 */
function echapperParametre(valeur: string): string {
  const propre = (valeur ?? "").replace(/["\r\n]/g, " ").trim();
  return /[:;,]/.test(propre) ? `"${propre}"` : propre;
}

function formatUtc(dateIso: string): string {
  return new Date(dateIso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** RFC 5545 §3.1 : une ligne ne doit pas dépasser 75 OCTETS, saut de ligne non compté. */
const LIMITE_OCTETS_PAR_LIGNE = 75;

/**
 * `TextEncoder` et non `Buffer` : ce module est importé par du code client
 * (`components/student/AppointmentCard.tsx`, bouton « Télécharger .ics »), où
 * `Buffer` n'existe pas sans polyfill.
 */
const ENCODEUR_UTF8 = new TextEncoder();

function tailleEnOctets(valeur: string): number {
  return ENCODEUR_UTF8.encode(valeur).length;
}

/**
 * Découpe les lignes > 75 octets selon le "folding" de RFC 5545 §3.1.
 *
 * ⚠️ 75 OCTETS, PAS 75 CARACTÈRES — défaut B corrigé le 17/11/2026. La
 * version précédente découpait sur `String.prototype.slice`, donc sur des
 * unités UTF-16 : une ligne de 75 caractères accentués pèse jusqu'à 150
 * octets et sortait hors limite, et une paire de substituts (emoji) pouvait
 * être tranchée en deux moitiés invalides. Le découpage se fait désormais
 * caractère par caractère (`for…of` itère les POINTS DE CODE), en mesurant
 * chacun en octets UTF-8 : aucune séquence multioctet n'est jamais coupée.
 *
 * ⚠️ LA LIMITE S'APPLIQUE À LA LIGNE ÉMISE, espace de continuation compris.
 * Une ligne de continuation commence par une espace que le "unfolding"
 * retirera ; cette espace occupe un octet, d'où 74 octets utiles au-delà du
 * premier segment.
 *
 * Reste hors de portée : un groupe de graphèmes (« e » suivi d'un accent
 * combinant) peut encore être séparé entre deux segments. La RFC n'interdit
 * que la coupure d'un caractère, et le "unfolding" du client recolle la
 * chaîne à l'identique — l'affichage final est donc correct.
 */
function foldLine(line: string): string {
  if (tailleEnOctets(line) <= LIMITE_OCTETS_PAR_LIGNE) return line;
  const segments: string[] = [];
  let courant = "";
  let octetsCourants = 0;
  let budget = LIMITE_OCTETS_PAR_LIGNE;
  for (const caractere of line) {
    const taille = tailleEnOctets(caractere);
    if (octetsCourants + taille > budget) {
      segments.push(courant);
      courant = "";
      octetsCourants = 0;
      budget = LIMITE_OCTETS_PAR_LIGNE - 1;
    }
    courant += caractere;
    octetsCourants += taille;
  }
  if (courant !== "") segments.push(courant);
  return segments.map((segment, rang) => (rang === 0 ? segment : ` ${segment}`)).join("\r\n");
}

/**
 * ⚠️ `METHOD` N'EST PLUS ÉMIS ICI — défaut A corrigé le 17/11/2026. La RFC
 * 5545 §3.7.2 place `METHOD` au niveau du COMPOSANT CALENDRIER, et nulle part
 * ailleurs. L'annulation en produisait deux : celle de `VCALENDAR`, correcte,
 * et une seconde à l'intérieur du `VEVENT`. D'où la disparition du paramètre
 * `method` : il ne servait qu'à cette ligne fautive, et le statut suffit à
 * distinguer les deux cas.
 */
function buildEvent(input: IcsAppointmentInput, status: "CONFIRMED" | "CANCELLED"): string {
  const nowStamp = formatUtc(input.dtstamp ?? new Date().toISOString());
  const lines = [
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART:${formatUtc(input.startAt)}`,
    `DTEND:${formatUtc(input.endAt)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(input.description)}`,
    input.location ? `LOCATION:${escapeIcsText(input.location)}` : null,
    input.meetingUrl ? `URL:${escapeIcsText(input.meetingUrl)}` : null,
    // ORGANIZER est facultatif en RFC 5545, mais un `mailto:` vide produit une
    // ligne invalide que certains clients rejettent. Côté élève, l'email du
    // coach n'est volontairement plus exposé (RLS `coaches`, audit 26/07/2026)
    // : la ligne est alors omise plutôt que tronquée.
    input.organizerEmail
      ? `ORGANIZER;CN=${echapperParametre(input.organizerName)}:mailto:${input.organizerEmail}`
      : null,
    /*
     * ⚠️ `ROLE` ET `PARTSTAT` SONT CE QU'ATTEND UN CLIENT iTIP (lot 4). Sans
     * `PARTSTAT`, Apple Calendar n'a pas d'état de participation à afficher et
     * traite plus volontiers la pièce jointe comme un simple fichier que
     * comme une invitation à accepter ou refuser. Les deux paramètres sont
     * purement additifs : aucun client ne perd d'information.
     */
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${echapperParametre(input.attendeeName)}:mailto:${input.attendeeEmail}`,
    `STATUS:${status}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    "END:VEVENT",
  ].filter((line): line is string => line !== null);
  return lines.map(foldLine).join("\r\n");
}

/**
 * Enveloppe `VCALENDAR`.
 *
 * ⚠️ LE FLUX SE TERMINE PAR CRLF (lot 4). RFC 5545 §3.1 décrit un flux de
 * LIGNES, chacune terminée par CRLF — y compris la dernière. Le fichier
 * s'arrêtait sur `END:VCALENDAR` sans terminateur : toléré par la plupart des
 * clients, refusé par les analyseurs stricts.
 */
function envelopper(methode: MethodeIcs, evenement: string): string {
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Seth Coaching//Booking//FR",
      "CALSCALE:GREGORIAN",
      `METHOD:${methode}`,
      evenement,
      "END:VCALENDAR",
    ].join("\r\n") + "\r\n"
  );
}

/** Invitation de confirmation (nouveau rendez-vous ou report). */
export function buildConfirmationIcs(input: IcsAppointmentInput): string {
  return envelopper("REQUEST", buildEvent(input, "CONFIRMED"));
}

/** Invitation d'annulation — même UID, SEQUENCE incrémentée, STATUS:CANCELLED. */
export function buildCancellationIcs(input: IcsAppointmentInput): string {
  return envelopper("CANCEL", buildEvent({ ...input, sequence: (input.sequence ?? 0) + 1 }, "CANCELLED"));
}

/**
 * `METHOD` réellement écrit dans un fichier — `null` s'il n'y en a pas.
 *
 * Ne lit QUE le niveau calendrier : la ligne doit précéder `BEGIN:VEVENT`.
 */
export function methodeDeclaree(contenuIcs: string): MethodeIcs | null {
  const lignes = contenuIcs.split("\r\n");
  const finEnveloppe = lignes.indexOf("BEGIN:VEVENT");
  const portee = finEnveloppe >= 0 ? lignes.slice(0, finEnveloppe) : lignes;
  const trouvee = portee.find((ligne) => ligne === "METHOD:REQUEST" || ligne === "METHOD:CANCEL");
  if (trouvee === "METHOD:REQUEST") return "REQUEST";
  if (trouvee === "METHOD:CANCEL") return "CANCEL";
  return null;
}

/**
 * Type MIME d'une pièce jointe .ics, DÉRIVÉ du contenu.
 *
 * ⚠️ APPLE DÉCIDE À PARTIR DU PARAMÈTRE MIME `method`, PAS SEULEMENT DU
 * FICHIER (lot 4). Avec un `Content-Type: text/calendar` nu, Apple Mail
 * présente volontiers le .ics comme une pièce jointe ordinaire au lieu d'une
 * invitation : l'annulation n'est alors jamais appliquée à l'agenda, ce qui
 * est exactement le symptôme que le lot 3 cherchait à faire disparaître.
 *
 * ⚠️ DÉRIVÉ, DONC IMPOSSIBLE À DÉSYNCHRONISER. Le `method` annoncé en MIME et
 * le `METHOD:` écrit dans le fichier doivent concorder — un REQUEST annoncé
 * sur un fichier CANCEL est pire que pas d'annonce du tout. Plutôt que de
 * laisser l'appelant répéter la valeur, on la relit sur le contenu.
 */
export function typeMimeIcs(contenuIcs: string): string {
  const methode = methodeDeclaree(contenuIcs);
  return methode ? `text/calendar; charset=utf-8; method=${methode}` : "text/calendar; charset=utf-8";
}

/** Déclenche le téléchargement d'un fichier .ics côté navigateur. */
export function downloadIcsFile(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
