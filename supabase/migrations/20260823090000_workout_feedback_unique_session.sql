-- ────────────────────────────────────────────────────────────────────────────
-- F3 — UN ÉLÈVE, UNE SÉANCE, UN SEUL RETOUR
--      (chantier feat/training-movement-patterns, quatrième et dernière migration)
--
-- ────────────────────────────────────────────────────────────────────────────
-- L'INVARIANT, ET POURQUOI IL N'ÉTAIT PAS TENU
-- ────────────────────────────────────────────────────────────────────────────
-- `lib/supabase/workout-feedback.ts` annonce depuis l'origine un « upsert par
-- student_id + sessionKey, voir la contrainte unique sur workout_feedback ».
-- Cette contrainte N'EXISTAIT PAS : `pg_constraint` ne portait que la clé
-- primaire, trois clés étrangères et trois CHECK. L'unicité reposait donc
-- entièrement sur une lecture-puis-écriture applicative — c'est-à-dire sur
-- rien du tout dès que deux soumissions se croisent : les deux lisent
-- « aucun retour », les deux insèrent, l'élève se retrouve avec deux retours
-- pour la même séance et le coach avec deux lignes dans sa file.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI (student_id, session_id) ET NON (student_id, session_key)
-- ────────────────────────────────────────────────────────────────────────────
-- `session_id` est l'IDENTITÉ CANONIQUE d'une séance réelle, et l'audit le
-- confirme de bout en bout :
--   * c'est la clé étrangère vers `workout_sessions` ;
--   * c'est elle qui déclenche la vérification d'appartenance
--     (`student_owns_workout_session`), la construction du snapshot, et la
--     dérivation de `program_id` / `session_key` / `session_ref_label`
--     (migrations 20260821090000 et 20260822090000) ;
--   * `lib/regularisation-achats.ts` compte les retours rattachés à un
--     programme EN PASSANT PAR `session_id`, jamais par `program_id` ;
--   * `lib/supabase/programs.ts` documente que la sauvegarde en diff fin
--     préserve les identifiants de séance PRÉCISÉMENT pour que
--     `workout_feedback.session_id` survive aux modifications du builder.
--
-- `session_key` n'est plus, pour une séance réelle, qu'une COPIE TEXTE de
-- `session_id` (dérivée et figée depuis 20260822090000). Poser l'unicité
-- dessus reviendrait à protéger le reflet plutôt que l'objet — et laisserait
-- la porte ouverte à toute ligne héritée dont la clé aurait divergé.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE L'INDEX NE COUVRE PAS, VOLONTAIREMENT
-- ────────────────────────────────────────────────────────────────────────────
-- Les retours dont `session_id` est NULL — séances mock/localStorage, et tout
-- l'historique antérieur à la migration des programmes — ne sont pas
-- concernés : l'index est PARTIEL. Leur comportement ne change en rien, et
-- aucune donnée existante n'a besoin d'être touchée pour que la migration
-- passe. C'est aussi ce qui rend l'index NULL-safe : en SQL, deux NULL ne
-- sont pas égaux, un index non partiel n'aurait donc de toute façon rien
-- contraint sur ces lignes — le rendre partiel le dit explicitement plutôt
-- que de laisser croire à une protection qui n'existerait pas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA GARANTIE DE CONCURRENCE VIENT DE POSTGRESQL, PAS DE L'APPLICATION
-- ────────────────────────────────────────────────────────────────────────────
-- Un index UNIQUE est vérifié DANS l'index, à l'insertion de l'entrée. Deux
-- transactions qui insèrent la même clé ne peuvent pas réussir toutes les
-- deux : la seconde bloque sur l'entrée en cours puis échoue en
-- `unique_violation` (SQLSTATE 23505) dès que la première valide. Aucune
-- fenêtre entre le SELECT et l'INSERT ne peut être exploitée, quelle que
-- soit la couche appelante. La couche applicative n'a donc pas à empêcher la
-- course : elle a seulement à la RATTRAPER proprement, ce que fait
-- `saveWorkoutFeedback` en relisant le retour gagnant et en poursuivant en
-- mise à jour — exactement le chemin d'une resoumission ordinaire.
--
-- STRICTEMENT ADDITIVE : aucune colonne, aucune politique, aucune fonction
-- touchée. Aucune donnée supprimée ni fusionnée — jamais, sous aucune
-- condition. Idempotente. Aucune migration déjà appliquée modifiée.
--
-- NE PAS exécuter en Production sans validation explicite.
-- ────────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PRÉCHECK — la migration REFUSE de s'appliquer sur des données en conflit
-- ────────────────────────────────────────────────────────────────────────────
-- `create unique index` échouerait de toute façon, mais avec un message
-- Postgres qui ne dit ni combien de couples sont en cause, ni quoi faire.
-- Surtout : il ne dirait pas ce qui compte ici, à savoir que RIEN ne sera
-- supprimé ni fusionné automatiquement. Un retour d'élève est une donnée
-- métier ; le choix de celui qu'on garde appartient au coach, pas à une
-- migration.
do $$
declare
  v_couples int;
  v_lignes int;
  v_exemple text;
