

# Perfil do Cliente a partir dos dados da Judit

## Objetivo
Criar uma tabela `clientes` no banco de dados para persistir as informacoes das partes envolvidas e uma pagina de perfil acessivel ao clicar no nome do cliente dentro do card de processo.

## Dados disponiveis da Judit (ja salvos no JSONB `partes`)
- Nome completo
- CPF ou CNPJ (com tipo do documento)
- Lado no processo (Ativo/Passivo)
- Advogados vinculados (nome, CPF, OAB)

## Etapas

### 1. Criar tabela `clientes` no banco de dados
Nova tabela com os seguintes campos:
- `id` (UUID, chave primaria)
- `user_id` (UUID, referencia ao advogado dono)
- `nome` (texto, nome completo)
- `documento` (texto, CPF ou CNPJ)
- `tipo_documento` (texto, "CPF" ou "CNPJ")
- `tipo_pessoa` (texto, "fisica" ou "juridica")
- `telefone`, `email`, `endereco`, `observacoes` (campos opcionais para preenchimento posterior pelo advogado)
- `created_at`, `updated_at`

Politicas RLS: advogado so ve/edita seus proprios clientes.

### 2. Popular clientes automaticamente na importacao
Atualizar a edge function `import-processes` para, ao importar processos, extrair as partes do lado "Active" (clientes do advogado) e inserir/atualizar na tabela `clientes` usando upsert por `user_id + documento`.

### 3. Popular clientes existentes
Criar uma migration ou script que percorre os processos ja importados e extrai os clientes para a nova tabela.

### 4. Criar pagina de perfil do cliente (`/clientes/:id`)
Pagina com:
- **Cabecalho**: Nome, CPF/CNPJ, tipo de pessoa
- **Informacoes de contato**: telefone, email, endereco (editaveis pelo advogado)
- **Lista de processos vinculados**: todos os processos onde essa parte aparece
- **Observacoes**: campo de texto livre

### 5. Atualizar o botao no card do processo
O badge clicavel com o nome do cliente passara a ser um `Link` para `/clientes/:id` ao inves de apenas filtrar a busca.

### 6. Atualizar a pagina `/clientes` (ClientesList)
Transformar a pagina vazia atual em uma lista real de clientes vindos da tabela, com busca por nome ou documento.

## Detalhes tecnicos

### Tabela SQL
```sql
CREATE TABLE public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  documento TEXT,
  tipo_documento TEXT DEFAULT 'CPF',
  tipo_pessoa TEXT DEFAULT 'fisica',
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Unique constraint e RLS policies
-- Trigger para updated_at
```

### Arquivos modificados
- `supabase/functions/import-processes/index.ts` - extrair e salvar clientes
- `src/pages/processos/ProcessosList.tsx` - badge vira Link para perfil
- `src/pages/clientes/ClientesList.tsx` - lista real de clientes
- `src/pages/clientes/ClienteDetail.tsx` (novo) - pagina de perfil
- `src/hooks/useClientes.ts` (novo) - hook para buscar clientes
- `src/App.tsx` - adicionar rota `/clientes/:id`

### Fluxo do usuario
1. Advogado ve a lista de processos
2. Clica no nome do cliente no card
3. Abre o perfil do cliente com dados da Judit + processos vinculados
4. Pode adicionar telefone, email e observacoes manualmente
