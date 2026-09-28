"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";

import { AdminSection } from "@/components/admin/AdminSection";
import { Field } from "@/components/admin/AdminFormFields";
import { Modal } from "@/components/admin/Modal";
import { EditeurBlocsCardio, type EnregistrementCardio } from "@/components/admin/cardio/EditeurBlocsCardio";
import { Loader } from "@/components/ui/Loader";
import { useCalendrierAthlete } from "@/hooks/useCalendrierAthlete";
import { usePhysiologieEleve } from "@/hooks/usePhysiologieEleve";
import { modelesCardio, resumeDuModeleCardio } from "@/lib/bibliotheque-cardio";
import {
  grilleDuMois,
  JOURS_COURTS,
  libelleDuMois,
  positionDansLeProgramme,
} from "@/lib/calendrier-athlete";
import { cibleDuSegment } from "@/lib/cardio-zones";
import { formatDurationSeconds } from "@/lib/cardio";
import type { SeanceDuCalendrier } from "@/lib/supabase/calendrier-seances";
import type { CardioTrainingBlock, SessionTemplate, TrainingBlock } from "@/types";

/**
 * LE CALENDRIER D'UN ATHLÈTE — ce qu'il fait, et quel jour.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS ÉTATS DE DATE, ET ILS NE SE CONFONDENT PAS
 * ════════════════════════════════════════════════════════════════════════
 *   · « planifiée » — le coach a posé une date (`scheduled_date`) ;
 *   · « calculée »  — la date vient du début de programme + semaine + jour ;
 *   · « indéterminée » — il n'y a pas de date de début : AUCUNE date n'est
 *     inventée, et ces séances sont listées à part au lieu d'être posées au
 *     hasard dans la grille.
 *
 * ⚠️ UN JOUR DE REPOS N'EST PAS AFFICHÉ. Voir `lireCalendrierDeLEleve`.
 *
 * ⚠️ RIEN N'EST MODIFIÉ SANS CLIC. Ouvrir une séance ne l'enregistre pas ;
 * déplacer demande une date ; supprimer demande confirmation, parce que les
 * clés étrangères sont en cascade et qu'il n'y a pas de corbeille.
 */

const TEINTE: Readonly<Record<string, string>> = {
  gray: "bg-surface-soft text-muted-foreground",
  red: "bg-red-500/20 text-red-200",
  orange: "bg-orange-500/20 text-orange-200",
  yellow: "bg-yellow-500/20 text-yellow-100",
  green: "bg-emerald-500/20 text-emerald-200",
  blue: "bg-sky-500/20 text-sky-200",
  purple: "bg-purple-500/20 text-purple-200",
};

const LIBELLE_SPORT: Readonly<Record<string, string>> = {
  course: "Course",
  velo: "Vélo",
  natation: "Natation",
  autre: "Autre",
};

function aujourdhuiIso(): string {
  const maintenant = new Date();
  return `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, "0")}-${String(maintenant.getDate()).padStart(2, "0")}`;
}

/** Les blocs cardio d'une séance, pour l'aperçu. */
function blocsCardio(blocks: readonly TrainingBlock[]): CardioTrainingBlock[] {
  return blocks.filter((bloc): bloc is CardioTrainingBlock => bloc.category === "cardio");
}

