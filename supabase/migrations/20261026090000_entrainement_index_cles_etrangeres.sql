-- ============================================================================
-- ENTRAÎNEMENT — LES TROIS INDEX DE CLÉ ÉTRANGÈRE QUI MANQUAIENT.
-- Chantier feat/entrainement-performances, lot A. Octobre 2026.
-- ============================================================================
--
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI — LA MESURE, PAS L'INTUITION
-- ════════════════════════════════════════════════════════════════════════════
-- Relevé sur le projet le 24/10/2026, `pg_stat_user_tables` :
--
--   table                 balayages séq.   lignes lues séq.   lignes vivantes
--   workout_sessions             46 294        61 259 571              1 395
--   workout_exercises             8 485        40 197 057              5 074
--
-- Plus de 100 millions de lignes parcourues séquentiellement sur deux tables
-- qui en comptent 6 500. `EXPLAIN ANALYZE` sur la base distante, pour aller
-- chercher les 5 exercices d'UNE séance :
--
--   Seq Scan on workout_exercises  (actual time=3.991..16.244 rows=5 loops=1)
--     Filter: (session_id = (InitPlan 1).col1)
--     Rows Removed by Filter: 5069
--
-- Ces trois colonnes sont exactement celles que parcourent, à CHAQUE
-- instruction, les fonctions de portée RLS (`workout_session_ids_ecriture()`,
-- `workout_exercise_ids_ecriture()`, `training_block_ids_ecriture()`) et les
-- lectures de `loadPrograms`. Un enregistrement de programmation émet 84 à 100
-- appels séquentiels : le surcoût est payé 84 à 100 fois.
--
-- ⚠️ LE CHIFFRE QUI JUSTIFIE CETTE MIGRATION. Expérience de contrôle sur base
-- locale reconstruite, volumétrie calquée sur la production, les trois index
-- pour SEULE variable, 84 séances enregistrées une par une sous RLS :
--
--   index manquants ... 318,5 s au total, 3 791 ms de moyenne, 4 303 ms au pire
--   index posés .......   7,2 s au total,    86 ms de moyenne,   235 ms au pire
--
-- Soit un facteur 44. Et le coût redevient proportionnel au contenu : un jour
-- de repos, dont la charge utile pèse 297 octets, passe de 3 675 ms à 15,7 ms.
--
-- Enjeu de FIABILITÉ autant que de vitesse : le rôle `authenticated` porte
-- `statement_timeout = 8s`, et `save_training_session_blocks` est UNE SEULE
-- instruction. Sur 1 760 appels réels (`pg_stat_statements`) : moyenne
-- 1 840,6 ms, écart-type 1 517,5 ms, MAXIMUM 7 873,2 ms — soit 127 ms de marge
-- avant annulation par PostgreSQL. C'est ce qui fait échouer « parfois »
-- l'ajout d'une semaine à une programmation de 12 semaines.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ════════════════════════════════════════════════════════════════════════════
-- Aucune colonne ajoutée, retirée ou modifiée. Aucune policy touchée. Aucune
-- fonction remplacée. Aucune donnée lue, réécrite ou supprimée. Strictement
-- additive : trois index, et rien d'autre.
--
-- ⚠️ AUCUN INDEX EXISTANT N'EST MODIFIÉ NI SUPPRIMÉ. En particulier,
-- `workout_sessions_scheduled_date_idx` — soit `(program_id, scheduled_date)
-- WHERE scheduled_date IS NOT NULL` — est CONSERVÉ tel quel, bien que le
-- linter Supabase le signale comme jamais utilisé. Deux raisons :
--   · il sert le calendrier athlète, dont la fréquentation n'a pas été mesurée
--     sur une fenêtre suffisante pour conclure ;
--   · le supprimer ne gagne rien sur le chemin traité ici.
-- Son existence est en revanche la RAISON pour laquelle `program_id` a besoin
-- de son propre index : étant PARTIEL, il ne peut pas servir un
-- `program_id = x` général. Vérifié sur la base distante :
--
--   Seq Scan on workout_sessions  (actual time=0.073..1.899 rows=84 loops=1)
--     Filter: (program_id = (InitPlan 1).col1)
--     Rows Removed by Filter: 1311
--
-- D'où un index NON PARTIEL et NON CONDITIONNEL ci-dessous — le contrôle 4 de
-- la vérification finale refuse explicitement toute clause `WHERE`.
--
-- ⚠️ PAS DE `CONCURRENTLY`, ET C'EST UN CHOIX ASSUMÉ. `CREATE INDEX
-- CONCURRENTLY` ne peut pas s'exécuter dans une transaction, alors que le CLI
-- Supabase enveloppe chaque migration dans une transaction. Sur 1 395 et
-- 5 074 lignes, la construction se compte en millisecondes et le verrou
-- `SHARE` qu'elle prend est imperceptible. Sur une table de plusieurs millions
-- de lignes, la conclusion serait inverse.
-- ============================================================================

-- ── 0. LE CATALOGUE D'ABORD : on regarde avant d'écrire ─────────────────────
--
-- `IF NOT EXISTS` suffirait à ne pas planter, mais ne dirait RIEN. Ce bloc
-- rapporte l'état de départ, nommément : s'il existe déjà un index utilisable
-- sur l'une des trois colonnes (non partiel, colonne en tête), la création qui
-- suit est un no-op et on veut le savoir, pas le découvrir.
do $etat$
declare
  r record;
  v_deja int := 0;
begin
  raise notice '── état du catalogue AVANT création ──';
  for r in
    select c.relname as tabl, i.relname as idx,
           pg_get_indexdef(ix.indexrelid) as def,
           ix.indpred is not null as partiel,
           a.attname as premiere_colonne
      from pg_index ix
      join pg_class c on c.oid = ix.indrelid
      join pg_class i on i.oid = ix.indexrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attribute a
             on a.attrelid = c.oid and a.attnum = (ix.indkey::int2[])[0]
     where n.nspname = 'public'
       and c.relname in ('workout_exercises', 'workout_sessions')
     order by c.relname, i.relname
  loop
    raise notice '   % · % (1re col. %, partiel %)', r.tabl, r.idx, r.premiere_colonne, r.partiel;
  end loop;

  -- Un index DÉJÀ utilisable sur l'une des trois cibles : non partiel, et la
  -- colonne visée en PREMIÈRE position (un index dont elle est la 2e colonne
  -- ne sert pas un filtre sur elle seule).
  select count(*) into v_deja
    from pg_index ix
    join pg_class c on c.oid = ix.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = (ix.indkey::int2[])[0]
   where n.nspname = 'public'
     and ix.indpred is null
     and ( (c.relname = 'workout_exercises' and a.attname = 'session_id')
        or (c.relname = 'workout_sessions'  and a.attname = 'program_week_id')
        or (c.relname = 'workout_sessions'  and a.attname = 'program_id') );

  raise notice '── index utilisables déjà en place sur les 3 cibles : % / 3 ──', v_deja;
end
$etat$;

-- ── 1. workout_exercises(session_id) ────────────────────────────────────────
-- La clé étrangère `workout_exercises_session_id_fkey` (ON DELETE CASCADE)
-- n'avait aucun index. Trois usages la parcourent :
--   · `workout_exercise_ids_ecriture()`, rejouée par les policies à chaque
--     instruction touchant `workout_exercises` ou `training_prescriptions` ;
--   · les étapes 5 et 7 de `save_training_session_blocks` (relecture des
--     exercices de la séance, puis suppressions tardives) ;
--   · la lecture `SELECT workout_exercises WHERE session_id = ANY($1)` de
--     `loadPrograms` — 976 appels, 133 966 ms cumulés, 137 ms de moyenne.
-- La cascade de suppression d'une séance la parcourait aussi, une fois par
-- ligne parente supprimée : retirer une semaine en bénéficie également.
create index if not exists workout_exercises_session_id_idx
  on public.workout_exercises (session_id);

-- ── 2. workout_sessions(program_week_id) ────────────────────────────────────
-- Clé étrangère `workout_sessions_program_week_id_fkey` (ON DELETE CASCADE),
-- sans index. Sert la lecture `SELECT workout_sessions WHERE program_week_id =
-- ANY($1)` (988 appels, 29 346 ms cumulés), la lecture des séances par
-- `diffProgramStructure` avant tout diff, et la cascade du retrait de semaine.
create index if not exists workout_sessions_program_week_id_idx
  on public.workout_sessions (program_week_id);

-- ── 3. workout_sessions(program_id) — NON PARTIEL ───────────────────────────
-- `workout_session_ids_ecriture()` et `workout_session_ids_lecture()` filtrent
-- `ws.program_id in (select program_ids_*())`. Le seul index dont `program_id`
-- était la première colonne étant PARTIEL (voir l'en-tête), chacune de ces
-- évaluations balayait les 1 395 séances — d'où les 46 294 balayages
-- séquentiels relevés. Celui-ci est inconditionnel, donc utilisable par
-- n'importe quel filtre d'égalité sur `program_id`, cascade comprise.
create index if not exists workout_sessions_program_id_idx
  on public.workout_sessions (program_id);

-- ── 4. Les statistiques, pour que le planificateur change d'avis ────────────
-- Un index posé mais non analysé laisse le planificateur sur ses anciennes
-- estimations : il peut conserver le balayage séquentiel. `ANALYZE` rend la
-- migration effective immédiatement plutôt qu'au prochain passage d'autovacuum.
analyze public.workout_exercises;
analyze public.workout_sessions;

-- ── 5. VÉRIFICATION FINALE ──────────────────────────────────────────────────
-- Catalogue seulement : aucune donnée lue, aucune écriture. Chaque contrôle
-- lève, parce qu'une migration de performance qui ne tient pas sa promesse
-- doit se voir à l'application, pas six semaines plus tard sur un graphique.
do $verif$
declare
  v_n int;
  v_partiel boolean;
  v_premiere text;
begin
  -- 1. Les trois index existent.
  select count(*) into v_n
    from pg_class i join pg_namespace n on n.oid = i.relnamespace
   where n.nspname = 'public'
     and i.relkind = 'i'
     and i.relname in ('workout_exercises_session_id_idx',
                       'workout_sessions_program_week_id_idx',
                       'workout_sessions_program_id_idx');
  if v_n <> 3 then
    raise exception 'index attendus absents : % sur 3 — migration inopérante', v_n;
  end if;

  -- 2. Aucun des trois n'est partiel : un index partiel ne sert pas un filtre
  --    d'égalité général, et c'est précisément le piège que cette migration
  --    corrige (voir `workout_sessions_scheduled_date_idx`).
  select count(*) into v_n
    from pg_index ix join pg_class i on i.oid = ix.indexrelid
   where i.relname in ('workout_exercises_session_id_idx',
                       'workout_sessions_program_week_id_idx',
                       'workout_sessions_program_id_idx')
     and ix.indpred is not null;
  if v_n <> 0 then
    raise exception '% index partiel(s) parmi les trois créés — inutilisable(s) pour un filtre général', v_n;
  end if;

  -- 3. Chacun porte SA colonne en première position.
  for v_premiere, v_partiel, v_n in
    select a.attname, ix.indpred is not null, 1
      from pg_index ix
      join pg_class i on i.oid = ix.indexrelid
      join pg_class c on c.oid = ix.indrelid
      join pg_attribute a on a.attrelid = c.oid and a.attnum = (ix.indkey::int2[])[0]
     where i.relname = 'workout_exercises_session_id_idx'
  loop
    if v_premiere <> 'session_id' then
      raise exception 'workout_exercises_session_id_idx : 1re colonne % au lieu de session_id', v_premiere;
    end if;
  end loop;

  select count(*) into v_n
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class c on c.oid = ix.indrelid
    join pg_attribute a on a.attrelid = c.oid and a.attnum = (ix.indkey::int2[])[0]
   where i.relname = 'workout_sessions_program_week_id_idx'
     and a.attname = 'program_week_id';
  if v_n <> 1 then
    raise exception 'workout_sessions_program_week_id_idx : program_week_id absent en 1re colonne';
  end if;

  select count(*) into v_n
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class c on c.oid = ix.indrelid
    join pg_attribute a on a.attrelid = c.oid and a.attnum = (ix.indkey::int2[])[0]
   where i.relname = 'workout_sessions_program_id_idx'
     and a.attname = 'program_id';
  if v_n <> 1 then
    raise exception 'workout_sessions_program_id_idx : program_id absent en 1re colonne';
  end if;

  -- 4. Plus AUCUNE des trois clés étrangères visées n'est sans couverture.
  --    C'est la formulation du linter Supabase (`unindexed_foreign_keys`), et
  --    c'est la propriété qu'on veut, pas la simple présence d'un index.
  select count(*) into v_n
    from pg_constraint con
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute a
      on a.attrelid = con.conrelid and a.attnum = k.attnum
   where con.contype = 'f'
     and con.conname in ('workout_exercises_session_id_fkey',
                         'workout_sessions_program_week_id_fkey')
     and not exists (
       select 1 from pg_index ix
        where ix.indrelid = con.conrelid
          and ix.indpred is null
          and (ix.indkey::int2[])[0] = a.attnum
     );
  if v_n <> 0 then
    raise exception '% clé(s) étrangère(s) encore sans index utilisable', v_n;
  end if;

  -- 5. L'index existant du calendrier est INTACT — on n'a touché à rien.
  perform 1 from pg_class i join pg_namespace n on n.oid = i.relnamespace
   where n.nspname = 'public' and i.relname = 'workout_sessions_scheduled_date_idx';
  if not found then
    raise exception 'workout_sessions_scheduled_date_idx a disparu : cette migration ne doit RIEN supprimer';
  end if;

  raise notice '20261026090000 — 5 contrôles sur 5 verts (3 index posés, non partiels, aucun index existant touché)';
end
$verif$;
