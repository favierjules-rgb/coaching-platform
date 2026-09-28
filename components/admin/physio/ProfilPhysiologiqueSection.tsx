"use client";

import { useState } from "react";
import { Activity, AlertTriangle, Pencil } from "lucide-react";

import { AdminSection } from "@/components/admin/AdminSection";
import { CalculateursTests } from "@/components/admin/physio/CalculateursTests";
import { ModaleDonneesPhysio } from "@/components/admin/physio/ModaleDonneesPhysio";
import { TableauZonesSport } from "@/components/admin/physio/TableauZonesSport";
import { Loader } from "@/components/ui/Loader";
import { usePhysiologieEleve } from "@/hooks/usePhysiologieEleve";
import {
  ageAffiche,
  champsDuGroupe,
  LIBELLE_GROUPE,
  OPTIONS_SEXE,
  type ChampPhysio,
  type GroupePhysio,
} from "@/lib/physiologie-champs";
import type { PhysiologieBrute } from "@/lib/supabase/physiologie";
import type { SportZone } from "@/lib/zones-physiologiques";

/**
 * LA FICHE PHYSIOLOGIQUE D'UN ATHLÈTE.
 *
 * ⚠️ UN SEUL ÉLÈVE, PASSÉ EN PROP. Il n'y a pas d'« élève courant » implicite :
 * chaque lecture et chaque écriture nomme `studentId`. C'est ce qui rend
 * impossible, par construction, de modifier Marco en croyant modifier Jules.
 *
 * ⚠️ « ESTIMÉE » EST AFFICHÉE, PAS DEVINÉE. Le badge n'apparaît que si le coach
 * l'a déclaré : aucune valeur n'est marquée estimée parce qu'un calcul l'aurait
 * produite — il n'y a aucun calcul d'estimation dans ce projet.
 */

const ONGLETS: readonly { readonly groupe: GroupePhysio; readonly sport: SportZone | null }[] = [
  { groupe: "general", sport: null },
  { groupe: "course", sport: "course" },
  { groupe: "velo", sport: "velo" },
  { groupe: "natation", sport: "natation" },
];

function valeurLisible(physio: PhysiologieBrute, champ: ChampPhysio): string {
  const brute = physio[champ.cle];
  if (brute === null || brute === undefined || brute === "") return "Non renseigné";
  if (champ.cle === "sex") {
    return OPTIONS_SEXE.find((option) => option.value === brute)?.label ?? String(brute);
  }
  if (champ.nature === "date") {
    const age = ageAffiche(String(brute), new Date());
    return age === null ? String(brute) : `${brute} (${age} ans)`;
  }
  return champ.unite ? `${brute} ${champ.unite}` : String(brute);
}

function CarteValeur({ physio, champ }: { readonly physio: PhysiologieBrute; readonly champ: ChampPhysio }) {
  const renseigne = physio[champ.cle] !== null && physio[champ.cle] !== undefined && physio[champ.cle] !== "";
  const estimee = champ.provenanceDeclarable && physio.sources[champ.colonne] === "estimee";
  return (
    <div className="rounded-card border border-border bg-surface-soft/40 p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{champ.libelle}</p>
      <p className={`mt-1 text-sm tabular-nums ${renseigne ? "text-foreground" : "text-muted-foreground/60"}`}>
        {valeurLisible(physio, champ)}
      </p>
      {renseigne && champ.provenanceDeclarable && (
        <span
          className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
            estimee ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          {estimee ? "Estimée" : "Mesurée"}
        </span>
      )}
    </div>
  );
}

export function ProfilPhysiologiqueSection({ studentId }: { readonly studentId: string }) {
  const { etat, enregistrer, enregistrerZones, reinitialiser } = usePhysiologieEleve(studentId);
  const [onglet, setOnglet] = useState<GroupePhysio>("general");
  const [modaleOuverte, setModaleOuverte] = useState(false);

  const actif = ONGLETS.find((element) => element.groupe === onglet) ?? ONGLETS[0];

  return (
    <AdminSection
      title="Profil physiologique"
      action={
        <button
          type="button"
          onClick={() => setModaleOuverte(true)}
          disabled={!etat.disponible}
          className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pencil size={13} />
          Modifier les données
        </button>
      }
    >
      {etat.chargement ? (
        <Loader libelle="Chargement du profil physiologique…" />
      ) : !etat.disponible ? (
        <p className="text-sm text-muted-foreground">
          Supabase n&apos;est pas configuré : aucune donnée physiologique n&apos;est lisible ici.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {etat.erreur && (
            <p className="flex items-start gap-2 text-xs text-red-400">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              {etat.erreur}
            </p>
          )}

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sports">
            {ONGLETS.map((element) => (
              <button
                key={element.groupe}
                type="button"
                role="tab"
                aria-selected={onglet === element.groupe}
                onClick={() => setOnglet(element.groupe)}
                className={`inline-flex min-h-11 items-center rounded-control border px-4 py-2 text-[11px] uppercase tracking-widest transition-colors ${
                  onglet === element.groupe
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {LIBELLE_GROUPE[element.groupe]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {champsDuGroupe(actif.groupe).map((champ) => (
              <CarteValeur key={champ.cle} physio={etat.physio} champ={champ} />
            ))}
          </div>

          {actif.sport === null ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Activity size={14} className="mt-0.5 flex-shrink-0" />
              La FC max générale sert aux trois sports tant qu&apos;aucune FC max spécifique n&apos;est renseignée.
              Aucune FC spécifique n&apos;est inventée.
            </p>
          ) : (
            <>
              <div className="border-t border-border pt-6">
                <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Zones d&apos;intensité — {LIBELLE_GROUPE[actif.groupe]}
                </h4>
                <TableauZonesSport
                  sport={actif.sport}
                  references={etat.references}
                  reglages={etat.reglages}
                  onEnregistrerZones={enregistrerZones}
                  onReinitialiser={reinitialiser}
                />
              </div>

              {actif.sport !== "velo" && (
                <div className="border-t border-border pt-6">
                  <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Tests terrain
                  </h4>
                  <CalculateursTests sport={actif.sport} onEnregistrer={enregistrer} />
                </div>
              )}
            </>
          )}

          {etat.physio.derniereMiseAJour && (
            <p className="text-[11px] text-muted-foreground/70">
              Dernière modification : {new Date(etat.physio.derniereMiseAJour).toLocaleString("fr-FR")}
            </p>
          )}
        </div>
      )}

      {modaleOuverte && (
        <ModaleDonneesPhysio
          physio={etat.physio}
          onClose={() => setModaleOuverte(false)}
          onEnregistrer={enregistrer}
        />
      )}
    </AdminSection>
  );
}
