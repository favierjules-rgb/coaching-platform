-- Chantier "admin-apple-calendar" — 1/3 : événements du coach.
--
-- `coach_unavailabilities` reste LA table des périodes qui bloquent les
-- créneaux élèves (rôle métier inchangé — audit condition 6 : le modèle
-- reste non ambigu car une indisponibilité, un événement personnel et un
-- événement professionnel sont tous, du point de vue des élèves, la même
-- chose : une période non réservable). Colonnes additives uniquement, les
-- lignes existantes restent des indisponibilités simples.
--
-- Confidentialité : title/notes/location sont PRIVÉS — la migration 2/3
-- retire la lecture élève de cette table.

alter table public.coach_unavailabilities
  add column if not exists category text not null default 'unavailability',
  add column if not exists title text not null default '',
  add column if not exists notes text not null default '',
  add column if not exists location text not null default '',
  add column if not exists all_day boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_unavailabilities_category_check'
      and conrelid = 'public.coach_unavailabilities'::regclass
  ) then
    alter table public.coach_unavailabilities
      add constraint coach_unavailabilities_category_check
      check (category in ('unavailability', 'personal', 'professional'));
  end if;
end $$;

comment on column public.coach_unavailabilities.category is
  'unavailability (historique, onglet Disponibilités) | personal | professional (événements privés admin, chantier admin-apple-calendar)';
comment on column public.coach_unavailabilities.title is
  'Titre privé — JAMAIS exposé aux élèves (voir get_busy_ranges)';
comment on column public.coach_unavailabilities.notes is
  'Notes privées admin';
