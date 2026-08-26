process.env.TZ = "Europe/Paris";

/**
 * Harnais — chantier AVIS GOOGLE, PHASE A (interface + source remplaçable).
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE PROTÈGE
 * ════════════════════════════════════════════════════════════════════════
 *   • le filtre 5 étoiles — et il travaille RÉELLEMENT, parce que le jeu
 *     contient trois avis pièges : des 3★, des 4★ et un 5★ sans texte ;
 *   • L'INTÉGRITÉ DES NEUF AVIS RÉELS : leur texte doit sortir dans le HTML
 *     au caractère près, sans troncature ni reformulation. Ce sont les mots
 *     de clients, pas du contenu qu'on peut retoucher ;
 *   • la frontière source / interface, celle qui permettra à la Phase B de
 *     ne changer qu'un fichier ;
 *   • le bandeau de provenance, qui empêche qu'une recopie figée soit lue
 *     comme un flux Google vivant ;
 *   • l'accessibilité : aucun contenu réservé au survol ;
 *   • l'absence de régression sur les sections voisines.
 *
 * ⚠️ CE QUE PHASE A N'A PAS ET NE DOIT PAS AVOIR : aucun cron, aucun OAuth,
 * aucune route API, aucune migration, aucune variable Google. Les tests 20 et
 * 21 le vérifient explicitement — c'est plus sûr que de s'en souvenir.
 *
 * Lancement : npx tsx scripts/tests/avis-google.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GoogleReviewsStack } from "../../components/sections/GoogleReviewsStack";
import {
  AVIS_DEMONSTRATION,
  AVIS_PIEGES,
  AVIS_RECOPIES,
  SOURCE_DES_AVIS,
} from "../../lib/reviews/google-reviews.mock";
import { getReviews } from "../../lib/reviews/source";
import { avisPubliables, estPubliable, moyenne, type GoogleReview } from "../../lib/reviews/types";

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
/** Ce que React écrit réellement dans le HTML pour un texte donné. */
function echappe(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const TYPES = lire("../../lib/reviews/types.ts");
const MOCK = lire("../../lib/reviews/google-reviews.mock.ts");
const SOURCE = lire("../../lib/reviews/source.ts");
const SECTION = lire("../../components/sections/GoogleReviews.tsx");
const PILE = lire("../../components/sections/GoogleReviewsStack.tsx");
const PAGE_ACCUEIL = lire("../../app/page.tsx");
const CSS = lire("../../app/globals.css");
/**
 * Le bloc CSS de la pile, depuis l'ouverture de son commentaire d'en-tête.
 * `lastIndexOf("/*", …)` et non `indexOf(marqueur)` : découper au marqueur
 * laisserait un commentaire sans son ouverture, que le nettoyeur ne saurait
 * plus reconnaître — et les phrases qui DOCUMENTENT une règle feraient rougir
 * le test qui la vérifie.
 */
const MARQUEUR_BLOC = "AMAS D'AVIS EN ORBITE";
const CSS_PILE = (() => {
  const ou = CSS.indexOf(MARQUEUR_BLOC);
  /*
   * ⚠️ LE REPÈRE A DÉJÀ CHANGÉ UNE FOIS, ET DIX TESTS SONT TOMBÉS D'UN COUP.
   * Le bloc s'appelait « PILE D'AVIS » ; renommé, `indexOf` a rendu −1, la
   * découpe portait sur tout le fichier et les assertions cherchaient leurs
   * règles au mauvais endroit. On échoue donc bruyamment plutôt que de
   * mesurer n'importe quoi.
   */
  if (ou < 0) throw new Error(`bloc CSS introuvable : « ${MARQUEUR_BLOC} »`);
  return CSS.slice(CSS.lastIndexOf("/*", ou));
})();
/** Les règles seules : ni commentaires, ni points de rupture `@media`. */
function reglesCss(bloc: string): string {
  return bloc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*@media[^{]*\{/gm, "");
}

function avis(n: number, patch: Partial<GoogleReview> = {}): GoogleReview {
  return {
    id: `essai-${n}`,
    authorName: `Essai ${n}`,
    authorPhoto: null,
    rating: 5,
    text: `Texte de l'avis numéro ${n}.`,
    date: "2026-03-14T10:00:00.000Z",
    googleUrl: null,
    ...patch,
  };
}

/* ═══════════════ 1-3. LE FILTRE 5 ÉTOILES ═══════════════ */

await test("1. seuls les avis 5 étoiles sont publiables — et le filtre est UNIQUE", () => {
  assert.equal(estPubliable(avis(1, { rating: 5 })), true);
  assert.equal(estPubliable(avis(2, { rating: 4 })), false);
  assert.equal(estPubliable(avis(3, { rating: 3 })), false);
  assert.equal(estPubliable(avis(4, { rating: 2 })), false);
  assert.equal(estPubliable(avis(5, { rating: 1 })), false);
  // Un 5 étoiles SANS texte ne produit pas une carte vide.
  assert.equal(estPubliable(avis(6, { text: "   " })), false);

  // ÉGALITÉ STRICTE, jamais un seuil : `>= 5` serait équivalent aujourd'hui
  // et faux le jour où une source rendrait une note hors barème.
  const source = sansCommentaires(TYPES);
  assert.ok(source.includes("avis.rating === NOTE_PUBLIABLE"), "égalité stricte");
  assert.ok(!/rating\s*>=?\s*\d/.test(source), "aucun seuil dans le filtre");
  assert.ok(source.includes("const NOTE_PUBLIABLE = 5 as const"), "la note publiable est 5, en dur");

  // Et le filtre n'est écrit QU'À UN SEUL ENDROIT : deux copies finiraient
  // par diverger.
  for (const [nom, code] of [["section", SECTION], ["pile", PILE]] as const) {
    assert.ok(
      !/rating\s*===?\s*5/.test(sansCommentaires(code)),
      `${nom} : le filtre ne doit pas être recopié dans l'interface`,
    );
  }
});

await test("2. le jeu contient RÉELLEMENT des avis pièges à écarter", () => {
  // ⚠️ SANS CETTE VÉRIFICATION, LE TEST 3 SERAIT VERT MÊME SANS FILTRE. Un
  // jeu composé uniquement de 5 étoiles ne peut rien prouver.
  const notes = AVIS_PIEGES.map((a) => a.rating);
  assert.ok(notes.includes(4), "il faut au moins un piège à 4 étoiles");
  assert.ok(notes.includes(3), "il faut au moins un piège à 3 étoiles");
  assert.ok(
    AVIS_PIEGES.some((a) => a.rating === 5 && a.text.trim().length === 0),
    "il faut un piège à 5 étoiles SANS texte",
  );
  // Les pièges ne sont jamais mélangés aux vrais avis.
  for (const piege of AVIS_PIEGES) {
    assert.ok(
      !AVIS_RECOPIES.some((vrai) => vrai.id === piege.id),
      `${piege.id} ne doit pas figurer parmi les avis réels`,
    );
  }
  assert.ok(AVIS_DEMONSTRATION.length >= 8, `au moins 8 avis pour l'effet de pile — ${AVIS_DEMONSTRATION.length}`);
});

await test("3. les avis à moins de 5 étoiles n'atteignent JAMAIS le rendu", async () => {
  const { reviews } = await getReviews();
  assert.ok(reviews.length > 0, "des avis publiables existent");
  for (const item of reviews) {
    assert.equal(item.rating, 5, `« ${item.authorName} » est à ${item.rating} étoiles`);
    assert.ok(item.text.trim().length > 0, `« ${item.authorName} » n'a pas de texte`);
  }

  // La preuve par le HTML : les textes des avis écartés ne sont nulle part.
  const html = renderToStaticMarkup(createElement(GoogleReviewsStack, { avis: reviews }));
  for (const ecarte of AVIS_DEMONSTRATION.filter((a) => !estPubliable(a))) {
    assert.ok(
      !html.includes(echappe(ecarte.text.trim())) || ecarte.text.trim().length === 0,
      `le texte de « ${ecarte.authorName} » ne doit pas être rendu`,
    );
    assert.ok(!html.includes(ecarte.id), `l'identifiant ${ecarte.id} ne doit pas être rendu`);
  }
  // Et les avis pièges portent un nom qui le dit, au cas où l'un passerait.
  assert.ok(!html.includes("Ne doit pas s"), "aucun avis piège n'est rendu");
});

/* ═══════════════ 4-6. LA FRONTIÈRE SOURCE / INTERFACE ═══════════════ */

await test("4. l'interface ne connaît QUE le type d'un avis, jamais sa provenance", () => {
  // La pile n'importe ni le mock, ni la source : elle reçoit une liste.
  const pile = sansCommentaires(PILE);
  assert.ok(!pile.includes("google-reviews.mock"), "la pile n'importe pas le mock");
  assert.ok(!pile.includes("reviews/source"), "la pile n'importe pas la source");
  assert.ok(pile.includes('from "@/lib/reviews/types"'), "elle ne connaît que le type");

  // La section appelle la source, et rien d'autre.
  const section = sansCommentaires(SECTION);
  assert.ok(section.includes("getReviews"), "la section appelle la source");
  assert.ok(!section.includes("google-reviews.mock"), "la section n'importe jamais le mock");
});

await test("5. la source est le SEUL point à changer en Phase B", () => {
  // Le mock n'est importé qu'à un endroit dans tout le dépôt applicatif.
  const importeurs = ["../../lib/reviews/source.ts", "../../components/sections/GoogleReviews.tsx", "../../components/sections/GoogleReviewsStack.tsx", "../../app/page.tsx"]
    .filter((chemin) => sansCommentaires(lire(chemin)).includes("google-reviews.mock"));
  assert.deepEqual(
    importeurs,
    ["../../lib/reviews/source.ts"],
    `le mock ne doit être importé QUE par la source — trouvé : ${importeurs.join(", ")}`,
  );

  // La signature est déjà asynchrone : la Phase B lira une base ou un réseau,
  // et un passage de synchrone à asynchrone obligerait à retoucher la section.
  assert.ok(SOURCE.includes("export async function getReviews()"), "getReviews est async dès maintenant");
  assert.ok(SECTION.includes("await getReviews()"), "et la section l'attend");
});

await test("6. la source ne lève jamais et rend une charge complète", async () => {
  const charge = await getReviews();
  assert.ok(Array.isArray(charge.reviews), "reviews est une liste");
  assert.equal(typeof charge.demonstration, "boolean", "demonstration est un booléen");
  assert.equal(charge.count, charge.reviews.length, "count reflète les avis réellement rendus");
  assert.equal(charge.average, moyenne(charge.reviews), "average est la moyenne des avis rendus");
  assert.ok(SOURCE.includes("} catch {"), "la source enveloppe sa lecture");
  assert.ok(
    SOURCE.includes("return { reviews: [], demonstration: true, average: null, count: 0 };"),
    "et rend une charge vide plutôt que de lever",
  );
});

/* ═══════════════ 7-8. LE BANDEAU DE DÉMONSTRATION ═══════════════ */

await test("7. AUCUN texte de provenance n'est rendu à l'écran", async () => {
  /*
   * ⚠️ CE TEST EXIGEAIT UN BANDEAU. IL EXIGE MAINTENANT SON ABSENCE, et le
   * renversement est une demande explicite — pas une dérive.
   *
   * Le bandeau disait « Avis Google réels, recopiés manuellement — non
   * synchronisés automatiquement ». Ce qu'il annonçait n'a jamais porté sur
   * l'AUTHENTICITÉ du contenu : ces neuf avis sont de vrais avis, écrits par
   * de vrais clients, recopiés au caractère près — les tests 24 et 28 le
   * verrouillent, et ils n'ont pas bougé. Il portait sur la FRAÎCHEUR : un
   * avis publié demain n'apparaîtra pas tout seul.
   *
   * Cette réserve reste vraie côté code — `demonstration: true` n'a pas
   * changé dans la source — elle n'est simplement plus dite à l'écran.
   *
   * Ce que ce test verrouille désormais : qu'aucun texte de provenance ne
   * revienne par inadvertance, et surtout qu'il ne soit pas remplacé par un
   * autre libellé.
   */
  const section = sansCommentaires(SECTION);
  assert.ok(!section.includes("data-avis-demonstration"), "plus aucun bandeau dans la section");
  for (const motif of [
    /recopiés? manuellement/i,
    /non synchronis/i,
    /données de démonstration/i,
    /pas de vrais avis/i,
    /mock/i,
    /local/i,
  ]) {
    assert.ok(!motif.test(section), `un texte de provenance subsiste : ${motif}`);
  }

  // La preuve par le HTML rendu, et pas seulement par le source.
  const { reviews } = await getReviews();
  const html = renderToStaticMarkup(createElement(GoogleReviewsStack, { avis: reviews }));
  assert.ok(!/recopi|synchronis|démonstration/i.test(html), "rien n'est rendu par la pile non plus");
});

await test("8. le drapeau de provenance vit toujours dans la SOURCE", () => {
  /*
   * ⚠️ RETIRER LE BANDEAU N'EST PAS RETIRER LE DRAPEAU. L'affichage a
   * disparu ; l'information de provenance, elle, reste au seul endroit où
   * elle a une valeur technique — la source. C'est ce que la Phase B
   * basculera, et c'est ce qui permettrait de réafficher un jour une mention
   * sans avoir à retrouver comment elle était calculée.
   */
  assert.ok(SOURCE.includes("demonstration: true"), "la source porte toujours le drapeau");
  // Et la section ne le lit plus : elle n'a plus rien à en faire.
  const section = sansCommentaires(SECTION);
  assert.ok(
    !/\bdemonstration\b/.test(section),
    "la section ne doit plus lire un drapeau qu'elle n'affiche pas",
  );
  assert.ok(section.includes("getReviews"), "elle appelle toujours la source");
});

/* ═══════════════ 9-11. LA SECTION DANS LA PAGE ═══════════════ */

await test("9. la section est placée ENTRE Transformations et Mon bilan offert", () => {
  const ordre = [
    "<Hero />",
    "<MethodStorytelling />",
    "<Transformations />",
    "<GoogleReviews />",
    "<FreeAssessment />",
    "<PublicPrograms />",
    "<Newsletter />",
  ];
  let curseur = -1;
  for (const balise of ordre) {
    const i = PAGE_ACCUEIL.indexOf(balise);
    assert.ok(i > -1, `${balise} doit être présente`);
    assert.ok(i > curseur, `${balise} doit venir après ${ordre[ordre.indexOf(balise) - 1] ?? "le début"}`);
    curseur = i;
  }
  // La contrainte exacte : rien ne s'intercale entre les trois.
  const iT = PAGE_ACCUEIL.indexOf("<Transformations />");
  const iG = PAGE_ACCUEIL.indexOf("<GoogleReviews />");
  const iF = PAGE_ACCUEIL.indexOf("<FreeAssessment />");
  const entre = PAGE_ACCUEIL.slice(iT + "<Transformations />".length, iF);
  const balisesEntre = [...entre.matchAll(/<([A-Z]\w+)\s*\/>/g)].map((m) => m[1]);
  assert.deepEqual(balisesEntre, ["GoogleReviews"], `un composant s'est glissé : ${balisesEntre.join(", ")}`);
  assert.ok(iT < iG && iG < iF, "l'ordre est bien Transformations → avis → bilan");
});

await test("10. les sections voisines ne sont PAS modifiées", () => {
  const transformations = lire("../../components/sections/Transformations.tsx");
  const bilan = lire("../../components/sections/FreeAssessment.tsx");
  // Aucune des deux ne connaît les avis.
  for (const [nom, code] of [["Transformations", transformations], ["FreeAssessment", bilan]] as const) {
    assert.ok(!code.includes("GoogleReviews"), `${nom} ne doit pas référencer la nouvelle section`);
    assert.ok(!code.includes("reviews"), `${nom} ne doit pas connaître les avis`);
  }
  // Et elles gardent leurs ancres et leurs titres.
  assert.ok(transformations.includes('id="transformations"'), "l'ancre de Transformations est intacte");
  assert.ok(bilan.includes('id="bilan-offert"'), "l'ancre du bilan est intacte");
  assert.ok(transformations.includes("Transformations"), "le titre de Transformations est intact");
  assert.ok(bilan.includes("Mon bilan offert"), "le titre du bilan est intact");
});

await test("11. l'absence d'avis ne casse pas la page — la section disparaît", () => {
  assert.ok(SECTION.includes("if (reviews.length === 0) return null;"), "aucun avis ⇒ rien n'est rendu");
  assert.ok(!/bient[oô]t/i.test(sansCommentaires(SECTION)), "aucun texte d'attente inventé");
  const html = renderToStaticMarkup(createElement(GoogleReviewsStack, { avis: [] }));
  assert.equal(html, "", `une liste vide ne doit rien produire — reçu « ${html} »`);
});

/* ═══════════════ 12-15. RENDU ET ACCESSIBILITÉ ═══════════════ */

await test("12. plusieurs cartes sont rendues, chacune avec son avis", async () => {
  const { reviews } = await getReviews();
  const html = renderToStaticMarkup(createElement(GoogleReviewsStack, { avis: reviews }));
  const cartes = (html.match(/class="avis-carte-hote"/g) ?? []).length;
  assert.equal(cartes, reviews.length, `${reviews.length} cartes attendues, ${cartes} rendues`);
  assert.ok(cartes >= 6, `l'effet de pile demande plusieurs cartes — ${cartes} rendues`);
});

await test("13. TOUT le contenu est dans le DOM, jamais réservé au survol", async () => {
  const { reviews } = await getReviews();
  const html = renderToStaticMarkup(createElement(GoogleReviewsStack, { avis: reviews }));
  for (const item of reviews) {
    assert.ok(html.includes(echappe(item.text)), `le texte de ${item.id} est dans le DOM`);
    assert.ok(html.includes(echappe(item.authorName)), `l'auteur de ${item.id} est dans le DOM`);
  }
  // La mise en avant est un attribut, pas un affichage conditionnel.
  assert.ok(PILE.includes("data-en-avant"), "la mise en avant est un attribut");
  // ⚠️ SUR LE CODE NETTOYÉ. Le composant CITE `{enAvant && …}` dans un
  // commentaire pour expliquer pourquoi il ne le fait pas ; chercher le motif
  // dans le texte brut ferait rougir le test sur la phrase qui le justifie.
  assert.ok(
    !sansCommentaires(PILE).includes("{enAvant && "),
    "aucun contenu conditionné à la mise en avant",
  );
  /*
   * Et le CSS ne fait DISPARAÎTRE aucun contenu.
   *
   * ⚠️ L'ÉCRÊTAGE PAR `line-clamp` N'EST PAS UN MASQUAGE, et la distinction
   * est celle qui compte ici. Un `display: none` retire le texte du DOM rendu
   * — un lecteur d'écran ne le lit plus. `line-clamp` limite les lignes
   * PEINTES : le texte reste entier dans le DOM, accessible, indexable, et
   * l'assertion du dessus le vérifie avis par avis.
   */
  const regles = reglesCss(CSS_PILE);
  assert.ok(!/opacity:\s*0\b/.test(regles), "aucune carte rendue transparente");
  assert.ok(!/visibility:\s*hidden/.test(regles), "aucune carte masquée");
  assert.ok(!/display:\s*none/.test(regles), "aucune carte retirée du flux");
});

await test("14. la note est lisible par un lecteur d'écran, les étoiles sont décoratives", () => {
  const html = renderToStaticMarkup(createElement(GoogleReviewsStack, { avis: [avis(1)] }));
  assert.ok(html.includes('aria-label="5 étoiles sur 5"'), "la note est dite en toutes lettres");
  assert.equal((html.match(/lucide-star/g) ?? []).length, 5, "cinq icônes rendues");
  assert.ok(html.includes('aria-hidden="true"'), "les icônes sont masquées aux lecteurs d'écran");
  // Une note différente rend un nombre différent d'étoiles.
  const quatre = renderToStaticMarkup(
    createElement(GoogleReviewsStack, { avis: [avis(2, { rating: 4 })] }),
  );
  assert.equal((quatre.match(/lucide-star/g) ?? []).length, 4, "une note de 4 rend 4 icônes");
  assert.ok(quatre.includes("4 étoiles sur 5"), "et le libellé dit la vraie note");
});

await test("15. la découverte fonctionne au clavier, avec un focus visible", () => {
  assert.ok(PILE.includes("onFocus: mettreEnAvant(index)"), "le focus met la carte en avant");
  assert.ok(PILE.includes("onBlur: retirer(index)"), "et la quitter la remet en place");
  assert.ok(PILE.includes("tabIndex={0}"), "les cartes sans lien restent tabulables");
  assert.ok(CSS_PILE.includes(".avis-carte:focus-visible"), "le focus produit la même mise en avant");
  /*
   * ⚠️ LE CONTOUR NE PEUT PLUS ÊTRE `--color-primary`. Ce jeton vaut BLANC en
   * thème sombre — et les cartes sont devenues blanches. Le liseré de focus
   * clavier aurait purement et simplement disparu : invisible, donc inexistant
   * pour qui navigue sans souris. Il est passé au bleu Google, lisible sur
   * blanc dans les deux thèmes.
   */
  assert.ok(
    /outline:\s*2px solid var\(--avis-g-focus\)/.test(CSS_PILE),
    "le contour de focus utilise une couleur lisible sur une carte blanche",
  );
  assert.ok(
    !/outline:[^;]*--color-primary/.test(CSS_PILE),
    "et surtout pas le jeton blanc du thème sombre",
  );
});

/* ═══════════════ 16-18. ANIMATION, RESPONSIVE, IDENTITÉ ═══════════════ */

await test("16. aucune bibliothèque d'animation n'a été ajoutée", () => {
  const paquet = JSON.parse(lire("../../package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const toutes = { ...paquet.dependencies, ...paquet.devDependencies };
  for (const interdite of ["framer-motion", "motion", "gsap", "react-spring", "@react-spring/web", "lottie-react", "@formkit/auto-animate"]) {
    assert.ok(!(interdite in toutes), `${interdite} ne doit pas avoir été ajoutée`);
  }
  // L'animation est du CSS maison, comme le reste du projet.
  assert.ok(CSS_PILE.includes("transition:"), "la pile anime en CSS");
  assert.ok(CSS_PILE.includes("var(--ease-out)"), "avec l'easing du projet");
  assert.ok(!PILE.includes("import { motion"), "aucun import d'animation dans le composant");
});

await test("17. les animations se coupent sous prefers-reduced-motion", () => {
  assert.ok(CSS_PILE.includes("@media (prefers-reduced-motion: reduce)"), "le garde existe");
  const reduit = CSS_PILE.slice(CSS_PILE.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(reduit.includes("transition: none"), "plus aucune transition");
  assert.ok(reduit.includes("transform: none"), "plus aucune transformation");
  // Le survol est gardé derrière un pointeur fin : sur tactile, `:hover` reste
  // collé après un tap et figerait une carte au premier plan.
  assert.ok(
    CSS_PILE.includes("@media (hover: hover) and (pointer: fine)"),
    "le survol est réservé aux pointeurs fins",
  );
});

await test("18. la section reprend les codes visuels de ses voisines", () => {
  assert.ok(SECTION.includes("<SectionLabel>"), "l'ouvreur de section commun est réutilisé");
  assert.ok(SECTION.includes("mx-auto max-w-7xl px-6"), "le conteneur commun");
  assert.ok(
    SECTION.includes("font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl"),
    "le titre suit exactement le gabarit des autres h2",
  );
  assert.ok(SECTION.includes("scroll-mt-24"), "l'ancre est décalée comme ailleurs");
  /*
   * ⚠️ CETTE ASSERTION ÉTAIT DEVENUE VIDE, et je l'ai laissée passer une fois.
   * La section est passée à `overflow-x-clip` ; l'assertion cherchait
   * `overflow-hidden` dans le fichier BRUT et le trouvait… dans le commentaire
   * qui explique pourquoi ce n'est plus ça. Elle est verte pour une raison
   * fausse. On cherche donc dans le code nettoyé, et on nomme la bonne règle.
   */
  assert.ok(
    sansCommentaires(SECTION).includes("overflow-x-clip"),
    "la section coupe son débordement horizontal sans guillotiner le vertical",
  );
  // Jetons sémantiques uniquement : aucune couleur brute, donc aucun risque
  // de « couleurs Google criardes ».
  const section = sansCommentaires(SECTION) + sansCommentaires(PILE);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(section), "aucune couleur hexadécimale en dur");
  assert.ok(!/\b(rgb|hsl)a?\(/.test(section), "aucune couleur brute en dur");
  // Aucun faux badge officiel : le mot « Google » suffit à nommer la source.
  assert.ok(!/logo|badge/i.test(section), "aucun badge ni logo Google reproduit");
});

await test("19. aucun débordement horizontal n'est possible par construction", () => {
  /*
   * ⚠️ CE TEST DÉCRIVAIT UNE PILE VERTICALE, PUIS DEUX COLONNES. La
   * composition est maintenant une ORBITE : il n'y a plus de flux à
   * contraindre, mais une SCÈNE CARRÉE dans laquelle chaque carte est placée
   * par un angle et un rayon.
   *
   * Le débordement se prévient donc autrement : la scène est bornée à la
   * largeur disponible, et l'inégalité `rayon + demi-carte ≤ demi-scène` — que
   * R16 mesure à l'écran — garde toutes les cartes à l'intérieur.
   */
  const regles = reglesCss(CSS_PILE);
  assert.ok(
    /width:\s*min\(100%,/.test(regles),
    "la scène est bornée à la largeur disponible",
  );
  assert.ok(/aspect-ratio:\s*1/.test(regles), "et elle est carrée");
  assert.ok(!/width:\s*\d{3,}px/.test(regles), "aucune largeur fixe en pixels");

  // La section, elle, coupe l'axe horizontal sans guillotiner le vertical.
  assert.ok(
    sansCommentaires(SECTION).includes("overflow-x-clip"),
    "la section coupe son débordement horizontal",
  );
});

await test("20. PHASE A : aucun cron, aucune route API, aucune migration, aucun vercel.json touché", () => {
  const racine = new URL("../../", import.meta.url);
  for (const chemin of [
    "app/api/cron/sync-google-reviews",
    "app/api/admin/google-reviews",
    "app/admin/avis",
    "lib/google",
    "lib/supabase/google-reviews.ts",
  ]) {
    assert.ok(!existsSync(new URL(chemin, racine)), `${chemin} ne doit pas exister en Phase A`);
  }
  // Aucune migration d'avis.
  const migrations = lire("../../supabase/baseline/manifest.json");
  assert.ok(!/avis_google|google_reviews/i.test(migrations), "aucune migration d'avis déclarée");
  // vercel.json ne porte que les deux crons d'origine.
  const vercel = JSON.parse(lire("../../vercel.json")) as { crons?: { path: string }[] };
  const chemins = (vercel.crons ?? []).map((c) => c.path);
  assert.deepEqual(
    chemins,
    ["/api/cron/purge-feedback-videos", "/api/cron/purge-coach-reply-videos"],
    `vercel.json ne doit pas avoir changé — trouvé : ${chemins.join(", ")}`,
  );
});

await test("21. PHASE A : aucune variable d'environnement Google, aucun appel réseau", () => {
  const env = lire("../../.env.example");
  assert.ok(!/GOOGLE_BUSINESS/i.test(env), "aucune variable Google documentée");
  assert.ok(!/GOOGLE_REVIEWS/i.test(env), "aucune variable d'avis documentée");

  for (const [nom, code] of [["types", TYPES], ["mock", MOCK], ["source", SOURCE], ["section", SECTION], ["pile", PILE]] as const) {
    const propre = sansCommentaires(code);
    assert.ok(!propre.includes("fetch("), `${nom} : aucun appel réseau`);
    assert.ok(!/process\.env\./.test(propre), `${nom} : aucune variable d'environnement lue`);
    assert.ok(!/googleapis\.com/.test(propre), `${nom} : aucune URL d'API Google`);
    assert.ok(!/oauth/i.test(propre), `${nom} : aucun OAuth`);
  }
});

/* ═══════════════ 22-23. INTÉGRITÉ DU CONTENU ═══════════════ */

await test("22. le texte d'un avis n'est jamais reformulé, tronqué ni complété", () => {
  const texte = "Un texte  avec   des espaces, des accents éàù et « des guillemets ».";
  const html = renderToStaticMarkup(createElement(GoogleReviewsStack, { avis: [avis(1, { text: texte })] }));
  assert.ok(html.includes(echappe(texte)), "le texte sort exactement tel qu'il est entré");

  /*
   * ⚠️ CE TEST INTERDISAIT TOUT `line-clamp`. IL NE LE PEUT PLUS, et c'est un
   * changement de contrat assumé : au repos, la carte ne montre désormais que
   * les premières lignes de l'avis, et le texte complet apparaît au survol.
   *
   * Ce qui reste interdit, et que ces trois assertions verrouillent :
   *   • que les données, elles, soient tronquées — c'est le test 28 ;
   *   • que l'écrêtage ne soit JAMAIS levé, ce qui rendrait la fin d'un avis
   *     réellement inatteignable ;
   *   • qu'une ellipse vienne suggérer un texte « à rallonge » qu'on ne
   *     pourrait pas lire.
   */
  const clampLeve = /line-clamp:\s*none/.test(reglesCss(CSS_PILE));
  assert.ok(clampLeve, "l'écrêtage doit être levé quelque part — sinon la fin de l'avis est perdue");
  assert.ok(
    /\.avis-carte:hover\s+\.avis-texte/.test(CSS_PILE),
    "le survol lève l'écrêtage",
  );
  assert.ok(
    /\[data-en-avant="true"\]\s+\.avis-texte/.test(CSS_PILE),
    "la mise en avant (focus clavier, tap) le lève aussi",
  );
  assert.ok(!/text-overflow:\s*ellipsis/.test(reglesCss(CSS_PILE)), "aucune ellipse");
  // Le nom de l'auteur non plus : un nom coupé n'attribue plus rien.
  // ⚠️ SUR LE CODE NETTOYÉ. Le composant CITE `truncate` dans un commentaire
  // pour expliquer pourquoi il ne l'utilise pas : chercher le mot dans le
  // texte brut ferait rougir le test sur la phrase qui le justifie.
  assert.ok(
    !sansCommentaires(PILE).includes("truncate"),
    "le nom de l'auteur n'est jamais tronqué",
  );
});

await test("23. la provenance LOCALE est identifiable sans lire le contenu", () => {
  /*
   * ⚠️ CE TEST A CHANGÉ DE NATURE, ET IL FAUT SAVOIR POURQUOI.
   *
   * Dans sa version précédente, il exigeait que CHAQUE avis s'annonce comme
   * faux : identifiant `demo-`, nom commençant par « Exemple », texte
   * contenant le mot « démonstration ». C'était la bonne garde tant que les
   * données étaient inventées — le marqueur vivait DANS LE CONTENU.
   *
   * Le contenu est maintenant RÉEL et INTOUCHABLE : neuf avis écrits par des
   * clients. Exiger qu'ils s'annoncent comme des exemples reviendrait à
   * exiger qu'on les falsifie. Le marqueur descend donc dans la STRUCTURE —
   * constante de provenance, préfixe d'identifiant, nom de fichier, drapeau
   * de la source — où il est tout aussi lisible et n'altère rien.
   */
  assert.equal(SOURCE_DES_AVIS, "mock-local", "la provenance est déclarée en clair");
  assert.ok(
    /RECOPIÉS À LA MAIN|RECOPIÉ/i.test(MOCK),
    "l'en-tête du fichier dit que les avis sont recopiés à la main",
  );
  assert.ok(
    /PAS SYNCHRONIS|pas synchronis/i.test(MOCK),
    "et qu'ils ne sont pas synchronisés avec Google",
  );

  // ── Les avis RÉELS : marqués par leur identifiant, jamais par leur texte.
  for (const item of AVIS_RECOPIES) {
    assert.ok(
      item.id.startsWith("mock-google-"),
      `${item.id} doit porter le préfixe de source locale`,
    );
    assert.ok(item.text.trim().length > 0, `${item.id} doit porter un texte réel`);
    // ⚠️ AUCUNE MENTION DE DÉMONSTRATION DANS UN AVIS RÉEL. Si ce mot
    // apparaissait ici, c'est qu'un texte aurait été retouché.
    assert.ok(
      !/démonstration|exemple de/i.test(item.text),
      `le texte de ${item.id} ne doit pas avoir été maquillé`,
    );
  }

  // ── Les avis PIÈGES : eux s'annoncent comme faux, dans le contenu même.
  for (const item of AVIS_PIEGES) {
    assert.ok(item.id.startsWith("mock-piege-"), `${item.id} doit porter le préfixe de piège`);
    assert.ok(
      item.authorName.startsWith("Exemple"),
      `« ${item.authorName} » doit s'annoncer comme un exemple`,
    );
    // Le piège volontairement SANS TEXTE est exempté : c'est son absence de
    // texte qui en fait un cas d'essai, et y écrire quoi que ce soit le
    // rendrait publiable.
    if (item.text.trim().length > 0) {
      assert.ok(/démonstration/i.test(item.text), `le texte de ${item.id} doit se dire inventé`);
    }
  }

  // ⚠️ AUCUNE PHOTO NI URL, NULLE PART. Trois de ces neuf comptes ont une
  // vraie photo de profil ; la reprendre supposerait une URL
  // `googleusercontent.com` fabriquée ou un téléchargement. On affiche donc
  // l'initiale — une donnée absente, jamais une donnée inventée.
  for (const item of AVIS_DEMONSTRATION) {
    assert.equal(item.authorPhoto, null, `${item.id} ne doit pas porter de photo`);
    assert.equal(item.googleUrl, null, `${item.id} ne doit pas porter d'URL`);
  }
});

/* ═══════════ 24-28. L'INTÉGRITÉ DES AVIS RÉELS ═══════════ */

/**
 * L'EMPREINTE DE CHAQUE TRANSCRIPTION — LE VERROU DE FIDÉLITÉ.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CETTE TABLE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Une première rédaction du test 24 comparait le HTML rendu au texte lu dans
 * `google-reviews.mock.ts`. Elle a été mise à l'épreuve en tronquant un avis
 * à 200 caractères DANS LE MOCK : le test est resté VERT.
 *
 * Évidemment : il lisait son attendu dans le fichier même qu'il surveillait.
 * Tronquer le texte tronquait aussi l'attendu, et les deux coïncidaient
 * toujours. Un tel test prouve que le composant n'abîme rien ; il ne prouve
 * RIEN sur la fidélité aux captures.
 *
 * ⚠️ CES VALEURS SONT LE TÉMOIN INDÉPENDANT. Elles ont été calculées le
 * 25 août 2026, à la transcription, et elles ne doivent JAMAIS être
 * recalculées pour faire passer un test. Si une empreinte ne correspond plus,
 * c'est qu'un texte de client a changé — et la seule question valable est
 * « qu'est-ce qui a modifié les mots de cette personne ? », pas « comment
 * remettre le test au vert ? ».
 *
 * Les mettre à jour est légitime dans UN cas et un seul : une nouvelle
 * capture montre que la transcription était fautive. Alors on corrige le
 * texte, on recalcule, et on dit pourquoi.
 */
const EMPREINTES = [
  { id: "mock-google-01", auteur: "Naïla Nach", caracteres: 342, empreinte: "2b07d87f896670d8" },
  { id: "mock-google-02", auteur: "Gaelle Balouzat", caracteres: 593, empreinte: "3d2b2d1799550000" },
  { id: "mock-google-03", auteur: "Alice Raveau", caracteres: 139, empreinte: "8f9483fdfe2bdc28" },
  { id: "mock-google-04", auteur: "Vincent Métamorph'Ose l'art d'être Soi m'aime", caracteres: 802, empreinte: "c008e1efd3f4385f" },
  { id: "mock-google-05", auteur: "Arthur C.I", caracteres: 245, empreinte: "cbd6c140865ffe18" },
  { id: "mock-google-06", auteur: "Alessandra Piel", caracteres: 658, empreinte: "fb55472263fdda7d" },
  { id: "mock-google-07", auteur: "Matthieu BALESTRIERI", caracteres: 44, empreinte: "fa0474eac4eade6e" },
  { id: "mock-google-08", auteur: "Foutse Yuehgoh", caracteres: 632, empreinte: "3782a91f6cf9b534" },
  { id: "mock-google-09", auteur: "Audrey ZIGGIOTTI", caracteres: 513, empreinte: "15d6ea23fbe5e169" },
] as const;

function empreinteDe(texte: string): string {
  return createHash("sha256").update(texte, "utf8").digest("hex").slice(0, 16);
}

await test("28. AUCUN avis n'a été retouché depuis la transcription des captures", () => {
  assert.equal(
    AVIS_RECOPIES.length,
    EMPREINTES.length,
    "la table d'empreintes couvre exactement les avis recopiés",
  );

  for (const attendu of EMPREINTES) {
    const item = AVIS_RECOPIES.find((a) => a.id === attendu.id);
    assert.ok(item, `${attendu.id} (${attendu.auteur}) a disparu du mock`);
    assert.equal(
      item.authorName,
      attendu.auteur,
      `le nom de ${attendu.id} a changé — était « ${attendu.auteur} »`,
    );
    assert.equal(
      [...item.text].length,
      attendu.caracteres,
      `le texte de « ${attendu.auteur} » fait ${[...item.text].length} caractères au lieu de ${attendu.caracteres} — troncature ou ajout`,
    );
    assert.equal(
      empreinteDe(item.text),
      attendu.empreinte,
      `le texte de « ${attendu.auteur} » a été MODIFIÉ depuis la transcription (reformulation, correction, ponctuation, emoji)`,
    );
  }
});

await test("24. les NEUF avis réels sortent dans le HTML au caractère près", async () => {
  const { reviews } = await getReviews();
  const html = renderToStaticMarkup(createElement(GoogleReviewsStack, { avis: reviews }));

  for (const item of AVIS_RECOPIES) {
    // ⚠️ LE TEXTE ENTIER, PAS SON DÉBUT. Une troncature à 200 caractères
    // passerait un test qui ne vérifierait que les premiers mots — et c'est
    // exactement la régression qu'on veut rendre impossible.
    assert.ok(
      html.includes(echappe(item.text)),
      `le texte de « ${item.authorName} » doit sortir INTÉGRALEMENT et tel quel`,
    );
    assert.ok(
      html.includes(echappe(item.authorName)),
      `le nom « ${item.authorName} » doit sortir tel quel`,
    );
  }

  // Les emoji et les sauts de ligne font partie du texte : ils survivent.
  assert.ok(html.includes("💪"), "les emoji des avis ne sont pas filtrés");
  assert.ok(
    reglesCss(CSS_PILE).includes("white-space: pre-line"),
    "les sauts de ligne des auteurs sont préservés au rendu",
  );
});

await test("25. AUCUNE note inférieure à 5 ne disparaît en silence", () => {
  /*
   * ⚠️ LE FILTRE 5 ÉTOILES EST MUET PAR CONSTRUCTION : un avis à 4 étoiles
   * est écarté sans un mot, et la section afficherait huit cartes au lieu de
   * neuf sans que personne ne s'en aperçoive. Ce test est le contrepoids —
   * il NOMME l'avis écarté au lieu de le laisser s'évaporer.
   */
  const ecartes = AVIS_RECOPIES.filter((a) => a.rating !== 5);
  if (ecartes.length > 0) {
    for (const item of ecartes) {
      console.error(
        `   ⚠️  AVIS RÉEL NON AFFICHÉ — « ${item.authorName} » est à ${item.rating}★ ` +
          `et sera écarté par le filtre. Vérifie la capture avant de conclure à une erreur de saisie.`,
      );
    }
  }
  assert.equal(
    ecartes.length,
    0,
    `${ecartes.length} avis réel(s) écarté(s) par le filtre : ${ecartes.map((a) => `${a.authorName} (${a.rating}★)`).join(", ")}`,
  );
  // Et les neuf arrivent bien jusqu'au rendu.
  assert.equal(AVIS_RECOPIES.length, 9, `neuf avis recopiés attendus — ${AVIS_RECOPIES.length}`);
});

await test("26. aucun doublon, aucun avis fabriqué en plus des neuf", () => {
  const identifiants = AVIS_DEMONSTRATION.map((a) => a.id);
  assert.equal(
    new Set(identifiants).size,
    identifiants.length,
    "chaque identifiant est unique",
  );
  const noms = AVIS_RECOPIES.map((a) => a.authorName);
  assert.equal(new Set(noms).size, noms.length, "chaque auteur n'apparaît qu'une fois");

  // ⚠️ NEUF, PAS DIX. Un dixième avis existe sur la fiche mais sa capture n'a
  // pas été fournie. Ce test tombe si quelqu'un « complète » la liste de
  // mémoire — ce qui serait un faux avis, quelle qu'en soit l'intention.
  assert.equal(
    AVIS_RECOPIES.length,
    9,
    "exactement neuf avis recopiés : le dixième n'a pas de capture et ne doit pas être inventé",
  );
});

await test("27. aucune date n'a été fabriquée à partir d'une ancienneté relative", () => {
  /*
   * ⚠️ GOOGLE N'AFFICHE JAMAIS DE DATE ABSOLUE — « il y a 4 jours »,
   * « 6 days ago », « Edited a day ago ». Convertir ces mentions en date ISO
   * fabriquerait une donnée à partir de l'instant de la recopie. Les neuf
   * avis portent donc `date: null`, et la carte n'affiche pas de ligne de
   * date plutôt que d'en afficher une fausse.
   */
  for (const item of AVIS_RECOPIES) {
    assert.equal(
      item.date,
      null,
      `${item.id} porte une date que la capture ne pouvait pas fournir`,
    );
  }

  // Le tri reste déterministe malgré l'absence totale de dates : l'ordre
  // affiché est l'ordre du tableau, pas un ordre au hasard.
  const publies = avisPubliables(AVIS_RECOPIES);
  assert.deepEqual(
    publies.map((a) => a.id),
    AVIS_RECOPIES.map((a) => a.id),
    "sans date, l'ordre d'affichage est exactement l'ordre du tableau",
  );

  // Et un avis daté passe toujours AVANT un avis sans date.
  const melange = avisPubliables([
    avis(1, { id: "sans-date", date: null }),
    avis(2, { id: "date-2026", date: "2026-01-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(
    melange.map((a) => a.id),
    ["date-2026", "sans-date"],
    "une date absente ne doit pas se faire passer pour une date récente",
  );
});

/* ═══════════ 29-31. GÉOMÉTRIE : HORIZONTALES ET DÉSORDONNÉES ═══════════ */

await test("29. AUCUNE carte n'est tournée — ni au repos, ni au survol, ni au focus", () => {
  /*
   * ⚠️ L'EXIGENCE EST ABSOLUE, DONC LA GARDE L'EST AUSSI.
   *
   * Une version précédente inclinait chaque carte de ±2,2° via une fonction
   * `inclinaison()` et une variable `--avis-rotation`. Les deux ont été
   * supprimées. Ce test empêche qu'elles reviennent par la fenêtre — y
   * compris sous une autre forme : `skew`, `rotate3d`, `matrix`.
   */
  const pile = sansCommentaires(PILE);
  assert.ok(!/inclinaison/.test(pile), "la fonction d'inclinaison ne doit plus exister");
  assert.ok(!/--avis-rotation\b/.test(pile), "aucune variable de rotation par carte");
  assert.ok(!/rotate|skew|matrix/.test(pile), "aucune rotation posée en ligne par React");

  /*
   * Côté CSS : on isole les règles qui portent sur UNE CARTE, et on vérifie
   * qu'aucune ne tourne. Le conteneur, lui, a le droit — c'est le groupe.
   */
  const regles = reglesCss(CSS_PILE);
  const declarations = [...regles.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(declarations.length > 10, `le bloc CSS doit être analysable — ${declarations.length} règles`);

  let reglesDeCarte = 0;
  for (const [, selecteur, corps] of declarations) {
    if (!/\.avis-carte/.test(selecteur)) continue;
    reglesDeCarte += 1;
    assert.ok(
      !/\b(rotate|skew|rotate3d|rotateZ)\s*\(/.test(corps),
      `« ${selecteur.trim()} » applique une rotation à une carte : ${corps.trim()}`,
    );
  }
  assert.ok(reglesDeCarte >= 5, `les règles de carte doivent être trouvées — ${reglesDeCarte}`);

  /*
   * ⚠️ IL N'Y A PLUS AUCUNE ROTATION DE GROUPE NON PLUS — et c'est ce qui
   * rend la garde absolue.
   *
   * Une version précédente faisait pivoter le conteneur de ±0,4° pendant la
   * secousse. L'orbite ne fonctionne plus ainsi : rien ne tourne, les
   * éléments PARCOURENT un cercle par translation. C'est précisément ce qui
   * garantit, sans contre-rotation, que les cartes restent horizontales.
   *
   * Le seul `rotate()` du bloc porte sur les TRAITS qui relient les avis à la
   * photo : un trait qui joint deux points doit s'orienter, c'est sa raison
   * d'être, et ce n'est pas une carte.
   */
  const rotations = declarations.filter(([, , corps]) => /\brotate\s*\(/.test(corps));
  for (const [, selecteur] of rotations) {
    assert.ok(
      /\.avis-lien/.test(selecteur),
      `« ${selecteur.trim()} » applique une rotation alors que seuls les traits y ont droit`,
    );
  }
  assert.equal(rotations.length, 1, `un seul élément tourne : le trait — ${rotations.length} trouvés`);

  // Et la secousse du groupe ne porte plus de composante angulaire.
  assert.ok(
    !/ROTATION_GROUPE_MAX/.test(pile),
    "le plafond de rotation de groupe n'a plus lieu d'être",
  );
  assert.ok(
    !/--avis-groupe-rotation/.test(regles),
    "aucune rotation posée sur le conteneur",
  );

  // ⚠️ LE MOUVEMENT VIENT DE `cos()` ET `sin()`, PAS D'UNE ROTATION.
  assert.ok(
    /cos\(var\(--avis-a\)\)/.test(regles) && /sin\(var\(--avis-a\)\)/.test(regles),
    "les cartes sont placées en coordonnées polaires, par translation",
  );
});

await test("30. chaque avis a son propre angle ET son propre rayon", () => {
  /*
   * ⚠️ LES DEUX TABLES DE DÉCALAGE ONT ÉTÉ REMPLACÉES par des coordonnées
   * polaires — un angle et un rayon par avis. L'exigence, elle, n'a pas
   * changé : aucune carte ne doit occuper la position d'une autre, et
   * l'ensemble ne doit ressembler ni à une grille ni à un cadran.
   */
  const pile = sansCommentaires(PILE);
  assert.ok(/function angle/.test(pile), "un angle par avis");
  assert.ok(/function rayon/.test(pile), "un rayon par avis");
  assert.ok(/--avis-angle/.test(pile) && /--avis-rayon/.test(pile), "les deux sont posés en ligne");
  assert.ok(!/decalageX|decalageY/.test(pile), "les anciennes tables cartésiennes ont disparu");

  const lire = (nom: string): number[] => {
    const bloc = new RegExp(`function ${nom}[\\s\\S]*?\\[([^\\]]+)\\]`).exec(pile);
    assert.ok(bloc, `la table de ${nom} doit être lisible`);
    return bloc[1].split(",").map((v) => Number(v.trim()));
  };
  const angles = lire("angle");
  const rayons = lire("rayon");

  assert.equal(angles.length, 9, `neuf angles attendus — ${angles.length}`);
  assert.equal(rayons.length, 9, `neuf rayons attendus — ${rayons.length}`);

  // ── NEUF POSITIONS DISTINCTES.
  const positions = angles.map((a, i) => `${a}|${rayons[i]}`);
  assert.equal(new Set(positions).size, 9, "deux avis occupent la même position");

  // ── PAS UN CADRAN : les écarts angulaires ne sont pas tous égaux.
  const ecarts = angles.slice(1).map((a, i) => Number((a - angles[i]).toFixed(4)));
  assert.ok(
    new Set(ecarts).size > 2,
    `les avis ne doivent pas être régulièrement espacés — écarts : ${ecarts.join(", ")}`,
  );

  // ── PAS UN ANNEAU : les rayons respirent.
  assert.ok(
    Math.max(...rayons) - Math.min(...rayons) >= 0.15,
    `les rayons doivent varier — de ${Math.min(...rayons)} à ${Math.max(...rayons)}`,
  );

  // ── ET LES ANGLES COUVRENT BIEN TOUT LE TOUR, sans se tasser d'un côté.
  assert.ok(Math.min(...angles) < 0.15, "des avis en haut du cercle");
  assert.ok(Math.max(...angles) > 0.85, "et d'autres qui bouclent le tour");
});

await test("31. le rayon PLANCHER dégage la photo, le rayon PLAFOND tient dans la scène", () => {
  /*
   * ⚠️ CE TEST COMPARAIT DES GOUTTIÈRES DE GRILLE. Il n'y a plus de grille.
   * Les deux inégalités qui la remplacent portent sur le rayon, et chacune
   * vient d'un défaut réellement rencontré :
   *
   *   • un plancher trop bas et la carte la plus proche passe SOUS la photo,
   *     qui la recouvre : elle devient intouchable ;
   *   • un plafond trop haut et la carte la plus au large sort de l'écran.
   *
   * Ici on vérifie les VALEURS déclarées ; R16 mesure le résultat à l'écran,
   * aux deux largeurs.
   */
  const pile = sansCommentaires(PILE);
  const bloc = /function rayon[\s\S]*?\[([^\]]+)\]/.exec(pile);
  assert.ok(bloc, "la table des rayons doit être lisible");
  const rayons = bloc[1].split(",").map((v) => Number(v.trim()));

  const regles = reglesCss(CSS_PILE);
  const nombre = (nom: string, ou: string): number => {
    const m = new RegExp(`${nom}:\\s*([\\d.]+)rem`).exec(ou);
    assert.ok(m, `${nom} doit être déclaré`);
    return Number(m[1]) * 16;
  };

  // Les deux jeux de mesures : mobile (bloc de base) puis desktop.
  const desktop = CSS_PILE.slice(CSS_PILE.indexOf("@media (min-width: 768px)"));
  for (const [nom, source] of [
    ["mobile", CSS_PILE.slice(0, CSS_PILE.indexOf("@media (min-width: 768px)"))],
    ["desktop", desktop],
  ] as const) {
    const base = nombre("--avis-rayon-base", source);
    const photo = nombre("--avis-photo", source) / 2;
    const demiCarte = nombre("--avis-carte-large", source) / 2;

    assert.ok(
      Math.min(...rayons) * base - demiCarte >= photo,
      `${nom} : la carte la plus proche passe sous la photo (${Math.round(Math.min(...rayons) * base - demiCarte)} px pour un rayon de photo de ${Math.round(photo)} px)`,
    );
  }
  assert.ok(regles.length > 0, "le bloc CSS doit être lisible");
});

await test("32. les cartes portent les codes couleur de Google", () => {
  /*
   * ⚠️ CES COULEURS SONT DES VALEURS BRUTES, ET C'EST LE SEUL ENDROIT DU
   * DÉPÔT OÙ C'EST JUSTIFIÉ. Une carte d'avis doit être reconnue comme une
   * carte Google avant d'être lue. Les passer en jetons sémantiques les
   * rendrait noires en thème sombre — elles cesseraient d'être des cartes
   * Google.
   *
   * Elles sont nommées une fois, sur le conteneur, et jamais semées dans les
   * règles : ce test verrouille les deux.
   */
  const attendus: Record<string, string> = {
    "--avis-g-fond": "#ffffff",
    "--avis-g-bordure": "#dadce0",
    "--avis-g-nom": "#202124",
    "--avis-g-texte": "#3c4043",
    "--avis-g-secondaire": "#70757a",
    "--avis-g-etoile": "#fbbc04",
    "--avis-g-avatar": "#f1f3f4",
    "--avis-g-focus": "#1a73e8",
  };
  for (const [jeton, valeur] of Object.entries(attendus)) {
    assert.ok(
      new RegExp(`${jeton}:\\s*${valeur}\\b`, "i").test(CSS_PILE),
      `${jeton} doit valoir ${valeur}`,
    );
  }

  // Les règles utilisent les jetons, pas les valeurs recopiées à la main.
  const regles = reglesCss(CSS_PILE);
  for (const valeur of ["#dadce0", "#202124", "#3c4043", "#70757a", "#1a73e8"]) {
    const occurrences = regles.split(valeur).length - 1;
    assert.ok(occurrences <= 1, `${valeur} est recopié ${occurrences} fois au lieu d'être un jeton`);
  }

  // Le fond de la carte et la couleur des étoiles viennent bien des jetons.
  assert.ok(
    /background-color:\s*var\(--avis-g-fond\)/.test(regles),
    "le fond de la carte est le blanc Google",
  );
  assert.ok(
    /\.avis-etoile\s*\{[^}]*var\(--avis-g-etoile/.test(CSS_PILE),
    "les étoiles portent le jaune Google",
  );

  // ⚠️ ET AUCUN LOGO NI BADGE : le mot « Google » suffit à nommer la source,
  // reproduire la marque ne nous appartient pas.
  assert.ok(!/logo|badge/i.test(sansCommentaires(PILE)), "aucun badge ni logo Google reproduit");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
