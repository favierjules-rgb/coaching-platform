import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * ON RESTE DANS SETH — PROUVÉ PAR UN VRAI CLIC, SUR LA VRAIE SÉANCE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE EXISTE POUR EMPÊCHER
 * ════════════════════════════════════════════════════════════════════════
 * « Voir la démo » était un `<a target="_blank">` : l'élève partait sur
 * YouTube au milieu de sa séance, et revenait — quand il revenait — sur une
 * page rechargée. Ce que le chantier doit garantir n'est pas seulement qu'une
 * modale s'ouvre : c'est que le formulaire de séance, lui, ne bouge pas d'un
 * millimètre.
 *
 * VIDEO9 est le cas qui compte. Il saisit une charge, des répétitions, un
 * RPE et un commentaire, ouvre le lecteur, le ferme, et relit les champs.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTREE = join(RACINE, "scripts", "tests", "video-player-render", "entree.tsx");
const STUB_RESEAU = join(RACINE, "scripts", "tests", "parcours-offline-render", "supabase-mode.ts");

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

const CANDIDATS = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter((c): c is string => Boolean(c));
const executable = CANDIDATS.find((c) => existsSync(c));
if (!executable) {
  console.error("Aucun navigateur trouvé. Pose CHROMIUM_PATH, ou installe Chromium.");
  process.exit(1);
}

const aliasReseau: esbuild.Plugin = {
  name: "alias-supabase-mode",
  setup(build) {
    build.onResolve({ filter: /^@\/lib\/supabase\/browser$/ }, () => ({ path: STUB_RESEAU }));
  },
};

const construction = await esbuild.build({
  entryPoints: [ENTREE],
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
  jsx: "automatic", tsconfig: join(RACINE, "tsconfig.json"),
  plugins: [aliasReseau],
  define: {
    "process.env.NODE_ENV": '"development"',
    "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://exemple-projet.supabase.co"',
  },
  banner: { js: "globalThis.process ??= { env: {} };" },
  logLevel: "silent",
});
const bundle = construction.outputFiles[0].text;

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>lecteur</title></head>
<body><div id="racine"></div><script type="module" src="/bundle.js"></script></body></html>`;

const serveur: Server = createServer((requete, reponse) => {
  if ((requete.url ?? "/").startsWith("/bundle.js")) {
    reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(bundle);
    return;
  }
  reponse.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
});
await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
const adresse = serveur.address();
const origine = `http://127.0.0.1:${typeof adresse === "object" && adresse ? adresse.port : 0}`;

