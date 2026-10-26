-- ============================================================================
-- ENREGISTREMENT GROUPÉ ET ATOMIQUE D'UNE PROGRAMMATION.
-- Chantier feat/entrainement-performances, lot B. Octobre 2026.
-- ============================================================================
--
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI — 87 À 100 ALLERS-RETOURS SÉQUENTIELS PAR ENREGISTREMENT
-- ════════════════════════════════════════════════════════════════════════════
-- `diffProgramStructure` terminait par une boucle appelant
-- `save_training_session_blocks` UNE FOIS PAR SÉANCE, séquentiellement, pour
-- TOUTES les séances du programme — y compris celles que le coach n'avait pas
-- touchées, y compris les jours de repos. Mesuré par instrumentation du code
-- réel sur une programmation de 12 semaines (84 séances) :
--
--   modifier un champ simple ....  87 requêtes, 87 séquentielles,  80 574 o
--   ajouter un exercice .........  87 requêtes, 87 séquentielles,  80 821 o
--   ajouter une semaine ......... 100 requêtes, 100 séquentielles, 88 249 o
--   modifier 10 séances .........  87 requêtes, 87 séquentielles,  82 966 o
--
-- Renommer une séance coûtait exactement autant que modifier dix. Le coût
-- suivait la TAILLE DU PROGRAMME, jamais la taille du changement.
--
-- Deux conséquences, toutes deux mesurées :
--   · 1 840,6 ms de moyenne par appel en production (1 760 appels,
--     pg_stat_statements) × 84 ≈ 155 s de temps serveur par enregistrement ;
--   · `statement_timeout = 8s` sur le rôle `authenticated`, pour un MAXIMUM
--     observé de 7 873,2 ms : 127 ms de marge. Un seul des 84 tirages qui
--     dépasse, et l'enregistrement échoue.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE FONCTION FAIT, ET CE QU'ELLE NE FAIT PAS
-- ════════════════════════════════════════════════════════════════════════════
-- Elle reçoit le programme et SES CHANGEMENTS, et les applique dans UNE SEULE
-- transaction : un aller-retour, une atomicité.
--
-- ⚠️ ELLE NE RÉIMPLÉMENTE AUCUNE RÈGLE MÉTIER. Pour le contenu d'une séance,
-- elle APPELLE `public.save_training_session_blocks(jsonb)`, inchangée. Toutes
-- ses validations s'appliquent donc au mot près — portée d'écriture, verrou
-- optimiste par séance, refus des identifiants étrangers (`FOREIGN_BLOCK_ID`),
-- des doublons d'identifiants temporaires, des catégories inconnues, des clés
-- de `session_patch` non autorisées, dérivation de `session_type` et
-- `is_rest_day` depuis les blocs. Dupliquer cette logique l'aurait fait
-- diverger ; l'appeler garantit qu'elle ne peut pas.
--
-- ⚠️ `security invoker`, ET C'EST LE CŒUR DU DISPOSITIF DE SÉCURITÉ. Aucune
-- policy n'est contournée : chaque INSERT, UPDATE et DELETE est évalué sous
-- les politiques RLS du coach appelant, exactement comme avant. Un
-- `SECURITY DEFINER` aurait supprimé le coût de la RLS — et avec lui la
-- garantie. Le périmètre du collaborateur (`categories_ecriture()`,
-- `coach_ids_portee()`, `student_ids_entrainement_ecriture()`) continue donc de
-- décider, et il décide dans la base, pas dans cette fonction.
--
-- ⚠️ ELLE N'EFFACE NI NE RECRÉE RIEN EN AVEUGLE. Les suppressions sont
-- EXPLICITES : `weeks_to_delete`, `sessions_to_delete`. C'est un renversement
-- par rapport au modèle précédent, où « absent de la charge » valait
-- « à supprimer » — modèle qui a détruit des données le 25/08/2026 quand une
-- lecture tronquée a rendu des séances invisibles. Désormais une séance absente
-- de la charge est une séance INCHANGÉE : ses identifiants, ses blocs, ses
-- exercices, ses prescriptions, son `updated_at` et le rattachement des retours
-- élèves ne sont pas touchés. Une lecture partielle ne peut plus supprimer quoi
-- que ce soit ; au pire elle ne modifie pas assez.
--
-- ⚠️ ELLE NE DÉCLARE JAMAIS UN SUCCÈS AVANT LE COMMIT. Une fonction plpgsql
-- s'exécute dans la transaction de l'appelant : son retour n'atteint le client
-- qu'après le COMMIT de PostgREST. Toute exception annule l'intégralité des
-- écritures — il ne peut plus exister d'état partiel où la tête du programme et
-- quarante séances sont commises tandis que les autres ont échoué.
--
-- ⚠️ ELLE SÉRIALISE LES ENREGISTREMENTS CONCURRENTS CÔTÉ SERVEUR. L'étape 2
-- verrouille la ligne `programs` en `FOR UPDATE` : deux coachs qui enregistrent
-- la même programmation s'exécutent l'un après l'autre, et le second voit le
-- verrou optimiste de tête (`STALE_TRAINING_PROGRAM`) plutôt que d'écraser en
-- silence. La garde de réentrance du navigateur (`lib/garde-sauvegarde.ts`)
-- reste nécessaire — elle protège contre le double clic d'UN coach — mais elle
-- n'est plus la seule protection.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ERREURS — TOUTES IDENTIFIABLES ET SITUÉES
-- ════════════════════════════════════════════════════════════════════════════
--   NOT_AUTHORIZED ................. appelant ni coach ni admin (42501)
--   INVALID_PAYLOAD: … ............. enveloppe incomplète ou mal typée
--   PROGRAM_NOT_FOUND_OR_FORBIDDEN . programme invisible sous la RLS du coach
--   STALE_TRAINING_PROGRAM ......... tête modifiée depuis le chargement
--   PROGRAM_HEAD_NOT_WRITABLE ...... 0 ligne mise à jour : droits insuffisants
--   WEEK_INSERT_FAILED: <n> ........ création de la semaine n refusée
--   WEEK_MISSING: <n> .............. séance visant une semaine indisponible
--   SESSION_INSERT_FAILED: <clé> ... création de séance refusée
--   SESSION_FAILED <clé>: <cause> .. échec du moteur par séance, cause conservée
--                                    (STALE_TRAINING_SESSION, FOREIGN_BLOCK_ID…)
-- Les deux dernières PRÉFIXENT l'erreur du moteur par la séance fautive sans
-- en perdre le texte : le client peut nommer la séance au coach, et le code
-- d'origine reste lisible pour le diagnostic.
-- ============================================================================

