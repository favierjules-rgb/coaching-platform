-- ============================================================================
-- Checklist PostgreSQL — F5 : RÉPONSE VIDÉO DU COACH
-- (migration 20260827090000_coach_reply_video)
--
-- CE QUI CHANGE PAR RAPPORT À F4, ET POURQUOI ÇA MÉRITE SA PROPRE CHECKLIST
--   Le sens de lecture est INVERSÉ. Dans `feedback-videos`, l'élève écrit et
--   son coach lit. Ici, le coach écrit et l'élève lit. Rejouer la checklist
--   F4 en changeant le nom du bucket ne prouverait donc rien : les questions
--   elles-mêmes ne sont pas les mêmes.
--
--   La plus importante est neuve : « l'élève peut-il déposer une réponse de
--   coach DANS SON PROPRE DOSSIER ? » En F4 c'était son droit le plus
--   évident ; ici, ce serait la faille — une réponse de coach que l'élève
--   pourrait écrire lui-même ne serait plus une réponse de coach.
--
-- LES QUESTIONS POSÉES, ET SEULEMENT CELLES-LÀ
--   1. « L'élève peut-il ÉCRIRE dans le bucket ? » (non — même chez lui.)
--   2. « L'élève destinataire peut-il LIRE ? » (oui — c'est le but.)
--   3. « Un coach non rattaché peut-il écrire ou lire ? » (non.)
--   4. « Un élève peut-il lire la réponse destinée à un AUTRE élève ? » (non.)
--   5. « Un coach peut-il coller sur le retour de A une vidéo destinée à B ? »
--      La RLS du bucket lui ouvre légitimement les DEUX dossiers s'il suit les
--      deux élèves : c'est le gardien de `workout_feedback` qui doit refuser,
--      et cette question ne se pose que parce que les deux droits existent.
--   6. « L'élève peut-il poser ou modifier le chemin, ou le calque, sur son
--      propre retour ? » — écrire une colonne n'exige aucun dépôt de fichier,
--      donc la RLS du bucket n'est jamais consultée sur ce chemin-là.
--   7. « La date de dépôt peut-elle être falsifiée ? » — c'est elle qui
--      datera la purge des 3 jours.
--   8. « Le calque peut-il contenir n'importe quoi ? » et « survit-il au
--      retrait de la vidéo ? » (non, et non.)
--   9. « `anon` voit-il quoi que ce soit ? »
--
-- COMMENT ELLES SONT POSÉES
--   En EXÉCUTANT des écritures sous le rôle `authenticated`, avec les claims
--   JWT de CINQ acteurs : élève A, élève B, coach A, coach B, administrateur,
--   plus `anon` et un élève sans coach. Jamais en relisant des politiques.
--
-- DEUX RÈGLES DE MÉTHODE, REPRISES DES CHECKLISTS F3 ET F4
--   * On mesure la VALEUR, jamais le nombre de lignes. Le gardien est un
--     trigger BEFORE : sur la tentative de l'élève, il RESTAURE l'ancienne
--     valeur au lieu de refuser, donc l'UPDATE rapporte « 1 ligne » sans
--     avoir rien changé.
--   * Un verdict NULL est un ÉCHEC. Une comparaison portant sur une ligne
--     que la RLS masque rend NULL, ce qui ressemblerait à un succès. Chaque
--     vérification d'une ligne d'autrui se fait donc HORS du rôle de
--     l'attaquant.
--
-- CE QUE CETTE CHECKLIST NE PEUT PAS PROUVER
--   Ni le plafond de taille, ni la liste blanche de types : `file_size_limit`
--   et `allowed_mime_types` sont appliqués par storage-api au moment du
--   téléversement HTTP, pas par une contrainte sur `storage.objects`. Ils
--   sont vérifiés ici par LECTURE de la ligne du bucket (section A).
--   La DURÉE non plus : PostgreSQL ne sait pas combien de temps dure un
--   fichier. Les 120 secondes ne sont tenues que par le navigateur — et la
--   DÉCOUPE encore moins : elle n'existe que dans le navigateur du coach.
--   Ces limites sont nommées plutôt que masquées par un contrôle qui
--   semblerait passer.
--
-- SECTIONS
--   A. le bucket : privé, plafonné, typé, quatre policies ASYMÉTRIQUES ;
--   B. dépôt : le coach rattaché oui, l'élève JAMAIS, le coach étranger non ;
--   C. lecture : l'élève destinataire oui, les autres non ;
--   D. déplacement et suppression : réservés à qui peut écrire ;
--   E. la COLONNE : l'élève ne pose ni chemin ni calque sur son propre retour ;
--   F. le chemin doit désigner L'ÉLÈVE DE CE RETOUR, même pour un coach ;
--   G. coach_reply_video_uploaded_at : dérivé, non falsifiable ;
--   H. le calque : structure validée, et il part avec la vidéo ;
--   I. anon ;
--   Z. rien ne survit au ROLLBACK.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   psql -U postgres -d <base_locale> -v ON_ERROR_STOP=1 \
--     -f supabase/tests/coach_reply_video_checklist.sql
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ============================================================================

\timing off

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;

