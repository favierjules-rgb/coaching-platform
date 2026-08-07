import Image from "next/image";
import { ChefHat } from "lucide-react";

import {
  RECIPE_IMAGE_ASPECT,
  recipeImagePublicUrl,
} from "@/lib/nutrition/recipe-image";

/**
 * LA PHOTO D'UNE RECETTE — une seule implémentation, quatre écrans.
 *
 * Le catalogue admin, la fiche recette, la liste élève et le détail élève
 * affichent la même chose à des tailles différentes. En écrire quatre
 * versions garantirait que trois divergent : rapport d'image, repli, ou
 * attribut `sizes` oublié quelque part.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI `next/image`, ET CE QU'IL FAUT LUI DONNER
 * ─────────────────────────────────────────────────────────────────────────
 * Le fichier stocké fait 1400 px de côté long — la bonne taille pour un
 * grand écran, quatre fois trop pour une vignette de catalogue. `next/image`
 * découpe des variantes et sert la plus petite qui convient, en AVIF ou WebP
 * selon le navigateur. Sur mobile, c'est la différence entre 300 Ko et 25 Ko
 * par recette.
 *
 * Deux conditions pour que ce soit vrai, et elles sont tenues ici :
 *   - `sizes` DOIT décrire la largeur réelle du conteneur. Sans lui,
 *     `fill` fait télécharger la variante pleine largeur d'écran ;
 *   - le rapport d'image est FIXE (`aspect-[4/3]`), donc la place est
 *     réservée avant le chargement : aucun saut de mise en page.
 *
 * `loading="lazy"` est le défaut de `next/image` : une liste de vingt
 * recettes ne télécharge que ce qui est à l'écran. Le premier visuel d'une
 * fiche peut demander `priority` — c'est le seul cas où l'attente se voit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE REPLI N'EST PAS UNE ERREUR
 * ─────────────────────────────────────────────────────────────────────────
 * Une recette sans photo est un cas NORMAL — l'image est facultative, et le
 * restera. Le repli occupe donc exactement la même place, dans le même
 * rapport, pour que la grille ne se déforme pas selon que le coach a illustré
 * ou non.
 */
export function RecipeImage({
  imagePath,
  alt,
  sizes,
  priority = false,
  className = "",
  rounded = "rounded-panel",
}: {
  imagePath: string | null;
  /** Décrit la RECETTE, pas la photo : « Bol poulet riz curry ». */
  alt: string;
  /** Largeur réelle du conteneur, par palier. Obligatoire : voir l'en-tête. */
  sizes: string;
  priority?: boolean;
  className?: string;
  rounded?: string;
}) {
  const url = recipeImagePublicUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, imagePath);

  return (
    <div
      className={`relative overflow-hidden border border-border bg-surface-soft ${rounded} ${className}`}
      style={{ aspectRatio: `${RECIPE_IMAGE_ASPECT.width} / ${RECIPE_IMAGE_ASPECT.height}` }}
    >
      {url ? (
        <Image
          src={url}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-muted-foreground"
          aria-hidden="true"
        >
          <ChefHat size={20} />
        </div>
      )}
    </div>
  );
}
