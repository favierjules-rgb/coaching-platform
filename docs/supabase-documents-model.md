# Bibliothèque de documents — modèle Supabase

Chantier "supabase-documents-library" : rendre l'onglet Documents réellement
fonctionnel avec Supabase, comme les programmes et la nutrition.

## Audit : tables déjà prêtes, jamais branchées

`documents`, `document_levels`, `document_assignments` existaient déjà dans
`supabase/schema.sql` (sections 18-20), RLS et buckets Storage
`documents`/`videos` compris — conçues pour correspondre au type mock
`AdminDocument` (`level`, `distribution_mode`, `unlock_after_weeks`,
`status` brouillon/publié/archivé...), mais jamais lues/écrites par l'app.
**Aucune nouvelle table créée** : `document_assignments` est réutilisée
telle quelle comme source unique d'assignation (jamais la table générique
`assignments`, déjà réservée aux programmes — conforme à la préférence
explicite du besoin).

Système mock existant retrouvé et laissé intact (branche non-Supabase) :
`data/admin.ts` (6 documents seed), `components/admin/DocumentModal.tsx`,
`app/admin/documents/(page|nouveau)`, côté élève `lib/documents.ts` +
`components/student/DocumentLibrary(Card)` + `data/student.ts`
(`DocumentResource`/`StudentDocumentAccess`, type distinct plus simple).
`app/admin/eleves/[studentId]` avait déjà une section "Documents"
(disponibles/verrouillés, déblocage manuel) branchée sur le mock.

## Colonnes additives

`documents` ne portait qu'une description (le mock en distingue une courte
et une complète), pas de champ texte, pas de notion de diffusion globale,
pas de date de déblocage précise, pas de tags :

```sql
alter table public.documents add column if not exists full_description text not null default '';
alter table public.documents add column if not exists difficulty text not null default 'intermédiaire'
  check (difficulty in ('facile', 'intermédiaire', 'avancé'));
alter table public.documents add column if not exists content_text text not null default '';
alter table public.documents add column if not exists visibility text not null default 'assigned'
  check (visibility in ('global', 'assigned'));
alter table public.documents add column if not exists unlock_at timestamptz;
alter table public.documents add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.documents drop constraint if exists documents_type_check;
alter table public.documents add constraint documents_type_check
  check (type in ('pdf', 'vidéo', 'lien', 'guide', 'image', 'texte'));
alter table public.document_assignments add column if not exists unlock_at timestamptz;
```

`type`/`category`/`status` gardent leur vocabulaire existant (déjà aligné
avec le mock) — seul `type` gagne `'texte'`. `distribution_mode` reste une
colonne texte libre (aucune contrainte préexistante) : gagne la valeur
`'deblocage-date'` côté app, sans migration nécessaire.

**⚠️ Migration à rejouer manuellement** dans l'éditeur SQL Supabase avant
utilisation — le connecteur Supabase MCP était indisponible pendant cette
session, aucune vérification live possible (voir "Limites" plus bas).

## Source de vérité et modèle de visibilité

- **Assignation** : `document_assignments` uniquement (`student_id` = 
  `students.id`, jamais `profiles.id`/`auth.users.id`/`student_profiles.id`).
  Un document peut être assigné à plusieurs élèves.
- **Visibilité globale** : nouvelle colonne `documents.visibility`. Un
  document `visibility = 'global'` et `status = 'publié'` est visible de
  tout élève actif sans ligne `document_assignments` ; `'assigned'`
  (comportement historique) nécessite une assignation explicite.
- **RLS élève** (`documents_select_global_or_assigned`) : combine les deux
  cas, toujours restreint à `status = 'publié'` — un brouillon ou un
  document archivé n'est jamais lisible par un élève, assigné ou non.
- **Déblocage dans le temps** (immédiat / niveau+semaines / date précise /
  manuel) reste calculé **côté app**, jamais au niveau RLS — même principe
  que le reste du code (aucune autre fonctionnalité de déblocage temporel
  n'est appliquée en RLS ailleurs dans ce projet). `unlock_at` au niveau de
  l'assignation (par élève) prime sur `unlock_at`/`distribution_mode` au
  niveau du document.

## Composition

- `lib/supabase/documents.ts` : `getDocuments` (admin, tous statuts),
  `getStudentDocumentsWithAvailability` (assignés + globaux publiés, avec
  disponibilité calculée), `createDocument`/`updateDocument`,
  `setDocumentAssignment`, `unlockDocumentForStudent`,
  `getAssignedDocumentIdsByStudent`. Compose vers `AdminDocument` (même
  type que le mock, étendu avec `contentText`/`videoUrl`/`unlockAt`/
  `visibility`/`tags`).
- `hooks/useSupabaseDocuments.ts` (liste admin), `useSupabaseDocumentsForStudent.ts`
  (élève précis, staff RLS — utilisé côté admin), `useSupabaseStudentDocuments.ts`
  (élève connecté lui-même, RLS élève).
- `lib/supabase/students.ts::toAdminStudent` peuple désormais
  `assignedDocumentIds` depuis `document_assignments` (auparavant toujours
  `[]`).

## Pages modifiées

- `/admin/documents` + `/admin/documents/nouveau` : priorité Supabase dès
  que configuré (jamais de mélange mock/réel, même principe que
  `/admin/nutrition`) ; formulaire étendu (visibilité, contenu texte/lien
  vidéo/lien externe séparés selon le type, tags, date de déblocage) ;
  validation d'URL avant sauvegarde (erreur claire si invalide).
- `/admin/eleves/[studentId]` : section "Documents" branchée sur la vraie
  disponibilité pour un élève réel (assignation + règle du document),
  boutons Attribuer/Retirer/Débloquer réels.
- `components/admin/AssignContentToStudentModal.tsx` : section Documents
  désormais réellement assignable (au lieu du message "pas encore migré").
- `/documents` (élève) : nouveau composant `RealDocumentLibrary` pour la
  branche Supabase réelle (recherche, filtres Mes documents/Vidéos/Guides/
  Nutrition/Entraînement/Administratif/À venir, ouverture lien/vidéo/PDF,
  cartes verrouillées avec date). Branche mock (`DocumentLibrary`) inchangée.
- `/admin` (dashboard) : carte "Documents partagés" passe de systématiquement
  "(exemple)" à réelle dès qu'au moins un document Supabase existe — pas
  d'autre ajout, conformément à la demande de ne pas surcharger.

## Limites

- **Upload de fichier réel non branché** : les buckets Storage `documents`/
  `videos` existent déjà (RLS comprise), mais le formulaire admin utilise
  encore des liens externes pour PDF/vidéo (`file_url`/`storage_path`
  restent `null` à la création) — conforme à la consigne "ne pas bloquer le
  chantier si l'upload est plus complexe, commencer par les liens". Étape 2
  possible sans changement de schéma.
- **Vérification live non effectuée** : connecteur Supabase MCP
  indisponible pendant cette session — migration non rejouée, tests 1-2 et
  4-20 de la liste fournie non exécutés contre une vraie base. À faire
  manuellement ou lors d'une prochaine session avec le connecteur actif.
  `npm run lint`, `npx tsc --noEmit` et `npm run build` sont passés sans
  erreur, et le modèle de disponibilité a été relu ligne à ligne contre les
  règles demandées (global/assigné, niveau/semaines, date précise, manuel).
