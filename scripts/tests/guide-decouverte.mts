/*
 * ════════════════════════════════════════════════════════════════════════════
 * VISITE GUIDÉE DE DÉCOUVERTE — LA LOGIQUE
 * ════════════════════════════════════════════════════════════════════════════
 * Tout ce qui est testé ici l'est en appelant les VRAIES fonctions de
 * `lib/guide-decouverte.ts`, celles que le composant appelle. Aucun navigateur
 * n'étant disponible sur ce poste, le rendu React lui-même n'est pas couvert :
 * la section F vérifie par assertion STRUCTURELLE que le composant et les
 * sidebars restent d'accord sur les attributs `data-guide`, ce qui attrape la
 * régression la plus probable — un menu renommé ou déplacé sans sa cible.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CLE_GUIDE_TERMINE,
  cibleGuideEleve,
  cibleGuideStaff,
  ECART,
  ETAPES_ELEVE,
  ETAPES_STAFF,
  SEUIL_MOBILE,
  doitFaireDefiler,
  estDerniereEtape,
  etapesEleveVisibles,
  etapesStaffVisibles,
  guideDejaVu,
  indexBorne,
  marquerGuideVu,
  positionnerCarte,
  prochaineEtapeAtteignable,
} from "../../lib/guide-decouverte";
import type { DroitsNavigationAdmin } from "../../lib/admin-shell-nav";

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), "utf8");

const ADMIN: DroitsNavigationAdmin = {
  estAdmin: true,
  roleStaff: "admin",
  categoriesLecture: [],
  mecanismeIndisponible: false,
};
const COLLABORATEUR = (categories: DroitsNavigationAdmin["categoriesLecture"]): DroitsNavigationAdmin => ({
  estAdmin: false,
  roleStaff: "collaborateur",
  categoriesLecture: categories,
  mecanismeIndisponible: false,
});

/* ══════════════════════════════ A. ORDRE ══════════════════════════════ */

await test("A1. l'ordre des étapes est stable et commence par le tableau de bord", () => {
  assert.equal(ETAPES_STAFF[0]?.href, "/admin", "le staff démarre sur son tableau de bord");
  assert.equal(ETAPES_ELEVE[0]?.href, "/dashboard", "l'élève démarre sur le sien");
  const ids = ETAPES_STAFF.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "aucun identifiant d'étape en double");
  const cibles = [...ETAPES_STAFF, ...ETAPES_ELEVE].map((e) => e.cible);
  assert.equal(new Set(cibles).size, cibles.length, "aucune cible partagée entre deux étapes");
});

await test("A2. chaque étape porte un titre, un texte et une cible non vides", () => {
  for (const etape of [...ETAPES_STAFF, ...ETAPES_ELEVE]) {
    assert.ok(etape.titre.length > 0, `${etape.id} a un titre`);
    assert.ok(etape.texte.length > 10, `${etape.id} a une explication`);
    assert.ok(etape.cible.length > 0, `${etape.id} a une cible`);
    assert.ok(etape.href.startsWith("/"), `${etape.id} référence une route`);
  }
});

/* ══════════════════════ B. SUIVANT / PRÉCÉDENT ══════════════════════ */

await test("B1. « Suivant » et « Précédent » parcourent les étapes dans l'ordre", () => {
  const etapes = ETAPES_ELEVE;
  const toutesPresentes = () => true;
  assert.equal(prochaineEtapeAtteignable(etapes, 1, 1, toutesPresentes), 1, "depuis 1 vers l'avant → 1");
  assert.equal(prochaineEtapeAtteignable(etapes, 3, -1, toutesPresentes), 3, "depuis 3 vers l'arrière → 3");
  assert.equal(prochaineEtapeAtteignable(etapes, etapes.length, 1, toutesPresentes), null, "au-delà de la fin → null");
  assert.equal(prochaineEtapeAtteignable(etapes, -1, -1, toutesPresentes), null, "avant le début → null");
});

