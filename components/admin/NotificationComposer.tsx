"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Search, Send } from "lucide-react";

import { fullName, matchesStudentSearch } from "@/lib/admin";
import { MODELES } from "@/lib/notifications/modeles";
import { FUSEAU_PAR_DEFAUT, type FrequenceRecurrence } from "@/lib/notifications/recurrence";
import { DESTINATIONS_STATIQUES } from "@/lib/push/destinations";
import type { AdminStudent } from "@/types";

/**
 * LE COMPOSER — UN SEUL, DEUX TAILLES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI PAS DEUX COMPOSANTS
 * ════════════════════════════════════════════════════════════════════════
 * Le bloc du tableau de bord et la page complète posent les mêmes questions
 * — qui, quoi, où ça mène — et n'en diffèrent que par la programmation.
 * Deux implémentations auraient fini par diverger sur la validation ou sur
 * la confirmation d'envoi global, c'est-à-dire précisément là où une
 * divergence coûte cher.
 *
 * `compact` ne change QUE la présentation : le menu « Quand » remplace trois
 * boutons, et le repli progressif n'affiche que ce que le mode choisi
 * demande. Les CAPACITÉS sont identiques — on programme et on crée une
 * répétition depuis le tableau de bord exactement comme depuis la page, avec
 * la même validation, le même calcul d'échéance et la même API. Une première
 * version forçait « Maintenant » en compact : c'était une amputation, pas une
 * mise en page.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LES NOMBRES VIENNENT DU SERVEUR
 * ════════════════════════════════════════════════════════════════════════
 * « 42 ciblés · 32 joignables · 38 appareils » n'est pas calculé ici : le
 * navigateur ne sait pas qui a un abonnement vivant. Les compter côté client
 * à partir de la liste d'élèves donnerait un chiffre faux, et la
 * confirmation d'envoi global reposerait sur ce chiffre faux.
 */

const JOURS = [
  { iso: 1, court: "L" }, { iso: 2, court: "M" }, { iso: 3, court: "M" },
  { iso: 4, court: "J" }, { iso: 5, court: "V" }, { iso: 6, court: "S" }, { iso: 7, court: "D" },
];

const LIBELLES_DESTINATION: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/entrainement": "Entraînement",
  "/progression": "Progression",
  "/nutrition": "Nutrition",
  "/documents": "Documents",
  "/profil": "Profil",
  "/rendez-vous": "Rendez-vous",
};

type GenreCible = "all" | "un" | "plusieurs";
type ModeQuand = "now" | "once" | "recurring";

interface Audience {
  cibles: number;
  joignables: number;
  appareils: number;
}

interface NotificationComposerProps {
  students: AdminStudent[];
  /** Tableau de bord : même composer, présentation resserrée. */
  compact?: boolean;
  onEnvoyee?: () => void;
}

