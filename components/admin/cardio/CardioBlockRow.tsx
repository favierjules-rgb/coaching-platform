"use client";

import { useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";

import { Field, SelectField } from "@/components/admin/AdminFormFields";
import { generateId } from "@/lib/admin";
import { ColorKeyPicker } from "@/components/ui/ColorKeyPicker";
import type { ColorKey } from "@/lib/ui/color-keys";
import { cibleDuSegment } from "@/lib/cardio-zones";
import { formatMinutesSecondes, secondesDepuisMinutesSecondes } from "@/lib/physiologie";
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

/* ════════════════════════════════════════════════════════════════════════
 * LA LIGNE DE SEGMENT — COMPACTE PAR DÉFAUT, COMPLÈTE AU BESOIN
 * ════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ AUCUN CHAMP N'A ÉTÉ SUPPRIMÉ POUR GAGNER DE LA PLACE. Le formulaire
 * précédent affichait en permanence quatorze champs sur quatre rangées, ce qui
 * rendait une séance de six segments illisible. Ce qui change est la HIÉRARCHIE,
 * pas le contenu : la ligne montre ce qu'on lit en construisant (type, durée ou
 * distance, intensité, et ce que ça donne pour l'athlète) ; tout le reste —
 * titre, récupération, dénivelé, inclinaison, cadence, notes — vit dans le
 * dépliant, à un clic. Supprimer une donnée pour simplifier l'écran ferait
 * perdre des prescriptions déjà saisies.
 */

/** Champ de saisie minuscule — pas de label au-dessus, la ligne le porte. */
function ChampCompact({
  valeur,
  onChange,
  placeholder,
  largeur = "w-20",
  aria,
  type = "text",
  pas,
  invalide = false,
}: {
  readonly valeur: string;
  readonly onChange: (valeur: string) => void;
  readonly placeholder?: string;
  readonly largeur?: string;
  readonly aria: string;
  readonly type?: string;
  readonly pas?: string;
  readonly invalide?: boolean;
}) {
  return (
    <input
      aria-label={aria}
      type={type}
      step={pas}
      value={valeur}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`h-9 ${largeur} rounded-control border bg-background px-2 text-xs tabular-nums text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none ${
        invalide ? "border-red-500/70" : "border-border"
      }`}
    />
  );
}

