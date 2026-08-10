import { useState } from "react";
import { PlayCircle } from "lucide-react";

import { VideoPlayerModal } from "@/components/shared/VideoPlayerModal";
import {
  ExerciseSubstitutionPicker,
  type ChargeurRemplacants,
} from "@/components/student/ExerciseSubstitutionPicker";
import {
  ExerciseVideoField,
  type DeposeurVideo,
  type ResolveurUrlVideo,
} from "@/components/student/ExerciseVideoField";
import {
  formatPreviousSetLabel,
  resolveSetPlaceholders,
  type PreviousExercisePerf,
} from "@/lib/previous-performance";
import { videoLisible } from "@/lib/video/source";
import type { Exercise, ExerciseFeedback, ExerciseSubstituteOption } from "@/types";

interface ExerciseFeedbackCardProps {
  exercise: Exercise;
  index: number;
  feedback: ExerciseFeedback;
  /**
   * Dernière performance passée du même exercice
   * (feat/student-previous-set-performance) — repères VISUELS uniquement :
   * ligne « Dernières perfs » + placeholders. Jamais écrite dans l'état du
   * formulaire ni dans le payload. Optionnelle : null/absente = aucun repère.
   */
  previous?: PreviousExercisePerf | null;
  /**
   * Option B : le RPE se saisit PAR SÉRIE (champ `rpe` de chaque ligne).
   * L'ancien sélecteur RPE d'exercice a été retiré — le RPE global
   * historique n'est plus une saisie, seulement une mention honnête.
   */
  onSetChange: (
    setNumber: number,
    field: "loadUsed" | "repsDone" | "rpe",
    value: string,
  ) => void;
  onCommentChange: (value: string) => void;
  /**
   * Remplacement (F3) : SEULS le nom affiché et la vidéo changent. La
   * prescription — séries, répétitions, RPE cible, repos, tempo — est celle
   * de `exercise`, toujours, et n'est jamais recalculée. `null` = aucun
   * remplacement.
   */
  /** Sans réseau : l'ajout de vidéo n'est pas monté (F4/F5 restent online-only). */
  horsLigne?: boolean;
  substitute?: ExerciseSubstituteOption | null;
  onSubstituteChange?: (option: ExerciseSubstituteOption | null) => void;
  /** Injectable pour les tests — voir ExerciseSubstitutionPicker. */
  chargerRemplacants?: ChargeurRemplacants;
  /**
   * Vidéo de technique (F4) : CHEMIN dans le bucket privé, jamais une URL.
   * Le champ n'apparaît que si l'appelant fournit `onVideoChange` ET
   * `studentId` — même règle que le remplacement : le récapitulatif et le
   * chemin mock n'ont pas de quoi déposer un fichier, ils n'affichent donc
   * pas un bouton qui ne mènerait nulle part.
   */
  studentId?: string | null;
  videoPath?: string | null;
  onVideoChange?: (chemin: string | null) => void;
  /** Injectables pour les tests — ni réseau, ni Supabase, ni caméra. */
  deposerVideo?: DeposeurVideo;
  resoudreUrlVideo?: ResolveurUrlVideo;
}

/**
 * Carte d'exercice du retour de séance — refonte visuelle
 * feat/student-training-apple-ui (AUCUN changement de données ni de logique :
 * mêmes props, mêmes handlers, mêmes placeholders, mêmes règles de priorité).
 *
 * Structure : en-tête (numéro, nom, résumé de la prescription, démo) →
 * séparation discrète → « Retour élève » (mention honnête d'un ancien RPE
 * global, séries, commentaire).
 *
 * « Dernières perfs » : pour chaque série, la ligne est posée AU-DESSUS du
 * groupe de champs de CETTE série, alignée sur les colonnes de saisie et
 * centrée (desktop/tablette) — plus jamais collée à gauche sous le titre.
 * Style secondaire discret, jamais confondable avec une valeur saisie.
 *
 * Grille des séries : mobile = libellé pleine largeur, charge + reps côte à
 * côte puis RPE pleine largeur ; ≥ sm = [libellé | charge | reps | RPE]
 * avec un RPE plus étroit. `min-w-0` partout : aucun débordement horizontal.
 */
