/*
 * ════════════════════════════════════════════════════════════════════════════
 * VISITES D'ESPACE — RÉSOLUTION DE ROUTE, MÉMORISATION, ET ANCRES RÉELLES
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE CONTRÔLE QUI COMPTE EST C1 : chaque étape doit viser un `data-guide`
 * RÉELLEMENT posé dans le code. Une étape orpheline ne lève pas d'erreur à
 * l'exécution — le guide saute la cible absente, par conception — donc elle
 * passerait inaperçue, et la visite se terminerait aussitôt sans rien montrer.
 * C'est le seul défaut de cette fonctionnalité qui soit à la fois probable et
 * silencieux : il a son test.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

import {
  ESPACES_GUIDES,
  PREFIXE_CLE_ESPACE,
  cleEspace,
  espaceDejaVu,
  espaceGuidePour,
  marquerEspaceVu,
} from "../../lib/guide-categories";
import { CLE_GUIDE_TERMINE } from "../../lib/guide-decouverte";

const RACINE = new URL("../../", import.meta.url).pathname;

/** Toutes les valeurs `data-guide="…"` posées dans le code de l'application. */
function ancresPosees(): Set<string> {
  const trouvees = new Set<string>();
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      if (entree === "node_modules" || entree === ".next" || entree.startsWith(".")) continue;
      const chemin = `${dossier}/${entree}`;
      if (statSync(chemin).isDirectory()) {
        parcourir(chemin);
        continue;
      }
      if (!entree.endsWith(".tsx")) continue;
      for (const m of readFileSync(chemin, "utf8").matchAll(/data-guide="([^"]+)"/g)) {
        trouvees.add(m[1]!);
      }
    }
  };
  parcourir(`${RACINE}app`);
  parcourir(`${RACINE}components`);
  return trouvees;
}

/* ═══════════════ A. RÉSOLUTION DE ROUTE ═══════════════ */

await test("A1. la route la plus spécifique l'emporte", () => {
  assert.equal(espaceGuidePour("/entrainement")?.id, "entrainement-accueil");
  assert.equal(espaceGuidePour("/entrainement/seance/abc")?.id, "entrainement-seance",
    "une séance ouverte ne doit PAS recevoir la visite de l'accueil");
  assert.equal(espaceGuidePour("/entrainement/historique")?.id, "entrainement-accueil");
});

await test("A2. une route sans visite ne propose rien", () => {
  assert.equal(espaceGuidePour("/profil"), null);
  assert.equal(espaceGuidePour("/admin/paiements"), null);
  assert.equal(espaceGuidePour(null), null);
  assert.equal(espaceGuidePour(undefined), null);
  assert.equal(espaceGuidePour(""), null);
});

await test("A3. l'ordre de déclaration ne change pas le résultat", () => {
  /* La règle est « le préfixe le plus long gagne », pas « le premier déclaré » :
     réarranger le tableau ne doit donc rien casser. */
  const parLongueur = [...ESPACES_GUIDES].sort((a, b) => a.route.length - b.route.length);
  const plusLong = parLongueur[parLongueur.length - 1]!;
  assert.equal(espaceGuidePour(`${plusLong.route}/quelque-chose`)?.id, plusLong.id);
});

/* ═══════════════ B. MÉMORISATION, PAR ESPACE ═══════════════ */

function stockageFactice() {
  const donnees = new Map<string, string>();
  return {
    getItem: (c: string) => donnees.get(c) ?? null,
    setItem: (c: string, v: string) => void donnees.set(c, v),
    taille: () => donnees.size,
  };
}

await test("B1. chaque espace a sa propre mémoire", () => {
  const stockage = stockageFactice();
  assert.equal(espaceDejaVu(stockage, "nutrition-plan"), false);
  marquerEspaceVu(stockage, "nutrition-plan");
  assert.equal(espaceDejaVu(stockage, "nutrition-plan"), true);
  assert.equal(espaceDejaVu(stockage, "entrainement-accueil"), false,
    "avoir vu la nutrition ne doit pas masquer la visite de l'entraînement");
});

