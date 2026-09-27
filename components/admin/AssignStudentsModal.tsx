"use client";

import { useEffect, useState } from "react";
import { CheckCircle, UserPlus } from "lucide-react";

import {
  dateProposeeParLaModale,
  datesAReecrireDepuisLaModale,
  terminerAssignation,
  terminerAssignationUnique,
  toggleSingleSelection,
  toggleStudentSelection,
} from "@/lib/assignment-selection";
import type { MotifAssignation } from "@/lib/assignment-selection";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cleAffectation, debutsDesAffectations } from "@/lib/supabase/programs";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { StudentPickerList } from "@/components/admin/StudentPickerList";
import type { AdminStudent, AssignableContentType } from "@/types";

/**
 * La date du jour au format `YYYY-MM-DD`, en heure LOCALE.
 *
 * ⚠️ PAS `toISOString().slice(0, 10)`, qui rend le jour UTC : passé 22h à
 * Paris en été, il proposerait DEMAIN. C'est la même confusion instant/jour
 * calendaire que celle corrigée dans `daysBetween`.
 */
function dateDuJourLocale(): string {
  const maintenant = new Date();
  const mois = String(maintenant.getMonth() + 1).padStart(2, "0");
  const jour = String(maintenant.getDate()).padStart(2, "0");
  return `${maintenant.getFullYear()}-${mois}-${jour}`;
}

interface AssignStudentsModalProps {
  contentLabel: string;
  contentType: AssignableContentType;
  contentId: string;
  students: AdminStudent[];
  assignedStudentIds: string[];
  onSetAssignment: (
    studentId: string,
    contentType: AssignableContentType,
    contentId: string,
    assigned: boolean,
    /** Programmes uniquement — voir le champ « Date de début » ci-dessous. */
    programStartDate?: string | null,
    /** `"date"` = correction d'une affectation existante, donc aucun email. */
    motif?: MotifAssignation,
  ) => void | boolean | Promise<boolean | void>;
  triggerLabel?: string;
  triggerVariant?: "primary" | "outline";
}

