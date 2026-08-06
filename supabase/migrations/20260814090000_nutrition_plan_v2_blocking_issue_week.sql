-- ============================================================================
-- feat/student-nutrition-recipes — garde serveur des SEPT JOURS
--
-- MIGRATION STRICTEMENT ADDITIVE. Elle remplace UNE fonction et rien d'autre :
--   public.nutrition_plan_v2_blocking_issue(uuid)
--
-- Aucune table, aucune colonne, aucun index, aucune policy, aucune donnée
-- n'est créé, modifié ni supprimé. Aucun `insert`, aucun `update`, aucun
-- `delete`, aucun `alter table`, aucun `drop`.
--
-- ── POURQUOI ────────────────────────────────────────────────────────────────
--
-- Depuis la refonte « semaine d'abord », un plan porte SEPT profils internes
-- (`day_monday` … `day_sunday`), un par jour. L'ancienne fonction, elle, ne
-- contrôlait qu'UN SEUL profil, choisi par la règle
-- `default` → `legacy_default` → premier par ordre alphabétique. Sur un plan
-- de la nouvelle forme, elle retenait donc `day_friday` — et un plan dont
-- lundi est incomplet mais vendredi correct passait la garde d'assignation.
--
-- L'interface, elle, valide déjà les sept jours. Cette migration remet le
-- filet serveur au niveau de l'interface : c'est la seule raison d'être du
-- fichier.
--
-- ── CE QUE LA FONCTION CONTRÔLE, POUR CHACUN DES SEPT JOURS ─────────────────
--
--   1. présence du jour                       <jour>:missing_day
--   2. présence du profile_key                <jour>:missing_profile_key
--   3. profil existant, sur LE MÊME plan      <jour>:unknown_profile
--   4. calories strictement positives         <jour>:calories_not_positive
--   5. P + G + L = 10 000 points de base      <jour>:daily_split_incomplete
--   6. les six créneaux existent              <jour>:missing_slot
--   7. au moins un créneau actif              <jour>:no_enabled_slot
--   8. aucun créneau désactivé alloué         <jour>:disabled_slot_with_allocation
--   9. somme protéines = 10 000               <jour>:protein_split_incomplete
--  10. somme glucides  = 10 000               <jour>:carb_split_incomplete
--  11. somme lipides   = 10 000               <jour>:fat_split_incomplete
--
-- ── DÉTERMINISME ────────────────────────────────────────────────────────────
--
-- Deux ordres, tous deux fixes : les jours sont parcourus de lundi à
-- dimanche, et les contrôles d'un jour sont évalués dans l'ordre ci-dessus.
-- La fonction rend donc TOUJOURS le même premier problème pour un même état
-- de la base — aucune dépendance à l'ordre physique des lignes.
--
-- Le code rendu porte le jour concerné en préfixe (`monday:…`), ce qui permet
-- à l'appelant de nommer le jour fautif sans requête supplémentaire. Le seul
-- code SANS préfixe est `missing_default_profile`, conservé à l'identique
-- pour un plan qui n'a aucun profil du tout : c'est le code historique, et
-- les messages d'erreur d'`assign_nutrition_plan` continuent de l'afficher.
--
-- ── COMPATIBILITÉ ───────────────────────────────────────────────────────────
--
-- Signature, type de retour, propriétaire, privilèges et sémantique
-- « NULL = assignable » sont INCHANGÉS. `assign_nutrition_plan`
-- (20260806090000) l'appelle sans modification.
--
-- Les plans déjà en base possèdent tous leurs sept jours : la migration
-- 20260811090000 a exécuté `nutrition_v2_backfill_plan` sur CHAQUE plan, et
-- cette fonction crée les journées manquantes. Le contrôle de présence ne
-- peut donc pas rendre non assignable un plan qui l'était.
-- ============================================================================

