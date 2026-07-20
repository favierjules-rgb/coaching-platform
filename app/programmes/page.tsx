import type { Metadata } from "next";
import Image from "next/image";

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
    <section className="relative min-h-[700px] overflow-hidden bg-black py-24">
      {/*
        Fond photo (chantier "backgrounds", juillet 2026) — page unique,
        pas besoin d'un prop opt-in. Même pattern qu'AuthCardLayout/Hero :
        fond en `absolute inset-0` sans z-index, contenu en `relative z-10`.
        Colonne droite plus étroite (au lieu du plein cadre initial) : la
        photo source (941×1672) est modeste en résolution native — affichée
        sur ~45% de la largeur plutôt que 100%, elle demande moins
        d'agrandissement et reste nette. Dégradé horizontal noir qui la
        fond dans le reste de la section (masque aussi la jonction gauche).
        `hidden lg:block` : masquée sous lg pour ne pas comprimer le
        contenu sur mobile/tablette, même choix que l'ancien Hero.
      */}
      <div className="absolute inset-y-0 right-0 hidden w-[45%] lg:block">
        <Image
          src="/brand/backgrounds/programmes.webp"
          alt=""
          fill
          sizes="45vw"
          className="object-cover object-[center_45%] grayscale"
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,1)_0%,rgba(0,0,0,1)_12%,rgba(0,0,0,0.4)_50%,rgba(0,0,0,0.2)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.25)_0%,rgba(0,0,0,0)_30%,rgba(0,0,0,0.5)_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6">
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
