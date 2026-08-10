"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Check, Share, SquarePlus } from "lucide-react";

import { ProfileSection } from "@/components/student/ProfileSection";
import { detecterCanalInstallation, type CanalInstallation } from "@/lib/pwa/install";
import {
  lireEtatInstallation,
  lireEtatInstallationServeur,
  oublierInvite,
  souscrireInstallation,
} from "@/lib/pwa/invite-installation";

/**
 * « INSTALLER L'APPLICATION » — sur le profil de l'élève.
 *
 * Ce qu'on installe n'est pas un fichier : c'est ce site, posé sur l'écran
 * d'accueil, qui s'ouvrira ensuite en plein écran sur sa page de connexion
 * (`app/manifest.ts`) sans barre d'adresse ni onglets.
 *
 * ────────────────────────────────────────────────────────────────────────
 * IL N'Y A PAS UN SEUL CAS, IL Y EN A QUATRE
 * ────────────────────────────────────────────────────────────────────────
 * Quel cas s'applique est décidé par `lib/pwa/install.ts` — une fonction
 * pure, vérifiée sur de vraies chaînes de navigateur. Ce que chaque cas
 * affiche est décidé par `ContenuInstallation` ci-dessous, séparé
 * volontairement de l'état : c'est ce qui permet de RENDRE les quatre
 * variantes dans un test et de vérifier la seule chose qui pourrait
 * réellement rater — qu'aucun bouton n'apparaisse sur iPhone, où il ne
 * pourrait rien faire.
 *
 * ────────────────────────────────────────────────────────────────────────
 * QUAND ELLE NE S'AFFICHE PAS
 * ────────────────────────────────────────────────────────────────────────
 * Rien avant le montage (le serveur ne sait pas sur quoi lit l'élève, et
 * deviner produirait une divergence d'hydratation), et rien du tout quand
 * l'application est DÉJÀ lancée depuis l'écran d'accueil : proposer
 * d'installer ce qui est déjà installé donne l'impression que rien n'a
 * marché.
 */

function Etape({ numero, children }: { numero: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs tabular-nums text-muted-foreground">
        {numero}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">{children}</span>
    </li>
  );
}

/**
 * Ce qui s'affiche pour un canal donné. Aucun état, aucun accès au
 * navigateur : rendu tel quel dans `scripts/tests/pwa-render.mts`.
 */
