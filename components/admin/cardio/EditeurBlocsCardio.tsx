"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Dumbbell, Loader2, Plus, Trash2 } from "lucide-react";

import { Field, CheckboxField, TextareaField } from "@/components/admin/AdminFormFields";
import { CardioBlockRow } from "@/components/admin/cardio/CardioBlockRow";
import { blankCardioBlock } from "@/lib/cardio";
import type { ReferencesAthlete, ReglagesZones } from "@/lib/zones-physiologiques";
import type { AdminCardioBlock, CardioTrainingBlock, TrainingBlock } from "@/types";

/**
 * L'ÉDITEUR DE BLOCS CARDIO — dans une séance qui contient AUSSI de la
 * musculation.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'IL EST, ET CE QU'IL N'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ IL N'EXISTE PAS DE « SÉANCE CARDIO » DANS CE MODÈLE. Une séance est une
 * liste ORDONNÉE de blocs, et l'entrelacement musculation → cardio →
 * musculation est une composition légitime et fréquente (287 des 847 séances de
 * production sont mixtes). Cet écran n'édite QUE les blocs cardio de cette
 * séance ; la musculation est affichée à sa place pour que le coach voie l'ordre
 * réel, et reste modifiable là où elle l'a toujours été.
 *
 * ⚠️ IL NE RENVOIE QUE LES BLOCS CARDIO, ET C'EST LA GARANTIE. L'enregistrement
 * part en portée `"cardio"` : la musculation n'est PAS dans le payload, donc la
 * RPC n'a structurellement pas de quoi la supprimer — au lieu de compter sur cet
 * écran pour la recopier fidèlement. Voir `SaveScope`
 * (lib/supabase/training-session-blocks.ts).
 *
 * ⚠️ LES BLOCS CARDIO SE DÉPLACENT ENTRE EUX. Glisser un bloc cardio AU-DELÀ
 * d'un bloc de musculation changerait la position de la musculation, ce qu'une
 * écriture de portée `"cardio"` ne peut pas exprimer — et ne doit pas pouvoir.
 * Ce réordonnancement-là appartient au builder de séance, qui détient les deux
 * catégories. L'écran le dit plutôt que de proposer un bouton qui mentirait.
 */

export interface MetaSeanceCardio {
  readonly name: string;
  readonly durationMinutes: number | null;
  readonly coachNotes: string;
}

export interface EnregistrementCardio {
  readonly meta: MetaSeanceCardio;
  /**
   * LES BLOCS CARDIO SEULS, avec leurs positions réelles dans la séance.
   *
   * ⚠️ L'APPELANT DOIT ENREGISTRER EN PORTÉE « cardio ». Envoyer cette liste en
   * portée « all » supprimerait la musculation de la séance : c'est exactement
   * le défaut que la portée ferme.
   */
  readonly blocksCardio: CardioTrainingBlock[];
  /** `true` quand le coach a coché « Enregistrer également dans ma bibliothèque ». */
  readonly dansLaBibliotheque: boolean;
}

/** Les blocs cardio à envoyer, positions de la séance PRÉSERVÉES. */
export function blocsCardioPourEnregistrement(blocs: readonly TrainingBlock[]): CardioTrainingBlock[] {
  /*
   * ⚠️ AUCUNE RENUMÉROTATION. Les positions viennent de la séance complète : les
   * renuméroter 0..n sur les seuls blocs cardio les ferait tous remonter devant
   * la musculation au prochain affichage.
   */
  return blocs.filter((bloc): bloc is CardioTrainingBlock => bloc.category === "cardio");
}

/** Un bloc cardio neuf, posé APRÈS le dernier bloc de la séance. */
function blocCardioNeuf(positionSuivante: number): CardioTrainingBlock {
  const modele: AdminCardioBlock = blankCardioBlock(positionSuivante + 1);
  return {
    id: modele.id,
    category: "cardio",
    position: positionSuivante,
    title: modele.title ? modele.title : null,
    colorKey: "blue",
    cardioType: modele.cardioType,
    machineType: modele.machineType,
    sport: undefined,
    rounds: undefined,
    prescriptions: modele.segments,
  };
}

