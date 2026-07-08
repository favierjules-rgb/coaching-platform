# Upload réel de fichiers — bucket Storage "documents"

Chantier "supabase-documents-storage-upload" : brancher l'upload réel de
fichiers depuis `/admin/documents` sur Supabase Storage, en plus du système
d'URL externe déjà fonctionnel depuis la PR #20.

## Audit

Aucun upload Supabase Storage n'existait ailleurs dans le repo (grep sur
`.upload(`/`createSignedUrl`/`getPublicUrl` : aucun résultat). Les buckets
`documents` et `videos` étaient déjà créés (`public: false`) avec des
policies `storage.objects` — mais la policy de lecture était
`bucket_id = 'documents' and auth.role() = 'authenticated'` : **n'importe
quel élève connecté pouvait lire n'importe quel fichier du bucket**, sans
lien avec le document réellement accessible. `documents.file_url`/
`external_url`/`storage_path` existaient déjà (colonnes PR #19/#20),
`storage_path` n'était jamais réellement écrit (aucun upload branché).

## Bucket utilisé : "documents" uniquement

Un seul bucket pour tous les types de fichiers (PDF, images, vidéos,
autres) — le bucket `videos` provisionné reste **volontairement inutilisé**
pour éviter de dupliquer la policy d'accès par document sur deux buckets.
`documents.video_url` reste disponible pour un lien externe (YouTube,
Vimeo...), inchangé depuis la PR #20.

## Stratégie de sécurité

**Bucket privé (`public: false`, inchangé) + policy RLS resserrée par
document + URL signée à la demande** — pas de bucket public, pas de
signed-URL-sans-RLS :

```sql
-- Remplace l'ancienne policy "authenticated" (accès à tout le bucket)
create policy "documents_bucket_select_accessible" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (
      public.is_coach_or_admin()
      or exists (
        select 1 from public.documents d
        where d.id::text = (storage.foldername(name))[1]
          and d.status = 'publié'
          and (
            d.visibility = 'global'
            or exists (
              select 1 from public.document_assignments da
              where da.document_id = d.id and da.student_id = public.current_student_id()
            )
          )
      )
    )
  );
```

Le chemin de chaque objet est `<document_id>/<timestamp>-<nom-fichier>` —
le premier segment (`storage.foldername(name)[1]`) identifie le document,
ce qui permet à la policy de vérifier si l'utilisateur courant a le droit
de lire *ce document précis* (même règle que la lecture de la ligne
`documents` elle-même, `documents_select_global_or_assigned`). Un élève ne
peut donc générer une URL signée (`createSignedUrl`, `lib/supabase/storage-documents.ts::getSignedDocumentFileUrl`)
que pour un fichier appartenant à un document publié et (global ou
assigné) — jamais pour un document brouillon, archivé, ou assigné à un
autre élève. INSERT/UPDATE/DELETE restent coach/admin uniquement
(inchangé).

**Limite assumée, cohérente avec le reste du projet** : le déblocage dans
le temps (niveau/semaines/date précise, voir `lib/admin.ts::computeDocumentAvailability`)
reste calculé **côté app**, pas en RLS — un document assigné mais encore
verrouillé au sens de l'app pourrait théoriquement voir son URL signée
générée via un appel direct au client Supabase (hors interface). C'est le
même principe déjà utilisé partout ailleurs dans ce projet pour le
déblocage temporel (jamais appliqué en RLS, ex. `nutrition_days`, niveaux
de documents...) : l'UI n'affiche le bouton d'ouverture que si
`availability.available` est vrai, donc ce chemin n'est jamais atteint en
usage normal. Traiter cette limite au niveau RLS demanderait de dupliquer
en SQL toute la logique de `computeDocumentAvailability` (risque de
divergence entre deux implémentations) — hors scope de ce chantier, à
reconsidérer si un renforcement plus strict est nécessaire.

## Modèle de données — colonnes additives uniquement

Aucune nouvelle table. `documents.storage_path` (déjà existante, jamais
réellement utilisée) porte désormais le vrai chemin de l'objet uploadé.
Trois colonnes ajoutées pour l'affichage (nom/taille/type du fichier) :

```sql
alter table public.documents add column if not exists file_name text;
alter table public.documents add column if not exists file_size_bytes bigint;
alter table public.documents add column if not exists file_mime_type text;
```

`file_url` (lien externe collé par le coach) et `storage_path` (fichier
uploadé) restent indépendants et peuvent coexister — l'app privilégie
`storage_path` à l'affichage élève s'il est renseigné, sinon retombe sur
`external_url`/`video_url`.

## Composition

- `lib/supabase/storage-documents.ts` (nouveau) : `validateDocumentFile`
  (type MIME cohérent avec le type de document + taille max — 25 Mo PDF,
  10 Mo image, 200 Mo vidéo), `warnLargeVideo` (avertissement non bloquant
  au-delà de 50 Mo), `uploadDocumentFile`, `deleteDocumentFile`,
  `getSignedDocumentFileUrl`.
- `components/admin/DocumentFileUploadField.tsx` (nouveau) : sélection de
  fichier, affichage nom/taille, bouton "Uploader" avec état de
  chargement, message de succès/erreur clair. En mode remplacement
  (édition), l'ancien fichier est supprimé du bucket une fois le nouveau
  uploadé avec succès (jamais avant, pour ne pas perdre le fichier en cas
  d'échec).
- `lib/supabase/documents.ts::createDocument` accepte désormais un `id`
  optionnel généré côté client (`crypto.randomUUID()`) *avant* la création
  de la ligne, pour uploader directement vers `<documentId>/...` sans
  déplacement de fichier après coup.

## Pages modifiées

- `/admin/documents/nouveau` : champ upload affiché selon le type (accept
  MIME adapté), coexiste avec le champ URL existant — aucun des deux n'est
  obligatoire, mais au moins un contenu réel (URL, fichier uploadé, ou
  texte pour le type "texte") est requis avant sauvegarde, sinon message
  d'erreur clair et sauvegarde bloquée.
- `components/admin/DocumentModal.tsx` (édition) : même champ upload avec
  remplacement de fichier possible ; l'ancien fichier est supprimé du
  bucket à la confirmation du nouveau.
- `components/student/RealDocumentLibrary.tsx` : les boutons Télécharger/
  Voir la vidéo/Ouvrir génèrent une URL signée à la demande
  (`getSignedDocumentFileUrl`) pour un fichier uploadé, au lieu d'un lien
  direct — remplace l'ancien comportement qui affichait par erreur le nom
  de fichier brut comme URL (`document.fileName` traité comme un `href`,
  jamais correct). Les liens externes (PDF/vidéo par URL) restent des
  `<a href>` classiques, inchangés.

## Limites

- **Vérification live non effectuée** : connecteur Supabase MCP
  indisponible pendant cette session — migration non rejouée, aucun test
  d'upload/lecture/suppression réel effectué contre le bucket Storage.
  `npm run lint`, `npx tsc --noEmit` et `npm run build` sont passés sans
  erreur ; la policy RLS et le flux d'upload ont été relus ligne à ligne
  contre les règles demandées.
- **Déblocage temporel non enforced au niveau Storage RLS** (voir plus
  haut) — cohérent avec le reste du projet, mais documenté explicitement
  comme demandé.
- **Pas de compression/transcodage vidéo** — un fichier vidéo volumineux
  (au-delà de 50 Mo) déclenche un avertissement non bloquant, l'upload
  reste possible jusqu'à 200 Mo.
