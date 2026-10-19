-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PROGRAMMES — PROPRIÉTÉ PAR COACH, PUBLICATION RÉSERVÉE À L'ADMIN,       ║
-- ║ ET VITRINE PUBLIQUE RENDUE LISIBLE À UN VISITEUR                        ║
-- ║ Migration ADDITIVE. Aucune migration déjà appliquée n'est modifiée —    ║
-- ║ celle-ci n'est pas encore appliquée, la section 4 y est donc ajoutée    ║
-- ║ plutôt que livrée dans une migration de plus.                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUI A ÉTÉ MESURÉ AVANT D'ÉCRIRE UNE LIGNE
-- ════════════════════════════════════════════════════════════════════════════
-- Deux coachs autonomes (`coaches.role = 'assistant'`), un programme chacun,
-- sur une base portant toutes les migrations P13-B :
--
--     programmes visibles           coach1 = 3   coach2 = 3   (sur 3)
--     coach2 voit le programme de coach1          OUI
--     coach2 MODIFIE le programme de coach1       OK
--     coach2 SUPPRIME le programme de coach1      OK
--     coach1 publie (is_public = true)            OK
--     coach1 met en vente (offre publique)        OK
--     coach1 INSÈRE un programme déjà public      OK
--
-- Il n'y avait donc AUCUN cloisonnement des programmes entre coachs, et aucune
-- réserve de publication.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA CAUSE, ET ELLE N'EST PAS CELLE QU'ON CROIT
-- ════════════════════════════════════════════════════════════════════════════
-- Les policies de `programs` savent déjà parler de propriété :
--
--     (owner_student_id is null and ( est_staff_global()
--                                     or (coach_id in (select coach_ids_portee())
--                                         and 'entrainement' in (select categories_lecture())) ))
--
-- Deux défauts se superposent :
--
--  1. `est_staff_global()` est VRAI pour tout coach autonome. Placé en
--     PREMIER terme d'un `or`, il rend la clause de propriété qui suit
--     purement décorative : tout assistant obtient tous les programmes
--     modèles, quel que soit leur `coach_id`.
--
--  2. ⚠️ ET `coach_id` N'EST JAMAIS RENSEIGNÉ. Relevé en production :
--     28 programmes, dont 25 copies individuelles (`owner_student_id`) et 3
--     modèles — et `coach_id` est NULL sur les 28. `createProgram`
--     (lib/supabase/programs.ts) ne l'écrit pas : la colonne existe, les
--     policies la citent, rien ne la remplit. Corriger seulement le point 1
--     aurait donc rendu un coach aveugle à SES PROPRES programmes.
--
-- C'est pour cela que ce correctif pose la propriété AVANT de s'en servir.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE MIGRATION NE TOUCHE PAS, ET POURQUOI
-- ════════════════════════════════════════════════════════════════════════════
--   · `exercise_library` et `session_templates` restent ouvertes au staff
--     global : ce sont les ressources MUTUALISÉES du cabinet (catalogue
--     d'exercices, modèles de séance), pas des programmes. Les cloisonner
--     priverait un coach de sa bibliothèque — hors de la demande.
--   · `programs_select_public` (`is_public and status = 'actif'`) n'est pas
--     touchée dans sa RÈGLE ni dans son rôle (`{anon}`) : elle reste la seule
--     porte de la vitrine. La section 4 se contente d'empêcher les policies
--     INTERNES d'être évaluées à côté d'elle pour un visiteur, ce qui les
--     faisait lever et emportait toute la requête.
--   · `programs_select_assigned_student` n'est pas touchée : un élève continue
--     de voir le programme qui lui est assigné.
--   · la branche `owner_student_id is not null` n'est pas touchée : les copies
--     individuelles restent gouvernées par `student_ids_entrainement_*`, donc
--     par les affectations P13-B. Le cloisonnement des collaborateurs est
--     intact — ils n'ont jamais eu `est_staff_global()`.
--   · AUCUNE DONNÉE N'EST RÉÉCRITE. Les 3 modèles existants gardent leur
--     `coach_id` NULL et deviennent donc visibles de l'administrateur seul.
--     C'est la conséquence voulue et elle est signalée au rapport : ces
--     modèles sont ceux du cabinet, créés avant que la propriété existe. Un
--     backfill aurait attribué arbitrairement des programmes à un coach.
--   · Stripe, Brevo et Resend ne sont pas touchés : la configuration reste
--     partagée, aucune séparation financière n'est introduite.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. LA PROPRIÉTÉ EST POSÉE À LA CRÉATION, EN BASE
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ EN BASE ET PAS SEULEMENT DANS `createProgram`. Un correctif applicatif
-- laisserait `coach_id` NULL pour toute insertion directe en PostgREST — donc
-- un programme sans propriétaire, invisible à son auteur et modifiable par
-- l'administrateur seul. Le déclencheur, lui, ne peut pas être contourné.
--
-- ⚠️ ET IL NE S'APPLIQUE QU'AUX MODÈLES. Une copie individuelle
-- (`owner_student_id` renseigné) est créée par `provision_program_copy` en
-- `service_role` et gouvernée par les affectations : lui poser un `coach_id`
-- ne changerait rien et brouillerait la lecture.
--
-- ⚠️ LA VALEUR N'EST PAS CELLE QUE LE CLIENT ENVOIE. `current_staff_id()` est
-- SECURITY DEFINER et ne rend que la fiche de l'appelant : un coach ne peut
-- donc pas s'attribuer le programme d'un autre en forgeant la requête.
-- L'administrateur, lui, garde la main : s'il désigne explicitement un
-- `coach_id`, il est conservé.

create or replace function public.programs_poser_proprietaire()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- Copie individuelle : la propriété se lit sur l'élève, pas sur le coach.
  if new.owner_student_id is not null then
    return new;
  end if;

  -- Déjà renseigné : on respecte le choix (parcours administrateur, imports,
  -- régularisations en service_role).
  if new.coach_id is not null then
    return new;
  end if;

  -- Contexte serveur (service_role, cron, migration) : aucune fiche à poser.
  if auth.uid() is null then
    return new;
  end if;

  new.coach_id := public.current_staff_id();
  return new;
end;
$fn$;
alter function public.programs_poser_proprietaire() owner to postgres;
revoke all on function public.programs_poser_proprietaire() from public, anon, authenticated, service_role;

drop trigger if exists programs_poser_proprietaire on public.programs;
create trigger programs_poser_proprietaire
  before insert on public.programs
  for each row execute function public.programs_poser_proprietaire();

comment on function public.programs_poser_proprietaire() is
  'Pose programs.coach_id = current_staff_id() à la création d''un programme MODÈLE '
  '(owner_student_id NULL) quand l''appelant n''en a pas fourni. Sans cela, coach_id '
  'restait NULL sur toutes les lignes — relevé en production — et le cloisonnement '
  'des programmes par coach n''avait aucun support.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2. UN COACH NE VOIT QUE SES PROGRAMMES
-- ════════════════════════════════════════════════════════════════════════════
-- `est_staff_global()` devient `is_admin()` dans la branche des MODÈLES, et là
-- seulement. Ce que cela donne, rôle par rôle, une fois `coach_id` posé :
--
--   · administrateur réel  → `coach_ids_portee()` rend TOUTES les fiches, et
--     `is_admin()` le couvre même sans fiche : visibilité globale conservée ;
--   · coach autonome       → `coach_ids_portee()` rend sa SEULE fiche
--     (`current_staff_id()`) : ses programmes, et rien d'autre ;
--   · collaborateur        → `coach_ids_portee()` rend les coachs de ses
--     élèves affectés, et la catégorie `entrainement` reste exigée :
--     comportement P13-B inchangé, il n'avait pas `est_staff_global()`.

create or replace function public.program_ids_lecture()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select p.id from public.programs p
   where p.owner_student_id in (select public.student_ids_entrainement_lecture())
  union
  select p.id from public.programs p
   where p.owner_student_id is null
     and ( coalesce(public.is_admin(), false)
           or ( p.coach_id is not null
                and p.coach_id in (select public.coach_ids_portee())
                and 'entrainement' in (select public.categories_lecture()) ) );
$fn$;

create or replace function public.program_ids_ecriture()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select p.id from public.programs p
   where p.owner_student_id in (select public.student_ids_entrainement_ecriture())
  union
  select p.id from public.programs p
   where p.owner_student_id is null
     and ( coalesce(public.is_admin(), false)
           or ( p.coach_id is not null
                and p.coach_id in (select public.coach_ids_portee())
                and 'entrainement' in (select public.categories_ecriture()) ) );
$fn$;

-- Les quatre policies de `programs` portent la même règle, écrite en ligne.
-- Elles sont recréées à l'identique, à ce seul terme près.
drop policy if exists programs_manage_staff_select on public.programs;
create policy programs_manage_staff_select
  on public.programs for select
  -- `to authenticated` : voir la section 4. Un visiteur anonyme n'a jamais été
  -- concerné par cette règle, et l'y soumettre faisait LEVER la vitrine.
  to authenticated
  using (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_lecture()))
    or (owner_student_id is null
        and ( coalesce(public.is_admin(), false)
              or ( coach_id is not null
                   and coach_id in (select public.coach_ids_portee())
                   and coalesce('entrainement' in (select public.categories_lecture()), false) ) ))
  );