/** Vue `AdminCardioBlock` d'un bloc canonique — la forme que `CardioBlockRow` édite. */
function versAdminBlock(bloc: CardioTrainingBlock): AdminCardioBlock {
  return {
    id: bloc.id,
    order: bloc.position,
    title: bloc.title ?? "",
    cardioType: bloc.cardioType,
    machineType: bloc.machineType,
    sport: bloc.sport,
    rounds: bloc.rounds,
    segments: bloc.prescriptions,
  };
}

export function EditeurBlocsCardio({
  meta: metaInitiale,
  blocks: blocsInitiaux,
  references,
  reglagesZones,
  referenceVmaKmh,
  enCours = false,
  erreur = null,
  libelleAction = "Enregistrer les blocs cardio",
  onEnregistrer,
  onAnnuler,
}: {
  readonly meta: MetaSeanceCardio;
  /** TOUS les blocs de la séance — la musculation sert à montrer l'ordre réel. */
  readonly blocks: readonly TrainingBlock[];
  readonly references?: ReferencesAthlete;
  readonly reglagesZones?: ReglagesZones;
  /** Repli d'aperçu quand aucune référence d'athlète n'est fournie. */
  readonly referenceVmaKmh?: number;
  readonly enCours?: boolean;
  readonly erreur?: string | null;
  readonly libelleAction?: string;
  readonly onEnregistrer: (enregistrement: EnregistrementCardio) => void;
  readonly onAnnuler?: () => void;
}) {
  const [meta, setMeta] = useState<MetaSeanceCardio>(metaInitiale);
  const [blocs, setBlocs] = useState<TrainingBlock[]>(() =>
    [...blocsInitiaux].sort((a, b) => a.position - b.position).map((bloc) => ({ ...bloc })),
  );
  const [dansLaBibliotheque, setDansLaBibliotheque] = useState(false);
  const [erreurLocale, setErreurLocale] = useState<string | null>(null);

  const blocsCardio = blocs.filter((bloc): bloc is CardioTrainingBlock => bloc.category === "cardio");
  const blocsMuscu = blocs.filter((bloc) => bloc.category === "strength");

  function remplacerBloc(id: string, suivant: CardioTrainingBlock) {
    setBlocs((precedents) => precedents.map((bloc) => (bloc.id === id ? suivant : bloc)));
  }

  function ajouterBloc() {
    setBlocs((precedents) => {
      const positionSuivante = precedents.reduce((max, bloc) => Math.max(max, bloc.position + 1), 0);
      return [...precedents, blocCardioNeuf(positionSuivante)];
    });
  }

  function supprimerBloc(id: string) {
    // ⚠️ AUCUNE RENUMÉROTATION : les positions des autres blocs, musculation
    // comprise, ne bougent pas. Un trou dans la suite des positions est sans
    // conséquence — c'est une clé de tri, pas un index.
    setBlocs((precedents) => precedents.filter((bloc) => bloc.id !== id));
  }

  /** Échange les POSITIONS de deux blocs cardio — la musculation ne bouge pas. */
  function echangerCardio(id: string, direction: "up" | "down") {
    setBlocs((precedents) => {
      const cardio = precedents
        .filter((bloc) => bloc.category === "cardio")
        .sort((a, b) => a.position - b.position);
      const index = cardio.findIndex((bloc) => bloc.id === id);
      const cible = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || cible < 0 || cible >= cardio.length) return precedents;
      const positionA = cardio[index].position;
      const positionB = cardio[cible].position;
      return precedents.map((bloc) => {
        if (bloc.id === cardio[index].id) return { ...bloc, position: positionB };
        if (bloc.id === cardio[cible].id) return { ...bloc, position: positionA };
        return bloc;
      });
    });
  }

  function enregistrer() {
    if (meta.name.trim() === "") {
      setErreurLocale("La séance a besoin d'un nom.");
      return;
    }
    if (blocsCardio.length === 0) {
      setErreurLocale("Ajoute au moins un bloc cardio, ou annule.");
      return;
    }
    const sansSegment = blocsCardio.find((bloc) => bloc.prescriptions.length === 0);
    if (sansSegment) {
      setErreurLocale("Chaque bloc cardio a besoin d'au moins un segment.");
      return;
    }
    setErreurLocale(null);
    onEnregistrer({
      meta: { ...meta, name: meta.name.trim() },
      blocksCardio: blocsCardioPourEnregistrement(blocs),
      dansLaBibliotheque,
    });
  }

  const ordonnes = [...blocs].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Nom de la séance" value={meta.name} onChange={(v) => setMeta((m) => ({ ...m, name: v }))} placeholder="Ex : Seuil + gainage" />
        <Field
          label="Durée prévue (min)"
          type="number"
          value={meta.durationMinutes !== null ? String(meta.durationMinutes) : ""}
          onChange={(v) => setMeta((m) => ({ ...m, durationMinutes: v ? Number(v) : null }))}
        />
      </div>
      <TextareaField
        label="Notes du coach"
        value={meta.coachNotes}
        onChange={(v) => setMeta((m) => ({ ...m, coachNotes: v }))}
        rows={2}
      />

      {blocsMuscu.length > 0 && (
        <div className="flex items-start gap-2 rounded-card border border-border bg-surface-soft/40 p-4 text-xs text-muted-foreground">
          <Dumbbell size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            Cette séance contient aussi{" "}
            {blocsMuscu.length === 1 ? "un bloc de musculation" : `${blocsMuscu.length} blocs de musculation`}. Ils ne sont
            pas modifiés ici, et l&apos;enregistrement ne peut pas les supprimer : il ne porte que le cardio. Pour changer
            leur contenu ou intercaler un bloc cardio entre eux, passe par le builder de séance.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {ordonnes.map((bloc) =>
          bloc.category === "strength" ? (
            <div
              key={bloc.id}
              className="flex items-center gap-2 rounded-card border border-dashed border-border/60 px-4 py-3 text-xs text-muted-foreground"
            >
              <Dumbbell size={13} className="flex-shrink-0" />
              <span>
                Musculation · {bloc.title ?? "Bloc"} · {bloc.exercises.length} exercice
                {bloc.exercises.length > 1 ? "s" : ""} — conservé tel quel
              </span>
            </div>
          ) : (
            <div key={bloc.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Bloc cardio · {bloc.title ?? "sans titre"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => echangerCardio(bloc.id, "up")}
                    aria-label="Remonter ce bloc cardio"
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => echangerCardio(bloc.id, "down")}
                    aria-label="Descendre ce bloc cardio"
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => supprimerBloc(bloc.id)}
                    aria-label="Supprimer ce bloc cardio"
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <CardioBlockRow
                block={versAdminBlock(bloc)}
                referenceVmaKmh={referenceVmaKmh ?? 0}
                references={references}
                reglagesZones={reglagesZones}
                colorKey={bloc.colorKey}
                onColorKeyChange={(couleur) => remplacerBloc(bloc.id, { ...bloc, colorKey: couleur })}
                onChange={(suivant) =>
                  remplacerBloc(bloc.id, {
                    ...bloc,
                    title: suivant.title ? suivant.title : null,
                    cardioType: suivant.cardioType,
                    machineType: suivant.machineType,
                    sport: suivant.sport,
                    rounds: suivant.rounds,
                    prescriptions: suivant.segments,
                  })
                }
                showBlockChrome={false}
              />
            </div>
          ),
        )}
        <button
          type="button"
          onClick={ajouterBloc}
          className="flex min-h-11 items-center justify-center gap-2 border border-dashed border-border py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus size={13} />
          Ajouter un bloc cardio
        </button>
      </div>

      <CheckboxField
        label="Enregistrer également dans ma bibliothèque"
        checked={dansLaBibliotheque}
        onChange={setDansLaBibliotheque}
      />

      {(erreurLocale || erreur) && (
        <p className="flex items-start gap-2 text-xs text-red-400">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          {erreurLocale ?? erreur}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onAnnuler && (
          <button
            type="button"
            onClick={onAnnuler}
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-border px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary"
          >
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={enregistrer}
          disabled={enCours}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-6 py-2 text-[11px] font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
        >
          {enCours && <Loader2 size={13} className="animate-spin" />}
          {libelleAction}
        </button>
      </div>
    </div>
  );
}
