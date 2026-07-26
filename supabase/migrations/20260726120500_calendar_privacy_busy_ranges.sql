-- Chantier "admin-apple-calendar" — 2/3 : confidentialité des événements du
-- coach + source neutre des périodes occupées.
--
-- Constat d'audit : la policy `coach_unavailabilities_select_authenticated`
-- exposait `reason` (et aurait exposé title/notes/location) à tout élève
-- authentifié via l'API. On la retire : la table devient lisible par le
-- staff uniquement, et les élèves obtiennent les périodes occupées via la
-- RPC `get_busy_ranges`, qui ne renvoie QUE des bornes horaires anonymes
-- (aucun titre, motif, catégorie, lieu, ni identité d'élève).
--
-- Bonus de correction (autorisé condition 7 : « correction du calcul des
-- créneaux occupés ») : l'élève ne voyait que SES propres RDV comme périodes
-- réservées (RLS), donc les créneaux réservés par d'autres élèves semblaient
-- libres côté client. get_busy_ranges agrège TOUS les RDV bloquants côté
-- serveur, sans révéler à qui ils appartiennent.

drop policy if exists coach_unavailabilities_select_authenticated on public.coach_unavailabilities;

create or replace function public.get_busy_ranges(p_from timestamptz, p_to timestamptz)
returns table (start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  -- Structure volontairement neutre : bornes uniquement, triées.
  select a.start_at, a.end_at
  from public.appointments a
  where a.status in ('pending', 'confirmed')
    and a.start_at < p_to
    and a.end_at > p_from
  union all
  select u.start_at, u.end_at
  from public.coach_unavailabilities u
  where u.start_at < p_to
    and u.end_at > p_from
  order by 1;
$$;

revoke all on function public.get_busy_ranges(timestamptz, timestamptz) from public;
-- Les default privileges Supabase accordent EXECUTE à anon sur toute nouvelle
-- fonction, et `revoke ... from public` ne retire PAS ce grant nominatif :
-- REVOKE explicite obligatoire (constat du test local PHASE 2.5).
revoke execute on function public.get_busy_ranges(timestamptz, timestamptz) from anon;
grant execute on function public.get_busy_ranges(timestamptz, timestamptz) to authenticated;

comment on function public.get_busy_ranges(timestamptz, timestamptz) is
  'Périodes occupées (RDV pending/confirmed + événements coach) sur [p_from, p_to) — bornes anonymes uniquement, pour le calcul des créneaux réservables (élève et admin).';
