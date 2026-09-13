/**
 * LE CHRONOMÈTRE DE SÉANCE — machine à états, rendu, et périmètre.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS CHOSES DISTINCTES SONT VÉRIFIÉES ICI
 * ════════════════════════════════════════════════════════════════════════
 *   C. la MACHINE À ÉTATS (lib/chronometre.ts), avec une horloge fournie à
 *      la milliseconde — c'est là que vivent « la pause continue de
 *      décrémenter » et « le compte ne s'arrête pas à 00:00 » ;
 *   D. le RENDU réel du composant (renderToString), pour les commandes, les
 *      libellés accessibles et l'absence de couleur de surface en dur ;
 *   E. le PÉRIMÈTRE : rendu dans la séance, ABSENT du Builder et du reste.
 *
 * Les sabotages rejouent chaque batterie contre une version fausse. Un
 * contrôle qui ne détecte pas la régression qu'on lui présente ne protège
 * de rien, et c'est vrai des trois.
 *
 * Lancement : npx tsx scripts/tests/chronometre-seance.mts
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { ChronometreSeance } from "../../components/student/ChronometreSeance";
import * as moduleLayoutSeance from "../../app/(student)/entrainement/seance/[sessionId]/layout";
import {
  ajuster,
  cadran,
  creerChronometre,
  demarrer,
  DUREE_MAX_MS,
  DUREE_PAR_DEFAUT_MS,
  PAS_AJUSTEMENT_MS,
  pauser,
  reglerDuree,
  reinitialiser,
  reprendre,
  restantMs,
  restantSecondes,
  tic,
  type Chronometre,
} from "../../lib/chronometre";

/**
 * `tsx` charge le .tsx en CommonJS et le .mts en ESM : le `default` arrive
 * parfois enveloppé une fois de plus. On déballe, plutôt que de renoncer à
 * monter le vrai layout — c'est justement ce montage qui distingue un import
 * mort d'un composant réellement rendu.
 */
type ComposantLayout = (props: { children?: ReactNode }) => ReactElement;
const brutLayout = moduleLayoutSeance.default as unknown;
const SeanceLayout = (typeof brutLayout === "function"
  ? brutLayout
  : (brutLayout as { default: ComposantLayout }).default) as ComposantLayout;

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * ⚠️ LES COMMENTAIRES SONT RETIRÉS AVANT TOUTE ANALYSE DE SOURCE.
 *
 * Sans cela, ce harnais se mordait lui-même : le commentaire d'en-tête du
 * composant explique pourquoi le compte à rebours ne porte PAS d'`aria-live`,
 * pourquoi le tic n'est pas un décompte, et qu'il ne parle pas à Supabase.
 * Les trois contrôles correspondants trouvaient ces mots-là — dans
 * l'explication, pas dans le code — et échouaient. Un contrôle qui interdit
 * d'EXPLIQUER le piège force à effacer la mémoire du piège.
 */
