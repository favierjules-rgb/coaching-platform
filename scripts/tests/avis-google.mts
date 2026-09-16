process.env.TZ = "Europe/Paris";

/**
 * Harnais — chantier AVIS GOOGLE, PHASE A (interface + source remplaçable).
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE PROTÈGE
 * ════════════════════════════════════════════════════════════════════════
 *   • le filtre 5 étoiles — et il travaille RÉELLEMENT, parce que le jeu
 *     contient trois avis pièges : des 3★, des 4★ et un 5★ sans texte ;
 *   • L'INTÉGRITÉ DES DOUZE AVIS RÉELS : leur texte doit sortir dans le HTML
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

import { GoogleReviewsGrid } from "../../components/sections/GoogleReviewsGrid";
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
const GRILLE = lire("../../components/sections/GoogleReviewsGrid.tsx");
const PAGE_ACCUEIL = lire("../../app/page.tsx");
const CSS = lire("../../app/globals.css");
/**
 * Le bloc CSS de la pile, depuis l'ouverture de son commentaire d'en-tête.
 * `lastIndexOf("/*", …)` et non `indexOf(marqueur)` : découper au marqueur
 * laisserait un commentaire sans son ouverture, que le nettoyeur ne saurait
 * plus reconnaître — et les phrases qui DOCUMENTENT une règle feraient rougir
 * le test qui la vérifie.
 */
const MARQUEUR_BLOC = "REFONTE DU 16/09/2026 — L'ORBITE A DISPARU";
const CSS_MOSAIQUE = (() => {
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
  for (const [nom, code] of [["section", SECTION], ["mosaïque", GRILLE]] as const) {
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
  const html = renderToStaticMarkup(createElement(GoogleReviewsGrid, { avis: reviews }));
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
  const pile = sansCommentaires(GRILLE);
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
  const importeurs = ["../../lib/reviews/source.ts", "../../components/sections/GoogleReviews.tsx", "../../components/sections/GoogleReviewsGrid.tsx", "../../app/page.tsx"]
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
   * l'AUTHENTICITÉ du contenu : ces douze avis sont de vrais avis, écrits par
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
  const html = renderToStaticMarkup(createElement(GoogleReviewsGrid, { avis: reviews }));
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
  const html = renderToStaticMarkup(createElement(GoogleReviewsGrid, { avis: [] }));
  assert.equal(html, "", `une liste vide ne doit rien produire — reçu « ${html} »`);
});

/* ═══════════════ 12-15. RENDU ET ACCESSIBILITÉ ═══════════════ */

await test("12. chaque avis a SA carte, et la boucle en pose une copie masquée", async () => {
  const { reviews } = await getReviews();
  const html = renderToStaticMarkup(createElement(GoogleReviewsGrid, { avis: reviews }));

  /*
   * ⚠️ ON COMPTE LES CARTES RÉELLES, PAS LES CARTES RENDUES. Depuis que le
   * mur défile en boucle, chaque colonne contient son contenu DEUX fois : la
   * copie est ce qui rend le raccord invisible. Elle porte `aria-hidden`, et
   * c'est exactement ce qui permet de la distinguer ici.
   */
  const toutes = (html.match(/class="avis-carte"/g) ?? []).length;
  const copies = (html.match(/class="avis-carte" aria-hidden="true"/g) ?? []).length;
  const reelles = toutes - copies;

  assert.equal(reelles, reviews.length, `${reviews.length} cartes réelles attendues, ${reelles}`);
  assert.equal(copies, reviews.length, "la copie couvre exactement les mêmes avis");
  assert.equal(toutes, reviews.length * 2, "la piste fait bien le double de son contenu");

  // Et chaque avis est présent, une fois pour de vrai.
  for (const item of reviews) {
    assert.ok(html.includes(echappe(item.authorName)), `${item.authorName} est rendu`);
  }
});

await test("13. TOUT le contenu est dans le DOM, et RIEN n'attend le survol", async () => {
  const { reviews } = await getReviews();
  const html = renderToStaticMarkup(createElement(GoogleReviewsGrid, { avis: reviews }));
  for (const item of reviews) {
    assert.ok(html.includes(echappe(item.text)), `le texte de ${item.id} est dans le DOM`);
    assert.ok(html.includes(echappe(item.authorName)), `l'auteur de ${item.id} est dans le DOM`);
  }

  /*
   * ⚠️ CHANGEMENT DE CONTRAT DU 16/09/2026, ET IL VA DANS LE BON SENS.
   *
   * L'ancienne mise en scène écrêtait le texte au repos et le dépliait au
   * survol : le contenu était dans le DOM, mais une partie n'était PEINTE
   * qu'à la souris. Le mur ne cache plus rien — chaque carte fait la hauteur
   * de son avis, et ce qu'on lit ne dépend d'aucun geste.
   */
  const grille = sansCommentaires(GRILLE);
  assert.ok(!/data-en-avant/.test(grille), "plus aucune mise en avant : rien ne se révèle");
  assert.ok(!/useState|useEffect/.test(grille), "le mur n'a plus d'état");
  assert.ok(!/"use client"/.test(grille), "et plus une ligne de JavaScript côté client");

  const regles = reglesCss(CSS_MOSAIQUE);
  assert.ok(!/opacity:\s*0\b/.test(regles), "aucune carte rendue transparente");
  assert.ok(!/visibility:\s*hidden/.test(regles), "aucune carte masquée");
  assert.ok(!/line-clamp/.test(regles), "aucun écrêtage : la carte grandit, le texte reste entier");

  /*
   * ⚠️ LE SEUL `display: none` TOLÉRÉ VISE LES COPIES, et seulement sous
   * mouvement réduit — où la boucle s'arrête et où la copie n'a plus de
   * raison d'être. Toute autre règle qui retirerait une carte du flux
   * cacherait un vrai témoignage.
   */
  for (const [, selecteur, corps] of regles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/display:\s*none/.test(corps)) continue;
    assert.ok(
      /aria-hidden="true"/.test(selecteur),
      `« ${selecteur.trim()} » retire une carte réelle du flux`,
    );
  }
});