-- `coalesce(p_ok, false)` : un verdict NULL — typiquement une comparaison sur
-- une ligne que la RLS a masquée — est un ÉCHEC, jamais un succès silencieux.
create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is true then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

-- Un ordre SQL qui DOIT échouer. Le bloc imbriqué joue le rôle d'un
-- SAVEPOINT : sans lui, la première exception avorterait la transaction.
create or replace function pg_temp.refuse(p_sql text)
returns boolean language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return true;
  end;
  return false;
end $$;

create or replace function pg_temp.chemin(p_student uuid, p_fichier uuid, p_ext text default 'mp4')
returns text language sql immutable as $$
  select p_student::text || '/' || p_fichier::text || '.' || p_ext
$$;

create or replace function pg_temp.eleve_a() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.eleve_b() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"50000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.coach_a() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.coach_b() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"50000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.eleve_orphelin() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"50000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.admin() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"50000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- LE DÉCOR — deux coachs, trois élèves, deux retours symétriques
-- ════════════════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  ('50000000-0000-4000-8000-000000000001'::uuid, 'f5.coachA@test.local'),
  ('50000000-0000-4000-8000-000000000002'::uuid, 'f5.eleveA@test.local'),
  ('50000000-0000-4000-8000-000000000003'::uuid, 'f5.eleveB@test.local'),
  ('50000000-0000-4000-8000-000000000004'::uuid, 'f5.admin@test.local'),
  ('50000000-0000-4000-8000-000000000005'::uuid, 'f5.coachB@test.local'),
  ('50000000-0000-4000-8000-000000000006'::uuid, 'f5.eleveOrphelin@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('50000000-0000-4000-8000-000000000001'::uuid, 'coach',   'F5CoachA', 'T', 'f5.coachA@test.local'),
  ('50000000-0000-4000-8000-000000000002'::uuid, 'student', 'F5EleveA', 'T', 'f5.eleveA@test.local'),
  ('50000000-0000-4000-8000-000000000003'::uuid, 'student', 'F5EleveB', 'T', 'f5.eleveB@test.local'),
  ('50000000-0000-4000-8000-000000000004'::uuid, 'admin',   'F5Admin', 'T', 'f5.admin@test.local'),
  ('50000000-0000-4000-8000-000000000005'::uuid, 'coach',   'F5CoachB', 'T', 'f5.coachB@test.local'),
  ('50000000-0000-4000-8000-000000000006'::uuid, 'student', 'F5Orphelin', 'T', 'f5.eleveOrphelin@test.local');

insert into public.coaches (id, user_id, name, email) values
  ('51000000-0000-4000-8000-000000000001'::uuid, '50000000-0000-4000-8000-000000000001'::uuid, 'F5CoachA', 'f5.coachA@test.local'),
  ('51000000-0000-4000-8000-000000000002'::uuid, '50000000-0000-4000-8000-000000000005'::uuid, 'F5CoachB', 'f5.coachB@test.local');

-- Un élève SANS coach : la Production en porte, et la migration n'invente
-- aucun rattachement. Personne ne doit pouvoir lui répondre, sauf l'admin.
insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
  ('52000000-0000-4000-8000-000000000002'::uuid, '50000000-0000-4000-8000-000000000002'::uuid,
   '51000000-0000-4000-8000-000000000001'::uuid, 'F5EleveA', 'T', 'f5.eleveA@test.local', 'active', 'coaching'),
  ('52000000-0000-4000-8000-000000000003'::uuid, '50000000-0000-4000-8000-000000000003'::uuid,
   '51000000-0000-4000-8000-000000000002'::uuid, 'F5EleveB', 'T', 'f5.eleveB@test.local', 'active', 'coaching'),
  ('52000000-0000-4000-8000-000000000006'::uuid, '50000000-0000-4000-8000-000000000006'::uuid,
   null, 'F5Orphelin', 'T', 'f5.eleveOrphelin@test.local', 'active', 'coaching');

insert into public.programs (id, coach_id, name, status, program_mode) values
  ('54000000-0000-4000-8000-000000000001'::uuid, '51000000-0000-4000-8000-000000000001'::uuid, 'Programme F5 — A', 'actif', 'individuel'),
  ('54000000-0000-4000-8000-000000000002'::uuid, '51000000-0000-4000-8000-000000000002'::uuid, 'Programme F5 — B', 'actif', 'individuel');

insert into public.program_weeks (id, program_id, week_number) values
  ('55000000-0000-4000-8000-000000000001'::uuid, '54000000-0000-4000-8000-000000000001'::uuid, 1),
  ('55000000-0000-4000-8000-000000000002'::uuid, '54000000-0000-4000-8000-000000000002'::uuid, 1);

insert into public.workout_sessions (id, program_id, program_week_id, day, name, muscle_group) values
  ('56000000-0000-4000-8000-000000000001'::uuid, '54000000-0000-4000-8000-000000000001'::uuid,
   '55000000-0000-4000-8000-000000000001'::uuid, 'lundi', 'Séance F5 de A', 'pectoraux'),
  ('56000000-0000-4000-8000-000000000002'::uuid, '54000000-0000-4000-8000-000000000002'::uuid,
   '55000000-0000-4000-8000-000000000002'::uuid, 'lundi', 'Séance F5 de B', 'dos');

insert into public.assignments (student_id, content_type, content_id) values
  ('52000000-0000-4000-8000-000000000002'::uuid, 'programme', '54000000-0000-4000-8000-000000000001'::uuid),
  ('52000000-0000-4000-8000-000000000003'::uuid, 'programme', '54000000-0000-4000-8000-000000000002'::uuid);

insert into public.workout_feedback (id, student_id, session_id, session_key, session_ref_label, completed) values
  ('59000000-0000-4000-8000-0000000000a1'::uuid, '52000000-0000-4000-8000-000000000002'::uuid,
   '56000000-0000-4000-8000-000000000001'::uuid, '56000000-0000-4000-8000-000000000001', 'Séance F5 de A', true),
  ('59000000-0000-4000-8000-0000000000b1'::uuid, '52000000-0000-4000-8000-000000000003'::uuid,
   '56000000-0000-4000-8000-000000000002'::uuid, '56000000-0000-4000-8000-000000000002', 'Séance F5 de B', true);


-- ════════════════════════════════════════════════════════════════════════════
-- A. LE BUCKET — privé, plafonné, typé, et ASYMÉTRIQUE
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_b record; v_n int; v_def text;
begin
  select * into v_b from storage.buckets where id = 'coach-reply-videos';

  perform pg_temp.noter('A', 'A1. le bucket coach-reply-videos existe et est PRIVÉ',
    v_b.id is not null and v_b.public is false);

  perform pg_temp.noter('A', 'A2. le plafond de taille est posé (200 Mo)',
    v_b.file_size_limit = 209715200);

  perform pg_temp.noter('A', 'A3. la liste blanche ne contient QUE des types vidéo',
    v_b.allowed_mime_types is not null
    and not exists (select 1 from unnest(v_b.allowed_mime_types) t where t not like 'video/%'));

  perform pg_temp.noter('A', 'A4. les trois conteneurs attendus sont acceptés (dont .mov iPhone)',
    v_b.allowed_mime_types @> array['video/mp4', 'video/quicktime', 'video/webm']);

  select count(distinct cmd) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'coach_reply_videos_%';
  perform pg_temp.noter('A', 'A5. quatre policies, une par commande', v_n = 4);

  -- Aucune policy ne doit se contenter du RÔLE : c'est le défaut du bucket
  -- `videos` préexistant, et la raison pour laquelle ce chantier en crée un
  -- dédié plutôt que d'y loger les réponses.
  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'coach_reply_videos_%'
     and (coalesce(qual, with_check) not like '%coach_reply_video_%able%'
          or coalesce(qual, with_check) like '%auth.role()%');
  perform pg_temp.noter('A', 'A6. aucune policy ne se contente du rôle : toutes passent par un prédicat',
    v_n = 0);

  -- L'ASYMÉTRIE, vérifiée là où elle vit : SELECT passe par le prédicat de
  -- LECTURE, les trois autres par celui d'ÉCRITURE. Les intervertir
  -- donnerait à l'élève le droit de déposer, ou lui retirerait celui de voir.
  select coalesce(qual, with_check) into v_def from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'coach_reply_videos_select_student_or_staff';
  perform pg_temp.noter('A', 'A7. SELECT passe par le prédicat de LECTURE',
    v_def like '%coach_reply_video_readable%');

  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('coach_reply_videos_insert_coach', 'coach_reply_videos_update_coach',
                        'coach_reply_videos_delete_coach')
     and coalesce(qual, with_check) like '%coach_reply_video_writable%';
  perform pg_temp.noter('A', 'A8. INSERT, UPDATE et DELETE passent par le prédicat d''ÉCRITURE',
    v_n = 3);

  -- Sans WITH CHECK sur UPDATE, on pourrait déplacer un objet qu'on a le
  -- droit de voir vers un chemin qu'on n'a pas le droit d'écrire.
  perform pg_temp.noter('A', 'A9. la policy UPDATE porte un WITH CHECK',
    exists (select 1 from pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'coach_reply_videos_update_coach' and with_check is not null));

  -- `anon` n'a aucune raison d'exécuter les prédicats, et `service_role`
  -- porte BYPASSRLS : les policies ne sont jamais évaluées pour lui.
  perform pg_temp.noter('A', 'A10. les prédicats ne sont exécutables que par authenticated',
    has_function_privilege('anon', 'public.coach_reply_video_readable(text)', 'execute') is false
    and has_function_privilege('anon', 'public.coach_reply_video_writable(text)', 'execute') is false
    and has_function_privilege('service_role', 'public.coach_reply_video_writable(text)', 'execute') is false
    and has_function_privilege('authenticated', 'public.coach_reply_video_readable(text)', 'execute')
    and has_function_privilege('authenticated', 'public.coach_reply_video_writable(text)', 'execute'));
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- B. DÉPÔT — le coach rattaché oui, l'élève JAMAIS
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_a  uuid := '52000000-0000-4000-8000-000000000002';
  v_b  uuid := '52000000-0000-4000-8000-000000000003';
  v_orph uuid := '52000000-0000-4000-8000-000000000006';
  v_ok boolean;
begin
  -- LE COACH RATTACHÉ DÉPOSE DANS LE DOSSIER DE SON ÉLÈVE.
  perform pg_temp.coach_a();
  insert into storage.objects (bucket_id, name, owner)
  values ('coach-reply-videos', pg_temp.chemin(v_a, '5b000000-0000-4000-8000-0000000000a1'::uuid),
          '50000000-0000-4000-8000-000000000001'::uuid);
  reset role;
  perform pg_temp.noter('B', 'B1. le coach RATTACHÉ dépose dans le dossier de son élève',
    exists (select 1 from storage.objects
             where bucket_id = 'coach-reply-videos'
               and name = pg_temp.chemin(v_a, '5b000000-0000-4000-8000-0000000000a1'::uuid)));

  -- L'INVERSION : L'ÉLÈVE NE DÉPOSE RIEN, MÊME CHEZ LUI.
  -- C'est la question centrale de ce chantier. En F4 c'était son droit le
  -- plus évident ; ici, ce serait la faille.
  perform pg_temp.eleve_a();
  v_ok := pg_temp.refuse(format($q$
    insert into storage.objects (bucket_id, name, owner)
    values ('coach-reply-videos', %L, '50000000-0000-4000-8000-000000000002'::uuid)
  $q$, pg_temp.chemin(v_a, '5b000000-0000-4000-8000-0000000000a2'::uuid)));
  reset role;
  perform pg_temp.noter('B', 'B2. l''ÉLÈVE ne dépose RIEN, même dans son propre dossier', v_ok);

  -- Le coach d'un autre élève n'écrit pas ici.
  perform pg_temp.coach_b();
  v_ok := pg_temp.refuse(format($q$
    insert into storage.objects (bucket_id, name, owner)
    values ('coach-reply-videos', %L, '50000000-0000-4000-8000-000000000005'::uuid)
  $q$, pg_temp.chemin(v_a, '5b000000-0000-4000-8000-0000000000a3'::uuid)));
  reset role;
  perform pg_temp.noter('B', 'B3. un coach NON rattaché ne dépose pas dans ce dossier', v_ok);

  -- Élève sans coach : personne ne lui répond, sauf l'admin.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    insert into storage.objects (bucket_id, name, owner)
    values ('coach-reply-videos', %L, '50000000-0000-4000-8000-000000000001'::uuid)
  $q$, pg_temp.chemin(v_orph, '5b000000-0000-4000-8000-0000000000c1'::uuid)));
  reset role;
  perform pg_temp.noter('B', 'B4. un élève SANS coach_id n''est ouvert à aucun coach', v_ok);

  perform pg_temp.admin();
  insert into storage.objects (bucket_id, name, owner)
  values ('coach-reply-videos', pg_temp.chemin(v_orph, '5b000000-0000-4000-8000-0000000000c2'::uuid),
          '50000000-0000-4000-8000-000000000004'::uuid);
  reset role;
  perform pg_temp.noter('B', 'B5. l''administrateur, lui, peut répondre à un élève sans coach',
    exists (select 1 from storage.objects
             where bucket_id = 'coach-reply-videos'
               and name = pg_temp.chemin(v_orph, '5b000000-0000-4000-8000-0000000000c2'::uuid)));

  -- Un chemin difforme est refusé par le prédicat lui-même, avant toute
  -- question d'appartenance.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse($q$
    insert into storage.objects (bucket_id, name, owner)
    values ('coach-reply-videos', 'a-la-racine.mp4', '50000000-0000-4000-8000-000000000001'::uuid)
  $q$);
  reset role;
  perform pg_temp.noter('B', 'B6. un chemin hors forme est refusé, même au coach', v_ok);

  -- Le dépôt pour l'élève B, par SON coach — sert aux contrôles de lecture.
  perform pg_temp.coach_b();
  insert into storage.objects (bucket_id, name, owner)
  values ('coach-reply-videos', pg_temp.chemin(v_b, '5b000000-0000-4000-8000-0000000000b1'::uuid),
          '50000000-0000-4000-8000-000000000005'::uuid);
  reset role;
  perform pg_temp.noter('B', 'B7. le coach B dépose chez SON élève', true);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- C. LECTURE — l'élève destinataire voit, et lui seul (avec son coach)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_a uuid := '52000000-0000-4000-8000-000000000002';
  v_b uuid := '52000000-0000-4000-8000-000000000003';
  v_n int;
