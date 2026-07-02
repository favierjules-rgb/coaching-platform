# coaching-platform

Gestion de mon site internet — plateforme de coaching sportif premium (Seth — Préparation Physique).

Projet [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS v4.

## État actuel

Étape 1 : site public (page d'accueil) uniquement, avec données mockées.
Pas encore développés : espace élève, espace admin, Supabase, Stripe, authentification réelle.

## Démarrer en local

```bash
npm install
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

## Structure

```
app/              # Routes App Router (layout, page d'accueil, styles globaux)
components/
  layout/         # Header, Footer
  sections/       # Sections de la page d'accueil (Hero, Method, Transformations, Newsletter)
  ui/             # Petits composants réutilisables (Logo, SectionLabel)
data/             # Données mockées (mock.ts)
types/            # Types TypeScript partagés
```
