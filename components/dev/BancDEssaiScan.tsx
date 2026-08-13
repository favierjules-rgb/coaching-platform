"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type EtatCamera,
  type MotifEchec,
  arreterCamera,
  etatDepuisMotif,
  ouvrirCameraArriere,
  torcheDisponible,
} from "@/lib/scan/camera";
import {
  CADENCE_PAR_SECONDE,
  INTERVALLE_MS,
  MOTEURS,
  type EtatBoucle,
  type MoteurScan,
  type NomMoteur,
  nouvelEtatBoucle,
  tenterUneImage,
} from "@/lib/scan/moteur";

/**
 * BANC D'ESSAI — TEMPORAIRE (ALIMENTS A4, PHASE 2).
 *
 * Il mesure, il n'ajoute rien au journal alimentaire : aucun appel à
 * `/api/food-products`, aucune RPC, aucune écriture. Le GTIN lu est AFFICHÉ,
 * puis oublié. C'est délibéré — on compare deux décodeurs, pas un pipeline
 * dont la phase 3 a déjà prouvé le comportement.
 *
 * Les messages sont en clair et techniques : c'est un outil de développement,
 * pas un écran d'élève.
 */

const MESSAGES_ECHEC: Readonly<Record<MotifEchec, string>> = {
  permission_refusee: "Accès à la caméra refusé.",
  aucune_camera: "Aucune caméra détectée sur cet appareil.",
  camera_occupee: "La caméra est déjà utilisée par une autre application.",
  contrainte_impossible: "Contrainte caméra impossible à satisfaire.",
  contexte_non_securise: "Contexte non sécurisé : le scanner exige HTTPS.",
  inconnu: "Erreur caméra inattendue.",
};

interface Mesures {
  moteur: NomMoteur;
  msChargementMoteur: number | null;
  msCameraPrete: number | null;
  msPremierCode: number | null;
  format: string | null;
  gtin: string | null;
  facingMode: string | null;
  secondeTentative: boolean;
  torche: boolean;
  tentatives: number;
  lecturesRejetees: number;
}

function mesuresVierges(moteur: NomMoteur): Mesures {
  return {
    moteur,
    msChargementMoteur: null,
    msCameraPrete: null,
    msPremierCode: null,
    format: null,
    gtin: null,
    facingMode: null,
    secondeTentative: false,
    torche: false,
    tentatives: 0,
    lecturesRejetees: 0,
  };
}