begin
  perform pg_temp.eleve_a();
  select count(*) into v_n from storage.objects
   where bucket_id = 'coach-reply-videos' and name like v_a::text || '/%';
  reset role;
  perform pg_temp.noter('C', 'C1. l''élève DESTINATAIRE lit la réponse qui lui est destinée', v_n = 1);

  perform pg_temp.eleve_a();
  select count(*) into v_n from storage.objects
   where bucket_id = 'coach-reply-videos' and name like v_b::text || '/%';
  reset role;
  perform pg_temp.noter('C', 'C2. il ne voit RIEN de la réponse destinée à un autre élève', v_n = 0);

  perform pg_temp.coach_a();
  select count(*) into v_n from storage.objects
   where bucket_id = 'coach-reply-videos' and name like v_a::text || '/%';
  reset role;
  perform pg_temp.noter('C', 'C3. le coach rattaché relit ce qu''il a déposé', v_n = 1);

  perform pg_temp.coach_a();
  select count(*) into v_n from storage.objects
   where bucket_id = 'coach-reply-videos' and name like v_b::text || '/%';
  reset role;
  perform pg_temp.noter('C', 'C4. un coach ne lit pas la réponse d''un élève qu''il ne suit pas', v_n = 0);

  perform pg_temp.admin();
  select count(*) into v_n from storage.objects where bucket_id = 'coach-reply-videos';
  reset role;
  perform pg_temp.noter('C', 'C5. l''administrateur voit tout le bucket', v_n = 3);

  -- L'élève sans coach lit quand même ce que l'admin lui a déposé : la
  -- lecture ne dépend pas d'un rattachement.
  perform pg_temp.eleve_orphelin();
  select count(*) into v_n from storage.objects
   where bucket_id = 'coach-reply-videos'
     and name like '52000000-0000-4000-8000-000000000006/%';
  reset role;
  perform pg_temp.noter('C', 'C6. un élève sans coach lit la réponse de l''administrateur', v_n = 1);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- D. DÉPLACEMENT ET SUPPRESSION — réservés à qui peut écrire
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_a uuid := '52000000-0000-4000-8000-000000000002';
  v_chemin text := pg_temp.chemin('52000000-0000-4000-8000-000000000002'::uuid,
                                  '5b000000-0000-4000-8000-0000000000a1'::uuid);
  v_ok boolean;