await test("B2. les bornes ne sortent jamais du tableau, même vide", () => {
  assert.equal(indexBorne(-5, 7), 0);
  assert.equal(indexBorne(99, 7), 6);
  assert.equal(indexBorne(3, 0), 0, "parcours vide : index neutre, pas de négatif");
  assert.equal(estDerniereEtape(6, 7), true);
  assert.equal(estDerniereEtape(5, 7), false);
  assert.equal(estDerniereEtape(0, 0), false, "un parcours vide n'a pas de dernière étape");
});

/* ═══════════════════ C. FILTRAGE PAR RÔLE ═══════════════════ */

await test("C1. un administrateur voit toutes les étapes staff", () => {
  assert.equal(etapesStaffVisibles(ADMIN).length, ETAPES_STAFF.length);
});

await test("C2. un collaborateur ne voit que les sections de ses catégories", () => {
  const visibles = etapesStaffVisibles(COLLABORATEUR(["entrainement"]));
  const hrefs = visibles.map((e) => e.href);
  assert.ok(hrefs.includes("/admin"), "l'accueil reste accessible");
  assert.ok(hrefs.includes("/admin/programmes"), "la programmation suit la catégorie entrainement");
  assert.ok(!hrefs.includes("/admin/paiements"), "les paiements ne lui sont PAS montrés");
  assert.ok(!hrefs.includes("/admin/parametres"), "les paramètres non plus");
  assert.ok(visibles.length < ETAPES_STAFF.length, "le parcours est bien raccourci");
});

await test("C3. un collaborateur sans aucune catégorie ne voit que l'accueil", () => {
  const visibles = etapesStaffVisibles(COLLABORATEUR([]));
  assert.deepEqual(visibles.map((e) => e.href), ["/admin"]);
});

await test("C4. pendant le chargement des droits, on n'ampute pas le parcours", () => {
  const enCours: DroitsNavigationAdmin = { ...COLLABORATEUR([]), chargement: true };
  assert.equal(etapesStaffVisibles(enCours).length, ETAPES_STAFF.length,
    "masquer pendant le chargement ferait clignoter le parcours");
});

await test("C5. un élève « programme seul » ne voit que Entraînement et Profil", () => {
  const visibles = etapesEleveVisibles("programme_seul");
  assert.deepEqual(visibles.map((e) => e.href), ["/entrainement", "/profil"]);
  assert.equal(etapesEleveVisibles("coaching").length, ETAPES_ELEVE.length);
  assert.equal(etapesEleveVisibles(null).length, ETAPES_ELEVE.length, "type inconnu : parcours complet, comme la sidebar");
});

await test("C6. aucune étape staff n'apparaît dans le parcours élève", () => {
  const hrefsEleve = new Set(ETAPES_ELEVE.map((e) => e.href));
  for (const etape of ETAPES_STAFF) {
    assert.ok(!hrefsEleve.has(etape.href), `${etape.href} ne doit pas être montré à un élève`);
  }
  assert.ok(ETAPES_ELEVE.every((e) => !e.href.startsWith("/admin")), "aucune route admin côté élève");
});

/* ═════════════ D. CIBLE ABSENTE — JAMAIS BLOQUÉ ═════════════ */

await test("D1. une cible absente est sautée, pas affichée", () => {
  const etapes = ETAPES_ELEVE;
  const absente = etapes[1]!.cible;
  const existe = (cible: string) => cible !== absente;
  assert.equal(prochaineEtapeAtteignable(etapes, 1, 1, existe), 2, "on saute à l'étape 2");
});

await test("D2. si plus aucune cible n'existe en aval, le parcours se termine au lieu de bloquer", () => {
  assert.equal(prochaineEtapeAtteignable(ETAPES_ELEVE, 2, 1, () => false), null);
  assert.equal(prochaineEtapeAtteignable(ETAPES_ELEVE, 2, -1, () => false), null);
});

await test("D3. un parcours entièrement introuvable ne lève pas", () => {
  assert.doesNotThrow(() => prochaineEtapeAtteignable([], 0, 1, () => true));
  assert.equal(prochaineEtapeAtteignable([], 0, 1, () => true), null);
});

/* ═══════════ E. PLACEMENT ET RESPONSIVE ═══════════ */

