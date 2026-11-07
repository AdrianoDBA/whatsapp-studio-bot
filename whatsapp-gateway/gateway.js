/**
 * WhatsApp Multi-Profile Gateway (Baileys)
 * Allows concurrent independent connections for 4 test profiles:
 * - meu_numero
 * - esposa
 * - filho
 * - bot_estudio
 *
 * Each session has strict folder isolation and independent connection states.
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
const FLASK_PORT = process.env.PORT || '5005';
const FLASK_WEBHOOK_URL = process.env.FLASK_WEBHOOK_URL || `http://127.0.0.1:${FLASK_PORT}/webhook`;
const APP_SECRET = process.env.APP_SECRET || 'studio_bot_app_secret_2026';
const AUTH_BASE_DIR = process.env.AUTH_DIR || (fs.existsSync('/data') ? '/data/auth_session' : path.join(__dirname, 'auth_session'));

// Process error guards to prevent crash from unexpected disconnects
process.on('uncaughtException', (err) => {
  console.error('[GATEWAY UNCAUGHT EXCEPTION]', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[GATEWAY UNHANDLED REJECTION]', reason);
});

// Track message IDs and texts sent by the bot so we never loop on our own replies
const botSentMsgIds = new Set();
const processedMsgIds = new Set();
const recentBotTexts = new Set();

// In-Memory Message Store required by Baileys to answer encryption retry receipts
const rawMessageStore = new Map();

function saveToRawMessageStore(key, message) {
  if (!key || !key.id || !message) return;
  rawMessageStore.set(key.id, message);
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

// Dynamic Sessions Map - Zero hardcoded profiles or pre-baked sessions
const SESSIONS = {};

function getOrCreateSession(sessionId) {
  if (!SESSIONS[sessionId]) {
    SESSIONS[sessionId] = {
      id: sessionId,
      apelido: `Instância ${sessionId}`,
      sock: null,
      status: 'DISCONNECTED',
      qr: null,
      connectedNumber: null,
      lastConnected: null,
      authDir: path.join(AUTH_BASE_DIR, sessionId),
      reconnectTimer: null
    };
  }
  return SESSIONS[sessionId];
}

async function startSession(profileId) {
  const session = SESSIONS[profileId] || getOrCreateSession(profileId);
  if (!session) return;

  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }

  if (session.sock) {
    try {
      session.sock.ev.removeAllListeners();
      session.sock.end();
    } catch (e) {}
    session.sock = null;
  }

  if (!fs.existsSync(session.authDir)) {
    fs.mkdirSync(session.authDir, { recursive: true });
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(session.authDir);

    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: [`StudioBot-${profileId}`, 'Chrome', '120.0.0'],
      defaultQueryTimeoutMs: undefined,
      getMessage: async (key) => {
        if (!key || !key.id) return undefined;
        return rawMessageStore.get(key.id);
      }
    });

    session.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.status = 'SCAN_QR';
        session.qr = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
        console.log(`[QR_CODE_GERADO] Perfil '${session.apelido}' (${profileId}) pronto para escaneamento.`);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const shouldReconnect = !isLoggedOut;

        console.log(`[GATEWAY] Perfil '${profileId}' desconectado (código: ${statusCode}). Reconectar: ${shouldReconnect}`);
        session.status = 'DISCONNECTED';
        session.qr = null;
        session.connectedNumber = null;

        if (isLoggedOut) {
          console.log(`[GATEWAY] Perfil '${profileId}' deslogado pelo usuário. Limpando credenciais...`);
          try {
            fs.rmSync(session.authDir, { recursive: true, force: true });
          } catch (e) {}
          session.reconnectTimer = setTimeout(() => startSession(profileId), 2000);
        } else if (shouldReconnect) {
          session.reconnectTimer = setTimeout(() => startSession(profileId), 3000);
        }
      } else if (connection === 'open') {
        session.status = 'CONNECTED';
        session.qr = null;
        session.connectedNumber = sock.user?.id ? sock.user.id.split(':')[0] : 'Conectado';
        session.lastConnected = new Date().toISOString();
        console.log(`\n✅ [WHATSAPP CONECTADO] Perfil '${session.apelido}' (${profileId}): +${session.connectedNumber}`);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
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

        const rawTs = Number(msg.messageTimestamp?.low || msg.messageTimestamp || 0);
        const nowSec = Math.floor(Date.now() / 1000);
        if (rawTs > 0 && (nowSec - rawTs) > 300) {
          continue;
        }

        const unwrapped = unwrapMessageContent(msg.message);
        if (!unwrapped) continue;

        const isAudio = Boolean(unwrapped.audioMessage);
        const isImage = Boolean(unwrapped.imageMessage);
        const text = (
          unwrapped.conversation ||
          unwrapped.extendedTextMessage?.text ||
          unwrapped.imageMessage?.caption ||
          unwrapped.videoMessage?.caption ||
          (isAudio ? '[Mensagem de Áudio]' : '')
        ).trim();

        if (!text && !isAudio && !isImage) continue;

        const remoteJid = msg.key.remoteJid || '';
        if (remoteJid.includes('@g.us') || remoteJid.includes('status@broadcast')) {
          continue;
        }

        const isFromMe = Boolean(msg.key.fromMe);
        const userJid = session.sock?.user?.id ? session.sock.user.id.split(':')[0] + '@s.whatsapp.net' : '';
        const isSelfChat = isFromMe && (remoteJid === userJid || remoteJid.startsWith(session.connectedNumber || '___'));

        if (isFromMe && !isSelfChat) {
          continue;
        }

        // Anti-loop checks
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
        console.log(`[GATEWAY INCOMING] Perfil: ${profileId} | De: ${remoteJid} (${pushName}) | Texto: "${text}"`);

        // Forward to Flask webhook
        try {
          const bodyStr = JSON.stringify({
            from: remoteJid,
            name: pushName,
            type: isAudio ? 'audio' : 'text',
            text: { body: text },
            id: msgId,
            source: 'baileys_gateway',
            is_self_chat: isSelfChat,
            phone_number_id: session.connectedNumber || '',
            profile: profileId
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
          console.error(`[GATEWAY ERROR] Falha ao encaminhar mensagem do perfil '${profileId}' para Flask:`, err.message);
        }
      }
    });
  } catch (err) {
    console.error(`[GATEWAY ERROR] Falha ao iniciar sessão '${profileId}':`, err.message);
    session.reconnectTimer = setTimeout(() => startSession(profileId), 4000);
  }
}

function startAllSessions() {
  if (fs.existsSync(AUTH_BASE_DIR)) {
    try {
      const dirs = fs.readdirSync(AUTH_BASE_DIR, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory()) {
          const credsFile = path.join(AUTH_BASE_DIR, d.name, 'creds.json');
          if (fs.existsSync(credsFile)) {
            console.log(`[GATEWAY] Retomando sessão salva para o workspace: ${d.name}`);
            startSession(d.name);
          }
        }
      }
    } catch (e) {
      console.error('[GATEWAY] Erro ao carregar sessões salvas:', e.message);
    }
  }
}

// REST Endpoints
app.get('/profiles', (req, res) => {
  const result = {};
  for (const [pid, s] of Object.entries(SESSIONS)) {
    result[pid] = {
      id: s.id,
      apelido: s.apelido,
      status: s.status,
      qr: s.qr,
      connectedNumber: s.connectedNumber,
      lastConnected: s.lastConnected
    };
  }
  res.json({ ok: true, profiles: result });
});

app.get('/profiles/:profile/status', (req, res) => {
  const pid = req.params.profile;
  const s = SESSIONS[pid];
  if (!s) {
    return res.status(404).json({ ok: false, error: 'Perfil não encontrado' });
  }
  res.json({
    ok: true,
    id: s.id,
    apelido: s.apelido,
    status: s.status,
    qr: s.qr,
    connectedNumber: s.connectedNumber,
    lastConnected: s.lastConnected
  });
});

// Backward compatibility with legacy /status
app.get('/status', (req, res) => {
  const targetProfile = req.query.profile || 'meu_numero';
  const s = SESSIONS[targetProfile] || SESSIONS.meu_numero;
  res.json({
    status: s.status,
    qr: s.qr,
    connectedNumber: s.connectedNumber,
    profile: s.id,
    apelido: s.apelido,
    lastConnected: s.lastConnected
  });
});

app.get('/generate-qr', async (req, res) => {
  try {
    const text = req.query.text || 'https://localhost:5005/conectar';
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
  const { to, text, buttons, imageUrl, caption, profile } = req.body;

  // Determine which profile session to use
  let activeSession = null;
  if (profile && SESSIONS[profile] && SESSIONS[profile].status === 'CONNECTED') {
    activeSession = SESSIONS[profile];
  } else {
    // Pick first connected session or bot_estudio or meu_numero
    for (const pid of ['bot_estudio', 'meu_numero', 'esposa', 'filho']) {
      if (SESSIONS[pid]?.status === 'CONNECTED') {
        activeSession = SESSIONS[pid];
        break;
      }
    }
  }

  if (!activeSession || !activeSession.sock || activeSession.status !== 'CONNECTED') {
    return res.status(400).json({ error: 'Nenhum WhatsApp conectado via QR Code no momento' });
  }

  let jid = to;
  if (!jid.includes('@')) {
    const cleanPhone = to.replace(/\D/g, '');
    jid = `${cleanPhone}@s.whatsapp.net`;
  }

  try {
    let sentMsg = null;
    if (imageUrl) {
      if (caption) recentBotTexts.add(caption.trim());
      sentMsg = await activeSession.sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption: caption || ''
      });
      console.log(`[GATEWAY OUTGOING IMAGE] Foto enviada pelo perfil '${activeSession.id}' para ${jid}: ${imageUrl}`);
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

      sentMsg = await activeSession.sock.sendMessage(jid, { text: fullText });
      console.log(`[GATEWAY OUTGOING TEXT] Mensagem enviada pelo perfil '${activeSession.id}' para ${jid}`);
    }

    if (sentMsg?.key?.id) {
      botSentMsgIds.add(sentMsg.key.id);
      processedMsgIds.add(sentMsg.key.id);
      if (sentMsg.message) {
        saveToRawMessageStore(sentMsg.key, sentMsg.message);
      }
    }

    res.json({ status: 'ok', profile: activeSession.id });
  } catch (err) {
    console.error(`[GATEWAY SEND ERROR] Perfil '${activeSession.id}': ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/profiles/:profile/disconnect', (req, res) => {
  const pid = req.params.profile;
  const s = SESSIONS[pid];
  if (!s) {
    return res.status(404).json({ ok: false, error: 'Perfil não encontrado' });
  }

  try {
    s.status = 'DISCONNECTED';
    s.qr = null;
    s.connectedNumber = null;
    if (s.sock) {
      try {
        s.sock.ev.removeAllListeners();
        s.sock.end();
      } catch (e) {}
      s.sock = null;
    }
    if (fs.existsSync(s.authDir)) {
      fs.rmSync(s.authDir, { recursive: true, force: true });
    }
    setTimeout(() => startSession(pid), 800);
    res.json({ ok: true, status: 'ok', message: `Perfil '${s.apelido}' desconectado com sucesso` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/profiles/:profile/reconnect', (req, res) => {
  const pid = req.params.profile;
  const s = SESSIONS[pid];
  if (!s) {
    return res.status(404).json({ ok: false, error: 'Perfil não encontrado' });
  }

  s.status = 'DISCONNECTED';
  s.qr = null;
  setTimeout(() => startSession(pid), 500);
  res.json({ ok: true, message: `Reconexão do perfil '${s.apelido}' iniciada.` });
});

// Dynamic Multi-Tenant Session Management
app.get('/session/:id/qr', async (req, res) => {
  const sessionId = req.params.id;
  const session = getOrCreateSession(sessionId);

  if (session.status === 'CONNECTED') {
    return res.json({ status: 'connected', connected: true, connectedNumber: session.connectedNumber });
  }

  if (!session.sock) {
    startSession(sessionId);
  }

  // Se já tiver QR pronto
  if (session.qr) {
    return res.json({ status: 'qr_ready', connected: false, qr: session.qr });
  }

  // Espera até 6 segundos para o QR code ser gerado pelo Baileys
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (session.qr) {
      return res.json({ status: 'qr_ready', connected: false, qr: session.qr });
    }
    if (session.status === 'CONNECTED') {
      return res.json({ status: 'connected', connected: true, connectedNumber: session.connectedNumber });
    }
  }

  res.json({ status: session.status, connected: session.status === 'CONNECTED', qr: session.qr });
});

app.get('/session/:id/status', (req, res) => {
  const sessionId = req.params.id;
  const session = SESSIONS[sessionId];
  if (!session) {
    return res.json({ status: 'disconnected', connected: false });
  }
  res.json({
    status: session.status.toLowerCase(),
    connected: session.status === 'CONNECTED',
    connectedNumber: session.connectedNumber,
    lastConnected: session.lastConnected,
  });
});

app.post('/session/:id/disconnect', (req, res) => {
  const sessionId = req.params.id;
  const session = SESSIONS[sessionId];
  if (!session) {
    return res.json({ ok: true });
  }

  session.status = 'DISCONNECTED';
  session.qr = null;
  session.connectedNumber = null;

  if (session.sock) {
    try {
      session.sock.ev.removeAllListeners();
      session.sock.end();
    } catch (e) {}
    session.sock = null;
  }

  if (fs.existsSync(session.authDir)) {
    try {
      fs.rmSync(session.authDir, { recursive: true, force: true });
    } catch (e) {}
  }

  res.json({ ok: true, status: 'disconnected' });
});

app.post('/session/:id/send', async (req, res) => {
  const sessionId = req.params.id;
  const session = SESSIONS[sessionId];

  if (!session || !session.sock || session.status !== 'CONNECTED') {
    return res.status(400).json({ error: 'WhatsApp desta organização não está conectado' });
  }

  const { to, text } = req.body;
  if (!to || !text) {
    return res.status(400).json({ error: 'Campos to e text são obrigatórios' });
  }

  let jid = to;
  if (!jid.includes('@')) {
    const cleanPhone = to.replace(/\D/g, '');
    jid = `${cleanPhone}@s.whatsapp.net`;
  }

  try {
    const sentMsg = await session.sock.sendMessage(jid, { text });
    if (sentMsg?.key?.id) {
      botSentMsgIds.add(sentMsg.key.id);
      processedMsgIds.add(sentMsg.key.id);
    }
    res.json({ status: 'ok', msgId: sentMsg?.key?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backward compatibility with legacy /disconnect
app.post('/disconnect', (req, res) => {
  const targetProfile = req.body?.profile || 'meu_numero';
  const s = SESSIONS[targetProfile] || SESSIONS.meu_numero;
  try {
    s.status = 'DISCONNECTED';
    s.qr = null;
    s.connectedNumber = null;
    if (s.sock) {
      try {
        s.sock.ev.removeAllListeners();
        s.sock.end();
      } catch (e) {}
      s.sock = null;
    }
    if (fs.existsSync(s.authDir)) {
      fs.rmSync(s.authDir, { recursive: true, force: true });
    }
    setTimeout(() => startSession(s.id), 800);
    res.json({ status: 'ok', message: `Perfil '${s.apelido}' desconectado` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[WHATSAPP GATEWAY] Multi-Sessão rodando na porta ${PORT}`);
  startAllSessions();
});
