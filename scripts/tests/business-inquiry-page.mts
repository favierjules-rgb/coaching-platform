/**
 * Harnais — page « GRIT Entreprise » : RENDU des composants.
 *
 * Refonte du 13/09/2026 : le formulaire progressif a laissé place au
 * CONFIGURATEUR en sept étapes. Les garanties contrôlées ici n'ont pas
 * changé de nature — sections présentes, une seule étape montée à la fois,
 * aucun secret côté client, responsive, accessibilité, verrou de double
 * soumission, SEO — seules leurs cibles ont suivi la refonte.
 *
 * Monté avec react-dom/server, donc SANS la condition `react-server` — la
 * logique serveur (envoi d'email, qui importe `server-only`) est couverte
 * par scripts/tests/business-inquiry-email.mts. Aucun email ne peut partir
 * d'ici : ce fichier n'importe aucune fonction d'envoi.
 *
 * Lancement : npx tsx scripts/tests/business-inquiry-page.mts
 */
process.env.TZ = "Europe/Paris";
process.env.EMAILS_ENABLED = "false";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerenderToNodeStream } from "react-dom/static";

import { EntrepriseConfigurateur } from "../../components/sections/EntrepriseConfigurateur";
import { Header } from "../../components/layout/Header";
import { Footer } from "../../components/layout/Footer";
import * as servicesPageModule from "../../app/services-entreprises/page";

/**
 * `tsx` renvoie parfois l'espace de noms CJS complet pour un module qui
 * combine `export default` et `export const` — le composant se retrouve
 * alors sous `default.default`. Artefact de l'exécution hors bundler :
 * Next.js résout l'export normalement. On déballe ici pour rendre la vraie
 * page.
 */
function resolveDefaultExport<T>(module: unknown): T {
  const candidate = (module as { default?: unknown }).default;
  if (typeof candidate === "function") return candidate as T;
  const nested = (candidate as { default?: unknown } | undefined)?.default;
  if (typeof nested === "function") return nested as T;
  throw new Error("Export par défaut introuvable");
}

