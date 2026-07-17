"use client";

import { useState, type ComponentType, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Globe, User, Users } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { PrimaryButton } from "@/components/admin/Modal";
import { useAdminData } from "@/hooks/useAdminData";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createProgram as createProgramSupabase } from "@/lib/supabase/programs";

const levelOptions = [
  { value: "Débutant", label: "Débutant" },
  { value: "Intermédiaire", label: "Intermédiaire" },
  { value: "Avancé", label: "Avancé" },
];

type ProgramPole = "individuel" | "groupe" | "public";

interface PoleDefinition {
  id: ProgramPole;
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  badge: string;
  bullets: string[];
  cta: string;
}

const poles: PoleDefinition[] = [
  {
    id: "individuel",
    icon: User,
    title: "Individuel",
    badge: "Coaching",
    bullets: [
      "Un planning propre à un seul élève.",
      "Suivi calé sur sa propre date de départ.",
      "Assigné ensuite depuis sa fiche élève.",
    ],
    cta: "Créer un programme individuel",
  },
  {
    id: "groupe",
    icon: Users,
    title: "De groupe",
    badge: "Coaching",
    bullets: [
      "Plusieurs élèves suivent le même planning.",
      "Une date de démarrage commune à toute la cohorte.",
      "Idéal pour un challenge ou une session collective.",
    ],
    cta: "Créer un programme de groupe",
  },
  {
    id: "public",
    icon: Globe,
    title: "Home page",
    badge: "Achat unique",
    bullets: [
      "Visible sur la home page et la page /programmes.",
      "Gratuit ou payant, sans abonnement.",
      "Crée automatiquement un compte élève limité à ce programme.",
    ],
    cta: "Créer un programme home page",
  },
];

/**
 * Création d'un programme (V3, étape "3 pôles" du chantier module
 * Programmation) : un premier écran fait choisir le pôle — individuel, de
 * groupe, ou public (home page / achat unique) — avant de recueillir les
 * informations générales. Le pôle choisi pré-configure `program_mode` et
 * `is_public`/`public_subscription_template_id` dès la création plutôt que
 * de laisser ces réglages enfouis dans le builder (le coach peut toujours
 * les changer ensuite depuis Réglages). La construction semaine/séance/
 * exercice se fait entièrement dans le builder plein écran, vers lequel on
 * redirige immédiatement après création — le programme est créé en
 * brouillon, sans aucune séance.
 */
