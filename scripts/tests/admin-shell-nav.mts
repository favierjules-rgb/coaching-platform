// Tests PURS du shell admin (Lot A — sidebar + drawer mobile). Prouvent la
// détection de route active (donc aria-current), l'activation du groupe
// Programmation (donc aria-expanded dérivé), les fermetures du drawer
// (Échap / overlay / navigation), la boucle Tab/Shift+Tab et le verrou de
// scroll — sans DOM.

import assert from "node:assert/strict";

import {
  FOCUSABLE_SELECTOR,
  bodyOverflowFor,
  isAdminRouteActive,
  isAnyAdminRouteActive,
  isSubmenuOpen,
  nextDrawerOpen,
  wrapFocusTarget,
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

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed > 0) process.exit(1);
