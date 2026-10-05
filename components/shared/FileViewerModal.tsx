"use client";

import { useCallback, useEffect, useState } from "react";

import { MediaModal } from "@/components/shared/MediaModal";
import type { DocumentKind } from "@/lib/documents";

/**
 * LES DOCUMENTS — DANS SETH AUSSI.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA VOIE NORMALE EST LA MODALE
 * ════════════════════════════════════════════════════════════════════════
 * Aucune redirection automatique : le clic ouvre le dialogue, point. Le
 * bouton « Ouvrir le document » est une ISSUE, jamais un comportement par
 * défaut, et il faut le viser volontairement.
 *
 * ════════════════════════════════════════════════════════════════════════
 * IPHONE, ET POURQUOI L'ISSUE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * WebKit affiche un PDF en `<iframe>` de façon inégale : selon la version
 * d'iOS et le mode (Safari ou PWA installée), on obtient soit un rendu
 * correct, soit un cadre vide sans le moindre événement d'erreur. Il n'y a
 * pas de test fiable côté JavaScript pour trancher — l'iframe se charge
 * « avec succès » dans les deux cas.
 *
 * On tente donc l'affichage intégré, et l'issue reste visible SOUS le
 * document plutôt que d'attendre une détection qui n'existe pas. Mieux vaut
 * un bouton toujours présent qu'un cadre vide sans recours.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'URL SIGNÉE RESTE TEMPORAIRE
 * ════════════════════════════════════════════════════════════════════════
 * Elle est reçue en propriété, utilisée, et jamais écrite ailleurs : ni
 * `localStorage`, ni IndexedDB, ni Cache Storage. Quand elle expire, on en
 * redemande une par le mécanisme existant — on ne rend jamais le document
 * public pour se simplifier la vie.
 *
 * ═════════════════════════════════════════════════════════════════════
 * UNE IMAGE N'EST PAS UN PDF (B)
 * ═════════════════════════════════════════════════════════════════════
 * Jusqu'à ce lot, TOUT passait par l'`<iframe>` ci-dessous. Une image s'y
 * affiche — le navigateur sait rendre une image seule — mais sur fond blanc
 * forcé, sans `object-fit`, sans `alt`, et tronquée ou minuscule selon la
 * taille réelle du fichier. C'était un visualiseur de PDF dans lequel une
 * image tombait par défaut.
 *
 * ⚠️ LA BRANCHE `<iframe>` EST CONSERVÉE À L'IDENTIQUE pour `pdf`, `video` et
 * `autre`. Le `<img>` est une branche SUPPLÉMENTAIRE, atteinte uniquement sur
 * `kind === "image"` ; elle ne remplace rien. Les états `hors_ligne`,
 * `erreur`, « Réessayer » et l'issue « Ouvrir le document » sont communs aux
 * deux et inchangés — un lien signé expiré produit la même page d'erreur du
 * Storage dans un `<img>` que dans une `<iframe>`, et la même absence
 * d'évènement côté JavaScript.
 *
 * `kind` est OPTIONNEL : sans lui, le comportement est exactement celui
 * d'avant. Aucun appelant existant n'a besoin d'être adapté.
 */

interface FileViewerModalProps {
  ouvert: boolean;
  onFermer: () => void;
  titre: string;
  /** URL signée, temporaire. `null` = pas encore obtenue, ou expirée. */
  url: string | null;
  /** Redemande une URL fraîche au mécanisme de signature existant. */
  onRafraichir?: () => Promise<string | null> | string | null;
  /**
   * Nature RÉELLE du fichier (voir `documentKind`, lib/documents.ts). Omis →
   * `"autre"`, donc l'`<iframe>` : le comportement d'avant ce lot.
   */
  kind?: DocumentKind;
}

type Etat = "affichage" | "erreur" | "hors_ligne";

function enLigne(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function FileViewerModal({ ouvert, onFermer, titre, url, onRafraichir, kind = "autre" }: FileViewerModalProps) {
  const [urlCourante, setUrlCourante] = useState<string | null>(url);
  const [etat, setEtat] = useState<Etat>("affichage");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let annule = false;
    function reinitialiser() {
      if (annule) return;
      setUrlCourante(url);
      setEtat(enLigne() ? (url ? "affichage" : "erreur") : "hors_ligne");
    }
    if (ouvert) reinitialiser();
    return () => {
      annule = true;
    };
  }, [ouvert, url]);

  const reessayer = useCallback(async () => {
    if (!enLigne()) {
      setEtat("hors_ligne");
      return;
    }
    setEnCours(true);
    try {
      const fraiche = onRafraichir ? await onRafraichir() : urlCourante;
      setUrlCourante(fraiche ?? null);
      setEtat(fraiche ? "affichage" : "erreur");
    } catch {
      setEtat("erreur");
    } finally {
      setEnCours(false);
    }
  }, [onRafraichir, urlCourante]);

  const cadre = "flex flex-col items-center gap-4 px-6 py-14 text-center";
  const bouton =
    "pressable rounded-control border border-border px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <MediaModal ouvert={ouvert} titre={titre} onFermer={onFermer}>
      {etat === "hors_ligne" ? (
        <div className={cadre} data-etat="hors-ligne">
          <p className="text-sm text-muted-foreground">
            Une connexion est nécessaire pour ouvrir ce document.
          </p>
          <button type="button" onClick={() => void reessayer()} className={bouton}>
            Réessayer
          </button>
        </div>
      ) : etat === "erreur" || !urlCourante ? (
        <div className={cadre} data-etat="erreur">
          <p className="text-sm text-muted-foreground">
            Ce document n&apos;est pas disponible. Le lien a peut-être expiré.
          </p>
          <button type="button" onClick={() => void reessayer()} disabled={enCours} className={bouton}>
            {enCours ? "Nouvelle tentative…" : "Réessayer"}
          </button>
        </div>
      ) : (
        <div className="flex h-full flex-col bg-card">
          {kind === "image" ? (
            /* Une image, rendue comme une image : jamais recadrée
               (`object-contain`), bornée en hauteur comme l'iframe, et
               décrite pour les lecteurs d'écran. */
            // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire, hors next/image (pas de domaine stable à autoriser)
            <img
              src={urlCourante}
              alt={titre}
              className="max-h-[70vh] w-full bg-surface-soft object-contain"
              data-visionneuse="image"
            />
          ) : (
            <iframe
              src={urlCourante}
              title={titre}
              className="h-[70vh] w-full border-0 bg-white"
              data-visionneuse="document"
            />
          )}
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border px-4 py-3">
            {/* « Réessayer » est présent MÊME quand le document s'affiche.
                Ce n'est pas une redondance : un lien signé qui a expiré
                produit, dans une iframe, la page d'erreur du Storage — et
                rien n'en sort côté JavaScript. Sans ce bouton, l'élève
                verrait un cadre d'erreur sans aucun recours. */}
            <button type="button" onClick={() => void reessayer()} disabled={enCours} className={bouton}>
              {enCours ? "Nouvelle tentative…" : "Réessayer"}
            </button>
            {/* Issue de secours, jamais automatique : il faut la viser. */}
            <a
              href={urlCourante}
              target="_blank"
              rel="noopener noreferrer"
              className={bouton}
              data-issue="ouvrir-document"
            >
              Ouvrir le document
            </a>
          </div>
        </div>
      )}
    </MediaModal>
  );
}
