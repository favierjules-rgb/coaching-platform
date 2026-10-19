-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ P13-B/8 — LES POLICIES `INSERT` TESTAIENT L'id DE LA LIGNE À CRÉER      ║
-- ║ Migration ADDITIVE et CORRECTIVE D'URGENCE.                             ║
-- ║ Aucune des sept précédentes n'est modifiée.                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- LE DÉFAUT, TEL QUE MESURÉ — ET IL NE CONCERNE PAS QUE LES COLLABORATEURS
-- ════════════════════════════════════════════════════════════════════════════
-- Signalé le 13/10/2026 : plus aucune modification de programme ne
-- s'enregistre, bandeau « Une partie du programme n'a pas pu être
-- enregistrée » (= STRUCTURE_INCOMPLETE, lib/admin-builder-save.ts).
--
-- Mesuré sur PostgreSQL 16 local, pour un ADMINISTRATEUR avec fiche `coaches`
-- ACTIVE — le cas le plus favorable qui soit, `est_staff_global()` vrai et
-- `is_admin()` vrai :
--
--     INSERT program_weeks  (semaine)            → ACCEPTÉE
--     UPDATE workout_sessions (séance existante) → ACCEPTÉE
--     INSERT workout_sessions (séance)           → REFUS 42501
--     INSERT workout_exercises (exercice)        → REFUS 42501
--     INSERT programs (nouveau programme)        → REFUS 42501
--     INSERT students (nouvel élève)             → REFUS 42501
--
-- On peut donc modifier ce qui existe, et plus rien créer. Le builder, qui
-- insère les séances neuves, est bloqué — exactement le symptôme décrit.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA CAUSE : UNE POLICY `INSERT` QUI SE REGARDE ELLE-MÊME
-- ════════════════════════════════════════════════════════════════════════════
-- La migration 20261011100000 a écrit, pour cinq tables :
--
--     with check (id in (select public.<table>_ids_ecriture()))
--
-- Or ces ensembles sont CALCULÉS DEPUIS LES LIGNES EXISTANTES de la table
-- elle-même :
--
--     workout_session_ids_ecriture() : select ws.id from public.workout_sessions ws …
--     workout_exercise_ids_ecriture(): select we.id from public.workout_exercises we …
--     program_ids_ecriture()         : select p.id  from public.programs p …
--
-- L'identifiant d'une ligne qu'on est en train de créer n'existe PAS encore
-- dans la table : il ne peut donc jamais appartenir à l'ensemble, et la
-- condition est fausse pour tout le monde, quel que soit le rôle. Une policy
-- `INSERT` doit porter sur le PARENT de la ligne (« ai-je le droit d'écrire
-- DANS ce programme / cette séance ? »), jamais sur son propre identifiant.
--
-- Les neuf autres policies `INSERT` du cœur le font correctement — elles
-- testent `program_id`, `session_id`, `block_id`, `student_id`,
-- `document_id`. Seules les cinq ci-dessous testaient `id`.
--
-- ⚠️ UN SIXIÈME CAS, DE MÊME NATURE : `training_prescriptions` ne testait que
-- `block_id`. Les prescriptions PAR EXERCICE portent `block_id` à NULL et
-- `exercise_id` renseigné (voir le corps de `provision_program_copy`) :
-- `null in (…)` vaut NULL, donc refus. Les prescriptions d'exercice étaient
-- bloquées elles aussi.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CE CORRECTIF N'ÉLARGIT PAS
-- ════════════════════════════════════════════════════════════════════════════
-- Chaque règle ci-dessous est la TRANSPOSITION AU PARENT de la règle de
-- lecture/écriture déjà en vigueur : mêmes ensembles, mêmes catégories, mêmes
-- niveaux. Un collaborateur sans `entrainement / ecriture` ne peut toujours
-- rien créer ; un collaborateur sans élève affecté non plus. Les policies
-- SELECT, UPDATE et DELETE ne sont pas touchées — une ligne créée reste
-- soumise aux mêmes conditions de lecture et de modification qu'avant.

begin;

-- ── 1. workout_sessions : le droit vient du PROGRAMME ──────────────────────
-- Symétrique de `program_weeks_manage_staff_insert`, qui teste déjà
-- `program_id in program_ids_ecriture()`. La cohérence semaine ↔ programme
-- reste assurée par la clé étrangère `program_week_id`.
drop policy if exists workout_sessions_manage_staff_insert on public.workout_sessions;
create policy workout_sessions_manage_staff_insert
  on public.workout_sessions for insert
  with check (program_id in (select public.program_ids_ecriture()));

-- ── 2. workout_exercises : le droit vient de la SÉANCE, ou du BLOC ─────────
-- Symétrique de `training_blocks_manage_staff_insert`. Les deux parents sont
-- acceptés parce que les deux existent dans le modèle : un exercice est
-- rattaché à une séance, et éventuellement à un bloc.
drop policy if exists workout_exercises_manage_staff_insert on public.workout_exercises;
create policy workout_exercises_manage_staff_insert
  on public.workout_exercises for insert
  with check (
    (session_id is not null and session_id in (select public.workout_session_ids_ecriture()))
    or (block_id is not null and block_id in (select public.training_block_ids_ecriture()))
  );

