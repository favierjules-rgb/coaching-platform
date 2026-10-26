-- ════════════════════════════════════════════════════════════════════════════
-- RAPPORT DU BANC — critères de décision du chantier
--   · plafond DUR     : 8 000 ms (`statement_timeout` du rôle authenticated).
--                       Au-delà, la transaction est annulée : échec, pas lenteur.
--   · objectif de VALIDATION : 4 000 ms sur le PIRE CAS, soit 50 % de marge.
-- Le verdict porte sur le MAXIMUM observé, jamais sur la moyenne : c'est le
-- pire tirage qui échoue chez le coach.
-- ════════════════════════════════════════════════════════════════════════════
\pset footer off

\echo ''
\echo '════════ RÉPÉTITIONS PAR SCÉNARIO ════════'
select scenario, nb_seances as seances,
       count(*) as n,
       count(*) filter (where issue <> 'ok') as echecs,
       min(ms) as min_ms,
       round(avg(ms), 1) as moy_ms,
       round(percentile_cont(0.5) within group (order by ms)::numeric, 1) as median_ms,
       max(ms) as max_ms,
       round(max(ms) / 8000.0 * 100, 1) as pct_du_plafond
  from public.bench_mesures
 group by scenario, nb_seances
 order by nb_seances, scenario;

\echo ''
\echo '════════ VERDICT (sur le MAXIMUM, objectif 4 000 ms, plafond 8 000 ms) ════════'
select scenario,
       max(ms) as max_ms,
       count(*) filter (where issue <> 'ok') as echecs,
       case
         when count(*) filter (where issue <> 'ok') > 0 then 'ÉCHEC — au moins une répétition n a pas abouti'
         when max(ms) > 8000 then 'ÉCHEC — plafond de 8 s dépassé'
         when max(ms) > 4000 then 'INSUFFISANT — sous le plafond mais au-dessus de l objectif de 4 s'
         else 'OK — pire cas sous 4 s'
       end as verdict
  from public.bench_mesures
 group by scenario
 order by max(ms);

\echo ''
\echo '════════ ÉCHECS DÉTAILLÉS (vide = aucun) ════════'
select scenario, rang, ms, sqlstate,
       case when sqlstate = '57014' then 'PLAFOND 8 s ATTEINT — transaction annulée' else left(issue, 90) end as cause
  from public.bench_mesures
 where issue <> 'ok'
 order by id;

\echo ''
\echo '════════ VOLUMÉTRIE AU MOMENT DU RAPPORT ════════'
select 'program_weeks' t, count(*) n from public.program_weeks
union all select 'workout_sessions', count(*) from public.workout_sessions
union all select 'training_blocks', count(*) from public.training_blocks
union all select 'workout_exercises', count(*) from public.workout_exercises
union all select 'training_prescriptions', count(*) from public.training_prescriptions;

\echo ''
\echo '════════ IDENTITÉ DES PRESCRIPTIONS APRÈS TOUTES LES RÉPÉTITIONS ════════'
\echo 'created_at est posé à la création : si le lot D tient ses promesses, aucune'
\echo 'prescription du décor (créée avant le banc) ne doit avoir été recréée.'
select count(*) as prescriptions_du_decor_encore_vivantes
  from public.training_prescriptions
 where id::text like '88880000-%';
