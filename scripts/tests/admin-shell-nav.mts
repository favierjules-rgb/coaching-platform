// Tests PURS du shell admin (Lot A — sidebar + drawer mobile). Prouvent la
// détection de route active (donc aria-current), l'activation du groupe
// Programmation (donc aria-expanded dérivé), les fermetures du drawer
// (Échap / overlay / navigation), la boucle Tab/Shift+Tab et le verrou de
// scroll — sans DOM.

import assert from "node:assert/strict";

import {
  CATEGORIES_PAR_SECTION_ADMIN,
  FOCUSABLE_SELECTOR,
  bodyOverflowFor,
  groupeAdminVisible,
  isAdminRouteActive,
  isAnyAdminRouteActive,
  isSubmenuOpen,
  nextDrawerOpen,
  sectionAdminVisible,
  wrapFocusTarget,
  type CategorieNavigation,
  type DroitsNavigationAdmin,
} from "@/lib/admin-shell-nav";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`❌ ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

// ── Route active (source d'aria-current) ──
test("route active : /admin exact uniquement (le dashboard n'est pas actif partout)", () => {
  assert.equal(isAdminRouteActive("/admin", "/admin"), true);
  assert.equal(isAdminRouteActive("/admin/eleves", "/admin"), false);
});
test("route active : préfixe pour les autres rubriques (sous-routes incluses)", () => {
  assert.equal(isAdminRouteActive("/admin/eleves", "/admin/eleves"), true);
  assert.equal(isAdminRouteActive("/admin/eleves/abc/progression", "/admin/eleves"), true);
  assert.equal(isAdminRouteActive("/admin/nutrition", "/admin/eleves"), false);
});
test("route active : pathname null/undefined -> jamais actif", () => {
  assert.equal(isAdminRouteActive(null, "/admin"), false);
  assert.equal(isAdminRouteActive(undefined, "/admin/eleves"), false);
});

// ── Groupe Programmation (source d'aria-expanded dérivé) ──
const programmation = ["/admin/programmes", "/admin/exercices", "/admin/seances"];
test("groupe Programmation actif sur chacune de ses routes (et sous-routes)", () => {
  assert.equal(isAnyAdminRouteActive("/admin/programmes/xyz/builder", programmation), true);
  assert.equal(isAnyAdminRouteActive("/admin/exercices", programmation), true);
  assert.equal(isAnyAdminRouteActive("/admin/seances", programmation), true);
  assert.equal(isAnyAdminRouteActive("/admin/eleves", programmation), false);
});
test("sous-menu : ouvert si groupe actif OU ouvert manuellement", () => {
  assert.equal(isSubmenuOpen(true, false), true);
  assert.equal(isSubmenuOpen(false, true), true);
  assert.equal(isSubmenuOpen(false, false), false);
});

// ── Drawer : fermetures ──
test("drawer : Échap ferme", () => assert.equal(nextDrawerOpen(true, "escape"), false));
test("drawer : clic overlay ferme", () => assert.equal(nextDrawerOpen(true, "overlay"), false));
test("drawer : navigation ferme", () => assert.equal(nextDrawerOpen(true, "navigate"), false));
test("drawer : bouton menu bascule (ouvertures/fermetures répétées)", () => {
  let open = false;
  open = nextDrawerOpen(open, "toggle");
  assert.equal(open, true);
  open = nextDrawerOpen(open, "toggle");
  assert.equal(open, false);
  open = nextDrawerOpen(open, "toggle");
  assert.equal(open, true);
});

// ── Boucle de focus Tab / Shift+Tab ──
const els = ["fermer", "lien-1", "lien-2", "deconnexion"];
test("Tab depuis le dernier élément -> retour au premier", () => {
  assert.equal(wrapFocusTarget(els, "deconnexion", false), "fermer");
});
test("Shift+Tab depuis le premier -> va au dernier", () => {
  assert.equal(wrapFocusTarget(els, "fermer", true), "deconnexion");
});
test("Tab au milieu -> null (comportement navigateur normal)", () => {
  assert.equal(wrapFocusTarget(els, "lien-1", false), null);
  assert.equal(wrapFocusTarget(els, "lien-2", true), null);
});
test("focus égaré (hors drawer) -> ramené au premier", () => {
  assert.equal(wrapFocusTarget(els, "element-derriere-overlay", false), "fermer");
  assert.equal(wrapFocusTarget(els, null, true), "fermer");
});
test("aucun élément focusable -> null (aucun crash)", () => {
  assert.equal(wrapFocusTarget([], null, false), null);
  assert.equal(wrapFocusTarget([], "x", true), null);
});
test("les éléments désactivés sont exclus de la boucle (sélecteur)", () => {
  assert.ok(FOCUSABLE_SELECTOR.includes('button:not([disabled])'));
  assert.ok(FOCUSABLE_SELECTOR.includes('input:not([disabled])'));
  assert.ok(FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'));
});

// ── Verrou de scroll ──
test("scroll : bloqué à l'ouverture, valeur d'origine restaurée à la fermeture", () => {
  assert.equal(bodyOverflowFor(true, ""), "hidden");
  assert.equal(bodyOverflowFor(true, "auto"), "hidden");
  assert.equal(bodyOverflowFor(false, ""), "");
  assert.equal(bodyOverflowFor(false, "scroll"), "scroll");
});


/* ══════════════════════════════════════════════════════════════════════════
   CLOISONNEMENT DE LA NAVIGATION PAR CATÉGORIE (P13-B)
   ══════════════════════════════════════════════════════════════════════════ */

/** Les quinze sections de l'espace admin, telles que la sidebar les connaît. */
const TOUTES_LES_SECTIONS = [
  "/admin",
  "/admin/eleves",
  "/admin/programmes",
  "/admin/exercices",
  "/admin/seances",
  "/admin/calendrier",
  "/admin/nutrition",
  "/admin/documents",
  "/admin/retours",
  "/admin/paiements",
  "/admin/abonnements",
  "/admin/emails",
  "/admin/notifications",
  "/admin/newsletter",
  "/admin/parametres",
] as const;

/** Les sections qu'AUCUNE catégorie n'ouvre : globales ou administratives. */
const SECTIONS_NON_ACCORDABLES = [
  "/admin/paiements",
  "/admin/abonnements",
  "/admin/emails",
  "/admin/notifications",
  "/admin/newsletter",
  "/admin/parametres",
] as const;

function droits(partiel: Partial<DroitsNavigationAdmin> = {}): DroitsNavigationAdmin {
  return {
    estAdmin: false,
    roleStaff: null,
    categoriesLecture: [],
    mecanismeIndisponible: false,
    ...partiel,
  };
}

const QUATRE_CATEGORIES: readonly CategorieNavigation[] = [
  "entrainement",
  "suivi_eleve",
  "agenda_communication",
  "nutrition",
];

function sectionsVisibles(d: DroitsNavigationAdmin): string[] {
  return TOUTES_LES_SECTIONS.filter((href) => sectionAdminVisible(href, d));
}

test("navigation : l'administrateur garde les quinze sections", () => {
  // Reconnu par `profiles.role`, donc même si les fonctions P13-B manquent et
  // même si sa fiche `coaches` n'existe pas encore.
  assert.deepEqual(sectionsVisibles(droits({ estAdmin: true })), [...TOUTES_LES_SECTIONS]);
  assert.deepEqual(
    sectionsVisibles(droits({ estAdmin: true, mecanismeIndisponible: false, roleStaff: null })),
    [...TOUTES_LES_SECTIONS],
  );
});

test("navigation : le coach autonome (assistant) garde les quinze sections", () => {
  const d = droits({ roleStaff: "assistant", categoriesLecture: QUATRE_CATEGORIES });
  assert.deepEqual(sectionsVisibles(d), [...TOUTES_LES_SECTIONS]);
});

test("navigation : migrations non appliquées ⇒ navigation inchangée pour tout le staff", () => {
  // Masquer sur l'ABSENCE du mécanisme casserait la navigation avant
  // l'application des migrations, pour un affichage qui ne protège rien.
  const d = droits({ mecanismeIndisponible: true });
  assert.deepEqual(sectionsVisibles(d), [...TOUTES_LES_SECTIONS]);
});

test("navigation : collaborateur nutrition — nutrition, documents, accueil, et rien d'autre", () => {
  const d = droits({ roleStaff: "collaborateur", categoriesLecture: ["nutrition"] });
  assert.deepEqual(sectionsVisibles(d), ["/admin", "/admin/nutrition", "/admin/documents"]);
});

test("navigation : collaborateur entraînement — programmation et retours, pas la nutrition", () => {
  const d = droits({ roleStaff: "collaborateur", categoriesLecture: ["entrainement"] });
  assert.deepEqual(sectionsVisibles(d), [
    "/admin",
    "/admin/programmes",
    "/admin/exercices",
    "/admin/seances",
    "/admin/documents",
    "/admin/retours",
  ]);
  assert.equal(sectionAdminVisible("/admin/nutrition", d), false);
  assert.equal(sectionAdminVisible("/admin/eleves", d), false);
});

test("navigation : collaborateur suivi_eleve — la fiche élève, pas l'entraînement", () => {
  const d = droits({ roleStaff: "collaborateur", categoriesLecture: ["suivi_eleve"] });
  assert.deepEqual(sectionsVisibles(d), ["/admin", "/admin/eleves", "/admin/documents"]);
});

test("navigation : collaborateur agenda — le calendrier, mais ni emails ni notifications", () => {
  // `email_logs`, `notification_campaigns` et `newsletter_subscribers` sont
  // en `est_staff_global()` : aucune catégorie ne les ouvre, et surtout pas
  // celle qui porte le mot « communication ».
  const d = droits({ roleStaff: "collaborateur", categoriesLecture: ["agenda_communication"] });
  assert.deepEqual(sectionsVisibles(d), ["/admin", "/admin/calendrier"]);
  assert.equal(sectionAdminVisible("/admin/emails", d), false);
  assert.equal(sectionAdminVisible("/admin/notifications", d), false);
  assert.equal(sectionAdminVisible("/admin/newsletter", d), false);
});

test("navigation : AUCUNE section globale ou administrative pour un collaborateur, même tout accordé", () => {
  const d = droits({ roleStaff: "collaborateur", categoriesLecture: QUATRE_CATEGORIES });
  for (const href of SECTIONS_NON_ACCORDABLES) {
    assert.equal(sectionAdminVisible(href, d), false, `${href} ne doit jamais apparaître`);
  }
  // Et il voit bien tout le reste.
  assert.deepEqual(sectionsVisibles(d), TOUTES_LES_SECTIONS.filter((h) => !SECTIONS_NON_ACCORDABLES.includes(h as never)));
});

test("navigation : collaborateur sans aucune permission ⇒ accueil seulement", () => {
  const d = droits({ roleStaff: "collaborateur", categoriesLecture: [] });
  assert.deepEqual(sectionsVisibles(d), ["/admin"]);
});

test("navigation : rôle staff inconnu alors que le mécanisme répond ⇒ refus par défaut", () => {
  // Aucune fiche `coaches` active et pas administrateur : on ne sait pas qui
  // c'est, donc on ne montre rien d'autre que le point d'entrée.
  const d = droits({ roleStaff: null, categoriesLecture: QUATRE_CATEGORIES });
  assert.deepEqual(sectionsVisibles(d), ["/admin"]);
});

test("navigation : une section non déclarée est traitée comme globale", () => {
  // Refus par défaut : une rubrique ajoutée demain et oubliée dans la table
  // n'apparaît pas, au lieu d'apparaître sans catégorie.
  const d = droits({ roleStaff: "collaborateur", categoriesLecture: QUATRE_CATEGORIES });
  assert.equal(sectionAdminVisible("/admin/section-inconnue", d), false);
});

test("navigation : le groupe Programmation disparaît quand aucun de ses enfants ne reste", () => {
  const enfants = ["/admin/programmes", "/admin/exercices", "/admin/seances"];
  assert.equal(
    groupeAdminVisible(enfants, droits({ roleStaff: "collaborateur", categoriesLecture: ["entrainement"] })),
    true,
  );
  assert.equal(
    groupeAdminVisible(enfants, droits({ roleStaff: "collaborateur", categoriesLecture: ["nutrition"] })),
    false,
  );
});

test("navigation : la table des catégories ne contient que des valeurs accordables", () => {
  // Une cinquième catégorie inventée ici — « facturation » — n'aurait aucune
  // contrepartie en base et n'ouvrirait donc jamais rien : autant qu'elle ne
  // puisse pas être écrite.
  for (const [href, categories] of Object.entries(CATEGORIES_PAR_SECTION_ADMIN)) {
    for (const categorie of categories) {
      assert.ok(QUATRE_CATEGORIES.includes(categorie), `${href} : catégorie inconnue « ${categorie} »`);
    }
  }
  // Les quinze sections de la sidebar sont toutes classées (sauf l'accueil,
  // traité à part) : aucune ne doit dépendre du refus par défaut par oubli.
  for (const href of TOUTES_LES_SECTIONS) {
    if (href === "/admin") continue;
    assert.ok(href in CATEGORIES_PAR_SECTION_ADMIN, `${href} n'est pas classée`);
  }
});

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed > 0) process.exit(1);
