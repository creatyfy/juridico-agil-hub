

# Plano: Corrigir vinculacao automatica de cliente ao processo

## Problema Identificado

O fluxo atual depende do `localStorage` para guardar o token do convite durante o cadastro. Isso falha em varios cenarios:
- O cliente confirma o e-mail em outro navegador ou dispositivo
- O localStorage e limpo antes do login
- O cliente ja se cadastrou antes da correcao ser implementada

**Dados atuais no banco:** Elizabeth tem 3 contas criadas, mas nenhuma esta vinculada ao registro de cliente (campo `auth_user_id` continua vazio). Os convites permanecem com status "pendente".

## Solucao Proposta

Substituir a dependencia do localStorage por um mecanismo robusto no backend: quando um cliente faz login, o sistema busca automaticamente convites pendentes pelo CPF (documento) e os aceita.

## Etapas

### 1. Corrigir dados existentes (Migration SQL)

Vincular manualmente a conta da Elizabeth ao registro de cliente e ativar o convite, para resolver o problema imediato.

### 2. Nova Edge Function: `auto-accept-invites`

Criar uma funcao backend que:
- Recebe o usuario autenticado (via header Authorization)
- Extrai o CPF do `user_metadata`
- Busca na tabela `clientes` registros com o mesmo `documento` (CPF) que ainda nao tem `auth_user_id`
- Vincula o `auth_user_id` ao cliente
- Atualiza todos os convites pendentes desse cliente para status "ativo"

Isso elimina completamente a dependencia do localStorage.

### 3. Atualizar `ClienteDashboard.tsx`

- Manter o mecanismo de localStorage como fallback
- Adicionar chamada a `auto-accept-invites` sempre que o dashboard carrega para um cliente
- Isso garante que mesmo sem token no localStorage, os convites sao aceitos automaticamente pelo CPF

### 4. Atualizar `AceitarConvite.tsx`

- Manter o localStorage como fallback
- Apos login na pagina de convite (quando o cliente ja tem conta), chamar a edge function com o token especifico para aceite imediato

## Fluxo Corrigido

```text
Cliente se cadastra via /convite/:token
         |
         v
Confirma e-mail (qualquer navegador/dispositivo)
         |
         v
Faz login no sistema
         |
         v
ClienteDashboard carrega
         |
         v
Chama auto-accept-invites (backend)
         |
    +----+----+
    |         |
  Busca por  Busca por
  localStorage  CPF no banco
    |         |
    +----+----+
         |
         v
Vincula auth_user_id ao cliente
Ativa todos os convites pendentes
         |
         v
Processos aparecem no dashboard
```

## Detalhes Tecnicos

### Edge Function `auto-accept-invites`
```typescript
// Recebe Authorization header automaticamente
// Usa service_role para atualizar registros
// 1. Extrai CPF do user_metadata
// 2. Busca clientes com mesmo documento sem auth_user_id
// 3. Atualiza auth_user_id e status do cliente
// 4. Atualiza cliente_processos para status 'ativo'
```

### Migration para dados existentes
```sql
-- Vincular Elizabeth (auth user) ao registro de cliente
UPDATE clientes SET auth_user_id = '<user_id>', status = 'ativo'
WHERE id = '804c5f0a-...';

-- Ativar convite
UPDATE cliente_processos SET status = 'ativo', data_aceite = now()
WHERE cliente_id = '804c5f0a-...';
```

### Arquivos a criar/modificar
- `supabase/functions/auto-accept-invites/index.ts` - Nova edge function
- `src/pages/dashboard/ClienteDashboard.tsx` - Adicionar chamada a nova funcao
- Migration SQL para corrigir dados existentes

