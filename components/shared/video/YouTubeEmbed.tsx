"use client";

import { urlIntegrationYouTube } from "@/lib/video/source";

/**
 * L'INTÉGRATION YOUTUBE — SANS AUTOPLAY, SANS COOKIE AVANT LECTURE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'ON NE PEUT PAS FAIRE, ET QU'IL FAUT DIRE
 * ════════════════════════════════════════════════════════════════════════
 * L'intérieur de cette `<iframe>` appartient à YouTube : son habillage, son
 * titre, son bouton « Regarder sur YouTube ». On ne peut ni le styliser ni
 * le masquer — les conditions d'utilisation l'interdisent, et la politique
 * d'origine du navigateur l'empêche techniquement.
 *
 * Conséquence directe : quand une chaîne INTERDIT l'intégration, YouTube
 * affiche son propre message d'erreur DANS l'iframe. Aucun événement n'en
 * sort (`onError` d'une iframe ne se déclenche pas pour un contenu chargé
 * avec succès qui affiche une erreur), et l'interroger serait une lecture
 * cross-origin. Cette limite est ASSUMÉE : on ne la contourne pas, on ne
 * prétend pas la détecter, et le bouton « Ouvrir sur YouTube » reste une
 * issue secondaire pour ce seul cas.
 */
export function YouTubeEmbed({ videoId, titre }: { videoId: string; titre: string }) {
  return (
    <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
      <iframe
        src={urlIntegrationYouTube(videoId)}
        title={titre}
        // `allowFullScreen` + `fullscreen` dans `allow` : les deux formes
        // coexistent, les navigateurs ne lisent pas tous la même.
        allowFullScreen
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        // `autoplay` est ABSENT de `allow` et des paramètres : c'est le clic
        // de l'élève qui ouvre le lecteur, la lecture reste son geste.
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}
