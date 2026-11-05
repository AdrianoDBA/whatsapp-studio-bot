-- ============================================================================
-- SCHEMA POSTGRESQL PARA O COMPUTADOR DO FOTÓGRAFO (RELATÓRIOS E BACKUP)
-- Gustavo Alves Fotografia - Sistema 100% Integrado
-- ============================================================================

CREATE TABLE IF NOT EXISTS contacts (
  wa_id TEXT PRIMARY KEY,
  studio_id INT,
  nome TEXT,
  tipo TEXT CHECK(tipo IN ('cliente','amigo','familia','fornecedor','spam')) DEFAULT 'cliente',
  first_contact_at TIMESTAMPTZ DEFAULT NOW(),
  last_contact_at TIMESTAMPTZ DEFAULT NOW(),
  total_conversas INT DEFAULT 1,
  pacote_interesse TEXT, -- Essencial R$7.500 / Premium R$8.800 / Black R$11.350
  ja_comprou BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS ensaios (
  id SERIAL PRIMARY KEY,
  studio_id INT,
  contact_wa_id TEXT REFERENCES contacts(wa_id),
  status TEXT CHECK(status IN ('agendado','em_atendimento','fotografando','editando','finalizado','cancelado')) DEFAULT 'agendado',
  pacote TEXT,
  start_at TIMESTAMPTZ UNIQUE,
  valor DECIMAL(10,2),
  comprovante_url TEXT,
  previa_instagram_url TEXT,
  avaliacao_enviada BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slots (
  id SERIAL PRIMARY KEY,
  studio_id INT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  status TEXT CHECK(status IN ('free','locked','booked')) DEFAULT 'free',
  client_wa_id TEXT,
  locked_at BIGINT,
  UNIQUE(studio_id, start_at)
);

CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS waiting_queue (
  id SERIAL PRIMARY KEY,
  studio_id INT,
  wa_id TEXT,
  tipo TEXT, -- 'humano', 'previa_pendente'
  msg TEXT,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS blocked_dates (
  id SERIAL PRIMARY KEY,
  studio_id INT,
  data DATE,
  motivo TEXT
);

CREATE INDEX IF NOT EXISTS idx_ensaios_status ON ensaios(status);
CREATE INDEX IF NOT EXISTS idx_ensaios_contact ON ensaios(contact_wa_id);
CREATE INDEX IF NOT EXISTS idx_contacts_tipo ON contacts(tipo);
