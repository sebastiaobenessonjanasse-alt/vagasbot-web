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

// =============================================
// INICIALIZAÇÃO DAS 3 IAS (GROQ, MISTRAL, OPENROUTER)
// =============================================
const OpenAI = require('openai');

// 1. Groq (velocidade extrema)
const groqClient = new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY
});

// 2. Mistral (modelos europeus)
const mistralClient = new OpenAI({
    baseURL: 'https://api.mistral.ai/v1',
    apiKey: process.env.MISTRAL_API_KEY
});

// 3. OpenRouter (agregador de modelos gratuitos)
const openRouterClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY
});

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
// ENDPOINT: IA (GROQ, MISTRAL, OPENROUTER)
// =============================================
app.post('/chat-ia', async (req, res) => {
    const { mensagem, idioma = 'pt', modelo = 'groq', telefone = 'anonimo' } = req.body;

    const prompt = idioma === 'en'
        ? `You are Vaga, a job assistant in Mozambique. Respond briefly and helpfully, using emojis. Question: ${mensagem}`
        : `Você é a Vaga, uma assistente de empregos em Moçambique. Responda de forma breve e útil, usando emojis. Pergunta: ${mensagem}`;

    try {
        let resposta = '';

        switch (modelo) {
            case 'groq': {
                const response = await groqClient.chat.completions.create({
                    model: 'mixtral-8x7b-32768', // ou 'llama3-70b-8192'
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 1024,
                });
                resposta = response.choices[0].message.content;
                break;
            }
            case 'mistral': {
                const response = await mistralClient.chat.completions.create({
                    model: 'mistral-large-3', // ou 'mistral-medium-3.5'
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 1024,
                });
                resposta = response.choices[0].message.content;
                break;
            }
            case 'openrouter': {
                const response = await openRouterClient.chat.completions.create({
                    model: 'openrouter/free', // escolhe automaticamente o melhor modelo grátis
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 1024,
                });
                resposta = response.choices[0].message.content;
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
// ENDPOINT: HISTÓRICO
// =============================================
app.get('/historico', (req, res) => {
    const limite = parseInt(req.query.limite) || 50;
    res.json(historico.slice(-limite));
});

// =============================================
// ENDPOINTS: MEMÓRIA
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
// ENDPOINT: VAGAS
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
// ADMIN: ATIVAR ASSINANTE
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
// ADMIN: ADICIONAR / REMOVER VAGA
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

app.post('/admin/remover-vaga', (req, res) => {
    const { telefone, titulo } = req.body;
    if (telefone !== DONO_TELEFONE) return res.status(403).json({ erro: 'Acesso negado' });
    const index = todasVagas.findIndex(v => v.titulo.toLowerCase() === titulo.toLowerCase());
    if (index === -1) return res.status(404).json({ erro: 'Vaga não encontrada' });
    todasVagas.splice(index, 1);
    res.json({ success: true, mensagem: 'Vaga removida!', total: todasVagas.length });
});

// =============================================
// PDF: UPLOAD, COMPRA, DOWNLOAD
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

app.post('/pdf/comprar', async (req, res) => {
    const { telefone, pdfId, preco = 100 } = req.body;
    if (!telefone || !pdfId) return res.status(400).json({ erro: 'Dados incompletos' });
    if (!pdfsComprados.has(telefone)) pdfsComprados.set(telefone, []);
    pdfsComprados.get(telefone).push(pdfId);
    res.json({ success: true, mensagem: 'PDF comprado com sucesso! Podes descarregar.' });
});

app.get('/pdf/download/:filename', (req, res) => {
    const { telefone } = req.query;
    const filename = req.params.filename;
    if (!telefone) return res.status(401).json({ erro: 'Telefone necessário' });
    const isDono = (telefone === DONO_TELEFONE);
    const comprou = pdfsComprados.has(telefone) && pdfsComprados.get(telefone).includes(filename);
    if (!isDono && !comprou) return res.status(403).json({ erro: 'Compra necessária' });
    const filePath = path.join(__dirname, 'public/pdfs/', filename);
    if (fs.existsSync(filePath)) res.download(filePath);
    else res.status(404).json({ erro: 'Ficheiro não encontrado' });
});

// =============================================
// ENDPOINT: VERIFICAR ACESSO
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
    res.json({ assinante: ativo, dono: isDono, diasRestantes: isDono ? -1 : diasRestantes });
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
