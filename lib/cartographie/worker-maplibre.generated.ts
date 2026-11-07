/**
 * FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN.
 * Régénérer :  npx tsx scripts/cartographie/copier-worker-maplibre.mts
 *
 * Le worker de MapLibre GL JS 6.16.0, copié dans `public/maplibre/` pour
 * être servi depuis NOTRE origine.
 *
 * ⚠️ MÊME ORIGINE, ET C'EST CE QUI DÉCIDE DE LA CSP. MapLibre ne fabrique un
 * `blob:` que si l'URL du worker est CROSS-ORIGIN (fonction de test interne
 * sur l'origine, puis `Blob([\`import "…"\`])`). Servi depuis chez nous, il
 * appelle `new Worker(url, { type: "module" })` directement : `worker-src
 * 'self'` suffit, et `blob:` serait une permission accordée pour rien.
 *
 * SHA-256 du worker : 0bf06492bdb7ba3d4132b78e435621bfba60d5250967991c02b1a73affea8cd5
 */

/** La version de `maplibre-gl` dont ce worker provient. */
export const WORKER_MAPLIBRE_VERSION = "6.16.0";

/** L'empreinte du fichier copié — comparée au paquet installé par un test. */
export const WORKER_MAPLIBRE_SHA256 = "0bf06492bdb7ba3d4132b78e435621bfba60d5250967991c02b1a73affea8cd5";

/** L'URL publique du worker, sur notre propre origine. */
export const WORKER_MAPLIBRE_URL = "/maplibre/maplibre-gl-worker-6.16.0.mjs";
