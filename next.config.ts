import type { NextConfig } from "next";

/**
 * En-têtes de sécurité (audit de pré-production, juillet 2026, point H-1).
 *
 * Le projet n'en posait aucun : ni protection contre le clickjacking, ni
 * politique de contenu, ni maîtrise du referrer. Vercel ajoute seulement
 * `Strict-Transport-Security` en HTTPS.
 *
 * La CSP est déclarée en **Report-Only** : elle n'a encore jamais tourné
 * contre le vrai trafic (Stripe, Supabase, images distantes), et une CSP
 * bloquante posée à l'aveugle casse un tunnel de paiement sans prévenir. À
 * basculer en `Content-Security-Policy` une fois les rapports d'une Preview
 * Vercel dépouillés — procédure en fin de fichier.
 */

/**
 * L'ORIGINE EXACTE DU PROJET SUPABASE — PAS TOUS LES PROJETS SUPABASE.
 *
 * `frame-src https://*.supabase.co` autoriserait N'IMPORTE QUEL projet
 * Supabase du monde à être encadré par SETH. Ce n'est pas ce qu'on veut :
 * les URLs signées du Storage viennent d'un projet et d'un seul, et son
 * origine est déjà connue au build par `NEXT_PUBLIC_SUPABASE_URL` — une
 * variable PUBLIQUE, celle que le navigateur reçoit déjà.
 *
 * La valeur n'est jamais recopiée telle quelle dans la politique : elle est
 * relue par `new URL(...).origin`, et l'hôte doit satisfaire un motif qui
 * exclut par construction l'espace, le point-virgule et l'astérisque —
 * c'est-à-dire tout ce qui permettrait d'injecter une directive.
 */
