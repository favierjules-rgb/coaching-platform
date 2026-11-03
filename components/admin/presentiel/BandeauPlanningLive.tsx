import { Radio } from "lucide-react";

/**
 * LE BANDEAU PERMANENT DU PLANNING EN MODE LIVE.
 *
 * ⚠️ IL RÉPOND À UNE SEULE QUESTION, ET C'EST LA PLUS FACILE À PERDRE DE VUE :
 * « dans le planning de QUI suis-je ? ». Un coach qui enchaîne deux élèves sur
 * la même programmation a, à l'écran, deux pages rigoureusement identiques —
 * mêmes semaines, mêmes séances, mêmes noms. D'où `sticky`, et d'où le nom de
 * l'élève plutôt qu'un simple titre de programme.
 *
 * ⚠️ IL NE PORTE AUCUNE ACTION, VOLONTAIREMENT. Celui de la SAISIE
 * (`BandeauPresentiel`) porte l'état du brouillon et son effacement, parce que
 * ces deux choses vivent dans le formulaire. Ici il n'y a rien à enregistrer :
 * un bandeau qui offrirait un bouton sur une page de consultation donnerait à
 * croire qu'on y saisit quelque chose.
 *
 * Composant serveur : aucun état, aucun effet. Il ne devient client que par
 * contagion de la page qui le monte.
 */
export function BandeauPlanningLive({
  nomEleve,
  nomProgramme,
}: {
  readonly nomEleve: string;
  readonly nomProgramme: string;
}) {
  return (
    <div
      role="status"
      data-live="bandeau-planning"
      className="sticky top-0 z-30 -mx-4 mb-6 border-b border-primary/40 bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:-mx-6 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control border border-primary/40 bg-primary/10 text-primary"
          >
            <Radio size={16} />
          </span>
          <span className="flex min-w-0 flex-col">
            {/* Le libellé exact du cahier des charges. Le nom tronque plutôt
                que d'élargir le bandeau : sur un téléphone en salle, c'est la
                largeur qui manque. */}
            <span className="truncate font-heading text-[11px] font-bold uppercase tracking-widest text-primary">
              Mode Live — planning de {nomEleve}
            </span>
            <span className="truncate text-xs text-muted-foreground">{nomProgramme}</span>
          </span>
        </span>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        Choisis la séance que vous faites ensemble. Rien n&apos;est enregistré depuis cette page.
      </p>
    </div>
  );
}
