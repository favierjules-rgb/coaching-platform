-- ============================================================================
-- Checklist PostgreSQL — RPE par demi-point
-- Migration couverte : 20260830090000_rpe_half_points.sql
--
-- CE QU'ELLE VÉRIFIE
--   RPE-HALF3  7,5 est écrit puis relu 7,5 — sur les QUATRE colonnes
--   RPE-HALF4  7,2 est refusé PAR LA BASE, pas seulement par l'interface
--   RPE-HALF5  les bornes d'origine sont inchangées, colonne par colonne
--   RPE-HALF6  les entiers restent acceptés, et les RPE historiques intacts
--   TYPE       les trois colonnes entières sont devenues numériques
--   Z          après le ROLLBACK, aucune donnée de test ne subsiste
--
-- POURQUOI CETTE CHECKLIST EXISTE
--   Un `<input step="0.5">` et un schéma zod ne disent RIEN de ce que fait
--   PostgreSQL. Tant que la colonne était `integer`, une valeur 7,5 validée
--   par l'application arrivait en base et en ressortait 8 — silencieusement.
--   Seule une écriture RÉELLE suivie d'une relecture peut le prouver.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/rpe_half_points_checklist.sql
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ============================================================================

\timing off

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, p_ok);
  if p_ok then raise notice 'OK      — % · %', p_section, p_libelle;
  else raise warning 'ÉCHEC   — % · %', p_section, p_libelle; end if;
end $$;

create or replace function pg_temp.refuse(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

create or replace function pg_temp.accepte(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  return false;
end $$;

-- ---------------------------------------------------------------------
-- TYPE — les colonnes ont bien changé de nature
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('TYPE', 'les trois colonnes entières sont devenues numeric',
    (select count(*) from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (
          ('exercise_feedback', 'rpe'),
          ('exercise_set_feedback', 'rpe'),
          ('workout_feedback', 'global_rpe'))
        and data_type = 'numeric') = 3);

  perform pg_temp.noter('TYPE', 'target_rpe était déjà numeric et l''est resté',
    (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'training_prescriptions'
        and column_name = 'target_rpe') = 'numeric');

  -- La colonne de prescription par SÉQUENCE reste du texte : « 6-7-8-6 »
  -- n'a pas de représentation numérique, et ce n'est pas un oubli.
  perform pg_temp.noter('TYPE', 'workout_exercises.recommended_rpe reste du texte, à dessein',
    (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'workout_exercises'
        and column_name = 'recommended_rpe') = 'text');
end $$;

-- ---------------------------------------------------------------------
-- Jeu d'essai — comptes et séance synthétiques
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('b0000000-0000-4000-8000-000000000001', 'rpe-eleve@test.invalid');

insert into public.students (id, user_id, first_name, last_name, email, status) values
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'Eleve', 'Rpe', 'rpe-eleve@test.invalid', 'active');

insert into public.workout_feedback
  (id, student_id, session_key, session_ref_label, completed, global_rpe, global_comment)
values ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
        'cle-test-rpe', 'Séance test', true, 7.5, '');

insert into public.exercise_feedback
  (id, workout_feedback_id, student_id, exercise_name, exercise_order, rpe, comment)
values ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000001', 'Développé couché', 0, 6.5, '');

insert into public.exercise_set_feedback
  (id, exercise_feedback_id, student_id, set_number, load_used, reps_done, rpe)
values ('b4000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000001', 1, '60', '10', 8.5);

-- Chaîne minimale pour porter une prescription : une prescription orpheline
-- est refusée par `training_prescriptions_exercise_or_block_check`, et un
-- test qui échoue pour cette raison-là ne dirait rien du RPE.
insert into public.programs (id, name, goal, level, duration_weeks, description, status)
values ('b6000000-0000-4000-8000-000000000001', 'Programme test RPE', 'Force', 'avancé', 1, '', 'brouillon');

insert into public.program_weeks (id, program_id, week_number)
values ('b6000000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000001', 1);

insert into public.workout_sessions (id, program_id, program_week_id, day, name)
values ('b6000000-0000-4000-8000-000000000003', 'b6000000-0000-4000-8000-000000000001',
        'b6000000-0000-4000-8000-000000000002', 'Lundi', 'Séance test');

insert into public.training_blocks (id, session_id, title, position)
values ('b6000000-0000-4000-8000-000000000004', 'b6000000-0000-4000-8000-000000000003', 'Bloc test', 1);

