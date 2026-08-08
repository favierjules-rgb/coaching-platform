-- ────────────────────────────────────────────────────────────────────────────
-- F3 — Patterns de mouvement, remplacement d'exercice par l'élève,
--      et fermeture de la faille d'écriture sur les retours de séance.
--      (chantier feat/training-movement-patterns)
--
-- CE QUE FAIT CETTE MIGRATION, DANS L'ORDRE :
--   1. `exercise_library.movement_pattern` — vocabulaire contrôlé de 36
--      valeurs couvrant toutes les articulations. Colonne NULLABLE : la
--      banque existante n'en porte aucun et reste valide telle quelle.
--   2. `exercise_feedback.substitute_exercise_library_id` +
--      `substitute_exercise_name` — trace du remplacement DANS le retour,
--      comme demandé. `exercise_name` continue de porter le nom PRESCRIT :
--      le coach voit ce qu'il avait demandé ET ce qui a été fait.
--   3. Trigger `enforce_exercise_feedback_substitution` — le NOM du
--      remplaçant est DÉRIVÉ de son identifiant, jamais accepté du client ;
--      et le remplaçant doit réellement partager le pattern de l'exercice
--      prescrit. La règle métier vit donc en BASE, pas seulement à l'écran.
--   4. Trigger `protect_workout_feedback_coach_columns` — un élève ne peut
--      plus écrire `status` ni `coach_reply` de son propre retour. La
--      politique `workout_feedback_student_or_staff` est [ALL] avec un
--      simple `student_id = current_student_id()` : elle laissait un élève
--      marquer son retour « traité » ou fabriquer une réponse de coach.
--   5. RPC `list_exercise_substitutes` — remplaçants candidats d'un
--      exercice de banque, sous RLS.
--
-- STRICTEMENT ADDITIVE. Aucune colonne supprimée, aucune donnée
-- transformée, aucune politique existante modifiée ou remplacée, aucune
-- migration déjà appliquée touchée. Idempotente : rejouable sans effet.
--
-- NE PAS exécuter en Production sans validation explicite.
-- ────────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────────
-- 1. Pattern de mouvement sur la banque d'exercices
-- ────────────────────────────────────────────────────────────────────────────
-- Un groupe musculaire ne suffit pas à décider qu'un exercice en remplace un
-- autre : « pectoraux » réunit le développé couché et l'écarté. Le pattern
-- décrit l'ACTION ARTICULAIRE, seule base honnête d'un échange.
--
-- Le vocabulaire est dupliqué dans lib/movement-patterns.ts (TypeScript) :
-- c'est assumé et VÉRIFIÉ — scripts/tests/training-movement-patterns.mts
-- relit ce CHECK et compare les deux listes, valeur par valeur.
alter table public.exercise_library
  add column if not exists movement_pattern text;

comment on column public.exercise_library.movement_pattern is
  'Pattern de mouvement (action articulaire). NULL = non renseigné : l''exercice n''offre alors aucun remplaçant. Vocabulaire figé par exercise_library_movement_pattern_check et dupliqué dans lib/movement-patterns.ts.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercise_library_movement_pattern_check') then
    alter table public.exercise_library
      add constraint exercise_library_movement_pattern_check
      check (
        movement_pattern is null
        or movement_pattern = any (array[
          -- Haut du corps — poussée / tirage
          'poussee_horizontale', 'poussee_verticale', 'tirage_horizontal', 'tirage_vertical',
          -- Épaule — isolation
          'elevation_laterale', 'elevation_frontale', 'elevation_posterieure',
          'rotation_externe_epaule', 'rotation_interne_epaule',
          -- Coude / poignet
          'flexion_coude', 'extension_coude', 'flexion_poignet', 'extension_poignet', 'pronosupination',
          -- Hanche / genou
          'squat', 'fente', 'charniere_de_hanche', 'extension_de_hanche',
          'extension_genou', 'flexion_genou', 'abduction_hanche', 'adduction_hanche', 'rotation_hanche',
          -- Cheville
          'flexion_plantaire', 'flexion_dorsale',
          -- Tronc
          'flexion_tronc', 'extension_tronc', 'rotation_tronc',
          'anti_extension', 'anti_rotation', 'anti_flexion_laterale',
          -- Global
          'port_de_charge', 'haltero', 'pliometrie', 'locomotion', 'mobilite'
        ])
      );
  end if;
