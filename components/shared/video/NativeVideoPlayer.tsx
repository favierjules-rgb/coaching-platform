"use client";

/**
 * LES VIDÉOS DE SETH — LECTEUR NATIF, CONTRÔLES NATIFS.
 *
 * `playsInline` est ce qui fait tenir le chantier sur iPhone : sans lui,
 * Safari sort la vidéo de la page pour la jouer en plein écran système, et
 * l'élève quitte visuellement SETH — précisément ce qu'on supprime.
 *
 * `preload="metadata"` : la durée et la première image, pas le fichier. Une
 * vidéo d'élève ne se télécharge pas parce qu'une modale s'est ouverte.
 */
export function NativeVideoPlayer({
  url,
  onErreur,
}: {
  url: string;
  onErreur: () => void;
}) {
  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      onError={onErreur}
      className="max-h-[75vh] w-full bg-black"
    />
  );
}