-- ── 3. training_prescriptions : par BLOC **ou** par EXERCICE ───────────────
-- ⚠️ L'ANCIENNE RÈGLE NE VOYAIT QUE LA MOITIÉ DU MODÈLE. Une prescription
-- d'exercice a `block_id` NULL : `null in (…)` vaut NULL, donc refus. Les
-- séries d'un exercice étaient impossibles à créer.
drop policy if exists training_prescriptions_manage_staff_insert on public.training_prescriptions;
create policy training_prescriptions_manage_staff_insert
  on public.training_prescriptions for insert
  with check (
    (block_id is not null and block_id in (select public.training_block_ids_ecriture()))
    or (exercise_id is not null and exercise_id in (select public.workout_exercise_ids_ecriture()))
  );

-- ── 4. programs : un programme neuf n'a pas de parent ──────────────────────
-- La règle est la TRANSPOSITION EXACTE de `program_ids_ecriture()` sur les
-- colonnes de la ligne créée : copie individuelle d'un élève dans la portée
-- `entrainement / ecriture`, ou programme MODÈLE appartenant au staff global
-- ou à un coach de la portée avec la catégorie en écriture.
drop policy if exists programs_manage_staff_insert on public.programs;
create policy programs_manage_staff_insert
  on public.programs for insert
  with check (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_ecriture()))
    or (
      owner_student_id is null
      and (
        coalesce(public.est_staff_global(), false)
        or (
          coach_id is not null
          and coach_id in (select public.coach_ids_portee())
          and coalesce('entrainement' in (select public.categories_ecriture()), false)
        )
      )
    )
  );

-- ── 5. students : créer un élève reste au staff global ─────────────────────
-- ⚠️ CE N'EST PAS UN RESSERREMENT. L'INSERT était TOTALEMENT impossible :
-- cette règle rend le droit à ceux qui l'avaient avant P13-B (administrateur,
-- coach autonome), et ne le donne pas au collaborateur — qui reçoit ses élèves
-- par AFFECTATION, et n'en a jamais créé.
drop policy if exists students_manage_staff on public.students;
create policy students_manage_staff
  on public.students for insert
  with check (
    coalesce(public.est_staff_global(), false)
    and (coach_id is null or coach_id in (select public.coach_ids_portee()))
  );

-- ── 6. documents : la CATÉGORIE du document porte le droit ─────────────────
-- `document_ids_ecriture()` passe par `document_assignments` : un document
-- neuf n'a aucune affectation, l'ensemble est donc vide par construction. La
-- règle reprend la correspondance catégorie → permission de cette fonction.
drop policy if exists documents_manage_staff_insert on public.documents;
create policy documents_manage_staff_insert
  on public.documents for insert
  with check (
    coalesce(public.est_staff_global(), false)
    or (category = 'nutrition'
        and coalesce('nutrition' in (select public.categories_ecriture()), false))
    or (category = 'entrainement'
        and coalesce('entrainement' in (select public.categories_ecriture()), false))
    or (category = 'administratif'
        and coalesce('suivi_eleve' in (select public.categories_ecriture()), false))
  );

-- ── 7. VÉRIFICATION FINALE ────────────────────────────────────────────────
do $g$
declare v_n int; r record;
begin
  -- Plus AUCUNE policy INSERT du schéma ne teste l'identifiant de la ligne
  -- qu'elle laisse créer.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and cmd = 'INSERT'
     and with_check ~ '^\(id IN';
  if v_n <> 0 then
    for r in select tablename, policyname from pg_policies
              where schemaname='public' and cmd='INSERT' and with_check ~ '^\(id IN'
    loop
      raise warning 'P13-B/8 : % . % teste encore `id`', r.tablename, r.policyname;
    end loop;
    raise exception 'P13-B/8 : % policy(ies) INSERT testent encore l''id de la ligne insérée', v_n;
  end if;

  -- Les six policies attendues existent.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and cmd = 'INSERT'
     and policyname in ('workout_sessions_manage_staff_insert',
                        'workout_exercises_manage_staff_insert',
                        'training_prescriptions_manage_staff_insert',
                        'programs_manage_staff_insert',
                        'students_manage_staff',
                        'documents_manage_staff_insert');
  if v_n <> 6 then
    raise exception 'P13-B/8 : % policy(ies) INSERT sur 6 en place', v_n;
  end if;

  -- Et les policies de LECTURE / MODIFICATION n'ont pas bougé : le correctif
  -- ne doit ouvrir que la création.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('programs_manage_staff_select','programs_manage_staff_update',
                        'workout_sessions_manage_staff_select','workout_sessions_manage_staff_update',
                        'workout_exercises_manage_staff_select','workout_exercises_manage_staff_update');
  if v_n <> 6 then
    raise exception 'P13-B/8 : les policies SELECT/UPDATE existantes ont été touchées (% sur 6)', v_n;
  end if;

  raise notice 'P13-B/8 : six policies INSERT corrigées — la création est de nouveau possible.';
end $g$;

commit;
