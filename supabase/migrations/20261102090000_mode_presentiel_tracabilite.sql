-- ════════════════════════════════════════════════════════════════════════════
-- MODE PRÉSENTIEL — TRAÇABILITÉ DE L'AUTEUR D'UNE SAISIE DE SÉANCE
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE MIGRATION FAIT
--
--   1. Trois colonnes sur `workout_feedback` : `saisie_mode`, `saisie_par`,
--      `saisie_le`.
--   2. Une réécriture de `enforce_workout_feedback_write()` qui les DÉRIVE.
--
-- CE QU'ELLE NE FAIT PAS, ET C'EST VOLONTAIRE
--
--   · Aucune policy RLS n'est touchée. Le staff pouvait DÉJÀ écrire le retour
--     d'un de ses élèves : `workout_feedback_student_or_staff_insert` accepte
--     `student_id in (select public.student_ids_entrainement_ecriture())`
--     depuis 20261011100000. Le mode présentiel n'ouvre aucun droit nouveau —
--     il se contente d'utiliser un droit existant depuis une interface faite
--     pour, et de laisser une trace de qui s'en est servi.
--   · Aucune donnée n'est réécrite. Voir « anciennes lignes » plus bas.
--   · Aucun index : ces colonnes ne servent qu'à l'affichage d'une ligne déjà
--     trouvée par ses clés existantes. Un index sur `saisie_par` se justifiera
--     le jour où l'on voudra « toutes les séances saisies par ce coach » ;
--     l'ajouter avant ce besoin coûterait des écritures sans rien rendre.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LES ANCIENNES LIGNES RESTENT À NULL, ET CE N'EST PAS UN OUBLI
-- ════════════════════════════════════════════════════════════════════════════
-- Il aurait été facile d'écrire `default 'autonome'` et de déclarer tout
-- l'historique autonome. Ce serait même factuellement probable : avant ce lot,
-- aucune interface ne permettait à un coach de saisir une séance.
--
-- Mais « probablement vrai » n'est pas « enregistré ». Remplir la colonne pour
-- l'historique inventerait une donnée que personne n'a observée, et la rendrait
-- indiscernable d'une trace réelle. NULL dit exactement ce qu'on sait : rien.
-- L'application l'affiche « non renseigné », et c'est honnête.
--
-- Si tu préfères le contraire, une seule ligne suffit, à exécuter séparément
-- et en connaissance de cause :
--     update public.workout_feedback set saisie_mode = 'autonome'
--      where saisie_mode is null;
--
-- ────────────────────────────────────────────────────────────────────────────
-- MATRICE DE PROPRIÉTÉ — SUITE DE CELLE DE 20260821090000
-- ────────────────────────────────────────────────────────────────────────────
-- A = écrit par l'élève · B = dérivé par la base · C = réservé au staff
-- D = figé après création
--
-- ⚠️ CE BLOC N'EST PAS DÉCORATIF. `scripts/tests/training-movement-patterns.mts`
-- (contrôle BB1) exige que CHAQUE colonne des trois tables de retour soit
-- classée quelque part dans cette matrice, qui s'étend d'une migration à la
-- suivante — une migration appliquée est immuable, donc une colonne ajoutée
-- aujourd'hui se classe ici, dans la migration qui l'ajoute.
--
-- workout_feedback (suite)
--   saisie_mode                     B     dérivé : 'autonome' si l'auteur est
--                                         l'élève de la ligne, 'presentiel'
--                                         sinon, NULL pour une écriture
--                                         système. La valeur reçue n'est pas
--                                         comparée, elle est REMPLACÉE.
--   saisie_par                      B     dérivé de auth.uid(). Un client ne
--                                         peut donc pas s'attribuer — ni
--                                         attribuer à autrui — une saisie.
--   saisie_le                       B     dérivé de now(), au même moment.
--                                         Distinct de submitted_at, qui ne
--                                         bouge pas sur une action de coach.
--
-- ⚠️ ET CES TROIS COLONNES NE SONT PAS « D ». Elles se RECALCULENT à chaque
-- modification du réalisé — c'est le propre d'une trace de dernière saisie.
-- Elles sont en revanche CONSERVÉES telles quelles sur toute autre écriture
-- (réponse de coach, passage en « traité »), sans quoi marquer un retour
-- comme lu attribuerait au coach la saisie de son élève.
--

