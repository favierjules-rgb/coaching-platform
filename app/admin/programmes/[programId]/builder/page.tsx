"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ProgramBuilderFullscreen, type BuilderData } from "@/components/admin/ProgramBuilderFullscreen";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseExerciseLibrary } from "@/hooks/useSupabaseExerciseLibrary";
import { useSupabaseProgram } from "@/hooks/useSupabaseProgram";
import { useSupabaseSessionTemplates } from "@/hooks/useSupabaseSessionTemplates";
import {
  executerResynchronisationDeLaPage,
  executerSauvegardeDeLaPage,
  programmeActifDeLaPage,
  type ResultatPourBuilder,
} from "@/lib/admin-builder-save";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { updateProgram as updateProgramSupabase } from "@/lib/supabase/programs";
import { createSessionTemplate } from "@/lib/supabase/session-templates";
import type { AdminProgram, AdminWorkoutSession } from "@/types";
import { Loader } from "@/components/ui/Loader";

/**
 * Builder plein écran V3 (/admin/programmes/[programId]/builder) : route
 * indépendante de la page de détail (/admin/programmes/[programId]), qui
 * reste l'aperçu en lecture seule. AdminShell détecte cette route par
 * pattern d'URL et retire sidebar/menu — voir components/admin/AdminShell.tsx.
 */
