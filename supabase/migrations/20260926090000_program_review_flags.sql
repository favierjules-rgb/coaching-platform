-- ============================================================================
-- LE RAPPEL « À JOUR / À VÉRIFIER » DU COACH — UNE TABLE, ET RIEN DANS `programs`
-- ============================================================================
--
-- ── CE QUE CETTE MIGRATION FAIT ────────────────────────────────────────────
--   1. crée la table `public.program_review_flags` (une ligne par programme) ;
--   2. active RLS dessus et pose UNE policy : staff seulement ;
--   3. rien d'autre. Aucune colonne ajoutée ailleurs, aucune table modifiée,
--      aucun trigger, aucune donnée réécrite.
--
-- ── POURQUOI PAS UNE COLONNE SUR `programs` ────────────────────────────────
-- Parce que ce drapeau ne fait PAS partie du programme. Une écriture dans
-- `programs` toucherait `updated_at`, que la sauvegarde du builder utilise pour
-- détecter les modifications concurrentes (`expected_updated_at`, voir
-- `diffProgramStructure`) : cocher une pastille aurait pu faire croire au
-- builder que quelqu'un venait de modifier le programme. Un pense-bête
-- d'interface ne doit pas pouvoir perturber une sauvegarde.
--
-- ── POURQUOI UNE SEMAINE, ET PAS UN BOOLÉEN ────────────────────────────────
-- On stocke la SEMAINE validée (le lundi, en `date`). L'état se dérive à la
-- lecture : « à jour » ⟺ semaine validée = semaine d'aujourd'hui. Le retour
-- automatique à « à vérifier » le lundi suivant est donc une conséquence du
-- calendrier, pas une tâche planifiée. Un booléen aurait exigé un balayage
-- hebdomadaire — un planificateur de plus, qui en tombant laisserait un
-- « À JOUR » mensonger affiché.
--
-- ── CE QUE CETTE TABLE NE PEUT PAS CASSER ──────────────────────────────────
-- Elle n'est lue et écrite que par l'interface coach. Sa suppression complète
-- ferait réapparaître « À vérifier » partout, et rien de plus : ni programme,
-- ni séance, ni progression, ni notification n'en dépend.
-- ============================================================================

create table if not exists public.program_review_flags (
  program_id    uuid primary key references public.programs (id) on delete cascade,

  -- Le LUNDI de la semaine validée (convention lundi → dimanche de toute
  -- l'application, voir `semaineContenant`). `date` et non `timestamptz` : la
  -- semaine d'un coach n'a pas de fuseau, et une comparaison de dates ne peut
  -- pas basculer à cause d'une heure.
  verified_week date not null,

  -- Quand et par qui, pour que « À jour » soit imputable. `set null` : le
  -- départ d'un coach ne doit pas effacer l'état de vérification des
  -- programmes qu'il suivait.
  verified_at   timestamptz not null default now(),
  verified_by   uuid references auth.users (id) on delete set null
);

comment on table public.program_review_flags is
  'Pense-bête coach « À jour / À vérifier » par programme. La semaine validée (lundi) est stockée : l''état se dérive à la lecture, aucun cron ne le réinitialise.';
comment on column public.program_review_flags.verified_week is
  'Lundi de la semaine pour laquelle le coach a déclaré le programme à jour. Différent du lundi courant = « À vérifier ».';

-- ── RLS — RIEN N'EST LISIBLE NI ÉCRIVABLE PAR DÉFAUT ───────────────────────
alter table public.program_review_flags enable row level security;

-- Un élève n'a aucune raison de voir, ni de poser, le pense-bête de son coach :
-- une seule policy, pour le staff, en lecture comme en écriture.
create policy program_review_flags_staff on public.program_review_flags
  for all to authenticated
  using (public.is_coach_or_admin())
  with check (public.is_coach_or_admin());
