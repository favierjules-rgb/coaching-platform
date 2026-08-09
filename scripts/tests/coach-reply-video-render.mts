import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { AnnotatedVideoPlayer } from "../../components/shared/AnnotatedVideoPlayer";
import { parseAnnotations } from "../../lib/video-annotations";

/**
 * F5 — RENDU RÉEL DU LECTEUR D'ANNOTATIONS
 *
 * SUITE SÉPARÉE, ET POUR UNE RAISON PRÉCISE : `react-dom/server` n'expose pas
 * `renderToString` sous la condition d'export `react-server`, dont la suite
 * principale a besoin (`lib/supabase/delete-student.ts` importe `server-only`).
 * Les deux ne peuvent pas cohabiter dans le même processus — d'où ce fichier,
 * lancé SANS la condition, exactement comme `cardio-block-form-render.mts`.
 *
 * CE QU'ELLE PROUVE
 *   Elle MONTE le lecteur avec le vrai React et regarde ce qui sort :
 *   les contrôles natifs, le canevas qui ne capte aucun clic, et surtout le
 *   texte du coach rendu comme du TEXTE. Aucun de ces trois points ne se
 *   vérifie honnêtement en lisant du source.
 *
 * CE QU'ELLE NE PROUVE PAS
 *   Le DESSIN lui-même : un canevas ne dessine rien au rendu serveur. Les
 *   coordonnées et la géométrie sont prouvées séparément, sur les fonctions
 *   pures (`boiteContenuVideo`, `versPixels`, `versNormalise`).
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

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const LECTEUR = lire("../../components/shared/AnnotatedVideoPlayer.tsx");
const EDITEUR = lire("../../components/admin/VideoAnnotationEditor.tsx");

const CALQUE = parseAnnotations([
  {
    id: "t1",
    type: "texte",
    debut: 0,
    duree: 5,
    position: { x: 0.5, y: 0.5 },
    contenu: "<script>alert(1)</script>",
  },
  { id: "c1", type: "cercle", debut: 0, duree: 5, centre: { x: 0.5, y: 0.5 }, rayon: 0.2 },
]);

test("R1. le lecteur monte, garde les contrôles natifs et pose un calque inerte", () => {
  const html = renderToString(createElement(AnnotatedVideoPlayer, { src: "blob:test", annotations: CALQUE }));
  assert.ok(/<video[^>]*controls/.test(html), "les contrôles du navigateur restent : plein écran, clavier, a11y");
  assert.ok(/<canvas/.test(html), "le calque est bien posé par-dessus");
  // Un canevas qui capterait les clics recouvrirait la barre de lecture, et
  // l'élève ne pourrait plus mettre en pause.
  assert.ok(/pointer-events-none/.test(html));
  assert.ok(/aria-hidden="true"/.test(html), "le canevas n'a rien à dire à un lecteur d'écran");
});

test("R2. LE TEXTE DU COACH N'EST JAMAIS INTERPRÉTÉ", () => {
  const html = renderToString(createElement(AnnotatedVideoPlayer, { src: "blob:test", annotations: CALQUE }));
  // Deux barrières, et elles tiennent toutes les deux :
  //   • le tracé est PEINT sur un canevas, où « balise » ne veut rien dire ;
  //   • la reprise accessible passe par un nœud texte React, donc échappée.
  assert.ok(!html.includes("<script>alert(1)</script>"), "aucune balise ne doit sortir telle quelle");
  assert.ok(html.includes("&lt;script&gt;"), "le contenu doit être rendu comme du TEXTE");
  assert.ok(!LECTEUR.includes("dangerouslySetInnerHTML"));
  assert.ok(!EDITEUR.includes("dangerouslySetInnerHTML"));
  assert.ok(!/innerHTML|insertAdjacentHTML|createContextualFragment/.test(LECTEUR + EDITEUR));
});

test("R3. ce que le canevas ne dit pas, le lecteur le dit autrement", () => {
  const html = renderToString(createElement(AnnotatedVideoPlayer, { src: "blob:test", annotations: CALQUE }));
  // React sépare deux nœuds texte voisins par un commentaire `<!-- -->` : lire
  // la PHRASE exige donc de les retirer, sinon « 2 annotations » n'est jamais
  // contigu dans le balisage et le contrôle passerait à côté de son sujet.
  const phrase = html.replace(/<!-- -->/g, "");
  // Les tracés géométriques ne se décrivent pas honnêtement en mots : on
  // annonce leur nombre. Le TEXTE écrit par le coach, lui, est du contenu.
  assert.ok(html.includes("sr-only"));
  assert.ok(/2 annotations/.test(phrase));
  assert.ok(/1 tracé dessiné/.test(phrase), "le nombre de tracés dessinés est annoncé");
  assert.ok(/À 0:00/.test(phrase), "et chaque texte porte son instant");
});

test("R4. un calque vide ne produit aucune reprise accessible parasite", () => {
  const html = renderToString(createElement(AnnotatedVideoPlayer, { src: "blob:test", annotations: [] }));
  assert.ok(/<video/.test(html), "la vidéo reste jouable sans annotation");
  assert.ok(!html.includes("sr-only"), "rien à annoncer : on n'annonce rien");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
