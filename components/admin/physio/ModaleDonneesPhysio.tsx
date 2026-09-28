"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Field, SelectField } from "@/components/admin/AdminFormFields";
import { Modal, OutlineButton, PrimaryButton } from "@/components/admin/Modal";
import {
  CHAMPS_PHYSIO,
  champsDuGroupe,
  ecritureDepuisSaisie,
  LIBELLE_GROUPE,
  OPTIONS_SEXE,
  provenancesDepuisPhysiologie,
  saisieDepuisPhysiologie,
  type GroupePhysio,
} from "@/lib/physiologie-champs";
import type { SourceValeur } from "@/lib/physiologie";
import type { EcriturePhysiologie, PhysiologieBrute } from "@/lib/supabase/physiologie";

const GROUPES: readonly GroupePhysio[] = ["general", "course", "velo", "natation"];

/**
 * « MODIFIER LES DONNÉES PHYSIOLOGIQUES ».
 *
 * ⚠️ LA MODALE N'ÉCRIT PAS ELLE-MÊME. Elle valide, construit l'écriture et la
 * remet à l'appelant, qui seul connaît l'élève visé. Un composant de formulaire
 * qui parlerait à Supabase pourrait, à la faveur d'une prop oubliée, écrire sur
 * le profil de quelqu'un d'autre.
 *
 * ⚠️ UN CHAMP VIDÉ EFFACE. C'est dit à l'écran, parce que c'est irréversible
 * côté donnée et que rien dans un champ vide ne le laisse devenir.
 */
export function ModaleDonneesPhysio({
  physio,
  onClose,
  onEnregistrer,
}: {
  readonly physio: PhysiologieBrute;
  readonly onClose: () => void;
  readonly onEnregistrer: (ecriture: EcriturePhysiologie) => Promise<{ ok: boolean; erreur: string | null }>;
}) {
  const [saisie, setSaisie] = useState<Record<string, string>>(() => saisieDepuisPhysiologie(physio));
  const [provenances, setProvenances] = useState<Record<string, SourceValeur>>(() =>
    provenancesDepuisPhysiologie(physio),
  );
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function valider() {
    const resultat = ecritureDepuisSaisie(saisie, provenances, physio.sources);
    setErreurs(resultat.erreurs);
    if (!resultat.ok || !resultat.ecriture) {
      setErreurGlobale("Certaines valeurs sont refusées : rien n'a été enregistré.");
      return;
    }
    setErreurGlobale(null);
    setEnCours(true);
    const reponse = await onEnregistrer(resultat.ecriture);
    setEnCours(false);
    if (!reponse.ok) {
      setErreurGlobale(reponse.erreur ?? "L'enregistrement a échoué.");
      return;
    }
    onClose();
  }

  return (
    <Modal title="Modifier les données physiologiques" onClose={onClose} maxWidth="max-w-3xl">
      <div className="flex flex-col gap-6">
        <p className="text-xs text-muted-foreground">
          Un champ laissé vide <strong>efface</strong> la valeur enregistrée. Aucune valeur n&apos;est déduite d&apos;une
          autre : ni FC max depuis l&apos;âge, ni VO2max depuis la VMA.
        </p>

        {GROUPES.map((groupe) => (
          <section key={groupe} className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {LIBELLE_GROUPE[groupe]}
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {champsDuGroupe(groupe).map((champ) => (
                <div key={champ.cle} className="flex flex-col gap-1">
                  {champ.nature === "choix" ? (
                    <SelectField
                      label={champ.libelle}
                      value={saisie[champ.cle] ?? ""}
                      onChange={(v) => setSaisie((precedent) => ({ ...precedent, [champ.cle]: v }))}
                      options={OPTIONS_SEXE.map((option) => ({ value: option.value, label: option.label }))}
                    />
                  ) : (
                    <Field
                      label={champ.unite ? `${champ.libelle} (${champ.unite})` : champ.libelle}
                      type={champ.nature === "date" ? "date" : "text"}
                      value={saisie[champ.cle] ?? ""}
                      onChange={(v) => setSaisie((precedent) => ({ ...precedent, [champ.cle]: v }))}
                      placeholder={champ.nature === "entier" ? "ex : 190" : champ.nature === "decimal" ? "ex : 11" : ""}
                    />
                  )}

                  {champ.provenanceDeclarable && (saisie[champ.cle] ?? "").trim() !== "" && (
                    <div className="flex items-center gap-3 pl-1">
                      {(["mesuree", "estimee"] as const).map((source) => (
                        <label key={source} className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                          <input
                            type="radio"
                            name={`provenance-${champ.cle}`}
                            checked={(provenances[champ.cle] ?? "mesuree") === source}
                            className="h-3 w-3 accent-primary"
                            value={source}
                            onChange={() => setProvenances((precedent) => ({ ...precedent, [champ.cle]: source }))}
                          />
                          {source === "mesuree" ? "Mesurée" : "Estimée"}
                        </label>
                      ))}
                    </div>
                  )}

                  {champ.aide && <p className="pl-1 text-[11px] text-muted-foreground">{champ.aide}</p>}
                  {erreurs[champ.cle] && <p className="pl-1 text-[11px] text-red-400">{erreurs[champ.cle]}</p>}
                </div>
              ))}
            </div>
          </section>
        ))}

        {erreurGlobale && (
          <p className="flex items-start gap-2 text-xs text-red-400">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            {erreurGlobale}
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <OutlineButton onClick={onClose}>Annuler</OutlineButton>
          <div className="sm:w-56">
            <PrimaryButton onClick={() => void valider()} disabled={enCours}>
              {enCours ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin" /> Enregistrement…
                </span>
              ) : (
                `Enregistrer (${CHAMPS_PHYSIO.length} champs)`
              )}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
