const express = require('express');
const app = express();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// =============================================
// MIDDLEWARES
// =============================================
app.use(express.json());
app.use(express.static('public'));

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
const CLICPAY_API_KEY = process.env.CLICPAY_API_KEY || 'SUA_CLICPAY_API_KEY';
const CLICPAY_WALLET_ID = process.env.CLICPAY_WALLET_ID || 'SEU_WALLET_ID';
const CLICPAY_BASE_URL = 'https://clicpay.co.mz/api/v2';

// =============================================
// INICIALIZAÇÃO DAS IAs
// =============================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

// Gemini - usando modelo 2.0 flash (mais recente e estável)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// DeepSeek (via OpenAI SDK)
const deepseekClient = new OpenAI({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY
});

// Claude (opcional)
const anthropic = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;

// =============================================
// ARMAZENAMENTO EM MEMÓRIA
// =============================================
const assinantes = new Map(); // telefone -> { plano, dataAtivacao }
const historico = []; // { usuario, mensagem, resposta, timestamp }
const memorias = []; // { id, texto, data }
const pdfsComprados = new Map(); // telefone -> [filenames]

// =============================================
// BASE DE VAGAS (30+ oportunidades)
// =============================================
let todasVagas = [
    { titulo: 'Desenvolvedor Java Pleno', cidade: 'Maputo', salario: '65.000 MT', area: 'TI', beneficio: 'Seguro médico, vale alimentação, home office 2x/semana' },
    { titulo: 'Analista de Sistemas', cidade: 'Maputo', salario: '58.000 MT', area: 'TI', beneficio: 'Vale transporte, bônus anual' },
    { titulo: 'Suporte Técnico (N1)', cidade: 'Beira', salario: '28.000 MT', area: 'TI', beneficio: 'Treinamento, horário flexível' },
    { titulo: 'Desenvolvedor Front-end (React)', cidade: 'Nampula', salario: '45.000 MT', area: 'TI', beneficio: 'Auxílio home office, plano de saúde' },
    { titulo: 'Especialista em Segurança da Informação', cidade: 'Maputo', salario: '80.000 MT', area: 'TI', beneficio: 'Bônus por desempenho, seguro de vida' },
    { titulo: 'Enfermeiro(a) Geral', cidade: 'Beira', salario: '35.000 MT', area: 'Saúde', beneficio: 'Alojamento, subsídio de refeição' },
    { titulo: 'Médico Clínico Geral', cidade: 'Maputo', salario: '90.000 MT', area: 'Saúde', beneficio: 'Seguro de saúde, carro da empresa' },
    { titulo: 'Técnico de Análises Clínicas', cidade: 'Nampula', salario: '30.000 MT', area: 'Saúde', beneficio: 'Vale transporte, horário fixo' },
    { titulo: 'Farmacêutico', cidade: 'Maputo', salario: '55.000 MT', area: 'Saúde', beneficio: 'Participação em lucros, plano de carreira' },
    { titulo: 'Professor de Matemática', cidade: 'Nampula', salario: '28.000 MT', area: 'Educação', beneficio: 'Contrato anual, subsídio de transporte' },
    { titulo: 'Professor de Português', cidade: 'Maputo', salario: '32.000 MT', area: 'Educação', beneficio: 'Vale refeição, horário parcial' },
    { titulo: 'Instrutor de Informática', cidade: 'Beira', salario: '25.000 MT', area: 'Educação', beneficio: 'Treinamento, possibilidade de efetivação' },
    { titulo: 'Coordenador Pedagógico', cidade: 'Maputo', salario: '48.000 MT', area: 'Educação', beneficio: 'Seguro saúde, bônus anual' },
    { titulo: 'Engenheiro Civil', cidade: 'Maputo', salario: '75.000 MT', area: 'Engenharia', beneficio: 'Vale transporte, seguro de vida' },
    { titulo: 'Técnico de Obras', cidade: 'Beira', salario: '40.000 MT', area: 'Engenharia', beneficio: 'Alojamento, cesta básica' },
    { titulo: 'Arquiteto', cidade: 'Maputo', salario: '62.000 MT', area: 'Engenharia', beneficio: 'Home office, participação em projetos' },
    { titulo: 'Topógrafo', cidade: 'Nampula', salario: '38.000 MT', area: 'Engenharia', beneficio: 'Vale refeição, seguro de acidentes' },
    { titulo: 'Assistente Administrativo', cidade: 'Maputo', salario: '30.000 MT', area: 'Administração', beneficio: 'Vale transporte, refeitório' },
    { titulo: 'Contabilista', cidade: 'Beira', salario: '45.000 MT', area: 'Finanças', beneficio: 'Bônus semestral, seguro saúde' },
    { titulo: 'Auditor Interno', cidade: 'Maputo', salario: '55.000 MT', area: 'Finanças', beneficio: 'Plano de carreira, vale alimentação' },
    { titulo: 'Gestor de Projetos', cidade: 'Nampula', salario: '60.000 MT', area: 'Administração', beneficio: 'Carro da empresa, bônus' },
    { titulo: 'Representante Comercial', cidade: 'Maputo', salario: '25.000 MT + comissão', area: 'Vendas', beneficio: 'Comissões, vale transporte' },
    { titulo: 'Atendente de Loja', cidade: 'Beira', salario: '18.000 MT', area: 'Vendas', beneficio: 'Horário rotativo, refeição' },
    { titulo: 'Supervisor de Vendas', cidade: 'Nampula', salario: '40.000 MT', area: 'Vendas', beneficio: 'Bônus mensal, seguro de vida' },
    { titulo: 'Motorista de Camião', cidade: 'Maputo', salario: '35.000 MT', area: 'Logística', beneficio: 'Vale refeição, seguro de carga' },
    { titulo: 'Operador de Empilhador', cidade: 'Beira', salario: '28.000 MT', area: 'Logística', beneficio: 'Adicional noturno, cesta básica' },
    { titulo: 'Coordenador de Logística', cidade: 'Nampula', salario: '48.000 MT', area: 'Logística', beneficio: 'Carro da empresa, bônus' },
    { titulo: 'Técnico Agrícola', cidade: 'Nampula', salario: '32.000 MT', area: 'Agrário', beneficio: 'Alojamento, vale transporte' },
    { titulo: 'Engenheiro Florestal', cidade: 'Maputo', salario: '50.000 MT', area: 'Agrário', beneficio: 'Seguro de acidentes, participação em projetos' },
    { titulo: 'Recepcionista de Hotel', cidade: 'Maputo', salario: '22.000 MT', area: 'Turismo', beneficio: 'Refeição, desconto em serviços' },
    { titulo: 'Guia Turístico', cidade: 'Beira', salario: '26.000 MT', area: 'Turismo', beneficio: 'Gorjetas, treinamento contínuo' }
];

