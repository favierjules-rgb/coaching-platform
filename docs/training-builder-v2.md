# Training Builder V2

Chantier `training-builder-v2` : étend le module Entraînement existant (programmes/semaines/séances/exercices) avec des blocs (superset, circuit, EMOM...), des prescriptions par série, une vraie distinction individuel/groupe/durée fixe, un workflow brouillon/publication avec historique, et une interface élève consciente des blocs — inspiré fonctionnellement de Strivee, avec l'identité visuelle SETH Préparation Physique.

Aucun autre module (nutrition, documents, rendez-vous, Stripe/abonnements, Resend, Brevo, landing page, accès conditionnel général) n'a été modifié.

## 1. Architecture avant ce chantier

- `programs` → `program_weeks` → `workout_sessions` → `workout_exercises`, une table plate par niveau, aucun concept de bloc.
- Assignation via `assignments` (content_type = 'programme') : plusieurs élèves pouvaient pointer vers le **même** `program_id` — comportement "groupe" par construction, jamais de véritable individualisation.
- `updateProgram` faisait un **delete + reinsert complet** de toute la structure à chaque sauvegarde : les id de séances/exercices changeaient à chaque édition, cassant le lien vers `workout_feedback`/`exercise_feedback` déjà soumis par l'élève (retrouvés par `session_key` = l'ancien `workout_sessions.id`).
- La RLS élève sur `programs` ne filtrait sur **aucun statut** : un programme "brouillon" assigné était déjà visible par l'élève.
- Séparation prescrit/réalisé déjà partiellement en place : `workout_exercises` (prescrit, mode simple uniquement) vs `exercise_feedback`/`exercise_set_feedback` (réalisé, texte libre).
- `lib/training-metrics.ts` : calcul séries/volume/tonnage par parsing regex de champs texte libres (`reps: "8-10"`, `recommendedLoad: "70 kg"`), doublement automatique uniquement pour `kg_per_dumbbell`, crédit plein (pas de pondération primaire/secondaire) à chaque groupe musculaire matché.

## 2. Architecture V2

```
programs (étendue)
 └─ program_weeks
     └─ workout_sessions
         └─ training_blocks (nouveau)
             └─ workout_exercises (étendue : block_id, superset_label)
                 └─ training_prescriptions (nouveau, mode détaillé optionnel)
training_change_history (nouveau, historique)
```

`programs.program_type` : `individual` / `group` / `fixed_duration`.
`programs.publication_status` : `draft` / `published` / `archived` — nouvelle frontière de sécurité, distincte de `status` (`brouillon`/`actif`/`archivé`, purement organisationnel côté admin, inchangé).

## 3. Compatibilité legacy — adaptateur de lecture

Aucune donnée existante n'est migrée de force. `lib/supabase/programs.ts::buildBlocksForSession` regroupe tout `workout_exercises` avec `block_id IS NULL` en un bloc `standard` **synthétisé à la lecture** (`isSynthesizedStandard: true`, id `standard-<sessionId>`), jamais écrit en base. Un ancien programme reste donc lisible et affichable sans qu'aucune ligne existante ne soit touchée.

`publication_status` est ajoutée avec `default 'published'` sur toutes les lignes existantes : c'est la seule valeur qui ne change rien à ce qu'un élève voyait déjà (la RLS ne filtrait sur aucun statut avant ce chantier).

`programs.program_type` est ajoutée avec `default 'group'` (pas `'individual'`) : c'est le comportement réel des programmes déjà attribués (structure partagée via `assignments`).

## 4. Correction du delete+reinsert

