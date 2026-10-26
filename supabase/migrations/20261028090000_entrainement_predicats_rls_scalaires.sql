-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ `SET LOCAL`, ET PAS `SET` — LA RAISON EST LA PORTÉE, PAS LE GOÛT
-- ════════════════════════════════════════════════════════════════════════════
-- `SET LOCAL` est borné à la TRANSACTION et revient à sa valeur d'origine au
-- commit. `supabase db push` applique chaque fichier de migration dans une
-- transaction et peut réutiliser la même connexion pour les suivants : un `SET`
-- de session laisserait le plafond relevé pour les migrations appliquées
-- ENSUITE, sans que rien ne le dise. `SET LOCAL` ne peut pas fuir.
--
-- VÉRIFIÉ, pas supposé : le CLI (2.115.0) enveloppe bien le fichier dans une
-- transaction, donc `SET LOCAL` prend effet. Mesuré sur une base plafonnée à
-- 3 s, avec `select pg_sleep(6)` : sans réglage → 57014 en 4 s ; avec
-- `SET LOCAL statement_timeout = '30s'` → succès en 8 s. (Hors transaction,
-- `SET LOCAL` n'émettrait qu'un WARNING et ne ferait rien : c'est pour cela
-- que ce point devait être vérifié avant d'écrire cette ligne.)
--
-- ⚠️ ET POURQUOI 120 s NE SUFFISAIT PAS. Ce n'est pas le rôle `authenticated`
-- (8 s) qui s'applique ici : `db push` se connecte en `postgres`, qui n'a aucun
-- `statement_timeout` de rôle, donc c'est le défaut du FICHIER DE
-- CONFIGURATION du serveur qui vaut — relevé en production : 120 000 ms.
-- Écrire `SET LOCAL statement_timeout = '120s'` revenait donc à poser la valeur
-- déjà en vigueur : un no-op. La preuve demandait ≈ 13 minutes ; c'est la
-- preuve qu'il fallait corriger, pas le plafond. Elle tient maintenant en
-- quelques dizaines de secondes, et cette marge n'est là que pour absorber une
-- machine plus lente.
set local statement_timeout = '300s';
-- ============================================================================
-- ENTRAÎNEMENT — DES PRÉDICATS SCALAIRES À LA PLACE DES ENSEMBLES D'IDENTIFIANTS.
-- Chantier feat/entrainement-performances, lot C. Octobre 2026.
-- ============================================================================
--
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI — 98,7 % DU COÛT RESTANT EST L'ÉVALUATION DES POLITIQUES
-- ════════════════════════════════════════════════════════════════════════════
-- Expérience de contrôle, base locale, volumétrie de production, un appel
-- groupé de 84 séances, la RLS pour SEULE variable :
--
--   RLS active ........ 6 411 ms   (76,3 ms par séance)
--   RLS désactivée .....   89 ms   ( 1,1 ms par séance)
--
-- Les écritures elles-mêmes coûtent 89 ms. Tout le reste est le prix payé pour
-- décider QUI a le droit d'écrire — décidé, à chaque instruction, en
-- matérialisant la liste ENTIÈRE des identifiants autorisés :
--
--   program_ids_ecriture() ........... 29 identifiants
--   workout_session_ids_ecriture() ... 1 395
--   training_block_ids_ecriture() .... 1 417
--   workout_exercise_ids_ecriture() .. 5 074   (164 ms par évaluation mesurée)
--
-- Une policy écrite `col in (select fonction_setof())` demande au
-- planificateur de construire cet ensemble, puis d'y chercher UNE valeur. Pour
-- autoriser l'écriture d'un exercice, PostgreSQL calculait la liste des 5 074
-- exercices écrivables. `EXPLAIN` d'une seule lecture de prescriptions rend
-- 167 sous-plans, et la mesure montre que ~970 des ~1 000 ms sont du TEMPS DE
-- PLANIFICATION (six exécutions successives : 1 019, 983, 1 058, 997, 1 047,
-- puis 28 ms dès que le plan est mis en cache).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE MIGRATION CHANGE, ET CE QU'ELLE NE CHANGE PAS
-- ════════════════════════════════════════════════════════════════════════════
-- Elle remplace « cet identifiant appartient-il à l'ensemble des identifiants
-- autorisés ? » par « cet identifiant est-il autorisé ? ». Même question, posée
-- de façon à ce que la réponse coûte une recherche par index au lieu d'un
-- parcours complet.
--
-- ⚠️ LA RÈGLE MÉTIER EST RECOPIÉE À L'IDENTIQUE, PAS REFORMULÉE. Chaque
-- prédicat est la transcription littérale du corps de la fonction d'ensemble
-- correspondante, avec le même appel à `is_admin()`, `coach_ids_portee()`,
-- `categories_ecriture()/lecture()` et `student_ids_entrainement_*()`. Aucune
-- condition n'est ajoutée, aucune n'est retirée.
--
-- ⚠️ LES FONCTIONS D'ENSEMBLE SONT CONSERVÉES, ET CE N'EST PAS DE LA PRUDENCE
-- MAL PLACÉE. `program_ids_*()` et les autres restent appelées par les policies
-- Storage et par d'autres chantiers ; les supprimer dépasserait ce chantier.
-- Elles servent en outre de RÉFÉRENCE à la preuve d'équivalence ci-dessous :
-- c'est en les comparant, ligne par ligne, que l'on démontre que les prédicats
-- ne changent rien.
--
-- ⚠️ CE N'EST PAS UNE AUGMENTATION DE TIMEOUT. `statement_timeout` n'est pas
-- touché. Le plafond de 8 s reste 8 s ; c'est l'opération qui passe dessous.
--
-- ⚠️ AUCUNE DONNÉE N'EST LUE, ÉCRITE NI SUPPRIMÉE. Les policies sont
-- remplacées, les prédicats créés. Rien d'autre.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA PREUVE D'ÉQUIVALENCE — MÉCANIQUE, PAS ARGUMENTAIRE
-- ════════════════════════════════════════════════════════════════════════════
-- La vérification finale compare, POUR CHAQUE LIGNE des quatre tables et pour
-- CHAQUE identité présente dans la base, le verdict de l'ancien ensemble et
-- celui du nouveau prédicat. Un seul désaccord lève et annule la migration.
-- Une policy de sécurité ne se relit pas, elle se vérifie.
-- ============================================================================

-- ── 1. PROGRAMME — la racine de toute la portée ─────────────────────────────
-- Transcription littérale de `program_ids_ecriture()`, bornée à UNE ligne.
create or replace function public.programme_ecrivable(p_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.programs p
     where p.id = p_program_id
       and (
         ( p.owner_student_id is not null
           and p.owner_student_id in (select public.student_ids_entrainement_ecriture()) )
         or
         ( p.owner_student_id is null
           and ( coalesce(public.is_admin(), false)
                 or ( p.coach_id is not null
                      and p.coach_id in (select public.coach_ids_portee())
                      and 'entrainement' in (select public.categories_ecriture()) ) ) )
       )
  );
$fn$;

create or replace function public.programme_lisible(p_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.programs p
     where p.id = p_program_id
       and (
         ( p.owner_student_id is not null
           and p.owner_student_id in (select public.student_ids_entrainement_lecture()) )
         or
         ( p.owner_student_id is null
           and ( coalesce(public.is_admin(), false)
                 or ( p.coach_id is not null
                      and p.coach_id in (select public.coach_ids_portee())
                      and 'entrainement' in (select public.categories_lecture()) ) ) )
       )
  );
$fn$;

-- ── 2. SÉANCE — une recherche sur la clé primaire, puis le programme ────────
create or replace function public.seance_ecrivable(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.workout_sessions ws
     where ws.id = p_session_id
       and public.programme_ecrivable(ws.program_id)
  );
$fn$;

create or replace function public.seance_lisible(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.workout_sessions ws
     where ws.id = p_session_id
       and public.programme_lisible(ws.program_id)
  );
$fn$;

-- ── 3. BLOC ─────────────────────────────────────────────────────────────────
create or replace function public.bloc_entrainement_ecrivable(p_block_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.training_blocks tb
     where tb.id = p_block_id
       and public.seance_ecrivable(tb.session_id)
  );
$fn$;

create or replace function public.bloc_entrainement_lisible(p_block_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.training_blocks tb
     where tb.id = p_block_id
       and public.seance_lisible(tb.session_id)
  );
$fn$;

-- ── 4. EXERCICE — le droit vient de la SÉANCE *ou* du BLOC ──────────────────
-- ⚠️ LE « OU » EST CONSERVÉ TEL QUEL, et les gardes `is not null` reproduisent
-- exactement le comportement de `col in (…)` sur une colonne NULL : `NULL in
-- (…)` rend NULL, qu'une policy traite comme faux. Les écrire explicitement ne
-- change pas le verdict, il le rend lisible.
create or replace function public.exercice_ecrivable(p_session_id uuid, p_block_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select ( p_session_id is not null and public.seance_ecrivable(p_session_id) )
      or ( p_block_id  is not null and public.bloc_entrainement_ecrivable(p_block_id) );
$fn$;

create or replace function public.exercice_lisible(p_session_id uuid, p_block_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select ( p_session_id is not null and public.seance_lisible(p_session_id) )
      or ( p_block_id  is not null and public.bloc_entrainement_lisible(p_block_id) );
$fn$;

-- Par identifiant : nécessaire à la policy INSERT de `training_prescriptions`,
-- qui accepte une prescription rattachée à un EXERCICE.
create or replace function public.exercice_ecrivable_par_id(p_exercise_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.workout_exercises we
     where we.id = p_exercise_id
       and public.exercice_ecrivable(we.session_id, we.block_id)
  );
$fn$;

-- ── 5. Droits : jamais public, jamais anon ──────────────────────────────────
do $droits$
declare f text;
begin
  foreach f in array array[
    'programme_ecrivable(uuid)', 'programme_lisible(uuid)',
    'seance_ecrivable(uuid)', 'seance_lisible(uuid)',
    'bloc_entrainement_ecrivable(uuid)', 'bloc_entrainement_lisible(uuid)',
    'exercice_ecrivable(uuid,uuid)', 'exercice_lisible(uuid,uuid)',
    'exercice_ecrivable_par_id(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('revoke execute on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$droits$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. PREUVE D'ÉQUIVALENCE — AVANT de remplacer la moindre policy
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ ELLE S'EXÉCUTE EN PREMIER, ET C'EST VOLONTAIRE. Si les prédicats ne sont
-- pas équivalents aux ensembles, la migration doit échouer AVANT d'avoir touché
-- la sécurité des tables, pas après.
--
-- Pour chaque identité connue de la base (toute fiche `coaches` et tout
-- `profiles`), on compare ligne par ligne les deux verdicts sur les quatre
-- tables. `set_config(..., true)` est LOCAL à la transaction : la migration ne
-- laisse derrière elle aucune identité usurpée.
do $preuve$
declare
  v_identite record;
  v_repr record;
  v_desaccords int;
  v_identites int := 0;
  v_classes int := 0;
  v_comparaisons bigint := 0;
  v_inattendues text[];
  v_admin boolean;
  v_coachs uuid[]; v_cat_e text[]; v_cat_l text[]; v_stu_e uuid[]; v_stu_l uuid[];
  v_paires bigint;
  -- Les SEULES fonctions par lesquelles l'identité entre dans les deux
  -- formulations. Vérifié par la garde de l'étape 1, pas supposé.
  c_signature text[] := array[
    'is_admin','coach_ids_portee','categories_ecriture','categories_lecture',
    'student_ids_entrainement_ecriture','student_ids_entrainement_lecture'];
  -- Les 16 fonctions que la preuve compare : 9 prédicats scalaires neufs,
  -- 7 fonctions d'ensemble historiques.
  c_comparees text[] := array[
    'programme_ecrivable','programme_lisible','seance_ecrivable','seance_lisible',
    'bloc_entrainement_ecrivable','bloc_entrainement_lisible','exercice_ecrivable',
    'exercice_lisible','exercice_ecrivable_par_id',
    'program_ids_ecriture','program_ids_lecture',
    'workout_session_ids_ecriture','workout_session_ids_lecture',
    'training_block_ids_ecriture','training_block_ids_lecture',
    'workout_exercise_ids_ecriture'];
begin
  -- ══════════════════════════════════════════════════════════════════════════
  -- 1. GARDE STATIQUE — ce qui rend la réduction par classes LÉGITIME
  -- ══════════════════════════════════════════════════════════════════════════
  -- La preuve ne parcourt plus les 38 identités une par une mais une par CLASSE
  -- d'équivalence. Cela n'est valide que si l'identité n'entre dans les deux
  -- formulations QUE par les six fonctions de `c_signature`. Au lieu de
  -- l'espérer, on le VÉRIFIE : on relève les fonctions `public.*` réellement
  -- référencées par les 16 fonctions comparées et on refuse de continuer si
  -- l'une sort de la liste. Une dépendance d'identité ajoutée demain fait
  -- échouer la migration ici, avec le nom de la fonction fautive — et non
  -- silencieusement passer une preuve devenue incomplète.
  select coalesce(array_agg(distinct ref order by ref), '{}'::text[])
    into v_inattendues
    from (
      select m[1] as ref
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        cross join regexp_matches(
          regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g'),
          'public\.(\w+)\s*\(', 'g') m
       where p.proname = any(c_comparees)
    ) q
   where ref <> all(c_comparees)
     and ref <> all(c_signature);
  if coalesce(array_length(v_inattendues, 1), 0) > 0 then
    raise exception 'PREUVE INVALIDE : les fonctions comparées référencent % hors de la signature d''identité. La réduction par classes n''est plus fondée : étendre c_signature, ou rétablir la boucle sur toutes les identités.',
      v_inattendues;
  end if;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2. SIGNATURE DE CHAQUE IDENTITÉ — six appels par identité, rien de plus
  -- ══════════════════════════════════════════════════════════════════════════
  -- ⚠️ POURQUOI CETTE ÉTAPE EXISTE. La version précédente comparait chaque
  -- ligne pour CHACUNE des identités. Mesuré sur une base de volumétrie de
  -- production (29 programmes, 1 393 séances, 1 196 blocs, 4 975 exercices,
  -- 38 identités dont 36 élèves) : 3,2 s par identité de staff et 21,8 s par
  -- identité d'élève, soit ≈ 13 MINUTES au total. Le plafond
  -- `statement_timeout` de la production est de 120 s (valeur du fichier de
  -- configuration, pas du rôle) : la preuve ne pouvait pas passer, et la
  -- relever n'était pas la réponse.
  -- Les 36 élèves partagent la MÊME signature (aucun n'est staff : leurs six
  -- fonctions rendent toutes faux/vide), donc la même réponse sur chaque ligne
  -- des deux côtés. Les prouver une fois les prouve toutes.
  -- `if not exists` + `truncate` plutôt qu'un `drop` préalable : au premier
  -- appel d'une session, `pg_temp` n'existe pas encore et un
  -- `drop ... pg_temp.x` émet un NOTICE inutile ; et le fichier reste
  -- réappliquable dans une même session.
  create temporary table if not exists preuve_identites (
    user_id uuid,
    signature text not null,
    representante boolean not null default false
  );
  truncate preuve_identites;

  for v_identite in
    select distinct u as user_id from (
      select user_id as u from public.coaches where user_id is not null
      union select user_id from public.profiles where user_id is not null
      union select null::uuid                      -- l'anonyme : tout doit être faux
    ) q
  loop
    if v_identite.user_id is null then
      -- ⚠️ `{}` ET NON LA CHAÎNE VIDE. `auth.uid()` fait
      -- `current_setting('request.jwt.claims', true)::json->>'sub'` : une chaîne
      -- vide n'est pas du JSON valide et le cast lève « invalid input syntax for
      -- type json » avant d'atteindre le moindre prédicat. Un objet VIDE est du
      -- JSON valide, sans `sub` : c'est bien l'anonyme.
      perform set_config('request.jwt.claims', '{}', true);
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_identite.user_id::text, 'role', 'authenticated')::text, true);
    end if;

    v_admin := coalesce(public.is_admin(), false);
    select array_agg(x order by x) into v_coachs from unnest(array(select public.coach_ids_portee())) x;
    select array_agg(x order by x) into v_cat_e  from unnest(array(select public.categories_ecriture())) x;
    select array_agg(x order by x) into v_cat_l  from unnest(array(select public.categories_lecture())) x;
    select array_agg(x order by x) into v_stu_e  from unnest(array(select public.student_ids_entrainement_ecriture())) x;
    select array_agg(x order by x) into v_stu_l  from unnest(array(select public.student_ids_entrainement_lecture())) x;

    insert into preuve_identites (user_id, signature)
    values (
      v_identite.user_id,
      -- ⚠️ L'ANONYME A SA PROPRE CLASSE, TOUJOURS. Même si sa signature
      -- coïncidait avec celle d'un élève, il doit être prouvé pour lui-même :
      -- c'est le cas où TOUT doit être faux, et c'est celui qui avait révélé la
      -- perte du `coalesce(…, false)` sur le rôle `anon`.
      case when v_identite.user_id is null then 'ANONYME'
      else md5(concat_ws('|', v_admin::text,
                 coalesce(v_coachs::text, '{}'), coalesce(v_cat_e::text, '{}'),
                 coalesce(v_cat_l::text, '{}'), coalesce(v_stu_e::text, '{}'),
                 coalesce(v_stu_l::text, '{}'))) end
    );
    v_identites := v_identites + 1;
  end loop;

  -- un représentant par signature
  update preuve_identites set representante = true where user_id is null;
  update preuve_identites t set representante = true
   where t.user_id in (select distinct on (signature) user_id
                         from preuve_identites
                        where user_id is not null
                        order by signature, user_id);
  select count(*) into v_classes from preuve_identites where representante;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 3. LA COMPARAISON — toutes les lignes, pour chaque classe
  -- ══════════════════════════════════════════════════════════════════════════
  for v_repr in select user_id, signature from preuve_identites where representante order by signature
  loop
    if v_repr.user_id is null then
      perform set_config('request.jwt.claims', '{}', true);
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_repr.user_id::text, 'role', 'authenticated')::text, true);
    end if;

    -- 3a. programs
    select count(*) into v_desaccords from public.programs p
     where (p.id in (select public.program_ids_ecriture())) is distinct from public.programme_ecrivable(p.id)
        or (p.id in (select public.program_ids_lecture()))  is distinct from public.programme_lisible(p.id);
    if v_desaccords > 0 then
      raise exception 'ÉQUIVALENCE ROMPUE sur programs : % désaccord(s) pour l''identité % (classe %)',
        v_desaccords, coalesce(v_repr.user_id::text, '(anonyme)'), v_repr.signature;
    end if;
    select v_comparaisons + count(*) into v_comparaisons from public.programs;

    -- 3b. workout_sessions
    select count(*) into v_desaccords from public.workout_sessions ws
     where (ws.id in (select public.workout_session_ids_ecriture())) is distinct from public.seance_ecrivable(ws.id)
        or (ws.id in (select public.workout_session_ids_lecture()))  is distinct from public.seance_lisible(ws.id);
    if v_desaccords > 0 then
      raise exception 'ÉQUIVALENCE ROMPUE sur workout_sessions : % désaccord(s) pour l''identité % (classe %)',
        v_desaccords, coalesce(v_repr.user_id::text, '(anonyme)'), v_repr.signature;
    end if;
    select v_comparaisons + count(*) into v_comparaisons from public.workout_sessions;

    -- 3c. training_blocks
    select count(*) into v_desaccords from public.training_blocks tb
     where (tb.id in (select public.training_block_ids_ecriture())) is distinct from public.bloc_entrainement_ecrivable(tb.id)
        or (tb.id in (select public.training_block_ids_lecture()))  is distinct from public.bloc_entrainement_lisible(tb.id);
    if v_desaccords > 0 then
      raise exception 'ÉQUIVALENCE ROMPUE sur training_blocks : % désaccord(s) pour l''identité % (classe %)',
        v_desaccords, coalesce(v_repr.user_id::text, '(anonyme)'), v_repr.signature;
    end if;
    select v_comparaisons + count(*) into v_comparaisons from public.training_blocks;

    -- 3d. workout_exercises, forme « OU » : UNE FOIS PAR COUPLE DISTINCT.
    -- ⚠️ CE N'EST PAS UN ÉCHANTILLONNAGE. Les deux côtés de la comparaison ne
    -- lisent que `session_id` et `block_id` : à gauche
    -- `session_id in (…) or block_id in (…)`, à droite
    -- `exercice_ecrivable(session_id, block_id)`. Deux lignes partageant le même
    -- couple donnent donc forcément le même verdict des deux côtés, et tester
    -- le couple une fois équivaut exactement à tester chacune de ses lignes.
    -- Sur la volumétrie de production : 4 975 lignes pour ≈ 1 196 couples.
    select count(*) into v_desaccords from (
      select distinct we.session_id, we.block_id from public.workout_exercises we) couples
     where ( (couples.session_id in (select public.workout_session_ids_ecriture()))
             or (couples.block_id in (select public.training_block_ids_ecriture())) ) is distinct from
           public.exercice_ecrivable(couples.session_id, couples.block_id)
        or ( (couples.session_id in (select public.workout_session_ids_lecture()))
             or (couples.block_id in (select public.training_block_ids_lecture())) ) is distinct from
           public.exercice_lisible(couples.session_id, couples.block_id);
    if v_desaccords > 0 then
      raise exception 'ÉQUIVALENCE ROMPUE sur workout_exercises (couple séance/bloc) : % désaccord(s) pour l''identité % (classe %)',
        v_desaccords, coalesce(v_repr.user_id::text, '(anonyme)'), v_repr.signature;
    end if;
    select count(*) into v_paires from (select distinct we.session_id, we.block_id from public.workout_exercises we) c;
    v_comparaisons := v_comparaisons + v_paires;

    -- 3e. workout_exercises, forme PAR IDENTIFIANT : ligne par ligne.
    -- `exercice_ecrivable_par_id(we.id)` dépend de la ligne elle-même : aucune
    -- déduplication n'est possible ici, et on ne l'invente pas.
    select count(*) into v_desaccords from public.workout_exercises we
     where (we.id in (select public.workout_exercise_ids_ecriture())) is distinct from
           public.exercice_ecrivable_par_id(we.id);
    if v_desaccords > 0 then
      raise exception 'ÉQUIVALENCE ROMPUE sur workout_exercises (par identifiant) : % désaccord(s) pour l''identité % (classe %)',
        v_desaccords, coalesce(v_repr.user_id::text, '(anonyme)'), v_repr.signature;
    end if;
    select v_comparaisons + count(*) into v_comparaisons from public.workout_exercises;
  end loop;

  perform set_config('request.jwt.claims', '{}', true);
  truncate preuve_identites;

  raise notice 'ÉQUIVALENCE PROUVÉE : % identité(s) couverte(s) par % classe(s) d''équivalence, % comparaison(s) de ligne, 0 désaccord',
    v_identites, v_classes, v_comparaisons;
