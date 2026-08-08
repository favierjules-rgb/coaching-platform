/**
 * F4 — VIDÉO DE TECHNIQUE : ce qui a besoin d'un NAVIGATEUR.
 *
 * Séparé de `lib/feedback-video.ts` pour la même raison que
 * `recipe-image-optimizer.ts` l'est de `recipe-image.ts` : les décisions se
 * testent dans Node, les périphériques non. Ici vivent les deux seules
 * choses qui exigent un vrai navigateur — lire la durée d'un fichier, et
 * filmer avec la caméra.
 *
 * AUCUNE DÉPENDANCE AJOUTÉE. Ni ffmpeg.wasm, ni bibliothèque d'upload : la
 * capture passe par `MediaRecorder`, présent partout où l'on va, et la durée
 * par un élément `<video>` en `preload="metadata"`.
 *
 * PAS DE RÉ-ENCODAGE, C'EST UNE DÉCISION. Un fichier importé n'est jamais
 * transcodé : on lit ses métadonnées et on le REFUSE s'il dépasse, en
 * expliquant quoi faire. Ré-encoder dans le navigateur demanderait soit un
 * transcodage temps réel (20 s d'attente, onglet actif obligatoire), soit
 * 30 Mo de WebAssembly. La capture caméra, elle, n'a pas ce problème : elle
 * est bornée À LA SOURCE — 720p demandé au périphérique, minuterie d'arrêt à
 * 20 s — donc rien à corriger après coup.
 *
 * LE MICRO RESTE FERMÉ. `audio: false` : une vidéo de technique n'a pas
 * besoin du son, et l'en-tête `Permissions-Policy` garde `microphone=()`.
 * On n'ouvre que ce dont on se sert.
 */

import {
  FEEDBACK_VIDEO_MAX_SECONDS,
  normalizeFeedbackVideoMime,
  type FeedbackVideoMime,
} from "@/lib/feedback-video";

/* ════════════════════════════════════════════════════════════════════════
 * 1. LIRE LA DURÉE D'UN FICHIER
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Rend la durée en secondes, ou `null` si elle est illisible.
 *
 * `null` n'est PAS une erreur : certains conteneurs WebM n'écrivent pas leur
 * durée et rendent `Infinity`. `validateFeedbackVideoDuration` accepte ce
 * cas — le plafond de taille, lui, reste opposable.
 *
 * L'URL d'objet est révoquée dans tous les cas : une vidéo de 40 Mo laissée
 * en mémoire sur un téléphone, c'est un onglet qui se fait tuer.
 */
