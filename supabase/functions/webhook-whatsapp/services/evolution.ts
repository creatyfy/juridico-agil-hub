export function normalizePhone(raw: string): string {
  return raw.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '')
}
