/**
 * Harnais — LE RANGEMENT DE LA FICHE ÉLÈVE EN SIX ONGLETS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CETTE SUITE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Ranger une page de 21 sections est un geste où l'on perd des choses sans le
 * voir : une section qui disparaît, une qui se retrouve en double, une action
 * enfermée dans un onglet, un onglet qui s'ouvre sur du vide. Rien de tout cela
 * ne casse la compilation, et rien ne se remarque tant qu'on ne cherche pas la
 * section manquante.
 *
 * ⚠️ CE QUI EST INTERDIT ICI, C'EST DE CHANGER LE COMPORTEMENT. Le chantier ne
 * range que l'affichage : aucun hook, aucune requête, aucune action, aucun
 * formulaire, aucune permission, aucune route. Les contrôles ci-dessous
 * vérifient le rangement ET cette absence de changement.
 *
 * Lancement : npm run test:profil-eleve-onglets
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  CATEGORIE_PAR_DEFAUT,
  CATEGORIES_DU_PROFIL,
  categorieDeLaSection,
  categoriesPotentiellementVides,
  idDeLOnglet,
  idDuPanneau,
  SECTIONS_DU_PROFIL,
  sectionsDeLaCategorie,
  type CategorieProfil,
} from "../../lib/student-profile-sections";
import { StudentProfilePanel, StudentProfileTabs } from "../../components/admin/StudentProfileTabs";

const RACINE = new URL("../../", import.meta.url).pathname;
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");
const sansCommentaires = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
const decode = (html: string) =>
  html.replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const texte = (html: string) => decode(html.replace(/<!--\s*-->/g, "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const PAGE = lire("app/admin/eleves/[studentId]/page.tsx");
const PAGE_CODE = sansCommentaires(PAGE);
const BARRE = lire("components/admin/StudentProfileTabs.tsx");
const BARRE_CODE = sansCommentaires(BARRE);

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
 * I. LES SIX CATÉGORIES, ET LEURS LIBELLÉS EXACTS
 * ════════════════════════════════════════════════════════════════════════ */

const LIBELLES_ATTENDUS = [
  "Profil",
  "Suivi corporel",
  "Entraînement",
  "Nutrition",
  "Administration",
  "Notes & historique",
] as const;

test("CAT1. six catégories, ni cinq ni sept, avec les libellés validés", () => {
  assert.equal(CATEGORIES_DU_PROFIL.length, 6, "le cahier des charges interdit la multiplication des catégories");
  assert.deepEqual(
    CATEGORIES_DU_PROFIL.map((categorie) => categorie.libelle),
    [...LIBELLES_ATTENDUS],
    "libellés et ordre validés — un libellé réécrit change ce que le coach cherche",
  );
  assert.deepEqual(
    CATEGORIES_DU_PROFIL.map((categorie) => categorie.cle),
    ["profil", "corps", "entrainement", "nutrition", "administration", "notes"],
  );
});

test("CAT2. « Profil » est l'onglet actif par défaut", () => {
  assert.equal(CATEGORIE_PAR_DEFAUT, "profil");
  assert.match(
    PAGE_CODE,
    /useState<CategorieProfil>\(CATEGORIE_PAR_DEFAUT\)/,
    "l'onglet initial doit venir de la constante partagée, pas d'une chaîne recopiée dans la page",
  );
});

test("CAT3. les libellés sont à l'écran, et une seule fois chacun", () => {
  const lu = texte(
    renderToString(createElement(StudentProfileTabs, { selected: "profil", onSelect: () => {} })),
  );
  for (const libelle of LIBELLES_ATTENDUS) {
    const occurrences = lu.split(libelle).length - 1;
    assert.equal(
      occurrences,
      1,
      `« ${libelle} » apparaît ${occurrences} fois : une variante courte cachée en sm:hidden ferait exister deux fois le même intitulé dans l'arbre d'accessibilité`,
    );
  }
});

/**
 * COMMENT RECONNAÎTRE UNE SECTION DANS LA SOURCE DE LA PAGE.
 *
 * ⚠️ LE TITRE NU NE SUFFIT PAS, ET S'EN CONTENTER REND LES TESTS FAUX. « Documents »
 * apparaît dans `useSupabaseDocuments`, `availableDocuments`, `lockedDocuments`…
 * bien avant la section ; « Objectifs » est aussi le début de l'étiquette interne
 * « Objectifs secondaires ». On vise donc ce qui identifie la section SANS
 * ambiguïté : `title="…"` quand elle passe par `AdminSection`, la balise du
 * composant quand elle en porte un, le titre nu seulement quand il est unique.
 *
 * ⚠️ LES APOSTROPHES SONT ÉCRITES `&apos;` DANS LA PAGE. « Charge d'entraînement
 * de l'élève » y figure sous la forme `Charge d&apos;entraînement de l&apos;élève` :
 * la marque porte donc la forme échappée, sans quoi le titre serait déclaré
 * absent alors qu'il est bien là.
 */
