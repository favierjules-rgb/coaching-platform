/**
 * Placeholder pour les types générés automatiquement par le CLI Supabase
 * (`supabase gen types typescript`) une fois le projet créé et le schéma
 * (voir supabase/schema.sql) appliqué. Voir README.md pour la commande
 * exacte.
 *
 * `Database = Record<string, never>` fait volontairement échouer toute
 * tentative de lecture d'une table précise tant que ce fichier n'a pas été
 * régénéré, plutôt que de laisser passer silencieusement un mauvais nom de
 * colonne — un rappel utile puisque les clients Supabase (lib/supabase/)
 * ne sont pas encore branchés sur les pages.
 */
export type Database = Record<string, never>;
