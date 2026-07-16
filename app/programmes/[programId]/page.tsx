import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PublicProgramPurchaseForm } from "@/components/sections/PublicProgramPurchaseForm";
import { formatAmountCents } from "@/lib/stripe/status";
import { getPublicProgramById } from "@/lib/supabase/public-programs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ programId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { programId } = await params;
  const supabase = await createSupabaseServerClient();
  const program = supabase ? await getPublicProgramById(supabase, programId) : null;
  return { title: program ? `${program.name} — Seth Préparation Physique` : "Programme — Seth Préparation Physique" };
}

/**
 * Page détail publique d'un programme (chantier module Programmation, étape
 * 6) — uniquement les champs marketing (getPublicProgramById, jamais le
 * détail séance/exercice). Le formulaire d'achat/réclamation
 * (PublicProgramPurchaseForm) déclenche soit un Checkout Stripe anonyme
 * (programme payant), soit une réclamation directe sans paiement (gratuit).
 */
export default async function PublicProgramDetailPage({ params }: PageProps) {
  const { programId } = await params;
  const supabase = await createSupabaseServerClient();
  const program = supabase ? await getPublicProgramById(supabase, programId) : null;

  if (!program) {
    notFound();
  }

  return (
    <section className="bg-black py-24">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <div className="aspect-[16/10] w-full overflow-hidden border border-border bg-zinc-950">
            {program.bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- bucket Storage public, URL externe
              <img src={program.bannerUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">Programme</span>
              </div>
            )}
          </div>

          <div>
            {program.level && (
              <span className="font-heading text-xs font-semibold uppercase tracking-wide text-primary">{program.level}</span>
            )}
            <h1 className="mt-2 font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">{program.name}</h1>
            {program.goal && <p className="mt-2 text-muted-foreground">{program.goal}</p>}
          </div>

          <div className="flex flex-wrap gap-6 border-y border-border py-4 text-sm text-muted-foreground">
            {program.durationWeeks > 0 && <span>{program.durationWeeks} semaines</span>}
            <span className="font-bold text-foreground">
              {program.priceCents ? formatAmountCents(program.priceCents, program.currency) : "Gratuit"}
            </span>
          </div>

          {program.description && <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{program.description}</p>}
        </div>

        <div className="border border-border bg-zinc-950 p-8">
          <h2 className="mb-2 font-heading text-lg font-bold uppercase text-foreground">
            {program.priceCents ? "Réserver mon accès" : "Recevoir mon programme"}
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
            Un compte te sera créé automatiquement, limité à ce programme (pas d&apos;accès nutrition, rendez-vous ou
            documents). Tu recevras un email pour définir ton mot de passe et y accéder.
          </p>
          <PublicProgramPurchaseForm programId={program.id} priceCents={program.priceCents} currency={program.currency} />
        </div>
      </div>
    </section>
  );
}
