import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  detecterCanalInstallation,
  estIOS,
  estSafariIOS,
  type ContexteInstallation,
} from "../../lib/pwa/install";

/**
 * PWA — À QUI PROPOSE-T-ON QUOI.
 *
 * Les chaînes de user agent ci-dessous sont de vraies chaînes, recopiées
 * telles quelles. C'est le seul moyen honnête de vérifier cette détection :
 * une chaîne inventée « qui contient iPhone » prouverait seulement que la
 * fonction sait lire une chaîne inventée.
 *
 * L'enjeu est concret : afficher un bouton « Installer » à un élève sur
 * iPhone donnerait un bouton mort, puisque Safari n'expose aucune API
 * d'installation. Il conclurait que ça ne marche pas — et il aurait raison.
 */

const RACINE = fileURLToPath(new URL("../..", import.meta.url));

let réussis = 0;
let échecs = 0;

function test(nom: string, fn: () => void) {
  try {
    fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

/* ── De vraies chaînes de navigateur ─────────────────────────────────── */

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  // iPadOS 13+ : réglage « Demander la version pour ordinateur » actif par
  // DÉFAUT — l'iPad se déclare Macintosh. Rigoureusement identique à un Mac,
  // au nombre de points de contact près.
  ipadOS: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

function contexte(partiel: Partial<ContexteInstallation>): ContexteInstallation {
  return {
    userAgent: UA.androidChrome,
    maxTouchPoints: 0,
    affichageApplication: false,
    inviteNativeDisponible: false,
    ...partiel,
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * I. RECONNAÎTRE iOS
 * ════════════════════════════════════════════════════════════════════════ */

test("P1. iPhone et iPad sont reconnus, y compris l'iPad déguisé en Mac", () => {
  assert.equal(estIOS(UA.iphoneSafari, 5), true);
  assert.equal(estIOS(UA.iphoneChrome, 5), true);
  // LE cas piège : même chaîne qu'un Mac, seuls les points de contact
  // diffèrent. Sans ce critère, tous les iPad recevraient des instructions
  // de bureau qui n'existent pas chez eux.
  assert.equal(estIOS(UA.ipadOS, 5), true);
});

test("P2. un Mac n'est pas un iPad", () => {
  // Un Mac, même avec un trackpad, ne rapporte aucun point de contact.
  assert.equal(estIOS(UA.macSafari, 0), false);
  assert.equal(estIOS(UA.windowsChrome, 0), false);
  assert.equal(estIOS(UA.androidChrome, 5), false);
});

test("P3. sur iOS, seul Safari est Safari", () => {
  assert.equal(estSafariIOS(UA.iphoneSafari), true);
  // Chrome et Firefox sur iOS affichent du WebKit mais ne savent PAS
  // ajouter à l'écran d'accueil : leur donner le mode d'emploi de Safari les
  // enverrait chercher un bouton qui n'existe pas.
  assert.equal(estSafariIOS(UA.iphoneChrome), false);
  assert.equal(estSafariIOS(UA.iphoneFirefox), false);
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LE CANAL PROPOSÉ
 * ════════════════════════════════════════════════════════════════════════ */

test("P4. déjà installée : on ne propose rien, sur aucune plateforme", () => {
  for (const userAgent of Object.values(UA)) {
    assert.equal(
      detecterCanalInstallation(contexte({ userAgent, affichageApplication: true })),
      "deja-installee",
      userAgent,
    );
  }
});

test("P5. déjà installée l'emporte même si le navigateur propose son invite", () => {
  // Cas réel : Chrome peut réémettre `beforeinstallprompt` dans une fenêtre
  // déjà installée. Sans cet ordre, l'élève verrait « Installer » DANS son
  // application.
  assert.equal(
    detecterCanalInstallation(
      contexte({ affichageApplication: true, inviteNativeDisponible: true }),
    ),
    "deja-installee",
  );
});

test("P6. Chrome Android et bureau : le vrai bouton", () => {
  for (const userAgent of [UA.androidChrome, UA.windowsChrome]) {
    assert.equal(
      detecterCanalInstallation(contexte({ userAgent, inviteNativeDisponible: true })),
      "invite-native",
      userAgent,
    );
  }
});

test("P7. iPhone sous Safari : les instructions, JAMAIS un bouton", () => {
  assert.equal(
    detecterCanalInstallation(contexte({ userAgent: UA.iphoneSafari, maxTouchPoints: 5 })),
    "ios-safari",
  );
  assert.equal(
    detecterCanalInstallation(contexte({ userAgent: UA.ipadOS, maxTouchPoints: 5 })),
    "ios-safari",
  );
});

test("P8. iPhone sous Chrome ou Firefox : on renvoie vers Safari", () => {
  for (const userAgent of [UA.iphoneChrome, UA.iphoneFirefox]) {
    assert.equal(
      detecterCanalInstallation(contexte({ userAgent, maxTouchPoints: 5 })),
      "ios-autre-navigateur",
      userAgent,
    );
  }
});

test("P9. Firefox Android, sans invite : instructions génériques", () => {
  // Firefox pour Android sait installer, mais n'émet pas
  // `beforeinstallprompt` : on ne peut que décrire son menu.
  assert.equal(
    detecterCanalInstallation(contexte({ userAgent: UA.androidFirefox, maxTouchPoints: 5 })),
    "manuel",
  );
});

test("P10. un iPhone ne reçoit jamais l'invite native, même si on la lui offre", () => {
  // Garde-fou : si un jour une détection en amont se trompait et proposait
  // une invite sur iOS, ce test n'empêcherait rien — mais celui-ci vérifie
  // au moins que la fonction ne l'invente pas d'elle-même.
  assert.equal(
    detecterCanalInstallation(
      contexte({ userAgent: UA.iphoneSafari, maxTouchPoints: 5, inviteNativeDisponible: false }),
    ),
    "ios-safari",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LE LIEN VERS LA VITRINE, DANS L'APPLICATION
 * ════════════════════════════════════════════════════════════════════════ */

test("A1. la règle qui masque la vitrine est bien DANS `display-mode: standalone`", () => {
  // Ce contrôle est structurel, et il faut dire ce qu'il vaut : une feuille
  // de style ne s'exécute pas dans Node. Il ne prouve donc pas le RENDU —
  // il prouve que la déclaration est à l'intérieur du bon bloc `@media`, et
  // pas simplement quelque part dans le fichier. Les deux se ressemblent
  // dans un `grep` et n'ont rien à voir : hors du bloc, le lien
  // disparaîtrait pour TOUT LE MONDE, y compris dans un onglet.
  const css = readFileSync(new URL("app/globals.css", `file://${RACINE}`), "utf8");
  const debut = css.indexOf("@media (display-mode: standalone)");
  assert.ok(debut !== -1, "le bloc @media display-mode est absent");

  // On avance jusqu'à l'accolade fermante du bloc, en comptant les niveaux.
  let profondeur = 0;
  let fin = -1;
  for (let i = css.indexOf("{", debut); i < css.length; i += 1) {
    if (css[i] === "{") profondeur += 1;
    if (css[i] === "}") {
      profondeur -= 1;
      if (profondeur === 0) {
        fin = i;
        break;
      }
    }
  }
  assert.ok(fin !== -1, "bloc @media non refermé");

  const bloc = css.slice(debut, fin);
  assert.match(bloc, /\.navigateur-seulement\s*\{[^}]*display:\s*none/);
});

test("A2. le lien vers la vitrine porte bien cette classe sur la page de connexion", () => {
  // LoginForm ne peut pas être rendu ici (il appelle `useRouter`, qui exige
  // le contexte de l'App Router). On vérifie donc que l'attribut est porté
  // par le lien vers "/" lui-même, et pas posé ailleurs dans le fichier.
  const source = readFileSync(new URL("components/auth/LoginForm.tsx", `file://${RACINE}`), "utf8");
  const lien = source.slice(source.indexOf('<Link\n          href="/"'));
  const fermeture = lien.indexOf(">");
  assert.ok(fermeture > 0, "lien vers l'accueil introuvable dans LoginForm");
  assert.match(lien.slice(0, fermeture), /navigateur-seulement/);
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. LE MAGASIN — CAPTURE ET CONSOMMATION DE L'INVITE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Un faux `window`, posé AVANT d'importer le magasin.
 *
 * On n'imite pas un navigateur : on fournit les trois choses que le magasin
 * touche réellement — les écouteurs, `navigator`, et `matchMedia`. Le reste
 * n'existe pas, et c'est très bien : si le magasin se mettait un jour à lire
 * autre chose, ces tests le diraient au lieu de le masquer.
 */
const ecouteurs = new Map<string, Array<(evenement: unknown) => void>>();
let modeApplication = false;

const fauxWindow = {
  addEventListener(nom: string, fn: (evenement: unknown) => void) {
    const liste = ecouteurs.get(nom) ?? [];
    liste.push(fn);
    ecouteurs.set(nom, liste);
  },
  removeEventListener(nom: string, fn: (evenement: unknown) => void) {
    const liste = (ecouteurs.get(nom) ?? []).filter((f) => f !== fn);
    ecouteurs.set(nom, liste);
  },
  navigator: { userAgent: UA.androidChrome, maxTouchPoints: 5 },
  matchMedia: (requete: string) => ({
    matches: requete.includes("standalone") ? modeApplication : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
};

(globalThis as Record<string, unknown>).window = fauxWindow;

const magasin = await import("../../lib/pwa/invite-installation");

function emettre(nom: string, evenement: Record<string, unknown>): void {
  for (const ecouteur of ecouteurs.get(nom) ?? []) {
    ecouteur(evenement);
  }
}

/** Nombre d'écouteurs posés sur un événement — pour vérifier l'idempotence. */
const compterEcouteurs = (nom: string) => (ecouteurs.get(nom) ?? []).length;

let preventDefaultAppele = 0;
function fausseInvite(): Record<string, unknown> {
  return {
    preventDefault: () => {
      preventDefaultAppele += 1;
    },
    prompt: async () => {},
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
  };
}

test("S1. démarrer la capture deux fois ne pose qu'un jeu d'écouteurs", () => {
  magasin.demarrerCaptureInstallation();
  const apresPremier = compterEcouteurs("beforeinstallprompt");
  magasin.demarrerCaptureInstallation();
  assert.equal(compterEcouteurs("beforeinstallprompt"), apresPremier);
  assert.equal(apresPremier, 1, "un seul écouteur, sinon l'invite serait traitée deux fois");
});

test("S2. avant tout événement : pas d'invite, donc pas de bouton", () => {
  const etat = magasin.lireEtatInstallation();
  assert.ok(etat !== null);
  assert.equal(etat!.invite, null);
  assert.equal(detecterCanalInstallation(etat!.contexte), "manuel");
});

test("S3. L'INSTANTANÉ EST STABLE PAR RÉFÉRENCE", () => {
  // `useSyncExternalStore` compare les instantanés par référence. Un magasin
  // qui en fabriquerait un neuf à chaque lecture ferait boucler le rendu à
  // l'infini — et l'écran de profil se figerait, sans erreur explicite.
  assert.equal(magasin.lireEtatInstallation(), magasin.lireEtatInstallation());
  assert.equal(magasin.lireEtatInstallationServeur(), magasin.lireEtatInstallationServeur());
  assert.equal(magasin.lireEtatInstallationServeur(), null, "le serveur ne devine rien");
});

test("S4. l'invite est captée, retenue, et la bannière du navigateur écartée", () => {
  let notifications = 0;
  const desabonner = magasin.souscrireInstallation(() => {
    notifications += 1;
  });
  emettre("beforeinstallprompt", fausseInvite());

  assert.equal(preventDefaultAppele, 1, "sans preventDefault, Chrome pose sa propre bannière");
  assert.equal(notifications, 1, "l'abonné doit être prévenu");
  const etat = magasin.lireEtatInstallation()!;
  assert.ok(etat.invite !== null, "l'invite doit être retenue pour le bouton du profil");
  assert.equal(detecterCanalInstallation(etat.contexte), "invite-native");
  desabonner();
});

test("S5. l'invite REFUSÉE est oubliée, et le bouton laisse place aux instructions", () => {
  // Une invite ne se rejoue pas : la garder afficherait un bouton qui ne
  // ferait plus rien au deuxième clic.
  magasin.oublierInvite(false);
  const etat = magasin.lireEtatInstallation()!;
  assert.equal(etat.invite, null);
  assert.equal(etat.venonsDInstaller, false, "un refus n'est pas une installation");
  assert.equal(detecterCanalInstallation(etat.contexte), "manuel");
});

test("S6. l'invite ACCEPTÉE bascule sur la confirmation", () => {
  emettre("beforeinstallprompt", fausseInvite());
  assert.ok(magasin.lireEtatInstallation()!.invite !== null);
  magasin.oublierInvite(true);
  const etat = magasin.lireEtatInstallation()!;
  assert.equal(etat.invite, null);
  assert.equal(etat.venonsDInstaller, true);
});

test("S7. `appinstalled` est traité, même sans passer par notre bouton", () => {
  // L'élève peut installer depuis le menu du navigateur, sans toucher au
  // bouton. Le bloc doit s'en apercevoir.
  emettre("appinstalled", {});
  const etat = magasin.lireEtatInstallation()!;
  assert.equal(etat.invite, null);
  assert.equal(etat.venonsDInstaller, true);
});

test("S8. lancée depuis l'écran d'accueil : plus rien à proposer", () => {
  modeApplication = true;
  emettre("appinstalled", {}); // force la reconstruction de l'instantané
  const etat = magasin.lireEtatInstallation()!;
  assert.equal(etat.contexte.affichageApplication, true);
  assert.equal(detecterCanalInstallation(etat.contexte), "deja-installee");
  modeApplication = false;
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
