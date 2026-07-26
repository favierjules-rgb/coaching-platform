"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";

import {
  FieldError,
  ProgressIndicator,
  QuestionBlock,
  progressiveInputClass,
  progressiveOptionClass,
} from "@/components/ui/ProgressiveQuestions";
import {
  GOAL_OPTIONS,
  MAX_LENGTHS,
  QUESTION_COUNT,
  firstIncompleteQuestion,
  freeAssessmentSchema,
} from "@/lib/free-assessment/schema";

/**
 * Formulaire « Mon bilan offert » — SIX questions dévoilées une à une, plus
 * un consentement distinct.
 *
 * Reprend exactement l'ergonomie validée du questionnaire « Services aux
 * entreprises » : mêmes briques d'interface (`components/ui/
 * ProgressiveQuestions`), même mécanique de progression (`lib/forms/
 * progressive-questions`), même animation de révélation.
 *
 * Validation client par le MÊME schéma Zod que la route serveur
 * (`lib/free-assessment/schema.ts`) : les deux ne peuvent pas diverger, et la
 * progression en est déduite — une question ne peut pas être jugée remplie à
 * l'affichage puis refusée à l'envoi. Les réponses saisies ne sont jamais
 * perdues quand une validation échoue.
 *
 * Accessibilité : chaque champ porte un label associé, les erreurs sont
 * reliées par `aria-describedby` + `aria-invalid`, les choix sont dans un
 * `fieldset`/`legend`, et l'état d'envoi est annoncé par une région live.
 * Cibles tactiles ≥ 44 px. Le focus n'est JAMAIS déplacé automatiquement à
 * l'apparition d'une question : le dévoilement se produit pendant la frappe.
 */

type Errors = Record<string, string>;

const initialState = {
  lastName: "",
  firstName: "",
  phone: "",
  email: "",
  goal: "",
  otherGoal: "",
  frustration: "",
  privacyAccepted: false,
  website: "", // honeypot
};

type FormState = typeof initialState;

