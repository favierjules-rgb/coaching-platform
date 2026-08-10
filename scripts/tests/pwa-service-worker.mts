import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BacServiceWorker,
  navigation,
  sousRequete,
} from "./helpers/faux-service-worker";
import { exportDefaut } from "./helpers/export-defaut";

/**
 * PWA — LE SERVICE WORKER, EXÉCUTÉ POUR DE VRAI.
 *
 * Chaque test ci-dessous fait TOURNER `public/sw.js` dans un faux contexte
 * de service worker et regarde ce qu'il produit. Aucun ne cherche une
 * chaîne de caractères dans le source.
 *
 * Ce qui est prouvé, dans l'ordre d'importance :
 *   1. AUCUNE page authentifiée ne finit en cache — c'est la seule chose
 *      qui pourrait faire de ce chantier un problème de confidentialité ;
 *   2. /api/ et Supabase ne sont même pas touchés ;
 *   3. la page hors ligne n'apparaît QUE quand le réseau échoue, jamais sur
 *      une erreur serveur ;
 *   4. les fichiers empreintés sont bien servis depuis le cache, une seule
 *      fois demandés au réseau ;
 *   5. l'activation purge ce qu'une version précédente aurait laissé.
 */

const CHEMIN_SW = fileURLToPath(new URL("../../public/sw.js", import.meta.url));
const ORIGINE = "https://seth.example";
/** La page de secours, telle que `public/sw.js` la nomme. */
const PAGE_HORS_LIGNE_TEST = "/hors-ligne";
/** Doit suivre `VERSION` dans public/sw.js. */
const VERSION_CACHE = "seth-pwa-v4";

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

/** HTML de la page hors ligne tel que Next.js le rendrait. */
const HTML_HORS_LIGNE = `<!DOCTYPE html><html lang="fr"><head>
  <link rel="stylesheet" href="/_next/static/css/abc123.css"/>
  <link rel="preload" as="script" href="/_next/static/chunks/main-def456.js"/>
</head><body><h1>Pas de connexion</h1>
  <script src="/_next/static/chunks/webpack-ghi789.js" async=""></script>
</body></html>`;

/**
 * HTML d'une page élève, tel que le serveur le produit RÉELLEMENT : une
 * coquille. Aucune donnée — c'est ce que `pwa-coquille.mts` va vérifier sur
 * le vrai rendu, pas sur cette copie.
 */
const HTML_COQUILLE_ELEVE = `<!DOCTYPE html><html><body>
  <nav>Tableau de bord · Entraînement · Nutrition · Profil</nav>
  <main>Chargement…</main>
</body></html>`;

/** Une page HORS liste blanche, avec une donnée : elle ne doit jamais être gardée. */
const HTML_PRIVE = `<!DOCTYPE html><html><body>
  <p>Bonjour Jules — 4 250 kg soulevés cette semaine</p>
</body></html>`;

function reseauNormal(): Record<string, () => Response> {
  return {
    "/hors-ligne": () =>
      new Response(HTML_HORS_LIGNE, { status: 200, headers: { "content-type": "text/html" } }),
    "/dashboard": () =>
      new Response(HTML_COQUILLE_ELEVE, { status: 200, headers: { "content-type": "text/html" } }),
    "/admin/eleves": () =>
      new Response(HTML_PRIVE, { status: 200, headers: { "content-type": "text/html" } }),
    "/connexion": () => new Response("<html>connexion</html>", { status: 200 }),
    "/_next/static/css/abc123.css": () => new Response("body{}", { status: 200 }),
    "/_next/static/chunks/main-def456.js": () => new Response("// main", { status: 200 }),
    "/_next/static/chunks/webpack-ghi789.js": () => new Response("// webpack", { status: 200 }),
    "/_next/static/chunks/page-jkl012.js": () => new Response("// page", { status: 200 }),
    "/api/newsletter/preference": () => new Response(`{"subscribed":true}`, { status: 200 }),
  };
}

async function bacInstalle(): Promise<BacServiceWorker> {
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau: reseauNormal() });
  await bac.installer();
  await bac.activer();
  return bac;
}

/* ════════════════════════════════════════════════════════════════════════
 * I. INSTALLATION
 * ════════════════════════════════════════════════════════════════════════ */

await test("I1. l'installation met en cache la page hors ligne ET ses fichiers de style", async () => {
  const bac = await bacInstalle();
  const enCache = bac.toutLeCache();
  assert.ok(enCache.includes(`${ORIGINE}/hors-ligne`), "la page hors ligne doit être précachée");
  // Sans ses fichiers empreintés, la seule page que l'élève verra en panne
  // serait la seule sans mise en page.
  assert.ok(enCache.includes(`${ORIGINE}/_next/static/css/abc123.css`));
  assert.ok(enCache.includes(`${ORIGINE}/_next/static/chunks/main-def456.js`));
  assert.ok(enCache.includes(`${ORIGINE}/_next/static/chunks/webpack-ghi789.js`));
});

await test("I2. l'installation ÉCHOUE si la page hors ligne n'est pas servie", async () => {
  // Un service worker actif dont la seule fonction hors ligne est cassée
  // serait pire qu'aucun : il intercepterait toutes les navigations pour
  // finalement ne rien pouvoir offrir.
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: { "/hors-ligne": () => new Response("boom", { status: 500 }) },
  });
  await assert.rejects(() => bac.installer());
  assert.equal(bac.skipWaitingAppele, false, "il ne doit pas prendre la main");
});

await test("I3. une ressource statique manquante ne fait pas échouer l'installation", async () => {
  const reseau = reseauNormal();
  delete reseau["/_next/static/css/abc123.css"];
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau });
  await bac.installer();
  assert.ok(bac.toutLeCache().includes(`${ORIGINE}/hors-ligne`));
  assert.equal(bac.skipWaitingAppele, true);
});

await test("I4. le relevé ne suit QUE /_next/static/", () => {
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau: reseauNormal() });
  const relever = bac.portee.relevesStatiques as (html: string) => string[];
  // `Array.from` : la fonction s'exécute dans le contexte du service worker,
  // qui a ses propres intrinsèques — son tableau n'est pas un `Array` de ce
  // fichier-ci, et `deepEqual` le refuserait pour cette seule raison.
  const releves = Array.from(
    relever(`
    <link href="/_next/static/css/a.css">
    <img src="/brand/logo/seth-logo-primary.svg">
    <script src="https://cdn.exemple.com/pisteur.js"></script>
    <a href="/dashboard">tableau de bord</a>
    <link href="/_next/static/css/a.css">
  `),
  );
  assert.deepEqual(releves, ["/_next/static/css/a.css"], "ni image, ni CDN, ni page — et sans doublon");
});

/* ════════════════════════════════════════════════════════════════════════
 * II. CE QUI NE DOIT JAMAIS FINIR EN CACHE
 * ════════════════════════════════════════════════════════════════════════ */