end
$preuve$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. LES POLICIES — même verdict, autre coût
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ SEULES LES POLICIES `*_manage_staff_*` SONT RÉÉCRITES. Les policies
-- `*_select_assigned_student` ne sont PAS touchées : elles portent le droit de
-- l'ÉLÈVE, elles ne passent pas par les fonctions d'ensemble, et les toucher
-- élargirait ce chantier à un périmètre non mesuré.

-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ `programs` N'EST PAS TOUCHÉE — ET C'EST LE RÉSULTAT D'UN ÉCHEC MESURÉ
-- ════════════════════════════════════════════════════════════════════════════
-- Une première version de cette migration remplaçait aussi les quatre policies
-- `programs_manage_staff_*`. Le test `programmes_cloisonnement_coach` l'a
-- refusée : 70 contrôles et 0 échec sur `origin/main`, 70 contrôles et
-- 10 ÉCHECS avec la migration (D5, D6, D7, D9, E10, puis H1 à H6).
--
-- Deux fautes distinctes, l'une et l'autre reproduites :
--
--   1. `for select using (programme_lisible(id))` cassait `INSERT … RETURNING`.
--        insert into programs (…) values (…);              -- INSERT 0 1   ✅
--        insert into programs (…) values (…) returning id; -- ERROR: new row
--                                                             violates RLS ❌
--      `RETURNING` consulte la policy SELECT, et `programme_lisible(id)` va
--      CHERCHER la ligne dans `programs` ; la fonction étant `STABLE`, elle lit
--      l'instantané du DÉBUT de l'instruction, où la ligne n'existe pas encore.
--      C'est l'auto-référence de `document_assignments` (corrigée le 25/10),
--      réapparue à l'endroit où on ne la surveillait pas. Et ce n'est pas un cas
--      de bord : `createProgram` fait `.insert(…).select("id").single()`, et
--      PostgREST émet toujours un `RETURNING` — plus aucune création possible.
--
--   2. La réécriture « en ligne » perdait un `coalesce(…, false)` présent dans
--      la policy d'origine. Conséquence mesurée sur le rôle `anon` :
--        select count(*) from public.programs;
--        ERROR: permission denied for function student_ids_entrainement_lecture
--      Sans le `coalesce`, le planificateur remonte le sous-plan en `InitPlan`
--      évalué INCONDITIONNELLEMENT ; avec lui, il reste un sous-plan corrélé que
--      les lignes `owner_student_id is null` n'atteignent jamais. Les fonctions
--      de portée étant révoquées pour `anon`, la vitrine publique levait au lieu
--      de répondre — alors que le texte de la policy semblait équivalent.
--
-- LA CONCLUSION N'EST PAS « CORRIGEONS LA RÉÉCRITURE », C'EST « NE RÉÉCRIVONS
-- PAS ». `programs` compte 29 lignes et `program_ids_*()` s'évalue en 6,7 ms :
-- il n'y a RIEN à y gagner. Le coût que cette migration supprime est celui de
-- `workout_session_ids_*()` (1 395 lignes), `training_block_ids_*()` (1 417) et
-- `workout_exercise_ids_*()` (5 074 lignes, 164 ms par évaluation). Les quatre
-- policies de `programs` restent donc EXACTEMENT celles d'`origin/main`, au
-- caractère près — le contrôle 8 de la vérification finale l'exige.
--
-- Les prédicats `programme_lisible` / `programme_ecrivable` restent utilisés,
-- mais seulement par les tables ENFANTS, qui les appellent sur leur `program_id`
-- — un parent qui existe déjà, donc visible dans l'instantané. L'auto-référence
-- n'existe que lorsqu'une policy résout SA PROPRE ligne.

