/**
 * Harnais — page de contact NFC « HTS » DANS UN VRAI NAVIGATEUR (chantier
 * feat/contact-nfc-hts, 24-25/11/2026).
 *
 * Ce que les rendus statiques ne peuvent pas prouver :
 *   - le bouton unique qui alterne Jules / Yoann à chaque ouverture ;
 *   - la bascule vers la forme iOS du lien APRÈS chargement du JavaScript ;
 *   - le comportement quand le compteur est lent ou en panne ;
 *   - l'affichage réel en largeur mobile et ordinateur (CSS compilé, logo) ;
 *   - l'absence du Header et du Footer du site.
 *
 * Deux modes, dans la même suite :
 *   - routes `/api/contact-nfc/tour` SIMULÉES par Playwright, pour piloter
 *     précisément ce que répond le serveur (lenteur, panne, coach donné) ;
 *   - routes RÉELLES du serveur lancé (compteur mémoire si Upstash n'est pas
 *     configuré), pour l'alternance de bout en bout entre deux visiteurs.
 *
 * ⚠️ CE N'EST PAS UN TÉLÉPHONE. Chromium reçoit l'agent utilisateur d'un
 * iPhone ou d'un Android, mais il n'ouvre aucune application SMS : chaque
 * navigation `sms:` est interceptée et consignée, jamais suivie. La
 * compatibilité réelle se mesure sur appareil.
 *
 * Prérequis : le site servi (build de production) à `CONTACT_NFC_BASE_URL`
 * (défaut http://127.0.0.1:3000), SANS Upstash configuré (le test « bout en
 * bout » suppose un compteur neuf), et Chromium. Sans navigateur, la suite
 * s'arrête SANS échouer et le dit : elle n'a alors rien vérifié.
 *
 * Lancement : npx tsx scripts/tests/contact-nfc-render.mts
 */
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import type { Browser, BrowserContextOptions, Page, Route } from "playwright-core";

import { COACHS_HTS } from "../../lib/contact-nfc/config";

let reussis = 0;
let echecs = 0;
async function test(nom: string, fn: () => Promise<void>) {
  try {
    await fn();
    reussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    echecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

const BASE_URL = process.env.CONTACT_NFC_BASE_URL ?? "http://127.0.0.1:3000";
const URL_PAGE = `${BASE_URL}/contact-nfc`;
const MOTIF_ROUTE_TOUR = "**/api/contact-nfc/tour";

const [JULES, YOANN] = COACHS_HTS;

const CANDIDATS = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((c): c is string => Boolean(c));

/** Premier candidat qui est un FICHIER (les liens symboliques sont suivis). */
function resoudreExecutable(): string | null {
  return CANDIDATS.find((candidat) => existsSync(candidat) && statSync(candidat).isFile()) ?? null;
}

const executable = resoudreExecutable();
if (!executable) {
  console.log("NON EXÉCUTÉ — aucun Chromium trouvé (pose CHROMIUM_PATH). Rien n'a été vérifié.");
  process.exit(0);
}

const IPHONE: BrowserContextOptions = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
};

const ANDROID: BrowserContextOptions = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2.6,
};

const ORDINATEUR: BrowserContextOptions = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 900 },
};

/**
 * Intercepte toute navigation `sms:` AVANT qu'elle parte, et la consigne.
 * L'écouteur est en phase de capture sur `document` : il passe avant le
 * gestionnaire React (posé sur la racine, en phase de bouillonnement), qui
 * s'exécute donc normalement — y compris quand React annule lui-même le clic.
 */
/*
 * ⚠️ LE `href` EST LU AU MOMENT DU CLIC, PAS APRÈS. Mesuré le 25/11/2026 :
 * lu dans le `setTimeout`, il rendait déjà le coach SUIVANT, React ayant
 * re-rendu le bouton entre-temps.
 */
const INTERCEPTION_SMS = `
  window.__liensSmsOuverts = [];
  document.addEventListener("click", (evenement) => {
    const lien = evenement.target instanceof Element ? evenement.target.closest('a[href^="sms:"]') : null;
    if (lien) {
      const href = lien.getAttribute("href");
      setTimeout(() => {
        // Après React : n'est « ouvert » que ce que React n'a pas annulé.
        if (!evenement.__annuleParReact) window.__liensSmsOuverts.push(href);
      }, 0);
      const preventDefaultOriginal = evenement.preventDefault.bind(evenement);
      evenement.preventDefault = () => { evenement.__annuleParReact = true; preventDefaultOriginal(); };
      preventDefaultOriginal();
    }
  }, true);
`;

