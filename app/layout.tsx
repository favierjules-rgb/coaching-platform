import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, DM_Sans } from "next/font/google";

import { SiteChrome } from "@/components/layout/SiteChrome";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { ThemeProvider, themeAntiFlashScript } from "@/components/theme/ThemeProvider";

import "./globals.css";

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-barlow",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Seth — Préparation Physique",
  description:
    "Coaching sportif, nutrition et suivi personnalisé pour transformer ton physique durablement.",
  // Le <link rel="manifest"> est posé automatiquement par Next.js à partir
  // de `app/manifest.ts` ; le <link rel="apple-touch-icon"> à partir de
  // `app/apple-icon.png`. Rien à déclarer ici pour ces deux-là.
  applicationName: "SETH",
  appleWebApp: {
    // Sur iOS, c'est CE réglage qui fait qu'un raccourci ajouté à l'écran
    // d'accueil s'ouvre en plein écran plutôt que dans Safari.
    capable: true,
    // Le nom sous l'icône. Sans lui, iOS prend le <title> de la page au
    // moment de l'ajout — soit « Connexion — Seth Préparation Physique ».
    title: "SETH",
    // "default" : barre d'état classique, le contenu commence dessous.
    // "black-translucent" ferait passer la page SOUS l'horloge : ce serait
    // plus joli, et ça demanderait de reprendre les marges hautes de chaque
    // écran (`env(safe-area-inset-top)`). Hors périmètre de ce lot.
    statusBarStyle: "default",
  },
  other: {
    // Next.js émet `mobile-web-app-capable` (la balise moderne). Safari
    // continue de lire l'ancienne sur les versions d'iOS encore en service :
    // on pose les deux, elles disent la même chose.
    "apple-mobile-web-app-capable": "yes",
  },
};

/**
 * Couleur de la barre système en mode application.
 *
 * Valeur FIXE, pas un couple clair/sombre : `theme-color` répond au thème du
 * SYSTÈME, alors que le thème du site vit en localStorage et vaut sombre par
 * défaut. Un téléphone en mode clair afficherait sinon une barre blanche
 * au-dessus d'une application restée noire.
 */
export const viewport: Viewport = {
  themeColor: "#050505",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${barlowCondensed.variable} ${dmSans.variable} h-full`}
      // Le script anti-flash ci-dessous (voir themeAntiFlashScript) applique
      // la classe .light sur ce nœud AVANT l'hydratation React, uniquement
      // si un choix "clair" est mémorisé en localStorage — c'est le seul
      // moyen d'éviter un flash sombre->clair au chargement sans connaître
      // le thème côté serveur. Cette classe ne fait jamais partie du rendu
      // React lui-même (className ci-dessus reste statique, toujours "dark"
      // par défaut côté serveur), donc React peut légitimement constater une
      // différence sur CE nœud précis lors de l'hydratation. C'est le
      // pattern documenté pour ce cas (cf. next-themes) : suppressHydrationWarning
      // ne masque pas une vraie régression, il évite un avertissement pour
      // une divergence intentionnelle et contrôlée, exclusivement sur <html>.
      suppressHydrationWarning
    >
      <head>
        {/* Anti-flash : applique .light avant l'hydratation si mémorisé (voir components/theme/ThemeProvider.tsx). */}
        <script dangerouslySetInnerHTML={{ __html: themeAntiFlashScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-background font-body text-foreground antialiased">
        <ThemeProvider>
          <SiteChrome>{children}</SiteChrome>
        </ThemeProvider>
        {/* Ne rend rien : déclare `/sw.js` au navigateur (production seule). */}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