/** Sélecteur minuscule — même gabarit que `ChampCompact`. */
function SelectCompact({
  valeur,
  onChange,
  options,
  aria,
  largeur = "w-36",
}: {
  readonly valeur: string;
  readonly onChange: (valeur: string) => void;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly aria: string;
  readonly largeur?: string;
}) {
  return (
    <select
      aria-label={aria}
      value={valeur}
      onChange={(event) => onChange(event.target.value)}
      className={`h-9 ${largeur} rounded-control border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Le contrôle de valeur qui accompagne le type d'intensité.
 *
 * ⚠️ UN SEUL CONTRÔLE À LA FOIS, ET C'EST CE QUI TIENT SUR UNE LIGNE. Chaque
 * type d'intensité a sa donnée propre : la zone va dans `targetZone`, le RPE
 * dans `intensityMin`, le pourcentage de puissance dans
 * `targetPowerPercentage`… Afficher les huit en permanence était le principal
 * coût de hauteur de l'ancien formulaire.
 */
function ValeurIntensite({
  segment,
  onChange,
}: {
  readonly segment: AdminCardioSegment;
  readonly onChange: (partial: Partial<AdminCardioSegment>) => void;
}) {
  const nombre = (valeur: string) => (valeur.trim() === "" ? undefined : Number(valeur.replace(",", ".")));

  switch (segment.intensityTargetType) {
    case "zone":
      return (
        <SelectCompact
          aria="Zone d'intensité"
          largeur="w-24"
          valeur={segment.targetZone !== undefined ? String(segment.targetZone) : ""}
          onChange={(v) => onChange({ targetZone: v ? Number(v) : undefined })}
          options={[{ value: "", label: "— zone —" }, ...ZONES.map((zone) => ({ value: String(zone), label: `Z${zone}` }))]}
        />
      );
    case "vma_percentage":
      return (
        <ChampCompact
          aria="Pourcentage de VMA"
          largeur="w-20"
          placeholder="% VMA"
          valeur={segment.targetVmaPercentage !== undefined ? String(segment.targetVmaPercentage) : ""}
          onChange={(v) => onChange({ targetVmaPercentage: nombre(v) })}
        />
      );
    case "ftp_percentage":
    case "pma_percentage":
      return (
        <ChampCompact
          aria={segment.intensityTargetType === "ftp_percentage" ? "Pourcentage de FTP" : "Pourcentage de PMA"}
          largeur="w-20"
          placeholder={segment.intensityTargetType === "ftp_percentage" ? "% FTP" : "% PMA"}
          valeur={segment.targetPowerPercentage !== undefined ? String(segment.targetPowerPercentage) : ""}
          onChange={(v) => onChange({ targetPowerPercentage: nombre(v) })}
        />
      );
    case "heart_rate_percentage":
      return (
        <ChampCompact
          aria="Pourcentage de FC max"
          largeur="w-20"
          placeholder="% FCmax"
          valeur={segment.targetHrPercentage !== undefined ? String(segment.targetHrPercentage) : ""}
          onChange={(v) => onChange({ targetHrPercentage: nombre(v) })}
        />
      );
    case "heart_rate_zone":
      return (
        <ChampCompact
          aria="Zone de fréquence cardiaque"
          largeur="w-24"
          placeholder="Zone 2"
          valeur={segment.targetHrZone ?? ""}
          onChange={(v) => onChange({ targetHrZone: v || undefined })}
        />
      );
    case "speed_kmh":
      return (
        <ChampCompact
          aria="Vitesse cible en km/h"
          largeur="w-20"
          placeholder="km/h"
          pas="0.1"
          valeur={segment.targetSpeedKmh !== undefined ? String(segment.targetSpeedKmh) : ""}
          onChange={(v) => onChange({ targetSpeedKmh: nombre(v) })}
        />
      );
    case "pace":
      return (
        <ChampAllure
          secondes={segment.targetPaceSecondsPerKm}
          onChange={(secondes) => onChange({ targetPaceSecondsPerKm: secondes })}
        />
      );
    case "power":
      return (
        <ChampCompact
          aria="Puissance cible en watts"
          largeur="w-20"
          placeholder="W"
          valeur={segment.targetPowerWatts !== undefined ? String(segment.targetPowerWatts) : ""}
          onChange={(v) => onChange({ targetPowerWatts: nombre(v) })}
        />
      );
    case "rpe":
      return (
        <ChampCompact
          /*
           * ⚠️ LE RPE CARDIO VIT DANS `intensityMin`, décision du 28/09/2026.
           * `target_rpe` existe en base mais n'est ni écrite ni lue par
           * l'application : y basculer ici créerait une seconde convention et
           * rendrait illisibles les prescriptions déjà posées.
           */
          aria="RPE cible"
          largeur="w-20"
          placeholder="RPE"
          pas="0.5"
          valeur={segment.intensityMin !== undefined ? String(segment.intensityMin) : ""}
          onChange={(v) => onChange({ intensityMin: nombre(v) })}
        />
      );
    default:
      return null;
  }
}

/** Allure saisie en mm:ss, stockée en secondes par km. */
function ChampAllure({
  secondes,
  onChange,
}: {
  readonly secondes?: number;
  readonly onChange: (secondes: number | undefined) => void;
}) {
  const [texte, setTexte] = useState(() => (secondes === undefined ? "" : formatMinutesSecondes(secondes)));
  const lu = secondesDepuisMinutesSecondes(texte);
  return (
    <ChampCompact
      aria="Allure cible (mm:ss par km)"
      largeur="w-20"
      placeholder="5:00"
      valeur={texte}
      invalide={texte.trim() !== "" && lu === null}
      onChange={(valeur) => {
        setTexte(valeur);
        if (valeur.trim() === "") onChange(undefined);
        else {
          const parse = secondesDepuisMinutesSecondes(valeur);
          if (parse !== null) onChange(parse);
        }
      }}
    />
  );
}

/**
 * Durée saisie en `mm:ss` (ou en secondes si on tape un nombre nu).
 *
 * ⚠️ « 600 » RESTE 600 SECONDES. Le parseur accepte les deux écritures : une
 * prescription déjà saisie en secondes ne change pas de sens parce que l'écran
 * l'affiche désormais « 10:00 ».
 */
function ChampDuree({
  secondes,
  onChange,
  aria,
}: {
  readonly secondes?: number;
  readonly onChange: (secondes: number | undefined) => void;
  readonly aria: string;
}) {
  const [texte, setTexte] = useState(() => (secondes === undefined ? "" : formatMinutesSecondes(secondes)));
  const lu = secondesDepuisMinutesSecondes(texte);
  return (
    <ChampCompact
      aria={aria}
      largeur="w-20"
      placeholder="mm:ss"
      valeur={texte}
      invalide={texte.trim() !== "" && lu === null}
      onChange={(valeur) => {
        setTexte(valeur);
        if (valeur.trim() === "") onChange(undefined);
        else {
          const parse = secondesDepuisMinutesSecondes(valeur);
          if (parse !== null) onChange(parse);
        }
      }}
    />
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
  onDuplicate,
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
   * athlète précis (calendrier). Absentes dans le builder de programme MODÈLE :
   * il n'y a alors pas d'athlète, donc rien à convertir, et inventer une VMA
   * « moyenne » afficherait des allures qui n'appartiennent à personne.
   */
  references?: ReferencesAthlete;
  reglagesZones?: ReglagesZones;
  onChange: (partial: Partial<AdminCardioSegment>) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  /** Duplique le segment juste après celui-ci. */
  onDuplicate?: () => void;
  isFirst: boolean;
  isLast: boolean;
  onDragStart: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  // Feedback visuel additif, voir le même commentaire dans ExerciseRow.
  onDragEnd?: () => void;
  isDropTarget?: boolean;
}) {
  const [deplie, setDeplie] = useState(false);
  const isRepeat = segment.segmentType === "repeat_group";
  const preview = segmentIntensityPreview(segment, referenceVmaKmh);
  const showPreview =
    segment.intensityTargetType === "vma_percentage" ||
    segment.intensityTargetType === "speed_kmh" ||
    segment.intensityTargetType === "pace";
  const cible = references ? cibleDuSegment(segment, sport, references, reglagesZones) : null;

  /**
   * ⚠️ LE DÉPLIANT S'OUVRE TOUT SEUL QUAND IL PORTE UNE DONNÉE. Un champ rempli
   * mais caché derrière un chevron fermé est une prescription qu'on croit avoir
   * perdue — et qu'on ressaisit.
   */
  const detailRenseigne =
    Boolean(segment.title) ||
    segment.recoveryDurationSeconds !== undefined ||
    segment.recoveryDistanceMeters !== undefined ||
    segment.elevationGainMeters !== undefined ||
    segment.inclinePercentage !== undefined ||
    segment.targetCadence !== undefined ||
    Boolean(segment.coachNotes);
  const detailOuvert = deplie || detailRenseigne;

  return (
    <div
      className={`rounded-panel border bg-background/30 transition-colors ${
        isDropTarget ? "border-dashed border-primary/70" : "border-border/60"
      }`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* ── LA LIGNE ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-2">
        <span
          draggable
          onDragStart={onDragStart}
          title="Glisser pour réordonner"
          className="cursor-grab px-0.5 text-muted-foreground hover:text-foreground"
        >
          <GripVertical size={13} />
        </span>

        <SelectCompact
          aria="Type de segment"
          largeur="w-32"
          valeur={segment.segmentType}
          onChange={(v) => onChange({ segmentType: v as CardioSegmentType })}
          options={Object.entries(cardioSegmentTypeLabels).map(([value, label]) => ({ value, label }))}
        />

        {isRepeat && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            ×
            <ChampCompact
              aria="Nombre de répétitions"
              largeur="w-12"
              placeholder="4"
              valeur={segment.repetitions !== undefined ? String(segment.repetitions) : ""}
              onChange={(v) => onChange({ repetitions: v ? Number(v) : undefined })}
            />
          </span>
        )}

        <ChampDuree
          aria={isRepeat ? "Durée de l'effort" : "Durée du segment"}
          secondes={segment.durationSeconds}
          onChange={(secondes) => onChange({ durationSeconds: secondes })}
        />
        <ChampCompact
          aria={isRepeat ? "Distance de l'effort en mètres" : "Distance du segment en mètres"}
          largeur="w-20"
          placeholder="m"
          valeur={segment.distanceMeters !== undefined ? String(segment.distanceMeters) : ""}
          onChange={(v) => onChange({ distanceMeters: v ? Number(v) : undefined })}
        />

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <SelectCompact
          aria="Type d'intensité ciblée"
          largeur="w-32"
          valeur={segment.intensityTargetType}
          onChange={(v) => onChange({ intensityTargetType: v as IntensityTargetType })}
          options={Object.entries(intensityTargetTypeLabels).map(([value, label]) => ({ value, label }))}
        />
        <ValeurIntensite segment={segment} onChange={onChange} />

        {/* Ce que ça donne pour l'athlète — la colonne de droite d'iDO. */}
        <span className="min-w-0 flex-1 truncate text-[11px] italic text-muted-foreground">
          {cible ? (
            <>
              {cible.valeurs.length > 0 ? cible.valeurs.join(" · ") : null}
              {cible.sportManquant && <span className="text-amber-300">sport du bloc non renseigné</span>}
              {cible.referenceManquante && !cible.sportManquant && (
                <span className="text-amber-300">référence indisponible</span>
              )}
            </>
          ) : showPreview ? (
            <>
              VMA réf. {referenceVmaKmh} km/h : {formatSpeed(preview.speedKmh)}
              {preview.paceLabel ? ` — ${preview.paceLabel}` : ""}
            </>
          ) : null}
        </span>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setDeplie((precedent) => !precedent)}
            aria-label={detailOuvert ? "Masquer les détails du segment" : "Afficher les détails du segment"}
            aria-expanded={detailOuvert}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md hover:text-foreground ${
              detailRenseigne ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {detailOuvert ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              aria-label="Dupliquer le segment"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <Copy size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={isFirst}
            aria-label="Déplacer le segment vers le haut"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={isLast}
            aria-label="Déplacer le segment vers le bas"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ArrowDown size={13} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Supprimer le segment"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-red-400 hover:text-red-300"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* ── LE DÉPLIANT : tout ce que la ligne ne montre pas ─────────────── */}
      {detailOuvert && (
        <div className="border-t border-border/60 px-2 pb-3 pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field
              label="Titre (optionnel)"
              value={segment.title}
              onChange={(v) => onChange({ title: v })}
              placeholder="Ex : Corps de séance"
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
            <Field
              label="Cadence cible (spm)"
              type="number"
              value={segment.targetCadence !== undefined ? String(segment.targetCadence) : ""}
              onChange={(v) => onChange({ targetCadence: v ? Number(v) : undefined })}
            />
            <Field
              label="Notes"
              value={segment.coachNotes ?? ""}
              onChange={(v) => onChange({ coachNotes: v || undefined })}
            />
          </div>
          {cible && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              <span className="text-foreground">{cible.consigne}</span>
              {cible.valeurs.length > 0 ? ` — ${cible.valeurs.join(" · ")}` : ""}
              {cible.sportManquant && (
                <span className="ml-1 text-amber-300">
                  — sport du bloc non renseigné : aucune conversion n&apos;est faite.
                </span>
              )}
              {cible.referenceManquante && !cible.sportManquant && (
                <span className="ml-1 text-amber-300">
                  — référence physiologique indisponible chez cet athlète : rien n&apos;est déduit.
                </span>
              )}
            </p>
          )}
        </div>
      )}
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

  function duplicateSegment(index: number) {
    /*
     * ⚠️ UN NOUVEL IDENTIFIANT, SINON CE N'EST PAS UNE COPIE. Deux segments
     * partageant un id se confondraient à la sauvegarde comme au rendu (clé
     * React), et le second écraserait le premier.
     */
    const source = block.segments[index];
    const copie = { ...source, id: generateId("seg") };
    const segments = [...block.segments];
    segments.splice(index + 1, 0, copie);
    onChange({ ...block, segments: segments.map((s, i) => ({ ...s, order: i + 1 })) });
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
            onDuplicate={() => duplicateSegment(i)}
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
