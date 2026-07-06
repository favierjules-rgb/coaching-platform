# Modèle Supabase élève : `students` vs `student_profiles`

Ce document fixe la répartition des colonnes entre les deux tables qui
décrivent un élève côté Supabase, pour que toute future migration (poids,
mensurations, programmes...) sache où lire/écrire sans ambiguïté.

## Décision

- **`students`** = identité principale + statut de suivi. Ce qui identifie
  la personne et où elle en est dans son coaching, indépendamment du
  contenu de ce coaching.
- **`student_profiles`** = détails coaching : mensurations de référence,
  niveau, objectif, fréquence, lieu d'entraînement, préférences,
  contraintes. Ce qui décrit le contenu du coaching, une ligne par élève.

## Audit — état avant cette étape

Avant cette étape, `students` portait à la fois l'identité **et** la
plupart des détails coaching (mensurations, objectif, niveau, fréquence,
lieu), tandis que `student_profiles` ne portait que les préférences/
contraintes/objectifs détaillés. Cette répartition n'était pas cohérente
avec la distinction "identité vs contenu du coaching" et rendait
`student_profiles` presque inutile en pratique.

### Colonnes `students` (avant)

| Colonne | Utilisée par le code ? |
| --- | --- |
| `id`, `user_id`, `coach_id` | Oui — identité, relation auth/coach |
| `first_name`, `last_name`, `email`, `phone` | Oui — identité |
| `age`, `height_cm` | Oui, mais détail coaching mal placé |
| `current_weight_kg`, `start_weight_kg`, `target_weight_kg` | Oui, mais détail coaching mal placé |
| `goal`, `level` | Oui, mais détail coaching mal placé |
| `training_frequency_per_week`, `training_location` | Oui, mais détail coaching mal placé |
| `status`, `start_date`, `last_login_at` | Oui — statut de suivi |
| `created_at`, `updated_at` | Oui |

### Colonnes `student_profiles` (avant et après — inchangées)

| Colonne | Utilisée par le code ? |
| --- | --- |
| `food_preferences`, `sport_preferences` | Oui — `AdminStudent.foodPreferences` / `sportPreferences` |
| `injury_note` | Oui — `AdminStudent.injuries` |
| `main_goal`, `secondary_goals`, `target_date`, `priority`, `tracked_indicators` | **Non** — lues par `lib/supabase/students.ts` (`mapStudentProfileRow`) mais jamais transmises à `AdminStudent` ; elles correspondent au type mock `StudentGoal` (section "Objectifs" de `/profil`), qui reste alimenté par des données statiques (`data/student.ts`) et n'est pas encore migré. Conservées telles quelles pour ne rien perdre, à brancher lors d'une future migration des objectifs. |

Ce dernier point (5 colonnes chargées mais jamais utilisées) a été vérifié
par lecture directe de `lib/supabase/students.ts` avant cette étape : la
fonction `toAdminStudent()` ne recevait que `foodPreferences`,
`sportPreferences` et `injuries` dans ses `extras`, jamais les 5 autres
champs. Aucune fonction d'écriture ne touchait `student_profiles` non plus
— toutes les écritures (`updateStudentFields`) ciblaient uniquement
`students`.

## Répartition finale

### `students`

```
id, user_id, coach_id
first_name, last_name, email, phone
status, start_date, last_login_at
created_at, updated_at
```

### `student_profiles`

```
id, student_id
age, height_cm
current_weight_kg, start_weight_kg, target_weight_kg
goal, level, training_frequency_per_week, training_location
food_preferences, sport_preferences, injury_note
main_goal, secondary_goals, target_date, priority, tracked_indicators
created_at, updated_at
```

`goal` (court, utilisé pour les badges/filtres élève, ex. "Perte de
poids") et `main_goal` (plus détaillé, utilisé par la section "Objectifs"
de `/profil` via le type mock `StudentGoal`) sont deux champs distincts en
mock (`AdminStudent.goal` vs `StudentGoal.mainGoal`) : ce n'est pas une
redondance, les deux sont conservés séparément sur `student_profiles`.

## Code impacté

- `types/supabase.ts` : `students` perd les 9 colonnes coaching, `student_profiles` les gagne.
- `types/index.ts` : `SupabaseStudent` perd les mêmes champs (camelCase), `SupabaseStudentProfile` les gagne.
- `lib/supabase/students.ts` :
  - `mapStudentRow` / `mapStudentProfileRow` — déplacés en miroir des tables.
  - `toAdminStudent(student, profile, extras)` — signature changée pour recevoir explicitement le `profile` (peut être `null` si l'élève n'a pas encore de fiche `student_profiles`) ; les champs coaching retombent sur des valeurs par défaut (`0`, `""`) plutôt que `undefined`/`NaN`.
  - `getStudents()` — charge désormais `student_profiles` en lot (comme `payments`) pour construire la liste `/admin/eleves`.
  - `getFullAdminStudent()` — inchangé dans sa forme, transmet simplement `profile` à `toAdminStudent`.
  - `updateStudentFields()` — un seul point d'entrée public (`Partial<AdminStudent>`), qui route en interne chaque champ vers `students` (identité/statut) ou `student_profiles` (détails coaching, upsert par `student_id`). Aucun changement côté appelants (`EditStudentModal`, `useSupabaseStudentDetail`, `useSupabaseStudentProfile`, `hooks/useSupabaseStudentProfile.ts`).

Aucun autre fichier n'a eu besoin de changer : `AdminStudent` (le type
mock consommé par les pages/composants) garde exactement la même forme,
seule la façon dont `lib/supabase/students.ts` l'assemble à partir des
deux tables Supabase a changé.

## Migration SQL

Le déplacement de colonnes est fait directement dans `supabase/schema.sql`
(section "4bis"), rejouable sans perte de données :

1. Ajoute les 9 colonnes sur `student_profiles` (`add column if not exists`).
2. Crée une ligne `student_profiles` pour tout élève qui n'en a pas encore, en reprenant les valeurs de `students`.
3. Reporte les valeurs de `students` vers `student_profiles` pour les lignes déjà existantes (sans écraser une valeur déjà renseignée côté profil).
4. Supprime les 9 colonnes de `students` (`drop column if exists`).

Les étapes 2 et 3 sont protégées par un bloc `do $$ ... $$` qui vérifie que
`students.age` existe encore avant de s'exécuter — sans cette protection,
relancer le script une seconde fois (une fois les colonnes déjà
supprimées de `students`) échouerait avec "column does not exist". Le
résultat final est identique qu'on parte d'un projet neuf ou d'un projet
déjà initialisé avec l'ancien schéma : `students` ne porte plus jamais les
colonnes coaching, `student_profiles` les porte toutes avec les données
d'origine préservées.

Pour appliquer cette migration à un projet Supabase déjà créé : recoller
l'intégralité de `supabase/schema.sql` dans l'éditeur SQL Supabase et
l'exécuter (même procédure que d'habitude, voir README.md) — aucune étape
manuelle supplémentaire n'est nécessaire.

## Portée

Cette étape ne touche que la répartition `students` / `student_profiles`.
Elle ne migre pas les programmes, la nutrition, les documents ni les
retours (déjà traités dans des étapes précédentes ou à venir) — voir les
sections dédiées du schéma pour ces tables.