create or replace function public.nutrition_plan_v2_blocking_issue(p_plan_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  c_total constant integer := 10000;
  c_jours constant text[] := array[
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  ];
  v_jour text;
  v_profile_key text;
  v_trouve boolean;
  v_profil record;
  v_creneaux int;
  v_actifs int;
  v_orphelin int;
  v_somme int;
begin
  -- Garde de plan : aucun profil du tout. Code historique conservé.
  if not exists (
    select 1 from public.nutrition_plan_profiles p where p.plan_id = p_plan_id
  ) then
    return 'missing_default_profile';
  end if;

  foreach v_jour in array c_jours loop
    -- 1. présence du jour
    select d.profile_key, true
      into v_profile_key, v_trouve
      from public.nutrition_days d
     where d.plan_id = p_plan_id
       and d.day = v_jour;

    if not found then
      return v_jour || ':missing_day';
    end if;

    -- 2. présence du profile_key
    if v_profile_key is null or btrim(v_profile_key) = '' then
      return v_jour || ':missing_profile_key';
    end if;

    -- 3. profil existant, ET rattaché au MÊME plan.
    -- La clé étrangère composite (plan_id, profile_key) le garantit déjà ;
    -- on le revérifie parce qu'une garde d'assignation ne doit pas dépendre
    -- d'une contrainte pour être correcte.
    select p.id, p.daily_calories, p.protein_bp, p.carb_bp, p.fat_bp
      into v_profil
      from public.nutrition_plan_profiles p
     where p.plan_id = p_plan_id
       and p.profile_key = v_profile_key;

    if not found then
      return v_jour || ':unknown_profile';
    end if;

    -- 4. calories
    if v_profil.daily_calories is null or v_profil.daily_calories <= 0 then
      return v_jour || ':calories_not_positive';
    end if;

    -- 5. répartition P/G/L de la journée
    if coalesce(v_profil.protein_bp, 0) + coalesce(v_profil.carb_bp, 0)
       + coalesce(v_profil.fat_bp, 0) <> c_total then
      return v_jour || ':daily_split_incomplete';
    end if;

    -- 6. les six créneaux sont matérialisés
    select count(*) into v_creneaux
      from public.nutrition_meal_slot_targets s
     where s.profile_id = v_profil.id;

    if v_creneaux <> 6 then
      return v_jour || ':missing_slot';
    end if;

    -- 7. au moins un créneau actif
    select count(*) into v_actifs
      from public.nutrition_meal_slot_targets s
     where s.profile_id = v_profil.id and s.enabled;

    if v_actifs = 0 then
      return v_jour || ':no_enabled_slot';
    end if;

    -- 8. aucun créneau désactivé ne conserve d'allocation
    select count(*) into v_orphelin
      from public.nutrition_meal_slot_targets s
     where s.profile_id = v_profil.id
       and not s.enabled
       and (coalesce(s.protein_bp, 0) <> 0 or coalesce(s.carb_bp, 0) <> 0
            or coalesce(s.fat_bp, 0) <> 0);

    if v_orphelin > 0 then
      return v_jour || ':disabled_slot_with_allocation';
    end if;

    -- 9 à 11. chaque macro totalise 10 000 points de base sur les créneaux
    select coalesce(sum(s.protein_bp), 0) into v_somme
      from public.nutrition_meal_slot_targets s where s.profile_id = v_profil.id;
    if v_somme <> c_total then
      return v_jour || ':protein_split_incomplete';
    end if;

    select coalesce(sum(s.carb_bp), 0) into v_somme
      from public.nutrition_meal_slot_targets s where s.profile_id = v_profil.id;
    if v_somme <> c_total then
      return v_jour || ':carb_split_incomplete';
    end if;

    select coalesce(sum(s.fat_bp), 0) into v_somme
      from public.nutrition_meal_slot_targets s where s.profile_id = v_profil.id;
    if v_somme <> c_total then
      return v_jour || ':fat_split_incomplete';
    end if;
  end loop;

  -- Les sept jours sont complets : le plan est assignable.
  return null;
end;
$fn$;

alter function public.nutrition_plan_v2_blocking_issue(uuid) owner to postgres;

comment on function public.nutrition_plan_v2_blocking_issue(uuid) is
  'Miroir SQL de la validation d''assignabilité. Retourne NULL si le plan v2 est assignable, sinon « <jour>:<code> » du PREMIER problème rencontré, les sept jours étant parcourus de lundi à dimanche et chaque jour contrôlé dans un ordre fixe. Un plan sans aucun profil rend le code historique missing_default_profile. Fonction de lecture, security invoker, search_path vide.';

revoke all on function public.nutrition_plan_v2_blocking_issue(uuid) from public;
revoke execute on function public.nutrition_plan_v2_blocking_issue(uuid) from anon;
grant execute on function public.nutrition_plan_v2_blocking_issue(uuid) to authenticated;