async function liensOuverts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __liensSmsOuverts: string[] }).__liensSmsOuverts);
}

/** Simulation de la route du tour : coach courant, POST consignés, délai ou panne au choix. */
interface Simulation {
  tour: "jules" | "yoann";
  delaiGetMs?: number;
  panne?: boolean;
  corpsPost: string[];
}

async function simulerRouteTour(page: Page, simulation: Simulation): Promise<void> {
  await page.route(MOTIF_ROUTE_TOUR, async (route: Route) => {
    const requete = route.request();
    if (simulation.panne) {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"x"}' });
      return;
    }
    if (requete.method() === "GET") {
      if (simulation.delaiGetMs) await new Promise((r) => setTimeout(r, simulation.delaiGetMs));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ coach: simulation.tour }) });
      return;
    }
    const corps = requete.postData() ?? "";
    simulation.corpsPost.push(corps);
    const ouvert = (JSON.parse(corps) as { coach: "jules" | "yoann" }).coach;
    const avance = ouvert === simulation.tour;
    if (avance) simulation.tour = simulation.tour === "jules" ? "yoann" : "jules";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ coach: simulation.tour, avance }),
    });
  });
}

const { chromium } = await import("playwright-core");
const navigateur: Browser = await chromium.launch({ executablePath: executable, headless: true });

async function ouvrir(options: BrowserContextOptions, simulation?: Simulation): Promise<Page> {
  const contexte = await navigateur.newContext(options);
  await contexte.addInitScript(INTERCEPTION_SMS);
  const page = await contexte.newPage();
  if (simulation) await simulerRouteTour(page, simulation);
  const reponse = await page.goto(URL_PAGE, { waitUntil: "domcontentloaded" });
  assert.equal(reponse?.status(), 200, `statut HTTP de ${URL_PAGE}`);
  return page;
}

/**
 * ⚠️ `textContent` ET NON `innerText` POUR LES LIBELLÉS. Le bouton porte la
 * classe `uppercase` : `innerText` rend le texte TEL QU'AFFICHÉ
 * (« CONTACTER JULES »), mesuré le 24/11/2026.
 */
/**
 * Attend que le bouton soit prêt ET pointe vers `coach`. ⚠️ Le libellé ne
 * dit plus à qui il s'adresse (« Contacter un coach », décision du
 * 25/11/2026) : le coach se lit dans `data-coach` et dans le lien.
 */
async function attendreCoach(page: Page, coach: "jules" | "yoann"): Promise<void> {
  await attendreLibelle(page, "Contacter un coach");
  await page.waitForFunction(
    (attendu) => document.querySelector('a[href^="sms:"]')?.getAttribute("data-coach") === attendu,
    coach,
    { timeout: 8000 },
  );
}

async function attendreLibelle(page: Page, libelle: string, etat = "pret"): Promise<void> {
  await page.waitForFunction(
    ([attendu, etatAttendu]) => {
      const bouton = document.querySelector('a[href^="sms:"]');
      return bouton?.textContent?.trim() === attendu && bouton.getAttribute("data-etat") === etatAttendu;
    },
    [libelle, etat] as const,
    { timeout: 8000 },
  );
}

