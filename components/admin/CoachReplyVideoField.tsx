"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, Scissors, Trash2, Upload, Video } from "lucide-react";

import { VideoAnnotationEditor } from "@/components/admin/VideoAnnotationEditor";
import {
  COACH_REPLY_VIDEO_LABEL,
  COACH_REPLY_VIDEO_MAX_SECONDS,
  COACH_REPLY_VIDEO_MIME_TYPES,
  validateCoachReplyVideoDuration,
  validateCoachReplyVideoFile,
  type CoachReplyVideoMime,
} from "@/lib/coach-reply-video";
import {
  captureCoachDisponible,
  decoupeDisponible,
  decouperVideo,
  demarrerCaptureCoach,
  lireDureeVideo,
  type SessionCaptureCoach,
} from "@/lib/coach-reply-video-capture";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getSignedCoachReplyVideoUrl,
  uploadCoachReplyVideo,
} from "@/lib/supabase/storage-coach-reply-videos";
import type { Annotation } from "@/lib/video-annotations";

/**
 * LA RÉPONSE VIDÉO DU COACH — dépôt, découpe, annotations (F5).
 *
 * ── POURQUOI CE CHAMP N'ENVOIE PAS TOUT DE SUITE, CONTRAIREMENT À F4 ─────────
 * Côté élève, le fichier part dès qu'il est choisi : l'aperçu est immédiat et
 * il n'y a rien à faire du fichier entre-temps. Ici il y a la DÉCOUPE. Envoyer
 * d'abord, découper ensuite, ce serait téléverser deux fois jusqu'à 200 Mo
 * pour n'en garder qu'un. Le coach travaille donc en local, puis JOINT — un
 * seul envoi, celui de la vidéo qu'il a décidé d'envoyer.
 *
 * ── UNE VIDÉO TROP LONGUE N'EST PAS REFUSÉE À L'IMPORT ──────────────────────
 * Elle est refusée à l'ENVOI. La différence n'est pas cosmétique : un coach
 * qui filme trois minutes sur son téléphone et veut n'en garder que quatre-
 * vingt-dix secondes se serait vu refuser le fichier exactement dans le cas
 * où la découpe sert à quelque chose. Le plafond de TAILLE, lui, s'applique
 * dès l'import — il est opposable sans rien décoder.
 *
 * ── LA DÉCOUPE COÛTE DU TEMPS RÉEL, ET ON LE DIT AVANT ──────────────────────
 * Aucun ré-encodage rapide n'existe dans un navigateur : découper, c'est
 * rejouer l'extrait et le réenregistrer. Quarante secondes gardées prennent
 * quarante secondes. On l'annonce avant de lancer, on montre la progression
 * pendant, et on demande de ne pas changer d'onglet — en arrière-plan, le
 * navigateur ralentit tout et la vidéo produite serait hachée.
 *
 * ── QUAND LE NAVIGATEUR NE SAIT PAS FAIRE ───────────────────────────────────
 * On le DIT et on propose la vidéo entière. Jamais un bouton qui tourne dans
 * le vide.
 */

export type DeposeurReponseVideo = (parametres: {
  studentId: string;
  fichier: Blob;
  mime: CoachReplyVideoMime;
}) => Promise<{ path: string } | { error: string }>;

export type ResolveurUrlReponseVideo = (chemin: string) => Promise<string | null>;

const deposeurParDefaut: DeposeurReponseVideo = async ({ studentId, fichier, mime }) => {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return { error: "Session expirée. Recharge la page." };
  return uploadCoachReplyVideo(supabase, { studentId, fichier, mime, identifiant: crypto.randomUUID() });
};

const resolveurParDefaut: ResolveurUrlReponseVideo = async (chemin) => {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  return getSignedCoachReplyVideoUrl(supabase, chemin);
};

interface Atelier {
  fichier: Blob;
  mime: CoachReplyVideoMime;
  url: string;
  /** `null` quand le conteneur ne porte pas de durée lisible (certains WebM). */
  duree: number | null;
}

type Etat =
  | { phase: "repos" }
  | { phase: "capture"; session: SessionCaptureCoach; restant: number }
  | { phase: "analyse" }
  | { phase: "atelier"; atelier: Atelier }
  | { phase: "decoupe"; atelier: Atelier; progression: number }
  | { phase: "envoi" };

