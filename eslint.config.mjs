import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /*
     * ⚠️ LE WORKER MAPLIBRE EST DU CODE TIERS MINIFIÉ, COPIÉ TEL QUEL.
     *
     * Il est produit par `scripts/cartographie/copier-worker-maplibre.mts`
     * depuis `node_modules/maplibre-gl` — il n'est ni écrit ni modifiable
     * ici, et un test compare son empreinte à celle du paquet installé. Le
     * passer au linter produit un millier d'avertissements sur du code que
     * personne ne peut corriger, et noie ceux qui comptent.
     *
     * ⚠️ LA RÈGLE VISE CE FICHIER, PAS `public/`. Le service worker du site
     * (`public/sw.js`) est écrit à la main et DOIT rester vérifié.
     */
    "public/maplibre/**",
  ]),
]);

export default eslintConfig;
