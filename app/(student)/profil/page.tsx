import {
  InfoRow,
  ProfileSection,
  TagList,
} from "@/components/student/ProfileSection";
import { ProgressPhotos } from "@/components/student/ProgressPhotos";
import {
  bodyMeasurements,
  foodPreferences,
  sportPreferences,
  student,
} from "@/data/student";

export default function ProfilPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Profil
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {student.firstName} {student.lastName} · Élève depuis le{" "}
          {new Date(student.startDate).toLocaleDateString("fr-FR")}
        </p>
      </div>

      <div className="mb-6 border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Photos de progression
        </h2>
        <ProgressPhotos />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
        </ProfileSection>

        <ProfileSection title="Mensurations">
          <InfoRow label="Tour de taille" value={`${bodyMeasurements.waist} cm`} />
          <InfoRow label="Tour de hanches" value={`${bodyMeasurements.hips} cm`} />
          <InfoRow
            label="Tour de poitrine"
            value={`${bodyMeasurements.chest} cm`}
          />
          <InfoRow label="Tour de bras" value={`${bodyMeasurements.arm} cm`} />
          <InfoRow label="Tour de cuisse" value={`${bodyMeasurements.thigh} cm`} />
          <InfoRow label="Tour de mollet" value={`${bodyMeasurements.calf} cm`} />
        </ProfileSection>

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
            <InfoRow label="Régime alimentaire" value={foodPreferences.diet} />
            <InfoRow
              label="Repas par jour"
              value={`${foodPreferences.mealsPerDay}`}
            />
          </div>
        </ProfileSection>

        <ProfileSection title="Préférences sportives">
          <div className="flex flex-col gap-4">
            <InfoRow label="Objectif sportif" value={sportPreferences.mainGoal} />
            <div>
              <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Sports pratiqués
              </span>
              <TagList items={sportPreferences.sports} />
            </div>
            <InfoRow
              label="Blessures / contraintes"
              value={sportPreferences.injuries}
            />
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
          </div>
        </ProfileSection>
      </div>
    </div>
  );
}
