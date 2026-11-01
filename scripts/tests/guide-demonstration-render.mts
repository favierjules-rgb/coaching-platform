/*
 * ════════════════════════════════════════════════════════════════════════════
 * LA DÉMONSTRATION, RENDUE POUR DE VRAI
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ POURQUOI CE HARNAIS EXISTE. Tous les autres contrôles du guide lisent le
 * CODE : ils savent dire qu'une ancre est écrite quelque part, pas qu'elle est
 * RENDUE dans l'état où l'étape la cherche. Or c'est exactement là qu'était le
 * défaut : la visite annonçait vingt-trois étapes et s'arrêtait à la dixième,
 * parce que les treize suivantes visaient l'intérieur d'une feuille que rien
 * n'ouvrait. Un test qui cherche « nutrition-ajout-quantite » dans un fichier
 * aurait été vert tout du long.
 *
 * Ici, on monte le VRAI composant — `GuideDemonstration`, qui monte lui-même
 * le vrai `AddFoodSheet` — scénario par scénario, et on lit le HTML produit.
 *
 * ⚠️ AUCUN RÉSEAU N'EST POSSIBLE PENDANT CE RENDU. `renderToString` n'exécute
 * aucun effet : la recherche à la frappe, l'hydratation des fiches produit et
 * le scan ne partent jamais. Et la feuille de démonstration ne reçoit de toute
 * façon aucune fonction d'écriture.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { FeuilleDemonstration } from "../../components/guide/GuideDemonstration";
import { ESPACES_GUIDES } from "../../lib/guide-categories";
import {
  DEMONSTRATION_ETEINTE,
  SCENARIOS_DEMONSTRATION,
  lireDemonstration,
  type CleDemonstration,
} from "../../lib/guide-demonstration";

/*
 * ⚠️ ON REND `FeuilleDemonstration`, PAS `GuideDemonstration`. Le second lit le
 * magasin par `useSyncExternalStore`, qui rend l'instantané SERVEUR pendant
 * `renderToString` — « éteinte », toujours. Le monter ici donnerait une chaîne
 * vide pour chaque scénario, et ce harnais serait vert sans rien prouver.
 */
function rendre(scenario: CleDemonstration): string {
  return renderToString(
    createElement(FeuilleDemonstration, { etat: SCENARIOS_DEMONSTRATION[scenario] }),
  );
}

function ancres(html: string): Set<string> {
  const trouvees = new Set<string>();
  for (const m of html.matchAll(/data-guide="([^"]+)"/g)) trouvees.add(m[1]!);
  return trouvees;
}

await test("R1. hors visite guidée, la démonstration ne rend RIEN", () => {
  assert.deepEqual(lireDemonstration(), DEMONSTRATION_ETEINTE,
    "le magasin est éteint tant qu'aucune visite ne l'a allumé");
  assert.equal(
    renderToString(createElement(FeuilleDemonstration, { etat: DEMONSTRATION_ETEINTE })),
    "",
    "une feuille d'exemple qui s'afficherait sur une page réelle serait le pire défaut possible",
  );
  assert.equal(rendre("aucun"), "", "et le scénario « aucun » ne rend rien non plus");
});

await test("R2. chaque scénario rend les ancres que ses étapes visent", () => {
  /*
   * LE CONTRÔLE CENTRAL. Pour chaque étape de la visite nutrition qui déclare
   * un scénario, on rend ce scénario et on vérifie que SA cible est bien dans
   * le HTML. Une étape mal rattachée tombe ici, pas chez l'utilisateur.
   */
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);

  const parScenario = new Map<CleDemonstration, string[]>();
  for (const etape of nutrition.etapes) {
    if (!etape.demo) continue;
    const liste = parScenario.get(etape.demo) ?? [];
    liste.push(etape.cible);
    parScenario.set(etape.demo, liste);
  }
  assert.ok(parScenario.size >= 4, "la visite s'appuie sur plusieurs scénarios");

  const manquantes: string[] = [];
  for (const [scenario, cibles] of parScenario) {
    const rendues = ancres(rendre(scenario));
    for (const cible of cibles) {
      if (!rendues.has(cible)) manquantes.push(`${scenario} → ${cible}`);
    }
  }
  assert.deepEqual(manquantes, [],
    "ces cibles ne sont PAS rendues par le scénario que leur étape déclare : la visite s'y arrêterait");
});

