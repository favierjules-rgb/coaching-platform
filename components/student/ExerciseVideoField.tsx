"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, Trash2, Upload, Video } from "lucide-react";

import {
  FEEDBACK_VIDEO_MAX_SECONDS,
  FEEDBACK_VIDEO_MIME_TYPES,
  FEEDBACK_VIDEO_VISIBILITY_LABEL,
  normalizeFeedbackVideoMime,
  validateFeedbackVideoDuration,
  validateFeedbackVideoFile,
  type FeedbackVideoMime,
} from "@/lib/feedback-video";
import {
  captureVideoAvailability,
  readVideoDurationSeconds,
  startFeedbackVideoCapture,
  type SessionCapture,
} from "@/lib/feedback-video-capture";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getSignedFeedbackVideoUrl,
  uploadFeedbackVideo,
} from "@/lib/supabase/storage-feedback-videos";

/**
 * « MONTRE-MOI TA TECHNIQUE » — une vidéo courte par exercice (F4).
 *
 * CE QUE CE COMPOSANT FAIT
 *   Il dépose un FICHIER et rend un CHEMIN. Il ne touche jamais à l'état des
 *   séries, ni au commentaire, ni au remplacement : comme le sélecteur de
 *   remplaçant, c'est une action de séance posée à côté du retour, pas une
 *   information de prescription.
 *
 * DEUX CHEMINS, UNE SEULE RÈGLE
 *   L'élève peut IMPORTER un fichier ou FILMER. La capture est bornée à la
 *   source — 720p demandé, minuterie d'arrêt à 20 s — donc elle ne peut pas
 *   dépasser. L'import, lui, est MESURÉ puis refusé s'il dépasse : on ne
 *   ré-encode rien dans le navigateur, et on le dit à l'élève avec la marche
 *   à suivre plutôt qu'un « fichier invalide ».
 *
 * LE FICHIER PART TOUT DE SUITE
 *   Pas à l'envoi du retour : le chemin ne dépend que de l'identifiant de
 *   l'élève, qui existe déjà. L'aperçu est donc immédiat, et l'élève ne
 *   découvre pas 40 Mo de téléversement au moment de valider sa séance.
 *
 * CET ÉCRAN N'EFFACE RIEN
 *   Ni au remplacement, ni au retrait. La BASE ne connaît le nouveau chemin
 *   qu'à l'envoi du retour : effacer l'ancien fichier tout de suite ferait
 *   pointer la base, définitivement, vers un objet disparu dès que l'élève
 *   abandonne l'écran. « Retirer » vide donc l'état local, rien d'autre —
 *   l'ancien objet devient un orphelin ordinaire, ramassé par la purge de
 *   rétention (F4.1).
 *
 * INJECTABLE. `deposer` et `resoudreUrl` ont une implémentation réelle par
 * défaut et sont remplaçables : les tests n'ont besoin ni de réseau, ni de
 * Supabase, ni de caméra.
 */

export type DeposeurVideo = (parametres: {
  studentId: string;
  fichier: Blob;
  mime: FeedbackVideoMime;
}) => Promise<{ path: string } | { error: string }>;

export type ResolveurUrlVideo = (chemin: string) => Promise<string | null>;

const deposeurParDefaut: DeposeurVideo = async ({ studentId, fichier, mime }) => {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return { error: "Session expirée. Recharge la page." };
  return uploadFeedbackVideo(supabase, {
    studentId,
    fichier,
    mime,
    identifiant: crypto.randomUUID(),
  });
};

const resolveurParDefaut: ResolveurUrlVideo = async (chemin) => {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  return getSignedFeedbackVideoUrl(supabase, chemin);
};

interface ExerciseVideoFieldProps {
  studentId: string;
  /** Chemin actuellement retenu, ou `null`. */
  videoPath: string | null;
  onChange: (chemin: string | null) => void;
  deposer?: DeposeurVideo;
  resoudreUrl?: ResolveurUrlVideo;
  /**
   * Sans réseau, AUCUNE vidéo nouvelle ne peut naître.
   *
   * F4/F5 restent online-only : un téléversement exige le bucket, et il n'y
   * a pas de Blob dans IndexedDB — stocker une vidéo localement pour
   * l'envoyer plus tard remplirait le téléphone et n'a jamais été le
   * chantier. On retire donc les deux commandes d'ajout et on le dit, au
   * lieu de laisser l'élève déclencher un envoi qui échouera.
   *
   * Ce qui est DÉJÀ enregistré, lui, reste affiché et conservé : voir
   * `cheminsVideoConnus` dans `construireWorkoutFeedbackPayload`.
   */
  horsLigne?: boolean;
}