`lib/supabase/programs.ts::upsertProgramStructure` (et les fonctions qu'elle appelle : `upsertSessionsForWeek`, `upsertBlocksForSession`, `upsertExercisesForBlock`) diffe désormais la structure à chaque sauvegarde :

- Une ligne dont l'id envoyé par le client est un **uuid déjà présent en base** est mise à jour en place — son id ne change jamais.
- Une ligne dont l'id est un id généré côté client (`lib/admin.ts::generateId`, jamais un uuid — détecté via `isPersistedId()`) est insérée comme nouvelle ligne.
- Une ligne présente en base mais absente des données envoyées est supprimée (suppression volontaire du coach, jamais un effet de bord).
- `training_prescriptions` fait exception : aucune table ne référence son id, un remplacement complet par exercice à chaque sauvegarde (`replacePrescriptionsForExercise`) est donc sûr et plus simple qu'un diff fin.

Conséquence directe : `workout_feedback.session_key` reste valide après une ré-édition du programme via le builder — le retour élève déjà soumis n'est plus orphelin.

L'ancien `ProgramBuilder.tsx` (mode "liste plate", sans éditeur de blocs actif) enveloppe automatiquement les exercices d'une séance dans un unique bloc `standard` réel côté écriture (réutilisé s'il existe déjà, jamais recréé à chaque save) — aucune régression fonctionnelle pour un coach qui n'utilise jamais l'éditeur de blocs.

## 5. Types de programmation

| Type | Comportement |
|---|---|
| `individual` | `assignIndividualProgram(supabase, templateProgramId, studentId)` copie intégralement la structure (semaines/séances/blocs/exercices/prescriptions, jamais les performances/feedbacks) dans un **nouveau** programme dédié (`owner_student_id`, `source_template_id` renseignés), puis l'assigne. Le coach adapte ensuite cette copie librement sans affecter le modèle source ni les copies des autres élèves. |
| `group` | Comportement historique inchangé : `setProgramAssignment` (table `assignments`), une seule structure partagée. Publier une modification d'un programme groupe déjà assigné déclenche une confirmation explicite listant les élèves affectés (`app/admin/programmes/[programId]/page.tsx::handleSave`). |
| `fixed_duration` | Structurellement identique à `group` pour l'instant — prépare une future vente de programmes prêts à l'emploi, sans aucune logique commerciale/Stripe dans ce chantier. |

## 6. Blocs

`training_blocks.block_type` : `standard`, `warmup`, `strength`, `superset`, `tri_set`, `giant_set`, `circuit`, `emom`, `amrap`, `interval`, `cooldown`, `benchmark`, `custom`.

Champs contextuels selon le type (affichés conditionnellement dans `BlockCard`, `components/admin/BlockEditor.tsx`) : `rounds`, `time_cap_seconds`, `rest_seconds` (repos entre exercices), `rest_between_rounds_seconds` (repos après chaque tour — distinct, superset/circuit), `emom_minutes`, `scoring_type` (texte libre).

Superset/tri-set/giant-set : label A1/A2/A3... généré automatiquement selon la position de l'exercice dans le bloc (jamais stocké comme un champ éditable séparé — `superset_label` en base reflète cette même valeur).

EMOM : structure simplifiée en V1 — les exercices du bloc sont listés dans l'ordre, un par minute, répétés en boucle jusqu'à `emom_minutes`. Pas de minuteur d'exécution en direct (voir Phase 2).

## 7. Prescriptions — mode simple / mode détaillé

Le mode simple (`workout_exercises.sets`/`reps`/`recommended_load`, texte libre) reste intact et fonctionne seul, exactement comme avant ce chantier. Le mode détaillé ajoute des lignes `training_prescriptions` (une par série) : `set_type` (normal/warmup/top_set/back_off/failure/optional), `target_reps`, `reps_min`/`reps_max`, `target_load`, `load_unit` (kg/lb), `load_input_mode` (total/per_side/per_implement), `target_percentage`, `target_rpe`, `target_rir`, `bodyweight_percentage`, tempo décomposé (excentrique/pause basse/concentrique/pause haute), `rest_seconds`, `coach_notes`.

Le passage entre modes (`BlockExerciseRow`, `components/admin/BlockEditor.tsx`) est purement un état d'affichage local — `exercise.prescriptions` n'est **jamais vidé** au passage en mode simple, seulement masqué à l'écran. À la sauvegarde, les deux jeux de champs sont écrits indépendamment.

**Convention charge/tonnage (`load_input_mode`)** — documentée explicitement pour ne jamais doubler une charge implicitement :
- `total` : la charge saisie est déjà la charge totale soulevée.
- `per_side` : charge par côté (à doubler pour le tonnage total).
- `per_implement` : charge par haltère/kettlebell — même convention que `kg_per_dumbbell` déjà utilisée par `lib/training-metrics.ts::getEffectiveLoadKg` (doublement automatique), préservée à l'identique pour le mode simple existant.

## 8. Duplication

Réutilise et étend la duplication déjà existante (`ProgramBuilder.tsx`, purement côté client avant sauvegarde) :

- Bloc : `duplicateBlock` (nouvel id de bloc, nouveaux ids d'exercices/prescriptions).
- Séance → semaine suivante : comportement historique conservé (`duplicateSession`), désormais bloc-aware (`cloneBlocks`).
- Semaine entière : `duplicateWeek`/`addWeek(copyPrevious=true)`, bloc-aware.
- La duplication ne copie jamais `workout_feedback`/`exercise_feedback`/`exercise_set_feedback` (ces types ne font pas partie d'`AdminWorkoutSession`/`AdminExercise`, structurellement impossible de les copier par erreur).

**Non couvert en V1** (reporté phase 2) : copier une séance vers une semaine arbitraire (pas seulement "+1 semaine"), copier une semaine vers un autre programme, copier uniquement la prescription sans l'exercice.

## 9. Publication, versionnement, historique

`programs.version_number` (défaut 1), `published_at`, `last_updated_by`. `updateProgram`/`createProgram` (`lib/supabase/programs.ts`) détectent une transition vers `publication_status = 'published'` (jamais une simple re-sauvegarde d'un programme déjà publié) et, dans ce cas uniquement : incrémentent `version_number`, mettent à jour `published_at`, écrivent une ligne `training_change_history` (`action_type: 'published'` ou `'created_published'`).

`training_change_history` : `program_id`, `entity_type`, `entity_id`, `student_id`, `actor_id`/`actor_role` (résolus via `supabase.auth.getUser()` + lookup `profiles`), `action_type`, `before_data`/`after_data` (jsonb), `version_number`. Écriture uniquement sur sauvegarde significative (création, publication), jamais par frappe clavier. Lecture réservée staff (comme `coach_notes`), aucune policy élève.

**Non couvert en V1** : panneau "Historique" affichant la liste/comparaison avant-après dans l'UI admin (les données sont journalisées et prêtes à être affichées, mais aucun composant de lecture n'a été construit — reporté).

## 10. RLS élève

Durcissement (pas d'assouplissement) : `programs_select_assigned_student`, `program_weeks_select_assigned_student`, `workout_sessions_select_assigned_student`, `workout_exercises_select_assigned_student` exigent désormais `publication_status = 'published'` en plus de l'assignation existante — un brouillon assigné n'est plus visible. `training_blocks`/`training_prescriptions` suivent la même jointure (session → programme → assignation → `publication_status = 'published'`).

Séparation cible/réalisé déjà garantie par construction : `training_blocks`/`training_prescriptions` n'ont **aucune** policy d'écriture élève (staff uniquement, `for all using (is_coach_or_admin())`) — un élève ne peut jamais modifier `target_reps`/`target_load`/une prescription. L'écriture élève reste exclusivement sur `exercise_set_feedback` (inchangé, `student_id = current_student_id()`).

`training_change_history` : staff uniquement, aucune policy élève (lecture ou écriture).

Aucune nouvelle fonction `SECURITY DEFINER` n'a été créée dans ce chantier — les policies réutilisent `is_coach_or_admin()`/`current_student_id()` déjà en place.

## 11. Realtime et Phase 2

**Non implémenté dans ce chantier.** Aucune utilisation de Supabase Realtime n'existait dans ce dépôt avant ce chantier ; l'introduire correctement (souscriptions filtrées par élève/programme, gestion des conflits `version_number`, notifications "nouvelle version disponible"/"performance reçue") représente un risque et un effort suffisants pour être traité comme un incrément séparé plutôt que rushé dans cette PR. `version_number`/`updated_at`/`last_updated_by` sont déjà en place côté schéma pour supporter une future détection de conflit.

Reporté en phase 2, sans compromettre la V1 :
- Vue calendrier hebdomadaire dédiée (colonnes jour par jour, navigation semaine précédente/suivante, "aujourd'hui") — la vue "Structure" (semaines empilées) reste la seule interface de construction pour l'instant.
- Drag-and-drop pointeur réel (`@dnd-kit/*` installé mais pas encore câblé) — le réordonnancement existe déjà via boutons flèche haut/bas (accessible clavier), qui restent la méthode principale en V1.
- Modèles réutilisables (enregistrer un bloc/une séance comme modèle, recherche/filtre/insertion).
- Copie de séance/semaine vers une cible arbitraire (autre semaine non adjacente, autre programme).
- Panneau "Historique" (lecture/affichage — les données sont déjà journalisées).
- AMRAP avec scoring/leaderboard avancé, minuteur d'exécution live (EMOM/circuit), assistant de progression automatique, restauration de version, liens publics d'invitation, vente de programmes, agrégation séries/volume/tonnage **par type de bloc** (aujourd'hui : agrégation par exercice/groupe musculaire, déjà correcte, transparente aux blocs via la liste plate dérivée).
- Pondération muscle principal (1) / secondaire (0,5) dans les statistiques — la convention actuelle (crédit plein à chaque groupe matché) est préservée à l'identique, documentée section 12, jamais changée silencieusement.

## 12. Calculs séries / volume / tonnage — convention préservée

`lib/training-metrics.ts` n'a subi **aucune modification de comportement**. Les blocs y sont transparents : `AdminWorkoutSession.exercises` (liste plate dérivée de `blocks.flatMap(b => b.exercises)`, calculée dans `lib/supabase/programs.ts` à la lecture et dans `ProgramBuilder.tsx`/`BlockEditor.tsx` à l'édition) reste la seule entrée consommée par `calculateSessionMetrics`/`calculateWeekMetrics`/`calculateTrainingMetrics`.

Conventions existantes, documentées ici pour la première fois plutôt que changées :
- Volume = séries × moyenne des répétitions (parsée depuis le texte libre `reps`).
- Tonnage = séries × moyenne des répétitions × charge effective (kg). `kg_per_dumbbell` double automatiquement la charge saisie ; `bodyweight`/`machine`/`assisted`/`other` ne comptent aucun tonnage tant que la charge n'est pas chiffrable.
- Un exercice matché sur plusieurs groupes musculaires (ex: "Pectoraux, triceps") reçoit le **crédit plein** dans chacun — pas de pondération principal/secondaire (voir Phase 2).

## 13. Migration Supabase

Bloc additif ajouté en fin de `supabase/schema.sql` (chantier "training-builder-v2") :

- Nouvelles tables : `training_blocks`, `training_prescriptions`, `training_change_history`, avec index et `updated_at` trigger (sauf `training_change_history`, journal append-only sans `updated_at`, comme `activity_events`/`billing_events`).
- Colonnes additives sur `programs` : `program_type`, `publication_status`, `cover_image_path`, `experience_level`, `expected_days_per_week`, `estimated_session_duration_minutes`, `source_template_id`, `owner_student_id`, `version_number`, `published_at`, `last_updated_by`.
- Colonnes additives sur `workout_exercises` : `block_id` (FK vers `training_blocks`, nullable), `superset_label`.
- RLS : policies staff-manage + student-select pour les 3 nouvelles tables ; durcissement des 4 policies student-select existantes (voir section 10).

Idempotente (toutes les instructions sont `create table if not exists`/`add column if not exists`/`drop policy if exists ... create policy`), sans suppression ni perte de données.

**Statut d'application** : rédigée et relue, **pas encore appliquée à un projet Supabase live** — le serveur MCP Supabase était déconnecté pendant toute la durée de ce chantier (aucune tentative d'accès direct à une base de production n'a été faite en contournement). `supabase/schema.sql` reste la source de vérité unique du dépôt, comme pour chaque chantier précédent de ce projet ; à exécuter dans l'éditeur SQL Supabase avant tout déploiement.

**Procédure de retour arrière** (si nécessaire après application) : chaque `alter table ... add column` peut être annulée avec `alter table ... drop column if exists <colonne>` ; les 3 nouvelles tables avec `drop table if exists training_change_history, training_prescriptions, training_blocks;` (ordre important : `training_prescriptions`/`training_blocks` sont référencées par FK) — sans effet sur `programs`/`program_weeks`/`workout_sessions`/`workout_exercises` existantes, qui ne perdent que les colonnes ajoutées.

## 14. Tests

### G. Technique (exécuté)
```
npm run lint      # 0 nouvelle erreur — 1 échec pré-existant hors périmètre, voir Limites
npx tsc --noEmit  # 0 erreur
npm run build     # succès, toutes les routes générées
```

### Vérification runtime
Serveur de dev démarré et testé via Playwright (Chromium headless) : `/admin/programmes/nouveau` sert un 200 OK et redirige proprement vers `/connexion` (comportement attendu, aucune session admin valide dans ce sandbox), zéro erreur console à ce stade. **Aucun compte coach de test n'existe dans ce sandbox** — impossible de vérifier visuellement l'éditeur de blocs, le calendrier ou l'attribution individuelle en conditions réelles. Voir Limites.

### Checklist manuelle à exécuter après déploiement (non vérifiable dans ce sandbox)

**A. Non-régression**
- [ ] Anciens programmes/séances toujours visibles et modifiables via le builder.
- [ ] Vidéos, feedbacks, performances déjà soumis intacts et toujours liés à la bonne séance après une ré-édition.
- [ ] Duplication séance/semaine toujours fonctionnelle.
- [ ] Statistiques existantes (séries/volume/tonnage) inchangées sur un programme non modifié.

**B. Builder**
- [ ] Créer un programme individuel/groupe/durée fixe.
- [ ] Créer un bloc standard, superset, circuit, EMOM ; ajouter/déplacer/supprimer un exercice.
- [ ] Basculer un exercice en mode détaillé, saisir plusieurs séries, revenir en mode simple sans perte de données.
- [ ] Dupliquer un bloc, une séance, une semaine.
- [ ] Publier un programme groupe déjà assigné → confirmation affichée listant les élèves.
- [ ] Attribuer un programme individuel à un élève → copie créée avec des id neufs.

**C. Élève**
- [ ] Un programme en brouillon n'est jamais visible même si assigné.
- [ ] Un programme publié affiche ses blocs (superset avec labels A1/A2, circuit avec tours, EMOM avec durée).
- [ ] Saisie de performance (charge/reps réels) toujours fonctionnelle, inchangée.

**F. Sécurité**
- [ ] Un élève ne peut pas écrire dans `training_blocks`/`training_prescriptions` (RLS refuse).
- [ ] Un élève ne peut pas lire le programme d'un autre élève.
- [ ] Un élève ne peut pas lire un programme `publication_status = 'draft'`.

## 15. Résumé de livraison

**Tables ajoutées** : `training_blocks`, `training_prescriptions`, `training_change_history`.
**Colonnes ajoutées** : voir section 13.
**Composants créés** : `components/admin/BlockEditor.tsx` (BlockCard, PrescriptionTable, BlockExerciseRow), `components/student/BlockAwareSessionBlocks.tsx`.
**Composants réécrits** : `components/admin/ProgramBuilder.tsx` (bloc-aware, nouveaux champs programme).
**Bibliothèque réécrite** : `lib/supabase/programs.ts` (lecture bloc-aware + adaptateur legacy, écriture diffée, `assignIndividualProgram`, `getProgramById`, historique).
**Pages modifiées** : `app/admin/programmes/page.tsx`, `app/admin/programmes/nouveau/page.tsx`, `app/admin/programmes/[programId]/page.tsx`, `app/(student)/entrainement/seance/[sessionId]/page.tsx`.
**Dépendance ajoutée** : `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (installées, pas encore câblées — voir Phase 2).

**Risques connus** :
- Migration non vérifiée contre une base Supabase live (MCP indisponible pendant tout ce chantier).
- `assignIndividualProgram` et l'écriture diffée n'ont pas pu être testées en conditions réelles (pas de compte coach de test dans ce sandbox) — revue de code minutieuse effectuée, mais pas de vérification runtime end-to-end.
- Calendrier hebdomadaire dédié, drag-and-drop pointeur, modèles réutilisables, Realtime, panneau historique UI : non livrés, documentés comme Phase 2 ci-dessus.

**Confirmations** :
- Aucune donnée existante supprimée : migration strictement additive, `updateProgram` ne supprime plus que les lignes explicitement retirées par le coach.
- Aucun autre module modifié : nutrition, documents, rendez-vous, Stripe/abonnements, Resend, Brevo, landing page, accès conditionnel général — aucun fichier touché.