export default function NewProgramPage() {
  const router = useRouter();
  const { createProgram } = useAdminData();

  const [pole, setPole] = useState<ProgramPole | null>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState("Intermédiaire");
  const [durationWeeks, setDurationWeeks] = useState(4);
  const [description, setDescription] = useState("");
  /** "" = gratuit, "__new__" = payant (prix personnalisé ci-dessous, toujours une formule/Product Stripe dédiée à ce programme). */
  const [accessChoice, setAccessChoice] = useState("");
  const [newPriceEuros, setNewPriceEuros] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Le nom du programme est obligatoire.");
      return;
    }
    if (pole === "public" && accessChoice === "__new__" && !(Number(newPriceEuros) > 0)) {
      setError("Renseigne un prix supérieur à 0, ou choisis Gratuit.");
      return;
    }
    setSubmitting(true);
    setError(null);

    // Prix personnalisé (chantier module Programmation, correctif "3 pôles") :
    // crée d'abord une formule one_time DÉDIÉE à ce programme (Product/Price
    // Stripe propre, jamais partagé avec un autre programme — voir
    // /api/admin/subscription-templates, déjà utilisée par /admin/abonnements)
    // avant de créer le programme, pour ne jamais forcer le coach à passer
    // par /admin/abonnements en amont et pour garantir qu'un visiteur qui
    // achète ce programme précis paie bien le Product Stripe de ce programme
    // précis.
    let publicSubscriptionTemplateId: string | null = null;
    if (pole === "public" && accessChoice === "__new__") {
      try {
        const response = await fetch("/api/admin/subscription-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `${name.trim()} — achat unique`,
            amountCents: Math.round(Number(newPriceEuros) * 100),
            currency: "eur",
            billingInterval: "one_time",
          }),
        });
        const body = await response.json();
        if (!response.ok || !body.template?.id) {
          setError(body.error ?? "Échec de la création du prix.");
          setSubmitting(false);
          return;
        }
        publicSubscriptionTemplateId = body.template.id;
      } catch {
        setError("Échec de la création du prix.");
        setSubmitting(false);
        return;
      }
    }

    const data = {
      name: name.trim(),
      goal,
      level,
      durationWeeks,
      description,
      status: "brouillon" as const,
      sessions: [],
      programMode: pole === "groupe" ? ("groupe" as const) : ("individuel" as const),
      isPublic: pole === "public",
      publicSubscriptionTemplateId,
    };

    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      const id = await createProgramSupabase(supabase, data);
      if (id) {
        router.push(`/admin/programmes/${id}/builder`);
        return;
      }
    }

    const id = createProgram({ ...data, assignedStudentIds: [] });
    router.push(`/admin/programmes/${id}/builder`);
  }

  if (!pole) {
    return (
      <div>
        <Link
          href="/admin/programmes"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Programmes
        </Link>

        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Créer une nouvelle programmation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Choisis le type de programmation qui correspond à ton objectif.</p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {poles.map(({ id, icon: Icon, title, badge, bullets, cta }) => (
            <div key={id} className="flex flex-col border border-border bg-card p-6">
              <div className="mb-6 flex h-28 items-center justify-center border border-border bg-black/30">
                <Icon size={32} className="text-primary" />
              </div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-heading text-lg font-bold uppercase text-foreground">{title}</h2>
                <span className="whitespace-nowrap border border-primary px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                  {badge}
                </span>
              </div>
              <ul className="mb-6 flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
                {bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2">
                    <span className="text-primary">•</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setPole(id)}
                className="border border-foreground bg-foreground px-4 py-3 text-xs uppercase tracking-widest text-background transition-colors hover:bg-transparent hover:text-foreground"
              >
                {cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const activePole = poles.find((p) => p.id === pole);

  return (
    <div>
      <button
        type="button"
        onClick={() => setPole(null)}
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Choisir un autre type
      </button>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Créer un programme — {activePole?.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Renseigne les informations générales, la construction semaine par semaine se fait ensuite dans le builder.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-4 border border-border bg-card p-6">
        <Field label="Nom du programme" value={name} onChange={setName} required />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Objectif" value={goal} onChange={setGoal} />
          <SelectField label="Niveau" value={level} onChange={setLevel} options={levelOptions} />
          <Field
            label="Durée (semaines)"
            type="number"
            value={String(durationWeeks)}
            onChange={(v) => setDurationWeeks(Number(v) || 0)}
          />
        </div>
        <TextareaField label="Description" value={description} onChange={setDescription} rows={3} />

        {pole === "public" && (
          <div className="flex flex-col gap-3 border border-border p-4">
            <SelectField
              label="Accès"
              value={accessChoice}
              onChange={setAccessChoice}
              options={[
                { value: "", label: "Gratuit (aucun paiement)" },
                { value: "__new__", label: "Payant — prix personnalisé" },
              ]}
            />
            {accessChoice === "__new__" && (
              <Field
                label="Prix (€ TTC)"
                type="number"
                step="0.01"
                value={newPriceEuros}
                onChange={setNewPriceEuros}
                placeholder="Ex : 19"
              />
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Le programme sera publié sur la home page et /programmes dès sa création. Un visiteur qui achète (ou
              récupère gratuitement) ce programme obtient un compte élève limité à ce programme uniquement — pas
              d&apos;accès nutrition, rendez-vous ou documents. Chaque programme payant obtient son propre Product/Price
              Stripe dédié (jamais partagé avec un autre programme) — un visiteur qui l&apos;achète paie précisément ce
              programme. Ces réglages restent modifiables ensuite dans le builder.
            </p>
          </div>
        )}

        {pole === "groupe" && (
          <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
            La date de démarrage commune à la cohorte se règle ensuite dans les réglages du programme, une fois dans
            le builder.
          </p>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <PrimaryButton type="submit" disabled={submitting}>
          <span className="flex items-center justify-center gap-2">
            Continuer et construire
            <ArrowRight size={14} />
          </span>
        </PrimaryButton>
      </form>
    </div>
  );
}
