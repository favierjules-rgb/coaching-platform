import type { ReactNode } from "react";

import { Logo } from "@/components/ui/Logo";

interface AuthCardLayoutProps {
  /** Contenu de la carte (formulaire, message de confirmation/erreur...). */
  children: ReactNode;
  /**
   * Classes additionnelles sur le conteneur plein écran, en plus de
   * `flex min-h-screen flex-col items-center justify-center bg-background
   * px-4 py-12` (ex: "gap-6 text-center" pour les écrans de résultat type
   * AccessDenied/PaymentResultCard, "text-center" pour Inscription).
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
}: AuthCardLayoutProps) {
  return (
    <main
      className={
        outerClassName
          ? `flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 ${outerClassName}`
          : "flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12"
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
    </main>
  );
}
