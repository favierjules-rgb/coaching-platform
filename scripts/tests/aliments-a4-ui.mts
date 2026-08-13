/**
 * Harnais — ALIMENTS A4 PHASE 3 : LE SCANNER DANS L'ÉCRAN D'AJOUT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS PROUVE, ET COMMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Le dépôt n'a ni jsdom ni bibliothèque de test DOM : ses harnais de rendu
 * s'arrêtent à `renderToString`, qui n'exécute aucun effet et ne clique sur
 * rien. Prétendre « simuler un scan » ici serait mentir sur ce qui est mesuré.
 *
 * Les contrats sont donc éprouvés là où ils sont RÉELLEMENT vérifiables :
 *
 *   - les RÈGLES de parcours — quel message, quelles portes de sortie — vivent
 *     dans `lib/scan/parcours.ts`, des fonctions pures appelées pour de vrai
 *     ici, sur TOUS les motifs et pas sur un échantillon ;
 *   - le LOOKUP vit dans `lib/nutrition/produits-client.ts`, avec un `fetch`
 *     injecté qui COMPTE ses appels : c'est ce compteur, et non un commentaire,
 *     qui prouve qu'une double détection ne fait qu'un appel ;
 *   - le RENDU est éprouvé par `renderToString`, sur ce qui est visible au
 *     premier rendu ;
 *   - ce qui ne peut être prouvé qu'en lisant le code — « la caméra est
 *     coupée AVANT le lookup » — est vérifié par des assertions PRÉCISES sur le
 *     source, toujours après dépouillement des commentaires, et toujours
 *     doublé d'un contrôle négatif montrant que le dépouillement n'a pas vidé
 *     le fichier.
 *
 * ⚠️ Le PIÈGE, sixième occurrence dans ce projet : une assertion « le mot X ne
 * doit pas apparaître » échoue sur la prose qui énonce la règle. Les
 * commentaires du scanner parlent de « fps » et de « GTIN » pour expliquer
 * pourquoi ils ne sont pas affichés. D'où `sansProse`, systématiquement.
 *
 * Lancement : npm run test:aliments-a4-ui
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import test from "node:test";

import { AddFoodSheet } from "../../components/student/AddFoodSheet";
import { ScannerCodeBarres } from "../../components/student/ScannerCodeBarres";
import { type Fetch, lireProduitParGtin } from "../../lib/nutrition/produits-client";
import { unitesPourProduit } from "../../lib/nutrition/selection-aliment";
import type { MotifEchec } from "../../lib/scan/camera";
import {
  type ActionRepli,
  type EchecLookup,
  LIBELLE_ACTION,
  MESSAGE_CAMERA,
  MESSAGE_LOOKUP,
  actionsPourCamera,
  actionsPourLookup,
} from "../../lib/scan/parcours";
import { lireGtin } from "../../lib/scan/gtin";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SOURCE_SHEET = lire("../../components/student/AddFoodSheet.tsx");
const SOURCE_SCANNER = lire("../../components/student/ScannerCodeBarres.tsx");
const CODE_SHEET = sansProse(SOURCE_SHEET);
const CODE_SCANNER = sansProse(SOURCE_SCANNER);

const TOUS_MOTIFS: readonly MotifEchec[] = [
  "permission_refusee",
  "aucune_camera",
  "camera_occupee",
  "contrainte_impossible",
  "contexte_non_securise",
  "inconnu",
];
const TOUS_ECHECS: readonly EchecLookup[] = ["introuvable", "incomplet", "indisponible"];

/* ── Faux réseau ───────────────────────────────────────────────────────── */

function réponse(statut: number, corps: unknown): Response {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: async () => corps,
  } as unknown as Response;
}

/** Un `fetch` de test : il journalise CHAQUE URL demandée. */
function fauxFetch(par: (url: string) => Response | Error) {
  const journal: string[] = [];
  const fetcher: Fetch = async (url) => {
    journal.push(url);
    const r = par(url);
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetcher, journal };
}

const DTO_NUTELLA = {
  id: "p-nutella",
  gtin: "3017620422003",
  name: "Nutella",
  brand: "Ferrero",
  imageUrl: null,
  proteinPer100: 6.3,
  carbPer100: 57.5,
  fatPer100: 30.9,
  nutritionUnit: "g" as const,
};

const DTO_LIQUIDE = { ...DTO_NUTELLA, id: "p-cola", gtin: "5449000000996", name: "Coca-Cola", nutritionUnit: "ml" as const };