begin
  -- L'élève VOIT l'objet : c'est justement ce qui rend la question réelle.
  -- Pouvoir lire ne doit jamais suffire à pouvoir effacer.
  perform pg_temp.eleve_a();
  v_ok := pg_temp.refuse(format('delete from storage.objects where bucket_id = %L and name = %L',
                                'coach-reply-videos', v_chemin));
  reset role;
  perform pg_temp.noter('D', 'D1. l''élève ne SUPPRIME pas la réponse qu''il peut lire',
    v_ok or exists (select 1 from storage.objects
                     where bucket_id = 'coach-reply-videos' and name = v_chemin));

  -- Un DELETE que la RLS masque ne lève pas d'exception : il ne touche
  -- simplement aucune ligne. On mesure donc la PRÉSENCE, pas l'erreur.
  perform pg_temp.noter('D', 'D1bis. et l''objet est toujours là',
    exists (select 1 from storage.objects
             where bucket_id = 'coach-reply-videos' and name = v_chemin));

  perform pg_temp.eleve_a();
  update storage.objects set name = pg_temp.chemin(v_a, '5b000000-0000-4000-8000-0000000000d1'::uuid)
   where bucket_id = 'coach-reply-videos' and name = v_chemin;
  reset role;
  perform pg_temp.noter('D', 'D2. l''élève ne DÉPLACE pas davantage',
    exists (select 1 from storage.objects
             where bucket_id = 'coach-reply-videos' and name = v_chemin));

  -- Le coach, lui, remplace : c'est son fichier, sur son élève.
  perform pg_temp.coach_a();
  delete from storage.objects where bucket_id = 'coach-reply-videos' and name = v_chemin;
  reset role;
  perform pg_temp.noter('D', 'D3. le coach rattaché, lui, peut supprimer',
    not exists (select 1 from storage.objects
                 where bucket_id = 'coach-reply-videos' and name = v_chemin));

  -- On le repose pour la suite.
  perform pg_temp.coach_a();
  insert into storage.objects (bucket_id, name, owner)
  values ('coach-reply-videos', v_chemin, '50000000-0000-4000-8000-000000000001'::uuid);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- E. LA COLONNE — écrire un chemin n'exige aucun fichier
