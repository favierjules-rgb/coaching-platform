"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";

import {
  FORMATS_REQUIRING_CITY,
  FORMAT_OPTIONS,
  HEADCOUNT_OPTIONS,
  MAX_LENGTHS,
  NEED_OPTIONS,
  QUESTION_COUNT,
  businessInquirySchema,
  firstIncompleteQuestion,
} from "@/lib/business-inquiry/schema";

/**
 * Formulaire de demande « Services aux entreprises » — SEPT groupes de
 * questions, un consentement distinct.
 *
 * Validation client par le MÊME schéma Zod que la route serveur
 * (`lib/business-inquiry/schema.ts`) : les deux ne peuvent pas diverger. Les
 * réponses déjà saisies ne sont jamais perdues quand une validation échoue —
 * seuls les messages d'erreur changent.
 *
 * Dévoilement PROGRESSIF (juillet 2026) : une seule question est proposée à
 * la fois — la suivante apparaît dès que la précédente est valide. Sept
 * questions affichées d'un bloc décourageaient à l'ouverture ; un compteur
 * « Question N sur 7 » remplace le repère visuel perdu.
 *
 * Le critère de complétude est DÉDUIT du schéma partagé
 * (`firstIncompleteQuestion`) : aucune règle n'est réécrite ici, donc une
 * question ne peut pas être jugée remplie côté affichage puis refusée à
 * l'envoi.
 *
 * Accessibilité : chaque champ porte un label associé, les erreurs sont
 * reliées par `aria-describedby` + `aria-invalid`, les groupes de choix sont
 * des `fieldset`/`legend`, et le résultat d'envoi est annoncé par une région
 * live. Cibles tactiles ≥ 44 px. Le focus n'est JAMAIS déplacé automatiquement
 * à l'apparition d'une question : le dévoilement se produit pendant la frappe,
 * déplacer le curseur couperait la saisie en cours. L'arrivée est annoncée
 * par une région live discrète.
 */

type Errors = Record<string, string>;

const initialState = {
  companyName: "",
  contactName: "",
  contactRole: "",
  email: "",
  phone: "",
  headcount: "",
  needs: [] as string[],
  otherNeed: "",
  format: "",
  city: "",
  projectDetails: "",
  privacyAccepted: false,
  website: "", // honeypot
};

type FormState = typeof initialState;

const inputClass =
  "min-h-[44px] w-full border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
      {message}
    </p>
  );
}

/**
 * Une question. `revealed` conditionne le montage : une question non encore
 * atteinte n'existe pas dans le DOM — ni pour la souris, ni pour le clavier,
 * ni pour un lecteur d'écran. L'animation d'apparition ne joue qu'après la
 * première interaction (`animate`), pour que le premier rendu de la page
 * soit immobile.
 */
function QuestionBlock({
  index,
  label,
  revealed,
  animate,
  children,
}: {
  index: number;
  label: string;
  revealed: boolean;
  animate: boolean;
  children: React.ReactNode;
}) {
  if (!revealed) return null;
  return (
    <div
      className={`border-t border-border pt-8 first:border-t-0 first:pt-0 ${animate ? "question-reveal" : ""}`}
    >
      <p className="mb-1 font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
        0{index}
      </p>
      <h3 className="mb-4 font-heading text-lg font-bold uppercase text-foreground sm:text-xl">{label}</h3>
      {children}
    </div>
  );
}

