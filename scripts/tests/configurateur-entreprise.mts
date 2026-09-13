/**
 * Harnais — CONFIGURATEUR « GRIT Entreprise » (/services-entreprises).
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * 1. Qu'AUCUN montant, AUCUNE devise et AUCUNE logique de facturation
 *    n'existe dans le périmètre de la page — invariant commercial du
 *    13/09/2026, et le seul qui ne puisse pas se vérifier à l'œil nu dans
 *    six mois.
 * 2. Que le parcours qualifie un projet sans jamais perdre une réponse :
 *    étape obligatoire infranchissable, retour arrière conservateur,
 *    recalcul du récapitulatif, double soumission verrouillée, erreurs
 *    d'API affichées, réinitialisation complète.
 *
 * ⚠️ LE GARDE ANTI-MONTANT NE CENSURE PAS LE VOCABULAIRE COMMERCIAL.
 * « devis », « proposition », « formule », « tarif » sont des mots
 * parfaitement légitimes sur une page qui promet un devis. Ce qui est
 * interdit, ce sont les MONTANTS et la LOGIQUE tarifaire : chiffres avec
 * devise, constantes de prix, multiplications par un prix unitaire,
 * intégrations de paiement. Interdire les mots aurait produit un test
 * bruyant et facile à contourner ; interdire les montants attrape la seule
 * chose qui compte.
 *
 * Lancement : npm run test:configurateur-entreprise
 */
process.env.TZ = "Europe/Paris";
process.env.EMAILS_ENABLED = "false";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONTACT_STEP,
  FREQUENCY_OPTIONS,
  HEADCOUNT_OPTIONS,
  LOCATION_OPTIONS,
  OBJECTIVE_OPTIONS,
  SECTOR_OPTIONS,
  STEP_COUNT,
  STEP_FIELDS,
  TIMELINE_OPTIONS,
  businessInquirySchema,
  firstIncompleteStep,
  isStepComplete,
  labelFor,
} from "../../lib/business-inquiry/schema";

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

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

/** Tout le périmètre de la page entreprise. */
const PERIMETRE = [
  "../../app/services-entreprises/page.tsx",
  "../../components/sections/EntrepriseConfigurateur.tsx",
  "../../components/ui/StepFlow.tsx",
  "../../data/entreprise.ts",
  "../../lib/business-inquiry/schema.ts",
  "../../lib/business-inquiry/email.ts",
  "../../app/api/business-inquiry/route.ts",
] as const;

/* ════════════════════════════════════════════════════════════════════════
 * I. AUCUN MONTANT, AUCUNE LOGIQUE TARIFAIRE
 * ════════════════════════════════════════════════════════════════════════ */