try {
  await test("R1 — un seul bouton ; tour de Yoann annoncé par le serveur → libellé neutre, lien vers Yoann seul", async () => {
    const simulation: Simulation = { tour: "yoann", corpsPost: [] };
    const page = await ouvrir(ANDROID, simulation);
    await attendreCoach(page, "yoann");
    assert.equal(await page.locator('a[href^="sms:"]').count(), 1);
    const href = (await page.locator('a[href^="sms:"]').getAttribute("href")) ?? "";
    assert.ok(href.startsWith(`sms:${YOANN.numero}?body=`), href);
    assert.ok(!href.includes(JULES.numero));
    await page.context().close();
  });

  await test("R2 — appui : SMS ouvert vers Jules, ouverture signalée, le lien passe à Yoann, aucun prénom affiché", async () => {
    const simulation: Simulation = { tour: "jules", corpsPost: [] };
    const page = await ouvrir(IPHONE, simulation);
    await attendreCoach(page, "jules");
    await page.locator('a[href^="sms:"]').click();
    await attendreCoach(page, "yoann");
    const ouverts = await liensOuverts(page);
    assert.equal(ouverts.length, 1);
    assert.ok(ouverts[0].startsWith(`sms:${JULES.numero}&body=`), `forme iOS vers Jules attendue : ${ouverts[0]}`);
    assert.deepEqual(simulation.corpsPost, ['{"coach":"jules"}']);
    const texte = (await page.textContent("body")) ?? "";
    assert.ok(texte.includes("Ton application SMS est ouverte"), "statut d'ouverture absent");
    assert.ok(!/Jules|Yoann/.test(texte), "un prénom de coach est affiché");
    assert.ok(!/envoyé|succès|confirmé|réussi/i.test(texte), "réussite annoncée");
    await page.context().close();
  });

  await test("R3 — double appui rapide : un seul SMS ouvert, un seul signalement", async () => {
    const simulation: Simulation = { tour: "jules", corpsPost: [] };
    const page = await ouvrir(ANDROID, simulation);
    await attendreCoach(page, "jules");
    const bouton = page.locator('a[href^="sms:"]');
    await bouton.click();
    await bouton.click();
    await page.waitForTimeout(300);
    assert.equal((await liensOuverts(page)).length, 1);
    assert.equal(simulation.corpsPost.length, 1);
    await page.context().close();
  });

  await test("R4 — appuis espacés : Jules, puis Yoann, puis Jules", async () => {
    const simulation: Simulation = { tour: "jules", corpsPost: [] };
    const page = await ouvrir(ANDROID, simulation);
    for (const attendu of [JULES, YOANN, JULES]) {
      await attendreCoach(page, attendu.identifiant);
      await page.waitForTimeout(1600); // au-delà de l'anti double appui
      await page.locator('a[href^="sms:"]').click();
    }
    await page.waitForTimeout(100); // le dernier clic est consigné après React (setTimeout 0)
    const ouverts = await liensOuverts(page);
    assert.deepEqual(
      ouverts.map((lien) => lien.slice(4, 16)),
      [JULES.numero, YOANN.numero, JULES.numero],
    );
    await page.context().close();
  });

  await test("R5 — compteur lent : « Un instant… », appui sans effet, puis le bon coach", async () => {
    const simulation: Simulation = { tour: "yoann", delaiGetMs: 1500, corpsPost: [] };
    const page = await ouvrir(ANDROID, simulation);
    await attendreLibelle(page, "Un instant…", "attente");
    assert.equal(await page.locator('a[href^="sms:"]').getAttribute("aria-disabled"), "true");
    // `force` : Playwright attendrait sinon que `aria-disabled` disparaisse
    // (mesuré le 25/11/2026). Un vrai doigt, lui, n'attend pas.
    await page.locator('a[href^="sms:"]').click({ force: true });
    await page.waitForTimeout(100);
    assert.equal((await liensOuverts(page)).length, 0, "aucun SMS ne doit s'ouvrir pendant l'attente");
    await attendreCoach(page, "yoann");
    await page.context().close();
  });

  await test("R6 — compteur en panne : le bouton sert Jules (défaut) et reste utilisable", async () => {
    const simulation: Simulation = { tour: "jules", panne: true, corpsPost: [] };
    const page = await ouvrir(IPHONE, simulation);
    await attendreCoach(page, "jules");
    await page.locator('a[href^="sms:"]').click();
    assert.equal((await liensOuverts(page)).length, 1);
    const texte = (await page.textContent("body")) ?? "";
    assert.ok(!/erreur|indisponible/i.test(texte), "la panne ne doit pas être affichée au visiteur");
    await page.context().close();
  });

  await test("R7 — bout en bout, vraie route : le visiteur A ouvre le SMS, le visiteur B (autre téléphone) a l'autre coach", async () => {
    // Le compteur du serveur a pu servir avant ce test : on part de SON état.
    const reponse = await fetch(`${BASE_URL}/api/contact-nfc/tour`, { cache: "no-store" });
    const { coach: depart } = (await reponse.json()) as { coach: "jules" | "yoann" };
    const premier = depart === "jules" ? JULES : YOANN;
    const second = depart === "jules" ? YOANN : JULES;

    const visiteurA = await ouvrir(ANDROID);
    await attendreCoach(visiteurA, premier.identifiant);
    await visiteurA.locator('a[href^="sms:"]').click();
    await attendreCoach(visiteurA, second.identifiant);

    const visiteurB = await ouvrir(IPHONE);
    await attendreCoach(visiteurB, second.identifiant);
    // Un simple scan (rechargement) ne fait pas avancer le tour.
    await visiteurB.reload({ waitUntil: "domcontentloaded" });
    await attendreCoach(visiteurB, second.identifiant);
    assert.ok((await liensOuverts(visiteurA)).length <= 1);
    await visiteurA.context().close();
    await visiteurB.context().close();
  });

  for (const [nom, options] of [
    ["iPhone 375×812", IPHONE],
    ["Android 412×915", ANDROID],
    ["ordinateur 1440×900", ORDINATEUR],
  ] as const) {
    await test(`R8 — ${nom} : logo chargé, bouton visible sans défilement, aucun débordement`, async () => {
      const page = await ouvrir(options, { tour: "jules", corpsPost: [] });
      await attendreCoach(page, "jules");
      await page.waitForFunction(() => {
        const logo = document.querySelector('img[alt="HTS"]') as HTMLImageElement | null;
        return Boolean(logo?.complete && logo.naturalWidth > 0);
      });
      const hauteur = options.viewport?.height ?? 0;
      const boite = await page.locator('a[href^="sms:"]').boundingBox();
      assert.ok(boite, "bouton absent");
      assert.ok(boite.y + boite.height <= hauteur, "bouton sous la ligne de flottaison");
      assert.ok(boite.height >= 48, `cible tactile ${boite.height}px < 48px`);
      const deborde = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      assert.equal(deborde, false, "débordement horizontal");
      await page.screenshot({ path: `/tmp/contact-nfc-${nom.split(" ")[0].toLowerCase()}.png`, fullPage: true });
      await page.context().close();
    });
  }

  await test("R9 — ni Header ni Footer du site, métadonnées noindex et canonique", async () => {
    const page = await ouvrir(ORDINATEUR, { tour: "jules", corpsPost: [] });
    assert.equal(await page.locator("footer, nav").count(), 0, "navigation ou pied de page présent");
    assert.equal(await page.locator("main").count(), 1);
    assert.equal(await page.getAttribute('meta[name="robots"]', "content"), "noindex, nofollow");
    assert.equal(await page.getAttribute('link[rel="canonical"]', "href"), "https://sethcoaching.fr/contact-nfc");
    await page.context().close();
  });

  await test("R10 — repli : les deux numéros, sans prénom, et le message", async () => {
    const page = await ouvrir(IPHONE, { tour: "jules", corpsPost: [] });
    await page.locator("summary", { hasText: "Le SMS ne s'ouvre pas ?" }).click();
    const texte = (await page.textContent("body")) ?? "";
    assert.ok(texte.includes("06 70 85 65 13"));
    assert.ok(texte.includes("06 46 89 37 67"));
    assert.ok(!/Jules|Yoann/.test(texte), "le repli ne doit pas nommer les coachs");
    assert.ok(texte.includes("je souhaite être recontacté(e)"));
    await page.context().close();
  });

  await test("R11 — accès direct avec paramètres arbitraires : rien de réinjecté", async () => {
    const contexte = await navigateur.newContext(ANDROID);
    const page = await contexte.newPage();
    await page.goto(`${URL_PAGE}?x=%3Cscript%3Ealert(1)%3C%2Fscript%3E&salle=test`, { waitUntil: "domcontentloaded" });
    assert.ok(!(await page.content()).includes("alert(1)"), "paramètre réinjecté");
    assert.equal(await page.locator('a[href^="sms:"]').count(), 1);
    await contexte.close();
  });
} finally {
  await navigateur.close();
}

console.log(`\n${reussis} réussis, ${echecs} échecs`);
if (echecs > 0) process.exit(1);
