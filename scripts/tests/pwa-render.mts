import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import * as moduleHorsLigne from "../../app/hors-ligne/page";
import { ContenuInstallation, InstallAppSection } from "../../components/student/InstallAppSection";
import type { CanalInstallation } from "../../lib/pwa/install";
import { exportDefaut } from "./helpers/export-defaut";

const HorsLignePage = exportDefaut<() => React.ReactElement>(
  moduleHorsLigne,
  "app/hors-ligne/page.tsx",
);

/**
 * PWA — CE QUI SORT VRAIMENT DU RENDU.
 *
 * SUITE SÉPARÉE, pour la même raison que `coach-reply-video-render.mts` :
 * `react-dom/server` n'expose pas `renderToString` sous la condition
 * d'export `react-server`. Elle est donc lancée SANS cette condition.
 *
 * Deux choses ne se vérifient pas autrement qu'en montant les composants :
 *
 *   • la page hors ligne doit fonctionner SANS JavaScript. Elle sera servie
 *     à un téléphone sans réseau, dont rien ne garantit que les fichiers JS
 *     soient en cache. Un bouton `onClick` y serait inerte ;
 *
 *   • le bloc d'installation ne doit produire AUCUN bouton sur iPhone.
 *     C'est la seule erreur de ce chantier qui serait invisible en revue et
 *     évidente pour l'élève : il cliquerait, rien ne se passerait.
 */

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

/* ════════════════════════════════════════════════════════════════════════
 * I. LA PAGE HORS LIGNE
 * ════════════════════════════════════════════════════════════════════════ */

const HORS_LIGNE = renderToString(createElement(HorsLignePage));

test("H1. la page hors ligne ne dépend d'aucun JavaScript", () => {
  // « Réessayer » est un LIEN. Un bouton exigerait que l'hydratation React
  // ait réussi — donc que les fichiers JS soient en cache, ce qui n'est
  // justement pas garanti au moment où cette page sert.
  assert.match(HORS_LIGNE, /<a[^>]+href="\/connexion"/);
  assert.ok(!/<button/.test(HORS_LIGNE), "aucun bouton : il serait mort sans JS");
  assert.ok(!/onclick/i.test(HORS_LIGNE));
});

test("H2. elle n'appelle aucun fichier distant", () => {
  // Hors ligne, une <img> pointerait sur un fichier absent : l'emblème doit
  // être dans le HTML lui-même.
  assert.ok(!/<img/.test(HORS_LIGNE), "aucune image externe");
  assert.match(HORS_LIGNE, /<svg/, "l'emblème est du SVG inline");
  assert.match(HORS_LIGNE, /aria-label="Emblème SETH"/);
});

test("H3. elle ne peut RIEN afficher de personnel, par construction", () => {
  // Elle est rendue UNE fois, à l'installation du service worker, et peut
  // être affichée des semaines plus tard — éventuellement à quelqu'un
  // d'autre sur le même téléphone. Tout ce qu'elle personnaliserait serait
  // faux, pas seulement périmé.
  //
  // Chercher des mots interdits dans le rendu ne prouverait rien : il
  // suffirait d'en ajouter un nouveau. On vérifie donc les deux propriétés
  // qui rendent la fuite IMPOSSIBLE : la page n'accepte aucun paramètre
  // (ni `params`, ni `searchParams`, donc rien à personnaliser), et son
  // rendu est identique d'un appel à l'autre — elle ne lit aucune source
  // externe.
  assert.equal(HorsLignePage.length, 0, "la page ne doit accepter aucun paramètre");
  const secondRendu = renderToString(createElement(HorsLignePage));
  assert.equal(secondRendu, HORS_LIGNE, "le rendu doit être strictement déterministe");
  assert.match(HORS_LIGNE.replace(/<!-- -->/g, ""), /Pas de connexion/);
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LE BLOC D'INSTALLATION
 * ════════════════════════════════════════════════════════════════════════ */

function rendre(canal: CanalInstallation): string {
  return renderToString(createElement(ContenuInstallation, { canal }));
}

test("I1. SUR IPHONE, AUCUN BOUTON — seulement la marche à suivre", () => {
  const html = rendre("ios-safari");
  assert.ok(!/<button/.test(html), "un bouton y serait mort au clic : Safari n'expose rien");
  assert.match(html, /Sur l&#x27;écran d&#x27;accueil|Sur l'écran d'accueil/);
  assert.match(html, /Partager/);
  // Trois étapes, numérotées : c'est le chemin exact dans Safari.
  assert.equal((html.match(/<li/g) ?? []).length, 3);
});

test("I2. sur un navigateur qui sait installer, un bouton et un seul", () => {
  const html = rendre("invite-native");
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /Installer l&#x27;application|Installer l'application/);
  // Et surtout pas les instructions Safari en plus : l'élève ne doit pas
  // avoir à choisir entre deux méthodes.
  assert.ok(!/Partager/.test(html));
});

test("I3. sur un navigateur iOS tiers, on renvoie vers Safari sans bouton", () => {
  const html = rendre("ios-autre-navigateur");
  assert.ok(!/<button/.test(html));
  assert.match(html, /Safari/);
});

test("I4. cas générique : ni bouton, ni instructions Safari inventées", () => {
  const html = rendre("manuel");
  assert.ok(!/<button/.test(html));
  assert.match(html, /Installer/);
  // Formulation conditionnelle : ce cas couvre aussi une application DÉJÀ
  // installée mais consultée depuis un onglet, où Chrome n'émet plus rien.
  assert.match(html, /Si l&#x27;application n&#x27;est pas déjà|Si l'application n'est pas déjà/);
});

test("I5. déjà installée : la section ne rend rien du tout", () => {
  assert.equal(rendre("deja-installee"), "");
});

test("I6. côté serveur, le bloc complet ne rend rien", () => {
  // Le serveur ignore sur quoi lit l'élève. Rendre quoi que ce soit ici
  // produirait soit une divergence d'hydratation, soit un clignotement —
  // la section apparaîtrait puis changerait de contenu.
  assert.equal(renderToString(createElement(InstallAppSection)), "");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