test("PRIX1. aucun symbole monétaire dans tout le périmètre", () => {
  /*
   * ⚠️ LE `$` SEUL NE PROUVE RIEN : c'est le préfixe de toute interpolation
   * JavaScript (`${valeur}`), présente partout dans ce code. Une première
   * version de ce test rougissait dessus — elle mesurait la syntaxe, pas
   * une devise. On ne retient donc le `$` que COLLÉ À UN NOMBRE, seule
   * forme où il désigne réellement un montant. `€` et `£` n'ont eux aucun
   * autre usage : ils restent interdits partout.
   */
  for (const chemin of PERIMETRE) {
    const code = lire(chemin);
    assert.ok(!/[€£]/.test(code), `${chemin} : symbole monétaire présent`);
    assert.ok(!/\$\s?\d|\d\s?\$(?!\{)/.test(code), `${chemin} : montant en dollars présent`);
    assert.ok(!/\bEUR\b|\bUSD\b/.test(code), `${chemin} : code devise présent`);
    // Un nombre suivi d'une unité monétaire écrite en toutes lettres.
    assert.ok(
      !/\d\s*(euros?|dollars?)\b/i.test(code),
      `${chemin} : montant libellé en toutes lettres`,
    );
  }
});

test("PRIX2. aucune constante de montant, ni les tarifs réels du modèle", () => {
  for (const chemin of PERIMETRE) {
    const code = sansCommentaires(lire(chemin));
    /*
     * Les deux tarifs réels du modèle commercial ne doivent apparaître nulle
     * part, sous aucune forme. Ils ne sont pas écrits ici non plus : le test
     * les reconstruit, pour qu'une recherche naïve dans le dépôt ne les
     * révèle pas davantage que le code lui-même.
     */
    const tarifs = [200 + 47, 400 - 3].map(String);
    for (const tarif of tarifs) {
      assert.ok(
        !new RegExp(`\\b${tarif}\\b`).test(code),
        `${chemin} : un tarif du modèle commercial est écrit dans le code`,
      );
    }
  }
});

test("PRIX3. aucune logique de calcul tarifaire", () => {
  for (const chemin of PERIMETRE) {
    const code = sansCommentaires(lire(chemin));
    for (const motif of [
      /prix\s*(unitaire|par|\*)/i,
      /montant\s*[=*]/i,
      /totalHT|totalTTC|montantTotal|prixTotal/i,
      /\bpricing\b/i,
      /calcul(er)?(Prix|Montant|Devis|Estimation)/i,
    ]) {
      assert.ok(!motif.test(code), `${chemin} : logique tarifaire détectée (${motif})`);
    }
  }
});

test("PRIX4. aucun paiement, aucun panier, aucun encaissement", () => {
  for (const chemin of PERIMETRE) {
    const code = sansCommentaires(lire(chemin));
    for (const motif of [/stripe/i, /checkout/i, /\bpanier\b/i, /createPaymentIntent/i, /paiement/i]) {
      assert.ok(!motif.test(code), `${chemin} : intégration de paiement détectée (${motif})`);
    }
  }
});

test("PRIX5. aucun fichier de tarification n'a été créé", () => {
  let existe = true;
  try {
    lire("../../lib/business-inquiry/pricing.ts");
  } catch {
    existe = false;
  }
  assert.equal(existe, false, "lib/business-inquiry/pricing.ts ne doit pas exister");
});

test("PRIX6. le vocabulaire commercial reste autorisé, lui", () => {
  // Contre-épreuve du garde : la page DOIT parler de devis. Un test qui
  // interdirait le mot rendrait la page impossible à écrire.
  const page = lire("../../app/services-entreprises/page.tsx");
  assert.ok(/devis/i.test(page), "la page doit annoncer la demande de devis");
  assert.ok(/proposition adaptée/i.test(page), "la page promet une proposition adaptée");
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LE PARCOURS NE LAISSE PAS PASSER UNE ÉTAPE VIDE
 * ════════════════════════════════════════════════════════════════════════ */

const projetComplet = {
  headcount: "10-19",
  frequency: "2-seances",
  objectives: ["bien-etre", "condition-physique"],
  sector: "services",
  timeline: "des-que-possible",
  projectDetails: "",
  location: "",
  city: "",
  companyName: "Acme",
  contactName: "Camille Martin",
  contactRole: "Dirigeante",
  email: "camille@acme.test",
  phone: "",
  privacyAccepted: true as const,
  website: "",
};

test("Q1. impossible de dépasser une étape obligatoire laissée vide", () => {
  const vide = { ...projetComplet, headcount: "" };
  assert.equal(firstIncompleteStep(vide), 1, "sans effectif, on reste à l'étape 1");
  assert.equal(isStepComplete(vide, 1), false, "l'étape 1 n'est pas franchissable");

  // Chaque étape obligatoire retient le parcours à son propre rang.
  const obligatoires: [string, number][] = [
    ["headcount", 1],
    ["frequency", 2],
    ["sector", 4],
    ["timeline", 5],
  ];
  for (const [champ, rang] of obligatoires) {
    const partiel = { ...projetComplet, [champ]: "" };
    assert.equal(firstIncompleteStep(partiel), rang, `« ${champ} » vide doit retenir l'étape ${rang}`);
  }
  // Les objectifs : au moins un.
  assert.equal(firstIncompleteStep({ ...projetComplet, objectives: [] }), 3, "aucun objectif ⇒ étape 3");
});

test("Q2. un effectif hors liste est impossible, y compris négatif ou nul", () => {
  for (const invalide of ["", "0", "-5", "12345", "dix", "50", "1-4 "]) {
    const resultat = businessInquirySchema.safeParse({ ...projetComplet, headcount: invalide });
    assert.equal(resultat.success, false, `effectif « ${invalide} » doit être refusé`);
  }
  // Seules les tranches déclarées passent.
  for (const option of HEADCOUNT_OPTIONS) {
    assert.equal(
      businessInquirySchema.safeParse({ ...projetComplet, headcount: option.value }).success,
      true,
      `tranche « ${option.value} » doit être acceptée`,
    );
  }
});

test("Q3. soumission sans email — ou avec un email invalide — impossible", () => {
  for (const email of ["", "   ", "pas-un-email", "a@b", "@acme.test", "camille@"]) {
    const resultat = businessInquirySchema.safeParse({ ...projetComplet, email });
    assert.equal(resultat.success, false, `email « ${email} » doit être refusé`);
    assert.ok(resultat.error?.issues.some((i) => i.path[0] === "email"), "erreur rattachée au champ email");
  }
});

test("Q4. soumission sans consentement impossible", () => {
  const resultat = businessInquirySchema.safeParse({ ...projetComplet, privacyAccepted: false });
  assert.equal(resultat.success, false);
  assert.ok(resultat.error?.issues.some((i) => i.path[0] === "privacyAccepted"));
});

test("Q5. l'étape facultative ne bloque jamais, mais reste bornée", () => {
  assert.equal(businessInquirySchema.safeParse(projetComplet).success, true, "étape 6 vide : envoi possible");
  // Bornée quand même : un champ libre non borné est une porte ouverte.
  const trop = { ...projetComplet, projectDetails: "x".repeat(2001) };
  assert.equal(businessInquirySchema.safeParse(trop).success, false, "détails trop longs refusés");
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LE RETOUR ARRIÈRE NE DÉTRUIT RIEN, LE RÉCAPITULATIF SUIT
 * ════════════════════════════════════════════════════════════════════════ */

test("R1. revenir en arrière ne valide rien et ne peut donc rien effacer", () => {
  const source = sansCommentaires(lire("../../components/sections/EntrepriseConfigurateur.tsx"));
  const goBack = source.slice(source.indexOf("function goBack()"), source.indexOf("function reset()"));
  /*
   * ⚠️ LE RETOUR NE DOIT NI VALIDER, NI TOUCHER AUX RÉPONSES. S'il
   * appelait la validation, une étape incomplète empêcherait de revenir en
   * arrière la corriger — exactement l'inverse du besoin. S'il touchait à
   * `values`, une réponse serait perdue au moindre aller-retour.
   */
  assert.ok(!goBack.includes("errorsForStep"), "le retour ne valide pas l'étape quittée");
  assert.ok(!goBack.includes("setValues"), "le retour ne modifie jamais les réponses");
  assert.ok(goBack.includes("Math.max"), "le retour est borné à la première étape");
});

test("R2. seule une action explicite remet les réponses à zéro", () => {
  const source = sansCommentaires(lire("../../components/sections/EntrepriseConfigurateur.tsx"));
  const occurrences = source.match(/setValues\(initialState\)/g) ?? [];
  /*
   * Exactement deux remises à zéro : la réinitialisation demandée par
   * l'utilisateur, et le succès d'envoi. Une troisième signifierait qu'un
   * chemin détruit des réponses sans que personne l'ait demandé.
   */
  assert.equal(occurrences.length, 2, "deux remises à zéro attendues : reset explicite et succès d'envoi");
  assert.ok(source.includes("function reset()"), "réinitialisation disponible");
  assert.ok(source.includes("Nouvelle demande"), "action de réinitialisation offerte après l'envoi");
});

test("R3. le récapitulatif est DÉRIVÉ des réponses, jamais mémorisé", () => {
  const source = sansCommentaires(lire("../../components/sections/EntrepriseConfigurateur.tsx"));
  const recap = source.slice(source.indexOf("function Recapitulatif"));
  /*
   * ⚠️ UN RÉCAPITULATIF MÉMORISÉ SE DÉSYNCHRONISE. Il est ici recalculé à
   * chaque rendu depuis `values` : changer une réponse puis revenir à
   * l'étape de contact ne peut pas afficher l'ancienne. Aucun `useState`,
   * aucun `useEffect` dans ce composant.
   */
  assert.ok(!recap.includes("useState"), "le récapitulatif ne mémorise pas d'état");
  assert.ok(!recap.includes("useEffect"), "le récapitulatif ne se synchronise pas par effet");
  assert.ok(recap.includes("values.headcount"), "il lit directement les réponses");
  // Et il n'affiche que des libellés, jamais un chiffrage.
  assert.ok(recap.includes("labelFor("), "les valeurs sont traduites en libellés lisibles");
});

test("R4. chaque valeur d'option possède un libellé lisible", () => {
  // Un récapitulatif qui afficherait « 10-19 » ou « des-que-possible » au
  // lieu du libellé trahirait une option ajoutée sans son intitulé.
  const jeux = [HEADCOUNT_OPTIONS, FREQUENCY_OPTIONS, OBJECTIVE_OPTIONS, SECTOR_OPTIONS, TIMELINE_OPTIONS, LOCATION_OPTIONS];
  for (const options of jeux) {
    for (const option of options) {
      const libelle = labelFor(options, option.value);
      assert.notEqual(libelle, option.value, `« ${option.value} » n'a pas de libellé distinct`);
      assert.ok(libelle.length > 1, `libellé vide pour « ${option.value} »`);
    }
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. ENVOI : VERROU, CHARGEMENT, ERREUR
 * ════════════════════════════════════════════════════════════════════════ */

test("E1. double soumission verrouillée AVANT le réseau, relâchée quoi qu'il arrive", () => {
  const source = lire("../../components/sections/EntrepriseConfigurateur.tsx");
  assert.ok(source.includes("const sendingRef = useRef(false)"), "verrou synchrone déclaré");
  assert.ok(
    source.includes('if (sendingRef.current || status === "sending") return;'),
    "verrou consulté avant toute soumission",
  );
  const pose = source.indexOf("sendingRef.current = true");
  const reseau = source.indexOf('fetch("/api/business-inquiry"');
  assert.ok(pose > 0 && pose < reseau, "verrou posé avant l'appel réseau");
  assert.ok(
    /finally \{[\s\S]{0,200}sendingRef\.current = false/.test(source),
    "verrou relâché dans un finally : un échec reste réessayable",
  );
});

test("E2. l'état de chargement est visible et bloque le bouton", () => {
  const source = lire("../../components/sections/EntrepriseConfigurateur.tsx");
  assert.ok(source.includes('setStatus("sending")'), "état d'envoi posé");
  assert.ok(source.includes('disabled={status === "sending"}'), "bouton désactivé pendant l'envoi");
  assert.ok(source.includes('aria-busy'), "état d'occupation exposé aux technologies d'assistance");
  assert.ok(source.includes("Envoi en cours"), "libellé de chargement visible");
  assert.ok(source.includes("animate-spin"), "indicateur visuel de chargement");
  assert.ok(source.includes("motion-reduce:animate-none"), "indicateur immobile sous prefers-reduced-motion");
});

test("E3. une erreur d'API est AFFICHÉE, jamais avalée", () => {
  const source = lire("../../components/sections/EntrepriseConfigurateur.tsx");
  assert.ok(source.includes('setStatus("error")'), "état d'erreur posé");
  assert.ok(source.includes('role="alert"'), "message d'erreur annoncé immédiatement");
  // Le message du serveur est préféré, avec repli générique.
  assert.ok(source.includes("payload.error ?? ERREUR_GENERIQUE"), "message serveur affiché en priorité");
  // Le catch réseau est traité comme une erreur, pas ignoré.
  assert.ok(/catch \{[\s\S]{0,160}setStatus\("error"\)/.test(source), "échec réseau traité comme une erreur");
});

test("E4. une erreur de validation ramène à la PREMIÈRE étape fautive", () => {
  const source = lire("../../components/sections/EntrepriseConfigurateur.tsx");
  /*
   * Signaler une erreur sur une étape déjà dépassée sans y ramener
   * laisserait le prospect devant un message qu'il ne peut pas corriger.
   */
  assert.ok(source.includes("firstIncompleteStep(values)"), "l'étape fautive est déduite du schéma");
  assert.ok(source.includes("setStep(fautive)"), "le parcours revient sur l'étape fautive");
});

test("E5. le honeypot part vers le serveur, et le client n'en sait rien de plus", () => {
  const source = lire("../../components/sections/EntrepriseConfigurateur.tsx");
  assert.ok(source.includes('name="website"'), "champ piège présent");
  assert.ok(!source.includes("looksAutomated"), "le client ne décide pas de la détection");
  // Aucun secret serveur ne transite par le composant.
  assert.ok(!source.includes("RESEND"), "aucune clé d'envoi côté client");
  assert.ok(!source.includes("B2B_CONTACT_RECIPIENT_EMAIL"), "aucun destinataire côté client");
});

/* ════════════════════════════════════════════════════════════════════════
 * V. COHÉRENCE DU PARCOURS
 * ════════════════════════════════════════════════════════════════════════ */

test("C1. sept étapes, la dernière porte le contact", () => {
  assert.equal(STEP_COUNT, 7, "sept étapes");
  assert.equal(CONTACT_STEP, STEP_COUNT, "l'étape de contact est la dernière");
  assert.deepEqual(
    [...STEP_FIELDS[CONTACT_STEP - 1]],
    ["companyName", "contactName", "contactRole", "email", "phone"],
    "l'étape de contact porte exactement les coordonnées",
  );
});

test("C2. aucun champ n'appartient à deux étapes", () => {
  const tous = STEP_FIELDS.flat();
  assert.equal(new Set(tous).size, tous.length, "un champ rattaché à deux étapes");
});

test("C3. le schéma refuse tout champ inconnu", () => {
  // `.strict()` : un champ ajouté côté client sans passer par le schéma est
  // rejeté par le serveur, pas silencieusement ignoré.
  const resultat = businessInquirySchema.safeParse({ ...projetComplet, montantEstime: 1000 });
  assert.equal(resultat.success, false, "champ inconnu accepté");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
