-- Programmes de groupe (chantier module Programmation, étape 5) : un
-- programme "groupe" utilise une date de démarrage fixe (partagée par tous
-- les élèves assignés) au lieu de la date de suivi individuelle de chaque
-- élève pour calculer la semaine courante. Défaut 'individuel' : aucun
-- impact sur les programmes existants.
alter table public.programs
  add column if not exists program_mode text not null default 'individuel' check (program_mode in ('individuel', 'groupe')),
  add column if not exists group_start_date date;
