-- ============================================================================
-- STABILISATION B1 / B2 — CHECKLIST SQL
--
-- À exécuter sur une base de TEST ou sur la base jetable du banc
-- `scripts/tests/sql/b1b2-base-jetable.sh`, JAMAIS sur la production. Le
-- fichier s'exécute dans UNE transaction qui finit par ROLLBACK : il ne laisse
-- rien derrière lui, même en cas de succès.
--
-- À exécuter APRÈS les deux migrations 20261119090000 et 20261119091000.
--
-- ----------------------------------------------------------------------------
-- CE QUE CETTE CHECKLIST PROUVE — ET C'EST LA SEULE QUI LE PROUVE
-- ----------------------------------------------------------------------------
--   • B2 — elle lit l'ACL RÉELLE des fonctions installées
--     (`has_function_privilege`), pas le texte des migrations. C'est la seule
--     vérification qui distingue « la ligne est écrite » de « le privilège est
--     retiré ». `scripts/tests/stabilisation-b1-b2.mts` ne peut pas le faire :
--     il n'a aucune base.
--   • B1 — elle APPELLE la RPC, en endossant une session d'élève, sur des
--     coachs créés pour l'occasion. Elle ne lit aucune donnée existante et ne
--     modifie aucune ligne de production : tout disparaît au `rollback`.
--
-- ⚠️ CE QU'ELLE NE PROUVE PAS. Elle s'exécute avec le rôle propriétaire, qui
-- contourne la RLS. Le cloisonnement par policy se vérifie ailleurs
-- (supabase/tests/p13b_roles_collaborateurs_checklist.sql).
--
-- ----------------------------------------------------------------------------
-- AUCUNE DONNÉE PERSONNELLE — contrainte, pas style
-- ----------------------------------------------------------------------------
-- Tous les noms employés sont synthétiques : « Alpha Beta » (composé),
-- « Alpha-Beta Gamma Delta » (patronyme en plusieurs mots), « Monomot » (un
-- seul mot), « Doublon Doublon » (homonymie), « identifiant.sans.espace »
-- (forme réellement rencontrée : une adresse technique sans espace). La valeur
-- réelle du coach titulaire n'apparaît nulle part : c'est la CLASSE de problème
-- qui est reproduite, pas l'identité.
-- ============================================================================
begin;

create or replace function b1b2_echec(p_cas text, p_detail text) returns void language plpgsql as $$
begin
  raise exception 'B1/B2 — % : %', p_cas, p_detail;
end $$;

-- ============================================================================
-- PARTIE B2 — LES PRIVILÈGES RÉELLEMENT OBTENUS
-- ============================================================================

do $$
declare
  v_conflit constant text := 'public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid)';
  v_eleve   constant text := 'public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text)';
  v_staff   constant text := 'public.creer_rendez_vous_staff(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text)';
