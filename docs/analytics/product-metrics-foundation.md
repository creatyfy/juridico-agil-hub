# Fundação de métricas de produto (ativação e retenção)

Esta base usa **somente `public.audit_logs`** como fonte canônica de eventos, evitando tabela duplicada.

## 1) Eventos-chave de ativação (canonizados)

Eventos alvo:
- `cadastro_created`
- `primeira_feature_premium`
- `primeiro_convite_enviado`

> Padrão recomendado: salvar o nome canônico em `metadata.event_name` e manter `action` para compatibilidade legada.

Exemplo de insert canônico:

```sql
INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, metadata)
VALUES (
  :tenant_id,
  :user_id,
  'feature_used',
  'feature',
  :entity_id,
  jsonb_build_object(
    'event_name', 'primeira_feature_premium',
    'feature_key', :feature_key,
    'plan_tier', 'premium'
  )
);
```

## 2) Visão agregada por tenant

Criada na migration:
- `public.v_tenant_product_metrics_agg`

Colunas:
- `total_eventos_7d`
- `total_eventos_30d`
- `usuarios_ativos_30d`
- `data_primeiro_evento`

Consulta para dashboard interno:

```sql
SELECT *
FROM public.v_tenant_product_metrics_agg
ORDER BY total_eventos_30d DESC;
```

## 3) Query eficiente baseada em `audit_logs`

A view já usa filtro por janela temporal e eventos-alvo. Para drill-down:

```sql
SELECT
  tenant_id,
  COALESCE(metadata->>'event_name', action) AS event_name,
  date_trunc('day', created_at) AS dia,
  COUNT(*) AS total_eventos,
  COUNT(DISTINCT user_id) AS usuarios_unicos
FROM public.audit_logs
WHERE created_at >= now() - interval '30 days'
  AND (
    action IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado')
    OR (metadata ? 'event_name' AND metadata->>'event_name' IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado'))
  )
GROUP BY 1, 2, 3
ORDER BY dia DESC, total_eventos DESC;
```

## 4) Estratégia de índice

Índice criado:
- `idx_audit_logs_activation_window (tenant_id, created_at DESC, user_id)` com **partial predicate** para eventos de ativação.

Motivo:
- reduz custo de scan para dashboard de produto (7/30 dias)
- mantém cardinalidade baixa por filtrar apenas eventos úteis
- aproveita partição lógica natural por `tenant_id`

## 5) Estratégia de cache

Para dashboard interno:
1. **TTL curto (60–300s)** no backend (Redis/KV/memória) por chave `tenant_id + janela`.
2. **Stale-while-revalidate** para leitura rápida e atualização assíncrona.
3. Se volume crescer, migrar para **materialized view** com refresh incremental/agendado (ex.: a cada 5 min).

## 6) Métricas recomendadas para decisão

Além da visão base:
- **Activation rate D7**: `% tenants com os 3 eventos em até 7 dias do cadastro_created`.
- **Tempo até valor (TTV)**: mediana entre `cadastro_created` e `primeira_feature_premium`.
- **Invite adoption**: `% tenants com primeiro_convite_enviado em até 14 dias`.
- **Retenção de atividade**: tenants com `total_eventos_30d > 0` por coorte mensal.
- **Depth score**: peso por evento (ex.: premium=3, convite=2, cadastro=1) para priorizar CS/upsell.
