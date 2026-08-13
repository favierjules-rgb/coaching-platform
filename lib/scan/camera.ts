/**
 * LA CAMÉRA — INDÉPENDANTE DU DÉCODEUR (ALIMENTS A4, PHASE 2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE NE CONNAÎT AUCUN CODE-BARRES
 * ────────────────────────────────────────────────────────────────────────────
 * Ouvrir la bonne caméra, la garder ouverte, et surtout l'ÉTEINDRE, sont trois
 * problèmes entiers qui n'ont rien à voir avec le décodage. Les mélanger
 * donnerait un composant où l'oubli d'un `stop()` se cache derrière une boucle
 * de décodage — et une caméra qui reste allumée derrière une feuille fermée est
 * exactement le genre de défaut qu'un utilisateur remarque avant nous, par le
 * voyant de son téléphone.
 *
 * `mediaDevices` est INJECTABLE : c'est ce qui rend toutes les règles ci-dessous
 * éprouvables sans navigateur, sans caméra, et sans remplacer un objet global.
 *
 * Ce module est une FEUILLE : ni React, ni réseau, ni décodeur.
 */

/**
 * Les états, nommés — pas une soupe de booléens.
 *
 * Trois booléens indépendants donnent huit combinaisons, dont cinq n'existent
 * pas (« en train de démarrer ET permission refusée ») et qu'il faut pourtant
 * relire à chaque modification. Une union de chaînes rend ces cinq impossibles
 * à écrire.
 */
export type EtatCamera =
  | "inactif"
  | "demande_permission"
  | "demarrage"
  | "scan"
  | "detecte"
  | "permission_refusee"
  | "camera_indisponible"
  | "erreur";

/** Ce qui a empêché la caméra de s'ouvrir. Distingué, jamais fondu en « erreur ». */
export type MotifEchec =
  | "permission_refusee"
  | "aucune_camera"
  | "camera_occupee"
  | "contrainte_impossible"
  | "contexte_non_securise"
  | "inconnu";

/**
 * LA CONTRAINTE D'OUVERTURE — caméra ARRIÈRE, et c'est une exigence
 * fonctionnelle, pas une préférence.
 *
 * ⚠️ `ideal` et JAMAIS `exact`. `{ exact: "environment" }` lève
 * `OverconstrainedError` sur tout appareil sans caméra arrière — un Mac, un
 * iPad posé sur un support, certaines tablettes — et transformerait une
 * situation parfaitement gérable (« on prendra ce qu'il y a, et on le dira »)
 * en échec sec. `ideal` demande la caméra arrière EN PRIORITÉ et laisse le
 * système répondre au mieux.
 *
 * Aucune contrainte de résolution n'est imposée : sur-contraindre multiplie les
 * `OverconstrainedError` sans garantir un meilleur décodage, et le décodeur
 * travaille de toute façon sur une image redimensionnée.
 */
export const CONTRAINTE_ARRIERE: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" } },
  audio: false,
};

/** Seconde tentative, ciblée : une caméra précise, choisie par son identifiant. */
export function contrainteParPeripherique(deviceId: string): MediaStreamConstraints {
  return { video: { deviceId: { exact: deviceId } }, audio: false };
}

/**
 * Les dépendances du navigateur, réduites à ce qu'on utilise vraiment.
 * `mediaDevices` absent = contexte non sécurisé (HTTP) ou navigateur trop
 * ancien : les deux se traitent pareil, et se distinguent du refus.
 */
export interface DependancesCamera {
  readonly mediaDevices: {
    getUserMedia(contraintes: MediaStreamConstraints): Promise<MediaStream>;
    enumerateDevices?(): Promise<MediaDeviceInfo[]>;
  } | null;
}

export interface SessionCamera {
  readonly stream: MediaStream;
  /** Ce que le navigateur dit avoir réellement ouvert. `null` s'il ne le dit pas. */
  readonly facingModeObtenu: string | null;
  /** Vrai si une seconde acquisition ciblée a été nécessaire. Diagnostic. */
  readonly secondeTentative: boolean;
}

export type ResultatOuverture =
  | { readonly ok: true; readonly session: SessionCamera }
  | { readonly ok: false; readonly motif: MotifEchec };