begin
  -- B2-01 — `anon` n'exécute AUCUNE des trois fonctions de M1.
  if has_function_privilege('anon', v_conflit, 'EXECUTE') then
    perform b1b2_echec('B2-01', 'anon execute encore calendar_has_conflict_pour_coach');
  end if;
  if has_function_privilege('anon', v_eleve, 'EXECUTE') then
    perform b1b2_echec('B2-01', 'anon execute encore reserver_creneau_eleve');
  end if;
  if has_function_privilege('anon', v_staff, 'EXECUTE') then
    perform b1b2_echec('B2-01', 'anon execute encore creer_rendez_vous_staff');
  end if;

  -- B2-02 — `authenticated` n'exécute plus la fonction de conflit.
  if has_function_privilege('authenticated', v_conflit, 'EXECUTE') then
    perform b1b2_echec('B2-02', 'authenticated execute encore calendar_has_conflict_pour_coach');
  end if;

  -- B2-03 — `authenticated` GARDE les deux parcours appelés depuis le navigateur.
  if not has_function_privilege('authenticated', v_eleve, 'EXECUTE') then
    perform b1b2_echec('B2-03', 'authenticated a perdu reserver_creneau_eleve : reservation eleve cassee');
  end if;
  if not has_function_privilege('authenticated', v_staff, 'EXECUTE') then
    perform b1b2_echec('B2-03', 'authenticated a perdu creer_rendez_vous_staff : creation staff cassee');
  end if;

  -- B2-04 — `service_role` garde les trois : rien ne lui a été retiré.
  if not has_function_privilege('service_role', v_conflit, 'EXECUTE') then
    perform b1b2_echec('B2-04', 'service_role a perdu calendar_has_conflict_pour_coach');
  end if;
  if not has_function_privilege('service_role', v_eleve, 'EXECUTE') then
    perform b1b2_echec('B2-04', 'service_role a perdu reserver_creneau_eleve');
  end if;
  if not has_function_privilege('service_role', v_staff, 'EXECUTE') then
    perform b1b2_echec('B2-04', 'service_role a perdu creer_rendez_vous_staff');
  end if;

  -- B2-05 — ALIGNEMENT SUR LE PRÉCÉDENT. `calendar_has_conflict`, fermée par
  -- 20260726121000, est la référence : la nouvelle fonction de conflit doit
  -- avoir EXACTEMENT la même ouverture.
  if has_function_privilege('anon', 'public.calendar_has_conflict(timestamptz, timestamptz, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.calendar_has_conflict(timestamptz, timestamptz, uuid, uuid)', 'EXECUTE') then
    perform b1b2_echec('B2-05', 'le precedent de reference a change : revoir la convention');
  end if;

  -- B2-06 — les corps n'ont pas bougé : les trois fonctions sont toujours
  -- `SECURITY DEFINER` avec un `search_path` posé.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('calendar_has_conflict_pour_coach', 'reserver_creneau_eleve', 'creer_rendez_vous_staff')
       and (not p.prosecdef or p.proconfig is null)
  ) then
    perform b1b2_echec('B2-06', 'une des trois fonctions a perdu security definer ou son search_path');
  end if;

  -- B2-07 — une seule signature par nom : aucune surcharge introduite.
  if exists (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('calendar_has_conflict_pour_coach', 'reserver_creneau_eleve', 'creer_rendez_vous_staff')
     group by p.proname having count(*) <> 1
  ) then
    perform b1b2_echec('B2-07', 'surcharge de signature detectee');
  end if;

  /*
   * B2-08 — AUCUN PRIVILÈGE INTERDIT NE SUBSISTE, `PUBLIC` COMPRIS.
   *
   * ⚠️ `PUBLIC` EST LE TROU QUE LES CONTRÔLES PAR RÔLE NE VOIENT PAS. Un
   * EXECUTE accordé à `PUBLIC` rend `has_function_privilege('anon', …)` vrai
   * sans qu'aucune entrée `anon` figure dans l'ACL. On interroge donc l'ACL
   * elle-même : une entrée de grantee VIDE est l'entrée `PUBLIC`.
   */
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(p.proacl) a
     where n.nspname = 'public'
       and p.proname in ('calendar_has_conflict_pour_coach', 'reserver_creneau_eleve', 'creer_rendez_vous_staff')
       and a.grantee = 0                     -- 0 = PUBLIC
       and a.privilege_type = 'EXECUTE'
  ) then
    perform b1b2_echec('B2-08', 'PUBLIC detient encore EXECUTE sur une des trois fonctions');
  end if;

  raise notice 'B2 : 8 controles OK';
end $$;

-- ============================================================================
-- PARTIE B1 — LE DÉCOUPAGE RENDU PAR LA FONCTION INSTALLÉE
--
-- ⚠️ LA RPC EST APPELÉE, PAS RELUE. Elle lit `auth.uid()` : on endosse donc une
-- session d'élève, exactement comme le navigateur.
-- ============================================================================

/*
 * Endosse une session d'élève, ou l'efface.
 *
 * ⚠️ UNE SESSION VIDE S'EFFACE, ELLE NE SE FABRIQUE PAS AVEC UN `sub` VIDE.
 * Première rédaction : `json_build_object('sub', coalesce(p_user::text, ''))`,
 * donc `{"sub": ""}` quand aucun élève n'est endossé. Mesuré le 19/11/2026 sur
 * le banc jetable, avec la définition Supabase d'`auth.uid()` :
 *
 *   ERROR:  invalid input syntax for type uuid: ""
 *   CONTEXT: SQL function "get_my_coach_public_profile" during startup
 *
 * `auth.uid()` fait `coalesce(claim.sub, claims->>'sub')::uuid` : une chaîne
 * vide n'est pas NULL, elle part au cast et le casse. « Pas de session » et
 * « session malformée » sont deux choses, et c'est la première qu'on veut.
 */