// =============================================
// FUNÇÃO AUXILIAR: VERIFICAR ASSINANTE ATIVO
// =============================================
function isAssinanteAtivo(telefone) {
    if (!assinantes.has(telefone)) return false;
    const { plano, dataAtivacao } = assinantes.get(telefone);
    const duracaoDias = plano === 'semanal' ? 7 : 30;
    const dataExpiracao = new Date(dataAtivacao);
    dataExpiracao.setDate(dataExpiracao.getDate() + duracaoDias);
    return new Date() < dataExpiracao;
}

// =============================================
// ENDPOINT: TTS (VoiceRSS – gratuito)
// =============================================
app.post('/sintetizar-voz', async (req, res) => {
    const { texto, idioma = 'pt-BR' } = req.body;
    if (!texto) return res.status(400).json({ erro: 'Texto é obrigatório' });
    try {
        const url = `https://api.voicerss.org/?key=SUA_CHAVE_VOICERSS&hl=${idioma === 'pt-BR' ? 'pt-br' : 'en-us'}&v=Maria&src=${encodeURIComponent(texto)}`;
        const response = await fetch(url);
        const audioBuffer = await response.arrayBuffer();
        const audioBase64 = Buffer.from(audioBuffer).toString('base64');
        res.json({ audio: audioBase64 });
    } catch (error) {
        console.error('Erro no TTS:', error);
        res.status(500).json({ erro: 'Falha ao gerar áudio' });
    }
});

