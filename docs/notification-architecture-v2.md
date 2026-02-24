# Arquitetura de Notificações v2 (produção sob alta concorrência)

## Arquitetura alvo

- **Fonte da verdade de entrega**: `notification_events` (outbox de domínio), com 1 linha por evento de movimentação e `event_id` determinístico.
- **Histórico imutável de execução**: `notification_attempts`, 1 linha por tentativa, sem update destrutivo.
- **Máquina de estados explícita**: `pending → processing → retry_scheduled → sent | dead_letter`.
- **Concorrência orientada a claim + lease**:
  - claim atômico via `claim_notification_events` (`FOR UPDATE SKIP LOCKED` + `UPDATE ... RETURNING`);
  - lease (`lease_until`) para recuperação automática de workers mortos.
- **Retry robusto**: exponencial com jitter, `next_retry_at`, classificação de `error_class`.
- **Reconciliação ativa**: função `reconcile_notification_events` para drift, lease vencido, stuck processing e duplicidade suspeita.

## Modelo de dados final

### 1) `notification_events` (outbox de intenção de entrega)

Campos mandatórios implementados:

- `event_id` **determinístico** (SHA-256 de `tenant_id:process_id:movement_id:event_type`)
- `idempotency_key` (igual ao `event_id`, único por tenant)
- `provider_message_id` (quando disponível)
- `next_retry_at`
- `lease_until`
- `retry_count`
- `error_class`
- `correlation_id`

Outros campos-chave:

- `state` (`notification_delivery_state`)
- `unknown_outcome` (timeout ambíguo)
- `claimed_by`, `claimed_at`, `sent_at`
- `max_retries`, `last_error`

Índices críticos:

- `idx_notification_events_claim`: filas ativas (`pending/retry_scheduled`) ordenáveis por `next_retry_at`.
- `idx_notification_events_processing_lease`: varredura de leases vencidos.
- `idx_notification_events_state_created`: profundidade por estado.
- `idx_notification_events_provider_message`: dedupe/reconciliação com retorno do provider.
- `uq_notification_events_idempotency_key`: dedupe upstream global por tenant.

### 2) `notification_attempts` (trilha imutável)

- Armazena `attempt_no`, `worker_id`, payload request/response, status HTTP, `provider_message_id`, `outcome`, `error_class`, latência.
- `UNIQUE(event_id, attempt_no)` evita colisão de tentativa.
- Permite auditoria, SLO, forense e reconciliação sem inferência por sobrescrita.

### 3) `notification_reconciliation_issues`

- Registro estruturado de anomalias detectadas por reconciliador (duplicidade, drift, stuck).

## Fluxo de processamento (transacional)

1. **Nova movimentação**
   - Aplicação chama `enqueue_process_movement_event(...)` na mesma transação de persistência da movimentação.
   - Se evento já existe, `ON CONFLICT DO NOTHING` garante dedupe de criação.

2. **Evento criado**
   - Estado inicial `pending`, `next_retry_at = now()`.
   - `event_id` e `idempotency_key` determinísticos para reprocesso seguro.

3. **Worker faz claim atômico**
   - Chama `claim_notification_events(worker_id, batch, lease_seconds)`.
   - Banco seleciona candidatos com `FOR UPDATE SKIP LOCKED` e já atualiza para `processing` + lease.
   - Evita corrida entre workers e double-claim.

4. **Lease aplicado**
   - `lease_until` protege processamento em andamento.
   - Worker renova lease (se necessário) ou finaliza rapidamente.

5. **Envio externo**
   - Worker envia com header/chave de idempotência = `idempotency_key`.
   - Em timeout ambíguo, finaliza como `unknown_outcome` para retry controlado e reconciliação posterior.

6. **Tentativa registrada**
   - Worker chama `finalize_notification_attempt(...)`.
   - Função grava tentativa imutável em `notification_attempts`.

7. **Estado final resolvido**
   - `sent`: limpa lease, guarda `provider_message_id`, marca `sent_at`.
   - `retry_scheduled`: incrementa `retry_count`, calcula novo `next_retry_at`.
   - `dead_letter`: terminal com histórico completo.

### Como evita falhas clássicas

- **corrida entre workers**: claim atômico com lock pessimista + `SKIP LOCKED`.
- **double-send**: dedupe na origem (`event_id/idempotency_key`) + idempotência no provider.
- **lost update**: todas as transições críticas via função transacional com `FOR UPDATE`.
- **limpeza indevida de flag**: não depende de boolean frágil em `processos`; truth source é `notification_events`.

## Concorrência correta

- Estratégia principal: `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)` com `RETURNING`.
- Lease vencida:
  - reconciliador move `processing` expirado para `retry_scheduled`.