export function BancDEssaiScan() {
  const [moteurChoisi, setMoteurChoisi] = useState<NomMoteur>("zxing-wasm");
  const [etat, setEtat] = useState<EtatCamera>("inactif");
  const [message, setMessage] = useState<string | null>(null);
  const [mesures, setMesures] = useState<Mesures>(() => mesuresVierges("zxing-wasm"));

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const moteurRef = useRef<MoteurScan | null>(null);
  const boucleRef = useRef<EtatBoucle>(nouvelEtatBoucle());
  const minuterieRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * TOUT ARRÊTER. Idempotente, et appelée de partout — c'est la fonction dont
   * l'oubli laisserait la caméra allumée derrière l'écran.
   */
  const toutArreter = useCallback(() => {
    if (minuterieRef.current !== null) {
      clearInterval(minuterieRef.current);
      minuterieRef.current = null;
    }
    arreterCamera(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    void moteurRef.current?.detruire();
    moteurRef.current = null;
  }, []);

  // DÉMONTAGE : le nettoyage n'est pas optionnel. Sans lui, quitter la page
  // laisserait la caméra ouverte jusqu'au rechargement de l'onglet.
  useEffect(() => () => toutArreter(), [toutArreter]);

  async function demarrer() {
    if (etat === "demande_permission" || etat === "demarrage" || etat === "scan") return;
    const m = mesuresVierges(moteurChoisi);
    setMesures(m);
    setMessage(null);
    boucleRef.current = nouvelEtatBoucle();

    // 1. Le moteur d'abord : il se charge pendant que l'élève lit la demande
    //    de permission, pas après.
    setEtat("demarrage");
    const t0 = performance.now();
    try {
      const { FABRIQUES } = await import("@/lib/scan/adaptateurs");
      const moteur = await FABRIQUES[moteurChoisi]();
      await moteur.initialiser();
      moteurRef.current = moteur;
      m.msChargementMoteur = Math.round(performance.now() - t0);
      setMesures({ ...m });
    } catch (e) {
      setEtat("erreur");
      setMessage(`Chargement du moteur impossible : ${(e as Error).message}`);
      return;
    }

    // 2. La caméra, seulement maintenant, et seulement parce que l'utilisateur
    //    a tapé sur le bouton.
    setEtat("demande_permission");
    const t1 = performance.now();
    const résultat = await ouvrirCameraArriere({
      mediaDevices:
        typeof navigator !== "undefined" && navigator.mediaDevices
          ? navigator.mediaDevices
          : null,
    });
    if (!résultat.ok) {
      setEtat(etatDepuisMotif(résultat.motif));
      setMessage(MESSAGES_ECHEC[résultat.motif]);
      toutArreter();
      return;
    }

    streamRef.current = résultat.session.stream;
    m.msCameraPrete = Math.round(performance.now() - t1);
    m.facingMode = résultat.session.facingModeObtenu;
    m.secondeTentative = résultat.session.secondeTentative;
    m.torche = torcheDisponible(résultat.session.stream);
    setMesures({ ...m });

    const video = videoRef.current;
    if (!video) {
      toutArreter();
      setEtat("erreur");
      return;
    }
    video.srcObject = résultat.session.stream;
    try {
      await video.play();
    } catch {
      // Sur iOS, `play()` peut être rejeté si l'élément n'a pas `playsInline`
      // et `muted` : les deux sont posés sur la balise, ci-dessous.
    }

    setEtat("scan");
    const t2 = performance.now();

    // 3. La cadence. Pas 60 images par seconde : le téléphone chaufferait sans
    //    rien décoder de plus, un code-barres ne bougeant pas en 33 ms.
    minuterieRef.current = setInterval(() => {
      void (async () => {
        const moteur = moteurRef.current;
        const canvas = canvasRef.current;
        if (!moteur || !canvas || !video.videoWidth) return;

        const contexte = canvas.getContext("2d", { willReadFrequently: true });
        if (!contexte) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        contexte.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = contexte.getImageData(0, 0, canvas.width, canvas.height);

        const issue = await tenterUneImage(boucleRef.current, moteur, image);
        if (issue.type === "gtin") {
          // VERROU déjà posé par `tenterUneImage`. On arrête tout AVANT de
          // toucher à l'affichage : entre les deux, une image peut arriver.
          toutArreter();
          setEtat("detecte");
          setMesures((précédent) => ({
            ...précédent,
            msPremierCode: Math.round(performance.now() - t2),
            gtin: issue.gtin,
            format: issue.format,
            tentatives: boucleRef.current.tentatives,
            lecturesRejetees: boucleRef.current.lecturesRejetees,
          }));
        } else if (issue.type === "lecture_rejetee" || issue.type === "rien_lu") {
          setMesures((précédent) => ({
            ...précédent,
            tentatives: boucleRef.current.tentatives,
            lecturesRejetees: boucleRef.current.lecturesRejetees,
          }));
        }
      })();
    }, INTERVALLE_MS);
  }

  const enCours = etat === "demande_permission" || etat === "demarrage" || etat === "scan";

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-5">
      <header>
        <h1 className="font-heading text-lg font-bold uppercase">Banc d&apos;essai scanner</h1>
        <p className="text-xs text-muted-foreground">
          A4 phase 2 — outil temporaire. Aucun aliment n&apos;est ajouté au journal.
        </p>
      </header>

      <div role="group" aria-label="Moteur" className="flex gap-2">
        {MOTEURS.map((nom) => (
          <button
            key={nom}
            type="button"
            onClick={() => {
              toutArreter();
              setEtat("inactif");
              setMoteurChoisi(nom);
              setMesures(mesuresVierges(nom));
            }}
            aria-pressed={moteurChoisi === nom}
            className={`min-h-[48px] flex-1 rounded-control border px-3 text-sm ${
              moteurChoisi === nom
                ? "border-primary bg-primary/10 font-bold"
                : "border-border text-muted-foreground"
            }`}
          >
            {nom}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void demarrer()}
        disabled={enCours}
        className="min-h-[48px] rounded-control bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
      >
        {enCours ? "Caméra en cours…" : "Ouvrir la caméra"}
      </button>
      <button
        type="button"
        onClick={() => {
          toutArreter();
          setEtat("inactif");
        }}
        className="min-h-[48px] rounded-control border border-border py-3 text-xs uppercase tracking-widest"
      >
        Fermer la caméra
      </button>

      {message && (
        <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {message}
        </p>
      )}

      {/* `playsInline` et `muted` sont OBLIGATOIRES sur iOS : sans eux, Safari
          bascule en lecture plein écran et le cadrage devient impossible. */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="w-full rounded-panel border border-border bg-black"
      />
      <canvas ref={canvasRef} className="hidden" />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-panel border border-border p-4 text-xs tabular-nums">
        <dt className="text-muted-foreground">État</dt>
        <dd>{etat}</dd>
        <dt className="text-muted-foreground">Moteur</dt>
        <dd>{mesures.moteur}</dd>
        <dt className="text-muted-foreground">Chargement moteur</dt>
        <dd>{mesures.msChargementMoteur === null ? "—" : `${mesures.msChargementMoteur} ms`}</dd>
        <dt className="text-muted-foreground">Caméra prête</dt>
        <dd>{mesures.msCameraPrete === null ? "—" : `${mesures.msCameraPrete} ms`}</dd>
        <dt className="text-muted-foreground">Premier code valide</dt>
        <dd>{mesures.msPremierCode === null ? "—" : `${mesures.msPremierCode} ms`}</dd>
        <dt className="text-muted-foreground">Format</dt>
        <dd>{mesures.format ?? "—"}</dd>
        <dt className="text-muted-foreground">GTIN</dt>
        <dd className="font-mono">{mesures.gtin ?? "—"}</dd>
        <dt className="text-muted-foreground">facingMode obtenu</dt>
        <dd>{mesures.facingMode ?? "non exposé"}</dd>
        <dt className="text-muted-foreground">2ᵉ acquisition</dt>
        <dd>{mesures.secondeTentative ? "oui" : "non"}</dd>
        <dt className="text-muted-foreground">Torche exposée</dt>
        <dd>{mesures.torche ? "oui" : "non"}</dd>
        <dt className="text-muted-foreground">Images décodées</dt>
        <dd>
          {mesures.tentatives} (cadence {CADENCE_PAR_SECONDE}/s)
        </dd>
        <dt className="text-muted-foreground">Lectures rejetées</dt>
        <dd>{mesures.lecturesRejetees}</dd>
      </dl>
    </main>
  );
}
