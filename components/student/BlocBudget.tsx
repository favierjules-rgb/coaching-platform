"use client";

import { useCallback, useMemo, useState } from "react";

import {
  formaterMontant,
  libelleCouverture,
  type BudgetDeLaListe,
} from "@/lib/nutrition/budget-courses";
import { NBSP } from "@/lib/nutrition/basis-points";

/**
 * COURSES C3 — LE BLOC BUDGET, EN HAUT DE « MA LISTE DE COURSES ».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA SEULE VRAIE FAUTE POSSIBLE ICI SERAIT DE MENTIR SUR LA COUVERTURE
 * ────────────────────────────────────────────────────────────────────────────
 * Une liste de 20 articles dont 15 seulement ont un prix ne coûte PAS 42 € :
 * elle coûte au moins 42 €. Afficher « Total : 42 € » ferait croire à l'élève
 * qu'il rentre dans son budget alors que cinq articles ne sont pas comptés.
 *
 * ⚠️ LE MOT « TOTAL » EST DONC BANNI QUAND L'ESTIMATION EST PARTIELLE. On dit
 * « ESTIMATION », on donne la couverture, et on nomme les articles manquants.
 *
 * ⚠️ ET L'ESTIMATION EST PROPORTIONNELLE — l'écran le dit aussi. 1 274 g de riz
 * à 2,50 € le kilo comptent pour 3,19 €, alors qu'il faudra acheter deux
 * paquets. Le conditionnement réel appartient à C4 ; le taire ferait passer une
 * approximation pour un devis.
 */
