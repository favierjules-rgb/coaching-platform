-- ════════════════════════════════════════════════════════════════════════════
-- ATTRIBUTION — à QUELLE étape va le temps d'une sauvegarde groupée ?
-- Diagnostic, pas validation : on décompose, on ne juge pas.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
drop table if exists public.attr;
create table public.attr (etape text, rang int, ms numeric, detail text);
grant all on public.attr to authenticated;
alter table public.attr enable row level security;
create policy attr_tout on public.attr for all using (true) with check (true);

-- Charge d'UNE séance, au format du moteur (pas de la RPC groupée).
create or replace function public.attr_charge_seance(p_session uuid, p_jeton text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'session_id', p_session,
    'expected_updated_at', (select updated_at from public.workout_sessions where id = p_session),
    'blocks', coalesce((
      select jsonb_agg(
        case when tb.block_type = 'strength' then
          jsonb_build_object('id', tb.id::text, 'category','strength','title',tb.title,
            'color_key',tb.color_key,'position',tb.position,
            'exercises', coalesce((select jsonb_agg(jsonb_build_object(
                'id', we.id::text,'name',we.name,'sets',we.sets,'reps',we.reps,
                'rest_seconds',we.rest_seconds,'tempo',we.tempo,
                'recommended_load',we.recommended_load,'recommended_rpe','',
                'video_url',we.video_url,'notes', we.notes || ' ' || p_jeton,
                'muscle_group',we.muscle_group,'exercise_library_id',null)
              order by we.order_index)
              from public.workout_exercises we where we.block_id = tb.id), '[]'::jsonb))
        else
          jsonb_build_object('id', tb.id::text,'category','cardio','title',tb.title,
            'color_key',tb.color_key,'position',tb.position,
            'cardio_type',tb.cardio_type,'machine_type',null,'sport',null,'rounds',null,
            'prescriptions', coalesce((select jsonb_agg(jsonb_build_object(
                'id', tp.id::text,'segment_type',tp.segment_type,
                'title', coalesce(tp.title,'') || ' ' || p_jeton,
                'work_duration_seconds',tp.work_duration_seconds,
                'intensity_target_type',tp.intensity_target_type)
              order by tp.position)
              from public.training_prescriptions tp where tp.block_id = tb.id), '[]'::jsonb))
        end order by tb.position)
      from public.training_blocks tb where tb.session_id = p_session), '[]'::jsonb));
$$;
grant execute on function public.attr_charge_seance(uuid,text) to authenticated;

create or replace procedure public.attr_mesurer(p_etape text, p_rang int, p_charge jsonb, p_detail text)
language plpgsql as $$
declare v_t timestamptz;
begin
  v_t := clock_timestamp();
  perform public.save_training_session_blocks(p_charge);
  insert into public.attr values (p_etape, p_rang,
    round(extract(epoch from (clock_timestamp()-v_t))*1000,1), p_detail);
  commit;
end $$;
grant execute on procedure public.attr_mesurer(text,int,jsonb,text) to authenticated;
\echo 'ATTRIBUTION PRÊTE'
