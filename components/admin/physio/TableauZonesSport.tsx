"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Pencil, RotateCcw, X } from "lucide-react";

import { formatMinutesSecondes, formatMinutesSecondesLarge } from "@/lib/physiologie";
import {
  bornesDeReference,
  cleSaisie,
  estPersonnalisee,
  famillesDuSport,
  LIBELLE_FAMILLE,
  possedeUnePersonnalisation,
  reglagesDepuisSaisie,
  saisieDepuisReglages,
  type SaisieBornes,
} from "@/lib/zones-personnalisation";
import {
  tableauZones,
  type LigneZone,
  type PlageCalculee,
  type ReferencesAthlete,
  type ReglagesZones,
  type SportZone,
} from "@/lib/zones-physiologiques";

/**
 * LE TABLEAU DES ZONES D'UN ATHLÈTE, POUR UN SPORT.
 *
 * ⚠️ AUCUN CALCUL ICI. Toutes les valeurs viennent de `tableauZones`, fonction
 * pure testée contre le barème iDO. Ce composant ne sait que mettre en forme —
 * c'est ce qui garantit qu'aucune allure affichée ne dépend d'une formule
 * réinventée dans du JSX.
 *
 * ⚠️ UNE RÉFÉRENCE MANQUANTE S'AFFICHE « — », JAMAIS « 0 ». Un athlète sans VMA
 * verrait sinon des vitesses de 0 km/h présentées comme des consignes.
 */

const CLASSE_COULEUR: Readonly<Record<string, string>> = {
  gray: "bg-surface-soft text-muted-foreground",
  rose: "bg-pink-500/15 text-pink-300",
  red: "bg-red-500/15 text-red-300",
  purple: "bg-purple-500/15 text-purple-300",
};

function Cellule({ plage }: { readonly plage: PlageCalculee }) {
  if (plage.nonSignificatif) return <span className="text-muted-foreground/60">Non significatif</span>;
  if (plage.referenceManquante) return <span className="text-muted-foreground/60">—</span>;
  return <span className="tabular-nums">{plage.libelle}</span>;
}

/**
 * ⚠️ LA PLAGE SE LIT « LA PLUS LENTE → LA PLUS RAPIDE ». `allure.max` porte
 * l'allure la plus lente (issue de la vitesse minimale) : l'afficher en second
 * inverserait la lecture par rapport au tableau de référence.
 */
function CelluleAllure({ plage, sport }: { readonly plage: PlageCalculee; readonly sport: SportZone }) {
  if (plage.nonSignificatif) return <span className="text-muted-foreground/60">Non significatif</span>;
  if (plage.referenceManquante) return <span className="text-muted-foreground/60">—</span>;
  const format = sport === "natation" ? formatMinutesSecondesLarge : formatMinutesSecondes;
  const unite = sport === "natation" ? "/100 m" : "/km";
  return (
    <span className="tabular-nums">
      {format(plage.max)} - {format(plage.min)} {unite}
    </span>
  );
}

