const express = require('express');
const app = express();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

app.use(express.json());
app.use(express.static('public'));

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
const DONO_TELEFONE = '879306034';
const PAYSUITE_API_KEY = process.env.PAYSUITE_API_KEY || 'SUA_API_KEY';
const PAYSUITE_SECRET = process.env.PAYSUITE_SECRET || 'SUA_SECRET';
const PAYSUITE_BASE_URL = 'https://api.paysuite.tech/v1';

// =============================================
// CHAVES DAS IAS
// =============================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const deepseekClient = new OpenAI({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY
});
const anthropic = process.env.CLAUDE_API_KEY ? new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }) : null;

// =============================================
// ARMAZENAMENTO (substituir por BD depois)
// =============================================
const assinantes = new Map(); // telefone -> { plano, dataAtivacao }
const historico = []; // array de { usuario, mensagem, resposta, timestamp }
const memorias = []; // array de { id, texto, data }
const vagas = []; // será preenchido

// =============================================
// FUNÇÃO DE EXPIRAÇÃO
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
// ENDPOINT: TTS (VOICERSS – GRATUITO)
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
// ENDPOINT: IA (GEMINI, DEEPSEEK, CLAUDE)
// =============================================
app.post('/chat-ia', async (req, res) => {
    const { mensagem, idioma = 'pt', modelo = 'gemini' } = req.body;
    const prompt = idioma === 'en'
        ? `You are Vaga, a job assistant in Mozambique. Respond briefly and helpfully, using emojis. Question: ${mensagem}`
        : `Você é a Vaga, uma assistente de empregos em Moçambique. Responda de forma breve e útil, usando emojis. Pergunta: ${mensagem}`;

    try {
        let resposta = '';
        switch (modelo) {
            case 'gemini': {
                const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const result = await model.generateContent(prompt);
                resposta = result.response.text();
                break;
            }
            case 'deepseek': {
                const resp = await deepseekClient.chat.completions.create({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 1024,
                });
                resposta = resp.choices[0].message.content;
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
            usuario: req.body.telefone || 'anonimo',
            mensagem,
            resposta,
            timestamp: new Date().toISOString()
        });
        res.json({ resposta });
    } catch (error) {
        console.error('Erro na IA:', error);
        res.status(500).json({ erro: `Falha ao gerar resposta com ${modelo}.` });
    }
});

// =============================================
// ENDPOINT: HISTÓRICO
// =============================================
app.get('/historico', (req, res) => {
    const limite = parseInt(req.query.limite) || 50;
    res.json(historico.slice(-limite));
});

// =============================================
// ENDPOINT: MEMÓRIA (NOTAS DO DONO)
// =============================================
app.post('/memoria', (req, res) => {
    const { texto, dono } = req.body;
    if (dono !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
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
// ENDPOINT: VAGAS (COM FILTRO E PREMIUM)
// =============================================
app.post('/vagas', (req, res) => {
    const { telefone, cidade, area } = req.body;
    const isDono = telefone === DONO_TELEFONE;
    const isPremium = isDono || isAssinanteAtivo(telefone);
    // ... (lógica de vagas igual à anterior)
    res.json({ vagas: [], total: 0, plano: isPremium ? 'premium' : 'gratuito' });
});

// =============================================
// ADMIN: ATIVAR ASSINANTE
// =============================================
app.post('/admin/ativar', (req, res) => {
    const { telefone, dono, plano = 'mensal' } = req.body;
    if (dono !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    if (!telefone) return res.status(400).json({ erro: 'Telefone é obrigatório' });
    assinantes.set(telefone, { plano, dataAtivacao: new Date() });
    res.json({ success: true, mensagem: `Assinante ${telefone} ativado com plano ${plano}` });
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
        const diasRest = Math.ceil((expiracao - new Date()) / (1000*60*60*24));
        return `${tel} - ${dados.plano} - ${diasRest > 0 ? diasRest + 'd' : 'expirado'}`;
    });
    res.json({ assinantes: lista, total: lista.length });
});

// =============================================
// PDF DOWNLOAD (COM PAGAMENTO OBRIGATÓRIO)
// =============================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/pdfs/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.post('/admin/upload-pdf', upload.single('pdf'), (req, res) => {
    const { dono } = req.body;
    if (dono !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    if (!req.file) return res.status(400).json({ erro: 'Ficheiro não enviado' });
    res.json({ success: true, filename: req.file.filename });
});

app.post('/pdf/comprar', async (req, res) => {
    const { telefone, pdfId } = req.body;
    // Verifica se o utilizador já comprou este PDF (armazenar numa lista)
    // Se não, redireciona para pagamento
    try {
        const response = await fetch(`${PAYSUITE_BASE_URL}/transactions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${PAYSUITE_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: 100, // valor do PDF
                currency: 'MZN',
                description: `PDF ${pdfId}`,
                customer: { phone: telefone },
                callback_url: 'https://vagasbot-web-api.onrender.com/webhook-pdf'
            })
        });
        const data = await response.json();
        res.json({ success: true, payment_url: data.payment_url });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/webhook-pdf', (req, res) => {
    const { reference, status, customer_phone, pdfId } = req.body;
    if (status === 'completed') {
        // Guardar que este utilizador comprou este PDF
        console.log(`✅ PDF ${pdfId} comprado por ${customer_phone}`);
    }
    res.sendStatus(200);
});

app.get('/pdf/download/:filename', (req, res) => {
    const { telefone } = req.query;
    // Verificar se o utilizador comprou este PDF
    // Se sim, enviar ficheiro
    const filePath = path.join(__dirname, 'public/pdfs/', req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ erro: 'Ficheiro não encontrado' });
    }
});

// =============================================
// INICIAR SERVIDOR
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