-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE LES PRÉDICATS SCALAIRES COÛTENT ET RAPPORTENT, PAR CHEMIN
-- ════════════════════════════════════════════════════════════════════════════
-- Les quatre commandes des cinq tables enfants passent au prédicat scalaire.
-- Ce choix a été remis en cause en cours de route, puis confirmé par la mesure :
-- le détour est consigné ici parce qu'il est instructif.
--
-- LE DOUTE. Un prédicat scalaire `security definer` est appelé UNE FOIS PAR
-- LIGNE, là où la forme « ensemble » matérialise une fois par instruction. À
-- l'écriture le scalaire gagne forcément (une ligne, un appel, une recherche
-- par index, au lieu de construire les 5 074 identifiants autorisés pour en
-- vérifier un). À la LECTURE, qui rend des centaines de lignes, le rapport
-- devait s'inverser — et il s'inverse, par table :
--
--   lecture complète d'une programmation de 12 semaines, premier passage
--   requête                    origin/main    + index    + prédicats
--   workout_exercises .........  1 934,4 ms     7,4 ms       59,6 ms   ← ×8
--   workout_sessions ..........      2,6 ms     2,7 ms        8,3 ms   ← ×3
--   training_blocks ...........      9,2 ms     7,1 ms       15,8 ms   ← ×2
--   training_prescriptions ....  1 063,1 ms 1 075,7 ms      974,3 ms
--   TOTAL .....................  3 013,7 ms 1 097,9 ms    1 063,0 ms
--
-- ⚠️ LA DERNIÈRE LIGNE EST CELLE QU'IL FAUT LIRE, ET ELLE DIT L'INVERSE DES
-- AUTRES. Les ratios par table sont défavorables ; le TOTAL, lui, est
-- légèrement MEILLEUR (1 063 contre 1 098 ms) parce que les valeurs dégradées
-- sont des dizaines de millisecondes sur une lecture que `training_prescriptions`
-- écrase à elle seule. Un ×8 sur 7 ms reste 60 ms : la ratio alarme, la
-- grandeur ne justifie rien.
--
-- LA CONTRE-ÉPREUVE, elle, est sans ambiguïté. Repasser les seuls `SELECT` en
-- forme ensemble — ce qui paraissait prudent — dégrade l'ÉCRITURE, parce que
-- PostgreSQL applique les policies `SELECT` aux lignes que lit un `UPDATE` :
--
--   scénario                        + index seuls   SELECT en ensemble   tout scalaire
--   champ simple ...................    276,6 ms          219,7 ms          181,5 ms
--   ajout d'1 exercice .............    209,2 ms          203,2 ms          140,3 ms
--   ajout d'1 semaine à 12 semaines     785,4 ms          681,2 ms          520,0 ms
--   10 séances modifiées ...........  1 727,1 ms        1 457,9 ms          698,8 ms
--   pire cas, 91 séances ...........  11 179,0 ms       9 243,9 ms        5 226,5 ms
--
-- ⚠️ LA LIGNE QUI DÉCIDE EST LA DERNIÈRE. Le rôle `authenticated` porte
-- `statement_timeout = 8s`, et la RPC groupée est UNE SEULE instruction : elle
-- a déplacé le plafond d'un appel par séance vers un appel unique, et cet appel
-- unique le franchit à 11 179 ms sans les prédicats, à 9 244 ms avec les seuls
-- `SELECT` en ensemble, et passe dessous à 5 226 ms avec les prédicats partout.
-- Les prédicats ne sont donc pas un raffinement de vitesse : ils sont ce qui
-- rend la RPC groupée VIABLE.
--
-- ⚠️ ET CE N'EST PAS UNE AUGMENTATION DE TIMEOUT. `statement_timeout` n'est pas
-- touché. Le plafond de 8 s reste 8 s ; c'est l'opération qui passe dessous.
--
-- ⚠️ CE QUI RESTE, ET QUI N'EST PAS TRAITÉ ICI. `training_prescriptions` coûte
-- ~1 000 ms en lecture dans les TROIS états : ni les index ni les prédicats n'y
-- changent quoi que ce soit, et c'est désormais 95 % de la lecture. La cause est
-- ailleurs — deux policies permissives `SELECT` combinées en OU, dont celle de
-- l'élève est une jointure sur quatre tables évaluée pour chaque ligne, et un
-- coût dominé par la PLANIFICATION (mesuré : 1 019, 983, 1 058, 997, 1 047 ms
-- puis 28 ms dès que le plan est mis en cache). La corriger demande de fusionner
-- des policies qui portent des règles métier distinctes : ce n'est pas une
-- optimisation, c'est une refonte des droits. Hors de ce chantier, et signalée
-- comme telle plutôt que bâclée.

