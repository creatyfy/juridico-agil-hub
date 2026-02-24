# Onboarding guiado de ativação (3 etapas obrigatórias)

## Objetivo
Ativar o tenant somente após completar 3 marcos de valor inicial, sem introduzir arquitetura paralela de eventos e reaproveitando `audit_logs` + `usage tracking` já existentes.

## Modelo simples de implementação
Base técnica na migration:
- `supabase/migrations/20260308100000_tenant_onboarding_activation_flow.sql`

### Etapas obrigatórias de ativação
1. `workspace_configured` → tenant configurou dados mínimos do workspace.
2. `first_case_created` → tenant criou o primeiro caso/processo.
3. `first_invite_sent` → tenant enviou o primeiro convite para cliente/parceiro.

### Estado no tenant (sem nova tabela)
Guardar no `public.tenants`:
- `onboarding_step_workspace_configured_at`
- `onboarding_step_first_case_created_at`
- `onboarding_step_first_invite_sent_at`
- `activated_at`
- `onboarding_block_expires_at` (opcional para bloqueio leve temporário)

Decisão de ativação:
- Se as 3 colunas de etapa tiverem timestamp, definir `activated_at`.

### Função única para registrar avanço
`public.complete_tenant_onboarding_step(step, metadata)`:
- valida etapa permitida;
- marca timestamp da etapa (idempotente);
- escreve evento em `audit_logs`:
  - `tenant_onboarding_step_completed`
  - `tenant_activated` (quando completar as 3 etapas)

## Estratégia de UX (bloqueio leve)

### Princípio
Evitar hard lock completo. O usuário entra no produto, mas com **camadas de orientação e limite gradual** até ativação.

### Regras de bloqueio leve sugeridas
1. **Overlay de checklist fixo** no dashboard com progresso 0/3, 1/3, 2/3, 3/3.
2. **CTA único por etapa** (“Configurar workspace”, “Criar 1º processo”, “Enviar 1º convite”).
3. **Navegação parcialmente liberada**:
   - leitura geral permitida;
   - ações avançadas (ex.: integrações premium, importações massivas) condicionadas a `activated_at` ou `onboarding_block_expires_at`.
4. **Timeout operacional opcional**: após X dias, remover bloqueio leve (`onboarding_block_expires_at`) para evitar fricção em contas enterprise com implantação assistida.
5. **Feedback imediato** a cada etapa concluída (toast + próximo passo recomendado).

## Métrica de sucesso (ativação)

### KPI principal
- **Activation Rate D7**: `% de tenants criados no período que atingem activated_at em até 7 dias`.

### KPIs de apoio
- **Step Conversion**: taxa por etapa (1→2, 2→3).
- **Tempo até ativação (TTV)**: mediana entre `tenant_created_at` e `activated_at`.
- **Drop-off por etapa**: onde tenants mais param (etapa 1, 2 ou 3).

### Fonte de dados
- `public.v_tenant_activation_funnel` para estado atual por tenant.
- `public.audit_logs` para análise temporal/eventos.

Exemplo KPI D7:
```sql
SELECT
  COUNT(*) FILTER (
    WHERE activated_at IS NOT NULL
      AND activated_at <= tenant_created_at + interval '7 days'
  )::numeric
  / NULLIF(COUNT(*), 0) AS activation_rate_d7
FROM public.v_tenant_activation_funnel
WHERE tenant_created_at >= date_trunc('month', now());
```
