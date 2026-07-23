// Tests PURS du mapping d'overlays anatomiques (contours paths, remplacement
// premium du schéma). Prouve : assets LOCAUX uniquement (aucune URL
// distante/Sketchfab/iframe), deux vues rendues, chaque zone du heatmap
// adressable, groupes bilatéraux des deux côtés, contours bien formés et dans
// le cadre de l'image. Aucun rendu React nécessaire.

import assert from "node:assert/strict";

import { BODY_ZONES, type BodyZone } from "@/lib/muscle-heatmap";
import {
  ANATOMY_ASSETS,
  ANATOMY_SIZES,
  BACK_ZONES,
  BILATERAL_ZONES,
  FRONT_ZONES,
  type ZonePaths,
} from "@/lib/muscle-overlays";

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

const allPaths = [ANATOMY_ASSETS.front, ANATOMY_ASSETS.back];

test("assets LOCAUX uniquement (pas d'URL distante, pas de Sketchfab, pas d'iframe)", () => {
  for (const p of allPaths) {
    assert.match(p, /^\/anatomy\/.+\.webp$/, `chemin non local: ${p}`);
    assert.ok(!/^https?:/i.test(p), `URL distante interdite: ${p}`);
    assert.ok(!/sketchfab/i.test(p), `référence Sketchfab interdite: ${p}`);
  }
});

test("les deux vues (face + dos) sont rendues", () => {
  assert.ok(FRONT_ZONES.length > 0, "vue de face vide");
  assert.ok(BACK_ZONES.length > 0, "vue de dos vide");
});

function zonesOf(list: ZonePaths[]): BodyZone[] {
  return list.map((o) => o.zone);
}

test("chaque zone d'overlay est une BodyZone valide", () => {
  for (const o of [...FRONT_ZONES, ...BACK_ZONES]) {
    assert.ok((BODY_ZONES as readonly string[]).includes(o.zone), `zone inconnue: ${o.zone}`);
  }
});

test("aucune zone dupliquée dans une même vue", () => {
  for (const list of [FRONT_ZONES, BACK_ZONES]) {
    const zs = zonesOf(list);
    assert.equal(new Set(zs).size, zs.length);
  }
});

test("chaque zone canonique du heatmap est adressable (face ∪ dos = 12 zones)", () => {
  const union = new Set<string>([...zonesOf(FRONT_ZONES), ...zonesOf(BACK_ZONES)]);
  for (const zone of BODY_ZONES) {
    assert.ok(union.has(zone), `zone non mappée sur le schéma: ${zone}`);
  }
});

test("répartition face/dos attendue", () => {
  const front = new Set(zonesOf(FRONT_ZONES));
  const back = new Set(zonesOf(BACK_ZONES));
  for (const z of ["pectoraux", "abdos", "quadriceps", "biceps", "épaules"] as BodyZone[]) {
    assert.ok(front.has(z), `${z} attendu en face`);
  }
  for (const z of ["dos", "triceps", "fessiers", "ischios", "mollets", "épaules"] as BodyZone[]) {
    assert.ok(back.has(z), `${z} attendu de dos`);
  }
});

test("avant-bras présents en face ET de dos (2 contours chacun) ; lombaires de dos uniquement", () => {
  const front = new Set(zonesOf(FRONT_ZONES));
  const back = new Set(zonesOf(BACK_ZONES));
  assert.ok(front.has("avant-bras"), "avant-bras attendu en face");
  assert.ok(back.has("avant-bras"), "avant-bras attendu de dos");
  assert.equal(FRONT_ZONES.find((o) => o.zone === "avant-bras")?.paths.length, 2);
  assert.equal(BACK_ZONES.find((o) => o.zone === "avant-bras")?.paths.length, 2);
  assert.ok(back.has("lombaires"), "lombaires attendu de dos");
  assert.ok(!front.has("lombaires"), "lombaires ne doit pas être en face");
});

test("groupes bilatéraux coloriés des deux côtés (≥ 2 contours)", () => {
  for (const list of [FRONT_ZONES, BACK_ZONES]) {
    for (const o of list) {
      if (BILATERAL_ZONES.includes(o.zone)) {
        assert.ok(o.paths.length >= 2, `${o.zone} devrait avoir ≥2 contours (bilatéral)`);
      }
    }
  }
});

test("pectoraux et quadriceps ont 2 contours en face ; dos plusieurs de dos", () => {
  assert.equal(FRONT_ZONES.find((o) => o.zone === "pectoraux")?.paths.length, 2);
  assert.equal(FRONT_ZONES.find((o) => o.zone === "quadriceps")?.paths.length, 2);
  assert.ok((BACK_ZONES.find((o) => o.zone === "dos")?.paths.length ?? 0) >= 2);
});

test("chaque contour est un path bien formé (commence par M, non vide, pas d'URL)", () => {
  for (const o of [...FRONT_ZONES, ...BACK_ZONES]) {
    assert.ok(o.paths.length >= 1, `${o.zone} sans contour`);
    for (const d of o.paths) {
      assert.match(d, /^[Mm]/, `${o.zone}: un contour doit commencer par M`);
      assert.ok(d.length > 10, `${o.zone}: contour trop court`);
      assert.ok(!/https?:|sketchfab|<|url\(/i.test(d), `${o.zone}: contour suspect`);
    }
  }
});

test("les contours restent dans le cadre de l'image (coordonnées plausibles)", () => {
  const bound = (list: ZonePaths[], W: number, H: number) => {
    const max = Math.max(W, H);
    for (const o of list) {
      for (const d of o.paths) {
        const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        for (const v of nums) {
          assert.ok(Number.isFinite(v) && v >= -20 && v <= max + 20, `${o.zone}: coord hors cadre (${v})`);
        }
      }
    }
  };
  bound(FRONT_ZONES, ANATOMY_SIZES.front.width, ANATOMY_SIZES.front.height);
  bound(BACK_ZONES, ANATOMY_SIZES.back.width, ANATOMY_SIZES.back.height);
});

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed > 0) process.exit(1);