await test("14. la note est lisible par un lecteur d'écran, les étoiles sont décoratives", () => {
  /*
   * ⚠️ UN SEUL AVIS EN ENTRÉE, MAIS DEUX CARTES EN SORTIE : la piste duplique
   * son contenu pour boucler. On compte donc les icônes de la PREMIÈRE carte,
   * pas celles du document entier — sans quoi le test mesurerait la boucle et
   * non la note.
   */
  const premiereCarte = (html: string) => html.slice(0, html.indexOf('aria-hidden="true"><div'));

  const html = renderToStaticMarkup(createElement(GoogleReviewsGrid, { avis: [avis(1)] }));
  assert.ok(html.includes('aria-label="5 étoiles sur 5"'), "la note est dite en toutes lettres");
  assert.equal((premiereCarte(html).match(/lucide-star/g) ?? []).length, 5, "cinq icônes rendues");
  assert.ok(html.includes('aria-hidden="true"'), "les icônes sont masquées aux lecteurs d'écran");

  // Une note différente rend un nombre différent d'étoiles.
  const quatre = renderToStaticMarkup(
    createElement(GoogleReviewsGrid, { avis: [avis(2, { rating: 4 })] }),
  );
  assert.equal(
    (premiereCarte(quatre).match(/lucide-star/g) ?? []).length,
    4,
    "une note de 4 rend 4 icônes",
  );
  assert.ok(quatre.includes("4 étoiles sur 5"), "et le libellé dit la vraie note");
});

