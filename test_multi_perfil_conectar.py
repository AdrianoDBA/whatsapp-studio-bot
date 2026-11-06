import unittest
import json
from app import (
    app,
    get_db,
    init_db,
    get_all_test_profiles,
    get_active_profile,
    get_active_studio,
)


class TestMultiPerfilConectar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = app.test_client()

    def setUp(self):
        self.studio = get_active_studio()
        self.token = self.studio.get("dashboard_token") or "painel-seguro-studio-2026"

    def test_01_test_profiles_table_and_defaults(self):
        profiles = get_all_test_profiles()
        self.assertGreaterEqual(len(profiles), 4)

        profile_ids = [p["id"] for p in profiles]
        self.assertIn("meu_numero", profile_ids)
        self.assertIn("esposa", profile_ids)
        self.assertIn("filho", profile_ids)
        self.assertIn("bot_estudio", profile_ids)

        # Verifica isolamento de pastas
        folders = {p["id"]: p["pasta_sessao"] for p in profiles}
        self.assertTrue(folders["meu_numero"].endswith("/meu_numero"))
        self.assertTrue(folders["esposa"].endswith("/esposa"))
        self.assertTrue(folders["filho"].endswith("/filho"))
        self.assertTrue(folders["bot_estudio"].endswith("/bot_estudio"))

        # Pelo menos um perfil deve estar ativo
        active = get_active_profile()
        self.assertIsNotNone(active)

    def test_02_root_redirects_to_conectar(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 302)
        self.assertTrue(res.headers.get("Location", "").endswith("/conectar"))

    def test_03_get_conectar_page(self):
        res = self.client.get("/conectar")
        self.assertEqual(res.status_code, 200)
        html = res.get_data(as_text=True)

        # Verifica as duas abas
        self.assertIn("Aba Teste por QR (Baileys", html)
        self.assertIn("Aba Produção", html)

        # Verifica os 4 cards fixos
        self.assertIn("Meu número", html)
        self.assertIn("Esposa", html)
        self.assertIn("Filho", html)
        self.assertIn("Bot do Estúdio", html)

        # Verifica a barra superior obrigatória
        self.assertIn("AMBIENTE: LOCAL | GATEWAY MULTI-SESSÃO", html)
        self.assertIn("Trocar quem está conectado", html)

    def test_04_get_conectar_perfil_pages(self):
        for pid, apelido in [
            ("meu_numero", "Meu número"),
            ("esposa", "Esposa"),
            ("filho", "Filho"),
            ("bot_estudio", "Bot do Estúdio"),
        ]:
            res = self.client.get(f"/conectar/{pid}")
            self.assertEqual(res.status_code, 200)
            html = res.get_data(as_text=True)
            self.assertIn(f"Escaneie com o celular de: <span>{apelido}</span>", html)
            self.assertIn("Aguardando scan...", html)
            self.assertIn("AMBIENTE: LOCAL | GATEWAY MULTI-SESSÃO", html)

        # Rota com perfil inexistente redireciona
        res_invalid = self.client.get("/conectar/perfil_fantasma")
        self.assertEqual(res_invalid.status_code, 302)

    def test_05_api_profiles_and_switch_active(self):
        # 1. API GET /api/profiles
        res = self.client.get("/api/profiles")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(len(data.get("profiles", [])), 4)

        # 2. Ativar perfil "esposa"
        res_post = self.client.post("/api/profiles/esposa/ativar")
        self.assertEqual(res_post.status_code, 200)
        self.assertTrue(res_post.get_json().get("ok"))

        # Confirma que "esposa" é o perfil ativo
        active = get_active_profile()
        self.assertEqual(active["id"], "esposa")

        # 3. Volta o ativo para "meu_numero"
        self.client.post("/api/profiles/meu_numero/ativar")
        active = get_active_profile()
        self.assertEqual(active["id"], "meu_numero")

    def test_06_top_status_bar_in_all_screens(self):
        # /comecar
        res_comecar = self.client.get("/comecar")
        self.assertEqual(res_comecar.status_code, 200)
        html_comecar = res_comecar.get_data(as_text=True)
        self.assertIn("AMBIENTE: LOCAL | GATEWAY MULTI-SESSÃO", html_comecar)
        self.assertIn("Trocar quem está conectado", html_comecar)

        # /painel
        res_painel = self.client.get(f"/painel?acesso={self.token}")
        self.assertEqual(res_painel.status_code, 200)
        html_painel = res_painel.get_data(as_text=True)
        self.assertIn("AMBIENTE: LOCAL | GATEWAY MULTI-SESSÃO", html_painel)
        self.assertIn("Trocar quem está conectado", html_painel)

    def test_07_api_disconnect_and_reconnect(self):
        res_rec = self.client.post("/api/profiles/meu_numero/reconnect")
        self.assertEqual(res_rec.status_code, 200)
        self.assertTrue(res_rec.get_json().get("ok"))

        res_disc = self.client.post("/api/profiles/meu_numero/desconectar")
        self.assertEqual(res_disc.status_code, 200)
        self.assertTrue(res_disc.get_json().get("ok"))


if __name__ == "__main__":
    unittest.main()
