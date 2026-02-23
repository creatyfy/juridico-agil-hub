import { computeBackoffWithJitterMs, shouldRetryStatus } from './outbox.ts'

export type WorkerDecision =
  | { action: 'accepted' }
  | { action: 'retry'; delayMs: number; reason: string }
  | { action: 'dead_letter'; reason: string }

export function decideOutboxOutcome(input: {
  attempts: number
  maxAttempts: number
  httpStatus?: number
  timedOut?: boolean
  rateLimited?: boolean
}): WorkerDecision {
  const currentAttempts = Math.max(1, input.attempts)

  if (input.rateLimited) {
    return { action: 'retry', delayMs: computeBackoffWithJitterMs(currentAttempts), reason: 'rate_limit' }
  }

  if (input.timedOut) {
    if (currentAttempts >= input.maxAttempts) return { action: 'dead_letter', reason: 'timeout' }
    return { action: 'retry', delayMs: computeBackoffWithJitterMs(currentAttempts), reason: 'timeout' }
  }

  if (!input.httpStatus || input.httpStatus < 400) return { action: 'accepted' }

  if (shouldRetryStatus(input.httpStatus)) {
    if (currentAttempts >= input.maxAttempts) return { action: 'dead_letter', reason: `http_${input.httpStatus}` }
    return { action: 'retry', delayMs: computeBackoffWithJitterMs(currentAttempts), reason: `http_${input.httpStatus}` }
  }

  return { action: 'dead_letter', reason: `http_${input.httpStatus}` }
}
