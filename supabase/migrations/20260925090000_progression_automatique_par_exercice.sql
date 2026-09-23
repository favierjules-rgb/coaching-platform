-- ═══════════════════════════════════════════════════════════════════════════
-- LE RÉGLAGE « PROGRESSION AUTOMATIQUE » APPARTIENT AU COUPLE
-- (PROGRAMME, EXERCICE) — JAMAIS À UNE LIGNE D'EXERCICE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ POURQUOI PAS UNE COLONNE SUR `workout_exercises`, QUI SEMBLAIT ÉVIDENT.
-- Trois faits du schéma l'interdisent :
--
--   1. `workout_exercises.session_id → workout_sessions.program_week_id`.
--      Cette table est rattachée à une SEMAINE. Une colonne y vivant
--      produirait N lignes pour N semaines, chacune modifiable
--      indépendamment : « Élévations latérales » pourrait être ON en semaine
--      1 et OFF en semaine 3. La règle posée est l'inverse exact — le
--      réglage est GLOBAL à l'exercice dans le programme.
--   2. Les identifiants de ligne sont RÉGÉNÉRÉS à chaque duplication :
--      `duplicateBlock` (lib/training-block-editing.ts) pose un
--      `new-exercise:<uuid>` neuf sur chaque exercice copié. Un réglage
--      accroché à `workout_exercises.id` disparaîtrait au premier
--      « dupliquer la semaine ».
--   3. `save_training_session_blocks` SUPPRIME toute ligne absente du
--      payload à chaque sauvegarde du builder. Le réglage serait donc
--      régulièrement effacé par une sauvegarde sans rapport.
--
-- ⚠️ POURQUOI PAS `exercise_library_id` SEUL COMME IDENTITÉ.
-- La colonne est NULLABLE — tout exercice saisi en texte libre par le coach
-- n'a pas de fiche de banque (`blankExercise` dans ProgramBuilder.tsx ne la
-- renseigne pas) — et sa clé étrangère est `ON DELETE SET NULL`, donc un
-- exercice peut PERDRE son identité de banque après coup. Une table qui
-- n'accepterait que cette identité laisserait sans réglage possible une part
-- réelle du catalogue.
--
-- D'où DEUX colonnes d'identité mutuellement exclusives, et le CHECK qui
-- l'impose. C'est exactement la hiérarchie que le code applique déjà partout
-- pour reconnaître un exercice (`findPreviousPerformance` :
-- `exercise_library_id` d'abord, nom normalisé ensuite).
--
-- ⚠️ LE CARACTÈRE « GLOBAL » EST GARANTI PAR LA STRUCTURE, PAS PAR LE CODE.
-- La clé unique est (programme, identité d'exercice). Il ne PEUT pas exister
-- deux valeurs différentes pour deux semaines : il n'y a qu'une ligne, et
-- aucune colonne de semaine, de séance ou de bloc pour en créer une seconde.
-- Aucune synchronisation applicative n'est nécessaire — donc aucune
-- synchronisation applicative ne peut échouer.
--
-- ⚠️ DÉFAUT `false`, ET AUCUN BACKFILL.
-- Décision explicite du propriétaire du projet. Aucune ligne n'est écrite par
-- cette migration : tous les exercices existants restent donc sans réglage,
-- ce que le code lit comme OFF. Conséquence voulue : pas un seul programme en
-- production ne change de comportement, et aucune recommandation de charge
-- n'apparaît à un élève avant qu'un coach ne l'ait activée exercice par
-- exercice. Un backfill à `true` aurait allumé la fonctionnalité sur toute la
-- production d'un coup, sans validation.
--
-- ⚠️ CETTE MIGRATION N'EST PAS APPLIQUÉE. Aucun `supabase db push` n'a été
-- lancé. Elle est déclarée aux registres (supabase/baseline/manifest.json et
-- scripts/tests/contrat-migrations.mts) pour que le bootstrap local et le
-- contrat restent vrais.

create table if not exists public.program_exercise_progression (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,

  -- IDENTITÉ 1 — la fiche de banque, quand elle existe. `on delete cascade`
  -- et non `set null` : sans sa fiche, la ligne ne désignerait plus rien et
  -- violerait le CHECK. Le réglage disparaît donc avec la fiche, et
  -- l'exercice revient au défaut (OFF) — un état lisible, pas une ligne
  -- orpheline.
  exercise_library_id uuid references public.exercise_library (id) on delete cascade,

  -- IDENTITÉ 2 — le nom NORMALISÉ (sans accents, minuscules, espaces
  -- repliés), pour les exercices en texte libre. La normalisation est faite
  -- par le code appelant (`normalizeExerciseName`), une seule fois, à
  -- l'écriture : dupliquer cette règle en SQL créerait deux normalisations
  -- qui divergeraient.
  exercise_name_normalized text,

  progression_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- EXACTEMENT UNE des deux identités. Sans ce CHECK, une ligne portant les
  -- deux serait comptée deux fois par les deux index uniques, et une ligne
  -- n'en portant aucune serait un réglage qui ne désigne aucun exercice.
  constraint program_exercise_progression_identite_exclusive check (
    (exercise_library_id is not null and exercise_name_normalized is null)
    or (
      exercise_library_id is null
      and exercise_name_normalized is not null
      and length(btrim(exercise_name_normalized)) > 0
    )
  )
);

comment on table public.program_exercise_progression is
  'Réglage « progression automatique » ON/OFF d''un exercice DANS un programme. Une seule ligne par (programme, exercice) : le réglage est global à toutes les semaines du programme PAR CONSTRUCTION, aucune colonne de semaine n''existe ici. Absence de ligne = OFF. Ne jamais déplacer ce réglage sur workout_exercises : cette table est rattachée à une séance, donc à une semaine, et ses identifiants sont régénérés à chaque duplication.';

comment on column public.program_exercise_progression.exercise_library_id is
  'Identité PRIORITAIRE de l''exercice : sa fiche de banque. Exclusive avec exercise_name_normalized (CHECK). Survit à un renommage de l''exercice dans le programme.';

comment on column public.program_exercise_progression.exercise_name_normalized is
  'Identité de REPLI pour un exercice saisi en texte libre (sans fiche de banque). Nom déjà normalisé par normalizeExerciseName côté code — jamais renormalisé en SQL. Exclusive avec exercise_library_id (CHECK).';

comment on column public.program_exercise_progression.progression_active is
  'true = le moteur de progression automatique produit une recommandation pour cet exercice. false ou ligne absente = aucune recommandation. L''historique des performances reste lisible dans les deux cas.';

-- ── Unicité : deux index PARTIELS, un par identité ────────────────────────
-- Un seul index sur (program_id, exercise_library_id, exercise_name_normalized)
-- ne servirait à rien : en SQL, NULL n'est jamais égal à NULL, donc deux
-- lignes en texte libre du même nom passeraient. Les index partiels, eux,
-- portent chacun sur les lignes où leur colonne est renseignée.
create unique index if not exists program_exercise_progression_banque_uidx
  on public.program_exercise_progression (program_id, exercise_library_id)
  where exercise_library_id is not null;

create unique index if not exists program_exercise_progression_nom_uidx
  on public.program_exercise_progression (program_id, exercise_name_normalized)
  where exercise_name_normalized is not null;

-- Lecture réelle du produit : « tous les réglages de CE programme », une
-- fois, à l'ouverture du builder et à l'ouverture d'une séance élève. Jamais
-- une requête par exercice.
create index if not exists program_exercise_progression_program_idx
  on public.program_exercise_progression (program_id);

-- ── PRIVILÈGES — sans eux, la RLS n'est même jamais consultée ─────────────
-- ⚠️ CE BLOC MANQUAIT, ET C'ÉTAIT BLOQUANT. Postgres vérifie les privilèges
-- de TABLE avant d'évaluer la moindre policy : sans `grant`, chaque lecture et
-- chaque écriture échouerait sur « permission denied for table
-- program_exercise_progression », policies parfaitement correctes ou non.
--
-- Le baseline porte bien `alter default privileges … grant all on tables to
-- authenticated`, mais ce défaut ne s'applique qu'aux tables créées PAR LE
-- RÔLE `postgres`. S'en remettre à lui rendrait l'accès dépendant du rôle
-- qui applique la migration. Les cinq migrations qui créent une table avant
-- celle-ci posent toutes leurs privilèges explicitement (c4_1, c4_2, c3,
-- n1_7, c5_1) : on suit la même règle.
--
-- ⚠️ ET CETTE TABLE EST ÉCRITE DEPUIS LE NAVIGATEUR, pas par un route handler
-- en service-role : le coach bascule le bouton dans le builder, donc le rôle
-- `authenticated` a réellement besoin d'`insert` et d'`update`. C'est la RLS,
-- et elle seule, qui restreint ces droits au staff (`is_coach_or_admin`).
--
-- ⚠️ AUCUN `delete` À `authenticated`. Rien dans le produit ne supprime un
-- réglage — on le bascule. Et comme « absence de ligne = OFF », un delete
-- serait une extinction silencieuse, indistinguable d'un réglage jamais posé.
-- `anon` n'a rien : un visiteur non connecté n'a aucun programme.
revoke all on table public.program_exercise_progression from public, anon, authenticated;
grant select, insert, update on table public.program_exercise_progression to authenticated;
grant all on table public.program_exercise_progression to service_role;

-- ── RLS — calquée sur `program_weeks`, sans l'élargir ─────────────────────
-- Le staff gère ; l'élève LIT le réglage des programmes qui lui sont
-- réellement affectés et publiés. Il doit pouvoir lire : sans cela, sa page
-- de séance ne saurait pas si la progression est active, et l'indicateur
-- n'apparaîtrait jamais. Il ne doit rien écrire : le réglage est une décision
-- de coach.
alter table public.program_exercise_progression enable row level security;

drop policy if exists program_exercise_progression_manage_staff
  on public.program_exercise_progression;
create policy program_exercise_progression_manage_staff
  on public.program_exercise_progression
  using (public.is_coach_or_admin())
  with check (public.is_coach_or_admin());

drop policy if exists program_exercise_progression_select_assigned_student
  on public.program_exercise_progression;
create policy program_exercise_progression_select_assigned_student
  on public.program_exercise_progression
  for select
  using (
    exists (
      select 1
      from public.assignments a
        join public.programs p on p.id = a.content_id
      where a.content_type = 'programme'
        and a.content_id = program_exercise_progression.program_id
        and a.student_id = public.current_student_id()
        and p.publication_status = 'published'
    )
  );

-- `updated_at` tenu par le même déclencheur que le reste du schéma, s'il
-- existe. La garde évite de faire échouer le bootstrap d'une base qui ne
-- porterait pas cette fonction.
do $$
begin
  if exists (
    select 1 from pg_proc pr
      join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.proname = 'set_updated_at'
  ) then
    execute $ddl$
      drop trigger if exists program_exercise_progression_set_updated_at
        on public.program_exercise_progression;
      create trigger program_exercise_progression_set_updated_at
        before update on public.program_exercise_progression
        for each row execute function public.set_updated_at();
    $ddl$;
  end if;
end
$$;
