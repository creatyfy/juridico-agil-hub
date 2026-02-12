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
          observacoes: string | null
          status: string | null
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
          observacoes?: string | null
          status?: string | null
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
          observacoes?: string | null
          status?: string | null
          telefone?: string | null
          tipo_documento?: string | null
          tipo_pessoa?: string | null
          updated_at?: string
          user_id?: string
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
          processo_id: string
          ultima_sync: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          processo_id: string
          ultima_sync?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
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
      whatsapp_contatos: {
        Row: {
          created_at: string
          foto_url: string | null
          id: string
          instancia_id: string
          nome: string | null
          numero: string | null
          remote_jid: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          foto_url?: string | null
          id?: string
          instancia_id: string
          nome?: string | null
          numero?: string | null
          remote_jid: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          foto_url?: string | null
          id?: string
          instancia_id?: string
          nome?: string | null
          numero?: string | null
          remote_jid?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
