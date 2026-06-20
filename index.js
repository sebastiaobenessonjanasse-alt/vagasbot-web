const express = require('express');
const app = express();
app.use(express.json());

// =============================================
// CONFIGURAÇÕES (substitua depois pelas chaves reais)
// =============================================
const PAYSUITE_API_KEY = process.env.PAYSUITE_API_KEY || 'SUA_API_KEY_AQUI';
const PAYSUITE_SECRET = process.env.PAYSUITE_SECRET || 'SUA_SECRET_AQUI';
const PAYSUITE_BASE_URL = 'https://api.paysuite.tech/v1'; // verifique na doc

// Armazenamento temporário (troque por BD depois)
const assinantes = new Set();

// =============================================
// ENDPOINT DE TESTE (já sabemos que funciona)
// =============================================
app.get('/', (req, res) => res.send('Servidor online!'));

// =============================================
// 1. Criar pagamento
// =============================================
app.post('/criar-pagamento', async (req, res) => {
    const { telefone, plano } = req.body;
    if (!telefone || !plano) {
        return res.status(400).json({ erro: 'Telefone e plano são obrigatórios' });
    }

    const valor = plano === 'semanal' ? 50 : 150;
    const descricao = `Assinatura ${plano} - VagasBot`;

    try {
        const response = await fetch(`${PAYSUITE_BASE_URL}/transactions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAYSUITE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: valor,
                currency: 'MZN',
                description: descricao,
                customer: { phone: telefone },
                callback_url: 'https://vagasbot-web-api.onrender.com/webhook-paysuite'
            })
        });

        const data = await response.json();
        res.json({ success: true, payment_url: data.payment_url, reference: data.reference });
    } catch (error) {
        res.status(500).json({ success: false, erro: error.message });
    }
});

// =============================================
// 2. Webhook para confirmação de pagamento
// =============================================
app.post('/webhook-paysuite', (req, res) => {
    const { reference, status, customer_phone } = req.body;
    console.log('Webhook recebido:', { reference, status, customer_phone });

    if (status === 'completed') {
        assinantes.add(customer_phone);
        console.log(`✅ Assinante ativado: ${customer_phone}`);
    }
    res.sendStatus(200);
});

// =============================================
// 3. Verificar se o utilizador é assinante
// =============================================
app.post('/verificar-acesso', (req, res) => {
    const { telefone } = req.body;
    const temAcesso = assinantes.has(telefone);
    res.json({ assinante: temAcesso });
});

// =============================================
// 4. Obter vagas (com ou sem restrição)
// =============================================
app.post('/vagas', (req, res) => {
    const { telefone } = req.body;

    const todasVagas = [
        'Dev Java – Maputo – 60k MT',
        'Enfermeiro – Beira – 35k MT',
        'Professor – Nampula – 28k MT'
    ];

    const vagasCompletas = [
        'Dev Java – Maputo – 60k MT – Benefícios: seguro, vale refeição',
        'Enfermeiro – Beira – 35k MT – Turno diurno, alojamento',
        'Professor – Nampula – 28k MT – Contrato de 1 ano renovável'
    ];

    if (assinantes.has(telefone)) {
        res.json({ vagas: vagasCompletas, plano: 'premium' });
    } else {
        res.json({ vagas: todasVagas, plano: 'gratuito', mensagem: 'Assine para ver detalhes completos!' });
    }
});

// =============================================
// INICIAR SERVIDOR
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
