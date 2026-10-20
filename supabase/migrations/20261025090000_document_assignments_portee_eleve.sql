-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ AFFECTATIONS DE DOCUMENTS — SORTIR DE L'AUTO-RÉFÉRENCE, BORNER L'ÉLÈVE   ║
-- ║ Migration ADDITIVE : 2 fonctions, 4 policies remplacées, rien d'autre.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- TROIS DÉFAUTS, UNE SEULE CAUSE : CES QUATRE POLICIES
-- ════════════════════════════════════════════════════════════════════════════
-- Les policies de `public.document_assignments` posées par 20261011100000 ne
-- regardent QU'UNE chose : `document_id in (select public.document_ids_*())`.
-- Et `document_ids_*()` (20261011090000) est défini par une JOINTURE INTERNE
-- sur `document_assignments` :
--
--     select distinct d.id from public.documents d
--       join public.document_assignments da on da.document_id = d.id
--      where ... da.student_id in (select public.student_ids_<cat>_*()) ...
--
-- ⚠️ DÉFAUT 1 — INTERBLOCAGE. Pour insérer la PREMIÈRE affectation d'un
-- document, il faut que le document soit déjà dans l'ensemble ; pour y être,
-- il faut qu'il porte déjà une affectation. La première affectation d'un
-- document est donc IMPOSSIBLE, pour tous les rôles — l'administrateur
-- compris, puisque ces deux fonctions n'ont aucune branche `is_admin()`.
-- Mesuré : `42501 new row violates row-level security policy`.
-- Conséquence : tout document neuf naît inaffectable, et retirer la DERNIÈRE
-- affectation d'un document (ce que la policy DELETE autorise) le fait
-- basculer définitivement dans cet état.
--
-- ⚠️ DÉFAUT 2 — FUITE EN ÉCRITURE. Ces policies ne regardent JAMAIS
-- `student_id`. Dès qu'un document est atteignable, n'importe quel identifiant
-- d'élève passe. Mesuré : un coach a inséré une affectation pour l'ÉLÈVE D'UN
-- AUTRE COACH sur son propre document — alors qu'il ne peut pas même lire la
-- fiche de cet élève. L'élève de l'autre cabinet voyait alors ce document
-- apparaître dans sa bibliothèque.
--
-- ⚠️ DÉFAUT 3 — FUITE EN LECTURE. Même absence de contrôle sur `student_id`
-- au SELECT. Mesuré : sur un document du fonds commun affecté à des élèves de
-- plusieurs coachs, un coach lisait les 2 lignes, donc l'identifiant d'un
-- élève dont il ne peut pas lire la fiche.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE MIGRATION FAIT
-- ════════════════════════════════════════════════════════════════════════════
-- Deux prédicats, et la règle devient une CONJONCTION explicite :
--
--     (le document est atteignable par l'appelant)
--  ET (l'élève visé est dans SA portée, pour LA catégorie du document)
--  OU  l'appelant est administrateur
--
-- « Atteignable » reprend exactement les deux voies déjà reconnues ailleurs
-- dans le schéma :
--   a. PROPRIÉTAIRE DANS LA PORTÉE — la branche que 20261013120000 a ajoutée
--      aux policies de `public.documents` pour cette raison précise, écrite
--      noir sur blanc dans son commentaire : « un document NEUF n'a aucune
--      affectation, donc son auteur ne pouvait ni le relire après création,
--      ni le retrouver pour l'affecter ». Le correctif n'avait pas été étendu
--      à `document_assignments`. C'est ce que fait cette migration.
--   b. LA VOIE P13-B, `document_ids_*()`, CONSERVÉE TELLE QUELLE — elle seule
--      donne accès aux documents du FONDS COMMUN (`coach_id IS NULL`, les 17
--      documents de production) à un coach dont un élève y est déjà affecté.
--      La retirer retirerait un droit existant.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ════════════════════════════════════════════════════════════════════════════
--   = `document_ids_lecture()` et `document_ids_ecriture()` NE SONT PAS
--     MODIFIÉES. Les policies Storage (`documents_bucket_select_accessible`,
--     `document_covers_select_accessible`) s'appuient dessus : y toucher
--     changerait l'accès aux FICHIERS, hors sujet et hors périmètre.
--   = Les policies de `public.documents` ne bougent pas.
--   = `documents_select_global_or_assigned` (accès élève) ne bouge pas.
--   = Aucune policy n'est désactivée, aucun droit n'est élargi au-delà de ce
--     que les policies de `public.documents` accordent déjà sur le même
--     document. P13-B reste intact : un collaborateur ne gagne aucun
--     document, aucune catégorie, aucun élève.
--   = Aucune reprise de données, aucune ligne réécrite.
--
-- ⚠️ ET LA CORRECTION RESSERRE AUTANT QU'ELLE OUVRE. Elle débloque la
-- première affectation (défaut 1) et ferme simultanément les défauts 2 et 3.
-- Le seul « droit » retiré est celui d'affecter — ou de lire l'affectation de
-- — l'élève d'un autre coach : ce n'est pas une capacité légitime.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ CETTE MIGRATION NE CHANGE PAS LE RÔLE ACTIF DE SA SESSION
-- ════════════════════════════════════════════════════════════════════════════
-- Ni bascule de rôle, ni retour de bascule, ni réglage équivalent par
-- paramètre : la CLI enregistre le passage de la migration sur la même
-- connexion. Le bloc de vérification final ne lit que le catalogue système.
-- L'exécution réelle par acteur est mesurée hors migration :
--
--     supabase/tests/documents_affectations_checklist.sql

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. LES DEUX PRÉDICATS — NON AUTO-RÉFÉRENTIELS PAR CONSTRUCTION
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ ILS PRENNENT LE COUPLE (document, élève), et c'est tout l'objet : une
-- policy qui ne reçoit que le document ne peut pas vérifier l'élève.
--
-- ⚠️ `security definer` : ces fonctions lisent `public.documents` et les
-- fonctions de portée. Sans cela, la lecture de `documents` repasserait par
-- les policies de `documents`, qui sont permissives sur une autre base — on
-- veut la règle MÉTIER, pas une composition accidentelle de deux policies.
--
-- ⚠️ ELLES N'INTERROGENT PAS `document_assignments` POUR ELLES-MÊMES. La seule
-- lecture de cette table se fait dans `document_ids_*()`, qui est elle aussi
-- `security definer` : aucune récursion de policy, et le document NEUF est
-- atteint par la branche propriétaire, sans dépendre d'une affectation.

create or replace function public.affectation_document_lisible(
  p_document_id uuid,
  p_student_id uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce((select public.is_admin()), false)
      or exists (
           select 1
             from public.documents d
            where d.id = p_document_id
              -- (a) le document est atteignable par l'appelant…
              and (
                (d.coach_id is not null
                 and d.coach_id in (select public.coach_ids_portee()))
                or d.id in (select public.document_ids_lecture())
              )
              -- (b) …ET l'élève visé est dans sa portée, pour LA catégorie
              --     du document (`administratif` relève de `suivi_eleve`).
              and (
                (d.category = 'nutrition'
                 and coalesce('nutrition' in (select public.categories_lecture()), false)
                 and p_student_id in (select public.student_ids_nutrition_lecture()))
                or (d.category = 'entrainement'
                 and coalesce('entrainement' in (select public.categories_lecture()), false)
                 and p_student_id in (select public.student_ids_entrainement_lecture()))
                or (d.category = 'administratif'
                 and coalesce('suivi_eleve' in (select public.categories_lecture()), false)
                 and p_student_id in (select public.student_ids_suivi_eleve_lecture()))
              )
         );
$body$;

create or replace function public.affectation_document_ecrivable(
  p_document_id uuid,
  p_student_id uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce((select public.is_admin()), false)
      or exists (
           select 1
             from public.documents d
            where d.id = p_document_id
              and (
                (d.coach_id is not null
                 and d.coach_id in (select public.coach_ids_portee()))
                or d.id in (select public.document_ids_ecriture())
              )
              and (
                (d.category = 'nutrition'
                 and coalesce('nutrition' in (select public.categories_ecriture()), false)
                 and p_student_id in (select public.student_ids_nutrition_ecriture()))
                or (d.category = 'entrainement'
                 and coalesce('entrainement' in (select public.categories_ecriture()), false)
                 and p_student_id in (select public.student_ids_entrainement_ecriture()))
                or (d.category = 'administratif'
                 and coalesce('suivi_eleve' in (select public.categories_ecriture()), false)
                 and p_student_id in (select public.student_ids_suivi_eleve_ecriture()))
              )
         );
$body$;

alter function public.affectation_document_lisible(uuid, uuid) owner to postgres;
alter function public.affectation_document_ecrivable(uuid, uuid) owner to postgres;

comment on function public.affectation_document_lisible(uuid, uuid) is
  'Vrai si l appelant peut LIRE l affectation (document, eleve) : administrateur, '
  'ou document atteignable (proprietaire dans la portee, ou voie P13-B) ET eleve '
  'dans sa portee de lecture pour la categorie du document. Ne lit jamais '
  'document_assignments pour elle-meme : un document neuf est atteint par la '
  'branche proprietaire.';
comment on function public.affectation_document_ecrivable(uuid, uuid) is
  'Meme regle que affectation_document_lisible, en portee d ECRITURE. C est elle '
  'qui autorise la PREMIERE affectation d un document, impossible avant cette '
  'migration (interblocage auto-referentiel), et qui refuse d affecter l eleve '
  'd un autre coach.';

-- ⚠️ `anon` N'EN A PAS L'EXECUTE. Ces fonctions révèlent, par leur réponse,
-- l'appartenance d'un élève à une portée : un appelant non authentifié ne doit
-- pas pouvoir les interroger via `/rest/v1/rpc/…`. Même traitement que les
-- fonctions de portée de 20261011090000.
do $$
declare f text;
begin
  foreach f in array array['affectation_document_lisible','affectation_document_ecrivable'] loop
    execute format('revoke all on function public.%I(uuid, uuid) from public', f);
    execute format('revoke all on function public.%I(uuid, uuid) from anon', f);
    execute format('grant execute on function public.%I(uuid, uuid) to authenticated', f);
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. LES QUATRE POLICIES
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ LA BRANCHE ÉLÈVE DU SELECT EST CONSERVÉE À L'IDENTIQUE, en premier :
-- `student_id = current_student_id()`. C'est par elle que l'élève lit sa
-- propre affectation (`viewed_at`, déblocage) et elle ne change pas d'un
-- caractère.
drop policy if exists document_assignments_select_self_or_staff on public.document_assignments;
create policy document_assignments_select_self_or_staff
  on public.document_assignments for select to authenticated
  using (
    student_id = (select public.current_student_id())
    or public.affectation_document_lisible(document_id, student_id)
  );

-- ⚠️ C'EST CETTE POLICY QUI DÉBLOQUE LA PREMIÈRE AFFECTATION. Elle n'exige
-- plus que le document figure dans un ensemble construit à partir de la table
-- qu'on est en train d'alimenter.
drop policy if exists document_assignments_manage_staff on public.document_assignments;
create policy document_assignments_manage_staff
  on public.document_assignments for insert to authenticated
  with check (public.affectation_document_ecrivable(document_id, student_id));

-- `using` ET `with check` : sans le second, un UPDATE pourrait DÉPLACER une
-- affectation vers un autre élève ou un autre document hors portée.
drop policy if exists document_assignments_update_staff on public.document_assignments;
create policy document_assignments_update_staff
  on public.document_assignments for update to authenticated
  using (public.affectation_document_ecrivable(document_id, student_id))
  with check (public.affectation_document_ecrivable(document_id, student_id));

drop policy if exists document_assignments_delete_staff on public.document_assignments;
create policy document_assignments_delete_staff
  on public.document_assignments for delete to authenticated
  using (public.affectation_document_ecrivable(document_id, student_id));


-- ════════════════════════════════════════════════════════════════════════════
-- 3. VÉRIFICATION — LECTURES DU CATALOGUE SYSTÈME UNIQUEMENT
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare
  v_n int;
  v_txt text;
begin
  -- 1. Les quatre policies existent, bornées au rôle authentifié.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'document_assignments'
     and policyname in ('document_assignments_select_self_or_staff','document_assignments_manage_staff',
                        'document_assignments_update_staff','document_assignments_delete_staff')
     and roles::text = '{authenticated}';
  if v_n <> 4 then
    raise exception 'document_assignments : les quatre policies ne sont pas au role authentifie (% sur 4)', v_n;
  end if;

  -- 2. ⚠️ LE CONTRÔLE QUI PORTE LE LOT : plus AUCUNE des quatre ne teste
  --    `document_id` contre `document_ids_*()` SANS regarder `student_id`.
  --    C'est cette forme-là qui produisait les trois défauts.
  select count(*), coalesce(string_agg(policyname, ', '), '') into v_n, v_txt
    from pg_policies
   where schemaname = 'public' and tablename = 'document_assignments'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'document_ids_(lecture|ecriture)\(\)'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) !~ 'affectation_document_';
  if v_n <> 0 then
    raise exception 'document_assignments : % policy(ies) testent encore le seul document_id (%)', v_n, v_txt;
  end if;

  -- 3. Les quatre passent par les nouveaux predicats, qui recoivent le COUPLE.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'document_assignments'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'affectation_document_\w+\(document_id, student_id\)';
  if v_n <> 4 then
    raise exception 'document_assignments : une policy ne verifie pas le couple (document, eleve) (% sur 4)', v_n;
  end if;

  -- 4. L'UPDATE porte bien un `with check`.
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='document_assignments'
                    and policyname='document_assignments_update_staff'
                    and with_check is not null) then
    raise exception 'document_assignments : la policy UPDATE n a pas de with_check';
  end if;

  -- 5. La branche de l ELEVE est intacte sur le SELECT.
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='document_assignments'
                    and policyname='document_assignments_select_self_or_staff'
                    and qual ~ 'current_student_id\(\)') then
    raise exception 'document_assignments : l eleve ne lit plus sa propre affectation — regression';
  end if;

  -- 6. Les deux predicats existent, sont STABLE SECURITY DEFINER, et ne sont
  --    PAS auto-referentiels : aucune lecture directe de document_assignments.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('affectation_document_lisible','affectation_document_ecrivable')
     and p.prosecdef
     and p.provolatile = 's';
  if v_n <> 2 then
    raise exception 'document_assignments : les deux predicats ne sont pas STABLE SECURITY DEFINER (% sur 2)', v_n;
  end if;

  select count(*), coalesce(string_agg(p.proname, ', '), '') into v_n, v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('affectation_document_lisible','affectation_document_ecrivable')
     and pg_get_functiondef(p.oid) ~ 'from\s+public\.document_assignments';
  if v_n <> 0 then
    raise exception 'document_assignments : % predicat(s) lisent directement la table protegee (%)', v_n, v_txt;
  end if;

  -- 7. Et ils verifient bien les TROIS categories et la portee ELEVE.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('affectation_document_lisible','affectation_document_ecrivable')
     and pg_get_functiondef(p.oid) ~ 'student_ids_nutrition_'
     and pg_get_functiondef(p.oid) ~ 'student_ids_entrainement_'
     and pg_get_functiondef(p.oid) ~ 'student_ids_suivi_eleve_'
     and pg_get_functiondef(p.oid) ~ 'coach_ids_portee'
     and pg_get_functiondef(p.oid) ~ 'is_admin';
  if v_n <> 2 then
    raise exception 'document_assignments : un predicat ne borne pas les trois categories ET la portee eleve (% sur 2)', v_n;
  end if;

  -- 8. `anon` n a l EXECUTE d aucun des deux.
  select count(*) into v_n
    from unnest(array['public.affectation_document_lisible(uuid, uuid)',
                      'public.affectation_document_ecrivable(uuid, uuid)']) f
   where has_function_privilege('anon', f::regprocedure, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'document_assignments : anon a l EXECUTE de % predicat(s) — interdit', v_n;
  end if;

  -- 9. NON-RÉGRESSION : les fonctions de portee et les policies de `documents`
  --    n ont PAS ete touchees par cette migration.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='document_ids_ecriture'
                    and pg_get_functiondef(p.oid) ~ 'join public\.document_assignments') then
    raise exception 'document_ids_ecriture() a ete modifiee — hors perimetre de ce lot';
  end if;
  select count(*) into v_n
    from pg_policies
   where schemaname='public' and tablename='documents'
     and policyname in ('documents_select_global_or_assigned','documents_manage_staff_select',
                        'documents_manage_staff_insert','documents_manage_staff_update',
                        'documents_manage_staff_delete');
  if v_n <> 5 then
    raise exception 'policies de public.documents : % sur 5 — regression', v_n;
  end if;

  raise notice 'Affectations de documents : interblocage auto-referentiel supprime (la premiere affectation d un document est possible), portee ELEVE desormais verifiee a la lecture comme a l ecriture, voie P13-B et acces eleve conserves. Acces reels mesures par supabase/tests/documents_affectations_checklist.sql.';
end $g$;

commit;