create or replace function public.save_training_program_sessions(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  v_program_id uuid;
  v_expected_program_updated_at timestamptz;
  v_current_program_updated_at timestamptz;
  v_new_program_updated_at timestamptz;
  v_patch jsonb;

  v_weeks_to_delete jsonb;
  v_weeks_to_create jsonb;
  v_sessions_to_delete jsonb;
  v_sessions_to_create jsonb;
  v_sessions_to_update jsonb;

  v_element jsonb;
  v_week_number int;
  v_week_id uuid;
  v_week_map jsonb := '{}'::jsonb;

  v_session_id uuid;
  v_session_ids_to_delete uuid[] := array[]::uuid[];
  v_cle text;
  v_inserted_updated_at timestamptz;

  v_charge_seance jsonb;
  v_resultats jsonb := '[]'::jsonb;
  v_un jsonb;
  v_n int;
  v_total_seances int := 0;
begin
  -- ── 0. Authentification : coach/admin uniquement ──────────────────────────
  -- Même garde que le moteur par séance, posée ici AUSSI : la portée fine
  -- reste l'affaire de la RLS, mais un appelant élève n'a rien à faire ici.
  if not public.is_coach_or_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- ── 1. Enveloppe ──────────────────────────────────────────────────────────
  -- ⚠️ LA FORME EST CONTRÔLÉE AVANT LE CAST, et l'ordre n'est pas cosmétique.
  -- `'pas-un-uuid'::uuid` lève une erreur de conversion PostgreSQL brute
  -- (22P02, « invalid input syntax for type uuid ») AVANT d'atteindre le moindre
  -- contrôle applicatif : le client recevait donc un message de bas niveau au
  -- lieu d'un `INVALID_PAYLOAD` identifiable, et ne pouvait pas le classer.
  if (p_payload->>'program_id') is null or (p_payload->>'program_id') = '' then
    raise exception 'INVALID_PAYLOAD: program_id manquant';
  end if;
  if (p_payload->>'program_id') !~* c_uuid_re then
    raise exception 'INVALID_PAYLOAD: program_id mal formé';
  end if;
  v_program_id := (p_payload->>'program_id')::uuid;

  v_patch                := p_payload->'program_patch';
  v_weeks_to_delete      := coalesce(p_payload->'weeks_to_delete', '[]'::jsonb);
  v_weeks_to_create      := coalesce(p_payload->'weeks_to_create', '[]'::jsonb);
  v_sessions_to_delete   := coalesce(p_payload->'sessions_to_delete', '[]'::jsonb);
  v_sessions_to_create   := coalesce(p_payload->'sessions_to_create', '[]'::jsonb);
  v_sessions_to_update   := coalesce(p_payload->'sessions_to_update', '[]'::jsonb);

  -- Chaque liste doit être un TABLEAU. Un objet ou une chaîne passerait
  -- silencieusement à travers `jsonb_array_elements` avec une erreur obscure ;
  -- on refuse tôt, avec le nom de la clé fautive.
  if jsonb_typeof(v_weeks_to_delete)    <> 'array' then raise exception 'INVALID_PAYLOAD: weeks_to_delete doit être un tableau'; end if;
  if jsonb_typeof(v_weeks_to_create)    <> 'array' then raise exception 'INVALID_PAYLOAD: weeks_to_create doit être un tableau'; end if;
  if jsonb_typeof(v_sessions_to_delete) <> 'array' then raise exception 'INVALID_PAYLOAD: sessions_to_delete doit être un tableau'; end if;
  if jsonb_typeof(v_sessions_to_create) <> 'array' then raise exception 'INVALID_PAYLOAD: sessions_to_create doit être un tableau'; end if;
  if jsonb_typeof(v_sessions_to_update) <> 'array' then raise exception 'INVALID_PAYLOAD: sessions_to_update doit être un tableau'; end if;
  if v_patch is not null and jsonb_typeof(v_patch) <> 'object' then
    raise exception 'INVALID_PAYLOAD: program_patch doit être un objet';
  end if;

  -- ── 2. Verrou de programme + appartenance ─────────────────────────────────
  -- ⚠️ CE `FOR UPDATE` FAIT DEUX CHOSES, ET LES DEUX COMPTENT.
  --   1. il sérialise les enregistrements concurrents de la MÊME programmation
  --      (deux coachs, deux onglets) : le second attend, puis se heurte au
  --      verrou optimiste plutôt que d'écraser ;
  --   2. il prouve que le programme est VISIBLE sous la RLS de l'appelant —
  --      `not found` ici vaut « inconnu ou hors périmètre », sans distinguer
  --      les deux (ne pas révéler l'existence d'un programme d'un autre coach).
  select updated_at into v_current_program_updated_at
    from public.programs
   where id = v_program_id
   for update;
  if not found then
    raise exception 'PROGRAM_NOT_FOUND_OR_FORBIDDEN';
  end if;

  -- ── 3. Verrou optimiste de TÊTE (facultatif mais recommandé) ──────────────
  -- Absent de la charge = pas de contrôle, pour ne pas imposer le verrou à un
  -- appelant qui ne porte pas de snapshot. Présent = la tête n'a pas bougé
  -- depuis le chargement, sinon on refuse AVANT toute écriture. C'est la
  -- protection qui manquait : l'`UPDATE programs` de l'ancien chemin n'avait
  -- aucun verrou, et le dernier qui écrivait gagnait en silence.
  if (p_payload ? 'expected_program_updated_at')
     and (p_payload->>'expected_program_updated_at') is not null then
    v_expected_program_updated_at := (p_payload->>'expected_program_updated_at')::timestamptz;
    if v_current_program_updated_at is distinct from v_expected_program_updated_at then
      raise exception 'STALE_TRAINING_PROGRAM';
    end if;
  end if;

  -- ── 4. Tête du programme ──────────────────────────────────────────────────
  -- Seules les clés PRÉSENTES sont écrites : une charge qui ne porte que des
  -- séances ne touche pas la tête. `owner_student_id` et `source_template_id`
  -- ne figurent dans aucun cas — une copie individuelle reste possédée et
  -- rattachée, comme dans l'ancien `updateProgram`.
  if v_patch is not null and v_patch <> '{}'::jsonb then
    if exists (
      select 1 from jsonb_object_keys(v_patch) k
       where k not in ('name','goal','level','duration_weeks','description','status',
                       'banner_url','program_mode','group_start_date','is_public',
                       'public_subscription_template_id')
    ) then
      raise exception 'INVALID_PAYLOAD: clé de program_patch non autorisée';
    end if;

    update public.programs
       set name    = case when v_patch ? 'name'    then coalesce(v_patch->>'name', name)   else name end,
           goal    = case when v_patch ? 'goal'    then coalesce(v_patch->>'goal', goal)   else goal end,
           level   = case when v_patch ? 'level'   then coalesce(v_patch->>'level', level) else level end,
           duration_weeks = case when v_patch ? 'duration_weeks' then (v_patch->>'duration_weeks')::int else duration_weeks end,
           description    = case when v_patch ? 'description' then coalesce(v_patch->>'description', description) else description end,
           status         = case when v_patch ? 'status' then coalesce(v_patch->>'status', status) else status end,
           banner_url     = case when v_patch ? 'banner_url' then nullif(v_patch->>'banner_url', '') else banner_url end,
           program_mode   = case when v_patch ? 'program_mode' then coalesce(v_patch->>'program_mode', program_mode) else program_mode end,
           group_start_date = case when v_patch ? 'group_start_date' then nullif(v_patch->>'group_start_date','')::date else group_start_date end,
           is_public        = case when v_patch ? 'is_public' then (v_patch->>'is_public')::boolean else is_public end,
           public_subscription_template_id = case
             when v_patch ? 'public_subscription_template_id'
             then nullif(v_patch->>'public_subscription_template_id','')::uuid
             else public_subscription_template_id end,
           updated_at = now()
     where id = v_program_id
     returning updated_at into v_new_program_updated_at;

    -- ⚠️ 0 LIGNE MODIFIÉE = ÉCHEC NET, AVANT TOUTE STRUCTURE. Incident du
    -- 02/08/2026 : sous RLS, un UPDATE sans droits d'écriture ne renvoie NI
    -- erreur NI ligne. L'étape 2 a prouvé la LECTURE ; elle ne prouve pas
    -- l'ÉCRITURE (un collaborateur en lecture seule sur `entrainement` passe
    -- l'une et pas l'autre). On refuse ici plutôt que d'enchaîner sur une
    -- cascade de NOT_AUTHORIZED derrière un message générique.
    if v_new_program_updated_at is null then
      raise exception 'PROGRAM_HEAD_NOT_WRITABLE';
    end if;
  else
    v_new_program_updated_at := v_current_program_updated_at;
  end if;

  -- ── 5. Semaines retirées — suppression EXPLICITE, par numéro ──────────────
  -- La cascade emporte séances, blocs, exercices et prescriptions de ces
  -- semaines. C'est irréversible, et c'est pour cela que le client demande une
  -- confirmation AVANT d'inscrire un numéro ici.
  for v_element in select * from jsonb_array_elements(v_weeks_to_delete) loop
    if jsonb_typeof(v_element) <> 'number' then
      raise exception 'INVALID_PAYLOAD: weeks_to_delete doit ne contenir que des numéros de semaine';
    end if;
    v_week_number := (v_element #>> '{}')::int;
    delete from public.program_weeks
     where program_id = v_program_id and week_number = v_week_number;
  end loop;

  -- ── 6. Semaines ajoutées ──────────────────────────────────────────────────
  -- `on conflict do nothing` sur (program_id, week_number) : la clé unique
  -- existe, et une semaine déjà présente n'est pas une erreur — c'est un
  -- client qui a vu la base dans un état un peu ancien. On récupère son id
  -- dans les deux cas pour que les séances puissent s'y rattacher.
  for v_element in select * from jsonb_array_elements(v_weeks_to_create) loop
    if jsonb_typeof(v_element) <> 'number' then
      raise exception 'INVALID_PAYLOAD: weeks_to_create ne doit contenir que des numéros de semaine';
    end if;
    v_week_number := (v_element #>> '{}')::int;

    insert into public.program_weeks (program_id, week_number)
    values (v_program_id, v_week_number)
    on conflict (program_id, week_number) do nothing
    returning id into v_week_id;

    if v_week_id is null then
      select id into v_week_id from public.program_weeks
       where program_id = v_program_id and week_number = v_week_number;
    end if;
    if v_week_id is null then
      -- Ni insérée ni retrouvée : la policy INSERT a refusé. Nommer la semaine
      -- plutôt que laisser ses séances tomber en silence (ancien comportement :
      -- `continue`, puis séance traitée comme neuve, puis vraie ligne supprimée).
      raise exception 'WEEK_INSERT_FAILED: %', v_week_number;
    end if;
    v_week_map := v_week_map || jsonb_build_object(v_week_number::text, v_week_id);
    v_week_id := null;
  end loop;

  -- ── 7. Séances retirées — suppression EXPLICITE, par identifiant ──────────
  for v_element in select * from jsonb_array_elements(v_sessions_to_delete) loop
    if (v_element #>> '{}') !~* c_uuid_re then
      raise exception 'INVALID_PAYLOAD: sessions_to_delete ne doit contenir que des UUID';
    end if;
    v_session_ids_to_delete := v_session_ids_to_delete || (v_element #>> '{}')::uuid;
  end loop;
  if array_length(v_session_ids_to_delete, 1) is not null then
    -- Borné au programme : une charge ne peut pas supprimer la séance d'un
    -- autre programme, même si la RLS l'y autorisait par ailleurs.
    delete from public.workout_sessions
     where id = any(v_session_ids_to_delete) and program_id = v_program_id;
  end if;

  -- ── 8. Séances créées ─────────────────────────────────────────────────────
  for v_element in select * from jsonb_array_elements(v_sessions_to_create) loop
    v_cle := coalesce(v_element->>'client_id', '(sans clé)');
    v_week_number := (v_element->>'week_number')::int;
    if v_week_number is null then
      raise exception 'INVALID_PAYLOAD: week_number manquant pour la séance %', v_cle;
    end if;

    -- La semaine vient du lot créé à l'étape 6, sinon de la base.
    v_week_id := nullif(v_week_map->>v_week_number::text, '')::uuid;
    if v_week_id is null then
      select id into v_week_id from public.program_weeks
       where program_id = v_program_id and week_number = v_week_number;
    end if;
    if v_week_id is null then
      raise exception 'WEEK_MISSING: %', v_week_number;
    end if;

    -- `is_rest_day` et `session_type` sont posés provisoirement ; l'appel au
    -- moteur, juste après, les DÉRIVE des blocs et écrase ces valeurs. On ne
    -- les laisse pas à la charge du client : les blocs sont la source de vérité.
    insert into public.workout_sessions
      (program_id, program_week_id, day, is_rest_day, name, muscle_group,
       duration_minutes, warmup, coach_notes, session_type, banner_url)
    values
      (v_program_id, v_week_id,
       coalesce(v_element->>'day', ''),
       coalesce((v_element->>'is_rest_day')::boolean, false),
       coalesce(v_element->>'name', ''),
       coalesce(v_element->>'muscle_group', ''),
       (v_element->>'duration_minutes')::int,
       coalesce(v_element->>'warmup', ''),
       coalesce(v_element->>'coach_notes', ''),
       coalesce(nullif(v_element->>'session_type',''), 'strength'),
       nullif(v_element->>'banner_url', ''))
    returning id, updated_at into v_session_id, v_inserted_updated_at;

    if v_session_id is null then
      raise exception 'SESSION_INSERT_FAILED: %', v_cle;
    end if;

    -- Contenu de la séance neuve, s'il y en a : le moteur, avec le `updated_at`
    -- EXACT de l'INSERT comme verrou (jamais un instantané client, qui ne peut
    -- pas connaître cette valeur).
    if jsonb_typeof(coalesce(v_element->'blocks','[]'::jsonb)) = 'array'
       and jsonb_array_length(coalesce(v_element->'blocks','[]'::jsonb)) > 0 then
      begin
        v_un := public.save_training_session_blocks(jsonb_build_object(
          'session_id', v_session_id,
          'expected_updated_at', v_inserted_updated_at,
          'blocks', v_element->'blocks'
        ));
      exception when others then
        raise exception 'SESSION_FAILED %: %', v_cle, sqlerrm;
      end;
    else
      -- Aucun bloc : jour de repos. Le moteur n'a rien à écrire, mais
      -- `session_type`/`is_rest_day` doivent refléter ce vide.
      update public.workout_sessions
         set is_rest_day = true, session_type = 'strength', updated_at = now()
       where id = v_session_id
       returning updated_at into v_inserted_updated_at;
      v_un := jsonb_build_object(
        'session_id', v_session_id, 'updated_at', v_inserted_updated_at,
        'session_type', 'rest', 'blocks', '[]'::jsonb,
        'id_mapping', jsonb_build_object('blocks', '{}'::jsonb, 'exercises', '{}'::jsonb),
        'warnings', jsonb_build_object('detached_exercise_feedback_count', 0));
    end if;

    v_resultats := v_resultats || jsonb_build_array(
      v_un || jsonb_build_object('client_id', v_element->>'client_id', 'created', true));
    v_total_seances := v_total_seances + 1;
    v_week_id := null;
    v_session_id := null;
  end loop;

  -- ── 9. Séances modifiées ──────────────────────────────────────────────────
  -- ⚠️ SEULES CELLES QUE LE CLIENT A DÉCLARÉES MODIFIÉES. Une séance absente
  -- de cette liste n'est pas lue, pas écrite, pas touchée : ses identifiants,
  -- son contenu et son `updated_at` restent tels quels. C'est ce qui fait
  -- passer un changement de nom de 84 écritures à une seule — et ce qui évite
  -- de réveiller 84 fois l'abonnement Realtime des élèves.
  for v_element in select * from jsonb_array_elements(v_sessions_to_update) loop
    v_cle := coalesce(v_element->>'session_id', '(sans identifiant)');
    if (v_element->>'session_id') is null or (v_element->>'session_id') !~* c_uuid_re then
      raise exception 'INVALID_PAYLOAD: session_id mal formé dans sessions_to_update (%)', v_cle;
    end if;
    if (v_element->>'expected_updated_at') is null then
      raise exception 'INVALID_PAYLOAD: expected_updated_at manquant pour la séance %', v_cle;
    end if;

    -- Bornage au programme : la charge ne peut pas détourner le moteur vers une
    -- séance d'un AUTRE programme. La RLS l'interdirait hors périmètre, mais
    -- deux programmes du même coach sont tous deux dans son périmètre — seule
    -- cette vérification empêche d'écrire dans le mauvais.
    perform 1 from public.workout_sessions
      where id = (v_element->>'session_id')::uuid and program_id = v_program_id;
    if not found then
      raise exception 'SESSION_FAILED %: séance absente de ce programme', v_cle;
    end if;

    /*
     * ⚠️ `session_patch` N'EST AJOUTÉ QUE S'IL EXISTE VRAIMENT, et l'oubli
     * était un défaut net — trouvé par la section I de
     * `save_training_program_sessions_checklist.sql`, pas par relecture.
     *
     * `v_element->'session_patch'` rend le jsonb `null` quand la clé est
     * absente, et `jsonb_build_object('session_patch', <jsonb null>)` produit
     * `{"session_patch": null}` — une clé PRÉSENTE valant null. Le moteur teste
     * alors `v_patch is not null` (vrai, c'est un jsonb `null`, pas un SQL
     * NULL) puis `jsonb_typeof(v_patch) <> 'object'` (vrai) et lève
     * `INVALID_SESSION_PATCH`. Autrement dit : TOUTE séance modifiée sans
     * métadonnées échouait, alors que c'est un cas parfaitement légitime
     * (ne changer que le contenu des blocs).
     */
    v_charge_seance := jsonb_build_object(
      'session_id', v_element->>'session_id',
      'expected_updated_at', v_element->>'expected_updated_at',
      'blocks', coalesce(v_element->'blocks', '[]'::jsonb)
    );
    if jsonb_typeof(coalesce(v_element->'session_patch', 'null'::jsonb)) = 'object' then
      v_charge_seance := v_charge_seance || jsonb_build_object('session_patch', v_element->'session_patch');
    end if;

    begin
      v_un := public.save_training_session_blocks(v_charge_seance);
    exception when others then
      -- La cause EXACTE du moteur est conservée (STALE_TRAINING_SESSION,
      -- FOREIGN_BLOCK_ID, NOT_AUTHORIZED…) et préfixée par la séance fautive.
      raise exception 'SESSION_FAILED %: %', v_cle, sqlerrm;
    end;

    v_resultats := v_resultats || jsonb_build_array(
      v_un || jsonb_build_object('client_id', v_element->>'client_id', 'created', false));
    v_total_seances := v_total_seances + 1;
  end loop;

  -- ── 10. Compte rendu ──────────────────────────────────────────────────────
  -- Le client en a besoin pour reconverger sans relire : nouveaux `updated_at`
  -- (prochains verrous), UUID réels des blocs et exercices créés
  -- (`id_mapping`), identifiants des semaines créées.
  select count(*) into v_n from public.program_weeks where program_id = v_program_id;

  return jsonb_build_object(
    'program_id', v_program_id,
    'program_updated_at', v_new_program_updated_at,
    'weeks', v_week_map,
    'week_count', v_n,
    'sessions', v_resultats,
    'session_count', v_total_seances
  );
end;
$fn$;

comment on function public.save_training_program_sessions(jsonb) is
  'Enregistrement GROUPÉ et ATOMIQUE d''une programmation : tête, semaines, séances créées/supprimées et séances modifiées en UNE transaction et UN aller-retour. Délègue le contenu de chaque séance à save_training_session_blocks (règles métier inchangées). security invoker : la RLS et le périmètre collaborateur s''appliquent intégralement. Suppressions EXPLICITES : une séance absente de la charge est inchangée, jamais supprimée. Voir l''en-tête de la migration 20261027090000.';

-- Mêmes droits que le moteur par séance : jamais public, jamais anon.
revoke execute on function public.save_training_program_sessions(jsonb) from public;
revoke execute on function public.save_training_program_sessions(jsonb) from anon;
grant execute on function public.save_training_program_sessions(jsonb) to authenticated;

-- ── VÉRIFICATION FINALE ─────────────────────────────────────────────────────
do $verif$
declare v_n int; v_prov text; v_sec boolean; v_path text;
begin
  -- 1. La fonction existe, avec la bonne signature.
  --    ⚠️ `pg_get_function_identity_arguments` rend « p_payload jsonb », AVEC
  --    le nom du paramètre — pas « jsonb ». On compare donc le TYPE, par son
  --    oid, ce qui ne dépend ni du nom du paramètre ni de son formatage.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_program_sessions'
     and p.pronargs = 1
     and p.proargtypes[0] = 'jsonb'::regtype;
  if v_n <> 1 then raise exception 'save_training_program_sessions(jsonb) absente (% trouvée(s))', v_n; end if;

  -- 2. `security invoker` — la RLS DOIT s'appliquer. Un passage en DEFINER
  --    supprimerait silencieusement l'isolation entre coachs.
  select p.prosecdef into v_sec from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_program_sessions';
  if v_sec then raise exception 'save_training_program_sessions est SECURITY DEFINER : la RLS serait contournée'; end if;

  -- 3. `search_path` figé : une fonction sans search_path explicite est
  --    détournable par un schéma temporaire de l'appelant.
  select array_to_string(p.proconfig, ',') into v_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_program_sessions';
  if v_path is null or v_path not like 'search_path=%' then
    raise exception 'save_training_program_sessions sans search_path figé (%)', coalesce(v_path, '(null)');
  end if;

  -- 4. Droits : révoquée pour public et anon, accordée à authenticated.
  if has_function_privilege('public', 'public.save_training_program_sessions(jsonb)', 'execute') then
    raise exception 'save_training_program_sessions exécutable par public';
  end if;
  if has_function_privilege('anon', 'public.save_training_program_sessions(jsonb)', 'execute') then
    raise exception 'save_training_program_sessions exécutable par anon';
  end if;
  if not has_function_privilege('authenticated', 'public.save_training_program_sessions(jsonb)', 'execute') then
    raise exception 'save_training_program_sessions NON exécutable par authenticated';
  end if;

  -- 5. Le moteur par séance est TOUJOURS là, inchangé : cette migration ne le
  --    remplace pas, elle l'appelle. S'il disparaissait, la fonction groupée
  --    perdrait toutes ses validations métier d'un coup.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_session_blocks';
  if v_n <> 1 then raise exception 'save_training_session_blocks introuvable : la fonction groupée en dépend'; end if;

  select p.prosecdef into v_sec from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_session_blocks';
  if v_sec then raise exception 'save_training_session_blocks est devenue SECURITY DEFINER'; end if;

  raise notice '20261027090000 — 6 contrôles sur 6 verts (RPC groupée posée, security invoker, droits bornés, moteur par séance intact)';
end
$verif$;
