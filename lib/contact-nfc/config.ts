/**
 * Contact NFC « HTS » — SOURCE UNIQUE des coachs, du texte du SMS et des
 * constantes de la page.
 *
 * Une puce NFC posée à l'accueil d'une salle ouvre `/contact-nfc`. La page
 * propose UN bouton, qui ouvre l'application SMS du visiteur vers UN SEUL
 * coach, avec le texte ci-dessous déjà rédigé. Les coachs sont servis À TOUR
 * DE RÔLE (décision de Jules, 25/11/2026) : le tour passe au suivant à chaque
 * ouverture de l'application SMS, jamais au simple scan.
 *
 * ⚠️ CES NUMÉROS SONT PUBLICS, ET C'EST ASSUMÉ. Un lien `sms:` porte son
 * destinataire en clair dans le HTML : aucune variable d'environnement ne
 * pourrait le cacher. Exposition acceptée par Jules le 24/11/2026.
 *
 * ⚠️ UN SEUL ENDROIT. `scripts/tests/contact-nfc-page.mts` vérifie qu'aucun
 * autre fichier de `app/`, `components/`, `lib/` ou `data/` ne recopie ces
 * numéros ni ce texte.
 */

export type IdentifiantCoachHts = "jules" | "yoann";

export interface CoachHts {
  identifiant: IdentifiantCoachHts;
  /**
   * Prénom — ⚠️ JAMAIS AFFICHÉ sur la page (décision du 25/11/2026 : le
   * bouton dit « Contacter un coach »). Sert aux tests et à la lecture du code.
   */
  prenom: string;
  /** Numéro au format international E.164, sans espace. */
  numero: string;
}

/**
 * ⚠️ L'ORDRE EST L'ORDRE DU TOUR. Le premier visiteur est envoyé au premier
 * coach, le suivant au second, et ainsi de suite (Jules en premier, décision
 * du 25/11/2026). Correspondance prénom ↔ numéro confirmée par Jules le
 * 25/11/2026.
 *
 * ⚠️ DEUX COACHS, DEUX CONVERSATIONS SÉPARÉES. Jamais les deux numéros dans
 * un même lien : ce serait une conversation de groupe (refusée le
 * 24/11/2026). Le tuple impose exactement deux entrées à la compilation.
 */
export const COACHS_HTS = [
  { identifiant: "jules", prenom: "Jules", numero: "+33670856513" },
  { identifiant: "yoann", prenom: "Yoann", numero: "+33646893767" },
] as const satisfies readonly [CoachHts, CoachHts];

/**
 * ⚠️ TEXTE EXACT, VALIDÉ LE 24/11/2026 — NE PAS REFORMULER.
 * `scripts/tests/contact-nfc-lien-sms.mts` le compare caractère pour
 * caractère et à une empreinte SHA-256 scellée : toute modification doit être
 * consciente et accompagnée de la mise à jour écrite du scellé.
 *
 * Mesuré : 141 caractères ; le « ê » de « être » est hors de l'alphabet SMS
 * GSM 7 bits, donc le SMS part en UCS-2 (3 segments sur le forfait du
 * visiteur). Sans effet sur le fonctionnement.
 */
export const TEXTE_SMS_HTS =
  "Bonjour, je souhaite être recontacté(e) par un coach pour discuter de mes problématiques et obtenir des renseignements. Merci de me rappeler.";

/**
 * URL canonique absolue : `app/layout.tsx` ne définit pas de `metadataBase`
 * (mesuré le 24/11/2026), une canonique relative ne serait pas résolue.
 */
export const URL_CANONIQUE_CONTACT_NFC = "https://sethcoaching.fr/contact-nfc";

/**
 * Jaune HTS. ⚠️ MESURÉ SUR LE LOGO fourni le 25/11/2026 (couleur la plus
 * fréquente des pixels jaunes opaques : rgb(253, 201, 1)), aucun code couleur
 * officiel n'ayant été communiqué. Texte noir sur ce jaune : contraste élevé.
 */
export const JAUNE_HTS = "#FDC901";

/** Logo HTS (chronomètre), réduit à 640 px depuis l'original de 1254 px. */
export const LOGO_HTS = { src: "/brand/logo/hts-logo.png", largeur: 640, hauteur: 640 } as const;
