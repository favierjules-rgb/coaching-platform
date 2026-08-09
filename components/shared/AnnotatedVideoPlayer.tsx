"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useVideoAnnotationOverlay } from "@/hooks/useVideoAnnotationOverlay";
import { annotationsVisibles, type Annotation } from "@/lib/video-annotations";

/**
 * LECTEUR VIDÉO AVEC CALQUE D'ANNOTATIONS (F5).
 *
 * Un `<video>` ordinaire — contrôles natifs compris — surmonté d'un canevas
 * qui rejoue les tracés du coach au bon instant. Le même composant sert des
 * deux côtés : l'élève dans son historique, le coach en relecture. Ce que le
 * coach valide est donc, au pixel près, ce que l'élève verra.
 *
 * ── LES CONTRÔLES RESTENT CEUX DU NAVIGATEUR ────────────────────────────────
 * Pas de barre de lecture maison. Celle du navigateur connaît le plein écran,
 * la vitesse, l'image dans l'image, le clavier, les lecteurs d'écran et les
 * gestes du système. En réécrire une pour l'assortir au thème coûterait tout
 * cela, pour un gain esthétique.
 *
 * ── LE CANEVAS NE CAPTE AUCUN CLIC ──────────────────────────────────────────
 * `pointer-events-none` : sans quoi il recouvrirait la barre de lecture et
 * l'élève ne pourrait plus mettre en pause. Il est purement décoratif au sens
 * technique — et c'est justement pourquoi le CONTENU des annotations texte
 * est aussi rendu en clair pour les lecteurs d'écran, plus bas.
 *
 * ── AUCUNE ANIMATION AJOUTÉE ────────────────────────────────────────────────
 * Le seul mouvement est celui de la vidéo elle-même. Rien à réduire pour
 * `prefers-reduced-motion` : un tracé qui apparaît à son instant n'est pas
 * une transition décorative, c'est le contenu.
 */

function instant(secondes: number): string {
  const total = Math.max(0, Math.floor(secondes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function AnnotatedVideoPlayer({
  src,
  annotations,
  maxHeight = 320,
  className = "",
}: {
  src: string;
  annotations: readonly Annotation[];
  maxHeight?: number;
  className?: string;
}) {
  const { videoRef, canvasRef, mesurer, redessiner } = useVideoAnnotationOverlay();
  const [enLecture, setEnLecture] = useState(false);

  /**
   * Le calque, relu au moment du dessin plutôt que capturé.
   *
   * Sans cette ref, `redessinerMaintenant` changerait d'identité à chaque
   * calque et remonterait un ResizeObserver à chaque fois. Avec elle, tout ce
   * qui redessine reste stable, et personne ne dessine un calque périmé.
   */
  const calqueRef = useRef<readonly Annotation[]>(annotations);
  useEffect(() => {
    calqueRef.current = annotations;
  }, [annotations]);

  const redessinerMaintenant = useCallback(() => {
    const video = videoRef.current;
    redessiner(video ? annotationsVisibles(calqueRef.current, video.currentTime) : []);
  }, [redessiner, videoRef]);

  // Le cadre change de taille au redimensionnement de la fenêtre, à
  // l'ouverture d'une modale, au passage en plein écran. Un ResizeObserver
  // couvre les trois ; il émet aussi une première mesure à l'observation, ce
  // qui initialise la boîte sans appeler `mesurer` depuis le corps de
  // l'effet. On redessine dès que `mesurer` dit avoir touché le canevas.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof ResizeObserver === "undefined") return;
    const observateur = new ResizeObserver(() => {
      if (mesurer()) redessinerMaintenant();
    });
    observateur.observe(video);
    return () => observateur.disconnect();
  }, [mesurer, redessinerMaintenant, videoRef]);

  // Pendant la lecture : une image de calque par image d'écran. Hors lecture,
  // cette boucle ne tourne pas — un `requestAnimationFrame` permanent sur une
  // vidéo en pause ne dessinerait rien de nouveau, tout en réveillant le
  // processeur soixante fois par seconde.
  useEffect(() => {
    if (!enLecture) return;
    let image = 0;
    const boucle = () => {
      redessinerMaintenant();
      image = requestAnimationFrame(boucle);
    };
    image = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(image);
  }, [enLecture, redessinerMaintenant]);

  // Vidéo à l'arrêt : un seul dessin, refait quand le calque change.
  useEffect(() => {
    if (enLecture) return;
    redessinerMaintenant();
  }, [enLecture, annotations, redessinerMaintenant]);

  const textes = annotations.filter((tr): tr is Extract<Annotation, { type: "texte" }> => tr.type === "texte");
  const dessins = annotations.length - textes.length;

  return (
    <div className={`relative w-full ${className}`}>
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-control bg-black"
        style={{ maxHeight }}
        onLoadedMetadata={() => {
          mesurer();
          redessinerMaintenant();
        }}
        onPlay={() => setEnLecture(true)}
        onPause={() => setEnLecture(false)}
        onEnded={() => setEnLecture(false)}
        onSeeked={redessinerMaintenant}
        onTimeUpdate={() => {
          if (!enLecture) redessinerMaintenant();
        }}
      />
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0" />

      {/* Ce qu'un canevas ne dit à personne. Les tracés géométriques ne se
          décrivent pas honnêtement en mots — on annonce leur nombre — mais le
          TEXTE écrit par le coach, lui, est du contenu, et il doit être
          lisible autrement qu'en regardant. */}
      {annotations.length > 0 && (
        <div className="sr-only">
          <p>
            Cette vidéo porte {annotations.length} annotation{annotations.length > 1 ? "s" : ""} du coach
            {dessins > 0 ? `, dont ${dessins} tracé${dessins > 1 ? "s" : ""} dessiné${dessins > 1 ? "s" : ""} sur l'image` : ""}.
          </p>
          {textes.length > 0 && (
            <ul>
              {textes.map((tr) => (
                <li key={tr.id}>
                  À {instant(tr.debut)} : {tr.contenu}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
