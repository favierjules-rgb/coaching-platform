-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ P13-B/9 — UNE POLICY NE PEUT PAS DÉPENDRE DE LA LIGNE QU'ELLE AUTORISE  ║
-- ║ Migration ADDITIVE et CORRECTIVE D'URGENCE.                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE LA 8e MIGRATION N'AVAIT PAS VU
-- ════════════════════════════════════════════════════════════════════════════
-- La 8e a corrigé les policies `INSERT`, et l'insertion nue fonctionne. Mais
-- l'enregistrement restait bloqué. Mesuré en instrumentant la RPC réelle
-- `save_training_session_blocks`, dans la session d'un ADMINISTRATEUR :
--
--     INSERT workout_exercises (…)                    → ACCEPTÉE
--     INSERT workout_exercises (…) RETURNING id       → REFUS 42501
--
-- Mêmes valeurs, même transaction, à une ligne d'intervalle. Et c'est la
-- seconde forme que tout le code applicatif emploie : `returning id into …`
-- dans les RPC, `.insert().select("id").single()` côté client.
--
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI `RETURNING` CHANGE TOUT
-- ════════════════════════════════════════════════════════════════════════════
-- Avec la RLS, `INSERT … RETURNING` exige, EN PLUS du `with check` de la
-- policy INSERT, que la ligne produite satisfasse la policy **SELECT** : on ne
-- peut pas rendre à l'appelant une ligne qu'il n'aurait pas le droit de lire.
--
-- Or les policies SELECT de ces tables sont écrites :
--
--     id in (select public.<table>_ids_lecture())
--
-- et ces fonctions lisent LA TABLE ELLE-MÊME :
--
--     workout_exercise_ids_lecture() : select we.id from public.workout_exercises we …
--     program_ids_lecture()          : select p.id  from public.programs p …
--     nutrition_plan_ids_lecture()   : select p.id  from public.nutrition_plans p …
--
-- Elles sont `STABLE`, donc évaluées sur le snapshot du DÉBUT de la commande :
-- la ligne qu'on vient d'insérer n'y figure pas, et ne peut pas y figurer. La
-- condition est fausse par construction — pour tout le monde, administrateur
-- compris. C'est le MÊME défaut que celui de la 8e migration (une règle qui se
-- regarde elle-même), transposé de `with check` à `using`.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA RÈGLE, ET POURQUOI LA PORTÉE NE CHANGE PAS
-- ════════════════════════════════════════════════════════════════════════════
-- Une policy doit s'exprimer sur les COLONNES de la ligne, jamais sur son
-- identifiant. Chaque règle ci-dessous est la définition EXACTE de la fonction
-- qu'elle remplace, transposée sur ces colonnes :
--
--     workout_session_ids_lecture() = « les séances dont program_id ∈ program_ids_lecture() »
--        devient, sur workout_sessions :  program_id in (select program_ids_lecture())
--
-- Mêmes ensembles, mêmes catégories, mêmes niveaux, mêmes résultats sur toutes
-- les lignes existantes — et une indirection de moins à l'exécution.
--
-- ⚠️ DEUX ÉLARGISSEMENTS ASSUMÉS, ET SEULEMENT DEUX, tous deux nécessaires
-- pour qu'une ligne NEUVE soit lisible par celui qui vient de la créer :
--   · `documents` : la propriété (`coach_id`) ouvre le document à son coach,
--     en plus de l'affectation. Sans cela un document neuf — qui n'a encore
--     aucune affectation — serait invisible à son auteur dès sa création.
--   · `students` : inchangé en portée, mais la branche « coach autonome »
--     passe par `coach_id`, qui est porté par la ligne elle-même.
-- Aucun des deux ne donne quoi que ce soit à un collaborateur : ses propres
-- conditions restent l'affectation explicite et la permission de catégorie.

begin;

