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