drop policy if exists programs_manage_staff_insert on public.programs;
create policy programs_manage_staff_insert
  on public.programs for insert
  -- `to authenticated` : voir la section 4. Un visiteur anonyme n'a jamais été
  -- concerné par cette règle, et l'y soumettre faisait LEVER la vitrine.
  to authenticated
  with check (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_ecriture()))
    or (owner_student_id is null
        and ( coalesce(public.is_admin(), false)
              or ( coach_id is not null
                   and coach_id in (select public.coach_ids_portee())
                   and coalesce('entrainement' in (select public.categories_ecriture()), false) ) ))
  );

drop policy if exists programs_manage_staff_update on public.programs;
create policy programs_manage_staff_update
  on public.programs for update
  -- `to authenticated` : voir la section 4. Un visiteur anonyme n'a jamais été
  -- concerné par cette règle, et l'y soumettre faisait LEVER la vitrine.
  to authenticated
  using (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_ecriture()))
    or (owner_student_id is null
        and ( coalesce(public.is_admin(), false)
              or ( coach_id is not null
                   and coach_id in (select public.coach_ids_portee())
                   and coalesce('entrainement' in (select public.categories_ecriture()), false) ) ))
  )
  with check (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_ecriture()))
    or (owner_student_id is null
        and ( coalesce(public.is_admin(), false)
              or ( coach_id is not null
                   and coach_id in (select public.coach_ids_portee())
                   and coalesce('entrainement' in (select public.categories_ecriture()), false) ) ))
  );

