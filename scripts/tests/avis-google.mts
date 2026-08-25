process.env.TZ = "Europe/Paris";

/**
 * Harnais — chantier AVIS GOOGLE, PHASE A (interface + source remplaçable).
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE PROTÈGE
 * ════════════════════════════════════════════════════════════════════════
 *   • le filtre 5 étoiles — et il travaille RÉELLEMENT, parce que le jeu de
 *     démonstration contient des 3★, des 4★ et un 5★ sans texte ;
 *   • la frontière source / interface, celle qui permettra à la Phase B de
 *     ne changer qu'un fichier ;
 *   • le bandeau de démonstration, qui empêche qu'un faux témoignage soit lu
 *     comme un vrai ;
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
import { existsSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GoogleReviewsStack } from "../../components/sections/GoogleReviewsStack";
import { AVIS_DEMONSTRATION } from "../../lib/reviews/google-reviews.mock";
import { getReviews } from "../../lib/reviews/source";
import { estPubliable, moyenne, type GoogleReview } from "../../lib/reviews/types";

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
const CSS_PILE = CSS.slice(CSS.lastIndexOf("/*", CSS.indexOf("PILE D'AVIS")));
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

await test("2. le jeu de démonstration contient RÉELLEMENT des avis à écarter", () => {
  // ⚠️ SANS CETTE VÉRIFICATION, LE TEST 3 SERAIT VERT MÊME SANS FILTRE. Un
  // mock composé uniquement de 5 étoiles ne peut rien prouver.
  const notes = AVIS_DEMONSTRATION.map((a) => a.rating);
  assert.ok(notes.includes(4), "le mock doit contenir au moins un 4 étoiles");
  assert.ok(notes.includes(3), "le mock doit contenir au moins un 3 étoiles");
  assert.ok(
    AVIS_DEMONSTRATION.some((a) => a.rating === 5 && a.text.trim().length === 0),
    "le mock doit contenir un 5 étoiles SANS texte",
  );
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

await test("7. le bandeau de démonstration est RENDU tant que la source est un mock", async () => {
  const { demonstration } = await getReviews();
  assert.equal(demonstration, true, "la Phase A est bien en démonstration");

  assert.ok(SECTION.includes("data-avis-demonstration"), "le bandeau est repérable");
  assert.ok(SECTION.includes("{demonstration ? ("), "il est conditionné au drapeau de la source");
  assert.ok(
    /Données de démonstration/.test(SECTION),
    "et il dit à l'écran, en toutes lettres, que ce sont des exemples",
  );
  assert.ok(
    /pas de vrais avis Google/i.test(SECTION),
    "le libellé doit être explicite, pas allusif",
  );
});

await test("8. le bandeau disparaîtra TOUT SEUL quand Google alimentera la section", () => {
  // ⚠️ C'EST LA GARDE QUI COMPTE. Le bandeau ne dépend d'aucune constante
  // locale qu'il faudrait penser à changer : il suit le drapeau de la source.
  // Passer `demonstration` à `false` suffit, et rien d'autre n'est à faire.
  const section = sansCommentaires(SECTION);
  assert.ok(
    !/const\s+\w*[Dd]emo\w*\s*=\s*(true|false)/.test(section),
    "aucun drapeau de démonstration codé en dur dans la section",
  );
  assert.ok(
    section.includes("demonstration") && section.includes("getReviews"),
    "le bandeau lit le drapeau que la source rend",
  );
  // Le drapeau vit à UN SEUL endroit.
  assert.ok(SOURCE.includes("demonstration: true"), "la source porte le drapeau");
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
  assert.ok(!PILE.includes("{enAvant && "), "aucun contenu conditionné à la mise en avant");
  // Et le CSS ne masque rien.
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
  assert.ok(CSS_PILE.includes("outline: 2px solid var(--color-primary)"), "et un contour visible");
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
  assert.ok(SECTION.includes("overflow-hidden"), "la section coupe son débordement");
  // Jetons sémantiques uniquement : aucune couleur brute, donc aucun risque
  // de « couleurs Google criardes ».
  const section = sansCommentaires(SECTION) + sansCommentaires(PILE);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(section), "aucune couleur hexadécimale en dur");
  assert.ok(!/\b(rgb|hsl)a?\(/.test(section), "aucune couleur brute en dur");
  // Aucun faux badge officiel : le mot « Google » suffit à nommer la source.
  assert.ok(!/logo|badge/i.test(section), "aucun badge ni logo Google reproduit");
});

await test("19. aucun débordement horizontal n'est possible par construction", () => {
  const mobile = CSS_PILE.slice(CSS_PILE.indexOf("@media (max-width: 767px)"));
  assert.ok(mobile.includes("grid-auto-flow: row"), "empilement vertical sous 768 px");
  assert.ok(mobile.includes("width: 100%"), "les cartes ne dépassent pas leur colonne");
  assert.ok(mobile.includes("max-width: 100%"), "et sont bornées");
  assert.ok(!/width:\s*\d{3,}px/.test(reglesCss(CSS_PILE)), "aucune largeur fixe en pixels");
});

/* ═══════════════ 20-21. LE PÉRIMÈTRE DE LA PHASE A ═══════════════ */

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
  assert.ok(!/line-clamp/.test(CSS_PILE), "aucun line-clamp sur le texte");
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

await test("23. les données de démonstration sont identifiables SANS lire le code", () => {
  // Le fichier le dit, dès son nom et dès ses premières lignes.
  assert.ok(MOCK.includes("DONNÉES DE DÉMONSTRATION"), "l'en-tête du mock est explicite");
  // Chaque identifiant porte le préfixe : lisible dans le DOM inspecté.
  for (const item of AVIS_DEMONSTRATION) {
    assert.ok(item.id.startsWith("demo-"), `${item.id} doit porter le préfixe de démonstration`);
    assert.ok(
      item.authorName.startsWith("Exemple"),
      `« ${item.authorName} » doit s'annoncer comme un exemple`,
    );
    // L'avis volontairement SANS TEXTE est exempté : c'est précisément son
    // absence de texte qui en fait un cas d'essai, et y écrire quoi que ce
    // soit le rendrait publiable.
    if (item.text.trim().length > 0) {
      assert.ok(/démonstration/i.test(item.text), `le texte de ${item.id} doit se dire de démonstration`);
    }
  }
  // ⚠️ AUCUNE PHOTO NI URL FABRIQUÉE : donner un visage réel ou un lien à un
  // témoignage inventé serait exactement ce qu'on cherche à éviter.
  for (const item of AVIS_DEMONSTRATION) {
    assert.equal(item.authorPhoto, null, `${item.id} ne doit pas porter de photo`);
    assert.equal(item.googleUrl, null, `${item.id} ne doit pas porter d'URL`);
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