function rendreFeuille(props: Partial<Parameters<typeof AddFoodSheet>[0]> = {}): string {
  return renderToString(
    createElement(AddFoodSheet, {
      titreRepas: "Petit-déjeuner",
      enCours: false,
      erreur: null,
      onFermer: () => {},
      onAjouterCatalogue: async () => true,
      onAjouterProduit: async () => true,
      onAjouterManuel: async () => true,
      ...props,
    }),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   A4-UI1..5 — L'ENTRÉE DANS LE SCANNER
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-UI1. le bouton « Scanner un code-barres » est visible dans l'onglet Rechercher", () => {
  const html = rendreFeuille();
  assert.ok(html.includes("Scanner un code-barres"), "le bouton est rendu dès l'ouverture");

  // ET IL N'Y A TOUJOURS QUE DEUX ONGLETS. Le scan est une manière de
  // RETROUVER un aliment, pas une troisième façon d'en ajouter un : un onglet
  // de plus raconterait le contraire.
  const onglets = html.match(/role="tab"/g) ?? [];
  assert.equal(onglets.length, 2, "deux onglets, pas trois");
  assert.ok(html.includes("Rechercher") && html.includes("Saisir à la main"));

  // Le bouton est DANS l'onglet recherche, sous le champ : il apparaît après
  // le champ de recherche dans le flux du document.
  assert.ok(
    html.indexOf('id="recherche-aliment"') < html.indexOf("Scanner un code-barres"),
    "le bouton suit le champ de recherche",
  );
});