-- ════════════════════════════════════════════════════════════════════════════
-- La RLS du bucket n'est JAMAIS consultée quand on écrit `coach_reply_video_path`
-- sur une ligne de `workout_feedback` : c'est un autre chemin d'écriture, et
-- c'est le gardien qui doit le tenir.
do $$
declare
  v_a       uuid := '52000000-0000-4000-8000-000000000002';
  v_retour  uuid := '59000000-0000-4000-8000-0000000000a1';
  v_chemin  text := pg_temp.chemin('52000000-0000-4000-8000-000000000002'::uuid,
                                   '5b000000-0000-4000-8000-0000000000a1'::uuid);
  v_valeur  text;
  v_calque  jsonb;
begin
  -- LE COACH POSE. C'est le cas nominal, et il doit marcher.
  perform pg_temp.coach_a();
  update public.workout_feedback
     set coach_reply = 'Regarde ta position de départ.',
         coach_reply_video_path = v_chemin,
         coach_reply_video_annotations =
           '[{"id":"a1","type":"fleche","debut":1,"duree":3,"couleur":"#ffffff",
              "de":{"x":0.1,"y":0.1},"a":{"x":0.5,"y":0.5}}]'::jsonb
   where id = v_retour;
  reset role;
  select coach_reply_video_path, coach_reply_video_annotations into v_valeur, v_calque
    from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('E', 'E1. le coach rattaché pose le chemin ET le calque',
    v_valeur = v_chemin and jsonb_array_length(v_calque) = 1);

  -- L'ÉLÈVE TENTE DE MODIFIER. Le gardien RESTAURE : l'UPDATE rapporte
  -- « 1 ligne » sans avoir rien changé. On mesure donc la VALEUR.
  perform pg_temp.eleve_a();
  update public.workout_feedback
     set coach_reply_video_path = pg_temp.chemin(v_a, '5b000000-0000-4000-8000-0000000000e1'::uuid)
   where id = v_retour;
  reset role;
  select coach_reply_video_path into v_valeur from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('E', 'E2. l''élève ne CHANGE pas le chemin de sa réponse (valeur restaurée)',
    v_valeur = v_chemin);

  perform pg_temp.eleve_a();
  update public.workout_feedback set coach_reply_video_path = null where id = v_retour;
  reset role;
  select coach_reply_video_path into v_valeur from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('E', 'E3. l''élève ne RETIRE pas davantage la réponse de son coach',
    v_valeur = v_chemin);

  perform pg_temp.eleve_a();
  update public.workout_feedback
     set coach_reply_video_annotations = '[]'::jsonb where id = v_retour;
  reset role;
  select coach_reply_video_annotations into v_calque from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('E', 'E4. l''élève ne touche pas au calque non plus',
    jsonb_array_length(v_calque) = 1);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- F. LE CHEMIN DOIT DÉSIGNER L'ÉLÈVE DE CE RETOUR