end $$;

-- Index PARTIEL : la recherche de remplaçants ne consulte jamais les
-- exercices sans pattern, qui sont aujourd'hui la totalité de la banque.
create index if not exists exercise_library_movement_pattern_idx
  on public.exercise_library (movement_pattern)
  where movement_pattern is not null;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Trace du remplacement dans le retour de séance
-- ────────────────────────────────────────────────────────────────────────────
-- DEUX colonnes et non une seule, pour une raison précise :
--   * l'identifiant garde le LIEN vivant vers la fiche de banque ;
--   * le nom est une PHOTOGRAPHIE, comme `prescribed_snapshot` : renommer
--     ou supprimer la fiche plus tard ne doit pas réécrire l'histoire.
-- `exercise_name` n'est jamais touché : il reste le nom PRESCRIT.
alter table public.exercise_feedback
  add column if not exists substitute_exercise_library_id uuid,
  add column if not exists substitute_exercise_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercise_feedback_substitute_exercise_library_id_fkey') then
    alter table public.exercise_feedback
      add constraint exercise_feedback_substitute_exercise_library_id_fkey
      foreign key (substitute_exercise_library_id)
      references public.exercise_library (id) on delete set null;
  end if;

  -- Un identifiant sans nom serait une trace illisible. L'INVERSE est
  -- légitime et voulu : quand la fiche de banque est supprimée, le FK passe
  -- l'identifiant à NULL et le NOM SURVIT — le coach continue de lire ce
  -- que son élève a réellement fait.
  if not exists (select 1 from pg_constraint where conname = 'exercise_feedback_substitute_shape_check') then
    alter table public.exercise_feedback
      add constraint exercise_feedback_substitute_shape_check
      check (
        substitute_exercise_library_id is null
        or (substitute_exercise_name is not null and btrim(substitute_exercise_name) <> '')
      );
  end if;
end $$;

comment on column public.exercise_feedback.substitute_exercise_library_id is
  'Fiche de banque réellement réalisée quand l''élève a déclaré l''exercice prescrit indisponible. NULL = aucun remplacement, ou fiche supprimée depuis (le nom, lui, subsiste).';
comment on column public.exercise_feedback.substitute_exercise_name is
  'Nom du remplaçant PHOTOGRAPHIÉ à l''enregistrement — dérivé de l''identifiant par le trigger enforce_exercise_feedback_substitution, jamais accepté du client.';

create index if not exists exercise_feedback_substitute_idx
  on public.exercise_feedback (substitute_exercise_library_id)
  where substitute_exercise_library_id is not null;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. La règle du remplacement vit en BASE, pas dans le navigateur
-- ────────────────────────────────────────────────────────────────────────────
-- Sans ce trigger, la politique `exercise_feedback_student_or_staff` [ALL]
-- laisse un élève écrire n'importe quel `substitute_exercise_name` par appel
-- PostgREST direct : « Squat » à la place d'un développé couché, ou un nom
-- inventé de toutes pièces. L'écran ne protège rien.
--
-- Ce que le trigger garantit, à l'INSERT d'une ligne portant un remplacement :
--   a. le nom est DÉRIVÉ de l'identifiant (le client n'en décide pas) ;
--   b. la fiche de remplacement existe et est ACTIVE ;
--   c. l'exercice PRESCRIT est identifié (`exercise_id`) et vient de la
--      banque — sans fiche source, il n'y a pas de pattern à comparer ;
--   d. les DEUX patterns sont non nuls et ÉGAUX ;
--   e. le remplaçant n'est pas l'exercice prescrit lui-même ;
--   f. l'exercice prescrit appartient bien à la séance du retour.
--
-- SECURITY DEFINER assumé : la vérification doit être AUTORITAIRE, donc
-- lire la banque et la séance sans être filtrée par la RLS de l'appelant.
-- Elle ne divulgue rien — `exercise_library_select_active` expose déjà les
-- fiches actives à tout utilisateur authentifié, et les exceptions levées
-- ne contiennent aucune donnée d'autrui.
create or replace function public.enforce_exercise_feedback_substitution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub_name text;
  v_sub_pattern text;
  v_sub_status text;
  v_src_library_id uuid;
  v_src_session_id uuid;
  v_src_pattern text;
  v_feedback_session_id uuid;
