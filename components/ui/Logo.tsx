import Image from "next/image";
import Link from "next/link";

interface LogoProps {
  /**
   * "compact" (défaut, inchangé) : rendu texte "SETH" utilisé partout dans
   * l'app (Footer, sidebars admin/élève, écrans d'auth, onboarding).
   * "header" (chantier /programmes, juillet 2026, Groupe 3) : SVG officiel
   * `/brand/logo/seth-logo-primary.svg`, plus grand et plus voyant, réservé
   * au Header public — n'affecte aucun des 7 autres appels de <Logo />.
   */
  variant?: "compact" | "header";
}

export function Logo({ variant = "compact" }: LogoProps) {
  if (variant === "header") {
    return (
      <Link href="/" className="min-w-0 shrink-0">
        {/*
          `logo-complet-blanc.svg` (juillet 2026) : dérivé du fichier fourni
          par Jules (`brand/logo/approved/Logo-complet-blanc.svg`, jamais
          modifié). Ce fichier source contenait le même défaut que
          `seth-logo-primary.svg` : un rectangle plein couvrant tout le
          canevas, ici sans classe donc en noir par défaut (invisible sur un
          fond sombre mais pas réellement transparent). Le dérivé retire
          uniquement ce rectangle, garde tous les tracés (lettres + étoiles)
          en blanc pur (#ffffff), fond transparent — aucun filtre CSS requis.
          viewBox recadré sur le tracé réel, ratio ≈2.902:1 (1269.57 ×
          437.49, arrondi 1270×438). Remplace `seth-logo-header-white.svg`
          (dérivé de l'ancien fichier, plus utilisé ici).
          `unoptimized` : évite l'optimiseur d'images de Next.js, qui refuse
          les SVG locaux tant que `images.dangerouslyAllowSVG` n'est pas
          activé dans next.config.ts (changement de config hors périmètre de
          ce fichier) — sans ce flag, next/image renvoie une erreur 400 à
          l'exécution pour ce fichier.
        */}
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Image
            src="/brand/logo/logo-complet-blanc.svg"
            alt="SETH"
            width={1270}
            height={438}
            unoptimized
            priority
            className="mt-0 h-10 w-auto shrink-0 object-contain lg:h-12"
          />
          <span
            aria-hidden="true"
            className="mt-5 hidden h-8 w-px shrink-0 bg-white/30 sm:block"
          />
          <span className="mt-5 hidden whitespace-nowrap text-xs font-medium uppercase tracking-[0.28em] text-white/65 sm:block lg:text-sm">
            Préparation physique
          </span>
        </div>
      </Link>
    );
  }

  return (
    <Link href="/" className="flex items-baseline gap-2">
      <span className="font-heading text-xl font-extrabold italic tracking-wide text-foreground">
        SETH
      </span>
      <span className="hidden text-[11px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
        Préparation Physique
      </span>
    </Link>
  );
}
