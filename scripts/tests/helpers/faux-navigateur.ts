/**
 * UN NAVIGATEUR DE PACOTILLE — juste assez pour faire tourner la découpe.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE QUE CE DOUBLE PROUVE, ET CE QU'IL NE PROUVE PAS
 * ────────────────────────────────────────────────────────────────────────
 * Il ne décode rien, n'encode rien, et ne dit RIEN de ce que Safari ou
 * Chrome feront d'un fichier réel. Prétendre le contraire serait pire que de
 * ne pas tester du tout.
 *
 * Ce qu'il prouve, c'est le FLOT DE CONTRÔLE de `decouperVideo` — c'est-à-dire
 * exactement ce qui a été corrigé :
 *   • une vidéo qui cale ne peut pas faire tourner l'écran indéfiniment ;
 *   • une panne de `MediaRecorder` ne rend pas un fichier partiel pour bon ;
 *   • un extrait tronqué est REFUSÉ, jamais proposé à l'envoi ;
 *   • une interruption rend une erreur, pas un demi-fichier ;
 *   • « aucune découpe » ne réencode rien.
 *
 * Aucune de ces cinq propriétés ne dépend du codec. Toutes dépendaient d'un
 * rappel de frame qui pouvait ne jamais arriver.
 *
 * Les globales sont posées puis RETIRÉES par `restaurer()` : une suite de
 * tests qui laisse un `MediaRecorder` derrière elle contamine tout ce qui
 * suit.
 */

export type ScenarioDecoupe =
  /** Lecture normale jusqu'à la borne de fin. */
  | { genre: "normal" }
  /** La vidéo se termine avant la borne demandée : extrait légitimement court. */
  | { genre: "fin_precoce"; aLaSeconde: number }
  /** Plus aucune image décodée, et AUCUNE erreur : le cas qui figeait l'écran. */
  | { genre: "bloque"; aLaSeconde: number }
  /** La lecture s'arrête net avec une erreur de décodage. */
  | { genre: "erreur_lecture"; aLaSeconde: number }
  /** `MediaRecorder` tombe en panne en cours de route. */
  | { genre: "panne_enregistreur"; aLaSeconde: number };

export interface OptionsFauxNavigateur {
  scenario: ScenarioDecoupe;
  /** Durée de la source, en secondes. */
  duree: number;
  /**
   * Expose `requestVideoFrameCallback` sur l'élément vidéo. C'est le chemin
   * NOMINAL des navigateurs modernes, et le plus traître : quand plus aucune
   * image n'est décodée, le rappel n'arrive jamais — pas même pour constater
   * une interruption.
   */
  avecRvfc?: boolean;
  /** Types que `MediaRecorder.isTypeSupported` accepte. */
  typesAcceptes?: string[];
  /** Secondes de vidéo gagnées à chaque tick d'animation. */
  pasParTick?: number;
}

export interface FauxNavigateur {
  restaurer: () => void;
  /** Nombre de fragments réellement produits — un extrait vide n'en a aucun. */
  fragments: () => number;
}

type Globale = Record<string, unknown>;

