const express = require('express');
const app = express();
app.use(express.json());

// =============================================
// CORS
// =============================================
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
const DONO_TELEFONE = '879306034'; // 👑 Seu número

// PaySuite (substitua após aprovação)
const PAYSUITE_API_KEY = process.env.PAYSUITE_API_KEY || 'SUA_API_KEY';
const PAYSUITE_SECRET = process.env.PAYSUITE_SECRET || 'SUA_SECRET';
const PAYSUITE_BASE_URL = 'https://api.paysuite.tech/v1';

// ClicPay (substitua após obter as credenciais)
const CLICPAY_API_KEY = process.env.CLICPAY_API_KEY || 'SUA_CLICPAY_API_KEY';
const CLICPAY_WALLET_ID = process.env.CLICPAY_WALLET_ID || 'SEU_WALLET_ID';
const CLICPAY_BASE_URL = 'https://clicpay.co.mz/api/v2';

// Armazenamento (substitua por BD depois)
const assinantes = new Set();

// Base de vagas (30+)
let todasVagas = [
    // Tecnologia & TI
    { titulo: 'Desenvolvedor Java Pleno', cidade: 'Maputo', salario: '65.000 MT', area: 'TI', beneficio: 'Seguro médico, vale alimentação, home office 2x/semana' },
    { titulo: 'Analista de Sistemas', cidade: 'Maputo', salario: '58.000 MT', area: 'TI', beneficio: 'Vale transporte, bônus anual' },
    { titulo: 'Suporte Técnico (N1)', cidade: 'Beira', salario: '28.000 MT', area: 'TI', beneficio: 'Treinamento, horário flexível' },
    { titulo: 'Desenvolvedor Front-end (React)', cidade: 'Nampula', salario: '45.000 MT', area: 'TI', beneficio: 'Auxílio home office, plano de saúde' },
    { titulo: 'Especialista em Segurança da Informação', cidade: 'Maputo', salario: '80.000 MT', area: 'TI', beneficio: 'Bônus por desempenho, seguro de vida' },
    // Saúde
    { titulo: 'Enfermeiro(a) Geral', cidade: 'Beira', salario: '35.000 MT', area: 'Saúde', beneficio: 'Alojamento, subsídio de refeição' },
    { titulo: 'Médico Clínico Geral', cidade: 'Maputo', salario: '90.000 MT', area: 'Saúde', beneficio: 'Seguro de saúde, carro da empresa' },
    { titulo: 'Técnico de Análises Clínicas', cidade: 'Nampula', salario: '30.000 MT', area: 'Saúde', beneficio: 'Vale transporte, horário fixo' },
    { titulo: 'Farmacêutico', cidade: 'Maputo', salario: '55.000 MT', area: 'Saúde', beneficio: 'Participação em lucros, plano de carreira' },
    // Educação
    { titulo: 'Professor de Matemática', cidade: 'Nampula', salario: '28.000 MT', area: 'Educação', beneficio: 'Contrato anual, subsídio de transporte' },
    { titulo: 'Professor de Português', cidade: 'Maputo', salario: '32.000 MT', area: 'Educação', beneficio: 'Vale refeição, horário parcial' },
    { titulo: 'Instrutor de Informática', cidade: 'Beira', salario: '25.000 MT', area: 'Educação', beneficio: 'Treinamento, possibilidade de efetivação' },
    { titulo: 'Coordenador Pedagógico', cidade: 'Maputo', salario: '48.000 MT', area: 'Educação', beneficio: 'Seguro saúde, bônus anual' },
    // Engenharia
    { titulo: 'Engenheiro Civil', cidade: 'Maputo', salario: '75.000 MT', area: 'Engenharia', beneficio: 'Vale transporte, seguro de vida' },
    { titulo: 'Técnico de Obras', cidade: 'Beira', salario: '40.000 MT', area: 'Engenharia', beneficio: 'Alojamento, cesta básica' },
    { titulo: 'Arquiteto', cidade: 'Maputo', salario: '62.000 MT', area: 'Engenharia', beneficio: 'Home office, participação em projetos' },
    { titulo: 'Topógrafo', cidade: 'Nampula', salario: '38.000 MT', area: 'Engenharia', beneficio: 'Vale refeição, seguro de acidentes' },
    // Administração
    { titulo: 'Assistente Administrativo', cidade: 'Maputo', salario: '30.000 MT', area: 'Administração', beneficio: 'Vale transporte, refeitório' },
    { titulo: 'Contabilista', cidade: 'Beira', salario: '45.000 MT', area: 'Finanças', beneficio: 'Bônus semestral, seguro saúde' },
    { titulo: 'Auditor Interno', cidade: 'Maputo', salario: '55.000 MT', area: 'Finanças', beneficio: 'Plano de carreira, vale alimentação' },
    { titulo: 'Gestor de Projetos', cidade: 'Nampula', salario: '60.000 MT', area: 'Administração', beneficio: 'Carro da empresa, bônus' },
    // Vendas
    { titulo: 'Representante Comercial', cidade: 'Maputo', salario: '25.000 MT + comissão', area: 'Vendas', beneficio: 'Comissões, vale transporte' },
    { titulo: 'Atendente de Loja', cidade: 'Beira', salario: '18.000 MT', area: 'Vendas', beneficio: 'Horário rotativo, refeição' },
    { titulo: 'Supervisor de Vendas', cidade: 'Nampula', salario: '40.000 MT', area: 'Vendas', beneficio: 'Bônus mensal, seguro de vida' },
    // Logística
    { titulo: 'Motorista de Camião', cidade: 'Maputo', salario: '35.000 MT', area: 'Logística', beneficio: 'Vale refeição, seguro de carga' },
    { titulo: 'Operador de Empilhador', cidade: 'Beira', salario: '28.000 MT', area: 'Logística', beneficio: 'Adicional noturno, cesta básica' },
    { titulo: 'Coordenador de Logística', cidade: 'Nampula', salario: '48.000 MT', area: 'Logística', beneficio: 'Carro da empresa, bônus' },
    // Agrário
    { titulo: 'Técnico Agrícola', cidade: 'Nampula', salario: '32.000 MT', area: 'Agrário', beneficio: 'Alojamento, vale transporte' },
    { titulo: 'Engenheiro Florestal', cidade: 'Maputo', salario: '50.000 MT', area: 'Agrário', beneficio: 'Seguro de acidentes, participação em projetos' },
    // Turismo
    { titulo: 'Recepcionista de Hotel', cidade: 'Maputo', salario: '22.000 MT', area: 'Turismo', beneficio: 'Refeição, desconto em serviços' },
    { titulo: 'Guia Turístico', cidade: 'Beira', salario: '26.000 MT', area: 'Turismo', beneficio: 'Gorjetas, treinamento contínuo' }
];