type Etat =
  | { phase: "repos" }
  | { phase: "analyse" }
  | { phase: "envoi" }
  | { phase: "capture"; session: SessionCapture; restant: number };

export function ExerciseVideoField({
  studentId,
  videoPath,
  onChange,
  deposer = deposeurParDefaut,
  resoudreUrl = resolveurParDefaut,
  horsLigne = false,
}: ExerciseVideoFieldProps) {
  const [etat, setEtat] = useState<Etat>({ phase: "repos" });
  const [erreur, setErreur] = useState<string | null>(null);
  /** Aperçu local du fichier tout juste déposé — évite une URL signée inutile. */
  const [apercuLocal, setApercuLocal] = useState<string | null>(null);
  /**
   * Aperçu distant MÉMORISÉ AVEC SON CHEMIN. On ne le remet pas à zéro dans
   * un effet — un `setState` en corps d'effet provoque un rendu de plus et
   * un aperçu qui clignote : on garde le couple, et on ne l'affiche que s'il
   * correspond encore au chemin courant.
   */
  const [apercuDistant, setApercuDistant] = useState<{ chemin: string; url: string } | null>(null);
  const champFichier = useRef<HTMLInputElement | null>(null);
  const videoDirect = useRef<HTMLVideoElement | null>(null);

  const capture = captureVideoAvailability();

  // Aperçu d'une vidéo déjà enregistrée (retour rouvert) : on ne demande une
  // URL signée que s'il n'y a pas déjà un aperçu local, et on l'annule si le
  // chemin change entre-temps.
  useEffect(() => {
    if (!videoPath || apercuLocal) return;
    let annule = false;
    void resoudreUrl(videoPath).then((url) => {
      if (!annule && url) setApercuDistant({ chemin: videoPath, url });
    });
    return () => {
      annule = true;
    };
  }, [videoPath, apercuLocal, resoudreUrl]);

  // Le flux de la caméra est branché après le rendu : l'élément n'existe pas
  // encore au moment où la capture démarre.
  useEffect(() => {
    if (etat.phase !== "capture" || !videoDirect.current) return;
    videoDirect.current.srcObject = etat.session.flux;
  }, [etat]);

  // Une URL d'objet non révoquée retient le fichier entier en mémoire.
  useEffect(() => {
    return () => {
      if (apercuLocal) URL.revokeObjectURL(apercuLocal);
    };
  }, [apercuLocal]);

  const envoyer = useCallback(
    async (fichier: Blob, mime: FeedbackVideoMime) => {
      setEtat({ phase: "envoi" });
      const resultat = await deposer({ studentId, fichier, mime });
      setEtat({ phase: "repos" });
      if ("error" in resultat) {
        setErreur(resultat.error);
        return;
      }
      setApercuLocal((precedent) => {
        if (precedent) URL.revokeObjectURL(precedent);
        return URL.createObjectURL(fichier);
      });
      setErreur(null);
      onChange(resultat.path);
    },
    [deposer, onChange, studentId],
  );

  async function choisirFichier(fichier: File) {
    setErreur(null);
    const mime = normalizeFeedbackVideoMime(fichier.type);
    const refusFichier = validateFeedbackVideoFile({ type: fichier.type, size: fichier.size });
    if (refusFichier || !mime) {
      setErreur(refusFichier ?? "Format non accepté.");
      return;
    }
    setEtat({ phase: "analyse" });
    const duree = await readVideoDurationSeconds(fichier);
    const refusDuree = validateFeedbackVideoDuration(duree);
    if (refusDuree) {
      setEtat({ phase: "repos" });
      setErreur(refusDuree);
      return;
    }
    await envoyer(fichier, mime);
  }

  async function demarrerCapture() {
    setErreur(null);
    const session = await startFeedbackVideoCapture();
    if ("error" in session) {
      setErreur(session.error);
      return;
    }
    setEtat({ phase: "capture", session, restant: FEEDBACK_VIDEO_MAX_SECONDS });
  }

  // Décompte : c'est la seule animation du composant, et elle porte une
  // information réelle — combien de temps il reste. Aucune fioriture.
  useEffect(() => {
    if (etat.phase !== "capture") return;
    const battement = setInterval(() => {
      setEtat((courant) =>
        courant.phase === "capture"
          ? { ...courant, restant: Math.max(0, courant.restant - 1) }
          : courant,
      );
    }, 1000);
    return () => clearInterval(battement);
  }, [etat.phase]);

  async function arreterCapture() {
    if (etat.phase !== "capture") return;
    const session = etat.session;
    setEtat({ phase: "envoi" });
    const resultat = await session.arreter();
    if ("error" in resultat) {
      setEtat({ phase: "repos" });
      setErreur(resultat.error);
      return;
    }
    await envoyer(resultat.fichier, resultat.mime);
  }

  function annulerCapture() {
    if (etat.phase !== "capture") return;
    etat.session.abandonner();
    setEtat({ phase: "repos" });
  }

  /**
   * Retirer = oublier, jamais effacer. Tant que le retour n'est pas renvoyé,
   * la base pointe encore sur cette vidéo : la supprimer ici casserait la
   * référence pour de bon si l'élève quitte l'écran. L'objet devient un
   * orphelin, ramassé par la purge de rétention.
   */
  function retirer() {
    onChange(null);
    setApercuLocal((precedent) => {
      if (precedent) URL.revokeObjectURL(precedent);
      return null;
    });
    setErreur(null);
  }

  const occupe = etat.phase === "analyse" || etat.phase === "envoi";
  const apercu =
    apercuLocal ?? (apercuDistant && apercuDistant.chemin === videoPath ? apercuDistant.url : null);

  /* ── Enregistrement en cours ────────────────────────────────────────── */
  if (etat.phase === "capture") {
    const progression = (etat.restant / FEEDBACK_VIDEO_MAX_SECONDS) * 100;
    return (
      <div className="mt-3 rounded-panel border border-primary/40 bg-surface-soft/40 p-3">
        <video
          ref={videoDirect}
          autoPlay
          muted
          playsInline
          className="mb-2 w-full rounded-control bg-black"
          style={{ maxHeight: 240 }}
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
            {etat.restant} s restantes
          </span>
          <button
            type="button"
            onClick={() => void arreterCapture()}
            className="pressable ml-auto flex min-h-11 items-center gap-1.5 rounded-control border border-primary px-3 text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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

  /* ── Une vidéo est attachée ─────────────────────────────────────────── */
  if (videoPath) {
    return (
      <div className="mt-3 rounded-panel border border-primary/40 bg-primary/5 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Video size={14} className="flex-shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 text-xs leading-snug text-foreground">
            Vidéo jointe. {FEEDBACK_VIDEO_VISIBILITY_LABEL}
          </span>
          <button
            type="button"
            onClick={retirer}
            className="pressable ml-auto flex min-h-11 items-center gap-1.5 rounded-control border border-border px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Trash2 size={12} aria-hidden="true" />
            Retirer la vidéo
          </button>
        </div>
        {apercu ? (
          <video
            src={apercu}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-control bg-black"
            style={{ maxHeight: 240 }}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Aperçu indisponible — la vidéo est bien enregistrée.</p>
        )}
        {erreur && <p className="mt-2 text-xs leading-snug text-destructive">{erreur}</p>}
      </div>
    );
  }

  /* ── Aucune vidéo ───────────────────────────────────────────────────── */
  if (horsLigne) {
    // Aucun `<input type="file">`, aucun bouton de capture : l'ajout n'est
    // pas seulement désactivé, il n'est pas MONTÉ. Rien ne peut donc
    // déclencher `deposer()` — ni un clic, ni un raccourci, ni un test.
    return (
      <div className="mt-3">
        <p className="text-xs leading-snug text-muted-foreground/70">
          Une connexion est nécessaire pour ajouter une vidéo.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={champFichier}
          type="file"
          accept={FEEDBACK_VIDEO_MIME_TYPES.join(",")}
          className="hidden"
          onChange={(evenement) => {
            const fichier = evenement.target.files?.[0];
            // On vide le champ : sans cela, rechoisir LE MÊME fichier après
            // un refus ne déclencherait aucun événement.
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
            Filmer {FEEDBACK_VIDEO_MAX_SECONDS} s
          </button>
        )}
      </div>

      <p className="mt-1.5 text-xs leading-snug text-muted-foreground/70">
        {FEEDBACK_VIDEO_MAX_SECONDS} s maximum, 50 Mo. {FEEDBACK_VIDEO_VISIBILITY_LABEL}
      </p>
      {erreur && <p className="mt-1.5 text-xs leading-snug text-destructive">{erreur}</p>}
    </div>
  );
}
