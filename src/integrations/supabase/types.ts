export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      advogado_credentials: {
        Row: {
          cpf: string
          created_at: string
          email: string
          id: string
          oab: string
          uf: string
          user_id: string
        }
        Insert: {
          cpf: string
          created_at?: string
          email: string
          id?: string
          oab: string
          uf: string
          user_id: string
        }
        Update: {
          cpf?: string
          created_at?: string
          email?: string
          id?: string
          oab?: string
          uf?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          metadata: Json
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          metadata?: Json
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      campaign_jobs: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          instance_id: string
          name: string
          payload_template: Json
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id: string
          name: string
          payload_template?: Json
          started_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id?: string
          name?: string
          payload_template?: Json
          started_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          attempts: number
          campaign_job_id: string
          created_at: string
          destination: string
          id: string
          last_error: string | null
          outbox_id: string | null
          payload: Json
          reference: string
          sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          campaign_job_id: string
          created_at?: string
          destination: string
          id?: string
          last_error?: string | null
          outbox_id?: string | null
          payload?: Json
          reference: string
          sent_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          campaign_job_id?: string
          created_at?: string
          destination?: string
          id?: string
          last_error?: string | null
          outbox_id?: string | null
          payload?: Json
          reference?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_job_id_fkey"
            columns: ["campaign_job_id"]
            isOneToOne: false
            referencedRelation: "campaign_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "message_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_processos: {
        Row: {
          advogado_user_id: string
          cliente_id: string
          created_at: string
          data_aceite: string | null
          data_convite: string
          id: string
          processo_id: string
          status: string
          token: string
        }
        Insert: {
          advogado_user_id: string
          cliente_id: string
          created_at?: string
          data_aceite?: string | null
          data_convite?: string
          id?: string
          processo_id: string
          status?: string
          token?: string
        }
        Update: {
          advogado_user_id?: string
          cliente_id?: string
          created_at?: string
          data_aceite?: string | null
          data_convite?: string
          id?: string
          processo_id?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_processos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_processos_processo_id_fkey"
            columns: ["processo_id"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          auth_user_id: string | null
          created_at: string
          documento: string | null
          email: string | null
          endereco: string | null
          id: string
          nome: string
          numero_whatsapp: string | null
          observacoes: string | null
          status: string | null
          status_vinculo: string | null
          telefone: string | null
          tipo_documento: string | null
          tipo_pessoa: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          nome: string
          numero_whatsapp?: string | null
          observacoes?: string | null
          status?: string | null
          status_vinculo?: string | null
          telefone?: string | null
          tipo_documento?: string | null
          tipo_pessoa?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          nome?: string
          numero_whatsapp?: string | null
          observacoes?: string | null
          status?: string | null
          status_vinculo?: string | null
          telefone?: string | null
          tipo_documento?: string | null
          tipo_pessoa?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversation_processing_locks: {
        Row: {
          fence_token: number
          lease_until: string | null
          phone: string
          tenant_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          fence_token?: number
          lease_until?: string | null
          phone: string
          tenant_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          fence_token?: number
          lease_until?: string | null
          phone?: string
          tenant_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      convites_vinculacao: {
        Row: {
          advogado_user_id: string
          cliente_id: string
          created_at: string
          data_aceite: string | null
          expiracao: string
          id: string
          ip_aceite: string | null
          processo_id: string
          status: string
          token: string
        }
        Insert: {
          advogado_user_id: string
          cliente_id: string
          created_at?: string
          data_aceite?: string | null
          expiracao?: string
          id?: string
          ip_aceite?: string | null
          processo_id: string
          status?: string
          token?: string
        }
        Update: {
          advogado_user_id?: string
          cliente_id?: string
          created_at?: string
          data_aceite?: string | null
          expiracao?: string
          id?: string
          ip_aceite?: string | null
          processo_id?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "convites_vinculacao_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "convites_vinculacao_processo_id_fkey"
            columns: ["processo_id"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          attempts: number
          created_at: string
          dead_lettered_at: string | null
          dedupe_key: string | null
          event_type: string
          id: string
          last_error: string | null
          lease_until: string | null
          lease_version: number
          next_retry_at: string | null
          payload: Json
          processed_at: string | null
          processing_started_at: string | null
          status: string
          tenant_id: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          dead_lettered_at?: string | null
          dedupe_key?: string | null
          event_type: string
          id?: string
          last_error?: string | null
          lease_until?: string | null
          lease_version?: number
          next_retry_at?: string | null
          payload: Json
          processed_at?: string | null
          processing_started_at?: string | null
          status?: string
          tenant_id: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          dead_lettered_at?: string | null
          dedupe_key?: string | null
          event_type?: string
          id?: string
          last_error?: string | null
          lease_until?: string | null
          lease_version?: number
          next_retry_at?: string | null
          payload?: Json
          processed_at?: string | null
          processing_started_at?: string | null
          status?: string
          tenant_id?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      email_verification_codes: {
        Row: {
          code: string
          created_at: string
          email: string
          expires_at: string
          id: string
          verified: boolean
        }
        Insert: {
          code: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          verified?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          verified?: boolean
        }
        Relationships: []
      }
      inbound_messages: {
        Row: {
          created_at: string
          id: string
          instance_id: string
          payload_raw: Json
          phone: string
          provider_message_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_id: string
          payload_raw: Json
          phone: string
          provider_message_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_id?: string
          payload_raw?: Json
          phone?: string
          provider_message_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
        ]
      }
      message_outbox: {
        Row: {
          accepted_reconciled_at: string | null
          aggregate_id: string | null
          aggregate_type: string
          attempts: number
          campaign_job_id: string | null
          created_at: string
          dead_lettered_at: string | null
          delivered_at: string | null
          id: string
          idempotency_key: string
          lease_until: string | null
          next_retry_at: string | null
          payload: Json
          provider_message_id: string | null
          status: string
          tenant_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          accepted_reconciled_at?: string | null
          aggregate_id?: string | null
          aggregate_type?: string
          attempts?: number
          campaign_job_id?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          delivered_at?: string | null
          id?: string
          idempotency_key: string
          lease_until?: string | null
          next_retry_at?: string | null
          payload?: Json
          provider_message_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          accepted_reconciled_at?: string | null
          aggregate_id?: string | null
          aggregate_type?: string
          attempts?: number
          campaign_job_id?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          delivered_at?: string | null
          id?: string
          idempotency_key?: string
          lease_until?: string | null
          next_retry_at?: string | null
          payload?: Json
          provider_message_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_message_outbox_campaign_job"
            columns: ["campaign_job_id"]
            isOneToOne: false
            referencedRelation: "campaign_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      movimentacoes: {
        Row: {
          conteudo: string | null
          created_at: string
          data_movimentacao: string | null
          descricao: string
          id: string
          judit_movement_id: string | null
          processo_id: string
          tipo: string | null
        }
        Insert: {
          conteudo?: string | null
          created_at?: string
          data_movimentacao?: string | null
          descricao: string
          id?: string
          judit_movement_id?: string | null
          processo_id: string
          tipo?: string | null
        }
        Update: {
          conteudo?: string | null
          created_at?: string
          data_movimentacao?: string | null
          descricao?: string
          id?: string
          judit_movement_id?: string | null
          processo_id?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_processo_id_fkey"
            columns: ["processo_id"]
            isOneToOne: false
            referencedRelation: "processos"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          created_at: string
          id: string
          lida: boolean
          link: string | null
          mensagem: string
          metadata: Json | null
          tipo: string
          titulo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lida?: boolean
          link?: string | null
          mensagem: string
          metadata?: Json | null
          tipo: string
          titulo: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lida?: boolean
          link?: string | null
          mensagem?: string
          metadata?: Json | null
          tipo?: string
          titulo?: string
          user_id?: string
        }
        Relationships: []
      }
      processo_monitoramentos: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          judit_request_attempts: number | null
          judit_request_created_at: string | null
          judit_request_id: string | null
          judit_request_status: string | null
          processo_id: string
          ultima_sync: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          judit_request_attempts?: number | null
          judit_request_created_at?: string | null
          judit_request_id?: string | null
          judit_request_status?: string | null
          processo_id: string
          ultima_sync?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          judit_request_attempts?: number | null
          judit_request_created_at?: string | null
          judit_request_id?: string | null
          judit_request_status?: string | null
          processo_id?: string
          ultima_sync?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processo_monitoramentos_processo_id_fkey"
            columns: ["processo_id"]
            isOneToOne: true
            referencedRelation: "processos"
            referencedColumns: ["id"]
          },
        ]
      }
      processos: {
        Row: {
          assunto: string | null
          classe: string | null
          created_at: string
          data_distribuicao: string | null
          fonte: string | null
          id: string
          judit_process_id: string | null
          numero_cnj: string
          partes: Json | null
          status: string | null
          tribunal: string | null
          updated_at: string
          user_id: string
          vara: string | null
        }
        Insert: {
          assunto?: string | null
          classe?: string | null
          created_at?: string
          data_distribuicao?: string | null
          fonte?: string | null
          id?: string
          judit_process_id?: string | null
          numero_cnj: string
          partes?: Json | null
          status?: string | null
          tribunal?: string | null
          updated_at?: string
          user_id: string
          vara?: string | null
        }
        Update: {
          assunto?: string | null
          classe?: string | null
          created_at?: string
          data_distribuicao?: string | null
          fonte?: string | null
          id?: string
          judit_process_id?: string | null
          numero_cnj?: string
          partes?: Json | null
          status?: string | null
          tribunal?: string | null
          updated_at?: string
          user_id?: string
          vara?: string | null
        }
        Relationships: []
      }
      validacoes_otp: {
        Row: {
          cliente_id: string
          codigo_otp: string
          convite_id: string
          created_at: string
          expiracao: string
          id: string
          numero_informado: string
          tentativas: number
          validado: boolean
        }
        Insert: {
          cliente_id: string
          codigo_otp: string
          convite_id: string
          created_at?: string
          expiracao?: string
          id?: string
          numero_informado: string
          tentativas?: number
          validado?: boolean
        }
        Update: {
          cliente_id?: string
          codigo_otp?: string
          convite_id?: string
          created_at?: string
          expiracao?: string
          id?: string
          numero_informado?: string
          tentativas?: number
          validado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "validacoes_otp_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validacoes_otp_convite_id_fkey"
            columns: ["convite_id"]
            isOneToOne: false
            referencedRelation: "convites_vinculacao"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_chats_cache: {
        Row: {
          created_at: string
          direcao: string | null
          foto_url: string | null
          id: string
          instancia_id: string
          is_group: boolean | null
          nao_lidas: number | null
          nome: string | null
          remote_jid: string
          ultima_mensagem: string | null
          ultimo_timestamp: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          direcao?: string | null
          foto_url?: string | null
          id?: string
          instancia_id: string
          is_group?: boolean | null
          nao_lidas?: number | null
          nome?: string | null
          remote_jid: string
          ultima_mensagem?: string | null
          ultimo_timestamp?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          direcao?: string | null
          foto_url?: string | null
          id?: string
          instancia_id?: string
          is_group?: boolean | null
          nao_lidas?: number | null
          nome?: string | null
          remote_jid?: string
          ultima_mensagem?: string | null
          ultimo_timestamp?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_chats_cache_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contatos: {
        Row: {
          created_at: string
          foto_url: string | null
          id: string
          instancia_id: string
          nome: string | null
          numero: string | null
          push_name: string | null
          remote_jid: string
          updated_at: string
          verified_name: string | null
        }
        Insert: {
          created_at?: string
          foto_url?: string | null
          id?: string
          instancia_id: string
          nome?: string | null
          numero?: string | null
          push_name?: string | null
          remote_jid: string
          updated_at?: string
          verified_name?: string | null
        }
        Update: {
          created_at?: string
          foto_url?: string | null
          id?: string
          instancia_id?: string
          nome?: string | null
          numero?: string | null
          push_name?: string | null
          remote_jid?: string
          updated_at?: string
          verified_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contatos_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instancias: {
        Row: {
          created_at: string
          id: string
          instance_id: string | null
          instance_name: string
          phone_number: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_name: string
          phone_number?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_name?: string
          phone_number?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_mensagens: {
        Row: {
          conteudo: string | null
          created_at: string
          direcao: string
          id: string
          instancia_id: string
          message_id: string
          remote_jid: string
          timestamp: string
          tipo: string | null
        }
        Insert: {
          conteudo?: string | null
          created_at?: string
          direcao?: string
          id?: string
          instancia_id: string
          message_id?: string
          remote_jid: string
          timestamp?: string
          tipo?: string | null
        }
        Update: {
          conteudo?: string | null
          created_at?: string
          direcao?: string
          id?: string
          instancia_id?: string
          message_id?: string
          remote_jid?: string
          timestamp?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_mensagens_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instancias"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_processing_metrics: {
        Row: {
          created_at: string
          error_code: string | null
          event_id: string | null
          event_type: string | null
          id: string
          processing_ms: number | null
          retries: number
          status: string
          tenant_id: string | null
          worker_name: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          event_id?: string | null
          event_type?: string | null
          id?: string
          processing_ms?: number | null
          retries?: number
          status: string
          tenant_id?: string | null
          worker_name: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          event_id?: string | null
          event_type?: string | null
          id?: string
          processing_ms?: number | null
          retries?: number
          status?: string
          tenant_id?: string | null
          worker_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_campaign_recipients: {
        Args: { p_batch_size?: number; p_campaign_job_id: string }
        Returns: {
          attempts: number
          campaign_job_id: string
          created_at: string
          destination: string
          id: string
          last_error: string | null
          outbox_id: string | null
          payload: Json
          reference: string
          sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "campaign_recipients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      run_process_campaign_jobs_cron: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
