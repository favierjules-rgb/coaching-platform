"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, TriangleAlert } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getProgramStartDate, setProgramStartDate } from "@/lib/supabase/programs";

/**
 * LA DATE DE DÉBUT D'UN PROGRAMME DÉJÀ AFFECTÉ — lecture, saisie, correction.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE CHAMP EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Au moment de ce lot, 14 affectations sur 15 n'avaient aucune date de début :
 * elles sont antérieures à la colonne. Aucune n'a été remplie automatiquement
 * — `assigned_at` aurait annoncé la semaine 2 là où la réponse validée était
 * la semaine 4. Ce champ est le seul chemin par lequel la vérité entre.
 *
 * ⚠️ IL AFFICHE L'ABSENCE AU LIEU DE LA MASQUER. Sans date, le calcul retombe
 * sur `students.start_date` — l'ancienne ancre, celle qui annonçait « Semaine
 * 5 / 12 » à une élève ayant reçu son programme le jour même. Ce repli est
 * transitoire et doit se voir : c'est l'avertissement orange ci-dessous, et
 * c'est ce qui empêche 14 affectations de rester fausses en silence.
 *
 * ⚠️ VIDER LE CHAMP EST UNE ACTION LÉGITIME, pas un bug. Un coach qui a saisi
 * une date fausse doit pouvoir la retirer et revenir à l'état « non
 * régularisé », visible — plutôt que de garder une date qu'il sait mauvaise.
 */
export function ProgramStartDateField({
  studentId,
  programId,
  actif,
  onChargee,
}: {
  studentId: string;
  programId: string;
  /** false = ne rien interroger (élève ou programme de démonstration). */
  actif: boolean;
  /**
   * Remonte la date au parent — à la lecture ET après chaque enregistrement.
   *
   * ⚠️ SANS CELA, LA FICHE AFFICHERAIT UNE SEMAINE PÉRIMÉE. Le bandeau
   * « Semaine N (actuelle) » vit dans la page parente ; si la date change ici
   * sans remonter, l'admin corrigerait une date et verrait le vieux numéro.
   */
  onChargee?: (date: string | null) => void;
}) {
  const [valeur, setValeur] = useState<string>("");
  const [enregistree, setEnregistree] = useState<string | null>(null);
  // ⚠️ L'ÉTAT INITIAL DÉPEND DE `actif`, ET IL EST CALCULÉ AU PREMIER RENDU.
  // Le poser depuis l'effet (« si inactif, alors prête ») serait un setState
  // synchrone, donc un second rendu immédiat — ce que la règle
  // `react-hooks/set-state-in-effect` du dépôt refuse, à juste titre : rien
  // n'a besoin d'être chargé quand il n'y a rien à charger.
  // ⚠️ INITIALISEUR PARESSEUX : les deux cas « rien à charger » (composant
  // inactif, Supabase non configuré) sont connus dès le premier rendu. Les
  // découvrir depuis l'effet obligerait à un setState synchrone — un second
  // rendu pour une information qu'on avait déjà.
  const [etat, setEtat] = useState<"chargement" | "prete" | "erreur">(() => {
    if (!actif) return "prete";
    return createSupabaseBrowserClient() ? "chargement" : "erreur";
  });
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!actif) return;
    let annule = false;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    void getProgramStartDate(supabase, studentId, programId)
      .then((date) => {
        if (annule) return;
        setEnregistree(date);
        setValeur(date ?? "");
        setEtat("prete");
        onChargee?.(date);
      })
      .catch(() => {
        if (!annule) setEtat("erreur");
      });
    return () => {
      annule = true;
    };
  }, [actif, studentId, programId, onChargee]);

  const enregistrer = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setEnCours(true);
    // ⚠️ CHAÎNE VIDE → `null`, ET NON `""`. La colonne est `date` : une chaîne
    // vide y serait refusée par PostgreSQL, et « pas de date » a déjà sa
    // représentation.
    const aEcrire = valeur.trim() === "" ? null : valeur;
    const ok = await setProgramStartDate(supabase, studentId, programId, aEcrire);
    setEnCours(false);
    if (ok) {
      setEnregistree(aEcrire);
      onChargee?.(aEcrire);
    } else {
      setEtat("erreur");
    }
  }, [studentId, programId, valeur, onChargee]);

  if (etat === "chargement") {
    return <p className="mt-3 text-xs text-muted-foreground">Chargement de la date de début…</p>;
  }

  const modifiee = (enregistree ?? "") !== valeur;

  return (
    <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
      <label
        htmlFor={`debut-${programId}`}
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
      >
        <CalendarClock size={12} aria-hidden="true" />
        Date de début du programme
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`debut-${programId}`}
          type="date"
          value={valeur}
          disabled={!actif || enCours}
          onChange={(event) => setValeur(event.target.value)}
          className="min-h-[44px] flex-1 rounded-control border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!actif || enCours || !modifiee}
          onClick={() => void enregistrer()}
          className="pressable min-h-[44px] rounded-control border border-primary px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40"
        >
          {enCours ? "…" : "Enregistrer"}
        </button>
      </div>

      {enregistree === null && (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-warning">
          <TriangleAlert size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          Aucune date enregistrée : la semaine affichée à l&apos;élève est calculée sur sa date
          d&apos;inscription, ce qui la fausse. Renseigne la vraie date de début.
        </p>
      )}
      {etat === "erreur" && (
        <p className="text-xs text-destructive">L&apos;enregistrement a échoué. Réessaie.</p>
      )}
    </div>
  );
}
