/**
 * Harnais — contact NFC « HTS » : configuration, texte exact, liens `sms:`,
 * encodage et détection de plateforme (chantier feat/contact-nfc-hts,
 * 24/11/2026).
 *
 * ⚠️ CE FICHIER NE VALIDE PAS LES TÉLÉPHONES. Il prouve que les liens
 * produits ont la forme voulue ; qu'un iPhone ou un Android les interprète
 * comme prévu ne se mesure que sur un vrai appareil (plan
 * `/tmp/PLAN_NFC_HTS_FINAL.md`, tests P1 à P14).
 *
 * Aucun réseau, aucun SMS : fonctions pures uniquement.
 *
 * Lancement : npx tsx scripts/tests/contact-nfc-lien-sms.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { COACHS_HTS, TEXTE_SMS_HTS, URL_CANONIQUE_CONTACT_NFC } from "../../lib/contact-nfc/config";
import {
  construireLienSms,
  detecterVarianteSms,
  encoderCorpsSms,
  formaterNumeroAffichage,
  type VarianteSms,
} from "../../lib/contact-nfc/lien-sms";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${name}`);
    console.error(error);
  }
}

/** Texte validé par Jules le 24/11/2026, recopié ici volontairement : c'est la référence, pas la source. */
const TEXTE_VALIDE =
  "Bonjour, je souhaite être recontacté(e) par un coach pour discuter de mes problématiques et obtenir des renseignements. Merci de me rappeler.";

/**
 * ⚠️ SCELLÉ. Empreinte SHA-256 (UTF-8) du texte validé, calculée le
 * 24/11/2026. Ne se met à jour que consciemment, si Jules change le texte,
 * avec la raison écrite ici.
 */
const SCELLE_TEXTE = "2a26eea9b8c5a0afedba4619d8086a32350623785eb39f8dcdd0e79857476e99";

/** Correspondance prénom ↔ numéro confirmée par Jules le 25/11/2026. */
const NUMERO_JULES = "+33670856513";
const NUMERO_YOANN = "+33646893767";

const CORPS_ENCODE_ATTENDU =
  "Bonjour%2C%20je%20souhaite%20%C3%AAtre%20recontact%C3%A9%28e%29%20par%20un%20coach%20pour%20discuter%20de%20mes%20probl%C3%A9matiques%20et%20obtenir%20des%20renseignements.%20Merci%20de%20me%20rappeler.";

const VARIANTES = ["rfc", "ios"] as const satisfies readonly VarianteSms[];

/** Partie destinataire d'un lien : entre `sms:` et le premier `?` ou `&`. */
function destinataireDe(lien: string): string {
  const sansSchema = lien.slice("sms:".length);
  const fin = sansSchema.search(/[?&]/);
  return fin === -1 ? sansSchema : sansSchema.slice(0, fin);
}

/** Corps encodé d'un lien : après `body=`. */
function corpsDe(lien: string): string {
  const index = lien.indexOf("body=");
  assert.ok(index > 0, `aucun champ body dans ${lien}`);
  return lien.slice(index + "body=".length);
}

/**
 * Contrôle de forme réutilisé par les contre-épreuves : un lien vers UN
 * destinataire E.164, corps encodé sans `+` ni espace.
 */
function verifierLien(lien: string): void {
  assert.ok(lien.startsWith("sms:"), "schéma sms: absent");
  const destinataire = destinataireDe(lien);
  assert.match(destinataire, /^\+[1-9]\d{7,14}$/, `destinataire invalide ou multiple : « ${destinataire} »`);
  const corps = corpsDe(lien);
  assert.ok(!corps.includes("+"), "le corps contient un « + » (serait affiché tel quel)");
  assert.ok(!/\s/.test(corps), "le corps contient un espace non encodé");
}

/* ─────────────── A1. Texte exact ─────────────── */

test("A1a — le texte est identique, caractère pour caractère, au texte validé", () => {
  assert.equal(TEXTE_SMS_HTS, TEXTE_VALIDE);
  assert.equal(TEXTE_SMS_HTS.length, 141);
});

test("A1b — le texte correspond au scellé SHA-256", () => {
  const empreinte = createHash("sha256").update(TEXTE_SMS_HTS, "utf8").digest("hex");
  assert.equal(empreinte, SCELLE_TEXTE);
});

test("A1c — accents composés (NFC) : « ê » et « é » sont des caractères uniques, pas lettre + accent", () => {
  assert.equal(TEXTE_SMS_HTS, TEXTE_SMS_HTS.normalize("NFC"));
  assert.ok(TEXTE_SMS_HTS.includes("être"), "« être » attendu avec U+00EA");
});

/* ─────────────── A2. Configuration des destinataires ─────────────── */

