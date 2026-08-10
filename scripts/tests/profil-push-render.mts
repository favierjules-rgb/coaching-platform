import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";
import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * /profil NE DOIT JAMAIS DÉPENDRE DES NOTIFICATIONS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE BOGUE QUE CETTE SUITE EXISTE POUR EMPÊCHER DE REVENIR
 * ════════════════════════════════════════════════════════════════════════
 * 10/08/2026, iPhone, Safari ET PWA, réseau normal : `/profil` affichait
 * « Chargement du profil… » et n'en sortait jamais.
 *
 * `ProfilPageContent` appelle `useEtatOfflineEleve(ready && !useSupabase)`,
 * puis rendait « Chargement du profil… » dès que `local.etat` valait
 * `"chargement"` — SANS la garde `!useSupabase` que `DashboardContent`
 * porte (ligne 99). Or quand le profil Supabase arrive, `useSupabase`
 * devient vrai, `enquerir` devient faux, l'effet du hook sort à sa première
 * ligne (`if (!enquerir) return;`) et `etat` reste `"chargement"` pour
 * toujours. Le profil chargé n'était donc JAMAIS affiché — pour tous les
 * élèves Supabase, en ligne comme hors ligne, avec ou sans Push.
 *
 * Aucun test ne pouvait l'attraper : `parcours-offline-render` ne montait
 * `/profil` que HORS LIGNE (PROF1), le seul cas où `useSupabase` est faux.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CHAQUE CAS PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * PROFILPUSH1  Safari hors PWA (pas de PushManager) → profil affiché,
 *              bloc Notifications en `non_supporte`.
 * PROFILPUSH2  `serviceWorker.ready` ne se résout jamais → profil affiché
 *              ENTIÈREMENT. Push n'a aucun droit de veto sur le rendu.
 * PROFILPUSH3  permission refusée → profil affiché + message de refus.
 * PROFILPUSH4  `getSubscription()` rejette → profil affiché + bloc en
 *              erreur, avec le bouton d'activation.
 * PROFILPUSH5  profil Supabase chargé, Push nominal → la page ne reste
 *              JAMAIS sur « Chargement du profil… ». (LA RÉGRESSION.)
 * PROFILPUSH6  `ready` ne se résout jamais → `useNotificationsPush` sort de
 *              `chargement` dans un délai BORNÉ, et se corrige si `ready`
 *              finit par arriver.
 */

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
  name: "alias-profil-push",
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
  define: { "process.env.NODE_ENV": '"development"' },
  banner: { js: "globalThis.process ??= { env: {} };" },
  logLevel: "silent",
});
const bundle = construction.outputFiles[0].text;

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>profil-push</title></head>
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

interface Vu {
  texte: string;
  boutons: string[];
}

type Appeler = <R>(nom: string, ...args: unknown[]) => Promise<R>;

/** Un CONTEXTE NEUF par cas : les substitutions de `navigator` ne fuient pas. */
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

/**
 * On INTERROGE depuis Node, on n'attend pas depuis la page : un prédicat
 * `async` passé à `waitForFunction` rend une Promesse — toujours vraie — et
 * le test passerait sans rien vérifier.
 */
async function attendre(appeler: Appeler, predicat: (v: Vu) => boolean, limiteMs: number): Promise<Vu> {
  const fin = Date.now() + limiteMs;
  let vu = await appeler<Vu>("vu");
  while (!predicat(vu) && Date.now() < fin) {
    await new Promise((ok) => setTimeout(ok, 50));
    vu = await appeler<Vu>("vu");
  }
  return vu;
}

const CHARGEMENT = /Chargement du profil/;

/** Le profil réel est là : le prénom Supabase, et pas l'écran d'attente. */
function profilAffiche(vu: Vu, prenom: string): boolean {
  return vu.texte.includes(prenom) && !CHARGEMENT.test(vu.texte);
}

async function monterAvec(appeler: Appeler, mode: string): Promise<void> {
  await appeler("environnementPush", mode);
  await appeler("profilCharge", true);
  await appeler("monterProfil");
}