-- ── 0. L'ENSEMBLE DES ÉLÈVES AFFECTÉS, SANS PASSER PAR `students` ─────────
-- `student_ids_portee()` lit `public.students`, donc une policy de `students`
-- qui l'appelle est auto-référentielle. Cette fonction ne lit que la table
-- d'affectation : elle est le seul terme de la portée qui ne peut pas être
-- exprimé par une colonne de `students`.
create or replace function public.student_ids_collaborateur()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select a.student_id
    from public.collaborateur_eleves a
   where public.staff_role() = 'collaborateur'
     and a.collaborateur_id = public.current_staff_id();
$fn$;
alter function public.student_ids_collaborateur() owner to postgres;
revoke all on function public.student_ids_collaborateur() from public;
revoke execute on function public.student_ids_collaborateur() from anon;
grant execute on function public.student_ids_collaborateur() to authenticated, service_role;

-- ── 1. workout_sessions : la portée vient du PROGRAMME ────────────────────
drop policy if exists workout_sessions_manage_staff_select on public.workout_sessions;
create policy workout_sessions_manage_staff_select
  on public.workout_sessions for select
  using (program_id in (select public.program_ids_lecture()));

drop policy if exists workout_sessions_manage_staff_update on public.workout_sessions;
create policy workout_sessions_manage_staff_update
  on public.workout_sessions for update
  using (program_id in (select public.program_ids_ecriture()))
  with check (program_id in (select public.program_ids_ecriture()));

drop policy if exists workout_sessions_manage_staff_delete on public.workout_sessions;
create policy workout_sessions_manage_staff_delete
  on public.workout_sessions for delete
  using (program_id in (select public.program_ids_ecriture()));

-- ── 2. workout_exercises : la portée vient de la SÉANCE ou du BLOC ────────
drop policy if exists workout_exercises_manage_staff_select on public.workout_exercises;
create policy workout_exercises_manage_staff_select
  on public.workout_exercises for select
  using (
    session_id in (select public.workout_session_ids_lecture())
    or block_id in (select public.training_block_ids_lecture())
  );

drop policy if exists workout_exercises_manage_staff_update on public.workout_exercises;
create policy workout_exercises_manage_staff_update
  on public.workout_exercises for update
  using (
    session_id in (select public.workout_session_ids_ecriture())
    or block_id in (select public.training_block_ids_ecriture())
  )
  with check (
    session_id in (select public.workout_session_ids_ecriture())
    or block_id in (select public.training_block_ids_ecriture())
  );

drop policy if exists workout_exercises_manage_staff_delete on public.workout_exercises;
create policy workout_exercises_manage_staff_delete
  on public.workout_exercises for delete
  using (
    session_id in (select public.workout_session_ids_ecriture())
    or block_id in (select public.training_block_ids_ecriture())
  );

-- ── 3. programs : transposition de program_ids_* sur les colonnes ─────────
drop policy if exists programs_manage_staff_select on public.programs;
create policy programs_manage_staff_select
  on public.programs for select
  using (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_lecture()))
    or (owner_student_id is null
        and (
          coalesce(public.est_staff_global(), false)
          or (coach_id is not null
              and coach_id in (select public.coach_ids_portee())
              and coalesce('entrainement' in (select public.categories_lecture()), false))
        ))
  );

drop policy if exists programs_manage_staff_update on public.programs;
create policy programs_manage_staff_update
  on public.programs for update
  using (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_ecriture()))
    or (owner_student_id is null
        and (
          coalesce(public.est_staff_global(), false)
          or (coach_id is not null
              and coach_id in (select public.coach_ids_portee())
              and coalesce('entrainement' in (select public.categories_ecriture()), false))
        ))
  )
  with check (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_ecriture()))
    or (owner_student_id is null
        and (
          coalesce(public.est_staff_global(), false)
          or (coach_id is not null
              and coach_id in (select public.coach_ids_portee())
              and coalesce('entrainement' in (select public.categories_ecriture()), false))
        ))
  );