-- ════════════════════════════════════════════════════════════════════════════
-- LE RISQUE DE CETTE MIGRATION, NOMMÉ
-- ════════════════════════════════════════════════════════════════════════════
-- Elle remplace une fonction `security definer` qui garde déjà toutes les
-- règles d'écriture du retour de séance : immuabilité du snapshot du prescrit,
-- colonnes figées, appartenance de la séance, dérivation des métadonnées,
-- horodatages, réponse vidéo et protection des colonnes de coach.
--
-- ⚠️ LE CORPS CI-DESSOUS EST CELUI DE L'ÉTAT RÉEL DE LA BASE, PAS CELUI DU
-- DERNIER `create or replace` VISIBLE DANS LE DÉPÔT. La distinction a coûté
-- une régression de sécurité, trouvée en revue :
--
--   · le dernier fichier qui écrit `create or replace function
--     public.enforce_workout_feedback_write` est 20260827090000_coach_reply_
--     video.sql, et il porte encore `v_staff := … is_coach_or_admin()` ;
--   · mais 20261011110000_p13b_durcissement_fonctions_definer.sql réécrit la
--     fonction DYNAMIQUEMENT — il lit `prosrc`, substitue cette seule ligne
--     d'autorisation par le prédicat de catégorie, et repose
--     `search_path = public, pg_temp`. Aucun grep sur `create or replace
--     function public.enforce_workout_feedback_write` ne le trouve.
--
-- Reprendre 20260827090000 « mot pour mot » annulait donc P13-B en silence.
-- Le corps ci-dessous part de l'état réel, vérifié à l'octet près contre la
-- production (empreinte md5 du corps : 164e356683f7098cbc8567736d37a160).
-- Seules trois choses y sont ajoutées : la variable `v_saisie`, le bloc « MP »
-- et rien d'autre ; `v_staff` et `search_path` sont ceux de P13-B.
--
-- DEUX CONTRÔLES ENCADRENT CE REMPLACEMENT, et ils ne disent pas la même
-- chose : le bloc A refuse de partir d'une fonction qui ne serait pas celle
-- dont ce texte dérive, le bloc Z refuse d'arriver à une fonction qui aurait
-- perdu une garde, changé de search_path, ou vu revenir `is_coach_or_admin()`.
-- ════════════════════════════════════════════════════════════════════════════


-- ── A0. UN OUTIL POUR LES CONTRÔLES : LE CODE SANS SA PROSE ────────────────
--
-- ⚠️ SANS LUI, LES CONTRÔLES SE MORDENT EUX-MÊMES. `pg_get_functiondef()` rend
-- le corps AVEC ses commentaires, et le corps de cette fonction EXPLIQUE
-- longuement pourquoi `is_coach_or_admin()` ne doit pas y revenir. Un contrôle
-- qui cherche « is_coach_or_admin » dans le texte brut le trouve donc — dans
-- l'explication, pas dans le code — et échoue. C'est arrivé au premier essai.
--
-- Interdire d'EXPLIQUER un piège force à effacer la mémoire du piège. On
-- retire donc la prose avant toute affirmation d'absence, et on la garde.
--
-- ⚠️ CRÉÉE DANS `pg_temp`, PAS DANS `public`. La première version vivait dans
-- `public` et se supprimait en fin de fichier — ce qui marche quand tout se
-- passe bien, et laisse une fonction orpheline dans le schéma dès que le bloc
-- A refuse de poursuivre (une migration n'est pas forcément rejouée dans une
-- transaction). `pg_temp` disparaît avec la session, succès ou échec, et ne
-- demande aucun nettoyage.
create function pg_temp._mp_code_seul(p_src text)
returns text language sql immutable as $cs$
  -- Les blocs /* … */ d'abord (non gourmand), les lignes -- ensuite.
  select regexp_replace(regexp_replace(p_src, '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g')
$cs$;


-- ── A. CONTRÔLE AVANT ───────────────────────────────────────────────────────
-- On refuse de s'exécuter sur une base qui n'est pas celle qu'on croit : sans
-- la fonction d'origine, la « réécriture » ci-dessous créerait une fonction
-- neuve amputée de tout ce qu'elle était censée conserver.
do $$
begin
  if to_regclass('public.workout_feedback') is null then
    raise exception 'PRÉALABLE MANQUANT — table public.workout_feedback absente';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
  ) then
    raise exception 'PRÉALABLE MANQUANT — fonction enforce_workout_feedback_write() absente';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgname = 'enforce_workout_feedback_write'
       and tgrelid = 'public.workout_feedback'::regclass
  ) then
    raise exception 'PRÉALABLE MANQUANT — trigger enforce_workout_feedback_write absent';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'current_student_id'
  ) then
    raise exception 'PRÉALABLE MANQUANT — fonction current_student_id() absente';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'categories_ecriture'
  ) then
    raise exception 'PRÉALABLE MANQUANT — fonction categories_ecriture() absente (P13-B non appliqué)';
  end if;

  /*
   * ⚠️ LA FONCTION REMPLACÉE EST-ELLE CELLE QU'ON CROIT ?
   *
   * C'est la précondition qui manquait, et son absence a coûté une régression.
   * Cette migration ne « modifie » pas la fonction : elle en REMPLACE le corps
   * entier par un texte figé dans ce fichier. Ce texte n'est juste que si la
   * version en place est bien celle dont il dérive. Si quoi que ce soit l'a
   * fait évoluer entre-temps — et c'est précisément ce qui est arrivé :
   * 20261011110000 la réécrit dynamiquement, sans qu'aucun
   * `create or replace function` ne soit visible au grep — alors remplacer
   * revient à ANNULER cette évolution en silence.
   *
   * On exige donc EXACTEMENT UNE occurrence du prédicat P13-B et ZÉRO de
   * `is_coach_or_admin()`, et on refuse d'aller plus loin sinon. Zéro
   * occurrence voudrait dire que la fonction a changé sous nos pieds ;
   * plusieurs, que la décision d'autorisation est prise à plusieurs endroits
   * et que ce fichier n'en reflète qu'un. C'est le même garde-fou que P13-B
   * s'était donné — en mieux : il regarde aussi ce qui ne doit PAS être là.
   */
  declare
    v_src    text;
    v_motif  constant text :=
      'v_staff := (not v_systeme) and (''entrainement'' in (select public.categories_ecriture()));';
    v_n      int;
  begin
    select pg_temp._mp_code_seul(p.prosrc) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
       and p.prokind = 'f';

    v_n := (length(v_src) - length(replace(v_src, v_motif, ''))) / length(v_motif);
    if v_n <> 1 then
      raise exception
        'PRÉALABLE INATTENDU — enforce_workout_feedback_write() porte % occurrence(s) du prédicat P13-B, 1 exigée. La version en place n''est pas celle dont dérive cette migration : la remplacer annulerait une évolution. Migration interrompue.', v_n;
    end if;

    if position('is_coach_or_admin' in v_src) > 0 then
      raise exception
        'PRÉALABLE INATTENDU — enforce_workout_feedback_write() oppose encore is_coach_or_admin() : l''invariant P13-B est déjà rompu avant cette migration. Migration interrompue.';
    end if;

    -- Le search_path de départ est celui que P13-B a posé : on le conserve,
    -- donc on vérifie qu'on part bien de là.
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
         and array_to_string(coalesce(p.proconfig, '{}'), ',') = 'search_path=public, pg_temp'
    ) then
      raise exception
        'PRÉALABLE INATTENDU — le search_path de enforce_workout_feedback_write() n''est pas « public, pg_temp ». Migration interrompue.';
    end if;
  end;