export async function readVideoDurationSeconds(fichier: Blob): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(fichier);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  try {
    const duree = await new Promise<number | null>((resolve) => {
      // Un fichier corrompu peut ne déclencher NI loadedmetadata NI error.
      // Sans cette minuterie, la promesse ne se résoudrait jamais et le
      // bouton resterait bloqué sur « Analyse… ».
      const minuterie = setTimeout(() => resolve(null), 5000);
      const finir = (valeur: number | null) => {
        clearTimeout(minuterie);
        resolve(valeur);
      };
      video.onloadedmetadata = () => finir(Number.isFinite(video.duration) ? video.duration : null);
      video.onerror = () => finir(null);
      video.src = url;
    });
    return duree;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * 2. FILMER AVEC LA CAMÉRA
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Types tentés dans l'ORDRE, du plus universel au plus spécifique.
 * `MediaRecorder.isTypeSupported` tranche : Safari 17+ produit du MP4,
 * Chrome et Firefox du WebM. On ne suppose rien, on demande.
 */
const TYPES_CAPTURE = [
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export interface CaptureVideoAvailability {
  disponible: boolean;
  /** Message à afficher quand elle ne l'est pas — jamais un bouton mort. */
  raison: string | null;
}

/**
 * La capture est-elle possible ICI ? On ne se contente pas de tester le
 * `userAgent` : on demande au navigateur ce qu'il sait faire. Sur un
 * navigateur sans `MediaRecorder`, ou hors contexte sécurisé (http), le
 * bouton « Filmer » ne doit pas apparaître du tout.
 */
export function captureVideoAvailability(): CaptureVideoAvailability {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return { disponible: false, raison: null };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { disponible: false, raison: "Ton navigateur ne permet pas de filmer ici. Importe un fichier." };
  }
  if (typeof MediaRecorder === "undefined") {
    return { disponible: false, raison: "Ton navigateur ne permet pas d'enregistrer ici. Importe un fichier." };
  }
  if (!window.isSecureContext) {
    return { disponible: false, raison: "L'accès à la caméra exige une connexion sécurisée." };
  }
  return { disponible: true, raison: null };
}

function choisirTypeCapture(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of TYPES_CAPTURE) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export interface SessionCapture {
  /** Le flux à brancher sur un `<video autoplay muted playsinline>`. */
  flux: MediaStream;
  /** Arrête l'enregistrement et rend le fichier. Idempotent. */
  arreter: () => Promise<{ fichier: Blob; mime: FeedbackVideoMime } | { error: string }>;
  /** Coupe tout sans rien produire — l'élève a changé d'avis. */
  abandonner: () => void;
}

/**
 * Ouvre la caméra et démarre l'enregistrement, borné à 20 s.
 *
 * 720p est DEMANDÉ, pas imposé : `ideal` laisse le périphérique proposer au
 * plus près plutôt que d'échouer s'il ne sait pas faire exactement cela.
 * `facingMode: environment` vise la caméra arrière — on filme quelqu'un
 * d'autre en train de soulever, pas soi-même.
 *
 * La minuterie d'arrêt est la raison pour laquelle la capture n'a besoin
 * d'aucun ré-encodage : le fichier ne PEUT pas dépasser la durée permise.
 */
export async function startFeedbackVideoCapture(): Promise<SessionCapture | { error: string }> {
  const dispo = captureVideoAvailability();
  if (!dispo.disponible) {
    return { error: dispo.raison ?? "La capture vidéo n'est pas disponible ici." };
  }
  const type = choisirTypeCapture();
  if (!type) {
    return { error: "Ton navigateur ne sait enregistrer aucun format accepté. Importe un fichier." };
  }

  let flux: MediaStream;
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: { ideal: "environment" },
      },
      audio: false,
    });
  } catch (erreur) {
    const nom = erreur instanceof DOMException ? erreur.name : "";
    if (nom === "NotAllowedError" || nom === "SecurityError") {
      return { error: "Accès à la caméra refusé. Autorise-le dans ton navigateur, ou importe un fichier." };
    }
    if (nom === "NotFoundError" || nom === "OverconstrainedError") {
      return { error: "Aucune caméra utilisable trouvée. Importe un fichier." };
    }
    return { error: "La caméra n'a pas pu être ouverte. Importe un fichier." };
  }

  const morceaux: Blob[] = [];
  const enregistreur = new MediaRecorder(flux, { mimeType: type });
  enregistreur.ondataavailable = (evenement) => {
    if (evenement.data.size > 0) morceaux.push(evenement.data);
  };
  enregistreur.start();

  const couperLeFlux = () => {
    for (const piste of flux.getTracks()) piste.stop();
  };

  const fin = new Promise<void>((resolve) => {
    enregistreur.onstop = () => resolve();
  });

  // Borne DURE. Si l'élève oublie d'arrêter, le navigateur arrête pour lui.
  const minuterie = setTimeout(() => {
    if (enregistreur.state === "recording") enregistreur.stop();
  }, FEEDBACK_VIDEO_MAX_SECONDS * 1000);

  let termine = false;

  return {
    flux,
    async arreter() {
      if (termine) return { error: "Enregistrement déjà terminé." };
      termine = true;
      clearTimeout(minuterie);
      if (enregistreur.state === "recording") enregistreur.stop();
      await fin;
      couperLeFlux();
      const mime = normalizeFeedbackVideoMime(type);
      if (!mime) return { error: "Format d'enregistrement inattendu. Importe un fichier." };
      const fichier = new Blob(morceaux, { type: mime });
      if (fichier.size === 0) return { error: "Rien n'a été enregistré. Réessaie." };
      return { fichier, mime };
    },
    abandonner() {
      if (termine) return;
      termine = true;
      clearTimeout(minuterie);
      if (enregistreur.state === "recording") enregistreur.stop();
      couperLeFlux();
    },
  };
}