-- ════════════════════════════════════════════════════════════════════════════
-- Cette question ne se pose QUE parce que les deux droits existent : un coach
-- qui suivrait A et B pourrait écrire dans les deux dossiers côté Storage.
-- C'est le gardien de `workout_feedback` qui refuse de coller la réponse de
-- l'un sur le retour de l'autre.
do $$
declare
  v_retour_a uuid := '59000000-0000-4000-8000-0000000000a1';
  v_chemin_b text := pg_temp.chemin('52000000-0000-4000-8000-000000000003'::uuid,
                                    '5b000000-0000-4000-8000-0000000000b1'::uuid);
  v_ok boolean;
  v_valeur text;
begin
  -- L'ADMINISTRATEUR a le droit d'écrire dans les deux dossiers : c'est donc
  -- lui, et pas un coach limité, qui fait le meilleur attaquant ici.
  perform pg_temp.admin();
  v_ok := pg_temp.refuse(format(
    'update public.workout_feedback set coach_reply_video_path = %L where id = %L',
    v_chemin_b, v_retour_a));
  reset role;
  perform pg_temp.noter('F', 'F1. un chemin désignant un AUTRE élève est REFUSÉ, admin compris', v_ok);

  select coach_reply_video_path into v_valeur from public.workout_feedback where id = v_retour_a;
  perform pg_temp.noter('F', 'F2. et la valeur d''origine est intacte',
    v_valeur = pg_temp.chemin('52000000-0000-4000-8000-000000000002'::uuid,
                              '5b000000-0000-4000-8000-0000000000a1'::uuid));

  -- La FORME est tenue par une contrainte de colonne, indépendamment du
  -- gardien : elle vaut même sur un chemin d'écriture qui contournerait le
  -- trigger.
  perform pg_temp.admin();
  v_ok := pg_temp.refuse(format(
    'update public.workout_feedback set coach_reply_video_path = %L where id = %L',
    '52000000-0000-4000-8000-000000000002/pas-un-uuid.mp4', v_retour_a));
  reset role;
  perform pg_temp.noter('F', 'F3. un chemin hors forme est refusé par la contrainte', v_ok);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- G. coach_reply_video_uploaded_at — DÉRIVÉ, non falsifiable
-- ════════════════════════════════════════════════════════════════════════════
-- C'est cette date qui déclenche la purge à 3 jours. Qui pourrait l'écrire
-- pourrait garder sa vidéo indéfiniment.
--
-- Le gardien utilise `clock_timestamp()` et non `now()` : `now()` rend
-- l'heure de DÉBUT DE TRANSACTION, ce qui rendrait « la date a-t-elle été
-- repoussée ? » INVÉRIFIABLE — un contrôle passerait aussi bien si la règle
-- était fausse.
do $$
declare
  v_retour uuid := '59000000-0000-4000-8000-0000000000a1';
  v_chemin text := pg_temp.chemin('52000000-0000-4000-8000-000000000002'::uuid,
                                  '5b000000-0000-4000-8000-0000000000a1'::uuid);
  v_avant  timestamptz;
  v_apres  timestamptz;
  v_valeur text;