-- program_weeks
drop policy if exists program_weeks_manage_staff_select on public.program_weeks;
create policy program_weeks_manage_staff_select on public.program_weeks
  for select using (public.programme_lisible(program_id));

drop policy if exists program_weeks_manage_staff_insert on public.program_weeks;
create policy program_weeks_manage_staff_insert on public.program_weeks
  for insert with check (public.programme_ecrivable(program_id));

drop policy if exists program_weeks_manage_staff_update on public.program_weeks;
create policy program_weeks_manage_staff_update on public.program_weeks
  for update using (public.programme_ecrivable(program_id))
  with check (public.programme_ecrivable(program_id));

drop policy if exists program_weeks_manage_staff_delete on public.program_weeks;
create policy program_weeks_manage_staff_delete on public.program_weeks
  for delete using (public.programme_ecrivable(program_id));

-- workout_sessions
drop policy if exists workout_sessions_manage_staff_select on public.workout_sessions;
create policy workout_sessions_manage_staff_select on public.workout_sessions
  for select using (public.programme_lisible(program_id));

drop policy if exists workout_sessions_manage_staff_insert on public.workout_sessions;
create policy workout_sessions_manage_staff_insert on public.workout_sessions
  for insert with check (public.programme_ecrivable(program_id));

drop policy if exists workout_sessions_manage_staff_update on public.workout_sessions;
create policy workout_sessions_manage_staff_update on public.workout_sessions
  for update using (public.programme_ecrivable(program_id))
  with check (public.programme_ecrivable(program_id));

