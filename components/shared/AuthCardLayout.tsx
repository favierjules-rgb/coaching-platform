import Image from "next/image";
import type { ReactNode } from "react";

import { Logo } from "@/components/ui/Logo";

interface AuthCardLayoutProps {
  /** Contenu de la carte (formulaire, message de confirmation/erreur...). */
  children: ReactNode;
  /**
   * Classes additionnelles sur le conteneur des enfants (logo/carte/footer),
   * en plus de `relative z-10 flex w-full flex-col items-center` (ex:
   * "gap-6 text-center" pour les écrans de résultat type
   * AccessDenied/PaymentResultCard). Nom conservé ("outer...") pour ne pas
   * casser les appelants existants, même si ces classes vivent maintenant
   * sur le wrapper de contenu plutôt que sur `<main>` lui-même (voir
   * commentaire dans le JSX ci-dessous).
   */
  outerClassName?: string;
  /**
   * Par défaut, le logo est enveloppé dans un `<div className="mb-8">` (gère
   * l'espacement logo/carte). Passer `false` quand l'espacement est déjà
   * géré par un `gap` sur le conteneur (voir `outerClassName`).
   */
  wrapLogo?: boolean;
  /** Classes additionnelles sur la carte, en plus de `w-full max-w-md border border-border bg-card p-8`. */
  cardClassName?: string;
  /** Contenu affiché sous la carte, hors de celle-ci (ex: lien "retour"). */
  footer?: ReactNode;
  /** Si `false`, n'affiche pas la carte englobante (état "chargement" sans carte, ex: spinner seul). */
  card?: boolean;
  /**
   * Photo de fond plein écran (chantier "backgrounds", juillet 2026) —
   * optionnelle, opt-in par écran (ex: uniquement LoginForm pour l'instant)
   * pour ne pas modifier les 5 autres écrans qui partagent ce composant.
   * Toujours combinée à un dégradé sombre (mêmes valeurs que le fond du
   * Hero, voir Hero.tsx) pour garder le logo et la carte lisibles sur
   * l'image.
   */
  backgroundImage?: string;
}

/**
 * Coquille visuelle partagée des pages d'authentification et assimilées
 * (connexion, mot de passe oublié, réinitialisation, inscription, accès
 * refusé, résultat de paiement) — chantier redesign UI, Lot 5. Extrait la
 * structure "logo centré + carte" jusqu'ici dupliquée à l'identique dans 6
 * fichiers. Ne contient aucune logique métier/auth : uniquement le wrapper
 * visuel, chaque appelant garde l'intégralité de ses handlers, appels
 * Supabase et redirections.
 *
 * Racine en `<main>` (Lot 6, Groupe C — landmarks) : ces pages sont des
 * écrans autonomes exclus de SiteChrome (voir PRIVATE_PREFIXES) et ne sont
 * enveloppées par aucun autre `<main>` (AdminShell/StudentShell), donc sans
 * ce tag elles n'exposaient aucun repère de navigation "contenu principal"
 * pour les lecteurs d'écran. Changement de balise uniquement, aucun style
 * ni comportement modifié.
 */
export function AuthCardLayout({
  children,
  outerClassName,
  wrapLogo = true,
  cardClassName,
  footer,
  card = true,
  backgroundImage,
}: AuthCardLayoutProps) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      {backgroundImage && (
        <div className="absolute inset-0">
          <Image src={backgroundImage} alt="" fill priority className="object-cover" />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(10,10,10,0.45)_0%,rgba(10,10,10,0.5)_60%,rgba(10,10,10,0.75)_100%)]" />
        </div>
      )}

      {/*
        `relative z-10` : nécessaire dès qu'un fond image est présent
        (position absolute juste au-dessus) — un élément positionné passe
        toujours devant le contenu en flux normal, quel que soit l'ordre
        dans le DOM, donc sans ce wrapper le fond recouvrirait le logo et
        la carte. Inoffensif quand `backgroundImage` est absent. `outerClassName`
        (gap-6/text-center pour AccessDenied/PaymentResultCard) vit ici
        désormais, plus sur `<main>` : c'est ce wrapper, pas `<main>`, qui
        porte réellement les enfants flex (logo/carte/footer) auxquels ces
        classes s'appliquent — comportement identique à avant pour les 6
        appelants, fond ou pas.
      */}
      <div
        className={
          outerClassName
            ? `relative z-10 flex w-full flex-col items-center ${outerClassName}`
            : "relative z-10 flex w-full flex-col items-center"
        }
      >
        {wrapLogo ? (
          <div className="mb-8">
            <Logo />
          </div>
        ) : (
          <Logo />
        )}

        {card ? (
          <div
            className={
              cardClassName
                ? `w-full max-w-md border border-border bg-card p-8 ${cardClassName}`
                : "w-full max-w-md border border-border bg-card p-8"
            }
          >
            {children}
          </div>
        ) : (
          children
        )}

        {footer}
      </div>
    </main>
  );
}