begin
  -- ── UPDATE : la trace est un fait, elle ne se réécrit pas ────────────────
  -- Le nom revient TOUJOURS à sa valeur d'origine, et l'identifiant ne peut
  -- que DISPARAÎTRE — c'est le `on delete set null` du FK quand la fiche de
  -- banque est supprimée. Le nom, lui, survit : c'est tout l'intérêt de
  -- l'avoir photographié. Aucun chemin applicatif ne modifie un
  -- remplacement (une nouvelle soumission SUPPRIME puis réinsère les lignes
  -- d'exercice), donc toute autre tentative est un appel direct.
  if tg_op = 'UPDATE' then
    new.substitute_exercise_name := old.substitute_exercise_name;
    if new.substitute_exercise_library_id is distinct from old.substitute_exercise_library_id
       and new.substitute_exercise_library_id is not null then
      raise exception 'Le remplacement d''un retour enregistré ne peut pas être modifié par UPDATE (exercise_feedback %)', old.id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── INSERT ───────────────────────────────────────────────────────────────
  -- Chemin ultra-majoritaire : aucun remplacement. Zéro requête.
  if new.substitute_exercise_library_id is null then
    new.substitute_exercise_name := null;
    return new;
  end if;

  -- a/b. La fiche de remplacement existe, est active, et porte un pattern.
  select el.name, el.movement_pattern, el.status
    into v_sub_name, v_sub_pattern, v_sub_status
    from public.exercise_library el
   where el.id = new.substitute_exercise_library_id;
  if not found then
    raise exception 'Remplacement refusé : exercice de banque introuvable (%)', new.substitute_exercise_library_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_sub_status <> 'active' then
    raise exception 'Remplacement refusé : l''exercice de remplacement est archivé (%)', new.substitute_exercise_library_id
      using errcode = 'check_violation';
  end if;
  if v_sub_pattern is null then
    raise exception 'Remplacement refusé : l''exercice de remplacement n''a pas de pattern de mouvement (%)', new.substitute_exercise_library_id
      using errcode = 'check_violation';
  end if;

  -- c. L'exercice PRESCRIT doit être identifié et venir de la banque.
  if new.exercise_id is null then
    raise exception 'Remplacement refusé : exercice prescrit non identifié (exercise_id absent)'
      using errcode = 'check_violation';
  end if;
  -- `found` et non « v_src_library_id is null » : la colonne est nullable,
  -- une ligne trouvée sans fiche de banque n'est PAS une ligne absente.
  select we.exercise_library_id, we.session_id
    into v_src_library_id, v_src_session_id
    from public.workout_exercises we
   where we.id = new.exercise_id;
  if not found then
    raise exception 'Remplacement refusé : exercice prescrit introuvable (%)', new.exercise_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_src_library_id is null then
    raise exception 'Remplacement refusé : l''exercice prescrit ne vient pas de la banque, aucun pattern à comparer (%)', new.exercise_id
      using errcode = 'check_violation';
  end if;

  -- e. Se remplacer par soi-même n'est pas un remplacement.
  if v_src_library_id = new.substitute_exercise_library_id then
    raise exception 'Remplacement refusé : le remplaçant est l''exercice prescrit lui-même (%)', v_src_library_id
      using errcode = 'check_violation';
  end if;

  -- d. Même pattern, sinon ce n'est pas un remplacement mais un autre exercice.
  select el.movement_pattern into v_src_pattern
    from public.exercise_library el
   where el.id = v_src_library_id;
  if v_src_pattern is null then
    raise exception 'Remplacement refusé : l''exercice prescrit n''a pas de pattern de mouvement (%)', v_src_library_id
      using errcode = 'check_violation';
  end if;
  if v_src_pattern <> v_sub_pattern then
    raise exception 'Remplacement refusé : patterns de mouvement différents (% ≠ %)', v_src_pattern, v_sub_pattern
      using errcode = 'check_violation';
  end if;

  -- f. L'exercice prescrit appartient bien à la séance de CE retour.
  --    (`session_id` est nul pour les séances hors Supabase : rien à vérifier.)
  select wf.session_id into v_feedback_session_id
    from public.workout_feedback wf
   where wf.id = new.workout_feedback_id;
  if v_feedback_session_id is not null and v_src_session_id is distinct from v_feedback_session_id then
    raise exception 'Remplacement refusé : l''exercice prescrit n''appartient pas à la séance du retour'
      using errcode = 'check_violation';
  end if;

  -- a. Le nom est DÉRIVÉ, jamais reçu.
  new.substitute_exercise_name := v_sub_name;
  return new;
end;
$$;

alter function public.enforce_exercise_feedback_substitution() owner to postgres;

comment on function public.enforce_exercise_feedback_substitution() is
  'Dérive substitute_exercise_name de substitute_exercise_library_id et vérifie qu''un remplacement partage réellement le pattern de mouvement de l''exercice prescrit. La trace d''un retour enregistré n''est jamais réécrite ; la suppression de la fiche de banque laisse le nom intact.';

revoke all on function public.enforce_exercise_feedback_substitution() from public;
revoke execute on function public.enforce_exercise_feedback_substitution() from anon;
revoke execute on function public.enforce_exercise_feedback_substitution() from authenticated;

drop trigger if exists enforce_exercise_feedback_substitution on public.exercise_feedback;
create trigger enforce_exercise_feedback_substitution
  before insert or update on public.exercise_feedback
  for each row
  execute function public.enforce_exercise_feedback_substitution();


-- ────────────────────────────────────────────────────────────────────────────
-- 4. `workout_feedback` : l'élève ne touche pas ce qui appartient au coach
-- ────────────────────────────────────────────────────────────────────────────
-- FAILLE CORRIGÉE ICI. `workout_feedback_student_or_staff` est une politique
-- [ALL] dont le prédicat est `student_id = current_student_id() or
-- is_coach_or_admin()`. Elle décide QUELLES LIGNES sont accessibles, jamais
-- QUELLES COLONNES : un élève pouvait donc, par un simple PATCH PostgREST
-- sur son propre retour, passer `status` à « traité » (le retour disparaît
-- de la file du coach) ou écrire un `coach_reply` que l'application affiche
-- ensuite comme la parole du coach.
--
-- Même motif que `protect_nutrition_days_coach_columns` (migration
-- 20260810090000) : un trigger BEFORE restaure les valeurs d'origine au lieu
-- de refuser la ligne. Conséquence à connaître pour les tests : l'UPDATE
-- rapporte bien « 1 ligne », mais la VALEUR n'a pas bougé — on mesure donc
-- la valeur, jamais le nombre de lignes.
create or replace function public.protect_workout_feedback_coach_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Contextes non-utilisateur (webhook, tâches service) et staff : inchangés.
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if public.is_coach_or_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Un retour naît toujours « à traiter » et sans réponse de coach, quoi
    -- que le client envoie. Le chemin applicatif ne fournit ni l'un ni
    -- l'autre : il lit les valeurs par défaut en retour d'insertion.
    new.status := 'a-traiter';
    new.coach_reply := '';
    return new;
  end if;

  new.status := old.status;
  new.coach_reply := old.coach_reply;
  return new;
end;
$$;

alter function public.protect_workout_feedback_coach_columns() owner to postgres;

comment on function public.protect_workout_feedback_coach_columns() is
  'Réserve workout_feedback.status et coach_reply au staff : un élève ne peut ni marquer son retour traité, ni fabriquer une réponse de coach. Le staff et les contextes service ne sont pas concernés.';

revoke all on function public.protect_workout_feedback_coach_columns() from public;
revoke execute on function public.protect_workout_feedback_coach_columns() from anon;
revoke execute on function public.protect_workout_feedback_coach_columns() from authenticated;

-- Nom choisi pour passer AVANT `workout_feedback_snapshot_immutable` dans
-- l'ordre alphabétique des triggers BEFORE (PostgreSQL les déclenche par
-- nom) : les deux touchent des colonnes disjointes, l'ordre n'a donc aucune
-- conséquence — c'est vérifié, pas supposé.
drop trigger if exists protect_workout_feedback_coach_columns on public.workout_feedback;
create trigger protect_workout_feedback_coach_columns
  before insert or update on public.workout_feedback
  for each row
  execute function public.protect_workout_feedback_coach_columns();