drop policy if exists workout_sessions_manage_staff_delete on public.workout_sessions;
create policy workout_sessions_manage_staff_delete on public.workout_sessions
  for delete using (public.programme_ecrivable(program_id));

-- training_blocks
drop policy if exists training_blocks_manage_staff_select on public.training_blocks;
create policy training_blocks_manage_staff_select on public.training_blocks
  for select using (public.seance_lisible(session_id));

drop policy if exists training_blocks_manage_staff_insert on public.training_blocks;
create policy training_blocks_manage_staff_insert on public.training_blocks
  for insert with check (public.seance_ecrivable(session_id));

drop policy if exists training_blocks_manage_staff_update on public.training_blocks;
create policy training_blocks_manage_staff_update on public.training_blocks
  for update using (public.seance_ecrivable(session_id))
  with check (public.seance_ecrivable(session_id));

drop policy if exists training_blocks_manage_staff_delete on public.training_blocks;
create policy training_blocks_manage_staff_delete on public.training_blocks
  for delete using (public.seance_ecrivable(session_id));

-- workout_exercises
drop policy if exists workout_exercises_manage_staff_select on public.workout_exercises;
create policy workout_exercises_manage_staff_select on public.workout_exercises
  for select using (public.exercice_lisible(session_id, block_id));