end $$;


-- ── B. LES TROIS COLONNES ───────────────────────────────────────────────────
-- `saisie_mode` est NULLABLE et sans défaut : voir l'en-tête. La contrainte
-- n'autorise que deux valeurs lorsqu'elle est renseignée.
--
-- `on delete set null` sur `saisie_par` : supprimer un compte coach ne doit ni
-- échouer, ni détruire le retour de l'élève. On perd alors le QUI ; `saisie_le`
-- et `saisie_mode` restent, et c'est déjà beaucoup.
alter table public.workout_feedback
  add column if not exists saisie_mode text,
  add column if not exists saisie_par uuid references auth.users(id) on delete set null,
  add column if not exists saisie_le timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.workout_feedback'::regclass
       and conname = 'workout_feedback_saisie_mode_valide'
  ) then
    alter table public.workout_feedback
      add constraint workout_feedback_saisie_mode_valide
      check (saisie_mode is null or saisie_mode in ('autonome', 'presentiel'));
  end if;
end $$;

comment on column public.workout_feedback.saisie_mode is
  'Qui a saisi le réalisé : autonome (l''élève lui-même) ou presentiel (saisi pour lui). NULL = antérieur à la traçabilité, ou écriture système. Dérivé par enforce_workout_feedback_write().';
comment on column public.workout_feedback.saisie_par is
  'auth.users.id de l''auteur de la dernière saisie du réalisé. NULL pour une écriture système ou un compte supprimé.';
comment on column public.workout_feedback.saisie_le is
  'Date de la dernière saisie du réalisé. Distincte de submitted_at, qui ne bouge pas sur une action de coach.';


-- ── C. LA FONCTION, REPRISE INTÉGRALEMENT ───────────────────────────────────
create or replace function public.enforce_workout_feedback_write()
returns trigger
language plpgsql
security definer
-- ⚠️ `public, pg_temp`, ET PAS UNE CHAÎNE VIDE. P13-B a reposé ce search_path
-- sur les dix fonctions de portée, pg_temp EN DERNIER, et son contrôle G27 en
-- exige la valeur exacte. Une chaîne vide serait certes plus stricte, mais
-- elle contredirait silencieusement une décision prise ailleurs et ferait
-- rougir G27 : on ne change pas une convention au détour d'une migration qui
-- ne parle pas d'elle.
set search_path = public, pg_temp
as $$
declare
  v_staff boolean;
  v_systeme boolean;
  v_saisie boolean;
