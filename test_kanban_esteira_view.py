import unittest
import app

class TestKanbanEsteiraView(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()
        self.studio = app.get_active_studio()
        self.token = self.studio.get("dashboard_token") or "painel-seguro-studio-2026"

    def test_esteira_kanban_rendered_in_painel_and_dashboard(self):
        """Verifica se a Esteira Kanban está embutida diretamente na aba de Agendamentos."""
        for endpoint in [f"/painel?token={self.token}", f"/dashboard?token={self.token}"]:
            res = self.client.get(endpoint)
            self.assertEqual(res.status_code, 200)
            html = res.get_data(as_text=True)

            # Tab com nome explícito de Esteira Kanban
            self.assertIn("Agendamentos (Esteira Kanban)", html)

            # Container principal da Esteira Kanban
            self.assertIn('id="visaoEsteiraKanban"', html)
            self.assertIn("Esteira de Agendamentos & Produção (Kanban)", html)

            # Métricas da Esteira
            self.assertIn('id="kMetricAgendados"', html)
            self.assertIn('id="kMetricAtendimento"', html)
            self.assertIn('id="kMetricFotografando"', html)
            self.assertIn('id="kMetricEditando"', html)

            # 4 Colunas da esteira com Drag & Drop
            self.assertIn('id="colAgendados"', html)
            self.assertIn('id="colAtendimento"', html)
            self.assertIn('id="colFotografando"', html)
            self.assertIn('id="colEditando"', html)
            self.assertIn("dropKanban(event, 'agendado')", html)
            self.assertIn("dropKanban(event, 'em_atendimento')", html)
            self.assertIn("dropKanban(event, 'fotografando')", html)
            self.assertIn("dropKanban(event, 'editando')", html)

            # Botões de alternância e funções JS
            self.assertIn("alternarModoVisualizacao('esteira')", html)
            self.assertIn("alternarModoVisualizacao('lista')", html)
            self.assertIn("function alternarModoVisualizacao(modo)", html)
            self.assertIn("function carregarKanban()", html)
            self.assertIn("carregarKanban()", html)

if __name__ == "__main__":
    unittest.main()
