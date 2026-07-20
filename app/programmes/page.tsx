import type { Metadata } from "next";

import { PublicProgramCard } from "@/components/sections/PublicProgramCard";
import { PublicProgramsRetry } from "@/components/sections/PublicProgramsRetry";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { getPublicPrograms } from "@/lib/supabase/public-programs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicProgramsResult } from "@/types";

export const metadata: Metadata = {
  title: "Programmes — Seth Préparation Physique",
  description: "Bibliothèque des programmes d'entraînement disponibles en accès immédiat, gratuits ou en paiement unique.",
};

/**
 * Bibliothèque publique complète (chantier module Programmation, étape 6) —
 * accessible depuis le menu burger de la home page et depuis le CTA
 * "Découvrez plus de programmes" de la section home page. Même carte que le
 * bandeau home page (PublicProgramCard), en grille classique ici.
 *
 * Correctif chantier /programmes (juillet 2026) : `getPublicPrograms`
 * renvoie un `PublicProgramsResult` typé (voir types/index.ts et
 * lib/supabase/public-programs.ts) — trois issues distinctes sont
 * maintenant rendues explicitement : succès avec programmes, succès avec
 * catalogue vide, et erreur de récupération (avec action "Réessayer").
 * Aucune dépendance à une session utilisateur : cette page reste publique.
 */
export default async function ProgrammesPage() {
  const supabase = await createSupabaseServerClient();
  const result: PublicProgramsResult = supabase
    ? await getPublicPrograms(supabase)
    : { status: "success", programs: [] };

  return (
    <section className="bg-black py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Bibliothèque</SectionLabel>
        <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">Programmes</h1>
        <p className="mb-16 max-w-xl text-muted-foreground">
          Tous les programmes disponibles en accès immédiat — gratuits ou en paiement unique, sans abonnement.
        </p>

        {result.status === "error" ? (
          <div className="max-w-md border border-border bg-zinc-950 p-6">
            <p className="mb-4 text-sm text-muted-foreground">{result.message}</p>
            <PublicProgramsRetry />
          </div>
        ) : result.programs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun programme disponible pour le moment. Reviens bientôt !</p>
        ) : (
          <div className="flex flex-wrap gap-6">
            {result.programs.map((program) => (
              <PublicProgramCard key={program.id} program={program} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
