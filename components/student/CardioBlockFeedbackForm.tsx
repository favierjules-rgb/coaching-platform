"use client";

import { PAIN_LEVELS, type CardioBlockDraft, type CardioBlockPrescribedSnapshot, type PainLevel } from "@/lib/cardio-feedback";
import { formatDistanceMeters, formatDurationSeconds } from "@/lib/cardio";

const inputClass =
  "min-h-[44px] w-full rounded-control border border-border bg-background px-4 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

const rpeOptions = Array.from({ length: 10 }, (_, index) => index + 1);

/**
 * « Réalisation du bloc » — formulaire de retour d'UN bloc cardio, rendu
 * sous la carte du bloc concerné (retour bloc par bloc, 25/07/2026).
 * Entièrement contrôlé : l'état vit dans SessionFeedbackSection (map par
 * blockId stable) — modifier un bloc ne touche jamais les brouillons des
 * autres. Repères = valeurs prescrites de CE bloc uniquement. Champs
 * adaptés au contenu : répétitions terminées seulement si le bloc en
 * prescrit ; dénivelé seulement si prescrit OU déjà saisi.
 */
export function CardioBlockFeedbackForm({
  blockId,
  blockLabel,
  prescribed,
  draft,
  error,
  onChange,
}: {
  blockId: string;
  blockLabel: string;
  prescribed: CardioBlockPrescribedSnapshot;
  draft: CardioBlockDraft;
  error: string | null;
  onChange: (next: CardioBlockDraft) => void;
}) {
  const patch = (partial: Partial<CardioBlockDraft>) => onChange({ ...draft, ...partial });
  const id = (suffix: string) => `cardio-${blockId}-${suffix}`;
  const showRepetitions = prescribed.repetitions !== null;
  const showElevation = prescribed.elevationGainMeters !== null || draft.elevation !== "";

  return (
    <div className="rounded-panel border border-border bg-surface-soft/40 p-5">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-foreground">
        Réalisation du bloc
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">{blockLabel}</p>

      <div className="flex flex-col gap-4">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-control border border-border bg-background px-4 py-2.5 text-sm text-foreground transition-colors focus-within:ring-2 focus-within:ring-primary/40 hover:border-border-strong">
          <input
            type="checkbox"
            checked={draft.completed}
            onChange={(event) => patch({ completed: event.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          Bloc terminé
        </label>

        <fieldset>
          <legend className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Durée réalisée
            {prescribed.durationSeconds !== null && (
              <span className="ml-2 normal-case tracking-normal">(prévu : {formatDurationSeconds(prescribed.durationSeconds)})</span>
            )}
          </legend>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ["h", "Heures", draft.hours, (v: string) => patch({ hours: v })],
                ["min", "Minutes", draft.minutes, (v: string) => patch({ minutes: v })],
                ["s", "Secondes", draft.seconds, (v: string) => patch({ seconds: v })],
              ] as const
            ).map(([suffix, label, value, set]) => (
              <label key={suffix} className="flex min-w-0 flex-col gap-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                {label}
                <input inputMode="numeric" value={value} onChange={(event) => set(event.target.value)} placeholder="0" className={inputClass} />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={id("distance")} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              Distance réalisée (km)
              {prescribed.distanceMeters !== null && (
                <span className="ml-2 normal-case tracking-normal">(prévu : {formatDistanceMeters(prescribed.distanceMeters)})</span>
              )}
            </label>
            <input
              id={id("distance")}
              inputMode="decimal"
              value={draft.distanceKm}
              onChange={(event) => patch({ distanceKm: event.target.value })}
              placeholder="Ex : 3,3"
              className={inputClass}
            />
          </div>
          {showRepetitions && (
            <div className="min-w-0">
              <label htmlFor={id("reps")} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Répétitions terminées
                <span className="ml-2 normal-case tracking-normal">(prévu : {prescribed.repetitions})</span>
              </label>
              <input
                id={id("reps")}
                inputMode="numeric"
                value={draft.repetitionsDone}
                onChange={(event) => patch({ repetitionsDone: event.target.value })}
                placeholder={`Ex : ${prescribed.repetitions}`}
                className={inputClass}
              />
            </div>
          )}
          {showElevation && (
            <div className="min-w-0">
              <label htmlFor={id("deniv")} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Dénivelé réalisé (m)
                {prescribed.elevationGainMeters !== null && (
                  <span className="ml-2 normal-case tracking-normal">(prévu : {prescribed.elevationGainMeters} m)</span>
                )}
              </label>
              <input
                id={id("deniv")}
                inputMode="numeric"
                value={draft.elevation}
                onChange={(event) => patch({ elevation: event.target.value })}
                placeholder="Ex : 320"
                className={inputClass}
              />
            </div>
          )}
          <div className="min-w-0">
            <label htmlFor={id("rpe")} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              RPE du bloc
              <span className="ml-2 normal-case tracking-normal">(difficulté de CE segment)</span>
            </label>
            <select
              id={id("rpe")}
              value={draft.rpe}
              onChange={(event) => patch({ rpe: event.target.value })}
              className={`${inputClass} appearance-none`}
            >
              <option value="">Non renseigné</option>
              {rpeOptions.map((value) => (
                <option key={value} value={value}>
                  {value} / 10
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor={id("pain")} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              Douleur ou gêne sur ce bloc
            </label>
            <select
              id={id("pain")}
              value={draft.painLevel}
              onChange={(event) => patch({ painLevel: event.target.value as PainLevel })}
              className={`${inputClass} appearance-none`}
            >
              {PAIN_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level === "aucune" ? "Aucune" : `Gêne ${level}`}
                </option>
              ))}
            </select>
          </div>
          {draft.painLevel !== "aucune" && (
            <div className="min-w-0">
              <label htmlFor={id("pain-detail")} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Où / comment ? (optionnel)
              </label>
              <input
                id={id("pain-detail")}
                value={draft.painDetail}
                onChange={(event) => patch({ painDetail: event.target.value })}
                placeholder="Ex : mollet droit dans les descentes"
                className={inputClass}
              />
            </div>
          )}
        </div>

        <div>
          <label htmlFor={id("comment")} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Commentaire sur ce bloc
          </label>
          <textarea
            id={id("comment")}
            rows={2}
            value={draft.comment}
            onChange={(event) => patch({ comment: event.target.value })}
            placeholder="Ex : dernière répétition non terminée."
            className={`${inputClass} resize-none py-3`}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
