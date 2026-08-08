-- ────────────────────────────────────────────────────────────────────────────
-- F3 — VOCABULAIRE DES PATTERNS : RETRAIT DÉFINITIF DES CLÉS DEPRECATED
--      (chantier feat/training-movement-patterns, migration corrective 2/2)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI CETTE MIGRATION EXISTE SÉPARÉMENT
-- ────────────────────────────────────────────────────────────────────────────
-- `20260824090000` a élargi le CHECK à 46 valeurs PLUS 4 clés DEPRECATED
-- (`tirage_horizontal`, `flexion_coude`, `extension_coude`,
-- `charniere_de_hanche`). Cette tolérance n'était pas de la complaisance :
-- PostgreSQL revalide un CHECK sur la LIGNE ENTIÈRE à chaque écriture, donc
-- une fiche portant encore une ancienne clé serait devenue immodifiable —
-- même pour changer son seul nom ou sa seule vidéo — dès l'instant où la clé
-- quittait le CHECK, et ce tant que l'ancien frontend était servi.
--
-- Cette migration-ci ferme la parenthèse : le CHECK ne garde plus que les 46
-- valeurs du vocabulaire courant. Appliquée au bon moment — après le
-- déploiement réel du nouveau frontend et après le réétiquetage des fiches
-- concernées — elle ne change rien pour personne : elle retire une tolérance
-- devenue inutile.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE FAIT, ET CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
-- ELLE FAIT : un précheck qui REFUSE tant qu'une clé DEPRECATED subsiste en
-- base, puis le remplacement du CHECK par les 46 valeurs finales.
--
-- ELLE NE FAIT PAS : aucune écriture de données. Aucun mapping, aucune
-- conversion, aucune mise à NULL, aucune ligne retirée. C'est une migration
-- de contrainte, rien d'autre. Si une fiche porte encore une ancienne clé,
-- la migration s'arrête, nomme la valeur et donne des exemples de fiches :
-- il suffit de les réétiqueter dans l'interface, avec les 46 valeurs sous
-- les yeux, puis de rejouer. Aucune décision d'étiquetage n'est prise à la
-- place du coach — « antérieur / postérieur » n'appartient qu'à lui.
--
-- Cette promesse n'est pas qu'une intention : la section 4 recalcule
-- l'empreinte de la colonne `movement_pattern` sur toute la table et échoue
-- si une seule valeur, ou le nombre total de fiches, a bougé.
--
-- Idempotente : rejouable sans effet.
--
-- NE PAS exécuter en Production sans validation explicite.
-- ────────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PRÉCHECK — refus tant qu'une clé DEPRECATED est encore portée
-- ────────────────────────────────────────────────────────────────────────────
-- Le refus est bavard À DESSEIN : une migration qui dit seulement « refusé »
-- oblige à rouvrir un client SQL pour comprendre. Celle-ci nomme les valeurs
-- fautives, leur nombre, et quelques fiches par leur nom.
do $$
declare
  v_n           int;
  v_valeurs     text;
  v_exemples    text;
begin
  select count(*) into v_n
    from public.exercise_library
   where movement_pattern in ('tirage_horizontal', 'flexion_coude',
                              'extension_coude', 'charniere_de_hanche');

  if v_n > 0 then
    -- Les valeurs concernées, avec le compte de fiches pour chacune.
    select string_agg(format('%s × %s', c.n, c.movement_pattern), ', '
                      order by c.n desc, c.movement_pattern)
      into v_valeurs
      from (select movement_pattern, count(*) as n
              from public.exercise_library
             where movement_pattern in ('tirage_horizontal', 'flexion_coude',
                                        'extension_coude', 'charniere_de_hanche')
             group by movement_pattern) as c;

    -- Et quelques fiches nommément, pour savoir par où commencer.
    select string_agg(format('« %s » (%s)', e.name, e.movement_pattern), ', '
                      order by e.movement_pattern, e.name)
      into v_exemples
      from (select name, movement_pattern
              from public.exercise_library
             where movement_pattern in ('tirage_horizontal', 'flexion_coude',
                                        'extension_coude', 'charniere_de_hanche')
             order by movement_pattern, name
             limit 5) as e;

    if v_n > 5 then
      v_exemples := v_exemples || format(' (et %s autre(s))', v_n - 5);
    end if;

    raise exception
      'MIGRATION REFUSÉE — % fiche(s) portent encore une clé retirée du vocabulaire : %. Exemples : %. Aucune conversion n''est faite d''office : réétiquette ces fiches dans l''interface avec le vocabulaire courant, puis rejoue cette migration. Aucune donnée n''a été touchée.',
      v_n, v_valeurs, v_exemples
      using errcode = 'check_violation';
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. EMPREINTE AVANT — pour pouvoir PROUVER qu'on n'a rien touché
-- ────────────────────────────────────────────────────────────────────────────
-- On fige ici le nombre de fiches et une empreinte de la colonne
-- `movement_pattern` ligne à ligne. La section 4 recalculera les deux et
-- refusera de conclure si quoi que ce soit a bougé.
do $$
declare
  v_total     bigint;
  v_empreinte text;
begin
  select count(*),
         md5(coalesce(string_agg(id::text || '=' || coalesce(movement_pattern, '∅'),
                                 ',' order by id), ''))
    into v_total, v_empreinte
    from public.exercise_library;

  perform set_config('f3.fiches_avant', v_total::text, false);
  perform set_config('f3.empreinte_avant', v_empreinte, false);

  raise notice 'Empreinte avant nettoyage : % fiche(s), signature %', v_total, v_empreinte;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. LE CHECK FINAL — 46 valeurs, et rien d'autre
