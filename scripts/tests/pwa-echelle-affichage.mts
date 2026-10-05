import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PWA — L'ÉCHELLE D'AFFICHAGE NE BOUGE PLUS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET COMMENT
 * ────────────────────────────────────────────────────────────────────────────
 * Deux niveaux, et chacun prouve ce que l'autre ne peut pas :
 *
 * 1. L'objet `viewport` de `app/layout.tsx` est RECONSTRUIT puis mesuré
 *    NUMÉRIQUEMENT. Ce ne sont pas des chaînes cherchées dans un fichier :
 *    `maximumScale: 2` échouerait là où un simple contrôle de présence
 *    passerait.
 *
 *    ⚠️ POURQUOI PAS UN `import` DU MODULE. `app/layout.tsx` fait
 *    `import "./globals.css"`, que le lanceur de tests ne sait pas analyser
 *    (`SyntaxError` sur `@import "tailwindcss"`). C'est pour cette raison que
 *    `home-theme.mts` et `aliments-a5-responsive.mts` lisent eux aussi ce
 *    fichier comme du TEXTE. On suit la convention du dépôt, et on compense
 *    en reconstruisant l'objet au lieu de se contenter de chercher des mots.
 * 2. Les règles CSS et les règles d'ARCHITECTURE — « aucun second viewport »,
 *    « aucun `preventDefault` tactile », « aucun blocage du défilement » —
 *    sont vérifiées sur le texte des fichiers : une absence ne s'observe pas
 *    à l'exécution.
 *
 * ⚠️ CE HARNAIS NE PROUVE PAS LE COMPORTEMENT D'UN IPHONE. Aucun test
 * statique ne le peut. Il prouve que la configuration DEMANDÉE est bien celle
 * qui part vers le navigateur, et que rien dans le dépôt ne la contredit. Le
 * comportement réel sur WebKit ne se constate que sur un appareil physique.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST CORRIGÉ, ET CE QUI EST DÉLIBÉRÉMENT LAISSÉ LIBRE
 * ────────────────────────────────────────────────────────────────────────────
 * Le défaut corrigé est le ZOOM AUTOMATIQUE AU FOCUS d'un champ, et il l'est
 * par le plancher de 16px (contrôles E13 à E17). C'est la cause mesurée :
 * `text-sm` = 14px, et WebKit zoome sous 16px.
 *
 * ⚠️ LE ZOOM DE L'UTILISATEUR — pincement, double-tap — RESTE AUTORISÉ, et
 * E5/E6/E8 le VÉRIFIENT. Ce n'est pas un oubli : `maximum-scale` et
 * `user-scalable=no` ne changent rien au zoom au focus, et le lot A5.9 a figé
 * la garantie « on ne bloque jamais le zoom de l'utilisateur » dans
 * scripts/tests/aliments-a5-responsive.mts (contrôle RESP-SUP). Ce harnais
 * défend le MÊME contrat, depuis l'autre bout : une suite qui exigerait ces
 * propriétés et une suite qui les interdirait ne pourraient pas être vertes
 * ensemble, et c'est bien ce qu'on veut — une seule règle, dite deux fois.
 *
 * Lancement : npm run test:pwa-echelle
 */

const RACINE = fileURLToPath(new URL("../..", import.meta.url));
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

const LAYOUT = lire("app/layout.tsx");
const CSS = lire("app/globals.css");

/**
 * ⚠️ LES COMMENTAIRES SONT RETIRÉS AVANT TOUT COMPTAGE.
 *
 * Le layout NOMME en prose la règle qu'il respecte (« AUCUN AUTRE
 * `export const viewport` NE DOIT EXISTER »). Un comptage posé sur le texte
 * brut trouverait deux occurrences et rougirait sur la phrase qui explique la
 * règle — exactement l'inverse de ce qu'on mesure.
 */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}
const CODE_LAYOUT = sansProse(LAYOUT);