begin
  select count(*), coalesce(sum(n), 0)
    into v_couples, v_lignes
    from (
      select count(*) as n
        from public.workout_feedback
       where session_id is not null
       group by student_id, session_id
      having count(*) > 1
    ) t;

  if v_couples > 0 then
    select string_agg(format('(élève %s, séance %s : %s retours)', student_id, session_id, n), ', ')
      into v_exemple
      from (
        select student_id, session_id, count(*) as n
          from public.workout_feedback
         where session_id is not null
         group by student_id, session_id
        having count(*) > 1
         order by count(*) desc
         limit 5
      ) t;
    raise exception
      'MIGRATION REFUSÉE — % couple(s) (élève, séance) portent déjà plusieurs retours (% lignes au total). AUCUNE fusion ni suppression automatique n''est faite : ces retours sont des données métier. Décide à la main lequel garder, puis rejoue cette migration. Premiers cas : %',
      v_couples, v_lignes, v_exemple
      using errcode = 'unique_violation';
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. L'INDEX
-- ────────────────────────────────────────────────────────────────────────────
-- Nom explicite : il énonce la règle métier, pas seulement les colonnes.
create unique index if not exists workout_feedback_one_per_student_session_uidx
  on public.workout_feedback (student_id, session_id)
  where session_id is not null;

comment on index public.workout_feedback_one_per_student_session_uidx is
  'UN élève + UNE séance réelle = UN seul retour. Partiel : les retours sans session_id (séances mock, historique antérieur) conservent leur comportement. Rattrapage applicatif de la collision : lib/supabase/workout-feedback.ts::saveWorkoutFeedback.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Contrôle final — la migration échoue si elle est incomplète
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_manque text := '';
  v_def text;
begin
  select indexdef into v_def
    from pg_indexes
   where schemaname = 'public'
     and tablename = 'workout_feedback'
     and indexname = 'workout_feedback_one_per_student_session_uidx';

  if v_def is null then
    raise exception 'MIGRATION INCOMPLÈTE — index workout_feedback_one_per_student_session_uidx absent';
  end if;
  if position('UNIQUE INDEX' in v_def) = 0 then
    v_manque := v_manque || ' index non UNIQUE';
  end if;
  if position('(student_id, session_id)' in v_def) = 0 then
    v_manque := v_manque || ' colonnes inattendues';
  end if;
  if position('WHERE (session_id IS NOT NULL)' in v_def) = 0 then
    v_manque := v_manque || ' index non partiel (les retours sans séance seraient concernés)';
  end if;

  if v_manque <> '' then
    raise exception 'MIGRATION INCOMPLÈTE —% (définition lue : %)', v_manque, v_def;
  end if;
end $$;
