"use client";

import { useCallback, useRef, useState } from "react";

import {
  boiteContenuVideo,
  versNormalise,
  type Annotation,
  type BoiteContenu,
  type PointNormalise,
} from "@/lib/video-annotations";
import { dessinerCalque } from "@/lib/video-annotations-draw";

/**
 * LE CALQUE POSÉ SUR UNE VIDÉO — la plomberie, partagée par les deux côtés.
 *
 * Le coach dessine (éditeur), l'élève regarde (lecteur). Les deux ont besoin
 * exactement des mêmes trois choses, et aucune n'est évidente :
 *
 *   1. UN CANEVAS À LA BONNE ÉCHELLE. Sur un écran à 2 ou 3 pixels physiques
 *      par pixel CSS, un canevas dimensionné en pixels CSS rend un tracé
 *      flou. On dimensionne donc la mémoire du canevas en pixels PHYSIQUES et
 *      on remet l'échelle dans le contexte — le dessin reste net.
 *
 *   2. LA BOÎTE DE L'IMAGE, PAS CELLE DE L'ÉLÉMENT. Une vidéo est centrée
 *      dans son cadre avec des bandes noires ; voir `boiteContenuVideo`.
 *
 *   3. LA MÊME CONVERSION DANS LES DEUX SENS. Le point que le coach touche
 *      doit revenir exactement au même endroit chez l'élève.
 *
 * Ce hook ne décide JAMAIS quand redessiner : c'est l'appelant qui sait s'il
 * suit une lecture en cours ou un geste de dessin.
 */
export function useVideoAnnotationOverlay() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [boite, setBoite] = useState<BoiteContenu>({ x: 0, y: 0, largeur: 0, hauteur: 0 });
  /** Doublon en ref : les gestionnaires de geste lisent la boîte SANS attendre un rendu. */
  const boiteRef = useRef<BoiteContenu>({ x: 0, y: 0, largeur: 0, hauteur: 0 });

  /**
   * Remesure le cadre et remet le canevas à l'échelle.
   *
   * À appeler depuis un ResizeObserver et depuis `loadedmetadata` : avant les
   * métadonnées, `videoWidth` vaut 0 et la boîte n'est qu'un repli.
   *
   * REND `true` quand le canevas a été touché — et l'appelant DOIT alors
   * redessiner. Écrire dans `canvas.width` efface le canevas : sans ce
   * signal, redimensionner la fenêtre ferait disparaître le calque jusqu'à
   * la prochaine image lue, ce qui ressemblerait exactement à un bug de
   * données plutôt qu'à un canevas vidé.
   */
  const mesurer = useCallback((): boolean => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return false;

    const largeur = video.clientWidth;
    const hauteur = video.clientHeight;
    const densite = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const memoireL = Math.max(1, Math.round(largeur * densite));
    const memoireH = Math.max(1, Math.round(hauteur * densite));
    // On ne réaffecte width/height que si la valeur change : y écrire efface
    // le canevas, ce qui ferait clignoter le calque à chaque mesure.
    let touche = false;
    if (canvas.width !== memoireL) {
      canvas.width = memoireL;
      touche = true;
    }
    if (canvas.height !== memoireH) {
      canvas.height = memoireH;
      touche = true;
    }
    canvas.style.width = `${largeur}px`;
    canvas.style.height = `${hauteur}px`;

    const suivante = boiteContenuVideo(largeur, hauteur, video.videoWidth, video.videoHeight);
    const precedente = boiteRef.current;
    const memeBoite =
      precedente.x === suivante.x &&
      precedente.y === suivante.y &&
      precedente.largeur === suivante.largeur &&
      precedente.hauteur === suivante.hauteur;
    if (!memeBoite) {
      // La ref est posée AVANT l'état : un gestionnaire de geste qui suit
      // immédiatement doit lire la nouvelle boîte sans attendre un rendu.
      boiteRef.current = suivante;
      setBoite(suivante);
    }
    return touche || !memeBoite;
  }, []);

  /** Efface et repose les tracés donnés. L'appelant a déjà choisi lesquels. */
  const redessiner = useCallback((calque: readonly Annotation[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const densite = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    ctx.setTransform(densite, 0, 0, densite, 0, 0);
    ctx.clearRect(0, 0, canvas.width / densite, canvas.height / densite);
    dessinerCalque(ctx, boiteRef.current, calque);
  }, []);

  /**
   * Point d'écran → point normalisé. On passe par le rectangle RÉEL du
   * canevas : la page peut avoir défilé, être zoomée, ou le cadre être dans
   * une modale décalée.
   */
  const pointDepuisEcran = useCallback((clientX: number, clientY: number): PointNormalise | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const cadre = canvas.getBoundingClientRect();
    return versNormalise(clientX - cadre.left, clientY - cadre.top, boiteRef.current);
  }, []);

  return { videoRef, canvasRef, boite, mesurer, redessiner, pointDepuisEcran };
}
