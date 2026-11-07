# Certificado de segurança do Supabase

O arquivo `supabase-root-2021-ca.crt` é o certificado público da autoridade do
Supabase ("Supabase Root 2021 CA"). Ele é usado pra ter **certeza de que o app
está falando com o banco do Supabase de verdade**, e não com alguém se passando
por ele.

## Por que ele precisa estar aqui

O endereço do banco (`DATABASE_URL`) carrega a senha dentro. Se o programa
conversasse com qualquer servidor sem conferir quem é, bastaria alguém se
colocar no meio do caminho pra receber essa senha.

O Supabase assina os certificados dos bancos com uma autoridade própria, que o
Node não conhece de fábrica. Sem este arquivo, só existiriam duas saídas ruins:
desligar a conferência (inseguro) ou não conseguir conectar.

## Não é segredo

Certificado de autoridade é público por natureza — ele só permite *conferir*
assinaturas, não permite forjar nada. Pode ficar no repositório sem problema.

## De onde veio / como conferir

Baixado de:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Impressão digital (SHA-256):
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

Validade: 28/04/2021 até **26/04/2031**.

Você também pega o mesmo arquivo no painel: Supabase → seu projeto → Settings →
Database → SSL Configuration.

## E se eu não uso Supabase?

Se o seu banco é outro, ou é um Supabase instalado no seu próprio servidor, o
programa usa a autoridade que o sistema já conhece. Pra apontar uma autoridade
sua, use a variável `NODE_EXTRA_CA_CERTS` com o caminho do seu arquivo `.crt`.
