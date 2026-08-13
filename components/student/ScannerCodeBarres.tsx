"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Flashlight, X } from "lucide-react";

import {
  type EtatCamera,
  type MotifEchec,
  arreterCamera,
  basculerTorche,
  etatDepuisMotif,
  ouvrirCameraArriere,
  torcheDisponible,
} from "@/lib/scan/camera";
import {
  INTERVALLE_MS,
  type MoteurScan,
  type EtatBoucle,
  nouvelEtatBoucle,
  tenterUneImage,
} from "@/lib/scan/moteur";
import { LIBELLE_ACTION, MESSAGE_CAMERA, actionsPourCamera } from "@/lib/scan/parcours";

/**
 * LE SCANNER DE CODE-BARRES — L'ÉCRAN RÉEL (ALIMENTS A4, PHASE 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE COMPOSANT NE MONTRE JAMAIS
 * ────────────────────────────────────────────────────────────────────────────
 * Ni le nom du moteur, ni les images par seconde, ni le nombre d'images
 * décodées, ni le `facingMode` obtenu, ni le temps de chargement, ni même le
 * GTIN lu. Le banc d'essai de la phase 2 affichait tout cela et il a été
 * SUPPRIMÉ avec sa page : c'étaient des chiffres pour départager deux
 * bibliothèques, pas pour quelqu'un debout dans un rayon de supermarché.
 *
 * Ce qu'il montre : une image, un cadre, et deux boutons.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE SAIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Ce qu'est un produit, ce qu'est Open Food Facts, ce qu'est une macro. Il rend
 * une CHAÎNE de chiffres à son appelant, une seule fois, après avoir tout
 * éteint. Le reste appartient à A3.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX TAPS AVANT LA CAMÉRA, ET C'EST VOULU
 * ────────────────────────────────────────────────────────────────────────────
 * Ouvrir cet écran ne demande RIEN. La permission n'est demandée qu'au tap sur
 * « Ouvrir la caméra ». On aurait pu interroger `navigator.permissions` pour
 * ouvrir tout seul quand l'autorisation est déjà accordée — Safari ne répond pas
 * pour la caméra, la branche ne serait donc vraie que sur une partie des
 * appareils, et surtout elle serait invérifiable par nos harnais. Un tap de plus,
 * toujours le même comportement, et une garantie qui se prouve.
 */

