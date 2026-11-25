"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { COACHS_HTS, TEXTE_SMS_HTS, type IdentifiantCoachHts } from "@/lib/contact-nfc/config";
import {
  construireLienSms,
  detecterVarianteSms,
  formaterNumeroAffichage,
  type VarianteSms,
} from "@/lib/contact-nfc/lien-sms";
import {
  COACH_PAR_DEFAUT,
  coachParIdentifiant,
  coachSuivant,
  estIdentifiantCoachHts,
} from "@/lib/contact-nfc/rotation";

/**
 * LE BOUTON UNIQUE du contact NFC « HTS » — un coach à la fois, à tour de rôle.
 *
 * 1. À l'affichage, la page demande au serveur à qui est le tour (sans le
 *    faire avancer). Le bouton reste « Contacter un coach » : seul son lien
 *    change.
 * 2. L'appui ouvre l'application SMS vers CE SEUL coach, texte prérempli, et
 *    signale l'ouverture au serveur, qui passe le tour au coach suivant.
 * 3. Le lien du bouton pointe alors vers le coach suivant.
 *
 * ⚠️ LE SITE NE SAIT JAMAIS SI LE SMS EST PARTI. Il n'annonce que
 * l'ouverture de l'application SMS, jamais un envoi. C'est le visiteur qui appuie sur Envoyer.
 *
 * ⚠️ SANS JAVASCRIPT, LE BOUTON FONCTIONNE QUAND MÊME. Le rendu serveur
 * contient un vrai lien vers le coach par défaut (Jules). Seule l'alternance
 * demande le JavaScript.
 *
 * ⚠️ PAS DE BLOCAGE SUR LE SERVEUR. Tant que la réponse du tour n'est pas
 * arrivée, le bouton attend au plus `DELAI_LECTURE_MS`, puis sert le coach
 * par défaut. Un compteur en panne ne coûte que l'équité, jamais le contact.
 *
 * ⚠️ AUCUNE DONNÉE COLLECTÉE. Les seuls échanges avec le serveur portent un
 * identifiant de coach ; aucun champ, aucun stockage navigateur.
 */

const ROUTE_TOUR = "/api/contact-nfc/tour";

/** Attente maximale de la réponse du tour avant de servir le coach par défaut. */
const DELAI_LECTURE_MS = 2500;

/**
 * Délai pendant lequel un second appui est ignoré. ⚠️ Sans lui, un double
 * appui rapide ouvrirait le SMS de Jules puis, le bouton ayant déjà basculé,
 * celui de Yoann.
 */
const ANTI_DOUBLE_APPUI_MS = 1500;

/**
 * ⚠️ LIBELLÉ NEUTRE, JAMAIS LE PRÉNOM (décision de Jules, 25/11/2026). Le
 * visiteur ne doit pas savoir à quel coach il écrit avant l'ouverture du SMS.
 * Le prénom n'apparaît nulle part dans la page : ni bouton, ni statut, ni
 * repli. Seul le numéro, inévitable, figure dans le lien.
 */
const LIBELLE_BOUTON = "Contacter un coach";

const STATUT_OUVERT = "Ton application SMS est ouverte : appuie sur Envoyer pour prévenir le coach.";

const INDICATION =
  "Le bouton ouvre ton application SMS avec le message déjà rédigé. Il te restera à appuyer sur Envoyer.";

type EtatCopie = "attente" | "copie" | "echec";

const MESSAGE_COPIE = {
  attente: "",
  copie: "Message copié. Colle-le dans un SMS à l'un des coachs.",
  echec: "Copie impossible : sélectionne le message ci-dessus pour le copier.",
} as const satisfies Record<EtatCopie, string>;

/** Rien à écouter : l'appareil ne change pas pendant la visite. */
function sAbonnerAucunChangement(): () => void {
  return () => {};
}

function varianteCoteServeur(): VarianteSms {
  return "rfc";
}

function varianteCoteNavigateur(): VarianteSms {
  return detecterVarianteSms({
    agentUtilisateur: navigator.userAgent,
    plateforme: navigator.platform,
    pointsDeContactMax: navigator.maxTouchPoints ?? 0,
  });
}

/** `false` au rendu serveur et pendant l'hydratation, `true` ensuite. */
function hydrateCoteServeur(): boolean {
  return false;
}
function hydrateCoteNavigateur(): boolean {
  return true;
}

/** Lit `{ coach }` dans une réponse de la route du tour ; `null` si illisible. */
async function lireCoachDeReponse(reponse: Response): Promise<IdentifiantCoachHts | null> {
  if (!reponse.ok) return null;
  const contenu = (await reponse.json().catch(() => null)) as { coach?: unknown } | null;
  return estIdentifiantCoachHts(contenu?.coach) ? contenu.coach : null;
}

