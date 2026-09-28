"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { CheckboxField, Field, TextareaField } from "@/components/admin/AdminFormFields";
import { SessionBlockList } from "@/components/admin/blocks/SessionBlockList";
import { LIBELLE_TYPE, refusDEnregistrement, seanceDeTravail, typeAffiche, type MetaSeance } from "@/lib/calendrier-composition";
import type { BuilderWorkoutSession } from "@/lib/training-block-editing";
import type { ReferencesAthlete, ReglagesZones } from "@/lib/zones-physiologiques";
import type { ExerciseLibraryItem, TrainingBlock } from "@/types";

/**
 * ÉDITER UNE SÉANCE COMPLÈTE DANS LE CALENDRIER D'UN ATHLÈTE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * IL N'Y A PAS DEUX BUILDERS, ET IL NE FAUT PAS QU'IL Y EN AIT DEUX
 * ════════════════════════════════════════════════════════════════════════
 * Les blocs sont édités par `SessionBlockList` — LE MÊME composant que le builder
 * de programme. Réécrire ici un éditeur de musculation aurait produit deux
 * comportements qui divergent au premier correctif : deux façons d'ajouter un
 * exercice, deux façons de déplacer un bloc, deux bugs à corriger deux fois.
 *
 * ⚠️ CE QUE CET ÉCRAN AJOUTE, C'EST L'ATHLÈTE. `references` / `reglagesZones`
 * descendent jusqu'aux segments cardio : les valeurs calculées affichées sont
 * CELLES DE CET ÉLÈVE. Dans le builder de programme ces props sont absentes,
 * parce qu'un programme modèle n'appartient à personne.
 *
 * ⚠️ IL RENVOIE TOUS LES BLOCS, ET DOIT DONC ÊTRE ENREGISTRÉ EN PORTÉE « all ».
 * C'est légitime ICI et seulement ici : le payload contient la séance ENTIÈRE,
 * musculation comprise, donc rien ne peut être supprimé par omission. L'éditeur
 * cardio (`EditeurBlocsCardio`) reste le chemin de portée « cardio », où la
 * musculation N'EST PAS dans le payload — et c'est cette absence qui la protège.
 * Confondre les deux réintroduirait exactement le défaut fermé par `SaveScope`.
 */

export interface EnregistrementSeance {
  readonly meta: MetaSeance;
  /** TOUS les blocs de la séance, positions renumérotées 0..n-1 par le builder. */
  readonly blocks: TrainingBlock[];
  readonly dansLaBibliotheque: boolean;
}

export function EditeurSeanceCalendrier({
  meta: metaInitiale,
  blocks: blocsInitiaux,
  library,
  references,
  reglagesZones,
  enCours = false,
  erreur = null,
  libelleAction = "Enregistrer la séance",
  onEnregistrer,
  onAnnuler,
}: {
  readonly meta: MetaSeance;
  readonly blocks: readonly TrainingBlock[];
  readonly library: ExerciseLibraryItem[];
  readonly references?: ReferencesAthlete;
  readonly reglagesZones?: ReglagesZones;
  readonly enCours?: boolean;
  readonly erreur?: string | null;
  readonly libelleAction?: string;
  readonly onEnregistrer: (enregistrement: EnregistrementSeance) => void;
  readonly onAnnuler?: () => void;
}) {
  const [session, setSession] = useState<BuilderWorkoutSession>(() =>
    seanceDeTravail({ meta: metaInitiale, blocks: blocsInitiaux }),
  );
  const [dansLaBibliotheque, setDansLaBibliotheque] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);

  const type = typeAffiche(session.blocks);

  function enregistrer() {
    const empechement = refusDEnregistrement(session);
    if (empechement) {
      setRefus(empechement);
      return;
    }
    setRefus(null);
    onEnregistrer({
      meta: {
        name: session.name.trim(),
        durationMinutes: session.durationMinutes > 0 ? session.durationMinutes : null,
        coachNotes: session.coachNotes,
      },
      blocks: session.blocks.map((bloc) => ({ ...bloc })),
      dansLaBibliotheque,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label="Nom de la séance"
          value={session.name}
          onChange={(v) => setSession((s) => ({ ...s, name: v }))}
          placeholder="Ex : Bas du corps + seuil"
        />
        <Field
          label="Durée prévue (min)"
          type="number"
          value={session.durationMinutes > 0 ? String(session.durationMinutes) : ""}
          onChange={(v) => setSession((s) => ({ ...s, durationMinutes: v ? Number(v) : 0 }))}
        />
        <div className="flex flex-col justify-end">
          <span className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">Type</span>
          <span className="inline-flex min-h-11 items-center rounded-control border border-border px-3 text-sm text-foreground">
            {LIBELLE_TYPE[type]}
            <span className="ml-2 text-[11px] text-muted-foreground">(déduit des blocs)</span>
          </span>
        </div>
      </div>

      <TextareaField
        label="Notes du coach"
        value={session.coachNotes}
        onChange={(v) => setSession((s) => ({ ...s, coachNotes: v }))}
        rows={2}
      />

      <SessionBlockList
        session={session}
        library={library}
        onSessionChange={setSession}
        references={references}
        reglagesZones={reglagesZones}
      />

      <CheckboxField
        label="Enregistrer également dans ma bibliothèque"
        checked={dansLaBibliotheque}
        onChange={setDansLaBibliotheque}
      />

      {(refus || erreur) && (
        <p className="flex items-start gap-2 text-xs text-red-400">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          {refus ?? erreur}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onAnnuler && (
          <button
            type="button"
            onClick={onAnnuler}
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-border px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
          >
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={enregistrer}
          disabled={enCours}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-6 py-2 text-[11px] font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
        >
          {enCours && <Loader2 size={13} className="animate-spin" />}
          {libelleAction}
        </button>
      </div>
    </div>
  );
}
