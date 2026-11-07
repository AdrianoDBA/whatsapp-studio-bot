-- Adiciona coluna config jsonb na tabela agents para guardar preferências estruturadas da secretária
alter table public.agents
  add column if not exists config jsonb not null default '{}'::jsonb;

comment on column public.agents.config is
  'Configuração estruturada da secretária (nome da assistente, empresa, tom de voz, serviços/preços, horários e regras de transbordo).';