export function CoachReplyVideoField({
  studentId,
  videoPath,
  annotations,
  onChange,
  deposer = deposeurParDefaut,
  resoudreUrl = resolveurParDefaut,
  urlExistante = null,
}: {
  /** L'élève DESTINATAIRE — c'est son dossier qui recevra le fichier. */
  studentId: string;
  videoPath: string | null;
  annotations: readonly Annotation[];
  onChange: (etat: { videoPath: string | null; annotations: Annotation[] }) => void;
  deposer?: DeposeurReponseVideo;
  resoudreUrl?: ResolveurUrlReponseVideo;
  /** URL déjà signée par la lecture de liste — évite une seconde signature. */
  urlExistante?: string | null;
}) {
  const [etat, setEtat] = useState<Etat>({ phase: "repos" });
  const [erreur, setErreur] = useState<string | null>(null);
  const [debut, setDebut] = useState(0);
  const [fin, setFin] = useState(0);
  /** Aperçu local de la vidéo JOINTE — évite de re-signer ce qu'on vient d'envoyer. */
  const [apercuLocal, setApercuLocal] = useState<string | null>(null);
  const [apercuDistant, setApercuDistant] = useState<{ chemin: string; url: string } | null>(null);
  const champFichier = useRef<HTMLInputElement | null>(null);
  const videoDirect = useRef<HTMLVideoElement | null>(null);
  const interruption = useRef<AbortController | null>(null);
  const capturePourNettoyage = useRef<SessionCaptureCoach | null>(null);

  const capture = captureCoachDisponible();
  const decoupe = decoupeDisponible();

  // URL signée d'une réponse déjà déposée (retour rouvert). On ne la demande
  // que si l'appelant n'en a pas déjà une et qu'aucun aperçu local ne sert.
  useEffect(() => {
    if (!videoPath || apercuLocal || urlExistante) return;
    let annule = false;
    void resoudreUrl(videoPath).then((url) => {
      if (!annule && url) setApercuDistant({ chemin: videoPath, url });
    });
    return () => {
      annule = true;
    };
  }, [videoPath, apercuLocal, urlExistante, resoudreUrl]);

  // Le flux de la caméra est branché après le rendu : l'élément n'existe pas
  // encore au moment où la capture démarre.
  useEffect(() => {
    if (etat.phase !== "capture" || !videoDirect.current) return;
    videoDirect.current.srcObject = etat.session.flux;
  }, [etat]);

  // Une URL d'objet non révoquée retient le fichier entier en mémoire — ici
  // jusqu'à 200 Mo.
  useEffect(() => {
    return () => {
      if (apercuLocal) URL.revokeObjectURL(apercuLocal);
    };
  }, [apercuLocal]);

  // FERMER LA MODALE PENDANT LA DÉCOUPE DOIT L'ARRÊTER. Sans cela, une vidéo
  // détachée continue de jouer dans le vide, un MediaRecorder continue
  // d'accumuler des morceaux que plus personne ne lira, et l'onglet paie tout
  // ça jusqu'à ce qu'il soit fermé. `abandonner()` fait de même pour une
  // capture caméra en cours : le voyant de la webcam doit s'éteindre quand
  // l'écran disparaît.
  useEffect(() => {
    return () => {
      interruption.current?.abort();
      capturePourNettoyage.current?.abandonner();
    };
  }, []);

  // La session de capture en cours, lisible par le nettoyage de démontage
  // sans que celui-ci dépende de l'état (et se rebranche à chaque seconde du
  // décompte).
  useEffect(() => {
    capturePourNettoyage.current = etat.phase === "capture" ? etat.session : null;
  }, [etat]);

  const ouvrirAtelier = useCallback((fichier: Blob, mime: CoachReplyVideoMime, duree: number | null) => {
    const url = URL.createObjectURL(fichier);
    setDebut(0);
    setFin(duree ?? COACH_REPLY_VIDEO_MAX_SECONDS);
    setEtat({ phase: "atelier", atelier: { fichier, mime, url, duree } });
  }, []);

  function fermerAtelier(atelier: Atelier) {
    URL.revokeObjectURL(atelier.url);
    setEtat({ phase: "repos" });
  }

  /* ── Entrées : importer, filmer ───────────────────────────────────────── */

  async function choisirFichier(fichier: File) {
    setErreur(null);
    const nu = fichier.type.split(";")[0]?.trim().toLowerCase() ?? "";
    const mime = (COACH_REPLY_VIDEO_MIME_TYPES as readonly string[]).includes(nu)
      ? (nu as CoachReplyVideoMime)
      : null;
    const refus = validateCoachReplyVideoFile({ type: fichier.type, size: fichier.size });
    if (refus || !mime) {
      setErreur(refus ?? "Format non accepté.");
      return;
    }
    setEtat({ phase: "analyse" });
    const duree = await lireDureeVideo(fichier);
    // Trop longue ? On ouvre quand même l'atelier : c'est exactement le cas où
    // la découpe sert. Le refus, lui, se fait au moment de joindre.
    ouvrirAtelier(fichier, mime, duree);
  }

  async function demarrerCapture() {
    setErreur(null);
    const session = await demarrerCaptureCoach();
    if ("error" in session) {
      setErreur(session.error);
      return;
    }
    setEtat({ phase: "capture", session, restant: COACH_REPLY_VIDEO_MAX_SECONDS });
  }

  // Décompte : la seule animation du composant, et elle porte une information
  // réelle — combien de temps il reste avant l'arrêt automatique.
  useEffect(() => {
    if (etat.phase !== "capture") return;
    const battement = setInterval(() => {
      setEtat((courant) =>
        courant.phase === "capture" ? { ...courant, restant: Math.max(0, courant.restant - 1) } : courant,
      );
    }, 1000);
    return () => clearInterval(battement);
  }, [etat.phase]);

  async function arreterCapture() {
    if (etat.phase !== "capture") return;
    const session = etat.session;
    setEtat({ phase: "analyse" });
    const resultat = await session.arreter();
    if ("error" in resultat) {
      setEtat({ phase: "repos" });
      setErreur(resultat.error);
      return;
    }
    const duree = await lireDureeVideo(resultat.fichier);
    ouvrirAtelier(resultat.fichier, resultat.mime, duree);
  }

  function annulerCapture() {
    if (etat.phase !== "capture") return;
    etat.session.abandonner();
    setEtat({ phase: "repos" });
  }

  /* ── Découper ─────────────────────────────────────────────────────────── */

  async function lancerDecoupe(atelier: Atelier) {
    setErreur(null);
    const controleur = new AbortController();
    interruption.current = controleur;
    setEtat({ phase: "decoupe", atelier, progression: 0 });

    const resultat = await decouperVideo(atelier.fichier, {
      debut,
      fin,
      // Quand l'intervalle couvre tout, il n'y a rien à découper : la source
      // est rendue telle quelle, sans réencodage ni attente.
      mimeSource: atelier.mime,
      dureeSource: atelier.duree,
      signal: controleur.signal,
      onProgression: (part) =>
        setEtat((courant) => (courant.phase === "decoupe" ? { ...courant, progression: part } : courant)),
    });
    interruption.current = null;

    if ("error" in resultat) {
      setEtat({ phase: "atelier", atelier });
      setErreur(resultat.error);
      return;
    }
    // La durée est MESURÉE sur le fichier produit, pas déduite de l'intervalle
    // demandé : c'est ce qui sera opposé au plafond de 120 s à l'envoi, et
    // supposer que le résultat fait exactement `fin - debut` reviendrait à se
    // fier au vœu plutôt qu'au fait. Repli sur l'intervalle demandé quand le
    // conteneur ne porte pas de durée lisible (certains WebM).
    const dureeReelle = (await lireDureeVideo(resultat.fichier)) ?? Math.max(0, fin - debut);
    // L'original n'a plus lieu d'être : on libère avant d'ouvrir le nouvel
    // atelier, sinon deux fichiers de 200 Mo cohabitent en mémoire. Sauf s'il
    // EST le résultat — cas « aucune découpe ».
    if (resultat.fichier !== atelier.fichier) URL.revokeObjectURL(atelier.url);
    ouvrirAtelier(resultat.fichier, resultat.mime, dureeReelle);
  }

  function interrompreDecoupe() {
    interruption.current?.abort();
  }

  /* ── Joindre ──────────────────────────────────────────────────────────── */

  async function joindre(atelier: Atelier) {
    const refusDuree = validateCoachReplyVideoDuration(atelier.duree);
    if (refusDuree) {
      setErreur(refusDuree);
      return;
    }
    const refusFichier = validateCoachReplyVideoFile({ type: atelier.mime, size: atelier.fichier.size });
    if (refusFichier) {
      setErreur(refusFichier);
      return;
    }

    setEtat({ phase: "envoi" });
    const resultat = await deposer({ studentId, fichier: atelier.fichier, mime: atelier.mime });
    if ("error" in resultat) {
      setEtat({ phase: "atelier", atelier });
      setErreur(resultat.error);
      return;
    }
    // On garde l'URL locale comme aperçu : la vidéo est déjà là, la re-signer
    // ferait retélécharger 200 Mo pour montrer ce que le coach vient d'envoyer.
    setApercuLocal((precedent) => {
      if (precedent) URL.revokeObjectURL(precedent);
      return atelier.url;
    });
    setEtat({ phase: "repos" });
    setErreur(null);
    // Remplacer une vidéo repart d'un calque VIERGE : des annotations posées
    // sur d'autres images ne veulent plus rien dire sur celles-ci.
    onChange({ videoPath: resultat.path, annotations: [] });
  }

  /**
   * Retirer = oublier, jamais effacer. Tant que la réponse n'est pas envoyée,
   * la base peut encore pointer sur cette vidéo : la supprimer ici casserait
   * la référence pour de bon si le coach ferme la modale. L'objet devient un
   * orphelin, ramassé par le balayeur de rétention.
   */
  function retirer() {
    onChange({ videoPath: null, annotations: [] });
    setApercuLocal((precedent) => {
      if (precedent) URL.revokeObjectURL(precedent);
      return null;
    });
    setErreur(null);
  }

  const source =
    apercuLocal ??
    urlExistante ??
    (apercuDistant && apercuDistant.chemin === videoPath ? apercuDistant.url : null);

  /* ── Enregistrement en cours ──────────────────────────────────────────── */
  if (etat.phase === "capture") {
    const progression = (etat.restant / COACH_REPLY_VIDEO_MAX_SECONDS) * 100;
    return (
      <div className="rounded-panel border border-primary/40 bg-surface-soft/40 p-3">
        <video
          ref={videoDirect}
          autoPlay
          muted
          playsInline
          className="mb-2 w-full rounded-control bg-black"
          style={{ maxHeight: 260 }}
        />
        <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-primary transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
            style={{ width: `${progression}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {etat.restant} s restantes — ta voix est enregistrée
          </span>
          <button
            type="button"
            onClick={() => void arreterCapture()}
            className="pressable ml-auto flex min-h-11 items-center rounded-control border border-primary px-3 text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Arrêter et garder
          </button>
          <button
            type="button"
            onClick={annulerCapture}
            className="pressable flex min-h-11 items-center rounded-control px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  /* ── Découpe en cours ─────────────────────────────────────────────────── */
  if (etat.phase === "decoupe") {
    const pourcent = Math.round(etat.progression * 100);
    return (
      <div className="rounded-panel border border-primary/40 bg-surface-soft/40 p-3">
        <p className="text-sm text-foreground">Découpe en cours — {pourcent} %</p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          L&apos;extrait est rejoué et réenregistré en temps réel : compte environ{" "}
          {Math.max(1, Math.round(fin - debut))} secondes. Reste sur cet onglet, sinon la vidéo produite sera hachée.
        </p>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-linear motion-reduce:transition-none"
            style={{ width: `${pourcent}%` }}
            aria-hidden="true"
          />
        </div>
        <button
          type="button"
          onClick={interrompreDecoupe}
          className="pressable mt-2 flex min-h-11 items-center rounded-control px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Interrompre
        </button>
      </div>
    );
  }

  /* ── Atelier local : prévisualiser, découper, joindre ─────────────────── */
  if (etat.phase === "atelier") {
    const { atelier } = etat;
    const duree = atelier.duree;
    const tropLongue = duree !== null && duree > COACH_REPLY_VIDEO_MAX_SECONDS + 0.5;
    const extrait = Math.max(0, fin - debut);

    return (
      <div className="rounded-panel border border-primary/40 bg-surface-soft/40 p-3">
        <video
          src={atelier.url}
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-control bg-black"
          style={{ maxHeight: 260 }}
        />

        <p className="mt-2 text-xs text-muted-foreground">
          {duree !== null ? `Durée : ${Math.round(duree)} s.` : "Durée illisible dans ce conteneur."}{" "}
          {tropLongue &&
            `Plafond : ${COACH_REPLY_VIDEO_MAX_SECONDS} s — découpe-la avant de la joindre.`}
        </p>

        {/* La découpe n'est proposée que quand elle est POSSIBLE, et son
            indisponibilité est dite plutôt que masquée. */}
        {decoupe.disponible && duree !== null ? (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
              <Scissors size={13} aria-hidden="true" />
              Ne garder qu&apos;un extrait
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-12 flex-shrink-0">Début</span>
              <input
                type="range"
                min={0}
                max={Math.max(0, duree - 0.5)}
                step={0.5}
                value={debut}
                onChange={(evenement) => {
                  const valeur = Number(evenement.target.value);
                  setDebut(valeur);
                  if (fin <= valeur) setFin(Math.min(duree, valeur + 1));
                }}
                className="h-11 min-w-0 flex-1 accent-primary"
              />
              <span className="w-14 flex-shrink-0 text-right tabular-nums">{debut.toFixed(1)} s</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-12 flex-shrink-0">Fin</span>
              <input
                type="range"
                min={0}
                max={duree}
                step={0.5}
                value={fin}
                onChange={(evenement) => {
                  const valeur = Number(evenement.target.value);
                  setFin(valeur);
                  if (valeur <= debut) setDebut(Math.max(0, valeur - 1));
                }}
                className="h-11 min-w-0 flex-1 accent-primary"
              />
              <span className="w-14 flex-shrink-0 text-right tabular-nums">{fin.toFixed(1)} s</span>
            </label>
            <button
              type="button"
              disabled={extrait <= 0 || extrait > COACH_REPLY_VIDEO_MAX_SECONDS + 0.5}
              onClick={() => void lancerDecoupe(atelier)}
              className="pressable mt-2 flex min-h-11 items-center gap-2 rounded-control border border-border px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Scissors size={13} aria-hidden="true" />
              Découper — {Math.round(extrait)} s gardées, environ autant d&apos;attente
            </button>
          </div>
        ) : (
          decoupe.raison && <p className="mt-2 text-xs leading-snug text-muted-foreground/70">{decoupe.raison}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button
            type="button"
            disabled={tropLongue}
            onClick={() => void joindre(atelier)}
            className="pressable flex min-h-11 items-center gap-2 rounded-control border border-primary px-3 text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Video size={13} aria-hidden="true" />
            Joindre cette vidéo
          </button>
          <button
            type="button"
            onClick={() => fermerAtelier(atelier)}
            className="pressable flex min-h-11 items-center rounded-control px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Abandonner
          </button>
        </div>
        {erreur && <p className="mt-2 text-xs leading-snug text-destructive">{erreur}</p>}
      </div>
    );
  }

  /* ── Une vidéo est jointe : on annote ─────────────────────────────────── */
  if (videoPath) {
    return (
      <div className="rounded-panel border border-primary/40 bg-primary/5 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Video size={14} className="flex-shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 text-xs leading-snug text-foreground">
            Vidéo jointe. Elle partira avec ta réponse.
          </span>
          <button
            type="button"
            onClick={retirer}
            className="pressable ml-auto flex min-h-11 items-center gap-1.5 rounded-control border border-border px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Trash2 size={12} aria-hidden="true" />
            Retirer
          </button>
        </div>
        {source ? (
          <VideoAnnotationEditor
            src={source}
            annotations={annotations}
            onChange={(calque) => onChange({ videoPath, annotations: calque })}
            maxHeight={260}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Aperçu indisponible — la vidéo est bien jointe, mais elle ne peut pas être annotée sans être affichée.
          </p>
        )}
        {erreur && <p className="mt-2 text-xs leading-snug text-destructive">{erreur}</p>}
      </div>
    );
  }

  /* ── Rien encore ──────────────────────────────────────────────────────── */
  const occupe = etat.phase === "analyse" || etat.phase === "envoi";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={champFichier}
          type="file"
          accept={COACH_REPLY_VIDEO_MIME_TYPES.join(",")}
          className="hidden"
          onChange={(evenement) => {
            const fichier = evenement.target.files?.[0];
            // On vide le champ : sans cela, rechoisir LE MÊME fichier après un
            // refus ne déclencherait aucun événement.
            evenement.target.value = "";
            if (fichier) void choisirFichier(fichier);
          }}
        />
        <button
          type="button"
          disabled={occupe}
          onClick={() => champFichier.current?.click()}
          className="pressable flex min-h-11 items-center gap-2 rounded-control border border-border px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {occupe ? (
            <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Upload size={13} aria-hidden="true" />
          )}
          {etat.phase === "analyse" ? "Analyse…" : etat.phase === "envoi" ? "Envoi…" : "Importer une vidéo"}
        </button>

        {capture.disponible && (
          <button
            type="button"
            disabled={occupe}
            onClick={() => void demarrerCapture()}
            className="pressable flex min-h-11 items-center gap-2 rounded-control border border-border px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera size={13} aria-hidden="true" />
            Filmer et parler
          </button>
        )}
      </div>

      <p className="mt-1.5 text-xs leading-snug text-muted-foreground/70">{COACH_REPLY_VIDEO_LABEL}</p>
      {!capture.disponible && capture.raison && (
        <p className="mt-1.5 text-xs leading-snug text-muted-foreground/70">{capture.raison}</p>
      )}
      {erreur && <p className="mt-1.5 text-xs leading-snug text-destructive">{erreur}</p>}
    </div>
  );
}
