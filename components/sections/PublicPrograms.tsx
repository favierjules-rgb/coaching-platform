import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PublicProgramsMarquee } from "@/components/sections/PublicProgramsMarquee";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { getPublicPrograms } from "@/lib/supabase/public-programs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Section home page "Programmes disponibles" (chantier module
 * Programmation, étape 6), placée juste après Transformations : deux
 * bandeaux auto-défilants (PublicProgramsMarquee) présentant les programmes
 * publics (gratuits ou achat unique), avec une invitation à consulter la
 * bibliothèque complète (/programmes). Ne s'affiche pas tant qu'aucun
 * programme n'est publié (`is_public = true`, réglé depuis le builder
 * admin) — rien à montrer plutôt qu'une section vide.
 */
export async function PublicPrograms() {
  const supabase = await createSupabaseServerClient();
  const programs = supabase ? await getPublicPrograms(supabase) : [];

  if (programs.length === 0) {
    return null;
  }

  return (
    <section id="programmes" className="overflow-hidden bg-black py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Accès immédiat</SectionLabel>
        <h2 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
          Programmes disponibles
        </h2>
        <p className="mb-16 max-w-xl text-muted-foreground">
          Des programmes clé en main en accès immédiat — gratuits ou en paiement unique, sans abonnement.
        </p>
      </div>

      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-6 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <PublicProgramsMarquee programs={programs} durationSeconds={Math.max(28, programs.length * 9)} />
          <PublicProgramsMarquee programs={[...programs].reverse()} durationSeconds={Math.max(34, programs.length * 11)} />
        </div>

        <div className="flex flex-shrink-0 flex-col items-start gap-4 border border-border bg-zinc-950 p-8 lg:w-72">
          <h3 className="font-heading text-2xl font-extrabold uppercase text-foreground">Découvrez plus de programmes</h3>
          <p className="text-sm text-muted-foreground">
            Toute la bibliothèque des programmes disponibles en achat unique, gratuits et payants.
          </p>
          <Link
            href="/programmes"
            className="mt-2 flex items-center gap-2 border border-primary px-5 py-3 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Voir la bibliothèque
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
