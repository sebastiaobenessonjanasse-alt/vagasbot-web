const express = require('express');
const app = express();
app.use(express.json());

// =============================================
// 1. Configuração (substitua pelos seus dados)
// =============================================
const PAYSUITE_API_KEY = 'SUA_API_KEY';       // virá do dashboard
const PAYSUITE_SECRET = 'SUA_SECRET_KEY';     // virá do dashboard
const PAYSUITE_BASE_URL = 'https://api.paysuite.tech/v1'; // verifique na doc

// Armazenamento temporário (substitua por BD depois)
const assinantes = new Set(); // guarda números de telefone ou IDs

// =============================================
// 2. Endpoint para criar pagamento
// =============================================
app.post('/criar-pagamento', async (req, res) => {
    const { telefone, plano } = req.body; // plano: 'semanal' ou 'mensal'

    const valor = plano === 'semanal' ? 50 : 150;
    const descricao = `Assinatura ${plano} - VagasBot`;

    try {
        // Chamada à API PaySuite para criar referência
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
                callback_url: 'https://vagasbot-web.onrender.com/webhook-paysuite'
            })
        });

        const data = await response.json();
        // Exemplo de resposta: { reference: 'ABC123', payment_url: 'https://...' }

        res.json({
            success: true,
            payment_url: data.payment_url,
            reference: data.reference
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =============================================
// 3. Webhook para receber confirmação da PaySuite
// =============================================
app.post('/webhook-paysuite', (req, res) => {
    const { reference, status, customer_phone } = req.body;

    if (status === 'completed') {
        // Pagamento confirmado! Libera acesso
        assinantes.add(customer_phone);
        console.log(`✅ Assinante ativado: ${customer_phone}`);
    }

    res.sendStatus(200); // sempre responder 200 para a PaySuite não reenviar
});

// =============================================
// 4. Endpoint para verificar se utilizador é assinante
// =============================================
app.post('/verificar-acesso', (req, res) => {
    const { telefone } = req.body;
    const temAcesso = assinantes.has(telefone);
    res.json({ assinante: temAcesso });
});

// =============================================
// 5. Endpoint para obter vagas (com ou sem restrição)
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
// 6. Iniciar servidor
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