const MARQUE_DE_LA_SECTION: Readonly<Record<string, string>> = {
  "informations-personnelles": 'title="Informations personnelles"',
  "preferences-alimentaires": 'title="Préférences alimentaires"',
  "preferences-sportives": 'title="Préférences sportives"',
  objectifs: 'title="Objectifs"',
  blessures: "Blessures et contraintes",
  poids: "<WeightEvolutionCard",
  photos: "<ProgressPhotoGallerySection",
  mensurations: "<MeasurementsSection",
  physiologie: "<ProfilPhysiologiqueSection",
  "programme-actif": 'title="Programme actif"',
  "retours-recents": "Retours récents",
  "charge-entrainement": "Charge d&apos;entraînement de l&apos;élève",
  performances: "<StudentPerformanceSection",
  "plan-nutrition": 'title="Plan nutrition actif"',
  "suivi-nutrition": "<NutritionWeekSummaryCard",
  "historique-alimentaire": "<CoachNutritionHistory",
  "historique-recent": "<ActivityFeed",
  "notes-privees": "Notes privées du coach",
  abonnement: "<StudentSubscriptionSection",
  documents: 'title="Documents"',
  notifications: 'title="Notifications"',
};

/* ════════════════════════════════════════════════════════════════════════
 * II. AUCUNE SECTION PERDUE, AUCUNE EN DOUBLE, AUCUN ONGLET VIDE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Les 21 sections de la fiche, telles qu'elles sont LUES à l'écran.
 *
 * ⚠️ CETTE LISTE EST ÉCRITE À LA MAIN, ET C'EST VOULU. La dériver de
 * `SECTIONS_DU_PROFIL` rendrait le contrôle circulaire : le registre se
 * vérifierait lui-même, et une section retirée des deux côtés passerait.
 */
const TITRES_ATTENDUS: readonly string[] = [
  "Informations personnelles",
  "Préférences alimentaires",
  "Préférences sportives",
  "Objectifs",
  "Blessures et contraintes",
  "Évolution du poids",
  "Photos de progression",
  "Mensurations",
  "Profil physiologique",
  "Programme actif",
  "Retours récents",
  "Charge d'entraînement de l'élève",
  "Performances",
  "Plan nutrition actif",
  "Suivi nutrition",
  "Historique alimentaire",
  "Historique récent",
  "Notes privées du coach",
  "Abonnement & Paiement",
  "Documents",
  "Notifications",
];

test("SECT1. le registre décrit 21 sections, sans clé en double", () => {
  assert.equal(SECTIONS_DU_PROFIL.length, 21);
  const cles = SECTIONS_DU_PROFIL.map((section) => section.cle);
  assert.equal(new Set(cles).size, cles.length, "deux sections partagent une clé : l'une masquerait l'autre");
  const titres = SECTIONS_DU_PROFIL.map((section) => section.titre);
  assert.equal(new Set(titres).size, titres.length, "deux sections portent le même titre");
});

test("SECT2. AUCUNE SECTION PERDUE : les 21 sections sont toujours rendues par la page", () => {
  assert.equal(
    Object.keys(MARQUE_DE_LA_SECTION).length,
    SECTIONS_DU_PROFIL.length,
    "une section du registre n'a pas de marque de reconnaissance, ou l'inverse",
  );
  for (const section of SECTIONS_DU_PROFIL) {
    const marque = MARQUE_DE_LA_SECTION[section.cle];
    assert.ok(marque, `${section.cle} : aucune marque déclarée`);
    assert.ok(
      PAGE_CODE.includes(marque),
      `la section « ${section.titre} » a disparu de la fiche (marque cherchée : ${marque}) — ranger ne doit rien supprimer`,
    );
  }
  // Et les 21 titres sont bien ceux validés à l'audit, mot pour mot.
  assert.deepEqual([...SECTIONS_DU_PROFIL].map((s) => s.titre).sort(), [...TITRES_ATTENDUS].sort());
});

test("SECT3. AUCUNE SECTION DUPLIQUÉE : chaque section n'est rendue qu'une fois", () => {
  /*
   * ⚠️ TROIS SECTIONS EXISTENT EN DEUX EXEMPLAIRES DEPUIS TOUJOURS, et ce n'est
   * pas un doublon de rangement : la page porte deux branches EXCLUSIVES selon que
   * le questionnaire d'onboarding est rempli (`onboardingProfile ? … : …`). Les
   * figer à 2 empêche d'en ajouter un troisième par mégarde.
   */
  const DEUX_BRANCHES = new Set(["preferences-alimentaires", "preferences-sportives", "blessures"]);
  for (const section of SECTIONS_DU_PROFIL) {
    const marque = MARQUE_DE_LA_SECTION[section.cle];
    const attendu = DEUX_BRANCHES.has(section.cle) ? 2 : 1;
    const occurrences = PAGE_CODE.split(marque).length - 1;
    assert.equal(
      occurrences,
      attendu,
      `« ${section.titre} » est rendue ${occurrences} fois au lieu de ${attendu} : un copier-coller de rangement l'a dédoublée`,
    );
  }
});