const ServicesEntreprisesPage = resolveDefaultExport<() => ReactElement>(servicesPageModule);
const metadata =
  servicesPageModule.metadata ??
  ((servicesPageModule.default as unknown as { metadata: typeof servicesPageModule.metadata }).metadata);

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${name}`);
    console.error(error);
  }
}

/**
 * ⚠️ LA PAGE CONTIENT DÉSORMAIS UN COMPOSANT SERVEUR ASYNCHRONE, et
 * `renderToStaticMarkup` ne sait pas l'attendre.
 *
 * Depuis le 16/09/2026, la page monte `<GoogleReviews />`, qui appelle
 * `getReviews()`. Le moteur SYNCHRONE de `react-dom/server` jetait alors
 * « A component suspended while responding to synchronous input » : ce
 * n'était pas un défaut de la page, mais la limite du moteur de rendu.
 *
 * `prerenderToNodeStream` (react-dom/static, React 19) attend les composants
 * asynchrones et rend le HTML complet — exactement ce que fait Next.js. Les
 * autres rendus du fichier restent synchrones : ils portent sur des
 * composants client, qui n'ont rien à attendre.
 */
async function rendreAsynchrone(element: ReactElement): Promise<string> {
  const { prelude } = await prerenderToNodeStream(element);
  let html = "";
  for await (const morceau of prelude) html += morceau as string;
  return html;
}

const flowHtml = renderToStaticMarkup(createElement(EntrepriseConfigurateur));
const pageHtml = await rendreAsynchrone(createElement(ServicesEntreprisesPage));
const headerHtml = renderToStaticMarkup(createElement(Header));
const footerHtml = renderToStaticMarkup(createElement(Footer));

test("1. le lien vit dans le burger ET dans le footer, hors navigation légale", () => {
  const headerSource = readFileSync(new URL("../../components/layout/Header.tsx", import.meta.url), "utf8");
  const footerSource = readFileSync(new URL("../../components/layout/Footer.tsx", import.meta.url), "utf8");
  const mockSource = readFileSync(new URL("../../data/mock.ts", import.meta.url), "utf8");

  // Absent du menu fermé (rendu serveur) : il n'apparaît qu'une fois ouvert.
  assert.ok(!headerHtml.includes("/services-entreprises"), "menu fermé : aucun lien visible");
  assert.ok(!mockSource.includes("services-entreprises"), "navLinks : aucune entrée dans la nav principale");

  // Présent dans le code du burger, via la liste dédiée.
  assert.ok(headerSource.includes("burgerOnlyLinks"), "liste dédiée aux liens du burger");
  assert.ok(
    headerSource.includes('{ label: "Services aux entreprises", href: "/services-entreprises" }'),
    "libellé exact attendu dans le Header",
  );

  /*
   * ⚠️ LE FOOTER PORTE LE LIEN DEPUIS LE 13/09/2026, MAIS PAS N'IMPORTE OÙ.
   *
   * Ce contrôle disait l'inverse — « footer : aucun lien » — tant que la
   * page n'était accessible que par le burger. Elle est désormais aussi
   * atteignable depuis le footer, à une condition que ce test verrouille :
   * le lien est COMMERCIAL, il ne doit donc pas rejoindre la navigation
   * `aria-label="Liens légaux"`, qui a été volontairement ramenée à quatre
   * entrées juridiques en juillet 2026. Un lien commercial annoncé comme
   * « légal » serait un mensonge pour les lecteurs d'écran.
   */
  assert.ok(footerHtml.includes("/services-entreprises"), "footer : le lien entreprise est présent");
  assert.ok(footerSource.includes('aria-label="Entreprises"'), "le lien vit dans sa propre nav nommée");

  // Les quatre liens juridiques restent exactement ce qu'ils étaient.
  for (const href of ["/informations-legales", "/confidentialite", "/cookies", "/profil"]) {
    assert.ok(footerHtml.includes(href), `lien juridique manquant : ${href}`);
  }
  const navLegale = footerHtml.slice(footerHtml.indexOf('aria-label="Liens légaux"'));
  assert.ok(
    !navLegale.includes("/services-entreprises"),
    "le lien commercial s'est glissé dans la navigation légale",
  );
});

test("1bis. le burger est disponible sur mobile ET desktop, la nav horizontale reste intacte", () => {
  const headerSource = readFileSync(new URL("../../components/layout/Header.tsx", import.meta.url), "utf8");
  // Le bouton burger n'est plus restreint à `lg:hidden`.
  const burgerButton = headerSource.slice(headerSource.indexOf("aria-controls=\"menu-burger\"") - 600);
  assert.ok(!/className="[^"]*lg:hidden[^"]*"[\s\S]{0,200}aria-controls="menu-burger"/.test(headerSource),
    "le bouton burger ne doit pas être masqué en desktop");
  assert.ok(burgerButton.includes("aria-expanded"), "état d'ouverture exposé");
  // La nav horizontale desktop existe toujours.
  assert.ok(headerSource.includes('className="mt-5 hidden items-center gap-8 lg:flex"'), "nav desktop inchangée");
  assert.ok(headerHtml.includes("La méthode") && headerHtml.includes("Connexion"), "liens existants préservés");
});

test("1ter. le bouton « En savoir plus sur la méthode » a été retiré du header", () => {
  // Retiré en juillet 2026 : doublon encombrant de l'entrée « La méthode »
  // de la navigation, sur toutes les pages publiques (header partagé).
  const headerSource = readFileSync(new URL("../../components/layout/Header.tsx", import.meta.url), "utf8");
  assert.ok(!headerSource.includes("En savoir plus sur la méthode"), "libellé absent du composant");
  assert.ok(!headerHtml.includes("En savoir plus sur la méthode"), "libellé absent du rendu");
  // L'accès à la section « méthode » reste assuré par la navigation.
  assert.ok(headerHtml.includes('href="/#methode"'), "ancre /#methode toujours atteignable");
  // « Connexion » reste la seule action mise en avant.
  assert.equal(
    (headerHtml.match(/Connexion/g) ?? []).length,
    1,
    "une seule action visible dans la barre (menu fermé)",
  );
});

/* ─── 2-3. Sections et sept questions ─── */

test("2. la page contient toutes les sections attendues", () => {
  for (const attendu of [
    "GRIT Entreprise",
    "Comment ça marche",
    "Ce que vous obtenez",
    "Pour vos collaborateurs",
    "Votre formule",
    "Demande de devis",
    "Construisons votre programme",
  ]) {
    assert.ok(pageHtml.includes(attendu), `section manquante : « ${attendu} »`);
  }
  assert.ok(pageHtml.includes('id="devis"'), "ancre du configurateur présente");
  assert.ok(pageHtml.includes('href="#devis"'), "le hero défile vers le configurateur");
  assert.ok(pageHtml.includes('id="programme"'), "ancre du programme présente");
  // Un H1 unique, la structure de titres reste exploitable pour le SEO.
  assert.equal((pageHtml.match(/<h1/g) ?? []).length, 1, "un seul H1");
  assert.ok((pageHtml.match(/<h2/g) ?? []).length >= 4, "les sections portent des H2");
});

test("3. à l'ouverture, SEULE la première étape est montée", () => {
  // Les étapes suivantes ne sont pas seulement masquées : elles n'existent
  // pas dans le DOM — ni tabulables, ni lues par un lecteur d'écran.
  const texte = flowHtml.replace(/<[^>]+>/g, " ");
  assert.ok(texte.includes("Combien de collaborateurs"), "étape 1 présente");
  for (const suivante of [
    "À quelle fréquence",
    "Quel est votre objectif principal",
    "Quel est votre secteur",
    "Quand souhaitez-vous lancer",
    "Parlez-nous de votre projet",
    "Parlons de votre projet",
  ]) {
    assert.ok(!texte.includes(suivante), `« ${suivante} » ne doit pas être montée d'emblée`);
  }
  // Le repère de progression remplace la vue d'ensemble.
  assert.ok(/Étape\s*1\s*sur\s*7/.test(texte), "compteur « Étape 1 sur 7 »");
  // Ni consentement, ni coordonnées, ni bouton d'envoi avant la fin.
  assert.ok(!flowHtml.includes("ec-privacy"), "consentement réservé à la dernière étape");
  assert.ok(!flowHtml.includes("ec-email"), "coordonnées réservées à la dernière étape");
  assert.ok(!flowHtml.includes('type="submit"'), "bouton d'envoi réservé à la dernière étape");
});

