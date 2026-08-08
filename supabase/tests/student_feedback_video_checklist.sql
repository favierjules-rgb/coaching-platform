-- ============================================================================
-- Checklist PostgreSQL — F4 : VIDÉO DE TECHNIQUE DE L'ÉLÈVE
-- (migration 20260826090000_student_feedback_video)
--
-- LES QUESTIONS POSÉES, ET SEULEMENT CELLES-LÀ
--   1. « Un élève peut-il déposer un fichier ailleurs que dans son dossier ? »
--   2. « Un élève peut-il VOIR, DÉPLACER ou EFFACER la vidéo d'un autre ? »
--   3. « Un élève peut-il ATTRIBUER à sa ligne de retour la vidéo d'un
--      autre ? » — la question est distincte de la précédente : écrire une
--      colonne n'exige aucun dépôt de fichier, donc la RLS du bucket n'est
--      jamais consultée sur ce chemin-là.
--   4. « La date de dépôt peut-elle être falsifiée ? » — c'est elle qui
--      datera la purge des 30 jours.
--   5. « Le staff peut-il POSER une vidéo au nom d'un élève ? » (il doit
--      pouvoir la RETIRER, jamais la poser.)
--   6. « `anon` voit-il quoi que ce soit ? »
--
-- COMMENT ELLES SONT POSÉES
--   En EXÉCUTANT des écritures sous le rôle `authenticated`, avec les claims
--   JWT de CINQ acteurs : élève A, élève B, coach, administrateur, et `anon`.
--   Jamais en relisant des politiques. Les objets sont écrits directement
--   dans `storage.objects` — c'est exactement la table que storage-api
--   manipule, et donc exactement la RLS qui s'applique en production.
--
-- DEUX RÈGLES DE MÉTHODE, REPRISES DE LA CHECKLIST F3
--   * On mesure la VALEUR, jamais le nombre de lignes. Le gardien est un
--     trigger BEFORE : sur la tentative du staff, il RESTAURE l'ancienne
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
--   sont donc vérifiés ici par LECTURE de la ligne du bucket (section A), et
--   comparés au code par scripts/tests/student-feedback-video.mts. Cette
--   limite est nommée plutôt que masquée par un contrôle qui semblerait
--   passer.
--   La DURÉE non plus : PostgreSQL ne sait pas combien de temps dure un
--   fichier. Les 20 secondes ne sont tenues que par le navigateur.
--
-- SECTIONS
--   A. le bucket : privé, plafonné, typé ;
--   B. dépôt : son dossier oui, celui d'un autre non ;
--   C. lecture, déplacement, suppression entre élèves ;
--   D. la COLONNE : attribuer la vidéo d'un autre à sa propre ligne ;
--   E. video_uploaded_at : dérivé, non falsifiable, remis à NULL au retrait ;
--   F. le staff : il retire, il ne pose pas ;
--   I. le cycle de vie : resoumission, retrait, et ce qui survit dans le bucket ;
--   G. anon ;
--   H. rien ne survit au ROLLBACK.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   psql -U postgres -d <base_locale> -v ON_ERROR_STOP=1 \
--     -f supabase/tests/student_feedback_video_checklist.sql
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

-- `p_ok is not true` et non `not p_ok` : un verdict NULL — typiquement une
-- comparaison sur une ligne que la RLS a masquée — est un ÉCHEC, jamais un
-- succès silencieux.
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

-- Chemin conforme : `<student_id>/<uuid>.<extension>`.
create or replace function pg_temp.chemin(p_student uuid, p_fichier uuid, p_ext text default 'mp4')
returns text language sql immutable as $$
  select p_student::text || '/' || p_fichier::text || '.' || p_ext
$$;

create or replace function pg_temp.eleve_a() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.eleve_b() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.coach() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.coach_b() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.eleve_orphelin() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
end $$;