/**
 * Traduit l'exception du navigateur en motif métier.
 *
 * Les noms viennent de la spécification `getUserMedia` et sont stables ; les
 * MESSAGES, eux, changent d'un navigateur à l'autre et d'une version à l'autre.
 * On lit donc `name`, jamais `message`.
 */
export function motifDepuisErreur(erreur: unknown): MotifEchec {
  const nom =
    typeof erreur === "object" && erreur !== null && "name" in erreur
      ? String((erreur as { name: unknown }).name)
      : "";
  switch (nom) {
    // `SecurityError` apparaît aussi quand la page n'est pas en HTTPS.
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "permission_refusee";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "aucune_camera";
    case "NotReadableError":
    case "TrackStartError":
      return "camera_occupee";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "contrainte_impossible";
    case "SecurityError":
      return "contexte_non_securise";
    default:
      return "inconnu";
  }
}

/** L'état d'écran correspondant à un motif — une seule table, pas deux `switch`. */
export function etatDepuisMotif(motif: MotifEchec): EtatCamera {
  if (motif === "permission_refusee") return "permission_refusee";
  if (motif === "aucune_camera" || motif === "camera_occupee") return "camera_indisponible";
  return "erreur";
}

/**
 * ARRÊTER LA CAMÉRA. Une seule fonction, appelée de partout.
 *
 * `getTracks()` et non `getVideoTracks()` : si une piste audio était demandée
 * par erreur un jour, elle serait arrêtée aussi. Le but n'est pas d'arrêter la
 * vidéo, c'est de rendre le matériel.
 *
 * IDEMPOTENTE, et ce n'est pas une politesse : elle est appelée depuis six
 * endroits (détection, bouton fermer, fermeture de la feuille, changement
 * d'écran, erreur critique, démontage) et plusieurs peuvent se déclencher dans
 * la même milliseconde. Un second appel doit être un non-événement, pas une
 * exception qui remonterait dans un `useEffect` de nettoyage.
 */
export function arreterCamera(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const piste of stream.getTracks()) {
    try {
      piste.stop();
    } catch {
      // Une piste déjà arrêtée, ou détachée : il n'y a rien à réparer, et
      // laisser filer l'exception empêcherait d'arrêter les pistes SUIVANTES.
    }
  }
}

/** Le `facingMode` réellement obtenu, quand le navigateur consent à le dire. */
export function facingModeDeLaSession(stream: MediaStream): string | null {
  const piste = stream.getVideoTracks()[0];
  if (!piste || typeof piste.getSettings !== "function") return null;
  const réglages = piste.getSettings() as { facingMode?: string };
  return réglages.facingMode ?? null;
}

/**
 * Une caméra ARRIÈRE identifiable parmi celles que le navigateur expose.
 *
 * ⚠️ `enumerateDevices()` ne rend des `label` et des `deviceId` utilisables
 * QU'APRÈS une autorisation accordée : avant, tout est vide, par conception —
 * sinon la liste des caméras serait une empreinte de plus pour pister un
 * visiteur. C'est pour cela que la sélection fine ne peut être qu'un SECOND
 * temps, jamais le premier.
 *
 * Les libellés ne sont pas normalisés (« Back Camera » sur iOS, « camera2 0,
 * facing back » sur Android) : on cherche donc plusieurs formes, et on accepte
 * de ne rien trouver.
 */
export function trouverCameraArriere(
  peripheriques: readonly MediaDeviceInfo[],
): MediaDeviceInfo | null {
  const caméras = peripheriques.filter((p) => p.kind === "videoinput");
  const arrière = caméras.find((p) => /back|rear|arrière|arriere|environment/i.test(p.label));
  return arrière ?? null;
}

/**
 * OUVRIR LA CAMÉRA ARRIÈRE.
 *
 * Appelée UNIQUEMENT après un tap explicite de l'élève — jamais au montage
 * d'un composant, jamais au chargement d'une page. Ce module ne peut pas le
 * garantir seul ; l'appelant doit le tenir, et le harnais A4-SCAN1 le mesure
 * en comptant les appels.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA SECONDE ACQUISITION, ET SA LIMITE
 * ────────────────────────────────────────────────────────────────────────────
 * Si le navigateur a ouvert la caméra FRONTALE malgré `ideal: environment`, et
 * qu'une caméra arrière est identifiable, on retente UNE fois par `deviceId`.
 * Une seule : une boucle de bascule entre deux caméras est un scintillement à
 * l'écran, une consommation inutile, et un bug qui ne se voit qu'en production.
 *
 * Si cette seconde tentative échoue, on GARDE la première session plutôt que de
 * ne rien rendre : une caméra frontale reste préférable à un écran noir, et
 * l'appelant sait — par `facingModeObtenu` — qu'il doit le signaler.
 */
