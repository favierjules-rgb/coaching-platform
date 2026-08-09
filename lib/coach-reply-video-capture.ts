import {
  COACH_REPLY_VIDEO_MAX_SECONDS,
  COACH_REPLY_VIDEO_MIME_TYPES,
  type CoachReplyVideoMime,
} from "@/lib/coach-reply-video";

/**
 * F5 — CE QUI A BESOIN D'UN NAVIGATEUR : filmer, et DÉCOUPER pour de vrai.
 *
 * Séparé des décisions pures pour la même raison qu'en F4 : les règles se
 * testent dans Node, les périphériques non.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LE SON EST OUVERT ICI, ET C'EST UN CHANGEMENT
 * ────────────────────────────────────────────────────────────────────────
 * F4 gardait `microphone=()` fermé : une vidéo de technique n'a pas besoin
 * du son. Une réponse de COACH, si — il explique. La capture demande donc
 * `audio: true`, ce qui exige d'ouvrir `microphone=(self)` dans
 * `next.config.ts`. `(self)` : ce site et lui seul, aucune iframe tierce.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA DÉCOUPE EST RÉELLE, ET ELLE COÛTE DU TEMPS RÉEL
 * ────────────────────────────────────────────────────────────────────────
 * Le fichier envoyé ne contient QUE l'intervalle gardé — ce n'est pas une
 * borne de lecture. Sans transcodage, la seule façon honnête d'y arriver est
 * de REJOUER l'intervalle et de le réenregistrer. Conséquences assumées :
 *   • une découpe de 40 s prend 40 s ;
 *   • l'onglet doit rester actif — en arrière-plan, le navigateur ralentit
 *     les animations et la vidéo produite serait hachée ;
 *   • le résultat est réencodé, donc légèrement moins bon que l'original.
 *
 * POURQUOI UN CANVAS ET UN AudioContext, ET PAS `video.captureStream()`
 * La méthode directe n'existe pas dans Safari. Le détour marche partout :
 *   • IMAGE  — on dessine chaque frame dans un `<canvas>`, et
 *     `canvas.captureStream()` en fait une piste vidéo ;
 *   • SON    — `createMediaElementSource` + `MediaStreamAudioDestinationNode`
 *     en font une piste audio, sans jamais la router vers les haut-parleurs
 *     (on ne connecte PAS `audioCtx.destination` : le coach n'a pas besoin
 *     de réentendre sa propre voix pendant la découpe).
 *
 * Si le navigateur ne sait pas faire, on le DIT et on propose d'envoyer la
 * vidéo entière — jamais un bouton qui tourne dans le vide.
 */

/** Types tentés dans l'ORDRE : `isTypeSupported` tranche, on ne suppose rien. */
const TYPES_ENREGISTREMENT = [
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

function normaliser(type: string): CoachReplyVideoMime | null {
  const nu = type.split(";")[0]?.trim().toLowerCase() ?? "";
  return (COACH_REPLY_VIDEO_MIME_TYPES as readonly string[]).includes(nu)
    ? (nu as CoachReplyVideoMime)
    : null;
}

function choisirType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of TYPES_ENREGISTREMENT) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

export interface Disponibilite {
  disponible: boolean;
  /** Message à afficher quand elle ne l'est pas — jamais un bouton mort. */
  raison: string | null;
}

/** La capture caméra est-elle possible ICI ? */
export function captureCoachDisponible(): Disponibilite {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return { disponible: false, raison: null };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { disponible: false, raison: "Ton navigateur ne permet pas de filmer ici. Importe un fichier." };
  }
  if (typeof MediaRecorder === "undefined" || !choisirType()) {
    return { disponible: false, raison: "Ton navigateur ne sait enregistrer aucun format accepté. Importe un fichier." };
  }
  if (!window.isSecureContext) {
    return { disponible: false, raison: "L'accès à la caméra exige une connexion sécurisée." };
  }
  return { disponible: true, raison: null };
}

/**
 * La découpe est-elle possible ICI ?
 *
 * Trois briques, testées séparément pour que le message dise ce qui manque
 * plutôt qu'un « non » opaque.
 */
