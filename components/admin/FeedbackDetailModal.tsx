"use client";

import { useMemo, useState } from "react";
import { CheckCircle, Eye, Repeat2, Video } from "lucide-react";

import { TextareaField } from "@/components/admin/AdminFormFields";
import { CoachReplyVideoField } from "@/components/admin/CoachReplyVideoField";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge, feedbackStatusTone } from "@/components/admin/StatusBadge";
import { feedbackStatusLabels, feedbackTypeLabels, formatDate, fullName } from "@/lib/admin";
import { isCardioResultEntryName, parseCardioResults, type CardioBlockResult } from "@/lib/cardio-feedback";
import { formatDistanceMeters, formatDurationSeconds } from "@/lib/cardio";
import type { ReponseCoach } from "@/lib/coach-reply-video";
import { cleDeSerie, comparaisonsDuRetour, type ComparaisonDeSerie } from "@/lib/comparaison-retour-coach";
import {
  formaterEcartReps,
  libelleEcartCharge,
  libelleEcartReps,
  texteEcartCharge,
  type ComparaisonImmediate,
  type UniteCharge,
} from "@/lib/indicateurs-progression";
import { exerciseGlobalRpeMentions } from "@/lib/previous-performance";
import { formatRpeFr } from "@/lib/rpe";
import { parseAnnotations, type Annotation } from "@/lib/video-annotations";
import type { AdminStudent, AdminStudentFeedback } from "@/types";

/**
 * LA TABLE VIDE DES MODALES FERMÉES — une seule, partagée.
 *
 * Une `new Map()` fabriquée à chaque rendu rendrait une identité différente à
 * chaque fois, et relancerait tout ce qui en dépend. Celle-ci ne change jamais,
 * et elle est vide : aucun badge n'est calculé sur rien.
 */
const AUCUNE_COMPARAISON: ReadonlyMap<string, ComparaisonDeSerie> = new Map();

/**
 * LES BADGES D'UNE SÉRIE, POUR LE COACH.
 *
 * ⚠️ TROIS INDICATEURS DE CONSTAT, ET PAS LA FLÈCHE DE CONSEIL. ↑/↓ dit
 * « change la charge à la série suivante » : sur une séance terminée, la série
 * suivante a déjà eu lieu et ce conseil ne s'adresse à personne. Voir
 * lib/comparaison-retour-coach.ts.
 *
 * Les couleurs suivent celles de l'écran élève, et pour la même raison : une
 * charge en BAISSE est un FAIT, pas un échec — elle reste neutre. Peindre en
 * rouge un élève qui a allégé pour tenir sa fourchette serait une conclusion
 * naïve.
 *
 * ⚠️ AUCUNE COULEUR DANS LES LIBELLÉS ACCESSIBLES : ils disent la VALEUR.
 */
function IndicateursDeSerie({
  comparaison,
  numeroSerie,
}: {
  comparaison: { comparaison: ComparaisonImmediate; unite: UniteCharge } | null;
  numeroSerie: number;
}) {
  if (!comparaison) return null;
  const { comparaison: lue, unite } = comparaison;
  const badge = "rounded-full border px-1.5 py-0.5 text-[0.6875rem] font-semibold leading-tight";
  const vert = `${badge} border-emerald-600/30 text-emerald-600 dark:text-emerald-400`;
  const rouge = `${badge} border-red-600/30 text-red-600 dark:text-red-400`;
  const neutre = `${badge} border-border text-muted-foreground`;
  const ecartReps = lue.ecartReps;
  return (
    <>
      {lue.ecartChargeKg !== 0 && (
        <span
          aria-label={libelleEcartCharge(lue, unite, numeroSerie)}
          className={lue.tenue === "tenue" ? vert : lue.tenue === "insuffisante" ? rouge : neutre}
        >
          {texteEcartCharge(lue, unite)}
        </span>
      )}
      {ecartReps !== null && (
        <span aria-label={libelleEcartReps(ecartReps, numeroSerie)} className={ecartReps > 0 ? vert : rouge}>
          {formaterEcartReps(ecartReps)} reps
        </span>
      )}
    </>
  );
}

