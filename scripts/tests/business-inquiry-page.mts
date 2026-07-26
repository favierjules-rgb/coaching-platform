/**
 * Harnais — page « Services aux entreprises » : RENDU des composants
 * (chantier feat/business-services-contact, juillet 2026).
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

import { BusinessInquiryForm } from "../../components/sections/BusinessInquiryForm";
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

const flowHtml = renderToStaticMarkup(createElement(BusinessInquiryForm));
const pageHtml = renderToStaticMarkup(createElement(ServicesEntreprisesPage));
const headerHtml = renderToStaticMarkup(createElement(Header));
const footerHtml = renderToStaticMarkup(createElement(Footer));

test("1. le lien « Services aux entreprises » n'est ni dans la nav principale ni dans le footer", () => {
  const headerSource = readFileSync(new URL("../../components/layout/Header.tsx", import.meta.url), "utf8");
  const mockSource = readFileSync(new URL("../../data/mock.ts", import.meta.url), "utf8");

  // Absent du menu fermé (rendu serveur) : il n'apparaît qu'une fois ouvert.
  assert.ok(!headerHtml.includes("/services-entreprises"), "menu fermé : aucun lien visible");
  assert.ok(!footerHtml.includes("/services-entreprises"), "footer : aucun lien");
  assert.ok(!mockSource.includes("services-entreprises"), "navLinks/footerLinks : aucune entrée");

  // Présent dans le code du burger, via la liste dédiée.
  assert.ok(headerSource.includes("burgerOnlyLinks"), "liste dédiée aux liens du burger");
  assert.ok(headerSource.includes("/services-entreprises"), "lien déclaré dans le Header");
  assert.ok(
    headerSource.includes('{ label: "Services aux entreprises", href: "/services-entreprises" }'),
    "libellé exact attendu",
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
    "Sport et performance en entreprise",
    "Parler de votre projet",
    "Besoins traités",
    "Formats possibles",
    "Fonctionnement",
    "Parlez-moi de votre projet",
  ]) {
    assert.ok(pageHtml.includes(attendu), `section manquante : « ${attendu} »`);
  }
  assert.ok(pageHtml.includes('id="demande"'), "ancre du formulaire présente");
  assert.ok(pageHtml.includes('href="#demande"'), "le bouton hero défile vers le formulaire");
});

test("3. à l'ouverture, SEULE la première question est proposée", () => {
  // Dévoilement progressif : les questions suivantes ne sont pas seulement
  // masquées, elles ne sont pas montées — ni tabulables, ni lues par un
  // lecteur d'écran.
  const numeros = flowHtml.match(/>0[1-9]</g) ?? [];
  assert.deepEqual(numeros, [">01<"], "une seule question au premier rendu");
  assert.ok(flowHtml.includes("Quel est le nom de votre entreprise"), "question 1 présente");
  for (const libelleSuivant of [
    "Qui puis-je contacter",
    "Comment puis-je vous joindre",
    "Combien de collaborateurs seraient concernés",
    "Quel est votre besoin principal",
    "sous quel format souhaitez-vous être accompagné",
    "Pouvez-vous préciser votre projet",
  ]) {
    assert.ok(!flowHtml.includes(libelleSuivant), `« ${libelleSuivant} » ne doit pas être montée d'emblée`);
  }
  // Le repère de progression compense la vue d'ensemble perdue.
  assert.ok(/Question\s*1\s*sur\s*7/.test(flowHtml.replace(/<[^>]+>/g, " ")), "compteur « Question 1 sur 7 »");
  // Ni consentement ni bouton d'envoi tant que le parcours n'est pas terminé.
  assert.ok(!flowHtml.includes("bi-privacyAccepted"), "consentement dévoilé seulement à la fin");
  assert.ok(!flowHtml.includes('type="submit"'), "bouton d'envoi dévoilé seulement à la fin");
  assert.ok(flowHtml.includes("Le bouton d&#x27;envoi apparaîtra"), "repère de fin de parcours affiché");
});

test("3bis. les sept questions restent déclarées, dans l'ordre, dans le composant", () => {
  const source = readFileSync(
    new URL("../../components/sections/BusinessInquiryForm.tsx", import.meta.url),
    "utf8",
  );
  const libelles = [
    "Quel est le nom de votre entreprise",
    "Qui puis-je contacter",
    "Comment puis-je vous joindre",
    "Combien de collaborateurs seraient concernés",
    "Quel est votre besoin principal",
    "sous quel format souhaitez-vous être accompagné",
    "Pouvez-vous préciser votre projet",
  ];
  let position = -1;
  for (const libelle of libelles) {
    const index = source.indexOf(libelle);
    assert.ok(index > position, `question « ${libelle} » absente ou mal ordonnée`);
    position = index;
  }
  assert.equal((source.match(/<QuestionBlock/g) ?? []).length, 7, "sept blocs de question");
  // Le dévoilement ne doit jamais reculer : une question atteinte le reste.
  assert.ok(source.includes("Math.max(current, atteinte)"), "dévoilement monotone");
  // Le focus n'est pas volé pendant la frappe.
  assert.ok(
    !/revealed[\s\S]{0,400}\.focus\(\)/.test(source),
    "aucun focus automatique déclenché par le dévoilement",
  );
});

/* ─── 4-9. Validation ─── */