export function ScannerCodeBarres({
  onGtin,
  onFermer,
  onRechercheParNom,
  onSaisieManuelle,
}: {
  /** Appelé UNE fois, avec la caméra DÉJÀ éteinte. */
  onGtin: (gtin: string) => void;
  onFermer: () => void;
  onRechercheParNom: () => void;
  onSaisieManuelle: () => void;
}) {
  const [état, setÉtat] = useState<EtatCamera>("inactif");
  const [motif, setMotif] = useState<MotifEchec | null>(null);
  const [torcheOfferte, setTorcheOfferte] = useState(false);
  const [torcheAllumée, setTorcheAllumée] = useState(false);

  const vidéoRef = useRef<HTMLVideoElement | null>(null);
  const toileRef = useRef<HTMLCanvasElement | null>(null);
  const fluxRef = useRef<MediaStream | null>(null);
  const moteurRef = useRef<MoteurScan | null>(null);
  const boucleRef = useRef<EtatBoucle>(nouvelEtatBoucle());
  const minuterieRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Garde de double ouverture : deux taps très rapprochés partiraient tous deux. */
  const ouvertureRef = useRef(false);

  /**
   * TOUT ARRÊTER. Idempotente, et appelée de partout — c'est la fonction dont
   * l'oubli laisserait la caméra allumée derrière une feuille fermée, avec le
   * voyant du téléphone toujours vert.
   *
   * L'ordre compte : la minuterie D'ABORD. L'arrêter après avoir rendu le flux
   * laisserait passer un dernier tour de boucle sur une piste morte.
   */
  const toutArrêter = useCallback(() => {
    if (minuterieRef.current !== null) {
      clearInterval(minuterieRef.current);
      minuterieRef.current = null;
    }
    arreterCamera(fluxRef.current);
    fluxRef.current = null;
    if (vidéoRef.current) vidéoRef.current.srcObject = null;
    void moteurRef.current?.detruire();
    moteurRef.current = null;
    setTorcheOfferte(false);
    setTorcheAllumée(false);
  }, []);

  // DÉMONTAGE. Ce composant est monté et démonté par la feuille d'ajout : ce
  // nettoyage est ce qui garantit qu'aucune fermeture — bouton, retour, ou
  // fermeture de la feuille entière — ne laisse la caméra ouverte.
  useEffect(() => () => toutArrêter(), [toutArrêter]);

  async function ouvrir() {
    if (ouvertureRef.current) return;
    ouvertureRef.current = true;
    setMotif(null);
    boucleRef.current = nouvelEtatBoucle();

    try {
      // 1. LE MOTEUR D'ABORD. Il se charge pendant que l'élève lit la demande
      //    de permission, pas après — sinon la première image attendrait un
      //    mégaoctet de WebAssembly, et l'écran paraîtrait figé.
      setÉtat("demarrage");
      try {
        const { fabriquerMoteurWasm } = await import("@/lib/scan/adaptateurs");
        const moteur = await fabriquerMoteurWasm();
        await moteur.initialiser();
        moteurRef.current = moteur;
      } catch {
        setÉtat("erreur");
        setMotif("inconnu");
        toutArrêter();
        return;
      }

      // 2. LA CAMÉRA, seulement maintenant, et seulement parce que l'élève a
      //    tapé sur le bouton.
      setÉtat("demande_permission");
      const résultat = await ouvrirCameraArriere({
        mediaDevices:
          typeof navigator !== "undefined" && navigator.mediaDevices
            ? navigator.mediaDevices
            : null,
      });
      if (!résultat.ok) {
        setÉtat(etatDepuisMotif(résultat.motif));
        setMotif(résultat.motif);
        toutArrêter();
        return;
      }

      fluxRef.current = résultat.session.stream;
      setTorcheOfferte(torcheDisponible(résultat.session.stream));

      const vidéo = vidéoRef.current;
      if (!vidéo) {
        toutArrêter();
        setÉtat("erreur");
        setMotif("inconnu");
        return;
      }
      vidéo.srcObject = résultat.session.stream;
      try {
        await vidéo.play();
      } catch {
        // Sur iOS, `play()` est rejeté si l'élément n'a pas `playsInline` et
        // `muted` : les deux sont posés sur la balise. Un rejet résiduel ne
        // justifie pas d'abandonner — l'image arrive souvent quand même.
      }

      setÉtat("scan");

      // 3. LA CADENCE. Pas une image sur soixante : le téléphone chaufferait
      //    sans rien décoder de plus, un code-barres ne bougeant pas en 33 ms.
      minuterieRef.current = setInterval(() => {
        void (async () => {
          const moteur = moteurRef.current;
          const toile = toileRef.current;
          if (!moteur || !toile || !vidéo.videoWidth) return;

          const contexte = toile.getContext("2d", { willReadFrequently: true });
          if (!contexte) return;
          toile.width = vidéo.videoWidth;
          toile.height = vidéo.videoHeight;
          contexte.drawImage(vidéo, 0, 0, toile.width, toile.height);
          // ⚠️ L'IMAGE NE QUITTE JAMAIS L'APPAREIL. Elle est lue en mémoire,
          // décodée sur place, puis oubliée. Aucun `toDataURL`, aucun `toBlob`,
          // aucun envoi : ce qui remonte est une suite de chiffres.
          const image = contexte.getImageData(0, 0, toile.width, toile.height);

          const issue = await tenterUneImage(boucleRef.current, moteur, image);
          if (issue.type !== "gtin") return;

          // LE VERROU est déjà posé par `tenterUneImage`. On éteint TOUT avant
          // de prévenir l'appelant : un code reste visible une vingtaine
          // d'images, et sans cela ce seraient vingt lookups.
          toutArrêter();
          setÉtat("detecte");
          onGtin(issue.gtin);
        })();
      }, INTERVALLE_MS);
    } finally {
      ouvertureRef.current = false;
    }
  }

  function fermer() {
    toutArrêter();
    setÉtat("inactif");
    onFermer();
  }

  async function inverserTorche() {
    const voulue = !torcheAllumée;
    const acceptée = await basculerTorche(fluxRef.current, voulue);
    // Si la piste refuse, l'état N'EST PAS modifié : un bouton qui s'allume
    // alors que la lampe reste éteinte ferait douter de tout le reste.
    if (acceptée) setTorcheAllumée(voulue);
  }

  const échec =
    état === "permission_refusee" || état === "camera_indisponible" || état === "erreur";
  const enCours = état === "demarrage" || état === "demande_permission";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Scanner un code-barres
        </h4>
        <button
          type="button"
          onClick={fermer}
          className="-mt-1 flex h-9 items-center gap-1.5 rounded-control px-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X size={14} />
          Fermer
        </button>
      </div>

      {état === "inactif" && (
        <>
          <p className="rounded-panel border border-border bg-surface-soft/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Vise le code-barres au dos de l&apos;emballage. La caméra ne s&apos;ouvre qu&apos;à ta
            demande, et l&apos;image reste sur ton téléphone.
          </p>
          <button
            type="button"
            onClick={() => void ouvrir()}
            className="pressable inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-control bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Camera size={14} />
            Ouvrir la caméra
          </button>
        </>
      )}

      {/* LA VUE CAMÉRA. `hidden` plutôt que démontée : l'élément `<video>` doit
          exister AVANT que le flux ne lui soit attaché, sans quoi
          `srcObject` s'appliquerait à rien. */}
      <div className={enCours || état === "scan" || état === "detecte" ? "" : "hidden"}>
        <div className="relative w-full overflow-hidden rounded-panel border border-border bg-black">
          <video
            ref={vidéoRef}
            muted
            playsInline
            autoPlay
            aria-label="Aperçu de la caméra"
            className="block max-h-[52vh] w-full object-cover"
          />
          {/* LE CADRE DE VISÉE — VISUEL, et seulement visuel. Il n'est pas
              recadré côté décodeur : le benchmark iPhone a lu les codes en
              plein cadre, et rogner l'image avant de décoder ferait perdre les
              codes légèrement décalés sans rien accélérer de démontré.
              Il sert à ce qu'un cadre sert : centrer, garder la bonne
              distance, tenir le téléphone tranquille.
              `pointer-events-none` : il ne doit rien intercepter. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6"
          >
            <div className="h-[22%] max-h-28 w-[82%] rounded-[10px] border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground" role="status">
          {enCours ? "Démarrage de la caméra…" : "Place le code-barres dans le cadre."}
        </p>

        {/* LA LAMPE — seulement si la piste l'expose VRAIMENT. Un bouton qui ne
            fait rien est pire que pas de bouton : il fait douter du reste. */}
        {torcheOfferte && état === "scan" && (
          <button
            type="button"
            onClick={() => void inverserTorche()}
            aria-pressed={torcheAllumée}
            className={`pressable mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-control border py-3 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              torcheAllumée
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Flashlight size={14} />
            {torcheAllumée ? "Éteindre la lampe" : "Allumer la lampe"}
          </button>
        )}
      </div>

      {échec && motif && (
        <div className="flex flex-col gap-3">
          <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {MESSAGE_CAMERA[motif]}
          </p>
          {/* JAMAIS DE CUL-DE-SAC. Même sans caméra, l'élève peut toujours
              chercher son aliment ou le saisir depuis l'emballage. */}
          {actionsPourCamera(motif).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                if (action === "reessayer") void ouvrir();
                else if (action === "recherche") onRechercheParNom();
                else onSaisieManuelle();
              }}
              className="pressable inline-flex min-h-[48px] w-full items-center justify-center rounded-control border border-border py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {LIBELLE_ACTION[action]}
            </button>
          ))}
        </div>
      )}

      {/* La toile de travail : elle reçoit l'image, elle n'est jamais montrée. */}
      <canvas ref={toileRef} className="hidden" />
    </div>
  );
}
