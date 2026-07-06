/**
 * Types pour le client Supabase. À terme, ce fichier doit être remplacé en
 * intégralité par la sortie du CLI Supabase (`supabase gen types typescript`,
 * voir README.md) une fois le schéma (supabase/schema.sql) appliqué à un
 * vrai projet.
 *
 * En attendant, il est tenu à jour à la main, table par table, au fur et à
 * mesure qu'une table est réellement utilisée par le code (`profiles` pour
 * l'authentification/rôles — voir lib/supabase/auth.ts ; `students` et les
 * tables liées pour la fiche élève — voir lib/supabase/students.ts). Les
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
      students: {
        Row: {
          id: string;
          user_id: string | null;
          coach_id: string | null;
          first_name: string;
          last_name: string;
          email: string;
          phone: string;
          status: "actif" | "pause" | "terminé";
          start_date: string;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          coach_id?: string | null;
          first_name: string;
          last_name: string;
          email?: string;
          phone?: string;
          status?: "actif" | "pause" | "terminé";
          start_date?: string;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          coach_id?: string | null;
          first_name?: string;
          last_name?: string;
          email?: string;
          phone?: string;
          status?: "actif" | "pause" | "terminé";
          start_date?: string;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * Détails coaching (une ligne par élève) : mensurations de référence,
       * niveau, objectifs, contraintes et préférences — voir
       * docs/supabase-student-model.md pour la répartition students /
       * student_profiles.
       */
      student_profiles: {
        Row: {
          id: string;
          student_id: string;
          age: number | null;
          height_cm: number | null;
          current_weight_kg: number | null;
          start_weight_kg: number | null;
          target_weight_kg: number | null;
          goal: string;
          level: string;
          training_frequency_per_week: number | null;
          training_location: string;
          food_preferences: unknown;
          sport_preferences: unknown;
          injury_note: unknown;
          main_goal: string;
          secondary_goals: unknown;
          target_date: string | null;
          priority: "haute" | "moyenne" | "basse" | null;
          tracked_indicators: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          age?: number | null;
          height_cm?: number | null;
          current_weight_kg?: number | null;
          start_weight_kg?: number | null;
          target_weight_kg?: number | null;
          goal?: string;
          level?: string;
          training_frequency_per_week?: number | null;
          training_location?: string;
          food_preferences?: unknown;
          sport_preferences?: unknown;
          injury_note?: unknown;
          main_goal?: string;
          secondary_goals?: unknown;
          target_date?: string | null;
          priority?: "haute" | "moyenne" | "basse" | null;
          tracked_indicators?: unknown;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          age?: number | null;
          height_cm?: number | null;
          current_weight_kg?: number | null;
          start_weight_kg?: number | null;
          target_weight_kg?: number | null;
          goal?: string;
          level?: string;
          training_frequency_per_week?: number | null;
          training_location?: string;
          food_preferences?: unknown;
          sport_preferences?: unknown;
          injury_note?: unknown;
          main_goal?: string;
          secondary_goals?: unknown;
          target_date?: string | null;
          priority?: "haute" | "moyenne" | "basse" | null;
          tracked_indicators?: unknown;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      progress_photos: {
        Row: {
          id: string;
          student_id: string;
          type: "avant" | "actuelle" | "objectif" | "mensuelle";
          date: string;
          weight_kg: number | null;
          note: string;
          image_url: string | null;
          storage_path: string | null;
          pending: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          type: "avant" | "actuelle" | "objectif" | "mensuelle";
          date?: string;
          weight_kg?: number | null;
          note?: string;
          image_url?: string | null;
          storage_path?: string | null;
          pending?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          type?: "avant" | "actuelle" | "objectif" | "mensuelle";
          date?: string;
          weight_kg?: number | null;
          note?: string;
          image_url?: string | null;
          storage_path?: string | null;
          pending?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      body_measurements: {
        Row: {
          id: string;
          student_id: string;
          type: string;
          unit: string;
          start_value: number;
          current_value: number;
          note: string;
          last_updated_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          type: string;
          unit?: string;
          start_value: number;
          current_value: number;
          note?: string;
          last_updated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          type?: string;
          unit?: string;
          start_value?: number;
          current_value?: number;
          note?: string;
          last_updated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      custom_measurements: {
        Row: {
          id: string;
          student_id: string;
          name: string;
          unit: string;
          start_value: number;
          current_value: number;
          note: string;
          last_updated_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          name: string;
          unit?: string;
          start_value: number;
          current_value: number;
          note?: string;
          last_updated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          name?: string;
          unit?: string;
          start_value?: number;
          current_value?: number;
          note?: string;
          last_updated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          student_id: string;
          offer_name: string;
          monthly_price_euros: number;
          duration_months: number;
          total_price_euros: number;
          paid_amount_euros: number;
          status: "à jour" | "en attente" | "en retard" | "terminé";
          method: "virement" | "carte" | "espèces" | "chèque" | "autre";
          next_payment_date: string | null;
          installments_total: number;
          installments_paid: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          offer_name?: string;
          monthly_price_euros?: number;
          duration_months?: number;
          total_price_euros?: number;
          paid_amount_euros?: number;
          status?: "à jour" | "en attente" | "en retard" | "terminé";
          method?: "virement" | "carte" | "espèces" | "chèque" | "autre";
          next_payment_date?: string | null;
          installments_total?: number;
          installments_paid?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          offer_name?: string;
          monthly_price_euros?: number;
          duration_months?: number;
          total_price_euros?: number;
          paid_amount_euros?: number;
          status?: "à jour" | "en attente" | "en retard" | "terminé";
          method?: "virement" | "carte" | "espèces" | "chèque" | "autre";
          next_payment_date?: string | null;
          installments_total?: number;
          installments_paid?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_entries: {
        Row: {
          id: string;
          payment_id: string;
          student_id: string;
          amount: number;
          date: string;
          method: "virement" | "carte" | "espèces" | "chèque" | "autre";
          note: string;
          status: "à jour" | "en attente" | "en retard" | "terminé";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          payment_id: string;
          student_id: string;
          amount: number;
          date?: string;
          method?: "virement" | "carte" | "espèces" | "chèque" | "autre";
          note?: string;
          status?: "à jour" | "en attente" | "en retard" | "terminé";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          payment_id?: string;
          student_id?: string;
          amount?: number;
          date?: string;
          method?: "virement" | "carte" | "espèces" | "chèque" | "autre";
          note?: string;
          status?: "à jour" | "en attente" | "en retard" | "terminé";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      coach_notes: {
        Row: {
          id: string;
          student_id: string;
          coach_id: string | null;
          text: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          coach_id?: string | null;
          text: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          coach_id?: string | null;
          text?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      weight_entries: {
        Row: {
          id: string;
          student_id: string;
          weight_kg: number;
          recorded_at: string;
          source: "initial" | "student_update" | "coach_update";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          weight_kg: number;
          recorded_at?: string;
          source?: "initial" | "student_update" | "coach_update";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          weight_kg?: number;
          recorded_at?: string;
          source?: "initial" | "student_update" | "coach_update";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workout_feedback: {
        Row: {
          id: string;
          student_id: string;
          session_id: string | null;
          program_id: string | null;
          session_key: string | null;
          session_ref_label: string;
          completed: boolean;
          global_rpe: number | null;
          global_comment: string;
          pain: string;
          status: "a-traiter" | "traité" | "important";
          coach_reply: string;
          submitted_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          session_id?: string | null;
          program_id?: string | null;
          session_key?: string | null;
          session_ref_label?: string;
          completed?: boolean;
          global_rpe?: number | null;
          global_comment?: string;
          pain?: string;
          status?: "a-traiter" | "traité" | "important";
          coach_reply?: string;
          submitted_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          session_id?: string | null;
          program_id?: string | null;
          session_key?: string | null;
          session_ref_label?: string;
          completed?: boolean;
          global_rpe?: number | null;
          global_comment?: string;
          pain?: string;
          status?: "a-traiter" | "traité" | "important";
          coach_reply?: string;
          submitted_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      exercise_feedback: {
        Row: {
          id: string;
          workout_feedback_id: string;
          student_id: string;
          exercise_id: string | null;
          exercise_name: string;
          exercise_order: number | null;
          rpe: number | null;
          comment: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workout_feedback_id: string;
          student_id: string;
          exercise_id?: string | null;
          exercise_name: string;
          exercise_order?: number | null;
          rpe?: number | null;
          comment?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workout_feedback_id?: string;
          student_id?: string;
          exercise_id?: string | null;
          exercise_name?: string;
          exercise_order?: number | null;
          rpe?: number | null;
          comment?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      exercise_set_feedback: {
        Row: {
          id: string;
          exercise_feedback_id: string;
          student_id: string;
          set_number: number;
          load_used: string;
          reps_done: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          exercise_feedback_id: string;
          student_id: string;
          set_number: number;
          load_used?: string;
          reps_done?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          exercise_feedback_id?: string;
          student_id?: string;
          set_number?: number;
          load_used?: string;
          reps_done?: string;
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
