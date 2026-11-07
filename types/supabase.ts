export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      agent_run_steps: {
        Row: {
          cost_micros: number | null;
          created_at: string;
          duration_ms: number | null;
          error_message: string | null;
          id: string;
          input: Json | null;
          kind: Database["public"]["Enums"]["agent_step_kind"];
          organization_id: string;
          output: Json | null;
          run_id: string;
          seq: number;
          simulado: boolean;
          tokens_input: number | null;
          tokens_output: number | null;
          tool_name: string | null;
        };
        Insert: {
          cost_micros?: number | null;
          created_at?: string;
          duration_ms?: number | null;
          error_message?: string | null;
          id?: string;
          input?: Json | null;
          kind: Database["public"]["Enums"]["agent_step_kind"];
          organization_id: string;
          output?: Json | null;
          run_id: string;
          seq: number;
          simulado?: boolean;
          tokens_input?: number | null;
          tokens_output?: number | null;
          tool_name?: string | null;
        };
        Update: {
          cost_micros?: number | null;
          created_at?: string;
          duration_ms?: number | null;
          error_message?: string | null;
          id?: string;
          input?: Json | null;
          kind?: Database["public"]["Enums"]["agent_step_kind"];
          organization_id?: string;
          output?: Json | null;
          run_id?: string;
          seq?: number;
          simulado?: boolean;
          tokens_input?: number | null;
          tokens_output?: number | null;
          tool_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_run_steps_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_run_steps_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_runs: {
        Row: {
          agent_id: string | null;
          agent_slug: string;
          cost_micros: number | null;
          created_at: string;
          error_message: string | null;
          finished_at: string | null;
          id: string;
          input: Json;
          model: string | null;
          modo: string;
          organization_id: string;
          output: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["agent_run_status"];
          thread_id: string | null;
          tokens_input: number;
          tokens_output: number;
          trigger_kind: Database["public"]["Enums"]["agent_trigger_kind"];
          triggered_by: string | null;
        };
        Insert: {
          agent_id?: string | null;
          agent_slug: string;
          cost_micros?: number | null;
          created_at?: string;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          input?: Json;
          model?: string | null;
          modo?: string;
          organization_id: string;
          output?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["agent_run_status"];
          thread_id?: string | null;
          tokens_input?: number;
          tokens_output?: number;
          trigger_kind?: Database["public"]["Enums"]["agent_trigger_kind"];
          triggered_by?: string | null;
        };
        Update: {
          agent_id?: string | null;
          agent_slug?: string;
          cost_micros?: number | null;
          created_at?: string;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          input?: Json;
          model?: string | null;
          modo?: string;
          organization_id?: string;
          output?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["agent_run_status"];
          thread_id?: string | null;
          tokens_input?: number;
          tokens_output?: number;
          trigger_kind?: Database["public"]["Enums"]["agent_trigger_kind"];
          triggered_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "threads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_triggered_by_profile_fkey";
            columns: ["triggered_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      agents: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          max_output_tokens: number;
          max_steps: number;
          model: string;
          name: string;
          organization_id: string;
          slug: string;
          status: Database["public"]["Enums"]["agent_status"];
          system_prompt: string;
          temperature: number;
          tools: string[];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          max_output_tokens?: number;
          max_steps?: number;
          model: string;
          name: string;
          organization_id: string;
          slug: string;
          status?: Database["public"]["Enums"]["agent_status"];
          system_prompt?: string;
          temperature?: number;
          tools?: string[];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          max_output_tokens?: number;
          max_steps?: number;
          model?: string;
          name?: string;
          organization_id?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["agent_status"];
          system_prompt?: string;
          temperature?: number;
          tools?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_usage: {
        Row: {
          day: string;
          organization_id: string;
          tokens_used: number;
        };
        Insert: {
          day?: string;
          organization_id: string;
          tokens_used?: number;
        };
        Update: {
          day?: string;
          organization_id?: string;
          tokens_used?: number;
        };
        Relationships: [
          {
            foreignKeyName: "automation_usage_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      credentials: {
        Row: {
          ciphertext: string;
          created_at: string;
          created_by: string | null;
          id: string;
          key_prefix: string;
          key_version: number;
          label: string;
          last4: string;
          metadata: Json;
          organization_id: string | null;
          provider: Database["public"]["Enums"]["credential_provider"];
          updated_at: string;
        };
        Insert: {
          ciphertext: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          key_prefix?: string;
          key_version?: number;
          label?: string;
          last4?: string;
          metadata?: Json;
          organization_id?: string | null;
          provider: Database["public"]["Enums"]["credential_provider"];
          updated_at?: string;
        };
        Update: {
          ciphertext?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          key_prefix?: string;
          key_version?: number;
          label?: string;
          last4?: string;
          metadata?: Json;
          organization_id?: string | null;
          provider?: Database["public"]["Enums"]["credential_provider"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credentials_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      document_chunks: {
        Row: {
          content: string;
          created_at: string;
          document_id: string;
          embedding: string;
          id: string;
          knowledge_base_id: string;
          organization_id: string;
          seq: number;
          tokens: number | null;
        };
        Insert: {
          content: string;
          created_at?: string;
          document_id: string;
          embedding: string;
          id?: string;
          knowledge_base_id: string;
          organization_id: string;
          seq: number;
          tokens?: number | null;
        };
        Update: {
          content?: string;
          created_at?: string;
          document_id?: string;
          embedding?: string;
          id?: string;
          knowledge_base_id?: string;
          organization_id?: string;
          seq?: number;
          tokens?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_chunks_knowledge_base_id_fkey";
            columns: ["knowledge_base_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_bases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_chunks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          byte_size: number | null;
          char_count: number;
          chunk_count: number;
          content: string | null;
          created_at: string;
          created_by: string | null;
          embed_cost_micros: number | null;
          embed_tokens: number;
          embedding_model: string | null;
          error_message: string | null;
          id: string;
          knowledge_base_id: string;
          mime_type: string | null;
          organization_id: string;
          processed_at: string | null;
          source_kind: Database["public"]["Enums"]["document_source_kind"];
          status: Database["public"]["Enums"]["document_status"];
          storage_path: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          byte_size?: number | null;
          char_count?: number;
          chunk_count?: number;
          content?: string | null;
          created_at?: string;
          created_by?: string | null;
          embed_cost_micros?: number | null;
          embed_tokens?: number;
          embedding_model?: string | null;
          error_message?: string | null;
          id?: string;
          knowledge_base_id: string;
          mime_type?: string | null;
          organization_id: string;
          processed_at?: string | null;
          source_kind: Database["public"]["Enums"]["document_source_kind"];
          status?: Database["public"]["Enums"]["document_status"];
          storage_path?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          byte_size?: number | null;
          char_count?: number;
          chunk_count?: number;
          content?: string | null;
          created_at?: string;
          created_by?: string | null;
          embed_cost_micros?: number | null;
          embed_tokens?: number;
          embedding_model?: string | null;
          error_message?: string | null;
          id?: string;
          knowledge_base_id?: string;
          mime_type?: string | null;
          organization_id?: string;
          processed_at?: string | null;
          source_kind?: Database["public"]["Enums"]["document_source_kind"];
          status?: Database["public"]["Enums"]["document_status"];
          storage_path?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_knowledge_base_id_fkey";
            columns: ["knowledge_base_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_bases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          organization_id: string;
          role: Database["public"]["Enums"]["org_role"];
          token: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          organization_id: string;
          role?: Database["public"]["Enums"]["org_role"];
          token?: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          organization_id?: string;
          role?: Database["public"]["Enums"]["org_role"];
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          agent_id: string | null;
          attempts: number;
          created_at: string;
          finished_at: string | null;
          id: string;
          idempotency_key: string | null;
          kind: string;
          last_error: string | null;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          organization_id: string;
          payload: Json;
          run_after: string;
          run_as: string | null;
          run_id: string | null;
          source_id: string | null;
          source_kind: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["job_status"];
          updated_at: string;
        };
        Insert: {
          agent_id?: string | null;
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          idempotency_key?: string | null;
          kind?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          organization_id: string;
          payload?: Json;
          run_after?: string;
          run_as?: string | null;
          run_id?: string | null;
          source_id?: string | null;
          source_kind: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          updated_at?: string;
        };
        Update: {
          agent_id?: string | null;
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          idempotency_key?: string | null;
          kind?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          organization_id?: string;
          payload?: Json;
          run_after?: string;
          run_as?: string | null;
          run_id?: string | null;
          source_id?: string | null;
          source_kind?: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_bases: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          embedding_dimensions: number;
          embedding_model: string;
          id: string;
          name: string;
          organization_id: string;
          slug: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          embedding_dimensions?: number;
          embedding_model?: string;
          id?: string;
          name: string;
          organization_id: string;
          slug: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          embedding_dimensions?: number;
          embedding_model?: string;
          id?: string;
          name?: string;
          organization_id?: string;
          slug?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_bases_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      llm_usage: {
        Row: {
          day: string;
          tokens_used: number;
          user_id: string;
        };
        Insert: {
          day?: string;
          tokens_used?: number;
          user_id: string;
        };
        Update: {
          day?: string;
          tokens_used?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      memberships: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_user_profile_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      org_ai_limits: {
        Row: {
          alert_at_percent: number;
          alert_level: number | null;
          alert_month: string | null;
          created_at: string;
          daily_budget_micros: number | null;
          hard_stop: boolean;
          max_run_cost_micros: number | null;
          monthly_budget_micros: number | null;
          organization_id: string;
          platform_cap_micros: number | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          alert_at_percent?: number;
          alert_level?: number | null;
          alert_month?: string | null;
          created_at?: string;
          daily_budget_micros?: number | null;
          hard_stop?: boolean;
          max_run_cost_micros?: number | null;
          monthly_budget_micros?: number | null;
          organization_id: string;
          platform_cap_micros?: number | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          alert_at_percent?: number;
          alert_level?: number | null;
          alert_month?: string | null;
          created_at?: string;
          daily_budget_micros?: number | null;
          hard_stop?: boolean;
          max_run_cost_micros?: number | null;
          monthly_budget_micros?: number | null;
          organization_id?: string;
          platform_cap_micros?: number | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "org_ai_limits_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_ai_spend: {
        Row: {
          agent_micros: number;
          day: string;
          embedding_micros: number;
          organization_id: string;
          unpriced_documents: number;
          unpriced_runs: number;
          updated_at: string;
        };
        Insert: {
          agent_micros?: number;
          day: string;
          embedding_micros?: number;
          organization_id: string;
          unpriced_documents?: number;
          unpriced_runs?: number;
          updated_at?: string;
        };
        Update: {
          agent_micros?: number;
          day?: string;
          embedding_micros?: number;
          organization_id?: string;
          unpriced_documents?: number;
          unpriced_runs?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_ai_spend_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          logo_url: string | null;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          logo_url?: string | null;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          logo_url?: string | null;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_admins_user_profile_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      schedules: {
        Row: {
          agent_id: string;
          created_at: string;
          created_by: string | null;
          day_of_month: number | null;
          entrega: Json;
          every_minutes: number | null;
          hour: number | null;
          id: string;
          input: Json;
          is_active: boolean;
          kind: string;
          last_error: string | null;
          last_run_at: string | null;
          minute: number | null;
          modo: string;
          name: string;
          next_run_at: string | null;
          organization_id: string;
          run_as: string | null;
          slug: string | null;
          timezone: string;
          updated_at: string;
          weekdays: number[] | null;
        };
        Insert: {
          agent_id: string;
          created_at?: string;
          created_by?: string | null;
          day_of_month?: number | null;
          entrega?: Json;
          every_minutes?: number | null;
          hour?: number | null;
          id?: string;
          input?: Json;
          is_active?: boolean;
          kind: string;
          last_error?: string | null;
          last_run_at?: string | null;
          minute?: number | null;
          modo?: string;
          name: string;
          next_run_at?: string | null;
          organization_id: string;
          run_as?: string | null;
          slug?: string | null;
          timezone?: string;
          updated_at?: string;
          weekdays?: number[] | null;
        };
        Update: {
          agent_id?: string;
          created_at?: string;
          created_by?: string | null;
          day_of_month?: number | null;
          entrega?: Json;
          every_minutes?: number | null;
          hour?: number | null;
          id?: string;
          input?: Json;
          is_active?: boolean;
          kind?: string;
          last_error?: string | null;
          last_run_at?: string | null;
          minute?: number | null;
          modo?: string;
          name?: string;
          next_run_at?: string | null;
          organization_id?: string;
          run_as?: string | null;
          slug?: string | null;
          timezone?: string;
          updated_at?: string;
          weekdays?: number[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "schedules_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "schedules_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "schedules_run_as_profile_fkey";
            columns: ["run_as"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          assigned_to: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          due_date: string | null;
          id: string;
          organization_id: string;
          priority: Database["public"]["Enums"]["task_priority"];
          status: Database["public"]["Enums"]["task_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          organization_id: string;
          priority?: Database["public"]["Enums"]["task_priority"];
          status?: Database["public"]["Enums"]["task_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          organization_id?: string;
          priority?: Database["public"]["Enums"]["task_priority"];
          status?: Database["public"]["Enums"]["task_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      thread_messages: {
        Row: {
          created_at: string;
          id: string;
          metadata: Json | null;
          organization_id: string;
          parts: Json;
          role: Database["public"]["Enums"]["thread_message_role"];
          run_id: string | null;
          seq: number;
          thread_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          organization_id: string;
          parts: Json;
          role: Database["public"]["Enums"]["thread_message_role"];
          run_id?: string | null;
          seq?: never;
          thread_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          organization_id?: string;
          parts?: Json;
          role?: Database["public"]["Enums"]["thread_message_role"];
          run_id?: string | null;
          seq?: never;
          thread_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thread_messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_messages_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thread_messages_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "threads";
            referencedColumns: ["id"];
          },
        ];
      };
      threads: {
        Row: {
          agent_id: string;
          created_at: string;
          id: string;
          last_message_at: string | null;
          message_count: number;
          organization_id: string;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          agent_id: string;
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          message_count?: number;
          organization_id: string;
          title?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          agent_id?: string;
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          message_count?: number;
          organization_id?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "threads_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "threads_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "threads_user_profile_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_endpoints: {
        Row: {
          agent_id: string;
          calls_count: number;
          created_at: string;
          created_by: string | null;
          esperar_resposta: boolean;
          id: string;
          is_active: boolean;
          label: string;
          last_called_at: string | null;
          modo: string;
          organization_id: string;
          run_as: string | null;
          slug: string | null;
          token_hash: string;
          token_prefix: string;
          updated_at: string;
          window_count: number;
          window_started_at: string | null;
        };
        Insert: {
          agent_id: string;
          calls_count?: number;
          created_at?: string;
          created_by?: string | null;
          esperar_resposta?: boolean;
          id?: string;
          is_active?: boolean;
          label?: string;
          last_called_at?: string | null;
          modo?: string;
          organization_id: string;
          run_as?: string | null;
          slug?: string | null;
          token_hash: string;
          token_prefix?: string;
          updated_at?: string;
          window_count?: number;
          window_started_at?: string | null;
        };
        Update: {
          agent_id?: string;
          calls_count?: number;
          created_at?: string;
          created_by?: string | null;
          esperar_resposta?: boolean;
          id?: string;
          is_active?: boolean;
          label?: string;
          last_called_at?: string | null;
          modo?: string;
          organization_id?: string;
          run_as?: string | null;
          slug?: string | null;
          token_hash?: string;
          token_prefix?: string;
          updated_at?: string;
          window_count?: number;
          window_started_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_endpoints_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_endpoints_run_as_profile_fkey";
            columns: ["run_as"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_instances: {
        Row: {
          cloud_access_token: string | null;
          cloud_phone_number_id: string | null;
          cloud_waba_id: string | null;
          connected_at: string | null;
          created_at: string;
          id: string;
          instance_name: string | null;
          last_seen_at: string | null;
          organization_id: string;
          phone_number: string | null;
          provider: "baileys" | "cloud_api";
          qr_code: string | null;
          status: "disconnected" | "connecting" | "connected" | "qr_ready";
          updated_at: string;
        };
        Insert: {
          cloud_access_token?: string | null;
          cloud_phone_number_id?: string | null;
          cloud_waba_id?: string | null;
          connected_at?: string | null;
          created_at?: string;
          id?: string;
          instance_name?: string | null;
          last_seen_at?: string | null;
          organization_id: string;
          phone_number?: string | null;
          provider?: "baileys" | "cloud_api";
          qr_code?: string | null;
          status?: "disconnected" | "connecting" | "connected" | "qr_ready";
          updated_at?: string;
        };
        Update: {
          cloud_access_token?: string | null;
          cloud_phone_number_id?: string | null;
          cloud_waba_id?: string | null;
          connected_at?: string | null;
          created_at?: string;
          id?: string;
          instance_name?: string | null;
          last_seen_at?: string | null;
          organization_id?: string;
          phone_number?: string | null;
          provider?: "baileys" | "cloud_api";
          qr_code?: string | null;
          status?: "disconnected" | "connecting" | "connected" | "qr_ready";
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invitation: {
        Args: { _token: string };
        Returns: {
          organization_id: string;
          slug: string;
        }[];
      };
      add_platform_admin: { Args: { _email: string }; Returns: string };
      agent_belongs_to_org: {
        Args: { _agent_id: string; _organization_id: string };
        Returns: boolean;
      };
      ai_month_start: { Args: never; Returns: string };
      ai_today: { Args: never; Returns: string };
      append_document_chunks: {
        Args: { _chunks: Json; _document_id: string };
        Returns: number;
      };
      assert_document_admin: { Args: { _document_id: string }; Returns: string };
      automation_budget_left: {
        Args: { _organization_id: string };
        Returns: number;
      };
      automation_daily_cap: { Args: never; Returns: number };
      can_manage_credential: { Args: { _org_id: string }; Returns: boolean };
      claim_job: { Args: { _worker_id: string }; Returns: string };
      consume_llm_tokens: { Args: { _tokens: number }; Returns: boolean };
      create_organization_with_owner: {
        Args: { _name: string; _slug: string };
        Returns: {
          id: string;
          slug: string;
        }[];
      };
      credential_status: {
        Args: { _organization_id?: string };
        Returns: {
          provider: Database["public"]["Enums"]["credential_provider"];
          source: string;
        }[];
      };
      current_user_email: { Args: never; Returns: string };
      enqueue_agent_job: {
        Args: {
          _agent_id: string;
          _input?: Json;
          _source_id?: string;
          _source_kind?: string;
        };
        Returns: string;
      };
      enqueue_document_job: {
        Args: { _document_id: string; _download_url?: string };
        Returns: string;
      };
      enqueue_due_schedules: { Args: { _limite?: number }; Returns: number };
      enqueue_webhook_job: {
        Args: {
          _endpoint_id: string;
          _idempotency_key?: string;
          _payload?: Json;
        };
        Returns: Json;
      };
      fail_document: {
        Args: { _document_id: string; _motivo?: string };
        Returns: undefined;
      };
      finish_agent_run: {
        Args: {
          _error_message?: string;
          _output?: string;
          _run_id: string;
          _status: Database["public"]["Enums"]["agent_run_status"];
        };
        Returns: Json;
      };
      finish_agent_run_system: {
        Args: {
          _error_message?: string;
          _output?: string;
          _run_id: string;
          _status: Database["public"]["Enums"]["agent_run_status"];
        };
        Returns: Json;
      };
      finish_document_indexing: {
        Args: {
          _document_id: string;
          _embed_cost_micros?: number;
          _embed_tokens?: number;
          _embedding_model: string;
        };
        Returns: undefined;
      };
      finish_job: {
        Args: {
          _error?: string;
          _job_id: string;
          _retry_in?: string;
          _run_id?: string;
          _status: Database["public"]["Enums"]["job_status"];
        };
        Returns: undefined;
      };
      has_org_role: {
        Args: {
          _org_id: string;
          _roles: Database["public"]["Enums"]["org_role"][];
        };
        Returns: boolean;
      };
      is_org_member: { Args: { _org_id: string }; Returns: boolean };
      is_platform_admin: { Args: never; Returns: boolean };
      job_for_run: {
        Args: { _job_id: string; _worker_id: string };
        Returns: {
          agent_id: string;
          attempts: number;
          id: string;
          kind: string;
          locked_by: string;
          max_attempts: number;
          organization_id: string;
          payload: Json;
          run_as: string;
          source_id: string;
          source_kind: string;
        }[];
      };
      mark_job_started: { Args: { _job_id: string }; Returns: boolean };
      match_document_chunks: {
        Args: {
          _embedding?: string;
          _knowledge_base_id?: string;
          _limite?: number;
          _min_similarity?: number;
          _organization_id: string;
        };
        Returns: {
          chunk_id: string;
          content: string;
          document_id: string;
          document_title: string;
          knowledge_base_id: string;
          seq: number;
          similarity: number;
        }[];
      };
      max_micros_per_million_tokens: { Args: never; Returns: number };
      next_schedule_run: {
        Args: {
          _day_of_month: number;
          _every_minutes: number;
          _from?: string;
          _hour: number;
          _kind: string;
          _minute: number;
          _timezone: string;
          _weekdays: number[];
        };
        Returns: string;
      };
      open_agent_run_system: {
        Args: {
          _agent_id: string;
          _agent_slug: string;
          _input: Json;
          _model: string;
          _modo?: string;
          _organization_id: string;
          _thread_id?: string;
          _trigger_kind: Database["public"]["Enums"]["agent_trigger_kind"];
          _triggered_by: string;
        };
        Returns: string;
      };
      org_ai_budget_status: {
        Args: { _organization_id: string };
        Returns: {
          alert_at_percent: number;
          blocked: boolean;
          blocked_by: string;
          daily_budget_micros: number;
          day: string;
          day_spent_micros: number;
          effective_monthly_micros: number;
          hard_stop: boolean;
          max_run_cost_micros: number;
          month: string;
          month_agent_micros: number;
          month_embedding_micros: number;
          month_spent_micros: number;
          monthly_budget_micros: number;
          over_budget: boolean;
          percent_used: number;
          platform_cap_micros: number;
          unpriced_documents: number;
          unpriced_runs: number;
        }[];
      };
      org_ai_spend_add: {
        Args: {
          _agent_micros?: number;
          _embedding_micros?: number;
          _organization_id: string;
          _unpriced_documents?: number;
          _unpriced_runs?: number;
        };
        Returns: number;
      };
      org_ai_spend_add_embedding: {
        Args: { _organization_id: string; _tokens: number };
        Returns: undefined;
      };
      owner_memberships_for_seed: {
        Args: { _organization_id?: string };
        Returns: {
          organization_id: string;
          user_id: string;
        }[];
      };
      platform_ai_spend_overview: {
        Args: { _month?: string };
        Returns: {
          month_spent_micros: number;
          monthly_budget_micros: number;
          organization_id: string;
          organization_name: string;
          organization_slug: string;
          percent_used: number;
          platform_cap_micros: number;
          unpriced_runs: number;
          uses_own_key: boolean;
        }[];
      };
      queue_document: { Args: { _document_id: string }; Returns: undefined };
      reclaim_stuck_agent_runs: {
        Args: { _older_than?: string };
        Returns: number;
      };
      reclaim_stuck_jobs: { Args: { _older_than?: string }; Returns: number };
      recompute_org_ai_spend: {
        Args: { _from: string; _organization_id: string; _to: string };
        Returns: number;
      };
      record_agent_run_step: {
        Args: {
          _cost_micros?: number;
          _duration_ms?: number;
          _error_message?: string;
          _input?: Json;
          _kind: Database["public"]["Enums"]["agent_step_kind"];
          _output?: Json;
          _run_id: string;
          _seq: number;
          _simulado?: boolean;
          _tokens_input?: number;
          _tokens_output?: number;
          _tool_name?: string;
        };
        Returns: undefined;
      };
      release_job: {
        Args: { _error?: string; _job_id: string };
        Returns: undefined;
      };
      remove_platform_admin: { Args: { _user_id: string }; Returns: undefined };
      resolve_credential: {
        Args: {
          _organization_id?: string;
          _provider?: Database["public"]["Enums"]["credential_provider"];
        };
        Returns: {
          ciphertext: string;
          credential_id: string;
          key_version: number;
          metadata: Json;
          organization_id: string;
          source: string;
        }[];
      };
      save_credential: {
        Args: {
          _ciphertext: string;
          _key_prefix: string;
          _key_version: number;
          _label?: string;
          _last4: string;
          _metadata?: Json;
          _organization_id?: string;
          _provider: Database["public"]["Enums"]["credential_provider"];
        };
        Returns: string;
      };
      schedule_report_result: {
        Args: { _error?: string; _pausar?: boolean; _schedule_id: string };
        Returns: undefined;
      };
      set_org_ai_limits: {
        Args: {
          _alert_at_percent: number;
          _daily_budget_micros: number;
          _hard_stop: boolean;
          _max_run_cost_micros: number;
          _monthly_budget_micros: number;
          _organization_id: string;
        };
        Returns: undefined;
      };
      set_org_platform_cap: {
        Args: { _organization_id: string; _platform_cap_micros: number };
        Returns: undefined;
      };
      start_document_processing: {
        Args: { _document_id: string };
        Returns: boolean;
      };
      storage_folder_uuid: { Args: { _name: string }; Returns: string };
      transfer_ownership: {
        Args: { _org_id: string; _target_user_id: string };
        Returns: undefined;
      };
      webhook_endpoint_for_check: {
        Args: { _endpoint_id: string };
        Returns: {
          agent_id: string;
          esperar_resposta: boolean;
          id: string;
          is_active: boolean;
          modo: string;
          organization_id: string;
          run_as: string;
          token_hash: string;
        }[];
      };
      webhook_job_result: {
        Args: { _endpoint_id: string; _job_id: string };
        Returns: {
          cost_micros: number;
          last_error: string;
          output: string;
          run_id: string;
          run_modo: string;
          run_status: string;
          status: string;
        }[];
      };
      webhook_touch: {
        Args: { _endpoint_id: string; _limite_por_minuto?: number };
        Returns: boolean;
      };
    };
    Enums: {
      agent_run_status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
      agent_status: "draft" | "active" | "archived";
      agent_step_kind: "model" | "tool";
      agent_trigger_kind: "chat" | "manual" | "schedule" | "webhook";
      credential_provider: "openrouter" | "anthropic" | "openai" | "google" | "resend";
      document_source_kind: "upload" | "text" | "url";
      document_status: "pending" | "processing" | "ready" | "failed";
      job_status: "pending" | "running" | "done" | "failed" | "cancelled";
      org_role: "owner" | "admin" | "member";
      task_priority: "low" | "medium" | "high";
      task_status: "pending" | "in_progress" | "done";
      thread_message_role: "user" | "assistant" | "tool";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      agent_run_status: ["queued", "running", "succeeded", "failed", "cancelled"],
      agent_status: ["draft", "active", "archived"],
      agent_step_kind: ["model", "tool"],
      agent_trigger_kind: ["chat", "manual", "schedule", "webhook"],
      credential_provider: ["openrouter", "anthropic", "openai", "google", "resend"],
      document_source_kind: ["upload", "text", "url"],
      document_status: ["pending", "processing", "ready", "failed"],
      job_status: ["pending", "running", "done", "failed", "cancelled"],
      org_role: ["owner", "admin", "member"],
      task_priority: ["low", "medium", "high"],
      task_status: ["pending", "in_progress", "done"],
      thread_message_role: ["user", "assistant", "tool"],
    },
  },
} as const;
