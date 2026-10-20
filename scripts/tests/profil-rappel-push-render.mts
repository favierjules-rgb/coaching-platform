/**
 * Harnais NAVIGATEUR — LE RAPPEL DE RÉACTIVATION, CLIQUÉ POUR DE VRAI.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️ CETTE SUITE EXIGE UN CHROMIUM, ET ELLE N'A PAS ÉTÉ EXÉCUTÉE DANS  ║
 * ║    L'ENVIRONNEMENT QUI L'A ÉCRITE.                                   ║
 * ║                                                                      ║
 * ║    Elle sort en code 1 avec un message explicite si aucun navigateur ║
 * ║    n'est trouvé — comme `profil-push-render`, dont elle réutilise le  ║
 * ║    harnais React. À lancer sur un poste qui a Chromium :             ║
 * ║                                                                      ║
 * ║        npm run test:profil-rappel-push-render                        ║
 * ║        CHROMIUM_PATH=/chemin/vers/chromium npm run …  (si besoin)    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE PROUVE, ET QU'AUCUN TEST NODE NE PEUT PROUVER
 * ────────────────────────────────────────────────────────────────────────────
 * Le CLIC. `scripts/tests/profil-rappel-push.mts` exécute la table de vérité
 * et le parcours d'activation (fonctions pures, dépendances injectées), mais
 * jamais un évènement réel sur un vrai bouton dans un vrai arbre React.
 *
 * RAPPEL1  notifications actives → AUCUNE fenêtre.
 * RAPPEL2  abonnement absent malgré une permission accordée → fenêtre, et le
 *          clic sur « Réactiver » abonne, enregistre et FERME la fenêtre.
 * RAPPEL3  permission `default` → la permission n'est demandée qu'AU CLIC.
 * RAPPEL4  permission `denied` → instructions de réglages, aucun bouton
 *          d'activation, et AUCUNE demande de permission.
 * RAPPEL5  « Plus tard » → fermeture, et rien d'autre : aucun appel réseau.
 * RAPPEL6  échec serveur → la fenêtre reste, avec une erreur, et l'état
 *          n'annonce jamais un succès.
 * RAPPEL7  abonnement présent mais serveur qui l'a oublié → réactivation
 *          SANS créer un second abonnement.
 * RAPPEL8  aucune boucle : la fenêtre fermée ne se rouvre pas, même après
 *          plusieurs revalidations.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright-core";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOSSIER = join(RACINE, "scripts", "tests", "profil-push-render");
const ENTREE = join(DOSSIER, "entree.tsx");
const STUB_PROFIL = join(DOSSIER, "profil-charge.ts");
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

const alias: esbuild.Plugin = {
  name: "alias-rappel-push",
  setup(build) {
    build.onResolve({ filter: /^@\/lib\/supabase\/browser$/ }, () => ({ path: STUB_RESEAU }));
    build.onResolve({ filter: /^@\/hooks\/useSupabaseStudentProfile$/ }, (a) =>
      a.importer === STUB_PROFIL ? null : { path: STUB_PROFIL });
  },
};

const construction = await esbuild.build({
  entryPoints: [ENTREE],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  tsconfig: join(RACINE, "tsconfig.json"),
  plugins: [alias],
  define: {
    "process.env.NODE_ENV": '"development"',
    // Sans clé publique, le parcours sort en « non configuré » avant tout.
    "process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY": '"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ"',
  },
  banner: { js: "globalThis.process ??= { env: {} };" },
  logLevel: "silent",
});
const bundle = construction.outputFiles[0].text;

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>rappel-push</title></head>
<body><div id="racine"></div><script type="module" src="/bundle.js"></script></body></html>`;

/* ══════════════════════════════════════════════════════════════════════════
   LE SERVEUR — il joue les deux routes push, et compte les appels
   ══════════════════════════════════════════════════════════════════════════ */

