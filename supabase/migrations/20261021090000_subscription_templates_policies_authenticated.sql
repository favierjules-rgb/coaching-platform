-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ CATALOGUE D'OFFRES — LES TROIS POLICIES D'ÉCRITURE AU RÔLE AUTHENTIFIÉ   ║
-- ║ Migration ADDITIVE et MINIMALE. 20261020090000 est enregistrée comme     ║
-- ║ appliquée : elle n'est pas modifiée. Ce fichier ne touche QUE les rôles  ║
-- ║ de trois policies — aucune condition, aucune table, aucun privilège.     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QU'IL RESTAIT, ET CE QUE ÇA FAISAIT
-- ════════════════════════════════════════════════════════════════════════════
-- 20261020090000 a borné au rôle `authenticated` les policies internes de
-- `programs` et les DEUX policies de LECTURE de `subscription_templates`.
-- Trois policies d'ÉCRITURE du catalogue d'offres portaient encore `{public}` :
--
--     subscription_templates_manage_staff_insert    {public}   is_admin()
--     subscription_templates_manage_staff_update    {public}   is_admin()
--     subscription_templates_manage_staff_delete    {public}   is_admin()
--
-- ⚠️ ET `anon` DÉTIENT LES PRIVILÈGES DE TABLE CORRESPONDANTS. Relevé en
-- local : `anon` a INSERT, UPDATE et DELETE sur `public.subscription_templates`
-- (les GRANT par défaut de Supabase). Ces trois policies étaient donc
-- RÉELLEMENT évaluées pour un visiteur, et chacune appelle `is_admin()`, dont
-- P13-B a retiré l'EXECUTE à `anon`. Mesuré, pour les trois commandes :
--
--     42501  permission denied for function is_admin
--
-- ⚠️ CE N'EST PAS UNE ÉLÉVATION DE PRIVILÈGE, ET IL FAUT LE DIRE : le visiteur
-- était refusé, et il reste refusé. Ce qui change est la NATURE du refus. Un
-- « permission denied for function is_admin » apprend à qui le provoque qu'une
-- fonction de ce nom existe et gouverne la décision, et il place le refus dans
-- la plomberie des privilèges plutôt que dans la règle d'accès. Après ce
-- correctif, l'écriture anonyme est refusée parce qu'AUCUNE POLICY NE
-- S'APPLIQUE — ce qui est la vraie raison.
--
-- ⚠️ ET SURTOUT : UNE POLICY QUI LÈVE AU LIEU DE REFUSER EST UN PIÈGE QUI A
-- DÉJÀ COÛTÉ CHER ICI. C'est exactement ce mécanisme — une policy permissive
-- évaluée pour `anon` et qui lève sur une fonction interdite — qui rendait la
-- vitrine publique illisible AVANT 20261020090000, en faisant échouer toute la
-- requête. Ces trois policies-ci ne portent que des commandes d'écriture,
-- qu'aucune page publique n'émet, donc rien n'est cassé aujourd'hui ; les
-- laisser en `{public}` serait garder la dernière amorce du même piège.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA CORRECTION
-- ════════════════════════════════════════════════════════════════════════════
-- `alter policy … to authenticated`, et rien d'autre. Cette forme NE TOUCHE
-- NI `using` NI `with check` : les trois conditions `is_admin()` sont
-- conservées à l'identique, sans être réécrites — donc sans risque de les
-- recopier de travers.
--
-- ⚠️ `to authenticated` RESTREINT une policy permissive. Aucun rôle n'y gagne
-- quoi que ce soit :
--   · l'administrateur    → `authenticated` + `is_admin()` vrai : inchangé ;
--   · le coach autonome   → `authenticated` + `is_admin()` faux : refusé, comme
--                           avant (mesuré : 42501 RLS à l'INSERT, 0 ligne en
--                           UPDATE et DELETE) ;
--   · le collaborateur    → identique au coach, et P13-B n'entre pas en jeu
--                           ici : aucune catégorie n'ouvre le catalogue ;
--   · le visiteur anonyme → plus aucune policy d'écriture applicable, donc
--                           refus net ;
--   · `service_role`      → porte `bypassrls`, aucune policy ne le concerne :
--                           webhook Stripe et routes serveur inchangés.
--
-- Les trois policies de LECTURE ne sont pas touchées :
-- `subscription_templates_select_vitrine_publique` reste à `{anon}` — c'est
-- elle qui porte la vitrine — et les deux autres restent à `{authenticated}`.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ CETTE MIGRATION NE CHANGE PAS LE RÔLE ACTIF DE LA SESSION, ET C'EST
--    DÉLIBÉRÉ
-- ════════════════════════════════════════════════════════════════════════════
-- Une première version de ce fichier tentait l'écriture anonyme À L'INTÉRIEUR
-- de la migration : elle basculait le rôle actif de la session le temps d'un
-- INSERT, puis revenait en arrière. C'est retiré.
--
-- Raison : la CLI Supabase applique le fichier PUIS enregistre son passage
-- dans `supabase_migrations.schema_migrations`, sur la même connexion. Le lot
-- précédent a buté sur un « 42501 permission denied for schema
-- supabase_migrations » qu'il a fallu réparer à la main. Une bascule du rôle
-- actif en cours de migration — même rendue à son état d'origine — peut faire
-- perdre à la CLI les droits nécessaires à cet enregistrement. Un fichier de
-- migration ne doit donc toucher au rôle actif de la session par AUCUN
-- moyen : ni bascule, ni retour de bascule, ni réglage équivalent par
-- paramètre de session.
--
-- ⚠️ LE CONTRÔLE N'EST PAS SUPPRIMÉ, IL EST DÉPLACÉ. L'exécution RÉELLE en
-- rôle `anon` — la requête de la vitrine qui aboutit, l'écriture refusée par
-- la RÈGLE D'ACCÈS et non par un privilège de fonction manquant — est mesurée
-- par un fichier de test exécuté hors du processus de migration :
--
--     supabase/tests/catalogue_offres_role_anon.sql
--
-- Ce fichier-ci ne garde que les vérifications de CATALOGUE SYSTÈME
-- (`pg_policies`, `has_function_privilege`). Elles n'exigent aucun changement
-- de rôle, et elles font échouer la migration si le résultat n'est pas celui
-- attendu.

