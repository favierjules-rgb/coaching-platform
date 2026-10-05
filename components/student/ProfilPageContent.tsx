"use client";

import { RotateCcw } from "lucide-react";

import { ChangePasswordSection } from "@/components/student/ChangePasswordSection";
import { CoachingSummaryCard } from "@/components/student/CoachingSummaryCard";
import { EditPersonalInfoModal } from "@/components/student/EditPersonalInfoModal";
import { GoalsSection } from "@/components/student/GoalsSection";
import { InjurySection } from "@/components/student/InjurySection";
import { InstallAppSection } from "@/components/student/InstallAppSection";
import { MeasurementsSection } from "@/components/student/MeasurementsSection";
import { InfoRow, ProfileSection, TagList } from "@/components/student/ProfileSection";
import { NewsletterPreferenceToggle } from "@/components/student/NewsletterPreferenceToggle";
import { ProgressPhotoGallerySection } from "@/components/student/ProgressPhotoGallerySection";
import { StudentOnboardingDetailModal } from "@/components/student/StudentOnboardingDetailModal";
import { SubscriptionSection } from "@/components/student/SubscriptionSection";
import { WeightEvolutionCard } from "@/components/student/WeightEvolutionCard";
import { SectionIndisponible } from "@/components/pwa/SectionIndisponible";
import { NotificationsSection } from "@/components/student/NotificationsSection";
import { useEtatOfflineEleve } from "@/hooks/useEtatOfflineEleve";
import { useStudentProfile, type StudentProfileState } from "@/hooks/useStudentProfile";
import { useSupabaseStudentProfile } from "@/hooks/useSupabaseStudentProfile";
import { vuesProfilOnboarding } from "@/lib/profil-eleve-onboarding";
import type { FoodPreferences, InjuryNote, SportPreferences, StudentGoal } from "@/types";
import { Loader } from "@/components/ui/Loader";

/**
 * LES QUATRE BLOCS DE DÉMONSTRATION, NOMMÉS COMME TELS (P8).
 *
 * ⚠️ CES VALEURS VIENNENT DE `data/student.ts`, ET LE TYPE LE DIT. Elles
 * étaient passées en quatre props anonymes, que rien ne distinguait d'une
 * donnée réelle : il fallait lire la page pour savoir d'où elles sortaient.
 * Regroupées sous `demonstration`, leur rôle est lisible à l'appel.
 *
 * Elles ne sont rendues QUE dans la branche de démonstration — celle qu'on
 * n'atteint que si Supabase n'est pas configuré.
 */
export interface ProfilDemonstration {
  foodPreferences: FoodPreferences;
  sportPreferences: SportPreferences;
  injuryNote: InjuryNote;
  studentGoal: StudentGoal;
}

interface ProfilPageContentProps {
  studentId: string;
  seed: StudentProfileState;
  demonstration: ProfilDemonstration;
}

/**
 * Composant client unique qui monte useStudentProfile et distribue le même
 * état (profil, historique de poids, mensurations, photos) à toutes les
 * sections de /profil, pour qu'une mise à jour (poids, objectif, infos,
 * mensurations, photo) soit immédiatement visible partout sur la page et
 * persiste après rechargement (localStorage).
 */