drop policy if exists programs_manage_staff_delete on public.programs;
create policy programs_manage_staff_delete
  on public.programs for delete
  -- `to authenticated` : voir la section 4. Un visiteur anonyme n'a jamais été
  -- concerné par cette règle, et l'y soumettre faisait LEVER la vitrine.
  to authenticated
  using (
    (owner_student_id is not null
     and owner_student_id in (select public.student_ids_entrainement_ecriture()))
    or (owner_student_id is null
        and ( coalesce(public.is_admin(), false)
              or ( coach_id is not null
                   and coach_id in (select public.coach_ids_portee())
                   and coalesce('entrainement' in (select public.categories_ecriture()), false) ) ))
  );


-- ════════════════════════════════════════════════════════════════════════════
-- 3. PUBLIER ET VENDRE : L'ADMINISTRATEUR, ET PERSONNE D'AUTRE
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ DEUX COLONNES, ET DEUX SEULEMENT, PORTENT CE POUVOIR :
--
--     is_public                        → la vitrine publique
--                                        (`programs_select_public` :
--                                         is_public AND status = 'actif')
--     public_subscription_template_id  → la mise en vente
--                                        (/api/public/programs/[id]/checkout
--                                         refuse sans elle)
--
-- ⚠️ ET TROIS AUTRES N'EN PORTENT AUCUN — elles restent au coach, c'est la
-- distinction que la demande exige :
--
--     status ∈ {brouillon, actif, archivé}      travail interne
--     publication_status ∈ {draft, published}   visibilité pour SON élève
--     published_at                              horodatage, aucun droit
--
-- Un programme `status = 'actif'` et `is_public = false` n'est dans aucune
-- vitrine : le coach peut donc mener tout son travail sans jamais approcher la
-- commercialisation.
--
-- ⚠️ CE DÉCLENCHEUR LÈVE, IL NE RECOPIE PAS EN SILENCE — dans un sens. Les
-- déclencheurs voisins (`protect_access_columns`, `protect_students_ownership`)
-- remettent l'ancienne valeur sans rien dire ; c'est tenable pour un champ
-- administratif, c'est inacceptable ici : un coach qui croit avoir publié son
-- programme et ne voit rien venir n'a aucun moyen de comprendre. Une tentative
-- d'OUVRIR la publication ou la vente lève donc `42501`, que la couche API
-- traduit en refus explicite.
--
-- ⚠️ MAIS LE SENS INVERSE EST PRÉSERVÉ EN SILENCE, ET C'EST DÉLIBÉRÉ.
-- `updateProgram` renvoie TOUJOURS les deux colonnes dans son payload, et le
-- builder d'un coach ne modélise pas la publication : il enverrait
-- `is_public = false` sur un programme que l'administrateur a publié. Lever
-- dans ce cas interdirait au coach de modifier son propre programme pour une
-- intention qu'il n'a pas eue. La valeur de l'administrateur est donc
-- conservée, et l'édition passe.