function codeSeul(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${name}`);
    console.error(error);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * C. LA MACHINE À ÉTATS
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * L'interface exacte dont la batterie a besoin. La déclarer permet de lui
 * passer une implémentation SABOTÉE et de vérifier qu'elle mord.
 */
interface Moteur {
  demarrer: (c: Chronometre, t: number) => Chronometre;
  pauser: (c: Chronometre, t: number) => Chronometre;
  reprendre: (c: Chronometre, t: number) => Chronometre;
  reinitialiser: (c: Chronometre) => Chronometre;
  tic: (c: Chronometre, t: number) => Chronometre;
  restantMs: (c: Chronometre, t: number) => number;
}

const MOTEUR_REEL: Moteur = { demarrer, pauser, reprendre, reinitialiser, tic, restantMs };

const T0 = 1_700_000_000_000; // instant arbitraire, fixe : aucun test ne lit l'horloge réelle

/**
 * Les cinq propriétés que le compte à rebours doit tenir. Retourne les
 * violations plutôt que de jeter, pour qu'un saboteur puisse en produire
 * plusieurs.
 */
function batterieMoteur(m: Moteur): string[] {
  const v: string[] = [];
  const ko = (message: string) => v.push(message);

  /* 1. DÉMARRAGE — le temps s'écoule vraiment. */
  {
    let c = creerChronometre(60_000);
    c = m.demarrer(c, T0);
    if (c.etat !== "encours") ko("démarrer ne met pas en marche");
    if (m.restantMs(c, T0) !== 60_000) ko("restant faux juste après le démarrage");
    if (m.restantMs(c, T0 + 10_000) !== 50_000) ko("le temps ne s'écoule pas");
  }

  /* 2. PAUSE — le temps NE s'écoule PLUS. C'est la faute la plus commune :
   *    l'état passe à « pause » mais le restant continue d'être calculé
   *    depuis une échéance qu'on a oublié d'effacer. */
  {
    let c = m.demarrer(creerChronometre(60_000), T0);
    c = m.pauser(c, T0 + 20_000);
    if (c.etat !== "pause") ko("pauser ne met pas en pause");
    if (m.restantMs(c, T0 + 20_000) !== 40_000) ko("pause : restant faux à l'instant de la pause");
    if (m.restantMs(c, T0 + 120_000) !== 40_000) ko("PAUSE QUI CONTINUE DE DÉCRÉMENTER");
    if (m.tic(c, T0 + 3_600_000).etat !== "pause") ko("un tic fait sortir de la pause");
  }

  /* 3. REPRISE — repart du restant figé, pas de l'échéance d'origine. */
  {
    let c = m.demarrer(creerChronometre(60_000), T0);
    c = m.pauser(c, T0 + 20_000);
    c = m.reprendre(c, T0 + 500_000); // huit minutes de pause
    if (c.etat !== "encours") ko("reprendre ne repart pas");
    if (m.restantMs(c, T0 + 500_000) !== 40_000) ko("reprise : le temps de pause a été décompté");
    if (m.restantMs(c, T0 + 510_000) !== 30_000) ko("reprise : le temps ne s'écoule plus après reprise");
  }

  /* 4. FIN — arrêt NET à 00:00, jamais en dessous. */
  {
    const c = m.demarrer(creerChronometre(60_000), T0);
    if (m.restantMs(c, T0 + 59_999) !== 1) ko("dernière milliseconde perdue");
    if (m.restantMs(c, T0 + 60_000) !== 0) ko("restant non nul à l'échéance");
    if (m.restantMs(c, T0 + 90_000) !== 0) ko("COMPTE À REBOURS PASSÉ SOUS ZÉRO");
    const avant = m.tic(c, T0 + 59_999);
    if (avant.etat !== "encours") ko("terminé une milliseconde trop tôt");
    const apres = m.tic(c, T0 + 60_000);
    if (apres.etat !== "termine") ko("NE S'ARRÊTE PAS À 00:00");
    if (m.restantMs(apres, T0 + 300_000) !== 0) ko("continue de courir après la fin");
    if (m.tic(apres, T0 + 300_000).etat !== "termine") ko("sort de l'état terminé tout seul");
  }

  /* 5. RÉINITIALISATION — depuis N'IMPORTE QUEL état. */
  {
    const depuis: Chronometre[] = [
      creerChronometre(90_000),
      m.demarrer(creerChronometre(90_000), T0),
      m.pauser(m.demarrer(creerChronometre(90_000), T0), T0 + 30_000),
      m.tic(m.demarrer(creerChronometre(90_000), T0), T0 + 200_000),
    ];
    for (const [i, c] of depuis.entries()) {
      const remis = m.reinitialiser(c);
      if (remis.etat !== "arrete") ko(`reset #${i} : état ${remis.etat} au lieu de « arrete »`);
      if (remis.restantMs !== 90_000) ko(`reset #${i} : restant ${remis.restantMs} au lieu de 90000`);
      if (remis.echeanceMs !== null) ko(`reset #${i} : échéance non effacée`);
      if (m.restantMs(remis, T0 + 10_000_000) !== 90_000) ko(`reset #${i} : REPART TOUT SEUL`);
    }
  }

  return v;
}

