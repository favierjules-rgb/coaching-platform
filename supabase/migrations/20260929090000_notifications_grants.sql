-- ============================================================================
-- CORRECTIF — PRIVILÈGES EXPLICITES SUR LES DEUX TABLES QUE LE NAVIGATEUR LIT
-- ============================================================================
--
-- ── CE QUE CETTE MIGRATION FAIT, EXACTEMENT ────────────────────────────────
--   1. sur `public.notification_campaigns` : révoque tout privilège implicite
--      pour `public`, `anon`, `authenticated`, puis accorde `select` (et rien
--      d'autre) à `authenticated`, `all` à `service_role` ;
--   2. sur `public.notification_campaign_targets` : même révocation, puis
--      `select, insert, delete` à `authenticated`, `all` à `service_role`.
--
-- Rien d'autre. Aucune table créée ou modifiée, AUCUNE POLICY TOUCHÉE, aucune
-- colonne, aucun index, aucun trigger, aucune donnée. La migration
-- 20260828090000 n'est PAS modifiée : elle est appliquée depuis le 28/08.
--
-- ── POURQUOI MAINTENANT, ALORS QUE CES TABLES VIVENT DEPUIS AOÛT ───────────
-- Parce que jusqu'à ce chantier, AUCUN accès ne passait par le rôle
-- `authenticated`. Les quatre appelants de `lib/notifications/depot.ts`
-- (routes `audience`, `campaigns`, `campaigns/[id]`, `cron/notifications`)
-- construisent tous un client `createSupabaseAdminClient()`, c'est-à-dire
-- `service_role`, qui contourne RLS ET privilèges. Le socle du 28/08 pouvait
-- donc se contenter de `revoke all … from anon` (lignes 228-233) sans jamais
-- rien accorder à `authenticated`.
--
-- `lib/supabase/rappels-eleve.ts` est le PREMIER chemin navigateur vers ces
-- deux tables — vérifié : c'est le seul fichier hors `depot.ts` à les nommer,
-- et l'interface de notifications du coach (`NotificationComposer`,
-- `NotificationCampaignList`) passe exclusivement par `fetch` vers les routes.
--
-- ⚠️ ET POSTGRES VÉRIFIE LES PRIVILÈGES DE TABLE AVANT LA MOINDRE POLICY.
-- Sans `grant`, les deux interrupteurs de la fiche élève échoueraient sur
-- « permission denied for table … », policies `notification_campaigns_staff` et
-- `notification_campaign_targets_staff` parfaitement correctes, et jamais
-- consultées. Même défaut que celui corrigé pour
-- `program_exercise_progression` (20260925090000) et pour
-- `program_review_flags` (20260928090000).
--
-- ── LES PRIVILÈGES SUIVENT LE CHEMIN RÉEL, PAS LE CONFORT ──────────────────
-- `lib/supabase/rappels-eleve.ts` émet EXACTEMENT ceci depuis le navigateur :
--
--     campagnesDeRappel      →  notification_campaigns         : select
--     lireRappelsEleve       →  notification_campaign_targets   : select
--     definirRappelEleve ON  →  notification_campaign_targets   : upsert
--     definirRappelEleve OFF →  notification_campaign_targets   : delete
--
-- ⚠️ AUCUN DROIT D'ÉCRITURE SUR `notification_campaigns`, ET C'EST LE POINT.
-- Le titre, le corps, l'heure, la récurrence et le drapeau `rappel_auto` d'un
-- rail système ne doivent pas pouvoir bouger depuis un navigateur : un seul
-- `update` y couperait ou déréglerait les rappels de TOUS les élèves. La route
-- `/api/admin/notifications/campaigns/[id]` refuse déjà les campagnes système
-- (403) ; ce `grant select` seul rend le contournement impossible même sans
-- passer par elle. Les campagnes ordinaires continuent d'être créées,
-- modifiées et annulées par les routes en `service_role`, inchangées.
--
-- ⚠️ ET `insert` + `delete` SANS `update` SUR LES CIBLES. Une ligne de ciblage
-- n'a que deux colonnes, toutes deux dans sa clé primaire
-- `(campaign_id, student_id)` : il n'y a littéralement rien à y mettre à jour.
-- Un `update` ne pourrait servir qu'à DÉPLACER un réglage d'un élève vers un
-- autre — ce que le produit ne fait jamais, et que personne ne devrait pouvoir
-- faire en une requête.
--
-- ⚠️ L'UPSERT DE `definirRappelEleve` N'EXIGE PAS `update`. PostgREST le
-- traduit en `insert … on conflict (campaign_id, student_id) do nothing` :
-- aucune ligne n'est modifiée, le conflit est simplement ignoré. C'est
-- délibéré, et c'est ce qui rend une seconde activation inoffensive.
--
-- `anon` n'a rien : un visiteur non connecté n'a ni élève, ni rappel. Et c'est
-- la RLS, elle seule, qui restreint ces droits au staff
-- (`public.is_coach_or_admin()`) — les privilèges ouvrent la porte, la policy
-- décide qui passe. Un élève authentifié la trouve fermée.
--
-- ── IDEMPOTENCE ────────────────────────────────────────────────────────────
-- `revoke` et `grant` sont naturellement idempotents : rejouer cette migration
-- réapplique le même état final, sans erreur et sans effet de bord. Le
-- `revoke all … from anon` du socle est réappliqué à l'identique, pas contredit.
-- ============================================================================

-- ── LES CAMPAGNES — LECTURE SEULE POUR LE NAVIGATEUR ───────────────────────
revoke all on table public.notification_campaigns
  from public, anon, authenticated;

grant select
  on table public.notification_campaigns
  to authenticated;

grant all
  on table public.notification_campaigns
  to service_role;

-- ── LES CIBLES — LE RÉGLAGE ON/OFF D'UN ÉLÈVE ─────────────────────────────
revoke all on table public.notification_campaign_targets
  from public, anon, authenticated;

grant select, insert, delete
  on table public.notification_campaign_targets
  to authenticated;

grant all
  on table public.notification_campaign_targets
  to service_role;