await test("II1. une page HORS liste blanche ne laisse aucune trace", async () => {
  // Les pages publiques, légales, d'administration : rien de ce parcours ne
  // sert à ouvrir l'application en salle, donc rien n'est gardé.
  const bac = await bacInstalle();
  const avant = bac.toutLeCache();
  const verdict = await bac.requeter(navigation(`${ORIGINE}/admin/eleves`));
  assert.equal(verdict.repondu, true, "les navigations passent bien par le service worker");
  assert.deepEqual(bac.toutLeCache(), avant, "le cache n'a pas bougé d'un octet");
});

await test("II1bis. la coquille élève est gardée, mais SEULEMENT la coquille", async () => {
  // Elle est mise en cache DÉLIBÉRÉMENT : c'est elle qui fait que
  // l'application s'ouvre hors ligne avec ses menus. Ce qui compte est
  // qu'elle ne contienne aucune donnée — vérifié ici sur le contenu
  // réellement stocké, et sur le vrai HTML par `pwa-coquille.mts`.
  const bac = await bacInstalle();
  await bac.requeter(navigation(`${ORIGINE}/dashboard`));

  const coquilles = bac.contenu("seth-pwa-v4-coquille");
  assert.deepEqual(coquilles, [`${ORIGINE}/dashboard`]);

  // Rien d'autre n'a bougé : ni le cache statique, ni celui de la page de
  // secours. Ce que la coquille CONTIENT est vérifié sur le vrai HTML par
  // `pwa-coquille.mts` — l'affirmer ici ne prouverait que ma propre fixture.
  assert.ok(!bac.contenu("seth-pwa-v4-statique").some((u) => u.endsWith("/dashboard")));
  assert.ok(!bac.contenu("seth-pwa-v4-hors-ligne").some((u) => u.endsWith("/dashboard")));
});

await test("II1ter. une réponse OBTENUE APRÈS REDIRECTION n'est jamais gardée", async () => {
  // Session expirée : le serveur répond la page de connexion sous l'URL du
  // tableau de bord. La garder ferait s'ouvrir l'application, hors ligne,
  // sur un formulaire de connexion figé — impossible à franchir, puisque
  // se connecter demande du réseau.
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: {
      ...reseauNormal(),
      "/dashboard": () => {
        const r = new Response("<html>connexion</html>", { status: 200 });
        Object.defineProperty(r, "redirected", { value: true });
        return r;
      },
    },
  });
  await bac.installer();
  await bac.activer();
  await bac.requeter(navigation(`${ORIGINE}/dashboard`));
  assert.deepEqual(bac.contenu("seth-pwa-v4-coquille"), []);
});

await test("II2. un appel /api/ n'est même pas intercepté", async () => {
  const bac = await bacInstalle();
  const appelsAvant = bac.appelsReseau.length;
  const verdict = await bac.requeter(sousRequete(`${ORIGINE}/api/newsletter/preference`));
  // `repondu: false` veut dire que `respondWith` n'a pas été appelé : le
  // navigateur fait sa requête lui-même, le service worker ne la voit pas
  // passer et n'en garde rien.
  assert.equal(verdict.repondu, false);
  assert.equal(bac.appelsReseau.length, appelsAvant, "aucune requête faite par le service worker");
  assert.ok(!bac.toutLeCache().some((url) => url.includes("/api/")));
});

await test("II3. une NAVIGATION vers /api/ n'est pas interceptée non plus", async () => {
  // Le refus de /api/ est placé AVANT le test de navigation dans sw.js. Si
  // l'ordre était inversé, l'ouverture directe d'une URL d'API dans un
  // onglet passerait par `respondWith` — et une coupure réseau renverrait
  // du HTML là où l'appelant attend du JSON.
  const bac = await bacInstalle();
  const verdict = await bac.requeter(navigation(`${ORIGINE}/api/newsletter/preference`));
  assert.equal(verdict.repondu, false);
});

await test("II4. Supabase et Stripe ne sont jamais touchés", async () => {
  const bac = await bacInstalle();
  for (const url of [
    "https://abcdefgh.supabase.co/rest/v1/students?select=*",
    "https://abcdefgh.supabase.co/storage/v1/object/sign/coach-reply-videos/x.webm",
    "https://api.stripe.com/v1/checkout/sessions",
  ]) {
    const verdict = await bac.requeter(sousRequete(url));
    assert.equal(verdict.repondu, false, `${url} doit passer sans interception`);
  }
  assert.ok(!bac.toutLeCache().some((u) => u.includes("supabase") || u.includes("stripe")));
});

await test("II4bis. un /_next/static/ d'une AUTRE origine n'est pas capturé", async () => {
  // Ce cas n'a rien de théorique : il suffirait qu'`assetPrefix` soit un jour
  // réglé sur un CDN pour que des URL `/_next/static/…` arrivent d'un autre
  // domaine. Le filtre de chemin, à lui seul, les prendrait pour les nôtres
  // et les rangerait dans NOTRE cache — sans jamais pouvoir les invalider.
  // C'est le contrôle d'origine, et lui seul, qui l'empêche.
  const bac = await bacInstalle();
  const verdict = await bac.requeter(sousRequete("https://cdn.autre-site.com/_next/static/chunks/x.js"));
  assert.equal(verdict.repondu, false);
  assert.ok(!bac.toutLeCache().some((u) => u.includes("cdn.autre-site.com")));
});

await test("II5. aucune requête non-GET n'est interceptée", async () => {
  const bac = await bacInstalle();
  for (const methode of ["POST", "PUT", "PATCH", "DELETE"]) {
    const verdict = await bac.requeter(sousRequete(`${ORIGINE}/dashboard`, methode));
    assert.equal(verdict.repondu, false, `${methode} doit passer sans interception`);
  }
});

await test("II5bis. l'envoi d'un FORMULAIRE n'est jamais intercepté", async () => {
  // Un POST de formulaire est une NAVIGATION : sans le contrôle de méthode,
  // il tomberait dans la branche « navigation » et serait rejoué par
  // `fetch()`. Hors ligne, l'élève recevrait la page « Pas de connexion » à
  // la place d'un vrai retour de serveur — et surtout, un envoi rejoué est
  // un envoi qui peut être fait deux fois.
  const bac = await bacInstalle();
  const verdict = await bac.requeter({ method: "POST", url: `${ORIGINE}/connexion`, mode: "navigate" });
  assert.equal(verdict.repondu, false);
  bac.horsLigne = true;
  const horsLigne = await bac.requeter({ method: "POST", url: `${ORIGINE}/connexion`, mode: "navigate" });
  assert.equal(horsLigne.repondu, false, "même hors ligne, un POST n'est pas détourné");
});