export function TableauZonesSport({
  sport,
  references,
  reglages,
  onEnregistrerZones,
  onReinitialiser,
}: {
  readonly sport: SportZone;
  readonly references: ReferencesAthlete;
  readonly reglages: ReglagesZones;
  readonly onEnregistrerZones: (reglages: ReglagesZones) => Promise<{ ok: boolean; erreur: string | null }>;
  readonly onReinitialiser: () => Promise<{ ok: boolean; erreur: string | null }>;
}) {
  const lignes = tableauZones(sport, references, reglages);
  const [edition, setEdition] = useState(false);
  const [saisie, setSaisie] = useState<Record<string, SaisieBornes>>({});
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const familles = famillesDuSport(sport);
  const personnalise = possedeUnePersonnalisation(reglages);

  function ouvrirEdition() {
    setSaisie(saisieDepuisReglages(sport, reglages));
    setErreurs({});
    setErreurGlobale(null);
    setEdition(true);
  }

  async function enregistrer() {
    const resultat = reglagesDepuisSaisie(reglages, sport, saisie);
    setErreurs(resultat.erreurs);
    if (!resultat.ok) {
      setErreurGlobale("Certaines bornes sont refusées : rien n'a été enregistré.");
      return;
    }
    setErreurGlobale(null);
    setEnCours(true);
    const reponse = await onEnregistrerZones(resultat.reglages);
    setEnCours(false);
    if (!reponse.ok) {
      setErreurGlobale(reponse.erreur ?? "L'enregistrement a échoué.");
      return;
    }
    setEdition(false);
  }

  async function reinitialiser() {
    setEnCours(true);
    const reponse = await onReinitialiser();
    setEnCours(false);
    if (!reponse.ok) {
      setErreurGlobale(reponse.erreur ?? "La réinitialisation a échoué.");
      return;
    }
    setErreurGlobale(null);
    setEdition(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {personnalise
            ? "Bornes personnalisées pour cet athlète — les valeurs modifiées sont signalées."
            : "Barème de référence iDO."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (edition ? setEdition(false) : ouvrirEdition())}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            {edition ? <X size={13} /> : <Pencil size={13} />}
            {edition ? "Fermer l'édition" : "Personnaliser les bornes"}
          </button>
          {/*
            ⚠️ CE BOUTON NE TOUCHE QUE LES ZONES. Il appelle
            `enregistrerReglagesZones(…, null)` : la requête ne nomme aucune
            colonne de VMA, de FTP, de PMA, de FC ni de poids. Voir
            lib/supabase/physiologie.ts.
          */}
          <button
            type="button"
            onClick={() => void reinitialiser()}
            disabled={enCours || !personnalise}
            title={personnalise ? undefined : "Aucune personnalisation à effacer."}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={13} />
            Réinitialiser mes zones iDO
          </button>
        </div>
      </div>

      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3">Zone</th>
              <th className="py-2 pr-3">Perception</th>
              <th className="py-2 pr-3">RPE</th>
              {sport === "velo" ? (
                <>
                  <th className="py-2 pr-3">% FTP</th>
                  <th className="py-2 pr-3">Puissance FTP</th>
                  <th className="py-2 pr-3">% PMA</th>
                  <th className="py-2 pr-3">Puissance PMA</th>
                </>
              ) : (
                <>
                  <th className="py-2 pr-3">{sport === "natation" ? "% VMA natation" : "% VMA"}</th>
                  <th className="py-2 pr-3">Vitesse</th>
                  <th className="py-2 pr-3">Allure</th>
                </>
              )}
              <th className="py-2 pr-3">
                FC{lignes[0]?.fcSpecifiqueAuSport ? " (spécifique)" : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((ligne: LigneZone) => (
              <tr key={ligne.zone} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${CLASSE_COULEUR[ligne.couleur] ?? CLASSE_COULEUR.gray}`}
                  >
                    Z{ligne.zone}
                  </span>
                  <span className="ml-2 text-xs text-foreground">{ligne.nom}</span>
                </td>
                <td className="py-2 pr-3 text-xs text-muted-foreground">{ligne.perception}</td>
                <td className="py-2 pr-3 tabular-nums">{ligne.rpe}</td>
                {sport === "velo" ? (
                  <>
                    <td className="py-2 pr-3 text-xs tabular-nums">{ligne.libellePourcentages}</td>
                    <td className="py-2 pr-3 text-xs"><Cellule plage={ligne.puissanceFtp} /></td>
                    <td className="py-2 pr-3 text-xs tabular-nums">
                      {bornesDeReference("pma", ligne.zone) === null
                        ? "Non significatif"
                        : `${(reglages.pma?.[ligne.zone] ?? bornesDeReference("pma", ligne.zone))?.[0]}% - ${(reglages.pma?.[ligne.zone] ?? bornesDeReference("pma", ligne.zone))?.[1]}%`}
                    </td>
                    <td className="py-2 pr-3 text-xs"><Cellule plage={ligne.puissancePma} /></td>
                  </>
                ) : (
                  <>
                    <td className="py-2 pr-3 text-xs tabular-nums">{ligne.libellePourcentages}</td>
                    <td className="py-2 pr-3 text-xs"><Cellule plage={ligne.vitesse} /></td>
                    <td className="py-2 pr-3 text-xs"><CelluleAllure plage={ligne.allure} sport={sport} /></td>
                  </>
                )}
                <td className="py-2 pr-3 text-xs"><Cellule plage={ligne.fc} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edition && (
        <div className="flex flex-col gap-4 rounded-card border border-border bg-surface-soft/40 p-4">
          <p className="text-xs text-muted-foreground">
            Bornes en pourcentage. Une borne remise à sa valeur de référence disparaît des réglages — c&apos;est
            volontaire : l&apos;athlète reste alors aligné sur le barème iDO si celui-ci évolue.
          </p>
          {familles.map((famille) => (
            <div key={famille} className="flex flex-col gap-2">
              <h5 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                {LIBELLE_FAMILLE[famille]}
              </h5>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {lignes.map((ligne) => {
                  const reference = bornesDeReference(famille, ligne.zone);
                  const cle = cleSaisie(famille, ligne.zone);
                  if (reference === null) {
                    return (
                      <p key={cle} className="text-[11px] text-muted-foreground/60">
                        Z{ligne.zone} — non significatif
                      </p>
                    );
                  }
                  const valeurs = saisie[cle] ?? { min: "", max: "" };
                  return (
                    <div key={cle} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="w-14 text-[11px] uppercase text-muted-foreground">
                          Z{ligne.zone}
                          {estPersonnalisee(famille, ligne.zone, reglages) ? " •" : ""}
                        </span>
                        <input
                          aria-label={`${LIBELLE_FAMILLE[famille]} Z${ligne.zone} borne basse`}
                          value={valeurs.min}
                          onChange={(event) =>
                            setSaisie((precedent) => ({ ...precedent, [cle]: { ...valeurs, min: event.target.value } }))
                          }
                          className="w-20 rounded-control border border-border bg-background px-2 py-1.5 text-xs tabular-nums text-foreground"
                        />
                        <span className="text-xs text-muted-foreground">→</span>
                        <input
                          aria-label={`${LIBELLE_FAMILLE[famille]} Z${ligne.zone} borne haute`}
                          value={valeurs.max}
                          onChange={(event) =>
                            setSaisie((precedent) => ({ ...precedent, [cle]: { ...valeurs, max: event.target.value } }))
                          }
                          className="w-20 rounded-control border border-border bg-background px-2 py-1.5 text-xs tabular-nums text-foreground"
                        />
                      </div>
                      {erreurs[cle] && <p className="pl-16 text-[11px] text-red-400">{erreurs[cle]}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {erreurGlobale && (
            <p className="flex items-start gap-2 text-xs text-red-400">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              {erreurGlobale}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setEdition(false)}
              className="inline-flex min-h-11 items-center rounded-control border border-border px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void enregistrer()}
              disabled={enCours}
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              {enCours && <Loader2 size={13} className="animate-spin" />}
              Enregistrer les bornes
            </button>
          </div>
        </div>
      )}

      {!edition && erreurGlobale && (
        <p className="flex items-start gap-2 text-xs text-red-400">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          {erreurGlobale}
        </p>
      )}
    </div>
  );
}
