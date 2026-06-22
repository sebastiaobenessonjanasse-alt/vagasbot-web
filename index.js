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
// IAs
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
// ARMAZENAMENTO
// =============================================
const assinantes = new Map();
const historico = [];
const memorias = [];
let todasVagas = [
    // ... (coloque aqui a lista de vagas que já tem)
];

// =============================================
// FUNÇÃO AUXILIAR
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
// ENDPOINT: TTS (VoiceRSS)
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
// ENDPOINT: /chat-ia (PRINCIPAL)
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
// HISTÓRICO, MEMÓRIA, VAGAS, ADMIN, PDFs...
// =============================================
// (coloque aqui os restantes endpoints que já tem, como /historico, /memoria, /vagas, /admin/ativar, etc.)
// Se quiser, pode copiar da resposta anterior onde forneci o index.js completo.

// =============================================
// INICIAR SERVIDOR
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