create or replace function b1b2_endosser(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  end if;
end $$;

/*
 * Crée un coach portant `p_nom`, un élève rattaché à lui, endosse cet élève,
 * appelle la RPC et rend « <first_name>|<last_name> » — « <NULL> » pour un
 * champ nul, afin de distinguer NULL de la chaîne vide.
 *
 * ⚠️ TOUTES LES COLONNES OBLIGATOIRES SONT RENSEIGNÉES, ET LA LISTE A ÉTÉ
 * RELEVÉE SUR LE BASELINE, pas devinée. `public.students` impose `first_name`
 * et `last_name` en `not null` SANS défaut : une première version de ce fichier
 * les omettait et échouait sur
 *   « null value in column "first_name" of relation "students" ».
 *
 * ⚠️ `status` EST FOURNI EXPLICITEMENT, et ce n'est pas une précaution : le
 * baseline déclare `status text default 'actif' not null` AVEC
 * `students_status_check check (status in ('active','paused','completed'))`.
 * Le défaut VIOLE donc sa propre contrainte, et tout insert qui l'omet échoue.
 * Anomalie du schéma antérieure à ce chantier, signalée et non corrigée ici.
 *
 * `b1b2_sonde_contraintes` ci-dessous refuse de laisser cette liste dériver.
 */
create or replace function b1b2_decoupage(p_nom text) returns text language plpgsql as $$
declare
  v_coach uuid;
  v_eleve uuid;
  v_uid uuid := gen_random_uuid();
  v_first text;
  v_last text;
begin
  insert into public.coaches (name, user_id, status)
  values (p_nom, gen_random_uuid(), 'actif')
  returning id into v_coach;

  insert into public.students (user_id, coach_id, first_name, last_name, status)
  values (v_uid, v_coach, 'Eleve', 'Essai', 'active')
  returning id into v_eleve;

  perform b1b2_endosser(v_uid);
  select r.first_name, r.last_name into v_first, v_last
    from public.get_my_coach_public_profile() r;

  /*
   * A7 — UNE RPC SANS RÉSULTAT N'EST PAS UN NOM VIDE.
   *
   * ⚠️ SANS CE CONTRÔLE, DEUX CAUSES DONNENT LE MÊME SYMPTÔME. `select … into`
   * laisse les deux variables à NULL quand la requête ne rend AUCUNE ligne :
   * « coach dont le nom est vide » et « session absente, jointure cassée ou
   * `auth.uid()` non câblée » produisaient tous deux « <NULL>|<NULL> », et les
   * contrôles du nom vide pouvaient passer pour la mauvaise raison. Observé
   * pendant la revue du 19/11/2026 sur un décor où `auth.uid()` ne lisait pas
   * `request.jwt.claims`.
   */
  if not found then
    perform b1b2_echec('B1-00',
      format('la RPC n''a rendu AUCUNE ligne pour le nom %L : session, jointure students/coaches ou auth.uid() en cause — PAS le decoupage', p_nom));
  end if;

  -- Chaque cas repart du même état.
  delete from public.students where id = v_eleve;
  delete from public.coaches where id = v_coach;
  perform b1b2_endosser(null);

  return coalesce(quote_literal(v_first), '<NULL>') || '|' || coalesce(quote_literal(v_last), '<NULL>');
end $$;

/*
 * ⚠️ LA LISTE DES COLONNES OBLIGATOIRES NE DOIT PAS DÉRIVER. Si une colonne
 * `not null` sans défaut apparaît sur `students` ou `coaches`, l'insert
 * ci-dessus cassera — et le message serait un échec de contrainte, pas un
 * diagnostic. Ce contrôle nomme la colonne manquante AVANT.
 */
create or replace function b1b2_sonde_contraintes() returns void language plpgsql as $$
declare
  v_manquantes text;
begin
  select string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name)
    into v_manquantes
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('students', 'coaches')
     and is_nullable = 'NO'
     and column_default is null
     and column_name not in ('first_name', 'last_name', 'name', 'id');
  if v_manquantes is not null then
    perform b1b2_echec('B1-0C',
      'colonne(s) obligatoire(s) non prevue(s) par l''insert de la checklist : ' || v_manquantes);
  end if;
end $$;

do $$
declare
  v text;
