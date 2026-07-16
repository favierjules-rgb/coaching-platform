"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

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

/**
 * Création d'un programme (V3) : ne recueille plus que les informations
 * générales — la construction semaine/séance/exercice se fait entièrement
 * dans le builder plein écran, vers lequel on redirige immédiatement après
 * création (voir spec V3, flux direct sans page intermédiaire). Le
 * programme est créé en brouillon, sans aucune séance : le builder ajoute
 * les semaines à la demande.
 */
export default function NewProgramPage() {
  const router = useRouter();
  const { createProgram } = useAdminData();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState("Intermédiaire");
  const [durationWeeks, setDurationWeeks] = useState(4);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Le nom du programme est obligatoire.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const data = {
      name: name.trim(),
      goal,
      level,
      durationWeeks,
      description,
      status: "brouillon" as const,
      sessions: [],
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

  return (
    <div>
      <Link href="/admin/programmes" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Programmes
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Créer un programme
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