// =============================================
// TRADUÇÃO LEVE
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
// ENDPOINTS PÚBLICOS
// =============================================
app.get('/', (req, res) => res.send('Servidor online!'));

// ---------- Criar pagamento com PaySuite ----------
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

// ---------- Criar pagamento com ClicPay ----------
app.post('/criar-pagamento-clicpay', async (req, res) => {
    const { telefone, plano } = req.body;
    if (!telefone || !plano) return res.status(400).json({ erro: 'Telefone e plano são obrigatórios' });
    const valor = plano === 'semanal' ? 50 : 150;
    try {
        const response = await fetch(
            `${CLICPAY_BASE_URL}/wallets/${CLICPAY_WALLET_ID}/c2b/mpesa`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CLICPAY_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    msisdn: telefone,
                    amount: valor,
                    reference_description: `Assinatura ${plano} - VagasBot`,
                    internal_notes: `Pedido ${Date.now()}`
                })
            }
        );
        const data = await response.json();
        res.json({
            success: true,
            transaction_id: data.transaction_id,
            status: data.status,
            payment_url: data.payment_url || null
        });
    } catch (error) {
        res.status(500).json({ success: false, erro: error.message });
    }
});

// ---------- Webhook PaySuite ----------
app.post('/webhook-paysuite', (req, res) => {
    const { reference, status, customer_phone } = req.body;
    console.log('Webhook PaySuite:', { reference, status, customer_phone });
    if (status === 'completed') {
        assinantes.add(customer_phone);
        console.log(`✅ Assinante ativado (PaySuite): ${customer_phone}`);
    }
    res.sendStatus(200);
});

// ---------- Webhook ClicPay ----------
app.post('/webhook-clicpay', (req, res) => {
    const { transaction_id, status, customer_msisdn } = req.body;
    console.log('Webhook ClicPay:', { transaction_id, status, customer_msisdn });
    if (status === 'completed' || status === 'success') {
        assinantes.add(customer_msisdn);
        console.log(`✅ Assinante ativado (ClicPay): ${customer_msisdn}`);
    }
    res.sendStatus(200);
});

// ---------- Verificar acesso ----------
app.post('/verificar-acesso', (req, res) => {
    const { telefone } = req.body;
    const temAcesso = assinantes.has(telefone) || telefone === DONO_TELEFONE;
    res.json({ assinante: temAcesso, dono: telefone === DONO_TELEFONE });
});

// ---------- Obter vagas (com filtros e tradução) ----------
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
    const completo = vagasFiltradas.map(v =>
        `${v.titulo} – ${v.cidade} – ${v.salario}\n   • Benefícios: ${v.beneficio}`
    );

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

// =============================================
// ENDPOINTS ADMIN (apenas dono)
// =============================================
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
