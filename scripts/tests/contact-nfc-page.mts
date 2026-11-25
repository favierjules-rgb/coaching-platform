/**
 * Harnais — page de contact NFC « HTS » : RENDU, MÉTADONNÉES, ABSENCE DE
 * COLLECTE et isolement de la navigation (chantier feat/contact-nfc-hts,
 * 24/11/2026).
 *
 * Monté avec react-dom/server, sans la condition `react-server` : c'est le
 * HTML que reçoit le navigateur AVANT le JavaScript, donc la forme RFC des
 * liens. La bascule iOS après chargement et l'affichage mobile/ordinateur
 * sont couverts par scripts/tests/contact-nfc-render.mts (vrai navigateur).
 *
 * ⚠️ AUCUN SMS NE PEUT PARTIR D'ICI : la page n'a aucun moyen d'en envoyer,
 * et ce harnais ne clique sur rien.
 *
 * Lancement : npx tsx scripts/tests/contact-nfc-page.mts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Metadata } from "next";
import type { ReactElement } from "react";

import * as moduleContactNfc from "../../app/contact-nfc/page";
import { COACHS_HTS, TEXTE_SMS_HTS } from "../../lib/contact-nfc/config";
import { encoderCorpsSms } from "../../lib/contact-nfc/lien-sms";
import { exportDefaut } from "./helpers/export-defaut";

/** Export par défaut d'une page vu depuis un `.mts` : voir scripts/tests/helpers/export-defaut.ts. */
const ContactNfcPage = exportDefaut<() => ReactElement>(moduleContactNfc, "app/contact-nfc/page.tsx");

/** Même emballage CommonJS pour l'export nommé `metadata`. */
const metadata: Metadata =
  moduleContactNfc.metadata ??
  (moduleContactNfc.default as unknown as { metadata: Metadata }).metadata;

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

const RACINE = fileURLToPath(new URL("../../", import.meta.url));

function lire(cheminRelatif: string): string {
  return readFileSync(join(RACINE, cheminRelatif), "utf8");
}

/** Retire les commentaires : on juge le CODE, pas les explications qui citent les mots interdits. */
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Fichiers source d'un dossier, récursivement. */
function fichiersSource(dossier: string): string[] {
  const absolu = join(RACINE, dossier);
  const resultat: string[] = [];
  for (const entree of readdirSync(absolu, { recursive: true }) as string[]) {
    const chemin = join(absolu, entree);
    if (/\.(ts|tsx|mts|js|mjs)$/.test(entree) && statSync(chemin).isFile()) {
      resultat.push(relative(RACINE, chemin));
    }
  }
  return resultat;
}

const html = renderToStaticMarkup(createElement(ContactNfcPage));

const SOURCES_CHANTIER = [
  "app/contact-nfc/page.tsx",
  "app/api/contact-nfc/tour/route.ts",
  "components/contact-nfc/BoutonSmsHts.tsx",
  "lib/contact-nfc/config.ts",
  "lib/contact-nfc/lien-sms.ts",
  "lib/contact-nfc/rotation.ts",
  "lib/contact-nfc/tour.ts",
] as const;

/** Le seul fichier autorisé à appeler le réseau, et la seule adresse qu'il peut appeler. */
const BOUTON = "components/contact-nfc/BoutonSmsHts.tsx";
const ROUTE_TOUR = "/api/contact-nfc/tour";