begin
  -- B1-0C — le décor de l'insert est toujours complet.
  perform b1b2_sonde_contraintes();

  -- B1-01 — NOM COMPOSÉ : prénom et patronyme, découpés au PREMIER espace.
  v := b1b2_decoupage('Alpha Beta');
  if v <> '''Alpha''|''Beta''' then
    perform b1b2_echec('B1-01', 'Alpha Beta a rendu ' || v);
  end if;

  -- B1-02 — PATRONYME EN PLUSIEURS MOTS : tout le reste part dans le patronyme.
  v := b1b2_decoupage('Alpha-Beta Gamma Delta');
  if v <> '''Alpha-Beta''|''Gamma Delta''' then
    perform b1b2_echec('B1-02', 'Alpha-Beta Gamma Delta a rendu ' || v);
  end if;

  -- B1-03 — UN SEUL MOT : un champ renseigné, l'autre NULL. C'EST LE DÉFAUT B1.
  -- L'ancienne expression rendait ici « 'Monomot'|'Monomot' ».
  v := b1b2_decoupage('Monomot');
  if v <> '''Monomot''|<NULL>' then
    perform b1b2_echec('B1-03', 'Monomot a rendu ' || v || ' (attendu ''Monomot''|<NULL>)');
  end if;

  -- B1-04 — LA FORME OBSERVÉE SUR APPLE CALENDRIER : une adresse technique est
  -- un nom d'un seul mot comme un autre. Elle ne doit plus sortir deux fois.
  v := b1b2_decoupage('identifiant.sans.espace');
  if v <> '''identifiant.sans.espace''|<NULL>' then
    perform b1b2_echec('B1-04', 'identifiant.sans.espace a rendu ' || v);
  end if;

  -- B1-05 — HOMONYMIE PRÉSERVÉE. Deux mots identiques gardent leurs deux
  -- champs : c'est précisément ce qu'une règle « first_name = last_name »
  -- aurait détruit, et la raison pour laquelle elle a été écartée.
  v := b1b2_decoupage('Doublon Doublon');
  if v <> '''Doublon''|''Doublon''' then
    perform b1b2_echec('B1-05', 'Doublon Doublon a rendu ' || v || ' : homonymie ecrasee');
  end if;

  -- B1-06 — NOM VIDE : les deux champs nuls. Côté application,
  -- `filter(Boolean)` écarte '' comme null, donc le repli `DEFAULT_COACH_INFO`
  -- s'applique à l'identique de l'avant-correction.
  v := b1b2_decoupage('');
  if v <> '<NULL>|<NULL>' then
    perform b1b2_echec('B1-06', 'un nom vide a rendu ' || v);
  end if;

  -- B1-07 — ESPACES DE BORD : ils ne fabriquent plus un prénom vide.
  -- L'ancienne expression rendait ici « ''|'Alpha Beta' ».
  v := b1b2_decoupage('  Alpha Beta  ');
  if v <> '''Alpha''|''Beta''' then
    perform b1b2_echec('B1-07', 'un nom a espaces de bord a rendu ' || v);
  end if;

  -- B1-08 — ESPACES MULTIPLES À L'INTÉRIEUR : le patronyme est débarrassé de
  -- son espace de tête par le `trim` du corps.
  v := b1b2_decoupage('Alpha   Beta');
  if v <> '''Alpha''|''Beta''' then
    perform b1b2_echec('B1-08', 'un nom a espaces multiples a rendu ' || v);
  end if;

  raise notice 'B1 : 8 controles de decoupage OK';
end $$;

-- ============================================================================
-- B1-09 — LE CAS « NOM NUL » N'EXISTE PAS EN BASE, ET C'EST LA CONTRAINTE QUI
-- LE GARANTIT.
--
-- ⚠️ CE CONTRÔLE A REMPLACÉ UN TEST IMPOSSIBLE. La version précédente appelait
-- `b1b2_decoupage(null)`, donc tentait d'insérer `coaches.name = null` : la
-- colonne est `not null`, et l'insert échouait sur
-- « null value in column "name" of relation "coaches" ». Tester l'interdit ne
-- prouve rien ; on vérifie donc la contrainte elle-même, et ce contrôle
-- rougira si elle disparaît — c'est alors que le cas NULL devrait être couvert.
--
-- Le `coalesce(c.name, '')` du corps de la RPC reste en place comme défense en
-- profondeur : il ne coûte rien et couvre le jour où la contrainte tomberait.
-- ============================================================================
do $$
declare
  v_nullable text;
begin
  select is_nullable into v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'coaches' and column_name = 'name';

  if v_nullable is null then
    perform b1b2_echec('B1-09', 'la colonne coaches.name est introuvable');
  end if;
  if v_nullable <> 'NO' then
    perform b1b2_echec('B1-09',
      'coaches.name est devenue nullable : le cas NULL doit desormais etre couvert par un controle de decoupage');
  end if;

  -- Et la défense en profondeur est toujours écrite dans le corps.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_my_coach_public_profile'
       and pg_get_functiondef(p.oid) like '%coalesce(c.name%'
  ) then
    perform b1b2_echec('B1-09', 'le coalesce(c.name, …) a disparu du corps de la RPC');
  end if;

  raise notice 'B1-09 : contrainte coaches.name NOT NULL + coalesce en place OK';
end $$;

