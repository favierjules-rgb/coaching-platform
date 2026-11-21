-- ============================================================================
-- LOT 1 — D3 : RETOUR ARRIÈRE DE LA REPRISE D'AFFECTATIONS
--
-- ⚠️ CE FICHIER N'EST PAS UNE MIGRATION, ET IL NE DOIT JAMAIS ÊTRE PLACÉ DANS
-- `supabase/migrations/`. Il y serait appliqué par le prochain
-- `supabase db push`, c'est-à-dire exactement au moment où personne ne le veut.
-- Il s'exécute à la main, en connaissance de cause :
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/lot1-retour-arriere-reprise.sql
--
-- OBJET. Le bloc 1 de M1 est le SEUL geste non réversible du lot : il a
-- rattaché à Coach A tout l'opérationnel qui était sans propriétaire ou rattaché
-- au compte de test Coach B. Ce script rétablit l'état d'avant.
--
-- ⚠️ IL N'ÉCRASE AUCUNE MODIFICATION MÉTIER POSTÉRIEURE À M1. Chaque ligne à
-- restaurer est désignée NOMMÉMENT par son identifiant, relevé avant M1 le
-- 15/11/2026, et n'est remise à son ancienne valeur que si elle porte
-- AUJOURD'HUI exactement la valeur que M1 lui a donnée (Coach A). Une ligne
-- qu'un coach aurait réaffectée depuis est laissée telle quelle et SIGNALÉE :
-- le script rend la main sans rien deviner.
--
-- ⚠️ IL NE SUPPRIME RIEN. Aucun `delete`, aucun `truncate`. Il ne touche qu'à
-- la colonne `coach_id` des cinq tables concernées.
-- ============================================================================
do $$
declare
  c_coach_a constant uuid := '53c76658-9560-41c1-9382-6588972271c2';
  c_coach_b constant uuid := 'f5dfa5ae-56b2-436e-a99d-ad390247c6e9';

  -- État relevé AVANT M1, le 15/11/2026, en lecture seule.
  -- Les 5 disponibilités créées le 26/07/2026 : sans propriétaire.
  c_dispos_sans_proprietaire constant uuid[] := array[
    '22dd684c-641f-4eb5-8d05-febeb187cdb6',  -- mardi    06:30-18:45
    '15ae65f4-1fbd-4969-b383-daf743cc0a63',  -- mercredi 06:30-19:30
    'bc9da8ec-b142-4a31-961a-bc1edda20a46',  -- jeudi    06:30-12:30
    '7101b5bd-8e00-4b66-a7cf-a34859ab8a07',  -- vendredi 06:30-19:30
    '9a61184b-fe20-41cf-8132-bd0ffa293d3e'   -- samedi   09:00-12:30
  ]::uuid[];
  -- Les 2 disponibilités créées le 19/10/2026 : rattachées à Coach B.
  c_dispos_coach_b constant uuid[] := array[
    '32bf1cb8-e0e8-4f4c-bf72-a21d31296491',  -- lundi 09:00-12:00
    '502ea186-5904-41da-a6d5-6bfa38d4f08e'   -- mardi 09:00-12:00
  ]::uuid[];
  -- Les 7 rendez-vous sans propriétaire.
  c_rdv_sans_proprietaire constant uuid[] := array[
    '07fd8d34-e472-4425-8fd6-2b15a48132f8',
    '0b789e13-8642-43b2-b99d-7a4801d266cf',
    'e2122b18-1c08-46f3-8671-d6db3cd28b52',
    '0b5adba6-26d0-4543-9b5d-a382eb449d2d',
    '76d1c17d-2c89-4b3c-9c99-5477b42d664f',
    '9489d0cc-adc8-4a47-a07c-fcaf8dc1d145',
    '292427e2-d381-43a3-a4f3-32d33c01d9aa'
  ]::uuid[];

  -- Les 2 élèves sans coach titulaire, les 2 indisponibilités et le réglage
  -- singleton sans propriétaire — relevés en lecture seule le 15/11/2026,
  -- AVANT toute application de M1.
  c_eleves_sans_coach constant uuid[] := array[
    '57d4db37-5049-4d2c-83a7-1c1b0e6a90d6',
    '5c7e82e2-db6a-414b-adda-03c3f221b754'
  ]::uuid[];
  c_indispos_sans_coach constant uuid[] := array[
    '6f8422e4-15c7-4559-bc20-c0444df939e1',
    'a221999b-75f7-470a-b142-2175c7252249'
  ]::uuid[];
  c_reglages_sans_coach constant uuid[] := array[
    '6661adcb-e1f6-4e91-983f-a174fd52986b'
  ]::uuid[];

  v_n int;
  v_ignorees int := 0;
  v_restaurees int := 0;