/** Liens `sms:` du HTML, dans l'ordre. */
function liensSms(contenu: string): string[] {
  return [...contenu.matchAll(/href="(sms:[^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
}

/* ─────────────── A9. Rendu sans JavaScript ─────────────── */

test("A9 — HTML serveur (sans JavaScript) : UN bouton, vers Jules seul, forme RFC, cliquable", () => {
  const liens = liensSms(html);
  assert.equal(liens.length, 1, "un seul lien sms: dans le bouton");
  assert.equal(liens[0], `sms:${COACHS_HTS[0].numero}?body=${encoderCorpsSms(TEXTE_SMS_HTS)}`);
  assert.ok(html.includes('data-coach="jules"'));
  assert.ok(html.includes('data-etat="statique"'), "état du HTML serveur");
  assert.ok(!html.includes("aria-disabled"), "le bouton du rendu serveur doit rester cliquable");
  assert.ok(!liens[0].includes(COACHS_HTS[1].numero), "le numéro de Yoann ne doit pas être dans le lien de Jules");
});

/* ─────────────── A10. Métadonnées ─────────────── */

test("A10 — noindex, nofollow et canonique absolue", () => {
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.deepEqual(metadata.alternates, { canonical: "https://sethcoaching.fr/contact-nfc" });
  assert.equal(metadata.title, "HTS — Contacter nos coachs");
});

/* ─────────────── A11. Aucune collecte ─────────────── */

/** Éléments de saisie trouvés dans un HTML — vide attendu. */
function champsDeSaisie(contenu: string): string[] {
  const trouves = ["<form", "<input", "<textarea", "<select"].filter((balise) => contenu.includes(balise));
  if (/contenteditable/i.test(contenu)) trouves.push("contenteditable");
  return trouves;
}

test("A11a — aucun champ de saisie dans la page", () => {
  assert.deepEqual(champsDeSaisie(html), []);
});

/**
 * ⚠️ RÉVISÉ CONSCIEMMENT LE 25/11/2026. Jusqu'au bouton unique, ce test
 * interdisait tout `fetch` dans le chantier. Le tour de rôle Jules / Yoann
 * (décision de Jules, 25/11/2026) exige d'interroger le compteur : le bouton
 * peut désormais appeler `/api/contact-nfc/tour`, et RIEN d'autre. Les
 * stockages navigateur et Supabase restent interdits partout.
 */
test("A11b — réseau : le bouton n'appelle que /api/contact-nfc/tour ; aucun stockage navigateur", () => {
  const code = sansCommentairesTs(lire(BOUTON));
  const cibles = [...code.matchAll(/\bfetch\s*\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  assert.ok(cibles.length > 0, "le bouton doit interroger le tour");
  assert.ok(cibles.every((cible) => cible === "ROUTE_TOUR"), `cibles de fetch : ${cibles.join(", ")}`);
  assert.ok(code.includes(`const ROUTE_TOUR = "${ROUTE_TOUR}";`), "adresse de la route du tour");
  for (const fichier of SOURCES_CHANTIER.filter((f) => f !== BOUTON && f !== "lib/contact-nfc/tour.ts")) {
    assert.ok(!/\bfetch\s*\(/.test(sansCommentairesTs(lire(fichier))), `${fichier} : fetch`);
  }
  const interdits = [
    /XMLHttpRequest/,
    /sendBeacon/,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
    /document\.cookie/,
    /from\s+["']@\/lib\/supabase/,
  ];
  for (const fichier of SOURCES_CHANTIER) {
    const code = sansCommentairesTs(lire(fichier));
    for (const motif of interdits) {
      assert.ok(!motif.test(code), `${fichier} : ${motif}`);
    }
  }
});

/**
 * ⚠️ RÉVISÉ CONSCIEMMENT LE 25/11/2026 (route API autorisée par Jules) :
 * UNE seule route, le compteur du tour. Aucune route d'envoi de SMS.
 */
test("A11c — une seule route API pour ce chantier : le tour de rôle", () => {
  const routes = fichiersSource("app/api").filter((f) => /contact-nfc|sms/i.test(f));
  assert.deepEqual(routes, ["app/api/contact-nfc/tour/route.ts"]);
  const code = sansCommentairesTs(lire("app/api/contact-nfc/tour/route.ts"));
  assert.match(code, /z\.object\(\{ coach: z\.enum\(IDENTIFIANTS_COACHS_HTS\) \}\)\.strict\(\)/, "corps : un identifiant de coach, rien d'autre");
  assert.ok(!/twilio|messages\.create|sendSms/i.test(code), "aucun envoi de SMS côté serveur");
});

/* ─────────────── A12. Libellés ─────────────── */

test("A12a — logo, titre, bouton unique, indication et information", () => {
  for (const attendu of [
    'alt="HTS"',
    "hts-logo.png",
    "Contacter nos coachs",
    "Contacter un coach",
    "Le bouton ouvre ton application SMS avec le message déjà rédigé.",
    "Le coach verra ton numéro pour pouvoir te rappeler.",
    "Le SMS ne s&#x27;ouvre pas ?",
    "Copier le message",
  ]) {
    assert.ok(html.includes(attendu), `« ${attendu} » absent`);
  }
  assert.equal((html.match(/<h1/g) ?? []).length, 1, "un seul titre h1");
  assert.equal((html.match(/Contacter un coach/g) ?? []).length, 1, "un seul bouton");
  assert.equal((html.match(/<main/g) ?? []).length, 1, "un seul <main>");
});

/** Le site ne sait jamais si un SMS est parti : aucun de ces mots ne doit apparaître. */
function annonceUneReussite(texte: string): boolean {
  return /envoyé|succès|confirmé|réussi/i.test(texte);
}

test("A12b — jamais de réussite annoncée : ni dans le HTML, ni dans le code", () => {
  assert.equal(annonceUneReussite(html), false, "mot de réussite dans le HTML");
  for (const fichier of SOURCES_CHANTIER) {
    assert.equal(annonceUneReussite(sansCommentairesTs(lire(fichier))), false, `mot de réussite dans ${fichier}`);
  }
  // Le seul état annoncé après un appui est l'OUVERTURE.
  const bouton = sansCommentairesTs(lire(BOUTON));
  assert.ok(bouton.includes("Ton application SMS est ouverte"), "statut d'ouverture absent");
});

/** Prénoms des coachs visibles dans un HTML (la casse compte : `data-coach="jules"` est un identifiant, pas un affichage). */
function prenomsAffiches(contenu: string): string[] {
  return COACHS_HTS.map((coach) => coach.prenom).filter((prenom) => contenu.includes(prenom));
}

test("A12d — anonymat : aucun prénom de coach dans la page, ni dans le code d'affichage du bouton", () => {
  assert.deepEqual(prenomsAffiches(html), []);
  assert.ok(!/\.prenom\b/.test(sansCommentairesTs(lire(BOUTON))), "le bouton lit un prénom");
  assert.ok(!/\.prenom\b/.test(sansCommentairesTs(lire("app/contact-nfc/page.tsx"))), "la page lit un prénom");
});

test("Contre-épreuve — un prénom réintroduit dans le bouton est détecté par le contrôle de A12d", () => {
  assert.deepEqual(prenomsAffiches(html.replace("Contacter un coach", "Contacter Yoann")), ["Yoann"]);
});

test("A12c — tutoiement : aucun vouvoiement dans la page", () => {
  assert.ok(!/\b(vous|votre|vos)\b/i.test(html));
});

/* ─────────────── A13–A14. Navigation ─────────────── */

/** Pages publiques qui perdraient leur Header/Footer avec ces préfixes — vide attendu. */
const PAGES_PUBLIQUES = ["/", "/services-entreprises", "/programmes", "/confidentialite"] as const;
function pagesPubliquesPrivees(prefixes: readonly string[]): string[] {
  return PAGES_PUBLIQUES.filter((page) => prefixes.some((prefixe) => page.startsWith(prefixe)));
}

/** Même règle que `SiteChrome` : `pathname.startsWith(prefixe)`. */
function prefixesDeSiteChrome(): string[] {
  const source = lire("components/layout/SiteChrome.tsx");
  const bloc = /const PRIVATE_PREFIXES = \[([\s\S]*?)\];/.exec(source);
  assert.ok(bloc, "PRIVATE_PREFIXES introuvable");
  return [...sansCommentairesTs(bloc[1]).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("A13 — Header et Footer écartés sur /contact-nfc seulement", () => {
  const prefixes = prefixesDeSiteChrome();
  assert.ok(prefixes.includes("/contact-nfc"), "/contact-nfc absent de PRIVATE_PREFIXES");
  assert.equal(prefixes.some((prefixe) => "/contact-nfc".startsWith(prefixe)), true);
  assert.deepEqual(pagesPubliquesPrivees(prefixes), []);
});

test("A14 — aucun lien vers /contact-nfc ailleurs dans le site", () => {
  const fichiers = [...fichiersSource("app"), ...fichiersSource("components"), ...fichiersSource("data")].filter(
    (f) => !f.startsWith("app/contact-nfc/") && f !== "components/layout/SiteChrome.tsx",
  );
  const fautifs = fichiers.filter((f) => /["'`]\/contact-nfc/.test(lire(f)));
  assert.deepEqual(fautifs, []);
});

/* ─────────────── A15. Page statique ─────────────── */

test("A15 — la page ne lit ni paramètre, ni en-tête, ni cookie", () => {
  const code = sansCommentairesTs(lire("app/contact-nfc/page.tsx"));
  for (const motif of [/searchParams/, /\bparams\b/, /headers\s*\(/, /cookies\s*\(/, /dynamic\s*=/]) {
    assert.ok(!motif.test(code), `${motif} présent`);
  }
  assert.match(code, /export default function ContactNfcPage\(\)/, "la page ne doit recevoir aucun argument");
});

/* ─────────────── Source unique des numéros ─────────────── */

/**
 * ⚠️ EXCEPTION PRÉEXISTANTE, MESURÉE LE 24/11/2026. `app/mentions-legales/
 * page.tsx` affiche « Téléphone : 06 70 85 65 13 » depuis le commit
 * `e70b6aa` (mentions légales de l'éditeur), bien avant ce chantier. C'est
 * une obligation légale indépendante du contact NFC : elle n'est pas une
 * copie de la configuration et ne doit pas en dépendre.
 */
const PORTEURS_PREEXISTANTS = ["app/mentions-legales/page.tsx"] as const;

test("Numéros — présents dans lib/contact-nfc/config.ts et nulle part ailleurs (app, components, lib, data)", () => {
  const formes = COACHS_HTS.flatMap((coach) => {
    const national = `0${coach.numero.slice(3)}`;
    return [coach.numero, national, national.replace(/(\d{2})(?=\d)/g, "$1 ")];
  });
  const fichiers = ["app", "components", "lib", "data"]
    .flatMap(fichiersSource)
    .filter((f) => !(PORTEURS_PREEXISTANTS as readonly string[]).includes(f));
  const porteurs = fichiers.filter((f) => formes.some((forme) => lire(f).includes(forme)));
  assert.deepEqual(porteurs, ["lib/contact-nfc/config.ts"]);
});

test("Texte — présent dans lib/contact-nfc/config.ts et nulle part ailleurs (app, components, lib, data)", () => {
  const fichiers = ["app", "components", "lib", "data"].flatMap(fichiersSource);
  const porteurs = fichiers.filter((f) => lire(f).includes("je souhaite être recontacté(e)"));
  assert.deepEqual(porteurs, ["lib/contact-nfc/config.ts"]);
});

/* ─────────────── Contre-épreuves ─────────────── */

test("Contre-épreuve — un champ téléphone injecté dans la page est détecté par le contrôle de A11a", () => {
  const fautif = html.replace("</main>", '<form><input name="telephone"></form></main>');
  assert.deepEqual(champsDeSaisie(fautif), ["<form", "<input"]);
});

test("Contre-épreuve — un préfixe « / » ajouté par erreur est détecté par le contrôle de A13", () => {
  assert.deepEqual(pagesPubliquesPrivees([...prefixesDeSiteChrome(), "/"]), [...PAGES_PUBLIQUES]);
});

test("Contre-épreuve — un libellé « SMS envoyé » est détecté par le contrôle de A12b", () => {
  const fautif = html.replace("Contacter un coach", "SMS envoyé au coach");
  assert.notEqual(fautif, html, "prémisse : le libellé a bien été remplacé");
  assert.equal(annonceUneReussite(fautif), true);
});

console.log(`\n${passed} réussis, ${failed} échecs`);
if (failed > 0) process.exit(1);