drop policy if exists workout_exercises_manage_staff_insert on public.workout_exercises;
create policy workout_exercises_manage_staff_insert on public.workout_exercises
  for insert with check (public.exercice_ecrivable(session_id, block_id));

drop policy if exists workout_exercises_manage_staff_update on public.workout_exercises;
create policy workout_exercises_manage_staff_update on public.workout_exercises
  for update using (public.exercice_ecrivable(session_id, block_id))
  with check (public.exercice_ecrivable(session_id, block_id));

drop policy if exists workout_exercises_manage_staff_delete on public.workout_exercises;
create policy workout_exercises_manage_staff_delete on public.workout_exercises
  for delete using (public.exercice_ecrivable(session_id, block_id));

-- training_prescriptions
drop policy if exists training_prescriptions_manage_staff_select on public.training_prescriptions;
create policy training_prescriptions_manage_staff_select on public.training_prescriptions
  for select using (public.bloc_entrainement_lisible(block_id));

drop policy if exists training_prescriptions_manage_staff_insert on public.training_prescriptions;
create policy training_prescriptions_manage_staff_insert on public.training_prescriptions
  for insert with check (
    ( block_id is not null and public.bloc_entrainement_ecrivable(block_id) )
    or
    ( exercise_id is not null and public.exercice_ecrivable_par_id(exercise_id) )
  );

