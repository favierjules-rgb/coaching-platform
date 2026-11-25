/**
 * Construction des liens `sms:` du contact NFC « HTS » — fonctions PURES,
 * sans accès au DOM, testées par `scripts/tests/contact-nfc-lien-sms.mts`.
 *
 * ⚠️ UN LIEN = UN DESTINATAIRE. `construireLienSms` refuse tout ce qui n'est
 * pas un numéro E.164 unique : une virgule ou un point-virgule glissé dans le
 * numéro produirait une conversation de groupe, refusée le 24/11/2026.
 *
 * ⚠️ DEUX FORMES, ET AUCUNE N'EST GARANTIE PAR UNE DOCUMENTATION CONSTRUCTEUR.
 *   - `rfc` : `sms:<numéro>?body=<texte>` — forme de la RFC 5724. Servie par
 *     défaut, donc aussi sans JavaScript.
 *   - `ios` : `sms:<numéro>&body=<texte>` — forme rapportée par des
 *     intégrateurs pour iOS 8 et suivants. Apple documente l'ouverture de
 *     Messages par le schéma `sms`, PAS le champ `body`.
 * La compatibilité réelle reste à mesurer sur iPhone et Android (plan
 * `/tmp/PLAN_NFC_HTS_FINAL.md`, tests P1 à P10).
 */

export type VarianteSms = "rfc" | "ios";

/** Séparateur entre le destinataire et `body=`, par variante. */
const SEPARATEUR_CORPS = {
  rfc: "?",
  ios: "&",
} as const satisfies Record<VarianteSms, string>;

/** Numéro international E.164 : `+`, indicatif sans zéro initial, 8 à 15 chiffres au total. */
const FORMAT_E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Encode le texte du SMS selon RFC 3986, strictement.
 *
 * `encodeURIComponent` laisse passer `! ' ( ) *`. Ils sont encodés ici aussi :
 * les parenthèses de « recontacté(e) » ne doivent dépendre d'aucune
 * tolérance d'analyseur. Les espaces deviennent `%20`, jamais `+` — un `+`
 * serait affiché tel quel dans le message.
 */
export function encoderCorpsSms(texte: string): string {
  return encodeURIComponent(texte).replace(
    /[!'()*]/g,
    (caractere) => `%${caractere.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Lien `sms:` vers UN destinataire, texte prérempli. */
export function construireLienSms(numero: string, texte: string, variante: VarianteSms): string {
  if (!FORMAT_E164.test(numero)) {
    throw new Error(`Numéro SMS invalide (E.164 attendu, un seul destinataire) : « ${numero} ».`);
  }
  return `sms:${numero}${SEPARATEUR_CORPS[variante]}body=${encoderCorpsSms(texte)}`;
}

export interface IndicesPlateforme {
  /** `navigator.userAgent`. */
  agentUtilisateur: string;
  /** `navigator.platform` (déprécié mais seul indice de l'iPadOS en mode « ordinateur »). */
  plateforme: string;
  /** `navigator.maxTouchPoints`. */
  pointsDeContactMax: number;
}

/**
 * Variante à servir selon l'appareil.
 *
 * ⚠️ TOUS LES NAVIGATEURS iOS SONT CONCERNÉS, PAS SEULEMENT SAFARI. Chrome
 * (`CriOS`), Firefox (`FxiOS`) et Edge sur iPhone portent `iPhone` dans leur
 * agent utilisateur et remettent le lien au système, qui ouvre Messages.
 *
 * ⚠️ L'iPadOS récent se présente comme un Mac (`MacIntel`) : seul le nombre
 * de points de contact le distingue d'un vrai Mac, qui en déclare 0.
 */
export function detecterVarianteSms(indices: IndicesPlateforme): VarianteSms {
  if (/iPhone|iPad|iPod/.test(indices.agentUtilisateur)) return "ios";
  if (indices.plateforme === "MacIntel" && indices.pointsDeContactMax > 1) return "ios";
  return "rfc";
}

/**
 * Affichage lisible d'un numéro français (`+33612345678` → `06 12 34 56 78`),
 * pour le repli « Le SMS ne s'ouvre pas ? ». Tout autre numéro est rendu tel
 * quel : aucune reformulation hasardeuse.
 */
export function formaterNumeroAffichage(numero: string): string {
  const francais = /^\+33(\d{9})$/.exec(numero);
  if (!francais) return numero;
  const national = `0${francais[1]}`;
  return national.replace(/(\d{2})(?=\d)/g, "$1 ");
}
