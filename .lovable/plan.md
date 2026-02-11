

# Integrar WhatsApp via Evolution API na pagina de Atendimento

## Visao Geral

A pagina de Atendimento sera transformada em uma central de WhatsApp completa, conectando-se a uma instancia da **Evolution API** (hospedada por voce externamente). O fluxo sera: configurar a URL da API, escanear o QR Code, e entao enviar/receber mensagens diretamente pelo sistema.

## Pre-requisitos

Voce precisara ter uma instancia da **Evolution API** rodando em um servidor proprio (VPS, Docker, etc). A Evolution API e gratuita e open-source: [github.com/EvolutionAPI/evolution-api](https://github.com/EvolutionAPI/evolution-api).

Apos instalar, voce tera:
- Uma **URL base** (ex: `https://sua-evolution.com`)
- Uma **API Key** para autenticacao

Esses dados serao armazenados de forma segura no backend do Lovable Cloud.

## Etapas da Implementacao

### 1. Armazenar credenciais da Evolution API
- Solicitar ao usuario a **URL** e **API Key** da Evolution API
- Armazena-las como secrets seguros no backend

### 2. Criar edge functions de integracao
- **`evolution-whatsapp`**: Edge function que faz proxy das chamadas para a Evolution API:
  - `POST /connect` - Cria instancia e retorna QR Code
  - `GET /status` - Verifica status da conexao
  - `GET /qrcode` - Busca QR Code atualizado
  - `POST /send` - Envia mensagem de texto
  - `GET /messages` - Busca historico de mensagens
  - `POST /disconnect` - Desconecta a instancia

### 3. Tabelas no banco de dados
- **`whatsapp_instancias`**: Armazena dados da instancia conectada por advogado (user_id, instance_name, status, phone_number)
- **`whatsapp_mensagens`**: Historico de mensagens (instancia_id, contato, direcao, conteudo, timestamp)
- **`whatsapp_contatos`**: Contatos do WhatsApp (nome, numero, foto)
- RLS para garantir que cada advogado ve apenas suas proprias conversas

### 4. Webhook para receber mensagens
- **`evolution-webhook`**: Edge function que recebe webhooks da Evolution API quando chegam novas mensagens
- Salva a mensagem na tabela `whatsapp_mensagens`
- Cria notificacao na tabela `notificacoes` para o advogado
- Realtime habilitado nas tabelas para atualizacao instantanea

### 5. Interface da pagina de Atendimento
A pagina tera 3 estados:

**Estado 1 - Nao configurado**: Botao para ir em Configuracoes e inserir URL/API Key da Evolution API

**Estado 2 - Configurado, nao conectado**: Exibe QR Code para escanear com WhatsApp. Atualiza automaticamente a cada 30s. Mostra instrucoes passo a passo.

**Estado 3 - Conectado**: Layout estilo chat com:
- **Painel esquerdo**: Lista de conversas com busca, ordenadas por ultima mensagem
- **Painel direito**: Chat aberto com historico de mensagens, campo de envio de texto
- Indicador de status da conexao (online/offline)
- Botao para desconectar

### 6. Pagina de Configuracoes
- Nova secao "WhatsApp / Evolution API" com campos para URL e API Key
- Botao para testar conexao
- Status da instancia atual

---

## Detalhes Tecnicos

### Edge Function: `evolution-whatsapp`
```
Endpoints proxied:
- POST /api/v1/instance/create
- GET  /api/v1/instance/connectionState/{instance}
- GET  /api/v1/instance/fetchInstances
- POST /api/v1/message/sendText/{instance}
- POST /api/v1/chat/findMessages/{instance}
```

### Tabelas (migracao SQL)
```text
whatsapp_instancias
+------------------+-------------------+
| user_id (UUID)   | FK auth.users     |
| instance_name    | TEXT              |
| instance_id      | TEXT              |
| status           | TEXT              |
| phone_number     | TEXT              |
| created_at       | TIMESTAMPTZ       |
+------------------+-------------------+

whatsapp_mensagens
+------------------+-------------------+
| instancia_id     | FK instancias     |
| remote_jid       | TEXT (contato)    |
| direcao          | TEXT (in/out)     |
| conteudo         | TEXT              |
| tipo             | TEXT              |
| timestamp        | TIMESTAMPTZ       |
| message_id       | TEXT              |
+------------------+-------------------+
```

### Realtime
Habilitado em `whatsapp_mensagens` para atualizacao em tempo real do chat.

### Webhook
A Evolution API sera configurada para enviar eventos para:
`https://<project-id>.supabase.co/functions/v1/evolution-webhook`

### Arquivos que serao criados/editados
- `supabase/functions/evolution-whatsapp/index.ts` (novo)
- `supabase/functions/evolution-webhook/index.ts` (novo)
- `src/pages/atendimento/Atendimento.tsx` (reescrito)
- `src/hooks/useWhatsApp.ts` (novo)
- `src/pages/configuracoes/Configuracoes.tsx` (editado - secao Evolution API)
- Migracao SQL para novas tabelas
- `supabase/config.toml` atualizado com as novas functions

