/**
 * Types pour le client Supabase. À terme, ce fichier doit être remplacé en
 * intégralité par la sortie du CLI Supabase (`supabase gen types typescript`,
 * voir README.md) une fois le schéma (supabase/schema.sql) appliqué à un
 * vrai projet.
 *
 * En attendant, il est tenu à jour à la main, table par table, au fur et à
 * mesure qu'une table est réellement utilisée par le code (ici : `profiles`,
 * nécessaire à l'authentification/rôles — voir lib/supabase/auth.ts). Les
 * autres tables du schéma ne sont pas encore décrites ici tant qu'aucune
 * page n'y accède, pour ne pas maintenir des types à la main qui risquent
 * de diverger silencieusement du schéma réel.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          user_id: string;
          role: "admin" | "coach" | "student";
          first_name: string;
          last_name: string;
          email: string;
          phone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: "admin" | "coach" | "student";
          first_name?: string;
          last_name?: string;
          email?: string;
          phone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role?: "admin" | "coach" | "student";
          first_name?: string;
          last_name?: string;
          email?: string;
          phone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
