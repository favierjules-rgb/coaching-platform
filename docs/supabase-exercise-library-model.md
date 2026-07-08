# Bibliothèque d'exercices Supabase

Chantier "supabase-exercise-library" : brancher la banque d'exercices
(`exercise_library`) à l'app, jusqu'ici créée en base mais jamais utilisée
(voir l'ancien commentaire de `lib/supabase/programs.ts`, qui documentait ce
report explicitement) — remplace le mock/localStorage utilisé partout où un
exercice est choisi ou affiché : `/admin/programmes`, création/édition de
programme, exercices d'une séance, élève `/entrainement`, lien vidéo démo,
filtres admin.

## Audit

- **Mock existant** : `data/admin.ts::adminExerciseLibrary` (10 exercices
  rédigés avec vraies consignes techniques), consommé par
  `hooks/useAdminData.ts` (CRUD localStorage), affiché par
  `components/admin/ExerciseLibraryManager.tsx` +
  `ExerciseLibraryItemModal.tsx` dans l'onglet "Banque d'exercices" de
  `/admin/programmes`, et cherché par `components/admin/ExerciseSearchPicker.tsx`
  dans `ProgramBuilder.tsx` pour préremplir un exercice de séance (copie par
  valeur uniquement, aucune FK).
- **Supabase réel** : `exercise_library` existait déjà (colonnes
  `name/category/equipment/level/muscle_group/video_url/notes`, staff-only en
  RLS, jamais lue/écrite par l'app) ; `workout_exercises` existait aussi,
  copié par valeur depuis `ProgramBuilder`, sans colonne de liaison vers
  `exercise_library`.
- **Décision** : aucune table recréée. `exercise_library` et
  `workout_exercises` étendues additivement (colonnes `add column if not
  exists`, contrainte `status` réappliquée via `drop constraint if exists` +
  `add constraint`).

## Modèle de données

`exercise_library` (déjà existante) reçoit :

```sql
description, secondary_muscles jsonb, exercise_type, alternative_video_url,
technical_cues, common_mistakes, default_tempo, default_rest_seconds,
tags jsonb, status ('active' | 'archived', défaut 'active')
```

`muscle_group` (déjà existante) reste la colonne du muscle **principal** —
pas de nouvelle colonne `primary_muscle` créée en doublon. `notes` (déjà
existante) reste une note interne coach, distincte de `technical_cues`
(consignes techniques) et `common_mistakes` (erreurs fréquentes), ajoutées
séparément pour respecter exactement les champs demandés.

`workout_exercises` reçoit une colonne `exercise_library_id uuid` **nullable**,
FK `on delete set null` — jamais renseignée pour les exercices déjà créés
avant ce chantier, qui continuent à s'afficher normalement (aucune valeur
requise).

### Taxonomie musculaire

`primary_muscle`/`secondary_muscles` réutilisent le type `MuscleGroup` déjà
partagé par toute l'analyse de charge (`lib/training-metrics.ts`), auquel
`"avant-bras"` a été ajouté additivement (seule valeur manquante face à la
liste demandée). Ce choix évite de dupliquer une deuxième taxonomie muscle et
garde `cardio`/`full-body`/`autre` disponibles pour les exercices qui ne
correspondent à aucun muscle isolé (ex. corde à sauter → `cardio`).

Catégorie et type d'exercice partagent volontairement la même liste de 9
valeurs (Force/Hypertrophie/Mobilité/Cardio/Gainage/Plyométrie/Échauffement/
Réathlétisation/Technique) : la demande ne fournissait qu'une seule liste
pour les deux champs.

## RLS

```sql
create policy "exercise_library_manage_staff" on public.exercise_library
  for all using (is_coach_or_admin()) with check (is_coach_or_admin());
create policy "exercise_library_select_active" on public.exercise_library
  for select using (status = 'active');
```

Remplace l'ancienne policy "staff only" (qui interdisait toute lecture
élève). Un élève authentifié peut désormais lire les exercices **actifs**
de la banque — lecture générale plutôt que restreinte à ses programmes
assignés, car la banque est un référentiel partagé non spécifique à un
élève (même principe que `document_levels`). Un exercice archivé n'est
**jamais** lisible par un élève, quelle que soit la façon dont il y accède.
`workout_exercises`/`workout_sessions`/`programs` gardent leurs policies
existantes (lecture élève limitée aux programmes assignés) : ce chantier n'y
touche pas.

## Composition

