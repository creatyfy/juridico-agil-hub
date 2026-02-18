export function logInfo(event: string, payload: Record<string, unknown>) {
  console.log(JSON.stringify({ level: 'info', event, ...payload }))
}

export function logError(event: string, payload: Record<string, unknown>) {
  console.error(JSON.stringify({ level: 'error', event, ...payload }))
}