test("3bis. les sept étapes sont déclarées dans l'ordre, et l'identité vient en DERNIER", () => {
  const source = readFileSync(
    new URL("../../components/sections/EntrepriseConfigurateur.tsx", import.meta.url),
    "utf8",
  );
  /*
   * ⚠️ L'ORDRE EST LE CŒUR DE LA REFONTE, PAS UN DÉTAIL DE PRÉSENTATION.
   * La version précédente demandait l'entreprise, le contact puis l'email
   * AVANT toute question de projet : trois écrans administratifs avant que
   * le prospect ait rien construit. Les cinq premières étapes ne réclament
   * désormais aucune donnée personnelle. Ce test échoue si l'ordre régresse.
   */
  const libelles = [
    "Combien de collaborateurs souhaitez-vous accompagner",
    "À quelle fréquence",
    "Quel est votre objectif principal",
    "Quel est votre secteur d'activité",
    "Quand souhaitez-vous lancer le programme",
    "Parlez-nous de votre projet",
    "Parlons de votre projet",
  ];
  let position = -1;
  for (const libelle of libelles) {
    const index = source.indexOf(libelle);
    assert.ok(index > position, `étape « ${libelle} » absente ou mal ordonnée`);
    position = index;
  }

  // Aucun champ d'identité avant l'étape de contact.
  const avantContact = source.slice(0, source.indexOf("step === CONTACT_STEP"));
  for (const champ of ["ec-email", "ec-companyName", "ec-contactName", "ec-phone"]) {
    assert.ok(!avantContact.includes(champ), `${champ} apparaît avant l'étape de contact`);
  }

  // La liste des champs par étape vient du schéma, jamais d'une copie locale.
  assert.ok(source.includes("STEP_FIELDS[cible - 1]"), "les champs d'étape sont lus dans le schéma");
});

/* ─── 4-9. Validation ─── */

test("17. aucun email réel ne peut partir depuis les tests", () => {
  assert.equal(process.env.EMAILS_ENABLED, "false", "coupe-circuit global posé");
  assert.equal(process.env.RESEND_API_KEY, undefined, "aucune clé Resend dans l'environnement de test");
  // La route serveur n'expose ni clé ni destinataire au navigateur.
  const formSource = readFileSync(new URL("../../components/sections/EntrepriseConfigurateur.tsx", import.meta.url), "utf8");
  assert.ok(!formSource.includes("RESEND"), "le composant client ne référence aucune clé");
  assert.ok(!formSource.includes("B2B_CONTACT_RECIPIENT_EMAIL"), "le composant client ignore le destinataire");
  assert.ok(!formSource.includes("@gmail.com"), "aucune adresse en dur dans le composant");
  assert.ok(formSource.includes('fetch("/api/business-inquiry"'), "l'envoi passe par la route serveur");
});

/* ─── 18-19. Responsive et accessibilité ─── */

test("18. responsive : aucune largeur fixe, grilles adaptatives, cibles tactiles ≥ 44px", () => {
  assert.ok(!/w-\[\d{3,}px\]/.test(pageHtml), "aucune largeur fixe en pixels");
  assert.ok(pageHtml.includes("max-w-7xl") && pageHtml.includes("px-6"), "colonne centrée avec marges latérales");
  assert.ok(pageHtml.includes("sm:grid-cols-2") && pageHtml.includes("lg:grid-cols-3"), "grilles responsives");
  assert.ok(/text-3xl[^"]*sm:text-4xl[^"]*md:text-6xl/.test(pageHtml), "titre progressif mobile → desktop");
  assert.ok(!/style="[^"]*width:\s*\d+px/.test(pageHtml), "aucune largeur inline en pixels");

  /*
   * ⚠️ LES CARTES DE CHOIX SONT LA CIBLE TACTILE CRITIQUE. Tout le
   * configurateur se remplit au doigt : une carte trop courte, et le
   * parcours devient pénible là où il doit être rapide. 64 px, soit
   * nettement au-dessus du minimum de 44 px.
   */
  assert.ok(flowHtml.includes("min-h-[64px]"), "cartes de choix confortables au doigt");

  const source = readFileSync(
    new URL("../../components/sections/EntrepriseConfigurateur.tsx", import.meta.url),
    "utf8",
  );
  const stepFlow = readFileSync(new URL("../../components/ui/StepFlow.tsx", import.meta.url), "utf8");
  // Boutons de navigation et d'envoi : montés plus tard, contrôlés en source.
  assert.ok(stepFlow.includes("min-h-[48px]"), "boutons de navigation confortables");
  assert.ok(source.includes("min-h-[52px]"), "bouton d'envoi confortable");
  // Une seule colonne sur mobile pour les cartes de choix.
  assert.ok(stepFlow.includes("grid-cols-1"), "cartes empilées sur mobile");
});