const FENETRE = { width: 1280, height: 800 };
const CARTE = { width: 340, height: 232 };

await test("E1. la carte se place à droite d'un menu de gauche", () => {
  const position = positionnerCarte({ top: 200, left: 16, width: 240, height: 44 }, FENETRE, CARTE);
  assert.equal(position.placement, "droite");
  assert.ok(position.left >= 240 + 16, "elle est bien au-delà de la cible");
});

await test("E2. elle bascule à gauche quand il n'y a plus de place à droite", () => {
  const position = positionnerCarte({ top: 200, left: 1000, width: 240, height: 44 }, FENETRE, CARTE);
  assert.equal(position.placement, "gauche");
  assert.ok(position.left >= ECART, "et reste dans la fenêtre");
});

await test("E3. elle reste ENTIÈREMENT visible, quelle que soit la cible", () => {
  const cibles = [
    { top: 0, left: 0, width: 40, height: 40 },
    { top: 760, left: 1240, width: 40, height: 40 },
    { top: 400, left: 620, width: 40, height: 40 },
    { top: -50, left: -50, width: 40, height: 40 },
  ];
  for (const cible of cibles) {
    const p = positionnerCarte(cible, FENETRE, CARTE);
    assert.ok(p.left >= ECART - 1, `left ${p.left} dans la fenêtre`);
    assert.ok(p.top >= ECART - 1, `top ${p.top} dans la fenêtre`);
    assert.ok(p.left + CARTE.width <= FENETRE.width - ECART + 1, `right dans la fenêtre`);
    assert.ok(p.top + CARTE.height <= FENETRE.height - ECART + 1, `bottom dans la fenêtre`);
  }
});

await test("E4. sur mobile, la carte est ancrée en bas et ne flanque jamais la cible", () => {
  const mobile = { width: 390, height: 844 };
  const position = positionnerCarte({ top: 100, left: 16, width: 240, height: 44 }, mobile, CARTE);
  assert.equal(position.placement, "bas-ecran");
  assert.equal(position.left, ECART);
  assert.ok(position.top + CARTE.height <= mobile.height, "elle tient dans la hauteur de l'écran");
  assert.ok(mobile.width < SEUIL_MOBILE, "le seuil est bien celui appliqué");
});

await test("E5. le défilement n'est demandé que si la cible sort de la zone visible", () => {
  assert.equal(doitFaireDefiler({ top: 300, left: 0, width: 10, height: 40 }, { height: 800 }), false);
  assert.equal(doitFaireDefiler({ top: -20, left: 0, width: 10, height: 40 }, { height: 800 }), true);
  assert.equal(doitFaireDefiler({ top: 790, left: 0, width: 10, height: 40 }, { height: 800 }), true);
});

/* ═══════════ F. FERMETURE, REPRISE, ET ACCORD AVEC LES SIDEBARS ═══════════ */

function stockageFactice() {
  const donnees = new Map<string, string>();
  return {
    getItem: (cle: string) => donnees.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => void donnees.set(cle, valeur),
  };
}

await test("F1. la fin du parcours est mémorisée, et la visite reste relançable", () => {
  const stockage = stockageFactice();
  assert.equal(guideDejaVu(stockage), false, "au premier passage, le guide n'a pas été vu");
  marquerGuideVu(stockage);
  assert.equal(guideDejaVu(stockage), true, "après la visite, on ne la repropose plus");
  assert.equal(stockage.getItem(CLE_GUIDE_TERMINE), "1");
});

await test("F2. un stockage indisponible ne fait jamais planter le guide", () => {
  const refus = {
    getItem: () => {
      throw new Error("mode privé");
    },
    setItem: () => {
      throw new Error("mode privé");
    },
  };
  assert.doesNotThrow(() => guideDejaVu(refus));
  assert.equal(guideDejaVu(refus), false, "on repropose la visite plutôt que de planter");
  assert.doesNotThrow(() => marquerGuideVu(refus));
  assert.equal(guideDejaVu(null), false);
  assert.doesNotThrow(() => marquerGuideVu(null));
});