begin
  -- Contexte non-utilisateur (webhook, tâche service) : aucun claim JWT.
  v_systeme := auth.uid() is null or coalesce(auth.role(), '') = 'service_role';
  /*
   * ⚠️ PRÉDICAT D'AUTORISATION — CELUI DE P13-B, ET IL NE DOIT PAS CHANGER.
   *
   * La règle est « entraînement EN ÉCRITURE ». Elle est vraie pour
   * l'administrateur et l'assistant — comportement rigoureusement inchangé
   * pour eux — et fausse pour un collaborateur sans cette permission, qui
   * retombe alors sur le chemin élève. `v_staff` commande le droit d'écrire
   * `status` et `coach_reply`, de poser une réponse vidéo et son calque, et
   * de ne pas faire remonter `submitted_at`.
   *
   * ⚠️ NE PAS Y SUBSTITUER LE HELPER DE RÔLES GLOBAL DU SCHÉMA (celui que
   * 20261011110000 a retiré d'ici, et dont l'en-tête de ce fichier raconte
   * l'histoire). Il ne lit que `profiles.role`, qui vaut 'coach' pour TOUT le
   * staff non-admin, collaborateurs compris : il est donc vrai pour un
   * collaborateur sans aucune permission d'entraînement.
   *
   * ⚠️ ET SON NOM N'EST PAS ÉCRIT ICI, VOLONTAIREMENT. L'invariant posé par
   * 20261011110000 est TEXTUEL : aucune fonction `security definer` du schéma
   * `public` ne doit contenir cette chaîne, commentaires compris, et son
   * contrôle intégré lit `prosrc` brut. Un commentaire qui la citerait ferait
   * rougir l'invariant sans qu'aucune ligne de code ne soit en cause. Le bloc
   * Z de ce fichier reprend cette exigence à la lettre.
   */
  v_staff := (not v_systeme) and ('entrainement' in (select public.categories_ecriture()));

  -- ── D. Colonnes figées après création ────────────────────────────────────
  -- `session_id` et `program_id` portent un `on delete set null` : supprimer
  -- une séance ou un programme déclenche un UPDATE de cette ligne vers NULL.
  -- Les figer aveuglément ferait échouer la suppression sur une violation de
  -- clé étrangère — le coach ne pourrait plus supprimer une séance. La règle
  -- exacte est donc : ces colonnes ne peuvent que DISPARAÎTRE, jamais être
  -- repointées ailleurs.
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.student_id := old.student_id;
    new.session_key := old.session_key;
    new.created_at := old.created_at;
    -- Le libellé de la séance est une photographie, au même titre que
    -- `exercise_name` : renommer la séance ne réécrit pas l'histoire.
    new.session_ref_label := old.session_ref_label;
    if new.session_id is distinct from old.session_id and new.session_id is not null then
      new.session_id := old.session_id;
    end if;
    if new.program_id is distinct from old.program_id and new.program_id is not null then
      new.program_id := old.program_id;
    end if;
  end if;

  -- ── La séance visée doit RÉELLEMENT être celle de cet élève ──────────────
  -- Sans ce contrôle, un élève pouvait créer un retour pointant la séance
  -- d'un autre — et se voir construire le snapshot d'une prescription qui
  -- n'est pas la sienne. Le staff n'est pas dispensé : un retour rattaché à
  -- une séance étrangère n'a de sens pour personne.
  if tg_op = 'INSERT' and new.session_id is not null then
    if not public.student_owns_workout_session(new.student_id, new.session_id) then
      raise exception 'Retour refusé : cette séance n''appartient pas à cet élève (séance %)', new.session_id
        using errcode = 'insufficient_privilege';
    end if;

    -- ── C. Les métadonnées de la séance sont DÉRIVÉES, pas déclarées ───────
    -- Voir l'audit en tête de fichier. Ce que l'appelant a envoyé dans ces
    -- trois colonnes n'est pas comparé : il est REMPLACÉ. Aucun écart entre
    -- `session_id` et le reste n'est donc représentable en base.
    select s.program_id, s.name
      into new.program_id, new.session_ref_label
      from public.workout_sessions s
     where s.id = new.session_id;
    new.session_key := new.session_id::text;
  end if;

  -- ── C. Le snapshot est RECALCULÉ, jamais reçu ────────────────────────────
  -- La valeur envoyée par l'appelant n'est même pas lue. Universel : ni un
  -- élève, ni un coach, ni le service ne peuvent en fabriquer un. Une
  -- intervention volontaire passe par la désactivation explicite du trigger.
  if tg_op = 'INSERT' then
    new.prescribed_snapshot := case
      when new.completed and new.session_id is not null
        then public.build_prescribed_snapshot(new.session_id)
      else null
    end;
  else
    new.prescribed_snapshot := case
      -- Immuable dès qu'elle est posée (le trigger
      -- workout_feedback_snapshot_immutable reste le second verrou).
      when old.prescribed_snapshot is not null then old.prescribed_snapshot
      when new.completed and new.session_id is not null
        then public.build_prescribed_snapshot(new.session_id)
      else null
    end;
  end if;

  -- ── C. Horodatages ───────────────────────────────────────────────────────
  -- Une resoumission d'ÉLÈVE réactualise la date d'envoi. Une action de coach
  -- (marquer traité, répondre) ou une cascade technique (suppression d'une
  -- séance) ne doit pas faire remonter le retour en tête de file.
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.submitted_at := now();
  elsif v_systeme or v_staff then
    new.submitted_at := old.submitted_at;
  else
    new.submitted_at := now();
  end if;

  -- ── F5. La réponse vidéo doit être destinée à L'ÉLÈVE DE CE RETOUR ───────
  -- La RLS du bucket dit déjà à quel dossier un coach a le droit d'écrire.
  -- Ici on dit autre chose : que le chemin RATTACHÉ À CETTE LIGNE désigne
  -- bien son élève. Sans ce contrôle, un coach qui suit deux élèves pourrait
  -- coller sur le retour de l'un la réponse destinée à l'autre — les deux
  -- chemins lui étant légitimement ouverts côté Storage.
  if new.coach_reply_video_path is not null
     and split_part(new.coach_reply_video_path, '/', 1) is distinct from new.student_id::text then
    raise exception 'Réponse vidéo refusée : le chemin % ne désigne pas l''élève de ce retour', new.coach_reply_video_path
      using errcode = 'insufficient_privilege';
  end if;

  -- ── F5. RETIRER LA VIDÉO EMPORTE SON CALQUE ──────────────────────────────
  -- La contrainte `..._annotations_sans_video` interdit déjà un calque
  -- orphelin, mais elle le REFUSE : un appelant qui remet le chemin à NULL
  -- sans penser aux annotations verrait sa requête échouer. Or il y en aura —
  -- le balayeur de rétention en est un.
  --
  -- LA CONDITION EST ÉTROITE À DESSEIN : uniquement la TRANSITION d'un chemin
  -- vers NULL. Nettoyer dès que le chemin « se trouve être » NULL avalerait
  -- en silence un calque posé sur un retour qui n'a pas de vidéo — le coach
  -- verrait sa requête réussir et son travail disparaître. Là, la contrainte
  -- doit parler, et fort.
  if tg_op = 'UPDATE'
     and new.coach_reply_video_path is null
     and old.coach_reply_video_path is not null then
    new.coach_reply_video_annotations := null;
  end if;

  -- ── F5/B. `coach_reply_video_uploaded_at` est DÉRIVÉ, pour TOUT LE MONDE ──
  -- Y compris le staff : c'est cette date qui déclenche la purge à 3 jours.
  -- Qui pourrait l'écrire pourrait garder sa vidéo indéfiniment.
  --
  -- `clock_timestamp()` et non `now()`, pour la même raison qu'en F4 : `now()`
  -- rend l'heure de DÉBUT DE TRANSACTION, ce qui rend « la date a-t-elle été
  -- repoussée ? » invérifiable — un test passerait aussi bien si la règle
  -- était fausse.
  if tg_op = 'INSERT' then
    new.coach_reply_video_uploaded_at :=
      case when new.coach_reply_video_path is null then null else clock_timestamp() end;
  else
    new.coach_reply_video_uploaded_at := case
      when new.coach_reply_video_path is null then null
      when new.coach_reply_video_path is distinct from old.coach_reply_video_path then clock_timestamp()
      else old.coach_reply_video_uploaded_at
    end;
  end if;

  -- ── MP. TRAÇABILITÉ DE LA SAISIE (mode présentiel) ──────────────────────
  --
  -- ⚠️ LA RÈGLE N'INTERROGE AUCUN RÔLE, ET C'EST DÉLIBÉRÉ. On pourrait écrire
  -- « si l'auteur est du staff, alors présentiel » en s'appuyant sur le helper
  -- de rôles global du schéma — ce serait faux dès que le modèle de rôles
  -- bouge, et il a déjà bougé : P13-B a ajouté `coaches.role =
  -- 'collaborateur'`, que ce helper ne distingue pas. Une classification qui
  -- dépend d'un helper de rôles hérite de tous ses angles morts.
  -- (Son nom n'est pas épelé ici : voir le commentaire de `v_staff`.)
  --
  -- La question réellement posée est plus simple et ne peut pas se périmer :
  -- CELUI QUI ÉCRIT EST-IL L'ÉLÈVE DE CETTE LIGNE ? Si oui, saisie autonome.
  -- Sinon, quelqu'un d'autre l'a saisie pour lui — c'est le présentiel, quel
  -- que soit son rôle, aujourd'hui comme après le prochain lot de droits.
  -- `current_student_id()` rend NULL pour tout compte qui n'est pas un élève :
  -- coach autonome, admin de cabinet et collaborateur retombent donc tous
  -- les trois du bon côté, sans être énumérés.
  --
  -- ⚠️ CES TROIS COLONNES SONT DÉRIVÉES, JAMAIS REÇUES. Même doctrine que
  -- `prescribed_snapshot` et `coach_reply_video_uploaded_at` : ce que
  -- l'appelant a envoyé n'est pas comparé, il est REMPLACÉ. Une colonne de
  -- traçabilité qu'un client pourrait écrire ne tracerait rien.
  --
  -- ⚠️ UNE RÉPONSE DE COACH N'EST PAS UNE SAISIE. Marquer « traité », écrire
  -- une réponse ou déposer une vidéo sont des UPDATE sur cette table, et
  -- recalculer la trace à cette occasion attribuerait au coach la saisie de
  -- l'élève. On ne la recalcule donc que lorsque le RÉALISÉ change — les sept
  -- colonnes de performance, et elles seules.
  v_saisie := tg_op = 'INSERT' or (
       new.completed        is distinct from old.completed
    or new.global_rpe       is distinct from old.global_rpe
    or new.global_comment   is distinct from old.global_comment
    or new.pain             is distinct from old.pain
    or new.duration_minutes is distinct from old.duration_minutes
    or new.performed_at     is distinct from old.performed_at
    or new.session_status   is distinct from old.session_status
  );

  if v_saisie then
    new.saisie_par := auth.uid();
    /*
     * ⚠️ `clock_timestamp()` ET PAS `now()`, pour la raison que
     * `coach_reply_video_uploaded_at` documente déjà quelques lignes plus
     * haut : `now()` rend l'heure de DÉBUT DE TRANSACTION, identique pour
     * toutes les instructions d'une même transaction. « La date a-t-elle été
     * recalculée sur cette écriture-là ? » devient alors indécidable, et un
     * contrôle qui la pose passe aussi bien quand la règle est respectée que
     * quand elle est cassée — vérifié par sabotage pendant la revue.
     * `clock_timestamp()` avance à chaque instruction : la règle de
     * conservation ci-dessous devient observable.
     */
    new.saisie_le  := clock_timestamp();
    -- Écriture système (service_role, tâche, migration) : aucun humain
    -- derrière, donc aucun mode à affirmer. NULL dit « on ne sait pas », ce
    -- qui est exact ; `saisie_par is null` le rend d'ailleurs reconnaissable.
    new.saisie_mode := case
      when auth.uid() is null then null
      when new.student_id = public.current_student_id() then 'autonome'
      else 'presentiel'
    end;
  elsif tg_op = 'UPDATE' then
    -- ⚠️ RÈGLE INCHANGÉE, MAINTENANT OBSERVABLE. Une écriture qui ne touche
    -- pas au réalisé — marquer « traité », répondre, déposer une vidéo, une
    -- cascade technique — conserve la trace à l'identique. Avec
    -- `clock_timestamp()`, un `new.saisie_le := clock_timestamp()` glissé ici
    -- par erreur se verrait immédiatement (checklist, T7c).
    new.saisie_mode := old.saisie_mode;
    new.saisie_par  := old.saisie_par;
    new.saisie_le   := old.saisie_le;
  end if;

  -- ── B. Colonnes du coach ─────────────────────────────────────────────────
  if v_systeme or v_staff then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'a-traiter';
    new.coach_reply := '';
    new.session_status := case when new.completed then 'done' else null end;
    -- F5 : un élève ne se répond pas à lui-même, en vidéo pas plus qu'en texte.
    new.coach_reply_video_path := null;
    new.coach_reply_video_annotations := null;
    new.coach_reply_video_uploaded_at := null;
  else
    new.status := old.status;
    new.coach_reply := old.coach_reply;
    new.session_status := case when new.completed then 'done' else null end;
    -- F5 : restauré, jamais refusé — comme les autres colonnes de staff.
    -- L'UPDATE rapporte « 1 ligne » sans avoir rien changé : les tests
    -- mesurent donc la VALEUR, jamais le nombre de lignes.
    new.coach_reply_video_path := old.coach_reply_video_path;
    new.coach_reply_video_annotations := old.coach_reply_video_annotations;
    new.coach_reply_video_uploaded_at := old.coach_reply_video_uploaded_at;
  end if;

  return new;
end;
$$;


-- ── Z. CONTRÔLE APRÈS — la migration échoue si elle est incomplète ──────────
do $$
declare
  v_manque text := '';
  v_src    text;
  c        text;
begin
  foreach c in array array['saisie_mode', 'saisie_par', 'saisie_le'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'workout_feedback' and column_name = c
    ) then
      v_manque := v_manque || format(' colonne %s absente ;', c);
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.workout_feedback'::regclass
       and conname = 'workout_feedback_saisie_mode_valide'
  ) then
    v_manque := v_manque || ' contrainte de valeurs absente ;';
  end if;

  -- ⚠️ `v_src` EST LE CODE SEUL, SANS LA PROSE. Voir le bloc A0 : affirmer
  -- l'absence d'un motif dans un corps qui explique pourquoi ce motif est
  -- proscrit ne peut qu'échouer. Les chaînes de caractères du code, elles,
  -- sont conservées — un `raise exception '…'` reste vérifiable.
  select pg_temp._mp_code_seul(pg_get_functiondef(p.oid)) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write';

  -- ── Ce que la réécriture devait AJOUTER ─────────────────────────────────
  if v_src not like '%current_student_id()%' then
    v_manque := v_manque || ' trace absente de la fonction ;';
  end if;

  -- DÉRIVATION EXCLUSIVEMENT SERVEUR des trois colonnes. Les trois valeurs
  -- viennent de `auth.uid()`, de `clock_timestamp()` et d'une comparaison avec
  -- `current_student_id()` : rien de ce que l'appelant envoie n'est lu. Une
  -- affectation qui disparaîtrait rendrait la colonne correspondante
  -- librement écrivable par le client — et une colonne de traçabilité qu'un
  -- client peut écrire ne trace rien.
  if v_src not like '%new.saisie_par := auth.uid()%' then
    v_manque := v_manque || ' saisie_par non dérivée de auth.uid() ;';
  end if;
  if v_src not like '%new.saisie_le  := clock_timestamp()%' then
    v_manque := v_manque || ' saisie_le non dérivée de clock_timestamp() ;';
  end if;
  if v_src not like '%when new.student_id = public.current_student_id() then ''autonome''%' then
    v_manque := v_manque || ' règle de classement autonome/presentiel absente ;';
  end if;
  -- Et la règle de CONSERVATION, sans laquelle une réponse de coach
  -- attribuerait au coach la saisie de son élève.
  if v_src not like '%new.saisie_mode := old.saisie_mode%' then
    v_manque := v_manque || ' conservation de la trace sur UPDATE absente ;';
  end if;
  -- `now()` serait un retour en arrière : il rend la conservation
  -- invérifiable (voir le commentaire du bloc C).
  if v_src like '%new.saisie_le  := now()%' or v_src like '%new.saisie_le := now()%' then
    v_manque := v_manque || ' saisie_le repose sur now() au lieu de clock_timestamp() ;';
  end if;

  -- ── LE PRÉDICAT D'AUTORISATION P13-B ────────────────────────────────────
  -- Les deux sens, nommés séparément : « le bon prédicat est là » et « le
  -- mauvais n'est pas revenu ». Le second est celui qui a manqué.
  if v_src not like '%v_staff := (not v_systeme) and (''entrainement'' in (select public.categories_ecriture()))%' then
    v_manque := v_manque || ' prédicat P13-B (categories_ecriture) absent ;';
  end if;
  /*
   * ⚠️ CELLE-CI SE JUGE SUR LE TEXTE BRUT, PAS SUR LE CODE SEUL — et c'est le
   * seul contrôle de ce bloc dans ce cas.
   *
   * L'invariant de 20261011110000 est littéral : « plus aucune fonction
   * SECURITY DEFINER du schéma public ne doit opposer ce helper », et son
   * contrôle intégré lit `prosrc` SANS retirer les commentaires. Respecter
   * l'invariant « strictement » veut donc dire : la chaîne ne doit pas
   * apparaître du tout, pas même dans une explication. C'est pourquoi le
   * corps de la fonction ne l'épelle nulle part (voir le commentaire de
   * `v_staff`), et pourquoi ce contrôle-ci ne dé-prosifie pas.
   */
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
       and p.prosrc like '%is_coach_or' || '_admin%'
  ) then
    v_manque := v_manque || ' le helper de rôles global est revenu dans le gardien : invariant P13-B rompu ;';
  end if;

  -- Et l'invariant dans son ENSEMBLE, tel que 20261011110000 le formule :
  -- aucune fonction definer du schéma public, à part le helper lui-même.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
       and p.prosrc like '%is_coach_or' || '_admin%'
       and p.proname <> 'is_coach_or' || '_admin'
  ) then
    v_manque := v_manque || ' invariant P13-B rompu sur au moins une fonction definer ;';
  end if;

  -- ── LE search_path, À LA VALEUR EXACTE ──────────────────────────────────
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
       and array_to_string(coalesce(p.proconfig, '{}'), ',') = 'search_path=public, pg_temp'
  ) then
    v_manque := v_manque || ' search_path <> « public, pg_temp » ;';
  end if;

  -- ── SECURITY DEFINER ET PROPRIÉTAIRE ────────────────────────────────────
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
       and p.prosecdef
  ) then
    v_manque := v_manque || ' security definer perdu ;';
  end if;

  -- ⚠️ ET SURTOUT CE QU''ELLE DEVAIT CONSERVER. Une réécriture qui perdrait
  -- l''une de ces quatre règles ouvrirait un trou bien plus grave que le
  -- bénéfice de la traçabilité.
  if v_src not like '%build_prescribed_snapshot%' then
    v_manque := v_manque || ' snapshot du prescrit perdu ;';
  end if;
  if v_src not like '%student_owns_workout_session%' then
    v_manque := v_manque || ' contrôle d''appartenance de la séance perdu ;';
  end if;
  if v_src not like '%new.student_id := old.student_id%' then
    v_manque := v_manque || ' figement des colonnes perdu ;';
  end if;
  if v_src not like '%coach_reply_video_uploaded_at%' then
    v_manque := v_manque || ' dérivation de la date de vidéo perdue ;';
  end if;
  -- ⚠️ ET LE RESTE DES GARDES, UNE PAR UNE. La revue a montré qu'une liste de
  -- quatre laissait passer ce qu'elle ne nommait pas : on nomme donc tout ce
  -- que la fonction d'origine garantissait.
  if v_src not like '%new.id := old.id%'
     or v_src not like '%new.session_key := old.session_key%'
     or v_src not like '%new.created_at := old.created_at%'
     or v_src not like '%new.session_ref_label := old.session_ref_label%' then
    v_manque := v_manque || ' figement d''une colonne immuable perdu ;';
  end if;
  if v_src not like '%new.session_key := new.session_id::text%' then
    v_manque := v_manque || ' dérivation de session_key perdue ;';
  end if;
  if v_src not like '%old.prescribed_snapshot is not null then old.prescribed_snapshot%' then
    v_manque := v_manque || ' immuabilité du snapshot perdue ;';
  end if;
  if v_src not like '%new.status := old.status%' or v_src not like '%new.coach_reply := old.coach_reply%' then
    v_manque := v_manque || ' réservation des colonnes de coach perdue ;';
  end if;
  if v_src not like '%ne désigne pas l''''élève de ce retour%' then
    v_manque := v_manque || ' contrôle du chemin de réponse vidéo perdu ;';
  end if;
  if v_src not like '%clock_timestamp()%' then
    v_manque := v_manque || ' horodatage de la vidéo repassé à now() ;';
  end if;
  if v_src not like '%new.submitted_at := old.submitted_at%' then
    v_manque := v_manque || ' protection de submitted_at perdue ;';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'enforce_workout_feedback_write'
       and tgrelid = 'public.workout_feedback'::regclass
  ) then
    v_manque := v_manque || ' trigger détaché ;';
  end if;

  -- La fonction reste hors de portée des comptes authentifiés.
  if has_function_privilege('authenticated', 'public.enforce_workout_feedback_write()', 'execute') then
    v_manque := v_manque || ' privilege:authenticated ;';
  end if;
  if has_function_privilege('anon', 'public.enforce_workout_feedback_write()', 'execute') then
    v_manque := v_manque || ' privilege:anon ;';
  end if;

  -- ── AUCUNE POLICY, AUCUN PRIVILÈGE N'A CHANGÉ ───────────────────────────
  -- Cette migration n'en contient aucune instruction ; le vérifier sur la
  -- BASE est autre chose que le vérifier sur le texte. Les quatre policies de
  -- `workout_feedback` doivent être exactement celles de 20261011100000, et
  -- juger sur les mêmes ensembles.
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'workout_feedback') <> 4 then
    v_manque := v_manque || ' le nombre de policies de workout_feedback a changé ;';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'workout_feedback'
         and policyname in ('workout_feedback_student_or_staff_select',
                            'workout_feedback_student_or_staff_insert',
                            'workout_feedback_student_or_staff_update',
                            'workout_feedback_student_or_staff_delete')) <> 4 then
    v_manque := v_manque || ' une policy de workout_feedback a été renommée ou retirée ;';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'workout_feedback'
       and coalesce(qual, with_check) not like '%current_student_id()%'
  ) then
    v_manque := v_manque || ' une policy ne juge plus sur current_student_id() ;';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'workout_feedback'
         and coalesce(qual, with_check) like '%student_ids_entrainement_ecriture%') <> 3 then
    v_manque := v_manque || ' les trois policies d''écriture ne jugent plus sur student_ids_entrainement_ecriture() ;';
  end if;
  -- Les trois colonnes n'ont reçu AUCUN privilège propre : elles héritent de
  -- ceux de la table, comme `status`. Un `grant` nominatif ici serait une
  -- ouverture que la migration ne déclare pas.
  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'workout_feedback'
       and column_name in ('saisie_mode', 'saisie_par', 'saisie_le')
       and privilege_type in ('INSERT', 'UPDATE')
       and grantee not in (
         select grantee from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'workout_feedback'
            and column_name = 'status' and privilege_type in ('INSERT', 'UPDATE'))
  ) then
    v_manque := v_manque || ' les nouvelles colonnes portent un privilège que status n''a pas ;';
  end if;

  if v_manque <> '' then
    raise exception 'MIGRATION INCOMPLÈTE —%', v_manque;
  end if;
end $$;