-- ============================================================================
-- B1-10 — ERREUR DE SESSION : une RPC sans résultat est signalée COMME TELLE.
--
-- ⚠️ C'EST LA CONTRE-ÉPREUVE DE A7, ET ELLE TOURNE À CHAQUE EXÉCUTION. On crée
-- un coach et un élève, puis on appelle la RPC SANS endosser l'élève. Zéro
-- ligne doit remonter, et le diagnostic doit nommer la session — pas rendre un
-- couple de NULL qu'on prendrait pour un nom vide.
-- ============================================================================
do $$
declare
  v_coach uuid;
  v_eleve uuid;
  v_first text;
  v_last text;
  v_lignes int;
begin
  insert into public.coaches (name, user_id, status)
  values ('Alpha Beta', gen_random_uuid(), 'actif') returning id into v_coach;
  insert into public.students (user_id, coach_id, first_name, last_name, status)
  values (gen_random_uuid(), v_coach, 'Eleve', 'Essai', 'active') returning id into v_eleve;

  -- AUCUN endossement : la session est vide. `b1b2_endosser(null)` EFFACE le
  -- réglage ; appeler la RPC doit alors rendre zéro ligne, SANS erreur de cast.
  perform b1b2_endosser(null);

  select count(*) into v_lignes from public.get_my_coach_public_profile();
  if v_lignes <> 0 then
    perform b1b2_echec('B1-10',
      'sans session, la RPC a rendu ' || v_lignes || ' ligne(s) : la garde auth.uid() ne protege plus rien');
  end if;

  select r.first_name, r.last_name into v_first, v_last from public.get_my_coach_public_profile() r;
  if found then
    perform b1b2_echec('B1-10', 'FOUND est vrai alors que la RPC n''a rien rendu');
  end if;
  if v_first is not null or v_last is not null then
    perform b1b2_echec('B1-10', 'des valeurs sont remontees sans session');
  end if;

  delete from public.students where id = v_eleve;
  delete from public.coaches where id = v_coach;

  raise notice 'B1-10 : absence de session distinguee d''un nom vide OK';
end $$;

-- ============================================================================
-- B1-11 — PÉRIMÈTRE INCHANGÉ. La RPC rend toujours les quatre mêmes colonnes,
-- dans le même ordre, et `anon` ne l'exécute toujours pas.
-- ============================================================================
do $$
declare
  v_resultat text;
begin
  select pg_get_function_result(p.oid) into v_resultat
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_my_coach_public_profile';

  if v_resultat is distinct from 'TABLE(coach_id uuid, first_name text, last_name text, specialty text)' then
    perform b1b2_echec('B1-11', 'le type de retour a change : ' || coalesce(v_resultat, '<absent>'));
  end if;

  if has_function_privilege('anon', 'public.get_my_coach_public_profile()', 'EXECUTE') then
    perform b1b2_echec('B1-11', 'anon execute get_my_coach_public_profile');
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_coach_public_profile()', 'EXECUTE') then
    perform b1b2_echec('B1-11', 'authenticated a perdu get_my_coach_public_profile');
  end if;

  raise notice 'B1-11 : perimetre et privileges de la RPC inchanges OK';
end $$;

-- ============================================================================
-- CONTRÔLE DE NON-RÉSIDU — avant même le `rollback`, on vérifie que les cas
-- ont nettoyé derrière eux. Un `delete` oublié dans une fonction d'essai se
-- verrait ici, alors que le `rollback` le masquerait.
-- ============================================================================
do $$
declare
  v_coachs int;
  v_eleves int;
begin
  select count(*) into v_coachs from public.coaches
   where name in ('Alpha Beta', 'Alpha-Beta Gamma Delta', 'Monomot', 'Doublon Doublon', 'identifiant.sans.espace', '', '  Alpha Beta  ', 'Alpha   Beta');
  select count(*) into v_eleves from public.students where first_name = 'Eleve' and last_name = 'Essai';
  if v_coachs <> 0 or v_eleves <> 0 then
    perform b1b2_echec('RESIDU',
      v_coachs || ' coach(s) et ' || v_eleves || ' eleve(s) de test subsistent avant le rollback');
  end if;
  raise notice 'RESIDU : aucune ligne de test subsistante avant rollback OK';
end $$;

-- ============================================================================
-- RIEN N'EST LAISSÉ DERRIÈRE : ni les fonctions d'essai, ni les lignes créées.
-- Le DDL est transactionnel sous PostgreSQL, donc `b1b2_echec`,
-- `b1b2_endosser`, `b1b2_decoupage` et `b1b2_sonde_contraintes` disparaissent
-- avec la transaction.
-- ============================================================================
rollback;
