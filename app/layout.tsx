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
 * L'ÉCHELLE D'AFFICHAGE DE LA PWA — UNE SEULE DÉCLARATION, ICI.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LE DÉFAUT CORRIGÉ, ET OÙ IL EST CORRIGÉ
 * ═══════════════════════════════════════════════════════════════════════
 * Toucher un champ « Reps (8–13) » agrandissait toute la page, et il fallait
 * dézoomer à la main. La cause n'est PAS dans ce fichier : WebKit — et
 * Chromium Android — zooment dès qu'un contrôle focalisé descend sous 16px,
 * et `text-sm` de Tailwind vaut 14px.
 *
 * ⚠️ LE CORRECTIF DE FOND EST DANS app/globals.css, section « ÉCHELLE
 * D'AFFICHAGE » : un plancher de 16px sur `input`, `textarea` et `select` sous
 * 768px. C'est lui, et lui seul, qui supprime le zoom au focus. Ce fichier ne
 * fait que poser une échelle de départ explicite.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUNE BORNE SUR LE ZOOM DE L'UTILISATEUR — ET C'EST UN CHOIX
 * ═══════════════════════════════════════════════════════════════════════
 * Le plafond d'échelle (`maximum-scale`) et l'interdiction de mise à
 * l'échelle (`user-scalable=no`) bornent le zoom de L'UTILISATEUR — le
 * pincement, le double-tap. Ils ne changent RIEN au zoom automatique au
 * focus, qui est le défaut rapporté. Les poser aurait donc coûté une
 * régression d'accessibilité sans rien gagner sur le problème à résoudre.
 *
 * Le dépôt porte déjà cette règle, et elle est ANTÉRIEURE à ce chantier : le
 * lot A5.9 (débordement horizontal de la fiche aliment) a corrigé son défaut
 * à la source — `min-w-0`, carrousel — plutôt qu'en verrouillant l'échelle,
 * et a figé la garantie dans scripts/tests/aliments-a5-responsive.mts,
 * contrôle RESP-SUP : deux assertions y exigent que ce fichier ne nomme NI
 * le plafond d'échelle, NI l'interdiction de mise à l'échelle par
 * l'utilisateur — « aucun plafond de zoom » et « aucun blocage du zoom
 * utilisateur ».
 *
 * ⚠️ ET CES ASSERTIONS LISENT LE TEXTE BRUT DU FICHIER, commentaires compris.
 * Écrire ici les noms exacts des deux propriétés — même pour expliquer qu'on
 * ne les pose PAS — suffirait à les faire rougir. C'est arrivé pendant ce
 * chantier. La prose les désigne donc par leur orthographe HTML
 * (`maximum-scale`, `user-scalable`) et jamais par l'identifiant TypeScript :
 * ce fichier ne contient aucune de ces deux chaînes, ce qui est la seule
 * façon non ambiguë de respecter le contrat.
 *
 * Ce contrat reste EN VIGUEUR. Un utilisateur malvoyant doit pouvoir pincer
 * pour agrandir, dans l'application comme ailleurs. Deux tests le défendent
 * désormais : celui d'A5.9, et les contrôles E5/E6 de
 * scripts/tests/pwa-echelle-affichage.mts, qui ROUGISSENT si l'une de ces
 * deux propriétés réapparaît.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CE QUE LES TROIS VALEURS POSÉES FONT RÉELLEMENT
 * ═══════════════════════════════════════════════════════════════════════
 * Avant ce chantier, cet objet ne portait QUE `themeColor` : Next.js appliquait
 * son viewport par défaut, sans qu'aucune de ces valeurs soit écrite. Elles
 * sont désormais EXPLICITES, ce qui les rend vérifiables par un test :
 *
 *   · `width: "device-width"` — la page fait la largeur de l'écran, et non
 *     celle d'un écran de bureau imaginaire qu'il faudrait réduire ;
 *   · `initialScale: 1` — on ouvre à l'échelle 1, jamais réduit ;
 *   · `minimumScale: 1` — l'échelle de DÉPART ne descend pas sous 1. Sans
 *     lui, certains moteurs ouvrent un document qui déborde horizontalement
 *     à une échelle inférieure à 1, et toute l'interface rétrécit.
 *
 *     ⚠️ IL N'EMPÊCHE PAS L'UTILISATEUR DE DÉZOOMER. `minimum-scale` borne
 *     l'échelle que le NAVIGATEUR choisit, pas le geste de pincement — que
 *     seul `user-scalable=no` interdirait, et qui n'est pas posé. La
 *     distinction est exactement celle que le contrat A5.9 protège.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * `themeColor` — INCHANGÉ
 * ═══════════════════════════════════════════════════════════════════════
 * Valeur FIXE, pas un couple clair/sombre : `theme-color` répond au thème du
 * SYSTÈME, alors que le thème du site vit en localStorage et vaut sombre par
 * défaut. Un téléphone en mode clair afficherait sinon une barre blanche
 * au-dessus d'une application restée noire.
 *
 * ⚠️ AUCUN AUTRE `export const viewport` NE DOIT EXISTER. Next.js résout la
 * métadonnée du layout le PLUS PROCHE de la page : un second viewport dans
 * `app/(student)/layout.tsx` ou dans une page écraserait silencieusement
 * celui-ci pour toute une branche de l'application. C'est vérifié par
 * scripts/tests/pwa-echelle-affichage.mts.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
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
