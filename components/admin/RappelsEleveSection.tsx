"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { definirRappelEleve, lireRappelsEleve, type RappelsDeLEleve } from "@/lib/supabase/rappels-eleve";
import { DEFINITIONS_RAPPEL, type GenreRappel } from "@/lib/rappels-automatiques";

/**
 * LES RAPPELS AUTOMATIQUES D'UN ÉLÈVE — deux interrupteurs, et rien de plus.
 *
 * ⚠️ CE QU'UN CLIC FAIT, ET TOUT CE QU'IL FAIT : ajouter ou retirer UNE ligne de
 * ciblage pour CET élève. Il ne touche ni l'heure, ni le texte, ni la
 * récurrence du rappel — ceux-ci appartiennent à la campagne système, qui n'est
 * modifiable par aucune interface (voir
 * app/api/admin/notifications/campaigns/[id]/route.ts).
 *
 * ⚠️ OFF VEUT DIRE « AUCUN RAPPEL AUTOMATIQUE », pas « rappel silencieux ». La
 * ligne de ciblage disparaît : le planificateur ne voit plus cet élève du tout.
 *
 * ⚠️ ON NE PROMET PAS UNE NOTIFICATION. Même activé, le rappel ne part que si la
 * condition du jour est remplie — séance prévue ET non terminée, ou journée
 * alimentaire incomplète. Le libellé le dit, pour qu'un coach ne conclue pas à
 * une panne un jour de repos.
 */

const LIBELLES: Readonly<Record<GenreRappel, { readonly titre: string; readonly detail: string }>> = {
  entrainement: {
    titre: "Rappel d'entraînement",
    detail: `Chaque matin à ${String(DEFINITIONS_RAPPEL.entrainement.heure).padStart(2, "0")}:${String(
      DEFINITIONS_RAPPEL.entrainement.minute,
    ).padStart(2, "0")}, seulement si une séance est prévue ce jour-là et qu'elle n'est pas déjà validée.`,
  },
  nutrition: {
    titre: "Rappel nutrition",
    detail: `Chaque soir à ${String(DEFINITIONS_RAPPEL.nutrition.heure).padStart(2, "0")}:${String(
      DEFINITIONS_RAPPEL.nutrition.minute,
    ).padStart(2, "0")}, seulement si la journée alimentaire est encore incomplète.`,
  },
};

export function RappelsEleveSection({ studentId }: { readonly studentId: string }) {
  const [actifs, setActifs] = useState<RappelsDeLEleve>({ entrainement: false, nutrition: false });
  const [disponible, setDisponible] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState<GenreRappel | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  /*
   * La lecture vit DANS l'effet, et pas dans un `useCallback` appelé par lui :
   * le chemin « Supabase non configuré » poserait alors l'état de façon
   * synchrone au premier rendu (react-hooks/set-state-in-effect). Rien d'autre
   * n'a besoin de la relancer — `basculer` met l'état à jour lui-même.
   */
  useEffect(() => {
    let annule = false;

    async function lire() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) {
          setDisponible(false);
          setChargement(false);
        }
        return;
      }
      const etat = await lireRappelsEleve(supabase, studentId);
      if (annule) return;
      setActifs(etat.actifs);
      setDisponible(etat.disponible);
      setChargement(false);
    }

    void lire();
    return () => {
      annule = true;
    };
  }, [studentId]);

  async function basculer(genre: GenreRappel) {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || enCours) return;
    setEnCours(genre);
    setErreur(null);
    const vise = !actifs[genre];
    // Optimiste, puis remis en place si la base refuse : un interrupteur qui
    // affiche ON sans avoir enregistré ferait croire le coach couvert.
    setActifs((avant) => ({ ...avant, [genre]: vise }));
    const ok = await definirRappelEleve(supabase, studentId, genre, vise);
    if (!ok) {
      setActifs((avant) => ({ ...avant, [genre]: !vise }));
      setErreur("Le réglage n'a pas pu être enregistré.");
    }
    setEnCours(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
          Rappels automatiques
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Notifications envoyées à l&apos;élève sur ses appareils abonnés. Aucun rappel n&apos;est envoyé
          si la condition du jour n&apos;est pas remplie.
        </p>
      </div>

      {chargement ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          Chargement des réglages…
        </p>
      ) : !disponible ? (
        /*
         * ⚠️ ON LE DIT PLUTÔT QUE D'AFFICHER DEUX INTERRUPTEURS MORTS. Les rails
         * système n'existent pas encore en base (migration non appliquée) :
         * proposer de cliquer produirait un échec silencieux.
         */
        <p className="text-xs text-warning">
          Les rappels automatiques ne sont pas encore configurés sur cette base.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(["entrainement", "nutrition"] as const).map((genre) => {
            const actif = actifs[genre];
            return (
              <li key={genre} className="flex items-start justify-between gap-3 rounded-control border border-border p-3">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{LIBELLES[genre].titre}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{LIBELLES[genre].detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void basculer(genre)}
                  disabled={enCours !== null}
                  aria-pressed={actif}
                  aria-label={`${LIBELLES[genre].titre} : ${actif ? "activé" : "désactivé"}`}
                  className={
                    actif
                      ? "pressable flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-control border border-success/50 bg-success/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-success transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40 disabled:opacity-50"
                      : "pressable flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-control border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
                  }
                >
                  {enCours === genre ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : actif ? (
                    <Bell size={11} />
                  ) : (
                    <BellOff size={11} />
                  )}
                  {actif ? "Activé" : "Désactivé"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {erreur && <p className="text-xs text-destructive">{erreur}</p>}
    </div>
  );
}
