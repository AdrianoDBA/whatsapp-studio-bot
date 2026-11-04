import os
import logging
import requests
from typing import Optional, List, Dict, Any

logger = logging.getLogger("whatsapp-studio-bot.providers")


class WhatsAppProvider:
    """Interface abstrata base para provedores de mensageria WhatsApp."""

    def send_text(self, to: str, text: str) -> bool:
        raise NotImplementedError

    def send_template(self, to: str, template: str, params: Optional[List[Any]] = None) -> bool:
        raise NotImplementedError

    def send_image(self, to: str, image_url: str, caption: Optional[str] = None) -> bool:
        raise NotImplementedError

    def mark_as_read(self, message_id: str) -> bool:
        return True


class BaileysProvider(WhatsAppProvider):
    """Provedor legado baseado no Baileys WhatsApp Gateway (porta local 5006)."""

    def __init__(self, gateway_url: Optional[str] = None):
        self.gateway_url = (gateway_url or os.getenv("GATEWAY_URL", "http://127.0.0.1:5006")).rstrip("/")
        self.test_numbers = {"5534991112222", "5534998887777", "5534999990000", "5534999991234", "5511999999999"}

    def _is_test_number(self, to: str) -> bool:
        clean = str(to or "").split("@")[0]
        return clean in self.test_numbers

    def send_text(self, to: str, text: str) -> bool:
        if not to or self._is_test_number(to):
            logger.debug("[BaileysProvider] Ignorando envio para número de teste ou vazio: %s", to)
            return True
        try:
            resp = requests.post(
                f"{self.gateway_url}/send",
                json={"to": to, "text": text},
                timeout=5,
            )
            return resp.status_code in (200, 201)
        except Exception as e:
            logger.warning("[BaileysProvider] Falha ao enviar texto: %s", e)
            return False

    def send_template(self, to: str, template: str, params: Optional[List[Any]] = None) -> bool:
        # Baileys não suporta templates Meta diretamente; fallback enviando texto interpolado
        text_body = f"[{template}] " + " ".join(str(p) for p in (params or []))
        return self.send_text(to, text_body)

    def send_image(self, to: str, image_url: str, caption: Optional[str] = None) -> bool:
        if not to or self._is_test_number(to):
            return True
        try:
            resp = requests.post(
                f"{self.gateway_url}/send",
                json={"to": to, "imageUrl": image_url, "caption": caption or ""},
                timeout=8,
            )
            return resp.status_code in (200, 201)
        except Exception as e:
            logger.warning("[BaileysProvider] Falha ao enviar imagem: %s", e)
            return False


