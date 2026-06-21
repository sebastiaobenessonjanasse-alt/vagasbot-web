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
const CLICPAY_API_KEY = process.env.CLICPAY_API_KEY || 'SUA_CLICPAY_API_KEY';
const CLICPAY_WALLET_ID = process.env.CLICPAY_WALLET_ID || 'SEU_WALLET_ID';
const CLICPAY_BASE_URL = 'https://clicpay.co.mz/api/v2';

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
// ARMAZENAMENTO E VAGAS
// =============================================
const assinantes = new Set();
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
// ENDPOINT: TTS (VoiceRSS gratuito)
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
// ENDPOINT: IA (Gemini, DeepSeek, Claude)
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
        res.json({ resposta });
    } catch (error) {
        console.error('Erro na IA:', error);
        res.status(500).json({ erro: `Falha ao gerar resposta com ${modelo}.` });
    }
});

// =============================================
// ENDPOINT: VAGAS
// =============================================
app.post('/vagas', async (req, res) => {
    const { telefone, cidade, area } = req.body;
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

    res.json({
        vagas: isPremium ? completo : resumo,
        plano: isPremium ? (isDono ? 'dono' : 'premium') : 'gratuito',
        total: vagasFiltradas.length,
        mensagem: isPremium ? (isDono ? '👑 Olá, Dono!' : '🔓 Detalhes completos disponíveis!') : '🔒 Assine Premium para ver detalhes.'
    });
});

// =============================================
// ENDPOINT: VERIFICAR ACESSO
// =============================================
app.post('/verificar-acesso', (req, res) => {
    const { telefone } = req.body;
    res.json({
        assinante: assinantes.has(telefone) || telefone === DONO_TELEFONE,
        dono: telefone === DONO_TELEFONE
    });
});

// =============================================
// ADMIN (apenas dono)
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
        return res.status(400).json({ erro: 'Vaga inválida' });
    }
    todasVagas.push(vaga);
    res.json({ success: true, mensagem: 'Vaga adicionada!', total: todasVagas.length });
});

app.post('/admin/remover-vaga', (req, res) => {
    const { telefone, titulo } = req.body;
    if (telefone !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    const index = todasVagas.findIndex(v => v.titulo.toLowerCase() === titulo.toLowerCase());
    if (index === -1) return res.status(404).json({ erro: 'Vaga não encontrada' });
    todasVagas.splice(index, 1);
    res.json({ success: true, mensagem: 'Vaga removida!', total: todasVagas.length });
});

// =============================================
// INICIAR SERVIDOR
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