export default function ProgramBuilderPage() {
  const params = useParams<{ programId: string }>();
  const { state } = useAdminData();

  // Lecture CIBLÉE : ce seul programme, pas la totalité du catalogue. Voir
  // useSupabaseProgram — la lecture globale faisait dépasser le plafond d'URL
  // de la passerelle PostgREST dès que le nombre de séances grandissait.
  const supabaseProgram = useSupabaseProgram(params.programId);
  // ⚠️ « Supabase est-il actif » se lit dans la CONFIGURATION, pas dans le
  // résultat : un identifiant inconnu rend `null` et ne doit pas faire
  // réapparaître les programmes de démonstration (cf. 65be51b).
  const isSupabaseActive = isSupabaseConfigured();
  const derivedProgram = isSupabaseActive
    ? (supabaseProgram.program ?? undefined)
    : state.programs.find((p) => p.id === params.programId);

  // Snapshot de page + révision qui pilotent le remount du builder.
  // `savedProgram` n'est écrit QUE dans le handler de sauvegarde (jamais dans un
  // effet), sur un succès réel (sauvegarde + refetch OK). Le programme actif est
  // DÉRIVÉ au render : le snapshot sauvegardé prime tant qu'il concerne ce
  // programId, sinon on retombe sur la version du cache. Un changement
  // SECONDAIRE du cache ne remonte donc pas le builder (la `key` ne change pas).
  // La `key` n'utilise PLUS `program.updatedAt` (non fiable : la RPC bumpe
  // workout_sessions.updated_at, pas forcément programs.updated_at) mais une
  // révision incrémentée explicitement.
  const [savedProgram, setSavedProgram] = useState<AdminProgram | null>(null);
  const [builderRevision, setBuilderRevision] = useState(0);
  /*
   * ⚠️ « ENREGISTRÉ MAIS PAS RELU » EST UN ÉTAT À PART ENTIÈRE, PAS UNE ERREUR.
   * Les écritures sont commitées ; c'est la relecture qui a échoué. L'état
   * affiché est donc périmé sur deux points qui interdisent d'écrire par-dessus :
   * ses `updatedAt` de séance ne valent plus comme verrous optimistes, et les
   * prescriptions que le serveur vient de créer portent encore ici des
   * identifiants temporaires `new-prescription:…`. Tant que ce drapeau est levé,
   * `handleSave` refuse AVANT le réseau et l'interface propose une
   * resynchronisation. Voir refusPourDesynchronisation() pour les trois raisons.
   */
  const [desynchronise, setDesynchronise] = useState(false);
  // Dérivation extraite dans lib/admin-builder-save.ts — c'est l'expression qui
  // tombait à `undefined` après un échec de relecture et démontait le builder.
  const activeProgram = programmeActifDeLaPage(savedProgram, derivedProgram, params.programId);

  const supabaseExerciseLibrary = useSupabaseExerciseLibrary();
  /*
   * ⚠️ LA BANQUE D'EXERCICES SUIT LA CONFIGURATION, PLUS SON NOMBRE DE
   * LIGNES. `isSupabaseActive` commandait déjà la lecture du programme
   * (ligne 38) ; la banque, elle, basculait encore sur `items.length > 0`.
   * Pendant la requête initiale, le picker du builder proposait donc les
   * exercices de démonstration de `data/admin.ts` — et un exercice choisi là
   * entre dans une séance qui part en base avec un `exercise_library_id` qui
   * n'existe pas.
   */
  const library = isSupabaseActive ? supabaseExerciseLibrary.items : state.exerciseLibrary;

  const sessionTemplates = useSupabaseSessionTemplates();

  async function handleSaveAsTemplate(session: AdminWorkoutSession, name: string, description: string): Promise<boolean> {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return false;
    const id = await createSessionTemplate(supabase, session, name, description);
    if (id) await sessionTemplates.refetch();
    return Boolean(id);
  }

  async function handleSave(data: BuilderData): Promise<boolean | ResultatPourBuilder> {
    if (!activeProgram) return false;
    if (!isSupabaseActive) return true;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return true;

    const programId = activeProgram.id;
    const etatCourant = { program: activeProgram, revision: builderRevision, desynchronise };

    /*
     * TOUTE la décision est dans `executerSauvegardeDeLaPage` (hors React, donc
     * testée directement) : refus préventif si l'état est désynchronisé — AVANT
     * d'appeler `save`, donc avant tout réseau —, puis sauvegarde, relecture, et
     * transition d'état. La page ne fait qu'injecter les deux poignées et
     * appliquer le résultat.
     */
    const { etat, resultat, outcome } = await executerSauvegardeDeLaPage({
      etat: etatCourant,
      /*
       * ⚠️ `activeProgram` EST PASSÉ COMME INSTANTANÉ, ET CE N'EST PAS UN
       * DÉTAIL. C'est la référence du diff : la source des `updatedAt`
       * (verrous optimistes) et des identifiants réels. Sans lui,
       * `calculerDiffProgrammation` ne peut déclarer aucune séance inchangée et
       * les 84 repartent — correct, mais sans aucun gain.
       */
      save: () => updateProgramSupabase(supabase, programId, data, activeProgram),
      refetch: () => supabaseProgram.refetch(),
    });

    /*
     * ⚠️ ON N'ÉCRIT L'ÉTAT QUE S'IL A CHANGÉ — la référence est conservée quand
     * rien ne bouge (STALE, erreur, refus préventif). Épingler `savedProgram`
     * sur un STALE figerait la page sur un instantané périmé alors qu'un
     * rafraîchissement du cache serait justement la bonne suite.
     *
     * Quand il a changé après un `refetch-failed` : `etat.program` est le MÊME
     * objet et `etat.revision` la MÊME valeur, donc la `key` du builder ne
     * change pas et il n'est PAS démonté ; l'écriture de `savedProgram` ne sert
     * qu'à ÉPINGLER cet instantané pour qu'`activeProgram` reste défini même si
     * le cache du hook venait à se vider. C'est la seconde des deux protections.
     */
    if (etat !== etatCourant) {
      setSavedProgram(etat.program);
      setBuilderRevision(etat.revision);
      setDesynchronise(etat.desynchronise);
    }

    if (resultat.ok) return true;
    if (resultat.desynchronise) {
      console.warn("[builder] enregistré, relecture échouée — état désynchronisé", outcome);
    } else {
      // Incident du 02/08 : l'erreur TECHNIQUE part en console (diagnostic), et
      // un message ACTIONNABLE remonte au builder quand la cause est connue.
      console.error("[builder] échec d'enregistrement", outcome);
    }
    return resultat;
  }

  /**
   * LA SORTIE DE L'ÉTAT DÉSYNCHRONISÉ, déclenchée par le coach.
   *
   * Un succès se comporte exactement comme un succès de sauvegarde : nouvel
   * instantané + révision incrémentée ⇒ le builder remonte sur les données
   * SERVEUR. Les identifiants temporaires `new-prescription:…` disparaissent
   * avec l'ancien état local et sont remplacés par les identifiants réellement
   * persistés — c'est là, et nulle part ailleurs, que se fait la réconciliation.
   * Aucun `id_mapping` n'est interprété côté client.
   */
  async function handleResynchroniser(): Promise<boolean> {
    if (!activeProgram) return false;
    if (!isSupabaseActive) return true;
    const { etat, ok } = await executerResynchronisationDeLaPage({
      etat: { program: activeProgram, revision: builderRevision, desynchronise },
      refetch: () => supabaseProgram.refetch(),
    });
    if (ok) {
      setSavedProgram(etat.program);
      setBuilderRevision(etat.revision);
      setDesynchronise(etat.desynchronise);
      return true;
    }
    console.error("[builder] resynchronisation échouée — état toujours désynchronisé");
    return false;
  }

  /*
   * ⚠️ LA BANQUE ENTRE DANS LA GARDE. Ouvrir le builder sur un picker vide
   * puis le voir se remplir est acceptable ; l'ouvrir sur des exercices de
   * démonstration ne l'est pas, parce qu'on peut en poser un dans une séance
   * avant que la vraie banque arrive.
   */
  if (isSupabaseActive && supabaseExerciseLibrary.loading) {
    return <Loader libelle="Chargement du builder…" className="h-dvh" />;
  }

  if (supabaseProgram.loading && !activeProgram) {
    return <Loader libelle="Chargement du builder…" className="h-dvh" />;
  }

  if (!activeProgram) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
        <p>Programme introuvable.</p>
        <Link href="/admin/programmes" className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
          <ArrowLeft size={14} />
          Retour aux programmes
        </Link>
      </div>
    );
  }

  return (
    // key contrôlée par la page : ne change qu'au remplacement explicite du
    // snapshot (sauvegarde réussie via builderRevision) ou au changement de
    // programId. Le builder se réinitialise alors depuis le snapshot frais.
    <ProgramBuilderFullscreen
      key={`${activeProgram.id}:${builderRevision}`}
      program={activeProgram}
      library={library}
      onSave={handleSave}
      desynchronise={desynchronise}
      onResynchroniser={handleResynchroniser}
      templates={sessionTemplates.items}
      onSaveAsTemplate={handleSaveAsTemplate}
    />
  );
}
