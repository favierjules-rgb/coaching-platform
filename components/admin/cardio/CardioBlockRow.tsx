"use client";

import { useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";

import { Field, SelectField } from "@/components/admin/AdminFormFields";
import { ColorKeyPicker } from "@/components/ui/ColorKeyPicker";
import type { ColorKey } from "@/lib/ui/color-keys";
import { cibleDuSegment } from "@/lib/cardio-zones";
import { ZONES, type ReferencesAthlete, type ReglagesZones } from "@/lib/zones-physiologiques";
import {
  blankCardioSegment,
  cardioSegmentTypeLabels,
  cardioTypeLabels,
  formatSpeed,
  intensityTargetTypeLabels,
  machineTypeLabels,
  segmentIntensityPreview,
} from "@/lib/cardio";
import type {
  AdminCardioBlock,
  AdminCardioSegment,
  CardioSegmentType,
  CardioType,
  IntensityTargetType,
  MachineType,
  SportCardio,
} from "@/types";

/**
 * Sports proposés, exactement ceux du CHECK `training_blocks_sport_check`.
 *
 * ⚠️ L'OPTION VIDE EST LA PREMIÈRE, ET ELLE N'EST PAS UN OUBLI. Choisir
 * « Course » par défaut prescrirait un sport que le coach n'a pas dit, et les
 * conversions de zones s'aligneraient dessus sans qu'il l'ait voulu.
 */
const OPTIONS_SPORT: readonly { readonly value: string; readonly label: string }[] = [
  { value: "", label: "Sport non renseigné" },
  { value: "course", label: "Course" },
  { value: "velo", label: "Vélo" },
  { value: "natation", label: "Natation" },
  { value: "autre", label: "Autre" },
];

/**
 * LES FORMULAIRES CARDIO DU BUILDER — bloc et segments.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL EST SÉPARÉ
 * ════════════════════════════════════════════════════════════════════════
 * Ces deux composants vivaient dans `components/admin/ProgramBuilder.tsx`, au
 * milieu du builder de musculation. Ce voisinage avait un coût mesurable : toute
 * évolution du cardio faisait rouvrir — et risquer — un fichier de mille lignes
 * dont la moitié n'a rien à voir avec l'endurance, et dont les tests de
 * régression portent sur la musculation.
 *
 * ⚠️ CE DÉPLACEMENT EST UN DÉPLACEMENT, PAS UNE RÉÉCRITURE. Le corps des deux
 * composants est identique à l'octet près à ce qu'il était dans
 * `ProgramBuilder.tsx` ; seuls les imports ont suivi. C'est vérifié par
 * `scripts/tests/extraction-cardio.mts`, qui refuse aussi que le cardio revienne
 * dans le builder de musculation.
 *
 * ⚠️ LE BUILDER MUSCULATION N'EST PAS MODIFIÉ FONCTIONNELLEMENT. `DayCard`
 * importe désormais `CardioBlockRow` d'ici au lieu de le déclarer ; rien
 * d'autre ne change côté musculation.
 */

/**
 * La consigne d'un segment, traduite pour UN athlète.
 *
 * ⚠️ IL NE CALCULE RIEN LUI-MÊME. Tout vient de `cibleDuSegment`
 * (lib/cardio-zones.ts), donc des mêmes fonctions que l'écran de l'athlète :
 * ce que le coach voit en construisant est EXACTEMENT ce que l'athlète lira.
 */
function CibleResolueApercu({
  segment,
  sport,
  references,
  reglagesZones,
}: {
  readonly segment: AdminCardioSegment;
  readonly sport?: SportCardio;
  readonly references: ReferencesAthlete;
  readonly reglagesZones?: ReglagesZones;
}) {
  const cible = cibleDuSegment(segment, sport, references, reglagesZones);
  if (segment.intensityTargetType === "free") return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="text-foreground">{cible.consigne}</span>
      {cible.valeurs.length > 0 ? ` — ${cible.valeurs.join(" · ")}` : ""}
      {cible.sportManquant && (
        <span className="ml-1 text-amber-300">
          — sport du bloc non renseigné : aucune conversion n&apos;est faite.
        </span>
      )}
      {cible.referenceManquante && !cible.sportManquant && (
        <span className="ml-1 text-amber-300">
          — référence physiologique absente chez cet athlète : rien n&apos;est déduit.
        </span>
      )}
    </p>
  );
}