test("SECT4. chaque section est rangée dans UNE catégorie, et chaque catégorie en a", () => {
  for (const section of SECTIONS_DU_PROFIL) {
    assert.ok(categorieDeLaSection(section.cle), `${section.cle} n'est rangée nulle part`);
  }
  const total = CATEGORIES_DU_PROFIL.reduce((n, { cle }) => n + sectionsDeLaCategorie(cle).length, 0);
  assert.equal(total, SECTIONS_DU_PROFIL.length, "une section est comptée dans deux onglets, ou dans aucun");
  for (const { cle, libelle } of CATEGORIES_DU_PROFIL) {
    assert.ok(sectionsDeLaCategorie(cle).length > 0, `l'onglet « ${libelle} » ne contient aucune section`);
  }
});

test("SECT5. AUCUN ONGLET VIDE, même sur une fiche de démonstration", () => {
  /*
   * Huit sections ne s'affichent que sous condition (`isSupabaseStudent`,
   * `assignedPlan`, `onboardingProfile`). Un onglet dont TOUTES les sections
   * seraient conditionnelles s'ouvrirait sur une page blanche pour un élève non
   * relié à Supabase — et passerait pour une panne.
   */
  assert.deepEqual(
    categoriesPotentiellementVides(),
    [],
    "cet onglet peut s'ouvrir sur du vide : il lui faut au moins une section inconditionnelle",
  );
  for (const { cle, libelle } of CATEGORIES_DU_PROFIL) {
    const inconditionnelles = sectionsDeLaCategorie(cle).filter((section) => !section.conditionnelle);
    assert.ok(inconditionnelles.length > 0, `« ${libelle} » : aucune section inconditionnelle`);
  }
});

test("SECT6. l'ordre relatif des sections d'un onglet est celui d'avant le rangement", () => {
  for (const { cle, libelle } of CATEGORIES_DU_PROFIL) {
    const positions = sectionsDeLaCategorie(cle).map((section) => {
      const index = PAGE_CODE.indexOf(MARQUE_DE_LA_SECTION[section.cle]);
      assert.notEqual(index, -1, `${section.cle} introuvable dans la page`);
      return { cle: section.cle, index };
    });
    const trié = [...positions].sort((a, b) => a.index - b.index).map((p) => p.cle);
    assert.deepEqual(
      positions.map((p) => p.cle),
      trié,
      `« ${libelle} » : l'ordre du registre ne suit plus l'ordre de la page`,
    );
  }
});

/**
 * Les bornes de chaque panneau dans la source : du `<StudentProfilePanel …>` de
 * cet onglet jusqu'à celui du suivant (ou la fin du rendu).
 */
function bornesDuPanneau(categorie: CategorieProfil): { debut: number; fin: number } {
  const ouvertures = CATEGORIES_DU_PROFIL.map(({ cle }) => ({
    cle,
    index: PAGE_CODE.indexOf(`<StudentProfilePanel categorie="${cle}"`),
  }));
  for (const { cle, index } of ouvertures) {
    assert.notEqual(index, -1, `le panneau « ${cle} » n'est pas rendu`);
  }
  const triees = [...ouvertures].sort((a, b) => a.index - b.index);
  const rang = triees.findIndex((o) => o.cle === categorie);
  return {
    debut: triees[rang].index,
    fin: rang + 1 < triees.length ? triees[rang + 1].index : PAGE_CODE.length,
  };
}

test("SECT7. chaque section est rendue DANS le panneau que le registre lui assigne", () => {
  /*
   * ⚠️ LE CONTRÔLE DÉCISIF, ET CELUI QUI MANQUAIT. Vérifier l'ordre à l'intérieur
   * d'un onglet ne suffit pas : déplacer une section d'un onglet à l'autre dans le
   * registre, SANS toucher la page, laissait l'ordre cohérent — l'onglet
   * afficherait une section, le registre en annoncerait une autre, et les tests
   * d'onglet vide raisonneraient sur une répartition imaginaire.
   *
   * On exige donc que la marque de chaque section tombe entre l'ouverture de SON
   * panneau et celle du panneau suivant.
   */
  for (const section of SECTIONS_DU_PROFIL) {
    const { debut, fin } = bornesDuPanneau(section.categorie);
    const marque = MARQUE_DE_LA_SECTION[section.cle];
    const dansLePanneau = PAGE_CODE.slice(debut, fin).includes(marque);
    assert.ok(
      dansLePanneau,
      `« ${section.titre} » est rangée dans « ${section.categorie} » par le registre, mais n'est pas rendue dans ce panneau`,
    );
  }
});

