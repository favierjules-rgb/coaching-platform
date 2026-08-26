"use client";

import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";

import { RecipeImage } from "@/components/shared/RecipeImage";
import { Loader } from "@/components/ui/Loader";
import {
  RECIPE_IMAGE_MAX_EDGE,
  RECIPE_IMAGE_SOURCE_MIME,
  describeRecipeImageRejection,
} from "@/lib/nutrition/recipe-image";
import {
  browserRecipeImageCodec,
  optimizeRecipeImage,
} from "@/lib/nutrition/recipe-image-optimizer";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { attachRecipeImage, detachRecipeImage } from "@/lib/supabase/storage-recipe-images";

/**
 * « PHOTO DE LA RECETTE » — une zone compacte, dans le formulaire existant.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * DEUX MOMENTS, DEUX COMPORTEMENTS — ET UNE SEULE RAISON
 * ═════════════════════════════════════════════════════════════════════════
 * Le chemin Storage d'une photo contient l'identifiant de la recette, et la
 * policy d'écriture exige que cette recette EXISTE et appartienne au coach.
 * Sur une recette pas encore enregistrée, il n'y a donc rien à quoi
 * rattacher un fichier.
 *
 *   CRÉATION (`recipeId === null`) — le fichier est optimisé tout de suite
 *   (le coach voit le résultat, et une erreur de format se dit
 *   immédiatement), puis GARDÉ EN MÉMOIRE. Rien ne part vers Storage. Si
 *   l'enregistrement de la recette échoue, il n'existe aucun fichier à
 *   nettoyer — le problème des orphelins est supprimé plutôt que traité.
 *   La page appelle l'envoi APRÈS la création, avec l'identifiant obtenu.
 *
 *   MODIFICATION (`recipeId !== null`) — la recette existe : envoi immédiat,
 *   commit, puis nettoyage de l'ancienne. Le coach voit la photo posée sans
 *   avoir à enregistrer quoi que ce soit d'autre.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * LA PHOTO N'EST PAS UN CHAMP DU FORMULAIRE
 * ═════════════════════════════════════════════════════════════════════════
 * `RecipeFormState` ne la porte pas, et `toRecipeSavePayload` ne l'émet
 * jamais : `save_nutrition_recipe` n'écrit pas `image_path`. Conséquence
 * voulue — publier, dépublier ou archiver depuis n'importe quel écran ne peut
 * pas toucher à la photo, et enregistrer un brouillon ne peut pas l'effacer.
 * Le seul chemin d'écriture est `set_nutrition_recipe_image`.
 */

export interface PendingRecipeImage {
  readonly blob: Blob;
  readonly mime: string;
  /** URL `blob:` locale — à révoquer par le propriétaire de l'état. */
  readonly previewUrl: string;
}