begin
  select coach_reply_video_uploaded_at into v_avant
    from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('G', 'G1. la date a été posée avec le chemin', v_avant is not null);

  -- Le coach tente de la repousser d'un an. Elle est DÉRIVÉE : la valeur
  -- envoyée n'est même pas lue.
  perform pg_temp.coach_a();
  update public.workout_feedback
     set coach_reply_video_uploaded_at = clock_timestamp() + interval '365 days'
   where id = v_retour;
  reset role;
  select coach_reply_video_uploaded_at into v_apres
    from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('G', 'G2. le COACH ne repousse pas la date de dépôt',
    v_apres < clock_timestamp() + interval '1 hour');

  -- L'administrateur non plus : la règle ne connaît pas de dispense.
  perform pg_temp.admin();
  update public.workout_feedback
     set coach_reply_video_uploaded_at = clock_timestamp() + interval '365 days'
   where id = v_retour;
  reset role;
  select coach_reply_video_uploaded_at into v_apres
    from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('G', 'G3. l''ADMINISTRATEUR non plus',
    v_apres < clock_timestamp() + interval '1 hour');

  -- Un NOUVEAU chemin redate. C'est correct : c'est un autre fichier.
  perform pg_temp.coach_a();
  insert into storage.objects (bucket_id, name, owner)
  values ('coach-reply-videos',
          pg_temp.chemin('52000000-0000-4000-8000-000000000002'::uuid,
                         '5b000000-0000-4000-8000-0000000000a9'::uuid),
          '50000000-0000-4000-8000-000000000001'::uuid);
  update public.workout_feedback
     set coach_reply_video_path = pg_temp.chemin('52000000-0000-4000-8000-000000000002'::uuid,
                                                 '5b000000-0000-4000-8000-0000000000a9'::uuid)
   where id = v_retour;
  reset role;
  select coach_reply_video_uploaded_at into v_apres
    from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('G', 'G4. un NOUVEAU chemin redate le dépôt', v_apres > v_avant);

  -- Et le retrait remet la date à NULL — sans quoi une vidéo absente
  -- resterait « datée », donc invisible à la purge comme à l'affichage.
  perform pg_temp.coach_a();
  update public.workout_feedback set coach_reply_video_path = null where id = v_retour;
  reset role;
  select coach_reply_video_path, coach_reply_video_uploaded_at::text into v_valeur, v_apres
    from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('G', 'G5. le retrait remet la date à NULL',
    v_valeur is null and v_apres is null);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- H. LE CALQUE — structure validée, et il part avec la vidéo
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_retour uuid := '59000000-0000-4000-8000-0000000000a1';
  v_chemin text := pg_temp.chemin('52000000-0000-4000-8000-000000000002'::uuid,
                                  '5b000000-0000-4000-8000-0000000000a1'::uuid);
  v_calque jsonb;
  v_ok boolean;