test("19. accessibilité : labels, groupes, erreurs reliées, clavier", () => {
  const source = readFileSync(
    new URL("../../components/sections/EntrepriseConfigurateur.tsx", import.meta.url),
    "utf8",
  );
  const stepFlow = readFileSync(new URL("../../components/ui/StepFlow.tsx", import.meta.url), "utf8");

  // L'étape montée est un groupe nommé par son propre titre.
  assert.ok(flowHtml.includes('role="group"'), "l'étape est un groupe");
  assert.ok(flowHtml.includes('aria-labelledby="ec-step-title"'), "groupe relié à son titre");

  /*
   * ⚠️ LES CARTES DE CHOIX SONT DE VRAIS BOUTONS, PAS DES INPUTS MASQUÉS.
   * Un input caché sous un label casse la navigation clavier sur plusieurs
   * lecteurs d'écran. Ici chaque carte est un <button> portant son rôle et
   * son état cochés explicitement.
   */
  assert.ok(/role="radio"/.test(flowHtml), "choix unique exposé comme radio");
  assert.ok(/aria-checked/.test(flowHtml), "état de sélection exposé");
  assert.ok(stepFlow.includes('role={multiple ? "checkbox" : "radio"}'), "choix multiple exposé comme checkbox");

  /*
   * Champs de la dernière étape : montés plus tard, contrôlés en source.
   * ⚠️ LES IDENTIFIANTS SONT COMPOSÉS (`ec-${id}`), pas écrits en clair :
   * on cherche donc le NOM du champ tel qu'il est passé au composant, pas
   * la chaîne assemblée qui n'existe qu'à l'exécution.
   */
  for (const id of ["companyName", "contactName", "contactRole", "email", "phone"]) {
    assert.ok(source.includes(`id="${id}"`), `champ ${id} absent de l'étape de contact`);
  }
  for (const id of ["ec-city", "ec-projectDetails", "ec-privacy"]) {
    assert.ok(source.includes(id), `champ ${id} absent`);
  }
  assert.ok(source.includes("htmlFor={`ec-${id}`}"), "chaque champ texte porte un label associé");
  assert.ok(source.includes("aria-invalid"), "état d'erreur exposé aux technologies d'assistance");
  assert.ok(source.includes("aria-describedby"), "erreurs reliées à leur champ");
  assert.ok(source.includes("<legend"), "le groupe de lieu porte une légende");

  // Honeypot : hors tabulation et masqué aux lecteurs d'écran.
  assert.ok(/aria-hidden[\s\S]{0,200}ec-website/.test(source), "honeypot masqué aux lecteurs d'écran");
  assert.ok(source.includes("tabIndex={-1}"), "honeypot hors ordre de tabulation");

  // Consentement obligatoire avec lien vers la politique.
  assert.ok(source.includes("/confidentialite"), "lien vers la politique de confidentialité");
  assert.ok(source.includes('type="submit"'), "bouton de soumission natif");
  assert.ok(source.includes('disabled={status === "sending"}'), "bouton désactivé pendant l'envoi");
  assert.ok(source.includes('aria-live="polite"'), "progression et résultat annoncés");
  assert.ok(
    source.includes('if (sendingRef.current || status === "sending") return;'),
    "double soumission bloquée côté client",
  );

  /*
   * ⚠️ LE FOCUS SE DÉPLACE ICI, CONTRAIREMENT AU DÉVOILEMENT VERTICAL.
   * Sur le formulaire progressif, déplacer le focus aurait coupé la frappe
   * (les questions apparaissent pendant la saisie). Ici le changement
   * d'étape est toujours provoqué par un clic délibéré : ne pas suivre le
   * focus laisserait un utilisateur clavier au bas de l'écran précédent.
   */
  assert.ok(source.includes("focusStepTitle"), "le focus suit le changement d'étape");
  assert.ok(stepFlow.includes("tabIndex={-1}"), "le titre d'étape est focusable par programme");
});