-- ---------------------------------------------------------------------
-- RPE-HALF3 — écrit 7,5, relu 7,5
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('RPE-HALF3', 'workout_feedback.global_rpe : 7,5 relu 7,5',
    (select global_rpe from public.workout_feedback
      where id = 'b2000000-0000-4000-8000-000000000001') = 7.5);

  perform pg_temp.noter('RPE-HALF3', 'exercise_feedback.rpe : 6,5 relu 6,5',
    (select rpe from public.exercise_feedback
      where id = 'b3000000-0000-4000-8000-000000000001') = 6.5);

  perform pg_temp.noter('RPE-HALF3', 'exercise_set_feedback.rpe : 8,5 relu 8,5',
    (select rpe from public.exercise_set_feedback
      where id = 'b4000000-0000-4000-8000-000000000001') = 8.5);

  -- Et surtout : la valeur n'a PAS été arrondie. C'est exactement ce que la
  -- colonne `integer` faisait avant, en silence.
  perform pg_temp.noter('RPE-HALF3', 'aucune valeur n''a été arrondie à l''entier',
    (select global_rpe <> 8 and global_rpe <> 7 from public.workout_feedback
      where id = 'b2000000-0000-4000-8000-000000000001'));

  -- La preuve par le type : `7.5::integer` aurait rendu 8. Le fait que la
  -- colonne accepte 7,5 ET le rende 7,5 ne tient qu'au changement de type.
  perform pg_temp.noter('RPE-HALF3', 'à titre de repère, 7.5::integer vaudrait bien 8',
    (7.5::numeric)::integer = 8);

end $$;

-- Une mise à jour ultérieure garde la décimale. L'écriture et la relecture
-- sont DEUX instructions : dans `noter(..., accepte(sql) and (select ...))`,
-- la sous-requête est évaluée dans le MÊME instantané que l'appel de
-- fonction et ne voit donc pas encore l'écriture. Défaut mesuré, pas supposé.
update public.exercise_set_feedback set rpe = 9.5
 where id = 'b4000000-0000-4000-8000-000000000001';

do $$
begin
  perform pg_temp.noter('RPE-HALF3', 'un UPDATE en 9,5 est relu 9,5',
    (select rpe from public.exercise_set_feedback
      where id = 'b4000000-0000-4000-8000-000000000001') = 9.5);
end $$;

-- ---------------------------------------------------------------------
-- RPE-HALF4 — la base refuse ce qui n'est pas sur la grille
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('RPE-HALF4', 'global_rpe = 7,2 refusé par la base', pg_temp.refuse($q$
    update public.workout_feedback set global_rpe = 7.2
     where id = 'b2000000-0000-4000-8000-000000000001' $q$));

  perform pg_temp.noter('RPE-HALF4', 'exercise_feedback.rpe = 8,7 refusé', pg_temp.refuse($q$
    update public.exercise_feedback set rpe = 8.7
     where id = 'b3000000-0000-4000-8000-000000000001' $q$));

  perform pg_temp.noter('RPE-HALF4', 'exercise_set_feedback.rpe = 7,25 refusé', pg_temp.refuse($q$
    update public.exercise_set_feedback set rpe = 7.25
     where id = 'b4000000-0000-4000-8000-000000000001' $q$));

  perform pg_temp.noter('RPE-HALF4', 'target_rpe = 6,3 refusé', pg_temp.refuse($q$
    insert into public.training_prescriptions (id, block_id, set_number, intensity_target_type, target_rpe)
    values (gen_random_uuid(), 'b6000000-0000-4000-8000-000000000004', 1, 'rpe', 6.3) $q$));

  -- Un decimal à rallonge qui « ressemble » à un demi-point ne passe pas.
  perform pg_temp.noter('RPE-HALF4', '7,500001 refusé', pg_temp.refuse($q$
    update public.workout_feedback set global_rpe = 7.500001
     where id = 'b2000000-0000-4000-8000-000000000001' $q$));

  -- La valeur d'origine n'a pas bougé pendant toutes ces tentatives.
  perform pg_temp.noter('RPE-HALF4', 'après les refus, la valeur reste 7,5',
    (select global_rpe from public.workout_feedback
      where id = 'b2000000-0000-4000-8000-000000000001') = 7.5);
end $$;