test("A2a — exactement deux coachs, dans l'ordre du tour (Jules puis Yoann), avec les numéros validés", () => {
  assert.equal(COACHS_HTS.length, 2);
  assert.deepEqual(
    COACHS_HTS.map((coach) => coach.numero),
    [NUMERO_JULES, NUMERO_YOANN],
  );
  assert.deepEqual(
    COACHS_HTS.map((coach) => coach.identifiant),
    ["jules", "yoann"],
  );
});

test("A2b — numéros mobiles français E.164, distincts", () => {
  for (const coach of COACHS_HTS) {
    assert.match(coach.numero, /^\+33[67]\d{8}$/, `numéro hors format : ${coach.numero}`);
  }
  assert.notEqual(COACHS_HTS[0].numero, COACHS_HTS[1].numero);
});

test("A2c — prénoms affichés : « Jules » et « Yoann »", () => {
  assert.deepEqual(
    COACHS_HTS.map((coach) => coach.prenom),
    ["Jules", "Yoann"],
  );
});

test("A2d — URL canonique absolue", () => {
  assert.equal(URL_CANONIQUE_CONTACT_NFC, "https://sethcoaching.fr/contact-nfc");
});

/* ─────────────── A3–A4. Un destinataire par lien, même corps ─────────────── */

test("A3 — chaque lien contient UN seul destinataire, jamais le numéro de l'autre coach", () => {
  for (const variante of VARIANTES) {
    const [lienJules, lienYoann] = COACHS_HTS.map((coach) =>
      construireLienSms(coach.numero, TEXTE_SMS_HTS, variante),
    );
    assert.equal(destinataireDe(lienJules), NUMERO_JULES);
    assert.equal(destinataireDe(lienYoann), NUMERO_YOANN);
    assert.ok(!lienJules.includes(NUMERO_YOANN), `lien Jules (${variante}) contient le numéro de Yoann`);
    assert.ok(!lienYoann.includes(NUMERO_JULES), `lien Yoann (${variante}) contient le numéro de Jules`);
    for (const lien of [lienJules, lienYoann]) {
      assert.ok(!/[,;]/.test(destinataireDe(lien)), "séparateur de destinataires présent");
      verifierLien(lien);
    }
  }
});

test("A4 — les deux liens portent exactement le même corps", () => {
  for (const variante of VARIANTES) {
    const corps = COACHS_HTS.map((coach) => corpsDe(construireLienSms(coach.numero, TEXTE_SMS_HTS, variante)));
    assert.equal(corps[0], corps[1]);
    assert.equal(corps[0], CORPS_ENCODE_ATTENDU);
  }
});

test("A4b — construireLienSms refuse plusieurs destinataires ou un numéro mal formé", () => {
  for (const invalide of [
    `${NUMERO_JULES},${NUMERO_YOANN}`,
    `${NUMERO_JULES};${NUMERO_YOANN}`,
    "0670856513",
    "+33 6 70 85 65 13",
    "",
  ]) {
    assert.throws(() => construireLienSms(invalide, TEXTE_SMS_HTS, "rfc"), /Numéro SMS invalide/, invalide);
  }
});

/* ─────────────── A5–A6. Encodage ─────────────── */

test("A5a — corps encodé : %20, accents en UTF-8, virgule et parenthèses encodées, aucun +", () => {
  const corps = encoderCorpsSms(TEXTE_SMS_HTS);
  assert.equal(corps, CORPS_ENCODE_ATTENDU);
  assert.ok(corps.includes("%20"));
  assert.ok(!corps.includes("+"));
  assert.ok(corps.includes("%C3%AAtre"), "ê");
  assert.ok(corps.includes("recontact%C3%A9%28e%29"), "é et parenthèses");
  assert.ok(corps.includes("Bonjour%2C"), "virgule");
});

test("A5b — aller-retour : le décodage redonne exactement le texte", () => {
  for (const variante of VARIANTES) {
    for (const coach of COACHS_HTS) {
      const lien = construireLienSms(coach.numero, TEXTE_SMS_HTS, variante);
      assert.equal(decodeURIComponent(corpsDe(lien)), TEXTE_SMS_HTS);
    }
  }
});

