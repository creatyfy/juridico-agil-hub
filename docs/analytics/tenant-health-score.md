# Tenant Health Score (SaaS Product Analytics)

## Objetivo
Criar um score de saúde por tenant (0-100) com base em:
- eventos dos últimos 30 dias;
- usuários ativos dos últimos 30 dias;
- uso de feature premium;
- percentual de uso do plano.

SQL pronto para execução/consulta:
- `docs/analytics/sql/tenant_health_score_queries.sql`

## 1) Fórmula do score (0-100)

### 1.1 Componentes e pesos
- **Atividade de eventos 30d**: 30 pontos
- **Usuários ativos 30d**: 25 pontos
- **Uso de feature premium 30d**: 20 pontos
- **Percentual de uso do plano**: 25 pontos

### 1.2 Normalização dos componentes
Para cada tenant, os componentes são convertidos para 0..1:

- `eventos_norm = LEAST(eventos_30d / 100.0, 1.0)`
- `ativos_norm = LEAST(usuarios_ativos_30d / 20.0, 1.0)`
- `premium_norm = LEAST(eventos_premium_30d / 15.0, 1.0)`
- `plano_norm = LEAST(percentual_uso_plano / 100.0, 1.0)`

> Ajuste os denominadores (100, 20, 15) por tier de plano ou percentis históricos quando houver maturidade de dados.

### 1.3 Score final
```text
health_score = ROUND(
  100 * (
    0.30 * eventos_norm +
    0.25 * ativos_norm +
    0.20 * premium_norm +
    0.25 * plano_norm
  )
)
```

## 2) Classificação (segmentação)
- **healthy**: `score >= 70`
- **at-risk**: `score >= 40 AND score < 70`
- **churn-risk**: `score < 40`

## 3) Estratégia operacional automática por categoria

### healthy
- Enviar campanhas de **upsell/cross-sell** (features premium e add-ons).
- Acionar playbook de advocacy (NPS, case, indicação).
- Reforçar hábitos com insights de uso avançado.

### at-risk
- Disparar nudges no produto (checklist de ativação incompleta).
- Enviar sequência educativa com foco na feature de maior valor.
- Abrir tarefa para CSM se permanecer `at-risk` por 2 semanas.

### churn-risk
- Criar alerta imediato para time de CS/RevOps.
- Executar playbook de recuperação (contato humano + sessão de onboarding).
- Oferecer mitigação de fricção (ex.: extensão de trial, treinamento dedicado).

## 4) Recomendações de implementação
- Recalcular score diariamente (job agendado) e armazenar histórico para tendência.
- Monitorar variação semanal (`delta_score_7d`) para detectar degradação precoce.
- Calibrar thresholds por coorte/tier quando houver baseline estatístico sólido.
