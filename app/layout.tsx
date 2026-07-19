import type { Metadata } from "next";
import { Barlow_Condensed, DM_Sans } from "next/font/google";

import { SiteChrome } from "@/components/layout/SiteChrome";
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
      </body>
    </html>
  );
}
