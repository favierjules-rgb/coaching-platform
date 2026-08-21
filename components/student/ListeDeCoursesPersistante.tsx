"use client";

import { useCallback, useMemo, useState } from "react";

import type { LigneDeCourses } from "@/lib/nutrition/liste-de-courses";
import {
  libelleDerniereModification,
  type LigneAffichee,
} from "@/lib/nutrition/liste-persistante";
import {
  libellePeriode,
  type PeriodeCourses,
} from "@/lib/nutrition/periode-courses";
import { useListePersistante } from "@/hooks/useListePersistante";
import { useBudgetCourses } from "@/hooks/useBudgetCourses";
import { BlocBudget } from "@/components/student/BlocBudget";
import { BlocMinimumObserve } from "@/components/student/BlocMinimumObserve";
import { ChoixMagasinProche } from "@/components/student/ChoixMagasinProche";
import { useBudgetObserve } from "@/hooks/useBudgetObserve";
import { COLOR_STYLES } from "@/lib/ui/color-keys";

/**
 * COURSES C2 — « MA LISTE DE COURSES ».
 *
 * ⚠️ CET ÉCRAN NE GÉNÈRE RIEN À L'OUVERTURE (§13). Il montre ce qui est écrit,
 * et propose un bouton. Régénérer en silence effacerait les cases de quelqu'un
 * qui est en train de faire ses courses.
 *
 * ⚠️ LES LIGNES COCHÉES RESTENT VISIBLES (§9). Les faire disparaître priverait
 * l'élève du moyen de revenir sur une erreur, et ferait fondre une liste dont
 * il veut justement voir la longueur.
 */
