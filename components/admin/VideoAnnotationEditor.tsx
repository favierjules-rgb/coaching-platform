"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Circle, Pause, Pencil, Play, Trash2, Type } from "lucide-react";

import {
  ANNOTATIONS_MAX,
  ANNOTATION_DUREE_DEFAUT,
  ANNOTATION_POINTS_MAX,
  ANNOTATION_TEXTE_MAX,
  ANNOTATIONS_OCTETS_MAX,
  COULEURS_ANNOTATION,
  annotationsVisibles,
  calquePlein,
  type Annotation,
  type CouleurAnnotation,
  type OutilAnnotation,
  type PointNormalise,
} from "@/lib/video-annotations";
import { useVideoAnnotationOverlay } from "@/hooks/useVideoAnnotationOverlay";

/**
 * L'ÉDITEUR D'ANNOTATIONS DU COACH (F5).
 *
 * Le coach met la vidéo sur l'image qui l'intéresse, choisit un outil, et
 * dessine directement dessus. Le tracé apparaît à cet instant-là et reste
 * quelques secondes.
 *
 * ── DESSINER MET LA VIDÉO EN PAUSE, TOUJOURS ────────────────────────────────
 * Dès que le coach pose le doigt, la lecture s'arrête. Autrement l'image
 * glisserait sous le geste : il viserait un genou et entourerait une hanche.
 * Ce n'est pas une commodité, c'est ce qui rend le tracé juste.
 *
 * ── LES CONTRÔLES SONT REFAITS ICI, ET C'EST L'EXCEPTION ────────────────────
 * Le lecteur de l'élève garde les contrôles natifs du navigateur (plein
 * écran, clavier, lecteurs d'écran). Ici, non : la surface de dessin doit
 * recouvrir toute l'image, et elle recouvrirait la barre native. On la
 * remplace donc par une barre minimale — lecture/pause et une réglette — et
 * on n'y met rien de plus que ce qu'on a retiré.
 *
 * ── LE GESTE EST SUIVI EN CONTINU, PAS AU RELÂCHEMENT ───────────────────────
 * La flèche s'allonge sous le doigt, le cercle grandit, le trait se déroule.
 * `setPointerCapture` maintient le suivi même quand le doigt sort du cadre —
 * sans quoi un geste qui déborde s'interromprait en plein milieu.
 */

type Geste =
  | { outil: "fleche" | "cercle"; de: PointNormalise; a: PointNormalise }
  | { outil: "trait"; points: PointNormalise[] };

const OUTILS: { outil: OutilAnnotation; libelle: string; Icone: typeof Circle }[] = [
  { outil: "fleche", libelle: "Flèche", Icone: ArrowUpRight },
  { outil: "cercle", libelle: "Cercle", Icone: Circle },
  { outil: "trait", libelle: "Trait libre", Icone: Pencil },
  { outil: "texte", libelle: "Texte", Icone: Type },
];

const DUREES = [2, ANNOTATION_DUREE_DEFAUT, 5] as const;

const LIBELLES: Record<OutilAnnotation, string> = {
  fleche: "Flèche",
  cercle: "Cercle",
  trait: "Trait",
  texte: "Texte",
};

