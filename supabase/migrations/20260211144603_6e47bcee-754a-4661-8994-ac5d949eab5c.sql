
-- Table to store OTP verification codes
CREATE TABLE public.email_verification_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_verification_codes ENABLE ROW LEVEL SECURITY;

-- Allow edge functions (service role) full access; no public access needed
-- No RLS policies for anon/authenticated since only edge functions (service role) access this table

-- Index for fast lookups
CREATE INDEX idx_verification_codes_email ON public.email_verification_codes (email, code, expires_at);

-- Auto-cleanup old codes (optional: can be done via cron)
