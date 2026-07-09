# Photos de progression + export avant/après PDF

Chantier "supabase-progress-photos-before-after-export" : vrai upload de
photos de progression (Supabase Storage), galerie élève/admin, sélection
avant/après, comparaison, export PDF "Récapitulatif transformation"
téléchargeable des deux côtés.

## Audit — table et bucket déjà présents, aucune nouvelle policy

`progress_photos` (table) et `progress-photos` (bucket Storage privé)
existaient déjà, avec une RLS déjà exactement conforme à ce qui était
demandé :

- Table : policy `progress_photos_student_or_staff` — `for all`, `student_id
  = current_student_id() or is_coach_or_admin()`.
- Bucket : policy `progress_photos_bucket_student_or_staff` — accès complet
  staff, élève limité au dossier `{studentId}/...` via
  `(storage.foldername(name))[1] = current_student_id()::text`. Cette
  convention de chemin correspond exactement à celle demandée pour ce
  chantier.

**Conséquence : ce chantier ne modifie aucune policy RLS**, ni sur la
table ni sur le bucket. Seules des colonnes additives ont été ajoutées à
`progress_photos` (voir plus bas).

L'ancien schéma de la table (`type` avant/actuelle/objectif/mensuelle,
`date`, `weight_kg`, `note`, `image_url`, `storage_path`, `pending`) était
pensé pour un mock local : `AddProgressPhotoModal.tsx` encodait l'image en
base64 (`FileReader.readAsDataURL`) sans jamais appeler Supabase Storage,
et le code le documentait explicitement ("Aucun upload n'est effectué").
Ce composant et son flux (utilisé sur `/admin/eleves/[studentId]` pour
l'ajout rapide, et `/profil` côté élève) sont **laissés intacts** — ils
continuent de fonctionner avec les anciennes colonnes.

## Colonnes ajoutées (migration additive)

```sql
alter table public.progress_photos add column if not exists photo_type text not null default 'autre';
alter table public.progress_photos add constraint progress_photos_photo_type_check check (photo_type in ('face', 'profil', 'dos', 'autre'));
alter table public.progress_photos add column if not exists uploaded_by uuid;
alter table public.progress_photos add column if not exists file_name text;
alter table public.progress_photos add column if not exists file_size_bytes bigint;
alter table public.progress_photos add column if not exists file_mime_type text;
alter table public.progress_photos add column if not exists is_before_candidate boolean not null default false;
alter table public.progress_photos add column if not exists is_after_candidate boolean not null default false;
alter table public.progress_photos add column if not exists status text not null default 'active';
alter table public.progress_photos add constraint progress_photos_status_check check (status in ('active', 'archived'));
```

`photo_type` (angle : face/profil/dos/autre) est volontairement une colonne
**distincte** de `type` (rôle : avant/actuelle/objectif/mensuelle, déjà
existant) — les deux coexistent, aucune n'a été supprimée ni réinterprétée.
Les nouvelles photos créées par ce chantier renseignent `type = 'mensuelle'`
par défaut (rôle générique) et utilisent `is_before_candidate` /
`is_after_candidate` pour la sélection avant/après, plutôt que de réutiliser
`type = 'avant'/'objectif'` (déjà utilisé par l'ancien flux mock).

`⚠️ Action requise avant utilisation` : rejouer `supabase/schema.sql` sur
le projet Supabase pour appliquer ces colonnes.

## Sécurité / Storage

- Bucket privé, jamais d'URL publique exposée : `getSignedProgressPhotoUrl`
  (`lib/supabase/storage-progress-photos.ts`) génère une URL signée à
  courte durée (1h) pour chaque photo affichée, à la demande (galerie,
  comparaison, PDF).
- Chemin d'upload : `{studentId}/{timestamp}-{photoType}-{fileName}` —
  `studentId` toujours l'id de la table `students` (jamais profiles.id,
  auth.users.id, ni student_profiles.id), passé explicitement par
  l'appelant (élève : résolu via `getCurrentStudentId` ; admin : paramètre
  de route `[studentId]`).
- Validation à l'upload (`validateProgressPhotoFile`) : `image/jpeg`,
  `image/png`, `image/webp` uniquement, 10 Mo max.
- Aucune modification de RLS : la policy déjà en place couvre exactement
  les règles demandées (staff accès complet, élève limité à ses propres
  photos, jamais celles d'un autre élève).

## Couche d'accès Supabase

- `lib/supabase/storage-progress-photos.ts` — upload/suppression/URL
  signée (modelé sur `lib/supabase/storage-documents.ts`, même convention).
- `lib/supabase/progress-photos.ts` — CRUD riche : `listProgressPhotos` /
  `listProgressPhotosWithSignedUrls`, `createProgressPhotoWithUpload`
  (upload + insertion + `logActivityEvent`), `updateProgressPhotoMeta`,
  `archiveProgressPhoto` / `restoreProgressPhoto`,
  `deleteProgressPhotoPermanently` (ligne + fichier Storage),
  `setBeforeCandidate` / `setAfterCandidate` (désélectionne l'ancienne
  candidate de l'élève avant de sélectionner la nouvelle — une seule photo
  "avant" et une seule "après" à la fois).
- Distincte de `addProgressPhotoSupabase` / `deleteProgressPhotoSupabase`
  (`lib/supabase/students.ts`), laissées inchangées pour l'ancien flux.
- `hooks/useProgressPhotosGallery.ts` — hook partagé élève/coach
  (`actorType`), charge la galerie avec URLs signées et expose les
  handlers d'écriture (upload, édition, archive, suppression, sélection
  avant/après).

