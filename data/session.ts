import type { UserRole } from "@/types";

/**
 * Simulation de rôle en attendant une vraie authentification (Supabase).
 * Change cette valeur ("visitor" | "student" | "admin") pour prévisualiser
 * les différents états d'accès.
 */
export const currentUserRole: UserRole = "student";