await test("C1 — les cinq propriétés du compte à rebours", () => {
  assert.deepEqual(batterieMoteur(MOTEUR_REEL), []);
});

await test("C2 — aucune dérive : un battement en retard ne change rien", () => {
  const c = demarrer(creerChronometre(300_000), T0);
  // Un `setInterval(…, 250)` qui tire à 240, 260, 1 100 ms… et un onglet
  // endormi trois minutes. Le restant ne dépend que de l'horloge.
  let horloge = T0;
  for (const pas of [240, 260, 1_100, 180_000, 3, 60_000]) {
    horloge += pas;
    tic(c, horloge); // ← volontairement ignoré : le tic ne COMPTE pas
  }
  assert.equal(restantMs(c, horloge), 300_000 - (horloge - T0));
  assert.equal(restantMs(c, T0 + 241_360), 58_640, "valeur exacte, sans accumulation d'erreur");
});

await test("C3 — restantSecondes arrondit vers le haut : « 00:00 » ne ment pas", () => {
  const c = demarrer(creerChronometre(60_000), T0);
  assert.equal(restantSecondes(c, T0), 60);
  assert.equal(restantSecondes(c, T0 + 1), 60, "il reste 59,999 s → on affiche encore 60");
  assert.equal(restantSecondes(c, T0 + 1_000), 59);
  assert.equal(restantSecondes(c, T0 + 59_001), 1, "la dernière seconde reste visible");
  assert.equal(restantSecondes(c, T0 + 59_999), 1);
  assert.equal(restantSecondes(c, T0 + 60_000), 0, "00:00 exactement à l'échéance");
  assert.equal(restantSecondes(c, T0 + 999_999), 0);
});

await test("C4 — ajustements −30 s / +30 s, en marche comme à l'arrêt", () => {
  // À l'arrêt : la durée de RÉFÉRENCE suit, pour que le reset retombe dessus.
  let c = creerChronometre(60_000);
  c = ajuster(c, PAS_AJUSTEMENT_MS, T0);
  assert.equal(c.restantMs, 90_000);
  assert.equal(c.dureeInitialeMs, 90_000, "le reset doit retomber sur la valeur réglée");
  assert.equal(c.etat, "arrete", "ajuster à l'arrêt ne démarre pas");

  // En marche : l'échéance est déplacée, sans redémarrage.
  c = demarrer(creerChronometre(60_000), T0);
  c = ajuster(c, PAS_AJUSTEMENT_MS, T0 + 10_000);
  assert.equal(c.etat, "encours");
  assert.equal(restantMs(c, T0 + 10_000), 80_000);
  c = ajuster(c, -PAS_AJUSTEMENT_MS, T0 + 10_000);
  assert.equal(restantMs(c, T0 + 10_000), 50_000);

  // Retirer plus qu'il n'en reste termine, sans jamais passer sous zéro.
  const fini = ajuster(demarrer(creerChronometre(10_000), T0), -PAS_AJUSTEMENT_MS, T0);
  assert.equal(fini.etat, "termine");
  assert.equal(restantMs(fini, T0 + 100_000), 0);

  // Le plafond tient.
  const plafonne = ajuster(creerChronometre(DUREE_MAX_MS), PAS_AJUSTEMENT_MS, T0);
  assert.equal(plafonne.restantMs, DUREE_MAX_MS);
});

await test("C5 — réglage minutes + secondes", () => {
  const c = reglerDuree(creerChronometre(), 5 * 60_000 + 30_000);
  assert.equal(c.etat, "arrete");
  assert.equal(c.dureeInitialeMs, 330_000);
  assert.equal(c.restantMs, 330_000);
  assert.equal(c.echeanceMs, null);
  assert.equal(cadran(restantSecondes(c, T0)), "05:30");

  // Régler pendant une marche ARRÊTE : le chiffre lu et le chiffre réglé ne
  // doivent jamais diverger.
  const enMarche = demarrer(creerChronometre(60_000), T0);
  const regle = reglerDuree(enMarche, 120_000);
  assert.equal(regle.etat, "arrete");
  assert.equal(restantMs(regle, T0 + 10_000_000), 120_000);

  // Bornes.
  assert.equal(reglerDuree(creerChronometre(), -1).restantMs, 0);
  assert.equal(reglerDuree(creerChronometre(), DUREE_MAX_MS * 3).restantMs, DUREE_MAX_MS);
  assert.equal(reglerDuree(creerChronometre(), Number.NaN).restantMs, 0);
});

