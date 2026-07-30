import { Check } from "lucide-react";

import { FreeAssessmentForm } from "@/components/sections/FreeAssessmentForm";
import { SectionLabel } from "@/components/ui/SectionLabel";

/**
 * Section home page « Mon bilan offert » (juillet 2026) — placée entre
 * `Transformations` (les résultats donnent envie) et `PublicPrograms` (les
 * offres), c'est-à-dire au moment exact où le visiteur se demande « et pour
 * moi, ça donnerait quoi ? ».
 *
 * Mise en avant (chantier `feat/home-bilan-offert-mise-en-avant`) : c'est la
 * seule section de la home à porter un accent coloré, et cet accent reste
 * enfermé dans `.bilan-highlight` (voir globals.css) — le reste de la page ne
 * change pas d'un pixel. L'effet recherché est une brillance (halo froid
 * derrière l'encadré, filet lumineux sur son bord) plutôt qu'un aplat de
 * couleur, pour cohabiter avec l'identité noir et blanc.
 *
 * Composition en deux colonnes à partir de `lg` : argumentaire à gauche,
 * encadré du formulaire à droite. En dessous, une seule colonne empilée —
 * aucune largeur fixe nulle part, rembourrages et rayons en `clamp()`.
 *
 * Le questionnaire progressif vit dans `FreeAssessmentForm` (composant
 * client) ; cette section reste un composant serveur, comme ses voisines, et
 * la logique du formulaire n'est pas touchée.
 *
 * Ancre stable `#bilan-offert` pour de futurs appels à l'action.
 */

const reassurances = [
  "Entretien avec un professionnel",
  "Aucune carte bancaire, aucun engagement.",
  "Cinq minutes suffisent pour répondre.",
];

export function FreeAssessment() {
  return (
    <section id="bilan-offert" className="bilan-highlight scroll-mt-24 overflow-hidden bg-black py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          {/* Colonne argumentaire — écriture resserrée : interligne court,
              approche négative sur le titre, mesure limitée en `ch` pour
              rester lisible de 320 px à 1440 px. */}
          <div className="max-w-[46ch]">
            <SectionLabel>Premier échange</SectionLabel>

            <h2 className="mb-4 font-heading text-[2.5rem] font-extrabold uppercase leading-[0.92] tracking-[-0.03em] text-foreground sm:text-5xl md:text-6xl">
              Mon bilan offert
            </h2>

            <p className="mb-4 text-[0.975rem] leading-snug text-muted-foreground">
              Réponds à quelques questions pour me permettre de comprendre ton objectif et les difficultés que tu
              rencontres. Je te recontacte personnellement afin d&apos;échanger sur ta situation et définir les
              prochaines étapes.
            </p>

            <ul className="mb-6 flex flex-col gap-2">
              {reassurances.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[0.9rem] leading-snug text-muted-foreground">
                  <Check size={15} className="bilan-bullet mt-[0.2em] flex-shrink-0" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <span className="bilan-tag inline-flex items-center rounded-full px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em]">
              Sans engagement
            </span>
          </div>

          {/* Encadré du formulaire — c'est lui qui porte la brillance.
              `lg:mt-14` le décale vers le bas en deux colonnes : son anneau
              lumineux ne se retrouve plus à fleur du bord supérieur de la
              section, ce qui laisse le haut du bloc entièrement noir et fait
              arriver la couleur progressivement. En colonne unique, l'encadré
              vient déjà après le texte : aucun décalage nécessaire. */}
          <div className="bilan-card lg:mt-14">
            <FreeAssessmentForm />
          </div>
        </div>
      </div>
    </section>
  );
}