export function decoupeDisponible(): Disponibilite {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return { disponible: false, raison: null };
  }
  const canvas = document.createElement("canvas");
  if (typeof (canvas as HTMLCanvasElement & { captureStream?: unknown }).captureStream !== "function") {
    return { disponible: false, raison: "Ton navigateur ne sait pas découper une vidéo. Elle partira entière." };
  }
  const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Audio) {
    return { disponible: false, raison: "Ton navigateur ne sait pas extraire le son. La vidéo partira entière." };
  }
  // Le CONSTRUCTEUR ne suffit pas : la découpe a besoin de deux méthodes
  // précises, et un navigateur qui expose `AudioContext` sans elles nous
  // ferait échouer au milieu du traitement plutôt qu'avant de le lancer. On
  // les cherche sur le PROTOTYPE — instancier un AudioContext juste pour le
  // savoir en ouvrirait un que personne ne fermerait.
  if (
    typeof Audio.prototype?.createMediaElementSource !== "function" ||
    typeof Audio.prototype?.createMediaStreamDestination !== "function"
  ) {
    return { disponible: false, raison: "Ton navigateur ne sait pas extraire le son. La vidéo partira entière." };
  }
  if (typeof MediaRecorder === "undefined" || !choisirType()) {
    return { disponible: false, raison: "Ton navigateur ne sait réenregistrer aucun format accepté. La vidéo partira entière." };
  }
  return { disponible: true, raison: null };
}

/* ════════════════════════════════════════════════════════════════════════
 * FILMER
 * ════════════════════════════════════════════════════════════════════════ */

export interface SessionCaptureCoach {
  flux: MediaStream;
  arreter: () => Promise<{ fichier: Blob; mime: CoachReplyVideoMime } | { error: string }>;
  abandonner: () => void;
}

/**
 * Ouvre caméra ET micro, et enregistre — borné à 120 s.
 *
 * `facingMode: user` : le coach se filme en train de parler, contrairement à
 * l'élève qui filme quelqu'un d'autre en train de soulever.
 */
