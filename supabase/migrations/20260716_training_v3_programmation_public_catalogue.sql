-- Catalogue public de programmes en achat unique (étape 6). is_public
-- affiche le programme sur /programmes et la home page publique.
-- public_subscription_template_id pointe vers une formule one_time (prix
-- Stripe) ; null = programme gratuit (pas de Stripe, compte créé directement).
alter table public.programs
  add column if not exists is_public boolean not null default false,
  add column if not exists public_subscription_template_id uuid references public.subscription_templates(id) on delete set null;

-- Lecture publique (anon) des programmes marqués publics — champs marketing
-- uniquement exposés côté code (rien de sensible dans la ligne programs elle-
-- même). Le détail séance/exercice reste réservé aux élèves assignés + staff.
create policy "programs_select_public" on public.programs
  for select
  to anon
  using (is_public = true);

-- Type d'accès élève : "coaching" (défaut, comportement actuel inchangé) ou
-- "programme_seul" (compte auto-créé après achat/réclamation d'un programme
-- public — accès restreint à /entrainement uniquement).
alter table public.students
  add column if not exists access_type text not null default 'coaching' check (access_type in ('coaching', 'programme_seul'));