await test("C6 — une durée nulle ne démarre pas", () => {
  const c = reglerDuree(creerChronometre(), 0);
  assert.equal(demarrer(c, T0).etat, "arrete", "un compte à rebours de 0 s n'a rien à décompter");
});

await test("C7 — le cadran garde une largeur stable", () => {
  assert.equal(cadran(0), "00:00");
  assert.equal(cadran(9), "00:09");
  assert.equal(cadran(59), "00:59");
  assert.equal(cadran(60), "01:00");
  assert.equal(cadran(90), "01:30");
  assert.equal(cadran(600), "10:00");
  assert.equal(cadran(3599), "59:59");
  assert.equal(cadran(3600), "1:00:00");
  assert.equal(cadran(3661), "1:01:01");
  assert.equal(cadran(-5), "00:00", "jamais de signe au cadran");
  for (let s = 0; s < 3600; s += 7) {
    assert.equal(cadran(s).length, 5, `largeur stable à ${s} s`);
  }
});

await test("C8 — la durée par défaut est une minute", () => {
  assert.equal(DUREE_PAR_DEFAUT_MS, 60_000);
  assert.equal(creerChronometre().restantMs, 60_000);
});

/* ════════════════════════════════════════════════════════════════════════
 * D. LE RENDU
 * ════════════════════════════════════════════════════════════════════════ */

const html = renderToString(createElement(ChronometreSeance));

await test("D1 — le bouton flottant est rendu, fermé, et annoncé", () => {
  assert.ok(html.includes('aria-expanded="false"'), "le panneau est fermé au premier rendu");
  assert.ok(html.includes('aria-label="Ouvrir le chronomètre"'), "le déclencheur est nommé");
  assert.ok(html.includes("rounded-full"), "bouton circulaire");
  assert.ok(html.includes("fixed"), "flottant, donc insensible au défilement");
});

await test("D2 — il ne masque jamais une modale", () => {
  assert.ok(html.includes("z-30"), "posé sous les modales (z-50) et MediaModal (z-[100])");
  assert.ok(!html.includes("z-50") && !html.includes("z-[100]"), "aucun niveau de modale emprunté");
});

await test("D3 — safe-area respectée (le bouton ne passe pas sous la barre système iOS)", () => {
  assert.ok(/env\(safe-area-inset-bottom\)/.test(html));
});

await test("D4 — aucune couleur de surface en dur", async () => {
  const source = await readFile(join(RACINE, "components", "student", "ChronometreSeance.tsx"), "utf8");
  for (const interdit of ["bg-black", "bg-white", "bg-zinc-", "bg-neutral-", "bg-gray-", "text-black", "text-white"]) {
    assert.ok(
      !source.includes(interdit),
      `${interdit} : globals.css impose les jetons sémantiques (bg-card, text-foreground…)`,
    );
  }
  assert.ok(source.includes("bg-card"), "le panneau s'appuie sur un jeton de surface");
});