await test("II6. une image publique n'est ni interceptée ni mise en cache", async () => {
  // Elle n'est pas empreintée : la mettre en cache pour toujours signifierait
  // qu'une photo remplacée ne changerait jamais sur les téléphones installés.
  const bac = await bacInstalle();
  const verdict = await bac.requeter(sousRequete(`${ORIGINE}/brand/transformations/jules.webp`));
  assert.equal(verdict.repondu, false);
});

/* ════════════════════════════════════════════════════════════════════════
 * III. HORS LIGNE
 * ════════════════════════════════════════════════════════════════════════ */

await test("III1. sans réseau et SANS coquille préparée : page hors ligne", async () => {
  // Le secours, et uniquement le secours : application jamais ouverte en
  // ligne, donc rien à restaurer.
  const bac = await bacInstalle();
  bac.horsLigne = true;
  const verdict = await bac.requeter(navigation(`${ORIGINE}/dashboard`));
  assert.equal(verdict.repondu, true);
  const texte = await verdict.reponse!.text();
  assert.ok(texte.includes("Pas de connexion"), "c'est bien la page hors ligne qui est servie");
  assert.ok(!texte.includes("Jules"), "et surtout pas un tableau de bord d'avant");
});

await test("III1bis. APRÈS PRÉPARATION EN LIGNE, la coupure rend l'application, pas l'écran d'erreur", async () => {
  // C'est l'objectif produit : l'élève ouvre SETH en salle, perd le réseau,
  // et retrouve son application — mêmes menus, même écran de séance.
  const bac = await bacInstalle();
  await bac.requeter(navigation(`${ORIGINE}/dashboard`));

  bac.horsLigne = true;
  const verdict = await bac.requeter(navigation(`${ORIGINE}/dashboard`));
  const texte = await verdict.reponse!.text();
  assert.ok(!texte.includes("Pas de connexion"), "la page de secours ne doit plus apparaître");
  assert.ok(texte.includes("<html"), "c'est bien la coquille de l'application");
});

await test("A29. LANCEMENT DEPUIS L'ICÔNE, EN MODE AVION, APRÈS FERMETURE COMPLÈTE", async () => {
  // LE scénario produit, reproduit de bout en bout : l'élève prépare son
  // application en ligne, ouvre sa séance, ferme tout, coupe le réseau, puis
  // relance depuis l'icône. Le navigateur navigue alors vers `start_url`.
  //
  // Ce test lit `start_url` DANS le manifeste plutôt que de le recopier :
  // le jour où quelqu'un le déplace vers une route non mise en cache, c'est
  // ici que ça doit échouer, pas sur l'iPhone de Jules.
  const manifeste = exportDefaut<() => { start_url?: string }>(
    await import("../../app/manifest"),
    "app/manifest.ts",
  )();
  const LANCEMENT = String(manifeste.start_url);
  const SEANCE = "55555555-5555-4555-8555-555555555555";

  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: {
      ...reseauNormal(),
      [LANCEMENT]: () => new Response(HTML_COQUILLE_ELEVE, { status: 200 }),
      [`/entrainement/seance/${SEANCE}`]: () =>
        new Response(`<html><nav>Entraînement</nav><main>Chargement…</main></html>`, { status: 200 }),
    },
  });
  await bac.installer();
  await bac.activer();

  // 1-3. en ligne : lancement de l'application, puis ouverture de la séance.
  await bac.requeter(navigation(`${ORIGINE}${LANCEMENT}`));
  await bac.requeter(navigation(`${ORIGINE}/entrainement/seance/${SEANCE}`));

  // 4-5. fermeture complète + mode avion. Le service worker survit à la
  // fermeture : c'est tout l'intérêt, ses caches sont sur le disque.
  bac.horsLigne = true;

  // 6. lancement depuis l'icône.
  const lancement = await bac.requeter(navigation(`${ORIGINE}${LANCEMENT}`));
  const html = await lancement.reponse!.text();
  assert.ok(!html.includes("Pas de connexion"), "le lancement ne doit PAS tomber sur la page de secours");
  assert.ok(html.includes("Chargement…") || html.includes("nav"), "la coquille de l'application doit s'ouvrir");

  // Puis la navigation vers la séance du jour, toujours sans réseau.
  const seance = await bac.requeter(navigation(`${ORIGINE}/entrainement/seance/${SEANCE}`));
  const htmlSeance = await seance.reponse!.text();
  assert.ok(!htmlSeance.includes("Pas de connexion"), "la séance préparée doit rouvrir hors ligne");
  assert.ok(htmlSeance.includes("Entraînement"));
});

await test("A29bis. LE LANCEMENT EST PRÉPARÉ SANS QUE L'ÉLÈVE AIT VISITÉ /entrainement", async () => {
  // Sans cette préparation, le cold start hors ligne dépendrait du hasard :
  // un élève qui consulte son profil puis descend au sous-sol se
  // retrouverait devant la page de secours, avec le sentiment que son
  // application « marche parfois ».
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: {
      ...reseauNormal(),
      "/profil": () => new Response(HTML_COQUILLE_ELEVE, { status: 200 }),
      "/entrainement": () => new Response("<html><nav>Entraînement</nav></html>", { status: 200 }),
    },
  });
  await bac.installer();
  await bac.activer();

  // L'élève ouvre SON PROFIL, et rien d'autre.
  await bac.requeter(navigation(`${ORIGINE}/profil`));

  const coquilles = bac.contenu("seth-pwa-v4-coquille");
  assert.ok(coquilles.includes(`${ORIGINE}/entrainement`), "le point de lancement doit être préparé tout seul");

  // Kill + mode avion + lancement depuis l'icône.
  bac.horsLigne = true;
  const lancement = await bac.requeter(navigation(`${ORIGINE}/entrainement`));
  const html = await lancement.reponse!.text();
  assert.ok(!html.includes("Pas de connexion"));
  assert.ok(html.includes("Entraînement"));
});

await test("A29ter. la préparation ne garde JAMAIS un formulaire de connexion", async () => {
  // Élève non authentifié : /entrainement est redirigée vers /connexion. La
  // garder comme point de lancement enfermerait l'application, hors ligne,
  // sur un formulaire infranchissable — se connecter demande du réseau.
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: {
      ...reseauNormal(),
      "/profil": () => new Response(HTML_COQUILLE_ELEVE, { status: 200 }),
      "/entrainement": () => {
        const r = new Response("<html>connexion</html>", { status: 200 });
        Object.defineProperty(r, "redirected", { value: true });
        return r;
      },
    },
  });
  await bac.installer();
  await bac.activer();
  await bac.requeter(navigation(`${ORIGINE}/profil`));
  assert.ok(!bac.contenu("seth-pwa-v4-coquille").includes(`${ORIGINE}/entrainement`));
});

