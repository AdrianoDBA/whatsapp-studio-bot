/**
 * WhatsApp Web QR Code Gateway (Baileys)
 * Allows instant connection to WhatsApp by scanning a QR Code
 * without needing Meta Cloud API approval or Business Verification.
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = 5006;
const FLASK_WEBHOOK_URL = 'http://127.0.0.1:5005/webhook';
const APP_SECRET = process.env.APP_SECRET || 'studio_bot_app_secret_2026';
const AUTH_DIR = process.env.AUTH_DIR || (fs.existsSync('/data') ? '/data/auth_session' : path.join(__dirname, 'auth_session'));

let sock = null;
let currentStatus = 'DISCONNECTED';
let currentQR = null;
let connectedNumber = null;

// Track message IDs and texts sent by the bot itself so we never loop on our own replies,
// while still allowing the photographer to test the bot from their own phone ("Note to Self")!
const botSentMsgIds = new Set();
const processedMsgIds = new Set();
const recentBotTexts = new Set();

// In-Memory Message Store required by Baileys v7 to answer encryption retry receipts (resolves "Waiting for this message")
const rawMessageStore = new Map();

function saveToRawMessageStore(key, message) {
  if (!key || !key.id || !message) return;
  rawMessageStore.set(key.id, message);
  // Keep up to 2000 messages in memory to prevent leaks
  if (rawMessageStore.size > 2000) {
    const oldestKey = rawMessageStore.keys().next().value;
    rawMessageStore.delete(oldestKey);
  }
}

function unwrapMessageContent(m) {
  if (!m) return null;
  if (m.deviceSentMessage?.message) return unwrapMessageContent(m.deviceSentMessage.message);
  if (m.ephemeralMessage?.message) return unwrapMessageContent(m.ephemeralMessage.message);
  if (m.viewOnceMessage?.message) return unwrapMessageContent(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return unwrapMessageContent(m.viewOnceMessageV2.message);
  if (m.viewOnceMessageV2Extension?.message) return unwrapMessageContent(m.viewOnceMessageV2Extension.message);
  if (m.documentWithCaptionMessage?.message) return unwrapMessageContent(m.documentWithCaptionMessage.message);
  if (m.editedMessage?.message) return unwrapMessageContent(m.editedMessage.message);
  return m;
}

async function startSock() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['StudioBot', 'Chrome', '120.0.0'],
    defaultQueryTimeoutMs: undefined,
    // Critical for encryption retry - enables WhatsApp client to decrypt messages without getting stuck on "Aguardando mensagem"
    getMessage: async (key) => {
      if (!key || !key.id) return undefined;
      const stored = rawMessageStore.get(key.id);
      if (stored) return stored;
      return undefined;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentStatus = 'SCAN_QR';
      currentQR = await QRCode.toDataURL(qr);
      console.log('\n[QR_CODE_GERADO] Escaneie o QR Code no navegador ou no console para conectar seu WhatsApp!');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('[WHATSAPP GATEWAY] Conexão fechada. Reconectar:', shouldReconnect);
      currentStatus = 'DISCONNECTED';
      currentQR = null;
      connectedNumber = null;
      if (shouldReconnect) {
        setTimeout(startSock, 3000);
      }
    } else if (connection === 'open') {
      currentStatus = 'CONNECTED';
      currentQR = null;
      connectedNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'Conectado';
      console.log(`\n✅ [WHATSAPP CONECTADO COM SUCESSO] Número: +${connectedNumber}`);
    }
  });

  // Listen for incoming WhatsApp messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Store all messages for retry encryption handling
    for (const m of messages) {
      if (m.key && m.key.id && m.message) {
        saveToRawMessageStore(m.key, m.message);
      }
    }

    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const msgId = msg.key.id;
      if (!msgId || processedMsgIds.has(msgId) || botSentMsgIds.has(msgId)) continue;

      // Ignore historical messages when type === 'append'
      const rawTs = Number(msg.messageTimestamp?.low || msg.messageTimestamp || 0);
      const nowSec = Math.floor(Date.now() / 1000);
      if (rawTs > 0 && (nowSec - rawTs) > 45) {
        continue;
      }

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('broadcast') || remoteJid.includes('newsletter')) continue;

      // Determine if this is the user messaging their own number ("Note to Self" / self-chat test)
      const myNumber = connectedNumber || '';
      const myLid = sock.user?.lid ? sock.user.lid.split(':')[0] : '';
      const isSelfChat = (myNumber && remoteJid.includes(myNumber)) || (myLid && remoteJid.includes(myLid));

      // If fromMe is true, only allow if the user manually typed a message in their own self-chat (and it wasn't sent by the bot)
      if (msg.key.fromMe && !isSelfChat) {
        continue;
      }

      const content = unwrapMessageContent(msg.message);
      if (!content) continue;

      // Ignore protocol/reaction/receipt/image messages
      if (content.protocolMessage || content.reactionMessage || content.pollUpdateMessage || content.imageMessage) continue;

      let text = '';
      let isAudio = false;

      if (content.conversation) {
        text = content.conversation.trim();
      } else if (content.extendedTextMessage?.text) {
        text = content.extendedTextMessage.text.trim();
      } else if (content.buttonsResponseMessage?.selectedDisplayText) {
        text = content.buttonsResponseMessage.selectedDisplayText.trim();
      } else if (content.listResponseMessage?.title) {
        text = content.listResponseMessage.title.trim();
      } else if (content.templateButtonReplyMessage?.selectedDisplayText) {
        text = content.templateButtonReplyMessage.selectedDisplayText.trim();
      } else if (content.audioMessage) {
        isAudio = true;
        text = '[Áudio do WhatsApp]';
      }

      // CRITICAL: Never respond to empty messages or bot signatures
      if (!text && !isAudio) {
        continue;
      }
      if (
        recentBotTexts.has(text) ||
        text.includes('Aqui é a ') ||
        text.includes('Sou a ') ||
        text.includes('Tenho estes 3 horários') ||
        text.includes('Acabei de gerar seu comprovante') ||
        text.includes('Acabei de te mandar alguns exemplos') ||
        text.includes('Já chamei o ') ||
        text.includes('👉 *') ||
        text.includes('🔔 Novo recado') ||
        text.includes('Exemplo 1/3') ||
        text.includes('Exemplo 2/3') ||
        text.includes('Exemplo 3/3') ||
        text.includes('tá em edição') ||
        text.includes('Acabei de avisar') ||
        text.includes('Posso anotar seu recado') ||
        text.includes('horário confirmado') ||
        text.includes('Recebi seu áudio')
      ) {
        continue;
      }

      processedMsgIds.add(msgId);
      if (processedMsgIds.size > 2000) {
        const oldest = processedMsgIds.values().next().value;
        processedMsgIds.delete(oldest);
      }

      const pushName = msg.pushName || 'Cliente';
      console.log(`[GATEWAY INCOMING] ID: ${msgId} | De: ${remoteJid} (${pushName}) | SelfChat: ${isSelfChat} | Tipo: ${isAudio ? 'audio' : 'text'} | Texto: "${text}"`);

      // Forward to Python Flask bot with HMAC-SHA256 signature
      try {
        const bodyStr = JSON.stringify({
          from: remoteJid,
          name: pushName,
          type: isAudio ? 'audio' : 'text',
          text: { body: text },
          id: msgId,
          source: 'baileys_gateway'
        });
        const sig = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(bodyStr).digest('hex');
        await fetch(FLASK_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': sig
          },
          body: bodyStr
        });
      } catch (err) {
        console.error('[GATEWAY ERROR] Falha ao encaminhar mensagem para o Flask:', err.message);
      }
    }
  });
}

// REST Endpoints
app.get('/status', (req, res) => {
  res.json({
    status: currentStatus,
    qr: currentQR,
    connectedNumber: connectedNumber
  });
});

app.get('/generate-qr', async (req, res) => {
  try {
    const text = req.query.text || 'https://localhost:5005/comecar';
    const dataUrl = await QRCode.toDataURL(text, {
      width: 320,
      margin: 2,
      color: { dark: '#111b21', light: '#ffffff' }
    });
    res.json({ qr: dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/send', async (req, res) => {
  const { to, text, buttons, imageUrl, caption } = req.body;
  if (!sock || currentStatus !== 'CONNECTED') {
    return res.status(400).json({ error: 'WhatsApp não está conectado via QR Code' });
  }

  // Handle either raw JID (e.g. 12345@s.whatsapp.net or 12345@lid) or phone number
  let jid = to;
  if (!jid.includes('@')) {
    const cleanPhone = to.replace(/\D/g, '');
    jid = `${cleanPhone}@s.whatsapp.net`;
  }

  try {
    let sentMsg = null;
    if (imageUrl) {
      if (caption) recentBotTexts.add(caption.trim());
      sentMsg = await sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption: caption || ''
      });
      console.log(`[GATEWAY OUTGOING IMAGE] Foto enviada para ${jid}: ${imageUrl}`);
    } else {
      let fullText = text || '';
      if (buttons && buttons.length > 0) {
        fullText += '\n\n' + buttons.map((b, i) => `👉 *${i + 1}. ${b.title || b}*`).join('\n');
      }

      if (fullText.trim()) {
        recentBotTexts.add(fullText.trim());
        if (recentBotTexts.size > 500) {
          const oldestText = recentBotTexts.values().next().value;
          recentBotTexts.delete(oldestText);
        }
      }

      sentMsg = await sock.sendMessage(jid, { text: fullText });
      console.log(`[GATEWAY OUTGOING TEXT] Mensagem enviada para ${jid}`);
    }

    if (sentMsg?.key?.id) {
      botSentMsgIds.add(sentMsg.key.id);
      processedMsgIds.add(sentMsg.key.id);
      if (sentMsg.message) {
        saveToRawMessageStore(sentMsg.key, sentMsg.message);
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error(`[GATEWAY SEND ERROR] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/disconnect', (req, res) => {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    currentStatus = 'DISCONNECTED';
    currentQR = null;
    connectedNumber = null;
    if (sock) sock.end();
    setTimeout(startSock, 1000);
    res.json({ status: 'ok', message: 'Desconectado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[WHATSAPP GATEWAY] Rodando na porta ${PORT}`);
  startSock();
});