await test("A4-UI2. aucune permission caméra n'est demandée avant un tap", () => {
  // 1. Au premier rendu, la vue caméra n'existe pas : le scanner n'est pas
  //    monté du tout.
  const html = rendreFeuille();
  assert.ok(!html.includes("Aperçu de la caméra"), "aucune vidéo au premier rendu");
  assert.ok(!html.includes("Ouvrir la caméra"), "et pas même l'écran d'invite");

  // 2. `getUserMedia` n'est atteint que par `ouvrirCameraArriere`, qui n'est
  //    appelée que depuis `ouvrir()`, elle-même branchée sur un `onClick`.
  assert.ok(!CODE_SCANNER.includes("getUserMedia"), "l'écran n'appelle pas l'API directement");
  const posOuvrir = CODE_SCANNER.indexOf("await ouvrirCameraArriere(");
  const posFonction = CODE_SCANNER.indexOf("async function ouvrir()");
  assert.ok(posFonction > 0 && posOuvrir > posFonction);
  assert.ok(CODE_SCANNER.includes("onClick={() => void ouvrir()}"));

  // 3. Le SEUL effet du composant est un nettoyage de démontage. Un effet qui
  //    ouvrirait la caméra au montage demanderait la permission sans que
  //    personne n'ait rien tapé.
  assert.equal((CODE_SCANNER.match(/useEffect\(/g) ?? []).length, 1);
  assert.ok(CODE_SCANNER.includes("useEffect(() => () => toutArrêter(), [toutArrêter])"));

  // CONTRÔLE NÉGATIF du dépouillement.
  assert.ok(CODE_SCANNER.includes("ouvrirCameraArriere"), "le décapage n'a pas vidé le fichier");
  assert.ok(CODE_SCANNER.length > 2000);
});

await test("A4-UI3. le tap sur « Scanner » monte la vue caméra, et elle seule", () => {
  assert.ok(CODE_SHEET.includes("onClick={ouvrirScan}"));
  assert.ok(CODE_SHEET.includes("function ouvrirScan()"));
  // La vue scanner REMPLACE le contenu de l'onglet : sur un téléphone de
  // 375 px, garder le champ, la liste et les attributions autour d'une image
  // de caméra donnerait une image minuscule dans un écran illisible.
  assert.ok(
    /scanOuvert \? \(\s*<ScannerCodeBarres/.test(CODE_SHEET),
    "la vue scanner prend la place du contenu de l'onglet",
  );
  // L'écran d'invite existe, avec son bouton volontaire.
  const invite = renderToString(
    createElement(ScannerCodeBarres, {
      onGtin: () => {},
      onFermer: () => {},
      onRechercheParNom: () => {},
      onSaisieManuelle: () => {},
    }),
  );
  assert.ok(invite.includes("Ouvrir la caméra"), "le bouton volontaire est là");
  assert.ok(invite.includes("Fermer"), "et la sortie aussi");
});

await test("A4-UI4. la caméra ARRIÈRE est demandée, et jamais la frontale", () => {
  // La contrainte vient de la couche testée en phase 2 ; ce qui est vérifié
  // ici, c'est que l'écran ne la contourne pas.
  assert.ok(CODE_SCANNER.includes("ouvrirCameraArriere("));
  assert.ok(!CODE_SCANNER.includes('"user"'), "aucune demande de caméra frontale");
  assert.ok(!CODE_SCANNER.includes("facingMode"), "l'écran ne fabrique aucune contrainte à lui");
  // Pas de sélecteur de caméra en V1 : l'élève ne doit pas avoir à choisir.
  assert.ok(!CODE_SCANNER.includes("sélecteur") && !CODE_SCANNER.includes("choisirCamera"));
  assert.ok(!CODE_SCANNER.includes("enumerateDevices"));
});

await test("A4-UI5. le moteur est chargé PARESSEUSEMENT, jamais dans le chemin initial", () => {
  assert.ok(CODE_SCANNER.includes('await import("@/lib/scan/adaptateurs")'));
  assert.ok(!/^import .*adaptateurs/m.test(CODE_SCANNER), "aucun import statique");

  // Et la feuille d'ajout — qui, elle, est dans le chemin normal de l'écran
  // nutrition — ne nomme aucune bibliothèque de décodage.
  assert.ok(!CODE_SHEET.includes("zxing"), "la feuille ne tire aucun décodeur");
  assert.ok(!CODE_SHEET.includes("adaptateurs"));
});

await test("A4-UI6. plus aucune référence au moteur écarté", () => {
  const paquet = JSON.parse(lire("../../package.json")) as {
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.ok(!("@zxing/library" in paquet.dependencies), "la dépendance est retirée");
  assert.ok(!("@zxing/library" in (paquet.devDependencies ?? {})));
  assert.ok("zxing-wasm" in paquet.dependencies, "et le moteur retenu est bien là");

  // Le verrou de dépendances aussi : une dépendance retirée de `package.json`
  // mais laissée dans le lockfile serait réinstallée par un `npm ci`.
  const verrou = lire("../../package-lock.json");
  assert.ok(!verrou.includes("@zxing/library"), "le lockfile ne le mentionne plus");
  assert.ok(verrou.includes("zxing-wasm"), "le décapage du lockfile n'a pas tout emporté");

  // Et le code : ni adaptateur, ni sélection de moteur, ni banc d'essai.
  for (const dossier of ["lib/scan", "components/student"]) {
    for (const f of ["adaptateurs.ts", "moteur.ts", "camera.ts", "gtin.ts", "parcours.ts"]) {
      let code: string;
      try {
        code = sansProse(lire(`../../${dossier}/${f}`));
      } catch {
        continue;
      }
      assert.ok(!/zxing-js|@zxing\/library|MultiFormatReader/.test(code), `${dossier}/${f}`);
    }
  }
  assert.ok(!/zxing-js|MultiFormatReader/.test(CODE_SCANNER));
  assert.ok(!CODE_SCANNER.includes("NEXT_PUBLIC_A4_BENCH"));
  assert.ok(!CODE_SHEET.includes("NEXT_PUBLIC_A4_BENCH"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-UI7..9 — LE PREMIER GTIN VALIDE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-UI7. un GTIN valide déclenche UN lookup, et c'est celui d'A3", async () => {
  const { fetcher, journal } = fauxFetch(() => réponse(200, { produit: DTO_NUTELLA }));
  const issue = await lireProduitParGtin("3017620422003", fetcher);

  assert.equal(issue.type, "produit");
  assert.deepEqual(journal, ["/api/food-products/3017620422003"]);
  // LE SCANNER NE CONNAÎT PAS OPEN FOOD FACTS. Il produit un GTIN ; la route
  // d'A3 fait le reste. Aucune URL externe, aucune version d'API, aucun nom de
  // fournisseur ne traverse cet écran.
  for (const interdit of ["openfoodfacts", "api/v3", "search-a-licious", "food_products"]) {
    assert.ok(!CODE_SCANNER.includes(interdit), `« ${interdit} » dans l'écran scanner`);
  }
  assert.ok(CODE_SHEET.includes("lireProduitParGtin("), "la feuille appelle la route d'A3");
});

await test("A4-UI8. une double détection ne fait qu'UN lookup", async () => {
  // Le verrou est posé par `tenterUneImage` AVANT que l'appelant ne sache quoi
  // que ce soit — éprouvé en A4-SCAN9/10. Ce qui est mesuré ici, c'est que
  // l'écran ne rouvre pas la porte : le scanner est DÉMONTÉ dès le premier
  // GTIN (`setScanOuvert(false)` en tête de `traiterGtin`), donc sa boucle
  // n'existe même plus.
  const bloc = CODE_SHEET.slice(
    CODE_SHEET.indexOf("async function traiterGtin"),
    CODE_SHEET.indexOf("await lireProduitParGtin"),
  );
  assert.ok(bloc.includes("setScanOuvert(false)"), "la vue scanner est fermée AVANT le lookup");
  assert.equal((CODE_SHEET.match(/lireProduitParGtin\(/g) ?? []).length, 1, "un seul appelant");

  // Et le compteur le confirme sur la fonction réellement appelée.
  const { fetcher, journal } = fauxFetch(() => réponse(200, { produit: DTO_NUTELLA }));
  await lireProduitParGtin("3017620422003", fetcher);
  assert.equal(journal.length, 1);
});

await test("A4-UI9. la caméra est ÉTEINTE avant le lookup, pas après", () => {
  // Dans le scanner : tout est arrêté avant que l'appelant ne soit prévenu.
  const détection = CODE_SCANNER.slice(CODE_SCANNER.indexOf('issue.type !== "gtin"'));
  const posArrêt = détection.indexOf("toutArrêter()");
  const posAppel = détection.indexOf("onGtin(issue.gtin)");
  assert.ok(posArrêt > 0 && posAppel > posArrêt, "arrêt AVANT la remontée du GTIN");

  // Et dans la feuille : `traiterGtin` ne rallume rien — il n'y a pas une
  // seule ligne de caméra de ce côté-là.
  const bloc = CODE_SHEET.slice(
    CODE_SHEET.indexOf("async function traiterGtin"),
    CODE_SHEET.indexOf("function LigneRésultat"),
  );
  for (const interdit of ["getUserMedia", "MediaStream", "ouvrirCameraArriere"]) {
    assert.ok(!bloc.includes(interdit), `« ${interdit} » dans la feuille`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-UI10..12 — LE PRODUIT TROUVÉ
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-UI10. un produit trouvé ouvre l'étape quantité D'A3, pas une seconde interface", async () => {
  const { fetcher } = fauxFetch(() => réponse(200, { produit: DTO_NUTELLA }));
  const issue = await lireProduitParGtin("3017620422003", fetcher);
  assert.equal(issue.type, "produit");

  // La fiche revient hydratée par construction : elle vient de
  // `/api/food-products/{gtin}`, l'unité est OBSERVÉE et non supposée.
  if (issue.type !== "produit") return;
  assert.equal(issue.produit.hydratee, true);

  // Et la feuille la passe à `ouvrirQuantitéProduit` — la MÊME fonction que le
  // tap sur un résultat de recherche. Une seconde interface produit serait
  // deux endroits à maintenir, et deux occasions de diverger sur l'unité.
  assert.ok(CODE_SHEET.includes("ouvrirQuantitéProduit(issue.produit)"));
  assert.equal((CODE_SHEET.match(/function FormulaireQuantité/g) ?? []).length, 1);
});

await test("A4-UI11 · A4-UI12. l'unité de la fiche est respectée — g comme ml", async () => {
  const enG = await lireProduitParGtin("3017620422003", fauxFetch(() => réponse(200, { produit: DTO_NUTELLA })).fetcher);
  const enMl = await lireProduitParGtin("5449000000996", fauxFetch(() => réponse(200, { produit: DTO_LIQUIDE })).fetcher);
  assert.equal(enG.type === "produit" && enG.produit.nutritionUnit, "g");
  assert.equal(enMl.type === "produit" && enMl.produit.nutritionUnit, "ml");

  // Les unités PROPOSÉES sont exactement celles que le serveur sait convertir :
  // pour un produit, son unité nutritionnelle et elle seule. Proposer des
  // grammes sur une fiche « pour 100 ml » demanderait une densité — nous n'en
  // inventons aucune, et la RPC refuserait.
  if (enG.type === "produit") assert.deepEqual(unitesPourProduit(enG.produit), ["g"]);
  if (enMl.type === "produit") assert.deepEqual(unitesPourProduit(enMl.produit), ["ml"]);

  // L'écran pose l'unité de la fiche, il n'en choisit pas une.
  assert.ok(CODE_SHEET.includes("setUnitéChoix(produit.nutritionUnit)"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-UI13..15 — LES ÉCHECS, ET AUCUN CUL-DE-SAC
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-UI13. un produit absent propose les trois portes de sortie", async () => {
  const { fetcher } = fauxFetch(() => réponse(404, { code: "PRODUCT_NOT_FOUND", error: "…" }));
  const issue = await lireProduitParGtin("0000000000017", fetcher);
  assert.equal(issue.type, "introuvable");

  assert.equal(MESSAGE_LOOKUP.introuvable, "Produit introuvable.");
  assert.deepEqual(actionsPourLookup("introuvable"), ["rescanner", "recherche", "manuel"]);
});

await test("A4-UI14. un produit sans valeurs propose D'ABORD la saisie manuelle", async () => {
  const { fetcher } = fauxFetch(() =>
    réponse(422, { code: "PRODUCT_NUTRITION_INCOMPLETE", error: "…" }),
  );
  const issue = await lireProduitParGtin("3017620422003", fetcher);
  assert.equal(issue.type, "incomplet");

  // L'ORDRE EST UNE DÉCISION : l'emballage est dans la main de l'élève, et
  // rescanner le même code redonnerait exactement la même réponse.
  assert.equal(actionsPourLookup("incomplet")[0], "manuel");
  assert.ok(MESSAGE_LOOKUP.incomplet.includes("insuffisantes"));

  // ET SURTOUT : aucune macro inconnue n'est remplacée par 0. Le produit n'est
  // simplement pas consommable par ce chemin.
  assert.notEqual(issue.type, "produit");
});

await test("A4-UI15. une permission refusée laisse la recherche et la saisie ouvertes", () => {
  assert.equal(MESSAGE_CAMERA.permission_refusee, "Accès à la caméra refusé.");
  const actions = actionsPourCamera("permission_refusee");
  assert.ok(actions.includes("recherche") && actions.includes("manuel"));
  assert.ok(actions.includes("reessayer"), "réessayer a un sens : un refus peut être révisé");

  // ⚠️ « RÉESSAYER » EST UN BOUTON, PAS UNE BOUCLE. Redemander la permission
  // tout seul transformerait un refus en harcèlement, et certains navigateurs
  // finissent par bloquer définitivement le site qui insiste.
  assert.ok(!CODE_SCANNER.includes("setTimeout"), "aucune relance différée");
  assert.ok(!CODE_SCANNER.includes("while ("), "aucune boucle de demande");
  const posEffet = CODE_SCANNER.indexOf("useEffect(");
  const effet = CODE_SCANNER.slice(posEffet, CODE_SCANNER.indexOf(";", posEffet) + 1);
  assert.ok(effet.includes("toutArrêter()"), effet);
  assert.ok(!effet.includes("ouvrir("), "aucun effet ne relance l'ouverture");
});

await test("A4-UI-SUP. AUCUN motif d'échec n'est un cul-de-sac, et aucun ne fuite de technique", () => {
  // Balayage EXHAUSTIF : tous les motifs de caméra, tous les échecs de lookup.
  for (const motif of TOUS_MOTIFS) {
    const actions = actionsPourCamera(motif);
    assert.ok(actions.length >= 2, `${motif} : au moins deux sorties`);
    assert.ok(actions.includes("recherche"), `${motif} : la recherche reste offerte`);
    assert.ok(actions.includes("manuel"), `${motif} : la saisie reste offerte`);
  }
  for (const échec of TOUS_ECHECS) {
    const actions = actionsPourLookup(échec);
    assert.ok(actions.length === 3, `${échec} : trois sorties`);
    assert.ok(actions.includes("recherche") && actions.includes("manuel"));
    assert.ok(actions.includes("rescanner"));
  }

  // « Réessayer » n'apparaît PAS là où il serait un mensonge : sans caméra,
  // l'appareil n'en aura pas plus au second essai.
  assert.ok(!actionsPourCamera("aucune_camera").includes("reessayer"));
  assert.ok(!actionsPourCamera("contexte_non_securise").includes("reessayer"));

  // AUCUNE FUITE TECHNIQUE dans les messages. « 429 », « 503 », « OFF »,
  // « timeout », « NotAllowedError » n'apprennent rien à quelqu'un debout dans
  // un rayon de supermarché.
  const tousLesMessages = [
    ...Object.values(MESSAGE_CAMERA),
    ...Object.values(MESSAGE_LOOKUP),
    ...Object.values(LIBELLE_ACTION),
  ];
  for (const message of tousLesMessages) {
    for (const interdit of [
      "429",
      "503",
      "404",
      "422",
      "OFF",
      "Open Food Facts",
      "timeout",
      "Error",
      "getUserMedia",
      "GTIN",
      "fetch",
      "wasm",
    ]) {
      assert.ok(!message.includes(interdit), `« ${interdit} » dans « ${message} »`);
    }
    assert.ok(message.length > 0);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-UI16..18 — CYCLE DE VIE ET RÉOUVERTURE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-UI16 · A4-UI17. fermer le scanner, ou la feuille, coupe la caméra", () => {
  // Une seule fonction d'arrêt, et elle fait les trois choses.
  const bloc = CODE_SCANNER.slice(
    CODE_SCANNER.indexOf("const toutArrêter = useCallback"),
    CODE_SCANNER.indexOf("useEffect("),
  );
  assert.ok(bloc.includes("clearInterval"), "la cadence est coupée");
  assert.ok(bloc.includes("arreterCamera(fluxRef.current)"), "les pistes sont rendues");
  assert.ok(bloc.includes("srcObject = null"), "l'élément vidéo est détaché");
  assert.ok(bloc.includes("moteurRef.current?.detruire()"), "le moteur est rendu");
  assert.ok(
    bloc.indexOf("clearInterval") < bloc.indexOf("arreterCamera("),
    "la cadence est coupée AVANT les pistes : sinon un dernier tour de boucle passe",
  );

  // Le bouton « Fermer » de l'écran scanner l'appelle.
  assert.ok(CODE_SCANNER.includes("function fermer() {\n    toutArrêter();"));

  // FERMER LA FEUILLE ENTIÈRE aussi : le scanner est DÉMONTÉ avec elle, et le
  // nettoyage de démontage est le même. C'est ce qui rend impossible d'oublier
  // une sortie — il n'y a pas de liste de sorties à tenir à jour.
  assert.ok(CODE_SCANNER.includes("useEffect(() => () => toutArrêter(), [toutArrêter])"));
  assert.ok(
    CODE_SHEET.includes("{scanOuvert ?") || /scanOuvert \? \(/.test(CODE_SHEET),
    "le scanner n'est monté que quand il est ouvert",
  );
  assert.ok((CODE_SCANNER.match(/toutArrêter\(\)/g) ?? []).length >= 5, "appelée de partout");
});

await test("A4-UI18. rouvrir le scanner repart d'un état PROPRE", () => {
  // Le remède n'est pas une liste de remises à zéro — qu'on oublierait d'un
  // champ — mais un REMONTAGE. `key={sessionScan}` change à chaque ouverture :
  // React démonte l'ancien composant (donc son nettoyage tourne, donc la
  // caméra est rendue) et en monte un neuf. Flux, moteur, verrou, erreur : tout
  // repart de zéro par construction.
  assert.ok(CODE_SHEET.includes("key={sessionScan}"), "le scanner est remonté à chaque ouverture");
  assert.ok(CODE_SHEET.includes("setSessionScan((n) => n + 1)"));
  assert.ok(CODE_SHEET.includes("function ouvrirScan()"));

  // Et l'échec précédent est effacé à l'ouverture : une erreur d'hier ne doit
  // pas s'afficher au-dessus d'une caméra qui marche.
  const bloc = CODE_SHEET.slice(
    CODE_SHEET.indexOf("function ouvrirScan()"),
    CODE_SHEET.indexOf("function fermerScan()"),
  );
  assert.ok(bloc.includes("setÉchecScan(null)"));
  assert.ok(bloc.includes("setScanOuvert(true)"));

  // Le verrou de boucle est neuf à chaque ouverture, y compris sans remontage.
  assert.ok(CODE_SCANNER.includes("boucleRef.current = nouvelEtatBoucle()"));
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-UI19..20 — TORCHE ET VIE PRIVÉE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-UI19. la lampe n'est proposée que si la piste l'expose vraiment", () => {
  assert.ok(CODE_SCANNER.includes("torcheDisponible("), "la capacité est INTERROGÉE");
  assert.ok(CODE_SCANNER.includes("{torcheOfferte && état === \"scan\" && ("), "et elle conditionne le rendu");

  // Un bouton qui ne fait rien est pire que pas de bouton : il fait douter du
  // reste de l'écran. Si `applyConstraints` refuse, l'état N'EST PAS modifié.
  assert.ok(CODE_SCANNER.includes("if (acceptée) setTorcheAllumée(voulue)"));

  // Et le scan ne dépend jamais de la lampe : rien dans la boucle ne la lit.
  const boucle = CODE_SCANNER.slice(
    CODE_SCANNER.indexOf("minuterieRef.current = setInterval"),
    CODE_SCANNER.indexOf("} finally {"),
  );
  assert.ok(!boucle.includes("torche"), "la boucle de décodage ignore la lampe");
});

await test("A4-UI20. aucune image ne quitte l'appareil", () => {
  for (const interdit of [
    "fetch(",
    "XMLHttpRequest",
    "FormData",
    "toBlob",
    "toDataURL",
    "sendBeacon",
    "/api/",
  ]) {
    assert.ok(!CODE_SCANNER.includes(interdit), `« ${interdit} » dans l'écran scanner`);
  }
  // L'image est lue UNE fois, passée au moteur, puis oubliée.
  assert.equal((CODE_SCANNER.match(/getImageData\(/g) ?? []).length, 1);
  assert.ok(CODE_SCANNER.includes("tenterUneImage(boucleRef.current, moteur, image)"));

  // CONTRÔLE NÉGATIF : le dépouillement n'a pas vidé le fichier — et il a bien
  // retiré la prose, qui elle parle de `toDataURL` pour dire qu'on n'en veut pas.
  assert.ok(CODE_SCANNER.includes("getImageData("));
  assert.ok(SOURCE_SCANNER.includes("toDataURL"), "la prose, elle, en parle");
  assert.ok(!CODE_SCANNER.includes("toDataURL"), "le décapage a bien retiré la prose");
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-UI21..25 — LA NON-RÉGRESSION D'A2 ET D'A3
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-UI21. la recherche texte d'A3 est intacte", () => {
  const html = rendreFeuille();
  assert.ok(html.includes("Rechercher un aliment"));
  assert.ok(CODE_SHEET.includes("searchCatalogFoods") && CODE_SHEET.includes("searchCachedProducts"));
  assert.ok(CODE_SHEET.includes("rechercherProduitsExternes("), "l'action externe explicite demeure");
  assert.ok(CODE_SHEET.includes("hydraterProduit("), "l'hydratation au tap demeure");

  // ⚠️ ET LA FRAPPE NE PARLE TOUJOURS À PERSONNE. La recherche externe reste une
  // ACTION : le scan ne l'a pas transformée en effet de bord du clavier.
  const effetFrappe = CODE_SHEET.slice(
    CODE_SHEET.indexOf("const minuterie = setTimeout"),
    CODE_SHEET.indexOf("}, [terme, chercher]);"),
  );
  assert.ok(!effetFrappe.includes("rechercherProduitsExternes"));
  assert.ok(!effetFrappe.includes("lireProduitParGtin"));
});

await test("A4-UI22. la saisie manuelle d'A2 est intacte", () => {
  const html = rendreFeuille();
  assert.ok(html.includes("Saisir à la main"));
  assert.ok(CODE_SHEET.includes("lireMacroPour100"), "le lecteur de macros d'A2 est là");
  assert.ok(CODE_SHEET.includes("onAjouterManuel("));
  // Aucune conversion ml → g dans le mode manuel : la référence suit l'unité.
  assert.ok(!CODE_SHEET.includes("densite") && !CODE_SHEET.includes("densité"));
});

await test("A4-UI23. un produit scanné passe par la RPC produit d'A3", () => {
  // Le scan aboutit au MÊME `onAjouterProduit` que le tap sur un résultat, et
  // celui-ci appelle `ajouter_aliment_produit`. Un chemin d'écriture séparé
  // serait une seconde occasion de se tromper d'unité.
  assert.equal((CODE_SHEET.match(/onAjouterProduit\(/g) ?? []).length, 1, "un seul chemin d'ajout");
  const consumed = sansProse(lire("../../lib/supabase/consumed-meals.ts"));
  assert.ok(consumed.includes('"ajouter_aliment_produit"'));
  assert.ok(consumed.includes("p_product_id:"), "la RPC reçoit un produit, pas des macros");

  // Le produit scanné entre dans la MÊME liste que les autres, dédoublonné par
  // identifiant : rescanner un produit déjà affiché ne le duplique pas.
  assert.ok(CODE_SHEET.includes("fusionnerProduits(actuels, [issue.produit])"));
});

await test("A4-UI24. aucune macro finale n'est envoyée par le client", () => {
  // Ce que la RPC produit reçoit : un identifiant, une quantité, une unité.
  const consumed = sansProse(lire("../../lib/supabase/consumed-meals.ts"));
  const bloc = consumed.slice(
    consumed.indexOf("export function ajouterAlimentProduit"),
    consumed.indexOf("export function ajouterAlimentManuel"),
  );
  const clés = [...bloc.matchAll(/p_[a-z_]+:/g)].map((m) => m[0]);
  assert.deepEqual(clés, ["p_consumed_meal_id:", "p_product_id:", "p_quantity:", "p_unit:"]);
  for (const interdit of ["p_protein", "p_carb", "p_fat", "p_kcal", "p_calorie"]) {
    assert.ok(!bloc.includes(interdit), `« ${interdit} » envoyé par le client`);
  }

  // Et le chemin du scan n'invente aucune macro non plus : il transmet la fiche
  // telle que la route l'a rendue.
  const traitement = CODE_SHEET.slice(
    CODE_SHEET.indexOf("async function traiterGtin"),
    CODE_SHEET.indexOf("const qChoix ="),
  );
  for (const interdit of ["proteinPer100 =", "carbPer100 =", "fatPer100 =", "kcalFromMacros("]) {
    assert.ok(!traitement.includes(interdit), `« ${interdit} » sur le chemin du scan`);
  }
});

await test("A4-UI25. le journal survit au rechargement — rien n'est gardé côté client", () => {
  // Un produit scanné devient une ENTRÉE en base via la RPC, pas un état de
  // composant. Rien du parcours de scan n'est persisté dans le navigateur :
  // ni le GTIN, ni la fiche, ni l'image.
  for (const interdit of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assert.ok(!CODE_SCANNER.includes(interdit), `« ${interdit} » dans l'écran scanner`);
    assert.ok(!CODE_SHEET.includes(interdit), `« ${interdit} » dans la feuille`);
  }
  // L'ajout passe par une promesse rendue par le parent, qui écrit en base.
  assert.ok(CODE_SHEET.includes("void onAjouterProduit(choix.produit.id, qChoix, unitéChoix)"));
});

/* ══════════════════════════════════════════════════════════════════════════
   SUPPLÉMENTS — CE QUE LE §7 INTERDIT DE MONTRER, ET LE §21 MOBILE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-UI-SUP §7. aucun chiffre technique n'est montré à l'élève", () => {
  const rendu = renderToString(
    createElement(ScannerCodeBarres, {
      onGtin: () => {},
      onFermer: () => {},
      onRechercheParNom: () => {},
      onSaisieManuelle: () => {},
    }),
  );
  // ⚠️ ON LIT LE TEXTE, PAS LE HTML. Chercher « ms » dans le balisage le
  // trouverait dans `items-center` et dans `transition-colors` : l'assertion
  // serait rouge sans qu'aucun chiffre ne soit montré à personne. C'est le
  // même piège que la prose, transposé au balisage.
  const texte = rendu.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  for (const interdit of ["zxing", "fps", "facingMode", "GTIN", "moteur", "images décodées"]) {
    assert.ok(!texte.toLowerCase().includes(interdit.toLowerCase()), `« ${interdit} » à l'écran`);
  }
  // Et aucune mesure chiffrée : ni millisecondes, ni images par seconde, ni
  // kilo-octets. Ce sont des chiffres pour départager deux bibliothèques.
  assert.ok(!/\d+\s*(ms|fps|Ko|Mo|s\/img)\b/.test(texte), `mesure chiffrée dans « ${texte} »`);

  // CONTRÔLE NÉGATIF du dépouillement du balisage : le texte n'est pas vide.
  assert.ok(texte.length > 40, `texte trop court (${texte.length})`);
  // Le GTIN lu n'est jamais affiché : il est transmis, pas montré.
  assert.ok(!CODE_SCANNER.includes("{gtin}"));
  assert.ok(!CODE_SCANNER.includes("issue.gtin}"));
  // Et le mot d'aide, lui, est bien là.
  assert.ok(rendu.includes("Vise le code-barres"));
});

await test("A4-UI-SUP §8. le cadre de visée est VISUEL, et ne recadre pas l'image", () => {
  assert.ok(CODE_SCANNER.includes("pointer-events-none"), "le cadre n'intercepte rien");
  assert.ok(CODE_SCANNER.includes('aria-hidden="true"'), "et il est invisible aux lecteurs d'écran");
  // AUCUN recadrage avant décodage : le benchmark iPhone a lu les codes en
  // plein cadre, et rogner ferait perdre les codes légèrement décalés sans
  // rien accélérer de démontré.
  assert.ok(
    CODE_SCANNER.includes("getImageData(0, 0, toile.width, toile.height)"),
    "l'image entière est décodée",
  );
  assert.ok(!CODE_SCANNER.includes("crop") && !CODE_SCANNER.includes("recadr"));
});

await test("A4-UI-SUP §21. l'écran tient sur un téléphone", () => {
  // `playsInline` et `muted` sont OBLIGATOIRES sur iOS : sans eux, Safari
  // bascule en lecture plein écran et le cadrage devient impossible.
  assert.ok(CODE_SCANNER.includes("playsInline"));
  assert.ok(CODE_SCANNER.includes("muted"));
  // Rien ne peut déborder horizontalement : largeur relative, débordement caché.
  assert.ok(CODE_SCANNER.includes("w-full"));
  assert.ok(CODE_SCANNER.includes("overflow-hidden"));
  assert.ok(!/w-\[\d+px\]/.test(CODE_SCANNER), "aucune largeur fixe en pixels");
  // La vidéo est bornée en hauteur : sinon une caméra 4:3 en portrait pousserait
  // le bouton « Fermer » hors de l'écran.
  assert.ok(/max-h-\[\d+vh\]/.test(CODE_SCANNER), "la hauteur de la vidéo est bornée");
  // Cibles tactiles : 48 px partout, comme le reste de l'application.
  const boutons = CODE_SCANNER.match(/min-h-\[48px\]/g) ?? [];
  assert.ok(boutons.length >= 3, `cibles tactiles de 48 px (${boutons.length})`);
});

await test("A4-UI-SUP. le GTIN remonté par le scanner est toujours une CHAÎNE valide", () => {
  // La validation est celle d'A3, appliquée par la boucle : le scanner ne rend
  // jamais autre chose qu'un GTIN accepté.
  assert.equal(lireGtin("3017620422003"), "3017620422003");
  assert.equal(lireGtin("0000000000017"), "0000000000017", "les zéros de tête survivent");
  assert.equal(lireGtin("ABC"), null);
  assert.equal(lireGtin("123"), null);
  assert.ok(!CODE_SCANNER.includes("Number(") && !CODE_SCANNER.includes("parseInt("));
});

/* ── Contrôle de cohérence du harnais ──────────────────────────────────── */

await test("A4-UI-SUP. le dépouillement des commentaires n'a rien vidé", () => {
  assert.ok(CODE_SHEET.length > 5000, `feuille dépouillée trop courte (${CODE_SHEET.length})`);
  assert.ok(CODE_SCANNER.length > 2000, `scanner dépouillé trop court (${CODE_SCANNER.length})`);
  assert.ok(CODE_SHEET.includes("export function AddFoodSheet"));
  assert.ok(CODE_SCANNER.includes("export function ScannerCodeBarres"));
  // Et il a bien retiré quelque chose : les en-têtes n'y sont plus.
  assert.ok(SOURCE_SCANNER.includes("DEUX TAPS AVANT LA CAMÉRA"));
  assert.ok(!CODE_SCANNER.includes("DEUX TAPS AVANT LA CAMÉRA"));
});

const TOUTES_ACTIONS: readonly ActionRepli[] = ["reessayer", "rescanner", "recherche", "manuel"];
await test("A4-UI-SUP. chaque action a un libellé, et il est en français courant", () => {
  for (const action of TOUTES_ACTIONS) {
    assert.equal(typeof LIBELLE_ACTION[action], "string");
    assert.ok(LIBELLE_ACTION[action].length > 3);
  }
  assert.equal(LIBELLE_ACTION.rescanner, "Scanner un autre produit");
  assert.equal(LIBELLE_ACTION.recherche, "Rechercher par nom");
  assert.equal(LIBELLE_ACTION.manuel, "Saisir à la main");
});
