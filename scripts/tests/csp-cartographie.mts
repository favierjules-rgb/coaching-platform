/**
 * Harnais — CSP ET CARTOGRAPHIE : ce que le navigateur a le droit de charger.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE HARNAIS VERROUILLE, ET CE QU'IL A FALLU DÉMÊLER
 * ────────────────────────────────────────────────────────────────────────────
 * La carte ne s'affichait pas en Preview, et la console montrait DEUX choses
 * qui n'avaient rien à voir l'une avec l'autre :
 *
 *   1. des violations « Refused to connect to https://api.maptiler.com/… » ;
 *   2. « Worker failed to load. Check that the worker URL is correct. »
 *
 * ⚠️ LA PREMIÈRE NE BLOQUAIT RIEN. Les en-têtes de ce dépôt ne posent sur les
 * pages qu'une `Content-Security-Policy-Report-Only` : elle RAPPORTE, elle
 * n'interdit pas. Vérifié ici (`CSP-01`) sur l'objet rendu par `headers()`,
 * pas sur une lecture du fichier. MapTiler y est désormais déclaré — pour le
 * jour où la politique passera en mode bloquant, et pour que la console cesse
 * de crier au loup.
 *
 * ⚠️ LA SECONDE ÉTAIT LA VRAIE CAUSE, et elle n'a rien à voir avec la CSP :
 * MapLibre 6 DÉDUIT l'URL de son worker de `import.meta.url` (« le fichier
 * frère »), alors que Turbopack copie les `.mjs` du paquet dans
 * `/_next/static/media/` AVEC UNE EMPREINTE. Mesuré sur le build :
 *
 *     déployé  /_next/static/media/maplibre-gl-worker.247mnn5i12bew.mjs → 200
 *     déduit   /_next/static/media/maplibre-gl-worker.mjs               → 404
 *
 * ⚠️ ÉPROUVÉ DANS UN VRAI NAVIGATEUR. Chromium, sur cette disposition exacte :
 * sans correctif, requête 404 et « Worker failed to load » ; avec
 * `setWorkerUrl` vers notre origine, worker 200 et carte chargée. La
 * contre-épreuve cross-origin produit bien un `blob:` — c'est ce qui justifie
 * de NE PAS mettre `blob:` dans `worker-src`.
 *
 * Lancement : npm run test:csp-cartographie
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  WORKER_MAPLIBRE_SHA256,
  WORKER_MAPLIBRE_URL,
  WORKER_MAPLIBRE_VERSION,
} from "../../lib/cartographie/worker-maplibre.generated";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_CARTE = sansProse(lire("../../components/student/CarteDesMagasins.tsx"));

interface EnTete {
  readonly source: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

/** Les en-têtes TELS QUE NEXT LES RENDRA — pas une lecture du fichier source. */
async function enTetes(): Promise<readonly EnTete[]> {
  const config = await import("../../next.config");
  return (config.default as { headers: () => Promise<EnTete[]> }).headers();
}

async function politiques(): Promise<{
  readonly rapport: string;
  readonly bloquante: string | null;
  readonly parCle: ReadonlyMap<string, string>;
}> {
  const toutes = await enTetes();
  const globale = toutes.find((h) => h.source === "/:path*");
  assert.ok(globale, "règle globale absente");
  const parCle = new Map(globale!.headers.map((h) => [h.key, h.value] as const));
  return {
    rapport: parCle.get("Content-Security-Policy-Report-Only") ?? "",
    bloquante: parCle.get("Content-Security-Policy") ?? null,
    parCle,
  };
}

