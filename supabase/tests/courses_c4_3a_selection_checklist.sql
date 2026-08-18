-- ============================================================================
-- Checklist PostgreSQL — COURSES C4.3a : L'ÉCRITURE DU MAGASIN CHOISI,
-- SOUS LES PRIVILÈGES RÉELS DE C4.2.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI CE FICHIER EXISTE
-- ────────────────────────────────────────────────────────────────────────────
-- Un harnais Node peut prouver qu'un module appelle `.update()` plutôt que
-- `.upsert()`. Il ne peut PAS dire si l'ordre qui en résulte sera accepté par
-- PostgreSQL. Or c'est exactement là qu'était le défaut : l'appel paraissait
-- correct, il était refusé par un privilège de colonne — et refusé DÈS LA
-- PREMIÈRE SÉLECTION, pas seulement au changement de magasin.
--
-- Ce fichier éprouve donc les FORMES SQL en jeu contre le vrai moteur, sous le
-- vrai rôle, avec la vraie RLS et le vrai trigger.
--
-- ⚠️ CE QU'IL NE PROUVE PAS. Il ne fait pas tourner PostgREST : le saut HTTP et
-- la sérialisation de `supabase-js` ne sont pas exercés ici. La forme SQL testée
-- en A est celle qu'engendre PostgREST, lue dans son code source
-- (`QueryBuilder.hs` : `"DO UPDATE SET " … cfName <> " = EXCLUDED." <> cfName`
-- pour CHAQUE colonne du corps), pas devinée.
--
-- CE QU'ELLE VÉRIFIE
--   A   la forme `upsert` de PostgREST est REFUSÉE (42501), dès le 1ᵉʳ insert
--   B   la forme du correctif — insert(student_id, store_id) — est acceptée
--   C   le changement A → B par update(store_id) seul est accepté
--   D   `updated_at` est renouvelée par le trigger, sans être nommée
--   E   une seule ligne subsiste, et elle porte le magasin B
--   F   les privilèges de C4.2 sont INCHANGÉS
--   Z   après le ROLLBACK, aucune donnée de test ne subsiste
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ============================================================================

\timing off
begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;
create temporary table _ctx (u uuid, s uuid, a uuid, b uuid, t timestamptz) on commit drop;

create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok then raise notice 'OK      — % · %', p_section, p_libelle;
  else raise warning 'ÉCHEC   — % · %', p_section, p_libelle; end if;
end $$;

do $$
declare u uuid := gen_random_uuid(); s uuid; a uuid; b uuid; sch text;
begin
  insert into auth.users (id, email) values (u, 'c43a-eleve@test.invalid');
  insert into public.profiles (user_id, role) values (u, 'student');
  insert into public.students (user_id, first_name, last_name, email, status)
    values (u, 'C43a', 'Eleve', 'c43a-eleve@test.invalid', 'active') returning id into s;

  -- Les deux magasins sont semés par le rôle SERVEUR : c'est le chemin réel,
  -- `stores` n'accordant que `select` à `authenticated`.
  insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
    values (910001, 'WAY', 9100001, 'Magasin A', 45.1, 5.7) returning id into a;
  insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
    values (910002, 'NODE', 9100002, 'Magasin B', 45.2, 5.8) returning id into b;

  insert into _ctx values (u, s, a, b, null);

  sch := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated', sch);
  execute format('grant select, update on %I._ctx to authenticated', sch);
  execute format('grant insert, select on %I._faits to authenticated', sch);
  execute format('grant execute on all functions in schema %I to authenticated', sch);
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', (select u from _ctx), 'role', 'authenticated')::text, false);
set local role authenticated;


-- =====================================================================
-- A — LA FORME `upsert` DE POSTGREST EST REFUSÉE, DÈS LE PREMIER INSERT
-- =====================================================================
do $$
declare s uuid; a uuid; v_etat text;
begin
  select _ctx.s, _ctx.a into s, a from _ctx;
  begin
    -- ⚠️ CECI EST LE SQL QUE POSTGREST ENGENDRE pour
    -- `.upsert({ student_id, store_id }, { onConflict: "student_id" })`.
    execute format($q$
      insert into public.student_selected_store (student_id, store_id) values (%L, %L)
      on conflict (student_id) do update
        set student_id = excluded.student_id, store_id = excluded.store_id$q$, s, a);
    v_etat := 'ACCEPTE';
  exception when others then
    v_etat := sqlstate;
  end;

  -- ⚠️ 42501 = privilège insuffisant. PostgreSQL vérifie les colonnes nommées
  -- dans le DO UPDATE À LA PLANIFICATION : le refus tombe même sans conflit.
  perform pg_temp.noter('A-01',
    'la forme upsert de PostgREST est REFUSÉE pour privilège (42501)', v_etat = '42501');

  -- Le témoin : la MÊME requête sans `student_id` dans le SET passe. C'est bien
  -- la colonne nommée qui bloque, pas l'ordre `on conflict` en lui-même.
  begin
    execute format($q$
      insert into public.student_selected_store (student_id, store_id) values (%L, %L)
      on conflict (student_id) do update set store_id = excluded.store_id$q$, s, a);
    v_etat := 'ACCEPTE';
  exception when others then
    v_etat := sqlstate;
  end;
  perform pg_temp.noter('A-02',
    'témoin : la même requête SANS student_id dans le SET est acceptée', v_etat = 'ACCEPTE');

  -- On repart d'une ardoise vierge pour la suite.
  execute format('delete from public.student_selected_store where student_id = %L', s);
  perform pg_temp.noter('A-03', 'aucune sélection ne subsiste avant le scénario réel', (
    select count(*) = 0 from public.student_selected_store));
end $$;


