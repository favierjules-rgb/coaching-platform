"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";

/**
 * « ENVOYER UNE NOTIFICATION DE TEST » — RIEN DE PLUS.
 *
 * Ce n'est PAS le centre de notifications : ni destinataires, ni
 * programmation, ni récurrence. Un seul bouton, qui envoie à SES PROPRES
 * appareils, et qui existe pour une seule raison — pouvoir prouver le socle
 * depuis un téléphone, sans ligne de commande.
 *
 * Il disparaîtra ou sera absorbé par le composer une fois le socle validé.
 */
export function NotificationTestButton() {
  const [etat, setEtat] = useState<"repos" | "envoi" | "fait">("repos");
  const [resume, setResume] = useState<string | null>(null);

  async function envoyer() {
    setEtat("envoi");
    setResume(null);
    try {
      const reponse = await fetch("/api/admin/notifications/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const corps = (await reponse.json()) as {
        appareils?: number;
        envoyees?: number;
        echouees?: number;
        error?: string;
      };
      if (!reponse.ok) {
        setResume(corps.error ?? "L'envoi a échoué.");
      } else if ((corps.appareils ?? 0) === 0) {
        setResume("Aucun appareil abonné. Active d'abord les notifications dans ton profil.");
      } else {
        setResume(
          `${corps.envoyees} envoi(s) sur ${corps.appareils} appareil(s)` +
            ((corps.echouees ?? 0) > 0 ? ` · ${corps.echouees} échec(s)` : ""),
        );
      }
    } catch {
      setResume("Le serveur n'a pas répondu.");
    } finally {
      setEtat("fait");
    }
  }

  return (
    <div className="rounded-card border border-border bg-card p-6 shadow-soft">
      <div className="mb-3 flex items-center gap-3">
        <BellRing size={18} className="text-primary" aria-hidden="true" />
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">Notifications</h2>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        Envoie « Notification de test SETH » sur tes propres appareils abonnés.
      </p>
      <button
        type="button"
        onClick={() => void envoyer()}
        disabled={etat === "envoi"}
        className="pressable flex min-h-11 items-center justify-center rounded-control border border-primary px-5 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {etat === "envoi" ? "Envoi…" : "Envoyer une notification de test"}
      </button>
      {resume && <p className="mt-3 text-xs text-muted-foreground">{resume}</p>}
    </div>
  );
}