/** La valeur d'une directive, sans son nom. */
function directive(csp: string, nom: string): string | null {
  for (const morceau of csp.split(";")) {
    const net = morceau.trim();
    if (net === nom || net.startsWith(`${nom} `)) return net.slice(nom.length).trim();
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   1. QUELLE POLITIQUE EST RÉELLEMENT APPLIQUÉE
   ══════════════════════════════════════════════════════════════════════════ */

test("CSP-01 — UNE SEULE POLITIQUE SUR LES PAGES, ET ELLE EST EN REPORT-ONLY", async () => {
  /*
   * ⚠️ LE PIÈGE QUE CE CONTRÔLE FERME. On pourrait corriger la politique
   * Report-Only et croire le problème réglé alors qu'une politique BLOQUANTE
   * traîne ailleurs — ou l'inverse : chercher un blocage là où rien ne bloque.
   * On énumère donc TOUTES les règles d'en-têtes, et on nomme celles qui
   * portent une CSP.
   */
  const toutes = await enTetes();
  const porteuses: { source: string; cle: string; valeur: string }[] = [];
  for (const regle of toutes) {
    for (const h of regle.headers) {
      if (/^content-security-policy/i.test(h.key)) {
        porteuses.push({ source: regle.source, cle: h.key, valeur: h.value });
      }
    }
  }

  const surLesPages = porteuses.filter((p) => p.source === "/:path*");
  assert.equal(surLesPages.length, 1, "une seule politique sur les pages");
  assert.equal(
    surLesPages[0]!.cle,
    "Content-Security-Policy-Report-Only",
    "les pages sont en Report-Only : rien n'y est bloqué",
  );

  /*
   * ⚠️ IL EXISTE UNE POLITIQUE BLOQUANTE, ET ELLE EST LÉGITIME : celle du
   * service worker, qui s'applique à SON contexte d'exécution et non aux
   * pages. Ce contexte ne charge rien et ne contacte que sa propre origine —
   * elle n'a donc rien à voir avec la carte, et on la laisse telle quelle.
   */
  const bloquantes = porteuses.filter((p) => p.cle === "Content-Security-Policy");
  assert.deepEqual(
    bloquantes.map((p) => p.source),
    ["/sw.js"],
    "la seule CSP bloquante est celle du service worker",
  );
  assert.equal(bloquantes[0]!.valeur, "default-src 'self'; script-src 'self'");
});

/* ══════════════════════════════════════════════════════════════════════════
   2. MAPTILER, DÉCLARÉ LÀ OÙ IL FAUT ET NULLE PART AILLEURS
   ══════════════════════════════════════════════════════════════════════════ */

test("CSP-02 — MAPTILER EST DANS connect-src", async () => {
  /*
   * Tout ce que MapLibre va chercher chez le fournisseur passe par `fetch` :
   * `style.json`, `tiles.json`, les tuiles `.pbf`, les polices, ET l'image de
   * sprite. C'est ce que disaient les violations relevées — « Refused to
   * CONNECT », y compris pour `sprite@2x.png`.
   */
  const { rapport } = await politiques();
  const connect = directive(rapport, "connect-src");
  assert.ok(connect !== null, "connect-src non déclaré");
  assert.ok(connect!.includes("https://api.maptiler.com"), "MapTiler absent de connect-src");
});

test("CSP-03 — LES RESSOURCES CARTOGRAPHIQUES SONT DANS img-src", async () => {
  const { rapport } = await politiques();
  const img = directive(rapport, "img-src");
  assert.ok(img !== null, "img-src non déclaré");
  assert.ok(img!.includes("'self'"), "les images du site");
  assert.ok(img!.includes("data:"), "les aperçus encodés");
  /*
   * ⚠️ `blob:` SERT AUSSI À LA CARTE, et il était déjà là pour les aperçus de
   * photos. MapLibre décode les planches de symboles en
   * `Blob([...], { type: "image/png" })` puis les pose en `img.src` : sans
   * `blob:`, la carte s'afficherait sans aucune icône.
   */
  assert.ok(img!.includes("blob:"), "les planches de symboles décodées en blob");
  assert.ok(img!.includes("https://api.maptiler.com"), "MapTiler absent de img-src");
});

test("CSP-04 — LE WORKER EST AUTORISÉ, ET SANS blob:", async () => {
  /*
   * ════════════════════════════════════════════════════════════════════════
   * ⚠️ POURQUOI PAS DE `blob:` — VÉRIFIÉ, PAS SUPPOSÉ
   * ════════════════════════════════════════════════════════════════════════
   * MapLibre teste si l'URL de son worker est CROSS-ORIGIN. Si oui — et
   * seulement si oui — il fabrique un `blob:` qui ré-importe l'URL distante,
   * parce qu'un worker ne peut pas être chargé depuis une autre origine. Si
   * non, il appelle directement `new Worker(url, { type: "module" })`.
   *
   * Éprouvé dans Chromium : worker servi depuis notre origine → requête
   * normale, AUCUN `blob:` ; le même fichier servi depuis un autre port →
   * `blob:http://…` dans les requêtes. Notre worker est copié dans
   * `public/maplibre/`, donc même origine, donc `'self'` suffit.
   *
   * Ouvrir `blob:` dans `worker-src` n'aurait rien débloqué et aurait permis
   * d'exécuter du code fabriqué à la volée.
   */
  const { rapport } = await politiques();
  const worker = directive(rapport, "worker-src");
  assert.ok(worker !== null, "worker-src doit être déclaré explicitement");
  assert.equal(worker, "'self'", "le worker est servi depuis notre origine, et rien d'autre");
  assert.ok(!worker!.includes("blob:"), "aucun blob: : le chemin n'est jamais emprunté");
  assert.ok(!worker!.includes("*"), "aucun joker");
});

test("CSP-05 — AUCUN JOKER EXCESSIF N'A ÉTÉ INTRODUIT", async () => {
  const { rapport } = await politiques();
  /*
   * ⚠️ ON INTERDIT LE JOKER DE SCHÉMA ET LE JOKER NU, PAS LE SOUS-DOMAINE.
   * `https://*.supabase.co` existe depuis l'origine du projet et vise un
   * fournisseur précis ; `https:` ou `*` autoriseraient le web entier.
   */
  for (const morceau of rapport.split(";")) {
    const net = morceau.trim();
    if (net === "") continue;
    const [nom, ...valeurs] = net.split(/\s+/);
    for (const valeur of valeurs) {
      assert.notEqual(valeur, "*", `joker nu dans ${nom}`);
      assert.notEqual(valeur, "https:", `joker de schéma dans ${nom}`);
      assert.notEqual(valeur, "http:", `schéma non chiffré dans ${nom}`);
      assert.ok(!valeur.startsWith("*."), `sous-domaine sans schéma dans ${nom} : ${valeur}`);
    }
  }
  // ⚠️ ET MAPTILER EST DÉCLARÉ PAR SON ORIGINE EXACTE. `*.maptiler.com`
  // couvrirait aussi la console du compte et tout sous-domaine futur.
  assert.ok(!rapport.includes("*.maptiler.com"), "pas de joker sur MapTiler");
  assert.ok(rapport.includes("https://api.maptiler.com"));
});

test("CSP-06 — LES RESTRICTIONS EXISTANTES SONT INTACTES", async () => {
  /*
   * ⚠️ AJOUTER UN FOURNISSEUR NE DOIT RIEN RETIRER. Ce contrôle existe parce
   * qu'une directive se réécrit facilement en entier quand on y ajoute un mot.
   */
  const { rapport, parCle } = await politiques();
  for (const attendu of [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "upgrade-insecure-requests",
  ]) {
    assert.ok(rapport.includes(attendu), `${attendu} a disparu`);
  }
  // Les fournisseurs déjà déclarés le sont toujours.
  for (const origine of ["https://*.supabase.co", "https://js.stripe.com", "https://api.stripe.com"]) {
    assert.ok(rapport.includes(origine), `${origine} a disparu`);
  }
  // `media-src` et ses deux sources, posés par le chantier vidéo.
  assert.ok(/media-src[^;]*blob:/.test(rapport), "aperçu vidéo local");
  assert.ok(/media-src[^;]*supabase\.co/.test(rapport), "URL signée Storage");
  // Et les autres en-têtes de sécurité n'ont pas bougé.
  assert.equal(parCle.get("X-Content-Type-Options"), "nosniff");
  assert.equal(parCle.get("X-Frame-Options"), "DENY");
  assert.equal(parCle.get("Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("CSP-07 — MAPTILER N'A PAS ÉTÉ GLISSÉ DANS script-src NI frame-src", async () => {
  // Un fond de carte n'exécute aucun script tiers et ne s'affiche dans aucune
  // iframe : l'y autoriser serait une permission accordée sans usage.
  const { rapport } = await politiques();
  for (const nom of ["script-src", "frame-src", "form-action", "base-uri", "object-src"]) {
    const valeur = directive(rapport, nom) ?? "";
    assert.ok(!valeur.includes("maptiler"), `MapTiler n'a rien à faire dans ${nom}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   3. LE WORKER : LE FICHIER, SON URL, ET SA FRAÎCHEUR
   ══════════════════════════════════════════════════════════════════════════ */

test("CSP-08 — LE WORKER EST SERVI DEPUIS NOTRE ORIGINE, ET LE FICHIER EXISTE", () => {
  assert.match(WORKER_MAPLIBRE_URL, /^\/maplibre\//, "une URL relative, donc même origine");
  assert.ok(!/^https?:/.test(WORKER_MAPLIBRE_URL), "jamais une origine distante");
  const chemin = new URL(`../../public${WORKER_MAPLIBRE_URL}`, import.meta.url);
  assert.ok(existsSync(chemin), `le worker doit être déployé : public${WORKER_MAPLIBRE_URL}`);
  assert.ok(WORKER_MAPLIBRE_URL.includes(WORKER_MAPLIBRE_VERSION), "la version est dans le nom");
});

test("CSP-09 — LE WORKER COPIÉ CORRESPOND AU PAQUET INSTALLÉ", () => {
  /*
   * ⚠️ C'EST LE GARDE-FOU CONTRE LA DÉRIVE. Un worker d'une version et une
   * bibliothèque d'une autre se parlent mal, et la panne se cherche longtemps.
   * Monter `maplibre-gl` sans relancer le script de copie fait rougir ici, au
   * lieu de casser la carte en production.
   *
   *   npx tsx scripts/cartographie/copier-worker-maplibre.mts
   */
  const paquet = JSON.parse(lire("../../node_modules/maplibre-gl/package.json")) as {
    version: string;
  };
  assert.equal(
    WORKER_MAPLIBRE_VERSION,
    paquet.version,
    "worker et bibliothèque de versions différentes : relance le script de copie",
  );

  const source = readFileSync(
    new URL("../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url),
  );
  const empreinteSource = createHash("sha256").update(source).digest("hex");
  assert.equal(empreinteSource, WORKER_MAPLIBRE_SHA256, "le worker copié a dérivé de sa source");

  const copie = readFileSync(new URL(`../../public${WORKER_MAPLIBRE_URL}`, import.meta.url));
  assert.equal(
    createHash("sha256").update(copie).digest("hex"),
    WORKER_MAPLIBRE_SHA256,
    "le fichier servi n'est pas celui qui a été généré",
  );
});

test("CSP-10 — LE WORKER RESTE AUTONOME", () => {
  // S'il se mettait à importer un module frère, le copier seul le casserait —
  // et le symptôme serait le même « Worker failed to load », pour une autre
  // raison, qu'on chercherait au mauvais endroit.
  const copie = readFileSync(
    new URL(`../../public${WORKER_MAPLIBRE_URL}`, import.meta.url),
    "utf8",
  );
  assert.ok(!/^\s*import\s+[^(]/m.test(copie), "le worker ne doit porter aucun import statique");
});

test("CSP-11 — LE COMPOSANT IMPOSE L'URL DU WORKER AVANT DE CONSTRUIRE LA CARTE", () => {
  /*
   * ⚠️ L'ORDRE EST LE POINT. `setWorkerUrl` écrit dans un état global de
   * MapLibre : posé après `new Map(...)`, il arriverait trop tard et le worker
   * serait déjà parti chercher l'URL déduite — celle qui rend 404.
   */
  assert.match(CODE_CARTE, /setWorkerUrl\(WORKER_MAPLIBRE_URL\)/, "l'URL est imposée");
  const iSet = CODE_CARTE.indexOf("setWorkerUrl(WORKER_MAPLIBRE_URL)");
  const iMap = CODE_CARTE.indexOf("new CarteGL(");
  assert.ok(iSet > 0 && iMap > iSet, "setWorkerUrl doit précéder la construction de la carte");
  // Et l'URL vient du fichier généré, jamais écrite à la main dans le composant.
  assert.ok(
    !/["']\/maplibre\//.test(CODE_CARTE),
    "l'URL ne doit pas être recopiée : elle vient du fichier généré",
  );
});

test("CSP-12 — LE FICHIER GÉNÉRÉ DIT D'OÙ IL VIENT", () => {
  const genere = lire("../../lib/cartographie/worker-maplibre.generated.ts");
  assert.ok(genere.includes("NE PAS MODIFIER À LA MAIN"));
  assert.ok(genere.includes("copier-worker-maplibre.mts"), "la commande de régénération");
  assert.ok(genere.includes(WORKER_MAPLIBRE_SHA256), "l'empreinte est inscrite");
});
