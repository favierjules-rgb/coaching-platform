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

/** Domaines réellement contactés par le navigateur, relevés dans le code. */
const CSP_SOURCES = {
  // Supabase : REST, Auth, Storage et temps réel (websocket).
  supabase: "https://*.supabase.co wss://*.supabase.co",
  // Stripe : redirection Checkout, portail client, scripts embarqués.
  stripe: "https://js.stripe.com https://api.stripe.com https://checkout.stripe.com",
  stripeFrames: "https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
  // Images : Storage Supabase, Stripe, et data:/blob: pour les aperçus
  // locaux (upload d'une photo de progression).
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
  `img-src ${CSP_SOURCES.images}`,
  `font-src 'self' data:`,
  `connect-src 'self' ${CSP_SOURCES.supabase} ${CSP_SOURCES.stripe} ${CSP_SOURCES.vercel}`,
  `frame-src ${CSP_SOURCES.stripeFrames}`,
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
    // Aucune de ces API n'est utilisée : on les refuse explicitement plutôt
    // que de laisser la porte ouverte à un script tiers compromis.
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
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