export function ContenuInstallation({
  canal,
  onInstaller,
}: {
  canal: CanalInstallation;
  onInstaller?: () => void;
}) {
  if (canal === "deja-installee") {
    return null;
  }

  return (
    <>
      {/*
        Pas d'icône devant ce paragraphe : le pictogramme « téléphone » se
        réduit à un rectangle vide à 16 px, et un glyphe qu'on ne reconnaît
        pas coûte plus d'attention qu'il n'en fait gagner (vérifié au rendu).
        Les seules icônes gardées sont celles des étapes iOS, où elles ne
        décorent pas : elles montrent le bouton exact à toucher.
      */}
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        Installe ton espace sur l&apos;écran d&apos;accueil de ton téléphone : il
        s&apos;ouvre en plein écran, directement sur ta connexion, sans passer par le
        site.
      </p>

      {canal === "invite-native" && (
        <button
          type="button"
          onClick={onInstaller}
          className="rounded-panel bg-primary px-5 py-3 font-heading text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Installer l&apos;application
        </button>
      )}

      {canal === "ios-safari" && (
        // AUCUN BOUTON ICI, ET C'EST LE POINT LE PLUS IMPORTANT DU FICHIER.
        // Safari sur iOS n'expose aucune API d'installation : un bouton y
        // serait mort au clic, et l'élève en conclurait — à juste titre —
        // que ça ne marche pas. On montre le chemin, avec les icônes qu'il a
        // sous les yeux.
        <ol className="flex flex-col gap-3 text-sm text-foreground">
          <Etape numero={1}>
            Touche
            <Share size={16} aria-hidden="true" />
            <span className="text-muted-foreground">(Partager), en bas de Safari</span>
          </Etape>
          <Etape numero={2}>
            Choisis
            <SquarePlus size={16} aria-hidden="true" />
            <strong className="font-semibold">Sur l&apos;écran d&apos;accueil</strong>
          </Etape>
          <Etape numero={3}>
            Valide avec <strong className="font-semibold">Ajouter</strong>
          </Etape>
        </ol>
      )}

      {canal === "ios-autre-navigateur" && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Sur iPhone et iPad, seul <strong className="font-semibold text-foreground">Safari</strong>{" "}
          sait ajouter une application à l&apos;écran d&apos;accueil. Rouvre cette page dans
          Safari, puis reviens ici : la marche à suivre s&apos;affichera.
        </p>
      )}

      {canal === "manuel" && (
        // CAS FOURRE-TOUT, ET IL FAUT ASSUMER QU'ON NE SAIT PAS.
        //
        // Il couvre trois situations qu'aucune détection ne sépare de façon
        // fiable : un navigateur qui sait installer mais n'émet pas d'invite
        // (Firefox Android), une application DÉJÀ installée mais consultée
        // depuis un onglet (Chrome n'émet alors plus rien, et rien ne permet
        // de le savoir), et un navigateur qui ne sait pas installer du tout
        // (Firefox sur ordinateur).
        //
        // D'où deux précautions dans la formulation : « si elle n'est pas
        // déjà là » couvre le deuxième cas, et « certains navigateurs ne le
        // proposent pas » couvre le troisième. Promettre une entrée de menu
        // qui n'existe pas enverrait l'élève la chercher pour rien, et lui
        // ferait conclure que c'est le site qui est cassé.
        <p className="text-sm leading-relaxed text-muted-foreground">
          Si l&apos;application n&apos;est pas déjà sur ton écran d&apos;accueil, ouvre le
          menu de ton navigateur et cherche{" "}
          <strong className="font-semibold text-foreground">Installer</strong> ou{" "}
          <strong className="font-semibold text-foreground">Ajouter à l&apos;écran d&apos;accueil</strong>.
          Certains navigateurs ne le proposent pas ; dans ce cas, ouvre le site dans Chrome,
          Edge ou Safari.
        </p>
      )}
    </>
  );
}

export function InstallAppSection() {
  // L'événement `beforeinstallprompt` arrive AVANT que cet écran existe :
  // il est capté au niveau du layout racine et attend dans
  // `lib/pwa/invite-installation.ts`. Voir l'explication détaillée là-bas —
  // un écouteur posé ici serait systématiquement en retard.
  const etat = useSyncExternalStore(
    souscrireInstallation,
    lireEtatInstallation,
    lireEtatInstallationServeur,
  );

  const installer = useCallback(async () => {
    const invite = etat?.invite;
    if (!invite) {
      return;
    }
    await invite.prompt();
    const choix = await invite.userChoice;
    oublierInvite(choix.outcome === "accepted");
  }, [etat]);

  // Rendu serveur, ou tout premier rendu client : on ignore encore sur quoi
  // lit l'élève. Afficher quoi que ce soit ici produirait une divergence
  // d'hydratation, puis un clignotement.
  if (!etat) {
    return null;
  }

  if (etat.venonsDInstaller) {
    return (
      <ProfileSection title="Application">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Check size={16} aria-hidden="true" />
          C&apos;est fait — l&apos;application est sur ton écran d&apos;accueil.
        </p>
      </ProfileSection>
    );
  }

  const canal = detecterCanalInstallation(etat.contexte);

  if (canal === "deja-installee") {
    return null;
  }

  return (
    <ProfileSection title="Application">
      <ContenuInstallation canal={canal} onInstaller={installer} />
    </ProfileSection>
  );
}