create or replace function public.programs_publication_reservee_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_autorise boolean;
  v_ancien_public boolean;
  v_ancienne_offre uuid;
begin
  -- L'administrateur réel, et le serveur (webhook Stripe, régularisation
  -- d'achat, cron) qui crée les copies et encaisse les paiements.
  v_autorise := coalesce(public.is_admin(), false)
                or auth.uid() is null
                or coalesce(auth.role(), '') = 'service_role';
  if v_autorise then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Naître public ou vendable est une publication déguisée.
    if coalesce(new.is_public, false) or new.public_subscription_template_id is not null then
      raise exception 'La publication et la mise en vente d''un programme sont réservées à l''administrateur.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  v_ancien_public := coalesce(old.is_public, false);
  v_ancienne_offre := old.public_subscription_template_id;

  -- Ouvrir la vitrine, ou rattacher une offre payante : refus net.
  if (coalesce(new.is_public, false) and not v_ancien_public)
     or (new.public_subscription_template_id is not null
         and new.public_subscription_template_id is distinct from v_ancienne_offre) then
    raise exception 'La publication et la mise en vente d''un programme sont réservées à l''administrateur.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Tout autre écart sur ces deux colonnes — dépublier, retirer l'offre — est
  -- une intention que le coach n'a pas formulée : on conserve l'existant.
  new.is_public := v_ancien_public;
  new.public_subscription_template_id := v_ancienne_offre;
  return new;
end;
$fn$;
alter function public.programs_publication_reservee_admin() owner to postgres;
revoke all on function public.programs_publication_reservee_admin() from public, anon, authenticated, service_role;

drop trigger if exists programs_publication_reservee_admin on public.programs;
create trigger programs_publication_reservee_admin
  before insert or update on public.programs
  for each row execute function public.programs_publication_reservee_admin();

comment on function public.programs_publication_reservee_admin() is
  'Réserve is_public et public_subscription_template_id à l''administrateur réel '
  '(public.is_admin()) et au serveur. Lève 42501 sur toute tentative d''OUVRIR la '
  'publication ou la vente ; conserve en silence les valeurs de l''administrateur '
  'quand un payload de coach les effacerait sans l''avoir demandé. status, '
  'publication_status et published_at restent au coach : travail interne.';


