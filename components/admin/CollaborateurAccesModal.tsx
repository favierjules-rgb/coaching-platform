"use client";

import { useState } from "react";
import { AlertTriangle, ShieldCheck, Trash2, UserPlus } from "lucide-react";

import { SelectField } from "@/components/admin/AdminFormFields";
import { Modal } from "@/components/admin/Modal";
import { useCollaborateurAcces } from "@/hooks/useCollaborateurAcces";
import { AUCUN_ACCES_LABEL, categorieDroitLabels, niveauDroitLabels } from "@/lib/admin";
import { CATEGORIES_DROITS, type AdminCoach, type CategorieDroit, type NiveauDroit } from "@/types";

/**
 * Configuration des droits d'un COLLABORATEUR (modèle P13-B) — ouverte
 * depuis la section "Coachs" de /admin/parametres, à côté des boutons
 * "Modifier" et "Supprimer" déjà en place.
 *
 * Deux réglages, indépendants l'un de l'autre, parce que le modèle les
 * sépare :
 *
 *   1. LES ÉLÈVES, affectés un par un (`collaborateur_eleves`). Aucune
 *      affectation = aucun élève, et `students.coach_id` n'est jamais touché :
 *      le coach principal reste le coach principal.
 *   2. LE NIVEAU PAR CATÉGORIE (`collaborateur_permissions`), réglé
 *      séparément pour chacune des quatre catégories. "Aucun accès" n'est pas
 *      une valeur enregistrée : c'est la suppression de la ligne.
 *
 * Les deux conditions sont nécessaires : un élève affecté sans la catégorie
 * ne donne rien, une catégorie sans élève affecté ne donne rien. L'interface
 * le dit explicitement plutôt que de laisser croire qu'un réglage suffit.
 *
 * Ce que cet écran ne fait PAS : décider. Le refus est rendu par la RLS
 * (`collaborateur_eleves_manage_admin`, `collaborateur_permissions_manage_admin`,
 * réservées à `is_admin()`) et par les gardes de lib/api/authz.ts. Si
 * PostgreSQL refuse, l'erreur est affichée et l'état rechargé depuis la base :
 * l'écran ne montre jamais un droit qui n'a pas été enregistré.
 */

const OPTIONS_NIVEAU: { value: string; label: string }[] = [
  { value: "", label: AUCUN_ACCES_LABEL },
  { value: "lecture", label: niveauDroitLabels.lecture },
  { value: "ecriture", label: niveauDroitLabels.ecriture },
];

function niveauDepuisOption(valeur: string): NiveauDroit | null {
  return valeur === "lecture" || valeur === "ecriture" ? valeur : null;
}

interface CollaborateurAccesModalProps {
  collaborateur: AdminCoach;
  /** Fiche `coaches` de l'administrateur connecté — tracée dans `affecte_par` / `accorde_par`. */
  accordePar: string | null;
  onClose: () => void;
}

export function CollaborateurAccesModal({ collaborateur, accordePar, onClose }: CollaborateurAccesModalProps) {
  const { chargement, permissions, affectations, eleves, erreur, changerNiveau, affecter, revoquer } =
    useCollaborateurAcces(collaborateur.id, accordePar);

  const [categorieEnCours, setCategorieEnCours] = useState<CategorieDroit | null>(null);
  const [eleveChoisi, setEleveChoisi] = useState("");
  const [affectationEnCours, setAffectationEnCours] = useState(false);
  const [revocationEnCours, setRevocationEnCours] = useState<string | null>(null);

  const dejaAffectes = new Set(affectations.map((affectation) => affectation.studentId));
  const elevesRestants = eleves.filter((eleve) => !dejaAffectes.has(eleve.id));

  async function handleNiveau(categorie: CategorieDroit, valeur: string) {
    setCategorieEnCours(categorie);
    await changerNiveau(categorie, niveauDepuisOption(valeur));
    setCategorieEnCours(null);
  }

  async function handleAffecter() {
    if (!eleveChoisi) return;
    setAffectationEnCours(true);
    const ok = await affecter(eleveChoisi);
    setAffectationEnCours(false);
    if (ok) setEleveChoisi("");
  }

  async function handleRevoquer(studentId: string) {
    setRevocationEnCours(studentId);
    await revoquer(studentId);
    setRevocationEnCours(null);
  }

  return (
    <Modal title={`Droits de ${collaborateur.firstName} ${collaborateur.lastName}`.trim()} onClose={onClose} maxWidth="max-w-xl">
      <div className="flex flex-col gap-6">
        <p className="flex items-start gap-2 rounded-panel border border-border bg-surface-soft/40 px-4 py-3 text-xs text-muted-foreground">
          <ShieldCheck size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          Un collaborateur n&apos;accède qu&apos;aux élèves affectés ci-dessous, et seulement dans les catégories
          qui lui sont accordées. Les deux sont nécessaires : un élève affecté sans catégorie ne donne aucun accès.
        </p>

        {erreur && (
          <div role="alert" className="flex items-center gap-3 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertTriangle size={18} className="flex-shrink-0" aria-hidden="true" />
            {erreur}
          </div>
        )}

        {chargement ? (
          <p className="text-sm text-muted-foreground">Chargement des droits…</p>
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h4 className="font-heading text-xs font-bold uppercase tracking-widest text-foreground">
                Catégories accordées
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                {CATEGORIES_DROITS.map((categorie) => (
                  <div key={categorie}>
                    <SelectField
                      label={categorieDroitLabels[categorie]}
                      value={permissions[categorie] ?? ""}
                      onChange={(valeur) => void handleNiveau(categorie, valeur)}
                      options={OPTIONS_NIVEAU}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {categorieEnCours === categorie
                        ? "Enregistrement…"
                        : permissions[categorie]
                          ? niveauDroitLabels[permissions[categorie] as NiveauDroit]
                          : AUCUN_ACCES_LABEL}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                « Lecture et écriture » inclut la lecture de la même catégorie, et d&apos;elle seule. Aucune
                catégorie n&apos;ouvre la facturation, les abonnements ni la gestion des comptes.
              </p>
            </section>

            <section className="flex flex-col gap-3">
              <h4 className="font-heading text-xs font-bold uppercase tracking-widest text-foreground">
                Élèves affectés
              </h4>
              {affectations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun élève affecté — ce collaborateur n&apos;accède à aucune fiche.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {affectations.map((affectation) => (
                    <li
                      key={affectation.studentId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-surface-soft/40 px-4 py-3"
                    >
                      <span className="text-sm text-foreground">
                        {`${affectation.firstName} ${affectation.lastName}`.trim()}
                        {affectation.email && (
                          <span className="block text-xs text-muted-foreground">{affectation.email}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRevoquer(affectation.studentId)}
                        disabled={revocationEnCours === affectation.studentId}
                        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive/50 px-4 py-2 text-xs uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                        {revocationEnCours === affectation.studentId ? "Révocation…" : "Révoquer"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {elevesRestants.length > 0 ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <SelectField
                      label="Affecter un élève"
                      value={eleveChoisi}
                      onChange={setEleveChoisi}
                      options={[
                        { value: "", label: "Choisir un élève…" },
                        ...elevesRestants.map((eleve) => ({
                          value: eleve.id,
                          label: `${eleve.firstName} ${eleve.lastName}`.trim() || eleve.email,
                        })),
                      ]}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleAffecter()}
                    disabled={!eleveChoisi || affectationEnCours}
                    className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                  >
                    <UserPlus size={14} aria-hidden="true" />
                    {affectationEnCours ? "Affectation…" : "Affecter"}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Tous les élèves visibles sont déjà affectés.</p>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
