-- ============================================================================
-- A0 — LA CONSULTATION D'UN DOCUMENT SE MARQUE, ELLE NE S'ÉCRIT PLUS À LA MAIN
-- ============================================================================
--
-- ── CE QUE CETTE MIGRATION FAIT, EXACTEMENT ────────────────────────────────
--   1. remplace la policy UPDATE de `public.document_assignments` : l'élève
--      perd l'UPDATE direct, seul le staff le conserve ;
--   2. crée `public.mark_document_viewed(uuid)`, seule voie d'écriture de
--      `viewed_at` pour un élève ;
--   3. ferme cette fonction à `public` et `anon`, l'ouvre à `authenticated`
--      et à personne d'autre ;
--   4. retire `update` à `anon` sur la table (ce rôle ne peut plus satisfaire
--      aucune policy UPDATE, le privilège n'avait plus d'objet).
--
-- Rien d'autre. AUCUNE table créée ou modifiée, aucune colonne, aucun index,
-- aucun trigger, AUCUNE DONNÉE TOUCHÉE. `documents`, `document_levels`, le
-- bucket Storage et ses policies ne sont pas nommés une seule fois ici.
--
-- ── LE DÉFAUT CORRIGÉ ──────────────────────────────────────────────────────
-- La policy sortante portait cette intention en commentaire :
--
--     -- l'élève peut mettre à jour viewed_at (marquer un document comme consulté)
--     for update
--     using (student_id = public.current_student_id() or public.is_coach_or_admin())
--     with check (student_id = public.current_student_id() or public.is_coach_or_admin());
--
-- ⚠️ UNE POLICY NE RESTREINT PAS LES COLONNES. Ni `using` ni `with check` ne
-- disent quoi que ce soit de `viewed_at` : ils autorisent un UPDATE de la
-- LIGNE, donc de n'importe laquelle de ses colonnes. Le privilège de table le
-- confirmait :
--
--     authenticated → UPDATE sur created_at, document_id, id,
--                     manually_unlocked, student_id, unlock_at,
--                     updated_at, viewed_at
--
-- Deux conséquences réelles, atteignables par un simple appel à l'API REST
-- depuis le navigateur de l'élève :
--
--   · `update document_assignments set manually_unlocked = true` sur sa propre
--     ligne. `computeRealDocumentAvailability` (lib/supabase/documents.ts)
--     traite `manuallyUnlocked` en PRIORITÉ ABSOLUE et renvoie
--     `available: true` : le déblocage progressif est contourné. Et la policy
--     Storage `documents_bucket_select_accessible` signe le fichier, car elle
--     ne vérifie que l'EXISTENCE de la ligne d'assignation, jamais son
--     déblocage ;
--
--   · `update document_assignments set document_id = '<un autre document>'`.
--     `with check` n'impose que `student_id` : la ligne peut être repointée
--     vers un document jamais assigné, qui devient alors lisible — métadonnées
--     ET fichier, par la même policy Storage.
--
-- ── POURQUOI UNE FONCTION, ET PAS UNE POLICY PLUS FINE ─────────────────────
-- On pourrait écrire un `with check` qui compare chaque colonne sensible à sa
-- valeur courante. Ce serait exact, et illisible : quatre sous-requêtes
-- corrélées sur la ligne en cours de modification, à relire à chaque colonne
-- ajoutée à la table — et une colonne oubliée rouvre la faille en silence.
--
-- La fonction inverse la charge de la preuve : l'élève n'a plus AUCUN UPDATE,
-- et la seule écriture qui lui reste est celle qu'on a écrite. Une colonne
-- ajoutée demain à `document_assignments` est fermée par défaut.
--
-- ── CE QUE LA FONCTION NE FAIT PAS, ET C'EST VOULU ─────────────────────────
-- ⚠️ ELLE NE CRÉE JAMAIS DE LIGNE. Un document `visibility = 'global'` est
-- visible sans ligne d'assignation : l'UPDATE ne trouve rien, la fonction
-- renvoie `false`, et c'est tout. Un `insert … on conflict` serait exactement
-- le vecteur qu'on vient de fermer — l'élève se fabriquerait des assignations.
-- La consultation d'un document global reste donc NON SUIVIE tant que le coach
-- ne l'a pas assigné. C'est une limite assumée, pas un oubli.
--
-- ⚠️ ELLE N'ÉVALUE PAS LA DISPONIBILITÉ TEMPORELLE. Le déblocage
-- (niveau/semaines/date, `manually_unlocked`, `unlock_at`) est calculé côté
-- application — `computeDocumentAvailability` dans lib/admin.ts — comme tout
-- le reste de l'app. Le reproduire en SQL créerait deux règles destinées à
-- divergence. Conséquence connue : un élève qui appelle la fonction
-- directement peut horodater un document verrouillé qu'il n'a pas ouvert.
-- Cela SALIT une statistique ; cela n'accorde AUCUN accès — ni métadonnée, ni
-- fichier, ni déblocage. C'est la différence exacte avec le défaut corrigé
-- ci-dessus, et la raison pour laquelle on s'arrête là.
--
-- ⚠️ ELLE N'ÉCRASE JAMAIS LA PREMIÈRE DATE. `and viewed_at is null` dans le
-- `where` : la première consultation gagne, les suivantes ne font rien. La
-- fonction est donc idempotente, et son booléen de retour — `found` après
-- l'UPDATE — dit « c'était la première fois ». C'est ce booléen qui permet à
-- l'appelant de ne produire l'évènement `document_viewed` qu'UNE SEULE FOIS,
-- sans relecture et sans course entre deux onglets.
-- ============================================================================