test("20. double clic : le verrou d'envoi est SYNCHRONE, pas dépendant du re-rendu", () => {
  // Régression observée en validation live : deux clics dans le même tick
  // lisaient `status` avant le re-rendu de React, et deux requêtes POST
  // partaient. Le serveur les neutralisait (garde anti-rejeu), mais la
  // seconde requête ne devait pas être émise du tout.
  const source = readFileSync(
    new URL("../../components/sections/EntrepriseConfigurateur.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("const sendingRef = useRef(false)"), "verrou synchrone déclaré");
  assert.ok(source.includes("sendingRef.current || status"), "verrou consulté avant toute soumission");
  // Posé AVANT le fetch…
  const posePosition = source.indexOf("sendingRef.current = true");
  const fetchPosition = source.indexOf('fetch("/api/business-inquiry"');
  assert.ok(posePosition > 0 && posePosition < fetchPosition, "verrou posé avant l'appel réseau");
  // …et relâché quoi qu'il arrive, pour qu'un échec reste réessayable.
  assert.ok(/finally \{[\s\S]{0,200}sendingRef\.current = false/.test(source), "verrou relâché dans un finally");
});

/* ─── Thème clair et visuel d'en-tête ─── */

test("T1. la page s'ouvre en SOMBRE, et le choix clair est porté par le conteneur", () => {
  const source = readFileSync(new URL("../../app/services-entreprises/page.tsx", import.meta.url), "utf8");
  /*
   * ⚠️ SOMBRE PAR DÉFAUT, ET PORTÉ PAR LE CONTENEUR — JAMAIS PAR <html>.
   * Écrire le thème sur la racine ferait déborder le choix sur l'admin et
   * l'espace élève, qui ont leur propre mécanisme. Le conteneur isole.
   */
  assert.ok(pageHtml.includes('data-page-theme="dark"'), "rendu serveur en thème sombre");
  assert.ok(pageHtml.includes('id="entreprise"'), "conteneur identifié");
  assert.ok(source.includes("suppressHydrationWarning"), "l'attribut peut être changé avant hydratation");

  const switchSource = readFileSync(new URL("../../components/ui/PageThemeSwitch.tsx", import.meta.url), "utf8");
  assert.ok(!/documentElement/.test(switchSource), "le switch ne touche jamais <html>");
  assert.ok(/getElementById\(config\.containerId\)/.test(switchSource), "le switch cible le conteneur reçu");
});

test("T2. la clé de stockage est DISTINCTE de la home et de l'admin", () => {
  const source = readFileSync(new URL("../../app/services-entreprises/page.tsx", import.meta.url), "utf8");
  /*
   * Trois mécanismes de thème coexistent sur le site. Une clé partagée ferait
   * qu'éclaircir cette page éclaircirait la home — ou l'admin.
   */
  assert.ok(source.includes('storageKey: "seth-entreprise-theme"'), "clé propre à cette page");
  assert.ok(!source.includes('"seth-home-theme"'), "clé de la home non réutilisée");
  assert.ok(!source.includes('"seth-theme"'), "clé de l'admin non réutilisée");
});

test("T3. le choix est appliqué AVANT la première peinture", () => {
  const source = readFileSync(new URL("../../app/services-entreprises/page.tsx", import.meta.url), "utf8");
  const switchSource = readFileSync(new URL("../../components/ui/PageThemeSwitch.tsx", import.meta.url), "utf8");

  // Script bloquant, inséré comme premier enfant du conteneur.
  assert.ok(source.includes("pageThemeAntiFlashScript(THEME_ENTREPRISE)"), "script anti-flash monté");
  /*
   * ⚠️ ON CHERCHE L'APPEL, PAS LE NOM. `pageThemeAntiFlashScript` apparaît
   * aussi dans la ligne d'import, tout en haut du fichier : chercher le nom
   * seul faisait échouer ce contrôle sur une occurrence qui n'a rien à voir
   * avec la position du script dans le rendu.
   */
  const posConteneur = source.indexOf('id="entreprise"');
  const posScript = source.indexOf("pageThemeAntiFlashScript(THEME_ENTREPRISE)");
  const posSection = source.indexOf("<section");
  assert.ok(
    posConteneur < posScript && posScript < posSection,
    "le script doit précéder tout contenu peint",
  );
  /*
   * ⚠️ LE SCRIPT A CHANGÉ DE FICHIER, PAS DE GARANTIE. Il vit désormais dans
   * `lib/theme/page-theme.ts` (module neutre), parce qu'une fonction appelée
   * par le serveur ne peut pas venir d'un module « use client » — voir T8.
   * L'invariant contrôlé ici est le même : stockage indisponible
   * (navigation privée stricte) = sombre, sans planter.
   */
  const scriptSource = readFileSync(new URL("../../lib/theme/page-theme.ts", import.meta.url), "utf8");
  // Les DEUX moitiés : un `catch` orphelin passerait un contrôle qui ne
  // vérifierait que lui, et le script planterait au premier stockage refusé.
  assert.ok(/return\s+`try\{/.test(scriptSource), "le script ouvre bien un try");
  assert.ok(/catch\s*\(_\)\s*\{\}/.test(scriptSource), "script anti-flash sous try/catch");
  assert.ok(switchSource.includes("useSyncExternalStore"), "pas de setState dans un effet");
});

test("T4. la palette claire est partagée, jamais dupliquée", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const selecteur = css.slice(css.indexOf(".light,"), css.indexOf("--background: #f4f4f2"));
  assert.ok(selecteur.includes('[data-page-theme="light"]'), "la page rejoint la palette claire existante");
  // Une seconde déclaration des mêmes tokens signifierait deux palettes à maintenir.
  assert.equal(
    (css.match(/--background:\s*#f4f4f2/g) ?? []).length,
    1,
    "les valeurs claires ne sont déclarées qu'une fois",
  );
});

test("T5. la photo d'en-tête est DÉCORATIVE et ne retarde pas l'affichage", () => {
  const brut = readFileSync(new URL("../../app/services-entreprises/page.tsx", import.meta.url), "utf8");
  /*
   * ⚠️ ON LIT LE CODE, PAS LES COMMENTAIRES. Une première version de ce test
   * cherchait « priority » dans le fichier entier : le mot figurait aussi
   * dans le commentaire qui explique pourquoi l'attribut est là, si bien que
   * retirer l'attribut laissait le test vert. Il mesurait sa propre prose.
   */
  const source = brut
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
  assert.ok(
    source.includes('src="/brand/backgrounds/entreprise.webp"'),
    "image d'en-tête propre à la page entreprise",
  );
  /*
   * ⚠️ L'IMAGE EST UN PORTRAIT (1400×2096). Étalée en bandeau, le sujet serait
   * coupé ET le texte reposerait dessus, avec un contraste qui varierait d'un
   * pixel à l'autre. Elle occupe donc la moitié droite sur écran large, le
   * texte vivant sur une surface pleine : la lisibilité ne dépend d'aucune
   * zone de la photo.
   */
  assert.ok(source.includes('sizes="(min-width: 768px) 60vw, 100vw"'), "dimensionnement adapté aux deux colonnes");
  /*
   * ⚠️ DÉCORATIVE : `alt=""` ET `aria-hidden`. Elle n'apporte rien que le
   * texte ne dise déjà ; la décrire ferait perdre du temps à un lecteur
   * d'écran. Et `priority` parce que c'est l'image du LCP — en chargement
   * paresseux, elle retarderait l'affichage perçu du hero.
   */
  assert.ok(/alt=""/.test(source), "image sans texte alternatif (décorative)");
  assert.ok(source.includes("aria-hidden"), "couche d'image masquée aux lecteurs d'écran");
  assert.ok(source.includes("priority"), "image du LCP chargée en priorité");
  // Le contenu passe au-dessus du fond, sinon il serait recouvert.
  assert.ok(source.includes("relative z-10"), "contenu du hero au-dessus de l'image");
  assert.ok(source.includes("overflow-hidden"), "l'image ne déborde pas de la section");
});

test("T6. AUCUNE surface n'est codée en dur : tout suit le thème", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/services-entreprises/page.tsx", import.meta.url), "utf8");
  const flow = readFileSync(new URL("../../components/ui/StepFlow.tsx", import.meta.url), "utf8");
  const conf = readFileSync(
    new URL("../../components/sections/EntrepriseConfigurateur.tsx", import.meta.url),
    "utf8",
  );

  /*
   * ⚠️ LE DÉFAUT EXACT QUI A ÉTÉ CONSTATÉ À L'ÉCRAN, ET QUE CE TEST INTERDIT.
   *
   * Les sections alternées utilisaient `bg-black` — un noir absolu, pas un
   * token. En thème clair, `--foreground` passe en quasi-noir : les titres
   * devenaient invisibles, noir sur noir. L'en-tête de globals.css l'écrit
   * pourtant depuis longtemps : « aucun composant ne doit coder une couleur
   * de surface en dur (bg-black, bg-white, bg-zinc-*…) ».
   */
  for (const [nom, code] of [["page", page], ["StepFlow", flow], ["configurateur", conf]] as const) {
    for (const motif of [/\bbg-black\b/, /\bbg-white\b/, /\bbg-zinc-/, /\btext-black\b/, /\btext-white\b/]) {
      assert.ok(!motif.test(code), `${nom} : couleur de surface codée en dur (${motif})`);
    }
    assert.ok(!/rgba\(0,\s*0,\s*0/.test(code), `${nom} : noir littéral dans un dégradé`);
  }

  // Le conteneur porte sa propre surface ET sa couleur de texte : une section
  // sans fond déclaré hérite d'un couple cohérent, jamais d'un mélange.
  /*
   * ⚠️ LE BLOC EST BORNÉ À SA PROPRE ACCOLADE FERMANTE. Une première version
   * découpait « du sélecteur jusqu'à la fin du fichier » : la déclaration
   * cherchée était alors trouvée dans un AUTRE sélecteur plus bas, et retirer
   * la vraie ligne laissait le test vert.
   */
  const debutBloc = css.lastIndexOf("[data-page-theme] {");
  const bloc = css.slice(debutBloc, css.indexOf("}", debutBloc));
  assert.ok(/background:\s*var\(--background\)/.test(bloc), "le conteneur pose sa surface");
  assert.ok(/color:\s*var\(--foreground\)/.test(bloc), "le conteneur pose sa couleur de texte");

  // Le fondu de la photo est paramétré, avec une valeur propre au thème clair.
  assert.ok(css.includes("--hero-fondu-plein"), "fondu paramétré par token");
  const clair = css.slice(css.indexOf('[data-page-theme="light"] {'));
  assert.ok(/--hero-fondu-vide:\s*rgba\(244/.test(clair), "le fondu a une valeur claire");
  assert.ok(page.includes("hero-fondu"), "le fondu est appliqué au hero");
});

test("T6bis. contraste AA garanti dans les DEUX thèmes", () => {
  /*
   * Les ratios sont CALCULÉS depuis les tokens réels du fichier CSS, pas
   * recopiés : si une valeur de palette change, ce test la reteste.
   */
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const valeur = (bloc: string, nom: string): string => {
    const m = new RegExp(`${nom}:\\s*(#[0-9a-fA-F]{6})`).exec(bloc);
    assert.ok(m, `token ${nom} introuvable`);
    return m![1];
  };
  const luminance = (hex: string): number => {
    const c = (hex.match(/\w\w/g) ?? []).map((h) => parseInt(h, 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string): number => {
    const [haut, bas] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (haut + 0.05) / (bas + 0.05);
  };

  const sombre = css.slice(css.indexOf(":root {"), css.indexOf(".light,"));
  const clair = css.slice(css.indexOf(".light,"), css.indexOf("--hero-fondu"));

  for (const [nom, bloc] of [["sombre", sombre], ["clair", clair]] as const) {
    const fond = valeur(bloc, "--background");
    const surface = valeur(bloc, "--surface");
    const carte = valeur(bloc, "--card");
    const texte = valeur(bloc, "--foreground");
    const doux = valeur(bloc, "--muted-foreground");

    for (const [libelle, fg, bg] of [
      ["titre sur fond", texte, fond],
      ["titre sur surface", texte, surface],
      ["titre sur carte", texte, carte],
      ["texte doux sur fond", doux, fond],
      ["texte doux sur surface", doux, surface],
      ["texte doux sur carte", doux, carte],
    ] as const) {
      const r = ratio(fg, bg);
      assert.ok(r >= 4.5, `thème ${nom} — ${libelle} : contraste ${r.toFixed(2)}, en dessous de AA (4.5)`);
    }
  }
});

test("T7. le switch est un vrai bouton accessible, à cible tactile suffisante", () => {
  const switchSource = readFileSync(new URL("../../components/ui/PageThemeSwitch.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.ok(/<button[\s\S]{0,200}type="button"/.test(switchSource), "un <button>, pas une div cliquable");
  assert.ok(/aria-label=\{versClair \? "Activer le thème clair"/.test(switchSource), "aria-label explicite");
  assert.ok(switchSource.includes("aria-pressed"), "état courant annoncé");
  const cssSwitch = css.slice(css.indexOf(".page-theme-switch"));
  assert.ok(/width: 2\.75rem/.test(cssSwitch) && /height: 2\.75rem/.test(cssSwitch), "cible tactile de 44px");
  assert.ok(/env\(safe-area-inset-right\)/.test(cssSwitch), "safe area iPhone respectée");
  assert.ok(/prefers-reduced-motion[\s\S]{0,300}\.page-theme-switch/.test(css), "animation neutralisée si demandé");
});

test("T8. AUCUNE fonction d'un module « use client » n'est appelée depuis la page serveur", () => {
  /*
   * ⚠️ LE DÉFAUT QUE CE TEST INTERDIT, ET QUI A CASSÉ UN DÉPLOIEMENT.
   *
   * `"use client"` ne qualifie pas un composant : il qualifie LE MODULE.
   * Chacun de ses exports devient une référence client — un proxy
   * sérialisable, pas le vrai code. Un composant JSX s'en accommode : la
   * page pose un marqueur, le client hydrate. Une FONCTION, non : l'appeler
   * pendant le rendu serveur lève
   *
   *     Attempted to call X() from the server but X is on the client.
   *
   * Constaté au prerender de /services-entreprises (Vercel, 1efdde2), sur
   * `pageThemeAntiFlashScript` — une fonction qui n'avait pourtant rien de
   * client, rangée dans un module client par simple proximité de sujet.
   *
   * Ce contrôle est GÉNÉRIQUE : il suit tous les imports relatifs de la
   * page, ouvre chaque module, et refuse qu'un symbole venu d'un module
   * « use client » soit appelé. Il ne connaît aucun nom en particulier,
   * donc il attrapera le prochain cas, pas seulement celui-ci.
   */
  const pageUrl = new URL("../../app/services-entreprises/page.tsx", import.meta.url);
  const brut = readFileSync(pageUrl, "utf8");
  const corps = brut
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

  assert.ok(!/^\s*["']use client["']/.test(brut), "la page doit rester un Server Component");

  /** Résout un alias `@/…` ou un chemin relatif vers un fichier réel. */
  function resoudre(spec: string): URL | null {
    const base = spec.startsWith("@/")
      ? new URL(`../../${spec.slice(2)}`, import.meta.url)
      : spec.startsWith(".")
        ? new URL(spec, pageUrl)
        : null;
    if (!base) return null; // paquet externe : hors de notre contrôle
    for (const suffixe of [".tsx", ".ts", "/index.tsx", "/index.ts", ""]) {
      const candidat = new URL(base.href + suffixe);
      try {
        readFileSync(candidat, "utf8");
        return candidat;
      } catch {
        // suffixe suivant
      }
    }
    return null;
  }

  const imports = [...corps.matchAll(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g)];
  assert.ok(imports.length > 0, "aucun import détecté : le test ne mesure rien");

  let modulesClientVus = 0;
  for (const [, clause, spec] of imports) {
    const cible = resoudre(spec);
    if (!cible) continue;
    const source = readFileSync(cible, "utf8");
    if (!/^\s*["']use client["']/.test(source)) continue;
    modulesClientVus += 1;

    // Symboles importés de ce module client, hors imports de type (effacés).
    const symboles = clause
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("type "))
      .map((s) => (s.includes(" as ") ? s.split(" as ")[1].trim() : s));

    for (const symbole of symboles) {
      const appel = new RegExp(`(?<![.\\w])${symbole}\\s*\\(`);
      assert.ok(
        !appel.test(corps),
        `« ${symbole} » vient du module client ${spec} et est APPELÉ depuis la page serveur — ` +
          `le prerender échouera. Déplacer cette fonction dans un module sans directive.`,
      );
    }
  }

  assert.ok(
    modulesClientVus > 0,
    "aucun module client parmi les imports : ce contrôle ne prouverait rien",
  );
});

test("T9. le script anti-flash vient d'un module NEUTRE, appelable côté serveur", () => {
  const neutre = readFileSync(new URL("../../lib/theme/page-theme.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../../components/ui/PageThemeSwitch.tsx", import.meta.url), "utf8");

  // Le module neutre ne porte aucune directive : les deux côtés peuvent l'utiliser.
  assert.ok(!/^\s*["']use client["']/.test(neutre), "le module du script ne doit pas être client");
  assert.ok(!/^\s*["']server-only["']/.test(neutre), "ni réservé au serveur : le client en lit l'attribut");
  assert.ok(neutre.includes("export function pageThemeAntiFlashScript"), "le script est produit ici");

  // Le module client, lui, n'expose QUE le composant.
  assert.ok(/^\s*["']use client["']/.test(client), "le switch reste un composant client");
  const exportsClient = [...client.matchAll(/^export\s+(?:function|const|class)\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exportsClient, ["PageThemeSwitch"], "le module client n'exporte que son composant");

  /*
   * ⚠️ ET AUCUN RE-EXPORT NON PLUS. `export { x } from "…"` ne ressemble pas
   * à une déclaration et échappait au contrôle ci-dessus — or il rouvre
   * exactement la même porte : le symbole redevient une référence client,
   * prête à être appelée par erreur depuis le serveur. Seuls les exports de
   * TYPE sont tolérés, puisqu'ils disparaissent à la compilation.
   */
  const reExports = [...client.matchAll(/^export\s+(?!type\b)\{[^}]*\}\s+from\s+["'][^"']+["']/gm)];
  assert.deepEqual(
    reExports.map((m) => m[0]),
    [],
    "le module client ne doit rien ré-exporter : un re-export redevient une référence client",
  );
});

/* ─── SEO ─── */

test("AVIS : la section est RÉELLEMENT montée sur la page entreprise", () => {
  /*
   * ⚠️ RIEN NE VERROUILLAIT CE MONTAGE, et c'est précisément pour ça que ce
   * test existe. La section a été ajoutée à la page le 16/09/2026 ; jusqu'ici
   * on pouvait la retirer de `/services-entreprises` sans qu'un seul test
   * rougisse — le harnais montait bien la page entière, mais ne regardait
   * jamais si les avis y étaient.
   *
   * On mesure sur le HTML RENDU, pas sur le source : un import conservé mais
   * plus appelé passerait un contrôle textuel.
   */
  assert.ok(pageHtml.includes('id="avis-clients"'), "la section des avis est dans la page");
  assert.ok(pageHtml.includes("La confiance de nos clients"), "avec son titre");

  const cartes = (pageHtml.match(/class="avis-carte"/g) ?? []).length;
  const copies = (pageHtml.match(/class="avis-carte" aria-hidden="true"/g) ?? []).length;
  assert.ok(cartes - copies >= 9, `au moins neuf avis rendus — ${cartes - copies}`);
  assert.equal(cartes - copies, copies, "la boucle duplique exactement le même nombre de cartes");

  /*
   * ⚠️ L'ANCRE DU SECOND BOUTON EST ABSOLUE ICI, ET C'EST UN PIÈGE SILENCIEUX.
   * `#bilan-offert` vit sur l'ACCUEIL. Écrite sans le `/`, l'ancre ne pointe
   * sur rien depuis cette page : le bouton reste cliquable et ne fait
   * strictement rien — le genre de défaut qu'aucune erreur ne signale.
   */
  assert.ok(pageHtml.includes('href="/#bilan-offert"'), "« Mon bilan offert » ramène à l'accueil");
  assert.ok(
    !/href="#bilan-offert"/.test(pageHtml),
    "et jamais l'ancre relative, qui ne mènerait nulle part depuis cette page",
  );

  // Le lien Google s'ouvre à côté, sans laisser prise à window.opener.
  assert.ok(pageHtml.includes("share.google"), "« Laisser un avis » pointe vers la fiche Google");
  assert.ok(pageHtml.includes('rel="noopener noreferrer"'), "et coupe l'accès à window.opener");

  /*
   * ⚠️ LA PREUVE PRÉCÈDE LA DEMANDE. Les avis sont placés AVANT le
   * configurateur : une entreprise lit ce qu'on lui propose, puis ce que des
   * clients en disent, puis elle décrit son projet. Inverser l'ordre
   * reviendrait à demander avant d'avoir montré.
   */
  assert.ok(
    pageHtml.indexOf('id="avis-clients"') < pageHtml.indexOf('id="devis"'),
    "la section des avis vient avant le configurateur",
  );
});

test("SEO : métadonnées spécifiques, canonique, page indexable", () => {
  assert.equal(metadata.title, "Coaching sportif en entreprise | GRIT Entreprise");
  assert.ok(String(metadata.description).includes("individuel"), "la description porte la promesse centrale");
  assert.ok(String(metadata.description).includes("devis"), "la description annonce l'action attendue");
  assert.equal(metadata.alternates?.canonical, "/services-entreprises");
  assert.ok(
    !("robots" in metadata) || !JSON.stringify(metadata.robots).includes("noindex"),
    "la page doit rester indexable malgré un lien discret",
  );
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
