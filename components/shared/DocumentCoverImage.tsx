"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, type LucideIcon } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  DOCUMENT_COVER_ASPECT,
  getSignedDocumentCoverUrl,
} from "@/lib/supabase/storage-document-covers";

/**
 * LA MINIATURE DE COUVERTURE D'UN DOCUMENT — UNE SEULE IMPLÉMENTATION, DEUX ESPACES.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI UN COMPOSANT PARTAGÉ, ET PAS UN PAR ESPACE
 * ═════════════════════════════════════════════════════════════════════════
 * La carte de l'élève et la liste du coach doivent montrer la MÊME chose. En
 * écrire deux versions garantirait qu'elles divergent : le rapport d'image,
 * le recadrage, le repli ou l'attribut `loading` finiraient par ne plus
 * correspondre, et personne ne le remarquerait avant une capture d'écran.
 *
 * Ce qui diffère entre les deux espaces est la LARGEUR du conteneur et
 * l'arrondi — parce que l'un est une grille de cartes et l'autre une liste de
 * lignes. Tout le reste est ici, et ne se règle pas depuis l'appelant.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * L'EMPLACEMENT EST TOUJOURS LÀ, MÊME SANS IMAGE
 * ═════════════════════════════════════════════════════════════════════════
 * Un document sans couverture est le cas NORMAL — la miniature est
 * facultative, et le restera. Le repli occupe donc exactement la même place,
 * dans le même rapport 16/9 : la grille ne se déforme pas selon que le coach
 * a illustré ou non, et aucune carte ne « saute » au chargement.
 *
 * ⚠️ ET LE REPLI N'EST PAS UNE ERREUR. Il porte une icône discrète, pas un
 * message d'échec : rien ne doit laisser croire à l'élève qu'une image
 * manque ou qu'un chargement a raté.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * UNE SIGNATURE, PAS UNE BOUCLE
 * ═════════════════════════════════════════════════════════════════════════
 * L'effet ne dépend que de `coverStoragePath`, et une référence garde contre
 * le double montage du mode strict. `onError` pose `echec` et ne redemande
 * RIEN : une URL expirée ou un fichier disparu retombe définitivement sur le
 * repli pour cette carte. Re-signer dans `onError` produirait exactement la
 * boucle qu'on refuse — échec, signature, échec, signature.
 *
 * ⚠️ L'URL SIGNÉE NE QUITTE JAMAIS CET ÉTAT REACT : ni `localStorage`, ni
 * `sessionStorage`, ni IndexedDB, ni la base. Elle expire, et c'est voulu.
 *
 * ⚠️ AUCUNE BALISE `<img>` N'EST ÉMISE AVANT QU'UNE URL EXISTE. Le rendu
 * serveur n'exécute pas les effets : c'est donc le repli qui sort, et jamais
 * un `src` vide — une carte cassée est pire qu'une carte sans image.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CE COMPOSANT NE DÉCIDE PAS
 * ═════════════════════════════════════════════════════════════════════════
 * Il ne décide RIEN des droits. La signature est délivrée — ou refusée — par
 * la policy `document_covers_select_accessible` : un brouillon, un archivé,
 * un document non affecté et non global, ou le document d'un autre coach ne
 * donnent aucune URL, et la carte montre le repli. Un `coverStoragePath`
 * forgé côté navigateur n'ouvre donc rien.
 */
/**
 * LE CADRE D'UNE ILLUSTRATION DE CARTE — DÉFINI ICI, ET NULLE PART AILLEURS.
 *
 * ⚠️ EXPORTÉ PARCE QU'IL Y A DEUX ILLUSTRATIONS POSSIBLES, PAS DEUX CADRES.
 * La couverture (ce composant) et l'aperçu de l'original (`MiniatureImage`,
 * dans la bibliothèque élève) signent dans des seaux différents et ne peuvent
 * donc pas partager le même composant — mais elles occupent EXACTEMENT la
 * même place : même rapport 16/9, même recadrage, même bordure, même fond.
 *
 * Recopier ces trois chaînes dans le second appelant garantirait qu'elles
 * divergent : une carte illustrée par son original serait plus haute ou plus
 * basse que sa voisine, et personne ne le verrait avant une capture d'écran.
 */
export const CLASSES_CADRE_ILLUSTRATION =
  "relative overflow-hidden border border-border bg-surface-soft/40";

/** Le recadrage : l'image remplit le cadre, centrée, jamais déformée. */
export const CLASSES_IMAGE_ILLUSTRATION = "h-full w-full object-cover object-center";

/**
 * Le rapport, posé en style et non en classe : il réserve la place AVANT le
 * chargement, donc aucune carte ne saute. Aucune hauteur en pixels, nulle part.
 */
export const STYLE_CADRE_ILLUSTRATION: { aspectRatio: string } = {
  aspectRatio: `${DOCUMENT_COVER_ASPECT.width} / ${DOCUMENT_COVER_ASPECT.height}`,
};

export function DocumentCoverImage({
  coverStoragePath,
  titre,
  Repli = ImageIcon,
  rounded = "rounded-panel",
  className = "",
}: {
  coverStoragePath: string | null;
  /** Décrit le DOCUMENT, pas l'image : « Guide de la semaine 1 ». */
  titre: string;
  /** Icône du repli — le type du document, quand l'appelant le connaît. */
  Repli?: LucideIcon;
  rounded?: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [echec, setEchec] = useState(false);
  // Garde anti-double-signature en mode strict (double montage en dév).
  const demande = useRef<string | null>(null);

  useEffect(() => {
    if (!coverStoragePath) return;
    if (demande.current === coverStoragePath) return;
    demande.current = coverStoragePath;
    let annule = false;
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      const signee = await getSignedDocumentCoverUrl(supabase, coverStoragePath);
      if (annule) return;
      if (signee) {
        setUrl(signee);
      } else {
        setEchec(true);
      }
    })();
    return () => {
      annule = true;
    };
  }, [coverStoragePath]);

  const montrable = Boolean(coverStoragePath) && !echec && url !== null;

  return (
    <div
      className={`${CLASSES_CADRE_ILLUSTRATION} ${rounded} ${className}`}
      style={STYLE_CADRE_ILLUSTRATION}
      data-couverture={montrable ? "image" : "repli"}
    >
      {montrable ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire, hors next/image (aucun domaine stable à autoriser)
        <img
          src={url ?? ""}
          alt={`Miniature de ${titre}`}
          onError={() => setEchec(true)}
          loading="lazy"
          className={CLASSES_IMAGE_ILLUSTRATION}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-muted-foreground"
          aria-hidden="true"
        >
          <Repli size={22} />
        </div>
      )}
    </div>
  );
}