// =============================================
// ENDPOINT: CHAT COM IA (GEMINI, DEEPSEEK, CLAUDE)
// =============================================
app.post('/chat-ia', async (req, res) => {
    const { mensagem, idioma = 'pt', modelo = 'gemini', telefone = 'anonimo' } = req.body;

    const prompt = idioma === 'en'
        ? `You are Vaga, a job assistant in Mozambique. Respond briefly and helpfully, using emojis. Question: ${mensagem}`
        : `Você é a Vaga, uma assistente de empregos em Moçambique. Responda de forma breve e útil, usando emojis. Pergunta: ${mensagem}`;

    try {
        let resposta = '';
        switch (modelo) {
            case 'gemini': {
                // ✅ CORREÇÃO: usar gemini-2.0-flash (ou gemini-1.5-pro)
                const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
                const result = await model.generateContent(prompt);
                resposta = result.response.text();
                break;
            }
            case 'deepseek': {
                try {
                    const resp = await deepseekClient.chat.completions.create({
                        model: 'deepseek-chat',
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 1024,
                    });
                    resposta = resp.choices[0].message.content;
                } catch (error) {
                    // Se o erro for 402 (saldo insuficiente), avisa o utilizador
                    if (error.status === 402 || error.message.includes('Insufficient Balance')) {
                        resposta = '⚠️ O DeepSeek está sem saldo neste momento. Por favor, selecciona Gemini ou Claude.';
                    } else {
                        throw error;
                    }
                }
                break;
            }
            case 'claude': {
                if (!anthropic) throw new Error('Claude não configurado.');
                const resp = await anthropic.messages.create({
                    model: 'claude-3-haiku-20240307',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 1024
                });
                resposta = resp.content[0].text;
                break;
            }
            default: throw new Error('Modelo não suportado.');
        }
        // Guarda no histórico
        historico.push({
            usuario: telefone,
            mensagem,
            resposta,
            timestamp: new Date().toISOString()
        });
        if (historico.length > 1000) historico.splice(0, historico.length - 1000);
        res.json({ resposta });
    } catch (error) {
        console.error('Erro na IA:', error);
        res.status(500).json({ erro: `Falha ao gerar resposta com ${modelo}.` });
    }
});

// =============================================
// HISTÓRICO (GET)
// =============================================
app.get('/historico', (req, res) => {
    const limite = parseInt(req.query.limite) || 50;
    res.json(historico.slice(-limite));
});