/**
 * L'objet `viewport` du layout racine, RECONSTRUIT depuis sa source.
 *
 * Le littéral est extrait, dépouillé de ses commentaires, puis chaque paire
 * `clé: valeur` est convertie dans son type réel — nombre, booléen ou
 * chaîne. Une clé dont la valeur n'est pas un littéral simple lève : il vaut
 * mieux un test qui refuse de conclure qu'un test qui conclut à tort.
 */
function viewportDuLayout(): Record<string, string | number | boolean> {
  const debut = LAYOUT.indexOf("export const viewport: Viewport = {");
  assert.ok(debut >= 0, "app/layout.tsx doit exporter `viewport`");
  const fin = LAYOUT.indexOf("};", debut);
  assert.ok(fin > debut, "le littéral `viewport` doit se fermer");
  const corps = LAYOUT.slice(debut + "export const viewport: Viewport = {".length, fin)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, "");

  const objet: Record<string, string | number | boolean> = {};
  for (const morceau of corps.split(",")) {
    const net = morceau.trim();
    if (!net) continue;
    // `[\s\S]` plutôt que le drapeau `s` : la cible TypeScript du projet
    // n'autorise pas `dotAll` (TS1501).
    const paire = net.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+)$/);
    assert.ok(paire, `paire clé/valeur illisible dans le viewport : \`${net}\``);
    const [, cle, brut] = paire!;
    const valeur = brut.trim();
    if (/^-?\d+(\.\d+)?$/.test(valeur)) objet[cle] = Number(valeur);
    else if (valeur === "true") objet[cle] = true;
    else if (valeur === "false") objet[cle] = false;
    else if (/^"[^"]*"$/.test(valeur) || /^'[^']*'$/.test(valeur)) objet[cle] = valeur.slice(1, -1);
    else assert.fail(`valeur non littérale pour \`${cle}\` : ${valeur}`);
  }
  return objet;
}
const viewport = viewportDuLayout();

/** Retire les commentaires CSS : une règle ne se prouve pas en prose. */
function cssSansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ");
}
const CODE_CSS = cssSansCommentaires(CSS);

/** Tous les fichiers source du dépôt, hors dépendances et artefacts. */
function fichiersSource(): string[] {
  const trouves: string[] = [];
  const ignore = new Set(["node_modules", ".next", ".git", "Claude outputs"]);
  function parcourir(relatif: string) {
    for (const entree of readdirSync(join(RACINE, relatif))) {
      if (ignore.has(entree)) continue;
      const rel = relatif ? `${relatif}/${entree}` : entree;
      const infos = statSync(join(RACINE, rel));
      if (infos.isDirectory()) {
        parcourir(rel);
      } else if (/\.(ts|tsx|js|jsx|css|mts)$/.test(entree)) {
        trouves.push(rel);
      }
    }
  }
  for (const racine of ["app", "components", "hooks", "lib", "public"]) parcourir(racine);
  return trouves;
}
const SOURCES = fichiersSource();

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
 * I. LE VIEWPORT — LES VALEURS RÉELLES, PAS LEUR ORTHOGRAPHE
 * ════════════════════════════════════════════════════════════════════════ */