export async function ouvrirCameraArriere(
  deps: DependancesCamera,
): Promise<ResultatOuverture> {
  if (!deps.mediaDevices) {
    // Ni refus ni panne : la page n'est pas servie dans un contexte sécurisé,
    // ou le navigateur ne connaît pas l'API. Le message doit le dire.
    return { ok: false, motif: "contexte_non_securise" };
  }

  let stream: MediaStream;
  try {
    stream = await deps.mediaDevices.getUserMedia(CONTRAINTE_ARRIERE);
  } catch (erreur) {
    return { ok: false, motif: motifDepuisErreur(erreur) };
  }

  const facing = facingModeDeLaSession(stream);
  // `environment`, ou un navigateur qui ne dit rien : dans les deux cas on ne
  // touche à rien. Ne pas savoir n'est pas une raison de rouvrir la caméra.
  if (facing !== "user" || !deps.mediaDevices.enumerateDevices) {
    return { ok: true, session: { stream, facingModeObtenu: facing, secondeTentative: false } };
  }

  let arrière: MediaDeviceInfo | null = null;
  try {
    arrière = trouverCameraArriere(await deps.mediaDevices.enumerateDevices());
  } catch {
    arrière = null;
  }
  if (!arrière) {
    return { ok: true, session: { stream, facingModeObtenu: facing, secondeTentative: false } };
  }

  try {
    const ciblé = await deps.mediaDevices.getUserMedia(contrainteParPeripherique(arrière.deviceId));
    // La PREMIÈRE session est arrêtée AVANT d'être remplacée : sans cela, deux
    // flux resteraient ouverts et le téléphone garderait sa caméra allumée.
    arreterCamera(stream);
    return {
      ok: true,
      session: {
        stream: ciblé,
        facingModeObtenu: facingModeDeLaSession(ciblé),
        secondeTentative: true,
      },
    };
  } catch {
    // La caméra ciblée n'a pas voulu s'ouvrir : on garde celle qu'on a.
    return { ok: true, session: { stream, facingModeObtenu: facing, secondeTentative: false } };
  }
}

/**
 * La torche est-elle RÉELLEMENT disponible sur cette piste ?
 *
 * Elle l'est sur iOS depuis 17.5 (WebKit bug 243075, résolu) et sur Chrome
 * Android — mais « la plateforme le supporte » ne veut pas dire « cet appareil
 * l'expose ». On interroge donc la piste obtenue, et on n'affiche un bouton
 * lampe que si elle répond oui. Un bouton qui ne fait rien est pire que pas de
 * bouton : il fait douter de tout le reste de l'écran.
 */
export function torcheDisponible(stream: MediaStream): boolean {
  const piste = stream.getVideoTracks()[0];
  if (!piste || typeof piste.getCapabilities !== "function") return false;
  const capacités = piste.getCapabilities() as { torch?: boolean };
  return capacités.torch === true;
}

/**
 * Allume ou éteint la torche.
 *
 * ⚠️ `torch` n'est pas dans le type `MediaTrackConstraintSet` de TypeScript : il
 * vit dans le registre des contraintes d'image, que la définition standard ne
 * couvre pas. Le `as never` est donc une vérité sur l'API, pas un contournement
 * du typage — et il est confiné à cette ligne plutôt que dispersé dans l'écran.
 *
 * Rend `false` sans rien casser si la piste refuse : sur certains appareils,
 * `torch` est ANNONCÉ mais `applyConstraints` échoue quand même. Le scanner ne
 * doit jamais dépendre de la lampe — une lampe qui refuse de s'allumer n'est pas
 * une raison d'interrompre un scan qui marche.
 */
export async function basculerTorche(
  stream: MediaStream | null | undefined,
  allumee: boolean,
): Promise<boolean> {
  if (!stream) return false;
  const piste = stream.getVideoTracks()[0];
  if (!piste || typeof piste.applyConstraints !== "function") return false;
  try {
    await piste.applyConstraints({ advanced: [{ torch: allumee }] } as never);
    return true;
  } catch {
    return false;
  }
}