-- ────────────────────────────────────────────────────────────────────────────
-- C'est CE CHECK qui fait autorité : scripts/tests/training-movement-patterns.mts
-- le relit et le compare, valeur par valeur et dans les deux sens, à
-- `movementPatternOrder` de lib/movement-patterns.ts.
alter table public.exercise_library
  drop constraint if exists exercise_library_movement_pattern_check;

alter table public.exercise_library
  add constraint exercise_library_movement_pattern_check
  check (
    movement_pattern is null
    or movement_pattern = any (array[
      -- Haut du corps — poussée, tirage, écarté
      'poussee_horizontale', 'poussee_verticale', 'poussee_inclinee', 'poussee_declinee',
      'tirage_vertical', 'tirage_horizontal_coudes_ouverts', 'tirage_horizontal_coudes_fermes',
      'tirage_diagonal', 'ecarte_horizontal', 'ecarte_incline', 'ecarte_decline',
      -- Épaule — isolation
      'elevation_laterale', 'elevation_frontale', 'elevation_posterieure',
      'rotation_externe_epaule', 'rotation_interne_epaule',
      -- Coude / poignet
      'flexion_coude_anterieur', 'flexion_coude_posterieur',
      'extension_coude_anterieur', 'extension_coude_posterieur',
      'flexion_poignet', 'extension_poignet', 'pronosupination',
      -- Hanche / genou
      'squat', 'fente', 'hinge', 'extension_de_hanche', 'flexion_de_hanche',
      'extension_genou', 'flexion_genou', 'abduction_hanche', 'adduction_hanche',
      'rotation_hanche',
      -- Cheville
      'flexion_plantaire', 'flexion_dorsale',
      -- Tronc
      'flexion_tronc', 'extension_tronc', 'rotation_tronc',
      'anti_extension', 'anti_rotation', 'anti_flexion_laterale',
      -- Global
      'port_de_charge', 'haltero', 'pliometrie', 'locomotion', 'mobilite'
    ])
  );

comment on column public.exercise_library.movement_pattern is
  'Pattern de mouvement (action articulaire). NULL = non renseigné : l''exercice n''offre alors aucun remplaçant. Vocabulaire de 46 valeurs figé par exercise_library_movement_pattern_check (version finale, migration 20260825090000) et dupliqué dans lib/movement-patterns.ts.';


-- ────────────────────────────────────────────────────────────────────────────
-- 4. CONTRÔLE FINAL — la contrainte, puis la promesse de non-modification
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def        text;
  v_manque     text := '';
  v_cle        text;
  v_valeurs    int;
  v_total      bigint;
  v_empreinte  text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'exercise_library_movement_pattern_check';
  if v_def is null then
    raise exception 'MIGRATION INCOMPLÈTE — la contrainte exercise_library_movement_pattern_check a disparu';
  end if;

  -- Les quatre clés retirées doivent AVOIR DISPARU du CHECK. On teste avec
  -- les apostrophes : `flexion_coude` est un préfixe de
  -- `flexion_coude_anterieur`, une recherche sans apostrophes rendrait un
  -- faux positif permanent.
  foreach v_cle in array array['tirage_horizontal', 'flexion_coude',
                               'extension_coude', 'charniere_de_hanche'] loop
    if position('''' || v_cle || '''' in v_def) > 0 then
      v_manque := v_manque || ' clé retirée encore acceptée : ' || v_cle;
    end if;
  end loop;

  -- Et les 14 clés ajoutées par la version 2 doivent toujours y être.
  foreach v_cle in array array['poussee_inclinee', 'poussee_declinee',
                               'tirage_horizontal_coudes_ouverts', 'tirage_horizontal_coudes_fermes',
                               'tirage_diagonal', 'ecarte_horizontal', 'ecarte_incline',
                               'ecarte_decline', 'flexion_coude_anterieur', 'flexion_coude_posterieur',
                               'extension_coude_anterieur', 'extension_coude_posterieur',
                               'hinge', 'flexion_de_hanche'] loop
    if position('''' || v_cle || '''' in v_def) = 0 then
      v_manque := v_manque || ' clé du vocabulaire manquante : ' || v_cle;
    end if;
  end loop;

  -- Le compte exact : 46, pas 45 ni 47.
  select count(*) into v_valeurs from regexp_matches(v_def, '''([a-z_]+)''', 'g');
  if v_valeurs <> 46 then
    v_manque := v_manque || format(' le CHECK porte %s valeurs au lieu de 46', v_valeurs);
  end if;

  if v_manque <> '' then
    raise exception 'MIGRATION INCOMPLÈTE —%', v_manque;
  end if;

  -- La promesse tenue : ni le nombre de fiches ni une seule valeur de
  -- `movement_pattern` n'a changé entre la section 2 et maintenant.
  select count(*),
         md5(coalesce(string_agg(id::text || '=' || coalesce(movement_pattern, '∅'),
                                 ',' order by id), ''))
    into v_total, v_empreinte
    from public.exercise_library;

  if v_total::text <> current_setting('f3.fiches_avant', true) then
    raise exception 'MIGRATION INVALIDE — le nombre de fiches a changé : % avant, % après',
      current_setting('f3.fiches_avant', true), v_total;
  end if;
  if v_empreinte <> current_setting('f3.empreinte_avant', true) then
    raise exception 'MIGRATION INVALIDE — au moins une valeur de movement_pattern a changé (signature % avant, % après)',
      current_setting('f3.empreinte_avant', true), v_empreinte;
  end if;

  raise notice 'Nettoyage terminé : CHECK à % valeurs, % fiche(s) inchangées (signature %).',
    v_valeurs, v_total, v_empreinte;
end $$;