/** Ligne prévu/réalisé d'une métrique d'un bloc cardio (valeurs absentes masquées proprement). */
function metricLine(label: string, prescribed: string | null, realized: string | null): string | null {
  if (prescribed === null && realized === null) return null;
  if (prescribed !== null && realized !== null) return `${label} — prévu : ${prescribed} · réalisé : ${realized}`;
  if (realized !== null) return `${label} — réalisé : ${realized}`;
  return `${label} — prévu : ${prescribed}`;
}

/** Carte d'UN bloc cardio dans la modale (ordre de séance, aucun identifiant technique affiché). */
function CardioBlockResultCard({ result }: { result: CardioBlockResult }) {
  const lines = [
    metricLine(
      "Durée",
      result.prescribed.durationSeconds !== null ? formatDurationSeconds(result.prescribed.durationSeconds) : null,
      result.durationSeconds !== null ? formatDurationSeconds(result.durationSeconds) : null,
    ),
    metricLine(
      "Distance",
      result.prescribed.distanceMeters !== null ? formatDistanceMeters(result.prescribed.distanceMeters) : null,
      result.distanceMeters !== null ? formatDistanceMeters(result.distanceMeters) : null,
    ),
    metricLine(
      "Dénivelé",
      result.prescribed.elevationGainMeters !== null ? `${result.prescribed.elevationGainMeters} m` : null,
      result.elevationGainMeters !== null ? `${result.elevationGainMeters} m` : null,
    ),
    metricLine(
      "Répétitions",
      result.prescribed.repetitions !== null ? String(result.prescribed.repetitions) : null,
      result.repetitionsDone !== null ? String(result.repetitionsDone) : null,
    ),
  ].filter((line): line is string => line !== null);

  return (
    <div className="rounded-panel border border-border bg-surface-soft/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold uppercase text-foreground">{result.title}</span>
        <span className={`text-xs uppercase tracking-wide ${result.completed ? "text-success" : "text-muted-foreground"}`}>
          {result.completed ? "Terminé" : "Non terminé"}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {result.rpe !== null && <p>RPE : {formatRpeFr(result.rpe)}/10</p>}
        {result.pain && <p className="text-warning">Douleur / gêne : {result.pain}</p>}
        {result.comment && <p className="text-foreground">{result.comment}</p>}
      </div>
    </div>
  );
}

/** Libellé de type affiché : « Entraînement · Course » si le retour contient des résultats cardio. */
export function feedbackTypeDisplayLabel(feedback: AdminStudentFeedback): string {
  if (feedback.type === "entrainement" && feedback.exerciseEntries.some((e) => isCardioResultEntryName(e.exerciseName))) {
    return "Entraînement · Course";
  }
  return feedbackTypeLabels[feedback.type];
}