## Activité

Chaque upload crée un `activity_event` (`event_type =
progress_photo_uploaded`, `title = "Nouvelle photo de progression"`),
`actorType` = "student" ou "coach" selon le point d'entrée — best-effort,
n'échoue jamais l'upload. Icône ajoutée dans `ActivityFeed`
(`components/admin/ActivityFeed.tsx`).

## Export PDF

- Nouvelle dépendance unique : **jsPDF** (4.2.1) — 100% client-side, aucun
  binding natif, seule bibliothèque PDF du repo (aucune existante avant ce
  chantier). Choisie pour rester légère, conformément à la consigne.
- `lib/pdf/transformation-recap.ts` — génère un vrai PDF A4 (pas un export
  HTML à imprimer) : nom élève, titre "Récapitulatif transformation", date
  de génération, photo avant + photo après (récupérées via URL signée,
  encodées en data URL puis dessinées en conservant leur ratio d'aspect —
  jamais déformées), dates et poids avant/après, variation de poids, durée
  entre les deux photos, objectif principal si disponible, résumé
  (poids de départ, poids actuel, évolution totale, séances complétées,
  nutrition simple si un plan est actif), commentaire coach optionnel,
  prochain objectif optionnel, bandeau "SETH — Préparation Physique" en
  en-tête et pied de page. Mise en page volontairement sobre (texte
  structuré, pas de visuel marketing) — conforme à la consigne explicite
  reçue en cours de chantier ("pensé pour être donné à l'élève comme fichier
  récapitulatif de transformation, pas comme visuel marketing Instagram").
- `buildTransformationRecapInput` factorise la construction de l'input à
  partir des données déjà chargées par `lib/supabase/progress.ts` (résumé +
  nutrition), pour ne pas dupliquer cette logique entre les deux pages.
- `GenerateTransformationPdfButton` (`components/shared/`) — bouton
  partagé élève/admin, désactivé tant qu'aucune paire avant/après n'est
  sélectionnée, déclenche la génération + le téléchargement
  (`downloadPdfBlob`, `<a download>` + URL objet).
- Le commentaire coach et le prochain objectif restent des champs de
  formulaire **non persistés** (saisis juste avant la génération du PDF,
  côté admin uniquement) — aucune colonne demandée pour ça dans le modèle
  proposé.

## Composants

- `components/shared/ProgressPhotosSection.tsx` — galerie (vignette, date,
  angle, poids si renseigné, note, boutons Voir/Avant/Après/Archiver/
  Supprimer), formulaire d'upload (fichier + angle + date + poids + note),
  état vide ("Aucune photo de progression pour le moment." + bouton
  d'ajout).
- `components/shared/BeforeAfterComparison.tsx` — photos avant/après,
  dates, poids, variation de poids, durée, commentaire coach optionnel.
- `components/shared/GenerateTransformationPdfButton.tsx` — bouton de
  génération/téléchargement partagé.

## Pages modifiées

- `/progression` (élève) : remplace l'ancienne grille de photos en lecture
  seule par la galerie complète (upload réel), une section "Comparaison
  avant / après" avec le bouton PDF. Les 5 autres sections (résumé, poids,
  entraînement, nutrition, rendez-vous) sont inchangées.
- `/admin/eleves/[studentId]/progression` : ajoute une section "Photos de
  progression" (upload pour l'élève, édition, archive/suppression,
  sélection avant/après) et une section "Comparaison avant / après — export
  PDF" (avec champs commentaire coach / prochain objectif). Les 6 sections
  existantes (résumé, poids, mensurations, entraînement, nutrition,
  rendez-vous, activité récente) sont inchangées.
- `/admin/eleves/[studentId]` (fiche élève principale, hors périmètre de ce
  chantier) : non modifiée — continue d'utiliser l'ancien flux
  `ProgressPhotoGallerySection` / `addProgressPhotoSupabase` sans
  changement.

## Accessibilité

- Toutes les images ont un `alt` descriptif (date, angle, ou libellé
  avant/après).
- Boutons explicites (texte, jamais une icône seule) ; les icônes
  décoratives portent `aria-hidden="true"`.
- Sélection avant/après jamais signalée par la seule couleur : badge texte
  visible sur la vignette + `aria-pressed` + changement d'icône (étoile
  pleine/vide) sur le bouton.
- Aucun style ne retire l'outline de focus par défaut dans les nouveaux
  composants.
- PDF structuré en sections titrées (Résumé de la progression, Commentaire
  du coach, Prochain objectif) plutôt qu'un bloc de texte unique.

## Limites

- **Vérification live non effectuée** : connecteur Supabase MCP
  indisponible pour ce chantier. `npm run lint`, `npx tsc --noEmit` et
  `npm run build` passent sans erreur ; comportement de garde vérifié
  (redirection `/connexion` pour requête non authentifiée sur `/progression`
  et `/admin/eleves/[studentId]/progression`). Aucun upload réel, aucune
  génération de PDF réelle, aucune lecture de policy RLS testée en
  conditions réelles contre le projet Supabase.
- Commentaire coach / prochain objectif non persistés (voir plus haut) —
  à ressaisir à chaque génération de PDF.
- Pas d'export "visuel Instagram" — explicitement hors scope de cette PR,
  reporté à une étape suivante si demandé.
