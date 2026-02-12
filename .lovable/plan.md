

## Diagnostico

Existem **dois problemas criticos** impedindo o funcionamento correto:

### Problema 1: Mensagens nao salvam no banco (causa raiz principal)

O indice unico na coluna `message_id` da tabela `whatsapp_mensagens` foi criado como **indice parcial** (`WHERE message_id IS NOT NULL`). O PostgreSQL **nao suporta** `ON CONFLICT` com indices parciais. Por isso, **100% dos upserts do webhook falham** com o erro:

```
"there is no unique or exclusion constraint matching the ON CONFLICT specification"
```

Consequencias:
- Nenhuma mensagem e salva no banco de dados
- O Realtime nunca dispara (pois nao ha INSERTs)
- Mensagens enviadas/recebidas nao aparecem em tempo real
- Historico de conversas fica vazio (o fallback ao banco nao encontra nada)

### Problema 2: Nomes dos contatos

Os endpoints da Evolution API (`findContacts`, `contact/find`) retornam 0 contatos ou erro. Os nomes vem apenas de:
- `pushName` do objeto de chat (nome de perfil do WhatsApp, nao o nome salvo na agenda)
- Banco de dados local (apenas 2-120 registros salvos)

Muitos contatos aparecem apenas como numero de telefone.

---

## Plano de Correcao

### Passo 1: Corrigir o indice unico (migracao SQL)

- Remover o indice parcial atual `whatsapp_mensagens_message_id_unique`
- Criar um **UNIQUE CONSTRAINT real** na coluna `message_id` (sem clausula WHERE)
- Para lidar com valores NULL duplicados, definir um valor default usando `gen_random_uuid()` para linhas existentes sem `message_id`

```sql
-- Remove partial index
DROP INDEX IF EXISTS whatsapp_mensagens_message_id_unique;

-- Fill NULL message_ids with unique values
UPDATE whatsapp_mensagens SET message_id = gen_random_uuid()::text WHERE message_id IS NULL;

-- Make column NOT NULL with default
ALTER TABLE whatsapp_mensagens ALTER COLUMN message_id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE whatsapp_mensagens ALTER COLUMN message_id SET NOT NULL;

-- Create proper unique constraint
ALTER TABLE whatsapp_mensagens ADD CONSTRAINT whatsapp_mensagens_message_id_key UNIQUE (message_id);
```

### Passo 2: Melhorar resolucao de nomes dos contatos

Atualizar a edge function `evolution-whatsapp` no `fetch-chats`:

- Extrair `pushName` de **todas** as mensagens nos chats, nao apenas do `lastMessage`
- Usar `notify` field do chat quando disponivel
- Cachear nomes resolvidos no banco para uso futuro
- Quando o contato so tem numero, formatar como "+55 (XX) XXXXX-XXXX" para melhor legibilidade

### Passo 3: Salvar nomes recebidos via webhook

Atualizar `evolution-webhook` para salvar o `pushName` em cada mensagem recebida na tabela `whatsapp_contatos`, garantindo que nomes se acumulem ao longo do tempo.

---

## Detalhes Tecnicos

### Arquivos modificados:
1. **Nova migracao SQL** - corrigir constraint do `message_id`
2. **`supabase/functions/evolution-whatsapp/index.ts`** - melhorar resolucao de nomes no `fetch-chats`
3. **`supabase/functions/evolution-webhook/index.ts`** - ja salva pushName (funcionara apos correcao do indice)

### Resultado esperado:
- Webhook passa a salvar mensagens com sucesso
- Realtime funciona e mensagens aparecem instantaneamente
- Historico de conversas fica disponivel
- Nomes dos contatos melhoram progressivamente conforme mensagens chegam
