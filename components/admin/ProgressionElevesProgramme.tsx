import { progressionDuProgramme } from "@/lib/progression-programme";
import { MESSAGE_DATE_ABSENTE, affichageSemaineDeLEleve } from "@/lib/semaine-individuelle";
import type { AffichageSemaine } from "@/lib/semaine-individuelle";
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
 * ⚠️ CE COMPOSANT NE CALCULE RIEN. Le dénominateur et le numérateur viennent de
 * `progressionDuProgramme` (lib/progression-programme.ts) ; la semaine et son
 * libellé viennent de `affichageSemaineDeLEleve` (lib/semaine-individuelle.ts).
 * Les deux sont purs et testés seuls. Ici on met en forme, et on se TAIT quand on
 * ne sait pas.
 *
 * ════════════════════════════════════════════════════════════════════════
 * « SEM. X / Y » EST UN CALENDRIER, PAS UN COMPTEUR DE TRAVAIL
 * ════════════════════════════════════════════════════════════════════════
 * Décision du 27/09/2026 (option B). `X` vient de la date de début INDIVIDUELLE
 * de l'élève (`assignments.program_start_date`), et de rien d'autre ; `Y` est
 * `durationWeeks`. Une séance en retard ne bloque donc plus la semaine : un
 * élève à la semaine 4 qui n'a rien validé lit « Sem. 4 / 12 » et « 0 % », et
 * les deux sont vrais.
 *
 * La règle précédente — « X = la première semaine encore inachevée » — donnait
 * « Sem. 1 / 12 » à un élève démarré depuis trois semaines dès qu'une seule
 * séance de la semaine 1 manquait. C'était conforme à sa propre définition, et
 * illisible pour le coach.
 *
 * ⚠️ « TERMINÉ » PASSE DEVANT LE CALENDRIER, et c'est la seule exception : 48
 * séances sur 48 en semaine 7 est un programme fini. L'inverse ne l'est pas —
 * semaine 12 avec 47 séances sur 48 n'est pas terminé. L'arbitrage vit dans
 * `affichageSemaineDeLEleve`, pas ici.
 *
 * ⚠️ UNE DATE ABSENTE NE DEVIENT PAS « SEMAINE 1 ». 12 des 19 affectations de
 * production n'ont aucune date et retombaient en silence sur
 * `students.start_date` — la date d'INSCRIPTION. La carte affiche « — / Y » et
 * le dit. Un chiffre deviné ressemble trop à un chiffre su.
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
  durationWeeks,
  debutParEleve,
  elevesSansSeancesIndividuelles,
  reference,
}: {
  readonly sessions: readonly AdminProgramSummarySession[];
  /** Les élèves assignés, dans l'ordre où la carte les listait déjà. */
  readonly eleves: readonly AdminStudent[];
  readonly seancesParEleve: ReadonlyMap<string, ReadonlySet<string>>;
  readonly complet: boolean;
  readonly chargement: boolean;
  /** `Y` du libellé « Sem. X / Y » — la durée DÉCLARÉE du programme. */
  readonly durationWeeks: number;
  /** `studentId` → `assignments.program_start_date`. Clé absente = pas calculable ici. */
  readonly debutParEleve: ReadonlyMap<string, string | null>;
  /**
   * Élèves rattachés à cette carte au seul titre d'une COPIE individuelle :
   * leurs séances ne sont pas celles de cette carte, donc aucun avancement n'y
   * est affichable. Voir le bloc de documentation ci-dessus.
   */
  readonly elevesSansSeancesIndividuelles: readonly string[];
  /** « Maintenant », injectable pour rendre le composant testable. */
  readonly reference: Date;
}) {
  if (eleves.length === 0) {
    return <span className="text-sm text-muted-foreground">Aucun</span>;
  }

  /*
   * ⚠️ LE GARDE-FOU COUVRE AUSSI LE CALENDRIER, ET CE N'EST PAS UN OUBLI.
   * Le libellé calendaire n'a pas besoin des complétions — mais « Terminé »
   * passe devant lui, et savoir si un élève a fini EXIGE de les connaître.
   * Afficher « Sem. 3 / 12 » à un élève qui a peut-être tout fini serait
   * remplacer une incertitude par une affirmation fausse.
   */
  const progressionLisible = complet && !chargement;
  const sansSeances = new Set(elevesSansSeancesIndividuelles);

  return (
    <ul className="flex flex-col gap-0.5">
      {eleves.map((eleve) => {
        const progression = progressionDuProgramme({
          seances: sessions,
          seancesTerminees: seancesParEleve.get(eleve.id) ?? new Set<string>(),
        });
        const affichage = affichageSemaineDeLEleve({
          termine: progression.termine,
          dateDebut: debutParEleve.get(eleve.id) ?? null,
          durationWeeks,
          reference,
        });
        // Aucune séance individuelle sur cette carte → on nomme, on ne chiffre pas.
        const lisible = progressionLisible && !sansSeances.has(eleve.id) && progression.seancesPrevues > 0;
        const sansDate = affichage.etat === "sans-date" || affichage.etat === "date-illisible";
        return (
          <li key={eleve.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
            <span>
              {eleve.firstName} {eleve.lastName}
            </span>
            {lisible && (
              <span
                className={tonDuLibelle(affichage.etat)}
                title={sansDate ? MESSAGE_DATE_ABSENTE : undefined}
                // Le libellé accessible dit la VALEUR, jamais la couleur.
                aria-label={libelleAccessible(eleve, affichage, progression)}
              >
                {affichage.libelle}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function tonDuLibelle(etat: AffichageSemaine["etat"]): string {
  const base = "text-xs uppercase tracking-wide";
  switch (etat) {
    case "termine":
      return `${base} text-success`;
    case "sans-date":
    case "date-illisible":
      return `${base} text-warning`;
    case "a-venir":
      return `${base} text-muted-foreground`;
    case "en-cours":
      return `${base} text-foreground`;
  }
}

/**
 * ⚠️ LE COMPTE DE SÉANCES EST TOUJOURS DIT, quel que soit l'état du calendrier.
 * C'est la seule information que la carte possède à coup sûr : un lecteur
 * d'écran qui n'entendrait que « date non renseignée » perdrait l'avancement
 * réel, qui lui est connu.
 */
function libelleAccessible(
  eleve: AdminStudent,
  affichage: AffichageSemaine,
  progression: { seancesTerminees: number; seancesPrevues: number },
): string {
  const nom = `${eleve.firstName} ${eleve.lastName}`;
  const compte = `${progression.seancesTerminees} séances sur ${progression.seancesPrevues}`;
  switch (affichage.etat) {
    case "termine":
      return `${nom} : programme terminé, ${compte}`;
    case "a-venir":
      return `${nom} : programme à venir, pas encore commencé, ${compte}`;
    case "sans-date":
    case "date-illisible":
      return `${nom} : ${MESSAGE_DATE_ABSENTE.toLowerCase()}, semaine inconnue, ${compte}`;
    case "en-cours":
      return `${nom} : semaine ${affichage.semaine} sur ${affichage.total}, ${compte}`;
  }
}