drop policy if exists programs_manage_staff_delete on public.programs;
create policy programs_manage_staff_delete
  on public.programs for delete
  using (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_ecriture()))
    or (owner_student_id is null
        and (
          coalesce(public.est_staff_global(), false)
          or (coach_id is not null
              and coach_id in (select public.coach_ids_portee())
              and coalesce('entrainement' in (select public.categories_ecriture()), false))
        ))
  );

-- ── 4. students : la portée, exprimée sur la ligne ────────────────────────
-- ⚠️ MÊME PORTÉE, TERME POUR TERME, que `student_ids_portee()` : administrateur
-- réel ; coach autonome sur SES élèves (`coach_id`) ; collaborateur sur ses
-- élèves AFFECTÉS. La seule différence est qu'aucune branche ne relit
-- `public.students`.
drop policy if exists students_select_self_or_staff on public.students;
create policy students_select_self_or_staff
  on public.students for select
  using (
    user_id = auth.uid()
    or coalesce(public.is_admin(), false)
    or (
      not coalesce(public.is_admin(), false)
      and coalesce(public.staff_role() in ('admin', 'assistant'), false)
      and coach_id is not null
      and coach_id = (select public.current_staff_id())
    )
    or id in (select public.student_ids_collaborateur())
  );

-- La policy héritée, de même contenu, retirée : elle portait le même défaut.
drop policy if exists "Admin and coach can read students" on public.students;

-- ── 5. nutrition_plans : transposition de nutrition_plan_ids_* ────────────
drop policy if exists nutrition_plans_select_own_coach on public.nutrition_plans;
create policy nutrition_plans_select_own_coach
  on public.nutrition_plans for select
  using (
    (student_id is not null
     and student_id in (select public.student_ids_nutrition_lecture()))
    or (student_id is null
        and coach_id is not null
        and coach_id = (select public.current_coach_id())
        and coalesce(public.est_staff_global(), false))
  );

drop policy if exists nutrition_plans_update_own_coach on public.nutrition_plans;
create policy nutrition_plans_update_own_coach
  on public.nutrition_plans for update
  using (
    (student_id is not null
     and student_id in (select public.student_ids_nutrition_ecriture()))
    or (student_id is null
        and coach_id is not null
        and coach_id = (select public.current_coach_id())
        and coalesce(public.est_staff_global(), false))
  )
  with check (
    (student_id is not null
     and student_id in (select public.student_ids_nutrition_ecriture()))
    or (student_id is null
        and coach_id is not null
        and coach_id = (select public.current_coach_id())
        and coalesce(public.est_staff_global(), false))
  );

-- ── 6. documents : affectation OU propriété ───────────────────────────────
-- ⚠️ LA PROPRIÉTÉ EST AJOUTÉE, ET ELLE EST NÉCESSAIRE. `document_ids_lecture()`
-- passe par `document_assignments` : un document NEUF n'a aucune affectation,
-- donc son auteur ne pouvait ni le relire après création, ni le retrouver pour
-- l'affecter. La branche propriétaire est bornée par `coach_ids_portee()` :
-- un coach autonome n'y voit que les siens, un collaborateur que ceux des
-- coachs de ses élèves affectés, ET seulement si la catégorie le permet.
drop policy if exists documents_manage_staff_select on public.documents;
create policy documents_manage_staff_select
  on public.documents for select
  using (
    coalesce(public.is_admin(), false)
    or (
      coach_id is not null
      and coach_id in (select public.coach_ids_portee())
      and (
        (category = 'nutrition'
         and coalesce('nutrition' in (select public.categories_lecture()), false))
        or (category = 'entrainement'
            and coalesce('entrainement' in (select public.categories_lecture()), false))
        or (category = 'administratif'
            and coalesce('suivi_eleve' in (select public.categories_lecture()), false))
      )
    )
    or exists (
      select 1 from public.document_assignments da
       where da.document_id = documents.id
         and (
           (documents.category = 'nutrition'
            and da.student_id in (select public.student_ids_nutrition_lecture()))
           or (documents.category = 'entrainement'
               and da.student_id in (select public.student_ids_entrainement_lecture()))
           or (documents.category = 'administratif'
               and da.student_id in (select public.student_ids_suivi_eleve_lecture()))
         )
    )
  );