-- ════════════════════════════════════════════════════════════════════════════
-- 4. LA VITRINE PUBLIQUE : LES POLICIES INTERNES NE DOIVENT PLUS ÊTRE
--    ÉVALUÉES POUR UN VISITEUR
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ LE DÉFAUT, REPRODUIT EN LOCAL. La requête exacte de la vitrine
-- (`fetchPublicPrograms`, lib/supabase/public-programs.ts : `programs` filtré
-- sur `is_public = true AND status = 'actif'`, joint à
-- `subscription_templates(amount_cents, currency)`) échoue pour un visiteur
-- non connecté :
--
--     42501  permission denied for function student_ids_entrainement_lecture
--     puis, une fois la première lever corrigée :
--     42501  permission denied for function is_admin
--
-- ⚠️ ET CE N'EST PAS UN DÉFAUT DE CE LOT : il est ANTÉRIEUR. P13-B
-- (20261011110000) a retiré à `anon` l'EXECUTE des fonctions de portée, pour
-- de bonnes raisons. Mais les policies INTERNES du staff portent le rôle
-- `{public}`, donc PostgreSQL les évalue aussi pour `anon` — et une policy
-- permissive qui LÈVE ne se contente pas de ne rien rendre : elle fait
-- échouer toute la requête, y compris la branche publique qui aurait dû
-- répondre. Relevé précisément :
--
--   policy                                        rôle       fonction refusée à anon
--   ───────────────────────────────────────────────────────────────────────────
--   programs_manage_staff_select                  {public}   student_ids_entrainement_lecture,
--                                                            is_admin, coach_ids_portee,
--                                                            categories_lecture
--   subscription_templates_manage_staff_select    {public}   is_admin
--
--   programs_select_assigned_student              {public}   AUCUNE en propre, MAIS…
--
-- ⚠️ …ET C'EST LE PIÈGE QU'UNE PREMIÈRE MESURE AVAIT MANQUÉ. Les fonctions que
-- cette policy appelle elle-même (`current_student_id()`) SONT accordées à
-- `anon`. Mais sa clause lit `public.assignments` — et les deux policies de
-- lecture d'`assignments` portent le rôle `{public}` et appellent
-- `student_ids_entrainement_lecture()`. La requête du visiteur échouait donc
-- encore APRÈS avoir borné `programs_manage_staff_select`, sur un SECOND saut :
--
--     programs ──(EXISTS)──► assignments ──► student_ids_entrainement_lecture
--
-- Une policy innocente de ses propres appels peut faire tomber la requête par
-- la table qu'elle interroge. C'est pourquoi la vérification finale de ce lot
-- n'inspecte pas seulement le texte des policies : elle EXÉCUTE la requête de
-- la vitrine en `anon` et refuse l'application si elle lève. Un contrôle
-- textuel, à n'importe quelle profondeur, aurait laissé passer celui-là.
--
-- `programs_select_assigned_student` est donc bornée au rôle authentifié elle
-- aussi : un visiteur anonyme n'est jamais un élève assigné, cela ne lui
-- retire rien. `assignments` n'est pas touchée — plus aucun chemin anonyme ne
-- la lit.
--   subscription_templates_select_active_or_staff {public}   AUCUNE — ses deux fonctions
--                                                            intermédiaires sont accordées
--                                                            à anon (migration 20261018090000).
--
-- ⚠️ LA CORRECTION NE REND AUCUN EXECUTE À `anon` SUR UNE FONCTION DU STAFF.
-- Ce serait prendre le problème par le mauvais bout : ces fonctions lisent les
-- affectations, les permissions et les fiches du cabinet. On BORNE les policies
-- internes au rôle `authenticated`, qui est le seul à les avoir jamais
-- concernées, et on laisse à `anon` des policies PUBLIQUES distinctes, dont la
-- clause ne contient que des colonnes — aucun appel de fonction interne.
--
-- ⚠️ CELA NE DONNE RIEN DE PLUS À PERSONNE. `to authenticated` RESTREINT la
-- portée d'une policy permissive : aucun rôle n'y gagne un droit. Un visiteur
-- qui tentait d'écrire dans `programs` recevait un `42501` sur une fonction ;
-- il reçoit maintenant un refus net, faute de policy applicable.

-- ⚠️ LES QUATRE POLICIES INTERNES DE `programs` SONT DÉFINIES EN SECTION 2,
-- ET ELLES Y PORTENT DÉJÀ `to authenticated` — c'est ici qu'on explique
-- pourquoi, mais il n'y a qu'UN endroit où la règle s'écrit. Une première
-- version de ce fichier les recréait une seconde fois ici : deux définitions
-- de la même règle dans un même fichier, dont la seconde gagne en silence,
-- c'est exactement la divergence qu'on passe son temps à réparer ailleurs.

drop policy if exists programs_select_assigned_student on public.programs;
create policy programs_select_assigned_student
  on public.programs for select
  to authenticated
  using (
    publication_status = 'published'
    and exists (
      select 1 from public.assignments a
       where a.content_type = 'programme'
         and a.content_id = programs.id
         and a.student_id = public.current_student_id()
    )
  );


