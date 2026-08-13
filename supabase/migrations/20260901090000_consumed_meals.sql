-- ============================================================================
-- Migration 20260901090000 — ALIMENTS A2, LA CONSOMMATION PAR REPAS.
-- (chantier feat/aliments-a2)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE TABLE CONTENEUR
-- ────────────────────────────────────────────────────────────────────────────
-- `meal_entries` (A1) sait dire « 120 g de banane le 13/08 ». Elle ne sait pas
-- dire À QUEL REPAS. Trois raisons, mesurées sur la base réelle le 13/08/2026 :
--
--   1. `slot_key` est un vocabulaire FERMÉ de six valeurs v2. Deux collations
--      libres le même jour tombent dans le même couple (date, slot_key) :
--      « Collation #1 » et « Collation #2 » sont INEXPRIMABLES. Et
--      « Restaurant » n'est aucune des six valeurs ;
--
--   2. un repas élève a un NOM, et `meal_entries.label` est déjà le libellé de
--      l'ALIMENT, gelé par la règle d'instantané ;
--
--   3. la prescription N'A AUCUNE DATE. `nutrition_days.week_start_date` est
--      NULL sur 70 lignes sur 70 : un jour prescrit est un JOUR-TYPE de semaine
--      (`day` = 'monday'…), répété indéfiniment. Rattacher une consommation
--      datée à son repas prescrit par dérivation demanderait six sauts, dont
--      trois instables :
--        - `assign_nutrition_plan` réaffecte : une journée de juillet se
--          recalculerait contre le plan d'août ;
--        - `save_nutrition_plan_v2` fait DELETE + INSERT des `meals` : les
--          identifiants changent à chaque édition du coach ;
--        - il n'existe AUCUNE contrainte UNIQUE sur `meals (nutrition_day_id,
--          slot)`. Zéro doublon aujourd'hui (240 repas, 64 jours), mais le
--          schéma en autorise — et la dérivation deviendrait ambiguë EN
--          SILENCE le jour où il y en aura.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
--   A. `public.consumed_meals`      — le repas RÉELLEMENT mangé, prescrit ou
--      créé par l'élève, avec l'instantané de la cible coach ;
--   B. `meal_entries` rattachée au conteneur, et DÉLESTÉE de `consumed_on` /
--      `slot_key` qui deviendraient une seconde source de vérité ;
--   C. huit RPC `security definer` — le SEUL chemin d'écriture ;
--   D. RLS, et surtout le RETRAIT des privilèges d'écriture directs : sans
--      lui, PostgREST resterait un contournement de tout le calcul serveur ;
--   E. `public.consommation_du_jour(date)` — l'agrégat, pour ne jamais
--      recalculer un total dans deux endroits différents.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUNE écriture dans `meals`, `nutrition_days`, `nutrition_plans`,
--     `nutrition_plan_profiles` ni `nutrition_meal_slot_targets`. Le plan du
--     coach est en LECTURE SEULE pour tout ce lot ;
--   - AUCUNE modification de `nutrition_daily_logs`. Pas de double écriture,
--     pas de synchronisation : la convergence est un lot à part ;
--   - AUCUNE table `food_products`, aucun GTIN, aucun scanner, aucun appel
--     réseau, aucune extension ;
--   - AUCUN `food_id` sur `nutrition_recipe_ingredients` ;
--   - AUCUNE notion ON/OFF de journée. Elle n'existe pas, on ne l'invente pas ;
--   - AUCUNE conversion ml ↔ g. `food_catalog` ne porte pas de densité, et
--     inventer un facteur créerait une seconde convention nutritionnelle.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. `consumed_meals` — le repas réellement mangé
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.consumed_meals (
  id uuid primary key default gen_random_uuid(),

  student_id uuid not null references public.students (id) on delete cascade,
  consumed_on date not null,

  kind text not null,

  -- Pointeur de PROVENANCE vers la prescription, jamais d'autorité. `set null`
  -- pour la même raison qu'en A1 : le coach peut supprimer son plan, la
  -- journée consommée reste exacte.
  prescribed_meal_id uuid references public.meals (id) on delete set null,
  slot_key text,

  label text not null,
  position integer not null default 0,

  -- ── L'INSTANTANÉ DE LA CIBLE COACH ────────────────────────────────────
  -- Figé à l'OUVERTURE du repas. Deux sources possibles côté écran
  -- (components/student/StudentPrescribedWeek.tsx) : les macros tapées à la
  -- main dans `meals.macros` si le coach en a mis, sinon la part du créneau
  -- dérivée du profil du jour. AUCUNE des deux n'est rejouable plus tard :
  -- `save_nutrition_plan_v2` supprime et recrée les repas, et les 420
  -- `nutrition_meal_slot_targets` bougent avec le profil. Sans instantané,
  -- une journée d'il y a trois mois afficherait « objectif : — ».
  --
  -- Conséquence VOULUE : si le coach change sa cible après que l'élève a
  -- ouvert le repas, l'élève garde l'ancienne pour CE jour-là. L'objectif
  -- d'une journée écoulée ne se réécrit pas.
  target_kcal numeric,
  target_protein_g numeric,
  target_carb_g numeric,
  target_fat_g numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint consumed_meals_kind_check
    check (kind in ('prescribed', 'student')),
  constraint consumed_meals_label_not_blank
    check (length(btrim(label)) > 0),
  constraint consumed_meals_slot_key_check
    check (slot_key is null or slot_key in
      ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'dessert')),
  constraint consumed_meals_targets_non_negative
    check (coalesce(target_kcal, 0) >= 0 and coalesce(target_protein_g, 0) >= 0
       and coalesce(target_carb_g, 0) >= 0 and coalesce(target_fat_g, 0) >= 0),

  -- État impossible, écrit dans le sens qui SURVIT à `on delete set null` :
  -- on interdit un pointeur incohérent, on n'exige pas un pointeur présent.
  -- L'implication inverse rendrait la suppression d'un plan impossible.
  constraint consumed_meals_prescribed_pointer_coherent
    check (prescribed_meal_id is null or kind = 'prescribed'),

  -- Un repas ÉLÈVE ne porte JAMAIS de cible coach. Il n'en existe pas.
  constraint consumed_meals_student_has_no_target
    check (kind <> 'student' or (target_kcal is null and target_protein_g is null
       and target_carb_g is null and target_fat_g is null)),

  -- Support de la clé étrangère composite posée sur meal_entries : elle
  -- garantit STRUCTURELLEMENT qu'une entrée et son conteneur appartiennent au
  -- même élève. Sans elle, `meal_entries.student_id` serait une seconde
  -- source de vérité qu'un chemin d'écriture pourrait désynchroniser.
  constraint consumed_meals_id_student_unique unique (id, student_id)
);

-- UN SEUL conteneur par repas prescrit et par date. C'est cette contrainte qui
-- rend `ouvrir_repas_prescrit` idempotente face à deux appels concurrents :
-- le second perd la course et relit celui du premier.
create unique index if not exists consumed_meals_prescribed_unique
  on public.consumed_meals (student_id, consumed_on, prescribed_meal_id)
  where prescribed_meal_id is not null;

create index if not exists consumed_meals_student_date_idx
  on public.consumed_meals (student_id, consumed_on, position);

comment on table public.consumed_meals is
  'Repas RÉELLEMENT mangé. kind = prescribed (ouvert depuis un repas du plan, cible coach figée) | student (créé par l''élève, sans aucune cible). Distincte de `meals`, qui est la PRESCRIPTION : ce lot n''écrit jamais dans le plan du coach.';
comment on column public.consumed_meals.prescribed_meal_id is
  'Pointeur de provenance vers meals(id), jamais d''autorité. on delete set null : le coach peut supprimer son plan, la journée consommée reste exacte et garde son instantané de cible.';
comment on column public.consumed_meals.target_kcal is
  'Instantané de la cible coach, figé à l''ouverture du repas. NULL pour un repas élève — il n''a pas de cible, et la contrainte consumed_meals_student_has_no_target l''interdit. Les kcal sont ici STOCKÉES parce qu''elles viennent parfois d''une saisie coach directe (meals.macros.calories) qui n''est pas forcément le 4/4/9 de ses propres macros : les recalculer trahirait ce qu''il a écrit.';
comment on constraint consumed_meals_id_student_unique on public.consumed_meals is
  'Support de la clé étrangère composite de meal_entries : une entrée ne peut structurellement pas appartenir au conteneur d''un autre élève.';

-- ────────────────────────────────────────────────────────────────────────────
-- B. `meal_entries` — rattachée au conteneur, délestée du reste
-- ────────────────────────────────────────────────────────────────────────────
-- `consumed_on` et `slot_key` sont RETIRÉES. Une fois le conteneur posé, elles
-- seraient une seconde source de vérité : rien n'empêcherait une entrée datée
-- du 13 d'être rattachée à un repas du 14. La table contient 0 ligne en
-- Production (vérifié le 13/08/2026) : c'est maintenant, ou jamais.
alter table public.meal_entries
  add column if not exists consumed_meal_id uuid;

-- La colonne est posée nullable puis passée NOT NULL : sur une table vide
-- c'est équivalent, et ça rend la migration rejouable sur une base qui
-- aurait déjà la colonne.
alter table public.meal_entries
  alter column consumed_meal_id set not null;

-- Clé étrangère COMPOSITE : le conteneur ET l'élève. Une entrée ne peut donc
-- pas appartenir au repas d'un autre élève — la base le refuse, ce n'est pas
-- une règle applicative.
alter table public.meal_entries
  drop constraint if exists meal_entries_consumed_meal_same_student;
alter table public.meal_entries
  add constraint meal_entries_consumed_meal_same_student
  foreign key (consumed_meal_id, student_id)
  references public.consumed_meals (id, student_id)
  on delete cascade;

drop index if exists public.meal_entries_student_date_idx;
alter table public.meal_entries drop column if exists consumed_on;
alter table public.meal_entries drop column if exists slot_key;

create index if not exists meal_entries_consumed_meal_idx
  on public.meal_entries (consumed_meal_id);

comment on column public.meal_entries.consumed_meal_id is
  'Le repas auquel cette consommation appartient. NOT NULL : une entrée sans repas n''a pas de sens, et la table était vide au moment de la migration. La clé étrangère est COMPOSITE (avec student_id) — un élève ne peut pas rattacher une entrée au repas d''un autre.';

-- ────────────────────────────────────────────────────────────────────────────
-- C. Le calcul — une seule fonction, partagée par tous les chemins d'écriture
-- ────────────────────────────────────────────────────────────────────────────
-- Quantité + unité → grammes (ou millilitres) de la base nutritionnelle.
--
-- AUCUNE CONVERSION ml ↔ g. `food_catalog` ne porte pas de densité, et
-- inventer un facteur (« 1 ml ≈ 1 g ») créerait une seconde convention
-- nutritionnelle à côté du 4/4/9. Une unité qui ne correspond pas à celle de
-- l'aliment est REFUSÉE, franchement.
create or replace function public.quantite_en_base_nutritionnelle(
  p_quantity numeric,
  p_unit text,
  p_nutrition_unit text,
  p_piece_weight_g numeric
) returns numeric
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'QUANTITE_INVALIDE' using errcode = '22023';
  end if;

  -- L'unité de saisie est celle de l'aliment : rien à convertir.
  if p_unit = p_nutrition_unit then
    return p_quantity;
  end if;

  -- La pièce n'est proposable que si l'aliment dit ce qu'elle pèse. Pas
  -- d'estimation cachée : une banane sans piece_weight_g n'a pas de pièce.
  if p_unit = 'piece' then
    if p_nutrition_unit <> 'g' then
      raise exception 'PIECE_UNIQUEMENT_EN_GRAMMES' using errcode = '22023';
    end if;
    if p_piece_weight_g is null then
      raise exception 'PIECE_SANS_POIDS' using errcode = '22023';
    end if;
    return p_quantity * p_piece_weight_g;
  end if;

  raise exception 'UNITE_INCOMPATIBLE' using errcode = '22023';
end;
$fn$;

alter function public.quantite_en_base_nutritionnelle(numeric, text, text, numeric) owner to postgres;

comment on function public.quantite_en_base_nutritionnelle(numeric, text, text, numeric) is
  'Quantité saisie → quantité dans l''unité nutritionnelle de l''aliment. Accepte l''unité de l''aliment telle quelle, et la pièce UNIQUEMENT si piece_weight_g est renseigné. Refuse tout le reste : aucune conversion ml ↔ g n''est inventée, food_catalog ne porte pas de densité.';

revoke all on function public.quantite_en_base_nutritionnelle(numeric, text, text, numeric) from public;
revoke execute on function public.quantite_en_base_nutritionnelle(numeric, text, text, numeric) from anon;
grant execute on function public.quantite_en_base_nutritionnelle(numeric, text, text, numeric) to authenticated, service_role;

-- ── Le conteneur appartient-il à l'appelant ? ─────────────────────────────
create or replace function public.consumed_meal_de_l_eleve(p_consumed_meal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.consumed_meals m
     where m.id = p_consumed_meal_id
       and m.student_id = public.current_student_id()
  );
$$;

alter function public.consumed_meal_de_l_eleve(uuid) owner to postgres;
comment on function public.consumed_meal_de_l_eleve(uuid) is
  'Vrai si ce repas consommé appartient à l''élève connecté. security definer parce que la RLS de consumed_meals filtrerait un invoker et répondrait faux pour de mauvaises raisons.';
revoke all on function public.consumed_meal_de_l_eleve(uuid) from public;
revoke execute on function public.consumed_meal_de_l_eleve(uuid) from anon;
grant execute on function public.consumed_meal_de_l_eleve(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- D. Les RPC — le SEUL chemin d'écriture
-- ────────────────────────────────────────────────────────────────────────────
-- Toutes en `security definer`, toutes résolvant l'élève par
-- `current_student_id()` et JAMAIS par un identifiant reçu du client. C'est la
-- leçon du correctif de ciblage Push du 09/08/2026 : ne jamais faire confiance
-- à un id arbitraire envoyé depuis le navigateur.

-- ── D.1 Ouvrir un repas PRESCRIT pour une date ────────────────────────────
create or replace function public.ouvrir_repas_prescrit(
  p_meal_id uuid,
  p_consumed_on date
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
  v_existant uuid;
  v_meal record;
  v_part record;
  v_part_trouvee boolean;
  v_saisi boolean;
  v_position integer := 0;
  v_kcal numeric;
  v_prot numeric;
  v_gluc numeric;
  v_lip numeric;
  v_id uuid;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;
  if p_consumed_on is null then
    raise exception 'DATE_MANQUANTE' using errcode = '22023';
  end if;

  -- Le repas doit appartenir à un plan RÉELLEMENT ASSIGNÉ à cet élève. C'est
  -- ce contrôle, et lui seul, qui empêche de fabriquer un faux repas prescrit
  -- à partir du plan d'un autre.
  select m.id, m.slot, m.name, m.macros, d.profile_key, p.id as plan_id
    into v_meal
    from public.meals m
    join public.nutrition_days d on d.id = m.nutrition_day_id
    join public.nutrition_plans p on p.id = d.plan_id
   where m.id = p_meal_id
     and p.student_id = v_student;

  if not found then
    raise exception 'REPAS_PRESCRIT_INACCESSIBLE' using errcode = '42501';
  end if;

  select id into v_existant
    from public.consumed_meals
   where student_id = v_student
     and consumed_on = p_consumed_on
     and prescribed_meal_id = p_meal_id;
  if v_existant is not null then
    return v_existant;
  end if;

  -- ── L'INSTANTANÉ DE LA CIBLE ──────────────────────────────────────────
  -- Règle IDENTIQUE à celle de l'écran (components/student/
  -- StudentPrescribedWeek.tsx) : les macros tapées par le coach priment ; à
  -- défaut, la part du créneau dérivée du profil du jour.
  v_saisi := coalesce((v_meal.macros->>'calories')::numeric, 0) > 0
          or coalesce((v_meal.macros->>'protein')::numeric, 0)
           + coalesce((v_meal.macros->>'carbs')::numeric, 0)
           + coalesce((v_meal.macros->>'fat')::numeric, 0) > 0;

  -- La part du créneau, MIROIR EXACT de computeDailyMacroTargets puis
  -- computeMealDistribution (lib/nutrition/macro-targets.ts et
  -- meal-distribution.ts). Deux étages de points de base, et surtout PAS UN
  -- SEUL : les points du profil découpent les calories du jour en grammes de
  -- chaque macro, puis les points du créneau découpent CES GRAMMES.
  --
  --   grammes_jour   = daily_calories × profil.<macro>_bp / 10000 ÷ kcal_par_g
  --   grammes_créneau= grammes_jour   × créneau.<macro>_bp / 10000
  --   kcal_créneau   = 4·P + 4·G + 9·L  (jamais une somme de bp)
  --
  -- Appliquer les points du créneau directement aux calories du jour
  -- rendrait des valeurs différentes de celles affichées à l'élève : ce
  -- serait une seconde convention nutritionnelle. AUCUN arrondi non plus —
  -- le moteur n'en fait pas, il n'arrondit qu'à l'affichage.
  --
  -- `t.enabled` est exigé : `slotMacrosForDay` rend `null` pour un créneau
  -- désactivé. Un créneau désactivé n'a PAS d'objectif ; il n'en a pas zéro.
  select t.display_order,
         pr.daily_calories * pr.protein_bp / 10000.0 / 4 * t.protein_bp / 10000.0 as prot,
         pr.daily_calories * pr.carb_bp    / 10000.0 / 4 * t.carb_bp    / 10000.0 as gluc,
         pr.daily_calories * pr.fat_bp     / 10000.0 / 9 * t.fat_bp     / 10000.0 as lip
    into v_part
    from public.nutrition_plan_profiles pr
    join public.nutrition_meal_slot_targets t
      on t.profile_id = pr.id and t.slot = v_meal.slot and t.enabled
   where pr.plan_id = v_meal.plan_id
     and pr.profile_key = v_meal.profile_key;

  -- FOUND est réécrit par toute instruction SQL suivante : on le fige tout
  -- de suite dans une variable, plutôt que de le relire plus bas.
  v_part_trouvee := found;
  if v_part_trouvee then
    v_position := v_part.display_order;
  else
    -- Pas de part réglée pour ce créneau (désactivé, ou profil incomplet) :
    -- on retombe sur l'ORDRE CANONIQUE des six créneaux, jamais sur 0 — sinon
    -- un dîner sans part s'afficherait avant le petit-déjeuner.
    v_position := coalesce(array_position(
      array['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'dessert'],
      v_meal.slot), 0);
  end if;

  if v_saisi then
    v_kcal := (v_meal.macros->>'calories')::numeric;
    v_prot := (v_meal.macros->>'protein')::numeric;
    v_gluc := (v_meal.macros->>'carbs')::numeric;
    v_lip  := (v_meal.macros->>'fat')::numeric;
  elsif v_part_trouvee then
    v_prot := v_part.prot;
    v_gluc := v_part.gluc;
    v_lip  := v_part.lip;
    v_kcal := v_prot * 4 + v_gluc * 4 + v_lip * 9;
  end if;
  -- Sinon : les quatre restent NULL. Le repas s'ouvre quand même — l'élève
  -- doit pouvoir saisir ce qu'il a mangé même si le coach n'a pas réglé la
  -- part de ce créneau. L'écran affiche « pas d'objectif », pas « 0 ».

  insert into public.consumed_meals (
    student_id, consumed_on, kind, prescribed_meal_id, slot_key, label, position,
    target_kcal, target_protein_g, target_carb_g, target_fat_g
  ) values (
    v_student, p_consumed_on, 'prescribed', p_meal_id, v_meal.slot,
    coalesce(nullif(btrim(coalesce(v_meal.name, '')), ''), v_meal.slot),
    v_position, v_kcal, v_prot, v_gluc, v_lip
  )
  returning id into v_id;

  return v_id;
exception when unique_violation then
  -- Course perdue : l'autre appel a créé le conteneur, on relit le sien.
  select id into v_id from public.consumed_meals
   where student_id = v_student and consumed_on = p_consumed_on
     and prescribed_meal_id = p_meal_id;
  return v_id;
end;
$fn$;

alter function public.ouvrir_repas_prescrit(uuid, date) owner to postgres;
comment on function public.ouvrir_repas_prescrit(uuid, date) is
  'Obtient ou crée le conteneur de consommation d''un repas PRESCRIT pour une date. L''élève vient de current_student_id(), jamais d''un paramètre. Refuse un repas qui n''appartient pas à un plan assigné à cet élève. Idempotente : la contrainte unique partielle sert d''arbitre en cas d''appels concurrents. N''écrit JAMAIS dans meals ni dans le plan.';
revoke all on function public.ouvrir_repas_prescrit(uuid, date) from public;
revoke execute on function public.ouvrir_repas_prescrit(uuid, date) from anon;
grant execute on function public.ouvrir_repas_prescrit(uuid, date) to authenticated, service_role;

-- ── D.2 Créer un repas ÉLÈVE ──────────────────────────────────────────────
create or replace function public.creer_repas_eleve(
  p_consumed_on date,
  p_label text,
  p_slot_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
  v_id uuid;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;
  if p_consumed_on is null or length(btrim(coalesce(p_label, ''))) = 0 then
    raise exception 'REPAS_INVALIDE' using errcode = '22023';
  end if;

  insert into public.consumed_meals (
    student_id, consumed_on, kind, prescribed_meal_id, slot_key, label, position
  ) values (
    v_student, p_consumed_on, 'student', null, p_slot_key, btrim(p_label),
    -- BANDE SÉPARÉE, à partir de 1000. Les repas prescrits occupent le
    -- `display_order` du coach (0…999, borné par
    -- nutrition_meal_slot_targets_display_order_range) : compter à partir du
    -- maximum du jour ferait dépendre la place d'une collation de l'ordre
    -- dans lequel l'élève a ouvert ses repas prescrits, qui le sont
    -- PARESSEUSEMENT. Un repas libre se range toujours après le plan.
    coalesce((select max(position) + 1 from public.consumed_meals
               where student_id = v_student and consumed_on = p_consumed_on
                 and kind = 'student'), 1000)
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

alter function public.creer_repas_eleve(date, text, text) owner to postgres;
comment on function public.creer_repas_eleve(date, text, text) is
  'Crée un repas libre de l''élève. Aucune cible coach n''est écrite — la contrainte consumed_meals_student_has_no_target l''interdirait de toute façon. Deux collations le même jour sont deux lignes distinctes : c''est tout l''objet du conteneur.';
revoke all on function public.creer_repas_eleve(date, text, text) from public;
revoke execute on function public.creer_repas_eleve(date, text, text) from anon;
grant execute on function public.creer_repas_eleve(date, text, text) to authenticated, service_role;

-- ── D.3 Renommer / D.4 Supprimer un repas ÉLÈVE ───────────────────────────
-- Un repas PRESCRIT n'est ni renommable ni supprimable : le `kind = 'student'`
-- de la clause where n'est pas décoratif, c'est la règle produit.
create or replace function public.renommer_repas_eleve(
  p_consumed_meal_id uuid,
  p_label text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_touche int;
begin
  if length(btrim(coalesce(p_label, ''))) = 0 then
    raise exception 'LIBELLE_VIDE' using errcode = '22023';
  end if;
  update public.consumed_meals
     set label = btrim(p_label)
   where id = p_consumed_meal_id
     and student_id = public.current_student_id()
     and kind = 'student';
  get diagnostics v_touche = row_count;
  if v_touche = 0 then
    raise exception 'REPAS_NON_MODIFIABLE' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function public.supprimer_repas_eleve(p_consumed_meal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_touche int;
begin
  -- Les entrées partent avec, par la CASCADE de la clé étrangère composite.
  delete from public.consumed_meals
   where id = p_consumed_meal_id
     and student_id = public.current_student_id()
     and kind = 'student';
  get diagnostics v_touche = row_count;
  if v_touche = 0 then
    raise exception 'REPAS_NON_SUPPRIMABLE' using errcode = '42501';
  end if;
end;
$fn$;

alter function public.renommer_repas_eleve(uuid, text) owner to postgres;
alter function public.supprimer_repas_eleve(uuid) owner to postgres;
comment on function public.supprimer_repas_eleve(uuid) is
  'Supprime un repas LIBRE de l''élève et ses entrées (cascade). Un repas prescrit est structurellement hors d''atteinte : la clause where exige kind = ''student''.';
revoke all on function public.renommer_repas_eleve(uuid, text) from public;
revoke execute on function public.renommer_repas_eleve(uuid, text) from anon;
grant execute on function public.renommer_repas_eleve(uuid, text) to authenticated, service_role;
revoke all on function public.supprimer_repas_eleve(uuid) from public;
revoke execute on function public.supprimer_repas_eleve(uuid) from anon;
grant execute on function public.supprimer_repas_eleve(uuid) to authenticated, service_role;

-- ── D.5 Ajouter un aliment du CATALOGUE ───────────────────────────────────
-- LE POINT CENTRAL DE A2. Le client envoie (repas, aliment, quantité, unité).
-- Il n'envoie JAMAIS de macros — et il ne le peut plus, puisque le privilège
-- d'écriture directe sur meal_entries lui est retiré en section E.
create or replace function public.ajouter_aliment_catalogue(
  p_consumed_meal_id uuid,
  p_food_id uuid,
  p_quantity numeric,
  p_unit text
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
  v_food record;
  v_base numeric;
  v_id uuid;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;

  if not exists (select 1 from public.consumed_meals m
                  where m.id = p_consumed_meal_id and m.student_id = v_student) then
    raise exception 'REPAS_INACCESSIBLE' using errcode = '42501';
  end if;

  -- L'aliment doit être LISIBLE par cet élève : le catalogue global, et rien
  -- d'autre. Un aliment privé de coach ou archivé est refusé.
  select f.id, f.name, f.nutrition_unit, f.piece_weight_g,
         f.protein_per_100, f.carb_per_100, f.fat_per_100
    into v_food
    from public.food_catalog f
   where f.id = p_food_id
     and f.owner_coach_id is null
     and f.status = 'active';
  if not found then
    raise exception 'ALIMENT_INACCESSIBLE' using errcode = '42501';
  end if;

  v_base := public.quantite_en_base_nutritionnelle(
    p_quantity, p_unit, v_food.nutrition_unit, v_food.piece_weight_g);

  insert into public.meal_entries (
    student_id, consumed_meal_id, source_type, food_id,
    label, quantity, unit, protein_g, carb_g, fat_g
  ) values (
    v_student, p_consumed_meal_id, 'catalog_food', v_food.id,
    v_food.name, p_quantity, p_unit,
    round(v_base * v_food.protein_per_100 / 100, 4),
    round(v_base * v_food.carb_per_100 / 100, 4),
    round(v_base * v_food.fat_per_100 / 100, 4)
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

alter function public.ajouter_aliment_catalogue(uuid, uuid, numeric, text) owner to postgres;
comment on function public.ajouter_aliment_catalogue(uuid, uuid, numeric, text) is
  'Ajoute un aliment du catalogue GLOBAL à un repas de l''élève. Le client n''envoie AUCUNE macro : le serveur charge food_catalog, convertit la quantité et calcule l''instantané. Refuse un aliment privé, archivé, ou une unité incompatible.';
revoke all on function public.ajouter_aliment_catalogue(uuid, uuid, numeric, text) from public;
revoke execute on function public.ajouter_aliment_catalogue(uuid, uuid, numeric, text) from anon;
grant execute on function public.ajouter_aliment_catalogue(uuid, uuid, numeric, text) to authenticated, service_role;

-- ── D.6 Ajouter un aliment MANUEL ─────────────────────────────────────────
-- Le catalogue est vide (0 ligne au 13/08/2026) : sans ce chemin, A2 sortirait
-- avec une recherche qui ne rend rien. L'élève saisit les valeurs POUR 100
-- lues sur l'emballage — jamais le résultat. Le serveur multiplie et fige.
--
-- Un aliment manuel ne devient JAMAIS un food_catalog global : `food_id` reste
-- NULL et la contrainte meal_entries_food_id_coherent d'A1 l'interdit.
create or replace function public.ajouter_aliment_manuel(
  p_consumed_meal_id uuid,
  p_label text,
  p_quantity numeric,
  p_unit text,
  p_protein_per_100 numeric,
  p_carb_per_100 numeric,
  p_fat_per_100 numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
  v_id uuid;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;
  if not exists (select 1 from public.consumed_meals m
                  where m.id = p_consumed_meal_id and m.student_id = v_student) then
    raise exception 'REPAS_INACCESSIBLE' using errcode = '42501';
  end if;
  if p_unit not in ('g', 'ml') then
    raise exception 'UNITE_INCOMPATIBLE' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'QUANTITE_INVALIDE' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_label, ''))) = 0 then
    raise exception 'LIBELLE_VIDE' using errcode = '22023';
  end if;
  if coalesce(p_protein_per_100, -1) < 0 or coalesce(p_carb_per_100, -1) < 0
     or coalesce(p_fat_per_100, -1) < 0 then
    raise exception 'MACROS_INVALIDES' using errcode = '22023';
  end if;

  insert into public.meal_entries (
    student_id, consumed_meal_id, source_type, food_id,
    label, quantity, unit, protein_g, carb_g, fat_g
  ) values (
    v_student, p_consumed_meal_id, 'free', null,
    btrim(p_label), p_quantity, p_unit,
    round(p_quantity * p_protein_per_100 / 100, 4),
    round(p_quantity * p_carb_per_100 / 100, 4),
    round(p_quantity * p_fat_per_100 / 100, 4)
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

alter function public.ajouter_aliment_manuel(uuid, text, numeric, text, numeric, numeric, numeric) owner to postgres;
comment on function public.ajouter_aliment_manuel(uuid, text, numeric, text, numeric, numeric, numeric) is
  'Ajoute un aliment SAISI À LA MAIN (source_type = free). L''élève fournit les valeurs POUR 100 g/ml lues sur l''emballage ; le serveur multiplie par la quantité et fige l''instantané — le client ne dicte jamais le résultat. Ne crée AUCUNE entrée dans food_catalog.';
revoke all on function public.ajouter_aliment_manuel(uuid, text, numeric, text, numeric, numeric, numeric) from public;
revoke execute on function public.ajouter_aliment_manuel(uuid, text, numeric, text, numeric, numeric, numeric) from anon;
grant execute on function public.ajouter_aliment_manuel(uuid, text, numeric, text, numeric, numeric, numeric) to authenticated, service_role;

-- ── D.7 Modifier la quantité — le serveur RECHARGE et RECALCULE ───────────
-- Contrat A1 : l'instantané ne suit pas sa source, mais une correction
-- volontaire écrit un NOUVEL instantané, calculé depuis la source ACTUELLE.
create or replace function public.modifier_quantite_entree(
  p_entry_id uuid,
  p_quantity numeric,
  p_unit text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_student uuid;
  v_entree record;
  v_food record;
  v_base numeric;
begin
  v_student := public.current_student_id();
  select e.id, e.source_type, e.food_id, e.protein_g, e.carb_g, e.fat_g, e.quantity
    into v_entree
    from public.meal_entries e
   where e.id = p_entry_id and e.student_id = v_student;
  if not found then
    raise exception 'ENTREE_INACCESSIBLE' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'QUANTITE_INVALIDE' using errcode = '22023';
  end if;

  if v_entree.source_type = 'catalog_food' then
    select f.nutrition_unit, f.piece_weight_g,
           f.protein_per_100, f.carb_per_100, f.fat_per_100, f.name
      into v_food
      from public.food_catalog f
     where f.id = v_entree.food_id and f.owner_coach_id is null and f.status = 'active';
    if not found then
      -- L'aliment a disparu ou a été archivé : on ne devine pas, on refuse.
      raise exception 'ALIMENT_INACCESSIBLE' using errcode = '42501';
    end if;
    v_base := public.quantite_en_base_nutritionnelle(
      p_quantity, p_unit, v_food.nutrition_unit, v_food.piece_weight_g);
    update public.meal_entries
       set quantity = p_quantity, unit = p_unit, label = v_food.name,
           protein_g = round(v_base * v_food.protein_per_100 / 100, 4),
           carb_g    = round(v_base * v_food.carb_per_100 / 100, 4),
           fat_g     = round(v_base * v_food.fat_per_100 / 100, 4)
     where id = p_entry_id;
  else
    -- Aliment manuel : la référence pour 100 est celle de l'entrée elle-même,
    -- reconstituée depuis l'instantané précédent. Aucune source externe
    -- n'existe, et le client n'en fournit pas de nouvelle ici.
    if v_entree.quantity is null or v_entree.quantity <= 0 then
      raise exception 'ENTREE_SANS_REFERENCE' using errcode = '22023';
    end if;
    if p_unit <> (select unit from public.meal_entries where id = p_entry_id) then
      raise exception 'UNITE_INCOMPATIBLE' using errcode = '22023';
    end if;
    update public.meal_entries
       set quantity = p_quantity,
           protein_g = round(v_entree.protein_g / v_entree.quantity * p_quantity, 4),
           carb_g    = round(v_entree.carb_g    / v_entree.quantity * p_quantity, 4),
           fat_g     = round(v_entree.fat_g     / v_entree.quantity * p_quantity, 4)
     where id = p_entry_id;
  end if;
end;
$fn$;

create or replace function public.supprimer_entree(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_touche int;
begin
  delete from public.meal_entries
   where id = p_entry_id and student_id = public.current_student_id();
  get diagnostics v_touche = row_count;
  if v_touche = 0 then
    raise exception 'ENTREE_INACCESSIBLE' using errcode = '42501';
  end if;
end;
$fn$;

alter function public.modifier_quantite_entree(uuid, numeric, text) owner to postgres;
alter function public.supprimer_entree(uuid) owner to postgres;
comment on function public.modifier_quantite_entree(uuid, numeric, text) is
  'Corrige la quantité d''une entrée. Pour un aliment du catalogue, le serveur RECHARGE food_catalog et recalcule tout : le nouvel instantané reflète la source au moment de la correction. Pour un aliment manuel, la référence est l''instantané précédent ramené à la nouvelle quantité — aucune source externe n''existe.';
revoke all on function public.modifier_quantite_entree(uuid, numeric, text) from public;
revoke execute on function public.modifier_quantite_entree(uuid, numeric, text) from anon;
grant execute on function public.modifier_quantite_entree(uuid, numeric, text) to authenticated, service_role;
revoke all on function public.supprimer_entree(uuid) from public;
revoke execute on function public.supprimer_entree(uuid) from anon;
grant execute on function public.supprimer_entree(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- E. L'agrégat — une seule définition du total
-- ────────────────────────────────────────────────────────────────────────────
-- Le total du jour est la SOMME des meal_entries, repas prescrits ET repas
-- élèves confondus. Il n'est jamais dérivé du texte du coach.
--
-- ── POURQUOI L'ÉLÈVE EST UN PARAMÈTRE, ET NON « CE QUE LA RLS LAISSE VOIR »
-- Première version : `where m.consumed_on = p_consumed_on`, sans autre
-- filtre, en comptant sur la RLS. Pour un élève c'est juste — il ne voit que
-- ses lignes. MESURÉ pour un coach : la policy meal_entries_select_own_coach
-- lui montre les entrées de TOUS ses élèves, et la fonction a rendu 2,2 g de
-- protéines pour deux élèves ayant mangé 1,1 g chacun. Un total de journée
-- FAUX, présenté comme un total de journée.
--
-- La RLS répond « quelles lignes ai-je le droit de lire », jamais « de qui
-- parle-t-on ». Le sujet doit donc être explicite. Par défaut c'est l'élève
-- connecté ; un coach doit nommer l'élève, et la RLS reste ce qui décide
-- s'il a le droit de le lire — la fonction n'emprunte aucun privilège.
drop function if exists public.consommation_du_jour(date);

create or replace function public.consommation_du_jour(
  p_consumed_on date,
  p_student_id uuid default null
)
returns table (protein_g numeric, carb_g numeric, fat_g numeric, kcal numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(e.protein_g), 0),
    coalesce(sum(e.carb_g), 0),
    coalesce(sum(e.fat_g), 0),
    coalesce(sum(e.protein_g * 4 + e.carb_g * 4 + e.fat_g * 9), 0)
    from public.meal_entries e
    join public.consumed_meals m on m.id = e.consumed_meal_id
   where m.consumed_on = p_consumed_on
     and m.student_id = coalesce(p_student_id, public.current_student_id());
$$;

alter function public.consommation_du_jour(date, uuid) owner to postgres;
comment on function public.consommation_du_jour(date, uuid) is
  'Total consommé d''une journée POUR UN ÉLÈVE : somme des meal_entries, repas prescrits ET repas libres. p_student_id vaut par défaut l''élève connecté. Il est OBLIGATOIRE de le nommer pour un coach : sans lui, la RLS coach laisse passer tous ses élèves et la somme agrège plusieurs journées en une (mesuré). security INVOKER — la RLS reste seule juge du droit de lecture. Les kcal suivent le 4/4/9, jamais une colonne stockée.';
revoke all on function public.consommation_du_jour(date, uuid) from public;
revoke execute on function public.consommation_du_jour(date, uuid) from anon;
grant execute on function public.consommation_du_jour(date, uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- F. Sécurité — RLS, et le RETRAIT des écritures directes
-- ────────────────────────────────────────────────────────────────────────────
alter table public.consumed_meals enable row level security;

drop policy if exists "consumed_meals_read_own_student" on public.consumed_meals;
create policy "consumed_meals_read_own_student" on public.consumed_meals
  for select to authenticated
  using (student_id = public.current_student_id());

drop policy if exists "consumed_meals_select_own_coach" on public.consumed_meals;
create policy "consumed_meals_select_own_coach" on public.consumed_meals
  for select to authenticated
  using (public.is_coach_of_student(student_id));

drop policy if exists "consumed_meals_manage_admin" on public.consumed_meals;
create policy "consumed_meals_manage_admin" on public.consumed_meals
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── LE POINT QUI REND LA RÈGLE §5 RÉELLE ─────────────────────────────────
-- A1 accordait `insert, update, delete` sur meal_entries à `authenticated`.
-- Tant que ce privilège existe, un client peut écrire ses propres macros par
-- PostgREST et contourner INTÉGRALEMENT le calcul serveur — la RPC ne serait
-- qu'une politesse. On le retire. L'élève garde la LECTURE ; tout le reste
-- passe par les fonctions ci-dessus, qui sont `security definer` et écrivent
-- donc en tant que `postgres`.
revoke insert, update, delete on table public.meal_entries from authenticated;

revoke all on table public.consumed_meals from public;
revoke all on table public.consumed_meals from anon;
revoke all on table public.consumed_meals from authenticated;
grant select on table public.consumed_meals to authenticated;
grant all on table public.consumed_meals to service_role;

-- `updated_at` : même déclencheur que partout ailleurs.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    execute 'drop trigger if exists set_updated_at on public.consumed_meals';
    execute 'create trigger set_updated_at before update on public.consumed_meals
             for each row execute function public.set_updated_at()';
  end if;
end $$;
