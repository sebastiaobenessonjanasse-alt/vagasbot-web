const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const fs = require("fs");
const fetch = require("node-fetch");
const cron = require("node-cron");
const axios = require("axios");
const cheerio = require("cheerio");
const Parser = require("rss-parser");
const parser = new Parser();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ============================================================
// VARIÁVEIS DE AMBIENTE
// ============================================================
const PAYSUITE_API_KEY = process.env.PAYSUITE_API_KEY || 'SUA_API_KEY';
const PAYSUITE_SECRET = process.env.PAYSUITE_SECRET || 'SUA_SECRET';
const PAYSUITE_BASE_URL = process.env.PAYSUITE_BASE_URL || 'https://api.paysuite.tech/v1';
const VOICERSS_API_KEY = process.env.VOICERSS_API_KEY || 'SUA_CHAVE_VOICERSS';

// ============================================================
// CONFIGURAÇÃO DO SQLITE
// ============================================================
const db = new sqlite3.Database("./vagasbot.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    message TEXT,
    reply TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    status TEXT,
    transactionId TEXT,
    amount INTEGER,
    plano TEXT,
    phone TEXT,
    dataAtivacao DATETIME,
    dataExpiracao DATETIME,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS assinantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT UNIQUE,
    plano TEXT,
    dataAtivacao DATETIME,
    dataExpiracao DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS vagas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT,
    cidade TEXT,
    salario TEXT,
    area TEXT,
    beneficio TEXT,
    data_publicacao DATETIME DEFAULT CURRENT_TIMESTAMP,
    fonte TEXT
  )`);
});

// ============================================================
// FUNÇÕES AUXILIARES (assinaturas)
// ============================================================
function saveHistory(user, message, reply) {
  db.run("INSERT INTO history (user, message, reply) VALUES (?, ?, ?)", [user, message, reply]);
}

function isAssinanteAtivo(user) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM assinantes WHERE user = ? AND dataExpiracao > datetime('now')", [user], (err, row) => {
      if (err) return reject(err);
      resolve(!!row);
    });
  });
}

function getDiasRestantes(user) {
  return new Promise((resolve, reject) => {
    db.get("SELECT julianday(dataExpiracao) - julianday('now') AS dias FROM assinantes WHERE user = ? AND dataExpiracao > datetime('now')", [user], (err, row) => {
      if (err) return reject(err);
      resolve(row ? Math.ceil(row.dias) : 0);
    });
  });
}

function ativarAssinante(user, amount, phone, transactionId) {
  const planos = { '50': '1 Semana', '100': '2 Semanas', '150': '3 Semanas', '200': '1 Mês' };
  const diasMap = { '50': 7, '100': 14, '150': 21, '200': 30 };
  const plano = planos[amount.toString()];
  const dias = diasMap[amount.toString()];
  if (!plano) return Promise.reject(new Error('Plano inválido'));

  const dataAtivacao = new Date();
  const dataExpiracao = new Date();
  dataExpiracao.setDate(dataExpiracao.getDate() + dias);

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO assinantes (user, plano, dataAtivacao, dataExpiracao)
       VALUES (?, ?, ?, ?)`,
      [user, plano, dataAtivacao.toISOString(), dataExpiracao.toISOString()],
      (err) => {
        if (err) return reject(err);
        db.run(
          `INSERT INTO payments (user, status, transactionId, amount, plano, phone, dataAtivacao, dataExpiracao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [user, 'confirmed', transactionId, amount, plano, phone, dataAtivacao.toISOString(), dataExpiracao.toISOString()],
          (err2) => {
            if (err2) return reject(err2);
            resolve();
          }
        );
      }
    );
  });
}

// ============================================================
// INICIALIZAÇÃO DAS IAS (OpenRouter e Groq)
// ============================================================
const OpenAI = require('openai');

const openRouterClient = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || 'SUA_CHAVE_OPENROUTER',
  defaultHeaders: {
    'HTTP-Referer': 'https://vagasbot-web-api.onrender.com',
    'X-Title': 'VagasBot'
  }
});

const groqClient = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY || 'SUA_CHAVE_GROQ'
});

async function gerarRespostaIA(prompt, modelo = 'openrouter') {
  try {
    if (modelo === 'openrouter') {
      const response = await openRouterClient.chat.completions.create({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
      });
      return response.choices[0].message.content;
    } else if (modelo === 'groq') {
      const response = await groqClient.chat.completions.create({
        model: 'mixtral-8x7b-32768',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
      });
      return response.choices[0].message.content;
    } else {
      throw new Error('Modelo não suportado');
    }
  } catch (error) {
    console.error(`Erro no ${modelo}:`, error.message);
    try {
      if (modelo === 'openrouter') {
        console.log('Tentando fallback para Groq...');
        const response = await groqClient.chat.completions.create({
          model: 'mixtral-8x7b-32768',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1024,
        });
        return response.choices[0].message.content;
      } else {
        console.log('Tentando fallback para OpenRouter...');
        const response = await openRouterClient.chat.completions.create({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1024,
        });
        return response.choices[0].message.content;
      }
    } catch (fallbackError) {
      console.error('Ambas as IAs falharam:', fallbackError.message);
      return '⚠️ Desculpe, estou com problemas para responder agora. Tente novamente mais tarde.';
    }
  }
}

// ============================================================
// TTS – SÍNTESE DE VOZ (VoiceRSS)
// ============================================================
app.post("/sintetizar-voz", async (req, res) => {
  const { texto, idioma = "pt-BR" } = req.body;
  if (!texto) return res.status(400).json({ erro: "Texto obrigatório" });

  try {
    const lang = idioma === "pt-BR" ? "pt-br" : "en-us";
    const url = `https://api.voicerss.org/?key=${VOICERSS_API_KEY}&hl=${lang}&v=Maria&src=${encodeURIComponent(texto)}`;
    const response = await fetch(url);
    const audioBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
    res.json({ audio: audioBase64 });
  } catch (error) {
    console.error('Erro no TTS:', error);
    res.status(500).json({ erro: 'Falha ao gerar áudio' });
  }
});

