import { libelleProgression, progressionDuProgramme } from "@/lib/progression-programme";
import type { AdminProgramSummarySession, AdminStudent } from "@/types";

/**
 * LA PROGRESSION DES ÉLÈVES ASSIGNÉS, SUR LA CARTE D'UN PROGRAMME.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UNE LIGNE PAR ÉLÈVE, ET NON UN CHIFFRE UNIQUE
 * ════════════════════════════════════════════════════════════════════════
 * Un programme peut porter plusieurs élèves, qui n'en sont pas au même point.
 * Une moyenne, une plage, ou « le plus avancé » masquerait exactement ce que le
 * coach a besoin de voir : QUI est en retard. La carte listait déjà les noms —
 * chaque nom porte maintenant son avancement, et la structure ne change pas.
 *
 * Mesuré le 24/09/2026 : 17 affectations, et AUCUN programme à plus d'un élève
 * (0 programme de groupe, 17 copies individuelles). Le cas courant est donc une
 * seule ligne, aussi compacte qu'avant ; le cas multiple est correct sans être
 * optimisé pour un volume qui n'existe pas.
 *
 * ⚠️ CE COMPOSANT NE CALCULE RIEN. Le dénominateur, le numérateur et la semaine
 * courante viennent de `progressionDuProgramme` (lib/progression-programme.ts),
 * testé seul. Ici on met en forme, et on se TAIT quand on ne sait pas.
 *
 * ⚠️ « JE NE SAIS PAS » NE S'AFFICHE PAS COMME « ZÉRO ». Pendant le chargement,
 * et si un lot de lecture a échoué, la progression est ABSENTE de l'écran.
 * Afficher « Sem. 1 / 8 » par défaut annoncerait au coach qu'un élève n'a rien
 * fait alors qu'on n'en sait rien — et c'est le genre de chiffre sur lequel il
 * écrirait un message.
 */
export function ProgressionElevesProgramme({
  sessions,
  eleves,
  seancesParEleve,
  complet,
  chargement,
}: {
  readonly sessions: readonly AdminProgramSummarySession[];
  /** Les élèves assignés, dans l'ordre où la carte les listait déjà. */
  readonly eleves: readonly AdminStudent[];
  readonly seancesParEleve: ReadonlyMap<string, ReadonlySet<string>>;
  readonly complet: boolean;
  readonly chargement: boolean;
}) {
  if (eleves.length === 0) {
    return <span className="text-sm text-muted-foreground">Aucun</span>;
  }

  const progressionLisible = complet && !chargement;

  return (
    <ul className="flex flex-col gap-0.5">
      {eleves.map((eleve) => {
        const progression = progressionDuProgramme({
          seances: sessions,
          seancesTerminees: seancesParEleve.get(eleve.id) ?? new Set<string>(),
        });
        const libelle = libelleProgression(progression);
        return (
          <li key={eleve.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
            <span>
              {eleve.firstName} {eleve.lastName}
            </span>
            {progressionLisible && libelle !== "—" && (
              <span
                className={
                  progression.termine
                    ? "text-xs uppercase tracking-wide text-success"
                    : "text-xs uppercase tracking-wide text-foreground"
                }
                // Le libellé accessible dit la VALEUR, jamais la couleur.
                aria-label={
                  progression.termine
                    ? `${eleve.firstName} ${eleve.lastName} : programme terminé, ${progression.seancesTerminees} séances sur ${progression.seancesPrevues}`
                    : `${eleve.firstName} ${eleve.lastName} : semaine ${progression.semaineDeProgression} sur ${progression.semainesPlanifiees}, ${progression.seancesTerminees} séances sur ${progression.seancesPrevues}`
                }
              >
                {libelle}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