export function FreeAssessmentForm() {
  const [values, setValues] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  /**
   * Verrou d'envoi SYNCHRONE. `status` ne suffit pas : deux clics dans le
   * même tick lisent la même valeur de state avant le re-rendu, et deux
   * requêtes partent. Le serveur les neutralise, mais autant ne pas les
   * émettre.
   */
  const sendingRef = useRef(false);
  /**
   * Nombre de questions dévoilées. MONOTONE : effacer un champ déjà rempli
   * ne fait pas disparaître les questions suivantes — le contenu ne doit
   * jamais se dérober sous le curseur pendant une correction.
   */
  const [revealed, setRevealed] = useState(1);
  /** Aucune animation au premier rendu : la section s'ouvre immobile. */
  const [hasInteracted, setHasInteracted] = useState(false);

  const otherSelected = values.goal === "autre";
  /** Question en cours de saisie, bornée au nombre total (repère de progression). */
  const currentQuestion = Math.min(firstIncompleteQuestion(values), QUESTION_COUNT);
  /** Les six questions sont remplies : consentement et envoi peuvent apparaître. */
  const readyToSubmit = firstIncompleteQuestion(values) > QUESTION_COUNT;

  /**
   * Recalcule le dévoilement à partir des valeurs qui viennent d'être
   * saisies. Appelé depuis les gestionnaires d'événements (jamais pendant le
   * rendu) et toujours à la hausse.
   */
  function refreshReveal(next: FormState) {
    setHasInteracted(true);
    const atteinte = Math.min(firstIncompleteQuestion(next), QUESTION_COUNT);
    setRevealed((current) => Math.max(current, atteinte));
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    const next = { ...values, [key]: value };
    setValues(next);
    refreshReveal(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current || status === "sending") return;

    const parsed = freeAssessmentSchema.safeParse(values);
    if (!parsed.success) {
      const nextErrors: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !nextErrors[key]) nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      setStatus("idle");
      setFeedback("");
      // Focus sur le premier champ en erreur (ordre du DOM).
      const firstKey = Object.keys(nextErrors)[0];
      if (firstKey) {
        document.getElementById(`fa-${firstKey}`)?.focus();
      }
      return;
    }

    setErrors({});
    sendingRef.current = true;
    setStatus("sending");
    setFeedback("");

    try {
      const response = await fetch("/api/free-assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };

      if (!response.ok) {
        setStatus("error");
        setFeedback(
          payload.error ?? "Une erreur est survenue pendant l'envoi. Réessaie dans quelques instants.",
        );
        return;
      }

      setStatus("success");
      setFeedback(
        payload.message ??
          "Ta demande a bien été envoyée. Je te recontacte personnellement pour échanger sur ton objectif.",
      );
      setValues(initialState);
    } catch {
      setStatus("error");
      setFeedback("Une erreur est survenue pendant l'envoi. Réessaie dans quelques instants.");
    } finally {
      // Libéré dans tous les cas : un échec doit rester réessayable.
      sendingRef.current = false;
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="flex flex-col items-start gap-3 border border-border bg-card p-8 text-sm text-foreground"
      >
        <CheckCircle2 size={22} className="text-primary" aria-hidden />
        <p>{feedback}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
      <ProgressIndicator current={currentQuestion} total={QUESTION_COUNT} />

      {/* Q1 — nom */}
      <QuestionBlock index={1} label="Quel est ton nom ?" revealed animate={false}>
        <label htmlFor="fa-lastName" className="sr-only">
          Nom
        </label>
        <input
          id="fa-lastName"
          name="lastName"
          type="text"
          required
          maxLength={MAX_LENGTHS.lastName}
          autoComplete="family-name"
          value={values.lastName}
          onChange={(e) => update("lastName", e.target.value)}
          aria-invalid={Boolean(errors.lastName)}
          aria-describedby={errors.lastName ? "fa-lastName-error" : undefined}
          className={progressiveInputClass}
          placeholder="Ton nom"
        />
        <FieldError id="fa-lastName-error" message={errors.lastName} />
      </QuestionBlock>

      {/* Q2 — prénom */}
      <QuestionBlock
        index={2}
        label="Quel est ton prénom ?"
        revealed={revealed >= 2}
        animate={hasInteracted}
      >
        <label htmlFor="fa-firstName" className="sr-only">
          Prénom
        </label>
        <input
          id="fa-firstName"
          name="firstName"
          type="text"
          required
          maxLength={MAX_LENGTHS.firstName}
          autoComplete="given-name"
          value={values.firstName}
          onChange={(e) => update("firstName", e.target.value)}
          aria-invalid={Boolean(errors.firstName)}
          aria-describedby={errors.firstName ? "fa-firstName-error" : undefined}
          className={progressiveInputClass}
          placeholder="Ton prénom"
        />
        <FieldError id="fa-firstName-error" message={errors.firstName} />
      </QuestionBlock>

      {/* Q3 — téléphone */}
      <QuestionBlock
        index={3}
        label="Quel est ton numéro de téléphone ?"
        revealed={revealed >= 3}
        animate={hasInteracted}
      >
        <label htmlFor="fa-phone" className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
          Téléphone
        </label>
        <input
          id="fa-phone"
          name="phone"
          type="tel"
          required
          maxLength={MAX_LENGTHS.phone}
          autoComplete="tel"
          inputMode="tel"
          value={values.phone}
          onChange={(e) => update("phone", e.target.value)}
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={errors.phone ? "fa-phone-error" : undefined}
          className={progressiveInputClass}
          placeholder="06 12 34 56 78"
        />
        <FieldError id="fa-phone-error" message={errors.phone} />
      </QuestionBlock>

      {/* Q4 — email */}
      <QuestionBlock
        index={4}
        label="Quelle est ton adresse email ?"
        revealed={revealed >= 4}
        animate={hasInteracted}
      >
        <label htmlFor="fa-email" className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
          Email
        </label>
        <input
          id="fa-email"
          name="email"
          type="email"
          required
          maxLength={MAX_LENGTHS.email}
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={(e) => update("email", e.target.value)}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "fa-email-error" : undefined}
          className={progressiveInputClass}
          placeholder="prenom@exemple.fr"
        />
        <FieldError id="fa-email-error" message={errors.email} />
      </QuestionBlock>

      {/* Q5 — objectif principal */}
      <QuestionBlock
        index={5}
        label="Quel est ton objectif principal ?"
        revealed={revealed >= 5}
        animate={hasInteracted}
      >
        <fieldset aria-invalid={Boolean(errors.goal)} aria-describedby={errors.goal ? "fa-goal-error" : undefined}>
          <legend className="sr-only">Objectif principal</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {GOAL_OPTIONS.map((option, index) => (
              <label key={option.value} className={progressiveOptionClass(values.goal === option.value)}>
                <input
                  id={index === 0 ? "fa-goal" : undefined}
                  type="radio"
                  name="goal"
                  value={option.value}
                  checked={values.goal === option.value}
                  onChange={() => update("goal", option.value)}
                  className="h-4 w-4 accent-[color:var(--primary)]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <FieldError id="fa-goal-error" message={errors.goal} />

        {otherSelected && (
          <div className="mt-4">
            <label
              htmlFor="fa-otherGoal"
              className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground"
            >
              Précise ton objectif
            </label>
            <input
              id="fa-otherGoal"
              name="otherGoal"
              type="text"
              maxLength={MAX_LENGTHS.otherGoal}
              value={values.otherGoal}
              onChange={(e) => update("otherGoal", e.target.value)}
              aria-invalid={Boolean(errors.otherGoal)}
              aria-describedby={errors.otherGoal ? "fa-otherGoal-error" : undefined}
              className={progressiveInputClass}
            />
            <FieldError id="fa-otherGoal-error" message={errors.otherGoal} />
          </div>
        )}
      </QuestionBlock>

      {/* Q6 — frustration */}
      <QuestionBlock
        index={6}
        label="Quelle est aujourd'hui ta plus grande frustration ?"
        revealed={revealed >= 6}
        animate={hasInteracted}
      >
        <label
          htmlFor="fa-frustration"
          className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground"
        >
          Explique ce qui te bloque, ce que tu as déjà essayé ou ce que tu n&apos;arrives pas à maintenir dans
          le temps
        </label>
        <textarea
          id="fa-frustration"
          name="frustration"
          rows={5}
          required
          maxLength={MAX_LENGTHS.frustration}
          value={values.frustration}
          onChange={(e) => update("frustration", e.target.value)}
          aria-invalid={Boolean(errors.frustration)}
          aria-describedby={errors.frustration ? "fa-frustration-error" : undefined}
          className={`${progressiveInputClass} resize-y`}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {values.frustration.length} / {MAX_LENGTHS.frustration} caractères
        </p>
        <FieldError id="fa-frustration-error" message={errors.frustration} />
      </QuestionBlock>

      {/* Consentement — distinct des six questions, dévoilé avec l'envoi. */}
      {readyToSubmit && (
        <div className={`border-t border-border pt-8 ${hasInteracted ? "question-reveal" : ""}`}>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-muted-foreground">
            <input
              id="fa-privacyAccepted"
              type="checkbox"
              name="privacyAccepted"
              checked={values.privacyAccepted}
              onChange={(e) => update("privacyAccepted", e.target.checked)}
              aria-invalid={Boolean(errors.privacyAccepted)}
              aria-describedby={errors.privacyAccepted ? "fa-privacyAccepted-error" : undefined}
              className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[color:var(--primary)]"
            />
            <span>
              J&apos;accepte que les informations transmises soient utilisées pour me recontacter dans le cadre
              de ma demande de bilan.{" "}
              <Link
                href="/confidentialite"
                className="underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Politique de confidentialité
              </Link>
              .
            </span>
          </label>
          <FieldError id="fa-privacyAccepted-error" message={errors.privacyAccepted} />
        </div>
      )}

      {/* Piège à robots — masqué visuellement ET aux lecteurs d'écran. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="fa-website">Ne remplissez pas ce champ</label>
        <input
          id="fa-website"
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => update("website", e.target.value)}
        />
      </div>

      {status === "error" && (
        <p
          role="alert"
          className="flex items-start gap-2 border border-border bg-card px-4 py-3 text-sm text-foreground"
        >
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden />
          {feedback}
        </p>
      )}

      {readyToSubmit ? (
        <button
          type="submit"
          disabled={status === "sending"}
          className={`pressable flex min-h-[52px] items-center justify-center gap-2 bg-foreground px-6 py-3 text-sm font-bold uppercase tracking-widest text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 ${
            hasInteracted ? "question-reveal" : ""
          }`}
        >
          {status === "sending" && <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden />}
          {status === "sending" ? "Envoi en cours…" : "Demander mon bilan offert"}
        </button>
      ) : (
        // Repère de fin de parcours tant que tout n'est pas renseigné.
        <p className="text-xs text-muted-foreground">
          Le bouton d&apos;envoi apparaîtra une fois les questions renseignées.
        </p>
      )}

      <p aria-live="polite" className="sr-only">
        {status === "sending"
          ? "Envoi de ta demande en cours."
          : `Question ${currentQuestion} sur ${QUESTION_COUNT}.`}
      </p>
    </form>
  );
}
