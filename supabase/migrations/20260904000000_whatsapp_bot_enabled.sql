-- =============================================================================
-- Adiciona controle de Ligar/Desligar Bot de Atendimento no WhatsApp
-- =============================================================================
alter table public.whatsapp_instances
  add column if not exists bot_enabled boolean not null default true;

comment on column public.whatsapp_instances.bot_enabled is
  'Indica se as respostas automáticas da inteligência artificial estão ativas para este número.';