// ════════════════════════════════════════════════════════════════════════
// PROFILPUSH5 D'ABORD : c'est la régression signalée.
// ════════════════════════════════════════════════════════════════════════
await test(
  "PROFILPUSH5. profil Supabase chargé : la page ne reste JAMAIS sur « Chargement du profil… »",
  async () => {
    await atelier(async (_page, appeler) => {
      const { PRENOM_REEL } = await appeler<{ PRENOM_REEL: string }>("constantes");
      await monterAvec(appeler, "abonne");
      const vu = await attendre(
        appeler,
        (v) => profilAffiche(v, PRENOM_REEL) && /Désactiver sur cet appareil/.test(v.boutons.join("|")),
        6000,
      );
      assert.ok(
        !CHARGEMENT.test(vu.texte),
        `/profil est resté sur l'écran d'attente. Rendu : ${vu.texte.slice(0, 200)}`,
      );
      assert.ok(vu.texte.includes(PRENOM_REEL), "le profil Supabase chargé doit être affiché");
      assert.ok(
        !vu.texte.includes("Alexandre"),
        "le profil de démonstration ne doit jamais apparaître",
      );
      assert.ok(
        vu.boutons.some((b) => /Désactiver sur cet appareil/.test(b)),
        "un appareil déjà abonné doit pouvoir se désabonner",
      );
    });
  },
);

await test(
  "PROFILPUSH1. Safari hors PWA (pas de PushManager) : profil affiché, notifications « non supportées »",
  async () => {
    await atelier(async (_page, appeler) => {
      const { PRENOM_REEL } = await appeler<{ PRENOM_REEL: string }>("constantes");
      await monterAvec(appeler, "absent");
      // La détection doit être RÉELLE : si le retrait n'avait pas pris, le
      // cas se replierait sur le délai de garde et prouverait autre chose.
      const support = await appeler<Record<string, boolean>>("supportPush");
      assert.equal(support.serviceWorker, false, "navigator.serviceWorker doit avoir disparu");
      assert.equal(support.pushManager, false, "window.PushManager doit avoir disparu");
      const vu = await attendre(
        appeler,
        (v) => profilAffiche(v, PRENOM_REEL) && /ne gère pas les notifications/.test(v.texte),
        6000,
      );
      assert.ok(profilAffiche(vu, PRENOM_REEL), `profil non affiché : ${vu.texte.slice(0, 200)}`);
      assert.match(
        vu.texte,
        /ne gère pas les notifications/,
        "le bloc doit dire non supporté, pas rester muet",
      );
      assert.ok(
        !vu.boutons.some((b) => /Activer les notifications/.test(b)),
        "aucun bouton d'activation quand le navigateur ne sait pas le faire",
      );
    });
  },
);

await test(
  "PROFILPUSH2. `serviceWorker.ready` ne se résout jamais : le profil s'affiche entièrement",
  async () => {
    await atelier(async (_page, appeler) => {
      const { PRENOM_REEL } = await appeler<{ PRENOM_REEL: string }>("constantes");
      await monterAvec(appeler, "ready_jamais");
      const vu = await attendre(appeler, (v) => profilAffiche(v, PRENOM_REEL), 6000);
      assert.ok(profilAffiche(vu, PRENOM_REEL), `profil non affiché : ${vu.texte.slice(0, 200)}`);
      // Les sections qui n'ont rien à voir avec le Push doivent être là.
      assert.match(vu.texte, /Informations personnelles/);
      assert.match(vu.texte, /Objectif principal/);
    });

    /* LE CONTRAT, ET PAS SEULEMENT SON EFFET.
     *
     * Les quatre cas ci-dessus prouvent que le Push ne bloque pas le profil
     * DANS CES QUATRE SITUATIONS. Ce contrôle-ci dit pourquoi c'est vrai en
     * général : rien du Push n'est lu avant que le profil ne soit rendu.
     * `NotificationsSection` est monté DANS l'arbre final, après toutes les
     * sorties anticipées ; aucun état Push n'entre dans une condition de
     * rendu du profil. */
    const source = await readFile(join(RACINE, "components", "student", "ProfilPageContent.tsx"), "utf8");
    const avantLeRendu = source.slice(0, source.indexOf("<NotificationsSection"));
    for (const interdit of ["useNotificationsPush", "EtatNotifications", "Notification.permission", "serviceWorker"]) {
      assert.ok(
        !avantLeRendu.includes(interdit),
        `ProfilPageContent lit « ${interdit} » avant de rendre le profil : le Push reprendrait un droit de veto`,
      );
    }
    assert.ok(
      source.indexOf("<NotificationsSection") > source.lastIndexOf("Chargement du profil…"),
      "NotificationsSection doit être monté APRÈS les sorties anticipées, jamais avant",
    );
  },
);