begin
  -- Le retrait de la section G a dû emporter le calque : un calque sans
  -- vidéo ne se rejoue par-dessus rien.
  select coach_reply_video_annotations into v_calque
    from public.workout_feedback where id = v_retour;
  perform pg_temp.noter('H', 'H1. retirer la vidéo a EMPORTÉ le calque', v_calque is null);

  perform pg_temp.coach_a();
  update public.workout_feedback
     set coach_reply_video_path = v_chemin,
         coach_reply_video_annotations =
           '[{"id":"c1","type":"cercle","debut":0,"duree":2,"couleur":"#f59e0b",
              "centre":{"x":0.5,"y":0.5},"rayon":0.1}]'::jsonb
   where id = v_retour;
  reset role;

  -- Un type que le lecteur ne sait pas dessiner ne doit pas entrer.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations = '[{"type":"laser","debut":1,"duree":1}]'::jsonb
     where id = %L
  $q$, v_retour));
  reset role;
  perform pg_temp.noter('H', 'H2. un type d''annotation inconnu est REFUSÉ', v_ok);

  -- Sans instant ni durée, rien n'est rejouable. La CLÉ ABSENTE est le cas
  -- qui compte : `jsonb_typeof(tr->'duree')` rend NULL, et une comparaison
  -- avec NULL ne satisfait aucun WHERE — sans `coalesce`, le calque passait.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations = '[{"type":"cercle","debut":1}]'::jsonb
     where id = %L
  $q$, v_retour));
  reset role;
  perform pg_temp.noter('H', 'H3. une annotation sans DURÉE est REFUSÉE', v_ok);

  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations = '[{"type":"cercle","duree":2}]'::jsonb
     where id = %L
  $q$, v_retour));
  reset role;
  perform pg_temp.noter('H', 'H3bis. une annotation sans INSTANT est REFUSÉE', v_ok);

  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations = '[{"type":"cercle","debut":-1,"duree":2}]'::jsonb
     where id = %L
  $q$, v_retour));
  reset role;
  perform pg_temp.noter('H', 'H4. un instant NÉGATIF est REFUSÉ', v_ok);

  -- Un objet, pas un tableau : la colonne n'est pas un fourre-tout jsonb.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations = '{"type":"cercle"}'::jsonb
     where id = %L
  $q$, v_retour));
  reset role;
  perform pg_temp.noter('H', 'H5. un calque qui n''est pas un TABLEAU est REFUSÉ', v_ok);

  -- ── LES BORNES OPPOSABLES, ET NON SEULEMENT AFFICHÉES ────────────────
  -- Le lecteur BORNE déjà tout cela à la lecture. Mais une borne qui ne vit
  -- que dans le navigateur n'est pas une borne : elle est un affichage poli.
  -- Chacune de ces cinq est ici parce qu'elle passait, avant, en silence.

  -- Une flèche sans extrémités : la base l'acceptait, le lecteur l'écartait.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations = '[{"type":"fleche","debut":1,"duree":2}]'::jsonb
     where id = %L
  $q$, v_retour));
  reset role;
  perform pg_temp.noter('H', 'H7. un tracé SANS de quoi le dessiner est REFUSÉ', v_ok);

  -- Une coordonnée hors du cadre désigne le vide.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations =
         '[{"type":"cercle","debut":1,"duree":2,"centre":{"x":1.5,"y":0.5},"rayon":0.1}]'::jsonb
     where id = %L
  $q$, v_retour));
  reset role;
  perform pg_temp.noter('H', 'H8. une coordonnée HORS du cadre est REFUSÉE', v_ok);

  -- Une étiquette, pas un paragraphe : 80 caractères.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations =
         '[{"type":"texte","debut":1,"duree":2,"position":{"x":0.5,"y":0.5},"contenu":"%s"}]'::jsonb
     where id = %L
  $q$, repeat('x', 200), v_retour));
  reset role;
  perform pg_temp.noter('H', 'H9. un texte d''annotation trop long est REFUSÉ', v_ok);

  -- 120 s : la durée maximale d'une réponse. Au-delà, le tracé ne désigne
  -- plus rien de la vidéo.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations =
         '[{"type":"cercle","debut":999,"duree":2,"centre":{"x":0.5,"y":0.5},"rayon":0.1}]'::jsonb
     where id = %L
  $q$, v_retour));
  reset role;
  perform pg_temp.noter('H', 'H10. un instant au-delà de la vidéo est REFUSÉ', v_ok);

  -- La TAILLE, et pas seulement le nombre : deux cents traits libres de deux
  -- cent quarante points pèsent plus d'un mégaoctet et passeraient le compte
  -- de 200 sans broncher.
  perform pg_temp.coach_a();
  v_ok := pg_temp.refuse(format($q$
    update public.workout_feedback
       set coach_reply_video_annotations =
         jsonb_build_array(jsonb_build_object(
           'type', 'texte', 'debut', 1, 'duree', 2,
           'position', jsonb_build_object('x', 0.5, 'y', 0.5),
           'contenu', %L))
         || (select jsonb_agg(jsonb_build_object(
               'type','trait','debut',1,'duree',2,
               'points', (select jsonb_agg(jsonb_build_object('x', 0.5, 'y', 0.5))
                            from generate_series(1, 240))))
               from generate_series(1, 200))
     where id = %L
  $q$, 'ok', v_retour));
  reset role;
  perform pg_temp.noter('H', 'H11. un calque de plus de 256 Ko est REFUSÉ', v_ok);

  -- Un calque sans vidéo n'a rien à recouvrir. La contrainte reste le second
  -- verrou derrière le gardien, et on la vérifie directement.
  perform pg_temp.admin();
  v_ok := pg_temp.refuse($q$
    update public.workout_feedback
       set coach_reply_video_annotations = '[{"type":"cercle","debut":0,"duree":1}]'::jsonb
     where id = '59000000-0000-4000-8000-0000000000b1'
  $q$);
  reset role;
  perform pg_temp.noter('H', 'H6. un calque SANS vidéo est REFUSÉ', v_ok);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- I. ANON — il ne voit rien, il n'écrit rien
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int; v_ok boolean;
begin
  set local role anon;
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from storage.objects where bucket_id = 'coach-reply-videos';
  reset role;
  perform pg_temp.noter('I', 'I1. anon ne lit AUCUN objet du bucket', v_n = 0);

  set local role anon;
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from public.workout_feedback where coach_reply_video_path is not null;
  reset role;
  perform pg_temp.noter('I', 'I2. anon ne lit AUCUN chemin de réponse', v_n = 0);

  set local role anon;
  perform set_config('request.jwt.claims', null, true);
  v_ok := pg_temp.refuse($q$
    insert into storage.objects (bucket_id, name)
    values ('coach-reply-videos',
            '52000000-0000-4000-8000-000000000002/5b000000-0000-4000-8000-0000000000f1.mp4')
  $q$);
  reset role;
  perform pg_temp.noter('I', 'I3. anon n''écrit rien dans le bucket', v_ok);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- BILAN
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_total int; v_ko int; r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_ko from _faits;
  raise notice '';
  for r in select section, libelle from _faits where not ok order by section, libelle loop
    raise warning 'RESTE À CORRIGER — %. %', r.section, r.libelle;
  end loop;
  raise notice '──────── % contrôles, % échec(s) ────────', v_total, v_ko;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- Z. RIEN NE SURVIT
-- ════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '--- Réponse vidéo du coach : tout tient. ROLLBACK. ---'
rollback;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'coach-reply-videos') then
    raise warning 'ÉCHEC   — Z1. des objets survivent au ROLLBACK';
  elsif exists (select 1 from public.workout_feedback where coach_reply_video_path is not null) then
    raise warning 'ÉCHEC   — Z2. des chemins survivent au ROLLBACK';
  elsif exists (select 1 from public.students where email like 'f5.%') then
    raise warning 'ÉCHEC   — Z3. des élèves de test survivent au ROLLBACK';
  else
    raise notice 'OK      — Z1/Z2/Z3. aucune donnée de test après le ROLLBACK';
  end if;
end $$;