export async function demarrerCaptureCoach(): Promise<SessionCaptureCoach | { error: string }> {
  const dispo = captureCoachDisponible();
  if (!dispo.disponible) return { error: dispo.raison ?? "La capture n'est pas disponible ici." };
  const type = choisirType();
  if (!type) return { error: "Ton navigateur ne sait enregistrer aucun format accepté." };

  let flux: MediaStream;
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: { ideal: "user" } },
      // Le coach EXPLIQUE : sans le son, la réponse ne vaut rien.
      audio: true,
    });
  } catch (erreur) {
    const nom = erreur instanceof DOMException ? erreur.name : "";
    if (nom === "NotAllowedError" || nom === "SecurityError") {
      return { error: "Accès à la caméra ou au micro refusé. Autorise-le, ou importe un fichier." };
    }
    if (nom === "NotFoundError" || nom === "OverconstrainedError") {
      return { error: "Aucune caméra utilisable trouvée. Importe un fichier." };
    }
    return { error: "La caméra n'a pas pu être ouverte. Importe un fichier." };
  }

  const morceaux: Blob[] = [];
  const enregistreur = new MediaRecorder(flux, { mimeType: type });
  enregistreur.ondataavailable = (e) => {
    if (e.data.size > 0) morceaux.push(e.data);
  };
  enregistreur.start();

  const couper = () => {
    for (const piste of flux.getTracks()) piste.stop();
  };
  // `onstop` PEUT NE JAMAIS ARRIVER. Un MediaRecorder qui tombe en panne
  // n'émet pas `stop`, et sans ce second dénouement l'écran resterait figé
  // sur « Envoi… » indéfiniment, sans message et sans issue. On dénoue donc
  // aussi sur `error`, et le drapeau dit à `arreter()` ce qui s'est passé.
  let panneEnregistreur: string | null = null;
  const fin = new Promise<void>((resolve) => {
    enregistreur.onstop = () => resolve();
    enregistreur.onerror = (e) => {
      panneEnregistreur =
        (e as unknown as { error?: { message?: string } }).error?.message ?? "panne de l'enregistreur";
      resolve();
    };
  });
  const minuterie = setTimeout(() => {
    if (enregistreur.state === "recording") enregistreur.stop();
  }, COACH_REPLY_VIDEO_MAX_SECONDS * 1000);

  let termine = false;
  return {
    flux,
    async arreter() {
      if (termine) return { error: "Enregistrement déjà terminé." };
      termine = true;
      clearTimeout(minuterie);
      if (enregistreur.state === "recording") enregistreur.stop();
      await fin;
      couper();
      // Une panne d'enregistreur laisse des morceaux PARTIELS. Les rendre
      // reviendrait à proposer au coach d'envoyer une vidéo tronquée en
      // croyant qu'elle est complète.
      if (panneEnregistreur) {
        return { error: `L'enregistrement s'est interrompu (${panneEnregistreur}). Réessaie, ou importe un fichier.` };
      }
      const mime = normaliser(type);
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
      couper();
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * DÉCOUPER — pour de vrai
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tolérance entre l'intervalle DEMANDÉ et l'intervalle réellement capturé,
 * en secondes.
 *
 * La boucle de dessin s'arrête à la PREMIÈRE image dont l'horodatage atteint
 * `fin` : à trente images par seconde, elle dépasse donc d'au plus ~33 ms, et
 * `MediaRecorder` ferme son dernier fragment sur une frontière qui lui est
 * propre. Un demi-seconde couvre très largement ces deux imprécisions.
 *
 * Au-delà, ce n'est plus de l'imprécision : c'est une lecture qui s'est
 * arrêtée en route, et le fichier produit est TRONQUÉ. Il est alors refusé —
 * un extrait amputé envoyé comme s'il était complet serait pire qu'une
 * découpe qui échoue franchement.
 */
export const TOLERANCE_DECOUPE_S = 0.5;

/**
 * Délai de garde au-delà de la durée attendue, en millisecondes.
 *
 * Sans lui, une vidéo qui cale ne termine JAMAIS : `currentTime` n'avance
 * plus, `ended` ne se déclenche pas, et `requestVideoFrameCallback` ne
 * rappelle rien puisqu'aucune image n'est décodée. L'écran resterait sur
 * « Découpe en cours » jusqu'à ce que l'onglet soit fermé.
 */
const GARDE_DECOUPE_MS = 15_000;

/**
 * La demande de découpe est-elle recevable, et y a-t-il seulement quelque
 * chose à découper ?
 *
 * SÉPARÉE DU RESTE À DESSEIN. C'est la seule partie de la découpe qui ne
 * dépend d'aucun périphérique : elle se prouve dans Node, sur les vrais
 * chiffres, plutôt que de reposer sur une lecture de code ou sur un essai
 * manuel dans un navigateur.
 */
export type VerdictIntervalle =
  | { error: string }
  | { couvreTout: true }
  | { couvreTout: false; duree: number };

export function verifierIntervalleDecoupe(parametres: {
  debut: number;
  fin: number;
  dureeSource?: number | null;
}): VerdictIntervalle {
  const debut = Math.max(0, parametres.debut);
  const { fin } = parametres;
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return { error: "Bornes de découpe illisibles." };
  if (!(fin > debut)) return { error: "La fin doit venir après le début." };
  if (fin - debut > COACH_REPLY_VIDEO_MAX_SECONDS + TOLERANCE_DECOUPE_S) {
    return { error: `L'extrait dépasse ${COACH_REPLY_VIDEO_MAX_SECONDS} s.` };
  }

  const duree = parametres.dureeSource;
  // AUCUNE DÉCOUPE À FAIRE. L'intervalle couvre la vidéo entière : la
  // réencoder coûterait sa durée en temps réel et un peu de qualité, pour
  // rendre exactement le même contenu.
  if (
    duree != null &&
    Number.isFinite(duree) &&
    debut <= TOLERANCE_DECOUPE_S &&
    fin >= duree - TOLERANCE_DECOUPE_S
  ) {
    return { couvreTout: true };
  }
  return { couvreTout: false, duree: fin - debut };
}

export interface OptionsDecoupe {
  debut: number;
  fin: number;
  /**
   * Type du fichier SOURCE. Quand l'intervalle couvre la vidéo entière, il
   * n'y a rien à découper : on rend la source telle quelle, sans réencodage,
   * sans attente et sans perte de qualité. Sans ce type, on ne saurait pas
   * sous quel conteneur la rendre.
   */
  mimeSource?: CoachReplyVideoMime;
  /** Durée totale de la source, pour reconnaître « pas de découpe ». */
  dureeSource?: number | null;
  /** Progression 0..1, pour que l'attente ne soit pas aveugle. */
  onProgression?: (part: number) => void;
  /** Interrompt proprement la découpe en cours. */
  signal?: AbortSignal;
  /**
   * Marge du garde-fou au-delà de la durée attendue. Voir `GARDE_DECOUPE_MS`
   * pour la valeur par défaut et la raison d'être. Réglable parce qu'un
   * appelant peut avoir de bonnes raisons d'attendre moins — l'application,
   * elle, ne la règle pas.
   */
  margeGardeMs?: number;
}

/**
 * Rend un NOUVEAU fichier ne contenant que `[debut, fin]`.
 *
 * L'opération dure `fin - debut` secondes : c'est du temps réel, pas un
 * calcul. L'appelant doit le dire à l'utilisateur avant de la lancer.
 */
export async function decouperVideo(
  source: Blob,
  options: OptionsDecoupe,
): Promise<{ fichier: Blob; mime: CoachReplyVideoMime } | { error: string }> {
  const dispo = decoupeDisponible();
  if (!dispo.disponible) return { error: dispo.raison ?? "La découpe n'est pas disponible ici." };
  const type = choisirType();
  if (!type) return { error: "Aucun format d'enregistrement accepté." };

  const debut = Math.max(0, options.debut);
  const fin = options.fin;
  const verdict = verifierIntervalleDecoupe({ debut, fin, dureeSource: options.dureeSource });
  if ("error" in verdict) return verdict;
  // Rien à découper : on rend la source, intacte. Sans son type on ne saurait
  // pas sous quel conteneur la rendre, donc on réencode faute de mieux.
  if (verdict.couvreTout && options.mimeSource) {
    options.onProgression?.(1);
    return { fichier: source, mime: options.mimeSource };
  }

  const url = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  // Muet côté HAUT-PARLEURS uniquement : la piste audio est captée en amont
  // par l'AudioContext, donc le son est bien dans le fichier produit.
  video.muted = true;

  const AudioCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let audioCtx: AudioContext | null = null;
  let nettoye = false;

  const nettoyer = () => {
    if (nettoye) return;
    nettoye = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    void audioCtx?.close().catch(() => {});
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const minuterie = setTimeout(() => reject(new Error("métadonnées illisibles")), 10000);
      video.onloadedmetadata = () => {
        clearTimeout(minuterie);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(minuterie);
        reject(new Error("vidéo illisible"));
      };
    });

    // 720p au plus : réencoder en 4K coûterait cher pour rien, et le plafond
    // de taille du bucket est calibré sur du 720p.
    const largeurSource = video.videoWidth || 1280;
    const hauteurSource = video.videoHeight || 720;
    const echelle = Math.min(1, 1280 / largeurSource, 720 / hauteurSource);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(largeurSource * echelle));
    canvas.height = Math.max(2, Math.round(hauteurSource * echelle));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "Le navigateur n'a pas fourni de contexte de dessin." };
    ctx.imageSmoothingQuality = "high";

    const fluxCanvas = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(30);
    audioCtx = new AudioCtor();
    // Certains navigateurs ouvrent l'AudioContext suspendu tant qu'aucun
    // geste n'a eu lieu. La découpe part d'un clic, donc `resume` aboutit.
    if (audioCtx.state === "suspended") await audioCtx.resume();
    const sortieAudio = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaElementSource(video).connect(sortieAudio);
    // On ne connecte PAS `audioCtx.destination` : le coach n'a aucune raison
    // de réentendre sa propre voix pendant la découpe.

    const flux = new MediaStream([...fluxCanvas.getVideoTracks(), ...sortieAudio.stream.getAudioTracks()]);
    const morceaux: Blob[] = [];
    const enregistreur = new MediaRecorder(flux, { mimeType: type });
    enregistreur.ondataavailable = (e) => {
      if (e.data.size > 0) morceaux.push(e.data);
    };

    await new Promise<void>((resolve, reject) => {
      const minuterie = setTimeout(() => reject(new Error("positionnement impossible")), 10000);
      video.onseeked = () => {
        clearTimeout(minuterie);
        resolve();
      };
      video.currentTime = debut;
    });

    // `onstop` peut ne jamais arriver si l'enregistreur tombe en panne : on
    // dénoue aussi sur `error`, et on retient la panne pour REFUSER les
    // morceaux partiels plus bas.
    let panneEnregistreur: string | null = null;
    const termine = new Promise<void>((resolve) => {
      enregistreur.onstop = () => resolve();
      enregistreur.onerror = (e) => {
        panneEnregistreur =
          (e as unknown as { error?: { message?: string } }).error?.message ?? "panne de l'enregistreur";
        resolve();
      };
    });
    enregistreur.start();
    await video.play();

    // Boucle de dessin. `requestVideoFrameCallback` quand il existe — il se
    // cale sur les frames RÉELLEMENT décodées — sinon `requestAnimationFrame`.
    //
    // TROIS DÉNOUEMENTS, ET PAS UN SEUL. La boucle d'origine ne sortait que
    // par « on a atteint la fin » ou « on a été interrompu », tous deux
    // évalués DANS le rappel de frame. Or c'est exactement ce rappel qui
    // cesse d'arriver quand la vidéo cale : plus une seule image décodée,
    // donc plus de rappel, donc plus rien — pas même l'interruption. Le
    // battement et la garde existent pour que l'écran ne puisse pas rester
    // figé, quoi qu'il arrive au décodeur.
    await new Promise<void>((resolve) => {
      let fini = false;
      const finir = () => {
        if (fini) return;
        fini = true;
        clearTimeout(garde);
        clearInterval(battement);
        resolve();
      };
      const garde = setTimeout(finir, (fin - debut) * 1000 + (options.margeGardeMs ?? GARDE_DECOUPE_MS));
      const battement = setInterval(() => {
        if (options.signal?.aborted || video.error || video.ended || panneEnregistreur) finir();
      }, 250);

      const avecFrames = typeof (video as HTMLVideoElement & { requestVideoFrameCallback?: unknown })
        .requestVideoFrameCallback === "function";
      const dessiner = () => {
        if (fini) return;
        if (options.signal?.aborted) {
          finir();
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        options.onProgression?.(Math.min(1, (video.currentTime - debut) / (fin - debut)));
        if (video.currentTime >= fin || video.ended) {
          finir();
          return;
        }
        if (avecFrames) {
          (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => void })
            .requestVideoFrameCallback(dessiner);
        } else {
          requestAnimationFrame(dessiner);
        }
      };
      dessiner();
    });

    const atteint = video.currentTime;
    const finiNaturellement = video.ended;
    video.pause();
    if (enregistreur.state === "recording") enregistreur.stop();
    await termine;
    for (const piste of flux.getTracks()) piste.stop();

    if (options.signal?.aborted) return { error: "Découpe interrompue." };
    if (panneEnregistreur) {
      return {
        error: `La découpe s'est interrompue (${panneEnregistreur}). Tu peux envoyer la vidéo entière.`,
      };
    }

    // AUCUN EXTRAIT TRONQUÉ NE PASSE POUR UNE RÉPONSE VALIDE.
    //
    // `video.ended` est le cas légitime d'un extrait plus court que demandé :
    // la borne de fin dépassait la durée réelle du fichier, on a donc tout
    // capturé. Hors de là, être en deçà de la borne veut dire que la lecture
    // s'est arrêtée en route — et rendre ce fichier reviendrait à proposer au
    // coach d'envoyer une vidéo amputée en croyant qu'elle est entière.
    if (!finiNaturellement && atteint + TOLERANCE_DECOUPE_S < fin) {
      return {
        error:
          `La découpe s'est arrêtée à ${atteint.toFixed(1)} s au lieu de ${fin.toFixed(1)} s — ` +
          "l'extrait serait incomplet. Reste sur cet onglet et réessaie, ou envoie la vidéo entière.",
      };
    }

    const mime = normaliser(type);
    if (!mime) return { error: "Format d'enregistrement inattendu." };
    const fichier = new Blob(morceaux, { type: mime });
    if (fichier.size === 0) return { error: "La découpe n'a rien produit. Réessaie sans changer d'onglet." };
    options.onProgression?.(1);
    return { fichier, mime };
  } catch (erreur) {
    return { error: `La découpe a échoué (${(erreur as Error).message}). Tu peux envoyer la vidéo entière.` };
  } finally {
    nettoyer();
  }
}

/** Lit la durée d'un fichier — même rôle qu'en F4, repris tel quel. */
export async function lireDureeVideo(fichier: Blob): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(fichier);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  try {
    return await new Promise<number | null>((resolve) => {
      const minuterie = setTimeout(() => resolve(null), 5000);
      const finir = (v: number | null) => {
        clearTimeout(minuterie);
        resolve(v);
      };
      video.onloadedmetadata = () => finir(Number.isFinite(video.duration) ? video.duration : null);
      video.onerror = () => finir(null);
      video.src = url;
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