interface Reglages {
  /** Réponse de POST /api/push/status. */
  statut: { connu: boolean; actif: boolean };
  /** POST /api/push/subscribe réussit ? */
  abonnementAccepte: boolean;
}
const reglages: Reglages = { statut: { connu: true, actif: true }, abonnementAccepte: true };
let appels: string[] = [];

const serveur: Server = createServer((requete, reponse) => {
  const url = requete.url ?? "/";
  if (url.startsWith("/bundle.js")) {
    reponse.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(bundle);
    return;
  }
  if (url.startsWith("/api/push/status")) {
    appels.push("status");
    reponse
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(reglages.statut));
    return;
  }
  if (url.startsWith("/api/push/subscribe")) {
    appels.push("subscribe");
    if (!reglages.abonnementAccepte) {
      reponse.writeHead(500, { "content-type": "application/json" }).end('{"error":"non"}');
      return;
    }
    // Un enregistrement accepté rend l'appareil connu ET actif : c'est ce que
    // la relecture d'état doit constater juste après.
    reglages.statut = { connu: true, actif: true };
    reponse.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    return;
  }
  if (url.startsWith("/api/push/unsubscribe")) {
    appels.push("unsubscribe");
    reponse.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
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

interface Vu {
  texte: string;
  boutons: string[];
}
type Appeler = <R>(nom: string, ...args: unknown[]) => Promise<R>;

async function atelier<T>(travail: (page: Page, appeler: Appeler) => Promise<T>): Promise<T> {
  const contexte: BrowserContext = await navigateur.newContext();
  try {
    const page = await contexte.newPage();
    page.on("pageerror", (erreur) => console.error("  [page]", erreur.message));
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

async function attendre(appeler: Appeler, predicat: (v: Vu) => boolean, limiteMs = 8000): Promise<Vu> {
  const fin = Date.now() + limiteMs;
  let vu = await appeler<Vu>("vu");
  while (!predicat(vu) && Date.now() < fin) {
    await new Promise((ok) => setTimeout(ok, 60));
    vu = await appeler<Vu>("vu");
  }
  return vu;
}

const TEXTE_RAPPEL = /pense à réactiver les notifications push/;

interface Decor {
  permission: NotificationPermission;
  abonne: boolean;
  reponsePermission?: NotificationPermission;
  statut?: { connu: boolean; actif: boolean };
  abonnementAccepte?: boolean;
}

async function monter(appeler: Appeler, decor: Decor): Promise<void> {
  reglages.statut = decor.statut ?? { connu: true, actif: true };
  reglages.abonnementAccepte = decor.abonnementAccepte ?? true;
  appels = [];
  await appeler("environnementPushDetaille", {
    permission: decor.permission,
    abonne: decor.abonne,
    reponsePermission: decor.reponsePermission,
  });
  await appeler("profilCharge", true);
  await appeler("monterProfil");
}

/* ══════════════════════════════════════════════════════════════════════════ */

await test("RAPPEL1. notifications réellement actives → AUCUNE fenêtre", async () => {
  await atelier(async (_page, appeler) => {
    await monter(appeler, { permission: "granted", abonne: true, statut: { connu: true, actif: true } });
    const vu = await attendre(appeler, (v) =>
      v.boutons.some((b) => /Désactiver sur cet appareil/.test(b)),
    );
    assert.ok(
      !TEXTE_RAPPEL.test(vu.texte),
      `la fenêtre ne doit jamais s'ouvrir quand c'est actif. Rendu : ${vu.texte.slice(0, 200)}`,
    );
    assert.ok(vu.boutons.some((b) => /Désactiver sur cet appareil/.test(b)), "le bloc dit « actif »");
  });
});

await test("RAPPEL2. abonnement absent malgré une permission accordée : le CLIC réactive", async () => {
  await atelier(async (page, appeler) => {
    await monter(appeler, {
      permission: "granted",
      abonne: false,
      statut: { connu: false, actif: false },
    });
    const avant = await attendre(appeler, (v) => TEXTE_RAPPEL.test(v.texte));
    assert.match(avant.texte, TEXTE_RAPPEL, "la fenêtre doit s'ouvrir");
    assert.ok(
      avant.boutons.some((b) => /Réactiver les notifications/.test(b)),
      "…avec le bouton principal",
    );

    await page.getByRole("button", { name: "Réactiver les notifications" }).first().click();

    const apres = await attendre(appeler, (v) => !TEXTE_RAPPEL.test(v.texte), 10000);
    assert.ok(!TEXTE_RAPPEL.test(apres.texte), "une activation réussie FERME la fenêtre");
    assert.ok(
      apres.boutons.some((b) => /Désactiver sur cet appareil/.test(b)),
      "…et le bloc « Notifications » est synchronisé sur « actif »",
    );
    const c = await appeler<{ subscribe: number }>("compteurs");
    assert.equal(c.subscribe, 1, "un abonnement a bien été créé");
    assert.ok(appels.includes("subscribe"), "…et enregistré au serveur");
  });
});

await test("RAPPEL3. permission `default` : la permission n'est demandée QU'AU CLIC", async () => {
  await atelier(async (page, appeler) => {
    await monter(appeler, {
      permission: "default",
      abonne: false,
      statut: { connu: false, actif: false },
    });
    await attendre(appeler, (v) => TEXTE_RAPPEL.test(v.texte));
    const avant = await appeler<{ requestPermission: number }>("compteurs");
    assert.equal(
      avant.requestPermission,
      0,
      "⚠️ aucune demande au chargement : un refus serait définitif",
    );

    await page.getByRole("button", { name: "Réactiver les notifications" }).first().click();
    await attendre(appeler, (v) => !TEXTE_RAPPEL.test(v.texte), 10000);

    const apres = await appeler<{ requestPermission: number }>("compteurs");
    assert.equal(apres.requestPermission, 1, "une seule demande, et elle vient du clic");
  });
});

await test("RAPPEL4. permission `denied` : instructions de réglages, aucun contournement", async () => {
  await atelier(async (_page, appeler) => {
    await monter(appeler, { permission: "denied", abonne: false });
    const vu = await attendre(appeler, (v) => TEXTE_RAPPEL.test(v.texte));
    assert.match(vu.texte, /bloquées pour ce site/, "la fenêtre explique le blocage");
    assert.match(vu.texte, /Réglages/, "…et donne le chemin des réglages");
    assert.ok(
      !vu.boutons.some((b) => /Réactiver les notifications/.test(b)),
      "⚠️ aucun bouton d'activation : redemander ne produirait rien",
    );
    assert.ok(vu.boutons.some((b) => /Plus tard/.test(b)), "« Plus tard » reste disponible");
    const c = await appeler<{ requestPermission: number }>("compteurs");
    assert.equal(c.requestPermission, 0, "⚠️ aucune demande de permission, jamais");
  });
});

await test("RAPPEL5. « Plus tard » ferme la fenêtre et ne touche à RIEN", async () => {
  await atelier(async (page, appeler) => {
    await monter(appeler, {
      permission: "granted",
      abonne: false,
      statut: { connu: false, actif: false },
    });
    await attendre(appeler, (v) => TEXTE_RAPPEL.test(v.texte));
    const appelsAvant = [...appels];

    await page.getByRole("button", { name: "Plus tard" }).first().click();

    const vu = await attendre(appeler, (v) => !TEXTE_RAPPEL.test(v.texte));
    assert.ok(!TEXTE_RAPPEL.test(vu.texte), "la fenêtre est fermée");
    assert.ok(
      !appels.slice(appelsAvant.length).includes("unsubscribe"),
      "⚠️ aucun désabonnement : « Plus tard » ne désactive rien",
    );
    assert.ok(
      !appels.slice(appelsAvant.length).includes("subscribe"),
      "…et aucun enregistrement non demandé",
    );
    const c = await appeler<{ requestPermission: number; subscribe: number }>("compteurs");
    assert.equal(c.requestPermission, 0, "aucune permission demandée");
    assert.equal(c.subscribe, 0, "aucun abonnement créé");
    // Le bloc du profil reste cohérent : toujours réactivable.
    assert.ok(
      vu.boutons.some((b) => /Réactiver les notifications/.test(b)),
      "le bloc garde le bouton : la préférence n'a pas changé",
    );
  });
});

await test("RAPPEL6. le serveur refuse : la fenêtre reste, avec une erreur, sans faux succès", async () => {
  await atelier(async (page, appeler) => {
    await monter(appeler, {
      permission: "granted",
      abonne: false,
      statut: { connu: false, actif: false },
      abonnementAccepte: false,
    });
    await attendre(appeler, (v) => TEXTE_RAPPEL.test(v.texte));
    await page.getByRole("button", { name: "Réactiver les notifications" }).first().click();

    const vu = await attendre(appeler, (v) => /n'a pas pu enregistrer cet appareil/.test(v.texte), 10000);
    assert.match(vu.texte, /n'a pas pu enregistrer cet appareil/, "l'échec est affiché");
    assert.match(vu.texte, /pas encore actives/, "⚠️ et il dit que ce n'est PAS activé");
    assert.ok(
      !vu.boutons.some((b) => /Désactiver sur cet appareil/.test(b)),
      "⚠️ le bloc ne doit JAMAIS basculer sur « actif » après un échec",
    );
  });
});

await test("RAPPEL7. abonnement présent mais serveur qui l'a oublié : AUCUN second abonnement", async () => {
  await atelier(async (page, appeler) => {
    await monter(appeler, {
      permission: "granted",
      abonne: true,
      // Le cas « après une mise à jour » : le navigateur a un abonnement, le
      // serveur ne le connaît plus.
      statut: { connu: false, actif: false },
    });
    const avant = await attendre(appeler, (v) => TEXTE_RAPPEL.test(v.texte));
    assert.match(avant.texte, TEXTE_RAPPEL, "la divergence est détectée");

    await page.getByRole("button", { name: "Réactiver les notifications" }).first().click();
    await attendre(appeler, (v) => !TEXTE_RAPPEL.test(v.texte), 10000);

    const c = await appeler<{ subscribe: number }>("compteurs");
    assert.equal(
      c.subscribe,
      0,
      "⚠️ `subscribe()` ne doit PAS être appelé : l'abonnement existant est réutilisé",
    );
    assert.ok(appels.includes("subscribe"), "…mais il est réenregistré au serveur");
  });
});

await test("RAPPEL8. aucune boucle : une fenêtre fermée ne se rouvre pas", async () => {
  await atelier(async (page, appeler) => {
    await monter(appeler, {
      permission: "granted",
      abonne: false,
      statut: { connu: false, actif: false },
    });
    await attendre(appeler, (v) => TEXTE_RAPPEL.test(v.texte));
    await page.getByRole("button", { name: "Plus tard" }).first().click();
    await attendre(appeler, (v) => !TEXTE_RAPPEL.test(v.texte));

    // Plusieurs revalidations : c'est exactement ce qui rouvrirait la fenêtre
    // sans le verrou (retour sur l'onglet, fin d'activation, re-rendu).
    for (let i = 0; i < 4; i += 1) {
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await new Promise((ok) => setTimeout(ok, 150));
    }
    const vu = await appeler<Vu>("vu");
    assert.ok(
      !TEXTE_RAPPEL.test(vu.texte),
      "⚠️ la fenêtre ne doit pas se rouvrir après « Plus tard » pendant la même visite",
    );

    // …mais une NOUVELLE visite (remontage) la repropose, tant que c'est inactif.
    await appeler("monterProfil");
    const apres = await attendre(appeler, (v) => TEXTE_RAPPEL.test(v.texte));
    assert.match(apres.texte, TEXTE_RAPPEL, "une prochaine visite doit pouvoir la réafficher");
  });
});

await navigateur.close();
serveur.close();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
