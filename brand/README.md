# brand/

Dossier de stockage des assets de marque SETH — hors du code applicatif (`app/`, `components/`, `public/`), pas encore intégré au site. Prochaine étape après le Lot 6 : redesign des pages publiques, qui puisera dans ce dossier.

## Structure

```
brand/
├── README.md
├── logo/
│   ├── sources/
│   ├── approved/
│   └── exports/
├── images/
│   ├── portraits/
│   ├── training/
│   ├── running/
│   ├── lifestyle/
│   ├── backgrounds/
│   └── references/
├── transformations/
│   ├── approved/
│   ├── before-after/
│   ├── testimonials/
│   └── exports/
└── visual-identity/
    ├── palette.md
    ├── typography.md
    ├── image-treatment.md
    └── references/
```

### `logo/`

- `sources/` — fichiers originaux non modifiés (formats vectoriels/haute résolution tels que reçus, jamais retouchés).
- `approved/` — variantes officielles validées (celles qui peuvent être utilisées telles quelles).
- `exports/` — versions web optimisées (formats/poids adaptés à une intégration site).

### `images/`

Images brutes à intégrer, organisées par thème : `portraits/`, `training/`, `running/`, `lifestyle/`, `backgrounds/`.

- `references/` — inspirations uniquement (moodboard, exemples externes) : jamais servies directement sur le site, usage interne de cadrage seulement.

### `transformations/`

Versions retravaillées à partir de `images/`.

- `approved/` — seules images autorisées à être utilisées sur une page publique.
- `before-after/` — visuels de transformation/résultats.
- `testimonials/` — visuels liés aux témoignages.
- `exports/` — recadrages et formats web (poids/dimensions optimisés, prêts pour `public/`).

### `visual-identity/`

Règles permanentes de la marque (indépendantes de tout fichier image) : `palette.md`, `typography.md`, `image-treatment.md`, et `references/` pour les inspirations associées.

## Notes

- Ce dossier n'est pas servi par Next.js (contrairement à `public/`) : c'est un espace de stockage/travail, pas un chemin d'accès web.
- Seul le contenu de `logo/exports/` et `transformations/exports/` a vocation à être copié vers `public/brand/` lors du chantier pages publiques — pas avant.
- Aucun fichier ici n'est référencé par le code applicatif pour l'instant.
- Si des fichiers sources volumineux (.psd, .ai, exports haute résolution) sont ajoutés, on pourra envisager de les exclure du suivi git via `.gitignore` — à décider au cas par cas.