await test("A29quater. la SÉANCE n'est jamais préparée d'avance", async () => {
  // À l'opposé du point de lancement : une séance n'est disponible hors
  // ligne que si ELLE a été ouverte en ligne. Sa coquille porte son
  // identifiant, il n'y a rien à préparer pour une séance inconnue.
  const SEANCE = "66666666-6666-4666-8666-666666666666";
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: { ...reseauNormal(), "/entrainement": () => new Response("<html>e</html>", { status: 200 }) },
  });
  await bac.installer();
  await bac.activer();
  await bac.requeter(navigation(`${ORIGINE}/dashboard`));

  bac.horsLigne = true;
  const seance = await bac.requeter(navigation(`${ORIGINE}/entrainement/seance/${SEANCE}`));
  assert.ok((await seance.reponse!.text()).includes("Pas de connexion"));
});

await test("A30. le MÊME lancement, sans préparation préalable, retombe sur le secours", async () => {
  // Première installation, jamais ouverte en ligne : il n'y a rien à
  // restaurer, et le dire est la seule chose honnête à faire.
  const manifeste = exportDefaut<() => { start_url?: string }>(
    await import("../../app/manifest"),
    "app/manifest.ts",
  )();
  const bac = await bacInstalle();
  bac.horsLigne = true;
  const lancement = await bac.requeter(navigation(`${ORIGINE}${String(manifeste.start_url)}`));
  assert.ok((await lancement.reponse!.text()).includes("Pas de connexion"));
});

await test("III1ter. une route hors liste blanche retombe sur la page de secours", async () => {
  const bac = await bacInstalle();
  await bac.requeter(navigation(`${ORIGINE}/admin/eleves`));
  bac.horsLigne = true;
  const verdict = await bac.requeter(navigation(`${ORIGINE}/admin/eleves`));
  assert.ok((await verdict.reponse!.text()).includes("Pas de connexion"));
});

await test("III1quater. LA SÉANCE : chaque URL retrouve SA coquille, jamais celle d'une autre", async () => {
  // Servir la coquille de la séance A pour l'URL de la séance B ferait
  // s'hydrater l'écran avec l'identifiant de A — l'élève ouvrirait la
  // mauvaise séance sans le moindre signe.
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: {
      ...reseauNormal(),
      [`/entrainement/seance/${A}`]: () => new Response(`<html>coquille ${A}</html>`, { status: 200 }),
      [`/entrainement/seance/${B}`]: () => new Response(`<html>coquille ${B}</html>`, { status: 200 }),
    },
  });
  await bac.installer();
  await bac.activer();
  await bac.requeter(navigation(`${ORIGINE}/entrainement/seance/${A}`));

  bac.horsLigne = true;
  const surA = await bac.requeter(navigation(`${ORIGINE}/entrainement/seance/${A}`));
  assert.ok((await surA.reponse!.text()).includes(A), "la séance préparée doit rouvrir");

  const surB = await bac.requeter(navigation(`${ORIGINE}/entrainement/seance/${B}`));
  const texteB = await surB.reponse!.text();
  assert.ok(!texteB.includes(A), "la coquille de A ne doit JAMAIS servir pour B");
  assert.ok(texteB.includes("Pas de connexion"), "B non préparée : secours");
});

await test("III2. une erreur 500 n'est PAS remplacée par la page hors ligne", async () => {
  // Le repli ne se déclenche que sur un rejet de `fetch`. Confondre les deux
  // masquerait une panne serveur derrière un message rassurant, et personne
  // ne saurait que le site est cassé.
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: {
      ...reseauNormal(),
      "/dashboard": () => new Response("erreur interne", { status: 500 }),
    },
  });
  await bac.installer();
  await bac.activer();

  const verdict = await bac.requeter(navigation(`${ORIGINE}/dashboard`));
  assert.equal(verdict.reponse!.status, 500);
  assert.equal(await verdict.reponse!.text(), "erreur interne");
});

await test("III3. hors ligne, /connexion aussi renvoie la page hors ligne", async () => {
  // C'est l'écran de lancement de l'application : c'est LUI qu'on obtient
  // quand on ouvre l'application dans le métro.
  const bac = await bacInstalle();
  bac.horsLigne = true;
  const verdict = await bac.requeter(navigation(`${ORIGINE}/connexion`));
  assert.ok((await verdict.reponse!.text()).includes("Pas de connexion"));
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. FICHIERS EMPREINTÉS
 * ════════════════════════════════════════════════════════════════════════ */

await test("IV1. un fichier empreinté n'est demandé au réseau qu'une seule fois", async () => {
  const bac = await bacInstalle();
  const url = `${ORIGINE}/_next/static/chunks/page-jkl012.js`;

  const premier = await bac.requeter(sousRequete(url));
  assert.equal(premier.repondu, true);
  assert.equal(await premier.reponse!.text(), "// page");
  const appresPremier = bac.appelsReseau.filter((a) => a === url).length;
  assert.equal(appresPremier, 1);

  const second = await bac.requeter(sousRequete(url));
  assert.equal(await second.reponse!.text(), "// page");
  assert.equal(
    bac.appelsReseau.filter((a) => a === url).length,
    1,
    "le second passage doit venir du cache, pas du réseau",
  );
});

await test("IV2. hors ligne, un fichier empreinté déjà connu est encore servi", async () => {
  const bac = await bacInstalle();
  bac.horsLigne = true;
  // Celui-ci a été précaché à l'installation.
  const verdict = await bac.requeter(sousRequete(`${ORIGINE}/_next/static/css/abc123.css`));
  assert.equal(await verdict.reponse!.text(), "body{}");
});

await test("IV3. une réponse d'erreur n'est jamais mise en cache", async () => {
  const bac = await bacInstalle();
  const url = `${ORIGINE}/_next/static/chunks/absent.js`;
  await bac.requeter(sousRequete(url)); // 404
  const second = await bac.requeter(sousRequete(url));
  assert.equal(second.reponse!.status, 404);
  assert.equal(
    bac.appelsReseau.filter((a) => a === url).length,
    2,
    "un 404 mis en cache ferait disparaître le fichier pour toujours",
  );
});

await test("IV4. une vidéo `blob:` n'est jamais interceptée (F4 / F5)", async () => {
  // Les vidéos de technique et les réponses du coach sont lues depuis une
  // URL `blob:` locale ou une URL signée Supabase. Une seule seconde de
  // vidéo mise en cache par erreur, ce serait un enregistrement d'élève
  // laissé sur le disque du téléphone bien après la purge des 3 jours.
  const bac = await bacInstalle();
  for (const url of [
    "blob:https://seth.example/8f1c-4e2a",
    "https://abcdefgh.supabase.co/storage/v1/object/sign/feedback-videos/eleve.webm?token=x",
  ]) {
    const verdict = await bac.requeter(sousRequete(url));
    assert.equal(verdict.repondu, false, `${url} doit passer sans interception`);
  }
  assert.ok(!bac.toutLeCache().some((u) => u.includes("blob:") || u.includes(".webm")));
});

await test("IV5. le cache statique est PLAFONNÉ — il ne grossit pas sans fin", async () => {
  // Sans plafond, chaque déploiement ajoute ses fichiers empreintés et
  // n'enlève jamais les précédents : le cache ne décroît jamais. Au bout
  // d'un an, c'est plusieurs centaines de mégaoctets de code mort sur le
  // téléphone de l'élève.
  const reseau = reseauNormal();
  const TOTAL = 150;
  for (let i = 0; i < TOTAL; i += 1) {
    reseau[`/_next/static/chunks/v${i}.js`] = () => new Response(`// ${i}`, { status: 200 });
  }
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau });
  await bac.installer();
  await bac.activer();

  for (let i = 0; i < TOTAL; i += 1) {
    await bac.requeter(sousRequete(`${ORIGINE}/_next/static/chunks/v${i}.js`));
  }

  const statique = bac.contenu("seth-pwa-v4-statique");
  assert.ok(statique.length <= 120, `le cache statique compte ${statique.length} entrées, plafond 120`);
  // Les plus RÉCENTES sont gardées, les plus anciennes expulsées.
  assert.ok(statique.includes(`${ORIGINE}/_next/static/chunks/v149.js`), "le dernier fichier doit rester");
  assert.ok(!statique.includes(`${ORIGINE}/_next/static/chunks/v0.js`), "le plus ancien doit être parti");
});

