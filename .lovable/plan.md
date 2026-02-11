
# Convite de Cliente para Acompanhar Processo

## Resumo
Permitir que o advogado convide um cliente para acompanhar um processo no Jarvis Jud. O backend decide automaticamente se o cliente ja existe ou precisa ser criado, mantendo a interface simples com um unico botao.

## Modelagem de Dados

### Alteracoes na tabela `clientes`
- Adicionar campo `auth_user_id` (UUID, nullable) - referencia ao usuario autenticado do cliente (preenchido quando o cliente cria conta ou ja possui uma)
- Adicionar campo `status` (TEXT, default 'pendente') - status do cliente no sistema ('pendente' ou 'ativo')

### Nova tabela `cliente_processos`
Tabela de vinculo entre cliente e processo, com controle de convite:

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID | Chave primaria |
| cliente_id | UUID | FK para clientes |
| processo_id | UUID | FK para processos |
| advogado_user_id | UUID | Advogado que fez o convite |
| status | TEXT | 'pendente', 'aceito', 'ativo' |
| token | TEXT | Token unico para link de aceite |
| data_convite | TIMESTAMPTZ | Data do convite |
| data_aceite | TIMESTAMPTZ | Data do aceite |
| created_at | TIMESTAMPTZ | |

- Constraint UNIQUE em (cliente_id, processo_id) para evitar duplicatas
- RLS: advogado ve seus proprios convites; cliente (via auth_user_id) ve convites dirigidos a ele

## Backend (Edge Functions)

### 1. `convidar-processo`
- Recebe: `cliente_id`, `processo_id`
- Verifica se ja existe vinculo (impede duplicata)
- Cria registro em `cliente_processos` com status 'pendente' e token unico
- Se o cliente tem email cadastrado, envia email via Resend com link de ativacao
- Retorna sucesso com o token gerado

### 2. `aceitar-convite`
- Recebe: `token`
- Busca o convite pelo token
- Se cliente nao tem `auth_user_id`:
  - Redireciona para pagina de cadastro com dados pre-preenchidos (nome, CPF do cliente)
  - Apos cadastro, vincula `auth_user_id` e muda status para 'ativo'
- Se cliente ja tem `auth_user_id`:
  - Muda status do vinculo para 'ativo'
- Retorna dados do convite

## Frontend

### Pagina ClienteDetail (`/clientes/:id`)
- Adicionar botao "Convidar para acompanhar processo" sempre visivel abaixo do cabecalho
- Ao clicar, abre um Dialog listando os processos vinculados ao cliente (encontrados via `partes`)
- Advogado seleciona o processo e confirma
- Sistema chama a edge function `convidar-processo`
- Exibe feedback de sucesso com o link de convite (para copiar/compartilhar)
- Na secao de processos vinculados, mostrar o status do convite (pendente/ativo) ao lado de cada processo

### Pagina de Aceite (`/convite/:token`)
- Nova rota publica (nao requer autenticacao)
- Exibe dados do processo e do advogado
- Se cliente nao tem conta: mostra formulario de cadastro com nome e CPF pre-preenchidos
- Se cliente ja tem conta: mostra botao "Aceitar convite" (requer login)
- Apos aceite, redireciona para o dashboard do cliente

### Dashboard do Cliente (`ClienteDashboard`)
- Atualizar para buscar processos via `cliente_processos` onde `status = 'ativo'`
- Exibir lista de processos com movimentacoes

## Fluxo Completo

```text
Advogado abre perfil do cliente
         |
         v
Clica "Convidar para acompanhar processo"
         |
         v
Seleciona o processo no dialog
         |
         v
Backend cria vinculo (cliente_processos)
com status "pendente" + token unico
         |
         v
Email enviado ao cliente (se email cadastrado)
+ Link copiavel para o advogado
         |
         v
Cliente acessa o link /convite/:token
         |
    +---------+---------+
    |                   |
 Sem conta          Com conta
    |                   |
 Cadastro           Login +
 pre-preenchido     Aceitar
    |                   |
    +-------------------+
         |
         v
Status muda para "ativo"
Processo aparece no painel do cliente
```

## Detalhes Tecnicos

### Migration SQL
```sql
-- Adicionar campos na tabela clientes
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS auth_user_id UUID,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente';

-- Tabela de vinculo cliente-processo
CREATE TABLE public.cliente_processos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  advogado_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  data_convite TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_aceite TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cliente_id, processo_id)
);

ALTER TABLE public.cliente_processos ENABLE ROW LEVEL SECURITY;

-- RLS: advogado ve seus convites
CREATE POLICY "Advogado can manage own invites"
  ON public.cliente_processos FOR ALL
  TO authenticated
  USING (auth.uid() = advogado_user_id);

-- RLS: cliente ve convites dirigidos a ele
CREATE POLICY "Cliente can view own invites"
  ON public.cliente_processos FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clientes
      WHERE clientes.id = cliente_processos.cliente_id
      AND clientes.auth_user_id = auth.uid()
    )
  );

-- RLS: cliente pode atualizar status do convite
CREATE POLICY "Cliente can accept invites"
  ON public.cliente_processos FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clientes
      WHERE clientes.id = cliente_processos.cliente_id
      AND clientes.auth_user_id = auth.uid()
    )
  );
```

### Arquivos a criar/modificar
- `supabase/migrations/` - Nova migration com tabela e alteracoes
- `supabase/functions/convidar-processo/index.ts` - Edge function de convite
- `supabase/functions/aceitar-convite/index.ts` - Edge function de aceite
- `src/pages/clientes/ClienteDetail.tsx` - Adicionar botao + dialog de convite
- `src/pages/convite/AceitarConvite.tsx` - Nova pagina publica de aceite
- `src/pages/dashboard/ClienteDashboard.tsx` - Buscar processos vinculados
- `src/hooks/useClienteProcessos.ts` - Hook para vinculos
- `src/App.tsx` - Adicionar rota `/convite/:token`