// ============================================================
// BUSCA AUTOMÁTICA DE VAGAS (RSS + SCRAPING + CRON)
// ============================================================
// Função para guardar vagas na BD (substitui as antigas)
async function guardarVagas(vagas) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("DELETE FROM vagas", (err) => {
        if (err) return reject(err);
        if (vagas.length === 0) return resolve();

        const stmt = db.prepare(
          "INSERT INTO vagas (titulo, cidade, salario, area, beneficio, fonte) VALUES (?, ?, ?, ?, ?, ?)"
        );
        vagas.forEach(v => {
          stmt.run(v.titulo, v.cidade, v.salario, v.area, v.beneficio, v.fonte || 'scraping');
        });
        stmt.finalize();
        resolve();
      });
    });
  });
}

// Fonte 1: RSS Feed (exemplo com emprego.co.mz - ajustar se necessário)
async function buscarVagasRSS() {
  try {
    // Tenta vários feeds conhecidos
    const feeds = [
      'https://emprego.co.mz/feed',
      'https://njobs.co.mz/feed',
      'https://sovagas.co.mz/feed'
    ];
    for (const feedUrl of feeds) {
      try {
        const feed = await parser.parseURL(feedUrl);
        if (feed.items && feed.items.length > 0) {
          const vagas = feed.items.map(item => ({
            titulo: item.title,
            cidade: 'Maputo', // ou extrair do conteúdo
            salario: 'A combinar',
            area: 'Geral',
            beneficio: item.contentSnippet || '',
            fonte: 'RSS'
          }));
          return vagas;
        }
      } catch (e) {}
    }
    return null;
  } catch (error) {
    console.warn('RSS falhou:', error.message);
    return null;
  }
}

// Fonte 2: Web Scraping (njobs.co.mz)
async function buscarVagasScraping() {
  try {
    const response = await axios.get('https://njobs.co.mz', {
      timeout: 10000,
      headers: { 'User-Agent': 'VagasBot/1.0' }
    });
    const $ = cheerio.load(response.data);
    const vagas = [];

    // Adaptar seletores conforme a estrutura real do site
    $('.job-item, .vaga-item, article, .job-listing').each((i, el) => {
      const titulo = $(el).find('.job-title, h2, h3, .title').first().text().trim();
      const cidade = $(el).find('.job-location, .local, .city, .location').first().text().trim() || 'Maputo';
      const salario = $(el).find('.salary, .salario, .price').first().text().trim() || 'A combinar';
      const area = $(el).find('.category, .area, .type').first().text().trim() || 'Geral';
      const beneficio = $(el).find('.benefits, .descricao, .description').first().text().trim() || '';

      if (titulo && titulo.length > 3) {
        vagas.push({ titulo, cidade, salario, area, beneficio, fonte: 'scraping' });
      }
    });

    // Se não encontrou nenhuma vaga, tenta outro seletor genérico
    if (vagas.length === 0) {
      $('a[href*="vaga"], a[href*="job"], .post, .item').each((i, el) => {
        const titulo = $(el).text().trim();
        if (titulo.length > 10 && titulo.length < 100) {
          vagas.push({
            titulo: titulo.substring(0, 80),
            cidade: 'Maputo',
            salario: 'A combinar',
            area: 'Geral',
            beneficio: '',
            fonte: 'scraping'
          });
        }
      });
    }

    return vagas;
  } catch (error) {
    console.error('Scraping falhou:', error.message);
    return null;
  }
}

