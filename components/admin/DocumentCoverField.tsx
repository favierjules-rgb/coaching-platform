"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

import { DocumentCoverImage } from "@/components/shared/DocumentCoverImage";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  remplacerCouverture,
  supprimerCouverture,
  type PendingDocumentCover,
} from "@/lib/supabase/document-cover-lifecycle";
import {
  DOCUMENT_COVER_ASPECT,
  DOCUMENT_COVER_MAX_BYTES,
  DOCUMENT_COVER_MIME,
  validateDocumentCoverFile,
} from "@/lib/supabase/storage-document-covers";

/**
 * « IMAGE DE COUVERTURE » — le champ, dans les deux parcours du formulaire.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * DEUX MOMENTS, DEUX COMPORTEMENTS — ET UNE SEULE RAISON
 * ═════════════════════════════════════════════════════════════════════════
 *   CRÉATION (`differe`) — le fichier est validé et prévisualisé tout de
 *   suite, puis GARDÉ EN MÉMOIRE. Rien ne part vers Storage. Si le coach
 *   abandonne le formulaire, il n'existe aucun fichier à nettoyer : le
 *   problème des orphelins est supprimé plutôt que traité. La page pose
 *   l'image APRÈS la création, avec l'identifiant obtenu.
 *
 *   MODIFICATION — le document existe : « Téléverser » envoie, écrit la base,
 *   puis supprime l'ancienne image. Dans cet ordre, jamais l'inverse (voir
 *   lib/supabase/document-cover-lifecycle.ts).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * LA PRÉVISUALISATION PRÉCÈDE TOUJOURS L'ENVOI
 * ═════════════════════════════════════════════════════════════════════════
 * Choisir un fichier ne l'envoie jamais. Le coach voit d'abord le recadrage
 * 16/9 réel — ce qu'il verra sur la carte — et décide ensuite. C'est aussi ce
 * qui rend un refus de format immédiat et lisible, avant tout aller-retour
 * réseau.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * L'EXTENSION N'EST JAMAIS CONSULTÉE
 * ═════════════════════════════════════════════════════════════════════════
 * `validateDocumentCoverFile` lit les PREMIERS OCTETS du fichier et les
 * confronte au type déclaré : un `.jpg` qui est en réalité un SVG ou un PDF
 * est refusé ici. L'attribut `accept` ci-dessous ne filtre que le sélecteur
 * du système — c'est un confort, pas un contrôle.
 *
 * ⚠️ MAIS CE CONTRÔLE EST DANS LE NAVIGATEUR, DONC CONTOURNABLE. Il refuse
 * tôt et explique clairement ; il ne protège pas la base. Côté serveur, le
 * seau impose la TAILLE sur les octets reçus (vraie garantie) mais ne compare
 * les types MIME qu'au `content-type` ANNONCÉ : la signature réelle du fichier
 * n'est pas vérifiée par le serveur. La limite est détaillée en tête de
 * `lib/supabase/storage-document-covers.ts`, avec ce qui tient malgré tout.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * AUCUNE DOUBLE SOUMISSION POSSIBLE
 * ═════════════════════════════════════════════════════════════════════════
 * `enCours` désactive les deux boutons et le sélecteur pendant toute
 * opération. Le champ de fichier est vidé après chaque choix, sans quoi
 * re-sélectionner LE MÊME fichier après une erreur ne déclencherait aucun
 * évènement `change`.
 */