await test("F3. chaque étape vise un menu RÉELLEMENT présent dans sa sidebar", () => {
  /*
   * ⚠️ LA RÉGRESSION LA PLUS PROBABLE EST LÀ : un menu renommé ou déplacé, et
   * la cible du guide ne correspond plus à rien. Ce contrôle lit les sidebars
   * et exige que chaque `data-guide` du parcours y existe, et que chaque href
   * d'étape y soit aussi — dans les deux sens.
   */
  const adminSidebar = lire("components/admin/AdminSidebar.tsx");
  const studentSidebar = lire("components/student/StudentSidebar.tsx");

  // La dérivation est appelée POUR DE VRAI : si une sidebar et le parcours
  // divergeaient, c'est ici que cela se verrait, pas dans une chaîne littérale.
  for (const etape of ETAPES_STAFF) {
    assert.equal(cibleGuideStaff(etape.href), etape.cible, `${etape.href} → ${etape.cible}`);
  }
  for (const etape of ETAPES_ELEVE) {
    assert.equal(cibleGuideEleve(etape.href), etape.cible, `${etape.href} → ${etape.cible}`);
  }
  // Les trois sous-routes de Programmation partagent la cible du groupe.
  for (const href of ["/admin/programmes", "/admin/exercices", "/admin/seances"]) {
    assert.equal(cibleGuideStaff(href), "nav-admin-programmation", `${href} pointe le groupe`);
  }

  // Et les sidebars posent bien l'attribut depuis cette source unique.
  assert.ok(adminSidebar.includes("data-guide={cibleGuideStaff(href)}"), "AdminSidebar pose data-guide");
  assert.ok(adminSidebar.includes('data-guide="nav-admin-programmation"'), "le groupe Programmation est ciblé");
  assert.ok(studentSidebar.includes("data-guide={cibleGuideEleve(href)}"), "StudentSidebar pose data-guide");
  for (const etape of ETAPES_STAFF) {
    if (etape.cible === "nav-admin-programmation") continue;
    assert.ok(adminSidebar.includes(`"${etape.href}"`), `AdminSidebar contient la route ${etape.href}`);
  }

  // Et l'inverse : aucun menu élève oublié par le parcours.
  const hrefsElevesSidebar = [...studentSidebar.matchAll(/href: "(\/[a-z-]+)"/g)].map((m) => m[1]);
  for (const href of hrefsElevesSidebar) {
    assert.ok(ETAPES_ELEVE.some((e) => e.href === href), `le menu élève ${href} doit être présenté par le guide`);
  }
});

await test("F4. le composant ne contourne ni les droits ni la navigation", () => {
  /* ⚠️ ON DÉPOUILLE LA PROSE. Ces fichiers EXPLIQUENT en commentaire qu'ils ne
     touchent ni à Supabase ni à la RLS : chercher le mot dans le source brut
     accuserait le commentaire qui dit le contraire de ce qu'on craint. */
  const sansProse = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const composant = sansProse(lire("components/guide/GuideDecouverte.tsx"));
  const logique = sansProse(lire("lib/guide-decouverte.ts"));
  assert.ok(!/supabase|from\s+["']@\/lib\/supabase/i.test(composant), "le guide ne lit aucune donnée métier");
  assert.ok(!/supabase/i.test(logique), "la logique non plus");
  assert.ok(/sectionAdminVisible/.test(logique), "le filtrage réutilise la règle de la sidebar");
  assert.ok(/removeEventListener/.test(composant), "les écouteurs sont retirés");
  assert.equal((composant.match(/addEventListener/g) ?? []).length,
    (composant.match(/removeEventListener/g) ?? []).length,
    "autant de retraits que d'ajouts d'écouteurs");
  assert.ok(/motion-reduce:/.test(composant), "les animations respectent prefers-reduced-motion");
  assert.ok(/min-h-\[44px\]|h-11/.test(composant), "les cibles tactiles font au moins 44 px");
  assert.ok(/aria-modal="true"/.test(composant) && /role="dialog"/.test(composant), "la carte est un dialogue modal");
  assert.ok(/aria-live="polite"/.test(composant), "la progression est annoncée");
});
