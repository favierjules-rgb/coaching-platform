-- ============================================================================
-- CORRECTIF — LES PRIVILÈGES DE TABLE MANQUAIENT SUR `program_review_flags`
-- ============================================================================
--
-- ── CE QUE CETTE MIGRATION FAIT, EXACTEMENT ────────────────────────────────
--   1. révoque tout privilège implicite sur `public.program_review_flags`
--      pour `public`, `anon` et `authenticated` ;
--   2. accorde `select, insert, update, delete` à `authenticated` ;
--   3. accorde `all` à `service_role`.
--
-- Rien d'autre. Aucune table créée ou modifiée, aucune policy touchée, aucune
-- colonne ajoutée, aucun trigger, aucune donnée réécrite, aucune ligne
-- supprimée. La migration 20260926090000 n'est PAS modifiée : elle est déjà
-- appliquée, et une migration appliquée ne se réécrit pas.
--
-- ── POURQUOI C'ÉTAIT BLOQUANT ──────────────────────────────────────────────
-- ⚠️ POSTGRES VÉRIFIE LES PRIVILÈGES DE TABLE AVANT D'ÉVALUER LA MOINDRE
-- POLICY. Sans `grant`, chaque lecture et chaque écriture échoue sur
-- « permission denied for table program_review_flags » — la policy
-- `program_review_flags_staff` étant parfaitement correcte, et jamais
-- consultée. Exactement le défaut corrigé pour
-- `program_exercise_progression` (migration 20260925090000, lignes 125-148),
-- dont cette migration reprend la forme mot pour mot.
--
-- Le baseline du projet porte bien `alter default privileges … grant all on
-- tables to authenticated`, mais ce défaut ne s'applique qu'aux tables créées
-- PAR LE RÔLE `postgres`. S'en remettre à lui rendrait l'accès dépendant du
-- rôle qui applique la migration — les six migrations qui créent une table
-- avant celle-ci posent toutes leurs privilèges explicitement (c3, c4_1, c4_2,
-- n1_7, c5_1, progression automatique) : on suit la même règle.
--
-- ── POURQUOI CES QUATRE PRIVILÈGES, ET PAS TROIS ───────────────────────────
-- ⚠️ CETTE TABLE EST ÉCRITE DEPUIS LE NAVIGATEUR, pas par une route en
-- service-role : le coach clique la pastille « À jour / À vérifier » dans
-- /admin/programmes, donc le rôle `authenticated` émet réellement les trois
-- opérations de `lib/supabase/verification-programme.ts` :
--
--     lireVerifications     →  select
--     marquerVerifie        →  upsert   =  insert  +  update
--     retirerVerification   →  delete
--
-- ⚠️ ET `delete` EST INDISPENSABLE ICI, contrairement à
-- `program_exercise_progression` qui n'en a pas besoin. Là-bas, « absence de
-- ligne = OFF » et rien ne supprime jamais un réglage. Ici, se raviser
-- SUPPRIME la ligne — « jamais validé » et « validé il y a longtemps »
-- produisent le même état, et une ligne absente est plus simple à lire qu'une
-- date choisie pour être périmée. Sans `delete`, la pastille refuserait de
-- s'éteindre : le hook remettrait l'état précédent et le coach verrait
-- « À jour » revenir sans explication.
--
-- `anon` n'a rien : un visiteur non connecté n'a aucun programme à vérifier.
-- Et c'est la RLS, elle seule, qui restreint ces quatre droits au staff
-- (`public.is_coach_or_admin()`) — les privilèges ouvrent la porte, la policy
-- décide qui passe.
--
-- ── IDEMPOTENCE ────────────────────────────────────────────────────────────
-- `revoke` et `grant` sont naturellement idempotents : rejouer cette migration
-- réapplique le même état final, sans erreur et sans effet de bord.
-- ============================================================================

revoke all on table public.program_review_flags from public, anon, authenticated;

grant select, insert, update, delete
  on table public.program_review_flags
  to authenticated;

grant all
  on table public.program_review_flags
  to service_role;
