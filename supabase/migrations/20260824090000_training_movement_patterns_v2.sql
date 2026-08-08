-- ────────────────────────────────────────────────────────────────────────────
-- F3 — VOCABULAIRE DES PATTERNS DE MOUVEMENT, VERSION 2 : TRANSITION
--      (chantier feat/training-movement-patterns, migration corrective)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE MIGRATION SÉPARÉE DE 20260820090000
-- ────────────────────────────────────────────────────────────────────────────
-- `20260820090000_training_movement_patterns.sql` a été APPLIQUÉE au projet
-- distant (dry-run : « Remote database is up to date »). Elle est donc
-- IMMUABLE, même si la PR qui la porte n'est pas encore fusionnée : le
-- fichier doit rester le reflet exact de ce qui a tourné. Toute évolution du
-- vocabulaire passe par une migration corrective.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI CETTE MIGRATION EST *TRANSITOIRE*, ET PAS LE MOT DE LA FIN
-- ────────────────────────────────────────────────────────────────────────────
-- Les migrations sont appliquées AVANT le merge, pour tester la Preview.
-- Il existe donc une fenêtre pendant laquelle la base porte le nouveau
-- schéma alors que la Production sert encore l'ANCIEN frontend.
--
-- Le danger n'est pas seulement qu'un ancien écran envoie une clé retirée :
-- PostgreSQL revalide une contrainte CHECK sur la LIGNE ENTIÈRE à chaque
-- UPDATE. Une fiche portant `flexion_coude` deviendrait donc impossible à
-- modifier — même pour changer son nom ou sa vidéo — dès l'instant où la
-- clé disparaît du CHECK. C'est ce qui casserait, silencieusement, un écran
-- d'administration qui n'a rien demandé.
--
-- Cette migration élargit donc le CHECK à 46 + 4 valeurs : les 46 nouvelles,
-- ET les 4 clés retirées, conservées UNIQUEMENT le temps du déploiement.
--
-- UNE MIGRATION DE NETTOYAGE VIENDRA LES RETIRER — prévue sous le nom
-- `20260825090000_training_movement_patterns_remove_legacy.sql`, elle n'est
-- volontairement PAS dans cette branche. Elle sera écrite après le merge,
-- après la mise en Production de la nouvelle version, et après que le coach
-- ait réétiqueté à la main les fiches restées en `flexion_coude`. Tant
-- qu'elle n'existe pas, les 4 clés ci-dessous restent acceptées.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI CHANGE DANS LE VOCABULAIRE
-- ────────────────────────────────────────────────────────────────────────────
-- 36 → 46 valeurs. La granularité suit une seule règle : deux exercices d'un
-- même pattern doivent pouvoir se remplacer sans que le coach intervienne.
--
-- AJOUTS (14) — poussée inclinée et déclinée ; tirage horizontal coudes
--   ouverts / fermés ; tirage diagonal ; écarté horizontal, incliné,
--   décliné ; flexion et extension de coude, antérieur et postérieur ;
--   hinge ; flexion de hanche.
--
-- RETRAITS (4 clés), toutes DEPRECATED ici — encore acceptées par le CHECK,
-- retirées plus tard par la migration de nettoyage :
--   `tirage_horizontal`     scindée en coudes ouverts / coudes fermés
--   `flexion_coude`         scindée en antérieur / postérieur
--   `extension_coude`       scindée en antérieur / postérieur
--   `charniere_de_hanche`   fusionnée dans `hinge` (même mouvement : deux
--                           entrées auraient empêché un soulevé de terre et
--                           un roumain de se proposer l'un l'autre)
--
-- ────────────────────────────────────────────────────────────────────────────
-- DONNÉES EXISTANTES : AUCUNE CONVERSION ARBITRAIRE
-- ────────────────────────────────────────────────────────────────────────────
-- Relevé du 08/08/2026 sur le projet distant : 95 fiches sans pattern, et
-- 8 fiches portant une clé retirée —
--   `flexion_coude`       7 fiches (Curl banc incliné, Curl dos à la poulie,
--                         Curl EZ, Curl marteau machine, Curl marteau poulie,
--                         Curl spider, Curl unilatéral à la poulie)
--   `tirage_horizontal`   1 fiche  (Tirage horizontal coudes ouverts à la poulie)
--   `extension_coude`     0 fiche
--   `charniere_de_hanche` 0 fiche
--
-- DEUX mappings, et deux seulement, EXPLICITEMENT validés par le coach —
-- les deux cas où la bonne valeur ne fait aucun doute :
--
--   1. `tirage_horizontal` → `tirage_horizontal_coudes_ouverts`
--      Le nom de la fiche porte littéralement la réponse.
--
--   2. `charniere_de_hanche` → `hinge`
--      Même mouvement, sous deux noms. Zéro ligne concernée aujourd'hui, le
--      mapping est écrit pour le cas où une fiche apparaîtrait d'ici
--      l'application.
--
-- AUCUNE conversion pour `flexion_coude` (7 fiches) NI pour
-- `extension_coude` (0 fiche). « Antérieur / postérieur » dépend de la
-- position du bras, que le nom de la fiche ne donne pas de façon fiable :
-- selon la lecture, le curl banc incliné et le curl spider tomberaient dans
-- des catégories opposées. Le coach réétiquette ces fiches LUI-MÊME dans
-- l'interface, une par une, avec les 46 valeurs sous les yeux. Les passer à
-- NULL en attendant serait une perte d'information gratuite : tant que la
-- clé DEPRECATED est acceptée, la fiche garde la trace de ce qu'elle était.
--
-- Aucune ligne n'est jamais supprimée, et AUCUNE valeur n'est mise à NULL.
--
-- Idempotente : rejouable sans effet (les mappings ne trouvent plus rien, la
-- contrainte est reposée à l'identique).
--
-- NE PAS exécuter en Production sans validation explicite.
-- ────────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PRÉCHECK — refus propre si une valeur totalement inconnue est en base
-- ────────────────────────────────────────────────────────────────────────────
-- Les 4 clés DEPRECATED sont tolérées ici (c'est tout l'objet de la
-- transition). Ce qui est refusé, c'est une valeur qui n'appartient NI au
-- nouveau vocabulaire NI à l'ancien : elle bloquerait la pose du CHECK, et
-- aucune règle ne dit quoi en faire.
do $$
declare
  v_n int;
  v_detail text;
begin
  select count(*), string_agg(format('%s (« %s »)', movement_pattern, name), ', ')
    into v_n, v_detail
    from public.exercise_library
   where movement_pattern is not null
     and movement_pattern not in (
       -- les 46 nouvelles
       'poussee_horizontale', 'poussee_verticale', 'poussee_inclinee', 'poussee_declinee',
       'tirage_vertical', 'tirage_horizontal_coudes_ouverts', 'tirage_horizontal_coudes_fermes',
       'tirage_diagonal', 'ecarte_horizontal', 'ecarte_incline', 'ecarte_decline',
       'elevation_laterale', 'elevation_frontale', 'elevation_posterieure',
       'rotation_externe_epaule', 'rotation_interne_epaule',
       'flexion_coude_anterieur', 'flexion_coude_posterieur',
       'extension_coude_anterieur', 'extension_coude_posterieur',
       'flexion_poignet', 'extension_poignet', 'pronosupination',
       'squat', 'fente', 'hinge', 'extension_de_hanche', 'flexion_de_hanche',
       'extension_genou', 'flexion_genou', 'abduction_hanche', 'adduction_hanche',
       'rotation_hanche', 'flexion_plantaire', 'flexion_dorsale',
       'flexion_tronc', 'extension_tronc', 'rotation_tronc',
       'anti_extension', 'anti_rotation', 'anti_flexion_laterale',
       'port_de_charge', 'haltero', 'pliometrie', 'locomotion', 'mobilite',
       -- les 4 DEPRECATED, tolérées le temps du déploiement
       'tirage_horizontal', 'flexion_coude', 'extension_coude', 'charniere_de_hanche'
     );

  if v_n > 0 then
    raise exception
      'MIGRATION REFUSÉE — % fiche(s) portent une valeur de pattern inconnue : %. Ni le nouveau vocabulaire ni l''ancien ne la contiennent, et aucune conversion n''est faite d''office. Corrige ces fiches puis rejoue.',
      v_n, v_detail
      using errcode = 'check_violation';
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. La contrainte est retirée AVANT le remappage
-- ────────────────────────────────────────────────────────────────────────────
-- `tirage_horizontal_coudes_ouverts` et `hinge` n'existent pas dans
-- l'ancien CHECK : remapper avant de le remplacer échouerait.
alter table public.exercise_library
  drop constraint if exists exercise_library_movement_pattern_check;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. LES TROIS MAPPINGS VALIDÉS — et rien d'autre
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare v_tirage int; v_charniere int; v_a_reetiqueter int;
begin
  update public.exercise_library
     set movement_pattern = 'tirage_horizontal_coudes_ouverts'
   where movement_pattern = 'tirage_horizontal';
  get diagnostics v_tirage = row_count;

  update public.exercise_library
     set movement_pattern = 'hinge'
   where movement_pattern = 'charniere_de_hanche';
  get diagnostics v_charniere = row_count;

  -- Les fiches laissées volontairement en l'état, à réétiqueter à la main.
  select count(*) into v_a_reetiqueter
    from public.exercise_library
   where movement_pattern in ('flexion_coude', 'extension_coude');

  raise notice 'Patterns remappés : % tirage_horizontal → coudes ouverts, % charniere_de_hanche → hinge. % fiche(s) restent en flexion_coude/extension_coude : à réétiqueter à la main dans l''interface (aucune conversion automatique).',
    v_tirage, v_charniere, v_a_reetiqueter;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. LE CHECK DE TRANSITION — 46 valeurs + 4 DEPRECATED
-- ────────────────────────────────────────────────────────────────────────────
-- Les 46 sont dupliquées dans lib/movement-patterns.ts (TypeScript) : c'est
-- assumé et VÉRIFIÉ — scripts/tests/training-movement-patterns.mts compare
-- les deux listes valeur par valeur, en écartant les 4 clés DEPRECATED.
alter table public.exercise_library
  add constraint exercise_library_movement_pattern_check
  check (
    movement_pattern is null
    or movement_pattern = any (array[
      -- ── VOCABULAIRE COURANT (46) ─────────────────────────────────────────
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
      'port_de_charge', 'haltero', 'pliometrie', 'locomotion', 'mobilite',
      -- ── DEPRECATED — COMPATIBILITÉ DE DÉPLOIEMENT UNIQUEMENT ─────────────
      -- Ces quatre clés NE FONT PLUS PARTIE du vocabulaire. Elles ne sont
      -- proposées nulle part dans l'interface et ne doivent jamais être
      -- écrites volontairement. Elles ne sont tolérées que pour qu'une fiche
      -- qui en porterait encore reste MODIFIABLE par l'ancien frontend
      -- jusqu'au merge (PostgreSQL revalide le CHECK sur la ligne entière à
      -- chaque UPDATE). Retirées par
      -- 20260825090000_training_movement_patterns_remove_legacy.sql, à
      -- n'appliquer qu'une fois la nouvelle version en Production.
      'tirage_horizontal', 'flexion_coude', 'extension_coude', 'charniere_de_hanche'
    ])
  );