// Função principal de atualização
async function atualizarVagas() {
  console.log('🔄 A atualizar vagas...');
  let vagas = [];

  // Tenta RSS primeiro
  vagas = await buscarVagasRSS();
  if (vagas && vagas.length > 0) {
    await guardarVagas(vagas);
    console.log(`✅ ${vagas.length} vagas atualizadas via RSS.`);
    return;
  }

  // Se RSS falhar, tenta scraping
  vagas = await buscarVagasScraping();
  if (vagas && vagas.length > 0) {
    await guardarVagas(vagas);
    console.log(`✅ ${vagas.length} vagas atualizadas via scraping.`);
    return;
  }

  console.warn('⚠️ Nenhuma fonte retornou vagas. A manter as anteriores.');
}

// Agendar a atualização a cada 6 horas
cron.schedule('0 */6 * * *', () => {
  atualizarVagas();
});

// Atualizar uma vez ao iniciar o servidor (após 5 segundos)
setTimeout(atualizarVagas, 5000);

// ============================================================
// PAYSUITE – CRIAR PAGAMENTO
// ============================================================
app.post("/criar-pagamento-paysuite", async (req, res) => {
  const { telefone, amount } = req.body;
  if (!telefone || !amount) {
    return res.status(400).json({ success: false, message: "Telefone e valor são obrigatórios." });
  }
  const planos = { '50': '1 Semana', '100': '2 Semanas', '150': '3 Semanas', '200': '1 Mês' };
  const plano = planos[amount.toString()];
  if (!plano) {
    return res.status(400).json({ success: false, message: "Valor inválido. Escolha 50, 100, 150 ou 200 MT." });
  }

  try {
    const response = await fetch(`${PAYSUITE_BASE_URL}/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSUITE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount,
        currency: 'MZN',
        description: `Assinatura ${plano} - VagasBot`,
        customer: { phone: telefone },
        callback_url: 'https://vagasbot-web-api.onrender.com/webhook-paysuite'
      })
    });
    const data = await response.json();
    if (data && data.payment_url) {
      res.json({ success: true, payment_url: data.payment_url, reference: data.reference });
    } else {
      throw new Error('Erro ao criar transação');
    }
  } catch (error) {
    console.error('Erro no PaySuite:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// PAYSUITE – WEBHOOK
// ============================================================
app.post("/webhook-paysuite", async (req, res) => {
  const { reference, status, customer_phone, amount } = req.body;
  console.log('Webhook PaySuite recebido:', { reference, status, customer_phone, amount });

  if (status === 'completed' && customer_phone && amount) {
    try {
      await ativarAssinante(customer_phone, parseInt(amount), customer_phone, reference);
      console.log(`✅ Assinante ativado: ${customer_phone} - ${amount} MT`);
    } catch (error) {
      console.error('Erro ao ativar assinante:', error);
    }
  }
  res.sendStatus(200);
});

// ============================================================
// ENDPOINTS
// ============================================================

app.get('/', (req, res) => {
  res.send('🚀 VagasBot API está online!');
});

app.get("/history", (req, res) => {
  db.all("SELECT * FROM history ORDER BY timestamp DESC LIMIT 50", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, history: rows });
  });
});

app.get("/payment-history", (req, res) => {
  db.all("SELECT * FROM payments ORDER BY timestamp DESC LIMIT 50", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, history: rows });
  });
});

app.post("/verificar-acesso", async (req, res) => {
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: "Utilizador é obrigatório" });
  try {
    const ativo = await isAssinanteAtivo(user);
    const dias = ativo ? await getDiasRestantes(user) : 0;
    res.json({ assinante: ativo, diasRestantes: dias });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/memory", (req, res) => {
  const { key, value } = req.body;
  if (!key || !value) return res.status(400).json({ success: false, error: "Chave e valor são obrigatórios." });
  db.run("INSERT OR REPLACE INTO memory (key, value) VALUES (?, ?)", [key, value], (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

app.get("/memory", (req, res) => {
  db.all("SELECT * FROM memory", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, memory: rows });
  });
});

// ---------- CHAT (COM IA) ----------
app.post("/chat", async (req, res) => {
  const { prompt, user = "Sebastião", modelo = "openrouter", idioma = "pt" } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: "Mensagem vazia." });

  const systemPrompt = idioma === 'en'
    ? `You are Vaga, a job assistant in Mozambique. Respond briefly, helpfully and with emojis. Be friendly and professional.`
    : `Você é a Vaga, uma assistente de empregos em Moçambique. Responda de forma breve, útil e com emojis. Seja simpática e profissional.`;

  try {
    const resposta = await gerarRespostaIA(`${systemPrompt}\n\nUsuário: ${prompt}`, modelo);
    saveHistory(user, prompt, resposta);
    res.json({ success: true, reply: resposta });
  } catch (error) {
    console.error('Erro no chat:', error);
    res.status(500).json({ success: false, error: 'Erro ao processar a mensagem.' });
  }
});

// ---------- PAGAMENTO (SIMULAÇÃO LOCAL) ----------
app.post("/payment", async (req, res) => {
  const { user, amount, phone } = req.body;
  if (!user || !amount || !phone) {
    return res.status(400).json({ success: false, message: "Dados incompletos." });
  }
  const planos = { '50': '1 Semana', '100': '2 Semanas', '150': '3 Semanas', '200': '1 Mês' };
  if (!planos[amount.toString()]) {
    return res.status(400).json({ success: false, message: "Valor inválido." });
  }

  const transactionId = "TX-" + Date.now();
  try {
    await ativarAssinante(user, amount, phone, transactionId);
    res.json({
      success: true,
      message: `Assinatura ${planos[amount.toString()]} (${amount} MT) confirmada!`,
      transactionId
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- UPLOAD DE FOTOS ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop();
    cb(null, `foto_${Date.now()}.${ext}`);
  }
});
const upload = multer({ storage });

app.post("/upload-photo", upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Nenhum ficheiro enviado." });
  res.json({
    success: true,
    message: "Foto recebida com sucesso!",
    file: req.file.filename,
    url: `/uploads/${req.file.filename}`
  });
});

// ---------- GERAR PDF (PAGO) ----------
app.post("/generate-pdf", async (req, res) => {
  const { user, content } = req.body;
  if (!user || !content) return res.status(400).json({ success: false, message: "Dados incompletos." });
  try {
    const ativo = await isAssinanteAtivo(user);
    if (!ativo) {
      return res.status(403).json({ success: false, message: "Assinatura necessária para gerar PDF." });
    }
    const filename = `pdf_${Date.now()}.txt`;
    fs.writeFileSync(filename, content);
    res.json({ success: true, message: "PDF gerado com sucesso!", file: filename });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- GERAR IMAGEM (PAGO) ----------
app.post("/generate-image", async (req, res) => {
  const { user, description } = req.body;
  if (!user || !description) return res.status(400).json({ success: false, message: "Dados incompletos." });
  try {
    const ativo = await isAssinanteAtivo(user);
    if (!ativo) {
      return res.status(403).json({ success: false, message: "Assinatura necessária para gerar imagens." });
    }
    res.json({
      success: true,
      message: "Imagem gerada com sucesso! (simulação)",
      description,
      url: `https://via.placeholder.com/400x300?text=${encodeURIComponent(description)}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- VAGAS (LENDO DA BASE DE DADOS) ----------
app.post("/vagas", (req, res) => {
  const { cidade, area } = req.body;

  let sql = "SELECT * FROM vagas";
  const params = [];
  const conditions = [];

  if (cidade) {
    conditions.push("cidade LIKE ?");
    params.push(`%${cidade}%`);
  }
  if (area) {
    conditions.push("area LIKE ?");
    params.push(`%${area}%`);
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY data_publicacao DESC LIMIT 50";

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro ao buscar vagas:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({
      success: true,
      vagas: rows,
      total: rows.length
    });
  });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor VagasBot a correr na porta ${PORT}`);
});