function instant(secondes: number): string {
  const total = Math.max(0, Math.floor(secondes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function VideoAnnotationEditor({
  src,
  annotations,
  onChange,
  maxHeight = 320,
}: {
  src: string;
  annotations: readonly Annotation[];
  onChange: (calque: Annotation[]) => void;
  maxHeight?: number;
}) {
  const { videoRef, canvasRef, boite, mesurer, redessiner, pointDepuisEcran } = useVideoAnnotationOverlay();

  const [outil, setOutil] = useState<OutilAnnotation>("fleche");
  const [couleur, setCouleur] = useState<CouleurAnnotation>(COULEURS_ANNOTATION[0]);
  const [dureeTrace, setDureeTrace] = useState<number>(ANNOTATION_DUREE_DEFAUT);
  const [temps, setTemps] = useState(0);
  const [dureeVideo, setDureeVideo] = useState(0);
  const [enLecture, setEnLecture] = useState(false);
  const [geste, setGeste] = useState<Geste | null>(null);
  const [saisieTexte, setSaisieTexte] = useState<{ position: PointNormalise; contenu: string } | null>(null);

  // DEUX bornes, pas une : le nombre de tracés ET le poids du calque. Un
  // coach qui griffonne beaucoup atteint la seconde bien avant la première,
  // et il doit s'en apercevoir EN DESSINANT — pas au moment d'enregistrer.
  const plein = calquePlein(annotations);

  /* ── Ce qui est dessiné : le calque visible, plus le geste en cours ────── */

  /**
   * Rayon NORMALISÉ SUR LA LARGEUR, à partir de deux points normalisés.
   *
   * On repasse par les pixels : l'écart vertical entre deux points normalisés
   * ne vaut pas l'écart horizontal dès que le cadre n'est pas carré. Prendre
   * la distance directement en coordonnées normalisées donnerait un cercle
   * qui grandit plus vite vers le bas que vers la droite — et le coach
   * verrait le cercle qu'il vient de tracer changer de taille au premier
   * changement d'écran.
   */
  const rayonDepuis = useCallback(
    (centre: PointNormalise, bord: PointNormalise): number => {
      const dx = (bord.x - centre.x) * boite.largeur;
      const dy = (bord.y - centre.y) * boite.hauteur;
      const rayonPixels = Math.hypot(dx, dy);
      return boite.largeur > 0 ? Math.max(0.005, rayonPixels / boite.largeur) : 0.005;
    },
    [boite.largeur, boite.hauteur],
  );

  const apercuDuGeste = useCallback((): Annotation | null => {
    if (!geste) return null;
    const commun = { id: "apercu", debut: temps, duree: dureeTrace, couleur };
    if (geste.outil === "trait") {
      return geste.points.length >= 2 ? { ...commun, type: "trait", points: geste.points } : null;
    }
    if (geste.outil === "fleche") return { ...commun, type: "fleche", de: geste.de, a: geste.a };
    return { ...commun, type: "cercle", centre: geste.de, rayon: rayonDepuis(geste.de, geste.a) };
  }, [geste, temps, dureeTrace, couleur, rayonDepuis]);

  const composer = useCallback(() => {
    const video = videoRef.current;
    const t = video ? video.currentTime : 0;
    const visibles = annotationsVisibles(annotations, t);
    const apercu = apercuDuGeste();
    redessiner(apercu ? [...visibles, apercu] : visibles);
  }, [annotations, apercuDuGeste, redessiner, videoRef]);

  // Le dernier `composer` en date, pour les rappels qui ne doivent pas se
  // rebrancher à chaque tracé (ResizeObserver, boucle de lecture).
  const composerRef = useRef(composer);
  useEffect(() => {
    composerRef.current = composer;
  }, [composer]);

  useEffect(() => {
    composer();
  }, [composer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof ResizeObserver === "undefined") return;
    const observateur = new ResizeObserver(() => {
      if (mesurer()) composerRef.current();
    });
    observateur.observe(video);
    return () => observateur.disconnect();
  }, [mesurer, videoRef]);

  useEffect(() => {
    if (!enLecture) return;
    let image = 0;
    const boucle = () => {
      composerRef.current();
      image = requestAnimationFrame(boucle);
    };
    image = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(image);
  }, [enLecture]);

  /* ── Transport ────────────────────────────────────────────────────────── */

  function basculerLecture() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function allerA(secondes: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = secondes;
    setTemps(secondes);
  }

  /* ── Le geste ─────────────────────────────────────────────────────────── */

  function commencer(evenement: React.PointerEvent<HTMLCanvasElement>) {
    if (plein) return;
    const point = pointDepuisEcran(evenement.clientX, evenement.clientY);
    if (!point) return;

    // On met en pause AVANT toute autre chose : dessiner sur une image qui
    // défile produit un tracé qui ne désigne rien.
    const video = videoRef.current;
    if (video && !video.paused) video.pause();

    if (outil === "texte") {
      setSaisieTexte({ position: point, contenu: "" });
      return;
    }
    evenement.currentTarget.setPointerCapture(evenement.pointerId);
    setGeste(outil === "trait" ? { outil: "trait", points: [point] } : { outil, de: point, a: point });
  }

  function suivre(evenement: React.PointerEvent<HTMLCanvasElement>) {
    if (!geste) return;
    const point = pointDepuisEcran(evenement.clientX, evenement.clientY);
    if (!point) return;
    setGeste((courant) => {
      if (!courant) return courant;
      if (courant.outil !== "trait") return { ...courant, a: point };
      const dernier = courant.points[courant.points.length - 1];
      // On n'enregistre pas un point à un cheveu du précédent : le budget de
      // 240 points doit servir la forme du trait, pas la fréquence du capteur.
      if (dernier && Math.hypot(point.x - dernier.x, point.y - dernier.y) < 0.004) return courant;
      if (courant.points.length >= ANNOTATION_POINTS_MAX) return courant;
      return { ...courant, points: [...courant.points, point] };
    });
  }

  function terminer() {
    if (!geste) return;
    const acheve = apercuDuGeste();
    setGeste(null);
    if (!acheve) return;
    // Un simple clic n'est pas une flèche ni un cercle : sans ce seuil, un
    // tapotement laisserait un tracé invisible et indélébile dans la liste.
    if (acheve.type === "fleche" && Math.hypot(acheve.a.x - acheve.de.x, acheve.a.y - acheve.de.y) < 0.02) return;
    if (acheve.type === "cercle" && acheve.rayon < 0.015) return;
    ajouter({ ...acheve, id: crypto.randomUUID() });
  }

  function ajouter(tr: Annotation) {
    if (plein) return;
    onChange([...annotations, tr]);
  }

  function validerTexte() {
    if (!saisieTexte) return;
    const contenu = saisieTexte.contenu.trim().slice(0, ANNOTATION_TEXTE_MAX);
    setSaisieTexte(null);
    if (!contenu) return;
    ajouter({
      id: crypto.randomUUID(),
      type: "texte",
      debut: temps,
      duree: dureeTrace,
      couleur,
      position: saisieTexte.position,
      contenu,
    });
  }

  function retirer(id: string) {
    onChange(annotations.filter((tr) => tr.id !== id));
  }

  const triees = [...annotations].sort((a, b) => a.debut - b.debut);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full">
        <video
          ref={videoRef}
          src={src}
          playsInline
          preload="metadata"
          className="w-full rounded-control bg-black"
          style={{ maxHeight }}
          onLoadedMetadata={() => {
            const video = videoRef.current;
            setDureeVideo(video && Number.isFinite(video.duration) ? video.duration : 0);
            mesurer();
            composerRef.current();
          }}
          onPlay={() => setEnLecture(true)}
          onPause={() => setEnLecture(false)}
          onEnded={() => setEnLecture(false)}
          onTimeUpdate={() => {
            const video = videoRef.current;
            if (video) setTemps(video.currentTime);
          }}
        />
        {/* `touch-none` : sans lui, dessiner au doigt sur une tablette ferait
            défiler la page au lieu de tracer. */}
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 touch-none"
          style={{ cursor: plein ? "not-allowed" : "crosshair" }}
          onPointerDown={commencer}
          onPointerMove={suivre}
          onPointerUp={terminer}
          onPointerCancel={() => setGeste(null)}
        />
      </div>

      {/* ── Transport ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={basculerLecture}
          aria-label={enLecture ? "Mettre en pause" : "Lire"}
          className="pressable flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {enLecture ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>
        <input
          type="range"
          min={0}
          max={dureeVideo || 0}
          step={0.05}
          value={Math.min(temps, dureeVideo || 0)}
          aria-label="Position dans la vidéo"
          onChange={(evenement) => allerA(Number(evenement.target.value))}
          className="h-11 min-w-0 flex-1 accent-primary"
        />
        <span className="w-20 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {instant(temps)} / {instant(dureeVideo)}
        </span>
      </div>

      {/* ── Outils ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {OUTILS.map(({ outil: valeur, libelle, Icone }) => (
          <button
            key={valeur}
            type="button"
            aria-pressed={outil === valeur}
            onClick={() => setOutil(valeur)}
            className={`pressable flex min-h-11 items-center gap-1.5 rounded-control border px-3 text-[11px] uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              outil === valeur
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            <Icone size={13} aria-hidden="true" />
            {libelle}
          </button>
        ))}

        <span className="ml-auto flex items-center gap-1.5">
          {COULEURS_ANNOTATION.map((valeur) => (
            <button
              key={valeur}
              type="button"
              aria-label={`Couleur ${valeur}`}
              aria-pressed={couleur === valeur}
              onClick={() => setCouleur(valeur)}
              style={{ backgroundColor: valeur }}
              className={`pressable h-8 w-8 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                couleur === valeur ? "border-primary" : "border-border"
              }`}
            />
          ))}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Durée d&apos;affichage</span>
        {DUREES.map((valeur) => (
          <button
            key={valeur}
            type="button"
            aria-pressed={dureeTrace === valeur}
            onClick={() => setDureeTrace(valeur)}
            className={`pressable min-h-11 rounded-control border px-3 text-[11px] uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              dureeTrace === valeur
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {valeur} s
          </button>
        ))}
      </div>

      <p className="text-xs leading-snug text-muted-foreground/70">
        Place-toi sur l&apos;image qui t&apos;intéresse, puis dessine dessus : le tracé apparaît à cet instant et reste{" "}
        {dureeTrace} secondes. La vidéo se met en pause dès que tu commences.
      </p>

      {/* ── Saisie d'un texte ─────────────────────────────────────────── */}
      {saisieTexte && (
        <div className="flex flex-wrap items-center gap-2 rounded-panel border border-primary/40 bg-primary/5 p-3">
          <input
            autoFocus
            type="text"
            maxLength={ANNOTATION_TEXTE_MAX}
            value={saisieTexte.contenu}
            placeholder="Ce que tu veux écrire à cet endroit"
            onChange={(evenement) =>
              setSaisieTexte((courant) => (courant ? { ...courant, contenu: evenement.target.value } : courant))
            }
            onKeyDown={(evenement) => {
              if (evenement.key === "Enter") {
                evenement.preventDefault();
                validerTexte();
              }
              if (evenement.key === "Escape") setSaisieTexte(null);
            }}
            className="min-h-11 min-w-0 flex-1 rounded-control border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <button
            type="button"
            onClick={validerTexte}
            className="pressable min-h-11 rounded-control border border-primary px-3 text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Placer
          </button>
          <button
            type="button"
            onClick={() => setSaisieTexte(null)}
            className="pressable min-h-11 rounded-control px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Annuler
          </button>
        </div>
      )}

      {/* ── Ce qui a été posé ─────────────────────────────────────────── */}
      {triees.length > 0 && (
        <ul className="flex flex-col gap-1">
          {triees.map((tr) => (
            <li key={tr.id} className="flex items-center gap-2 rounded-control border border-border px-3 py-1.5 text-xs">
              <button
                type="button"
                onClick={() => allerA(tr.debut)}
                className="min-h-11 min-w-0 flex-1 text-left text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className="tabular-nums text-foreground">{instant(tr.debut)}</span> — {LIBELLES[tr.type]}
                {tr.type === "texte" && ` « ${tr.contenu} »`}
              </button>
              <span
                aria-hidden="true"
                style={{ backgroundColor: tr.couleur }}
                className="h-3 w-3 flex-shrink-0 rounded-full border border-border"
              />
              <button
                type="button"
                onClick={() => retirer(tr.id)}
                aria-label={`Supprimer l'annotation de ${instant(tr.debut)}`}
                className="pressable flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {plein && (
        <p className="text-xs leading-snug text-warning">
          {annotations.length >= ANNOTATIONS_MAX
            ? `${ANNOTATIONS_MAX} annotations, c'est le maximum.`
            : `Le calque a atteint sa taille maximale (${Math.round(ANNOTATIONS_OCTETS_MAX / 1000)} Ko).`}{" "}
          Supprimes-en une pour en ajouter une autre.
        </p>
      )}
    </div>
  );
}