test("E1. une configuration viewport globale existe et est exportée", () => {
  assert.ok(viewport, "app/layout.tsx doit exporter `viewport`");
  assert.equal(typeof viewport, "object");
  // L'export doit être dans le ROOT layout, pas ailleurs : c'est lui qui
  // couvre toute l'application.
  assert.match(LAYOUT, /export const viewport: Viewport = \{/);
});

test("E2. width = device-width", () => {
  assert.equal(viewport.width, "device-width");
});

test("E3. initial-scale = 1", () => {
  assert.equal(viewport.initialScale, 1);
});

test("E4. minimum-scale = 1", () => {
  // Sans lui, un document qui déborde horizontalement peut s'ouvrir à une
  // échelle inférieure à 1 sur certains moteurs : toute l'interface rétrécit.
  assert.equal(viewport.minimumScale, 1);
});

test("E5. `maximum-scale` n'est PAS pose : le zoom utilisateur reste possible", () => {
  // ATTENTION : CE CONTROLE EST INVERSE PAR RAPPORT A L'INTENTION INITIALE DU
  // CHANTIER, et c'est un arbitrage explicite (option B, valide par Jules).
  //
  // `maximum-scale` ne change RIEN au zoom automatique au focus d'un champ --
  // celui-ci est traite par le plancher de 16px (E13 a E17). Ce qu'il borne,
  // c'est le PINCEMENT de l'utilisateur. Le poser aurait donc coute une
  // regression d'accessibilite sans rien gagner sur le defaut a corriger.
  //
  // Le contrat est anterieur a ce chantier : le lot A5.9 l'a fige dans
  // scripts/tests/aliments-a5-responsive.mts (controle RESP-SUP, assertion
  // "aucun plafond de zoom"). Les deux tests disent desormais la meme chose,
  // depuis deux endroits : si quelqu'un reintroduit la propriete pour
  // "stabiliser l'echelle", DEUX suites rougissent, pas une.
  assert.ok(
    !("maximumScale" in viewport),
    "maximumScale borne le pincement sans rien corriger : contrat A5.9",
  );
  assert.ok(
    !/maximumScale/.test(CODE_LAYOUT),
    "maximumScale ne doit pas apparaitre dans le code du layout",
  );
});

test("E6. `user-scalable=no` n'est PAS pose : le pincement reste autorise", () => {
  // Meme raison que E5, et meme contrat A5.9 ("aucun blocage du zoom
  // utilisateur"). Un utilisateur malvoyant doit pouvoir pincer pour agrandir,
  // dans l'application comme ailleurs.
  //
  // Rappel du fait technique qui rend ce choix sans cout : Safari iOS IGNORE
  // de toute facon `user-scalable=no` depuis iOS 10, par accessibilite. La
  // propriete n'aurait eu d'effet que sur Chromium Android et dans les PWA
  // installees -- c'est-a-dire exactement la ou elle aurait fait du mal, et
  // nulle part ou elle aurait fait du bien.
  assert.ok(
    !("userScalable" in viewport),
    "userScalable: false bloque le pincement : contrat A5.9",
  );
  assert.ok(
    !/userScalable/.test(CODE_LAYOUT),
    "userScalable ne doit pas apparaitre dans le code du layout",
  );
});

test("E7. themeColor n'a pas été perdu en chemin", () => {
  // Contrôle de non-régression : la correction d'échelle ne doit pas avoir
  // écrasé le réglage préexistant de la barre système.
  assert.equal(viewport.themeColor, "#050505");
});

test("E8. l'echelle de depart est a 1, et rien ne borne le geste de l'utilisateur", () => {
  // MESURE NUMERIQUE, PAS TEXTUELLE. Un `initialScale: 0.9` ou un
  // `minimumScale: 0.5` passeraient un simple controle de presence tout en
  // laissant l'interface s'ouvrir reduite.
  assert.equal(viewport.minimumScale, viewport.initialScale);
  assert.equal(viewport.initialScale, 1);
  assert.ok(
    typeof viewport.minimumScale === "number" && viewport.minimumScale >= 1,
    "minimumScale doit valoir au moins 1",
  );

  // Et AUCUNE borne sur le geste : ni plafond, ni interdiction. `minimumScale`
  // borne l'echelle que le NAVIGATEUR choisit au chargement, pas le pincement.
  // C'est toute la distinction que le contrat A5.9 protege.
  for (const interdite of ["maximumScale", "userScalable"]) {
    assert.ok(!(interdite in viewport), `${interdite} ne doit pas etre pose`);
  }

  // Les cles effectivement declarees sont ENUMEREES : une propriete d'echelle
  // ajoutee sous un autre nom serait vue ici.
  assert.deepEqual(
    Object.keys(viewport).sort(),
    ["initialScale", "minimumScale", "themeColor", "width"],
    "le viewport ne doit porter que ces quatre cles",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * II. AUCUNE CONFIGURATION CONCURRENTE
 * ════════════════════════════════════════════════════════════════════════ */

test("E9. un SEUL `export const viewport` dans tout le dépôt", () => {
  // Next.js résout la métadonnée du layout le PLUS PROCHE de la page : un
  // second viewport dans un layout enfant écraserait silencieusement celui
  // de la racine pour toute une branche de l'application.
  const porteurs = SOURCES.filter((f) => /export const viewport\b/.test(sansProse(lire(f))));
  assert.deepEqual(
    porteurs,
    ["app/layout.tsx"],
    `viewport déclaré ailleurs qu'au layout racine : ${porteurs.join(", ")}`,
  );
  // Et une seule fois dans ce fichier — mesuré sur le CODE.
  assert.equal((CODE_LAYOUT.match(/export const viewport\b/g) ?? []).length, 1);
});

test("E10. aucune balise <meta viewport> posee a la main dans l'application", () => {
  // Elle entrerait en concurrence avec celle que Next.js emet, et l'ordre des
  // deux dans le <head> n'est pas garanti.
  //
  // ATTENTION : `lib/email/templates/` EST EXCLU, et ce n'est pas une
  // commodite. Ces fichiers produisent des e-mails HTML, pas des pages de
  // l'application : leur meta viewport est lu par Gmail ou Apple Mail, jamais
  // par la PWA, et il doit rester. L'exclusion est nommee precisement plutot
  // que large, pour qu'un meta viewport ajoute ailleurs soit toujours detecte.
  const horsApplication = (f: string) => f.startsWith("lib/email/");
  const motif = /<meta[^>]*name=.viewport./;
  const coupables = SOURCES.filter((f) => !horsApplication(f) && motif.test(lire(f)));
  assert.deepEqual(coupables, [], `meta viewport manuel : ${coupables.join(", ")}`);
  // Controle du controle : l'exclusion ne doit pas tout avaler, et elle doit
  // viser un fichier qui porte REELLEMENT la balise.
  const exclus = SOURCES.filter((f) => horsApplication(f) && motif.test(lire(f)));
  assert.ok(exclus.length > 0, "l'exclusion vise des fichiers qui existent");
});

test("E11. aucune `generateViewport` concurrente", () => {
  // L'autre API Next.js pour la même métadonnée. Une seule stratégie.
  const coupables = SOURCES.filter((f) => /generateViewport/.test(lire(f)));
  assert.deepEqual(coupables, [], `generateViewport trouvée : ${coupables.join(", ")}`);
});

test("E12. le manifeste ne contredit pas l'échelle", () => {
  const manifeste = lire("app/manifest.ts");
  // `display: standalone` est le mode où WebKit HONORE la borne d'échelle.
  assert.match(manifeste, /display:\s*"standalone"/);
  // Un manifeste ne porte aucune propriété d'échelle : s'il s'en inventait
  // une, ce serait un signal.
  assert.ok(!/scale|user_scalable/i.test(manifeste));
});

/* ════════════════════════════════════════════════════════════════════════
 * III. LE PLANCHER DE 16px — LA VRAIE CAUSE DU ZOOM AU FOCUS
 * ════════════════════════════════════════════════════════════════════════ */

/** La règle de plancher, extraite du CSS dépouillé de ses commentaires. */
function regleplancher(): { media: string; selecteur: string; corps: string } {
  const motif =
    /@media\s*\(max-width:\s*(\d+)px\)\s*\{\s*((?:input|textarea|select)(?:\s*,\s*(?:input|textarea|select))*)\s*\{([^}]*)\}\s*\}/;
  const trouve = CODE_CSS.match(motif);
  assert.ok(
    trouve,
    "la règle `@media (max-width: …) { input, textarea, select { … } }` doit exister dans app/globals.css",
  );
  return { media: trouve![1], selecteur: trouve![2], corps: trouve![3] };
}

test("E13. une règle garantit >= 16px pour les `input` sur mobile", () => {
  const { corps, media } = regleplancher();
  const taille = corps.match(/font-size:\s*(\d+)px/);
  assert.ok(taille, "la règle doit poser une `font-size` en pixels");
  // ⚠️ MESURE NUMÉRIQUE. `font-size: 14px !important` passerait un simple
  // contrôle de présence tout en réintroduisant exactement le défaut.
  assert.ok(
    Number(taille![1]) >= 16,
    `plancher à ${taille![1]}px : WebKit zoome en dessous de 16px`,
  );
  // En pixels, pas en `rem` : le seuil de WebKit est absolu, et `1rem` suit
  // la taille de base du document, que l'utilisateur peut réduire.
  assert.ok(!/font-size:\s*[\d.]+r?em/.test(corps), "le plancher doit être en px");
  // Le point de rupture doit couvrir les téléphones (>= 390px, l'iPhone le
  // plus étroit encore en service est à 320px).
  assert.ok(Number(media) >= 390, `point de rupture à ${media}px : trop étroit`);
  // Et le sélecteur doit bien porter `input`.
  assert.ok(regleplancher().selecteur.includes("input"));
});

test("E14. la meme regle couvre `textarea`", () => {
  const { corps, selecteur } = regleplancher();
  assert.ok(Number(corps.match(/font-size:\s*(\d+)px/)![1]) >= 16);
  // Le selecteur est extrait et ses balises sont ENUMEREES : les trois doivent
  // y etre, et rien d'autre ne doit s'y etre glisse.
  const balises = selecteur.split(",").map((b) => b.trim()).filter(Boolean).sort();
  assert.deepEqual(balises, ["input", "select", "textarea"]);
});

test("E15. la même règle couvre `select`", () => {
  const { corps } = regleplancher();
  assert.ok(Number(corps.match(/font-size:\s*(\d+)px/)![1]) >= 16);
});

test("E16. le plancher s'impose aux classes utilitaires", () => {
  // ⚠️ SANS `!important`, LA RÈGLE EST DÉCORATIVE. `input` est un sélecteur
  // de type (spécificité 0,0,1) ; `text-sm` est une classe (0,1,0) et gagne
  // toujours. Ce contrôle existe parce que retirer `!important` en croyant
  // « nettoyer » ramènerait le zoom sans qu'aucun autre test ne bouge.
  const { corps } = regleplancher();
  assert.match(corps, /!important/, "le plancher doit l'emporter sur `text-sm`");
});

test("E17. le plancher ne change pas le design de bureau", () => {
  const { media } = regleplancher();
  // Borné à `max-width` : au-delà, les champs gardent leur taille d'origine.
  assert.ok(Number(media) <= 1024, "le plancher ne doit pas s'appliquer au bureau");
  // Et il ne touche QUE `font-size` : ni padding, ni bordure, ni largeur.
  const { corps } = regleplancher();
  const proprietes = [...corps.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  assert.deepEqual(
    proprietes,
    ["font-size"],
    `le plancher ne doit toucher que font-size, or : ${proprietes.join(", ")}`,
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. `text-size-adjust`
 * ════════════════════════════════════════════════════════════════════════ */

test("E18. une stratégie `text-size-adjust` cohérente et préfixée", () => {
  const regle = CODE_CSS.match(/html\s*\{([^}]*text-size-adjust[^}]*)\}/);
  assert.ok(regle, "`text-size-adjust` doit être posé sur `html`");
  const corps = regle![1];
  // La propriété standard ET le préfixe WebKit : Safari et Chromium Android
  // ne lisent encore que le second.
  assert.match(corps, /(^|[^-])text-size-adjust:\s*100%/, "propriété standard requise");
  assert.match(corps, /-webkit-text-size-adjust:\s*100%/, "préfixe -webkit- requis");
  // `100%` et non `none` : `none` retire aussi l'agrandissement MANUEL du
  // texte sur certains moteurs, ce qui est un recul d'accessibilité.
  assert.ok(
    !/text-size-adjust:\s*none/.test(corps),
    "`none` casserait l'agrandissement manuel du texte",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * V. CE QUI NE DOIT PAS AVOIR ÉTÉ FAIT
 * ════════════════════════════════════════════════════════════════════════ */

test("E19. aucun hack JavaScript global contre le zoom", () => {
  // Pas de `preventDefault` tactile, nulle part. Le dépôt n'en contenait
  // aucun avant ce chantier, et il n'en contient toujours aucun.
  const coupables: string[] = [];
  for (const f of SOURCES) {
    if (!/\.(ts|tsx|js|jsx)$/.test(f)) continue;
    const src = lire(f);
    if (/addEventListener\(\s*["']touch(start|move|end)["']/.test(src)) coupables.push(`${f} (listener touch)`);
    if (/on(TouchStart|TouchMove|TouchEnd)=/.test(src)) coupables.push(`${f} (prop touch)`);
    if (/gesturestart|gesturechange|gestureend/.test(src)) coupables.push(`${f} (gesture WebKit)`);
    if (/\.scale\s*=\s*1|visualViewport[^.]*\.scale\s*=/.test(src)) coupables.push(`${f} (échelle forcée en JS)`);
  }
  assert.deepEqual(coupables, [], `hack tactile détecté : ${coupables.join(", ")}`);
});

test("E20. aucun `body { position: fixed }` global", () => {
  // Bloquer la page n'est pas une correction d'échelle : c'est une
  // suppression du défilement.
  const motif = /(^|\})\s*(html\s*,\s*body|body\s*,\s*html|body|html)\s*\{[^}]*position:\s*fixed/;
  assert.ok(!motif.test(CODE_CSS), "`position: fixed` sur body/html est interdit ici");
});

test("E21. aucun `overflow: hidden` global", () => {
  // Même raison. Les `overflow: hidden` préexistants sont tous portés par
  // des conteneurs nommés (une image ronde, une colonne de modale) — ce
  // contrôle ne vise que `html` et `body`.
  const motif = /(^|\})\s*(html\s*,\s*body|body\s*,\s*html|body|html)\s*\{[^}]*overflow(-x|-y)?:\s*hidden/;
  assert.ok(!motif.test(CODE_CSS), "`overflow: hidden` sur body/html est interdit ici");
});

test("E22. le defilement n'est bloque nulle part globalement", () => {
  // On inspecte CHAQUE regle du CSS et on regarde si son SELECTEUR touche la
  // racine. Un test qui ne cherchait que `body {` ou `html {` ratait le cas
  // reel : un selecteur groupe du genre `html, body, button { touch-action }`
  // pose la propriete sur la racine sans jamais ecrire `body {`.
  const regles = [...CODE_CSS.matchAll(/([^{}@]+)\{([^{}]*)\}/g)];
  assert.ok(regles.length > 50, "le CSS doit avoir ete decoupe en regles");

  for (const [, selecteurBrut, corps] of regles) {
    const cibles = selecteurBrut
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const toucheLaRacine = cibles.some((c) => c === "html" || c === "body" || c === "*" || c === ":root");
    if (!toucheLaRacine) continue;

    // ATTENTION : `touch-action` sur la racine se transmet au sous-arbre et
    // retirerait le pincement PARTOUT, y compris la ou il est legitime (lire
    // une photo de progression, un PDF dans la visionneuse). Interdit, meme a
    // `manipulation`.
    assert.ok(
      !/touch-action\s*:/.test(corps),
      `touch-action pose sur la racine via le selecteur \`${selecteurBrut.trim()}\``,
    );
    assert.ok(
      !/overscroll-behavior\s*:\s*none/.test(corps),
      `overscroll-behavior: none sur la racine via \`${selecteurBrut.trim()}\``,
    );
    assert.ok(
      !/position\s*:\s*fixed/.test(corps),
      `position: fixed sur la racine via \`${selecteurBrut.trim()}\``,
    );
    assert.ok(
      !/overflow(-x|-y)?\s*:\s*hidden/.test(corps),
      `overflow: hidden sur la racine via \`${selecteurBrut.trim()}\``,
    );
  }

  // Controle du controle : le decoupage doit bien voir la regle `html` qui
  // porte `text-size-adjust`, sinon la boucle ci-dessus ne prouve rien.
  const vuHtml = regles.some(([, sel, corps]) =>
    sel.split(",").map((c) => c.trim()).includes("html") && /text-size-adjust/.test(corps),
  );
  assert.ok(vuHtml, "le decoupage en regles doit voir la regle `html`");
});

test("E23. `touch-action: manipulation` est posé sur les contrôles", () => {
  const regle = CODE_CSS.match(/([a-z\[\]="'\s,\-]+)\{\s*touch-action:\s*manipulation;\s*\}/);
  assert.ok(regle, "`touch-action: manipulation` doit exister");
  const selecteur = regle![1];
  for (const attendu of ["button", "a[href]", "input", "textarea", "select"]) {
    assert.ok(selecteur.includes(attendu), `${attendu} doit être couvert`);
  }
  // `manipulation` conserve pan-x/pan-y : le défilement reste natif.
  assert.ok(!/touch-action:\s*none/.test(CODE_CSS), "`touch-action: none` nulle part");
});

test("E24. le rail de séance garde son `touch-action` d'origine", () => {
  // Non-régression : ce réglage précède ce chantier et autorise le geste
  // diagonal (glisser le rail ET faire défiler la page).
  assert.match(CODE_CSS, /\.rail-seance\s*\{[^}]*touch-action:\s*pan-x pan-y/);
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. LES CHAMPS RÉELS DU DÉPÔT
 * ════════════════════════════════════════════════════════════════════════ */

test("E25. les composants globaux de formulaire sont couverts par le plancher", () => {
  // Les cinq variables de classe repérées à l'audit portent toujours
  // `text-sm` — et c'est NORMAL : on ne les a pas retouchées, le plancher
  // CSS les couvre. Ce contrôle vérifie qu'elles existent toujours et que
  // le plancher porte bien sur les balises, pas sur des classes.
  const porteurs = [
    "components/admin/AdminFormFields.tsx",
    "components/student/ExerciseFeedbackCard.tsx",
    "components/student/CardioBlockFeedbackForm.tsx",
  ];
  for (const f of porteurs) {
    const src = lire(f);
    assert.match(src, /<(input|textarea|select)\b/, `${f} doit rendre un champ`);
  }
  // Le plancher doit viser des BALISES. Une règle écrite `.text-sm { … }`
  // ne couvrirait pas un champ qui change de classe.
  const { corps } = regleplancher();
  assert.ok(corps.length > 0);
  assert.ok(
    !/@media\s*\(max-width:\s*\d+px\)\s*\{\s*\./.test(CODE_CSS.replace(/\s+/g, " ")) ||
      /input,\s*textarea,\s*select/.test(CODE_CSS.replace(/\s+/g, " ")),
    "le plancher doit viser input/textarea/select, pas une classe",
  );
});

test("E26. aucun champ ne force une taille inférieure à 16px en style inline", () => {
  // Un `style={{ fontSize: 14 }}` sur un champ échapperait au plancher :
  // le style inline bat `!important` d'une feuille de styles auteur.
  const coupables: string[] = [];
  for (const f of SOURCES) {
    if (!/\.(tsx|jsx)$/.test(f)) continue;
    const src = lire(f);
    // `[^>]` englobe déjà les sauts de ligne : le drapeau `s` est inutile ici,
    // et indisponible avec la cible TypeScript du projet (TS1501).
    for (const m of src.matchAll(/<(input|textarea|select)\b[^>]*?>/g)) {
      if (/style=\{\{[^}]*fontSize/.test(m[0])) coupables.push(`${f} : ${m[1]}`);
    }
  }
  assert.deepEqual(coupables, [], `fontSize inline sur un champ : ${coupables.join(", ")}`);
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
