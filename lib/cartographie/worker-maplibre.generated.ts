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
 * SHA-256 du worker copié : f4650f17aa791e15a800278c1e8499d913ff802907a5ad2eb4b8c3cefe68b7ed
 * (le renvoi `sourceMappingURL` a été retiré — voir le script)
 */

/** La version de `maplibre-gl` dont ce worker provient. */
export const WORKER_MAPLIBRE_VERSION = "6.16.0";

/**
 * L'empreinte du fichier COPIÉ.
 *
 * ⚠️ ELLE DIFFÈRE DE CELLE DU PAQUET, d'une ligne : le renvoi vers la carte
 * des sources est retiré à la copie (voir le script). Le test compare donc
 * cette empreinte au fichier servi, et la VERSION au paquet installé — deux
 * contrôles, parce que ce sont deux dérives différentes.
 */
export const WORKER_MAPLIBRE_SHA256 = "f4650f17aa791e15a800278c1e8499d913ff802907a5ad2eb4b8c3cefe68b7ed";

/** L'URL publique du worker, sur notre propre origine. */
export const WORKER_MAPLIBRE_URL = "/maplibre/maplibre-gl-worker-6.16.0.mjs";