await test("IV6. le plafond n'expulse jamais les fichiers de la page hors ligne", async () => {
  // Ils vivent dans un cache séparé, jamais rogné : sinon la seule page que
  // l'élève verra en panne finirait par s'afficher sans mise en page, après
  // quelques semaines d'usage et sans que rien ne le signale.
  const reseau = reseauNormal();
  for (let i = 0; i < 150; i += 1) {
    reseau[`/_next/static/chunks/v${i}.js`] = () => new Response(`// ${i}`, { status: 200 });
  }
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau });
  await bac.installer();
  await bac.activer();
  for (let i = 0; i < 150; i += 1) {
    await bac.requeter(sousRequete(`${ORIGINE}/_next/static/chunks/v${i}.js`));
  }

  const horsLigne = bac.contenu("seth-pwa-v4-hors-ligne");
  assert.ok(horsLigne.includes(`${ORIGINE}/_next/static/css/abc123.css`), "la feuille de style doit survivre");
  assert.ok(horsLigne.includes(`${ORIGINE}/hors-ligne`));

  // Et elle reste servie hors ligne, sans avoir été recopiée dans le cache
  // statique au premier usage.
  bac.horsLigne = true;
  const verdict = await bac.requeter(sousRequete(`${ORIGINE}/_next/static/css/abc123.css`));
  assert.equal(await verdict.reponse!.text(), "body{}");
});

/* ════════════════════════════════════════════════════════════════════════
 * V. CYCLE DE VIE
 * ════════════════════════════════════════════════════════════════════════ */

await test("V1. l'activation supprime les caches d'une version précédente", async () => {
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau: reseauNormal() });
  // Ce qu'une version antérieure aurait pu laisser : y compris du HTML
  // authentifié, si elle avait été moins prudente.
  const ancien = await (bac as unknown as { ouvrir: (n: string) => { put: (u: string, r: Response) => Promise<void> } })
    .ouvrir("seth-pwa-v0-pages");
  await ancien.put("/dashboard", new Response(HTML_PRIVE));
  assert.ok(bac.toutLeCache().some((u) => u.endsWith("/dashboard")));

  await bac.installer();
  await bac.activer();

  assert.ok(
    !bac.toutLeCache().some((u) => u.endsWith("/dashboard")),
    "l'ancien cache de pages doit avoir disparu",
  );
  assert.equal(bac.claimAppele, true, "et le nouveau doit prendre la main");
});

await test("V2. l'activation ne supprime PAS les caches de la version courante", async () => {
  const bac = await bacInstalle();
  assert.ok(bac.toutLeCache().includes(`${ORIGINE}/hors-ligne`));
  await bac.activer(); // une seconde activation ne doit rien casser
  assert.ok(bac.toutLeCache().includes(`${ORIGINE}/hors-ligne`));
});

await test("V3. UN NOUVEAU DÉPLOIEMENT N'EST JAMAIS BLOQUÉ PAR LE CACHE", async () => {
  // Le scénario redouté : l'élève a l'application installée, on déploie, et
  // il reste bloqué sur l'ancienne version jusqu'à désinstaller.
  //
  // Il ne peut pas se produire, et ce test le montre plutôt que de
  // l'affirmer : le HTML n'est JAMAIS mis en cache (donc la page vient
  // toujours du serveur), et les fichiers du nouveau déploiement portent de
  // NOUVELLES empreintes — ils ne peuvent pas correspondre à une entrée du
  // cache, qui est indexé par URL.
  const bac = await bacInstalle();

  // Version N : l'élève charge la page et son fichier.
  await bac.requeter(sousRequete(`${ORIGINE}/_next/static/chunks/page-jkl012.js`));
  assert.ok(bac.contenu("seth-pwa-v4-statique").includes(`${ORIGINE}/_next/static/chunks/page-jkl012.js`));

  // Version N+1 : nouveau HTML, nouvelle empreinte.
  const nouveauHtml = `<!DOCTYPE html><html><body><p>version N+1</p>
    <script src="/_next/static/chunks/page-NOUVEAU.js"></script></body></html>`;
  (bac as unknown as { reseau: Record<string, () => Response> }).reseau["/dashboard"] = () =>
    new Response(nouveauHtml, { status: 200 });
  (bac as unknown as { reseau: Record<string, () => Response> }).reseau[
    "/_next/static/chunks/page-NOUVEAU.js"
  ] = () => new Response("// N+1", { status: 200 });

  const page = await bac.requeter(navigation(`${ORIGINE}/dashboard`));
  assert.match(await page.reponse!.text(), /version N\+1/, "le HTML vient toujours du serveur");

  const avant = bac.appelsReseau.length;
  const script = await bac.requeter(sousRequete(`${ORIGINE}/_next/static/chunks/page-NOUVEAU.js`));
  assert.equal(await script.reponse!.text(), "// N+1");
  assert.ok(bac.appelsReseau.length > avant, "le nouveau fichier est bien allé le chercher");

  // Et l'ancien reste disponible le temps que les pages ouvertes finissent
  // de s'en servir : rien n'est cassé pendant le déploiement.
  const ancien = await bac.requeter(sousRequete(`${ORIGINE}/_next/static/chunks/page-jkl012.js`));
  assert.equal(await ancien.reponse!.text(), "// page");
});