test("17. aucun email réel ne peut partir depuis les tests", () => {
  assert.equal(process.env.EMAILS_ENABLED, "false", "coupe-circuit global posé");
  assert.equal(process.env.RESEND_API_KEY, undefined, "aucune clé Resend dans l'environnement de test");
  // La route serveur n'expose ni clé ni destinataire au navigateur.
  const formSource = readFileSync(new URL("../../components/sections/BusinessInquiryForm.tsx", import.meta.url), "utf8");
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
  assert.ok(flowHtml.includes("min-h-[44px]"), "champs à hauteur tactile suffisante");
  assert.ok(!/style="[^"]*width:\s*\d+px/.test(pageHtml), "aucune largeur inline en pixels");
  const source = readFileSync(
    new URL("../../components/sections/BusinessInquiryForm.tsx", import.meta.url),
    "utf8",
  );
  // Le bouton d'envoi n'est monté qu'en fin de parcours : on le contrôle
  // dans la source, son rendu réel étant couvert par la validation live.
  assert.ok(source.includes("min-h-[52px]"), "bouton d'envoi confortable");
});

test("19. accessibilité : labels, groupes, erreurs reliées, clavier", () => {
  const formSourceA11y = readFileSync(
    new URL("../../components/sections/BusinessInquiryForm.tsx", import.meta.url),
    "utf8",
  );

  // Question 1, seule montée à l'ouverture : contrôlée sur le rendu réel.
  assert.ok(flowHtml.includes('for="bi-companyName"'), "label manquant pour bi-companyName");
  assert.ok(flowHtml.includes('id="bi-companyName"'), "champ bi-companyName absent");

  // Questions dévoilées ensuite : contrôlées dans la source (leur rendu est
  // vérifié en navigateur, une fois le parcours déroulé).
  for (const id of ["bi-contactName", "bi-contactRole", "bi-email", "bi-phone", "bi-city", "bi-projectDetails"]) {
    assert.ok(formSourceA11y.includes(`htmlFor="${id}"`), `label manquant pour ${id}`);
    assert.ok(formSourceA11y.includes(`id="${id}"`), `champ ${id} absent`);
  }
  // Les choix multiples sont des groupes nommés (effectif, besoins, format).
  assert.equal((formSourceA11y.match(/<fieldset/g) ?? []).length, 3, "trois fieldsets attendus");
  assert.ok(formSourceA11y.includes("<legend"), "chaque groupe porte une légende");
  assert.ok(flowHtml.includes("aria-invalid"), "état d'erreur exposé aux technologies d'assistance");
  // Honeypot : monté dès le départ, masqué visuellement, aux lecteurs
  // d'écran, et hors tabulation.
  assert.ok(/aria-hidden="true"[\s\S]{0,300}bi-website/.test(flowHtml), "honeypot masqué aux lecteurs d'écran");
  assert.ok(/tabindex="-1"/i.test(flowHtml), "honeypot hors ordre de tabulation");
  // Consentement obligatoire avec lien vers la politique.
  assert.ok(formSourceA11y.includes("/confidentialite"), "lien vers la politique de confidentialité");
  assert.ok(formSourceA11y.includes("uniquement pour répondre à ma demande"), "texte de consentement exact");
  // Le bouton d'envoi est un vrai submit, désactivable pendant l'envoi.
  assert.ok(formSourceA11y.includes('type="submit"'), "bouton de soumission natif");
  assert.ok(formSourceA11y.includes('disabled={status === "sending"}'), "bouton désactivé pendant l'envoi");
  assert.ok(formSourceA11y.includes('aria-live="polite"'), "état d'envoi annoncé");
  assert.ok(
    formSourceA11y.includes('if (sendingRef.current || status === "sending") return;'),
    "double soumission bloquée côté client",
  );
});

test("20. double clic : le verrou d'envoi est SYNCHRONE, pas dépendant du re-rendu", () => {
  // Régression observée en validation live : deux clics dans le même tick
  // lisaient `status` avant le re-rendu de React, et deux requêtes POST
  // partaient. Le serveur les neutralisait (garde anti-rejeu), mais la
  // seconde requête ne devait pas être émise du tout.
  const source = readFileSync(
    new URL("../../components/sections/BusinessInquiryForm.tsx", import.meta.url),
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

/* ─── SEO ─── */

test("SEO : métadonnées spécifiques, canonique, page indexable", () => {
  assert.equal(metadata.title, "Services aux entreprises | Coaching sportif et QVT");
  assert.ok(String(metadata.description).includes("prévention des TMS"));
  assert.ok(String(metadata.description).includes("qualité de vie au travail"));
  assert.equal(metadata.alternates?.canonical, "/services-entreprises");
  assert.ok(
    !("robots" in metadata) || !JSON.stringify(metadata.robots).includes("noindex"),
    "la page doit rester indexable malgré un lien discret",
  );
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
