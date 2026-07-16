import type { Metadata } from "next";

import { PublicProgramCard } from "@/components/sections/PublicProgramCard";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { getPublicPrograms } from "@/lib/supabase/public-programs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Programmes — Seth Préparation Physique",
  description: "Bibliothèque des programmes d'entraînement disponibles en accès immédiat, gratuits ou en paiement unique.",
};

/**
 * Bibliothèque publique complète (chantier module Programmation, étape 6) —
 * accessible depuis le menu burger de la home page et depuis le CTA
 * "Découvrez plus de programmes" de la section home page. Même carte que le
 * bandeau home page (PublicProgramCard), en grille classique ici.
 */
export default async function ProgrammesPage() {
  const supabase = await createSupabaseServerClient();
  const programs = supabase ? await getPublicPrograms(supabase) : [];

  return (
    <section className="bg-black py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Bibliothèque</SectionLabel>
        <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">Programmes</h1>
        <p className="mb-16 max-w-xl text-muted-foreground">
          Tous les programmes disponibles en accès immédiat — gratuits ou en paiement unique, sans abonnement.
        </p>

        {programs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun programme disponible pour le moment. Reviens bientôt !</p>
        ) : (
          <div className="flex flex-wrap gap-6">
            {programs.map((program) => (
              <PublicProgramCard key={program.id} program={program} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