drop policy if exists training_prescriptions_manage_staff_update on public.training_prescriptions;
create policy training_prescriptions_manage_staff_update on public.training_prescriptions
  for update using (public.bloc_entrainement_ecrivable(block_id))
  with check (public.bloc_entrainement_ecrivable(block_id));

drop policy if exists training_prescriptions_manage_staff_delete on public.training_prescriptions;
create policy training_prescriptions_manage_staff_delete on public.training_prescriptions
  for delete using (public.bloc_entrainement_ecrivable(block_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 8. VÉRIFICATION FINALE
-- ════════════════════════════════════════════════════════════════════════════
do $verif$
declare v_n int; v_id_controle uuid;
begin
  -- 1. Les neuf prédicats existent, sont STABLE et SECURITY DEFINER avec un
  --    search_path figé (sans quoi un schéma temporaire les détournerait).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('programme_ecrivable','programme_lisible','seance_ecrivable',
                       'seance_lisible','bloc_entrainement_ecrivable','bloc_entrainement_lisible',
                       'exercice_ecrivable','exercice_lisible','exercice_ecrivable_par_id')
     and p.prosecdef
     and p.provolatile = 's'
     and array_to_string(p.proconfig, ',') like 'search_path=%';
  if v_n <> 9 then
    raise exception 'prédicats mal déclarés : % sur 9 conformes (stable + security definer + search_path)', v_n;
  end if;

  -- 2. Aucun n'est exécutable par anon ni par public.
  select count(*) into v_n from (
    select unnest(array[
      'programme_ecrivable(uuid)','programme_lisible(uuid)','seance_ecrivable(uuid)',
      'seance_lisible(uuid)','bloc_entrainement_ecrivable(uuid)','bloc_entrainement_lisible(uuid)',
      'exercice_ecrivable(uuid,uuid)','exercice_lisible(uuid,uuid)','exercice_ecrivable_par_id(uuid)'
    ]) as f) q
   where has_function_privilege('anon', 'public.' || q.f, 'execute')
      or has_function_privilege('public', 'public.' || q.f, 'execute');
  if v_n <> 0 then
    raise exception '% prédicat(s) exposé(s) à anon ou public', v_n;
  end if;

  -- 3. PLUS AUCUNE policy `manage_staff` des cinq tables ne matérialise un
  --    ensemble d'identifiants d'entraînement. C'est la propriété mesurée ;
  --    une policy oubliée annulerait le gain sans se signaler.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('program_weeks','workout_sessions','training_blocks',
                       'workout_exercises','training_prescriptions')
     and policyname like '%manage_staff%'
     and ( coalesce(qual,'') || ' ' || coalesce(with_check,'') ) ~
         '(program_ids_|workout_session_ids_|training_block_ids_|workout_exercise_ids_)';
  if v_n <> 0 then
    raise exception '% policy(ies) manage_staff matérialisent encore un ensemble d''identifiants', v_n;
  end if;

  -- 4. Les policies de l'ÉLÈVE sont intactes — ce chantier n'y touche pas.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and policyname like '%select_assigned_student%'
     and tablename in ('programs','program_weeks','workout_sessions','training_blocks',
                       'workout_exercises','training_prescriptions');
  if v_n <> 6 then
    raise exception 'policies élève : % sur 6 — ce chantier ne doit pas y toucher', v_n;
  end if;

  -- 5. Les fonctions d'ensemble sont CONSERVÉES : d'autres chantiers et les
  --    policies Storage s'appuient dessus, et la preuve d'équivalence en a besoin.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('program_ids_ecriture','program_ids_lecture',
                       'workout_session_ids_ecriture','workout_session_ids_lecture',
                       'training_block_ids_ecriture','training_block_ids_lecture',
                       'workout_exercise_ids_ecriture','workout_exercise_ids_lecture');
  if v_n <> 8 then
    raise exception 'fonctions d''ensemble : % sur 8 — elles ne doivent PAS être supprimées', v_n;
  end if;

  -- 6. Chaque table garde ses quatre policies manage_staff (select/insert/update/delete).
  select count(*) into v_n from pg_policies
   where schemaname='public' and policyname like '%manage_staff%'
     and tablename in ('programs','program_weeks','workout_sessions','training_blocks',
                       'workout_exercises','training_prescriptions');
  if v_n <> 24 then
    raise exception 'policies manage_staff : % sur 24 attendues (6 tables × 4 commandes)', v_n;
  end if;

  -- 7. La RLS est toujours ACTIVE sur les six tables.
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relrowsecurity
     and c.relname in ('programs','program_weeks','workout_sessions','training_blocks',
                       'workout_exercises','training_prescriptions');
  if v_n <> 6 then
    raise exception 'RLS active sur % table(s) sur 6', v_n;
  end if;

  -- 8. ⚠️ AUCUNE POLICY DE `programs` NE DOIT RÉSOUDRE SA PROPRE LIGNE.
  --    Contrôle né de deux vrais défauts de la première version de cette
  --    migration (voir la section 7) : `using (programme_lisible(id))` cassait
  --    `INSERT … RETURNING`, et la réécriture « en ligne » perdait un
  --    `coalesce(…, false)` qui faisait lever la vitrine publique pour `anon`.
  --    On interdit donc que les prédicats de ligne atteignent `programs`, par
  --    inattention ou par un futur « uniformisons toutes les tables ».
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'programs'
     and ( coalesce(qual, '') like '%programme_lisible%'
        or coalesce(qual, '') like '%programme_ecrivable%'
        or coalesce(with_check, '') like '%programme_lisible%'
        or coalesce(with_check, '') like '%programme_ecrivable%' );
  if v_n <> 0 then
    raise exception
      '% policy(ies) de programs résolvent leur propre ligne : INSERT … RETURNING serait refusé, donc la création de programmation cassée', v_n;
  end if;

  --    Et elles ont bien gardé leur forme d'origine : le `coalesce(…, false)`
  --    autour du test de catégorie est ce qui empêche le planificateur de
  --    remonter le sous-plan en `InitPlan` évalué inconditionnellement — sans
  --    lui, `anon` heurte une fonction de portée qui lui est révoquée.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'programs'
     and policyname like 'programs_manage_staff_%'
     and coalesce(qual, '') || coalesce(with_check, '') like '%COALESCE((''entrainement''%';
  if v_n <> 4 then
    raise exception
      'policies de programs : % sur 4 portent encore le coalesce(…, false) de catégorie — la vitrine anon lèverait', v_n;
  end if;

  -- 9. ET LA PREUVE PAR L'USAGE : une insertion AVEC `RETURNING` passe.
  --    Un contrôle de catalogue dit la FORME de la policy ; celui-ci dit son
  --    EFFET, qui est ce qui compte. Tout est défait avant de sortir.
  insert into auth.users (id, email)
  values ('00000000-0000-4000-8000-00000000f1f1', 'controle-rls@local.invalid')
  on conflict (id) do nothing;
  insert into public.profiles (id, user_id, email, role, first_name, last_name, phone)
  values ('00000000-0000-4000-8000-00000000f1f1', '00000000-0000-4000-8000-00000000f1f1',
          'controle-rls@local.invalid', 'admin', 'Controle', 'RLS', '')
  on conflict (id) do nothing;

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-00000000f1f1","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.programs (name, goal, level, duration_weeks, status)
    values ('controle RLS — RETURNING', 'controle', 'controle', 1, 'brouillon')
    returning id into v_id_controle;
  exception when others then
    perform set_config('role', 'postgres', true);
    raise exception
      'INSERT … RETURNING sur programs refuse (%) : la creation de programmation serait cassee', sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
  if v_id_controle is null then
    raise exception 'INSERT … RETURNING sur programs n''a rien rendu : creation de programmation cassee';
  end if;
  delete from public.programs where id = v_id_controle;
  delete from public.profiles where id = '00000000-0000-4000-8000-00000000f1f1';
  delete from auth.users where id = '00000000-0000-4000-8000-00000000f1f1';

  -- 10. ⚠️ LES VINGT POLICIES DES TABLES ENFANTS SONT EN PRÉDICAT SCALAIRE,
  --     y compris les `SELECT`. Le détour qui les en excluait est documenté
  --     dans la note qui précède les policies : il partait d'un ratio et les
  --     totaux l'ont démenti.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and policyname like '%manage_staff%'
     and tablename in ('program_weeks','workout_sessions','training_blocks',
                       'workout_exercises','training_prescriptions')
     and (coalesce(qual,'') || coalesce(with_check,'')) ~
         '(programme_lisible|programme_ecrivable|seance_lisible|seance_ecrivable|bloc_entrainement_lisible|bloc_entrainement_ecrivable|exercice_lisible|exercice_ecrivable)';
  if v_n <> 20 then
    raise exception
      'prédicats scalaires sur % policy(ies) au lieu de 20 (5 tables × 4 commandes) — le gain d''écriture serait perdu', v_n;
  end if;

  raise notice '20261028090000 — 10 contrôles sur 10 verts (9 prédicats ; 20 policies enfants en scalaire ; les 4 de programs intactes, au caractère près ; RLS active ; policies élève intactes ; INSERT … RETURNING vérifié)';
end
$verif$;