begin
  -- ── Garde-fou d'identité : on est bien sur la base attendue.
  if not exists (select 1 from public.coaches where id = c_coach_a)
     or not exists (select 1 from public.coaches where id = c_coach_b) then
    raise exception 'D3 : les deux fiches coach attendues sont absentes — base inattendue, rien n''est touché';
  end if;

  -- ── Garde-fou d'état : M1 a-t-elle bien été appliquée ?
  if exists (select 1 from public.appointments where coach_id is null) then
    raise notice 'D3 : des rendez-vous sans propriétaire existent déjà — M1 n''a peut-être pas été appliquée.';
  end if;

  -- ── 1. Disponibilités qui étaient sans propriétaire.
  select count(*) into v_n from public.coach_availabilities
   where id = any(c_dispos_sans_proprietaire) and coach_id is distinct from c_coach_a;
  v_ignorees := v_ignorees + v_n;
  if v_n > 0 then
    raise notice 'D3 : % disponibilite(s) ne portent plus Coach A — modifiees depuis M1, laissees telles quelles.', v_n;
  end if;
  update public.coach_availabilities set coach_id = null
   where id = any(c_dispos_sans_proprietaire) and coach_id = c_coach_a;
  v_restaurees := v_restaurees + (select count(*) from public.coach_availabilities
                                   where id = any(c_dispos_sans_proprietaire) and coach_id is null);

  -- ── 2. Disponibilités qui appartenaient à Coach B.
  select count(*) into v_n from public.coach_availabilities
   where id = any(c_dispos_coach_b) and coach_id is distinct from c_coach_a;
  v_ignorees := v_ignorees + v_n;
  if v_n > 0 then
    raise notice 'D3 : % disponibilite(s) de Coach B ne portent plus Coach A — laissees telles quelles.', v_n;
  end if;
  update public.coach_availabilities set coach_id = c_coach_b
   where id = any(c_dispos_coach_b) and coach_id = c_coach_a;

  -- ── 3. Rendez-vous qui étaient sans propriétaire.
  select count(*) into v_n from public.appointments
   where id = any(c_rdv_sans_proprietaire) and coach_id is distinct from c_coach_a;
  v_ignorees := v_ignorees + v_n;
  if v_n > 0 then
    raise notice 'D3 : % rendez-vous ne portent plus Coach A — modifies depuis M1, laisses tels quels.', v_n;
  end if;
  update public.appointments set coach_id = null
   where id = any(c_rdv_sans_proprietaire) and coach_id = c_coach_a;

  /*
   * ── 4. Élèves, indisponibilités et réglages.
   *
   * ⚠️ DÉSIGNÉS NOMMÉMENT, EUX AUSSI. Une première rédaction de ce script les
   * laissait de côté : l'audit avait relevé les QUANTITÉS (2 élèves, 2
   * indisponibilités, 1 réglage) sans les identifiants, et restaurer « 2 élèves
   * parmi 39 » sans savoir lesquels aurait été une invention. Les identifiants
   * ont donc été relevés en lecture seule le 15/11/2026, AVANT toute
   * application de M1 — c'était possible précisément parce que la production
   * n'avait pas encore bougé.
   */
  select count(*) into v_n from public.students
   where id = any(c_eleves_sans_coach) and coach_id is distinct from c_coach_a;
  v_ignorees := v_ignorees + v_n;
  if v_n > 0 then
    raise notice 'D3 : % eleve(s) ne portent plus Coach A — reaffecte(s) depuis M1, laisse(s) tel(s) quel(s).', v_n;
  end if;
  update public.students set coach_id = null
   where id = any(c_eleves_sans_coach) and coach_id = c_coach_a;

  select count(*) into v_n from public.coach_unavailabilities
   where id = any(c_indispos_sans_coach) and coach_id is distinct from c_coach_a;
  v_ignorees := v_ignorees + v_n;
  if v_n > 0 then
    raise notice 'D3 : % indisponibilite(s) ne portent plus Coach A — laissee(s) telle(s) quelle(s).', v_n;
  end if;
  update public.coach_unavailabilities set coach_id = null
   where id = any(c_indispos_sans_coach) and coach_id = c_coach_a;

  select count(*) into v_n from public.booking_settings
   where id = any(c_reglages_sans_coach) and coach_id is distinct from c_coach_a;
  v_ignorees := v_ignorees + v_n;
  if v_n > 0 then
    raise notice 'D3 : % reglage(s) ne portent plus Coach A — laisse(s) tel(s) quel(s).', v_n;
  end if;
  update public.booking_settings set coach_id = null
   where id = any(c_reglages_sans_coach) and coach_id = c_coach_a;

  raise notice 'D3 : termine — % ligne(s) restauree(s), % ligne(s) ignoree(s) car modifiees depuis M1.',
    v_restaurees, v_ignorees;
end $$;