/* ══════════════════════════════════════════════════════════════════════════
 * LE PARCOURS RÉEL D'UN IPHONE — ET POURQUOI A29 NE LE COUVRAIT PAS
 * ══════════════════════════════════════════════════════════════════════════
 * A29 rejouait le scénario produit en supposant que chaque changement de
 * page passe par le service worker. Sur un vrai téléphone, ce n'est vrai
 * NI pour le premier chargement, NI pour les suivants :
 *
 *   • le tout premier document part AVANT que `register()` n'ait été
 *     exécuté — il n'y a pas encore de service worker pour l'intercepter,
 *     et `clients.claim()` arrive trop tard pour cette requête-là ;
 *
 *   • ensuite, le routeur de Next.js ne recharge plus jamais le document :
 *     il va chercher la charge RSC en `fetch`. `requete.mode` vaut alors
 *     "cors", pas "navigate" — le service worker la laisse passer, comme il
 *     doit.
 *
 * Conséquence : pendant TOUTE une session en ligne, le gestionnaire
 * `navigation()` peut ne jamais s'exécuter une seule fois. Et comme la
 * préparation du point de lancement n'était appelée que depuis lui, elle
 * n'avait jamais lieu non plus.
 * ══════════════════════════════════════════════════════════════════════════ */

await test("A31. SESSION RÉELLE : le service worker ne voit AUCUNE navigation, et le lancement marche quand même", async () => {
  const SEANCE = "77777777-7777-4777-8777-777777777777";
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: {
      ...reseauNormal(),
      "/entrainement": () => new Response(HTML_COQUILLE_ELEVE, { status: 200 }),
      [`/entrainement/seance/${SEANCE}`]: () =>
        new Response(`<html><nav>Entraînement</nav><main>Chargement…</main></html>`, { status: 200 }),
    },
  });

  // 1. Lancement depuis l'icône, EN LIGNE. Le document `/entrainement` est
  //    demandé par le navigateur AVANT que le service worker n'existe : il
  //    n'y a donc volontairement AUCUN `requeter(navigation(...))` ici.
  //    C'est la page rendue qui l'enregistre ensuite.
  await bac.installer();
  await bac.activer();

  // 2. La page annonce sa présence — le seul canal disponible.
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });

  // 3. L'élève tape sur sa séance. Next.js ne recharge pas le document :
  //    il va chercher la charge RSC. Le service worker n'y touche pas.
  const rsc = await bac.requeter(sousRequete(`${ORIGINE}/entrainement/seance/${SEANCE}?_rsc=1f2e3d`));
  assert.equal(rsc.repondu, false, "une charge RSC n'est pas une navigation : elle doit passer sans être touchée");
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement/seance/${SEANCE}` });

  // 4. Kill complet + mode avion.
  bac.horsLigne = true;

  // 5. Relance depuis l'icône : LE bogue du 09/08/2026.
  const lancement = await bac.requeter(navigation(`${ORIGINE}/entrainement`));
  const html = await lancement.reponse!.text();
  assert.ok(
    !html.includes("Pas de connexion"),
    "le lancement hors ligne tombe sur la page de secours alors que l'application a servi toute la session",
  );

  // 6. Et le geste suivant : ouvrir sa séance. Hors ligne, la charge RSC
  //    échoue et le navigateur retombe sur un chargement complet du
  //    document — donc sur le service worker.
  const seance = await bac.requeter(navigation(`${ORIGINE}/entrainement/seance/${SEANCE}`));
  const htmlSeance = await seance.reponse!.text();
  assert.ok(!htmlSeance.includes("Pas de connexion"), "la séance ouverte en ligne doit rouvrir hors ligne");
  assert.ok(htmlSeance.includes("Entraînement"));
});

await test("A32. le message ne garde QUE des coquilles élève, et jamais après une redirection", async () => {
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: {
      ...reseauNormal(),
      "/entrainement": () => new Response(HTML_COQUILLE_ELEVE, { status: 200 }),
      "/mentions-legales": () => new Response("<html>mentions</html>", { status: 200 }),
      "/admin/eleves": () => new Response("<html>admin</html>", { status: 200 }),
    },
  });
  await bac.installer();
  await bac.activer();

  // Une page publique et une page d'administration annoncent leur URL : le
  // service worker ne doit garder ni l'une ni l'autre. Seule la préparation
  // du point de lancement a lieu.
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/mentions-legales` });
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/admin/eleves` });

  const coquilles = bac.contenu(`${VERSION_CACHE}-coquille`);
  assert.ok(!coquilles.some((u) => u.endsWith("/mentions-legales")), "une page publique n'est pas une coquille élève");
  assert.ok(!coquilles.some((u) => u.endsWith("/admin/eleves")), "une page d'administration n'est pas une coquille élève");
});

await test("A33. un message d'une autre origine ne fait rien mettre en cache", async () => {
  // Le paramètre vient d'une page : il est traité comme une entrée, pas
  // comme une vérité. Une URL d'ailleurs ne doit produire aucune requête.
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: { ...reseauNormal(), "/entrainement": () => new Response(HTML_COQUILLE_ELEVE, { status: 200 }) },
  });
  await bac.installer();
  await bac.activer();
  await bac.message({ type: "coquille-eleve", url: "https://ailleurs.example/entrainement" });
  assert.ok(
    !bac.appelsReseau.some((u) => u.startsWith("https://ailleurs.example")),
    "le service worker a suivi une URL étrangère",
  );
});


/* ══════════════════════════════════════════════════════════════════════════
 * LES COQUILLES DU MENU — CELLES QU'ON N'A PAS ENCORE VISITÉES
 * ══════════════════════════════════════════════════════════════════════════
 * Constaté sur iPhone : cold start hors ligne réussi, séance du jour
 * disponible… et un clic sur « Nutrition » tombait sur « Pas de connexion ».
 *
 * La liste blanche contenait pourtant /nutrition depuis le début. Ce qui
 * manquait n'était pas l'autorisation de la servir, c'était sa PRÉPARATION :
 * seule `/entrainement` était capturée d'avance. Les six autres entrées du
 * menu n'existaient dans le cache que si l'élève y était passé en ligne —
 * c'est-à-dire par hasard.
 *
 * Ces cas exigent donc qu'une seule annonce de page suffise à rendre TOUT le
 * menu navigable sans réseau.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Les entrées du menu élève, relues dans la barre latérale elle-même. */
function cheminsDuMenu(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("../../components/student/StudentSidebar.tsx", import.meta.url)),
    "utf8",
  );
  const debut = source.indexOf("const studentLinks = [");
  const fin = source.indexOf("];", debut);
  assert.ok(debut !== -1 && fin !== -1, "studentLinks introuvable dans StudentSidebar.tsx");
  return Array.from(source.slice(debut, fin).matchAll(/href:\s*"([^"]+)"/g)).map((m) => m[1]);
}

await test("A34. UNE SEULE PAGE OUVERTE EN LIGNE SUFFIT À PRÉPARER TOUT LE MENU", async () => {
  const menu = cheminsDuMenu();
  const reseau = reseauNormal();
  for (const chemin of menu) {
    reseau[chemin] = () => new Response(HTML_COQUILLE_ELEVE, { status: 200 });
  }
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau });
  await bac.installer();
  await bac.activer();

  // L'élève ouvre son application, et RIEN d'autre. Aucune visite de
  // /nutrition, /documents, /progression…
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });

  const enCache = bac.toutLeCache();
  for (const chemin of menu) {
    assert.ok(
      enCache.includes(`${ORIGINE}${chemin}`),
      `${chemin} n'a pas été préparée — l'élève devra l'ouvrir en ligne avant de perdre le réseau`,
    );
  }

  // Mode avion : chaque entrée du menu doit ouvrir SA page.
  bac.horsLigne = true;
  for (const chemin of menu) {
    const verdict = await bac.requeter(navigation(`${ORIGINE}${chemin}`));
    const html = await verdict.reponse!.text();
    assert.ok(!html.includes("Pas de connexion"), `${chemin} retombe sur la page de secours`);
  }
});

