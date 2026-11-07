/**
 * GÉNÉRATEUR — le worker MapLibre, servi depuis NOTRE origine.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CE SCRIPT CORRIGE
 * ════════════════════════════════════════════════════════════════════════════
 * MapLibre 6 ne reçoit pas l'URL de son worker : il la DÉDUIT, à l'exécution,
 * de `import.meta.url` —
 *
 *     new URL("./maplibre-gl-worker.mjs", import.meta.url)
 *
 * — c'est-à-dire « le fichier frère, à côté de moi ». Cela suppose que le
 * paquet soit servi tel quel, non empaqueté.
 *
 * Or Turbopack traite les `.mjs` de `maplibre-gl` comme des ressources
 * statiques et les copie dans `/_next/static/media/` AVEC UNE EMPREINTE :
 *
 *     déployé  : /_next/static/media/maplibre-gl-worker.247mnn5i12bew.mjs  → 200
 *     déduit   : /_next/static/media/maplibre-gl-worker.mjs                → 404
 *
 * Mesuré sur le build de ce dépôt. D'où, dans la console, et autant de fois
 * qu'il y a de tentatives :
 *
 *     Error: Worker failed to load. Check that the worker URL is correct.
 *
 * ⚠️ CE N'EST PAS UN PROBLÈME DE CSP. Le fichier est bien déployé, et la
 * politique de ce site n'est qu'en `Report-Only` sur les pages : rien n'était
 * bloqué. C'est une URL fausse, et elle l'est quelle que soit la politique.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI COPIER PLUTÔT QUE RUSER AVEC L'EMPAQUETEUR
 * ════════════════════════════════════════════════════════════════════════════
 * On pourrait tenter de récupérer l'URL empreintée que Turbopack a produite.
 * Elle n'est exposée par aucun contrat : c'est un détail d'implémentation, qui
 * changera sans prévenir et dont la panne se verra en production, pas ici.
 *
 * Le worker est en revanche AUTONOME — aucun `import` statique, 519 Ko, vérifié
 * — donc le copier est sûr, et une URL que nous écrivons est une URL que nous
 * savons juste.
 *
 * ⚠️ LA VERSION EST DANS LE NOM DU FICHIER. Deux raisons : un worker d'une
 * version et une bibliothèque d'une autre se parlent mal, et c'est le genre de
 * panne qu'on cherche pendant des heures ; et un nom qui change à chaque
 * montée de version règle la question du cache du navigateur sans y penser.
 *
 * ⚠️ ET LA DÉRIVE EST MESURÉE, PAS SURVEILLÉE. Le fichier copié est COMMITÉ —
 * même doctrine que `rayons-ciqual.generated.ts` — et un test compare son
 * empreinte à celle du paquet installé. Monter `maplibre-gl` sans relancer ce
 * script fait rougir la suite, au lieu de casser la carte en production.
 *
 * Régénérer :  npx tsx scripts/cartographie/copier-worker-maplibre.mts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const RACINE = new URL("../../", import.meta.url);
const PAQUET = new URL("node_modules/maplibre-gl/package.json", RACINE);
const SOURCE = new URL("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", RACINE);
const DOSSIER_PUBLIC = new URL("public/maplibre/", RACINE);
const SORTIE_TS = new URL("lib/cartographie/worker-maplibre.generated.ts", RACINE);

const version = (JSON.parse(readFileSync(PAQUET, "utf8")) as { version: string }).version;
if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`version maplibre-gl inattendue : ${version}`);

const contenu = readFileSync(SOURCE);
const empreinte = createHash("sha256").update(contenu).digest("hex");

/*
 * ⚠️ UN GARDE-FOU SUR LE CONTENU. Le worker doit rester AUTONOME : s'il se
 * mettait à importer un module frère, le copier seul le casserait, et le
 * symptôme serait le même « Worker failed to load » — mais pour une autre
 * raison, qu'on chercherait au mauvais endroit.
 */
const texte = contenu.toString("utf8");
if (/^\s*import\s+[^(]/m.test(texte)) {
  throw new Error("le worker MapLibre n'est plus autonome : il porte des imports statiques");
}

const nomFichier = `maplibre-gl-worker-${version}.mjs`;
mkdirSync(DOSSIER_PUBLIC, { recursive: true });
writeFileSync(new URL(nomFichier, DOSSIER_PUBLIC), contenu);

const url = `/maplibre/${nomFichier}`;
writeFileSync(
  SORTIE_TS,
  `/**
 * FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN.
 * Régénérer :  npx tsx scripts/cartographie/copier-worker-maplibre.mts
 *
 * Le worker de MapLibre GL JS ${version}, copié dans \`public/maplibre/\` pour
 * être servi depuis NOTRE origine.
 *
 * ⚠️ MÊME ORIGINE, ET C'EST CE QUI DÉCIDE DE LA CSP. MapLibre ne fabrique un
 * \`blob:\` que si l'URL du worker est CROSS-ORIGIN (fonction de test interne
 * sur l'origine, puis \`Blob([\\\`import "…"\\\`])\`). Servi depuis chez nous, il
 * appelle \`new Worker(url, { type: "module" })\` directement : \`worker-src
 * 'self'\` suffit, et \`blob:\` serait une permission accordée pour rien.
 *
 * SHA-256 du worker : ${empreinte}
 */

/** La version de \`maplibre-gl\` dont ce worker provient. */
export const WORKER_MAPLIBRE_VERSION = ${JSON.stringify(version)};

/** L'empreinte du fichier copié — comparée au paquet installé par un test. */
export const WORKER_MAPLIBRE_SHA256 = ${JSON.stringify(empreinte)};

/** L'URL publique du worker, sur notre propre origine. */
export const WORKER_MAPLIBRE_URL = ${JSON.stringify(url)};
`,
  "utf8",
);

console.log(`worker MapLibre ${version} → public${url} (${contenu.length} octets)`);
console.log(`sha256 ${empreinte}`);