await test("B2. la clé d'espace ne touche JAMAIS celle de la visite des menus", () => {
  for (const espace of ESPACES_GUIDES) {
    assert.ok(cleEspace(espace.id).startsWith(PREFIXE_CLE_ESPACE));
    assert.notEqual(cleEspace(espace.id), CLE_GUIDE_TERMINE,
      "partager la clé ferait disparaître toutes les propositions d'un coup");
  }
  const stockage = stockageFactice();
  marquerEspaceVu(stockage, "nutrition-plan");
  assert.equal(stockage.getItem(CLE_GUIDE_TERMINE), null, "la visite des menus reste intacte");
});

await test("B3. un stockage refusé ne fait pas planter", () => {
  const refus = {
    getItem: () => {
      throw new Error("mode privé");
    },
    setItem: () => {
      throw new Error("mode privé");
    },
  };
  assert.doesNotThrow(() => espaceDejaVu(refus, "x"));
  assert.equal(espaceDejaVu(refus, "x"), false);
  assert.doesNotThrow(() => marquerEspaceVu(refus, "x"));
  assert.equal(espaceDejaVu(null, "x"), false);
  assert.doesNotThrow(() => marquerEspaceVu(null, "x"));
});

/* ═══════════════ C. ANCRES ET CONTENU ═══════════════ */

await test("C1. chaque étape vise une ancre `data-guide` RÉELLEMENT posée", () => {
  const posees = ancresPosees();
  const manquantes: string[] = [];
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      if (!posees.has(etape.cible)) manquantes.push(`${espace.id}/${etape.id} → ${etape.cible}`);
    }
  }
  assert.deepEqual(manquantes, [],
    "une étape sans ancre serait sautée en silence et la visite se terminerait sans rien montrer");
});

await test("C2. aucun espace vide, aucun identifiant ni aucune cible en double", () => {
  const ids: string[] = [];
  const cibles: string[] = [];
  for (const espace of ESPACES_GUIDES) {
    assert.ok(espace.etapes.length > 0, `${espace.id} a au moins une étape`);
    assert.ok(espace.route.startsWith("/"), `${espace.id} a une route`);
    assert.ok(espace.titre.length > 0, `${espace.id} a un titre`);
    for (const etape of espace.etapes) {
      ids.push(etape.id);
      cibles.push(etape.cible);
      assert.ok(etape.titre.length > 0, `${etape.id} a un titre`);
      assert.ok(etape.texte.length > 20, `${etape.id} explique réellement quelque chose`);
    }
  }
  assert.equal(new Set(ids).size, ids.length, "identifiants d'étape uniques");
  assert.equal(new Set(cibles).size, cibles.length, "cibles uniques");
});

await test("C3. la visite d'espace n'altère pas celle des menus", () => {
  const lire = (c: string) => readFileSync(`${RACINE}${c}`, "utf8");
  const categories = lire("lib/guide-categories.ts");
  const composant = lire("components/guide/GuideEspace.tsx");
  // Elle REPREND le composant existant, elle ne le redéfinit pas.
  assert.ok(/from "@\/components\/guide\/GuideDecouverte"/.test(composant),
    "GuideEspace réutilise GuideDecouverte tel quel");
  assert.ok(!/ETAPES_STAFF|ETAPES_ELEVE|etapesStaffVisibles|etapesEleveVisibles/.test(categories),
    "le catalogue d'espaces ne touche pas aux parcours de menus");
  assert.ok(!/marquerGuideVu|guideDejaVu\(/.test(categories),
    "ni à leur mémorisation");
});

await test("C4. l'alimentation couvre bien les trois façons d'ajouter un aliment", () => {
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition, "la visite de l'alimentation existe");
  const repas = nutrition.etapes.find((e) => e.id === "nut-repas");
  assert.ok(repas, "l'étape d'enregistrement d'un repas existe");
  for (const mot of [/chercher|banque/i, /main/i, /scanner|code-barres/i]) {
    assert.match(repas.texte, mot, `l'explication mentionne ${mot}`);
  }
});