- Re-claim seguro:
  - apenas itens com `state in (pending,retry_scheduled)` e `next_retry_at <= now()`.

## Idempotência forte

- Chave determinística por evento de movimentação (`event_id` hash estável).
- Índice único global por tenant: `UNIQUE (tenant_id, idempotency_key)`.
- Gateway recebe `idempotency_key` (obrigatório no contrato de integração).
- Timeout ambíguo (`unknown_outcome`) não assume sucesso/falha silenciosamente; reprocessa com a mesma chave.
- Deduplicação downstream:
  - por `idempotency_key` e/ou `provider_message_id` quando retornado.

## Retry robusto

- Estados explícitos de fila: `pending → processing → retry_scheduled → sent/dead_letter`.
- `next_retry_at` + backoff exponencial com jitter (`compute_notification_backoff_seconds`).
- `error_class` obrigatório para taxonomia operacional:
  - transitório (`timeout`, `provider_5xx`, `rate_limit`)
  - permanente (`invalid_number`, `payload_invalid`, `auth_revoked`)
- Exaustão de tentativas via `max_retries` resulta em `dead_letter`.
- Circuit breaker por tenant/provedor: integrar com tabela de breaker já existente (bloquear claim quando aberto).

## Atomicidade pragmática

- **Exactly-once real** entre Postgres e gateway externo é impossível sem 2PC/distributed transaction.
- Arquitetura adota **at-least-once + idempotência forte**:
  - persistir intenção primeiro (outbox),
  - enviar com chave idempotente,
  - registrar tentativa imutável,
  - reconciliar incertezas.
- Resultado: elimina inconsistência silenciosa e reduz duplicidade para cenários residuais controlados.

## Reconciliador

Job periódico (`reconcile_notification_events`) faz:

- Reativa leases expiradas (`processing` sem heartbeat).
- Marca stuck processing por timeout operacional.
- Detecta duplicidade suspeita (`sent` múltiplo no mesmo `event_id`).
- Registra achados em `notification_reconciliation_issues` para ação automática/manual.

Extensão recomendada no job:

- conferir drift entre `processos.last_notified_at` e último `sent_at` por `process_id`;
- corrigir automaticamente quando `events.sent_at` for mais novo.

## Observabilidade de produção

Métricas obrigatórias:

- `queue_depth` (count por estado)
- `queue_age_p95` (idade p95 de pendentes)
- `duplicate_detected_total`
- `unknown_outcome_total`
- `retry_exhausted_total`
- `send_latency_p95` (de `notification_attempts.latency_ms`)

Logs estruturados por tentativa/evento:

- `correlation_id`
- `attempt_id`
- `event_id`
- `provider_message_id`
- `error_class`

## Escalabilidade

- Scale-out horizontal seguro: múltiplos workers consumindo via `SKIP LOCKED` sem duplicar claim.
- Throughput previsível:
  - batch controlado,
  - lease curta + retry agendado,
  - índices de claim seletivos.
- Evita hotspot por processo:
  - eventos independentes por `event_id`,
  - ordenação por `next_retry_at/created_at`.
- Particionamento por tenant (quando volume exigir):
  - particionar `notification_events` e `notification_attempts` por hash/list de `tenant_id`.

## Garantias formais obtidas

- **G1**: no máximo 1 evento lógico por movimentação (dedupe por `event_id` determinístico).
- **G2**: no máximo 1 worker com claim ativo por evento (lock + lease).
- **G3**: toda tentativa é auditável e imutável.
- **G4**: retries são temporizados, finitos e classificáveis.
- **G5**: falhas ambíguas não são ocultadas (estado explícito + reconciliação).

## Limitações teóricas

- Não há garantia de exactly-once físico ponta-a-ponta sem 2PC com o provider.
- Se provider ignorar idempotency-key, duplicidade residual permanece possível (detectável e mitigável, não eliminável).

## Checklist de migração incremental

1. Criar novas tabelas/funções (`notification_events`, `notification_attempts`, claim/finalize/reconcile).
2. Publicar worker v2 usando `claim_notification_events` + `finalize_notification_attempt`.
3. Enviar `idempotency_key` ao gateway e persistir `provider_message_id`.
4. Ativar reconciliador periódico.
5. Migrar trigger/rotina de criação para `enqueue_process_movement_event`.
6. Rodar ambos fluxos por janela curta com shadow metrics.
7. Cortar escrita em `notifications` legado.
8. Backfill final e descomissionar legado.

## Riscos remanescentes (declarados explicitamente)

- Provider sem semântica idempotente real → risco residual de duplicidade externa.
- Timeout sem callback de confirmação → incerteza operacional temporária (`unknown_outcome`) até reconciliação.
