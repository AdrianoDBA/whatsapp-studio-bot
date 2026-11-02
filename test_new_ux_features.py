import json
import base64
from io import BytesIO
from PIL import Image
from app import app, init_db, get_db, generate_comprovante_png, generate_humanized_reply

def run_tests():
    print("=" * 70)
    print("🚀 INICIANDO TESTES DE UX, COMPROVANTE, CHAT E AGENDAMENTOS")
    print("=" * 70)

    init_db()
    client = app.test_client()

    conn = get_db()
    st = dict(conn.execute("SELECT * FROM studios ORDER BY created_at ASC LIMIT 1").fetchone())
    token = st["dashboard_token"]
    studio_id = st["id"]
    conn.close()

    # 1. Teste Comprovante PNG com Pillow (600x750px e fonte TrueType nítida)
    png_url = generate_comprovante_png(
        studio_name="Studio Luz & Arte",
        photographer_name="Gustavo",
        client_name="Mariana Silva",
        slot_human="Sábado (07/11) às 14h30",
        comprovante_id="TEST600x750",
        niche="Ensaio Gestante"
    )
    img_path = "/Users/adrianocme/.gemini/antigravity/scratch/whatsapp-studio-bot" + png_url
    img = Image.open(img_path)
    assert img.size == (600, 750), f"Dimensões incorretas: {img.size}"
    print(f"✅ [01/05] Comprovante PNG redesenhado para 600x750px: {png_url}")

    # 2. Teste Humanização: Saudação espelhada contextual e NUNCA chamar de 'Cliente'
    # 2a. Usuário diz 'Bom dia' sem nome cadastrado
    reply_bd, _, _, opts_bd = generate_humanized_reply(st, "5534999990000", "", "Bom dia!")
    assert "bom dia" in reply_bd.lower(), f"Esperado 'Bom dia', obteve: {reply_bd}"
    assert "cliente" not in reply_bd.lower(), f"Termo 'Cliente' proibido encontrado: {reply_bd}"
    assert "como posso te chamar" in reply_bd.lower(), f"Esperado perguntar o nome: {reply_bd}"
    assert len(opts_bd) > 0, "Esperado botões interativos de opções"
    print(f"✅ [02/05] Saudação contextual espelhada 'Bom dia' sem 'Cliente' e com opções interativas")

    # 2b. Usuário responde o nome
    reply_nome, _, _, _ = generate_humanized_reply(st, "5534999990000", "", "Juliana Mendes")
    assert "juliana" in reply_nome.lower(), f"Esperado cumprimentar Juliana: {reply_nome}"
    assert "cliente" not in reply_nome.lower(), f"Termo 'Cliente' proibido: {reply_nome}"
    print(f"✅ [03/05] Captura e tratamento caloroso pelo próprio nome (Juliana)")

    # 3. Teste Chat de Testes: Envio via /simular-conversa e Reset via /api/chat-teste/reset
    r_sim = client.post("/simular-conversa", json={"studio_id": studio_id, "text": "Boa tarde, quero agendar"})
    assert r_sim.status_code == 200
    sim_data = r_sim.get_json()
    assert sim_data["ok"] is True
    assert "options" in sim_data
    print("✅ [04/05] Envio no Chat de Testes retornou resposta e botões interativos")

    r_reset = client.post(f"/api/chat-teste/reset?token={token}")
    assert r_reset.status_code == 200
    assert r_reset.get_json()["ok"] is True
    conn = get_db()
    test_msgs_cnt = conn.execute("SELECT COUNT(*) as c FROM messages WHERE studio_id = ? AND wa_id = '5534999990000'", (studio_id,)).fetchone()["c"]
    conn.close()
    assert test_msgs_cnt == 0, f"Mensagens não foram limpas: {test_msgs_cnt}"
    print("✅ [05/05] Botão '🔄 Reiniciar Conversa' (/api/chat-teste/reset) limpou histórico perfeitamente")

    # 4. Teste Cancelamento de Agendamento com Notificação ao Cliente
    conn = get_db()
    slot = conn.execute("SELECT id FROM slots WHERE studio_id = ? LIMIT 1", (studio_id,)).fetchone()
    slot_id = slot["id"]
    conn.execute(
        "UPDATE slots SET status = 'booked', client_name = 'Lucas Santos', client_wa_id = '5534999998888', niche = 'Ensaio Família', start_at = '2026-11-10T15:00' WHERE id = ?",
        (slot_id,)
    )
    conn.commit()
    conn.close()

    r_canc = client.post(f"/api/agendamentos/{slot_id}/cancelar?token={token}")
    assert r_canc.status_code == 200
    canc_data = r_canc.get_json()
    assert canc_data["ok"] is True
    assert canc_data["status"] == "free"

    # Confirma que o slot ficou livre
    conn = get_db()
    sl_check = conn.execute("SELECT status, client_name FROM slots WHERE id = ?", (slot_id,)).fetchone()
    assert sl_check["status"] == "free"
    assert sl_check["client_name"] is None

    # Confirma que a notificação foi gravada no histórico de mensagens para o cliente
    notif_msg = conn.execute(
        "SELECT content FROM messages WHERE studio_id = ? AND wa_id = '5534999998888' ORDER BY id DESC LIMIT 1",
        (studio_id,)
    ).fetchone()
    conn.close()
    assert notif_msg is not None, "Mensagem de cancelamento não foi gerada para o cliente"
    assert "desmarcado conforme solicitado" in notif_msg["content"], f"Conteúdo inesperado: {notif_msg['content']}"
    print("✅ [06/05] Cancelamento liberou o slot e disparou mensagem humanizada para o WhatsApp do cliente")

    print("=" * 70)
    print("🎉 TODOS OS TESTES DE UX E NOVAS FEATURES PASSARAM COM 100% DE SUCESSO!")
    print("=" * 70)

if __name__ == "__main__":
    run_tests()