export function NotificationComposer({ students, compact = false, onEnvoyee }: NotificationComposerProps) {
  const idRecherche = useId();
  const [modeleCle, setModeleCle] = useState("poids");
  const [titre, setTitre] = useState(MODELES[0].titre);
  const [corps, setCorps] = useState(MODELES[0].corps);
  const [destination, setDestination] = useState(MODELES[0].destination);

  const [genre, setGenre] = useState<GenreCible>("all");
  const [recherche, setRecherche] = useState("");
  const [selection, setSelection] = useState<string[]>([]);

  const [quand, setQuand] = useState<ModeQuand>("now");
  const [date, setDate] = useState("");
  const [heure, setHeure] = useState("08:00");
  const [freq, setFreq] = useState<FrequenceRecurrence>("weekly");
  const [jours, setJours] = useState<number[]>([1]);
  const [jourDuMois, setJourDuMois] = useState(1);

  const [audience, setAudience] = useState<Audience | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [resume, setResume] = useState<string | null>(null);

  const filtres = students.filter((e) => matchesStudentSearch(e, recherche));
  // Une clé TEXTE, pas le tableau : une nouvelle référence de tableau à
  // chaque rendu relancerait la requête de comptage en boucle. La liste est
  // donc RECONSTRUITE depuis cette clé, ce qui la rend stable tant que la
  // sélection ne change pas réellement.
  const cleSelection = genre === "all" ? "" : selection.join(",");
  const studentIds = useMemo(
    () => (cleSelection === "" ? [] : cleSelection.split(",")),
    [cleSelection],
  );
  const cibleServeur = genre === "all" ? "all" : "students";
  const pretACibler = genre === "all" || selection.length > 0;

  function appliquerModele(cle: string) {
    const m = MODELES.find((x) => x.cle === cle);
    if (!m) return;
    setModeleCle(cle);
    setTitre(m.titre);
    setCorps(m.corps);
    setDestination(m.destination);
  }

  useEffect(() => {
    let annule = false;
    // Les mises à jour d'état restent imbriquées dans une fonction locale,
    // conformément à react-hooks/set-state-in-effect.
    async function compter() {
      if (!pretACibler) {
        setAudience(null);
        return;
      }
      try {
        const reponse = await fetch("/api/admin/notifications/audience", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ genre: cibleServeur, studentIds }),
        });
        const corpsReponse = (await reponse.json()) as Audience & { error?: string };
        if (annule) return;
        setAudience(reponse.ok ? corpsReponse : null);
      } catch {
        if (!annule) setAudience(null);
      }
    }
    void compter();
    return () => {
      annule = true;
    };
  }, [cibleServeur, pretACibler, studentIds]);

  function basculerJour(iso: number) {
    setJours((actuels) =>
      actuels.includes(iso) ? actuels.filter((j) => j !== iso) : [...actuels, iso].sort((a, b) => a - b),
    );
  }

  function corpsRequete() {
    const quandUtile =
      quand === "now"
        ? { mode: "now" as const }
        : quand === "once"
          ? { mode: "once" as const, date, heure, fuseau: FUSEAU_PAR_DEFAUT }
          : {
              mode: "recurring" as const,
              fuseau: FUSEAU_PAR_DEFAUT,
              recurrence: {
                freq,
                hour: Number(heure.slice(0, 2)),
                minute: Number(heure.slice(3, 5)),
                ...(freq === "weekly" ? { weekdays: jours } : {}),
                ...(freq === "monthly" ? { monthday: jourDuMois } : {}),
              },
            };
    return {
      titre, corps, destination,
      cible: { genre: cibleServeur, studentIds },
      quand: quandUtile,
    };
  }

  async function envoyer() {
    setEnvoi(true);
    setResume(null);
    try {
      const reponse = await fetch("/api/admin/notifications/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpsRequete()),
      });
      const r = (await reponse.json()) as {
        error?: string; envoyes?: number; echoues?: number; appareilsCibles?: number; prochaineEcheance?: string | null;
      };
      if (!reponse.ok) {
        setResume(r.error ?? "L'envoi a échoué.");
      } else if (r.prochaineEcheance) {
        setResume(
          `Programmée pour le ${new Date(r.prochaineEcheance).toLocaleString("fr-FR", { timeZone: FUSEAU_PAR_DEFAUT })}.`,
        );
        onEnvoyee?.();
      } else if ((r.appareilsCibles ?? 0) === 0) {
        setResume("Aucun appareil joignable : personne n'a encore activé ses notifications.");
        onEnvoyee?.();
      } else {
        setResume(
          `${r.envoyes} envoi(s) sur ${r.appareilsCibles} appareil(s)` +
            ((r.echoues ?? 0) > 0 ? ` · ${r.echoues} échec(s)` : ""),
        );
        onEnvoyee?.();
      }
    } catch {
      setResume("Le serveur n'a pas répondu.");
    } finally {
      setEnvoi(false);
      setConfirmation(false);
    }
  }

  function demanderEnvoi() {
    // Aucun envoi global en un clic : « tout le monde » passe toujours par
    // une confirmation qui affiche les nombres réels.
    if (genre === "all") {
      setConfirmation(true);
      return;
    }
    void envoyer();
  }

  const libelleAction = quand === "now" ? "Envoyer" : quand === "once" ? "Programmer" : "Créer la répétition";
  const champ =
    "w-full rounded-control border border-border bg-surface-soft px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30";
  const etiquette = "text-[11px] uppercase tracking-widest text-muted-foreground";

  return (
    <div className="flex flex-col gap-4">
      {/* ── Modèles ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {MODELES.map((m) => (
          <button
            key={m.cle}
            type="button"
            onClick={() => appliquerModele(m.cle)}
            className={`pressable rounded-control border px-3 py-1.5 text-[11px] uppercase tracking-widest transition-colors ${
              modeleCle === m.cle
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {m.libelle}
          </button>
        ))}
      </div>

      {/* ── Destinataires ───────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className={etiquette}>Destinataires</span>
        <select
          aria-label="Destinataires"
          value={genre}
          onChange={(e) => {
            const suivant = e.target.value as GenreCible;
            setGenre(suivant);
            if (suivant === "un") setSelection((s) => s.slice(0, 1));
            if (suivant === "all") setSelection([]);
          }}
          className={champ}
        >
          <option value="all">Tout le monde</option>
          <option value="un">Un élève</option>
          <option value="plusieurs">Plusieurs élèves</option>
        </select>

        {genre !== "all" && (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id={idRecherche}
                type="text"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher par prénom, nom ou email…"
                className={`${champ} pl-8`}
              />
            </div>
            {genre === "un" ? (
              <select
                aria-label="Élève destinataire"
                value={selection[0] ?? ""}
                onChange={(e) => setSelection(e.target.value ? [e.target.value] : [])}
                className={champ}
              >
                <option value="">Choisir un élève…</option>
                {filtres.map((e) => (
                  <option key={e.id} value={e.id}>
                    {fullName(e)} · {e.email}
                  </option>
                ))}
              </select>
            ) : (
              <div className="max-h-44 overflow-y-auto rounded-control border border-border bg-surface-soft/40 p-2">
                {filtres.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">Aucun élève ne correspond.</p>
                )}
                {filtres.map((e) => (
                  <label key={e.id} className="flex cursor-pointer items-center gap-2 px-1 py-1 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={selection.includes(e.id)}
                      onChange={(ev) =>
                        setSelection((s) => (ev.target.checked ? [...s, e.id] : s.filter((x) => x !== e.id)))
                      }
                      className="h-4 w-4 accent-current"
                    />
                    {fullName(e)}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {audience
            ? `${audience.cibles} ciblé${audience.cibles > 1 ? "s" : ""} · ${audience.joignables} joignable${audience.joignables > 1 ? "s" : ""} · ${audience.appareils} appareil${audience.appareils > 1 ? "s" : ""}`
            : pretACibler
              ? "Calcul en cours…"
              : "Choisis au moins un élève."}
        </p>
      </div>

      {/* ── Message ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className={etiquette}>Titre</span>
        <input type="text" value={titre} maxLength={80} onChange={(e) => setTitre(e.target.value)} className={champ} />
        <span className={etiquette}>Message</span>
        <textarea value={corps} maxLength={300} rows={2} onChange={(e) => setCorps(e.target.value)} className={champ} />
        <span className={etiquette}>Ouvre sur</span>
        <select aria-label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)} className={champ}>
          {DESTINATIONS_STATIQUES.map((d) => (
            <option key={d} value={d}>
              {LIBELLES_DESTINATION[d] ?? d}
            </option>
          ))}
        </select>
      </div>

      {/* ── Quand ───────────────────────────────────────────────────
          TOUJOURS présent, y compris en compact : le tableau de bord doit
          pouvoir CRÉER une notification programmée ou récurrente, pas
          seulement en envoyer une tout de suite. Seule l'affordance change
          — un menu déroulant là où la place manque, trois boutons sur la
          page — et le repli progressif n'affiche que ce que le mode
          choisi demande. */}
      <div className="flex flex-col gap-2">
        <span className={etiquette}>Quand</span>
        {compact ? (
          <select
            aria-label="Quand"
            value={quand}
            onChange={(e) => setQuand(e.target.value as ModeQuand)}
            className={champ}
          >
            <option value="now">Maintenant</option>
            <option value="once">Programmer</option>
            <option value="recurring">Répéter</option>
          </select>
        ) : (
          <div className="flex flex-wrap gap-2">
            {([["now", "Maintenant"], ["once", "Programmer"], ["recurring", "Répéter"]] as const).map(([valeur, libelle]) => (
              <button
                key={valeur}
                type="button"
                onClick={() => setQuand(valeur)}
                className={`pressable rounded-control border px-3 py-1.5 text-[11px] uppercase tracking-widest transition-colors ${
                  quand === valeur ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {libelle}
              </button>
            ))}
          </div>
        )}

          {quand === "once" && (
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                aria-label="Date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${champ} max-w-44`}
              />
              <input
                type="time"
                aria-label="Heure"
                value={heure}
                onChange={(e) => setHeure(e.target.value)}
                className={`${champ} max-w-32`}
              />
              <span className="self-center text-xs text-muted-foreground">{FUSEAU_PAR_DEFAUT}</span>
            </div>
          )}

          {quand === "recurring" && (
            <div className="flex flex-col gap-2">
              <select
                aria-label="Fréquence"
                value={freq}
                onChange={(e) => setFreq(e.target.value as FrequenceRecurrence)}
                className={champ}
              >
                <option value="daily">Tous les jours</option>
                <option value="weekly">Certains jours de la semaine</option>
                <option value="monthly">Tous les mois</option>
              </select>
              {freq === "weekly" && (
                <div className="flex flex-wrap gap-1.5">
                  {JOURS.map((j, index) => (
                    <button
                      key={j.iso}
                      type="button"
                      aria-label={`Jour ${j.iso}`}
                      aria-pressed={jours.includes(j.iso)}
                      onClick={() => basculerJour(j.iso)}
                      className={`pressable h-9 w-9 rounded-control border text-xs uppercase transition-colors ${
                        jours.includes(j.iso) ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-primary"
                      }`}
                    >
                      {JOURS[index].court}
                    </button>
                  ))}
                </div>
              )}
              {freq === "monthly" && (
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={jourDuMois}
                  onChange={(e) => setJourDuMois(Number(e.target.value))}
                  className={`${champ} max-w-24`}
                  aria-label="Jour du mois"
                />
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  type="time"
                  aria-label="Heure"
                  value={heure}
                  onChange={(e) => setHeure(e.target.value)}
                  className={`${champ} max-w-32`}
                />
                <span className="self-center text-xs text-muted-foreground">{FUSEAU_PAR_DEFAUT}</span>
              </div>
            </div>
          )}
      </div>

      {/* ── Confirmation d'envoi global ─────────────────────────── */}
      {confirmation ? (
        <div className="rounded-control border border-primary/60 bg-surface-soft/40 p-4">
          <p className="mb-3 text-sm text-foreground">
            Envoyer cette notification à {audience?.cibles ?? 0} élève{(audience?.cibles ?? 0) > 1 ? "s" : ""} ?
            <br />
            <span className="text-muted-foreground">
              {audience?.joignables ?? 0} actuellement joignable{(audience?.joignables ?? 0) > 1 ? "s" : ""} sur{" "}
              {audience?.appareils ?? 0} appareil{(audience?.appareils ?? 0) > 1 ? "s" : ""}.
            </span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmation(false)}
              className="pressable rounded-control border border-border px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void envoyer()}
              disabled={envoi}
              className="pressable rounded-control border border-primary px-4 py-2 text-[11px] uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
            >
              {envoi ? "Envoi…" : "Envoyer"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          // Étiquette stable : en mode complet, « Programmer » désigne AUSSI
          // un bouton de mode. Sans elle, rien ne distingue l'action de la
          // sélection — ni pour un lecteur d'écran, ni pour un test.
          aria-label="Valider la notification"
          onClick={demanderEnvoi}
          disabled={envoi || !pretACibler || titre.trim().length === 0 || corps.trim().length === 0}
          className="pressable flex min-h-11 w-fit items-center justify-center gap-2 rounded-control border border-primary px-5 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Send size={14} aria-hidden="true" />
          {envoi ? "Envoi…" : libelleAction}
        </button>
      )}

      {resume && <p className="text-xs text-muted-foreground">{resume}</p>}
    </div>
  );
}