export function BoutonSmsHts() {
  const variante = useSyncExternalStore(sAbonnerAucunChangement, varianteCoteNavigateur, varianteCoteServeur);
  const hydrate = useSyncExternalStore(sAbonnerAucunChangement, hydrateCoteNavigateur, hydrateCoteServeur);

  /** Coach dont c'est le tour selon le serveur ; `null` tant qu'inconnu. */
  const [tour, setTour] = useState<IdentifiantCoachHts | null>(null);
  const [lectureTerminee, setLectureTerminee] = useState(false);
  const [dernierOuvert, setDernierOuvert] = useState<IdentifiantCoachHts | null>(null);
  const [copie, setCopie] = useState<EtatCopie>("attente");
  const dernierAppui = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    const controleur = new AbortController();
    const delai = window.setTimeout(() => setLectureTerminee(true), DELAI_LECTURE_MS);
    fetch(ROUTE_TOUR, { cache: "no-store", signal: controleur.signal })
      .then(lireCoachDeReponse)
      .then((coach) => {
        if (coach) setTour(coach);
      })
      .catch(() => {
        // Réseau ou serveur indisponible : le coach par défaut sera servi.
      })
      .finally(() => {
        window.clearTimeout(delai);
        setLectureTerminee(true);
      });
    return () => {
      controleur.abort();
      window.clearTimeout(delai);
    };
  }, []);

  const coach = tour ? coachParIdentifiant(tour) : COACH_PAR_DEFAUT;
  const enAttente = hydrate && !lectureTerminee && tour === null;
  /**
   * État exposé en `data-etat` : `statique` (HTML serveur, avant JavaScript),
   * `attente` (tour demandé), `pret`. ⚠️ Sert aux tests navigateur : sans lui,
   * le libellé « Contacter Jules » du HTML serveur était pris pour l'état
   * final, et un appui partait avant l'hydratation (mesuré le 25/11/2026).
   */
  const etat = !hydrate ? "statique" : enAttente ? "attente" : "pret";

  function signalerOuverture(identifiant: IdentifiantCoachHts) {
    setDernierOuvert(identifiant);
    // Bascule immédiate vers le suivant ; la réponse du serveur fait foi.
    setTour(coachSuivant(identifiant).identifiant);
    fetch(ROUTE_TOUR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coach: identifiant }),
      cache: "no-store",
      // ⚠️ `keepalive` : l'application SMS passe au premier plan, la requête
      // doit pouvoir partir même si le navigateur est mis en arrière-plan.
      keepalive: true,
    })
      .then(lireCoachDeReponse)
      .then((prochain) => {
        if (prochain) setTour(prochain);
      })
      .catch(() => {
        // Le tour n'a peut-être pas avancé côté serveur : le visiteur, lui,
        // a bien son SMS ouvert. Rien à lui signaler.
      });
  }

  function auClic(evenement: React.MouseEvent<HTMLAnchorElement>) {
    // Horodatage de l'événement lui-même : pas de lecture d'horloge pendant le rendu.
    const maintenant = evenement.timeStamp;
    if (enAttente || maintenant - dernierAppui.current < ANTI_DOUBLE_APPUI_MS) {
      evenement.preventDefault();
      return;
    }
    dernierAppui.current = maintenant;
    signalerOuverture(coach.identifiant);
  }

  async function copierMessage() {
    try {
      await navigator.clipboard.writeText(TEXTE_SMS_HTS);
      setCopie("copie");
    } catch {
      setCopie("echec");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <a
        href={construireLienSms(coach.numero, TEXTE_SMS_HTS, variante)}
        data-coach={coach.identifiant}
        data-etat={etat}
        aria-disabled={enAttente || undefined}
        aria-busy={enAttente || undefined}
        onClick={auClic}
        className={`flex min-h-14 w-full items-center justify-center rounded-panel bg-[var(--hts-jaune)] px-5 py-4 text-center font-heading text-lg font-extrabold uppercase tracking-widest text-black transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hts-jaune)] focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          enAttente ? "cursor-wait opacity-60" : "hover:opacity-90"
        }`}
      >
        {enAttente ? "Un instant…" : LIBELLE_BOUTON}
      </a>

      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-foreground">
        {dernierOuvert ? STATUT_OUVERT : ""}
      </p>

      <p className="text-sm leading-relaxed text-muted-foreground">{INDICATION}</p>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer py-2 underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hts-jaune)]">
          Le SMS ne s&apos;ouvre pas ?
        </summary>
        <div className="mt-2 flex flex-col gap-3 border border-border bg-card p-4">
          <p>Envoie ce message par SMS à l&apos;un de ces deux numéros :</p>
          <ul className="flex flex-col gap-1 text-foreground">
            {COACHS_HTS.map((membre) => (
              <li key={membre.identifiant} className="tabular-nums">
                {formaterNumeroAffichage(membre.numero)}
              </li>
            ))}
          </ul>
          <p className="select-all border-l-2 border-[var(--hts-jaune)] pl-3 text-foreground">{TEXTE_SMS_HTS}</p>
          <button
            type="button"
            onClick={copierMessage}
            className="self-start rounded-panel border border-border px-4 py-2 font-heading text-xs font-bold uppercase tracking-widest text-foreground hover:border-[var(--hts-jaune)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hts-jaune)]"
          >
            Copier le message
          </button>
          <p role="status" aria-live="polite">
            {MESSAGE_COPIE[copie]}
          </p>
        </div>
      </details>
    </div>
  );
}
