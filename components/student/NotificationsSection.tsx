"use client";

import { Bell, BellOff } from "lucide-react";

import { useNotificationsPush } from "@/hooks/useNotificationsPush";

/**
 * LE BLOC « NOTIFICATIONS » DU PROFIL ÉLÈVE.
 *
 * Un seul geste possible à la fois, et une phrase qui dit pourquoi. Aucune
 * demande de permission au chargement : voir `useNotificationsPush`.
 */
export function NotificationsSection() {
  const { etat, message, activer, desactiver } = useNotificationsPush();

  if (etat === "chargement") {
    return null;
  }

  return (
    <div className="rounded-card border border-border bg-card p-6 shadow-soft">
      <div className="mb-3 flex items-center gap-3">
        {etat === "active" ? (
          <Bell size={18} className="text-primary" aria-hidden="true" />
        ) : (
          <BellOff size={18} className="text-muted-foreground" aria-hidden="true" />
        )}
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">Notifications</h2>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {etat === "active"
          ? "Cet appareil recevra les rappels de ton coach, même application fermée."
          : etat === "refuse"
            ? "Les notifications ont été refusées pour ce site. Pour les rétablir : Réglages → Notifications → SETH."
            : etat === "non_supporte"
              ? "Cet appareil ne gère pas les notifications. Sur iPhone, ajoute d'abord SETH à ton écran d'accueil."
              : etat === "erreur"
                ? (message ?? "Quelque chose n'a pas fonctionné.")
                : "Reçois les rappels de ton coach — poids, retour de séance, séance du jour. Tu peux les couper quand tu veux."}
      </p>

      {etat === "inactif" || etat === "erreur" ? (
        <button
          type="button"
          onClick={() => void activer()}
          className="pressable flex min-h-11 items-center justify-center rounded-control border border-primary px-5 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Activer les notifications
        </button>
      ) : null}

      {etat === "active" ? (
        <button
          type="button"
          onClick={() => void desactiver()}
          className="pressable flex min-h-11 items-center justify-center rounded-control border border-border px-5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Désactiver sur cet appareil
        </button>
      ) : null}
    </div>
  );
}
