"use client";

import { TrendingUp } from "lucide-react";

import { DoubleStar } from "@/components/ui/DoubleStar";
import {
  formatDureeSeance,
  formatProgression,
  formatTonnageSeance,
  type BilanFinSeance,
} from "@/lib/session-completion";

/**
 * F2 — LA CARTE DE FIN DE SÉANCE.
 *
 * Elle remplace le bloc « Retour envoyé » : même place, même rôle — confirmer
 * que c'est parti — mais elle donne enfin à l'élève quelque chose à regarder
 * au moment où il vient de finir.
 *
 * ────────────────────────────────────────────────────────────────────────
 * L'ANIMATION NE SE JOUE QU'À L'ENVOI
 * ────────────────────────────────────────────────────────────────────────
 * `celebre` n'est vrai qu'au retour du clic sur « Enregistrer mon retour ».
 * En rouvrant la séance plus tard, l'élève retrouve la même carte, chiffres
 * compris, mais immobile. Une étincelle qui se rejoue à chaque visite cesse
 * d'être une récompense et devient un tic — c'est la règle de fréquence de
 * `review-animations/STANDARDS.md`, et c'est aussi du simple bon sens.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS AFFICHÉ EST AUSSI UNE DÉCISION
 * ────────────────────────────────────────────────────────────────────────
 * Une valeur manquante ne devient jamais un « 0 » ni un « — » : la tuile
 * DISPARAÎT. Un élève qui n'a pas noté sa durée n'a pas fait une séance de
 * zéro minute, et lui afficher un tableau à trous le jour où il vient de
 * terminer serait un curieux remerciement.
 *
 * Le TONNAGE est le cas délicat : une séance de tractions n'en a pas, et une
 * séance mixte n'en a qu'une partie. Quand des séries échappent au calcul, le
 * total est annoncé comme un plancher (« au moins »), jamais comme un fait.
 */

interface SessionCompletionCardProps {
  bilan: BilanFinSeance;
  /** Joue l'allumage des étoiles. Vrai UNIQUEMENT à la soumission. */
  celebre: boolean;
  /** Rendu sous la carte — « Modifier mon retour » aujourd'hui. */
  children?: React.ReactNode;
}

function Tuile({ valeur, libelle }: { valeur: string; libelle: string }) {
  return (
    // `max-w` : sans lui, une tuile seule s'étire sur toute la largeur et
    // devient un bandeau. Les trois tuiles gardent la même taille entre elles
    // grâce à `basis-0`, quel que soit le nombre affiché.
    <div className="flex min-w-[96px] max-w-[220px] grow basis-0 flex-col items-center gap-0.5 rounded-panel border border-border bg-surface-soft/40 px-3 py-3">
      <span className="font-heading text-xl font-extrabold tabular-nums text-foreground">{valeur}</span>
      <span className="text-center text-[11px] uppercase leading-tight tracking-widest text-muted-foreground">
        {libelle}
      </span>
    </div>
  );
}

export function SessionCompletionCard({ bilan, celebre, children }: SessionCompletionCardProps) {
  const duree = formatDureeSeance(bilan.dureeMinutes);
  const tonnage = formatTonnageSeance(bilan.tonnageKg);

  const tuiles: { valeur: string; libelle: string }[] = [];
  if (duree) tuiles.push({ valeur: duree, libelle: "Durée" });
  if (bilan.seriesRealisees > 0) {
    tuiles.push({
      valeur: String(bilan.seriesRealisees),
      libelle: bilan.seriesRealisees > 1 ? "Séries" : "Série",
    });
  }
  // Le libellé reste « Soulevé » dans les deux cas : « Soulevé au moins » se
  // lit mal sous un chiffre. La nuance est portée par la phrase en dessous,
  // qui dit précisément ce qui n'est PAS compté — c'est plus honnête qu'un
  // adverbe collé à une étiquette, et ça se lit.
  if (tonnage) tuiles.push({ valeur: tonnage, libelle: "Soulevé" });

  return (
    <div
      className={`rounded-card border border-primary/30 bg-card p-8 text-center shadow-soft ${
        celebre ? "session-completion-in" : ""
      }`}
    >
      {/*
        `currentColor` : l'emblème prend la couleur du texte, donc il suit le
        thème clair comme sombre sans qu'on ait à le dupliquer en deux
        fichiers. L'identité est noir, blanc et gris — aucune couleur
        décorative n'est ajoutée ici.
      */}
      <DoubleStar anime={celebre} className="mx-auto mb-4 h-14 w-auto text-primary" />

      {/*
        LE TITRE NE DOIT AFFIRMER QUE CE QUI EST VRAI.
        « Séance terminée » est une DÉCLARATION de l'élève, pas une conséquence
        de l'envoi : la case part décochée et le retour s'envoie très bien sans
        elle — c'est même le cas d'un élève qui a dû s'arrêter en route. Lui
        annoncer une séance terminée qu'il n'a pas déclarée serait la seule
        chose fausse de cette carte.
      */}
      <h3 className="mb-1 font-heading text-base font-bold uppercase text-foreground">
        {bilan.seanceTerminee ? "Séance terminée" : "Retour envoyé"}
      </h3>
      <p className="text-sm text-muted-foreground">Ton coach recevra ton retour avant la prochaine séance.</p>

      {tuiles.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {tuiles.map((tuile) => (
            <Tuile key={tuile.libelle} valeur={tuile.valeur} libelle={tuile.libelle} />
          ))}
        </div>
      )}

      {bilan.tonnagePartiel && tonnage && (
        // « Total minimum » dit d'emblée que le chiffre est un PLANCHER ; la
        // suite dit lesquelles manquent. Sans le premier mot, l'élève lit un
        // total exact ; sans le second, il ne sait pas ce qui a été écarté.
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground/70">
          Total minimum : les séries au poids du corps ou sur machine sans charge affichée ne sont pas
          comptées.
        </p>
      )}

      {bilan.progressions.length > 0 && (
        <div className="mt-5 rounded-panel border border-primary/30 bg-primary/5 px-4 py-3 text-left">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-primary">
            <TrendingUp size={13} aria-hidden="true" />
            Tu as progressé depuis la dernière fois
          </p>
          <ul className="flex flex-col gap-1">
            {bilan.progressions.map((progression) => (
              <li
                key={progression.exerciseName}
                className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"
              >
                <span className="min-w-0 text-foreground">{progression.exerciseName}</span>
                <span className="tabular-nums text-muted-foreground">{formatProgression(progression)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {children}
    </div>
  );
}
