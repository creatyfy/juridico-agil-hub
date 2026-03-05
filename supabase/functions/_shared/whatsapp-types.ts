// @ts-nocheck - Deno edge function
export type ConversationState = 'IDLE' | 'WAITING_CPF' | 'WAITING_OTP' | 'WAITING_PROCESS_SELECTION' | 'AUTHENTICATED' | 'HUMAN_REQUIRED'

export type RequestContext = {
  requestId: string
  supabase: any
  tenantId: string
  instanceName: string
  instanceId: string
  phone: string
  message: string
}

export type Intent = 'PROCESS_STATUS' | 'HUMAN_SUPPORT' | 'NEW_CLIENT' | 'OPT_OUT' | 'OTHER'