-- ────────────────────────────────────────────────────────────────────────────
-- 5. Remplaçants candidats d'un exercice de banque
-- ────────────────────────────────────────────────────────────────────────────
-- `security invoker` : la RLS de l'appelant s'applique intégralement, donc
-- la fonction ne peut RIEN montrer que l'appelant ne pourrait déjà lire par
-- lui-même (`exercise_library_select_active` pour un élève, la politique
-- staff pour un coach). Elle ne fait qu'éviter au navigateur deux allers-
-- retours et l'obligation de connaître la règle de regroupement.
--
-- Conséquence assumée : si la fiche SOURCE est archivée, l'élève ne la lit
-- pas et aucun remplaçant n'est proposé. C'est cohérent — un exercice
-- retiré de la banque ne devrait plus être prescrit.
create or replace function public.list_exercise_substitutes(p_exercise_library_id uuid)
returns table (
  id uuid,
  name text,
  video_url text,
  alternative_video_url text,
  muscle_group text,
  equipment text,
  level text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select el.id, el.name, el.video_url, el.alternative_video_url,
         el.muscle_group, el.equipment, el.level
    from public.exercise_library el
   where el.status = 'active'
     and el.id <> p_exercise_library_id
     and el.movement_pattern is not null
     and el.movement_pattern = (
       select src.movement_pattern
         from public.exercise_library src
        where src.id = p_exercise_library_id
     )
   order by el.name
   limit 50;
$$;

alter function public.list_exercise_substitutes(uuid) owner to postgres;

comment on function public.list_exercise_substitutes(uuid) is
  'Exercices actifs partageant le pattern de mouvement de la fiche donnée (elle-même exclue), triés par nom, 50 au plus. security invoker : la RLS de l''appelant s''applique.';

revoke all on function public.list_exercise_substitutes(uuid) from public;
revoke execute on function public.list_exercise_substitutes(uuid) from anon;
grant execute on function public.list_exercise_substitutes(uuid) to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Contrôle final — la migration échoue si elle est incomplète
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_manque text := '';
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'exercise_library'
       and column_name = 'movement_pattern'
  ) then v_manque := v_manque || ' exercise_library.movement_pattern'; end if;

  if not exists (select 1 from pg_constraint where conname = 'exercise_library_movement_pattern_check') then
    v_manque := v_manque || ' exercise_library_movement_pattern_check';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'exercise_feedback'
       and column_name = 'substitute_exercise_library_id'
  ) then v_manque := v_manque || ' exercise_feedback.substitute_exercise_library_id'; end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'exercise_feedback'
       and column_name = 'substitute_exercise_name'
  ) then v_manque := v_manque || ' exercise_feedback.substitute_exercise_name'; end if;

  if not exists (select 1 from pg_constraint where conname = 'exercise_feedback_substitute_shape_check') then
    v_manque := v_manque || ' exercise_feedback_substitute_shape_check';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'exercise_feedback_substitute_exercise_library_id_fkey') then
    v_manque := v_manque || ' exercise_feedback_substitute_exercise_library_id_fkey';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'enforce_exercise_feedback_substitution'
       and tgrelid = 'public.exercise_feedback'::regclass
  ) then v_manque := v_manque || ' trigger:enforce_exercise_feedback_substitution'; end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'protect_workout_feedback_coach_columns'
       and tgrelid = 'public.workout_feedback'::regclass
  ) then v_manque := v_manque || ' trigger:protect_workout_feedback_coach_columns'; end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_exercise_substitutes'
  ) then v_manque := v_manque || ' list_exercise_substitutes'; end if;

  -- Les deux fonctions de garde ne doivent JAMAIS être appelables directement.
  if has_function_privilege('authenticated', 'public.enforce_exercise_feedback_substitution()', 'execute') then
    v_manque := v_manque || ' privilege:enforce_exercise_feedback_substitution(authenticated)';
  end if;
  if has_function_privilege('authenticated', 'public.protect_workout_feedback_coach_columns()', 'execute') then
    v_manque := v_manque || ' privilege:protect_workout_feedback_coach_columns(authenticated)';
  end if;
  if has_function_privilege('anon', 'public.list_exercise_substitutes(uuid)', 'execute') then
    v_manque := v_manque || ' privilege:list_exercise_substitutes(anon)';
  end if;
  if not has_function_privilege('authenticated', 'public.list_exercise_substitutes(uuid)', 'execute') then
    v_manque := v_manque || ' privilege:list_exercise_substitutes(authenticated manquant)';
  end if;

  if v_manque <> '' then
    raise exception 'MIGRATION INCOMPLÈTE —%', v_manque;
  end if;
end $$;