comment on column public.exercise_library.movement_pattern is
  'Pattern de mouvement (action articulaire). NULL = non renseigné : l''exercice n''offre alors aucun remplaçant. TRANSITION : le CHECK accepte les 46 valeurs courantes plus 4 clés DEPRECATED (tirage_horizontal, flexion_coude, extension_coude, charniere_de_hanche), conservées le temps du déploiement et du réétiquetage manuel, puis retirées par une migration de nettoyage ultérieure. Vocabulaire courant dupliqué dans lib/movement-patterns.ts.';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. Contrôle final — la migration échoue si elle est incomplète
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_manque text := '';
  v_cle text;
  v_restantes int;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'exercise_library_movement_pattern_check';
  if v_def is null then
    raise exception 'MIGRATION INCOMPLÈTE — la contrainte exercise_library_movement_pattern_check a disparu';
  end if;

  -- Les 14 nouvelles clés doivent être acceptées…
  foreach v_cle in array array['poussee_inclinee', 'poussee_declinee',
                               'tirage_horizontal_coudes_ouverts', 'tirage_horizontal_coudes_fermes',
                               'tirage_diagonal', 'ecarte_horizontal', 'ecarte_incline',
                               'ecarte_decline', 'flexion_coude_anterieur', 'flexion_coude_posterieur',
                               'extension_coude_anterieur', 'extension_coude_posterieur',
                               'hinge', 'flexion_de_hanche'] loop
    if position('''' || v_cle || '''' in v_def) = 0 then
      v_manque := v_manque || ' clé ajoutée manquante : ' || v_cle;
    end if;
  end loop;

  -- …et les 4 DEPRECATED encore tolérées : c'est ce qui protège le
  -- déploiement. Leur ABSENCE ici serait le bug.
  foreach v_cle in array array['tirage_horizontal', 'flexion_coude',
                               'extension_coude', 'charniere_de_hanche'] loop
    if position('''' || v_cle || '''' in v_def) = 0 then
      v_manque := v_manque || ' clé DEPRECATED absente du CHECK de transition : ' || v_cle;
    end if;
  end loop;

  -- Les deux mappings validés ont bien vidé LEURS clés — et seulement
  -- celles-là. `flexion_coude` et `extension_coude` doivent au contraire
  -- être restées intactes : leur conversion appartient au coach.
  select count(*) into v_restantes
    from public.exercise_library
   where movement_pattern in ('tirage_horizontal', 'charniere_de_hanche');
  if v_restantes > 0 then
    v_manque := v_manque || format(' %s fiche(s) portent encore une clé remappée', v_restantes);
  end if;

  if v_manque <> '' then
    raise exception 'MIGRATION INCOMPLÈTE —%', v_manque;
  end if;
end $$;