await test("R3. la feuille vide montre les quatre entrées de l'ajout", () => {
  const rendues = ancres(rendre("feuille-vide"));
  for (const attendue of [
    "nutrition-ajout-modes",
    "nutrition-ajout-recherche",
    "nutrition-ajout-resultats",
    "nutrition-ajout-scanner",
    "nutrition-ajout-manuel",
    "nutrition-liste-favoris",
    "nutrition-liste-recents",
  ]) {
    assert.ok(rendues.has(attendue), `${attendue} doit être rendue champ vide`);
  }
});

await test("R4. l'étape quantité et sa confirmation EXISTENT, sans aliment réel", () => {
  /*
   * ⚠️ CE QUI ÉTAIT IMPOSSIBLE AVANT. Ces deux cibles n'apparaissent qu'une
   * fois un aliment choisi. Les atteindre demandait auparavant que l'élève
   * sélectionne un vrai aliment pendant la visite — donc qu'il ouvre un repas
   * réel, lequel se crée en base. Avec la fixture, elles sont là, et rien
   * n'a été touché.
   */
  const html = rendre("quantite");
  const rendues = ancres(html);
  assert.ok(rendues.has("nutrition-ajout-quantite"), "le champ de quantité est rendu");
  assert.ok(rendues.has("nutrition-ajout-confirmer"), "le bouton de confirmation aussi");
  assert.ok(html.includes("Banane"), "et l'aliment d'exemple est nommé");
  assert.ok(!rendues.has("nutrition-ajout-resultats"),
    "la liste de résultats cède la place au formulaire de quantité — comme dans l'application");
});

await test("R5. la saisie manuelle montre ses champs et son enregistrement", () => {
  const rendues = ancres(rendre("saisie-manuelle"));
  assert.ok(rendues.has("nutrition-manuel-champs"));
  assert.ok(rendues.has("nutrition-manuel-enregistrer"));
});

await test("R6. le scanner est montré SANS caméra", () => {
  const html = rendre("scanner");
  const rendues = ancres(html);
  for (const attendue of ["nutrition-scan-intro", "nutrition-scan-camera", "nutrition-scan-cadre"]) {
    assert.ok(rendues.has(attendue), `${attendue} doit être rendue`);
  }
  assert.ok(html.includes("la caméra n&#x27;est pas allumée") || html.includes("caméra n'est pas allumée"),
    "l'écran annonce lui-même qu'il s'agit d'un aperçu");
});

await test("R7. les résultats affichés sont les fixtures, et elles se reconnaissent", () => {
  const html = rendre("recherche-resultats");
  assert.ok(html.includes("Banane, pulpe, crue"), "l'aliment de fixture est affiché");
  assert.ok(html.includes("banane"), "le terme de recherche est pré-saisi");
  assert.ok(!html.includes("undefined"), "aucun trou dans le rendu");
});

await test("R8. aucun identifiant de fixture ne ressemble à une donnée réelle", () => {
  /*
   * Si l'un d'eux arrivait par accident dans une requête, il faut qu'il se voie
   * au premier coup d'œil dans n'importe quel journal.
   */
  for (const scenario of ["feuille-vide", "recherche-resultats", "quantite"] as const) {
    const html = rendre(scenario);
    for (const m of html.matchAll(/demo-[a-z-]+/g)) {
      assert.ok(m[0]!.startsWith("demo-"), `${m[0]} doit porter le préfixe de démonstration`);
    }
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(html),
      "aucun identifiant qui ressemblerait à un UUID réel");
  }
});
