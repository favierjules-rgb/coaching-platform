-- ============================================================================
-- Migration 20260924090000 — SUPPRESSION DE L'INTÉGRATION NOLIO.
-- (chantier feat/suppression-nolio-db, lot 2)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- L'intégration est abandonnée : Nolio ne fournit pas le mode d'accès
-- multi-utilisateurs dont l'usage avait besoin. Le code est parti au lot 1
-- (4862153) — routes, client OAuth, chiffrement des jetons, carte du profil,
-- règles de quota et variables d'environnement. Il ne reste que les deux
-- objets créés par C5.1, et c'est cette migration qui les retire.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ELLE NE RÉÉCRIT PAS LE PASSÉ
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ `20260922090000_c5_1_connexions_nolio.sql` N'EST PAS MODIFIÉE. Elle est
-- appliquée en Production : une migration appliquée est un fait, pas un
-- brouillon. On n'efface pas le fait, on ajoute l'étape qui le défait.
--
-- ────────────────────────────────────────────────────────────────────────────
-- AUCUN `cascade`, ET C'EST UN CHOIX
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ `drop ... cascade` emporterait EN SILENCE tout objet qui dépendrait de
-- ceux-ci. L'inspection de `pg_depend` du 22/09/2026 dit que rien d'externe
-- n'en dépend : les 22 objets dépendants sont les constituants de la table
-- elle-même — 5 valeurs par défaut, ses 2 index explicites, ses 8 contraintes,
-- sa policy. Si cette inspection était fausse, la migration DOIT échouer
-- plutôt que de réussir en emportant autre chose au passage.
--
-- ⚠️ `students` N'EST PAS TOUCHÉE. La clé étrangère part de
-- `nolio_connections` VERS `students` ; elle appartient à la table supprimée
-- et disparaît avec elle. Aucune ligne, aucune colonne, aucune contrainte de
-- `students` n'est lue ni écrite ici.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. LA GARDE — ON NE DÉTRUIT PAS DE JETONS SANS LE SAVOIR
-- ────────────────────────────────────────────────────────────────────────────
-- La table était vide à l'audit (0 ligne), et le lot 1 a supprimé la seule
-- route capable d'y écrire. Mais l'audit et l'application de cette migration
-- sont deux instants différents.
--
-- ⚠️ ET UN `refresh_token` NOLIO N'EXPIRE PAS. Le détruire sans passer par
-- `/deauthorize/` laisserait une autorisation VIVANTE chez un tiers, sans
-- plus aucun moyen de la révoquer — la clé de déchiffrement partant elle
-- aussi. C'est ce fait, et lui seul, qui justifie une garde plutôt qu'un
-- `drop` direct.
--
-- ⚠️ ELLE EST STRICTE, ET NON IDEMPOTENTE. Pas de `to_regclass` : si la table
-- n'existe plus, cette migration n'a rien à faire ici et doit le dire
-- bruyamment. Une migration ne se rejoue pas dans ce dépôt, et un échec
-- visible vaut mieux qu'un succès silencieux sur une base déjà nettoyée.
--
-- `raise exception` annule la transaction entière : les deux `drop` qui
-- suivent ne s'exécutent pas.
do $$
begin
  if exists (select 1 from public.nolio_connections limit 1) then
    raise exception
      'Suppression Nolio refusée : nolio_connections contient encore des lignes. Révoquer les connexions chez Nolio (/deauthorize/) avant de rejouer cette migration.';
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- B. LA VUE D'ABORD — ELLE DÉPEND DE LA TABLE
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ L'ORDRE N'EST PAS COSMÉTIQUE. `nolio_connexion_etat` lit
-- `nolio_connections` : supprimer la table en premier ferait échouer le
-- `drop table` sans `cascade`. La vue part donc la première, et c'est
-- exactement ce qui rend le `cascade` inutile.
drop view if exists public.nolio_connexion_etat;

-- ────────────────────────────────────────────────────────────────────────────
-- C. PUIS LA TABLE — ET AVEC ELLE TOUT CE QUI LUI APPARTIENT
-- ────────────────────────────────────────────────────────────────────────────
-- Disparaissent du même coup, parce qu'ils appartiennent à la table :
--   · 5 index — pkey, les deux uniques (student_id, nolio_user_id) et les
--     deux index explicites (student_idx, status_idx) ;
--   · 8 contraintes — pkey, les deux uniques, la clé étrangère vers
--     `students`, et les quatre `check` (status, key_version, nolio_user_id,
--     tokens non vides) ;
--   · la policy `nolio_connections_manage_admin` et les grants
--     `service_role`.
-- Rien à révoquer à la main : un `drop table` emporte privilèges et policies.
drop table if exists public.nolio_connections;