// =============================================
// MEMÓRIA (POST, GET, DELETE)
// =============================================
app.post('/memoria', (req, res) => {
    const { texto, dono } = req.body;
    if (dono !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    if (!texto) return res.status(400).json({ erro: 'Texto é obrigatório' });
    const nova = { id: uuidv4(), texto, data: new Date().toISOString() };
    memorias.push(nova);
    res.json({ success: true, memoria: nova });
});

app.get('/memoria', (req, res) => {
    res.json(memorias);
});

app.delete('/memoria/:id', (req, res) => {
    const { dono } = req.body;
    if (dono !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    const index = memorias.findIndex(m => m.id === req.params.id);
    if (index === -1) return res.status(404).json({ erro: 'Não encontrado' });
    memorias.splice(index, 1);
    res.json({ success: true });
});

// =============================================
// VAGAS (COM FILTRO E PREMIUM)
// =============================================
app.post('/vagas', (req, res) => {
    const { telefone, cidade, area } = req.body;
    const isDono = (telefone === DONO_TELEFONE);
    const isPremium = isDono || isAssinanteAtivo(telefone);

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

    const resumo = vagasFiltradas.map(v => `${v.titulo} – ${v.cidade} – ${v.salario}`);
    const completo = vagasFiltradas.map(v =>
        `${v.titulo} – ${v.cidade} – ${v.salario}\n   • Benefícios: ${v.beneficio}`
    );

    res.json({
        vagas: isPremium ? completo : resumo,
        plano: isPremium ? (isDono ? 'dono' : 'premium') : 'gratuito',
        total: vagasFiltradas.length,
        mensagem: isPremium ? (isDono ? '👑 Olá, Dono!' : '🔓 Detalhes completos disponíveis!') : '🔒 Assine Premium para ver detalhes.'
    });
});

// =============================================
// ADMIN: ATIVAR ASSINANTE (MANUAL)
// =============================================
app.post('/admin/ativar', (req, res) => {
    const { telefone, dono, plano = 'mensal' } = req.body;
    if (dono !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    if (!telefone) return res.status(400).json({ erro: 'Telefone é obrigatório' });
    if (!['semanal', 'mensal'].includes(plano)) {
        return res.status(400).json({ erro: 'Plano inválido. Use semanal ou mensal' });
    }
    assinantes.set(telefone, {
        plano: plano,
        dataAtivacao: new Date()
    });
    console.log(`✅ Assinante ativado manualmente: ${telefone} - plano ${plano}`);
    res.json({ success: true, mensagem: `Assinante ${telefone} ativado com plano ${plano} por ${plano === 'semanal' ? '7' : '30'} dias!` });
});

// =============================================
// ADMIN: LISTAR ASSINANTES
// =============================================
app.post('/admin/assinantes', (req, res) => {
    const { dono } = req.body;
    if (dono !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    const lista = Array.from(assinantes.entries()).map(([tel, dados]) => {
        const duracao = dados.plano === 'semanal' ? 7 : 30;
        const expiracao = new Date(dados.dataAtivacao);
        expiracao.setDate(expiracao.getDate() + duracao);
        const diasRest = Math.ceil((expiracao - new Date()) / (1000 * 60 * 60 * 24));
        return `${tel} - ${dados.plano} - ${diasRest > 0 ? diasRest + ' dias restantes' : 'expirado'}`;
    });
    res.json({ assinantes: lista, total: lista.length });
});

// =============================================
// ADMIN: ADICIONAR VAGA
// =============================================
app.post('/admin/add-vaga', (req, res) => {
    const { telefone, vaga } = req.body;
    if (telefone !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    if (!vaga || !vaga.titulo || !vaga.cidade || !vaga.salario || !vaga.area || !vaga.beneficio) {
        return res.status(400).json({ erro: 'Vaga inválida' });
    }
    todasVagas.push(vaga);
    res.json({ success: true, mensagem: 'Vaga adicionada!', total: todasVagas.length });
});

// =============================================
// ADMIN: REMOVER VAGA
// =============================================
app.post('/admin/remover-vaga', (req, res) => {
    const { telefone, titulo } = req.body;
    if (telefone !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    const index = todasVagas.findIndex(v => v.titulo.toLowerCase() === titulo.toLowerCase());
    if (index === -1) return res.status(404).json({ erro: 'Vaga não encontrada' });
    todasVagas.splice(index, 1);
    res.json({ success: true, mensagem: 'Vaga removida!', total: todasVagas.length });
});

// =============================================
// PDF: UPLOAD (apenas dono)
// =============================================
if (!fs.existsSync('public/pdfs')) {
    fs.mkdirSync('public/pdfs', { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/pdfs/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.post('/admin/upload-pdf', upload.single('pdf'), (req, res) => {
    const { dono } = req.body;
    if (dono !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    if (!req.file) return res.status(400).json({ erro: 'Ficheiro não enviado' });
    res.json({ success: true, filename: req.file.filename, url: `/pdf/download/${req.file.filename}` });
});

// =============================================
// PDF: COMPRAR (gera pagamento)
// =============================================
app.post('/pdf/comprar', async (req, res) => {
    const { telefone, pdfId, preco = 100 } = req.body;
    if (!telefone || !pdfId) return res.status(400).json({ erro: 'Dados incompletos' });

    try {
        if (pdfsComprados.has(telefone) && pdfsComprados.get(telefone).includes(pdfId)) {
            return res.json({ success: true, jaComprou: true, mensagem: 'Já compraste este PDF!' });
        }

        const response = await fetch(`${PAYSUITE_BASE_URL}/transactions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAYSUITE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: preco,
                currency: 'MZN',
                description: `PDF ${pdfId}`,
                customer: { phone: telefone },
                callback_url: 'https://vagasbot-web-api.onrender.com/webhook-pdf'
            })
        });
        const data = await response.json();
        if (!data || !data.payment_url) throw new Error('Erro ao criar pagamento');

        res.json({ success: true, payment_url: data.payment_url, reference: data.reference });
    } catch (error) {
        console.error('Erro no pagamento do PDF:', error);
        res.status(500).json({ erro: error.message });
    }
});

// =============================================
// PDF: WEBHOOK (confirmação de pagamento)
// =============================================
app.post('/webhook-pdf', (req, res) => {
    const { reference, status, customer_phone, pdfId } = req.body;
    console.log('Webhook PDF:', { reference, status, customer_phone, pdfId });
    if (status === 'completed' && customer_phone && pdfId) {
        if (!pdfsComprados.has(customer_phone)) {
            pdfsComprados.set(customer_phone, []);
        }
        pdfsComprados.get(customer_phone).push(pdfId);
        console.log(`✅ PDF ${pdfId} comprado por ${customer_phone}`);
    }
    res.sendStatus(200);
});

// =============================================
// PDF: DOWNLOAD (verifica se comprou)
// =============================================
app.get('/pdf/download/:filename', (req, res) => {
    const { telefone } = req.query;
    const filename = req.params.filename;

    if (!telefone) {
        return res.status(401).json({ erro: 'É necessário fornecer o telefone para download' });
    }

    const isDono = (telefone === DONO_TELEFONE);
    const comprou = pdfsComprados.has(telefone) && pdfsComprados.get(telefone).includes(filename);

    if (!isDono && !comprou) {
        return res.status(403).json({ erro: 'Compra necessária para descarregar este ficheiro' });
    }

    const filePath = path.join(__dirname, 'public/pdfs/', filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ erro: 'Ficheiro não encontrado' });
    }
});

// =============================================
// VERIFICAR ACESSO (com dias restantes)
// =============================================
app.post('/verificar-acesso', (req, res) => {
    const { telefone } = req.body;
    const isDono = (telefone === DONO_TELEFONE);
    const ativo = isDono || isAssinanteAtivo(telefone);
    let diasRestantes = 0;
    if (ativo && !isDono) {
        const { plano, dataAtivacao } = assinantes.get(telefone);
        const duracaoDias = plano === 'semanal' ? 7 : 30;
        const dataExpiracao = new Date(dataAtivacao);
        dataExpiracao.setDate(dataExpiracao.getDate() + duracaoDias);
        diasRestantes = Math.ceil((dataExpiracao - new Date()) / (1000 * 60 * 60 * 24));
    }
    res.json({
        assinante: ativo,
        dono: isDono,
        diasRestantes: isDono ? -1 : diasRestantes
    });
});

// =============================================
// PAYSUITE: CRIAR PAGAMENTO (assinatura)
// =============================================
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

// =============================================
// PAYSUITE: WEBHOOK (ativação automática)
// =============================================
app.post('/webhook-paysuite', (req, res) => {
    const { reference, status, customer_phone, plano = 'mensal' } = req.body;
    console.log('Webhook PaySuite:', { reference, status, customer_phone, plano });
    if (status === 'completed' && customer_phone) {
        assinantes.set(customer_phone, {
            plano: plano,
            dataAtivacao: new Date()
        });
        console.log(`✅ Assinante ativado (PaySuite): ${customer_phone}`);
    }
    res.sendStatus(200);
});

// =============================================
// CLICPAY: CRIAR PAGAMENTO (alternativa)
// =============================================
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
        res.json({ success: true, transaction_id: data.transaction_id, status: data.status, payment_url: data.payment_url || null });
    } catch (error) {
        res.status(500).json({ success: false, erro: error.message });
    }
});

// =============================================
// CLICPAY: WEBHOOK
// =============================================
app.post('/webhook-clicpay', (req, res) => {
    const { transaction_id, status, customer_msisdn, plano = 'mensal' } = req.body;
    console.log('Webhook ClicPay:', { transaction_id, status, customer_msisdn, plano });
    if ((status === 'completed' || status === 'success') && customer_msisdn) {
        assinantes.set(customer_msisdn, {
            plano: plano,
            dataAtivacao: new Date()
        });
        console.log(`✅ Assinante ativado (ClicPay): ${customer_msisdn}`);
    }
    res.sendStatus(200);
});

// =============================================
// ENDPOINT DE TESTE
// =============================================
app.get('/', (req, res) => res.send('Servidor online!'));

// =============================================
// INICIAR SERVIDOR
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
