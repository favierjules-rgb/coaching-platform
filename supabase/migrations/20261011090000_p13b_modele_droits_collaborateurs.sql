-- ════════════════════════════════════════════════════════════════════════════
-- P13-B — MODÈLE DE DROITS : RÔLES, AFFECTATIONS, PERMISSIONS PAR CATÉGORIE
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE MIGRATION FERME
--
-- P13-A a cloisonné les 8 tables du cœur nutrition. Il reste 72 policies sur
-- 48 tables qui opposent `is_coach_or_admin()`, c'est-à-dire AUCUN
-- cloisonnement. Vérifié sur `students` :
--
--     students_select_self_or_staff : (user_id = auth.uid()) OR is_coach_or_admin()
--     students_delete_staff         : is_coach_or_admin()
--
-- N'importe quel compte non-admin du staff peut donc lire, modifier ET
-- supprimer les élèves de tous les coachs. Cette migration pose le modèle ;
-- la réécriture des policies suit dans 20261011100000.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
--
-- Elle ne touche à AUCUNE policy existante et à aucune donnée. Appliquée
-- seule, elle est sans effet observable : elle ajoute un rôle possible, deux
-- tables vides et des fonctions que personne n'appelle encore. C'est
-- délibéré — le modèle doit pouvoir être relu et corrigé avant que quoi que
-- ce soit ne dépende de lui.


-- ── 1. LE TROISIÈME RÔLE ───────────────────────────────────────────────────
-- L'existant, relevé en base avant toute modification :
--   profiles.role ∈ {admin, coach, student}
--   coaches.role  ∈ {admin, assistant}
-- et `lib/supabase/coaches.ts` fait correspondre `profiles.role = 'coach'` à
-- `coaches.role = 'assistant'`. « assistant » est donc le COACH AUTONOME.
--
-- On N'A PAS renommé `assistant` en `coach` : ce serait un changement de
-- vocabulaire qui casserait `coachIdParamSchema`, `CoachModal`,
-- `deleteCoachAccount` et la consigne explicite de préserver les rôles
-- existants. On ajoute seulement `collaborateur`.
--
-- Les deux contraintes sont recréées, pas élargies par `drop constraint` seul :
-- une table sans contrainte, même une seconde, accepterait n'importe quel rôle.
-- `profiles.role` N'EST PAS TOUCHÉE, et c'est une décision, pas un oubli.
--
-- Recherche faite avant d'y toucher, comme demandé. Sept gardes applicatives
-- testent `role === "admin" || role === "coach"` :
--   lib/supabase/auth.ts:84            isAdminOrCoach()
--   lib/supabase/guards.ts:78          requireAdminOrCoach()  → /acces-refuse
--   lib/supabase/guards.ts:269
--   lib/api/authz.ts:101, :124         requireStaff / requireStaffForStudent
--   lib/supabase/login-redirect.ts:55  redirection après connexion
--   lib/stripe/return-routes.ts:14,21
--   app/api/email/appointment-notification/route.ts:66
-- et `types/index.ts:53` fige `UserRole = "admin" | "coach" | "student"`.
--
-- Ajouter une quatrième valeur ferait rejeter le collaborateur par CHACUNE :
-- il se connecterait et serait renvoyé sur /acces-refuse. Le rôle fin vit donc
-- dans `coaches.role`, là où l'interface d'administration le gère déjà, et
-- `profiles.role` reste 'coach' pour un collaborateur — exactement comme pour
-- un assistant aujourd'hui. Les comportements de `admin`, `assistant` et
-- `student` sont ainsi préservés au sens strict : aucune de ces sept gardes
-- ne change de verdict pour eux.

alter table public.coaches drop constraint if exists coaches_role_check;
alter table public.coaches add constraint coaches_role_check
  check (role = any (array['admin','assistant','collaborateur']));