await test("A35. la préparation ne sort JAMAIS du menu élève", async () => {
  const reseau = reseauNormal();
  for (const chemin of cheminsDuMenu()) {
    reseau[chemin] = () => new Response(HTML_COQUILLE_ELEVE, { status: 200 });
  }
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau });
  await bac.installer();
  await bac.activer();
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });

  const demandes = bac.appelsReseau.map((u) => new URL(u).pathname);
  const autorises = new Set([...cheminsDuMenu(), PAGE_HORS_LIGNE_TEST]);
  for (const chemin of demandes) {
    if (chemin.startsWith("/_next/static/")) continue;
    assert.ok(
      autorises.has(chemin),
      `le service worker est allé chercher ${chemin} — hors du menu élève`,
    );
  }
  for (const interdit of ["/admin", "/", "/tarifs", "/connexion"]) {
    assert.ok(
      !bac.toutLeCache().some((u) => new URL(u).pathname === interdit),
      `${interdit} n'a rien à faire dans le cache`,
    );
  }
});

await test("A36. les coquilles du menu SURVIVENT au plafond du cache", async () => {
  // Le plafond expulse les plus anciennes. Les coquilles du menu sont
  // justement les premières insérées : sans protection, trente séances
  // ouvertes suffisaient à les faire disparaître — et le menu redevenait
  // inutilisable hors ligne, plusieurs semaines après.
  const reseau = reseauNormal();
  for (const chemin of cheminsDuMenu()) {
    reseau[chemin] = () => new Response(HTML_COQUILLE_ELEVE, { status: 200 });
  }
  const seances: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const id = `${String(i).padStart(8, "0")}-1111-4111-8111-aaaaaaaaaaaa`;
    seances.push(id);
    reseau[`/entrainement/seance/${id}`] = () => new Response(HTML_COQUILLE_ELEVE, { status: 200 });
  }
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau });
  await bac.installer();
  await bac.activer();
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });

  for (const id of seances) {
    await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement/seance/${id}` });
  }

  const enCache = bac.toutLeCache();
  for (const chemin of cheminsDuMenu()) {
    assert.ok(enCache.includes(`${ORIGINE}${chemin}`), `${chemin} a été expulsée par le plafond`);
  }
});

await test("A37. un NOUVEAU DÉPLOIEMENT rafraîchit les coquilles du menu", async () => {
  // Une coquille figée désigne des fichiers `/_next/static/` d'un
  // déploiement disparu. Hors ligne, elle s'ouvrirait sur une page blanche —
  // pire que la page de secours, parce qu'elle ne dit rien.
  let empreinte = "v1";
  const reseau = reseauNormal();
  const coquille = () =>
    new Response(
      `<!DOCTYPE html><html><head><script src="/_next/static/chunks/app-${empreinte}.js"></script></head><body><nav>menu</nav></body></html>`,
      { status: 200 },
    );
  for (const chemin of cheminsDuMenu()) {
    reseau[chemin] = coquille;
  }
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau });
  await bac.installer();
  await bac.activer();
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });

  const avant = await (await bac.caches.get(`${VERSION_CACHE}-coquille`)!.match(`${ORIGINE}/nutrition`))!.text();
  assert.ok(avant.includes("app-v1.js"));

  // Nouveau déploiement : même URL, empreintes différentes.
  empreinte = "v2";
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });

  const apres = await (await bac.caches.get(`${VERSION_CACHE}-coquille`)!.match(`${ORIGINE}/nutrition`))!.text();
  assert.ok(
    apres.includes("app-v2.js"),
    "la coquille de /nutrition désigne encore les fichiers du déploiement précédent",
  );
});


/* ══════════════════════════════════════════════════════════════════════════
 * UNE COQUILLE SANS SES FICHIERS NE DÉMARRE PAS
 * ══════════════════════════════════════════════════════════════════════════
 * A34 prouvait que le HTML de /nutrition était en cache. Il ne prouvait pas
 * que la page pouvait S'OUVRIR : le document référence des fichiers
 * `/_next/static/`, et ceux-là n'entrent dans le cache que lorsque le
 * navigateur les DEMANDE — c'est-à-dire à la visite. Préparer la coquille
 * d'une route jamais visitée ne les fait donc jamais entrer.
 *
 * Hors ligne, le document s'affiche et reste inerte : pas d'hydratation,
 * pas de React, pas de `SectionIndisponible`. Pire que la page de secours,
 * parce que ça ne dit rien.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Une coquille réaliste : elle référence les fichiers dont elle a besoin. */
function coquilleAvecFichiers(route: string, empreinte = "abc123"): Response {
  return new Response(
    `<!DOCTYPE html><html><head>` +
      `<link rel="stylesheet" href="/_next/static/css/app-${empreinte}.css"/>` +
      `<script src="/_next/static/chunks/framework-${empreinte}.js"></script>` +
      `<script src="/_next/static/chunks/app${route.replace(/\//g, "-")}-${empreinte}.js"></script>` +
      `</head><body><nav>menu</nav><main>Chargement…</main></body></html>`,
    { status: 200 },
  );
}

await test("A38. les FICHIERS de chaque coquille préparée sont en cache, pas seulement son HTML", async () => {
  const menu = cheminsDuMenu();
  const reseau = reseauNormal();
  for (const chemin of menu) {
    reseau[chemin] = () => coquilleAvecFichiers(chemin);
  }
  // Le réseau sait servir les fichiers eux-mêmes.
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: new Proxy(reseau, {
      get(cible, cle: string) {
        if (cle in cible) return cible[cle];
        if (typeof cle === "string" && cle.startsWith("/_next/static/")) {
          return () => new Response("/* fichier de build */", { status: 200 });
        }
        return undefined;
      },
      has(cible, cle: string) {
        return cle in cible || (typeof cle === "string" && cle.startsWith("/_next/static/"));
      },
    }),
  });
  await bac.installer();
  await bac.activer();
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });

  const enCache = bac.toutLeCache();
  for (const chemin of menu) {
    const attendu = `${ORIGINE}/_next/static/chunks/app${chemin.replace(/\//g, "-")}-abc123.js`;
    assert.ok(
      enCache.includes(attendu),
      `le fichier propre à ${chemin} manque : la coquille sera servie mais ne démarrera pas`,
    );
  }
  assert.ok(
    enCache.includes(`${ORIGINE}/_next/static/css/app-abc123.css`),
    "la feuille de style de la coquille manque",
  );
});