-- ── 4b. Le catalogue d'offres : la vitrine et le reste séparés ────────────
--
-- ⚠️ CE QUE LE VISITEUR A BESOIN DE LIRE, ET RIEN DE PLUS. La vitrine joint
-- l'offre d'un programme publié pour en afficher le prix
-- (`subscription_templates(amount_cents, currency)`). Aucune page anonyme ne
-- liste le catalogue d'offres : vérifié sur tous les appelants de
-- `getSubscriptionTemplates`/`ById` — routes d'administration
-- (`requireAdmin()`), route email et webhook Stripe (`service_role`), parcours
-- d'achat de l'élève (session élève). La policy publique est donc bornée aux
-- offres RATTACHÉES À UN PROGRAMME PUBLIÉ.
--
-- ⚠️ C'EST PLUS ÉTROIT QU'AVANT, PAS PLUS LARGE. Jusqu'ici
-- `subscription_templates_select_active_or_staff` rendait à `anon` TOUTES les
-- offres actives (`peut_voir_catalogue_offres()` est vraie pour un appelant
-- non authentifié). Un visiteur voit désormais les seules offres qu'un
-- programme publié met en avant.
--
-- ⚠️ ET LA FONCTION INTERMÉDIAIRE N'EST PAS UNE FONCTION DU STAFF. Elle ne
-- rend que la liste des offres attachées à des programmes PUBLIÉS — une
-- information publique par construction, celle-là même que la vitrine
-- affiche. Elle ne lit ni affectation, ni permission, ni fiche de coach. Son
-- EXECUTE accordé à `anon` ne rouvre donc rien du modèle P13-B, dont les
-- fonctions de portée restent inaccessibles à `anon`.
create or replace function public.offres_des_programmes_publies()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select distinct p.public_subscription_template_id
    from public.programs p
   where p.is_public = true
     and p.status = 'actif'
     and p.public_subscription_template_id is not null;
$fn$;
alter function public.offres_des_programmes_publies() owner to postgres;
revoke all on function public.offres_des_programmes_publies() from public, anon, authenticated, service_role;
grant execute on function public.offres_des_programmes_publies() to anon, authenticated, service_role;

comment on function public.offres_des_programmes_publies() is
  'Offres rattachées à un programme PUBLIÉ (is_public + status actif) — information '
  'publique par construction, celle que la vitrine affiche. Sert la policy '
  'subscription_templates_select_vitrine_publique, accordée à anon. Ne lit aucune '
  'affectation, permission ni fiche de coach : elle ne rouvre rien du modèle P13-B.';

drop policy if exists subscription_templates_select_vitrine_publique on public.subscription_templates;
create policy subscription_templates_select_vitrine_publique
  on public.subscription_templates for select
  to anon
  using (
    is_active = true
    and id in (select public.offres_des_programmes_publies())
  );

-- La policy de l'élève et du staff, bornée au rôle authentifié. La règle est
-- reprise À L'IDENTIQUE de la migration 20261018090000 : élève pour son
-- parcours d'achat, staff global et administrateur pour la gestion.
drop policy if exists subscription_templates_select_active_or_staff on public.subscription_templates;
create policy subscription_templates_select_active_or_staff
  on public.subscription_templates for select
  to authenticated
  using (
    (is_active = true and public.peut_voir_catalogue_offres())
    or id in (select public.offre_de_l_eleve_connecte())
  );

-- Et la policy d'administration du catalogue, qui appelait `is_admin()` pour
-- un visiteur. Les trois commandes d'écriture ne sont pas touchées : elles ne
-- sont évaluées que pour la commande correspondante, qu'`anon` n'émet jamais.
drop policy if exists subscription_templates_manage_staff_select on public.subscription_templates;
create policy subscription_templates_manage_staff_select
  on public.subscription_templates for select
  to authenticated
  using ((select public.is_admin()));


-- ════════════════════════════════════════════════════════════════════════════
-- 5. VÉRIFICATION
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare
  v_n int;
  v_vitrine_ok boolean;
  v_vitrine_erreur text;