export function ExerciseFeedbackCard({
  exercise,
  index,
  feedback,
  previous,
  onSetChange,
  onCommentChange,
  substitute = null,
  onSubstituteChange,
  chargerRemplacants,
  studentId = null,
  videoPath = null,
  onVideoChange,
  deposerVideo,
  resoudreUrlVideo,
  horsLigne = false,
}: ExerciseFeedbackCardProps) {
  // Le nom et la vidéo RÉELLEMENT réalisés. Tout le reste vient de
  // `exercise` : c'est la prescription, elle ne bouge pas.
  const nomAffiche = substitute?.name ?? exercise.name;
  const videoAffichee = (substitute ? substitute.videoUrl || substitute.alternativeVideoUrl : exercise.videoUrl).trim();
  // L'ouverture du lecteur est un état LOCAL à la carte : elle ne remonte
  // pas dans l'état de la séance, ne change pas la route et ne provoque
  // aucune nouvelle révision du brouillon.
  const [lecteurOuvert, setLecteurOuvert] = useState(false);
  const champ =
    "w-full min-w-0 rounded-control border border-border bg-background px-3 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5">
            <span className="font-heading text-xs font-semibold text-primary">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground">
              {nomAffiche}
            </h3>
          </div>
          {substitute && (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground/80">
              À la place de {exercise.name}
            </p>
          )}
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {[
              `${exercise.sets} séries`,
              `${exercise.reps} reps`,
              `${exercise.restSeconds}s repos`,
              exercise.tempo ? `tempo ${exercise.tempo}` : null,
              exercise.recommendedLoad ? `charge conseillée ${exercise.recommendedLoad}` : null,
              (exercise.recommendedRpe ?? "").trim() ? `RPE cible ${exercise.recommendedRpe}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {videoLisible(videoAffichee) ? (
          <>
            {/* Le design du bouton est INCHANGÉ : seul `<a href>` devient
                `<button onClick>`. `type="button"` est indispensable — ce
                bouton vit dans le formulaire de séance, et un bouton sans
                type y déclencherait un envoi. */}
            <button
              type="button"
              onClick={() => setLecteurOuvert(true)}
              className="pressable inline-flex min-h-11 items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <PlayCircle size={16} />
              Voir la démo
            </button>
            <VideoPlayerModal
              ouvert={lecteurOuvert}
              onFermer={() => setLecteurOuvert(false)}
              titre={exercise.name}
              url={videoAffichee}
            />
          </>
        ) : (
          <span
            title="Aucune vidéo disponible"
            className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-control border border-border/60 px-4 py-2 text-xs text-muted-foreground/40"
          >
            <PlayCircle size={16} />
            Aucune vidéo
          </span>
        )}
      </div>

      <div className="mt-4 border-t border-border/70 pt-4">
        <span className="mb-3 block text-sm font-semibold tracking-tight text-foreground">
          Retour élève
        </span>

        {previous?.exerciseRpe != null && (
          // Ancien retour (pré-option B) : le RPE n'existait qu'au niveau de
          // l'exercice — affiché UNE fois, avec un libellé honnête, jamais
          // recopié dans les lignes ou placeholders de série.
          <p className="mb-3 text-xs leading-tight text-muted-foreground/70">
            Dernières perfs — RPE global de l&apos;exercice : {previous.exerciseRpe}
          </p>
        )}

        <div className="mb-4 flex flex-col gap-3">
          {feedback.sets.map((set) => {
            // Correspondance par INDEX de série (ancienne série N → série N).
            // PRIORITÉ champ par champ inchangée : charge/reps = prescription
            // sinon dernière perf sinon neutre ; RPE = prescription (RPE
            // CIBLE) sinon « RPE » — le RPE passé reste UNIQUEMENT dans la
            // ligne « Dernières perfs ». La saisie réelle (value) masque tout.
            const previousSet = previous?.sets[set.setNumber] ?? null;
            const previousLabel = formatPreviousSetLabel(previousSet);
            const placeholders = resolveSetPlaceholders(exercise, previousSet, set.setNumber);
            return (
              <div key={set.setNumber} className="flex flex-col gap-1">
                {previousLabel && (
                  // Alignée sur le groupe de champs : sur ≥ sm, la colonne
                  // libellé est sautée et le texte est centré au-dessus des
                  // trois champs de CETTE série. Sur mobile, pleine largeur,
                  // retour à la ligne propre (leading-snug, jamais de
                  // débordement).
                  <div className="grid grid-cols-1 sm:grid-cols-[72px_1fr]">
                    <span className="hidden sm:block" aria-hidden="true" />
                    <span
                      aria-label={`Dernières performances série ${set.setNumber}`}
                      className="block min-w-0 text-xs leading-snug text-muted-foreground/70 sm:text-center"
                    >
                      Dernières perfs : {previousLabel}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[72px_1fr_1fr_84px]">
                  <span className="col-span-2 text-xs font-medium text-muted-foreground sm:col-span-1">
                    Série {set.setNumber}
                  </span>
                  <input
                    value={set.loadUsed}
                    onChange={(event) =>
                      onSetChange(set.setNumber, "loadUsed", event.target.value)
                    }
                    placeholder={placeholders.load}
                    className={champ}
                  />
                  <input
                    value={set.repsDone}
                    onChange={(event) =>
                      onSetChange(set.setNumber, "repsDone", event.target.value)
                    }
                    placeholder={placeholders.reps}
                    className={champ}
                  />
                  <input
                    value={set.rpe}
                    onChange={(event) =>
                      onSetChange(set.setNumber, "rpe", event.target.value)
                    }
                    inputMode="numeric"
                    aria-label={`RPE série ${set.setNumber} (1 à 10)`}
                    placeholder={placeholders.rpe}
                    className={`${champ} col-span-2 sm:col-span-1`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <input
          value={feedback.comment}
          onChange={(event) => onCommentChange(event.target.value)}
          placeholder="Commentaire exercice (optionnel)"
          className={champ}
        />

        {/* Le remplacement vit sous le retour de l'exercice, jamais dans
            l'en-tête : c'est une action de séance, pas une information de
            prescription. Absent quand l'appelant ne gère pas le
            remplacement (chemin mock, récapitulatif). */}
        {/* La vidéo vit au même endroit que le remplacement, et pour la
            même raison : c'est une action de séance posée SOUS le retour de
            l'exercice, jamais une information de prescription. */}
        {onVideoChange && studentId && (
          <ExerciseVideoField
            studentId={studentId}
            videoPath={videoPath}
            onChange={onVideoChange}
            {...(deposerVideo ? { deposer: deposerVideo } : {})}
            {...(resoudreUrlVideo ? { resoudreUrl: resoudreUrlVideo } : {})}
            horsLigne={horsLigne}
          />
        )}

        {onSubstituteChange && (
          <ExerciseSubstitutionPicker
            libraryExerciseId={exercise.libraryExerciseId ?? null}
            substitute={substitute}
            onChoose={onSubstituteChange}
            onReset={() => onSubstituteChange(null)}
            {...(chargerRemplacants ? { chargerRemplacants } : {})}
          />
        )}
      </div>
    </div>
  );
}
