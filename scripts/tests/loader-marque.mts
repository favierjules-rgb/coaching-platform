process.env.TZ = "Europe/Paris";

/**
 * Harnais — LE LOADER À L'EMBLÈME.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE PROTÈGE
 * ════════════════════════════════════════════════════════════════════════
 *   • que le loader utilise l'emblème OFFICIEL et non un tracé recopié ;
 *   • qu'il s'annonce aux lecteurs d'écran — une attente silencieuse pour qui
 *     ne voit pas l'écran ressemble à une page cassée ;
 *   • que son battement se coupe sous `prefers-reduced-motion` SANS que
 *     l'emblème disparaisse ;
 *   • qu'il couvre réellement la navigation, via le `loading.tsx` racine ;
 *   • qu'il reste une boucle `linear` — une boucle qui accélère attire l'œil
 *     bien plus qu'un indicateur ne le doit.
 *
 * Lancement : npx tsx scripts/tests/loader-marque.mts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Loader } from "../../components/ui/Loader";

let réussis = 0;
let échecs = 0;

function test(nom: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      réussis += 1;
      console.log(`ok - ${nom}`);
    })
    .catch((erreur) => {
      échecs += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(erreur);
    });
}

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const LOADER = lire("../../components/ui/Loader.tsx");
const CHARGEMENT = lire("../../app/loading.tsx");
const CSS = lire("../../app/globals.css");
/*
 * ⚠️ LE BLOC EST BORNÉ DES DEUX CÔTÉS, ET CE N'EST PAS DE LA COQUETTERIE.
 *
 * Une première version découpait du repère jusqu'à la FIN du fichier : la
 * recherche « le loader ne disparaît jamais » tombait alors sur un
 * `display: none` appartenant à un tout autre bloc, et rougissait pour une
 * règle qui n'est pas la sienne. On mesure ce qu'on croit mesurer.
 */