await test("PROFILPUSH3. permission refusée : profil affiché, et le bloc dit comment revenir", async () => {
  await atelier(async (_page, appeler) => {
    const { PRENOM_REEL } = await appeler<{ PRENOM_REEL: string }>("constantes");
    await monterAvec(appeler, "refuse");
    const vu = await attendre(
      appeler,
      (v) => profilAffiche(v, PRENOM_REEL) && /ont été refusées/.test(v.texte),
      6000,
    );
    assert.ok(profilAffiche(vu, PRENOM_REEL), `profil non affiché : ${vu.texte.slice(0, 200)}`);
    assert.match(vu.texte, /ont été refusées/);
    assert.ok(
      !vu.boutons.some((b) => /Activer les notifications/.test(b)),
      "un refus iOS ne se rattrape pas depuis la page",
    );
  });
});

await test("PROFILPUSH4. `getSubscription()` rejette : profil affiché, bloc en erreur réessayable", async () => {
  await atelier(async (_page, appeler) => {
    const { PRENOM_REEL } = await appeler<{ PRENOM_REEL: string }>("constantes");
    await monterAvec(appeler, "getSubscription_rejette");
    const vu = await attendre(
      appeler,
      (v) => profilAffiche(v, PRENOM_REEL) && /Activer les notifications/.test(v.boutons.join("|")),
      6000,
    );
    assert.ok(profilAffiche(vu, PRENOM_REEL), `profil non affiché : ${vu.texte.slice(0, 200)}`);
    assert.ok(
      vu.boutons.some((b) => /Activer les notifications/.test(b)),
      "une panne passagère doit laisser un moyen de réessayer",
    );
  });
});

await test(
  "PROFILPUSH6. `ready` sans réponse : l'attente est BORNÉE, et l'état se corrige si elle finit par arriver",
  async () => {
    await atelier(async (_page, appeler) => {
      const { PRENOM_REEL } = await appeler<{ PRENOM_REEL: string }>("constantes");
      await monterAvec(appeler, "ready_jamais");
      // Le bloc Notifications rend `null` tant que l'état vaut `chargement`.
      // S'il n'apparaît jamais, l'élève n'a aucun moyen de savoir pourquoi.
      const vu = await attendre(appeler, (v) => /Notifications/.test(v.texte), 8000);
      assert.match(
        vu.texte,
        /Notifications/,
        "le bloc doit finir par apparaître : une attente non bornée le rend invisible pour toujours",
      );
      assert.ok(profilAffiche(vu, PRENOM_REEL), "et le profil reste affiché pendant ce temps");
    });

    await atelier(async (_page, appeler) => {
      await monterAvec(appeler, "ready_tardif");
      // `ready` arrive après l'expiration : l'état doit être CORRIGÉ, pas figé.
      const vu = await attendre(
        appeler,
        (v) => /Désactiver sur cet appareil/.test(v.boutons.join("|")),
        12000,
      );
      assert.ok(
        vu.boutons.some((b) => /Désactiver sur cet appareil/.test(b)),
        "un enregistrement tardif doit remplacer l'état provisoire par l'état réel",
      );
    });
  },
);

await navigateur.close();
serveur.close();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);