-- ── 2. L'AFFECTATION EXPLICITE D'UN COLLABORATEUR À UN ÉLÈVE ───────────────
-- Décision d'architecture (option B) : `students.coach_id` reste le coach
-- PRINCIPAL et n'est jamais modifié par une affectation. Un collaborateur est
-- rattaché à un élève par une ligne ici, et par rien d'autre.
--
-- Conséquence voulue : plusieurs collaborateurs peuvent suivre le même élève,
-- chacun avec ses propres catégories, sans qu'aucun ne devienne propriétaire.
create table if not exists public.collaborateur_eleves (
  id uuid primary key default gen_random_uuid(),
  -- La fiche `coaches` du collaborateur. CASCADE et non RESTRICT : supprimer
  -- un collaborateur doit emporter ses affectations. La suppression du coach
  -- COACH 1, en octobre, avait échoué précisément sur un RESTRICT oublié.
  collaborateur_id uuid not null references public.coaches(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  -- Qui a décidé de l'affectation. SET NULL : la trace survit au départ de
  -- l'administrateur qui l'a posée.
  affecte_par uuid references public.coaches(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Une seule ligne par couple : l'affectation est un fait, pas un compteur.
  constraint collaborateur_eleves_unique unique (collaborateur_id, student_id)
);

-- Les deux sens de lecture sont utilisés par les policies : « les élèves de ce
-- collaborateur » (index de la contrainte unique) et « les collaborateurs de
-- cet élève » (celui-ci). Sans le second, chaque vérification côté élève
-- balaierait la table.
create index if not exists collaborateur_eleves_student_idx
  on public.collaborateur_eleves (student_id);

alter table public.collaborateur_eleves enable row level security;


-- ── 3. LES PERMISSIONS PAR CATÉGORIE ───────────────────────────────────────
-- Trois niveaux, obtenus sans troisième valeur : ABSENCE DE LIGNE = aucun
-- accès, `lecture` = lecture seule, `ecriture` = lecture et écriture. Encoder
-- « aucun » comme une valeur aurait créé deux façons de dire la même chose, et
-- donc un état où une ligne `aucun` et une ligne absente peuvent diverger.
--
-- `ecriture` IMPLIQUE la lecture : c'est la seule implication du modèle, elle
-- est interne à une catégorie et ne franchit jamais la frontière entre deux
-- catégories.
create table if not exists public.collaborateur_permissions (
  id uuid primary key default gen_random_uuid(),
  collaborateur_id uuid not null references public.coaches(id) on delete cascade,
  categorie text not null
    check (categorie = any (array['entrainement','suivi_eleve','agenda_communication','nutrition'])),
  niveau text not null check (niveau = any (array['lecture','ecriture'])),
  accorde_par uuid references public.coaches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Une seule ligne par catégorie : deux lignes `lecture` + `ecriture` pour la
  -- même catégorie rendraient le niveau effectif ambigu.
  constraint collaborateur_permissions_unique unique (collaborateur_id, categorie)
);

-- La facturation, les paiements, Stripe, les abonnements, `coaches` et
-- `profiles` ne sont PAS dans la liste des catégories et ne peuvent donc pas
-- être accordés. Ce n'est pas un oubli : c'est la règle déjà écrite dans
-- `lib/api/authz.ts` (« le coach ne touche jamais aux données de facturation
-- globales », « le coach ne gère jamais globalement les coachs »), portée ici
-- dans une contrainte que l'interface ne peut pas contourner.

alter table public.collaborateur_permissions enable row level security;

drop trigger if exists collaborateur_permissions_updated_at on public.collaborateur_permissions;
create trigger collaborateur_permissions_updated_at
  before update on public.collaborateur_permissions
  for each row execute function public.set_updated_at();


-- ── 4. LES FONCTIONS D'ACCÈS ───────────────────────────────────────────────
-- Toutes SANS ARGUMENT. C'est la leçon chiffrée de P13-A : une fonction qui
-- prend un argument est réévaluée UNE FOIS PAR LIGNE (1 786 ms sur 3 312
-- lignes), une fonction sans argument est hissée et évaluée UNE FOIS PAR
-- INSTRUCTION (5,6 ms sur les mêmes lignes).
--
-- Toutes en SECURITY DEFINER avec `search_path = public, pg_temp` : pg_temp
-- nommé EN DERNIER, faute de quoi il est consulté EN PREMIER et un objet
-- temporaire peut masquer les tables lues ici.

-- La fiche coach de l'appelant, quel que soit son rôle.
create or replace function public.current_staff_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $f$
  select c.id from public.coaches c
   where c.user_id = auth.uid() and c.status = 'actif'
   order by c.created_at, c.id limit 1;
$f$;

-- Le rôle de l'appelant au sens de ce modèle : 'admin', 'assistant',
-- 'collaborateur', ou null s'il n'est pas membre du staff.
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public, pg_temp as $f$
  select c.role from public.coaches c
   where c.user_id = auth.uid() and c.status = 'actif'
   order by c.created_at, c.id limit 1;
$f$;

-- Les élèves sur lesquels l'appelant a une PORTÉE, avant toute question de
-- catégorie. Un coach autonome : ses élèves. Un collaborateur : ceux qui lui
-- sont explicitement affectés — jamais ceux dont il partage seulement le coach.
-- L'administrateur n'est pas traité ici : il passe par ses propres policies.
create or replace function public.student_ids_portee() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $f$
  -- L'ADMINISTRATEUR est traité ICI, et non dans chaque policy. Mettre
  -- `is_admin() or …` dans les 72 policies aurait imposé un OR à chacune, et
  -- la mesure de P13-A a montré que le planificateur place volontiers les
  -- sous-plans hachés AVANT l'InitPlan de `is_admin()` dans un OR : le
  -- court-circuit n'a pas lieu et l'ensemble est construit pour rien.
  -- Porté par la fonction, chaque policy n'a plus qu'un seul terme à opposer.
  select s.id from public.students s
   where public.staff_role() = 'admin'
  union
  select s.id
    from public.students s
   where public.staff_role() = 'assistant'
     and s.coach_id is not null
     and s.coach_id = public.current_staff_id()
  union
  select a.student_id
    from public.collaborateur_eleves a
   where public.staff_role() = 'collaborateur'
     and a.collaborateur_id = public.current_staff_id();
$f$;

-- Les coachs sous l'autorité desquels l'appelant travaille. Sert aux
-- BIBLIOTHÈQUES rattachées à un coach et non à un élève (`exercise_library`,
-- `session_templates`, `documents`). Un collaborateur accède à la bibliothèque
-- des coachs de ses élèves affectés, et à aucune autre : être collaborateur ne
-- donne pas accès aux bibliothèques de toute la plateforme.
create or replace function public.coach_ids_portee() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $f$
  select c.id from public.coaches c
   where public.staff_role() = 'admin'
  union
  select public.current_staff_id()
   where public.staff_role() = 'assistant'
  union
  select distinct s.coach_id
    from public.collaborateur_eleves a
    join public.students s on s.id = a.student_id
   where public.staff_role() = 'collaborateur'
     and a.collaborateur_id = public.current_staff_id()
     and s.coach_id is not null;
$f$;

-- Les catégories ouvertes à l'appelant, en lecture puis en écriture.
-- Un coach autonome les a toutes : la restriction par catégorie est le propre
-- du collaborateur. L'administrateur n'est pas concerné.
create or replace function public.categories_lecture() returns setof text
language sql stable security definer set search_path = public, pg_temp as $f$
  select unnest(array['entrainement','suivi_eleve','agenda_communication','nutrition'])
   where public.staff_role() in ('admin','assistant')
  union
  select p.categorie
    from public.collaborateur_permissions p
   where public.staff_role() = 'collaborateur'
     and p.collaborateur_id = public.current_staff_id();
$f$;

create or replace function public.categories_ecriture() returns setof text
language sql stable security definer set search_path = public, pg_temp as $f$
  select unnest(array['entrainement','suivi_eleve','agenda_communication','nutrition'])
   where public.staff_role() in ('admin','assistant')
  union
  select p.categorie
    from public.collaborateur_permissions p
   where public.staff_role() = 'collaborateur'
     and p.collaborateur_id = public.current_staff_id()
     and p.niveau = 'ecriture';
$f$;

-- ── 4b. LES HUIT ENSEMBLES D'ÉLÈVES, PAR CATÉGORIE ET PAR NIVEAU ───────────
-- C'est ce que les policies interrogeront : « cet élève est-il dans ma portée
-- POUR CETTE CATÉGORIE, à ce niveau ? ». Croiser la portée et la catégorie
-- dans la policy elle-même aurait obligé à répéter la jointure 48 fois.
--
-- Les huit corps sont GÉNÉRÉS, pas recopiés : huit copies manuelles d'un même
-- prédicat sont huit occasions de diverger d'un mot, et c'est exactement le
-- genre d'écart qu'une relecture ne voit pas. La boucle est la source unique.
do $$
declare
  c text;
  n text;
begin
  foreach c in array array['entrainement','suivi_eleve','agenda_communication','nutrition'] loop
    foreach n in array array['lecture','ecriture'] loop
      execute format($g$
        create or replace function public.student_ids_%1$s_%2$s() returns setof uuid
        language sql stable security definer set search_path = public, pg_temp as $body$
          select e.id from public.student_ids_portee() as e(id)
           where %1$L in (select public.categories_%2$s());
        $body$;
      $g$, c, n);
    end loop;
  end loop;
end $$;


-- Les tables GLOBALES — réglages de réservation, niveaux de documents,
-- abonnés à la newsletter, journaux d'emails, campagnes et occurrences de
-- notification, abonnements push, journaux d'emails de rendez-vous — ne se
-- rattachent à aucun élève. Aucune affectation ne peut donc les justifier, et
-- la règle « sans élève identifiable, pas d'accès » s'y applique telle quelle :
-- elles restent à l'administrateur et au coach autonome, et ne sont JAMAIS
-- accordables à un collaborateur, quelle que soit sa catégorie.
create or replace function public.est_staff_global() returns boolean
language sql stable security definer set search_path = public, pg_temp as $f$
  select public.staff_role() in ('admin','assistant');
$f$;

-- ── 4c. LES ENSEMBLES DÉRIVÉS : PROGRAMMES, SÉANCES, DOCUMENTS ────────────
-- Sept tables d'entraînement ne portent pas de `student_id` : la propriété
-- passe par `programs`. Six autres niveaux de chaîne seraient traversés une
-- fois PAR LIGNE si on les écrivait en EXISTS dans la policy — c'est
-- exactement ce qui a coûté 107 ms de planification sur la nutrition. On les
-- précalcule donc en ensembles, eux aussi sans argument.
--
-- `programs` est l'un ou l'autre : un PROGRAMME D'ÉLÈVE (`owner_student_id`
-- renseigné) ou un MODÈLE DE COACH (`owner_student_id` nul). Les deux règles
-- de propriété coexistent et ne se recouvrent pas.
do $$
declare n text;
begin
  foreach n in array array['lecture','ecriture'] loop
    execute format($g$
      create or replace function public.program_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        select p.id from public.programs p
         where p.owner_student_id in (select public.student_ids_entrainement_%1$s())
        union
        select p.id from public.programs p
         where p.owner_student_id is null
           and ( public.est_staff_global()
                 or ( p.coach_id is not null
                      and p.coach_id in (select public.coach_ids_portee())
                      and 'entrainement' in (select public.categories_%1$s()) ) );
      $body$;

      create or replace function public.workout_session_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        select ws.id from public.workout_sessions ws
         where ws.program_id in (select public.program_ids_%1$s());
      $body$;

      create or replace function public.training_block_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        select tb.id from public.training_blocks tb
         where tb.session_id in (select public.workout_session_ids_%1$s());
      $body$;

      create or replace function public.workout_exercise_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        select we.id from public.workout_exercises we
         where we.session_id in (select public.workout_session_ids_%1$s())
            or we.block_id in (select public.training_block_ids_%1$s());
      $body$;

      -- Les DOCUMENTS sont routés par LEUR PROPRE catégorie, et non en bloc :
      -- `documents.category` est contrainte à {nutrition, entrainement,
      -- administratif}. Ranger la table entière dans une seule catégorie
      -- ouvrirait les documents de nutrition à qui n'a pas la nutrition.
      -- `administratif` relève de `suivi_eleve`.
      --
      -- Un document n'est atteint QUE par une affectation d'élève : il doit
      -- être assigné (`document_assignments`) à un élève lui-même affecté au
      -- collaborateur. Un document global, ou assigné à personne, reste
      -- inaccessible — c'est la règle « sans élève identifiable, pas d'accès ».
      create or replace function public.document_ids_%1$s() returns setof uuid
      language sql stable security definer set search_path = public, pg_temp as $body$
        select distinct d.id
          from public.documents d
          join public.document_assignments da on da.document_id = d.id
         where (d.category = 'nutrition'
                  and da.student_id in (select public.student_ids_nutrition_%1$s()))
            or (d.category = 'entrainement'
                  and da.student_id in (select public.student_ids_entrainement_%1$s()))
            or (d.category = 'administratif'
                  and da.student_id in (select public.student_ids_suivi_eleve_%1$s()));
      $body$;
    $g$, n);
  end loop;
end $$;

-- ── 5. LES DROITS D'EXÉCUTION ──────────────────────────────────────────────
-- `anon` possède le droit TEMP et peut appeler une fonction exposée : lui
-- laisser EXECUTE donnerait à un appelant NON AUTHENTIFIÉ la liste des
-- identifiants d'élèves d'un coach via `/rest/v1/rpc/…`. L'advisor Supabase
-- signale déjà ce défaut sur `current_student_id()` et `is_coach_or_admin()` ;
-- on ne l'ajoute pas aux nouvelles fonctions.
do $$
declare f text;
begin
  foreach f in array array[
    'current_staff_id','staff_role','student_ids_portee','coach_ids_portee',
    'categories_lecture','categories_ecriture',
    'student_ids_entrainement_lecture','student_ids_entrainement_ecriture',
    'student_ids_suivi_eleve_lecture','student_ids_suivi_eleve_ecriture',
    'student_ids_agenda_communication_lecture','student_ids_agenda_communication_ecriture',
    'student_ids_nutrition_lecture','student_ids_nutrition_ecriture',
    'program_ids_lecture','program_ids_ecriture',
    'workout_session_ids_lecture','workout_session_ids_ecriture',
    'training_block_ids_lecture','training_block_ids_ecriture',
    'workout_exercise_ids_lecture','workout_exercise_ids_ecriture',
    'document_ids_lecture','document_ids_ecriture',
    'est_staff_global'
  ] loop
    execute format('revoke all on function public.%I() from public', f);
    execute format('revoke all on function public.%I() from anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop;
end $$;


-- ── 6. LES POLICIES DES DEUX NOUVELLES TABLES ──────────────────────────────
-- Les affectations et les permissions sont de l'ADMINISTRATION : seul
-- l'administrateur les écrit. Un collaborateur qui pourrait s'affecter un
-- élève ou s'accorder une catégorie contournerait tout le modèle en une
-- requête.
drop policy if exists "collaborateur_eleves_manage_admin" on public.collaborateur_eleves;
create policy "collaborateur_eleves_manage_admin"
  on public.collaborateur_eleves for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Le collaborateur LIT ses propres affectations — l'interface doit pouvoir lui
-- dire de qui il s'occupe — et ne les écrit jamais.
drop policy if exists "collaborateur_eleves_select_self" on public.collaborateur_eleves;
create policy "collaborateur_eleves_select_self"
  on public.collaborateur_eleves for select to authenticated
  using (collaborateur_id = (select public.current_staff_id()));

drop policy if exists "collaborateur_permissions_manage_admin" on public.collaborateur_permissions;
create policy "collaborateur_permissions_manage_admin"
  on public.collaborateur_permissions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "collaborateur_permissions_select_self" on public.collaborateur_permissions;
create policy "collaborateur_permissions_select_self"
  on public.collaborateur_permissions for select to authenticated
  using (collaborateur_id = (select public.current_staff_id()));


-- ── 7. CE QUI N'EST PAS TOUCHÉ ─────────────────────────────────────────────
-- Aucune policy existante, aucune donnée, aucune migration P13-A.
-- `is_coach_or_admin()` existe toujours et reste utilisée par les 72 policies
-- que la migration suivante réécrira : tant qu'elle n'est pas appliquée, le
-- comportement de la plateforme est strictement inchangé.
