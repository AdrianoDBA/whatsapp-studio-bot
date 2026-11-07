export type WhatsAppProvider = "baileys" | "cloud_api";
export type WhatsAppStatus = "disconnected" | "connecting" | "connected" | "qr_ready";

export type WhatsAppInstance = {
  id: string;
  organization_id: string;
  phone_number: string | null;
  instance_name: string | null;
  provider: WhatsAppProvider;
  status: WhatsAppStatus;
  bot_enabled: boolean;
  qr_code: string | null;
  cloud_phone_number_id: string | null;
  cloud_waba_id: string | null;
  cloud_access_token: string | null;
  connected_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};