const DEBUT_BLOC = CSS.lastIndexOf("/*", CSS.indexOf("LOADER — components/ui/Loader.tsx"));
const FIN_BLOC = CSS.indexOf("@keyframes double-star-allumage", DEBUT_BLOC);
if (DEBUT_BLOC < 0 || FIN_BLOC < 0) throw new Error("bloc CSS du loader introuvable");
const BLOC = CSS.slice(DEBUT_BLOC, CSS.lastIndexOf("/*", FIN_BLOC));
const REGLES = BLOC.replace(/\/\*[\s\S]*?\*\//g, "");

/* ═══════════════ 1-3. L'EMBLÈME ═══════════════ */

await test("1. le loader réutilise l'emblème officiel, il ne le redessine pas", () => {
  const code = sansCommentaires(LOADER);
  assert.ok(code.includes("DoubleStar"), "le loader monte le composant d'emblème");
  /*
   * ⚠️ AUCUN TRACÉ RECOPIÉ. Un `<path d="…">` écrit ici serait un second
   * exemplaire du logo, condamné à diverger de l'original le jour où celui-ci
   * bougera. L'emblème vit à UN seul endroit.
   */
  assert.ok(!/<path/.test(code), "aucun chemin SVG redessiné dans le loader");
  assert.ok(!/<svg/.test(code), "aucun SVG en dur non plus");
  // Ni image distante : le loader doit s'afficher avant tout réseau.
  assert.ok(!/<img|next\/image/.test(code), "aucune image à charger — un loader ne s'attend pas lui-même");
});

await test("2. il s'annonce aux lecteurs d'écran", () => {
  const html = renderToStaticMarkup(createElement(Loader, { libelle: "Chargement des essais…" }));
  assert.ok(/role="status"/.test(html), "le loader porte role=status");
  assert.ok(/aria-live="polite"/.test(html), "et une région vivante polie");
  assert.ok(html.includes("Chargement des essais…"), "le libellé est rendu");
  assert.ok(/sr-only/.test(html), "le libellé est réservé aux lecteurs d'écran");
  // ⚠️ L'EMBLÈME EST DÉCORATIF : c'est le libellé qui porte l'information.
  assert.ok(/aria-label="Emblème SETH"/.test(html) || /aria-hidden/.test(html), "l'emblème ne double pas le libellé");
});

await test("3. le libellé par défaut existe, et peut être précisé", () => {
  const parDefaut = renderToStaticMarkup(createElement(Loader, {}));
  assert.ok(/Chargement/.test(parDefaut), "un libellé par défaut est toujours rendu");
  const precis = renderToStaticMarkup(createElement(Loader, { libelle: "Chargement des programmes…" }));
  assert.ok(precis.includes("Chargement des programmes…"), "un libellé précis remplace le défaut");
});

/* ═══════════════ 4-6. L'ANIMATION ═══════════════ */

await test("4. le battement est une boucle LINÉAIRE", () => {
  /*
   * ⚠️ `linear`, ET C'EST UNE RÈGLE. Un mouvement perpétuel qui accélère et
   * ralentit attire l'œil bien plus qu'un indicateur ne le doit — voir
   * `.agents/skills/review-animations/STANDARDS.md`, « Constant motion ».
   */
  assert.ok(/@keyframes seth-loader-battement/.test(BLOC), "le battement est déclaré");
  const animation = /animation:\s*seth-loader-battement\s+(\d+)ms\s+(\w+)\s+infinite/.exec(REGLES);
  assert.ok(animation, "l'animation du tracé doit être lisible");
  assert.equal(animation[2], "linear", `une boucle ne doit pas accélérer — trouvé ${animation[2]}`);
  const duree = Number(animation[1]);
  assert.ok(
    duree >= 1000 && duree <= 2000,
    `le cycle doit rester entre 1 et 2 s — trouvé ${duree} ms`,
  );
});

await test("5. les deux étoiles alternent, elles ne clignotent pas ensemble", () => {
  // Sans décalage, les deux pointes s'allument et s'éteignent en même temps :
  // ce n'est plus un battement, c'est un clignotement.
  const decalage = /nth-of-type\(2\)\s*\{[^}]*animation-delay:\s*(\d+)ms/.exec(REGLES);
  assert.ok(decalage, "la seconde étoile doit porter un décalage");
  const animation = /animation:\s*seth-loader-battement\s+(\d+)ms/.exec(REGLES);
  assert.ok(animation, "la durée doit être lisible");
  assert.equal(
    Number(decalage[1]) * 2,
    Number(animation[1]),
    "le décalage doit valoir la MOITIÉ du cycle — c'est ce qui met les deux étoiles en opposition",
  );
});

await test("6. sous mouvement réduit, le battement part — PAS le signal", () => {
  const calme = BLOC.slice(BLOC.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(calme.length > 0, "le garde de mouvement réduit existe");
  assert.ok(/animation:\s*none/.test(calme), "le battement est coupé");
  /*
   * ⚠️ ET L'EMBLÈME RESTE VISIBLE. Le battement joue sur l'opacité : coupé
   * sans remettre `opacity: 1`, le tracé resterait figé à sa valeur initiale,
   * c'est-à-dire à peine visible. L'utilisateur ne saurait plus que quelque
   * chose charge.
   */
  assert.ok(/opacity:\s*1/.test(calme), "l'emblème reste pleinement visible");
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(calme), "le loader ne disparaît jamais");
});

/* ═══════════════ 7-9. LA COUVERTURE ═══════════════ */

await test("7. le loader racine couvre la navigation", () => {
  assert.ok(existsSync(new URL("../../app/loading.tsx", import.meta.url)), "app/loading.tsx existe");
  const code = sansCommentaires(CHARGEMENT);
  assert.ok(code.includes("Loader"), "il monte le loader partagé");
  assert.ok(/export default function/.test(code), "et suit la convention Next.js");
});

await test("8. les états de chargement existants portent le même emblème", () => {
  /*
   * ⚠️ UN SEUL SIGNAL SUR TOUT LE SITE. `/programmes` garde son squelette —
   * dessiner la forme du contenu attendu vaut mieux qu'un indicateur seul
   * quand on connaît cette forme — mais il doit montrer le MÊME emblème,
   * sinon l'attente ne se reconnaît pas d'une page à l'autre.
   */
  const programmes = lire("../../app/programmes/loading.tsx");
  assert.ok(programmes.includes("Loader"), "/programmes affiche l'emblème lui aussi");
  assert.ok(
    !/role="status"[\s\S]{0,200}sr-only/.test(sansCommentaires(programmes)),
    "et ne double pas l'annonce du loader avec la sienne",
  );
});

await test("9. le loader ne dépend d'aucun état ni d'aucun réseau", () => {
  const code = sansCommentaires(LOADER);
  /*
   * Un indicateur de chargement qui aurait besoin d'être hydraté, ou d'aller
   * chercher quoi que ce soit, arriverait après ce qu'il annonce.
   */
  assert.ok(!/useState|useEffect|fetch\(/.test(code), "aucun état, aucun appel réseau");
  assert.ok(!/"use client"/.test(code), "composant serveur : il est rendu dans le HTML initial");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
