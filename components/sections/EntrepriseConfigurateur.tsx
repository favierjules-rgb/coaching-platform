"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";

import { FieldError, progressiveInputClass } from "@/components/ui/ProgressiveQuestions";
import { ChoiceCard, ChoiceGrid, Step, StepNav, StepProgress } from "@/components/ui/StepFlow";
import {
  CONTACT_STEP,
  FREQUENCY_OPTIONS,
  HEADCOUNT_OPTIONS,
  LOCATIONS_REQUIRING_CITY,
  LOCATION_OPTIONS,
  MAX_LENGTHS,
  OBJECTIVE_OPTIONS,
  SECTOR_OPTIONS,
  STEP_COUNT,
  STEP_FIELDS,
  TIMELINE_OPTIONS,
  businessInquirySchema,
  firstIncompleteStep,
  labelFor,
} from "@/lib/business-inquiry/schema";

/**
 * Configurateur « GRIT Entreprise » — sept étapes, une par écran.
 *
 * ════════════════════════════════════════════════════════════════════════
 * IL QUALIFIE UN PROJET, IL NE CHIFFRE RIEN
 * ════════════════════════════════════════════════════════════════════════
 * Aucun montant, aucune devise, aucun calcul, aucun paiement : le prix se
 * discute pendant l'appel (décision commerciale du 13/09/2026). Le
 * récapitulatif final montre la CONFIGURATION choisie, jamais une somme.
 * `scripts/tests/configurateur-entreprise.mts` échoue si un montant ou une
 * logique de facturation réapparaît dans ce fichier.
 *
 * ⚠️ LE SCHÉMA ZOD RESTE LA SEULE AUTORITÉ. La complétude d'une étape est
 * DÉDUITE de `firstIncompleteStep` — aucune règle n'est réécrite ici, donc
 * une étape ne peut pas être jugée franchissable à l'affichage puis refusée
 * à l'envoi. Même principe que le formulaire progressif dont ce
 * configurateur prend la suite.
 *
 * ⚠️ LES RÉPONSES NE SONT JAMAIS PERDUES. Revenir en arrière, corriger,
 * repartir en avant : `values` n'est remis à zéro que par la
 * réinitialisation explicite ou par un envoi réussi. Une validation qui
 * échoue ne modifie que `errors`.
 */

type Errors = Record<string, string>;

const initialState = {
  headcount: "",
  frequency: "",
  objectives: [] as string[],
  sector: "",
  timeline: "",
  projectDetails: "",
  location: "",
  city: "",
  companyName: "",
  contactName: "",
  contactRole: "",
  email: "",
  phone: "",
  privacyAccepted: false,
  website: "", // honeypot
};

type FormState = typeof initialState;

/** Intitulé de chaque étape — sert au titre affiché et au récapitulatif. */
const STEP_TITLES: readonly { title: string; hint?: string }[] = [
  { title: "Combien de collaborateurs souhaitez-vous accompagner ?" },
  { title: "À quelle fréquence ?", hint: "Chaque séance dure environ 45 minutes." },
  { title: "Quel est votre objectif principal ?", hint: "Plusieurs réponses possibles." },
  { title: "Quel est votre secteur d'activité ?" },
  { title: "Quand souhaitez-vous lancer le programme ?" },
  { title: "Parlez-nous de votre projet", hint: "Facultatif — vous pouvez passer cette étape." },
  {
    title: "Parlons de votre projet.",
    hint: "Nous avons les informations nécessaires pour préparer votre proposition.",
  },
];

const ERREUR_GENERIQUE =
  "Une erreur est survenue pendant l'envoi. Merci de réessayer ou de me contacter directement.";

