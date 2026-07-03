-- ============================================================================
-- Exemple : créer le premier compte admin/coach manuellement.
-- ============================================================================
-- Ne contient AUCUNE vraie clé, mot de passe ou email réel — remplace les
-- valeurs ci-dessous après avoir suivi les étapes du README.md
-- ("Créer les premiers utilisateurs").
--
-- 1. Dashboard Supabase > Authentication > Users > Add user (ou Invite
--    user) : créer un compte avec un email + mot de passe.
-- 2. Copier son "User UID" (visible dans la liste des utilisateurs, ou
--    dans le détail du compte).
-- 3. Exécuter la requête ci-dessous dans SQL Editor, en remplaçant
--    'UUID_AUTH_USER_ICI' par ce User UID, et les infos personnelles par
--    les vraies.
-- ============================================================================

insert into public.profiles (user_id, role, first_name, last_name, email)
values ('UUID_AUTH_USER_ICI', 'admin', 'Jules', 'Favier', 'ton-email@example.com');

-- ----------------------------------------------------------------------------
-- Même principe pour un compte élève, une fois qu'un vrai compte
-- auth.users existe pour lui (créé par le coach, comme au point 1) :
-- ----------------------------------------------------------------------------
-- insert into public.profiles (user_id, role, first_name, last_name, email)
-- values ('UUID_AUTH_USER_ELEVE_ICI', 'student', 'Alexandre', 'Morel', 'alexandre@example.com');

-- ----------------------------------------------------------------------------
-- Et pour un coach assistant (rôle "coach", accès identique à "admin" pour
-- l'instant — voir lib/supabase/guards.ts) :
-- ----------------------------------------------------------------------------
-- insert into public.profiles (user_id, role, first_name, last_name, email)
-- values ('UUID_AUTH_USER_COACH_ICI', 'coach', 'Manon', 'Roy', 'manon@example.com');
