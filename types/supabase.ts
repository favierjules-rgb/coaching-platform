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
      coaches: {
        Row: {
          id: string;
          user_id: string | null;
          name: string;
          email: string;
          role: "admin" | "assistant";
          status: "actif" | "inactif";
          specialty: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          name: string;
          email?: string;
          role?: "admin" | "assistant";
          status?: "actif" | "inactif";
          specialty?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          name?: string;
          email?: string;
          role?: "admin" | "assistant";
          status?: "actif" | "inactif";
          specialty?: string;
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
          status: "active" | "paused" | "completed";
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
          status?: "active" | "paused" | "completed";
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
          status?: "active" | "paused" | "completed";
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
          sport_level: string | null;
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
          onboarding_completed: boolean;
          onboarding_completed_at: string | null;
          target_timeframe: string | null;
          activity_level: string | null;
          neat_level: string | null;
          sports_practiced: unknown;
          other_activities: unknown;
          available_equipment: unknown;
          favorite_exercises: unknown;
          favorite_gym_exercises: unknown;
          avoided_exercises: unknown;
          injuries: string | null;
          training_notes: string | null;
          medical_treatments: string | null;
          medications: string | null;
          health_notes: string | null;
          hydration_level: string | null;
          daily_water_intake: string | null;
          sleep_duration: string | null;
          sleep_quality: string | null;
          recovery_notes: string | null;
          lifestyle_notes: string | null;
          motivation_source: string | null;
          recent_life_events: string | null;
          mental_wellbeing_goal: string | null;
          emotional_wellbeing_notes: string | null;
          disliked_foods: unknown;
          allergies: unknown;
          intolerances: unknown;
          diet_type: string | null;
          preferred_meal_count: number | null;
          meal_timing_notes: string | null;
          hunger_notes: string | null;
          snacking_notes: string | null;
          work_schedule_notes: string | null;
          nutrition_notes: string | null;
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
          sport_level?: string | null;
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
          onboarding_completed?: boolean;
          onboarding_completed_at?: string | null;
          target_timeframe?: string | null;
          activity_level?: string | null;
          neat_level?: string | null;
          sports_practiced?: unknown;
          other_activities?: unknown;
          available_equipment?: unknown;
          favorite_exercises?: unknown;
          favorite_gym_exercises?: unknown;
          avoided_exercises?: unknown;
          injuries?: string | null;
          training_notes?: string | null;
          medical_treatments?: string | null;
          medications?: string | null;
          health_notes?: string | null;
          hydration_level?: string | null;
          daily_water_intake?: string | null;
          sleep_duration?: string | null;
          sleep_quality?: string | null;
          recovery_notes?: string | null;
          lifestyle_notes?: string | null;
          motivation_source?: string | null;
          recent_life_events?: string | null;
          mental_wellbeing_goal?: string | null;
          emotional_wellbeing_notes?: string | null;
          disliked_foods?: unknown;
          allergies?: unknown;
          intolerances?: unknown;
          diet_type?: string | null;
          preferred_meal_count?: number | null;
          meal_timing_notes?: string | null;
          hunger_notes?: string | null;
          snacking_notes?: string | null;
          work_schedule_notes?: string | null;
          nutrition_notes?: string | null;
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
          sport_level?: string | null;
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
          onboarding_completed?: boolean;
          onboarding_completed_at?: string | null;
          target_timeframe?: string | null;
          activity_level?: string | null;
          neat_level?: string | null;
          sports_practiced?: unknown;
          other_activities?: unknown;
          available_equipment?: unknown;
          favorite_exercises?: unknown;
          favorite_gym_exercises?: unknown;
          avoided_exercises?: unknown;
          injuries?: string | null;
          training_notes?: string | null;
          medical_treatments?: string | null;
          medications?: string | null;
          health_notes?: string | null;
          hydration_level?: string | null;
          daily_water_intake?: string | null;
          sleep_duration?: string | null;
          sleep_quality?: string | null;
          recovery_notes?: string | null;
          lifestyle_notes?: string | null;
          motivation_source?: string | null;
          recent_life_events?: string | null;
          mental_wellbeing_goal?: string | null;
          emotional_wellbeing_notes?: string | null;
          disliked_foods?: unknown;
          allergies?: unknown;
          intolerances?: unknown;
          diet_type?: string | null;
          preferred_meal_count?: number | null;
          meal_timing_notes?: string | null;
          hunger_notes?: string | null;
          snacking_notes?: string | null;
          work_schedule_notes?: string | null;
          nutrition_notes?: string | null;
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
          photo_type: "face" | "profil" | "dos" | "autre";
          uploaded_by: string | null;
          file_name: string | null;
          file_size_bytes: number | null;
          file_mime_type: string | null;
          is_before_candidate: boolean;
          is_after_candidate: boolean;
          status: "active" | "archived";
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
          photo_type?: "face" | "profil" | "dos" | "autre";
          uploaded_by?: string | null;
          file_name?: string | null;
          file_size_bytes?: number | null;
          file_mime_type?: string | null;
          is_before_candidate?: boolean;
          is_after_candidate?: boolean;
          status?: "active" | "archived";
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
          photo_type?: "face" | "profil" | "dos" | "autre";
          uploaded_by?: string | null;
          file_name?: string | null;
          file_size_bytes?: number | null;
          file_mime_type?: string | null;
          is_before_candidate?: boolean;
          is_after_candidate?: boolean;
          status?: "active" | "archived";
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
      programs: {
        Row: {
          id: string;
          coach_id: string | null;
          name: string;
          goal: string;
          level: string;
          duration_weeks: number;
          description: string;
          status: "brouillon" | "actif" | "archivé";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          coach_id?: string | null;
          name: string;
          goal?: string;
          level?: string;
          duration_weeks?: number;
          description?: string;
          status?: "brouillon" | "actif" | "archivé";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          coach_id?: string | null;
          name?: string;
          goal?: string;
          level?: string;
          duration_weeks?: number;
          description?: string;
          status?: "brouillon" | "actif" | "archivé";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      program_weeks: {
        Row: {
          id: string;
          program_id: string;
          week_number: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          program_id: string;
          week_number: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string;
          week_number?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workout_sessions: {
        Row: {
          id: string;
          program_id: string;
          program_week_id: string;
          day: string;
          is_rest_day: boolean;
          name: string;
          muscle_group: string;
          duration_minutes: number | null;
          warmup: string;
          coach_notes: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          program_id: string;
          program_week_id: string;
          day: string;
          is_rest_day?: boolean;
          name?: string;
          muscle_group?: string;
          duration_minutes?: number | null;
          warmup?: string;
          coach_notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string;
          program_week_id?: string;
          day?: string;
          is_rest_day?: boolean;
          name?: string;
          muscle_group?: string;
          duration_minutes?: number | null;
          warmup?: string;
          coach_notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workout_exercises: {
        Row: {
          id: string;
          session_id: string;
          order_index: number;
          name: string;
          sets: number;
          reps: string;
          rest_seconds: number;
          tempo: string;
          recommended_load: string;
          video_url: string;
          notes: string;
          muscle_group: string | null;
          exercise_library_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          order_index?: number;
          name: string;
          sets?: number;
          reps?: string;
          rest_seconds?: number;
          tempo?: string;
          recommended_load?: string;
          video_url?: string;
          notes?: string;
          muscle_group?: string | null;
          exercise_library_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          order_index?: number;
          name?: string;
          sets?: number;
          reps?: string;
          rest_seconds?: number;
          tempo?: string;
          recommended_load?: string;
          video_url?: string;
          notes?: string;
          muscle_group?: string | null;
          exercise_library_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      exercise_library: {
        Row: {
          id: string;
          coach_id: string | null;
          name: string;
          description: string;
          category: string;
          exercise_type: string;
          equipment: string;
          level: string;
          muscle_group: string;
          secondary_muscles: string[];
          video_url: string;
          alternative_video_url: string;
          technical_cues: string;
          common_mistakes: string;
          default_tempo: string;
          default_rest_seconds: number | null;
          tags: string[];
          status: "active" | "archived";
          notes: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          coach_id?: string | null;
          name: string;
          description?: string;
          category?: string;
          exercise_type?: string;
          equipment?: string;
          level?: string;
          muscle_group?: string;
          secondary_muscles?: string[];
          video_url?: string;
          alternative_video_url?: string;
          technical_cues?: string;
          common_mistakes?: string;
          default_tempo?: string;
          default_rest_seconds?: number | null;
          tags?: string[];
          status?: "active" | "archived";
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          coach_id?: string | null;
          name?: string;
          description?: string;
          category?: string;
          exercise_type?: string;
          equipment?: string;
          level?: string;
          muscle_group?: string;
          secondary_muscles?: string[];
          video_url?: string;
          alternative_video_url?: string;
          technical_cues?: string;
          common_mistakes?: string;
          default_tempo?: string;
          default_rest_seconds?: number | null;
          tags?: string[];
          status?: "active" | "archived";
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      assignments: {
        Row: {
          id: string;
          student_id: string;
          content_type: "programme" | "nutrition";
          content_id: string;
          assigned_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          content_type: "programme" | "nutrition";
          content_id: string;
          assigned_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          content_type?: "programme" | "nutrition";
          content_id?: string;
          assigned_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      nutrition_plans: {
        Row: {
          id: string;
          student_id: string | null;
          coach_id: string | null;
          name: string;
          description: string;
          coach_notes: string;
          hydration_tip: string;
          supplements: string[] | null;
          goal_type: "perte-de-poids" | "maintien" | "prise-de-masse" | "performance";
          daily_target: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
          weekly_target_calories: number | null;
          status: "actif" | "ancien" | "prochain";
          shopping_list: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id?: string | null;
          coach_id?: string | null;
          name: string;
          description?: string;
          coach_notes?: string;
          hydration_tip?: string;
          supplements?: string[] | null;
          goal_type?: "perte-de-poids" | "maintien" | "prise-de-masse" | "performance";
          daily_target?: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
          weekly_target_calories?: number | null;
          status?: "actif" | "ancien" | "prochain";
          shopping_list?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string | null;
          coach_id?: string | null;
          name?: string;
          description?: string;
          coach_notes?: string;
          hydration_tip?: string;
          supplements?: string[] | null;
          goal_type?: "perte-de-poids" | "maintien" | "prise-de-masse" | "performance";
          daily_target?: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
          weekly_target_calories?: number | null;
          status?: "actif" | "ancien" | "prochain";
          shopping_list?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      nutrition_days: {
        Row: {
          id: string;
          plan_id: string;
          week_start_date: string | null;
          day: string;
          status: "non-commence" | "en-cours" | "valide";
          target: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
          actual: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          week_start_date?: string | null;
          day: string;
          status?: "non-commence" | "en-cours" | "valide";
          target?: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
          actual?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          plan_id?: string;
          week_start_date?: string | null;
          day?: string;
          status?: "non-commence" | "en-cours" | "valide";
          target?: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
          actual?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      meals: {
        Row: {
          id: string;
          nutrition_day_id: string;
          slot: string;
          name: string;
          items: { name: string; quantity: string }[] | null;
          macros: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
          coach_notes: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          nutrition_day_id: string;
          slot: string;
          name?: string;
          items?: { name: string; quantity: string }[] | null;
          macros?: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
          coach_notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          nutrition_day_id?: string;
          slot?: string;
          name?: string;
          items?: { name: string; quantity: string }[] | null;
          macros?: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
          coach_notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      nutrition_daily_logs: {
        Row: {
          id: string;
          student_id: string;
          nutrition_plan_id: string;
          log_date: string;
          calories: number | null;
          protein_g: number | null;
          carbs_g: number | null;
          fat_g: number | null;
          note: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          nutrition_plan_id: string;
          log_date: string;
          calories?: number | null;
          protein_g?: number | null;
          carbs_g?: number | null;
          fat_g?: number | null;
          note?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          nutrition_plan_id?: string;
          log_date?: string;
          calories?: number | null;
          protein_g?: number | null;
          carbs_g?: number | null;
          fat_g?: number | null;
          note?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          coach_id: string | null;
          title: string;
          description: string;
          full_description: string;
          type: "pdf" | "vidéo" | "lien" | "guide" | "image" | "texte";
          category: "nutrition" | "entrainement" | "administratif";
          level: number;
          difficulty: "facile" | "intermédiaire" | "avancé";
          distribution_mode: string;
          unlock_after_weeks: number | null;
          unlock_at: string | null;
          file_url: string | null;
          video_url: string | null;
          external_url: string | null;
          storage_path: string | null;
          file_name: string | null;
          file_size_bytes: number | null;
          file_mime_type: string | null;
          content_text: string;
          visibility: "global" | "assigned";
          tags: string[];
          status: "brouillon" | "publié" | "archivé";
          important: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          coach_id?: string | null;
          title: string;
          description?: string;
          full_description?: string;
          type: "pdf" | "vidéo" | "lien" | "guide" | "image" | "texte";
          category: "nutrition" | "entrainement" | "administratif";
          level?: number;
          difficulty?: "facile" | "intermédiaire" | "avancé";
          distribution_mode?: string;
          unlock_after_weeks?: number | null;
          unlock_at?: string | null;
          file_url?: string | null;
          video_url?: string | null;
          external_url?: string | null;
          storage_path?: string | null;
          file_name?: string | null;
          file_size_bytes?: number | null;
          file_mime_type?: string | null;
          content_text?: string;
          visibility?: "global" | "assigned";
          tags?: string[];
          status?: "brouillon" | "publié" | "archivé";
          important?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          coach_id?: string | null;
          title?: string;
          description?: string;
          full_description?: string;
          type?: "pdf" | "vidéo" | "lien" | "guide" | "image" | "texte";
          category?: "nutrition" | "entrainement" | "administratif";
          level?: number;
          difficulty?: "facile" | "intermédiaire" | "avancé";
          distribution_mode?: string;
          unlock_after_weeks?: number | null;
          unlock_at?: string | null;
          file_url?: string | null;
          video_url?: string | null;
          external_url?: string | null;
          storage_path?: string | null;
          file_name?: string | null;
          file_size_bytes?: number | null;
          file_mime_type?: string | null;
          content_text?: string;
          visibility?: "global" | "assigned";
          tags?: string[];
          status?: "brouillon" | "publié" | "archivé";
          important?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      document_levels: {
        Row: {
          id: string;
          level_number: number;
          label: string;
          weeks_required: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          level_number: number;
          label: string;
          weeks_required?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          level_number?: number;
          label?: string;
          weeks_required?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      document_assignments: {
        Row: {
          id: string;
          document_id: string;
          student_id: string;
          viewed_at: string | null;
          manually_unlocked: boolean;
          unlock_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          student_id: string;
          viewed_at?: string | null;
          manually_unlocked?: boolean;
          unlock_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          student_id?: string;
          viewed_at?: string | null;
          manually_unlocked?: boolean;
          unlock_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      coach_availabilities: {
        Row: {
          id: string;
          coach_id: string | null;
          weekday: number;
          start_time: string;
          end_time: string;
          slot_duration_minutes: number;
          appointment_type: string;
          location: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          coach_id?: string | null;
          weekday: number;
          start_time: string;
          end_time: string;
          slot_duration_minutes?: number;
          appointment_type?: string;
          location?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          coach_id?: string | null;
          weekday?: number;
          start_time?: string;
          end_time?: string;
          slot_duration_minutes?: number;
          appointment_type?: string;
          location?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      coach_unavailabilities: {
        Row: {
          id: string;
          coach_id: string | null;
          start_at: string;
          end_at: string;
          reason: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          coach_id?: string | null;
          start_at: string;
          end_at: string;
          reason?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          coach_id?: string | null;
          start_at?: string;
          end_at?: string;
          reason?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      appointments: {
        Row: {
          id: string;
          student_id: string | null;
          coach_id: string | null;
          title: string;
          description: string;
          appointment_type: string;
          start_at: string;
          end_at: string;
          timezone: string;
          location: string;
          meeting_url: string;
          status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
          cancellation_reason: string;
          rescheduled_from_id: string | null;
          calendar_event_id: string | null;
          ics_uid: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id?: string | null;
          coach_id?: string | null;
          title?: string;
          description?: string;
          appointment_type?: string;
          start_at: string;
          end_at: string;
          timezone?: string;
          location?: string;
          meeting_url?: string;
          status?: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
          cancellation_reason?: string;
          rescheduled_from_id?: string | null;
          calendar_event_id?: string | null;
          ics_uid?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string | null;
          coach_id?: string | null;
          title?: string;
          description?: string;
          appointment_type?: string;
          start_at?: string;
          end_at?: string;
          timezone?: string;
          location?: string;
          meeting_url?: string;
          status?: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
          cancellation_reason?: string;
          rescheduled_from_id?: string | null;
          calendar_event_id?: string | null;
          ics_uid?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      appointment_email_logs: {
        Row: {
          id: string;
          appointment_id: string | null;
          recipient_email: string;
          type: string;
          status: string;
          sent_at: string | null;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          appointment_id?: string | null;
          recipient_email?: string;
          type?: string;
          status?: string;
          sent_at?: string | null;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          appointment_id?: string | null;
          recipient_email?: string;
          type?: string;
          status?: string;
          sent_at?: string | null;
          error?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      booking_settings: {
        Row: {
          id: string;
          min_lead_minutes: number;
          max_days_ahead: number;
          default_duration_minutes: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          min_lead_minutes?: number;
          max_days_ahead?: number;
          default_duration_minutes?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          min_lead_minutes?: number;
          max_days_ahead?: number;
          default_duration_minutes?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      activity_events: {
        Row: {
          id: string;
          student_id: string | null;
          actor_type: "student" | "coach" | "system";
          event_type: string;
          title: string;
          description: string;
          metadata: Record<string, unknown>;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id?: string | null;
          actor_type?: "student" | "coach" | "system";
          event_type: string;
          title: string;
          description?: string;
          metadata?: Record<string, unknown>;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string | null;
          actor_type?: "student" | "coach" | "system";
          event_type?: string;
          title?: string;
          description?: string;
          metadata?: Record<string, unknown>;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