export function BlocBudget({
  budget,
  enCours,
  onDefinirBudget,
}: {
  readonly budget: BudgetDeLaListe;
  readonly enCours: boolean;
  readonly onDefinirBudget: (cents: number | null) => void | Promise<unknown>;
}) {
  const [edition, setEdition] = useState(false);

  const aucuneEstimation = budget.articlesEstimes === 0;

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-border bg-card p-4"
      aria-label="Budget de la liste"
    >
      <h3 className="text-sm font-semibold tracking-wide text-muted-foreground">BUDGET</h3>

      {edition ? (
        <FormulaireBudget
          valeurInitiale={budget.budgetCents}
          enCours={enCours}
          onAnnuler={() => setEdition(false)}
          onValider={async (cents) => {
            await onDefinirBudget(cents);
            setEdition(false);
          }}
        />
      ) : (
        <>
          {/* ── LES MONTANTS ─────────────────────────────────────────────── */}
          <dl className="flex flex-col gap-2">
            {budget.budgetCents !== null && (
              <Ligne
                terme="Budget"
                valeur={formaterMontant(budget.budgetCents)}
                onModifier={() => setEdition(true)}
              />
            )}

            <Ligne
              terme={budget.partielle ? "Estimation partielle" : "Estimation"}
              valeur={aucuneEstimation ? "—" : formaterMontant(budget.estimeCents)}
            />

            {/* ⚠️ L'ÉCART N'EST AFFICHÉ QUE SI UN BUDGET EXISTE. Sans budget,
                il n'y a pas de « restant » : il y a une estimation, et c'est
                tout. Inventer un écart contre un budget nul dirait à tout le
                monde qu'il est en dépassement. */}
            {/*
              ⚠️ DÉFAUT D-4, TROUVÉ PAR L'AUDIT ADVERSE. « Budget restant :
              6,60 € » était affirmé tel quel alors que 5 articles sur 20
              n'avaient aucun prix : le vrai reste pouvait être négatif. Un
              écart calculé sur une estimation PARTIELLE n'est pas un fait, et
              le libellé doit le dire — pas une note en bas de bloc que
              personne ne relie au chiffre.
            */}
            {budget.ecartCents !== null && !aucuneEstimation && (
              <Ligne
                terme={
                  budget.partielle
                    ? `${budget.depassement ? "Dépassement" : "Budget restant"} estimé sur ${budget.articlesEstimes}${NBSP}/${NBSP}${budget.articlesTotal} articles`
                    : budget.depassement
                      ? "Dépassement estimé"
                      : "Budget restant"
                }
                valeur={formaterMontant(Math.abs(budget.ecartCents))}
                ton={budget.depassement ? "warning" : "success"}
              />
            )}
          </dl>

          {/* ── LA COUVERTURE, JAMAIS TUE ────────────────────────────────── */}
          {aucuneEstimation ? (
            <p className="text-sm text-muted-foreground" role="status">
              Aucune estimation disponible pour cette liste.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground" role="status">
              {libelleCouverture(budget)}
              {budget.partielle && (
                <>
                  {" · "}
                  <span className="text-warning">
                    {budget.articlesSansPrix} article{budget.articlesSansPrix > 1 ? "s" : ""} sans
                    prix
                  </span>
                </>
              )}
            </p>
          )}

          {/*
            ── DÉJÀ ACHETÉ / RESTE À ACHETER — LA LECTURE DE `checked` ──
            ⚠️ DÉFAUT D-5, TROUVÉ PAR L'AUDIT ADVERSE. Le libellé était « Reste
            estimé », à deux lignes de « Budget restant » : deux nombres
            différents, deux notions différentes, et des noms qu'on pouvait
            confondre au premier coup d'œil.
              · BUDGET RESTANT   = budget − estimation totale (ce qu'il reste à DÉPENSER)
              · RESTE À ACHETER  = estimation des lignes NON cochées (ce qu'il reste à PRENDRE)
            Les deux coexistent volontairement ; leurs noms ne doivent pas.
          */}
          {!aucuneEstimation && budget.achetesCents > 0 && (
            <dl className="flex flex-col gap-2 border-t border-border pt-3">
              <Ligne terme="Déjà acheté" valeur={formaterMontant(budget.achetesCents)} />
              <Ligne terme="Reste à acheter" valeur={formaterMontant(budget.restantCents)} />
            </dl>
          )}

          {!aucuneEstimation && (
            <p className="text-xs text-muted-foreground">
              Estimation basée sur les quantités nécessaires, sans tenir compte des
              conditionnements.
            </p>
          )}

          {budget.budgetCents === null && (
            <button
              type="button"
              onClick={() => setEdition(true)}
              className="min-h-11 self-start rounded-pill border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
            >
              DÉFINIR UN BUDGET
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Ligne({
  terme,
  valeur,
  ton,
  onModifier,
}: {
  readonly terme: string;
  readonly valeur: string;
  readonly ton?: "warning" | "success";
  readonly onModifier?: () => void;
}) {
  const couleur =
    ton === "warning" ? "text-warning" : ton === "success" ? "text-success" : "text-foreground";
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <dt className="text-sm text-muted-foreground">{terme}</dt>
      <dd className={`flex items-baseline gap-2 text-base font-semibold tabular-nums ${couleur}`}>
        {valeur}
        {onModifier && (
          <button
            type="button"
            onClick={onModifier}
            className="min-h-11 rounded-pill px-2 text-xs font-normal text-muted-foreground underline transition hover:text-foreground"
          >
            Modifier
          </button>
        )}
      </dd>
    </div>
  );
}

/**
 * La saisie du budget.
 *
 * ⚠️ SAISIE EN EUROS, STOCKAGE EN CENTIMES, CONVERSION EN UN SEUL ENDROIT.
 * L'élève tape « 60 » ou « 60,50 » ; la base reçoit 6000 ou 6050. Laisser
 * passer des euros flottants jusqu'à la base rouvrirait exactement le problème
 * que `*_cents integer` existe pour fermer.
 *
 * ⚠️ ET LE BOUTON EST EXPLICITE, PAS UNE ÉCRITURE À CHAQUE FRAPPE. « 6 » est un
 * état intermédiaire légitime de quelqu'un qui tape « 60 » : l'écrire
 * enverrait un budget de 6 € en base, puis le corrigerait — et un réseau lent
 * pourrait laisser gagner le mauvais.
 */
function FormulaireBudget({
  valeurInitiale,
  enCours,
  onValider,
  onAnnuler,
}: {
  readonly valeurInitiale: number | null;
  readonly enCours: boolean;
  readonly onValider: (cents: number | null) => void | Promise<unknown>;
  readonly onAnnuler: () => void;
}) {
  const [texte, setTexte] = useState(
    valeurInitiale === null ? "" : (valeurInitiale / 100).toFixed(2).replace(".", ","),
  );

  const cents = useMemo(() => centsDepuisSaisie(texte), [texte]);
  const valide = texte.trim() === "" || cents !== null;

  const soumettre = useCallback(async () => {
    if (!valide) return;
    await onValider(texte.trim() === "" ? null : cents);
  }, [valide, onValider, texte, cents]);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Budget pour cette liste</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder="60,00"
            aria-label="Budget en euros"
            className="min-h-11 w-32 rounded-panel border border-border bg-background px-3 py-2 text-sm tabular-nums"
          />
          <span className="text-sm text-muted-foreground">€</span>
        </div>
      </label>

      {!valide && (
        <p className="text-sm text-destructive" role="alert">
          Montant invalide. Exemple&nbsp;: 60 ou 60,50 — au maximum 1{NBSP}000{NBSP}€.
        </p>
      )}
      {texte.trim() === "" && (
        <p className="text-xs text-muted-foreground">
          Laisser vide retire le budget&nbsp;: tu garderas l&apos;estimation, sans comparaison.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void soumettre()}
          disabled={!valide || enCours}
          className="min-h-11 rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:opacity-50"
        >
          {enCours ? "Enregistrement…" : "Enregistrer"}
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

/**
 * « 60 » · « 60,50 » · « 60.5 » → centimes entiers. `null` si ce n'est pas un
 * montant.
 *
 * ⚠️ `Math.round` APRÈS MULTIPLICATION PAR 100, ET NON `parseFloat` PUIS
 * TRONCATURE. `60.35 * 100` vaut `6034.999...` en flottant : sans arrondi, le
 * budget saisi perdrait un centime au passage.
 *
 * Exportée pour être testée : une règle de saisie qu'on ne peut pas mesurer se
 * contourne.
 */
export function centsDepuisSaisie(texte: string): number | null {
  const nettoye = texte.trim().replace(/\s| | /g, "").replace(",", ".");
  if (nettoye === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(nettoye)) return null;
  const euros = Number(nettoye);
  if (!Number.isFinite(euros) || euros < 0) return null;
  const cents = Math.round(euros * 100);
  // Le même plafond que la contrainte de la base : 1 000 €. Le refuser ici
  // donne un message lisible, plutôt qu'un rejet SQL illisible.
  if (cents > 100_000) return null;
  return cents;
}