export function CardioSegmentRow({
  segment,
  referenceVmaKmh,
  sport,
  references,
  reglagesZones,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDropTarget = false,
}: {
  segment: AdminCardioSegment;
  referenceVmaKmh: number;
  /** Sport du bloc parent — sans lui, aucune zone n'est convertie. */
  sport?: SportCardio;
  /**
   * Références physiologiques de L'ATHLÈTE, quand le bloc est édité pour un
   * athlète précis (builder cardio, calendrier). Absentes dans le builder de
   * programme MODÈLE : il n'y a alors pas d'athlète, donc rien à convertir, et
   * inventer une VMA « moyenne » afficherait des allures qui n'appartiennent à
   * personne.
   */
  references?: ReferencesAthlete;
  reglagesZones?: ReglagesZones;
  onChange: (partial: Partial<AdminCardioSegment>) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
  onDragStart: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  // Feedback visuel additif, voir le même commentaire dans ExerciseRow.
  onDragEnd?: () => void;
  isDropTarget?: boolean;
}) {
  const isRepeat = segment.segmentType === "repeat_group";
  const preview = segmentIntensityPreview(segment, referenceVmaKmh);
  const showPreview =
    segment.intensityTargetType === "vma_percentage" ||
    segment.intensityTargetType === "speed_kmh" ||
    segment.intensityTargetType === "pace";

  return (
    <div
      className={`border bg-background/30 p-3 transition-colors ${isDropTarget ? "border-dashed border-primary/70" : "border-border/60"}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span
            draggable
            onDragStart={onDragStart}
            title="Glisser pour réordonner"
            className="cursor-grab text-muted-foreground hover:text-foreground"
          >
            <GripVertical size={12} />
          </span>
          Segment #{segment.order}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={isFirst}
            aria-label="Déplacer le segment vers le haut"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-30"
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={isLast}
            aria-label="Déplacer le segment vers le bas"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-30"
          >
            <ArrowDown size={13} />
          </button>
          <button type="button" onClick={onRemove} aria-label="Supprimer le segment" className="text-red-400 hover:text-red-300">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Titre (optionnel)" value={segment.title} onChange={(v) => onChange({ title: v })} placeholder="Ex : Corps de séance" />
        <SelectField
          label="Type"
          value={segment.segmentType}
          onChange={(v) => onChange({ segmentType: v as CardioSegmentType })}
          options={Object.entries(cardioSegmentTypeLabels).map(([value, label]) => ({ value, label }))}
        />

        {isRepeat && (
          <Field
            label="Répétitions"
            type="number"
            value={String(segment.repetitions ?? 1)}
            onChange={(v) => onChange({ repetitions: Number(v) || 1 })}
          />
        )}

        <Field
          label={isRepeat ? "Durée effort (s)" : "Durée (s)"}
          type="number"
          value={segment.durationSeconds !== undefined ? String(segment.durationSeconds) : ""}
          onChange={(v) => onChange({ durationSeconds: v ? Number(v) : undefined })}
        />
        <Field
          label={isRepeat ? "Distance effort (m)" : "Distance (m)"}
          type="number"
          value={segment.distanceMeters !== undefined ? String(segment.distanceMeters) : ""}
          onChange={(v) => onChange({ distanceMeters: v ? Number(v) : undefined })}
        />

        {isRepeat && (
          <>
            <Field
              label="Durée récup (s)"
              type="number"
              value={segment.recoveryDurationSeconds !== undefined ? String(segment.recoveryDurationSeconds) : ""}
              onChange={(v) => onChange({ recoveryDurationSeconds: v ? Number(v) : undefined })}
            />
            <Field
              label="Distance récup (m)"
              type="number"
              value={segment.recoveryDistanceMeters !== undefined ? String(segment.recoveryDistanceMeters) : ""}
              onChange={(v) => onChange({ recoveryDistanceMeters: v ? Number(v) : undefined })}
            />
          </>
        )}

        <Field
          label="Dénivelé + (m)"
          type="number"
          value={segment.elevationGainMeters !== undefined ? String(segment.elevationGainMeters) : ""}
          onChange={(v) => onChange({ elevationGainMeters: v ? Number(v) : undefined })}
        />
        <Field
          label="Inclinaison (%)"
          type="number"
          value={segment.inclinePercentage !== undefined ? String(segment.inclinePercentage) : ""}
          onChange={(v) => onChange({ inclinePercentage: v ? Number(v) : undefined })}
        />
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label="Intensité ciblée"
            value={segment.intensityTargetType}
            onChange={(v) => onChange({ intensityTargetType: v as IntensityTargetType })}
            options={Object.entries(intensityTargetTypeLabels).map(([value, label]) => ({ value, label }))}
          />

          {segment.intensityTargetType === "vma_percentage" && (
            <Field
              label="% VMA"
              type="number"
              value={segment.targetVmaPercentage !== undefined ? String(segment.targetVmaPercentage) : ""}
              onChange={(v) => onChange({ targetVmaPercentage: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "speed_kmh" && (
            <Field
              label="Vitesse (km/h)"
              type="number"
              step="0.1"
              value={segment.targetSpeedKmh !== undefined ? String(segment.targetSpeedKmh) : ""}
              onChange={(v) => onChange({ targetSpeedKmh: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "pace" && (
            <Field
              label="Allure (s/km)"
              type="number"
              value={segment.targetPaceSecondsPerKm !== undefined ? String(segment.targetPaceSecondsPerKm) : ""}
              onChange={(v) => onChange({ targetPaceSecondsPerKm: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "heart_rate_percentage" && (
            <Field
              label="% FC max"
              type="number"
              value={segment.targetHrPercentage !== undefined ? String(segment.targetHrPercentage) : ""}
              onChange={(v) => onChange({ targetHrPercentage: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "heart_rate_zone" && (
            <Field label="Zone FC (ex : Z2)" value={segment.targetHrZone ?? ""} onChange={(v) => onChange({ targetHrZone: v || undefined })} />
          )}
          {segment.intensityTargetType === "power" && (
            <Field
              label="Puissance (W)"
              type="number"
              value={segment.targetPowerWatts !== undefined ? String(segment.targetPowerWatts) : ""}
              onChange={(v) => onChange({ targetPowerWatts: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "rpe" && (
            <Field
              // Borne 0-10 CONSERVÉE : celle de
              // training_prescriptions_target_rpe_check, où 0 veut dire « au
              // repos » pour un segment cardio. Seul le pas change.
              label="RPE (0-10, pas de 0,5)"
              type="number"
              step="0.5"
              value={segment.intensityMin !== undefined ? String(segment.intensityMin) : ""}
              onChange={(v) => onChange({ intensityMin: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "zone" && (
            <SelectField
              label="Zone"
              value={segment.targetZone !== undefined ? String(segment.targetZone) : ""}
              onChange={(v) => onChange({ targetZone: v ? Number(v) : undefined })}
              options={[
                { value: "", label: "— choisir —" },
                ...ZONES.map((zone) => ({ value: String(zone), label: `Z${zone}` })),
              ]}
            />
          )}
          {(segment.intensityTargetType === "ftp_percentage" || segment.intensityTargetType === "pma_percentage") && (
            <Field
              label={segment.intensityTargetType === "ftp_percentage" ? "% FTP" : "% PMA"}
              type="number"
              value={segment.targetPowerPercentage !== undefined ? String(segment.targetPowerPercentage) : ""}
              onChange={(v) => onChange({ targetPowerPercentage: v ? Number(v) : undefined })}
            />
          )}
        </div>

        {/*
          ⚠️ DEUX APERÇUS, ET ILS NE DISENT PAS LA MÊME CHOSE.
          · Avec les références d'un ATHLÈTE (builder cardio, calendrier), la
            consigne est traduite en valeurs qui lui appartiennent — et l'absence
            de sport ou de référence est DITE, jamais comblée.
          · Sans athlète (builder de programme MODÈLE), l'aperçu historique reste
            affiché tel quel, avec sa VMA de référence explicitement nommée.
        */}
        {references ? (
          <CibleResolueApercu
            segment={segment}
            sport={sport}
            references={references}
            reglagesZones={reglagesZones}
          />
        ) : (
          showPreview && (
            <p className="mt-2 text-xs text-muted-foreground">
              Aperçu (VMA réf. {referenceVmaKmh} km/h) : {formatSpeed(preview.speedKmh)}
              {preview.paceLabel ? ` — ${preview.paceLabel}` : ""}
            </p>
          )
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Cadence cible (spm, optionnel)"
          type="number"
          value={segment.targetCadence !== undefined ? String(segment.targetCadence) : ""}
          onChange={(v) => onChange({ targetCadence: v ? Number(v) : undefined })}
        />
        <Field label="Notes" value={segment.coachNotes ?? ""} onChange={(v) => onChange({ coachNotes: v || undefined })} />
      </div>
    </div>
  );
}

export function CardioBlockRow({
  block,
  referenceVmaKmh,
  references,
  reglagesZones,
  colorKey,
  onColorKeyChange,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
  // Chantier multi-blocs (Lot 4.2) : quand ce bloc cardio est édité DANS une
  // carte multi-blocs (TrainingBlockCard), la carte fournit déjà titre, numéro
  // d'ordre et actions Monter/Descendre/Supprimer. `showBlockChrome={false}`
  // masque alors l'en-tête et le champ Titre de CE composant, sans dupliquer la
  // logique des segments (prescriptions). Défaut `true` : l'usage legacy
  // (DayCard) reste strictement inchangé.
  showBlockChrome = true,
}: {
  block: AdminCardioBlock;
  referenceVmaKmh: number;
  /** Références de l'athlète — voir `CardioSegmentRow`. */
  references?: ReferencesAthlete;
  reglagesZones?: ReglagesZones;
  /**
   * Couleur du bloc, quand l'appelant la gère (`training_blocks.color_key`).
   * Absente, le sélecteur n'est pas affiché : le builder legacy ne porte pas
   * cette donnée dans `AdminCardioBlock`, et afficher un sélecteur sans effet
   * serait un piège.
   */
  colorKey?: string;
  onColorKeyChange?: (couleur: string) => void;
  onChange: (updated: AdminCardioBlock) => void;
  onRemove?: () => void;
  onMove?: (direction: "up" | "down") => void;
  isFirst?: boolean;
  isLast?: boolean;
  showBlockChrome?: boolean;
}) {
  function updateSegment(index: number, partial: Partial<AdminCardioSegment>) {
    const segments = block.segments.map((s, i) => (i === index ? { ...s, ...partial } : s));
    onChange({ ...block, segments });
  }

  function removeSegment(index: number) {
    const segments = block.segments.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 }));
    onChange({ ...block, segments });
  }

  function moveSegment(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= block.segments.length) return;
    const segments = [...block.segments];
    [segments[index], segments[targetIndex]] = [segments[targetIndex], segments[index]];
    onChange({ ...block, segments: segments.map((s, i) => ({ ...s, order: i + 1 })) });
  }

  function addSegment() {
    onChange({ ...block, segments: [...block.segments, blankCardioSegment(block.segments.length + 1)] });
  }

  // Réordonnancement par glisser-déposer (en plus des flèches haut/bas
  // conservées pour l'accessibilité clavier) — l'index source est retenu
  // dans une ref le temps du drag, sans re-render intermédiaire.
  const dragSegmentIndex = useRef<number | null>(null);
  // Feedback visuel de la cible de dépôt courante (même principe que
  // dragOverSessionId dans ProgramBuilderFullscreen.tsx) — purement
  // additif, n'intervient pas dans le calcul de réordonnancement.
  const [dragOverSegmentIndex, setDragOverSegmentIndex] = useState<number | null>(null);

  function reorderSegments(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const segments = [...block.segments];
    const [moved] = segments.splice(fromIndex, 1);
    segments.splice(toIndex, 0, moved);
    onChange({ ...block, segments: segments.map((s, i) => ({ ...s, order: i + 1 })) });
  }

  return (
    <div className="border border-border p-4">
      {showBlockChrome && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Bloc cardio #{block.order}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onMove?.("up")}
              disabled={isFirst}
              aria-label="Déplacer le bloc cardio vers le haut"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-30"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => onMove?.("down")}
              disabled={isLast}
              aria-label="Déplacer le bloc cardio vers le bas"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-30"
            >
              <ArrowDown size={14} />
            </button>
            <button type="button" onClick={() => onRemove?.()} aria-label="Supprimer le bloc cardio" className="text-red-400 hover:text-red-300">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}

      <div className={`mb-4 grid grid-cols-1 gap-3 ${showBlockChrome ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {showBlockChrome && (
          <Field label="Titre du bloc" value={block.title} onChange={(v) => onChange({ ...block, title: v })} placeholder="Ex : Séance VMA" />
        )}
        <SelectField
          label="Type de cardio"
          value={block.cardioType}
          onChange={(v) => onChange({ ...block, cardioType: v as CardioType })}
          options={Object.entries(cardioTypeLabels).map(([value, label]) => ({ value, label }))}
        />
        <SelectField
          label="Machine (si salle)"
          value={block.machineType ?? ""}
          onChange={(v) => onChange({ ...block, machineType: (v || undefined) as MachineType | undefined })}
          options={[
            { value: "", label: "Extérieur / course à pied" },
            ...Object.entries(machineTypeLabels).map(([value, label]) => ({ value, label })),
          ]}
        />
        <SelectField
          label="Sport"
          value={block.sport ?? ""}
          onChange={(v) => onChange({ ...block, sport: (v || undefined) as SportCardio | undefined })}
          options={OPTIONS_SPORT.map((option) => ({ value: option.value, label: option.label }))}
        />
        <Field
          label="Séries du bloc"
          type="number"
          value={block.rounds !== undefined ? String(block.rounds) : ""}
          onChange={(v) => onChange({ ...block, rounds: v ? Number(v) : undefined })}
          placeholder="ex : 3"
        />
        {colorKey !== undefined && onColorKeyChange && (
          <div>
            <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Couleur</span>
            <ColorKeyPicker
              value={(colorKey || "gray") as ColorKey}
              onChange={(couleur) => onColorKeyChange(couleur ?? "gray")}
              ariaLabel="Couleur du bloc cardio"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {block.segments.map((segment, i) => (
          <CardioSegmentRow
            key={segment.id}
            segment={segment}
            referenceVmaKmh={referenceVmaKmh}
            sport={block.sport}
            references={references}
            reglagesZones={reglagesZones}
            onChange={(partial) => updateSegment(i, partial)}
            onRemove={() => removeSegment(i)}
            onMove={(dir) => moveSegment(i, dir)}
            isFirst={i === 0}
            isLast={i === block.segments.length - 1}
            isDropTarget={dragOverSegmentIndex === i}
            onDragStart={() => {
              dragSegmentIndex.current = i;
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOverSegmentIndex(i);
            }}
            onDrop={() => {
              if (dragSegmentIndex.current !== null) {
                reorderSegments(dragSegmentIndex.current, i);
                dragSegmentIndex.current = null;
              }
              setDragOverSegmentIndex(null);
            }}
            onDragEnd={() => {
              dragSegmentIndex.current = null;
              setDragOverSegmentIndex(null);
            }}
          />
        ))}
        <button
          type="button"
          onClick={addSegment}
          className="flex items-center justify-center gap-2 border border-dashed border-border py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus size={13} />
          Ajouter un segment
        </button>
      </div>
    </div>
  );
}