-- ---------------------------------------------------------------------
-- RPE-HALF5 — les bornes d'origine, colonne par colonne
-- ---------------------------------------------------------------------
do $$
begin
  -- Ressenti : 1 à 10. Zéro n'a jamais été valide, et ne l'est toujours pas.
  perform pg_temp.noter('RPE-HALF5', 'global_rpe = 0 refusé (borne basse 1, inchangée)', pg_temp.refuse($q$
    update public.workout_feedback set global_rpe = 0
     where id = 'b2000000-0000-4000-8000-000000000001' $q$));
  perform pg_temp.noter('RPE-HALF5', 'global_rpe = 0,5 refusé', pg_temp.refuse($q$
    update public.workout_feedback set global_rpe = 0.5
     where id = 'b2000000-0000-4000-8000-000000000001' $q$));
  perform pg_temp.noter('RPE-HALF5', 'global_rpe = 10,5 refusé (borne haute 10, inchangée)', pg_temp.refuse($q$
    update public.workout_feedback set global_rpe = 10.5
     where id = 'b2000000-0000-4000-8000-000000000001' $q$));
  perform pg_temp.noter('RPE-HALF5', 'global_rpe = 1 et 10 acceptés (les bornes elles-mêmes)',
    pg_temp.accepte($q$ update public.workout_feedback set global_rpe = 1
                         where id = 'b2000000-0000-4000-8000-000000000001' $q$)
    and pg_temp.accepte($q$ update public.workout_feedback set global_rpe = 10
                             where id = 'b2000000-0000-4000-8000-000000000001' $q$));

  -- Cible cardio : 0 à 10. La borne basse N'A PAS été remontée à 1.
  perform pg_temp.noter('RPE-HALF5', 'target_rpe = 0 reste accepté — « au repos » existe encore',
    pg_temp.accepte($q$
      insert into public.training_prescriptions (id, block_id, set_number, intensity_target_type, target_rpe)
      values ('b5000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000004', 1, 'rpe', 0) $q$));
  perform pg_temp.noter('RPE-HALF5', 'target_rpe = 0,5 accepté', pg_temp.accepte($q$
    insert into public.training_prescriptions (id, block_id, set_number, intensity_target_type, target_rpe)
    values ('b5000000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000004', 2, 'rpe', 0.5) $q$));
  perform pg_temp.noter('RPE-HALF5', 'target_rpe = 10,5 refusé', pg_temp.refuse($q$
    insert into public.training_prescriptions (id, block_id, set_number, intensity_target_type, target_rpe)
    values (gen_random_uuid(), 'b6000000-0000-4000-8000-000000000004', 3, 'rpe', 10.5) $q$));

  -- Et le NULL reste permis partout où il l'était : une série sans RPE
  -- n'est pas une erreur.
  perform pg_temp.noter('RPE-HALF5', 'un RPE de série NULL reste accepté', pg_temp.accepte($q$
    update public.exercise_set_feedback set rpe = null
     where id = 'b4000000-0000-4000-8000-000000000001' $q$));
end $$;

-- ---------------------------------------------------------------------
-- RPE-HALF6 — les entiers restent acceptés, l'historique est intact
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('RPE-HALF6', 'les entiers 1 à 10 passent tous', (
    select bool_and(pg_temp.accepte(format(
      'update public.workout_feedback set global_rpe = %s where id = ''b2000000-0000-4000-8000-000000000001''', n)))
      from generate_series(1, 10) n));

  perform pg_temp.noter('RPE-HALF6', 'les 19 valeurs de la grille 1→10 passent toutes', (
    select bool_and(pg_temp.accepte(format(
      'update public.workout_feedback set global_rpe = %s where id = ''b2000000-0000-4000-8000-000000000001''', v)))
      from generate_series(2, 20) i, lateral (select (i::numeric / 2) as v) g));

end $$;

-- Un entier écrit avant la migration se relit à l'identique — la conversion
-- integer → numeric est exacte et totale. Même précaution d'instantané.
update public.exercise_feedback set rpe = 9
 where id = 'b3000000-0000-4000-8000-000000000001';

do $$
begin
  perform pg_temp.noter('RPE-HALF6', 'un RPE entier historique se relit inchangé',
    (select rpe from public.exercise_feedback
      where id = 'b3000000-0000-4000-8000-000000000001') = 9);
end $$;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_ko int;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_ko from _faits;
  raise notice '────────────────────────────────────────────────';
  raise notice 'RPE DEMI-POINTS — % contrôles, % échec(s)', v_total, v_ko;
  raise notice '────────────────────────────────────────────────';
  if v_ko > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_ko, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

-- ---------------------------------------------------------------------
-- Section Z — après le ROLLBACK, rien ne subsiste
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.workout_feedback where id = 'b2000000-0000-4000-8000-000000000001')
  or exists (select 1 from public.students where id = 'b1000000-0000-4000-8000-000000000001')
  or exists (select 1 from auth.users where id = 'b0000000-0000-4000-8000-000000000001')
  or exists (select 1 from public.programs where id = 'b6000000-0000-4000-8000-000000000001')
  or exists (select 1 from public.training_prescriptions where id = 'b5000000-0000-4000-8000-000000000001')
  then
    raise exception 'Z — des données de test ont survécu au ROLLBACK';
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste après le ROLLBACK';
end $$;
