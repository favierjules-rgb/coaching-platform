import { CoachingSummaryCard } from "@/components/student/CoachingSummaryCard";
import { GoalsSection } from "@/components/student/GoalsSection";
import { InjurySection } from "@/components/student/InjurySection";
import { MeasurementsSection } from "@/components/student/MeasurementsSection";
import { MockActionModal, MockField } from "@/components/student/MockActionModal";
import { InfoRow, ProfileSection, TagList } from "@/components/student/ProfileSection";
import { ProgressPhotoGallerySection } from "@/components/student/ProgressPhotoGallerySection";
import { WeightEvolutionCard } from "@/components/student/WeightEvolutionCard";
import {
  bodyMeasurements,
  customMeasurements,
  foodPreferences,
  injuryNote,
  progressPhotos,
  sportPreferences,
  student,
  studentGoal,
  weightHistory,
} from "@/data/student";

export default function ProfilPage() {
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Profil
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {student.firstName} {student.lastName} · Élève depuis le{" "}
            {new Date(student.startDate).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <MockActionModal
          triggerLabel="Modifier mes informations"
          title="Modifier mes informations"
          description="Mets à jour tes informations personnelles. Cette action est une démonstration : aucune donnée n'est encore enregistrée."
          confirmLabel="Enregistrer les modifications"
          successMessage="Informations mises à jour. Ton coach en sera informé."
          triggerVariant="primary"
        >
          <MockField label="Prénom" placeholder={student.firstName} />
          <MockField label="Nom" placeholder={student.lastName} />
          <MockField label="Objectif principal" placeholder={student.goal} />
        </MockActionModal>
      </div>

      <CoachingSummaryCard profile={student} />

      <ProgressPhotoGallerySection
        studentId={student.id}
        initialPhotos={progressPhotos}
        defaultWeightKg={student.currentWeightKg}
      />

      <div className="mb-6">
        <WeightEvolutionCard profile={student} history={weightHistory} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProfileSection title="Informations personnelles">
          <InfoRow label="Prénom" value={student.firstName} />
          <InfoRow label="Nom" value={student.lastName} />
          <InfoRow label="Âge" value={`${student.age} ans`} />
          <InfoRow label="Taille" value={`${student.heightCm} cm`} />
          <InfoRow label="Poids actuel" value={`${student.currentWeightKg} kg`} />
          <InfoRow label="Objectif principal" value={student.goal} />
          <InfoRow label="Niveau sportif" value={student.level} />
          <InfoRow
            label="Début du coaching"
            value={new Date(student.startDate).toLocaleDateString("fr-FR")}
          />
          <InfoRow
            label="Fréquence d'entraînement"
            value={`${student.trainingFrequencyPerWeek}x / semaine`}
          />
          <InfoRow label="Salle ou domicile" value={student.trainingLocation} />
        </ProfileSection>

        <MeasurementsSection
          studentId={student.id}
          initialMeasurements={bodyMeasurements}
          initialCustomMeasurements={customMeasurements}
        />
      </div>

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
            <InfoRow label="Niveau sportif" value={student.level} />
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
    </div>
  );
}