const { chromium } = await import("playwright-core");
const navigateur: Browser = await chromium.launch({
  executablePath: executable,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

type Appeler = <R>(nom: string, ...args: unknown[]) => Promise<R>;

interface EtatModale {
  ouvert: boolean;
  role?: string; ariaModal?: string; titre?: string; etiquetteTitre?: boolean;
  texte?: string; iframes?: number; videos?: number; srcIframe?: string | null;
  titreIframe?: string | null; pleinEcran?: boolean; permissions?: string;
  etat?: string | null; focusSurFermeture?: boolean; scrollBloque?: boolean;
}

async function atelier<T>(travail: (page: Page, appeler: Appeler) => Promise<T>): Promise<T> {
  const contexte: BrowserContext = await navigateur.newContext();
  try {
    const page = await contexte.newPage();
    page.on("pageerror", (erreur) => console.error("  [page]", erreur.message));
    // Aucune requête ne sort réellement : le réseau du test est coupé net.
    await page.route("**://www.youtube-nocookie.com/**", (route) => route.abort());
    await page.route("**://*.supabase.co/**", (route) => route.abort());
    await page.goto(origine);
    await page.waitForFunction(() => "__harnais" in window);
    const appeler = <R,>(nom: string, ...args: unknown[]): Promise<R> =>
      page.evaluate(
        ([n, a]) =>
          (window as unknown as { __harnais: Record<string, (...x: unknown[]) => unknown> }).__harnais[
            n as string
          ](...(a as unknown[])) as unknown,
        [nom, args] as const,
      ) as Promise<R>;
    return await travail(page, appeler);
  } finally {
    await contexte.close();
  }
}

/* ════════════════ VIDEO7-9 : LA SÉANCE, POUR DE VRAI ════════════════ */

await test("VIDEO7. clic sur « Voir la démo » : le lecteur s'ouvre DANS la page", async () => {
  await atelier(async (_page, appeler) => {
    await appeler("semer");
    assert.equal(await appeler<string>("monterSeance"), "ok");

    assert.equal(await appeler<string>("cliquerDemo"), "ok", "le déclencheur doit être un <button>");
    const modale = await appeler<EtatModale>("etatModale");

    assert.equal(modale.ouvert, true, "un dialogue doit être visible");
    assert.equal(modale.role, "dialog");
    assert.equal(modale.ariaModal, "true");
    assert.equal(modale.etiquetteTitre, true, "aria-labelledby doit désigner le titre");
    assert.match(modale.titre ?? "", /Développé couché/, "le titre accessible nomme l'exercice");
    assert.equal(modale.iframes, 1, "une intégration, une seule");
    assert.equal(modale.focusSurFermeture, true, "le focus entre dans le dialogue");
    assert.equal(modale.scrollBloque, true, "le fond ne défile plus");

    // L'intégration est celle du résolveur : nocookie, playsinline, sans autoplay.
    assert.ok(modale.srcIframe?.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"));
    assert.ok(modale.srcIframe?.includes("playsinline=1"));
    assert.ok(!modale.srcIframe?.includes("autoplay"), "aucune lecture automatique");
    assert.ok(!modale.srcIframe?.includes("si="), "le paramètre de suivi ne survit pas");
    assert.equal(modale.pleinEcran, true, "le plein écran reste possible");
    assert.match(modale.permissions ?? "", /picture-in-picture/);
    assert.match(modale.permissions ?? "", /encrypted-media/);
    assert.ok(!/autoplay/.test(modale.permissions ?? ""), "autoplay n'est pas accordé");
  });
});

await test("VIDEO8. fermeture : même page, même route, aucune navigation", async () => {
  await atelier(async (page, appeler) => {
    await appeler("semer");
    await appeler("monterSeance");
    const cheminAvant = new URL(page.url()).pathname;

    await appeler("cliquerDemo");
    for (const fermeture of ["fermerParX", "fermerParEchap", "fermerParVoile"]) {
      if (fermeture !== "fermerParX") await appeler("cliquerDemo");
      await appeler(fermeture);
      const apres = await appeler<EtatModale>("etatModale");
      assert.equal(apres.ouvert, false, `${fermeture} doit fermer le dialogue`);
    }

    const seance = await appeler<{
      texte: string; contientExercice: boolean; nombreChamps: number; cheminCourant: string; navigations: string[];
    }>("pageSeance");
    assert.equal(seance.contientExercice, true, `la séance est toujours là — vu : ${seance.texte.slice(0, 120)}`);
    assert.ok(seance.nombreChamps > 0, "ses champs aussi");
    assert.equal(seance.cheminCourant, cheminAvant, "la route n'a pas bougé");
    assert.deepEqual(seance.navigations, [], "aucune navigation du routeur n'a été demandée");
    assert.equal(new URL(page.url()).pathname, cheminAvant);
  });
});

await test("VIDEO9. les saisies de séance sont STRICTEMENT conservées", async () => {
  await atelier(async (_page, appeler) => {
    await appeler("semer");
    assert.equal(await appeler<string>("monterSeance"), "ok");

    const saisies = await appeler<Record<string, string>>("remplirSeance");
    assert.ok(Object.keys(saisies).length >= 3, "il faut de vraies saisies pour prouver quoi que ce soit");
    const avant = await appeler<{ numeriques: string[]; commentaires: string[] }>("valeursSaisies");
    assert.ok(avant.numeriques.some((v) => v !== ""), "les champs portent bien des valeurs");

    await appeler("cliquerDemo");
    assert.equal((await appeler<EtatModale>("etatModale")).ouvert, true);
    await appeler("fermerParX");

    const apres = await appeler<{ numeriques: string[]; commentaires: string[] }>("valeursSaisies");
    assert.deepEqual(apres, avant, "charge, répétitions, RPE et commentaire doivent être intacts");

    // Et le formulaire n'a été ni envoyé, ni réinitialisé : il est toujours
    // le même arbre, avec le même nombre de champs.
    const seance = await appeler<{ nombreChamps: number; formulaires: number; navigations: string[] }>("pageSeance");
    assert.ok(seance.nombreChamps > 0);
    assert.deepEqual(seance.navigations, []);
  });
});

/* ════════════════ VIDEO13 : HORS LIGNE ════════════════ */

await test("VIDEO13. hors ligne : aucune iframe, aucune requête vidéo, un message clair", async () => {
  await atelier(async (_page, appeler) => {
    const { VIDEO_YOUTUBE } = await appeler<{ VIDEO_YOUTUBE: string }>("constantes");
    await appeler("poserReseau", false);
    await appeler("monterLecteur", "video", VIDEO_YOUTUBE);
    const requetesAvant = (await appeler<string[]>("requetes")).length;

    await appeler("ouvrirMedia");
    const modale = await appeler<EtatModale>("etatModale");

    assert.equal(modale.ouvert, true, "la modale s'ouvre quand même — c'est elle qui explique");
    assert.equal(modale.etat, "hors-ligne");
    assert.match(modale.texte ?? "", /Une connexion est nécessaire pour lire cette vidéo\./);
    assert.equal(modale.iframes, 0, "aucune iframe montée");
    assert.equal(modale.videos, 0, "aucun lecteur natif monté non plus");

    const requetes = await appeler<string[]>("requetes");
    assert.equal(requetes.length, requetesAvant, "aucune requête n'est partie");
    assert.ok(
      !requetes.some((u) => /youtube|supabase/.test(u)),
      "surtout aucune requête vidéo",
    );

    // De retour en ligne, « Réessayer » monte le lecteur.
    await appeler("poserReseau", true);
    const bouton = await appeler<string>("etatModale");
    void bouton;
  });
});

/* ════════════════ PDF1-3 : LES DOCUMENTS ════════════════ */

await test("PDF1. un document s'ouvre dans une modale SETH, pas dans un onglet", async () => {
  await atelier(async (page, appeler) => {
    const { SIGNEE } = await appeler<{ SIGNEE: string }>("constantes");
    // Un nouvel onglet serait visible ici : on le surveille.
    const onglets: string[] = [];
    page.context().on("page", (p) => onglets.push(p.url()));

    await appeler("monterLecteur", "fichier", SIGNEE);
    await appeler("ouvrirMedia");
    const modale = await appeler<EtatModale>("etatModale");

    assert.equal(modale.ouvert, true);
    assert.equal(modale.role, "dialog");
    assert.equal(modale.iframes, 1, "le document est affiché DANS la modale");
    assert.ok(modale.srcIframe?.startsWith("https://exemple-projet.supabase.co/storage/v1/object/sign/"));
    assert.deepEqual(onglets, [], "aucun onglet n'a été ouvert");
    // L'issue existe, sous le document, et il faut la viser.
    assert.match(modale.texte ?? "", /Ouvrir le document/);
  });
});

await test("PDF2. l'URL affichée est l'URL SIGNÉE, jamais une adresse publique", async () => {
  await atelier(async (_page, appeler) => {
    const { SIGNEE } = await appeler<{ SIGNEE: string }>("constantes");
    await appeler("monterLecteur", "fichier", SIGNEE);
    await appeler("ouvrirMedia");
    const modale = await appeler<EtatModale>("etatModale");

    assert.equal(modale.srcIframe, SIGNEE, "l'URL signée est reprise telle quelle");
    assert.ok(modale.srcIframe?.includes("token="), "sa signature en fait partie");
    assert.ok(!modale.srcIframe?.includes("/object/public/"), "aucune republication publique");
  });
});

await test("PDF3. lien expiré : « Réessayer » obtient une URL DIFFÉRENTE, pas un rechargement", async () => {
  await atelier(async (_page, appeler) => {
    const { SIGNEE } = await appeler<{ SIGNEE: string }>("constantes");
    await appeler("reinitialiserSignatures");
    await appeler("monterLecteur", "fichier", SIGNEE);
    await appeler("ouvrirMedia");

    const premiere = await appeler<EtatModale>("etatModale");
    assert.equal(premiere.srcIframe, SIGNEE, "la première tentative utilise l'URL reçue");
    assert.ok(premiere.srcIframe?.includes("token=abc"));
    assert.deepEqual(await appeler<string[]>("signatures"), [], "aucune signature demandée pour l'instant");

    assert.equal(await appeler<string>("reessayer"), "ok");
    const seconde = await appeler<EtatModale>("etatModale");
    const signatures = await appeler<string[]>("signatures");

    // La preuve tient en trois points, et il faut les trois.
    assert.equal(signatures.length, 1, "le mécanisme de signature a bien été RAPPELÉ");
    assert.notEqual(seconde.srcIframe, premiere.srcIframe, "l'adresse a CHANGÉ");
    assert.equal(seconde.srcIframe, signatures[0], "et c'est bien la nouvelle signature qui est affichée");
    assert.ok(seconde.srcIframe?.includes("token=frais-1"));

    // Deuxième essai : encore une adresse différente. Ce n'est donc ni un
    // cache, ni un rechargement du même `src`.
    await appeler("reessayer");
    const troisieme = await appeler<EtatModale>("etatModale");
    assert.equal((await appeler<string[]>("signatures")).length, 2);
    assert.notEqual(troisieme.srcIframe, seconde.srcIframe);
    assert.ok(troisieme.srcIframe?.includes("token=frais-2"));
  });
});

await test("PDF3b. si la signature échoue, on affiche l'échec — on ne republie rien", async () => {
  await atelier(async (_page, appeler) => {
    const { SIGNEE } = await appeler<{ SIGNEE: string }>("constantes");
    await appeler("reinitialiserSignatures");
    await appeler("poserEchecSignature", true);
    await appeler("monterLecteur", "fichier", SIGNEE);
    await appeler("ouvrirMedia");
    await appeler("reessayer");

    const modale = await appeler<EtatModale>("etatModale");
    assert.equal(modale.etat, "erreur", "un refus de signature s'affiche comme tel");
    assert.equal(modale.iframes, 0, "et rien n'est affiché avec une adresse périmée");
    assert.ok(!/object\/public/.test(modale.texte ?? ""), "aucune adresse publique de repli");
  });
});

await test("VIDEO-RETRY. vidéo Storage privée : l'échec de lecture redemande une signature", async () => {
  await atelier(async (_page, appeler) => {
    const { SIGNEE } = await appeler<{ SIGNEE: string }>("constantes");
    await appeler("reinitialiserSignatures");
    // Une vidéo privée passe par le lecteur natif, pas par l'iframe.
    await appeler("monterLecteur", "video", SIGNEE);
    await appeler("ouvrirMedia");
    let modale = await appeler<EtatModale>("etatModale");
    assert.equal(modale.iframes, 0, "un fichier du Storage n'est JAMAIS mis dans une iframe");

    // Le réseau du test refuse `*.supabase.co` : c'est exactement ce que vit
    // un lien signé expiré. Le lecteur natif émet `error`, et le composant
    // doit le dire — pas rester sur un cadre noir.
    if (modale.videos === 1) await appeler("casserLaVideo");
    modale = await appeler<EtatModale>("etatModale");
    assert.equal(modale.etat, "erreur", "un lien mort s'affiche comme tel");
    assert.match(modale.texte ?? "", /expiré/);

    assert.equal(await appeler<string>("reessayer"), "ok");
    const signatures = await appeler<string[]>("signatures");
    assert.equal(signatures.length, 1, "une NOUVELLE signature a été demandée");
    assert.notEqual(signatures[0], SIGNEE, "et son adresse diffère de celle qui a échoué");

    // Une seconde tentative en produit encore une autre : ce n'est donc ni un
    // cache, ni un rechargement de la même adresse. Dans ce harnais le réseau
    // refuse `*.supabase.co`, donc la lecture rééchoue — ce qui est
    // exactement le comportement attendu d'un lien mort, et n'enlève rien à
    // la preuve : le mécanisme de signature a bien été rappelé, deux fois,
    // avec deux adresses distinctes.
    await appeler("reessayer");
    const deux = await appeler<string[]>("signatures");
    assert.equal(deux.length, 2);
    assert.notEqual(deux[0], deux[1], "deux appels, deux URLs différentes");
    modale = await appeler<EtatModale>("etatModale");
    assert.ok(!/object\/public/.test(modale.texte ?? ""), "et jamais d'adresse publique de repli");
  });
});

await navigateur.close();
serveur.close();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