-- ── 1. L'UPDATE DIRECT REDEVIENT UNE AFFAIRE DE STAFF ──────────────────────
-- L'ancienne policy est nommée ici pour être retirée, et seulement pour ça.
drop policy if exists "document_assignments_update_self_or_staff" on public.document_assignments;

-- Le staff garde l'UPDATE : `unlockDocumentForStudent` (manually_unlocked) et
-- `setDocumentAssignment` (unlock_at) passent par là, depuis le navigateur du
-- coach, donc sous le rôle `authenticated`.
drop policy if exists "document_assignments_update_staff" on public.document_assignments;
create policy "document_assignments_update_staff" on public.document_assignments
  for update
  using (public.is_coach_or_admin())
  with check (public.is_coach_or_admin());

-- ⚠️ LE PRIVILÈGE DE TABLE DE `authenticated` N'EST PAS RÉVOQUÉ, ET C'EST
-- NÉCESSAIRE. Postgres vérifie les privilèges AVANT la moindre policy : un
-- `revoke update … from authenticated` ferait échouer le coach sur
-- « permission denied for table document_assignments », policy ci-dessus
-- parfaitement correcte et jamais consultée. C'est la policy qui distingue
-- l'élève du coach, pas le grant — les deux sont le même rôle Postgres.
revoke update on public.document_assignments from anon;

-- ── 2. LA SEULE ÉCRITURE QUI RESTE À L'ÉLÈVE ───────────────────────────────
-- `security definer` : la fonction s'exécute avec les droits de son
-- propriétaire et contourne donc la policy ci-dessus, qui vient précisément
-- de fermer la porte à l'élève. Tout le contrôle est dans son corps.
--
-- Le propriétaire sera `postgres` (le rôle qui applique les migrations), qui
-- est aussi le propriétaire de `document_assignments`, et la table n'a PAS
-- `force row level security` (vérifié : `relforcerowsecurity = false`) : son
-- UPDATE n'est donc pas soumis à la policy staff. Si `force row level
-- security` était activé un jour sur cette table, cette fonction cesserait de
-- fonctionner et il faudrait lui ajouter une policy dédiée — c'est noté ici
-- plutôt que découvert en production.
--
-- `set search_path = ''` : aucune résolution implicite. Chaque objet est
-- qualifié (`public.document_assignments`, `public.current_student_id`), ce
-- qui interdit à un schéma temporaire de détourner un nom. Seul `pg_catalog`
-- reste implicite, d'où `now()` sans préfixe.
create or replace function public.mark_document_viewed(p_document_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  if p_document_id is null then
    return false;
  end if;

  -- L'élève courant vient de la primitive existante, jamais d'un argument :
  -- il n'y a aucun paramètre `student_id` à falsifier.
  v_student_id := public.current_student_id();
  if v_student_id is null then
    -- Ni élève connecté, ni staff passant par ici : rien à marquer.
    return false;
  end if;

  -- Les trois conditions sont indissociables :
  --   · `document_id` — le document demandé, et lui seul ;
  --   · `student_id`  — la ligne de CET élève, et elle seule ;
  --   · `viewed_at is null` — la première consultation seulement.
  -- Aucune autre colonne n'est nommée dans le `set` : `document_id`,
  -- `student_id`, `manually_unlocked` et `unlock_at` sont hors de portée.
  update public.document_assignments
     set viewed_at = now(),
         updated_at = now()
   where document_id = p_document_id
     and student_id = v_student_id
     and viewed_at is null;

  -- `found` est vrai si et seulement si l'UPDATE a touché une ligne, donc si
  -- et seulement si c'était la PREMIÈRE consultation d'un document RÉELLEMENT
  -- assigné à cet élève. Un document non assigné, déjà consulté, ou global
  -- sans assignation renvoient tous `false` — indistinctement, ce qui ne
  -- divulgue pas l'existence d'un document que l'élève ne doit pas connaître.
  return found;
end;
$$;

comment on function public.mark_document_viewed(uuid) is
  'Marque la PREMIÈRE consultation d''un document assigné à l''élève courant. Renvoie true si viewed_at vient d''être posé, false sinon (déjà consulté, non assigné, document global sans assignation, aucun élève courant). Ne crée jamais de ligne, ne touche jamais document_id / student_id / manually_unlocked / unlock_at.';

-- ── 3. LES GRANTS, ET RIEN DE PLUS ─────────────────────────────────────────
-- `create function` accorde `execute` à PUBLIC par défaut : on referme
-- d'abord, on ouvre ensuite, dans cet ordre.
revoke all on function public.mark_document_viewed(uuid) from public;
revoke all on function public.mark_document_viewed(uuid) from anon;

-- `authenticated` seul. `anon` est exclu : sans session, `current_student_id()`
-- renvoie `null` et la fonction ne ferait rien — autant ne pas l'exposer.
-- `service_role` est exclu AUSSI : aucun chemin serveur ne marque une
-- consultation (c'est un geste de l'élève, émis depuis son navigateur), et un
-- rôle qui contourne RLS n'a rien à gagner d'une fonction dont tout l'intérêt
-- est de contraindre un élève.
grant execute on function public.mark_document_viewed(uuid) to authenticated;