export function ProfilPageContent({ studentId, seed, demonstration }: ProfilPageContentProps) {
  // Toujours montés tous les deux (règle des hooks) : useSupabaseStudentProfile
  // vérifie si l'utilisateur connecté a une vraie fiche élève Supabase, et
  // seul le résultat correspondant est réellement utilisé plus bas. Tant
  // que Supabase n'est pas configuré, n'a pas de fiche élève pour ce compte,
  // ou que la vérification est en cours, on continue avec le mock/localStorage
  // existant — comportement inchangé.
  const mockProfile = useStudentProfile(studentId, seed);
  const supabaseProfile = useSupabaseStudentProfile();
  const useSupabase = supabaseProfile.ready && supabaseProfile.state !== null;
  // POURQUOI le chargement n'a rien donné. Même diagnostic que les autres
  // écrans élève ; aucune requête tant que le verdict en ligne n'est pas
  // tombé.
  const local = useEtatOfflineEleve(supabaseProfile.ready && !useSupabase);
  // Compte "achat unique" (chantier suppression auto. 6 mois) : accès à
  // /profil réduit à l'essentiel (nom, email, mot de passe) — jamais aux
  // mensurations/photos/préférences réservées aux vrais clients coaching.
  const isProgramOnly = useSupabase && supabaseProfile.accessType === "programme_seul";

  const state = useSupabase ? supabaseProfile.state! : mockProfile.state;
  const updateProfile = useSupabase ? supabaseProfile.updateProfile : mockProfile.updateProfile;
  const updateWeight = useSupabase ? supabaseProfile.updateWeight : mockProfile.updateWeight;
  const updateMeasurements = useSupabase ? supabaseProfile.updateMeasurements : mockProfile.updateMeasurements;
  const addPhoto = useSupabase ? supabaseProfile.addPhoto : mockProfile.addPhoto;
  const removePhoto = useSupabase ? supabaseProfile.removePhoto : mockProfile.removePhoto;
  const { profile, weightHistory, measurements, customMeasurements, measurementHistory, photos } = state;
  /*
   * LES QUATRE BLOCS DE L'ÉLÈVE RÉEL — MÊME SOURCE QUE LE COACH (P8).
   *
   * `vuesProfilOnboarding` est le module partagé ; il ne lit que les colonnes
   * vivantes de `student_profiles` et ne fabrique aucun champ absent du schéma
   * (voir lib/profil-eleve-onboarding.ts).
   *
   * ⚠️ DÉRIVÉ À CHAQUE RENDU, ET PAS MÉMORISÉ. La fonction est pure et
   * minuscule ; un `useMemo` ici n'économiserait rien et ajouterait une
   * dépendance à tenir à jour.
   *
   * ⚠️ `onboardingProfile` PEUT ÊTRE ABSENT sans que le profil soit absent :
   * la fiche `student_profiles` n'existe pas encore pour un élève tout juste
   * créé. `ficheDisponible` porte cette distinction jusqu'à l'écran.
   */
  const vues = vuesProfilOnboarding(supabaseProfile.onboardingProfile ?? null);

  function handleReset() {
    if (window.confirm("Réinitialiser le profil de test ? Toutes les modifications locales seront perdues.")) {
      mockProfile.resetProfile();
    }
  }

  if (!supabaseProfile.ready) {
    return <Loader libelle="Chargement du profil…" variante="ligne" />;
  }

  /* ══════════════════════════════════════════════════════════════════
   * SUPABASE CONFIGURÉ, MAIS RIEN N'EST ARRIVÉ
   * ══════════════════════════════════════════════════════════════════
   * `useSupabase === false` couvrait quatre situations, dont la panne
   * réseau. En avion, l'élève voyait donc le profil de démonstration —
   * un autre prénom, d'autres mensurations, d'autres photos — avec des
   * boutons d'édition qui écrivaient dans le localStorage du mock.
   *
   * Ce chemin manquait au garde-fou MOCK1 : l'import de `data/student`
   * est dans la PAGE, l'appel des hooks dans CE composant. Le contrôle
   * a été élargi en conséquence.
   *
   * ── LA GARDE `!useSupabase` N'EST PAS DÉCORATIVE ────────────────────
   * `useEtatOfflineEleve` n'est INTERROGÉ que si `!useSupabase` (ligne du
   * dessus) ; son effet sort à sa première ligne autrement, et son état
   * reste `"chargement"` POUR TOUJOURS. Sans cette garde, un profil
   * Supabase parfaitement chargé tombait donc dans la branche d'attente
   * ci-dessous et `/profil` ne s'affichait jamais — constaté sur iPhone
   * le 10/08/2026, Safari comme PWA. Ces deux branches ne concernent que
   * l'élève dont le profil n'est PAS arrivé ; `DashboardContent` porte la
   * même garde depuis toujours. Voir `scripts/tests/profil-push-render.mts`. */
  if (!useSupabase) {
    if (local.etat === "chargement") {
      return <Loader libelle="Chargement du profil…" variante="ligne" />;
    }

    if (local.etat !== "mock") {
      return (
        <SectionIndisponible
          zone="/profil"
          titre="Profil"
          etat={local.etat}
          messageOffline="Ton profil demande une connexion : il n'est pas conservé sur cet appareil. Ta séance du jour, elle, reste disponible."
          lignes={{ auth: local.identite ? "oui" : "non" }}
        />
      );
    }
  }

  if (isProgramOnly) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Profil
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {profile.firstName} {profile.lastName}
          </p>
        </div>

        <div className="mb-6">
          <ProfileSection title="Informations personnelles">
            <InfoRow label="Prénom" value={profile.firstName} />
            <InfoRow label="Nom" value={profile.lastName} />
            <InfoRow label="Email" value={supabaseProfile.email} />
          </ProfileSection>
        </div>

        <div className="mb-6">
          <ChangePasswordSection />
        </div>

        <NewsletterPreferenceToggle />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Profil
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {profile.firstName} {profile.lastName} · Élève depuis le{" "}
            {new Date(profile.startDate).toLocaleDateString("fr-FR")}
          </p>
          {!useSupabase && (
            <button
              type="button"
              onClick={handleReset}
              className="mt-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
            >
              <RotateCcw size={12} />
              Réinitialiser le profil de test
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {useSupabase && <StudentOnboardingDetailModal student={profile} />}
          <EditPersonalInfoModal profile={profile} onSave={updateProfile} />
        </div>
      </div>

      <CoachingSummaryCard profile={profile} />

      {useSupabase && (
        <div className="mb-6">
          <ProfileSection title="Mon abonnement">
            <SubscriptionSection />
          </ProfileSection>
        </div>
      )}

      <ProgressPhotoGallerySection
        studentId={studentId}
        photos={photos}
        defaultWeightKg={profile.currentWeightKg}
        onAdd={addPhoto}
        onDelete={removePhoto}
      />

      <div className="mb-6">
        <WeightEvolutionCard
          profile={profile}
          history={weightHistory}
          onUpdateWeight={updateWeight}
          onUpdateTarget={(targetWeightKg) => updateProfile({ targetWeightKg })}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProfileSection title="Informations personnelles">
          <InfoRow label="Prénom" value={profile.firstName} />
          <InfoRow label="Nom" value={profile.lastName} />
          <InfoRow label="Âge" value={`${profile.age} ans`} />
          <InfoRow label="Taille" value={`${profile.heightCm} cm`} />
          <InfoRow label="Poids actuel" value={`${profile.currentWeightKg} kg`} />
          <InfoRow label="Objectif principal" value={profile.goal} />
          <InfoRow label="Niveau sportif" value={profile.level} />
          <InfoRow
            label="Début du coaching"
            value={new Date(profile.startDate).toLocaleDateString("fr-FR")}
          />
          <InfoRow
            label="Fréquence d'entraînement"
            value={`${profile.trainingFrequencyPerWeek}x / semaine`}
          />
          <InfoRow label="Salle ou domicile" value={profile.trainingLocation} />
        </ProfileSection>

        <MeasurementsSection
          measurements={measurements}
          customMeasurements={customMeasurements}
          measurementHistory={measurementHistory}
          onSave={updateMeasurements}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          LES QUATRE BLOCS DU PROFIL — DEUX SOURCES, JAMAIS DE MÉLANGE (P8)
          ══════════════════════════════════════════════════════════════════
          Jusqu'au 05/10/2026, ces quatre sections n'existaient QUE dans la
          branche de démonstration : un élève Supabase n'en voyait aucune, et
          ses réponses — que le coach lit tous les jours — ne lui étaient
          rendues que derrière « Voir mes informations complètes ».

          ⚠️ AUCUN REPLI D'UNE SOURCE SUR L'AUTRE. Sous Supabase, une fiche
          absente ou vide se DIT (`ficheDisponible`, tirets) ; elle ne fait
          jamais apparaître `data/student.ts`. C'est tout l'objet du lot.

          ⚠️ RIEN N'EST RENDU PENDANT LE CHARGEMENT : la sortie anticipée
          `!supabaseProfile.ready` plus haut précède ce bloc. */}
      {useSupabase ? (
        <>
          {!vues.ficheDisponible && (
            <div className="mb-6 rounded-card border border-dashed border-border bg-surface-soft/40 p-6">
              <p className="text-sm text-muted-foreground">
                Ton questionnaire n&apos;est pas encore enregistr&eacute;. Compl&egrave;te-le depuis
                &laquo;&nbsp;Voir mes informations compl&egrave;tes&nbsp;&raquo; pour que ton coach
                en tienne compte.
              </p>
            </div>
          )}

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ProfileSection title="Préférences alimentaires">
              <div className="flex flex-col gap-4">
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Aliments aimés
                  </span>
                  <TagList items={[...vues.alimentaire.alimentsAimes]} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Aliments à éviter
                  </span>
                  <TagList items={[...vues.alimentaire.alimentsEvites]} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Allergies
                  </span>
                  <TagList items={[...vues.alimentaire.allergies]} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Intolérances
                  </span>
                  <TagList items={[...vues.alimentaire.intolerances]} />
                </div>
                <InfoRow label="Régime alimentaire" value={vues.alimentaire.regime} />
                <InfoRow label="Repas par jour" value={vues.alimentaire.repasParJour} />
                <InfoRow label="Horaires habituels" value={vues.alimentaire.horairesDeRepas} />
                <InfoRow
                  label="Contraintes sociales / pro"
                  value={vues.alimentaire.contraintesTravailOuSociales}
                />
                <InfoRow label="Notes nutrition" value={vues.alimentaire.notes} />
              </div>
            </ProfileSection>

            <ProfileSection title="Préférences sportives">
              <div className="flex flex-col gap-4">
                <InfoRow label="Objectif sportif" value={vues.objectifs.objectifPrincipal} />
                <InfoRow label="Niveau sportif" value={profile.level} />
                <InfoRow label="Niveau d'activité / NEAT" value={vues.sportive.niveauActivite} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Sports pratiqués
                  </span>
                  <TagList items={[...vues.sportive.sportsPratiques]} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Autres activités
                  </span>
                  <TagList items={[...vues.sportive.autresActivites]} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Matériel disponible
                  </span>
                  <TagList items={[...vues.sportive.materielDisponible]} />
                </div>
                <InfoRow label="Lieu d'entraînement" value={vues.sportive.lieuDEntrainement} />
                <InfoRow label="Séances par semaine" value={vues.sportive.seancesParSemaine} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Exercices préférés (salle)
                  </span>
                  <TagList items={[...vues.sportive.exercicesPreferesEnSalle]} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Exercices préférés
                  </span>
                  <TagList items={[...vues.sportive.exercicesPreferes]} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Exercices à éviter
                  </span>
                  <TagList items={[...vues.sportive.exercicesAEviter]} />
                </div>
              </div>
            </ProfileSection>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ProfileSection title="Blessures et contraintes">
              <div className="flex flex-col gap-4">
                {/* ⚠️ UN SEUL CHAMP DE BLESSURES, parce que la base n'en a
                    qu'un (`student_profiles.injuries`). Les quatre listes du
                    type de démonstration — anciennes blessures, douleurs
                    récurrentes, mouvements à éviter, remarques du coach — n'ont
                    AUCUNE colonne : les afficher ici reviendrait à inventer. */}
                <InfoRow label="Douleurs / blessures" value={vues.blessures.douleursEtBlessures} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Exercices à éviter
                  </span>
                  <TagList items={[...vues.blessures.exercicesAEviter]} />
                </div>
                <InfoRow label="Notes santé" value={vues.blessures.notesSante} />
                <InfoRow label="Traitements" value={vues.blessures.traitements} />
                <InfoRow label="Médicaments" value={vues.blessures.medicaments} />
                <InfoRow label="Notes pour le coach" value={vues.blessures.notesPourLeCoach} />
              </div>
            </ProfileSection>

            <ProfileSection title="Objectifs">
              <div className="flex flex-col gap-4">
                {/* ⚠️ AUCUNE « PRIORITÉ ACTUELLE ». `student_profiles.priority`
                    est `null` sur les 32 profils de production et n'est écrit
                    nulle part ; l'afficher indexerait une table de libellés
                    avec `null` et rendrait `undefined`. */}
                <InfoRow label="Objectif principal" value={vues.objectifs.objectifPrincipal} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Objectifs secondaires
                  </span>
                  <TagList items={[...vues.objectifs.objectifsSecondaires]} />
                </div>
                <InfoRow label="Date cible" value={vues.objectifs.dateCible} />
                <InfoRow label="Délai souhaité" value={vues.objectifs.delaiSouhaite} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Indicateurs suivis
                  </span>
                  <TagList items={[...vues.objectifs.indicateursSuivis]} />
                </div>
              </div>
            </ProfileSection>
          </div>
        </>
      ) : (
        /* ── DÉMONSTRATION ────────────────────────────────────────────────
           Inchangé : mêmes fixtures, mêmes composants, même rendu qu'avant
           ce lot. On ajoute une branche, on n'en retire aucune. */
        <>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ProfileSection title="Préférences alimentaires">
              <div className="flex flex-col gap-4">
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Aliments aimés
                  </span>
                  <TagList items={demonstration.foodPreferences.liked} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Aliments non aimés
                  </span>
                  <TagList items={demonstration.foodPreferences.disliked} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Intolérances
                  </span>
                  <TagList items={demonstration.foodPreferences.intolerances} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Allergies
                  </span>
                  <TagList items={demonstration.foodPreferences.allergies} />
                </div>
                <InfoRow label="Régime alimentaire" value={demonstration.foodPreferences.diet} />
                <InfoRow
                  label="Repas par jour"
                  value={`${demonstration.foodPreferences.mealsPerDay}`}
                />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Horaires habituels
                  </span>
                  <TagList items={demonstration.foodPreferences.mealTimes} />
                </div>
                <InfoRow
                  label="Contraintes sociales / pro"
                  value={demonstration.foodPreferences.socialConstraints}
                />
              </div>
            </ProfileSection>

            <ProfileSection title="Préférences sportives">
              <div className="flex flex-col gap-4">
                <InfoRow label="Objectif sportif" value={demonstration.sportPreferences.mainGoal} />
                <InfoRow label="Niveau sportif" value={profile.level} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Sports pratiqués
                  </span>
                  <TagList items={demonstration.sportPreferences.sports} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Matériel disponible
                  </span>
                  <TagList items={demonstration.sportPreferences.equipment} />
                </div>
                <InfoRow
                  label="Lieu d'entraînement"
                  value={demonstration.sportPreferences.location}
                />
                <InfoRow
                  label="Séances par semaine"
                  value={`${demonstration.sportPreferences.sessionsPerWeek}`}
                />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Exercices préférés
                  </span>
                  <TagList items={demonstration.sportPreferences.preferredExercises} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Exercices à éviter
                  </span>
                  <TagList items={demonstration.sportPreferences.exercisesToAvoid} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Disponibilité hebdomadaire
                  </span>
                  <TagList items={demonstration.sportPreferences.weeklyAvailability} />
                </div>
              </div>
            </ProfileSection>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <InjurySection injury={demonstration.injuryNote} />
            <GoalsSection goal={demonstration.studentGoal} />
          </div>
        </>
      )}
    {/* Chantier PWA : ne s'affiche pas du tout quand l'espace est déjà
        ouvert depuis l'écran d'accueil. */}
    <div className="mb-6">
      <NotificationsSection />
    </div>
    <div className="mb-6">
      <InstallAppSection />
    </div>
    <NewsletterPreferenceToggle />
    </div>
  );
}