export function EntrepriseConfigurateur() {
  const [values, setValues] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  /** Aucune animation au premier rendu : la section s'ouvre immobile. */
  const [hasMoved, setHasMoved] = useState(false);

  /**
   * Verrou d'envoi SYNCHRONE. `status` ne suffit pas : deux clics dans le
   * même tick lisent la même valeur de state avant le re-rendu, et deux
   * requêtes partent. Le serveur les neutralise (garde anti-rejeu), mais
   * autant ne pas les émettre.
   */
  const sendingRef = useRef(false);
  const titleRef = useRef<HTMLDivElement | null>(null);

  const cityRequired = (LOCATIONS_REQUIRING_CITY as readonly string[]).includes(values.location);

  /** Déplace le focus sur le titre de l'étape après un changement délibéré. */
  function focusStepTitle() {
    window.requestAnimationFrame(() => {
      titleRef.current?.querySelector<HTMLElement>("h3[tabindex]")?.focus();
    });
  }

  function update(patch: Partial<FormState>) {
    setValues((current) => ({ ...current, ...patch }));
    // Une correction efface l'erreur du champ corrigé, pas les autres.
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  }

  function toggleObjective(value: string) {
    const selected = values.objectives.includes(value);
    update({
      objectives: selected
        ? values.objectives.filter((o) => o !== value)
        : [...values.objectives, value],
    });
  }

  /**
   * Messages d'erreur de l'étape courante, extraits du schéma partagé.
   *
   * ⚠️ LE CONSENTEMENT EST NEUTRALISÉ PENDANT LA PROGRESSION, comme dans la
   * brique partagée : sans cela, `privacyAccepted: z.literal(true)` fait
   * échouer l'objet entier et les règles conditionnelles ne sont jamais
   * évaluées.
   */
  function errorsForStep(state: FormState, cible: number): Errors {
    const parsed = businessInquirySchema.safeParse({ ...state, privacyAccepted: true });
    if (parsed.success) return {};
    // ⚠️ LES CHAMPS D'UNE ÉTAPE VIENNENT DU SCHÉMA, JAMAIS D'UNE COPIE
    // LOCALE. Une liste dupliquée ici finirait par diverger de STEP_FIELDS,
    // et une étape se laisserait franchir alors qu'elle bloque l'envoi.
    const champs = new Set(STEP_FIELDS[cible - 1]);
    const next: Errors = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (champs.has(key) && !next[key]) next[key] = issue.message;
    }
    return next;
  }

  function goNext() {
    setHasMoved(true);
    const bloquantes = errorsForStep(values, step);
    if (Object.keys(bloquantes).length > 0) {
      setErrors(bloquantes);
      return;
    }
    setErrors({});
    setStep((current) => Math.min(current + 1, STEP_COUNT));
    focusStepTitle();
  }

  function goBack() {
    setHasMoved(true);
    // ⚠️ AUCUNE VALIDATION AU RETOUR, ET AUCUNE PERTE. On revient toujours,
    // même depuis une étape incomplète, et les réponses restent intactes.
    setErrors({});
    setStep((current) => Math.max(current - 1, 1));
    focusStepTitle();
  }

  function reset() {
    setValues(initialState);
    setErrors({});
    setStep(1);
    setStatus("idle");
    setFeedback("");
    sendingRef.current = false;
    setHasMoved(true);
    focusStepTitle();
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
      // Ramène à la PREMIÈRE étape fautive plutôt que de signaler dans le
      // vide : l'erreur peut concerner une étape déjà dépassée.
      const fautive = Math.min(firstIncompleteStep(values), CONTACT_STEP);
      if (fautive !== step) {
        setStep(fautive);
        focusStepTitle();
      } else {
        const firstKey = Object.keys(nextErrors)[0];
        if (firstKey) document.getElementById(`ec-${firstKey}`)?.focus();
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
        setFeedback(payload.error ?? ERREUR_GENERIQUE);
        return;
      }

      setStatus("success");
      setFeedback(
        payload.message ?? "Demande envoyée. Nous revenons vers vous pour échanger sur votre projet.",
      );
      setValues(initialState);
    } catch {
      setStatus("error");
      setFeedback(ERREUR_GENERIQUE);
    } finally {
      // Libéré dans tous les cas : un échec doit rester réessayable.
      sendingRef.current = false;
    }
  }

  /* ─── Écran de confirmation ─── */
  if (status === "success") {
    return (
      <div className="page-card p-8 text-center md:p-12" role="status" aria-live="polite">
        <CheckCircle2 size={40} className="mx-auto mb-6 text-primary" aria-hidden />
        <h3 className="mb-3 font-heading text-2xl font-extrabold uppercase text-foreground md:text-3xl">
          Demande envoyée.
        </h3>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
          {feedback}
        </p>
        <button
          type="button"
          onClick={reset}
          className="pressable mt-8 inline-flex min-h-[48px] items-center gap-2 rounded-control border border-border-strong px-5 py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <RotateCcw size={14} aria-hidden />
          Nouvelle demande
        </button>
      </div>
    );
  }

  const meta = STEP_TITLES[step - 1];
  const enDernier = step === CONTACT_STEP;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-10">
      <StepProgress current={step} total={STEP_COUNT} />

      <div ref={titleRef}>
        <Step titleId="ec-step-title" title={meta.title} hint={meta.hint} animate={hasMoved}>
          {step === 1 ? (
            <ChoiceGrid>
              {HEADCOUNT_OPTIONS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  selected={values.headcount === option.value}
                  label={option.label}
                  onSelect={() => update({ headcount: option.value })}
                />
              ))}
            </ChoiceGrid>
          ) : null}

          {step === 2 ? (
            <ChoiceGrid columns={1}>
              {FREQUENCY_OPTIONS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  selected={values.frequency === option.value}
                  label={option.label}
                  onSelect={() => update({ frequency: option.value })}
                />
              ))}
            </ChoiceGrid>
          ) : null}

          {step === 3 ? (
            <ChoiceGrid>
              {OBJECTIVE_OPTIONS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  multiple
                  selected={values.objectives.includes(option.value)}
                  label={option.label}
                  onSelect={() => toggleObjective(option.value)}
                />
              ))}
            </ChoiceGrid>
          ) : null}

          {step === 4 ? (
            <ChoiceGrid>
              {SECTOR_OPTIONS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  selected={values.sector === option.value}
                  label={option.label}
                  onSelect={() => update({ sector: option.value })}
                />
              ))}
            </ChoiceGrid>
          ) : null}

          {step === 5 ? (
            <ChoiceGrid>
              {TIMELINE_OPTIONS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  selected={values.timeline === option.value}
                  label={option.label}
                  onSelect={() => update({ timeline: option.value })}
                />
              ))}
            </ChoiceGrid>
          ) : null}

          {step === 6 ? (
            <div className="flex flex-col gap-8">
              <fieldset>
                <legend className="mb-4 text-sm font-semibold text-foreground">
                  Où souhaitez-vous que les séances se déroulent ?
                  <span className="ml-2 font-normal text-muted-foreground">(facultatif)</span>
                </legend>
                <ChoiceGrid>
                  {LOCATION_OPTIONS.map((option) => (
                    <ChoiceCard
                      key={option.value}
                      selected={values.location === option.value}
                      label={option.label}
                      onSelect={() =>
                        update({ location: values.location === option.value ? "" : option.value })
                      }
                    />
                  ))}
                </ChoiceGrid>
              </fieldset>

              {cityRequired ? (
                <div>
                  <label htmlFor="ec-city" className="mb-2 block text-sm font-semibold text-foreground">
                    Ville ou zone de l&apos;intervention
                  </label>
                  <input
                    id="ec-city"
                    name="city"
                    type="text"
                    value={values.city}
                    maxLength={MAX_LENGTHS.city}
                    onChange={(e) => update({ city: e.target.value })}
                    aria-invalid={errors.city ? true : undefined}
                    aria-describedby={errors.city ? "ec-city-error" : undefined}
                    className={progressiveInputClass}
                  />
                  <FieldError id="ec-city-error" message={errors.city} />
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="ec-projectDetails"
                  className="mb-2 block text-sm font-semibold text-foreground"
                >
                  Un contexte, une contrainte, une question ?
                  <span className="ml-2 font-normal text-muted-foreground">(facultatif)</span>
                </label>
                <textarea
                  id="ec-projectDetails"
                  name="projectDetails"
                  rows={5}
                  value={values.projectDetails}
                  maxLength={MAX_LENGTHS.projectDetails}
                  onChange={(e) => update({ projectDetails: e.target.value })}
                  className={`${progressiveInputClass} resize-y`}
                />
              </div>
            </div>
          ) : null}

          {step === CONTACT_STEP ? (
            <div className="flex flex-col gap-8">
              <Recapitulatif values={values} />

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <ChampTexte
                  id="companyName"
                  label="Entreprise"
                  value={values.companyName}
                  max={MAX_LENGTHS.companyName}
                  error={errors.companyName}
                  autoComplete="organization"
                  onChange={(v) => update({ companyName: v })}
                />
                <ChampTexte
                  id="contactName"
                  label="Nom et prénom"
                  value={values.contactName}
                  max={MAX_LENGTHS.contactName}
                  error={errors.contactName}
                  autoComplete="name"
                  onChange={(v) => update({ contactName: v })}
                />
                <ChampTexte
                  id="contactRole"
                  label="Votre fonction"
                  value={values.contactRole}
                  max={MAX_LENGTHS.contactRole}
                  error={errors.contactRole}
                  autoComplete="organization-title"
                  onChange={(v) => update({ contactRole: v })}
                />
                <ChampTexte
                  id="email"
                  label="Email professionnel"
                  type="email"
                  value={values.email}
                  max={MAX_LENGTHS.email}
                  error={errors.email}
                  autoComplete="email"
                  onChange={(v) => update({ email: v })}
                />
                <ChampTexte
                  id="phone"
                  label="Téléphone"
                  optionnel
                  type="tel"
                  value={values.phone}
                  max={MAX_LENGTHS.phone}
                  error={errors.phone}
                  autoComplete="tel"
                  onChange={(v) => update({ phone: v })}
                />
              </div>

              {/* Honeypot : masqué visuellement ET au clavier, jamais rempli par un humain. */}
              <div aria-hidden className="hidden">
                <label htmlFor="ec-website">Site web</label>
                <input
                  id="ec-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={values.website}
                  onChange={(e) => update({ website: e.target.value })}
                />
              </div>

              <div>
                <label htmlFor="ec-privacy" className="flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    id="ec-privacy"
                    name="privacyAccepted"
                    type="checkbox"
                    checked={values.privacyAccepted}
                    onChange={(e) => update({ privacyAccepted: e.target.checked })}
                    aria-invalid={errors.privacyAccepted ? true : undefined}
                    aria-describedby={errors.privacyAccepted ? "ec-privacy-error" : undefined}
                    className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[var(--primary)]"
                  />
                  <span className="leading-relaxed text-muted-foreground">
                    J&apos;accepte que ces informations soient utilisées pour traiter ma demande.
                    Voir la{" "}
                    <Link href="/confidentialite" className="text-primary underline">
                      politique de confidentialité
                    </Link>
                    .
                  </span>
                </label>
                <FieldError id="ec-privacy-error" message={errors.privacyAccepted} />
              </div>
            </div>
          ) : null}
        </Step>
      </div>

      {enDernier ? (
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={goBack}
            className="pressable inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control border border-border-strong px-5 py-3 text-sm font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Retour
          </button>
          <button
            type="submit"
            disabled={status === "sending"}
            aria-busy={status === "sending" ? true : undefined}
            className="pressable inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-control bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 sm:flex-none"
          >
            {status === "sending" ? (
              <>
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />
                Envoi en cours…
              </>
            ) : (
              "Demander mon devis"
            )}
          </button>
        </div>
      ) : (
        <StepNav showBack={step > 1} onBack={goBack} onNext={goNext} />
      )}

      {/* Région live UNIQUE : progression et résultat d'envoi y sont annoncés. */}
      <p aria-live="polite" className="sr-only">
        {`Étape ${step} sur ${STEP_COUNT}`}
      </p>

      {status === "error" && feedback ? (
        <p
          role="alert"
          className="flex items-start gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden />
          {feedback}
        </p>
      ) : null}
    </form>
  );
}