begin
  -- La branche des modèles ne dépend plus du staff global, dans les deux
  -- fonctions et dans les quatre policies.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('program_ids_lecture', 'program_ids_ecriture')
     and pg_get_functiondef(p.oid) ~ 'est_staff_global';
  if v_n <> 0 then
    raise exception 'Programmes : % fonction(s) de portée dépendent encore du staff global — le cloisonnement serait décoratif', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('program_ids_lecture', 'program_ids_ecriture')
     and pg_get_functiondef(p.oid) ~ 'is_admin'
     and pg_get_functiondef(p.oid) ~ 'coach_ids_portee';
  if v_n <> 2 then
    raise exception 'Programmes : une fonction de portée a perdu l''administrateur ou la clause de propriété';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'programs'
     and policyname like 'programs_manage_staff_%'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'est_staff_global';
  if v_n <> 0 then
    raise exception 'Programmes : % policy(ies) laissent encore passer tout coach autonome', v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'programs'
     and policyname like 'programs_manage_staff_%'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'coach_ids_portee'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'is_admin';
  if v_n <> 4 then
    raise exception 'Programmes : les quatre policies ne portent pas toutes la règle (% sur 4)', v_n;
  end if;

  -- La vitrine publique et l'accès de l'élève assigné sont intacts.
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='programs'
                    and policyname='programs_select_public') then
    raise exception 'Programmes : la vitrine publique a disparu';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='programs'
                    and policyname='programs_select_assigned_student') then
    raise exception 'Programmes : l''accès de l''élève assigné a disparu';
  end if;

  -- Les deux déclencheurs sont posés.
  for v_n in
    select 1 from unnest(array['programs_poser_proprietaire',
                               'programs_publication_reservee_admin']) t
     where not exists (select 1 from pg_trigger
                        where tgrelid = 'public.programs'::regclass
                          and tgname = t and not tgisinternal)
  loop
    raise exception 'Programmes : un déclencheur de ce lot n''est pas posé sur la table';
  end loop;

  -- Et la bibliothèque mutualisée n'a pas été cloisonnée par erreur.
  select count(*) into v_n from pg_policies
   where schemaname='public' and tablename in ('exercise_library','session_templates')
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'est_staff_global';
  if v_n <> 8 then
    raise exception 'Programmes : la bibliothèque d''exercices ou les modèles de séance ont changé de règle (% policies sur 8)', v_n;
  end if;


  -- ── Section 4 : plus aucune policy interne n'est évaluée pour un visiteur
  --
  -- ⚠️ LE CONTRÔLE EST DYNAMIQUE, ET C'EST LE SEUL QUI VAILLE. Nommer les deux
  -- policies fautives ne protégerait pas de la troisième qu'on ajouterait
  -- demain avec le rôle `{public}` par défaut. On parcourt donc TOUTES les
  -- policies de lecture applicables à `anon` sur les deux tables de la
  -- vitrine, et on refuse l'application si l'une d'elles cite une fonction
  -- interne du staff.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public'
     and tablename in ('programs', 'subscription_templates')
     and cmd = 'SELECT'
     and (roles::text = '{public}' or roles::text ~ 'anon')
     and coalesce(qual, '') ~ ('student_ids_|coach_ids_portee|categories_(lecture|ecriture)'
                               || '|est_staff_global|is_admin|program_ids_');
  if v_n <> 0 then
    raise exception 'Vitrine : % policy(ies) de lecture évaluée(s) pour anon appellent encore une fonction interne du staff — la vitrine tombera en 42501', v_n;
  end if;

  -- Les quatre policies internes de `programs` sont bornées au rôle authentifié.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'programs'
     and policyname like 'programs_manage_staff_%'
     and roles::text = '{authenticated}';
  if v_n <> 4 then
    raise exception 'Vitrine : les quatre policies internes de programs ne sont pas bornées à authenticated (% sur 4)', v_n;
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='programs'
                    and policyname='programs_select_assigned_student'
                    and roles::text = '{authenticated}'
                    and qual ~ 'published' and qual ~ 'current_student_id') then
    raise exception 'Vitrine : la policy de l''élève assigné n''est pas bornée à authenticated, ou sa règle a changé';
  end if;

  -- …et la vitrine, elle, reste une policy à part, pour `anon`, sans fonction.
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='programs'
                    and policyname='programs_select_public'
                    and roles::text = '{anon}'
                    and qual ~ 'is_public' and qual ~ 'actif') then
    raise exception 'Vitrine : la policy publique des programmes a changé de forme ou de rôle';
  end if;

  -- Le catalogue d'offres : une policy publique BORNÉE aux offres des
  -- programmes publiés, et les deux policies internes pour `authenticated`.
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='subscription_templates'
                    and policyname='subscription_templates_select_vitrine_publique'
                    and roles::text = '{anon}'
                    and qual ~ 'offres_des_programmes_publies'
                    and qual ~ 'is_active') then
    raise exception 'Vitrine : la policy publique du catalogue d''offres manque, ou n''est plus bornée aux programmes publiés';
  end if;
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'subscription_templates'
     and policyname in ('subscription_templates_select_active_or_staff',
                        'subscription_templates_manage_staff_select')
     and roles::text = '{authenticated}';
  if v_n <> 2 then
    raise exception 'Vitrine : les policies élève/staff du catalogue ne sont pas bornées à authenticated (% sur 2)', v_n;
  end if;

  -- ⚠️ ET AUCUN EXECUTE N'A ÉTÉ RENDU À `anon` SUR UNE FONCTION DU STAFF.
  -- C'est la contrainte explicite du lot : la vitrine se répare en bornant les
  -- policies, jamais en rouvrant le modèle P13-B.
  for v_n in
    select 1 from unnest(array['public.student_ids_entrainement_lecture()',
                               'public.student_ids_entrainement_ecriture()',
                               'public.coach_ids_portee()',
                               'public.categories_lecture()',
                               'public.categories_ecriture()',
                               'public.est_staff_global()',
                               'public.is_admin()',
                               'public.program_ids_lecture()',
                               'public.program_ids_ecriture()']) f
     where has_function_privilege('anon', f::regprocedure, 'EXECUTE')
  loop
    raise exception 'Vitrine : anon a récupéré l''EXECUTE d''une fonction interne du staff — interdit par ce lot';
  end loop;

  -- La fonction de la vitrine, elle, est bien accordée à anon, et durcie.
  if not exists (select 1 from pg_proc p
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'offres_des_programmes_publies'
                    and p.prosecdef
                    and p.proconfig::text ~ 'search_path') then
    raise exception 'Vitrine : offres_des_programmes_publies() manque, n''est pas SECURITY DEFINER, ou a perdu son search_path';
  end if;
  if not has_function_privilege('anon', 'public.offres_des_programmes_publies()'::regprocedure, 'EXECUTE') then
    raise exception 'Vitrine : anon ne peut pas évaluer la policy publique du catalogue — elle échouerait au lieu de répondre';
  end if;

  /*
   * ⚠️ ET LE CONTRÔLE QUI COMPTE VRAIMENT : ON EXÉCUTE LA REQUÊTE.
   *
   * Les contrôles ci-dessus lisent le TEXTE des policies. Ils n'auraient pas
   * attrapé le second saut `programs → assignments → student_ids_…`, parce que
   * la policy fautive ne citait aucune fonction interdite dans sa propre
   * clause. La requête exacte de `fetchPublicPrograms`, jouée dans le rôle
   * `anon`, est le seul contrôle qui ne puisse pas être trompé par la
   * profondeur du chemin.
   *
   * Zéro ligne est un résultat acceptable — une base sans programme publié est
   * un état normal. Ce qui est refusé, c'est que la requête LÈVE.
   */
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    perform count(*)
       from public.programs p
       left join public.subscription_templates t on t.id = p.public_subscription_template_id
      where p.is_public = true and p.status = 'actif';
    v_vitrine_ok := true;
  exception when others then
    v_vitrine_ok := false;
    v_vitrine_erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  if not v_vitrine_ok then
    raise exception 'Vitrine : la requête du catalogue public échoue encore pour un visiteur (%)', v_vitrine_erreur;
  end if;

  raise notice 'Programmes : propriété posée à la création, modèles cloisonnés par coach, publication et vente réservées à l''administrateur, vitrine publique rendue lisible à un visiteur sans rouvrir aucune fonction du staff.';
end $g$;

commit;