-- =====================================================================
-- B, C, D, E — LE SCÉNARIO RÉEL DU CORRECTIF
-- =====================================================================
do $$
declare s uuid; a uuid; b uuid; n int; t_apres_a timestamptz;
begin
  select _ctx.s, _ctx.a, _ctx.b into s, a, b from _ctx;

  -- ── ÉTAPE 1 : aucune sélection → l'update ne touche rien, l'insert crée ──
  execute format('update public.student_selected_store set store_id = %L where student_id = %L', a, s);
  get diagnostics n = row_count;
  perform pg_temp.noter('B-01', 'sans ligne existante, l''update ne touche rien', n = 0);

  execute format(
    'insert into public.student_selected_store (student_id, store_id) values (%L, %L)', s, a);
  perform pg_temp.noter('B-02',
    'ÉTAPE 1 — insert(student_id, store_id) : le magasin A est choisi', (
    select count(*) = 1 from public.student_selected_store where store_id = a));

  select updated_at into t_apres_a from public.student_selected_store where student_id = s;
  update _ctx set t = t_apres_a;

  -- ⚠️ On antidate avec le rôle SERVEUR pour rendre l'écart mesurable : `now()`
  -- est figé dans une transaction. C'est un montage de test, pas une propriété.
  reset role;
  execute format($q$update public.student_selected_store
                    set updated_at = timestamptz '2020-01-01 00:00:00+00'
                    where student_id = %L$q$, s);
  -- Le trigger vient de réécrire la date ; on la repose donc sans passer par
  -- lui, en supprimant puis réinsérant.
  execute format('delete from public.student_selected_store where student_id = %L', s);
  execute format($q$insert into public.student_selected_store (student_id, store_id, updated_at)
                    values (%L, %L, timestamptz '2020-01-01 00:00:00+00')$q$, s, a);
  select updated_at into t_apres_a from public.student_selected_store where student_id = s;
  update _ctx set t = t_apres_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select u from _ctx), 'role', 'authenticated')::text, false);
  set local role authenticated;

  -- ── ÉTAPE 2 : la ligne existe → update(store_id) SEUL ────────────────
  execute format('update public.student_selected_store set store_id = %L where student_id = %L', b, s);
  get diagnostics n = row_count;
  perform pg_temp.noter('C-01',
    'ÉTAPE 2 — changement A → B par update(store_id) seul : accepté', n = 1);

  perform pg_temp.noter('E-01', 'une seule ligne subsiste pour cet élève', (
    select count(*) = 1 from public.student_selected_store where student_id = s));
  perform pg_temp.noter('E-02', 'et elle porte le magasin B', (
    select store_id = b from public.student_selected_store where student_id = s));

  -- ── D : la date a été renouvelée SANS avoir été nommée ───────────────
  perform pg_temp.noter('D-01',
    'updated_at renouvelée par le TRIGGER, sans que l''appelant la nomme', (
    select updated_at > (select t from _ctx) from public.student_selected_store where student_id = s));

  -- Et l'élève ne peut toujours pas l'écrire lui-même.
  begin
    execute format($q$update public.student_selected_store
                      set updated_at = timestamptz '2000-01-01 00:00:00+00'
                      where student_id = %L$q$, s);
    n := 0;
  exception when insufficient_privilege then n := 1;
  end;
  perform pg_temp.noter('D-02', 'l''élève ne peut PAS écrire updated_at lui-même', n = 1);

  -- Ni déplacer sa sélection vers un autre élève.
  begin
    execute format('update public.student_selected_store set student_id = %L where student_id = %L',
                   gen_random_uuid(), s);
    n := 0;
  exception when insufficient_privilege then n := 1;
  end;
  perform pg_temp.noter('D-03', 'l''élève ne peut PAS réaffecter student_id', n = 1);
end $$;

reset role;


-- =====================================================================
-- F — LES PRIVILÈGES DE C4.2 SONT INCHANGÉS
-- =====================================================================
do $$
begin
  perform pg_temp.noter('F-01', 'UPDATE de authenticated = {store_id}, et rien d''autre', (
    select array_agg(column_name::text order by column_name::text) = array['store_id']
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'student_selected_store'
       and privilege_type = 'UPDATE' and grantee = 'authenticated'));

  perform pg_temp.noter('F-02', 'INSERT de authenticated = {student_id, store_id}', (
    select array_agg(column_name::text order by column_name::text)
           = array['store_id', 'student_id']
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'student_selected_store'
       and privilege_type = 'INSERT' and grantee = 'authenticated'));

  perform pg_temp.noter('F-03', 'aucun privilège d''écriture au niveau de la TABLE', (
    select coalesce(array_agg(distinct privilege_type::text
                              order by privilege_type::text), array[]::text[])
           = array['DELETE', 'SELECT']
      from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'student_selected_store'
       and grantee = 'authenticated'));
end $$;


-- =====================================================================
-- SYNTHÈSE
-- =====================================================================
do $$
declare v_total int; v_ko int;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_ko from _faits;
  raise notice '────────────────────────────────────────────────────────';
  raise notice 'C4.3a — SÉLECTION : % contrôles, % en échec', v_total, v_ko;
  raise notice '────────────────────────────────────────────────────────';
  if v_ko > 0 then
    raise warning 'ÉCHECS : %', (select string_agg(section || ' ' || libelle, ' | ')
                                   from _faits where not ok);
  end if;
end $$;

select section, libelle, ok from _faits where not ok order by section;

rollback;

do $$
begin
  if exists (select 1 from public.stores where op_location_id between 910001 and 910999) then
    raise warning 'ÉCHEC   — Z-01 · des magasins de test ont survécu au ROLLBACK';
  else
    raise notice 'OK      — Z-01 · aucun magasin de test ne subsiste';
  end if;
end $$;