test("SECT8. aucune section n'est rendue HORS des panneaux", () => {
  /*
   * Une section laissée au-dessus de la barre d'onglets s'afficherait quel que
   * soit l'onglet — un contenu permanent que personne n'a demandé, et la page
   * resterait longue.
   */
  const premierPanneau = PAGE_CODE.indexOf("<StudentProfilePanel");
  const avantLesPanneaux = PAGE_CODE.slice(0, premierPanneau);
  for (const section of SECTIONS_DU_PROFIL) {
    const marque = MARQUE_DE_LA_SECTION[section.cle];
    // Les imports vivent aussi avant les panneaux : on ne compte que le JSX.
    const rendu = avantLesPanneaux.includes(marque) && !avantLesPanneaux.includes(`import { ${marque.slice(1)} }`);
    assert.ok(
      !rendu,
      `« ${section.titre} » est rendue hors des panneaux : elle resterait visible dans tous les onglets`,
    );
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LES PANNEAUX RESTENT MONTÉS — LA DÉCISION STRUCTURANTE
 * ════════════════════════════════════════════════════════════════════════ */

test("MONTAGE1. les six panneaux sont rendus INCONDITIONNELLEMENT", () => {
  for (const { cle, libelle } of CATEGORIES_DU_PROFIL) {
    const marque = `<StudentProfilePanel categorie="${cle}" selected={ongletActif}>`;
    assert.ok(PAGE_CODE.includes(marque), `le panneau « ${libelle} » n'est pas rendu, ou pas sous cette forme`);
  }
  assert.equal(
    PAGE_CODE.split("<StudentProfilePanel").length - 1,
    6,
    "six panneaux, pas plus : un septième signerait une catégorie clandestine",
  );
});

test("MONTAGE2. aucun panneau n'est sous rendu conditionnel — ce serait un démontage", () => {
  /*
   * ⚠️ LE CŒUR DU CHANTIER. `{ongletActif === "x" && <Panneau…>}` démonterait les
   * sections de l'onglet fermé, et avec elles les lectures Supabase de six
   * composants enfants (`RappelsEleveSection`, `CoachNutritionHistory`,
   * `ProfilPhysiologiqueSection`, `NutritionWeekSummaryCard`,
   * `StudentSubscriptionSection`, `ProgramStartDateField`). L'instant de ces
   * requêtes changerait — un changement de COMPORTEMENT, alors que ce chantier ne
   * doit ranger que l'affichage.
   */
  for (const interdit of [
    /ongletActif\s*===\s*"[a-z]+"\s*&&/,
    /ongletActif\s*!==\s*"[a-z]+"\s*&&/,
    /ongletActif\s*===\s*"[a-z]+"\s*\?/,
  ]) {
    assert.ok(
      !interdit.test(PAGE_CODE),
      `la page compare l'onglet actif pour décider d'un rendu (${interdit}) : les panneaux doivent tous rester montés`,
    );
  }
  // Le masquage passe par `hidden`, et par rien d'autre.
  assert.match(
    BARRE_CODE,
    /hidden=\{categorie !== selected\}/,
    "le panneau doit être masqué par l'attribut `hidden`, qui laisse les composants montés",
  );
  assert.ok(
    !/\{\s*categorie === selected\s*&&/.test(BARRE_CODE),
    "le panneau ne doit pas conditionner le rendu de ses enfants",
  );
  assert.ok(
    !/display:\s*none|"none"/.test(BARRE_CODE),
    "pas de style en ligne : `hidden` sort aussi le panneau de l'arbre d'accessibilité",
  );
});

test("MONTAGE3. rendu réel : le panneau masqué contient TOUT DE MÊME ses enfants", () => {
  const html = renderToString(
    createElement(
      StudentProfilePanel,
      { categorie: "nutrition", selected: "profil" },
      createElement("span", null, "SENTINELLE"),
    ),
  );
  assert.ok(html.includes("SENTINELLE"), "un panneau fermé qui ne rend pas ses enfants les a DÉMONTÉS");
  assert.match(html, /hidden(=""|>)/, "le panneau fermé doit porter `hidden`");

  const ouvert = renderToString(
    createElement(
      StudentProfilePanel,
      { categorie: "nutrition", selected: "nutrition" },
      createElement("span", null, "SENTINELLE"),
    ),
  );
  assert.ok(ouvert.includes("SENTINELLE"));
  assert.ok(!/hidden(=""|>)/.test(ouvert), "le panneau ouvert ne doit pas être masqué");
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. L'EN-TÊTE ET LES ACTIONS RESTENT HORS DES ONGLETS
 * ════════════════════════════════════════════════════════════════════════ */

const ACTIONS_DE_LENTETE: readonly string[] = [
  "<EditStudentModal",
  "<AssignContentToStudentModal",
  "<AddCoachNoteModal",
  "<AdminOnboardingDetailModal",
  "Mettre en pause",
  "Archiver l&apos;élève",
  "Supprimer définitivement",
];

test("ENTETE1. les actions sont TOUTES avant le premier panneau", () => {
  const premierPanneau = PAGE_CODE.indexOf("<StudentProfilePanel");
  assert.notEqual(premierPanneau, -1);
  for (const action of ACTIONS_DE_LENTETE) {
    const index = PAGE_CODE.indexOf(action);
    assert.notEqual(index, -1, `l'action ${action} a disparu de la fiche`);
    assert.ok(
      index < premierPanneau,
      `${action} est enfermée dans un panneau : elle serait plus difficile à trouver qu'avant le rangement`,
    );
  }
});

test("ENTETE2. Progression et Calendrier restent accessibles, et restent des routes séparées", () => {
  const premierPanneau = PAGE_CODE.indexOf("<StudentProfilePanel");
  for (const route of ["/progression", "/calendrier"]) {
    const marque = `href={\`/admin/eleves/\${student.id}${route}\`}`;
    const index = PAGE_CODE.indexOf(marque);
    assert.notEqual(index, -1, `le lien vers ${route} a disparu`);
    assert.ok(index < premierPanneau, `le lien ${route} doit rester dans l'en-tête, atteignable depuis tout onglet`);
  }
  /*
   * ⚠️ ELLES NE DOIVENT PAS DEVENIR DES ONGLETS. Absorber ces deux pages dans la
   * barre serait un changement de route, que le cahier des charges interdit.
   */
  for (const { libelle } of CATEGORIES_DU_PROFIL) {
    assert.ok(libelle !== "Progression" && libelle !== "Calendrier", `« ${libelle} » : ceci est une route, pas un onglet`);
  }
});

test("ENTETE3. la barre d'onglets vient APRÈS l'en-tête, et une seule fois", () => {
  const entete = PAGE_CODE.indexOf('className="mb-8 flex flex-wrap items-start justify-between gap-4"');
  const barre = PAGE_CODE.indexOf("<StudentProfileTabs");
  assert.notEqual(entete, -1, "l'en-tête a changé de forme");
  assert.notEqual(barre, -1, "la barre d'onglets n'est pas rendue");
  assert.ok(entete < barre, "l'en-tête doit rester au-dessus de la navigation");
  assert.ok(barre < PAGE_CODE.indexOf("<StudentProfilePanel"), "la barre doit précéder les panneaux");
  assert.equal(PAGE_CODE.split("<StudentProfileTabs").length - 1, 1, "une seule barre d'onglets");
});

/* ════════════════════════════════════════════════════════════════════════
 * V. LA STRUCTURE ARIA
 * ════════════════════════════════════════════════════════════════════════ */

test("ARIA1. motif « tabs » complet : tablist, tab, aria-selected, aria-controls", () => {
  const html = renderToString(createElement(StudentProfileTabs, { selected: "corps", onSelect: () => {} }));
  assert.match(html, /role="tablist"/);
  assert.equal(html.split('role="tab"').length - 1, 6, "six onglets porteurs de role=\"tab\"");
  assert.equal(html.split("aria-selected").length - 1, 6, "chaque onglet doit déclarer sa sélection");
  assert.match(html, /aria-selected="true"/);
  for (const { cle } of CATEGORIES_DU_PROFIL) {
    assert.ok(html.includes(`id="${idDeLOnglet(cle)}"`), `l'onglet ${cle} n'a pas d'identifiant`);
    assert.ok(html.includes(`aria-controls="${idDuPanneau(cle)}"`), `l'onglet ${cle} ne désigne pas son panneau`);
  }
  assert.match(html, /aria-orientation="horizontal"/);
});

test("ARIA2. un SEUL onglet dans l'ordre de tabulation", () => {
  const html = renderToString(createElement(StudentProfileTabs, { selected: "nutrition", onSelect: () => {} }));
  assert.equal(html.split('tabindex="0"').length - 1, 1, "six onglets tabulables obligeraient à les traverser un par un");
  assert.equal(html.split('tabindex="-1"').length - 1, 5);
});

test("ARIA3. le panneau désigne son onglet en retour", () => {
  for (const { cle } of CATEGORIES_DU_PROFIL) {
    const html = renderToString(
      createElement(StudentProfilePanel, { categorie: cle, selected: "profil" }, createElement("span")),
    );
    assert.ok(html.includes(`id="${idDuPanneau(cle)}"`));
    assert.ok(html.includes('role="tabpanel"'));
    assert.ok(html.includes(`aria-labelledby="${idDeLOnglet(cle)}"`), "aria-controls sans aria-labelledby est un lien à sens unique");
  }
});

test("ARIA4. navigation clavier ← → / Origine / Fin", () => {
  for (const touche of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.ok(BARRE_CODE.includes(`"${touche}"`), `la touche ${touche} n'est pas gérée`);
  }
  assert.match(BARRE_CODE, /onKeyDown=/, "aucun gestionnaire clavier n'est branché");
  assert.match(BARRE_CODE, /preventDefault\(\)/, "sans preventDefault, les flèches font aussi défiler la page");
  assert.match(BARRE_CODE, /refs\.current\[cible\]\?\.focus\(\)/, "le focus doit suivre la sélection au clavier");
});

test("ARIA5. le tablist principal est DISTINCT du tablist interne du profil physiologique", () => {
  const principal = /aria-label="([^"]+)"/.exec(BARRE_CODE)?.[1];
  assert.equal(principal, "Sections de la fiche élève");
  const physio = sansCommentaires(lire("components/admin/physio/ProfilPhysiologiqueSection.tsx"));
  const interne = /role="tablist"\s+aria-label="([^"]+)"/.exec(physio)?.[1];
  assert.ok(interne, "le profil physiologique a perdu l'étiquette de son tablist");
  assert.notEqual(
    principal,
    interne,
    "deux listes d'onglets homonymes sur un même écran sont indiscernables à la voix",
  );
});

test("ARIA6. la barre est collée en haut, avec le débord qu'exige le <main> d'AdminShell", () => {
  /*
   * ⚠️ `main` PORTE `p-6 lg:p-10`, ET C'EST LUI QUI DÉFILE (voir AdminShell).
   * Sans débord négatif ni fond opaque, le contenu défilerait visiblement le long
   * des bords de la barre collée.
   */
  assert.match(BARRE_CODE, /sticky top-0/, "la navigation doit rester accessible pendant le défilement");
  assert.match(BARRE_CODE, /-mx-6[\s\S]{0,80}lg:-mx-10/, "le débord horizontal manque");
  assert.match(BARRE_CODE, /bg-background/, "sans fond opaque, le contenu se voit passer derrière la barre");
  const shell = lire("components/admin/AdminShell.tsx");
  assert.match(shell, /<main className="flex-1 overflow-y-auto p-6 lg:p-10"/, "le conteneur de défilement a changé : revoir le débord");
});

test("ARIA7. mobile : la même barre défile horizontalement, sans second balisage", () => {
  assert.match(BARRE_CODE, /overflow-x-auto/, "la barre doit défiler sur mobile plutôt que d'être tronquée");
  assert.match(BARRE_CODE, /snap-x snap-mandatory/);
  assert.match(BARRE_CODE, /snap-start/);
  assert.ok(!/hidden sm:|sm:hidden/.test(BARRE_CODE), "aucune variante cachée : un seul balisage pour les deux tailles");
  assert.match(BARRE_CODE, /min-h-\[44px\]/, "cible tactile de 44 px");
  assert.ok(!/flex-nowrap|whitespace-nowrap/.test(BARRE_CODE), "rien ne doit empêcher le retour à la ligne à partir de sm");
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. TESTS NÉGATIFS — CE QUE LE RANGEMENT NE DOIT PAS AVOIR TOUCHÉ
 * ════════════════════════════════════════════════════════════════════════ */

test("NEG1. les hooks Supabase de la page sont INTACTS, et aucun n'est apparu", () => {
  const HOOKS_ATTENDUS: readonly string[] = [
    "useAdminData(",
    "useSupabaseProgramsSummary(",
    "useSupabaseProgram(",
    "useSupabaseNutritionPlans(",
    "useSupabaseDocuments(",
    "useSupabaseDocumentsForStudent(",
    "useSupabaseStudentDetail(",
    "useStudentProfile(",
    "useContentAssignment(",
    "useGuardedNutritionAssignment(",
  ];
  for (const hook of HOOKS_ATTENDUS) {
    assert.equal(
      PAGE_CODE.split(hook).length - 1,
      1,
      `${hook} : exactement un appel attendu — ranger l'affichage ne doit ni dédoubler ni supprimer une lecture`,
    );
  }
  /*
   * ⚠️ AUCUN HOOK DE LECTURE NE DOIT APPARAÎTRE DANS LA BARRE OU LE PANNEAU. Ce
   * sont des composants de navigation : y glisser une lecture ferait dépendre le
   * rangement des données qu'il range.
   */
  assert.ok(
    !/useSupabase|createSupabaseBrowserClient|useAdminData/.test(BARRE_CODE),
    "la barre d'onglets ne doit lire aucune donnée",
  );
});

test("NEG2. les lectures des enfants restent branchées sur les mêmes gardes", () => {
  /*
   * Les six composants qui lisent à leur montée doivent garder EXACTEMENT la
   * condition d'affichage qu'ils avaient avant le rangement. Un rangement qui
   * resserrerait une garde ferait disparaître une section ; un rangement qui la
   * relâcherait ferait lire là où il n'y a rien.
   */
  assert.match(
    PAGE_CODE,
    /\{isSupabaseStudent && \(\s*<div className="mb-6">\s*<ProfilPhysiologiqueSection/,
    "le profil physiologique doit rester réservé à un élève réel",
  );
  assert.ok(
    PAGE_CODE.includes("isSupabaseStudent && assignedPlan"),
    "« Suivi nutrition » doit rester conditionné au plan assigné",
  );
  /*
   * ⚠️ ET L'HISTORIQUE ALIMENTAIRE, LUI, N'EN DÉPEND PAS. Un élève peut avoir
   * mangé sans plan assigné : c'est la garde la plus facile à resserrer par
   * mégarde en déplaçant les deux blocs côte à côte dans le même onglet.
   */
  const avantHistorique = PAGE_CODE.slice(
    PAGE_CODE.lastIndexOf("{isSupabaseStudent", PAGE_CODE.indexOf("<CoachNutritionHistory")),
    PAGE_CODE.indexOf("<CoachNutritionHistory"),
  );
  assert.ok(!avantHistorique.includes("assignedPlan"), "l'historique alimentaire ne doit pas dépendre d'un plan assigné");
  for (const garde of ["<RappelsEleveSection", "<ActivityFeed"]) {
    const avant = PAGE_CODE.slice(PAGE_CODE.lastIndexOf("{isSupabaseStudent", PAGE_CODE.indexOf(garde)), PAGE_CODE.indexOf(garde));
    assert.ok(avant.length > 0, `${garde} n'est plus réservé à un élève réel`);
  }
});

test("NEG3. aucune route, aucune requête, aucune migration n'a été ajoutée", () => {
  for (const interdit of ["useSearchParams", "useRouter().replace", "router.replace", "window.location", ".from(", ".rpc("]) {
    assert.ok(
      !PAGE_CODE.includes(interdit),
      `${interdit} est apparu dans la fiche : le rangement ne doit toucher ni la navigation d'URL ni la couche données`,
    );
  }
  /*
   * ⚠️ LA PAGE A DÉJÀ UN `fetch`, ET IL DOIT RESTER : la suppression définitive
   * d'un élève passe par `DELETE /api/admin/students/…` depuis toujours. Interdire
   * `fetch` rendrait ce contrôle rouge sur du code que le chantier n'a pas touché ;
   * ce qu'il faut vérifier, c'est qu'il n'en est apparu AUCUN AUTRE.
   */
  const appels = [...PAGE_CODE.matchAll(/\bfetch\(`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(
    appels,
    ["/api/admin/students/${student.id}"],
    "un appel réseau est apparu, a disparu ou a changé de cible dans la fiche",
  );
  assert.ok(!/useSearchParams|next\/navigation/.test(BARRE_CODE), "la barre d'onglets ne doit pas toucher à l'URL");
});

test("NEG4. les composants de section ne sont pas retouchés par la navigation", () => {
  /*
   * La barre et le panneau ne connaissent aucune section : ils ne doivent
   * importer aucun composant métier. Sans cela, le rangement finirait par
   * enrober, adapter, puis modifier ce qu'il range.
   */
  // ⚠️ MULTI-LIGNES : l'import du registre est réparti sur plusieurs lignes ;
  // une expression ancrée sur une seule ligne ne le verrait pas et déclarerait
  // une dépendance manquante.
  const imports = [...BARRE.matchAll(/from "([^"]+)";/g)].map((m) => m[1]);
  assert.deepEqual(
    imports.sort(),
    ["@/lib/student-profile-sections", "react"],
    "la navigation ne doit dépendre que de React et du registre de rangement",
  );
});

test("NEG5. le registre de rangement ne contient AUCUNE logique de données", () => {
  /*
   * ⚠️ ON LIT LE CODE, PAS LES COMMENTAIRES. L'en-tête du registre EXPLIQUE qu'il
   * ne connaît ni Supabase ni React : interdire le mot rendrait sa propre
   * documentation illégale.
   */
  const registre = sansCommentaires(lire("lib/student-profile-sections.ts"));
  assert.ok(!/\bimport\b|\brequire\(/.test(registre), "le registre ne doit dépendre de RIEN : ni React, ni Supabase, ni un composant");
  for (const interdit of ["usestate", "useeffect", "createclient", "supabase.", "fetch(", "jsx", "=>"]) {
    assert.ok(
      !registre.toLowerCase().includes(interdit) || interdit === "=>",
      `le registre contient « ${interdit} » : il doit rester des données pures, testables sans base ni rendu`,
    );
  }
  /*
   * ⚠️ `isSupabaseStudent` Y FIGURE, ET C'EST VOULU : c'est le NOM de la garde
   * d'affichage de la page, enregistré pour prouver qu'aucun onglet ne peut être
   * vide. Une chaîne de documentation, pas un appel.
   */
  assert.ok(registre.includes('"isSupabaseStudent"'), "les conditions d'affichage doivent rester documentées");
});

test("NEG6. le commentaire qui interdisait les onglets a été CORRIGÉ, pas simplement retiré", () => {
  /*
   * ⚠️ POURQUOI L'ANCIENNE INTERDICTION N'EST PLUS APPLICABLE.
   *
   * Le chantier « Performances » portait un cahier des charges qui interdisait de
   * DÉPLACER l'existant : sa section avait donc été ajoutée en bas de la pile, et
   * un commentaire l'expliquait — « Le profil n'a pas de barre d'onglets ». Ce
   * n'était pas une règle de conception, c'était la contrainte d'un chantier.
   *
   * Le chantier de rangement lève explicitement cette contrainte : les sections
   * sont RANGÉES en six onglets, aucune n'est modifiée. Laisser le commentaire
   * aurait laissé dans le code une affirmation devenue fausse ; le retirer sans
   * rien dire aurait effacé la trace de la décision. Il est donc remplacé par
   * l'explication du nouveau contrat, et c'est cela que ce test vérifie.
   */
  assert.ok(
    !PAGE.includes("Le profil n'a pas de barre"),
    "le commentaire affirmant que le profil n'a pas d'onglets est devenu faux",
  );
  assert.ok(
    !PAGE.includes("RIEN N'EST DÉPLACÉ"),
    "l'ancienne contrainte « rien n'est déplacé » ne s'applique plus à cette page",
  );
  for (const attendu of [
    "LES SIX PANNEAUX RESTENT MONTÉS",
    "L'EN-TÊTE ET LA BARRE D'ACTIONS RESTENT AU-DESSUS DES ONGLETS",
    "AUCUN HOOK N'A BOUGÉ",
  ]) {
    assert.ok(PAGE.includes(attendu), `le nouveau contrat doit être écrit dans la page : « ${attendu} »`);
  }
});

test("NEG7. les grilles multi-colonnes démantelées n'ont pas emporté leur câblage", () => {
  /*
   * La grille 3 colonnes (Programme actif · Plan nutrition · Notifications ·
   * Documents) éclate en quatre onglets : c'est le seul regroupement DOM que le
   * rangement dissout. Chaque carte doit avoir emporté ses actions.
   */
  assert.match(PAGE_CODE, /<ProgramStartDateField/, "la date de début du programme a été perdue en route");
  assert.equal(
    PAGE_CODE.split('handleSetAssignment(student.id, "programme"').length - 1,
    1,
    "le retrait du programme doit rester unique",
  );
  assert.equal(
    PAGE_CODE.split('handleSetAssignment(student.id, "nutrition"').length - 1,
    1,
    "le retrait du plan nutrition doit rester unique",
  );
  assert.equal(
    PAGE_CODE.split('handleSetAssignment(student.id, "document"').length - 1,
    1,
    "le retrait d'un document doit rester unique",
  );
  for (const action of ["Tout débloquer", "Débloquer", "handleUnlockAllDocuments", "handleUnlockDocument"]) {
    assert.ok(PAGE_CODE.includes(action), `l'action « ${action} » des documents a disparu`);
  }
  assert.ok(PAGE_CODE.includes("notifyByEmail: false"), "la fiche élève ne doit toujours déclencher aucun email");
});

test("NEG8. aucune grille ne se retrouve avec une seule carte conditionnelle", () => {
  /*
   * Une grille `lg:grid-cols-2` dont l'unique enfant est conditionnel afficherait
   * une carte à demi-largeur, avec une colonne vide à côté, dès que la condition
   * n'est pas remplie. Les sections déplacées hors de leurs grilles occupent donc
   * toute la largeur de leur panneau.
   */
  const grilles = [...PAGE_CODE.matchAll(/grid-cols-1 gap-6 lg:grid-cols-(\d)/g)].map((m) => Number(m[1]));
  assert.ok(grilles.every((n) => n === 2), `une grille à ${grilles.filter((n) => n !== 2)} colonnes subsiste`);
  assert.ok(
    !PAGE_CODE.includes("lg:grid-cols-3"),
    "la grille 3 colonnes est démantelée : ses quatre cartes partent dans quatre onglets",
  );
});

/* ── Bilan ─────────────────────────────────────────────────────────────────── */
console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