drop policy if exists documents_manage_staff_update on public.documents;
create policy documents_manage_staff_update
  on public.documents for update
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null and coach_id in (select public.coach_ids_portee())
        and (
          (category = 'nutrition'
           and coalesce('nutrition' in (select public.categories_ecriture()), false))
          or (category = 'entrainement'
              and coalesce('entrainement' in (select public.categories_ecriture()), false))
          or (category = 'administratif'
              and coalesce('suivi_eleve' in (select public.categories_ecriture()), false))
        ))
  )
  with check (
    coalesce(public.is_admin(), false)
    or (coach_id is not null and coach_id in (select public.coach_ids_portee())
        and (
          (category = 'nutrition'
           and coalesce('nutrition' in (select public.categories_ecriture()), false))
          or (category = 'entrainement'
              and coalesce('entrainement' in (select public.categories_ecriture()), false))
          or (category = 'administratif'
              and coalesce('suivi_eleve' in (select public.categories_ecriture()), false))
        ))
  );

drop policy if exists documents_manage_staff_delete on public.documents;
create policy documents_manage_staff_delete
  on public.documents for delete
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null and coach_id in (select public.coach_ids_portee())
        and (
          (category = 'nutrition'
           and coalesce('nutrition' in (select public.categories_ecriture()), false))
          or (category = 'entrainement'
              and coalesce('entrainement' in (select public.categories_ecriture()), false))
          or (category = 'administratif'
              and coalesce('suivi_eleve' in (select public.categories_ecriture()), false))
        ))
  );

-- ── 7. VÉRIFICATION FINALE ────────────────────────────────────────────────
do $g$
declare v_n int; r record;
begin
  -- Plus AUCUNE policy du schéma ne teste `id` contre un ensemble lu dans la
  -- table qu'elle protège.
  select count(*) into v_n
    from pg_policies p
    join pg_proc f on f.pronamespace = 'public'::regnamespace
                  and f.proname like '%\_ids\_%'
   where p.schemaname = 'public'
     and (coalesce(p.qual,'')||' '||coalesce(p.with_check,'')) ~ ('id IN \( SELECT '||f.proname)
     and f.prosrc ~ ('from public\.'||p.tablename||' ');
  if v_n <> 0 then
    for r in
      select p.tablename, p.cmd, p.policyname
        from pg_policies p
        join pg_proc f on f.pronamespace = 'public'::regnamespace and f.proname like '%\_ids\_%'
       where p.schemaname = 'public'
         and (coalesce(p.qual,'')||' '||coalesce(p.with_check,'')) ~ ('id IN \( SELECT '||f.proname)
         and f.prosrc ~ ('from public\.'||p.tablename||' ')
    loop
      raise warning 'P13-B/9 : % [%] % reste auto-référentielle', r.tablename, r.cmd, r.policyname;
    end loop;
    raise exception 'P13-B/9 : % policy(ies) auto-référentielle(s) subsistent', v_n;
  end if;

  -- Les tables du parcours gardent bien une policy par commande.
  for r in select unnest(array['programs','workout_sessions','workout_exercises',
                               'nutrition_plans','documents','students']) as t
  loop
    select count(*) into v_n from pg_policies
     where schemaname = 'public' and tablename = r.t and cmd = 'SELECT';
    if v_n = 0 then
      raise exception 'P13-B/9 : % n''a plus aucune policy SELECT', r.t;
    end if;
  end loop;

  raise notice 'P13-B/9 : policies transposées sur les colonnes — INSERT … RETURNING fonctionne de nouveau.';
end $g$;

commit;