export function installerFauxNavigateur(options: OptionsFauxNavigateur): FauxNavigateur {
  const g = globalThis as unknown as Globale;
  const avant = new Map<string, unknown>();
  const poser = (nom: string, valeur: unknown) => {
    avant.set(nom, g[nom]);
    g[nom] = valeur;
  };

  const pas = options.pasParTick ?? 0.05;
  const types = options.typesAcceptes ?? ["video/mp4"];
  let fragments = 0;

  /* ── L'élément vidéo ──────────────────────────────────────────────── */
  const fauxVideo: Globale = {
    src: "",
    playsInline: false,
    muted: false,
    currentTime: 0,
    videoWidth: 1280,
    videoHeight: 720,
    duration: options.duree,
    ended: false,
    error: null,
    paused: true,
    onloadedmetadata: null,
    onerror: null,
    onseeked: null,
    play() {
      fauxVideo.paused = false;
      return Promise.resolve();
    },
    pause() {
      fauxVideo.paused = true;
    },
    removeAttribute() {},
    load() {},
  };

  /**
   * Avance la lecture d'un pas, et applique le scénario. Rend `false` quand
   * plus aucune image ne sera décodée — c'est ce que `requestVideoFrameCallback`
   * traduit par « je ne te rappellerai plus ».
   */
  function avancer(): boolean {
    const t = fauxVideo.currentTime as number;
    const s = options.scenario;
    if (s.genre !== "normal" && t >= s.aLaSeconde) {
      if (s.genre === "fin_precoce") {
        fauxVideo.ended = true;
        return false;
      }
      if (s.genre === "erreur_lecture") {
        fauxVideo.error = { code: 3, message: "décodage impossible" };
        return false;
      }
      // « bloque » et « panne_enregistreur » : le temps ne bouge plus, et
      // rien ne signale quoi que ce soit.
      return false;
    }
    const suivant = Math.min(t + pas, options.duree);
    fauxVideo.currentTime = suivant;
    if (suivant >= options.duree) fauxVideo.ended = true;
    return true;
  }

  if (options.avecRvfc) {
    fauxVideo.requestVideoFrameCallback = (rappel: () => void) => {
      setTimeout(() => {
        // Aucune image décodée ⇒ AUCUN rappel. Jamais.
        if (avancer()) rappel();
      }, 0);
    };
  }

  /* ── Canvas et contexte ───────────────────────────────────────────── */
  const contexte: Globale = {
    imageSmoothingQuality: "low",
    drawImage() {},
    save() {},
    restore() {},
    setLineDash() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    stroke() {},
    fillText() {},
    strokeText() {},
    clearRect() {},
    setTransform() {},
  };
  const fauxCanvas: Globale = {
    width: 0,
    height: 0,
    getContext: () => contexte,
    captureStream: () => ({ getVideoTracks: () => [{ stop() {} }] }),
  };

  poser("document", {
    createElement: (nom: string) => (nom === "canvas" ? fauxCanvas : fauxVideo),
  });

  /* ── Audio ────────────────────────────────────────────────────────── */
  class FauxAudioContext {
    state = "running";
    async resume() {
      this.state = "running";
    }
    createMediaElementSource() {
      return { connect() {} };
    }
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [{ stop() {} }] } };
    }
    async close() {}
  }

  /* ── L'enregistreur ───────────────────────────────────────────────── */
  class FauxMediaRecorder {
    static isTypeSupported = (t: string) => types.includes(t);
    state = "inactive";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    private minuterie: ReturnType<typeof setInterval> | null = null;

    // Le flux et les options ne sont pas relus : ce double prouve le FLOT DE
    // CONTRÔLE, pas ce que contient le fichier.
    constructor() {}

    start() {
      this.state = "recording";
      // Un fragment par tranche, comme un vrai enregistreur — c'est ce qui
      // rend un résultat PARTIEL possible, et donc testable.
      this.minuterie = setInterval(() => {
        const s = options.scenario;
        if (s.genre === "panne_enregistreur" && (fauxVideo.currentTime as number) >= s.aLaSeconde) {
          this.state = "inactive";
          if (this.minuterie) clearInterval(this.minuterie);
          this.onerror?.({ error: { message: "encodage impossible" } });
          return;
        }
        fragments += 1;
        this.ondataavailable?.({ data: new Blob(["x"]) });
      }, 5);
    }

    stop() {
      this.state = "inactive";
      if (this.minuterie) clearInterval(this.minuterie);
      setTimeout(() => this.onstop?.(), 0);
    }
  }

  poser("MediaRecorder", FauxMediaRecorder);
  // `decouperVideo` compose une piste vidéo et une piste audio en UN flux,
  // puis arrête chaque piste à la fin. Le double doit donc les rendre.
  poser(
    "MediaStream",
    class {
      private pistes: { stop: () => void }[];
      constructor(pistes: { stop: () => void }[] = []) {
        this.pistes = pistes;
      }
      getTracks() {
        return this.pistes;
      }
    },
  );
  poser("window", {
    AudioContext: FauxAudioContext,
    devicePixelRatio: 1,
    isSecureContext: true,
  });
  poser("URL", {
    createObjectURL: () => "blob:faux",
    revokeObjectURL: () => {},
  });
  poser("requestAnimationFrame", (rappel: () => void) => {
    // Contrairement à `requestVideoFrameCallback`, il rappelle TOUJOURS :
    // c'est un battement d'écran, pas un battement de décodeur.
    return setTimeout(() => {
      avancer();
      rappel();
    }, 0) as unknown as number;
  });
  poser("cancelAnimationFrame", (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));

  // `onloadedmetadata` et `onseeked` sont posés PAR `decouperVideo`, après
  // l'installation de ce double. On les relance donc en boucle plutôt qu'une
  // fois : déclencher trop tôt laisserait la promesse pendante jusqu'à son
  // propre délai d'attente, et le test échouerait pour une raison qui
  // n'existe pas.
  const interval = setInterval(() => {
    (fauxVideo.onloadedmetadata as (() => void) | null)?.();
    (fauxVideo.onseeked as (() => void) | null)?.();
  }, 1);

  return {
    restaurer() {
      clearInterval(interval);
      for (const [nom, valeur] of avant) {
        if (valeur === undefined) delete g[nom];
        else g[nom] = valeur;
      }
    },
    fragments: () => fragments,
  };
}
