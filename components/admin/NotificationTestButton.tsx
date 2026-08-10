"use client";

import { useEffect, useId, useState } from "react";
import { BellRing, Search } from "lucide-react";

import { fullName, matchesStudentSearch } from "@/lib/admin";
import type { AdminStudent } from "@/types";

/**
 * « ENVOYER UNE NOTIFICATION DE TEST » — À UN ÉLÈVE DÉSIGNÉ.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN DESTINATAIRE, ET PAS « MES PROPRES APPAREILS »
 * ════════════════════════════════════════════════════════════════════════
 * La première version postait un corps vide, et la route retombait donc sur
 * le compte STAFF connecté. L'administrateur n'ayant jamais activé les
 * notifications, l'écran annonçait « Aucun appareil abonné » alors que
 * l'élève en avait deux. On ne teste pas un système de notification sur le
 * compte qui ne le reçoit pas.
 *
 * Le destinataire est donc choisi explicitement, et c'est une FICHE ÉLÈVE
 * qui part sur le réseau — jamais un identifiant de compte. Le serveur
 * résout lui-même le compte correspondant : voir la route.
 *
 * Ce n'est toujours PAS le centre de notifications : ni programmation, ni
 * récurrence, ni envoi collectif. Un destinataire, un message fixe, un
 * bouton — le temps de prouver le socle depuis un vrai téléphone.
 */

interface NotificationTestButtonProps {
  students: AdminStudent[];
}

interface ReponseTest {
  utilisateursCibles?: number;
  appareilsCibles?: number;
  envoyes?: number;
  echoues?: number;
  error?: string;
}

/** « 2 appareils joignables » — au singulier quand il n'y en a qu'un. */
function phraseAppareils(nombre: number): string {
  if (nombre === 0) return "Aucun appareil joignable";
  return `${nombre} appareil${nombre > 1 ? "s" : ""} joignable${nombre > 1 ? "s" : ""}`;
}

export function NotificationTestButton({ students }: NotificationTestButtonProps) {
  const idRecherche = useId();
  const idSelection = useId();
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState("");
  const [appareils, setAppareils] = useState<number | null>(null);
  const [compte, setCompte] = useState<"repos" | "chargement" | "erreur">("repos");
  const [etat, setEtat] = useState<"repos" | "envoi">("repos");
  const [resume, setResume] = useState<string | null>(null);

  const filtres = students.filter((eleve) => matchesStudentSearch(eleve, query));
  const choisi = students.find((eleve) => eleve.id === studentId) ?? null;

  /**
   * Le nombre d'appareils est demandé au SERVEUR, jamais déduit ici : c'est
   * lui qui sait ce que contient `push_subscriptions`, et il le compte sans
   * rien envoyer.
   */
  useEffect(() => {
    let annule = false;
    // Les mises à jour d'état restent imbriquées dans une fonction locale à
    // l'effet plutôt qu'appelées directement dans son corps, conformément à
    // la règle react-hooks/set-state-in-effect appliquée dans ce dépôt.
    async function compterAppareils() {
      if (!studentId) {
        setAppareils(null);
        setCompte("repos");
        return;
      }
      setCompte("chargement");
      setResume(null);
      try {
        const reponse = await fetch(
          `/api/admin/notifications/test?studentId=${encodeURIComponent(studentId)}`,
        );
        const corps = (await reponse.json()) as ReponseTest;
        if (annule) return;
        if (!reponse.ok) {
          setCompte("erreur");
          setAppareils(null);
          return;
        }
        setAppareils(corps.appareilsCibles ?? 0);
        setCompte("repos");
      } catch {
        if (!annule) {
          setCompte("erreur");
          setAppareils(null);
        }
      }
    }
    void compterAppareils();
    return () => {
      annule = true;
    };
  }, [studentId]);

  async function envoyer() {
    if (!studentId) return;
    setEtat("envoi");
    setResume(null);
    try {
      const reponse = await fetch("/api/admin/notifications/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const corps = (await reponse.json()) as ReponseTest;
      if (!reponse.ok) {
        setResume(corps.error ?? "L'envoi a échoué.");
      } else if ((corps.utilisateursCibles ?? 0) === 0) {
        setResume("Cet élève n'a pas encore de compte actif : aucun appareil ne peut être joint.");
      } else if ((corps.appareilsCibles ?? 0) === 0) {
        setResume(
          "Aucun appareil joignable. Cet élève doit d'abord activer les notifications depuis son profil.",
        );
      } else {
        setAppareils(corps.appareilsCibles ?? 0);
        setResume(
          `${corps.envoyes} envoi(s) sur ${corps.appareilsCibles} appareil(s)` +
            ((corps.echoues ?? 0) > 0 ? ` · ${corps.echoues} échec(s)` : ""),
        );
      }
    } catch {
      setResume("Le serveur n'a pas répondu.");
    } finally {
      setEtat("repos");
    }
  }

  return (
    <div className="rounded-card border border-border bg-card p-6 shadow-soft">
      <div className="mb-3 flex items-center gap-3">
        <BellRing size={18} className="text-primary" aria-hidden="true" />
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Notification de test
        </h2>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        Envoie « Notification de test SETH » sur les appareils de l&apos;élève choisi.
      </p>

      <div className="mb-4 flex flex-col gap-2">
        <label
          htmlFor={idRecherche}
          className="text-[11px] uppercase tracking-widest text-muted-foreground"
        >
          Destinataire
        </label>
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id={idRecherche}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un élève (prénom, nom ou email)…"
            className="w-full rounded-control border border-border bg-surface-soft py-2 pl-8 pr-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
        </div>
        <select
          id={idSelection}
          aria-label="Élève destinataire"
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
          className="w-full rounded-control border border-border bg-surface-soft px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
        >
          <option value="">
            {filtres.length === 0 ? "Aucun élève ne correspond" : "Choisir un élève…"}
          </option>
          {filtres.map((eleve) => (
            <option key={eleve.id} value={eleve.id}>
              {fullName(eleve)} · {eleve.email}
            </option>
          ))}
        </select>
      </div>

      {choisi && (
        <p className="mb-4 text-xs text-muted-foreground">
          {compte === "chargement"
            ? "Recherche des appareils…"
            : compte === "erreur"
              ? "Impossible de compter les appareils de cet élève."
              : phraseAppareils(appareils ?? 0)}
        </p>
      )}

      <button
        type="button"
        onClick={() => void envoyer()}
        disabled={etat === "envoi" || !studentId}
        className="pressable flex min-h-11 items-center justify-center rounded-control border border-primary px-5 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {etat === "envoi" ? "Envoi…" : "Envoyer une notification de test"}
      </button>
      {resume && <p className="mt-3 text-xs text-muted-foreground">{resume}</p>}
    </div>
  );
}