export function CalendrierAthlete({ studentId, nomEleve }: { readonly studentId: string; readonly nomEleve: string }) {
  const { etat, deplacer, supprimer, enregistrerSeance, creer, enregistrerDansLaBibliotheque, blocsDuModelePourApplication } =
    useCalendrierAthlete(studentId);
  const physio = usePhysiologieEleve(studentId);

  const aujourdhui = aujourdhuiIso();
  const [mois, setMois] = useState(() => {
    const maintenant = new Date();
    return { annee: maintenant.getFullYear(), mois: maintenant.getMonth() + 1 };
  });
  const [ouverte, setOuverte] = useState<SeanceDuCalendrier | null>(null);
  const [ajoutSurLeJour, setAjoutSurLeJour] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cases = useMemo(() => grilleDuMois(mois.annee, mois.mois), [mois]);
  const parDate = useMemo(() => {
    const table = new Map<string, SeanceDuCalendrier[]>();
    for (const seance of etat.calendrier.seances) {
      if (!seance.date) continue;
      const liste = table.get(seance.date) ?? [];
      liste.push(seance);
      table.set(seance.date, liste);
    }
    return table;
  }, [etat.calendrier.seances]);
  const sansDate = etat.calendrier.seances.filter((seance) => seance.date === null);

  function moisPrecedent() {
    setMois(({ annee, mois: m }) => (m === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: m - 1 }));
  }
  function moisSuivant() {
    setMois(({ annee, mois: m }) => (m === 12 ? { annee: annee + 1, mois: 1 } : { annee, mois: m + 1 }));
  }

  async function agir<T>(action: () => Promise<{ ok: boolean; erreur: string | null } & T>) {
    setEnCours(true);
    setMessage(null);
    const resultat = await action();
    setEnCours(false);
    if (!resultat.ok) setMessage(resultat.erreur ?? "L'opération a échoué.");
    return resultat;
  }

  return (
    <AdminSection
      title={`Calendrier — ${nomEleve}`}
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={moisPrecedent}
            aria-label="Mois précédent"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-border text-muted-foreground hover:border-primary hover:text-primary"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-36 text-center text-sm capitalize text-foreground">{libelleDuMois(mois.annee, mois.mois)}</span>
          <button
            type="button"
            onClick={moisSuivant}
            aria-label="Mois suivant"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-border text-muted-foreground hover:border-primary hover:text-primary"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      }
    >
      {etat.chargement ? (
        <Loader libelle="Chargement du calendrier…" />
      ) : !etat.disponible ? (
        <p className="text-sm text-muted-foreground">Supabase n&apos;est pas configuré : aucun calendrier n&apos;est lisible ici.</p>
      ) : !etat.calendrier.programme ? (
        <p className="text-sm text-muted-foreground">
          Aucun programme n&apos;est affecté à cet élève : il n&apos;y a pas de séance à dater.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {!etat.calendrier.debut && (
            <p className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              La date de début du programme n&apos;est pas renseignée pour cet élève : les séances non déplacées à la main
              n&apos;ont aucune date calculable, et sont listées sous la grille.
            </p>
          )}

          <div className="-mx-2 overflow-x-auto px-2">
            <div className="min-w-[700px]">
              <div className="grid grid-cols-7 gap-1 pb-1">
                {JOURS_COURTS.map((jour) => (
                  <div key={jour} className="px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {jour}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cases.map((caseDuMois) => {
                  const seances = parDate.get(caseDuMois.date) ?? [];
                  const estAujourdhui = caseDuMois.date === aujourdhui;
                  return (
                    <div
                      key={caseDuMois.date}
                      className={`flex min-h-24 flex-col gap-1 rounded-md border p-1.5 ${
                        caseDuMois.dansLeMois ? "border-border bg-background/40" : "border-border/40 bg-background/10"
                      } ${estAujourdhui ? "ring-1 ring-primary/60" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[11px] tabular-nums ${caseDuMois.dansLeMois ? "text-foreground" : "text-muted-foreground/50"}`}>
                          {Number(caseDuMois.date.slice(8, 10))}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAjoutSurLeJour(caseDuMois.date)}
                          aria-label={`Ajouter une séance le ${caseDuMois.date}`}
                          className="text-muted-foreground/50 transition-colors hover:text-primary"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      {seances.map((seance) => (
                        <button
                          key={seance.id}
                          type="button"
                          onClick={() => setOuverte(seance)}
                          className={`rounded px-1.5 py-1 text-left text-[11px] leading-tight transition-opacity hover:opacity-80 ${TEINTE[seance.couleur] ?? TEINTE.gray}`}
                        >
                          <span className="block truncate font-semibold">{seance.name || "Séance"}</span>
                          <span className="block truncate opacity-80">
                            {seance.sports.map((sport) => LIBELLE_SPORT[sport] ?? sport).join(" · ") || "—"}
                            {seance.durationMinutes > 0 ? ` · ${seance.durationMinutes} min` : ""}
                          </span>
                          {seance.origineDate === "planifiee" && <span className="block opacity-70">déplacée</span>}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {sansDate.length > 0 && (
            <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-soft/40 p-4">
              <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <CalendarDays size={13} />
                Séances sans date déterminable ({sansDate.length})
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Aucune date n&apos;est inventée pour elles. Renseigne la date de début du programme, ou déplace-les une par
                une.
              </p>
              <div className="flex flex-wrap gap-2">
                {sansDate.map((seance) => (
                  <button
                    key={seance.id}
                    type="button"
                    onClick={() => setOuverte(seance)}
                    className="rounded-control border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    S{seance.weekNumber} · {seance.day} · {seance.name || "Séance"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(message || etat.erreur) && (
            <p className="flex items-start gap-2 text-xs text-red-400">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              {message ?? etat.erreur}
            </p>
          )}
        </div>
      )}

      {ouverte && (
        <ModaleSeance
          seance={ouverte}
          debut={etat.calendrier.debut}
          references={physio.etat.references}
          reglagesZones={physio.etat.reglages}
          enCours={enCours}
          onFermer={() => setOuverte(null)}
          onDeplacer={async (date) => {
            const resultat = await agir(() => deplacer(ouverte.id, date));
            if (resultat.ok) setOuverte(null);
          }}
          onSupprimer={async () => {
            const resultat = await agir(() => supprimer(ouverte.id));
            if (resultat.ok) setOuverte(null);
          }}
          onEnregistrer={async (enregistrement) => {
            const resultat = await agir(() => enregistrerSeance(ouverte, enregistrement.blocksCardio, enregistrement.meta));
            if (resultat.ok && enregistrement.dansLaBibliotheque) {
              await agir(() =>
                enregistrerDansLaBibliotheque({
                  name: enregistrement.meta.name,
                  durationMinutes: enregistrement.meta.durationMinutes,
                  coachNotes: enregistrement.meta.coachNotes,
                  blocks: enregistrement.blocksCardio,
                }),
              );
            }
            if (resultat.ok) setOuverte(null);
          }}
        />
      )}

      {ajoutSurLeJour && etat.calendrier.programme && (
        <ModaleAjout
          date={ajoutSurLeJour}
          debut={etat.calendrier.debut}
          modeles={modelesCardio(etat.modeles)}
          references={physio.etat.references}
          reglagesZones={physio.etat.reglages}
          enCours={enCours}
          onFermer={() => setAjoutSurLeJour(null)}
          onCreer={async (entree) => {
            const position = positionDansLeProgramme(ajoutSurLeJour, etat.calendrier.debut);
            if (!position) {
              setMessage(
                "Impossible de placer une séance à cette date : la date de début du programme est absente, ou la date précède le début du programme.",
              );
              return;
            }
            const resultat = await agir(async () => {
              const creation = await creer({
                programId: etat.calendrier.programme?.id ?? "",
                weekNumber: position.semaine,
                day: position.jour,
                name: entree.meta.name,
                durationMinutes: entree.meta.durationMinutes,
                coachNotes: entree.meta.coachNotes,
                scheduledDate: ajoutSurLeJour,
                blocks: entree.blocksCardio,
              });
              return { ok: creation.ok, erreur: creation.erreur };
            });
            if (resultat.ok && entree.dansLaBibliotheque) {
              await agir(() =>
                enregistrerDansLaBibliotheque({
                  name: entree.meta.name,
                  durationMinutes: entree.meta.durationMinutes,
                  coachNotes: entree.meta.coachNotes,
                  blocks: entree.blocksCardio,
                }),
              );
            }
            if (resultat.ok) setAjoutSurLeJour(null);
          }}
          blocsDuModele={blocsDuModelePourApplication}
        />
      )}
    </AdminSection>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * OUVRIR UNE SÉANCE : lire, modifier, déplacer, supprimer
 * ════════════════════════════════════════════════════════════════════════ */

function ModaleSeance({
  seance,
  debut,
  references,
  reglagesZones,
  enCours,
  onFermer,
  onDeplacer,
  onSupprimer,
  onEnregistrer,
}: {
  readonly seance: SeanceDuCalendrier;
  readonly debut: string | null;
  readonly references: Parameters<typeof cibleDuSegment>[2];
  readonly reglagesZones: Parameters<typeof cibleDuSegment>[3];
  readonly enCours: boolean;
  readonly onFermer: () => void;
  readonly onDeplacer: (date: string | null) => void;
  readonly onSupprimer: () => void;
  readonly onEnregistrer: (enregistrement: EnregistrementCardio) => void;
}) {
  const [onglet, setOnglet] = useState<"apercu" | "edition">("apercu");
  const [nouvelleDate, setNouvelleDate] = useState(seance.date ?? "");
  const [confirmation, setConfirmation] = useState(false);

  const cardio = blocsCardio(seance.blocks);
  const position = seance.date ? positionDansLeProgramme(seance.date, debut) : null;

  return (
    <Modal title={seance.name || "Séance"} onClose={onFermer} maxWidth="max-w-4xl">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            Semaine {seance.weekNumber} · {seance.day}
          </span>
          <span>·</span>
          <span>
            {seance.date ?? "date indéterminée"}{" "}
            {seance.origineDate === "planifiee" ? "(déplacée à la main)" : seance.origineDate === "calculee" ? "(calculée)" : ""}
          </span>
          {position && position.semaine !== seance.weekNumber && (
            <span className="text-amber-300">
              — cette date correspond à la semaine {position.semaine} du programme, pas à la semaine {seance.weekNumber}.
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {(["apercu", "edition"] as const).map((valeur) => (
            <button
              key={valeur}
              type="button"
              onClick={() => setOnglet(valeur)}
              className={`inline-flex min-h-11 items-center rounded-control border px-4 py-2 text-[11px] uppercase tracking-widest ${
                onglet === valeur ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              {valeur === "apercu" ? "Aperçu" : "Modifier"}
            </button>
          ))}
        </div>

        {onglet === "apercu" ? (
          <div className="flex flex-col gap-4">
            {cardio.length === 0 ? (
              <p className="text-sm text-muted-foreground">Cette séance ne contient aucun bloc cardio.</p>
            ) : (
              cardio.map((bloc) => (
                <div key={bloc.id} className="rounded-card border border-border p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="text-sm font-semibold text-foreground">{bloc.title ?? "Bloc cardio"}</span>
                    {bloc.sport && <span>· {LIBELLE_SPORT[bloc.sport] ?? bloc.sport}</span>}
                    {bloc.rounds ? <span>· {bloc.rounds} séries</span> : null}
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {bloc.prescriptions.map((segment) => {
                      const cible = cibleDuSegment(segment, bloc.sport, references, reglagesZones);
                      return (
                        <li key={segment.id} className="text-xs text-muted-foreground">
                          <span className="text-foreground">{segment.title || "Segment"}</span>
                          {segment.durationSeconds ? ` · ${formatDurationSeconds(segment.durationSeconds)}` : ""}
                          {segment.distanceMeters ? ` · ${segment.distanceMeters} m` : ""}
                          {segment.repetitions ? ` · ×${segment.repetitions}` : ""}
                          {` — ${cible.consigne}`}
                          {cible.valeurs.length > 0 ? ` (${cible.valeurs.join(" · ")})` : ""}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}

            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end">
              <div className="sm:w-56">
                <Field label="Déplacer au" type="date" value={nouvelleDate} onChange={setNouvelleDate} />
              </div>
              <button
                type="button"
                onClick={() => onDeplacer(nouvelleDate || null)}
                disabled={enCours}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
              >
                {enCours && <Loader2 size={13} className="animate-spin" />}
                Déplacer
              </button>
              {seance.origineDate === "planifiee" && (
                <button
                  type="button"
                  onClick={() => onDeplacer(null)}
                  disabled={enCours}
                  className="inline-flex min-h-11 items-center justify-center rounded-control border border-border px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  Revenir à la date calculée
                </button>
              )}
            </div>

            <div className="border-t border-border pt-4">
              {confirmation ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-xs text-red-400">
                    Cette suppression est définitive : les blocs, exercices et prescriptions de la séance partent avec
                    elle. Confirmer ?
                  </p>
                  <button
                    type="button"
                    onClick={onSupprimer}
                    disabled={enCours}
                    className="inline-flex min-h-11 items-center gap-2 rounded-control bg-red-500/80 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white hover:bg-red-500 disabled:opacity-40"
                  >
                    {enCours && <Loader2 size={13} className="animate-spin" />}
                    Supprimer définitivement
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmation(false)}
                    className="text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmation(true)}
                  className="inline-flex min-h-11 items-center gap-2 text-[11px] uppercase tracking-widest text-red-400 hover:text-red-300"
                >
                  <Trash2 size={13} />
                  Supprimer la séance
                </button>
              )}
            </div>
          </div>
        ) : (
          <EditeurBlocsCardio
            meta={{ name: seance.name, durationMinutes: seance.durationMinutes || null, coachNotes: seance.coachNotes }}
            blocks={seance.blocks}
            references={references}
            reglagesZones={reglagesZones}
            enCours={enCours}
            libelleAction="Enregistrer les modifications"
            onEnregistrer={onEnregistrer}
            onAnnuler={() => setOnglet("apercu")}
          />
        )}
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * AJOUTER UNE SÉANCE : depuis la bibliothèque, ou neuve
 * ════════════════════════════════════════════════════════════════════════ */

function ModaleAjout({
  date,
  debut,
  modeles,
  references,
  reglagesZones,
  enCours,
  onFermer,
  onCreer,
  blocsDuModele,
}: {
  readonly date: string;
  readonly debut: string | null;
  readonly modeles: readonly SessionTemplate[];
  readonly references: Parameters<typeof cibleDuSegment>[2];
  readonly reglagesZones: Parameters<typeof cibleDuSegment>[3];
  readonly enCours: boolean;
  readonly onFermer: () => void;
  readonly onCreer: (entree: EnregistrementCardio) => void;
  readonly blocsDuModele: (template: SessionTemplate) => TrainingBlock[];
}) {
  const [depart, setDepart] = useState<{ meta: { name: string; durationMinutes: number | null; coachNotes: string }; blocks: TrainingBlock[] } | null>(null);
  const position = positionDansLeProgramme(date, debut);

  return (
    <Modal title={`Ajouter une séance — ${date}`} onClose={onFermer} maxWidth="max-w-4xl">
      <div className="flex flex-col gap-5">
        {position ? (
          <p className="text-xs text-muted-foreground">
            Cette date tombe en semaine {position.semaine} du programme, un {position.jour.toLowerCase()}. La séance y sera
            créée, avec sa date réelle enregistrée.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-warning">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            Cette date ne correspond à aucune semaine du programme (date de début absente, ou date antérieure au début).
            Aucune séance ne peut y être créée tant que ce n&apos;est pas résolu.
          </p>
        )}

        {depart === null ? (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              disabled={!position}
              onClick={() => setDepart({ meta: { name: "", durationMinutes: null, coachNotes: "" }, blocks: [] })}
              className="flex min-h-11 items-center justify-center gap-2 rounded-control border border-dashed border-border py-3 text-xs uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
            >
              <Plus size={13} />
              Nouvelle séance cardio
            </button>

            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Depuis ma bibliothèque ({modeles.length})
              </h4>
              {modeles.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aucun modèle cardio pour l&apos;instant. Coche « Enregistrer également dans ma bibliothèque » en
                  construisant une séance pour en créer un.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {modeles.map((modele) => {
                    const resume = resumeDuModeleCardio(modele);
                    return (
                      <li key={modele.id}>
                        <button
                          type="button"
                          disabled={!position}
                          onClick={() =>
                            setDepart({
                              meta: { name: modele.name, durationMinutes: modele.durationMinutes, coachNotes: "" },
                              blocks: blocsDuModele(modele),
                            })
                          }
                          className="w-full rounded-card border border-border p-3 text-left transition-colors hover:border-primary disabled:opacity-40"
                        >
                          <span className="block text-sm text-foreground">{resume.nom}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {resume.nombreDeBlocs} bloc{resume.nombreDeBlocs > 1 ? "s" : ""} · {resume.nombreDeSegments}{" "}
                            segment{resume.nombreDeSegments > 1 ? "s" : ""}
                            {resume.sports.length > 0 ? ` · ${resume.sports.map((s) => LIBELLE_SPORT[s] ?? s).join(", ")}` : ""}
                            {resume.dureeMinutes ? ` · ${resume.dureeMinutes} min` : ""}
                            {resume.avecMusculation ? " · contient aussi de la musculation" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <EditeurBlocsCardio
            meta={depart.meta}
            blocks={depart.blocks}
            references={references}
            reglagesZones={reglagesZones}
            enCours={enCours}
            libelleAction="Créer la séance"
            onEnregistrer={onCreer}
            onAnnuler={() => setDepart(null)}
          />
        )}
      </div>
    </Modal>
  );
}