export function FeedbackDetailModal({
  feedback,
  student,
  onReply,
  historique = [],
  ouvertInitialement = false,
}: {
  feedback: AdminStudentFeedback;
  student: AdminStudent | undefined;
  onReply: (reponse: ReponseCoach) => void;
  /**
   * L'HISTORIQUE DE L'ÉLÈVE, déjà chargé par l'écran — aucune requête de plus.
   *
   * Il sert à retrouver l'occurrence N-1 du même jour, c'est-à-dire le SEUL
   * repère dont les indicateurs immédiats ont besoin. Absent (chemin de
   * démonstration, appelant qui ne l'a pas), la modale est EXACTEMENT celle
   * d'avant : aucun badge, et surtout aucun badge calculé sur rien.
   */
  historique?: readonly AdminStudentFeedback[];
  /**
   * COUTURE DE TEST — l'état d'ouverture initial.
   *
   * ⚠️ ELLE EXISTE PARCE QUE `renderToString` N'EXÉCUTE AUCUN EFFET ET AUCUN
   * CLIC : sans elle, le détail d'un retour ne serait jamais rendu en SSR et
   * aucun test ne pourrait vérifier ce que le coach voit. Même motif que la
   * couture `indexInitial` du bouton de progression. La production ne la
   * fournit jamais : la modale s'ouvre au clic, comme avant.
   */
  ouvertInitialement?: boolean;
}) {
  const [open, setOpen] = useState(ouvertInitialement);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);
  // F5 : la réponse vidéo suit exactement le même cycle que le texte — un
  // brouillon local, envoyé avec le reste. La vidéo, elle, est déjà dans le
  // bucket dès que le coach l'a jointe ; ce qui est en brouillon ici, c'est
  // son CHEMIN et son calque.
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // La réponse enregistrée est chargée UNE fois par retour (comparaison par
  // id UNIQUEMENT — jamais par le contenu du brouillon) : si la liste se
  // recharge pendant la saisie, le brouillon n'est pas écrasé. Ajustement
  // d'état pendant le rendu (motif recommandé « You Might Not Need an
  // Effect », déjà utilisé par app/admin/parametres) — logique équivalente
  // testée dans scripts/tests/feedback-reply-draft.mts.
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  if (loadedForId !== feedback.id) {
    setLoadedForId(feedback.id);
    setReply(feedback.coachReply ?? "");
    setVideoPath(feedback.coachReplyVideo?.videoPath ?? null);
    // On ne fait jamais confiance au `jsonb` : un calque abîmé est écarté
    // tracé par tracé, il ne fait pas disparaître la vidéo.
    setAnnotations(parseAnnotations(feedback.coachReplyVideo?.annotations));
  }

  function close() {
    setOpen(false);
    setSent(false);
  }

  // Une réponse peut être uniquement écrite, uniquement filmée, ou les deux.
  // Ce qui n'a pas de sens, c'est une réponse vide.
  const peutEnvoyer = Boolean(reply.trim()) || Boolean(videoPath);

  function handleSend() {
    if (!peutEnvoyer) return;
    onReply({ texte: reply.trim(), videoPath, annotations });
    setSent(true);
  }

  // Résultats cardio BLOC PAR BLOC (format v2, triés par ordre de séance) +
  // éventuel retour global historique (v1) ; les entrées réservées
  // « Cardio · Résultats » sont retirées du détail par exercice pour ne pas
  // s'afficher comme une fausse série de musculation, et aucune structure
  // technique (JSON, blockId) n'est jamais rendue.
  /**
   * LES INDICATEURS IMMÉDIATS DU COACH — même règle, même référence que côté
   * élève (lib/comparaison-retour-coach.ts).
   *
   * ⚠️ AUCUN CALCUL ICI. Cette modale affiche ; elle ne décide d'aucun seuil,
   * d'aucune borne et d'aucun kilogramme. La table est vide quand il n'y a rien
   * d'honnête à dire — voir l'en-tête du module.
   */
  const comparaisons = useMemo(
    /*
     * ⚠️ RIEN N'EST CALCULÉ TANT QUE LA MODALE EST FERMÉE, ET C'EST UNE
     * CORRECTION, PAS UNE MICRO-OPTIMISATION.
     *
     * `/admin/retours` rend UNE modale par ligne — 129 en production. Ce
     * `useMemo` s'exécute au rendu, avant et indépendamment du `{open && …}`
     * plus bas : chacune des 129 lignes construisait donc son index sur
     * l'historique entier, soit 129 × 129 parcours de retours pour un écran où
     * le coach n'ouvre qu'un seul détail. Conditionné à `open`, le compte tombe
     * à zéro au rendu de la liste, et à UN à l'ouverture.
     *
     * ⚠️ AUCUNE RÈGLE N'EST TOUCHÉE. Même appel, mêmes entrées, même table.
     * Ce qui change, c'est QUAND il a lieu — jamais ce qu'il rend. Une modale
     * ouverte affiche exactement les badges qu'elle affichait avant.
     */
    () => (open ? comparaisonsDuRetour({ retour: feedback, historique }) : AUCUNE_COMPARAISON),
    [open, feedback, historique],
  );

  const parsedCardio = parseCardioResults(feedback.exerciseEntries);
  const strengthEntries = feedback.exerciseEntries.filter((entry) => !isCardioResultEntryName(entry.exerciseName));

  // REMPLACEMENTS (F3) — dédoublonnés par couple prescrit → réalisé :
  // `exerciseEntries` est une liste à PLAT (une entrée par série), donc
  // l'information y est répétée autant de fois qu'il y a de séries.
  // Affichés en tête du détail : c'est la première chose que le coach doit
  // voir, avant de lire des charges qui ne portent pas sur l'exercice prévu.
  const remplacements = [
    ...new Map(
      strengthEntries
        .filter((entry) => entry.substituteExerciseName)
        .map((entry) => [
          `${entry.exerciseName}→${entry.substituteExerciseName}`,
          { prescrit: entry.exerciseName, realise: entry.substituteExerciseName as string },
        ]),
    ).values(),
  ];

  // VIDÉOS DE TECHNIQUE (F4) — lues sur le RETOUR, pas sur `exerciseEntries`.
  // Elles y sont déjà une par exercice : plus rien à dédoublonner, et un
  // exercice filmé sans aucune série saisie apparaît lui aussi.
  //
  // `videoUrl` est une URL SIGNÉE d'une heure, fabriquée en lot par
  // getAdminWorkoutFeedbackList — le chemin que /admin/retours emprunte
  // réellement. Absente = la RLS a refusé ce chemin à ce coach (il n'est pas
  // rattaché à cet élève), ou la vidéo a été purgée : dans les deux cas on le
  // DIT, on ne laisse pas un lecteur vide.
  const videos = feedback.videos ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Eye size={13} />
        Voir détail
      </button>

      {open && (
        <Modal title={`${feedbackTypeDisplayLabel(feedback)} — ${feedback.refLabel}`} onClose={close} maxWidth="max-w-lg">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-foreground">{student ? fullName(student) : "Élève non identifié"}</span>
              <StatusBadge label={feedbackStatusLabels[feedback.status]} tone={feedbackStatusTone(feedback.status)} />
            </div>
            <p className="text-xs text-muted-foreground">{formatDate(feedback.date)}</p>

            {feedback.type === "entrainement" && (
              <>
                <p className="text-sm text-foreground">
                  Séance {feedback.completed ? "terminée" : "non terminée"}
                </p>
                {!feedback.programId && (
                  <p className="text-xs text-muted-foreground">Programme non lié</p>
                )}
              </>
            )}
            {feedback.rpe !== null && (
              <p className="text-sm text-foreground">RPE global : {formatRpeFr(feedback.rpe)} / 10</p>
            )}
            {feedback.pain && (
              <p className="text-sm text-warning">Douleur / gêne : {feedback.pain}</p>
            )}
            {feedback.comment && <p className="text-sm text-foreground">{feedback.comment}</p>}

            {parsedCardio.blocks.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Retour cardio — bloc par bloc</h4>
                <div className="flex flex-col gap-2">
                  {parsedCardio.blocks.map((result) => (
                    <CardioBlockResultCard key={result.blockId} result={result} />
                  ))}
                </div>
              </div>
            )}

            {parsedCardio.legacy && (
              <div>
                <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Retour cardio global (historique)</h4>
                <div className="rounded-panel border border-border bg-surface-soft/40 p-3 text-sm text-foreground">
                  {[
                    parsedCardio.legacy.durationLabel && `Durée : ${parsedCardio.legacy.durationLabel}`,
                    parsedCardio.legacy.distanceLabel && `Distance : ${parsedCardio.legacy.distanceLabel}`,
                    parsedCardio.legacy.elevationLabel && `D+ : ${parsedCardio.legacy.elevationLabel}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            )}

            {videos.length > 0 && (
              <div className="rounded-panel border border-primary/40 bg-primary/5 p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-primary">
                  <Video size={13} aria-hidden="true" />
                  Vidéos envoyées par l&apos;élève
                </h4>
                <div className="flex flex-col gap-3">
                  {videos.map((video) => (
                    <div key={video.videoPath}>
                      <p className="mb-1 text-sm text-foreground">{video.realizedName}</p>
                      {video.videoUrl ? (
                        <video
                          src={video.videoUrl}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full rounded-control bg-black"
                          style={{ maxHeight: 280 }}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Vidéo indisponible : soit elle a dépassé sa durée de conservation, soit
                          cet élève ne t&apos;est pas rattaché.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {remplacements.length > 0 && (
              <div className="rounded-panel border border-primary/40 bg-primary/5 p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-primary">
                  <Repeat2 size={13} aria-hidden="true" />
                  Exercices remplacés par l&apos;élève
                </h4>
                <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                  {remplacements.map((r) => (
                    <li key={`${r.prescrit}-${r.realise}`}>
                      <span className="text-foreground">{r.realise}</span> à la place de {r.prescrit}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {strengthEntries.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Détail par exercice</h4>
                <div className="flex flex-col gap-2">
                  {/* Option B : `entry.rpe` est le RPE réellement enregistré
                      POUR LA SÉRIE (null sur tout l'historique antérieur —
                      jamais un global recopié). Le RPE global d'exercice des
                      anciens retours s'affiche UNE fois, plus bas. */}
                  {strengthEntries.map((entry, i) => (
                    <div key={i} className="rounded-panel border border-border p-3 text-sm">
                      <div className="flex justify-between text-foreground">
                        {/* Le nom PRESCRIT reste la clé de lecture du coach ;
                            le réalisé s'ajoute, il ne le remplace jamais. */}
                        <span>
                          {entry.exerciseName} — série {entry.setNumber}
                          {entry.substituteExerciseName && (
                            <span className="text-primary"> · réalisé : {entry.substituteExerciseName}</span>
                          )}
                        </span>
                        {entry.rpe !== null && <span className="text-muted-foreground">RPE {formatRpeFr(entry.rpe)}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {entry.loadUsed} · {entry.repsDone} reps
                          {entry.comment && ` · ${entry.comment}`}
                        </span>
                        <IndicateursDeSerie
                          comparaison={comparaisons.get(cleDeSerie(entry.exerciseName, entry.setNumber)) ?? null}
                          numeroSerie={entry.setNumber}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {exerciseGlobalRpeMentions(feedback.exerciseEntries).map((mention) => (
                  <p key={mention.exerciseName} className="mt-2 text-xs text-muted-foreground">
                    {mention.exerciseName} — RPE global de l&apos;exercice : {formatRpeFr(mention.rpe)}
                  </p>
                ))}
              </div>
            )}

            {sent ? (
              <div role="status" className="flex items-center gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
                <CheckCircle size={18} className="flex-shrink-0" aria-hidden="true" />
                Réponse envoyée, retour marqué comme traité.
              </div>
            ) : (
              <>
                <TextareaField label="Réponse coach" value={reply} onChange={setReply} rows={3} />
                <div>
                  <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Réponse vidéo</p>
                  <CoachReplyVideoField
                    studentId={feedback.studentId}
                    videoPath={videoPath}
                    annotations={annotations}
                    urlExistante={
                      // Déjà signée par la lecture de liste quand le chemin
                      // n'a pas changé depuis. Inutile de re-signer ce qu'on a.
                      feedback.coachReplyVideo?.videoPath === videoPath
                        ? (feedback.coachReplyVideo?.videoUrl ?? null)
                        : null
                    }
                    onChange={(etat) => {
                      setVideoPath(etat.videoPath);
                      setAnnotations(etat.annotations);
                    }}
                  />
                </div>
                <PrimaryButton onClick={handleSend} disabled={!peutEnvoyer}>
                  Envoyer la réponse
                </PrimaryButton>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