create or replace function pg_temp.admin() returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- LE DÉCOR — cinq acteurs, deux élèves, deux retours symétriques
-- ════════════════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  ('30000000-0000-4000-8000-000000000001'::uuid, 'f4.coachA@test.local'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'f4.eleveA@test.local'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'f4.eleveB@test.local'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'f4.admin@test.local'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'f4.coachB@test.local'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'f4.eleveOrphelin@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('30000000-0000-4000-8000-000000000001'::uuid, 'coach',   'F4CoachA', 'T', 'f4.coachA@test.local'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'student', 'F4EleveA', 'T', 'f4.eleveA@test.local'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'student', 'F4EleveB', 'T', 'f4.eleveB@test.local'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'admin',   'F4Admin', 'T', 'f4.admin@test.local'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'coach',   'F4CoachB', 'T', 'f4.coachB@test.local'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'student', 'F4Orphelin', 'T', 'f4.eleveOrphelin@test.local');

-- DEUX coachs. Sans le second, « le coach A ne lit pas l'élève du coach B »
-- ne serait pas testable, et la règle ne vaudrait que sur le papier.
insert into public.coaches (id, user_id, name, email) values
  ('31000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 'F4CoachA', 'f4.coachA@test.local'),
  ('31000000-0000-4000-8000-000000000002'::uuid, '30000000-0000-4000-8000-000000000005'::uuid, 'F4CoachB', 'f4.coachB@test.local');

-- Trois élèves : un par coach, plus un SANS rattachement — la Production en
-- porte, et la migration n'invente aucun lien.
insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
  ('32000000-0000-4000-8000-000000000002'::uuid, '30000000-0000-4000-8000-000000000002'::uuid,
   '31000000-0000-4000-8000-000000000001'::uuid, 'F4EleveA', 'T', 'f4.eleveA@test.local', 'active', 'coaching'),
  ('32000000-0000-4000-8000-000000000003'::uuid, '30000000-0000-4000-8000-000000000003'::uuid,
   '31000000-0000-4000-8000-000000000002'::uuid, 'F4EleveB', 'T', 'f4.eleveB@test.local', 'active', 'coaching'),
  ('32000000-0000-4000-8000-000000000006'::uuid, '30000000-0000-4000-8000-000000000006'::uuid,
   null, 'F4Orphelin', 'T', 'f4.eleveOrphelin@test.local', 'active', 'coaching');

insert into public.programs (id, coach_id, name, status, program_mode) values
  ('34000000-0000-4000-8000-000000000001'::uuid, '31000000-0000-4000-8000-000000000001'::uuid, 'Programme F4 — A', 'actif', 'individuel'),
  ('34000000-0000-4000-8000-000000000002'::uuid, '31000000-0000-4000-8000-000000000001'::uuid, 'Programme F4 — B', 'actif', 'individuel');

insert into public.program_weeks (id, program_id, week_number) values
  ('35000000-0000-4000-8000-000000000001'::uuid, '34000000-0000-4000-8000-000000000001'::uuid, 1),
  ('35000000-0000-4000-8000-000000000002'::uuid, '34000000-0000-4000-8000-000000000002'::uuid, 1);

insert into public.workout_sessions (id, program_id, program_week_id, day, name, muscle_group) values
  ('36000000-0000-4000-8000-000000000001'::uuid, '34000000-0000-4000-8000-000000000001'::uuid,
   '35000000-0000-4000-8000-000000000001'::uuid, 'lundi', 'Séance de A', 'pectoraux'),
  ('36000000-0000-4000-8000-000000000002'::uuid, '34000000-0000-4000-8000-000000000002'::uuid,
   '35000000-0000-4000-8000-000000000002'::uuid, 'lundi', 'Séance de B', 'dos');

insert into public.assignments (student_id, content_type, content_id) values
  ('32000000-0000-4000-8000-000000000002'::uuid, 'programme', '34000000-0000-4000-8000-000000000001'::uuid),
  ('32000000-0000-4000-8000-000000000003'::uuid, 'programme', '34000000-0000-4000-8000-000000000002'::uuid);

-- Un retour par élève, et une ligne d'exercice par retour.
insert into public.workout_feedback (id, student_id, session_id, session_key, session_ref_label, completed) values
  ('39000000-0000-4000-8000-0000000000a1'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
   '36000000-0000-4000-8000-000000000001'::uuid, '36000000-0000-4000-8000-000000000001', 'Séance de A', true),
  ('39000000-0000-4000-8000-0000000000b1'::uuid, '32000000-0000-4000-8000-000000000003'::uuid,
   '36000000-0000-4000-8000-000000000002'::uuid, '36000000-0000-4000-8000-000000000002', 'Séance de B', true);

insert into public.exercise_feedback (id, workout_feedback_id, student_id, exercise_name, exercise_order) values
  ('3a000000-0000-4000-8000-0000000000a1'::uuid, '39000000-0000-4000-8000-0000000000a1'::uuid,
   '32000000-0000-4000-8000-000000000002'::uuid, 'Développé couché', 0),
  ('3a000000-0000-4000-8000-0000000000b1'::uuid, '39000000-0000-4000-8000-0000000000b1'::uuid,
   '32000000-0000-4000-8000-000000000003'::uuid, 'Rowing barre', 0);


-- ════════════════════════════════════════════════════════════════════════════
-- A. LE BUCKET — privé, plafonné, typé
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_b record; v_n int;
begin
  select * into v_b from storage.buckets where id = 'feedback-videos';

  perform pg_temp.noter('A', 'A1. le bucket feedback-videos existe et est PRIVÉ',
    v_b.id is not null and v_b.public is false);

  -- 50 Mo. Appliqué par storage-api au téléversement HTTP, pas par une
  -- contrainte : on vérifie donc qu'il est POSÉ, pas qu'il bloque ici.
  perform pg_temp.noter('A', 'A2. le plafond de taille est posé (50 Mo)',
    v_b.file_size_limit = 52428800);

  perform pg_temp.noter('A', 'A3. la liste blanche ne contient QUE des types vidéo',
    v_b.allowed_mime_types is not null
    and not exists (select 1 from unnest(v_b.allowed_mime_types) t where t not like 'video/%'));

  perform pg_temp.noter('A', 'A4. les trois conteneurs attendus sont acceptés (dont .mov iPhone)',
    v_b.allowed_mime_types @> array['video/mp4', 'video/quicktime', 'video/webm']);

  -- AUCUNE des quatre policies ne doit se contenter du rôle : c'est
  -- exactement le défaut du bucket `videos` préexistant
  -- (`auth.role() = 'authenticated'`), qui ouvre chaque objet à tout compte
  -- connecté — et la raison pour laquelle ce chantier crée un bucket dédié.
  -- Le bucket `videos` lui-même n'est pas observable ici : il ne fait pas
  -- partie de la baseline locale. Sa policy est vérifiée par lecture de
  -- `supabase/schema.sql` dans scripts/tests/student-feedback-video.mts.
  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'feedback_videos_%'
     and (coalesce(qual, with_check) not like '%feedback_video_path_owner_ok%'
          or coalesce(qual, with_check) like '%auth.role()%');
  perform pg_temp.noter('A', 'A5. aucune policy ne se contente du rôle : toutes passent par le prédicat',
    v_n = 0);

  select count(distinct cmd) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'feedback_videos_%';
  perform pg_temp.noter('A', 'A6. quatre policies, une par commande', v_n = 4);

  perform pg_temp.noter('A', 'A7. la policy UPDATE porte un WITH CHECK (sinon on DÉPLACE un objet)',
    exists (select 1 from pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'feedback_videos_update_owner_or_staff'
               and with_check is not null));

  -- Le prédicat est SECURITY DEFINER À DESSEIN : la question « à quel coach
  -- cet élève est-il rattaché ? » a une seule réponse, qui ne doit pas
  -- dépendre de ce que la RLS de `students` laisse voir à l'appelant. Ce
  -- qu'on vérifie ici, c'est qu'il reste cloisonné (search_path vide) et
  -- surtout qu'il n'ouvre PLUS le bucket à tout coach.
  perform pg_temp.noter('A', 'A8. le prédicat est cloisonné (search_path vide)',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'feedback_video_path_owner_ok'
               and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=%'));

  perform pg_temp.noter('A', 'A8bis. il n''utilise PLUS is_coach_or_admin() — sinon tout coach lirait tout élève',
    (select position('is_coach_or_admin' in pg_get_functiondef(p.oid)) = 0
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'feedback_video_path_owner_ok'));

  perform pg_temp.noter('A', 'A8ter. et il prouve l''appartenance par students.coach_id',
    (select pg_get_functiondef(p.oid) like '%s.coach_id = public.current_coach_id()%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'feedback_video_path_owner_ok'));

  perform pg_temp.noter('A', 'A9. anon n''a pas le droit d''exécuter le prédicat',
    not has_function_privilege('anon', 'public.feedback_video_path_owner_ok(text)', 'execute'));

  -- Le prédicat est SECURITY DEFINER : tout droit d'exécution inutile est un
  -- droit de trop. `service_role` porte BYPASSRLS, les policies ne sont jamais
  -- évaluées pour lui — il n'en a donc aucun besoin. Seul `authenticated`, le
  -- rôle sous lequel les policies tournent, le garde.
  perform pg_temp.noter('A', 'A10. ni anon ni service_role ne peuvent exécuter le prédicat',
    not has_function_privilege('anon', 'public.feedback_video_path_owner_ok(text)', 'execute')
    and not has_function_privilege('service_role', 'public.feedback_video_path_owner_ok(text)', 'execute'));

  perform pg_temp.noter('A', 'A11. …mais authenticated, lui, le peut (sinon plus personne ne lit)',
    has_function_privilege('authenticated', 'public.feedback_video_path_owner_ok(text)', 'execute'));

  -- La fonction de trigger, elle, n'a pas à être appelable par l'application.
  perform pg_temp.noter('A', 'A12. le gardien de trigger reste hors de portée des rôles clients',
    not has_function_privilege('anon', 'public.enforce_exercise_feedback_write()', 'execute')
    and not has_function_privilege('authenticated', 'public.enforce_exercise_feedback_write()', 'execute'));
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- B. LE DÉPÔT — son dossier oui, celui d'un autre non
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_ok boolean;
begin
  perform pg_temp.eleve_a();

  begin
    insert into storage.objects (bucket_id, name) values ('feedback-videos',
      pg_temp.chemin('32000000-0000-4000-8000-000000000002'::uuid,
                     '11111111-1111-4111-8111-111111111111'::uuid));
    v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pg_temp.noter('B', 'B1. l''élève A dépose dans SON dossier', v_ok);

  perform pg_temp.noter('B', 'B2. l''élève A ne dépose PAS dans le dossier de B',
    pg_temp.refuse($q$
      insert into storage.objects (bucket_id, name) values ('feedback-videos',
        '32000000-0000-4000-8000-000000000003/22222222-2222-4222-8222-222222222222.mp4')
    $q$));

  -- La FORME est refusée avant toute question d'appartenance : un chemin
  -- plus profond ouvrirait `<A>/../<B>/x.mp4` comme angle d'attaque.
  perform pg_temp.noter('B', 'B3. un chemin à trois segments est refusé',
    pg_temp.refuse($q$
      insert into storage.objects (bucket_id, name) values ('feedback-videos',
        '32000000-0000-4000-8000-000000000002/sous/33333333-3333-4333-8333-333333333333.mp4')
    $q$));

  perform pg_temp.noter('B', 'B4. un chemin sans dossier est refusé',
    pg_temp.refuse($q$
      insert into storage.objects (bucket_id, name) values ('feedback-videos',
        '44444444-4444-4444-4444-444444444444.mp4')
    $q$));

  perform pg_temp.noter('B', 'B5. une extension hors vocabulaire est refusée',
    pg_temp.refuse($q$
      insert into storage.objects (bucket_id, name) values ('feedback-videos',
        '32000000-0000-4000-8000-000000000002/55555555-5555-4555-8555-555555555555.exe')
    $q$));

  perform pg_temp.noter('B', 'B6. un dossier qui n''est pas un uuid est refusé',
    pg_temp.refuse($q$
      insert into storage.objects (bucket_id, name) values ('feedback-videos',
        'public/66666666-6666-4666-8666-666666666666.mp4')
    $q$));

  -- L'élève B dépose la sienne : le décor de la section C.
  perform pg_temp.eleve_b();
  begin
    insert into storage.objects (bucket_id, name) values ('feedback-videos',
      pg_temp.chemin('32000000-0000-4000-8000-000000000003'::uuid,
                     '77777777-7777-4777-8777-777777777777'::uuid));
    v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pg_temp.noter('B', 'B7. l''élève B dépose dans SON dossier', v_ok);

  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- C. ENTRE ÉLÈVES — lire, déplacer, effacer la vidéo de l'autre
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_vus int; v_reste int;
begin
  perform pg_temp.eleve_b();
  select count(*) into v_vus from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000002/%';
  perform pg_temp.noter('C', 'C1. l''élève B ne LIT pas la vidéo de A', v_vus = 0);

  select count(*) into v_vus from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000003/%';
  perform pg_temp.noter('C', 'C2. …mais voit bien la sienne (le harnais n''est pas aveugle)', v_vus = 1);

  -- Une suppression que la RLS masque ne lève AUCUNE erreur : elle ne
  -- supprime simplement rien. On mesure donc ce qui RESTE, hors du rôle de
  -- l'attaquant, jamais le succès apparent de l'ordre.
  delete from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000002/%';

  -- Un déplacement vers son propre dossier : la policy UPDATE porte un
  -- WITH CHECK, mais c'est le USING qui arrête déjà l'élève B ici.
  update storage.objects
     set name = '32000000-0000-4000-8000-000000000003/88888888-8888-4888-8888-888888888888.mp4'
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000002/%';

  reset role;

  select count(*) into v_reste from storage.objects
   where bucket_id = 'feedback-videos'
     and name = '32000000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.mp4';
  perform pg_temp.noter('C', 'C3. la vidéo de A a survécu à la tentative de suppression de B', v_reste = 1);
  perform pg_temp.noter('C', 'C4. …et à la tentative de déplacement (vérifié HORS du rôle de B)', v_reste = 1);

  select count(*) into v_reste from storage.objects
   where bucket_id = 'feedback-videos'
     and name = '32000000-0000-4000-8000-000000000003/88888888-8888-4888-8888-888888888888.mp4';
  perform pg_temp.noter('C', 'C5. aucun objet n''est apparu dans le dossier de B', v_reste = 0);

  -- LE COACH A : SON élève, et LUI SEUL. C'est le correctif du point 6 de
  -- l'audit — avant, `is_coach_or_admin()` lui ouvrait tout le bucket.
  perform pg_temp.coach();
  select count(*) into v_vus from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000002/%';
  perform pg_temp.noter('C', 'C6. le coach A lit la vidéo de SON élève A', v_vus = 1);

  select count(*) into v_vus from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000003/%';
  perform pg_temp.noter('C', 'C7. le coach A ne lit PAS l''élève du coach B', v_vus = 0);

  select count(*) into v_vus from storage.objects where bucket_id = 'feedback-videos';
  perform pg_temp.noter('C', 'C8. il ne voit donc qu''une vidéo sur les deux', v_vus = 1);

  perform pg_temp.coach_b();
  select count(*) into v_vus from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000002/%';
  perform pg_temp.noter('C', 'C9. et le coach B ne lit pas l''élève A (règle symétrique)', v_vus = 0);

  select count(*) into v_vus from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000003/%';
  perform pg_temp.noter('C', 'C10. mais bien SON élève B', v_vus = 1);

  -- L'ADMIN garde l'accès administratif — convention déjà en vigueur sur
  -- toute la plateforme (`is_admin()`, distinct de `is_coach_or_admin()`).
  perform pg_temp.admin();
  select count(*) into v_vus from storage.objects where bucket_id = 'feedback-videos';
  perform pg_temp.noter('C', 'C11. l''admin voit les deux (convention administrative existante)', v_vus = 2);

  -- L'ÉLÈVE SANS COACH : visible de lui-même et de l'admin, de personne
  -- d'autre. La Production porte des rattachements incomplets ; la migration
  -- ne les invente pas, et cette ligne le prouve.
  perform pg_temp.eleve_orphelin();
  insert into storage.objects (bucket_id, name) values ('feedback-videos',
    '32000000-0000-4000-8000-000000000006/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.mp4');
  select count(*) into v_vus from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000006/%';
  perform pg_temp.noter('C', 'C12. un élève sans coach dépose et relit SA vidéo', v_vus = 1);

  perform pg_temp.coach();
  select count(*) into v_vus from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000006/%';
  perform pg_temp.noter('C', 'C13. …et AUCUN coach ne la voit tant qu''il n''y est pas rattaché', v_vus = 0);

  perform pg_temp.admin();
  select count(*) into v_vus from storage.objects
   where bucket_id = 'feedback-videos'
     and name like '32000000-0000-4000-8000-000000000006/%';
  perform pg_temp.noter('C', 'C14. l''admin, lui, la voit', v_vus = 1);

  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- D. LA COLONNE — s'attribuer la vidéo d'un autre SANS toucher au bucket
-- ════════════════════════════════════════════════════════════════════════════
-- La question est distincte de la section B : écrire `video_path` n'exige
-- aucun dépôt, donc la RLS du bucket n'est jamais consultée. Sans le
-- contrôle du trigger, l'élève A pointerait le fichier de B et le coach —
-- qui, lui, a le droit de lire les deux — le verrait sous le nom de A.
do $$
declare v_valeur text;
begin
  perform pg_temp.eleve_a();

  perform pg_temp.noter('D', 'D1. l''élève A rattache SA vidéo à SA ligne',
    not pg_temp.refuse($q$
      update public.exercise_feedback
         set video_path = '32000000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.mp4'
       where id = '3a000000-0000-4000-8000-0000000000a1'
    $q$));

  perform pg_temp.noter('D', 'D2. un chemin qui désigne un autre élève est REFUSÉ',
    pg_temp.refuse($q$
      update public.exercise_feedback
         set video_path = '32000000-0000-4000-8000-000000000003/77777777-7777-4777-8777-777777777777.mp4'
       where id = '3a000000-0000-4000-8000-0000000000a1'
    $q$));

  -- On mesure la VALEUR : un refus qui laisserait la colonne modifiée serait
  -- passé inaperçu si l'on ne regardait que l'erreur levée.
  select video_path into v_valeur from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';
  perform pg_temp.noter('D', 'D3. …et la colonne porte toujours SA vidéo, pas celle de B',
    v_valeur = '32000000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.mp4');

  perform pg_temp.noter('D', 'D4. un chemin difforme est refusé par la contrainte de forme',
    pg_temp.refuse($q$
      update public.exercise_feedback set video_path = 'pas/un/chemin.mp4'
       where id = '3a000000-0000-4000-8000-0000000000a1'
    $q$));

  perform pg_temp.noter('D', 'D5. une URL n''est pas un chemin',
    pg_temp.refuse($q$
      update public.exercise_feedback
         set video_path = 'https://exemple.test/vol.mp4'
       where id = '3a000000-0000-4000-8000-0000000000a1'
    $q$));

  -- Greffe : écrire sur la LIGNE d'un autre élève. La RLS de la table
  -- l'arrête avant même le trigger ; on le vérifie hors du rôle de A.
  update public.exercise_feedback
     set video_path = '32000000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.mp4'
   where id = '3a000000-0000-4000-8000-0000000000b1';

  reset role;
  select video_path into v_valeur from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000b1';
  perform pg_temp.noter('D', 'D6. A ne greffe aucune vidéo sur la ligne de B (vérifié hors de son rôle)',
    v_valeur is null);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- E. LA DATE DE DÉPÔT — dérivée, non falsifiable, honnête au retrait
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_date timestamptz; v_avant timestamptz; v_path text;
begin
  select video_uploaded_at into v_date from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';
  -- On compare à clock_timestamp() et non à now() : le gardien pose l'heure
  -- RÉELLE d'écriture, qui est postérieure au début de la transaction.
  perform pg_temp.noter('E', 'E1. video_uploaded_at est posé par la BASE dès qu''un chemin apparaît',
    v_date is not null and v_date <= clock_timestamp() and v_date >= now());

  v_avant := v_date;

  perform pg_temp.eleve_a();

  -- Falsification directe : la valeur envoyée doit être ignorée, pas reprise.
  update public.exercise_feedback
     set video_uploaded_at = now() + interval '400 days'
   where id = '3a000000-0000-4000-8000-0000000000a1';
  reset role;
  select video_uploaded_at into v_date from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';
  perform pg_temp.noter('E', 'E2. une date envoyée par l''élève est IGNORÉE (sinon : rétention infinie)',
    v_date = v_avant);

  -- Modifier une AUTRE colonne ne doit pas rajeunir la vidéo : sinon il
  -- suffirait d'éditer son commentaire tous les 29 jours.
  perform pg_temp.eleve_a();
  update public.exercise_feedback set comment = 'ça piquait'
   where id = '3a000000-0000-4000-8000-0000000000a1';
  reset role;
  select video_uploaded_at into v_date from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';
  -- Ce contrôle n'a de valeur QUE parce que le gardien utilise
  -- clock_timestamp() : avec now(), figé sur toute la transaction, il
  -- passerait même si la règle était fausse.
  perform pg_temp.noter('E', 'E3. éditer le commentaire ne repousse PAS la date de dépôt', v_date = v_avant);

  -- Remplacer la vidéo, en revanche, doit bien la repousser.
  perform pg_temp.eleve_a();
  insert into storage.objects (bucket_id, name) values ('feedback-videos',
    '32000000-0000-4000-8000-000000000002/99999999-9999-4999-8999-999999999999.webm');
  update public.exercise_feedback
     set video_path = '32000000-0000-4000-8000-000000000002/99999999-9999-4999-8999-999999999999.webm'
   where id = '3a000000-0000-4000-8000-0000000000a1';
  reset role;
  select video_uploaded_at, video_path into v_date, v_path from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';
  perform pg_temp.noter('E', 'E4. remplacer la vidéo repousse la date, et le chemin suit',
    v_date > v_avant and v_path like '%99999999%');

  -- Retrait : les deux colonnes tombent ensemble.
  perform pg_temp.eleve_a();
  update public.exercise_feedback set video_path = null
   where id = '3a000000-0000-4000-8000-0000000000a1';
  reset role;
  select video_uploaded_at, video_path into v_date, v_path from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';
  perform pg_temp.noter('E', 'E5. retirer la vidéo remet la date à NULL', v_path is null and v_date is null);

  -- L'état bâtard « une date sans vidéo » est impossible — mais pas de la
  -- façon qu'on attendrait : le gardien NEUTRALISE la valeur avant que la
  -- contrainte n'ait à parler, donc l'ordre passe sans erreur. C'est
  -- exactement le piège que la méthode de cette checklist annonce : on
  -- mesure la VALEUR, jamais le succès apparent de l'ordre. Un test écrit
  -- avec `refuse()` échouerait ici en croyant avoir trouvé une faille.
  update public.exercise_feedback set video_uploaded_at = now()
   where id = '3a000000-0000-4000-8000-0000000000b1';
  select video_uploaded_at into v_date from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000b1';
  perform pg_temp.noter('E', 'E6. une date sans vidéo est neutralisée, pas enregistrée', v_date is null);

  perform pg_temp.noter('E', 'E7. et la contrainte de cohérence existe, en dernier rempart',
    exists (select 1 from pg_constraint
             where conname = 'exercise_feedback_video_uploaded_at_coherent'));

  -- On repose une vidéo pour la section F.
  perform pg_temp.eleve_a();
  update public.exercise_feedback
     set video_path = '32000000-0000-4000-8000-000000000002/99999999-9999-4999-8999-999999999999.webm'
   where id = '3a000000-0000-4000-8000-0000000000a1';
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- F. LE STAFF — il retire, il ne pose pas
-- ════════════════════════════════════════════════════════════════════════════
-- Le gardien RESTAURE au lieu de refuser : l'UPDATE rapporte « 1 ligne »
-- sans avoir rien changé. On mesure donc la VALEUR, jamais le nombre de
-- lignes — c'est la leçon de la checklist F3, appliquée ici.
do $$
declare v_path text;
begin
  perform pg_temp.coach();
  update public.exercise_feedback
     set video_path = '32000000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.mp4'
   where id = '3a000000-0000-4000-8000-0000000000a1';
  reset role;
  select video_path into v_path from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';
  perform pg_temp.noter('F',
    'F1. le coach ne POSE aucune vidéo : la valeur est restaurée (on mesure la VALEUR)',
    v_path = '32000000-0000-4000-8000-000000000002/99999999-9999-4999-8999-999999999999.webm');

  -- Modération : retirer doit rester possible, sinon une vidéo déplacée
  -- resterait indéfiniment sous les yeux du coach.
  perform pg_temp.coach();
  update public.exercise_feedback set video_path = null
   where id = '3a000000-0000-4000-8000-0000000000a1';
  reset role;
  select video_path into v_path from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';
  perform pg_temp.noter('F', 'F2. le staff peut RETIRER la vidéo (modération)', v_path is null);

  -- L'admin non plus ne pose rien.
  perform pg_temp.eleve_a();
  update public.exercise_feedback
     set video_path = '32000000-0000-4000-8000-000000000002/99999999-9999-4999-8999-999999999999.webm'
   where id = '3a000000-0000-4000-8000-0000000000a1';
  reset role;

  perform pg_temp.admin();
  update public.exercise_feedback
     set video_path = '32000000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.mp4'
   where id = '3a000000-0000-4000-8000-0000000000a1';
  reset role;
  select video_path into v_path from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';
  perform pg_temp.noter('F', 'F3. l''admin non plus ne pose aucune vidéo au nom d''un élève',
    v_path = '32000000-0000-4000-8000-000000000002/99999999-9999-4999-8999-999999999999.webm');

  -- Le staff garde en revanche le droit de supprimer l'OBJET (modération).
  perform pg_temp.coach();
  delete from storage.objects
   where bucket_id = 'feedback-videos'
     and name = '32000000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.mp4';
  reset role;
  perform pg_temp.noter('F', 'F4. le staff peut supprimer l''objet lui-même',
    not exists (select 1 from storage.objects
                 where bucket_id = 'feedback-videos'
                   and name = '32000000-0000-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.mp4'));
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- I. LE CYCLE DE VIE — resoumission, retrait, et ce qui SURVIT au bucket
-- ════════════════════════════════════════════════════════════════════════════
-- `saveWorkoutFeedback` SUPPRIME puis RECRÉE les lignes d'exercice à chaque
-- envoi. On rejoue ici exactement cette séquence, pour prouver côté base ce
-- que la suite TypeScript prouve côté application.
do $$
declare
  v_id_avant uuid; v_id_apres uuid; v_path text; v_n int; v_date timestamptz;
begin
  perform pg_temp.eleve_a();

  -- Décor : une vidéo, rattachée à une ligne d'exercice.
  insert into storage.objects (bucket_id, name) values ('feedback-videos',
    '32000000-0000-4000-8000-000000000002/f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1.mp4');
  update public.exercise_feedback
     set video_path = '32000000-0000-4000-8000-000000000002/f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1.mp4'
   where id = '3a000000-0000-4000-8000-0000000000a1';
  select id, video_uploaded_at into v_id_avant, v_date from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a1';

  -- Nombre d'objets du dossier de A AVANT la resoumission : c'est lui qui
  -- doit être inchangé après. Un comptage absolu dépendrait des sections
  -- précédentes, et se casserait au premier contrôle ajouté plus haut.
  select count(*) into v_n from storage.objects
   where bucket_id = 'feedback-videos' and name like '32000000-0000-4000-8000-000000000002/%';
  perform set_config('f4.objets_avant', v_n::text, false);

  -- RESOUMISSION : la ligne est supprimée puis recréée, avec le MÊME chemin.
  delete from public.exercise_feedback where workout_feedback_id = '39000000-0000-4000-8000-0000000000a1';
  select count(*) into v_n from storage.objects
   where bucket_id = 'feedback-videos'
     and name = '32000000-0000-4000-8000-000000000002/f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1.mp4';
  perform pg_temp.noter('I', 'I1. supprimer la ligne d''exercice ne touche PAS l''objet Storage', v_n = 1);

  insert into public.exercise_feedback (id, workout_feedback_id, student_id, exercise_name, exercise_order, comment, video_path)
  values ('3a000000-0000-4000-8000-0000000000a2'::uuid, '39000000-0000-4000-8000-0000000000a1'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid, 'Développé couché', 0, 'commentaire modifié',
          '32000000-0000-4000-8000-000000000002/f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1.mp4');

  select id, video_path into v_id_apres, v_path from public.exercise_feedback
   where workout_feedback_id = '39000000-0000-4000-8000-0000000000a1';
  perform pg_temp.noter('I', 'I2. la NOUVELLE ligne porte le MÊME video_path',
    v_id_apres is distinct from v_id_avant
    and v_path = '32000000-0000-4000-8000-000000000002/f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1.mp4');

  select count(*) into v_n from storage.objects where bucket_id = 'feedback-videos'
   and name like '32000000-0000-4000-8000-000000000002/%';
  perform pg_temp.noter('I', 'I3. aucun SECOND fichier n''a été créé',
    v_n::text = current_setting('f4.objets_avant', true));

  -- La date de dépôt est reposée : c'est un INSERT. Assumé, documenté, et
  -- traité en F4.1 — la rétention devra s'appuyer sur storage.objects.created_at,
  -- qui, lui, ne se remet pas à zéro sur une simple resoumission.
  select video_uploaded_at into v_date from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a2';
  perform pg_temp.noter('I', 'I4. video_uploaded_at est REPOSÉ à la resoumission (traité en F4.1)',
    v_date is not null);

  -- RETRAIT PUIS ENVOI : la référence tombe, le fichier RESTE.
  perform pg_temp.eleve_a();
  update public.exercise_feedback set video_path = null
   where id = '3a000000-0000-4000-8000-0000000000a2';
  reset role;
  select video_path, video_uploaded_at into v_path, v_date from public.exercise_feedback
   where id = '3a000000-0000-4000-8000-0000000000a2';
  select count(*) into v_n from storage.objects where bucket_id = 'feedback-videos'
   and name = '32000000-0000-4000-8000-000000000002/f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1.mp4';
  perform pg_temp.noter('I',
    'I5. retirer la vidéo lève la référence mais LAISSE l''objet (purge F4.1)',
    v_path is null and v_date is null and v_n = 1);

  -- Ménage du décor de cette section.
  perform pg_temp.eleve_a();
  delete from storage.objects where bucket_id = 'feedback-videos'
    and name = '32000000-0000-4000-8000-000000000002/f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1.mp4';
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- G. ANON — rien, nulle part
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  select count(*) into v_n from storage.objects where bucket_id = 'feedback-videos';
  perform pg_temp.noter('G', 'G1. anon ne lit aucun objet du bucket', v_n = 0);

  select count(*) into v_n from public.exercise_feedback where video_path is not null;
  perform pg_temp.noter('G', 'G2. anon ne lit aucun chemin de vidéo', v_n = 0);

  perform pg_temp.noter('G', 'G3. anon n''écrit aucun objet',
    pg_temp.refuse($q$
      insert into storage.objects (bucket_id, name) values ('feedback-videos',
        '32000000-0000-4000-8000-000000000002/abababab-abab-4bab-8bab-abababababab.mp4')
    $q$));

  reset role;
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
-- H. RIEN NE SURVIT
-- ════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '--- Vidéo de technique : tout tient. ROLLBACK. ---'
rollback;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'feedback-videos') then
    raise warning 'ÉCHEC   — H1. des objets survivent au ROLLBACK';
  elsif exists (select 1 from public.exercise_feedback where video_path is not null) then
    raise warning 'ÉCHEC   — H2. des chemins survivent au ROLLBACK';
  elsif exists (select 1 from public.students where email like 'f4.%') then
    raise warning 'ÉCHEC   — H3. des élèves de test survivent au ROLLBACK';
  else
    raise notice 'OK      — H1/H2/H3. aucune donnée de test après le ROLLBACK';
  end if;
end $$;