test("A6 — apostrophes et caractères structurants n'altèrent jamais la forme du lien", () => {
  const textes = [
    "J'ai une question",
    "J’ai une question",
    "a&b=c?d#e%f",
    "Ligne 1\nLigne 2",
    "Prix : 10 € + 5 % !",
    "(test) *étoile*",
  ];
  for (const texte of textes) {
    for (const variante of VARIANTES) {
      const lien = construireLienSms(NUMERO_JULES, texte, variante);
      verifierLien(lien);
      const corps = corpsDe(lien);
      assert.ok(!/[&?#=']/.test(corps), `caractère structurant non encodé dans « ${texte} »`);
      assert.equal(decodeURIComponent(corps), texte);
      // Un seul « body= » et un seul séparateur : la structure n'a pas bougé.
      assert.equal(lien.split("body=").length, 2);
    }
  }
  assert.ok(encoderCorpsSms("J'ai").includes("%27"), "apostrophe droite encodée");
  assert.ok(encoderCorpsSms("J’ai").includes("%E2%80%99"), "apostrophe typographique encodée");
});

/* ─────────────── A7. Variantes ─────────────── */

test("A7 — rfc : sms:<numéro>?body= ; ios : sms:<numéro>&body=", () => {
  assert.equal(
    construireLienSms(NUMERO_JULES, TEXTE_SMS_HTS, "rfc"),
    `sms:${NUMERO_JULES}?body=${CORPS_ENCODE_ATTENDU}`,
  );
  assert.equal(
    construireLienSms(NUMERO_YOANN, TEXTE_SMS_HTS, "ios"),
    `sms:${NUMERO_YOANN}&body=${CORPS_ENCODE_ATTENDU}`,
  );
});

/* ─────────────── A8. Détection de plateforme ─────────────── */

const AGENTS = [
  {
    nom: "iPhone Safari",
    attendu: "ios",
    agentUtilisateur:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    plateforme: "iPhone",
    pointsDeContactMax: 5,
  },
  {
    nom: "iPhone Chrome (CriOS)",
    attendu: "ios",
    agentUtilisateur:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
    plateforme: "iPhone",
    pointsDeContactMax: 5,
  },
  {
    nom: "iPhone Firefox (FxiOS)",
    attendu: "ios",
    agentUtilisateur:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
    plateforme: "iPhone",
    pointsDeContactMax: 5,
  },
  {
    nom: "iPadOS en mode ordinateur",
    attendu: "ios",
    agentUtilisateur:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    plateforme: "MacIntel",
    pointsDeContactMax: 5,
  },
  {
    nom: "Mac Safari (vrai Mac)",
    attendu: "rfc",
    agentUtilisateur:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    plateforme: "MacIntel",
    pointsDeContactMax: 0,
  },
  {
    nom: "Android Chrome",
    attendu: "rfc",
    agentUtilisateur:
      "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    plateforme: "Linux armv81",
    pointsDeContactMax: 5,
  },
  {
    nom: "Samsung Internet",
    attendu: "rfc",
    agentUtilisateur:
      "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    plateforme: "Linux armv81",
    pointsDeContactMax: 5,
  },
  {
    nom: "Firefox Android",
    attendu: "rfc",
    agentUtilisateur: "Mozilla/5.0 (Android 15; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0",
    plateforme: "Linux armv81",
    pointsDeContactMax: 5,
  },
  {
    nom: "Windows Chrome",
    attendu: "rfc",
    agentUtilisateur:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    plateforme: "Win32",
    pointsDeContactMax: 0,
  },
] as const;

test("A8 — détection : tous les navigateurs iOS/iPadOS en ios, le reste en rfc", () => {
  for (const agent of AGENTS) {
    assert.equal(
      detecterVarianteSms({
        agentUtilisateur: agent.agentUtilisateur,
        plateforme: agent.plateforme,
        pointsDeContactMax: agent.pointsDeContactMax,
      }),
      agent.attendu,
      agent.nom,
    );
  }
});

/* ─────────────── Affichage du repli ─────────────── */

test("Repli — numéros français lisibles, autres numéros inchangés", () => {
  assert.equal(formaterNumeroAffichage(NUMERO_JULES), "06 70 85 65 13");
  assert.equal(formaterNumeroAffichage(NUMERO_YOANN), "06 46 89 37 67");
  assert.equal(formaterNumeroAffichage("+447700900123"), "+447700900123");
});

/* ─────────────── A17. Contre-épreuves ─────────────── */

test("A17a — contre-épreuve : un corps encodé avec « + » est détecté", () => {
  const fautif = `sms:${NUMERO_JULES}?body=${CORPS_ENCODE_ATTENDU.replaceAll("%20", "+")}`;
  assert.throws(() => verifierLien(fautif), /« \+ »/);
});

test("A17b — contre-épreuve : un lien à deux destinataires est détecté", () => {
  const fautif = `sms:${NUMERO_JULES},${NUMERO_YOANN}?body=${CORPS_ENCODE_ATTENDU}`;
  assert.throws(() => verifierLien(fautif), /destinataire invalide ou multiple/);
});

test("A17c — contre-épreuve : un texte altéré d'un seul caractère rompt le scellé", () => {
  const altere = TEXTE_VALIDE.replace("être", "etre");
  const empreinte = createHash("sha256").update(altere, "utf8").digest("hex");
  assert.notEqual(empreinte, SCELLE_TEXTE);
});

test("A17d — contre-épreuve : encodeURIComponent seul laisserait les parenthèses passer", () => {
  assert.ok(encodeURIComponent(TEXTE_SMS_HTS).includes("(e)"), "prémisse : encodeURIComponent n'encode pas ( )");
  assert.ok(!encoderCorpsSms(TEXTE_SMS_HTS).includes("(e)"), "encoderCorpsSms doit les encoder");
});

console.log(`\n${passed} réussis, ${failed} échecs`);
if (failed > 0) process.exit(1);