await test("A39. seuls des fichiers `/_next/static/` sont préchargés — rien d'autre", async () => {
  const reseau = reseauNormal();
  for (const chemin of cheminsDuMenu()) {
    reseau[chemin] = () =>
      new Response(
        `<!DOCTYPE html><html><head>` +
          `<script src="/_next/static/chunks/ok-1.js"></script>` +
          `<script src="/api/session"></script>` +
          `<script src="https://cdn.example/analytics.js"></script>` +
          `<link rel="stylesheet" href="/brand/logo/logo.svg"/>` +
          `</head><body><nav>menu</nav></body></html>`,
        { status: 200 },
      );
  }
  reseau["/_next/static/chunks/ok-1.js"] = () => new Response("ok", { status: 200 });
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau });
  await bac.installer();
  await bac.activer();
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });

  for (const interdit of ["/api/session", "https://cdn.example/analytics.js", "/brand/logo/logo.svg"]) {
    assert.ok(
      !bac.appelsReseau.some((u) => u === interdit || u === `${ORIGINE}${interdit}`),
      `${interdit} a été suivi — seuls les fichiers de build publics sont autorisés`,
    );
  }
  assert.ok(bac.toutLeCache().includes(`${ORIGINE}/_next/static/chunks/ok-1.js`));
});

await test("A40. un nouveau déploiement remplace AUSSI les fichiers des coquilles", async () => {
  let empreinte = "v1";
  const reseau = reseauNormal();
  for (const chemin of cheminsDuMenu()) {
    reseau[chemin] = () => coquilleAvecFichiers(chemin, empreinte);
  }
  const bac = new BacServiceWorker(CHEMIN_SW, {
    origine: ORIGINE,
    reseau: new Proxy(reseau, {
      get(cible, cle: string) {
        if (cle in cible) return cible[cle];
        if (typeof cle === "string" && cle.startsWith("/_next/static/")) {
          return () => new Response("/* build */", { status: 200 });
        }
        return undefined;
      },
      has(cible, cle: string) {
        return cle in cible || (typeof cle === "string" && cle.startsWith("/_next/static/"));
      },
    }),
  });
  await bac.installer();
  await bac.activer();
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });
  assert.ok(bac.toutLeCache().includes(`${ORIGINE}/_next/static/chunks/app-nutrition-v1.js`));

  empreinte = "v2";
  await bac.message({ type: "coquille-eleve", url: `${ORIGINE}/entrainement` });
  assert.ok(
    bac.toutLeCache().includes(`${ORIGINE}/_next/static/chunks/app-nutrition-v2.js`),
    "les fichiers du nouveau déploiement n'ont pas été pris",
  );
  // Le point de lancement AUSSI : sa coquille est rafraîchie à chaque
  // message, mais ses fichiers partaient avec la purge sans que rien ne les
  // redemande.
  assert.ok(
    bac.toutLeCache().includes(`${ORIGINE}/_next/static/chunks/app-entrainement-v2.js`),
    "les fichiers de la coquille de lancement n'ont pas suivi le déploiement",
  );
  assert.ok(
    !bac.toutLeCache().includes(`${ORIGINE}/_next/static/chunks/app-nutrition-v1.js`),
    "les fichiers du déploiement précédent traînent encore",
  );
});

await test("V4. les caches des générations PRÉCÉDENTES disparaissent, ceux de la génération courante restent", async () => {
  // La stratégie de cache a changé (précache des fichiers de coquille,
  // navigation document hors ligne) : une génération neuve garantit qu'aucun
  // téléphone ne mélange l'ancienne et la nouvelle. Ce cas vérifie que le
  // ménage se fait vraiment, et qu'il ne va pas trop loin.
  const bac = new BacServiceWorker(CHEMIN_SW, { origine: ORIGINE, reseau: reseauNormal() });
  const ouvrir = (nom: string) =>
    (bac as unknown as { ouvrir: (n: string) => { put: (u: string, r: Response) => Promise<void> } }).ouvrir(nom);

  // Trois générations obsolètes, avec les suffixes réellement utilisés.
  for (const version of ["seth-pwa-v1", "seth-pwa-v2", "seth-pwa-v3"]) {
    for (const suffixe of ["-hors-ligne", "-statique", "-coquille", "-meta", "-assets"]) {
      await ouvrir(version + suffixe).put(`/vestige${version}${suffixe}`, new Response("x"));
    }
  }
  assert.ok(bac.toutLeCache().some((u) => u.includes("/vestige")), "les vestiges doivent exister avant l'activation");

  await bac.installer();
  await bac.activer();

  for (const nom of Array.from(bac.caches.keys())) {
    assert.ok(
      nom.startsWith(`${VERSION_CACHE}-`),
      `${nom} appartient à une génération obsolète et aurait dû être supprimé`,
    );
  }
  assert.ok(
    !bac.toutLeCache().some((u) => u.includes("/vestige")),
    "des entrées d'une génération précédente ont survécu",
  );
  // Et la génération courante est bien là, pas seulement vide.
  assert.ok(bac.toutLeCache().includes(`${ORIGINE}/hors-ligne`), "la page de secours doit être reprise");
});

await test("V5. le service worker ne touche JAMAIS à IndexedDB", async () => {
  // Les caches sont jetés à chaque génération ; les données hors ligne, non.
  // Elles vivent dans IndexedDB (snapshot, brouillon, outbox), et ce fichier
  // n'a aucun moyen de les atteindre — ni pour lire, ni pour effacer. Un
  // changement de VERSION ne peut donc rien faire perdre à l'élève.
  const source = readFileSync(CHEMIN_SW, "utf8");
  for (const interdit of ["indexedDB", "IDBDatabase", "IDBFactory", "openDatabase"]) {
    assert.ok(
      !source.includes(interdit),
      `${interdit} apparaît dans public/sw.js — le cache et les données doivent rester étanches`,
    );
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
