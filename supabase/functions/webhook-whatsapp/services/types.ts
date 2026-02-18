import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type ConversationState = 'UNVERIFIED' | 'AWAITING_CPF' | 'AWAITING_OTP' | 'VERIFIED'

export type RequestContext = {
  requestId: string
  supabase: SupabaseClient
  tenantId: string
  instanceName: string
  instanceId: string
  phone: string
  message: string
}

export type Intent =
  | 'CONSULTAR_STATUS'
  | 'MARCAR_CONSULTORIA'
  | 'ENVIAR_DOCUMENTO'
  | 'RECLAMACAO'
  | 'FALAR_COM_ADVOGADO'
  | 'DUVIDA_GERAL'

export type ClassificationResult = {
  intencao: Intent
  confianca: number
  precisaEscalar: boolean
}