await test("D5 — le panneau ouvert expose les six commandes", async () => {
  const source = await readFile(join(RACINE, "components", "student", "ChronometreSeance.tsx"), "utf8");
  const commandes: readonly (readonly [string, RegExp])[] = [
    ["démarrer", /demarrer\b/],
    ["pause", /agir\(pauser\)/],
    ["reprendre", /reprendre\s*:\s*demarrer|reprendre : demarrer/],
    ["réinitialiser", /setChrono\(reinitialiser\)/],
    ["−30 s", /ajuster\(c,\s*-PAS_AJUSTEMENT_MS/],
    ["+30 s", /ajuster\(c,\s*PAS_AJUSTEMENT_MS/],
  ];
  for (const [nom, motif] of commandes) {
    assert.ok(motif.test(source), `commande « ${nom} » absente du composant`);
  }
  assert.ok(/reglerDuree\(/.test(source), "réglage de la durée initiale absent");
  assert.ok(/type="number"[\s\S]{0,400}Secondes|Secondes[\s\S]{0,400}type="number"/.test(source), "réglage des secondes absent");
});

await test("D6 — accessibilité : rôles, focus et annonces mesurées", async () => {
  const source = codeSeul(await readFile(join(RACINE, "components", "student", "ChronometreSeance.tsx"), "utf8"));
  assert.ok(/role="dialog"/.test(source), "le panneau est un dialogue nommé");
  assert.ok(/aria-controls=/.test(source), "le déclencheur pointe vers le panneau");
  assert.ok(/role="timer"/.test(source), "le compte à rebours porte le rôle timer");
  assert.ok(/role="status"/.test(source) && /aria-live="polite"/.test(source), "région d'annonce des transitions");
  assert.ok(
    !/role="timer"[\s\S]{0,200}aria-live/.test(source),
    "un compte à rebours annoncé à chaque seconde rend un lecteur d'écran inutilisable",
  );
  assert.ok(/declencheur\.current\?\.focus\(\)/.test(source), "le focus revient au déclencheur à la fermeture");
  assert.ok(/premierControle\.current\?\.focus\(\)/.test(source), "le focus entre dans le panneau à l'ouverture");
  assert.ok(/=== "Escape"/.test(source), "Échap ferme le panneau");
  assert.ok(/min-h-11|min-h-14|min-h-9/.test(source), "zones tactiles dimensionnées");
});

await test("D7 — prefers-reduced-motion est respecté", async () => {
  const source = await readFile(join(RACINE, "components", "student", "ChronometreSeance.tsx"), "utf8");
  assert.ok(/usePrefersReducedMotion/.test(source), "le réglage système est lu");
  const animations = source.match(/animate-[a-z]+/g) ?? [];
  assert.ok(animations.length > 0, "il y a bien une animation à désactiver");
  for (const ligne of source.split("\n")) {
    if (!/animate-/.test(ligne)) continue;
    assert.ok(
      /!mouvementReduit/.test(ligne),
      `animation non conditionnée au mouvement réduit :\n  ${ligne.trim()}`,
    );
  }
});

await test("D8 — les intervalles sont nettoyés et n'existent qu'en marche", async () => {
  const source = codeSeul(await readFile(join(RACINE, "components", "student", "ChronometreSeance.tsx"), "utf8"));
  const effets = source.split("useEffect(");
  const effetBattement = effets.find((bloc) => bloc.includes("setInterval"));
  assert.ok(effetBattement, "aucun battement trouvé");
  assert.ok(
    /clearInterval/.test(effetBattement!),
    "un setInterval sans clearInterval survit à la sortie de la page",
  );
  assert.ok(
    /chrono\.etat !== "encours"\) return/.test(effetBattement!),
    "le battement doit être armé uniquement pendant la marche",
  );
  assert.equal(
    (source.match(/setInterval/g) ?? []).length,
    (source.match(/clearInterval/g) ?? []).length,
    "autant de nettoyages que d'armements",
  );
});

await test("D9 — aucune persistance, aucune écriture de données de séance", async () => {
  const source = codeSeul(await readFile(join(RACINE, "components", "student", "ChronometreSeance.tsx"), "utf8"));
  for (const interdit of ["localStorage", "sessionStorage", "indexedDB", "supabase", "Supabase", "fetch(", "navigator.storage"]) {
    assert.ok(!source.includes(interdit), `${interdit} : le chronomètre ne persiste rien`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * E. LE PÉRIMÈTRE
 * ════════════════════════════════════════════════════════════════════════ */

/** Tous les fichiers de source de l'application (hors tests et dépendances). */
async function fichiersSource(): Promise<{ chemin: string; contenu: string }[]> {
  const resultats: { chemin: string; contenu: string }[] = [];
  async function parcourir(dossier: string) {
    for (const entree of await readdir(dossier, { withFileTypes: true })) {
      if (entree.name === "node_modules" || entree.name.startsWith(".")) continue;
      const complet = join(dossier, entree.name);
      if (entree.isDirectory()) {
        await parcourir(complet);
      } else if (/\.(ts|tsx)$/.test(entree.name)) {
        resultats.push({ chemin: relative(RACINE, complet), contenu: await readFile(complet, "utf8") });
      }
    }
  }
  for (const racine of ["app", "components", "lib", "hooks"]) await parcourir(join(RACINE, racine));
  return resultats;
}

const LAYOUT_SEANCE = join("app", "(student)", "entrainement", "seance", "[sessionId]", "layout.tsx");

/**
 * Le seul fichier autorisé à rendre le chronomètre est le layout de la route
 * de séance. Retourne les violations.
 */
function porteesInterdites(fichiers: { chemin: string; contenu: string }[]): string[] {
  const violations: string[] = [];
  let monte = false;
  for (const { chemin, contenu } of fichiers) {
    if (chemin.endsWith("ChronometreSeance.tsx")) continue;
    // Un IMPORT ou un RENDU, pas une mention : lib/chronometre.ts et
    // lib/duree.ts nomment le composant dans leur documentation pour dire où
    // vit son seul point de montage, et ce n'est pas une infraction.
    const code = codeSeul(contenu);
    if (!/<ChronometreSeance[\s/>]|ChronometreSeance\s*\}?\s*from|import\s+ChronometreSeance/.test(code)) continue;
    if (chemin === LAYOUT_SEANCE) {
      monte = true;
      continue;
    }
    violations.push(`${chemin} : rend ou importe le chronomètre hors de la route de séance`);
  }
  if (!monte) violations.push("aucun fichier ne monte le chronomètre dans la route de séance");
  return violations;
}

await test("E1 — monté par le layout de séance, et par lui seul", async () => {
  assert.deepEqual(porteesInterdites(await fichiersSource()), []);
});

await test("E2 — le layout de séance le rend RÉELLEMENT (rendu, pas import mort)", () => {
  const rendu = renderToString(
    createElement(SeanceLayout, null, createElement("p", null, "contenu de séance")),
  );
  assert.ok(rendu.includes("contenu de séance"), "le layout doit laisser passer la page");
  assert.ok(rendu.includes('aria-label="Ouvrir le chronomètre"'), "le chronomètre n'est pas rendu");
});

await test("E3 — ABSENT du Builder et de tout app/admin", async () => {
  for (const { chemin, contenu } of await fichiersSource()) {
    if (!chemin.startsWith(join("app", "admin")) && !chemin.startsWith(join("components", "admin"))) continue;
    assert.ok(
      !/ChronometreSeance|lib\/chronometre|@\/lib\/chronometre/.test(codeSeul(contenu)),
      `${chemin} : le chronomètre ne doit exister nulle part côté admin`,
    );
  }
});

await test("E4 — exactement UN layout monte le chronomètre, et c'est celui de la séance", async () => {
  const fichiers = await fichiersSource();
  const porteurs = fichiers.filter(
    ({ chemin, contenu }) =>
      chemin.endsWith("layout.tsx") && /<ChronometreSeance[\s/>]/.test(codeSeul(contenu)),
  );
  assert.equal(porteurs.length, 1, `layouts porteurs : ${porteurs.map((f) => f.chemin).join(", ") || "aucun"}`);
  assert.equal(porteurs[0].chemin, LAYOUT_SEANCE, "le point de montage a changé de route");
});

/* ════════════════════════════════════════════════════════════════════════
 * SABOTAGES
 * ════════════════════════════════════════════════════════════════════════ */

const MOTEURS_SABOTES: readonly (readonly [string, Moteur])[] = [
  [
    "S1 — la PAUSE continue de décrémenter (échéance non effacée)",
    {
      ...MOTEUR_REEL,
      pauser: (c, t) => (c.etat === "encours" ? { ...c, etat: "pause", restantMs: restantMs(c, t) } : c),
      restantMs: (c, t) => (c.echeanceMs !== null ? Math.max(0, c.echeanceMs - t) : c.restantMs),
    },
  ],
  [
    "S2 — le compte à rebours NE S'ARRÊTE PAS à 00:00",
    { ...MOTEUR_REEL, tic: (c) => c },
  ],
  [
    "S3 — le compte à rebours passe SOUS zéro",
    {
      ...MOTEUR_REEL,
      restantMs: (c, t) => (c.etat === "encours" && c.echeanceMs !== null ? c.echeanceMs - t : c.restantMs),
    },
  ],
  [
    "S4 — le RESET est supprimé (rend l'état inchangé)",
    { ...MOTEUR_REEL, reinitialiser: (c) => c },
  ],
  [
    "S5 — le RESET oublie d'effacer l'échéance : le chrono repart tout seul",
    {
      ...MOTEUR_REEL,
      reinitialiser: (c) => ({ ...c, etat: "arrete", restantMs: c.dureeInitialeMs }),
      restantMs: (c, t) => (c.echeanceMs !== null ? Math.max(0, c.echeanceMs - t) : c.restantMs),
    },
  ],
  [
    "S6 — la REPRISE décompte le temps passé en pause",
    {
      ...MOTEUR_REEL,
      reprendre: (c, t) => (c.etat === "pause" ? { ...c, etat: "encours", echeanceMs: t + c.restantMs - 60_000 } : c),
    },
  ],
  [
    "S7 — le tic DÉCRÉMENTE au lieu de constater (source de dérive)",
    {
      ...MOTEUR_REEL,
      tic: (c) => (c.etat === "encours" ? { ...c, restantMs: c.restantMs - 1000, echeanceMs: null } : c),
      restantMs: (c) => Math.max(0, c.restantMs),
    },
  ],
];

for (const [nom, moteur] of MOTEURS_SABOTES) {
  await test(`SAB ${nom} — la batterie le détecte`, () => {
    assert.ok(
      batterieMoteur(moteur).length > 0,
      "le saboteur passe la batterie : elle ne protège de rien",
    );
  });
}

await test("SAB S8 — le chronomètre rendu dans le BUILDER est détecté", () => {
  const corpus = [
    { chemin: LAYOUT_SEANCE, contenu: "import { ChronometreSeance } from '@/components/student/ChronometreSeance';" },
    {
      chemin: join("app", "admin", "programmes", "[programId]", "builder", "page.tsx"),
      contenu: "import { ChronometreSeance } from '@/components/student/ChronometreSeance';\n<ChronometreSeance />",
    },
  ];
  const violations = porteesInterdites(corpus);
  assert.equal(violations.length, 1, "le Builder doit être signalé");
  assert.ok(violations[0].includes("builder"), violations[0]);
});

await test("SAB S9 — le chronomètre rendu dans une AUTRE page élève est détecté", () => {
  const corpus = [
    { chemin: LAYOUT_SEANCE, contenu: "<ChronometreSeance />" },
    { chemin: join("app", "(student)", "nutrition", "page.tsx"), contenu: "<ChronometreSeance />" },
  ];
  assert.equal(porteesInterdites(corpus).length, 1);
});

await test("SAB S10 — le chronomètre RETIRÉ du layout de séance est détecté", () => {
  const corpus = [{ chemin: LAYOUT_SEANCE, contenu: "export default function L({ children }) { return children; }" }];
  const violations = porteesInterdites(corpus);
  assert.equal(violations.length, 1);
  assert.ok(violations[0].includes("aucun fichier ne monte"), violations[0]);
});

await test("SAB S11 — un layout qui IMPORTE sans rendre passe encore E1 mais échoue E2", () => {
  // E1 est un contrôle textuel : il ne peut pas distinguer un import mort.
  // C'est PRÉCISÉMENT pourquoi E2 monte le layout avec React et cherche le
  // bouton dans le HTML produit. Ce test documente la division du travail.
  const importMort = renderToString(
    createElement(
      ({ children }: { children: ReactNode }) => createElement("div", null, children),
      null,
      "contenu",
    ),
  );
  assert.ok(!importMort.includes('aria-label="Ouvrir le chronomètre"'));
});

console.log(`\n${passed} réussis, ${failed} échecs`);
if (failed > 0) process.exit(1);
