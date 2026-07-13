"use client";

import { RotateCcw } from "lucide-react";

import { CoachingSummaryCard } from "@/components/student/CoachingSummaryCard";
import { EditPersonalInfoModal } from "@/components/student/EditPersonalInfoModal";
import { GoalsSection } from "@/components/student/GoalsSection";
import { InjurySection } from "@/components/student/InjurySection";
import { MeasurementsSection } from "@/components/student/MeasurementsSection";
import { InfoRow, ProfileSection, TagList } from "@/components/student/ProfileSection";
import { NewsletterPreferenceToggle } from "@/components/student/NewsletterPreferenceToggle";
import { ProgressPhotoGallerySection } from "@/components/student/ProgressPhotoGallerySection";
import { StudentOnboardingDetailModal } from "@/components/student/StudentOnboardingDetailModal";
import { SubscriptionSection } from "@/components/student/SubscriptionSection";
import { WeightEvolutionCard } from "@/components/student/WeightEvolutionCard";
import { useStudentProfile, type StudentProfileState } from "@/hooks/useStudentProfile";
import { useSupabaseStudentProfile } from "@/hooks/useSupabaseStudentProfile";
import type { FoodPreferences, InjuryNote, SportPreferences, StudentGoal } from "@/types";

interface ProfilPageContentProps {
  studentId: string;
  seed: StudentProfileState;
  foodPreferences: FoodPreferences;
  sportPreferences: SportPreferences;
  injuryNote: InjuryNote;
  studentGoal: StudentGoal;
}

/**
 * Composant client unique qui monte useStudentProfile et distribue le même
 * état (profil, historique de poids, mensurations, photos) à toutes les
 * sections de /profil, pour qu'une mise à jour (poids, objectif, infos,
 * mensurations, photo) soit immédiatement visible partout sur la page et
 * persiste après rechargement (localStorage).
 */
export function ProfilPageContent({
  studentId,
  seed,
  foodPreferences,
  sportPreferences,
  injuryNote,
  studentGoal,
}: ProfilPageContentProps) {
  // Toujours montés tous les deux (règle des hooks) : useSupabaseStudentProfile
  // vérifie si l'utilisateur connecté a une vraie fiche élève Supabase, et
  // seul le résultat correspondant est réellement utilisé plus bas. Tant
  // que Supabase n'est pas configuré, n'a pas de fiche élève pour ce compte,
  // ou que la vérification est en cours, on continue avec le mock/localStorage
  // existant — comportement inchangé.
  const mockProfile = useStudentProfile(studentId, seed);
  const supabaseProfile = useSupabaseStudentProfile();
  const useSupabase = supabaseProfile.ready && supabaseProfile.state !== null;

  const state = useSupabase ? supabaseProfile.state! : mockProfile.state;
  const updateProfile = useSupabase ? supabaseProfile.updateProfile : mockProfile.updateProfile;
  const updateWeight = useSupabase ? supabaseProfile.updateWeight : mockProfile.updateWeight;
  const updateMeasurements = useSupabase ? supabaseProfile.updateMeasurements : mockProfile.updateMeasurements;
  const addPhoto = useSupabase ? supabaseProfile.addPhoto : mockProfile.addPhoto;
  const removePhoto = useSupabase ? supabaseProfile.removePhoto : mockProfile.removePhoto;
  const { profile, weightHistory, measurements, customMeasurements, measurementHistory, photos } = state;

  function handleReset() {
    if (window.confirm("Réinitialiser le profil de test ? Toutes les modifications locales seront perdues.")) {
      mockProfile.resetProfile();
    }
  }

  if (!supabaseProfile.ready) {
    return <p className="text-sm text-muted-foreground">Chargement du profil…</p>;
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

      {/* Ces 4 sections viennent de data/student.ts (données d'exemple statiques,
          jamais de Supabase) — voir app/(student)/profil/page.tsx. Pour un
          élève Supabase, ces mêmes informations (et bien plus) sont déjà
          disponibles via "Voir mes informations complètes" ci-dessus ; les
          afficher ici aussi les ferait passer pour de vraies réponses. */}
      {!useSupabase && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ProfileSection title="Préférences alimentaires">
              <div className="flex flex-col gap-4">
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Aliments aimés
                  </span>
                  <TagList items={foodPreferences.liked} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Aliments non aimés
                  </span>
                  <TagList items={foodPreferences.disliked} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Intolérances
                  </span>
                  <TagList items={foodPreferences.intolerances} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Allergies
                  </span>
                  <TagList items={foodPreferences.allergies} />
                </div>
                <InfoRow label="Régime alimentaire" value={foodPreferences.diet} />
                <InfoRow
                  label="Repas par jour"
                  value={`${foodPreferences.mealsPerDay}`}
                />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Horaires habituels
                  </span>
                  <TagList items={foodPreferences.mealTimes} />
                </div>
                <InfoRow
                  label="Contraintes sociales / pro"
                  value={foodPreferences.socialConstraints}
                />
              </div>
            </ProfileSection>

            <ProfileSection title="Préférences sportives">
              <div className="flex flex-col gap-4">
                <InfoRow label="Objectif sportif" value={sportPreferences.mainGoal} />
                <InfoRow label="Niveau sportif" value={profile.level} />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Sports pratiqués
                  </span>
                  <TagList items={sportPreferences.sports} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Matériel disponible
                  </span>
                  <TagList items={sportPreferences.equipment} />
                </div>
                <InfoRow label="Lieu d'entraînement" value={sportPreferences.location} />
                <InfoRow
                  label="Séances par semaine"
                  value={`${sportPreferences.sessionsPerWeek}`}
                />
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Exercices préférés
                  </span>
                  <TagList items={sportPreferences.preferredExercises} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Exercices à éviter
                  </span>
                  <TagList items={sportPreferences.exercisesToAvoid} />
                </div>
                <div>
                  <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Disponibilité hebdomadaire
                  </span>
                  <TagList items={sportPreferences.weeklyAvailability} />
                </div>
              </div>
            </ProfileSection>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <InjurySection injury={injuryNote} />
            <GoalsSection goal={studentGoal} />
          </div>
        </>
      )}
    <NewsletterPreferenceToggle />
    </div>
  );
}
