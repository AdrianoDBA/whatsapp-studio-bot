# Studio Fotográfico - WhatsApp Cloud API Bot (SaaS Edition)

![LGPD OK](https://img.shields.io/badge/Seguran%C3%A7a-LGPD%20OK-25D366?style=for-the-badge&logo=shield&logoColor=white)
![Anti-Loop](https://img.shields.io/badge/Prote%C3%A7%C3%A3o-Anti--Loop-00a884?style=for-the-badge&logo=whatsapp&logoColor=white)
![Dados Criptografados](https://img.shields.io/badge/Fernet%20AES--128-Dados%20Criptografados-4285F4?style=for-the-badge&logo=lock&logoColor=white)

Camada SaaS multi-tenant para fotógrafos com PWA instalável (React + Vite), persona dinâmica com Gemini 3.8 Flash, Agendamento Real (`slots`), Follow-up Inteligente de 30h e blindagem completa **Anti-Loop & LGPD**.

---

## 🔒 SEGURANÇA (LGPD OK • Anti-Loop • Dados Criptografados)

| Selo de Conformidade | Status | Proteção Implementada |
| :--- | :---: | :--- |
| 🛡️ **[LGPD OK]** | ✅ Ativo | Direito de Exclusão em 1 Clique (`DELETE /lgpd/delete/:wa_id`), Portabilidade JSON (`GET /lgpd/export/:wa_id`) e Mascaramento de Dados Sensíveis nos logs (`***1234`). |
| 🔁 **[Anti-Loop]** | ✅ Ativo | 6 Travas Definitivas: Idempotência SQLite (`processed_messages`), Filtro de Eco (`PHONE_NUMBER_ID` / `bot`), Filtro de Status (`read`/`delivered`), Debounce `<3s` (`last_message_time`), Trava de Re-engajamento (`FOLLOWUP_SENT` + `followup_count <= 2`) e Auditoria `LOOP_BLOCKED`. |
| 🔐 **[Dados Criptografados]** | ✅ Ativo | Criptografia simétrica **Fernet (`cryptography.fernet`)** em repouso no SQLite para `WHATSAPP_TOKEN` e `transcription` (transcrições de áudio), mais backups criptografados com senha (`backup.py` via PBKDF2-HMAC-SHA256). |

### Detalhes da Blindagem de Segurança:
1. **Webhook Verificado (HMAC-SHA256)**: Validação estrita do cabeçalho `X-Hub-Signature-256` com `APP_SECRET` (`hmac.compare_digest`), retornando `403 Forbidden` para qualquer requisição sem assinatura válida.
2. **Zero SQL Injection**: 100% das queries SQLite utilizam *parameterized queries* (`?`). Nenhuma query utiliza `f-string`.
3. **Validação & Anti-XSS (`/onboarding` e `/comecar`)**: Bloqueio de tags `<script>`, payloads XSS/SQLi, escape HTML (`html.escape`) e limite máximo de 50 caracteres nos campos de nome.
4. **Rate Limiting (`Flask-Limiter`)**: Limite de **60 requisições/minuto por IP** na rota `/webhook`, retornando `429 Too Many Requests` contra abusos.
5. **Segredos Fora do Git**: `.gitignore` bloqueia `.env`, `*.db`, `backups/`, `*.enc` e `__pycache__`.

---

## 🌟 Funcionalidades SaaS & Atendimento Inteligente

1. **PWA Instalável em 1 Clique (`/comecar` e `/ajuda`)**:
   - Configurado com `manifest.json` (`Bot do Studio`, cor `#25D366`, display `standalone`) e `service-worker.js`.
   - Botão de parada instantânea **`🛑 PARAR BOT` / `▶️ RELIGAR BOT`** no topo do `/dashboard`.

2. **Tempos de Atendimento Automático (10s / 1 min / 30h)**:
   - **10 segundos**: Cliente chama → se o fotógrafo (Gustavo/Leo) não responder em 10s, a secretária virtual assume.
   - **1 minuto (60s)**: Se o cliente pedir para falar com o fotógrafo, aguarda 1 minuto e re-engaja (máximo 2 vezes por ciclo com trava `FOLLOWUP_SENT`).
   - **30 horas**: Thread em background analisa o histórico completo via Gemini respeitando a janela de 24h da Meta (`<24h` mensagem normal vs `>24h` template aprovado).

3. **Agendamento Real no Banco (`slots`)**:
   - Consulta os 3 horários livres (`free`) mais próximos no SQLite, reserva como `busy`, envia confirmação de sinal Pix R\$ 100 e gera comprovante formatado na aba **📅 Agendamentos**.

---

## 🚀 Rotas Disponíveis

- **`/comecar`**: Instalação e conexão em 1 clique para o fotógrafo no WhatsApp.
- **`/instagram-comecar`**: Conexão em 1 clique da conta do Instagram com botão degradê rosa.
- **`/dashboard`**: Painel Unificado com abas `[💬 WhatsApp]` e `[📸 Instagram]`, comentários que viraram DM, DMs pendentes e atalho direto `ig.me/m/{username}`.
- **`/onboarding`**: Configuração do estúdio, persona, preços, portfólio, horários da agenda (`slots`) e palavras-chave de ativação do Instagram.
- **`/ajuda`**: Vídeos interativos de 20 segundos (Conectar WhatsApp, iPhone, Android).
- **`/webhook`**: Endpoint oficial do WhatsApp com validação HMAC-SHA256 e Rate Limit (60 req/min).
- **`/webhook/instagram`**: Endpoint oficial do Instagram Graph API para comentários, stories e DMs.
- **`/lgpd/export/<wa_id>`**: Exportação completa dos dados do cliente em JSON (LGPD).
- **`/lgpd/delete/<wa_id>`**: Exclusão completa dos dados do cliente em 1 clique (LGPD).

---

## 📸 MÓDULO INSTAGRAM (COMBO INSTA + ZAP R$ 197/mês)

O Bot do Studio agora conta com o módulo completo de conversão automática no Instagram oficial da Meta Graph API:

1. **Comment to DM (Mais Importante)**:
   - Monitora comentários nas publicações com palavras-chave (*"preço"*, *"valor"*, *"quanto"*, *"quero"*, *"info"*, *"ensaio"*, etc.).
   - Responde publicamente no comentário: *"Te respondi no DM! 📸"*.
   - Chama imediatamente na DM privada com o menu de ensaios e horários livres reais da agenda (`slots`).
2. **Story Mention / Reply**:
   - Detecta respostas e menções em stories.
   - Responde no DM: *"Obrigada por responder o story! Quer agendar seu ensaio? Tenho [3 horários livres]"*.
3. **DM Keyword & Atendimento Humano**:
   - Responde dúvidas sobre pacotes e horários com a secretária virtual.
   - Encaminha automaticamente para `WAITING_HUMAN` caso o cliente peça para falar com o fotógrafo, surgindo com destaque no `/dashboard`.
4. **Blindagem Anti-Ban e Segurança Meta**:
   - Limite de segurança de no máximo 50 comentários respondidos por período de 24 horas.
   - Trava anti-spam que impede o envio de DMs repetidas para o mesmo seguidor em menos de 5 minutos.
   - Idempotência de mensagens com `processed_messages`.

---

## 🛠️ Como Executar e Auditar

```bash
cd /Users... .gemini/antigravity/scratch/whatsapp-studio-bot
source .venv/bin/activate

# 1. Rodar suíte funcional (8 testes)
python test_bot.py

# 2. Rodar auditoria de segurança e anti-loop (20 testes)
python security_audit.py

# 3. Gerar backup criptografado do SQLite
python backup.py
```