class CloudApiProvider(WhatsAppProvider):
    """Provedor oficial Meta WhatsApp Cloud API v20."""

    def __init__(self, phone_number_id: Optional[str] = None, token: Optional[str] = None):
        self.phone_number_id = phone_number_id or os.getenv("PHONE_NUMBER_ID", "")
        self.token = token or os.getenv("WHATSAPP_TOKEN", os.getenv("ACCESS_TOKEN", ""))

    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def _get_url(self) -> str:
        return f"https://graph.facebook.com/v20.0/{self.phone_number_id}/messages"

    def send_text(self, to: str, text: str) -> bool:
        if not self.phone_number_id or not self.token:
            logger.warning("[CloudApiProvider] phone_number_id ou token ausente. Env: USE_PROVIDER=meta")
            return False
        clean_to = str(to or "").split("@")[0].replace("+", "").strip()
        payload = {
            "messaging_product": "whatsapp",
            "to": clean_to,
            "type": "text",
            "text": {"body": text},
        }
        try:
            resp = requests.post(self._get_url(), headers=self._get_headers(), json=payload, timeout=8)
            if resp.status_code in (200, 201):
                logger.info("[CloudApiProvider] Texto enviado com sucesso para %s", clean_to)
                return True
            logger.warning("[CloudApiProvider] Resposta de erro %d: %s", resp.status_code, resp.text)
            return False
        except Exception as e:
            logger.error("[CloudApiProvider] Erro ao enviar texto: %s", e)
            return False

    def send_template(self, to: str, template: str, params: Optional[List[Any]] = None) -> bool:
        if not self.phone_number_id or not self.token:
            return False
        clean_to = str(to or "").split("@")[0].replace("+", "").strip()
        payload = {
            "messaging_product": "whatsapp",
            "to": clean_to,
            "type": "template",
            "template": {
                "name": template,
                "language": {"code": "pt_BR"},
                "components": [
                    {
                        "type": "body",
                        "parameters": [{"type": "text", "text": str(p)} for p in (params or [])],
                    }
                ],
            },
        }
        try:
            resp = requests.post(self._get_url(), headers=self._get_headers(), json=payload, timeout=8)
            return resp.status_code in (200, 201)
        except Exception as e:
            logger.error("[CloudApiProvider] Erro ao enviar template: %s", e)
            return False

    def send_image(self, to: str, image_url: str, caption: Optional[str] = None) -> bool:
        if not self.phone_number_id or not self.token:
            return False
        clean_to = str(to or "").split("@")[0].replace("+", "").strip()
        payload = {
            "messaging_product": "whatsapp",
            "to": clean_to,
            "type": "image",
            "image": {"link": image_url, "caption": caption or ""},
        }
        try:
            resp = requests.post(self._get_url(), headers=self._get_headers(), json=payload, timeout=10)
            return resp.status_code in (200, 201)
        except Exception as e:
            logger.error("[CloudApiProvider] Erro ao enviar imagem: %s", e)
            return False

    def mark_as_read(self, message_id: str) -> bool:
        """Marca uma mensagem oficial como lida no WhatsApp."""
        if not self.phone_number_id or not self.token or not message_id:
            return False
        payload = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
        }
        try:
            resp = requests.post(self._get_url(), headers=self._get_headers(), json=payload, timeout=4)
            return resp.status_code in (200, 201)
        except Exception as e:
            logger.debug("[CloudApiProvider] Falha ao marcar como lida: %s", e)
            return False


def get_whatsapp_provider(studio: Optional[Dict[str, Any]] = None) -> WhatsAppProvider:
    """
    Factory que retorna o provider apropriado conforme USE_PROVIDER ou dados do estúdio.
    Default: 'meta' se USE_PROVIDER='meta' ou se WHATSAPP_TOKEN/PHONE_NUMBER_ID estiverem definidos.
    Fallback: 'baileys' se USE_PROVIDER='baileys'.
    """
    use_provider = (os.getenv("USE_PROVIDER") or "").lower().strip()
    
    # Se configurado explicitamente para baileys
    if use_provider == "baileys":
        return BaileysProvider()

    # Se configurado para meta ou padrão
    token = os.getenv("WHATSAPP_TOKEN") or os.getenv("ACCESS_TOKEN")
    phone_number_id = os.getenv("PHONE_NUMBER_ID")

    if studio:
        # Se o estúdio tiver credenciais salvas
        studio_token = studio.get("access_token")
        if studio_token and not str(studio_token).startswith("meta_cloud_token_placeholder"):
            token = studio_token
        if studio.get("phone_number_id"):
            phone_number_id = studio.get("phone_number_id")

    is_real_cloud = bool(
        token
        and not str(token).startswith("COLA_")
        and not str(token).startswith("meta_cloud_token_placeholder")
        and phone_number_id
        and not str(phone_number_id).startswith("COLA_")
    )

    if (use_provider in ("meta", "cloud") and is_real_cloud) or (token and phone_number_id and is_real_cloud):
        return CloudApiProvider(phone_number_id=phone_number_id, token=token)

    # Se nenhuma variável real da Cloud API existir ou se for Baileys/QR, usa BaileysProvider
    return BaileysProvider()
