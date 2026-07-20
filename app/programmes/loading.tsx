import { SectionLabel } from "@/components/ui/SectionLabel";

/**
 * État de chargement de /programmes (correctif chantier /programmes,
 * juillet 2026) — squelette sobre et statique (aucune animation), affiché
 * automatiquement par Next.js (convention de fichier `loading.tsx`) pendant
 * la récupération serveur du catalogue public. L'en-tête reproduit à
 * l'identique le texte statique de app/programmes/page.tsx (à garder
 * synchronisé si ce texte change) : seule la grille, réellement dépendante
 * des données, est représentée par des blocs neutres.
 */
export default function ProgrammesLoading() {
  return (
    <section className="bg-black py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Bibliothèque</SectionLabel>
        <h1 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">Programmes</h1>
        <p className="mb-16 max-w-xl text-muted-foreground">
          Tous les programmes disponibles en accès immédiat — gratuits ou en paiement unique, sans abonnement.
        </p>

        <div className="flex flex-wrap gap-6" role="status">
          <span className="sr-only">Chargement des programmes…</span>
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden="true" className="flex w-72 flex-shrink-0 flex-col border border-border bg-zinc-950">
              <div className="aspect-[16/10] w-full bg-zinc-900" />
              <div className="flex flex-1 flex-col gap-2 p-5">
                <div className="h-3 w-16 bg-zinc-800" />
                <div className="h-4 w-32 bg-zinc-800" />
                <div className="h-3 w-full bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
