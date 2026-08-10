"use client";

import { useCallback, useEffect, useState } from "react";

import { MediaModal } from "@/components/shared/MediaModal";
import { NativeVideoPlayer } from "@/components/shared/video/NativeVideoPlayer";
import { YouTubeEmbed } from "@/components/shared/video/YouTubeEmbed";
import { resoudreSource, type VideoSource } from "@/lib/video/source";

/**
 * LE LECTEUR — ON RESTE DANS SETH.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE COMPOSANT NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il ne parse aucune URL : `lib/video/source.ts` est le seul parseur, et il
 * rend `null` pour tout ce qu'il ne reconnaît pas. Ici, `null` s'affiche —
 * il ne se rattrape jamais par une ouverture externe.
 *
 * Il ne met rien en cache, ne stocke aucune URL signée, et ne touche ni à
 * IndexedDB ni au Cache Storage : les vidéos restent EN LIGNE UNIQUEMENT.
 *
 * ════════════════════════════════════════════════════════════════════════
 * HORS LIGNE : ON NE MONTE RIEN
 * ════════════════════════════════════════════════════════════════════════
 * Ni `<iframe>`, ni `<video>`. Monter le lecteur puis afficher son échec
 * reviendrait à laisser partir une requête qui ne peut pas aboutir, et à
 * faire clignoter un lecteur noir. Le message tombe avant.
 */

interface VideoPlayerModalProps {
  ouvert: boolean;
  onFermer: () => void;
  /** Titre affiché — nom de l'exercice, du document… */
  titre: string;
  /** URL brute telle qu'elle vient de la base. Peut être invalide. */
  url: string | null | undefined;
  /**
   * Redemande une URL fraîche — pour une URL signée qui a expiré. Le
   * mécanisme de signature existant reste le seul à en produire.
   */
  onRafraichir?: () => Promise<string | null> | string | null;
}

type Etat = "lecture" | "erreur" | "hors_ligne" | "refusee";

function enLigne(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function VideoPlayerModal({ ouvert, onFermer, titre, url, onRafraichir }: VideoPlayerModalProps) {
  const [urlCourante, setUrlCourante] = useState<string | null | undefined>(url);
  const [etat, setEtat] = useState<Etat>("lecture");
  const [rafraichissement, setRafraichissement] = useState(false);

  useEffect(() => {
    let annule = false;
    function reinitialiser() {
      if (annule) return;
      setUrlCourante(url);
      setEtat(enLigne() ? "lecture" : "hors_ligne");
    }
    if (ouvert) reinitialiser();
    return () => {
      annule = true;
    };
  }, [ouvert, url]);

  const source: VideoSource | null = etat === "hors_ligne" ? null : resoudreSource(urlCourante);
  const refusee = etat !== "hors_ligne" && source === null;

  const reessayer = useCallback(async () => {
    if (!enLigne()) {
      setEtat("hors_ligne");
      return;
    }
    setRafraichissement(true);
    try {
      const fraiche = onRafraichir ? await onRafraichir() : urlCourante;
      setUrlCourante(fraiche ?? null);
      setEtat("lecture");
    } catch {
      setEtat("erreur");
    } finally {
      setRafraichissement(false);
    }
  }, [onRafraichir, urlCourante]);

  const cadre = "flex flex-col items-center gap-4 px-6 py-14 text-center";

  return (
    <MediaModal ouvert={ouvert} titre={titre} onFermer={onFermer}>
      {etat === "hors_ligne" ? (
        <div className={cadre} data-etat="hors-ligne">
          <p className="text-sm text-muted-foreground">
            Une connexion est nécessaire pour lire cette vidéo.
          </p>
          <button type="button" onClick={() => void reessayer()} className={BOUTON}>
            Réessayer
          </button>
        </div>
      ) : refusee ? (
        <div className={cadre} data-etat="refusee">
          <p className="text-sm text-muted-foreground">Cette vidéo n&apos;est pas disponible.</p>
        </div>
      ) : etat === "erreur" ? (
        <div className={cadre} data-etat="erreur">
          <p className="text-sm text-muted-foreground">
            La lecture a échoué. Le lien a peut-être expiré.
          </p>
          <button
            type="button"
            onClick={() => void reessayer()}
            disabled={rafraichissement}
            className={BOUTON}
          >
            {rafraichissement ? "Nouvelle tentative…" : "Réessayer"}
          </button>
        </div>
      ) : source?.type === "youtube" ? (
        <YouTubeEmbed videoId={source.videoId} titre={titre} />
      ) : source ? (
        <NativeVideoPlayer url={source.url} onErreur={() => setEtat("erreur")} />
      ) : null}
    </MediaModal>
  );
}

const BOUTON =
  "pressable rounded-control border border-border px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