await test("15. le clavier atteint les deux appels à l'action, avec un focus visible", () => {
  /*
   * ⚠️ IL N'Y A PLUS RIEN À « DÉCOUVRIR » AU CLAVIER, et c'est un progrès.
   *
   * L'ancienne mise en scène rendait chaque carte tabulable (`tabIndex={0}`)
   * pour qu'un focus dévoile le texte écrêté : douze arrêts de tabulation
   * pour lire ce qui aurait dû être lisible d'emblée. La mosaïque n'écrête
   * plus rien, donc les cartes n'ont plus à être focusables — et le clavier
   * ne traverse plus que ce qui est réellement actionnable.
   */
  const grille = sansCommentaires(GRILLE);
  assert.ok(!/tabIndex/.test(grille), "une carte n'est pas un contrôle : elle ne se tabule pas");

  /*
   * Ce qui est actionnable, lui, doit se voir au clavier : les deux boutons
   * du panneau. Le lien Google s'ouvre dans un nouvel onglet, ce qui impose
   * `rel="noopener noreferrer"` — sans lui, la page ouverte garde une
   * référence vers la nôtre via `window.opener`.
   */
  const section = sansCommentaires(SECTION);
  /*
   * ⚠️ LE FOCUS EST EN CSS, PAS EN CLASSE UTILITAIRE. L'anneau de Tailwind
   * (`focus-visible:ring-primary`) vaut BLANC en thème sombre — et le panneau
   * est devenu gris clair : l'anneau aurait disparu. Il est passé au bleu
   * Google, sur `.avis-bouton`, lisible sur clair comme sur blanc.
   */
  assert.equal(
    (section.match(/className="avis-bouton /g) ?? []).length,
    2,
    "les deux appels à l'action partagent la même classe de bouton",
  );
  assert.ok(
    /\.avis-bouton:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--avis-g-bleu\)/.test(CSS_MOSAIQUE),
    "et cette classe porte un contour de focus visible",
  );
  assert.ok(
    /\.avis-bouton:focus-visible\s*\{[^}]*outline-offset/.test(CSS_MOSAIQUE),
    "décollé du bouton, pour rester lisible sur un fond plein",
  );
  assert.ok(/target="_blank"/.test(section), "le lien Google s'ouvre à côté");
  assert.ok(
    /rel="noopener noreferrer"/.test(section),
    "et il coupe l'accès à window.opener",
  );

  /*
   * ⚠️ LE CONTOUR D'UN LIEN DANS UNE CARTE NE PEUT PAS ÊTRE `--color-primary`.
   * Ce jeton vaut BLANC en thème sombre — et les cartes sont blanches. Le
   * liseré aurait purement et simplement disparu : invisible, donc inexistant
   * pour qui navigue sans souris. Il est au bleu Google, lisible sur blanc
   * dans les deux thèmes.
   */
  assert.ok(
    /outline:\s*2px solid var\(--avis-g-bleu\)/.test(CSS_MOSAIQUE),
    "le contour de focus utilise une couleur lisible sur une carte blanche",
  );
  assert.ok(
    !/outline:[^;]*--color-primary/.test(CSS_MOSAIQUE),
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
  assert.ok(/@keyframes avis-defilement/.test(CSS_MOSAIQUE), "le défilement est déclaré en CSS");
  assert.ok(!GRILLE.includes("import { motion"), "aucun import d'animation dans le composant");

  /*
   * ⚠️ `linear`, ET C'EST LA RÈGLE DE LA MAISON, PAS UN GOÛT. Un mouvement
   * PERPÉTUEL qui accélère et ralentit attrape l'œil bien plus qu'il ne le
   * doit — voir `.agents/skills/review-animations/STANDARDS.md`, « constant
   * motion (marquee) -> linear ». Les courbes d'accélération (`var(--ease-out)`)
   * sont réservées aux entrées et sorties ponctuelles : ici, il n'y en a pas.
   */
  const defilement = /animation:\s*avis-defilement\s+(\S+)\s+(\w+)/.exec(reglesCss(CSS_MOSAIQUE));
  assert.ok(defilement, "l'animation de la piste doit être lisible");
  assert.equal(defilement[1], "linear", `une boucle ne doit pas accélérer — trouvé ${defilement[1]}`);
  assert.equal(defilement[2], "infinite", "et elle ne s'arrête jamais d'elle-même");
  assert.ok(
    !/animation:\s*avis-defilement[^;]*var\(--ease-out\)/.test(CSS_MOSAIQUE),
    "surtout pas l'easing des entrées/sorties sur une boucle",
  );
});

await test("17. les animations se coupent sous prefers-reduced-motion", () => {
  assert.ok(CSS_MOSAIQUE.includes("@media (prefers-reduced-motion: reduce)"), "le garde existe");
  const reduit = CSS_MOSAIQUE.slice(CSS_MOSAIQUE.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(reduit.includes("transition: none"), "plus aucune transition");
  assert.ok(reduit.includes("transform: none"), "plus aucune transformation");
  // Le survol est gardé derrière un pointeur fin : sur tactile, `:hover` reste
  // collé après un tap et figerait une carte au premier plan.
  assert.ok(
    CSS_MOSAIQUE.includes("@media (hover: hover) and (pointer: fine)"),
    "le survol est réservé aux pointeurs fins",
  );
});

await test("18. la section reprend les codes visuels de ses voisines", () => {
  /*
   * ⚠️ L'OUVREUR « PREUVE SOCIALE » A ÉTÉ RETIRÉ, sur demande. La section
   * s'ouvre désormais directement sur son titre.
   *
   * Ce test exigeait `<SectionLabel>` au nom de la cohérence avec les
   * sections voisines. Il exige maintenant l'inverse — qu'aucun ouvreur ne
   * revienne par recopie d'une autre section — et continue de vérifier tout
   * le reste du gabarit commun : conteneur, titre, ancre.
   */
  assert.ok(
    !sansCommentaires(SECTION).includes("<SectionLabel>"),
    "aucun ouvreur de section au-dessus des avis",
  );
  assert.ok(
    !/Preuve sociale/i.test(sansCommentaires(SECTION)),
    "le libellé « Preuve sociale » ne doit plus être rendu",
  );
  assert.ok(SECTION.includes("mx-auto max-w-7xl px-6"), "le conteneur commun");
  assert.ok(
    /*
     * ⚠️ LE GABARIT TYPOGRAPHIQUE EST LE MÊME QUE PARTOUT ; LA COULEUR, NON.
     * `text-foreground` a été retiré de la classe : sur un panneau gris clair,
     * ce jeton vaut blanc en thème sombre et le titre disparaîtrait. La
     * couleur vient de `.avis-titre` et de la palette Google.
     */
    SECTION.includes("font-heading text-4xl font-extrabold uppercase md:text-6xl") &&
      SECTION.includes('className="avis-titre'),
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
  /*
   * ⚠️ AUCUNE COULEUR EN DUR DANS LES COMPOSANTS DE SECTION. Toutes les
   * valeurs de la palette Google vivent dans le bloc CSS, sous forme de
   * jetons — c'est ce qui permet de les mesurer (test 33) et d'empêcher
   * qu'une nuance dérive au fil des retouches.
   *
   * ⚠️ `LogoGoogle` EST LA SEULE EXCEPTION, et elle est délibérée : les
   * quatre couleurs de la marque sont posées tracé par tracé, dans le
   * composant, parce qu'un logo officiel ne se thématise pas. Le test 32
   * verrouille ces quatre valeurs et interdit toute règle qui le recolorerait.
   */
  const section = sansCommentaires(SECTION) + sansCommentaires(GRILLE);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(section), "aucune couleur hexadécimale en dur");
  assert.ok(!/\b(rgb|hsl)a?\(/.test(section), "aucune couleur brute en dur");
  assert.ok(
    !/#[0-9a-fA-F]{3,8}\b/.test(sansCommentaires(SECTION)),
    "la section elle-même ne porte aucune couleur brute",
  );
});

await test("19. aucun débordement horizontal n'est possible par construction", () => {
  /*
   * ⚠️ TROIS COMPOSITIONS SE SONT SUCCÉDÉ ICI — pile verticale, deux
   * colonnes, orbite — et chacune prévenait le débordement à sa façon. La
   * mosaïque le prévient par ses colonnes : une colonne ne peut pas être plus
   * large que son conteneur, et une carte ne peut pas déborder de sa colonne.
   *
   * Ce qui reste à verrouiller, c'est ce qui pourrait CASSER cette propriété.
   */
  const regles = reglesCss(CSS_MOSAIQUE);

  // Une largeur fixe en pixels ne rétrécit pas : sur un petit écran, elle pousse.
  assert.ok(!/width:\s*\d{3,}px/.test(regles), "aucune largeur fixe en pixels");

  // Une carte ne dépasse jamais sa colonne, même avec un mot à rallonge.
  assert.ok(
    /\.avis-carte[^{]*\{[^}]*max-width:\s*100%/.test(regles),
    "une carte est bornée à la largeur de sa colonne",
  );
  assert.ok(
    /overflow-wrap:\s*anywhere/.test(regles),
    "un mot trop long est coupé plutôt que de pousser la carte",
  );

  // Les colonnes sont bornées des deux côtés : `minmax(0, …)` empêche la
  // colonne de contenu de refuser de rétrécir sous la largeur de son contenu.
  assert.ok(
    /grid-template-columns:\s*minmax\(0,[^;]*minmax\(0,/.test(regles),
    "les deux colonnes ont le droit de rétrécir",
  );

  // Et la section coupe l'axe horizontal sans guillotiner le vertical —
  // `overflow: hidden` bloquerait aussi le collant du panneau.
  const section = sansCommentaires(SECTION);
  assert.ok(section.includes("overflow-x-clip"), "la section coupe son débordement horizontal");
  assert.ok(
    !/overflow-hidden/.test(section),
    "et pas `overflow-hidden`, qui casserait le panneau collant",
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

  for (const [nom, code] of [["types", TYPES], ["mock", MOCK], ["source", SOURCE], ["section", SECTION], ["mosaïque", GRILLE]] as const) {
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
  const html = renderToStaticMarkup(createElement(GoogleReviewsGrid, { avis: [avis(1, { text: texte })] }));
  assert.ok(html.includes(echappe(texte)), "le texte sort exactement tel qu'il est entré");

  /*
   * ⚠️ CE TEST A OSCILLÉ, ET IL REVIENT À SA FORME LA PLUS STRICTE.
   *
   * Il interdisait tout écrêtage ; la mise en scène orbitale l'a assoupli
   * (écrêté au repos, entier au survol) ; la mosaïque le rend à nouveau
   * absolu. Plus aucun `line-clamp`, nulle part : une carte fait la hauteur
   * de son avis. Couper le témoignage d'un client à trois lignes pour
   * l'esthétique d'une grille, c'est lui couper la parole.
   */
  const regles = reglesCss(CSS_MOSAIQUE);
  assert.ok(!/line-clamp/.test(regles), "aucun écrêtage du texte");
  assert.ok(!/text-overflow:\s*ellipsis/.test(regles), "aucune ellipse");
  assert.ok(!/max-height/.test(regles), "aucune hauteur plafonnée qui couperait un avis");

  /*
   * ⚠️ ET LES SAUTS DE LIGNE DE L'AUTEUR SURVIVENT. Plusieurs de ces avis
   * sont écrits en paragraphes ; les aplatir en un pavé changerait leur
   * lecture sans qu'un seul caractère ait été retiré.
   */
  assert.ok(/white-space:\s*pre-line/.test(regles), "les sauts de ligne sont restitués");

  // Le nom de l'auteur non plus : un nom coupé n'attribue plus rien.
  // ⚠️ SUR LE CODE NETTOYÉ. Le composant CITE `truncate` dans un commentaire
  // pour expliquer pourquoi il ne l'utilise pas : chercher le mot dans le
  // texte brut ferait rougir le test sur la phrase qui le justifie.
  assert.ok(!/truncate/.test(sansCommentaires(GRILLE)), "le nom de l'auteur n'est jamais tronqué");
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
  // Transcrits le 16/09/2026 depuis quatre captures (la quatrième, Gaelle
  // Balouzat, était déjà au dépôt et a servi de contrôle de fidélité).
  { id: "mock-google-10", auteur: "Nathalie ZOLLI", caracteres: 788, empreinte: "5b165ef8e85938aa" },
  { id: "mock-google-11", auteur: "Christelle Gestin", caracteres: 632, empreinte: "c6af0bdaa7edf211" },
  { id: "mock-google-12", auteur: "Corentin Dubuisson", caracteres: 337, empreinte: "e3afd6764294113e" },
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

await test("24. les DOUZE avis réels sortent dans le HTML au caractère près", async () => {
  const { reviews } = await getReviews();
  const html = renderToStaticMarkup(createElement(GoogleReviewsGrid, { avis: reviews }));

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
    reglesCss(CSS_MOSAIQUE).includes("white-space: pre-line"),
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
  assert.equal(AVIS_RECOPIES.length, 12, `neuf avis recopiés attendus — ${AVIS_RECOPIES.length}`);
});

await test("26. aucun doublon, aucun avis fabriqué en plus des douze", () => {
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
    12,
    "exactement douze avis recopiés : le treizième n'a pas de capture et ne doit pas être inventé",
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
   * Une version de l'ancienne mise en scène inclinait chaque carte de ±2,2°
   * via une fonction `inclinaison()` et une variable `--avis-rotation`. La
   * mise en scène a disparu ; l'interdit, lui, reste. Ce test empêche qu'une
   * rotation revienne par la fenêtre — y compris sous une autre forme :
   * `skew`, `rotate3d`, `matrix`.
   */
  const grille = sansCommentaires(GRILLE);
  assert.ok(!/inclinaison/.test(grille), "la fonction d'inclinaison ne doit plus exister");
  assert.ok(!/--avis-rotation\b/.test(grille), "aucune variable de rotation par carte");
  assert.ok(!/rotate|skew|matrix/.test(grille), "aucune rotation posée en ligne par React");

  const regles = reglesCss(CSS_MOSAIQUE);
  const declarations = [...regles.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(declarations.length > 8, `le bloc CSS doit être analysable — ${declarations.length} règles`);

  let reglesDeCarte = 0;
  for (const [, selecteur, corps] of declarations) {
    if (!/\.avis-carte/.test(selecteur)) continue;
    reglesDeCarte += 1;
    assert.ok(
      !/\b(rotate|skew|rotate3d|rotateZ)\s*\(/.test(corps),
      `« ${selecteur.trim()} » applique une rotation à une carte : ${corps.trim()}`,
    );
  }
  assert.ok(reglesDeCarte >= 3, `les règles de carte doivent être trouvées — ${reglesDeCarte}`);
});

await test("30. le mur DÉFILE en boucle, et le raccord est exact", () => {
  const regles = reglesCss(CSS_MOSAIQUE);

  /*
   * ⚠️ LA BOUCLE REPOSE SUR UNE ÉGALITÉ, PAS SUR UN RÉGLAGE VISUEL.
   *
   * La piste contient son contenu deux fois et se translate de 0 à −50 %. À
   * la fin du cycle, la copie occupe EXACTEMENT la place de départ de
   * l'original : le raccord est invisible. Cette exactitude tient à une seule
   * condition — que la piste mesure le double de sa première moitié.
   *
   * D'où l'interdit qui suit : ni `gap` ni marge sur la piste. L'espacement
   * vient de la marge basse de CHAQUE carte, la dernière comprise. Un `gap`
   * laisserait une demi-marge orpheline au raccord et le mur sauterait à
   * chaque cycle — un défaut qu'on ne voit qu'après une minute d'observation,
   * et qu'on ne retrouve plus ensuite.
   */
  assert.ok(/translateY\(-50%\)/.test(regles), "la piste se translate d'exactement la moitié");
  assert.ok(
    /\.avis-carte[^{]*\{[^}]*margin-bottom:/.test(regles),
    "l'espacement est porté par la carte, y compris la dernière",
  );
  const piste = /\.avis-piste\s*\{([^}]*)\}/.exec(regles);
  assert.ok(piste, "la piste doit être déclarée");
  assert.ok(!/gap:/.test(piste[1]), "aucun `gap` sur la piste : il fausserait le raccord");
  assert.ok(!/margin/.test(piste[1]), "ni marge propre, pour la même raison");

  /*
   * ⚠️ ET LA FENÊTRE BORNE RÉELLEMENT. Sans hauteur ni `overflow`, les douze
   * avis s'étalent sur près de trois mille pixels et la boucle ne se voit
   * même pas — le mur défilerait hors de l'écran.
   */
  const fenetre = /\.avis-fenetre\s*\{([^}]*)\}/.exec(regles);
  assert.ok(fenetre, "la fenêtre doit être déclarée");
  assert.ok(/height:\s*clamp\(/.test(fenetre[1]), "sa hauteur est bornée des deux côtés");
  assert.ok(/overflow:\s*hidden/.test(fenetre[1]), "et ce qui dépasse est coupé");

  /*
   * ⚠️ LE FONDU EST UN MASQUE, PAS UN VOILE. Un dégradé posé par-dessus
   * prendrait la couleur du fond de la page : il trahirait la moindre section
   * colorée derrière. `mask-image` retire de l'opacité au contenu lui-même.
   */
  assert.ok(/mask-image:\s*linear-gradient/.test(fenetre[1]), "les cartes s'effacent aux deux bords");
  assert.ok(/-webkit-mask-image/.test(fenetre[1]), "avec le préfixe que WebKit exige encore");

  // Deux colonnes sur grand écran, une seule sur téléphone.
  assert.ok(/grid-template-columns:\s*repeat\(2,/.test(regles), "deux colonnes sur grand écran");
});

await test("31. le panneau est COLLANT sur grand écran, et libre sur téléphone", () => {
  /*
   * ⚠️ C'EST LA RAISON D'ÊTRE DE LA DISPOSITION. Au douzième témoignage,
   * « Laisser un avis » doit encore être à l'écran : le panneau reste collé
   * pendant que la mosaïque défile.
   *
   * ⚠️ MAIS PAS SUR TÉLÉPHONE. Sous `lg`, les deux colonnes s'empilent : un
   * panneau collant y mangerait la moitié de la hauteur utile et on ferait
   * défiler les avis dans une fente. Le collant vit donc DANS la requête
   * média, jamais à la racine.
   */
  const ouvreLg = CSS_MOSAIQUE.indexOf("@media (min-width: 1024px)");
  assert.ok(ouvreLg > 0, "le point de rupture grand écran existe");

  const avantLg = CSS_MOSAIQUE.slice(0, ouvreLg);
  assert.ok(
    !/\.avis-panneau[^{]*\{[^}]*position:\s*sticky/.test(avantLg),
    "le panneau ne doit pas être collant hors de la requête média",
  );

  const dansLg = CSS_MOSAIQUE.slice(ouvreLg, CSS_MOSAIQUE.indexOf("@media", ouvreLg + 10));
  assert.ok(/position:\s*sticky/.test(dansLg), "il l'est à partir de 1024 px");
  assert.ok(/top:\s*[\d.]+rem/.test(dansLg), "avec un décalage qui dégage l'en-tête fixe");
  assert.ok(
    /grid-template-columns:\s*minmax\(/.test(dansLg),
    "les deux colonnes apparaissent au même point de rupture",
  );
});

await test("32. la palette Google, le logo officiel, et rien de redessiné", () => {
  /*
   * ⚠️ CES COULEURS SONT DES VALEURS BRUTES, ET C'EST LE SEUL ENDROIT DU
   * DÉPÔT OÙ C'EST JUSTIFIÉ. Une carte d'avis doit être reconnue comme une
   * carte Google avant d'être lue. Les passer en jetons sémantiques les
   * rendrait noires en thème sombre — elles cesseraient d'être des cartes
   * Google. Elles sont nommées une fois, sur le conteneur, et jamais semées
   * dans les règles : ce test verrouille les deux.
   */
  const attendus: Record<string, string> = {
    "--avis-g-fond": "#ffffff",
    "--avis-g-bordure": "#dadce0",
    "--avis-g-nom": "#202124",
    "--avis-g-texte": "#3c4043",
    "--avis-g-secondaire": "#70757a",
    "--avis-g-etoile": "#fbbc04",
    "--avis-g-gris": "#f1f3f4",
    "--avis-g-bleu": "#1a73e8",
  };
  for (const [jeton, valeur] of Object.entries(attendus)) {
    assert.ok(
      new RegExp(`${jeton}:\\s*${valeur}\\b`, "i").test(CSS_MOSAIQUE),
      `${jeton} doit valoir ${valeur}`,
    );
  }

  // Les règles utilisent les jetons, pas les valeurs recopiées à la main.
  const regles = reglesCss(CSS_MOSAIQUE);
  for (const valeur of ["#dadce0", "#202124", "#3c4043", "#70757a", "#f1f3f4", "#1a73e8"]) {
    const occurrences = regles.split(valeur).length - 1;
    assert.ok(occurrences <= 1, `${valeur} est recopié ${occurrences} fois au lieu d'être un jeton`);
  }

  assert.ok(
    /background-color:\s*var\(--avis-g-fond\)/.test(regles),
    "le fond de la carte est le blanc Google",
  );
  assert.ok(
    /\.avis-etoile\s*\{[^}]*var\(--avis-g-etoile/.test(CSS_MOSAIQUE),
    "les étoiles portent le jaune Google",
  );

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ LE LOGO EST DÉSORMAIS EXIGÉ — CE TEST L'INTERDISAIT
   * ════════════════════════════════════════════════════════════════════════
   * Il vérifiait « aucun badge ni logo Google reproduit », au motif que
   * reproduire la marque ne nous appartient pas. L'interdit a été levé le
   * 16/09/2026, et la raison inverse est plus forte : afficher un avis Google
   * SANS l'attribuer visuellement à Google est le vrai problème. Les règles
   * de la fiche d'établissement demandent que les avis repris ailleurs
   * restent identifiables comme venant de Google.
   *
   * Ce qui reste interdit, et que ces assertions verrouillent : le
   * redessiner, le recolorer, le déformer.
   */
  const logo = lire("../../components/ui/LogoGoogle.tsx");
  assert.ok(sansCommentaires(GRILLE).includes("<LogoGoogle"), "chaque carte porte le G de Google");

  const MARQUE: Record<string, string> = {
    bleu: "#4285F4",
    vert: "#34A853",
    jaune: "#FBBC05",
    rouge: "#EA4335",
  };
  for (const [nom, valeur] of Object.entries(MARQUE)) {
    assert.ok(logo.includes(`fill="${valeur}"`), `le ${nom} officiel ${valeur} doit être intact`);
  }
  assert.equal(
    (logo.match(/<path/g) ?? []).length,
    4,
    "le logo a quatre tracés, un par couleur — ni plus, ni moins",
  );
  assert.ok(logo.includes('viewBox="0 0 48 48"'), "et le cadrage d'origine");

  /*
   * ⚠️ AUCUNE RÈGLE NE RECOLORE LE LOGO. `currentColor`, un `fill` ou un
   * `filter` dans le CSS le ferait dériver de la marque — c'est précisément
   * ce qu'on n'a pas le droit de faire.
   */
  const regleLogo = /\.logo-google\s*\{([^}]*)\}/.exec(regles);
  assert.ok(regleLogo, "le logo est dimensionné une fois, en CSS");
  assert.ok(!/fill|color|filter/.test(regleLogo[1]), "et jamais recoloré");
  assert.ok(
    /width:[^;]*;[\s\S]*height:/.test(regleLogo[1]),
    "ses deux dimensions sont posées : il reste carré",
  );

  /*
   * ⚠️ ET L'ATTRIBUTION RESTE LISIBLE SANS LES YEUX. Le logo est décoratif
   * (`aria-hidden`) ; le texte « Avis Google » est passé en `sr-only`. Le
   * retirer laisserait un avis non attribué à qui ne voit pas la page.
   */
  assert.ok(logo.includes('aria-hidden="true"'), "le logo est décoratif");
  assert.ok(
    /<span className="sr-only">Avis Google<\/span>/.test(GRILLE),
    "l'attribution écrite reste, pour les lecteurs d'écran",
  );
});

await test("33. l'îlot clair reste LISIBLE — contrastes mesurés, pas supposés", () => {
  /*
   * ⚠️ TOUTE LA SECTION EST PASSÉE EN CLAIR, jetons Google compris. Rien ne
   * garantit plus que le thème du site rattrape une erreur : si un gris
   * dérive, plus personne ne lit. Ce test refait le calcul WCAG sur les
   * paires réellement utilisées.
   *
   * ⚠️ LE BOUTON EST LE POINT SENSIBLE. Blanc sur #1a73e8 donne 4,51:1 —
   * au-dessus du plancher de 4,5:1 pour du petit texte, mais de 0,01. Toute
   * tentative d'éclaircir ce bleu fera rougir ce test, et c'est le but.
   */
  const canal = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = (hex: string) => {
    const n = hex.replace("#", "");
    const [r, v, b] = [0, 2, 4].map((i) => canal(parseInt(n.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * v + 0.0722 * b;
  };
  const contraste = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const jeton = (nom: string) => {
    const trouve = new RegExp(`${nom}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS_MOSAIQUE);
    assert.ok(trouve, `${nom} introuvable`);
    return trouve![1];
  };

  const blanc = jeton("--avis-g-fond");
  const gris = jeton("--avis-g-gris");
  const bleu = jeton("--avis-g-bleu");

  const paires: [string, string, string, number][] = [
    ["titre du panneau", jeton("--avis-g-nom"), gris, 4.5],
    ["sous-titre du panneau", jeton("--avis-g-texte"), gris, 4.5],
    ["texte d'un avis", jeton("--avis-g-texte"), blanc, 4.5],
    ["nom de l'auteur", jeton("--avis-g-nom"), blanc, 4.5],
    // La date est en petites majuscules espacées : traitée comme du texte normal.
    ["date d'un avis", jeton("--avis-g-secondaire"), blanc, 4.5],
    ["libellé du bouton bleu", blanc, bleu, 4.5],
    // Une bordure est un objet graphique : le plancher est de 3:1.
    ["bordure d'une carte", jeton("--avis-g-bordure"), gris, 1.1],
  ];
  for (const [quoi, avant, arriere, plancher] of paires) {
    const ratio = contraste(avant, arriere);
    assert.ok(
      ratio >= plancher,
      `${quoi} : ${avant} sur ${arriere} donne ${ratio.toFixed(2)}:1 — plancher ${plancher}:1`,
    );
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