/** Repère de progression — remplace la vue d'ensemble perdue par le dévoilement. */
function ProgressIndicator({ current }: { current: number }) {
  const percent = Math.round((current / QUESTION_COUNT) * 100);
  return (
    <div className="flex flex-col gap-2">
      {/* Pas d'`aria-live` ici : l'annonce est portée par l'unique région
          live du formulaire, en bas — sinon le changement serait lu deux fois. */}
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        Question {current} sur {QUESTION_COUNT}
      </p>
      <div className="h-px w-full bg-border" aria-hidden>
        <div
          className="h-px bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function BusinessInquiryForm() {
  const [values, setValues] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  /**
   * Verrou d'envoi SYNCHRONE. `status` ne suffit pas : deux clics dans le
   * même tick lisent la même valeur de state avant le re-rendu, et deux
   * requêtes partent. Le serveur les neutralise (garde anti-rejeu), mais
   * autant ne pas les émettre.
   */
  const sendingRef = useRef(false);
  /**
   * Nombre de questions dévoilées. MONOTONE : effacer un champ déjà rempli
   * ne fait pas disparaître les questions suivantes — le contenu ne doit
   * jamais se dérober sous le curseur pendant une correction.
   */
  const [revealed, setRevealed] = useState(1);
  /** Aucune animation au premier rendu : la page s'ouvre immobile. */
  const [hasInteracted, setHasInteracted] = useState(false);

  const cityRequired = (FORMATS_REQUIRING_CITY as readonly string[]).includes(values.format);
  const otherSelected = values.needs.includes("autre");
  /** Question en cours de saisie, bornée au nombre total (repère de progression). */
  const currentQuestion = Math.min(firstIncompleteQuestion(values), QUESTION_COUNT);
  /** Les sept questions sont remplies : consentement et envoi peuvent apparaître. */
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

  function toggleNeed(need: string) {
    const next = {
      ...values,
      needs: values.needs.includes(need)
        ? values.needs.filter((n) => n !== need)
        : [...values.needs, need],
    };
    setValues(next);
    refreshReveal(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current || status === "sending") return;

    const parsed = businessInquirySchema.safeParse(values);
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
        document.getElementById(`bi-${firstKey}`)?.focus();
      }
      return;
    }

    setErrors({});
    sendingRef.current = true;
    setStatus("sending");
    setFeedback("");

    try {
      const response = await fetch("/api/business-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };

      if (!response.ok) {
        setStatus("error");
        setFeedback(
          payload.error ??
            "Une erreur est survenue pendant l'envoi. Merci de réessayer ou de me contacter directement.",
        );
        return;
      }

      setStatus("success");
      setFeedback(
        payload.message ??
          "Votre demande a bien été envoyée. Je vous recontacte rapidement pour échanger sur votre projet.",
      );
      setValues(initialState);
    } catch {
      setStatus("error");
      setFeedback("Une erreur est survenue pendant l'envoi. Merci de réessayer ou de me contacter directement.");
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
      <ProgressIndicator current={currentQuestion} />

      {/* Q1 — entreprise */}
      <QuestionBlock
        index={1}
        label="Quel est le nom de votre entreprise ?"
        revealed
        animate={false}
      >
        <label htmlFor="bi-companyName" className="sr-only">
          Nom de l&apos;entreprise
        </label>
        <input
          id="bi-companyName"
          name="companyName"
          type="text"
          required
          maxLength={MAX_LENGTHS.companyName}
          autoComplete="organization"
          value={values.companyName}
          onChange={(e) => update("companyName", e.target.value)}
          aria-invalid={Boolean(errors.companyName)}
          aria-describedby={errors.companyName ? "bi-companyName-error" : undefined}
          className={inputClass}
          placeholder="Nom de l'entreprise"
        />
        <FieldError id="bi-companyName-error" message={errors.companyName} />
      </QuestionBlock>

      {/* Q2 — contact */}
      <QuestionBlock
        index={2}
        label="Qui puis-je contacter ?"
        revealed={revealed >= 2}
        animate={hasInteracted}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="bi-contactName" className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
              Nom et prénom
            </label>
            <input
              id="bi-contactName"
              name="contactName"
              type="text"
              required
              maxLength={MAX_LENGTHS.contactName}
              autoComplete="name"
              value={values.contactName}
              onChange={(e) => update("contactName", e.target.value)}
              aria-invalid={Boolean(errors.contactName)}
              aria-describedby={errors.contactName ? "bi-contactName-error" : undefined}
              className={inputClass}
            />
            <FieldError id="bi-contactName-error" message={errors.contactName} />
          </div>
          <div>
            <label htmlFor="bi-contactRole" className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
              Fonction dans l&apos;entreprise
            </label>
            <input
              id="bi-contactRole"
              name="contactRole"
              type="text"
              required
              maxLength={MAX_LENGTHS.contactRole}
              autoComplete="organization-title"
              value={values.contactRole}
              onChange={(e) => update("contactRole", e.target.value)}
              aria-invalid={Boolean(errors.contactRole)}
              aria-describedby={errors.contactRole ? "bi-contactRole-error" : undefined}
              className={inputClass}
            />
            <FieldError id="bi-contactRole-error" message={errors.contactRole} />
          </div>
        </div>
      </QuestionBlock>

      {/* Q3 — coordonnées */}
      <QuestionBlock
        index={3}
        label="Comment puis-je vous joindre ?"
        revealed={revealed >= 3}
        animate={hasInteracted}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="bi-email" className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
              Email professionnel
            </label>
            <input
              id="bi-email"
              name="email"
              type="email"
              required
              maxLength={MAX_LENGTHS.email}
              autoComplete="email"
              inputMode="email"
              value={values.email}
              onChange={(e) => update("email", e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "bi-email-error" : undefined}
              className={inputClass}
            />
            <FieldError id="bi-email-error" message={errors.email} />
          </div>
          <div>
            <label htmlFor="bi-phone" className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
              Téléphone <span className="normal-case tracking-normal">(facultatif)</span>
            </label>
            <input
              id="bi-phone"
              name="phone"
              type="tel"
              maxLength={MAX_LENGTHS.phone}
              autoComplete="tel"
              inputMode="tel"
              value={values.phone}
              onChange={(e) => update("phone", e.target.value)}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "bi-phone-error" : undefined}
              className={inputClass}
            />
            <FieldError id="bi-phone-error" message={errors.phone} />
          </div>
        </div>
      </QuestionBlock>

      {/* Q4 — effectif */}
      <QuestionBlock
        index={4}
        label="Combien de collaborateurs seraient concernés ?"
        revealed={revealed >= 4}
        animate={hasInteracted}
      >
        <fieldset
          aria-invalid={Boolean(errors.headcount)}
          aria-describedby={errors.headcount ? "bi-headcount-error" : undefined}
        >
          <legend className="sr-only">Effectif concerné</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {HEADCOUNT_OPTIONS.map((option, index) => (
              <label
                key={option.value}
                className={`pressable flex min-h-[44px] cursor-pointer items-center gap-3 border px-4 py-3 text-sm transition-colors ${
                  values.headcount === option.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/60"
                }`}
              >
                <input
                  id={index === 0 ? "bi-headcount" : undefined}
                  type="radio"
                  name="headcount"
                  value={option.value}
                  checked={values.headcount === option.value}
                  onChange={() => update("headcount", option.value)}
                  className="h-4 w-4 accent-[color:var(--primary)]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <FieldError id="bi-headcount-error" message={errors.headcount} />
      </QuestionBlock>

      {/* Q5 — besoins */}
      <QuestionBlock
        index={5}
        label="Quel est votre besoin principal ?"
        revealed={revealed >= 5}
        animate={hasInteracted}
      >
        <fieldset
          aria-invalid={Boolean(errors.needs)}
          aria-describedby={errors.needs ? "bi-needs-error" : undefined}
        >
          <legend className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
            Plusieurs réponses possibles
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {NEED_OPTIONS.map((option, index) => (
              <label
                key={option.value}
                className={`pressable flex min-h-[44px] cursor-pointer items-center gap-3 border px-4 py-3 text-sm transition-colors ${
                  values.needs.includes(option.value)
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/60"
                }`}
              >
                <input
                  id={index === 0 ? "bi-needs" : undefined}
                  type="checkbox"
                  name="needs"
                  value={option.value}
                  checked={values.needs.includes(option.value)}
                  onChange={() => toggleNeed(option.value)}
                  className="h-4 w-4 accent-[color:var(--primary)]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <FieldError id="bi-needs-error" message={errors.needs} />

        {otherSelected && (
          <div className="mt-4">
            <label htmlFor="bi-otherNeed" className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
              Précisez votre besoin
            </label>
            <input
              id="bi-otherNeed"
              name="otherNeed"
              type="text"
              maxLength={MAX_LENGTHS.otherNeed}
              value={values.otherNeed}
              onChange={(e) => update("otherNeed", e.target.value)}
              aria-invalid={Boolean(errors.otherNeed)}
              aria-describedby={errors.otherNeed ? "bi-otherNeed-error" : undefined}
              className={inputClass}
            />
            <FieldError id="bi-otherNeed-error" message={errors.otherNeed} />
          </div>
        )}
      </QuestionBlock>

      {/* Q6 — format et localisation */}
      <QuestionBlock
        index={6}
        label="Où et sous quel format souhaitez-vous être accompagné ?"
        revealed={revealed >= 6}
        animate={hasInteracted}
      >
        <fieldset
          aria-invalid={Boolean(errors.format)}
          aria-describedby={errors.format ? "bi-format-error" : undefined}
        >
          <legend className="sr-only">Format d&apos;accompagnement</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {FORMAT_OPTIONS.map((option, index) => (
              <label
                key={option.value}
                className={`pressable flex min-h-[44px] cursor-pointer items-center gap-3 border px-4 py-3 text-sm transition-colors ${
                  values.format === option.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/60"
                }`}
              >
                <input
                  id={index === 0 ? "bi-format" : undefined}
                  type="radio"
                  name="format"
                  value={option.value}
                  checked={values.format === option.value}
                  onChange={() => update("format", option.value)}
                  className="h-4 w-4 accent-[color:var(--primary)]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <FieldError id="bi-format-error" message={errors.format} />

        <div className="mt-4">
          <label htmlFor="bi-city" className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
            Ville ou zone géographique{" "}
            <span className="normal-case tracking-normal">
              {cityRequired ? "(requis pour une intervention en présentiel)" : "(facultatif à distance)"}
            </span>
          </label>
          <input
            id="bi-city"
            name="city"
            type="text"
            maxLength={MAX_LENGTHS.city}
            autoComplete="address-level2"
            value={values.city}
            onChange={(e) => update("city", e.target.value)}
            aria-invalid={Boolean(errors.city)}
            aria-describedby={errors.city ? "bi-city-error" : undefined}
            className={inputClass}
          />
          <FieldError id="bi-city-error" message={errors.city} />
        </div>
      </QuestionBlock>

      {/* Q7 — détails */}
      <QuestionBlock
        index={7}
        label="Pouvez-vous préciser votre projet ?"
        revealed={revealed >= 7}
        animate={hasInteracted}
      >
        <label htmlFor="bi-projectDetails" className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground">
          Fréquence souhaitée, période de démarrage, contraintes, objectifs, budget indicatif si vous le souhaitez
        </label>
        <textarea
          id="bi-projectDetails"
          name="projectDetails"
          rows={5}
          maxLength={MAX_LENGTHS.projectDetails}
          value={values.projectDetails}
          onChange={(e) => update("projectDetails", e.target.value)}
          aria-invalid={Boolean(errors.projectDetails)}
          aria-describedby={errors.projectDetails ? "bi-projectDetails-error" : undefined}
          className={`${inputClass} resize-y`}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {values.projectDetails.length} / {MAX_LENGTHS.projectDetails} caractères
        </p>
        <FieldError id="bi-projectDetails-error" message={errors.projectDetails} />
      </QuestionBlock>

      {/* Consentement — distinct des sept questions, dévoilé avec l'envoi.
          La question 7 étant facultative, `readyToSubmit` est atteint dès la
          question 6 validée : le prospect n'est jamais bloqué par un champ
          libre qu'il ne souhaite pas remplir. */}
      {readyToSubmit && (
      <div className={`border-t border-border pt-8 ${hasInteracted ? "question-reveal" : ""}`}>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-muted-foreground">
          <input
            id="bi-privacyAccepted"
            type="checkbox"
            name="privacyAccepted"
            checked={values.privacyAccepted}
            onChange={(e) => update("privacyAccepted", e.target.checked)}
            aria-invalid={Boolean(errors.privacyAccepted)}
            aria-describedby={errors.privacyAccepted ? "bi-privacyAccepted-error" : undefined}
            className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[color:var(--primary)]"
          />
          <span>
            J&apos;accepte que les informations transmises soient utilisées uniquement pour répondre à ma demande
            et établir une proposition commerciale.{" "}
            <Link
              href="/confidentialite"
              className="underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Politique de confidentialité
            </Link>
            .
          </span>
        </label>
        <FieldError id="bi-privacyAccepted-error" message={errors.privacyAccepted} />
      </div>
      )}

      {/* Piège à robots — masqué visuellement ET aux lecteurs d'écran. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="bi-website">Ne remplissez pas ce champ</label>
        <input
          id="bi-website"
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => update("website", e.target.value)}
        />
      </div>

      {status === "error" && (
        <p role="alert" className="flex items-start gap-2 border border-border bg-card px-4 py-3 text-sm text-foreground">
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
          {status === "sending" ? "Envoi en cours…" : "Envoyer ma demande"}
        </button>
      ) : (
        // Repère de fin de parcours tant que tout n'est pas renseigné : sans
        // lui, le formulaire semblerait dépourvu d'action.
        <p className="text-xs text-muted-foreground">
          Le bouton d&apos;envoi apparaîtra une fois les questions renseignées.
        </p>
      )}

      <p aria-live="polite" className="sr-only">
        {status === "sending" ? "Envoi de votre demande en cours." : `Question ${currentQuestion} sur ${QUESTION_COUNT}.`}
      </p>
    </form>
  );
}