export function AssignStudentsModal({
  contentLabel,
  contentType,
  contentId,
  students,
  assignedStudentIds,
  onSetAssignment,
  triggerLabel = "Assigner",
  triggerVariant = "outline",
}: AssignStudentsModalProps) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  // Correctif fix/program-assignment-checkbox : la sélection vit ICI,
  // localement, initialisée depuis les assignations existantes à CHAQUE
  // ouverture (fermer/rouvrir recharge donc l'état réel). Aucune écriture
  // pendant la sélection — le diff ne part qu'au clic sur « Terminer ».
  const [selection, setSelection] = useState<string[]>([]);
  // Atomicité UI : « Terminer » attend TOUTES les écritures (verrou
  // anti-double-clic), et un échec laisse la modale OUVERTE avec un message
  // — jamais de faux succès.
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /**
   * Date de début du programme, PROGRAMMES UNIQUEMENT.
   *
   * ⚠️ PROPOSÉE À AUJOURD'HUI, MAIS MODIFIABLE AVANT VALIDATION — et c'est la
   * différence entre ce champ et le défaut qui a causé le bug. `students
   * .start_date` portait un `DEFAULT CURRENT_DATE` que personne ne voyait
   * jamais ; ici le coach LIT la date au moment où il assigne, et la corrige
   * s'il prépare un programme qui démarre lundi prochain.
   *
   * ⚠️ UNE SEULE DATE POUR LE LOT COCHÉ : on assigne un programme à plusieurs
   * élèves qui le commencent le même jour. Un élève qui démarre plus tard se
   * régularise depuis sa fiche.
   */
  const [dateDebut, setDateDebut] = useState<string>("");
  /**
   * LES DATES RÉELLEMENT STOCKÉES pour les élèves déjà affectés.
   *
   * ⚠️ UNE CLÉ ABSENTE SIGNIFIE « PAS LU », PAS « PAS DE DATE ». C'est ce qui
   * empêche « Terminer » d'écrire une date sur une affectation dont personne n'a
   * pu comparer la valeur — voir `affectationsDontLaDateChange`.
   */
  const [debutsStockes, setDebutsStockes] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [lectureDates, setLectureDates] = useState<"inutile" | "chargement" | "prete" | "erreur">("inutile");
  const [datesDivergentes, setDatesDivergentes] = useState(false);
  /**
   * `true` seulement quand le coach a modifié le champ À LA MAIN.
   *
   * ⚠️ SANS LUI, UN CLIC SUR « TERMINER » PARLE DE DATES SANS LE SAVOIR. Le
   * champ s'ouvre vide quand les élèves déjà assignés n'ont pas la même date ;
   * ce vide est un CONSTAT, pas une saisie. Le confondre avec « retire les
   * dates » a effacé le 07/09 de Jules en production, sur un geste qui visait à
   * cocher un autre élève. Voir `datesAReecrireDepuisLaModale`.
   */
  const [champDateTouche, setChampDateTouche] = useState(false);

  /*
   * LA LECTURE DES DATES ENREGISTRÉES — une seule fois par ouverture.
   *
   * ⚠️ ELLE NE PART QUE POUR LES PROGRAMMES AVEC AU MOINS UN ÉLÈVE DÉJÀ
   * AFFECTÉ. Une assignation neuve n'a rien à lire, et la nutrition comme les
   * documents n'ont pas de date de début : leur parcours ne change pas d'un
   * pixel, ni en requêtes ni en affichage.
   *
   * ⚠️ TOUT `setState` EST DANS LA CONTINUATION ASYNCHRONE. Le poser dans le
   * corps de l'effet serait un rendu de plus pour rien, ce que la règle
   * `react-hooks/set-state-in-effect` du dépôt refuse — même pour le chemin
   * « Supabase non configuré ».
   */
  const cleEleves = assignedStudentIds.join(",");
  useEffect(() => {
    if (!open || lectureDates !== "chargement") return;
    let annule = false;
    async function lire() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) setLectureDates("erreur");
        return;
      }
      const dejaAffectes = cleEleves === "" ? [] : cleEleves.split(",");
      const table = await debutsDesAffectations(
        supabase,
        dejaAffectes.map((studentId) => ({ studentId, programId: contentId })),
      );
      if (annule) return;
      // La table est indexée par couple ; la modale, elle, ne parle que
      // d'élèves — un seul contenu est ouvert à la fois.
      const parEleve = new Map<string, string | null>();
      for (const studentId of dejaAffectes) {
        const cle = cleAffectation(studentId, contentId);
        if (table.has(cle)) parEleve.set(studentId, table.get(cle) ?? null);
      }
      const proposition = dateProposeeParLaModale({
        dejaAffectes,
        debutsStockes: parEleve,
        dateDuJour: dateDuJourLocale(),
      });
      setDebutsStockes(parEleve);
      setDateDebut(proposition.valeur);
      setDatesDivergentes(proposition.divergentes);
      // La valeur qui vient d'arriver n'est pas une saisie du coach : le champ
      // redevient « non touché », sinon la lecture elle-même autoriserait une
      // réécriture.
      setChampDateTouche(false);
      setLectureDates("prete");
    }
    void lire();
    return () => {
      annule = true;
    };
  }, [open, lectureDates, contentId, cleEleves]);

  function close() {
    setOpen(false);
    setConfirmed(false);
    setSaving(false);
    setSaveFailed(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setSelection(assignedStudentIds);
          /*
           * ⚠️ LE CHAMP NE PART PLUS À « AUJOURD'HUI » QUAND UNE DATE EXISTE.
           * Avec des élèves déjà affectés, il reste VIDE le temps de la lecture
           * puis reçoit la valeur stockée : le coach ne voit jamais une date
           * qu'il n'a pas saisie et que la base ne porte pas. Sans élève déjà
           * affecté, rien à lire — la date du jour reste la proposition, comme
           * avant ce lot.
           */
          const aDejaDesAffectes = contentType === "programme" && assignedStudentIds.length > 0;
          setDebutsStockes(new Map());
          setDatesDivergentes(false);
          setChampDateTouche(false);
          setDateDebut(aDejaDesAffectes ? "" : dateDuJourLocale());
          setLectureDates(aDejaDesAffectes ? "chargement" : "inutile");
          setOpen(true);
        }}
        className={
          triggerVariant === "primary"
            ? "pressable flex min-h-[44px] items-center rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            : "pressable flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        }
      >
        <span className="flex items-center gap-1.5">
          <UserPlus size={13} />
          {triggerLabel}
        </span>
      </button>

      {open && (
        <Modal title={`Assigner — ${contentLabel}`} onClose={close}>
          {confirmed ? (
            <div className="flex items-center gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              <CheckCircle size={18} className="flex-shrink-0" />
              Assignation mise à jour.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {contentType === "nutrition"
                  ? "Choisis l'élève qui doit suivre ce plan. Un plan nutritionnel ne peut être suivi que par un seul élève à la fois."
                  : "Coche les élèves qui doivent avoir accès à ce contenu."}
              </p>
              <StudentPickerList
                students={students}
                selectedIds={selection}
                onToggle={(studentId, checked) =>
                  setSelection((prev) =>
                    // NUTRITION = CHOIX UNIQUE : `nutrition_plans.student_id`
                    // est une colonne scalaire, un plan ne peut pas viser
                    // deux élèves. Laisser cocher plusieurs élèves ferait
                    // miroiter un état impossible et le dernier écrit
                    // gagnerait silencieusement.
                    contentType === "nutrition"
                      ? toggleSingleSelection(prev, studentId, checked)
                      : toggleStudentSelection(prev, studentId, checked),
                  )
                }
              />
              {/* ⚠️ PROGRAMMES UNIQUEMENT. Un plan nutritionnel et un document
                  n'ont pas de « semaine 4 » : leur parcours d'affectation ne
                  change pas d'un pixel. */}
              {contentType === "programme" && (
                <div className="flex flex-col gap-1.5 rounded-panel border border-border bg-surface-soft/40 px-4 py-3">
                  <label
                    htmlFor="date-debut-programme"
                    className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
                  >
                    Date de début du programme
                  </label>
                  {/* ⚠️ VERROUILLÉ QUAND LES DATES DIVERGENT (option C du 27/09/2026).
                      Un champ unique ne peut pas corriger deux élèves qui ne sont
                      pas au même jour sans en écraser un ; le laisser actif
                      rendrait l'accident possible d'un seul clic. La fiche de
                      l'élève reste le chemin individuel. */}
                  <input
                    id="date-debut-programme"
                    type="date"
                    value={dateDebut}
                    disabled={datesDivergentes}
                    onChange={(event) => {
                      setDateDebut(event.target.value);
                      setChampDateTouche(true);
                    }}
                    className="min-h-[44px] rounded-control border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    C&apos;est elle qui détermine la semaine affichée à l&apos;élève. Laisse vide si
                    tu ne la connais pas encore — tu pourras la renseigner depuis sa fiche.
                  </p>
                  {/* ⚠️ CE QUE LE CHAMP MONTRE, DIT EXPLICITEMENT. Un champ de
                      date ne peut pas distinguer « lu et vide », « en cours de
                      lecture » et « plusieurs valeurs » : sans ces phrases, les
                      trois se ressemblent, et c'est exactement la confusion qui
                      a laissé croire qu'une date était enregistrée. */}
                  {lectureDates === "chargement" && (
                    <p className="text-xs text-muted-foreground">Lecture de la date enregistrée…</p>
                  )}
                  {lectureDates === "erreur" && (
                    <p className="text-xs text-destructive">
                      Impossible de lire la date enregistrée. Ne la saisis pas ici : corrige-la depuis
                      la fiche de l&apos;élève.
                    </p>
                  )}
                  {lectureDates === "prete" && datesDivergentes && (
                    <p className="text-xs text-warning">
                      Les élèves sélectionnés ont des dates de début différentes. Pour modifier la
                      date d&apos;un élève, utilisez sa fiche.
                    </p>
                  )}
                  {lectureDates === "prete" && !datesDivergentes && dateDebut === "" && (
                    <p className="text-xs text-warning">
                      Aucune date enregistrée pour les élèves déjà assignés.
                    </p>
                  )}
                </div>
              )}
              {saveFailed && (
                <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  L&apos;enregistrement a échoué. Ta sélection est conservée — réessaie, ou vérifie ta connexion.
                </p>
              )}
              <PrimaryButton
                disabled={saving}
                onClick={() => {
                  if (saving) return;
                  setSaving(true);
                  setSaveFailed(false);
                  // SEUL point d'écriture : le diff sélection ↔ assignations
                  // initiales, TOUTES les écritures attendues avant de
                  // confirmer — un échec laisse la modale ouverte.
                  //
                  // NUTRITION : aucune écriture de retrait quand un élève est
                  // choisi — la RPC déplace l'assignation en une transaction.
                  const terminerType =
                    contentType === "nutrition" ? terminerAssignationUnique : terminerAssignation;
                  /*
                   * ⚠️ LES ÉLÈVES INCHANGÉS DONT LA DATE A CHANGÉ SONT RÉÉMIS.
                   * C'était le cœur du bug : un élève déjà coché et toujours
                   * coché ne produisait AUCUN appel, donc la date saisie à côté
                   * de lui n'atteignait jamais la base — et la modale affichait
                   * « Assignation mise à jour ». Seule une vraie différence,
                   * mesurée contre la valeur LUE, déclenche une écriture.
                   */
                  const aReappliquer =
                    contentType === "programme"
                      ? datesAReecrireDepuisLaModale({
                          dejaAffectes: assignedStudentIds,
                          debutsStockes,
                          dateSaisie: dateDebut || null,
                          champDateTouche,
                          datesDivergentes,
                        })
                      : [];
                  void terminerType(
                    assignedStudentIds,
                    selection,
                    (studentId, assigned, motif) =>
                      // ⚠️ LA DATE NE PART QU'À L'ATTRIBUTION OU À LA CORRECTION.
                      // Au retrait, la ligne est supprimée : lui joindre une date
                      // n'aurait aucun sens, et l'écrire avant de supprimer en
                      // aurait encore moins.
                      onSetAssignment(
                        studentId,
                        contentType,
                        contentId,
                        assigned,
                        assigned && contentType === "programme" ? dateDebut || null : undefined,
                        motif,
                      ),
                    aReappliquer,
                  ).then(({ ok }) => {
                    setSaving(false);
                    if (ok) {
                      setConfirmed(true);
                    } else {
                      setSaveFailed(true);
                    }
                  });
                }}
              >
                {saving ? "Enregistrement…" : "Terminer"}
              </PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