begin;

alter policy subscription_templates_manage_staff_insert
  on public.subscription_templates to authenticated;

alter policy subscription_templates_manage_staff_update
  on public.subscription_templates to authenticated;

alter policy subscription_templates_manage_staff_delete
  on public.subscription_templates to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — LECTURES DU CATALOGUE SYSTÈME UNIQUEMENT
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare
  v_n int;
begin
  -- 1. Les trois policies d'écriture sont EXACTEMENT au rôle authentifié.
  --    `= '{authenticated}'` et non `~ 'authenticated'` : une policy portant
  --    `{anon,authenticated}` satisferait une recherche de sous-chaîne tout en
  --    laissant le visiteur dans la règle.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public'
     and tablename = 'subscription_templates'
     and policyname in ('subscription_templates_manage_staff_insert',
                        'subscription_templates_manage_staff_update',
                        'subscription_templates_manage_staff_delete')
     and roles::text = '{authenticated}';
  if v_n <> 3 then
    raise exception 'Catalogue d''offres : les trois policies d''écriture ne sont pas exactement bornées à authenticated (% sur 3)', v_n;
  end if;

  -- 2. …et elles ont GARDÉ leur condition. `alter policy … to` ne touche pas
  --    `using`/`with check`, mais on le contrôle plutôt que de le supposer.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public'
     and tablename = 'subscription_templates'
     and policyname in ('subscription_templates_manage_staff_insert',
                        'subscription_templates_manage_staff_update',
                        'subscription_templates_manage_staff_delete')
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'is_admin';
  if v_n <> 3 then
    raise exception 'Catalogue d''offres : une policy d''écriture a perdu sa condition is_admin() (% sur 3)', v_n;
  end if;

  -- 3. La vitrine publique est toujours là, toujours pour `anon`, toujours
  --    bornée aux offres des programmes publiés.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public'
                    and tablename = 'subscription_templates'
                    and policyname = 'subscription_templates_select_vitrine_publique'
                    and roles::text = '{anon}'
                    and qual ~ 'offres_des_programmes_publies'
                    and qual ~ 'is_active') then
    raise exception 'Catalogue d''offres : la policy de vitrine publique a disparu, changé de rôle ou perdu sa borne aux programmes publiés';
  end if;

  -- 4. Les deux policies de lecture interne restent au rôle authentifié.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public'
     and tablename = 'subscription_templates'
     and policyname in ('subscription_templates_select_active_or_staff',
                        'subscription_templates_manage_staff_select')
     and roles::text = '{authenticated}';
  if v_n <> 2 then
    raise exception 'Catalogue d''offres : les policies de lecture élève/staff ne sont plus bornées à authenticated (% sur 2)', v_n;
  end if;

  -- 5. Le compte total n'a pas bougé : aucune policy ajoutée ni supprimée.
  select count(*) into v_n
    from pg_policies where schemaname = 'public' and tablename = 'subscription_templates';
  if v_n <> 6 then
    raise exception 'Catalogue d''offres : le nombre de policies a changé (% au lieu de 6) — ce lot ne doit qu''en modifier les rôles', v_n;
  end if;

  -- 6. Et `anon` n'a toujours pas l'EXECUTE de `is_admin()` : la correction
  --    passe par les rôles des policies, jamais par une réouverture.
  if has_function_privilege('anon', 'public.is_admin()'::regprocedure, 'EXECUTE') then
    raise exception 'Catalogue d''offres : anon a récupéré l''EXECUTE de is_admin() — interdit';
  end if;

  /*
   * ⚠️ CE QUE CES SIX CONTRÔLES NE PROUVENT PAS, ET QUI LE PROUVE.
   *
   * Ils lisent le catalogue système : ils établissent que la RÈGLE est celle
   * attendue, pas que le CHEMIN RÉEL se comporte comme prévu. Le refus par la
   * règle d'accès et le refus par un privilège de fonction manquant portent
   * le même SQLSTATE 42501 : seul le message les distingue, et c'est tout
   * l'objet de ce lot. Cette distinction se mesure en exécutant vraiment la
   * requête dans le rôle du visiteur — donc hors d'une migration, qui ne doit
   * pas toucher au rôle actif de sa session :
   *
   *     supabase/tests/catalogue_offres_role_anon.sql   (contrôles A5 à A7)
   */
  raise notice 'Catalogue d''offres : les trois policies d''écriture sont bornées au rôle authentifié, leurs conditions is_admin() conservées, et la vitrine publique intacte. L''exécution réelle en visiteur est mesurée par supabase/tests/catalogue_offres_role_anon.sql.';
end $g$;

commit;