export function DocumentCoverField({
  documentId,
  coverStoragePath,
  titre,
  differe = false,
  onPending,
  onCommitted,
  disabled = false,
}: {
  documentId: string;
  /** Chemin actuellement EN BASE, ou `null`. Ignoré en mode différé. */
  coverStoragePath: string | null;
  titre: string;
  /** `true` sur un document pas encore créé : l'envoi est différé. */
  differe?: boolean;
  /** Mode différé : l'image validée attend la naissance du document. */
  onPending?: (pending: PendingDocumentCover | null) => void;
  /** Mode immédiat : appelé après une écriture RÉUSSIE en base. */
  onCommitted?: (coverStoragePath: string | null) => void | Promise<void>;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [choisi, setChoisi] = useState<File | null>(null);
  const [apercuLocal, setApercuLocal] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Une URL `blob:` retient son contenu en mémoire tant qu'elle n'est pas
  // révoquée. Sans ce nettoyage, choisir dix images d'affilée en garderait dix.
  useEffect(() => {
    return () => {
      if (apercuLocal) URL.revokeObjectURL(apercuLocal);
    };
  }, [apercuLocal]);

  function remplacerApercu(url: string | null) {
    setApercuLocal((precedent) => {
      if (precedent) URL.revokeObjectURL(precedent);
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
    setEnCours(true);
    const refus = await validateDocumentCoverFile(fichier);
    setEnCours(false);
    if (refus) {
      setErreur(refus);
      setChoisi(null);
      remplacerApercu(null);
      onPending?.(null);
      return;
    }

    const url = URL.createObjectURL(fichier);
    remplacerApercu(url);
    setChoisi(fichier);
    // ⚠️ EN MODE DIFFÉRÉ, TOUT S'ARRÊTE ICI. Aucun octet ne part vers Storage
    // avant que le document existe.
    if (differe) {
      onPending?.({ file: fichier, previewUrl: url });
    }
  }

  async function televerser() {
    if (!choisi || differe) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setErreur("Supabase n'est pas configuré.");
      return;
    }
    setEnCours(true);
    setErreur(null);
    const resultat = await remplacerCouverture(supabase, documentId, choisi, coverStoragePath);
    setEnCours(false);
    if (!resultat.ok) {
      // L'ancienne couverture est intacte : on ne touche pas à l'aperçu local,
      // le coach peut réessayer avec le même fichier.
      setErreur(resultat.error);
      return;
    }
    setChoisi(null);
    remplacerApercu(null);
    await onCommitted?.(resultat.coverStoragePath);
  }

  async function retirer() {
    setErreur(null);
    // Une image seulement choisie n'a jamais été envoyée : il n'y a rien à
    // supprimer côté Storage, et rien à écrire en base.
    if (choisi) {
      setChoisi(null);
      remplacerApercu(null);
      onPending?.(null);
      return;
    }
    if (differe || !coverStoragePath) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setErreur("Supabase n'est pas configuré.");
      return;
    }
    setEnCours(true);
    const resultat = await supprimerCouverture(supabase, documentId, coverStoragePath);
    setEnCours(false);
    if (!resultat.ok) {
      setErreur(resultat.error);
      return;
    }
    await onCommitted?.(null);
  }

  const aQuelqueChose = Boolean(choisi) || Boolean(coverStoragePath);
  const inactif = disabled || enCours;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="block text-xs uppercase tracking-wide text-muted-foreground">
        Image de couverture (facultative)
      </label>

      {/* L'aperçu montre le recadrage RÉEL : même rapport, même `object-cover`
          que la carte de l'élève et la liste du coach. */}
      <div className="w-full max-w-xs">
        {apercuLocal ? (
          <div
            className="relative overflow-hidden rounded-panel border border-border bg-surface-soft/40"
            style={{ aspectRatio: `${DOCUMENT_COVER_ASPECT.width} / ${DOCUMENT_COVER_ASPECT.height}` }}
            data-apercu="local"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu `blob:` local, hors next/image */}
            <img
              src={apercuLocal}
              alt={`Aperçu de la miniature de ${titre}`}
              className="h-full w-full object-cover object-center"
            />
          </div>
        ) : (
          <DocumentCoverImage
            coverStoragePath={differe ? null : coverStoragePath}
            titre={titre}
            Repli={ImageIcon}
          />
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {aQuelqueChose
          ? choisi
            ? differe
              ? "Image retenue — elle sera enregistrée avec le document."
              : "Image choisie — clique sur « Téléverser » pour l'enregistrer."
            : "Une miniature est enregistrée pour ce document."
          : `Aucune image — la carte affichera un emplacement neutre. JPEG, PNG ou WebP, ${Math.round(DOCUMENT_COVER_MAX_BYTES / (1024 * 1024))} Mo max.`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={DOCUMENT_COVER_MIME.join(",")}
          disabled={inactif}
          onChange={(event) => void choisir(event)}
          className="block w-full rounded-control text-sm text-muted-foreground file:mr-4 file:min-h-[44px] file:rounded-control file:border file:border-primary file:bg-transparent file:px-4 file:py-2 file:text-xs file:font-bold file:uppercase file:tracking-widest file:text-primary hover:file:bg-primary hover:file:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {choisi && !differe && (
          <button
            type="button"
            onClick={() => void televerser()}
            disabled={inactif}
            className="pressable flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-control border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enCours ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Upload size={13} aria-hidden />}
            {enCours ? "Envoi…" : "Téléverser"}
          </button>
        )}
        {aQuelqueChose && (
          <button
            type="button"
            onClick={() => void retirer()}
            disabled={inactif}
            aria-label="Retirer la miniature de couverture"
            className="pressable flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={16} aria-hidden />
          </button>
        )}
      </div>

      {erreur && (
        <p className="flex items-center gap-2 text-xs text-destructive" role="alert">
          <AlertTriangle size={13} aria-hidden className="flex-shrink-0" />
          {erreur}
        </p>
      )}
    </div>
  );
}