export function RecipeImageField({
  recipeId,
  coachId,
  imagePath,
  recipeName,
  onCommitted,
  onPending,
  disabled = false,
}: {
  /** `null` sur une recette pas encore créée : l'envoi est différé. */
  recipeId: string | null;
  /**
   * Le coach propriétaire — il compose le chemin, il n'autorise rien. La
   * policy Storage exige que la recette du chemin lui appartienne réellement :
   * un `coachId` faux se fait refuser par la base, pas par cet écran.
   */
  coachId: string | null;
  imagePath: string | null;
  recipeName: string;
  /** Appelé après un envoi RÉUSSI (modification) — le chemin est en base. */
  onCommitted?: (imagePath: string | null) => void;
  /** Appelé en création : l'image optimisée attend la naissance de la recette. */
  onPending?: (pending: PendingRecipeImage | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [remarque, setRemarque] = useState<string | null>(null);
  const [aperçuLocal, setAperçuLocal] = useState<string | null>(null);

  // Une URL `blob:` retient son contenu en mémoire tant qu'elle n'est pas
  // révoquée. Sans ce nettoyage, choisir dix photos d'affilée en garderait
  // dix.
  useEffect(() => {
    return () => {
      if (aperçuLocal) URL.revokeObjectURL(aperçuLocal);
    };
  }, [aperçuLocal]);

  function remplacerAperçu(url: string | null) {
    setAperçuLocal((précédent) => {
      if (précédent) URL.revokeObjectURL(précédent);
      return url;
    });
  }

  async function choisir(event: React.ChangeEvent<HTMLInputElement>) {
    const fichier = event.target.files?.[0];
    // Vidé tout de suite : sans cela, re-choisir LE MÊME fichier après une
    // erreur ne déclenche aucun `change`.
    event.target.value = "";
    if (!fichier) return;

    setErreur(null);
    setRemarque(null);
    setEnCours(true);

    // ── 1. Optimiser, toujours — même en création ────────────────────────
    const optimisée = await optimizeRecipeImage(fichier, browserRecipeImageCodec);
    if (!optimisée.ok) {
      setEnCours(false);
      setErreur(describeRecipeImageRejection(optimisée.code));
      return;
    }

    const aperçu = URL.createObjectURL(optimisée.blob);

    // ── 2a. Recette pas encore créée : on garde, on n'envoie rien ────────
    if (recipeId === null) {
      remplacerAperçu(aperçu);
      setEnCours(false);
      onPending?.({ blob: optimisée.blob, mime: optimisée.mime, previewUrl: aperçu });
      setRemarque(
        `Photo prête (${formaterPoids(optimisée.bytes)}). Elle sera envoyée à l'enregistrement de la recette.`,
      );
      return;
    }

    // ── 2b. Recette existante : envoi, commit, nettoyage ─────────────────
    const supabase = createSupabaseBrowserClient();
    if (!supabase || coachId === null) {
      URL.revokeObjectURL(aperçu);
      setEnCours(false);
      setErreur(
        coachId === null
          ? "Aucun coach n'est identifié : impossible d'envoyer une photo."
          : "Connexion indisponible. Rien n'a été envoyé.",
      );
      return;
    }

    const résultat = await attachRecipeImage(supabase, {
      recipeId,
      coachId,
      blob: optimisée.blob,
      mime: optimisée.mime,
      fileId: crypto.randomUUID(),
    });

    URL.revokeObjectURL(aperçu);
    setEnCours(false);

    if (!résultat.ok) {
      setErreur(résultat.message);
      return;
    }
    remplacerAperçu(null);
    if (résultat.orphanLeft) {
      setRemarque("Photo enregistrée. L'ancien fichier n'a pas pu être supprimé du stockage.");
    } else {
      setRemarque(`Photo enregistrée (${formaterPoids(optimisée.bytes)}).`);
    }
    onCommitted?.(résultat.imagePath);
  }

  async function retirer() {
    setErreur(null);
    setRemarque(null);

    // En création, il n'y a rien en base : on jette l'image gardée.
    if (recipeId === null) {
      remplacerAperçu(null);
      onPending?.(null);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setErreur("Connexion indisponible. Rien n'a été modifié.");
      return;
    }
    setEnCours(true);
    const résultat = await detachRecipeImage(supabase, recipeId);
    setEnCours(false);
    if (!résultat.ok) {
      setErreur(résultat.message);
      return;
    }
    remplacerAperçu(null);
    if (résultat.orphanLeft) {
      setRemarque("Photo retirée. Le fichier n'a pas pu être supprimé du stockage.");
    }
    onCommitted?.(null);
  }

  const aUneImage = imagePath !== null || aperçuLocal !== null;

  return (
    <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-bold uppercase text-foreground">
            Photo de la recette
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Facultative. JPEG, PNG ou WebP — l&apos;image est réduite à {RECIPE_IMAGE_MAX_EDGE}
            {" "}px et recompressée avant l&apos;envoi.
          </p>
        </div>
        {aUneImage && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || enCours}
              className="pressable flex min-h-11 items-center gap-2 rounded-control border border-border px-3 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <RefreshCw size={14} />
              Remplacer
            </button>
            <button
              type="button"
              onClick={() => void retirer()}
              disabled={disabled || enCours}
              className="pressable flex min-h-11 items-center gap-2 rounded-control border border-border px-3 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            >
              <Trash2 size={14} />
              Retirer
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 max-w-sm">
        {aperçuLocal !== null ? (
          <div
            className="relative overflow-hidden rounded-panel border border-border bg-surface-soft"
            style={{ aspectRatio: "4 / 3" }}
          >
            {/* Aperçu LOCAL : une URL `blob:` n'est pas optimisable par
                next/image, et n'a pas à l'être — elle ne quitte pas l'onglet. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={aperçuLocal} alt="" className="h-full w-full object-cover" />
          </div>
        ) : imagePath !== null ? (
          <RecipeImage
            imagePath={imagePath}
            alt={recipeName || "Recette"}
            sizes="(max-width: 640px) 90vw, 384px"
          />
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || enCours}
            className="pressable flex w-full flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-border py-10 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {enCours ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            <span className="text-xs font-bold uppercase tracking-widest">
              {enCours ? "Traitement…" : "Ajouter une photo"}
            </span>
          </button>
        )}
      </div>

      {enCours && aUneImage && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          {/*
            ⚠️ ACTION COURTE, MAIS HORS D'UN BOUTON : la phrase reste — elle
            explique ce qui se passe pendant que la photo est retaillée — et
            l'emblème l'accompagne au lieu d'un cercle générique. Le `Loader`
            porte lui-même `role="status"` : le paragraphe ne le double plus,
            sinon l'annonce serait lue deux fois.
          */}
          <Loader libelle="Traitement de l&apos;image…" variante="inline" />
          <span aria-hidden="true">Traitement de l&apos;image…</span>
        </p>
      )}

      {erreur && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive" role="alert">
          <ImageOff size={12} className="mt-0.5 flex-shrink-0" />
          {erreur}
        </p>
      )}
      {!erreur && remarque && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {remarque}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={RECIPE_IMAGE_SOURCE_MIME.join(",")}
        className="hidden"
        onChange={(e) => void choisir(e)}
      />
    </section>
  );
}

/** « 248 Ko », « 1,1 Mo ». `Intl` suffit : aucune dépendance. */
function formaterPoids(octets: number): string {
  if (octets < 1024 * 1024) {
    return `${Math.max(1, Math.round(octets / 1024))} Ko`;
  }
  return `${(octets / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}