/* ─────────────── Sous-composants ─────────────── */

function ChampTexte({
  id,
  label,
  value,
  max,
  error,
  type = "text",
  optionnel,
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  error?: string;
  type?: string;
  optionnel?: boolean;
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={`ec-${id}`} className="mb-2 block text-sm font-semibold text-foreground">
        {label}
        {optionnel ? <span className="ml-2 font-normal text-muted-foreground">(facultatif)</span> : null}
      </label>
      <input
        id={`ec-${id}`}
        name={id}
        type={type}
        value={value}
        maxLength={max}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `ec-${id}-error` : undefined}
        className={progressiveInputClass}
      />
      <FieldError id={`ec-${id}-error`} message={error} />
    </div>
  );
}

/**
 * Récapitulatif de la configuration — ce que le prospect a construit.
 *
 * ⚠️ IL MONTRE DES CHOIX, JAMAIS UNE SOMME. C'est la contrepartie de la
 * décision commerciale : le prospect voit son projet pris en compte, le
 * chiffrage se fait pendant l'appel.
 */
function Recapitulatif({ values }: { values: FormState }) {
  const lignes: { label: string; value: string }[] = [];

  if (values.headcount) {
    lignes.push({ label: "Collaborateurs", value: labelFor(HEADCOUNT_OPTIONS, values.headcount) });
  }
  if (values.frequency) {
    lignes.push({ label: "Fréquence", value: labelFor(FREQUENCY_OPTIONS, values.frequency) });
  }
  if (values.objectives.length > 0) {
    lignes.push({
      label: "Objectifs",
      value: values.objectives.map((o) => labelFor(OBJECTIVE_OPTIONS, o)).join(" · "),
    });
  }
  if (values.sector) {
    lignes.push({ label: "Secteur", value: labelFor(SECTOR_OPTIONS, values.sector) });
  }
  if (values.timeline) {
    lignes.push({ label: "Démarrage", value: labelFor(TIMELINE_OPTIONS, values.timeline) });
  }
  if (values.location) {
    lignes.push({
      label: "Lieu",
      value: values.city
        ? `${labelFor(LOCATION_OPTIONS, values.location)} — ${values.city}`
        : labelFor(LOCATION_OPTIONS, values.location),
    });
  }

  if (lignes.length === 0) return null;

  return (
    <div className="page-card p-6">
      <p className="mb-5 font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
        Votre projet
      </p>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {lignes.map((ligne) => (
          <div key={ligne.label}>
            <dt className="text-xs uppercase tracking-widest text-muted-foreground">{ligne.label}</dt>
            <dd className="mt-1 font-heading text-sm font-bold uppercase leading-tight text-foreground">
              {ligne.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