export function ListeDeCoursesPersistante({
  periode,
  lignesDuPlan,
  studentId,
  restants,
}: {
  readonly periode: PeriodeCourses | null;
  readonly lignesDuPlan: readonly LigneDeCourses[];
  readonly studentId: string | null;
  /** Repas encore à composer : leurs aliments ne sont dans aucune liste. */
  readonly restants: number;
}) {
  const etat = useListePersistante(periode, lignesDuPlan, studentId);
  // COURSES C3 — les prix et le budget, dans un hook séparé : la liste et les
  // prix n'ont pas la même cadence, et une panne de prix ne doit pas faire
  // disparaître la liste.
  const argent = useBudgetCourses(etat.liste, etat.lignes, etat.recharger);
  // COURSES C4.6 — le MINIMUM OBSERVÉ, dans un troisième hook, et pour la même
  // raison qui avait séparé le second du premier : une cadence différente. Les
  // relevés Open Prices se lisent une fois par ouverture de liste, pas à chaque
  // case cochée — et une panne de l'amont ne doit faire disparaître ni la
  // liste, ni l'estimation C3.
  //
  // ⚠️ LES DEUX BLOCS COEXISTENT, ET NE SE REMPLACENT PAS. « Estimation » (C3,
  // saisie à la main, proportionnelle) et « minimum observé » (C4, relevés
  // réels, conditionnement réel) répondent à deux questions différentes. Faire
  // retomber l'un sur l'autre quand il manque produirait un nombre dont
  // personne ne saurait dire ce qu'il vaut.
  const observe = useBudgetObserve(etat.liste?.id ?? null);
  const [ouvertAjout, setOuvertAjout] = useState(false);

  const libelleBouton = useMemo(() => {
    if (etat.etat === "absente") return "GÉNÉRER MA LISTE";
    if (etat.etat === "a_mettre_a_jour") return "METTRE À JOUR MA LISTE";
    return null;
  }, [etat.etat]);

  if (periode === null) return null;

  // ⚠️ « RIEN LU » N'EST PAS « RIEN À ACHETER ». Un réseau coupé et une liste
  // jamais générée mènent au même écran vide si on les confond — et l'élève
  // cliquerait « GÉNÉRER » sur une liste qui existe déjà.
  if (!etat.ok) return <LectureImpossible onReessayer={etat.recharger} />;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          MA LISTE DE COURSES
        </h2>
        <p className="text-sm text-muted-foreground">
          {libellePeriode(periode)}
        </p>
      </header>

      {restants > 0 && (
        <p
          className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
          role="status"
        >
          {restants} repas rest{restants > 1 ? "ent" : "e"} à composer&nbsp;:
          ils ne figurent pas dans cette liste.
        </p>
      )}

      {etat.etat === "a_mettre_a_jour" && etat.liste !== null && (
        <p
          className="rounded-panel border border-info/40 bg-info/10 px-4 py-3 text-sm text-info"
          role="status"
        >
          Tes repas ont changé depuis la dernière génération. Mettre à jour
          corrigera les quantités&nbsp;— tes articles ajoutés à la main et tes
          cases cochées sont conservés.
        </p>
      )}

      {/*
        COURSES C3 — LE BLOC BUDGET EST EN HAUT, avant la liste elle-même :
        c'est l'information qu'on regarde en entrant dans le magasin.
        ⚠️ Il ne s'affiche pas si les prix n'ont pas pu être lus : une
        estimation à zéro serait un mensonge, pas une absence.
      */}
      {etat.liste !== null && argent.ok && (
        <BlocBudget
          budget={argent.budget}
          enCours={argent.enCours}
          onDefinirBudget={argent.definirBudget}
        />
      )}

      {/*
        COURSES C4.6 — LE MINIMUM OBSERVÉ, SOUS L'ESTIMATION ET JAMAIS À SA
        PLACE. Le bloc s'affiche même en panne : il dit alors qu'il ne sait
        pas, ce qui vaut mieux qu'une absence silencieuse dont l'élève
        conclurait qu'aucun prix n'existe.
      */}
      {/*
        ⚠️ CE BLOC S'AFFICHE MÊME SANS LISTE, ET C'EST DÉLIBÉRÉ. Il portait la
        garde `etat.liste !== null` ; le sélecteur de magasin, monté dedans,
        disparaissait donc tant qu'aucune liste n'existait — et l'élève ne
        pouvait plus choisir son magasin au moment précis où il prépare ses
        courses. Sans liste, le bloc ne prétend rien sur les prix : il le dit,
        et ne lit rien.
      */}
      <BlocMinimumObserve
        budget={observe.budget}
        comparaison={observe.comparaison}
        couvertureMagasin={observe.couvertureMagasin}
        chargement={observe.chargement}
        ok={observe.ok}
        // ⚠️ UN ÉTAT D'ÉCRAN, PAS UN SEPTIÈME ÉTAT DE COUVERTURE. Les six
        // valeurs d'`EtatCouverture` continuent de dire exactement ce
        // qu'elles disaient ; « pas encore de liste » est une autre question.
        listeAbsente={etat.liste === null}
        /*
            COURSES C4.3c — LE CHOIX DU MAGASIN VIT ICI, ET NULLE PART AILLEURS.

            ⚠️ IL ÉTAIT MONTÉ EN HAUT DE `courses/page.tsx`, AVANT « RETOUR » ET
            « MA LISTE DE COURSES » : trois commandes permanentes — géolocaliser,
            saisir une ville, rechercher — pour un geste qu'on fait une fois par
            mois. C'est le défaut Preview corrigé ici.

            ⚠️ ET SÛREMENT PAS DANS `ListeDeCoursesParcours`, qui reste sous
            contrat UX-24 : ce dernier ne doit connaître ni magasin, ni prix, ni
            géolocalisation. Ce composant-ci n'est pas sous ce contrat — il
            PORTE déjà les prix observés, et le magasin est ce qui les commande.

            ⚠️ `onMagasinChoisi` EST LE CORRECTIF LE PLUS IMPORTANT DU LOT.
            Après un `POST /stores/select` réussi, les relevés affichés sont
            ceux de l'ANCIEN magasin ; sans cette relecture, l'élève changerait
            de magasin et lirait des prix qui ne sont plus les siens. On relit
            la zone des prix, et elle SEULE : remonter le parcours entier
            réinitialiserait la composition de la liste.
          */
        enTete={
          <ChoixMagasinProche
            studentId={studentId}
            onMagasinChoisi={observe.recharger}
          />
        }
      />

      {etat.liste !== null && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p
            className="text-sm font-medium text-muted-foreground"
            aria-live="polite"
          >
            {etat.progression.libelle}
          </p>
          {/*
            ⚠️ AFFICHÉE PARCE QU'ELLE EST VRAIE. La RPC n'avance `updated_at`
            que si une ligne a bougé : une régénération à l'identique ne la
            touche pas. Une date qui avancerait à chaque ouverture serait une
            information fausse, et il vaudrait mieux ne pas la montrer du tout.
          */}
          {libelleDerniereModification(etat.liste) !== null && (
            <p className="text-xs text-muted-foreground">
              {libelleDerniereModification(etat.liste)}
            </p>
          )}
        </div>
      )}

      {etat.liste === null ? (
        <p className="text-sm text-muted-foreground">
          Aucune liste pour cette période. Génère-la à partir des repas que tu
          as validés.
        </p>
      ) : etat.lignes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ta liste est vide&nbsp;: aucun repas validé sur cette période, et
          aucun article ajouté à la main.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-card">
          {etat.lignes.map((ligne) => (
            <LigneDeListe
              key={ligne.id}
              ligne={ligne}
              onBasculer={(coche) => void etat.basculer(ligne.id, coche)}
              onSupprimer={
                ligne.source === "manual"
                  ? () => void etat.supprimer(ligne.id)
                  : null
              }
            />
          ))}
        </ul>
      )}

      {etat.liste !== null && (
        <>
          {ouvertAjout ? (
            <FormulaireArticle
              enCours={etat.enCours}
              onAnnuler={() => setOuvertAjout(false)}
              onValider={async (article) => {
                const reussi = await etat.ajouter(article);
                if (reussi) setOuvertAjout(false);
                return reussi;
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setOuvertAjout(true)}
              className="min-h-11 self-start rounded-pill border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
            >
              + AJOUTER UN ARTICLE
            </button>
          )}
        </>
      )}

      {libelleBouton !== null && (
        <button
          type="button"
          onClick={() => void etat.regenerer()}
          disabled={etat.enCours || etat.chargement}
          className="min-h-11 rounded-pill bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition disabled:opacity-50"
        >
          {etat.enCours ? "En cours…" : libelleBouton}
        </button>
      )}

      {etat.erreur !== null && (
        <p className="text-sm text-destructive" role="alert">
          {messageDErreur(etat.erreur)}
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * UNE LIGNE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ EXPORTÉE POUR ÊTRE MESURÉE, comme les écrans du parcours C1. L'état
 * peuplé de la liste dépend d'un hook qui parle à Supabase : sans ce point
 * d'entrée, le banc responsive ne verrait jamais qu'un écran vide, et
 * « aucun débordement » serait vrai par construction.
 */
export function LigneDeListe({
  ligne,
  onBasculer,
  onSupprimer,
}: {
  readonly ligne: LigneAffichee;
  readonly onBasculer: (coche: boolean) => void;
  /** `null` pour une ligne PLAN : elle ne se supprime pas (§11). */
  readonly onSupprimer: (() => void) | null;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        role="checkbox"
        aria-checked={ligne.checked}
        onClick={() => onBasculer(!ligne.checked)}
        className="flex min-h-11 flex-1 items-center gap-3 py-1 text-left"
      >
        <span
          aria-hidden
          className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${
            ligne.checked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border"
          }`}
        >
          {ligne.checked ? "✓" : ""}
        </span>
        {ligne.colorKey !== null && (
          <span
            aria-hidden
            className={`size-2 shrink-0 rounded-full ${COLOR_STYLES[ligne.colorKey].dot}`}
          />
        )}
        <span
          // ⚠️ ATTÉNUÉE, PAS SUPPRIMÉE. La ligne cochée reste lisible : c'est
          // ce qui permet de revenir sur une erreur au rayon suivant.
          className={`flex-1 text-sm ${ligne.checked ? "text-muted-foreground line-through" : ""}`}
        >
          {ligne.libelle}
        </span>
        {ligne.quantite !== null && (
          <span
            className={`text-sm tabular-nums ${ligne.checked ? "text-muted-foreground" : "text-muted-foreground"}`}
          >
            {ligne.quantite}
          </span>
        )}
      </button>
      {onSupprimer !== null && (
        <button
          type="button"
          onClick={onSupprimer}
          aria-label={`Supprimer ${ligne.libelle}`}
          className="min-h-11 min-w-11 rounded-pill border border-border px-3 text-xs text-muted-foreground transition hover:bg-muted"
        >
          ✕
        </button>
      )}
    </li>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * LE FORMULAIRE D'ARTICLE MANUEL
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ AUCUNE RECHERCHE DANS LE CATALOGUE (§10). Ce champ n'est pas un
 * autocomplete : il n'appelle rien, ne suggère rien, n'apparie rien. Un article
 * manuel est du texte, et le rattacher à un aliment lui donnerait une identité
 * que la base refuse justement de lui laisser porter.
 *
 * ⚠️ L'UNITÉ EST UN CHOIX, JAMAIS UNE DÉDUCTION (§21). « Jus d'orange » ne
 * devient pas des millilitres. Aucune heuristique, dans aucun sens.
 */
export function FormulaireArticle({
  enCours,
  onValider,
  onAnnuler,
}: {
  readonly enCours: boolean;
  readonly onValider: (article: {
    libelle: string;
    quantite: number | null;
    unite: string | null;
  }) => Promise<boolean>;
  readonly onAnnuler: () => void;
}) {
  const [libelle, setLibelle] = useState("");
  const [quantite, setQuantite] = useState("");
  const [unite, setUnite] = useState<"" | "g" | "ml" | "piece">("");

  const nombre = useMemo(() => {
    const t = quantite.trim();
    if (t === "") return null;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [quantite]);

  const valide =
    libelle.trim() !== "" && (quantite.trim() === "" || nombre !== null);

  const soumettre = useCallback(async () => {
    if (!valide) return;
    const reussi = await onValider({
      libelle: libelle.trim(),
      quantite: nombre,
      unite: unite === "" ? null : unite,
    });
    if (reussi) {
      setLibelle("");
      setQuantite("");
      setUnite("");
    }
  }, [valide, onValider, libelle, nombre, unite]);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Article</span>
        <input
          type="text"
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          placeholder="Papier toilette, éponges…"
          className="min-h-11 rounded-panel border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium text-muted-foreground">
            Quantité (facultative)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={quantite}
            onChange={(e) => setQuantite(e.target.value)}
            className="min-h-11 rounded-panel border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-muted-foreground">Unité</span>
          <select
            value={unite}
            onChange={(e) =>
              setUnite(e.target.value as "" | "g" | "ml" | "piece")
            }
            className="min-h-11 rounded-panel border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">aucune</option>
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="piece">pièce</option>
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void soumettre()}
          disabled={!valide || enCours}
          className="min-h-11 rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:opacity-50"
        >
          Ajouter
        </button>
        <button
          type="button"
          onClick={onAnnuler}
          className="min-h-11 rounded-pill border border-border px-4 py-2 text-sm transition hover:bg-muted"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

function LectureImpossible({
  onReessayer,
}: {
  readonly onReessayer: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3">
      <p className="text-sm text-destructive" role="alert">
        Impossible de lire ta liste de courses. Rien n&apos;a été modifié.
      </p>
      <button
        type="button"
        onClick={onReessayer}
        className="min-h-11 self-start rounded-pill border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10"
      >
        Réessayer
      </button>
    </div>
  );
}

/**
 * Les codes du serveur, traduits UNE fois, ici.
 *
 * ⚠️ UN CODE INCONNU N'EST PAS ABSORBÉ EN « une erreur est survenue » : il est
 * montré tel quel. C'est laid, et c'est voulu — un code lisible à l'écran est
 * un code qu'on peut rapporter.
 */
function messageDErreur(code: string): string {
  switch (code) {
    case "LIGNE_HORS_PLANIFICATION":
      return "Un aliment de la liste ne correspond plus à tes repas validés. Recompose la semaine, puis réessaie.";
    case "PERIODE_TROP_LONGUE":
    case "PERIODE_INVALIDE":
    case "PERIODE_MANQUANTE":
      return "La période demandée n’est pas valide.";
    case "COCHAGE_REFUSE":
      return "La case n’a pas pu être enregistrée. La liste vient d’être rechargée.";
    case "AJOUT_REFUSE":
      return "L’article n’a pas pu être ajouté.";
    case "SUPPRESSION_REFUSEE":
      return "Cet article ne peut pas être supprimé : seuls les articles ajoutés à la main le peuvent.";
    case "ARTICLE_MANUEL_INTROUVABLE":
      return "Cet article n’est pas modifiable.";
    default:
      return `Refus du serveur : ${code}`;
  }
}