- `lib/supabase/exercise-library.ts` (nouveau) : `getExerciseLibrary`
  (tous les exercices, actifs et archivés — pour l'admin),
  `createExerciseLibraryItem`, `updateExerciseLibraryItem` (édition
  partielle via une map champ → colonne), `setExerciseLibraryStatus`
  (archiver/réactiver — jamais de suppression réelle, pour préserver
  l'historique des programmes qui référencent l'exercice).
- `hooks/useSupabaseExerciseLibrary.ts` (nouveau) : même forme
  `loading/items/refetch` que `useSupabasePrograms`.
- Les lignes sont composées dans le même type `ExerciseLibraryItem` déjà
  utilisé par tout l'admin (étendu additivement avec les nouveaux champs),
  donc `ExerciseLibraryManager`/`ExerciseSearchPicker`/`ProgramBuilder`
  n'ont besoin d'aucun changement structurel, seulement d'un branchement de
  leurs handlers vers Supabase quand configuré.

### Priorité Supabase / mock

Même principe que les autres chantiers : `exerciseLibrary =
supabaseExerciseLibrary.items.length > 0 ? supabaseExerciseLibrary.items :
state.exerciseLibrary` — jamais de mélange, et toute création passe par
Supabase dès que le client est configuré (sinon repli mock).

## Connexion avec les programmes

`ProgramBuilder.tsx::exerciseFromLibrary` copie par valeur les champs de
l'exercice choisi (nom, vidéo — `video_url` sinon `alternative_video_url` en
repli —, groupe musculaire, tempo/repos par défaut si renseignés) **et**
renseigne `libraryExerciseId` sur l'`AdminExercise` créé, persistée dans
`workout_exercises.exercise_library_id` par `lib/supabase/programs.ts`. Les
paramètres du programme (séries, reps, repos, tempo, charge conseillée)
restent modifiables librement pour cette séance précise sans jamais être
réécrits par une future modification de l'exercice source dans la banque —
c'est le sens même de la copie par valeur : seule la référence est gardée,
jamais une lecture live. Un exercice archivé n'apparaît plus dans les
résultats d'`ExerciseSearchPicker` (filtré côté composant), mais reste lisible
pour tout programme qui le référence déjà.

`ExerciseSearchPicker` ajoute des filtres muscle/matériel en plus de la
recherche texte, et affiche une icône vidéo quand une démo est disponible.

## Élève `/entrainement`

Aucun changement nécessaire à `ExerciseFeedbackCard.tsx` ni au type `Exercise`
élève : la vidéo affichée (`exercise.videoUrl`) est déjà le résultat de la
copie par valeur faite à l'ajout dans `ProgramBuilder` (avec repli sur la
vidéo alternative si la principale est vide), donc le bouton "Voir la démo"
déjà correctement masqué/désactivé quand aucune vidéo n'existe (voir PR #17)
fonctionne sans modification pour les exercices liés à la banque. Tous les
retours élève déjà fonctionnels (charge, reps, RPE, commentaire, tonnage,
volume, séries réalisées) sont inchangés.

## Données initiales

La migration reprend les 10 exercices déjà rédigés dans
`data/admin.ts::adminExerciseLibrary` (consignes techniques réelles) plutôt
que la liste arbitraire de 12 exercices proposée en repli — seed exécutée
uniquement si `exercise_library` est vide côté base, donc idempotente et sans
doublon en cas de rejeu.

## Pages modifiées

- `/admin/exercices` (nouveau) : vue complète de la banque avec filtres
  muscle/catégorie/matériel/niveau/statut, création, édition, archivage
  (jamais de suppression réelle), lien "Voir la démo".
- `/admin/programmes` (onglet "Banque d'exercices") : mêmes handlers
  Supabase que `/admin/exercices`, aucune UI dupliquée.
- `/admin/programmes/nouveau` et `/admin/programmes/[programId]` :
  `ProgramBuilder` reçoit désormais la banque réelle (active + archivée,
  filtrage des archivés délégué à `ExerciseSearchPicker`).
- Lien "Exercices" ajouté à `AdminSidebar`.

## Limites

- **Vérification live non effectuée** : connecteur Supabase MCP indisponible
  pendant cette session (comme pour les PR #20 et #21) — migration non
  rejouée, aucune lecture/écriture réelle testée contre `exercise_library`/
  `workout_exercises`. `npm run lint`, `npx tsc --noEmit` et `npm run build`
  sont passés sans erreur ; le flux de bout en bout (création → édition →
  archivage → ajout à un programme → affichage élève) a été relu ligne à
  ligne contre les 22 tests demandés, sans pouvoir les exécuter contre une
  base réelle.
- **Pas d'upload vidéo** — hors scope explicite de ce chantier, uniquement
  des liens externes (`video_url`/`alternative_video_url`), comme demandé.
- **Lecture élève générale plutôt que restreinte aux programmes assignés**
  (voir RLS ci-dessus) — choix délibéré parmi les deux options proposées,
  documenté explicitement.
