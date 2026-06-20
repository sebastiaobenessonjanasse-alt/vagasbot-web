const express = require('express');
const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// =============================================
// CONFIGURAÇÕES
// =============================================
const DONO_TELEFONE = '879306034';
const PAYSUITE_API_KEY = process.env.PAYSUITE_API_KEY || 'SUA_API_KEY';
const PAYSUITE_SECRET = process.env.PAYSUITE_SECRET || 'SUA_SECRET';
const PAYSUITE_BASE_URL = 'https://api.paysuite.tech/v1';

const assinantes = new Set();

// Base de vagas (pode ser a lista completa que já tem)
let todasVagas = [
    // ... sua lista de vagas aqui ...
];

// =============================================
// TRADUÇÃO
// =============================================
const franc = require('franc');
const translate = require('translate');
const cacheTraducoes = new Map();

function detectarIdioma(texto) {
    const codigo = franc(texto);
    const mapa = { 'por': 'pt', 'eng': 'en', 'spa': 'es', 'fra': 'fr', 'deu': 'de', 'ita': 'it', 'rus': 'ru', 'zho': 'zh', 'jpn': 'ja', 'ara': 'ar' };
    return mapa[codigo] || 'pt';
}

async function traduzirTexto(texto, idiomaDestino) {
    if (idiomaDestino === 'pt' || !texto) return texto;
    const chave = `${texto}|${idiomaDestino}`;
    if (cacheTraducoes.has(chave)) return cacheTraducoes.get(chave);
    try {
        const traducao = await translate(texto, { to: idiomaDestino });
        cacheTraducoes.set(chave, traducao);
        return traducao;
    } catch (err) {
        console.warn('Erro na tradução:', err.message);
        return texto;
    }
}

// =============================================
// ENDPOINTS
// =============================================
app.get('/', (req, res) => res.send('Servidor online!'));

app.post('/criar-pagamento', async (req, res) => {
    const { telefone, plano } = req.body;
    if (!telefone || !plano) return res.status(400).json({ erro: 'Telefone e plano são obrigatórios' });
    const valor = plano === 'semanal' ? 50 : 150;
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
                description: `Assinatura ${plano} - VagasBot`,
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

app.post('/webhook-paysuite', (req, res) => {
    const { reference, status, customer_phone } = req.body;
    console.log('Webhook:', { reference, status, customer_phone });
    if (status === 'completed') {
        assinantes.add(customer_phone);
        console.log(`✅ Assinante ativado: ${customer_phone}`);
    }
    res.sendStatus(200);
});

app.post('/verificar-acesso', (req, res) => {
    const { telefone } = req.body;
    const temAcesso = assinantes.has(telefone) || telefone === DONO_TELEFONE;
    res.json({ assinante: temAcesso, dono: telefone === DONO_TELEFONE });
});

app.post('/vagas', async (req, res) => {
    const { telefone, cidade, area, idioma = 'pt' } = req.body;
    const isDono = (telefone === DONO_TELEFONE);

    let vagasFiltradas = todasVagas;
    if (cidade) {
        const cid = cidade.trim().toLowerCase();
        vagasFiltradas = vagasFiltradas.filter(v => v.cidade.toLowerCase().includes(cid));
    }
    if (area) {
        const ar = area.trim().toLowerCase();
        vagasFiltradas = vagasFiltradas.filter(v => v.area.toLowerCase().includes(ar));
    }
    if (!cidade && !area) vagasFiltradas = todasVagas;

    const isPremium = assinantes.has(telefone) || isDono;

    const resumo = vagasFiltradas.map(v => `${v.titulo} – ${v.cidade} – ${v.salario}`);
    const completo = vagasFiltradas.map(v => `${v.titulo} – ${v.cidade} – ${v.salario}\n   • Benefícios: ${v.beneficio}`);

    let mensagemBase = '';
    let listaVagas = [];

    if (isPremium) {
        mensagemBase = isDono ? '👑 Olá, Dono! Aqui estão todas as vagas com todos os detalhes.' : '🔓 Detalhes completos disponíveis!';
        listaVagas = completo;
    } else {
        mensagemBase = '🔒 Assine Premium para ver benefícios e detalhes completos!';
        listaVagas = resumo;
    }

    // Traduzir
    const mensagemTraduzida = await traduzirTexto(mensagemBase, idioma);
    const vagasTraduzidas = await Promise.all(listaVagas.map(v => traduzirTexto(v, idioma)));

    res.json({
        vagas: vagasTraduzidas,
        plano: isPremium ? (isDono ? 'dono' : 'premium') : 'gratuito',
        total: vagasTraduzidas.length,
        mensagem: mensagemTraduzida
    });
});

// --- Endpoints Admin (apenas dono) ---
app.post('/admin/assinantes', (req, res) => {
    const { telefone } = req.body;
    if (telefone !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    res.json({ assinantes: Array.from(assinantes), total: assinantes.size });
});

app.post('/admin/add-vaga', (req, res) => {
    const { telefone, vaga } = req.body;
    if (telefone !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    if (!vaga || !vaga.titulo || !vaga.cidade || !vaga.salario || !vaga.area || !vaga.beneficio) {
        return res.status(400).json({ erro: 'Vaga inválida. Necessário: titulo, cidade, salario, area, beneficio' });
    }
    todasVagas.push(vaga);
    res.json({ success: true, mensagem: 'Vaga adicionada com sucesso!', total: todasVagas.length });
});

app.post('/admin/remover-vaga', (req, res) => {
    const { telefone, titulo } = req.body;
    if (telefone !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    const index = todasVagas.findIndex(v => v.titulo.toLowerCase() === titulo.toLowerCase());
    if (index === -1) return res.status(404).json({ erro: 'Vaga não encontrada' });
    todasVagas.splice(index, 1);
    res.json({ success: true, mensagem: 'Vaga removida com sucesso!', total: todasVagas.length });
});

// =============================================
// INICIAR SERVIDOR
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