const MOTIF_HOTE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function origineSupabase(brut = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!brut) return null;
  try {
    const url = new URL(brut);
    if (url.protocol !== "https:") return null;
    if (!MOTIF_HOTE.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const SUPABASE_FRAME = origineSupabase();
if (!SUPABASE_FRAME && process.env.NODE_ENV === "production") {
  // Sans elle, la CSP passée en mode bloquant empêcherait l'affichage des
  // documents privés. Mieux vaut un avertissement au build qu'un cadre vide
  // découvert en production.
  console.warn(
    "[csp] NEXT_PUBLIC_SUPABASE_URL absente ou invalide : frame-src n'autorisera pas les documents Storage.",
  );
}

/** Domaines réellement contactés par le navigateur, relevés dans le code. */
const CSP_SOURCES = {
  // Supabase : REST, Auth, Storage et temps réel (websocket).
  supabase: "https://*.supabase.co wss://*.supabase.co",
  // Stripe : redirection Checkout, portail client, scripts embarqués.
  stripe: "https://js.stripe.com https://api.stripe.com https://checkout.stripe.com",
  stripeFrames: "https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
  // Lecteur vidéo intégré (chantier « lecteur vidéo SETH ») : les vidéos de
  // démonstration sont hébergées sur YouTube et lues DANS l'application, plus
  // jamais par redirection. `youtube-nocookie` et lui seul — le domaine sans
  // cookie de suivi tant que la lecture n'a pas commencé. Aucun joker : ni
  // `https:`, ni `*`, ni `youtube.com` complet.
  youtubeFrames: "https://www.youtube-nocookie.com",
  // L'origine EXACTE du projet, jamais `*.supabase.co` : voir ci-dessus.
  supabaseFrames: SUPABASE_FRAME ?? "",
  // CARTOGRAPHIE — le fond de carte de la recherche de commerces.
  //
  // ⚠️ UN SEUL HÔTE, ET IL EST VÉRIFIÉ SUR LE STYLE LUI-MÊME. Le document
  // `liberty` d'OpenFreeMap ne cite aucune autre origine : le style, les
  // polices (`/fonts/`), les planches de symboles (`/sprites/`), les tuiles
  // vectorielles (`/planet/`) et le relief ombré (`/natural_earth/`) en
  // viennent tous. Aucun joker : ni `*.openfreemap.org`, ni `https:`.
  //
  // Ce qui passe par là : le style, le TileJSON, les tuiles `.pbf`, les
  // polices `.pbf`, les planches de symboles. MapLibre les récupère toutes
  // par `fetch` — elles relèvent donc de `connect-src`, pas de `img-src`,
  // l'image de sprite comprise.
  //
  // ⚠️ LE RELIEF OMBRÉ EST UNE SOURCE RASTER (`.png`). MapLibre la récupère
  // aussi par `fetch`, puis la décode en `blob:` avant de l'afficher — d'où
  // l'hôte dans `img-src` également, par sécurité, et le `blob:` qui y était
  // déjà pour les aperçus de photos.
  fondDeCarte: "https://tiles.openfreemap.org",
  // Images : Storage Supabase, Stripe, et data:/blob: pour les aperçus
  // locaux (upload d'une photo de progression).
  //
  // ⚠️ `blob:` SERT AUSSI À LA CARTE, et il était déjà là. MapLibre décode les
  // planches de symboles et les tuiles raster en
  // `Blob([...], { type: "image/png" })` puis les pose en `img.src` : sans
  // `blob:`, la carte s'afficherait sans icônes et sans relief.
  images: "'self' data: blob: https://*.supabase.co https://*.stripe.com",
  // Vercel Analytics / Speed Insights, si activés plus tard.
  vercel: "https://*.vercel-insights.com https://*.vercel-scripts.com",
};

const contentSecurityPolicy = [
  `default-src 'self'`,
  // `unsafe-inline` et `unsafe-eval` restent nécessaires au runtime Next.js
  // (hydratation, Fast Refresh). À resserrer avec des nonces le jour où le
  // gain justifiera la complexité.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${CSP_SOURCES.stripe} ${CSP_SOURCES.vercel}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src ${CSP_SOURCES.images} ${CSP_SOURCES.fondDeCarte}`,
  // `media-src` n'était pas déclaré : les `<video>` retombaient donc sur
  // `default-src 'self'`, qui bloque à la fois l'aperçu local (`blob:`) et
  // l'URL signée du Storage. Sans cette ligne, la CSP passée en mode
  // bloquant casserait la vidéo de technique (F4) sans autre symptôme qu'un
  // lecteur noir.
  `media-src 'self' blob: ${CSP_SOURCES.supabase}`,
  `font-src 'self' data:`,
  // LE WORKER DE MAPLIBRE — ET POURQUOI IL N'Y A PAS DE `blob:` ICI.
  //
  // `worker-src` n'était pas déclaré : les workers retombaient sur
  // `default-src 'self'`, ce qui suffisait déjà. On le déclare quand même,
  // pour que la règle soit lisible plutôt que déduite.
  //
  // ⚠️ `blob:` SERAIT UNE PERMISSION ACCORDÉE POUR RIEN, et c'est vérifié dans
  // le code de MapLibre, pas supposé : il teste si l'URL du worker est
  // CROSS-ORIGIN. Si oui — et seulement si oui — il fabrique un `blob:` qui
  // ré-importe l'URL distante, parce qu'un worker ne peut pas être chargé
  // depuis une autre origine. Si non, il appelle directement
  // `new Worker(url, { type: "module" })`.
  //
  // Notre worker est copié dans `public/maplibre/` et servi depuis NOTRE
  // origine (voir `scripts/cartographie/copier-worker-maplibre.mts`) : le
  // chemin `blob:` n'est jamais emprunté. L'ouvrir affaiblirait la politique
  // sans rien débloquer — et `blob:` dans `worker-src` est précisément ce qui
  // permet d'exécuter du code fabriqué à la volée.
  //
  // ⚠️ CECI N'A PAS CHANGÉ EN CHANGEANT DE FOURNISSEUR DE FOND DE CARTE : le
  // worker est à nous, il l'a toujours été, et il ne vient d'aucun tiers.
  `worker-src 'self'`,
  `connect-src 'self' ${CSP_SOURCES.supabase} ${CSP_SOURCES.stripe} ${CSP_SOURCES.vercel} ${CSP_SOURCES.fondDeCarte}`,
  // Les documents privés (PDF) sont affichés dans une modale SETH à partir
  // d'une URL SIGNÉE du Storage : sans cette origine, la CSP passée en mode
  // bloquant afficherait un cadre vide, sans autre symptôme.
  `frame-src ${[CSP_SOURCES.stripeFrames, CSP_SOURCES.youtubeFrames, CSP_SOURCES.supabaseFrames].filter(Boolean).join(" ")}`,
  // Le site n'a aucune raison d'être encadré : protection contre le
  // clickjacking, en complément de X-Frame-Options pour les navigateurs
  // anciens.
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self' ${CSP_SOURCES.stripe}`,
  `object-src 'none'`,
  `upgrade-insecure-requests`,
].join("; ");

/** Appliqués à toutes les réponses. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // On n'ouvre QUE ce dont on se sert.
    //
    // `camera=(self)` depuis F4 (feat/student-feedback-video) : l'élève peut
    // filmer sa technique depuis la page de séance. `(self)` autorise ce
    // site et LUI SEUL — aucune iframe tierce, Stripe compris, n'hérite du
    // droit. Le navigateur redemande de toute façon son accord à l'élève :
    // cet en-tête ne donne pas la caméra, il cesse de l'interdire.
    //
    // `microphone=(self)` depuis F5 (feat/coach-reply-video). C'est un
    // ASSOUPLISSEMENT, et il faut le justifier plutôt que le glisser :
    // F4 gardait le micro fermé parce qu'une vidéo de technique n'a pas
    // besoin du son. Une réponse de COACH, si — il EXPLIQUE, et une réponse
    // muette ne vaudrait rien. La capture demande donc `audio: true`, ce qui
    // exige cette ouverture.
    //
    // Ce qui n'a PAS bougé, et qui est l'essentiel : `(self)`, ce site et lui
    // seul. Aucune iframe tierce, Stripe comprise, n'hérite du droit, et le
    // navigateur redemande de toute façon son accord à l'utilisateur — cet
    // en-tête ne donne pas le micro, il cesse de l'interdire.
    // `geolocation=(self)` depuis la recherche de commerces. C'EST UN
    // ASSOUPLISSEMENT, ET IL DOIT ÊTRE RELU.
    //
    // ⚠️ MESURÉ, PAS SUPPOSÉ. Avec `geolocation=()`, Chromium répond, sur
    // l'en-tête exact de ce fichier :
    //
    //     code 1 — « Geolocation has been disabled in this document by
    //               permissions policy. »
    //
    // Autrement dit : le mode « Autour de moi » de la liste de courses ne
    // pouvait PAS fonctionner, et l'écran affichait « Localisation refusée »
    // sans que l'élève ait rien refusé. Que cela ait semblé marcher en recette
    // n'y change rien : Safari n'applique pas cette politique pour la
    // géolocalisation, Chrome et Firefox si.
    //
    // `(self)`, donc — ce site et lui seul, comme la caméra et le micro avant
    // lui. Aucune iframe tierce, Stripe comprise, n'hérite du droit, et le
    // navigateur redemande de toute façon son accord à l'élève : cet en-tête
    // ne donne pas sa position, il cesse de l'interdire. Et rien n'est
    // demandé au chargement de l'écran — c'est le bouton qui déclenche.
    value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
];

/**
 * Pages authentifiées : jamais mises en cache par un intermédiaire partagé.
 * Le rendu dynamique les protège déjà aujourd'hui, mais rien ne garantit
 * qu'une page ne devienne pas statique au fil des évolutions (audit M-5).
 */
const privateCacheHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
];

const PRIVATE_PATHS = [
  // Atteinte par un lien porteur d'un jeton à usage unique : ni cache
  // partagé, ni conservation par un intermédiaire (incident du 27/07/2026).
  "/reinitialiser-mot-de-passe",
  // Chantier PWA : /connexion lit désormais le cookie de session pour
  // rediriger un élève déjà connecté vers son espace (écran de lancement de
  // l'application — voir app/manifest.ts). Sa réponse dépend donc de QUI la
  // demande : elle ne doit jamais être conservée par un intermédiaire
  // partagé, qui servirait à un visiteur anonyme la redirection destinée à
  // quelqu'un d'autre.
  "/connexion",
  "/dashboard",
  "/admin",
  "/entrainement",
  "/nutrition",
  "/documents",
  "/profil",
  "/rendez-vous",
  "/progression",
  "/paiement",
  "/onboarding",
];

/**
 * IMAGES DISTANTES — l'hôte exact, et rien d'autre.
 *
 * `next/image` refuse par défaut toute source distante : sans cette liste, un
 * `<Image src="https://…supabase.co/…">` rend un 400. La tentation est de
 * poser `hostname: "**.supabase.co"` et de passer à autre chose — ce serait
 * ouvrir l'optimiseur d'images de ce site à N'IMPORTE QUEL projet Supabase du
 * monde, qui pourrait alors s'en servir comme CDN gratuit.
 *
 * L'hôte est donc DÉRIVÉ de `NEXT_PUBLIC_SUPABASE_URL` : un seul projet, le
 * nôtre. Et le chemin est borné au bucket public des photos de recettes —
 * l'optimiseur ne relaiera rien d'autre, pas même un autre bucket public du
 * même projet. `search: ""` interdit en plus toute chaîne de requête, qui
 * multiplierait les variantes de cache pour la même image.
 *
 * Si la variable manque (build sans environnement), la liste est vide : aucun
 * relais n'est ouvert. C'est cohérent — sans URL Supabase, l'application n'a
 * de toute façon aucune image à afficher.
 *
 * `lib/nutrition/recipe-image.ts` construit le MÊME motif, et un test vérifie
 * que les deux ne divergent pas.
 */
function recipeImageRemotePatterns() {
  const brut = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!brut) return [];
  let hostname: string;
  try {
    hostname = new URL(brut).hostname;
  } catch {
    return [];
  }
  if (hostname === "") return [];
  return [
    {
      protocol: "https" as const,
      hostname,
      pathname: "/storage/v1/object/public/recipe-images/**",
      search: "",
    },
  ];
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: recipeImageRemotePatterns(),
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Les routes d'API renvoient des données personnelles : même règle.
      { source: "/api/:path*", headers: privateCacheHeaders },
      // Le jeton d'activation transite dans l'URL : aucun `Referer` ne doit
      // sortir de cette page vers une origine tierce, même en HTTPS.
      {
        source: "/reinitialiser-mot-de-passe",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      // LE SERVICE WORKER (chantier PWA).
      //
      // `Cache-Control: no-store` est le point important, et il n'a rien
      // d'esthétique : `/sw.js` est le seul fichier du site que le
      // navigateur peut garder plusieurs heures ET qui s'exécute avant
      // chaque page. S'il était mis en cache, une correction urgente
      // resterait sans effet aussi longtemps que la copie survit — sur un
      // fichier dont un bogue casse tout le site. Complète (et ne remplace
      // pas) `updateViaCache: "none"` posé à l'enregistrement : l'un vient
      // du serveur, l'autre du client.
      //
      // La CSP est ici BLOQUANTE, alors qu'elle est en Report-Only partout
      // ailleurs. Ce n'est pas une incohérence : elle s'applique au contexte
      // d'exécution du service worker, pas aux pages. Ce contexte ne charge
      // rien et ne contacte que sa propre origine — la resserrer ne casse
      // donc rien, et elle limite ce qu'un `/sw.js` altéré pourrait faire.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      ...PRIVATE_PATHS.map((path) => ({ source: path, headers: privateCacheHeaders })),
      ...PRIVATE_PATHS.map((path) => ({
        source: `${path}/:path*`,
        headers: privateCacheHeaders,
      })),
    ];
  },
};

export default nextConfig;

/**
 * Passage de la CSP en mode bloquant — à faire APRÈS mesure :
 *
 *  1. déployer une Preview Vercel avec cette configuration ;
 *  2. parcourir les chemins sensibles : connexion, achat d'un programme
 *     jusqu'au retour de Stripe, espace élève, espace admin, upload d'une
 *     photo de progression ;
 *  3. relever les violations `Content-Security-Policy-Report-Only` en console ;
 *  4. compléter `CSP_SOURCES` avec les domaines légitimes manquants ;
 *  5. seulement ensuite, renommer la clé en `Content-Security-Policy`.
 */
