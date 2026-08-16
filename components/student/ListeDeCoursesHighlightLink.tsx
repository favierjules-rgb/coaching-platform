"use client";

import Link from "next/link";
import { ShoppingBasket, ArrowRight } from "lucide-react";

/**
 * COURSES C1 — L'ENTRÉE MISE EN AVANT VERS LA LISTE DE COURSES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI ELLE EST LE JUMEAU EXACT DE « RECETTES »
 * ────────────────────────────────────────────────────────────────────────────
 * Ce sont les deux OUTILS du haut de l'écran nutrition : on ouvre les recettes
 * pour décider quoi manger, on ouvre les courses pour aller l'acheter. Deux
 * gestes de même rang méritent la même carte — même hauteur, même structure,
 * même flèche, même filet lumineux. Seule la teinte change.
 *
 * ⚠️ L'ANIMATION N'EST PAS DUPLIQUÉE. Elle vit entièrement dans la règle CSS
 * `.recettes-halo` (app/globals.css), paramétrée par `--halo-teinte` : ce
 * composant se contente d'ajouter `.halo-info`. Il n'existe donc qu'UNE
 * animation dans le projet, et un réglage de durée ou de courbe s'applique
 * aux deux entrées sans qu'on ait à y penser.
 *
 * ⚠️ LE MARKUP, LUI, EST RECOPIÉ — QUINZE LIGNES, ET C'EST VOULU. Extraire un
 * composant générique aurait vidé `RecipesHighlightLink.tsx` des littéraux
 * (`border-success/50`, `bg-success/10`, `recettes-halo`) que la suite
 * `nutrition-v2-unified` lit DANS CE FICHIER. Refactorer aurait donc obligé à
 * réécrire un test hors périmètre pour retrouver du vert — exactement ce qu'on
 * s'interdit. La factorisation porte sur ce qui coûte à maintenir (la règle
 * CSS), pas sur quinze lignes de balisage.
 *
 * ⚠️ AUCUNE COULEUR CODÉE EN DUR. `--info` est un token de thème, déclaré à
 * côté de `--destructive` / `--warning` / `--success`, et aligné sur la clé
 * `blue` du vocabulaire partagé `lib/ui/color-keys.ts`.
 *
 * ⚠️ AUCUNE LOGIQUE MÉTIER ICI : ce composant ne fait que naviguer. Il ne
 * connaît ni le plan, ni la période, ni les repas — la liste est liée à
 * l'ÉLÈVE et à des dates réelles, pas à un plan, d'où l'absence de `planId`
 * dans l'URL.
 */
export function ListeDeCoursesHighlightLink({ className = "" }: { readonly className?: string }) {
  return (
    <Link
      href="/nutrition/courses"
      className={`recettes-halo halo-info pressable group relative flex min-h-[44px] items-center justify-between gap-3 overflow-hidden rounded-card border border-info/50 bg-info/10 px-4 py-3 transition-colors hover:bg-info/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/50 ${className}`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <ShoppingBasket size={18} className="flex-shrink-0 text-info" />
        <span className="flex min-w-0 flex-col">
          <span className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
            GÉNÉRER MA LISTE DE COURSE
          </span>
          <span className="text-[11px] leading-tight text-muted-foreground">
            De 1 à 7 jours, depuis tes repas validés
          </span>
        </span>
      </span>
      <ArrowRight
        size={16}
        className="flex-shrink-0 text-info transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
