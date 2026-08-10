import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/LoginForm";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { redirectAuthenticatedAwayFromLogin } from "@/lib/supabase/login-redirect";

export const metadata: Metadata = {
  title: "Connexion — Seth Préparation Physique",
};

/**
 * ÉCRAN DE LANCEMENT DE L'APPLICATION (chantier PWA).
 *
 * `app/manifest.ts` fait démarrer l'application installée sur CETTE page,
 * jamais sur la vitrine. Elle doit donc savoir s'effacer : un élève déjà
 * connecté qui lance l'application ne veut pas retaper son mot de passe.
 *
 * La redirection est faite CÔTÉ SERVEUR, avant tout rendu — pas dans un
 * `useEffect`. Une redirection côté client ferait apparaître le formulaire
 * une fraction de seconde à chaque lancement, ce qui est exactement le
 * défaut qu'on cherche à supprimer. Elle rend aussi la page dynamique :
 * `/connexion` est ajouté aux chemins non mis en cache dans
 * `next.config.ts`, puisqu'elle dépend maintenant du cookie de session.
 */
export default async function ConnexionPage() {
  await redirectAuthenticatedAwayFromLogin();
  return <LoginForm supabaseConfigured={isSupabaseConfigured()} />;
}
