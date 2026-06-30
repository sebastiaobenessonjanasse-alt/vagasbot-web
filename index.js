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
app.use(express.static("uploads"));
app.use(express.static(".")); // serve ficheiros da raiz (dono.png, info-dono.jpg)

// ============================================================
// VARIÁVEIS DE AMBIENTE
// ============================================================
const PAYSUITE_API_KEY = process.env.PAYSUITE_API_KEY || 'SUA_API_KEY';
const PAYSUITE_SECRET = process.env.PAYSUITE_SECRET || 'SUA_SECRET';
const PAYSUITE_BASE_URL = process.env.PAYSUITE_BASE_URL || 'https://api.paysuite.tech/v1';
const VOICERSS_API_KEY = process.env.VOICERSS_API_KEY || 'SUA_CHAVE_VOICERSS';
const DONO_TELEFONE = '879306034';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'SUA_CHAVE_OPENROUTER';
const GROQ_API_KEY = process.env.GROQ_API_KEY || 'SUA_CHAVE_GROQ';

// ============================================================
// PLANOS
// ============================================================
const PLANOS = {
  '50': { dias: 7, descricao: '7 dias' },
  '100': { dias: 14, descricao: '14 dias' },
  '150': { dias: 21, descricao: '21 dias' },
  '200': { dias: 30, descricao: '1 mês' }
};

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

  db.run(`CREATE TABLE IF NOT EXISTS comprovativos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    filename TEXT,
    status TEXT DEFAULT 'pendente',
    data_upload DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS utilizadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefone TEXT UNIQUE,
    nome TEXT,
    area TEXT,
    data_registo DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS imagens_geradas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    descricao TEXT,
    url TEXT,
    data_geracao DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================
function saveHistory(user, message, reply) {
  db.run("INSERT INTO history (user, message, reply) VALUES (?, ?, ?)", [user, message, reply]);
}

function isAssinanteAtivo(user) {
  if (user === DONO_TELEFONE) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM assinantes WHERE user = ? AND dataExpiracao > datetime('now')", [user], (err, row) => {
      if (err) return reject(err);
      resolve(!!row);
    });
  });
}

function getDiasRestantes(user) {
  if (user === DONO_TELEFONE) return Promise.resolve(9999);
  return new Promise((resolve, reject) => {
    db.get("SELECT julianday(dataExpiracao) - julianday('now') AS dias FROM assinantes WHERE user = ? AND dataExpiracao > datetime('now')", [user], (err, row) => {
      if (err) return reject(err);
      resolve(row ? Math.ceil(row.dias) : 0);
    });
  });
}

function ativarAssinante(user, amount, phone, transactionId) {
  const plano = PLANOS[amount.toString()];
  if (!plano) return Promise.reject(new Error('Plano inválido'));
  const dataAtivacao = new Date();
  const dataExpiracao = new Date();
  dataExpiracao.setDate(dataExpiracao.getDate() + plano.dias);
  return new Promise((resolve, reject) => {
    db.run(`INSERT OR REPLACE INTO assinantes (user, plano, dataAtivacao, dataExpiracao) VALUES (?, ?, ?, ?)`,
      [user, plano.descricao, dataAtivacao.toISOString(), dataExpiracao.toISOString()],
      (err) => {
        if (err) return reject(err);
        db.run(`INSERT INTO payments (user, status, transactionId, amount, plano, phone, dataAtivacao, dataExpiracao) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [user, 'confirmed', transactionId, amount, plano.descricao, phone, dataAtivacao.toISOString(), dataExpiracao.toISOString()],
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
// INICIALIZAÇÃO DAS IAS
// ============================================================
const OpenAI = require('openai');

const openRouterClient = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: { 'HTTP-Referer': 'https://vagasbot-web-api.onrender.com', 'X-Title': 'VagasBot' }
});

const groqClient = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: GROQ_API_KEY
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
// TTS – SÍNTESE DE VOZ
// ============================================================
app.post("/sintetizar-voz", async (req, res) => {
  const { texto, idioma = "pt-BR" } = req.body;
  if (!texto) return res.status(400).json({ erro: "Texto obrigatório" });
  try {
    const langMap = { 'pt-PT': 'pt-pt', 'pt-BR': 'pt-br', 'en-US': 'en-us' };
    const lang = langMap[idioma] || 'pt-br';
    let voice = idioma === 'en-US' ? 'Joanna' : 'Maria';
    const url = `https://api.voicerss.org/?key=${VOICERSS_API_KEY}&hl=${lang}&v=${voice}&src=${encodeURIComponent(texto)}`;
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
// BUSCA AUTOMÁTICA DE VAGAS
// ============================================================
async function guardarVagas(vagas) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("DELETE FROM vagas", (err) => {
        if (err) return reject(err);
        if (vagas.length === 0) return resolve();
        const stmt = db.prepare("INSERT INTO vagas (titulo, cidade, salario, area, beneficio, fonte) VALUES (?, ?, ?, ?, ?, ?)");
        vagas.forEach(v => stmt.run(v.titulo, v.cidade, v.salario, v.area, v.beneficio, v.fonte || 'scraping'));
        stmt.finalize();
        resolve();
      });
    });
  });
}

async function buscarVagasRSS() {
  try {
    const feeds = ['https://emprego.co.mz/feed', 'https://njobs.co.mz/feed', 'https://sovagas.co.mz/feed'];
    for (const feedUrl of feeds) {
      try {
        const feed = await parser.parseURL(feedUrl);
        if (feed.items && feed.items.length > 0) {
          return feed.items.map(item => ({
            titulo: item.title.replace(/^The post\s*/, '').trim().substring(0, 80) || 'Oferta de emprego',
            cidade: 'Maputo',
            salario: 'A combinar',
            area: 'Geral',
            beneficio: (item.contentSnippet || '').substring(0, 100),
            fonte: 'RSS'
          }));
        }
      } catch (e) {}
    }
    return null;
  } catch (error) {
    console.warn('RSS falhou:', error.message);
    return null;
  }
}

async function buscarVagasScraping() {
  try {
    const response = await axios.get('https://emprego.co.mz', { timeout: 10000, headers: { 'User-Agent': 'VagasBot/1.0' } });
    const $ = cheerio.load(response.data);
    const vagas = [];
    $('article, .post, .job-item, .entry').each((i, el) => {
      let titulo = $(el).find('h2, h3, .title, .entry-title').first().text().trim().replace(/^The post\s*/, '').replace(/^Como\s*/, '');
      if (titulo && titulo.length > 5 && titulo.length < 120 && !titulo.includes('emprego.co.mz')) {
        vagas.push({ titulo: titulo.substring(0, 80), cidade: 'Maputo', salario: 'A combinar', area: 'Geral', beneficio: '', fonte: 'scraping' });
      }
    });
    if (vagas.length < 3) {
      $('h2, h3').each((i, el) => {
        const texto = $(el).text().trim();
        if (texto.length > 10 && texto.length < 80 && !texto.includes('The post')) {
          vagas.push({ titulo: texto, cidade: 'Maputo', salario: 'A combinar', area: 'Geral', beneficio: '', fonte: 'scraping' });
        }
      });
    }
    return vagas;
  } catch (error) {
    console.error('Scraping falhou:', error.message);
    return null;
  }
}

async function atualizarVagas() {
  console.log('🔄 A atualizar vagas...');
  let vagas = await buscarVagasRSS();
  if (vagas && vagas.length > 0) {
    await guardarVagas(vagas);
    console.log(`✅ ${vagas.length} vagas atualizadas via RSS.`);
    return;
  }
  vagas = await buscarVagasScraping();
  if (vagas && vagas.length > 0) {
    await guardarVagas(vagas);
    console.log(`✅ ${vagas.length} vagas atualizadas via scraping.`);
    return;
  }
  console.warn('⚠️ Nenhuma fonte retornou vagas. A manter as anteriores.');
}
cron.schedule('0 */6 * * *', () => { atualizarVagas(); });
setTimeout(atualizarVagas, 5000);

// ============================================================
// PAYSUITE
// ============================================================
app.post("/criar-pagamento-paysuite", async (req, res) => {
  const { telefone, amount } = req.body;
  if (!telefone || !amount) return res.status(400).json({ success: false, message: "Telefone e valor são obrigatórios." });
  const plano = PLANOS[amount.toString()];
  if (!plano) return res.status(400).json({ success: false, message: "Valor inválido. Escolha 50, 100, 150 ou 200 MT." });
  try {
    const response = await fetch(`${PAYSUITE_BASE_URL}/transactions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PAYSUITE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'MZN', description: `Assinatura ${plano.descricao} - VagasBot`, customer: { phone: telefone }, callback_url: 'https://vagasbot-web-api.onrender.com/webhook-paysuite' })
    });
    const data = await response.json();
    if (data && data.payment_url) res.json({ success: true, payment_url: data.payment_url, reference: data.reference });
    else throw new Error('Erro ao criar transação');
  } catch (error) {
    console.error('Erro no PaySuite:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/webhook-paysuite", async (req, res) => {
  const { reference, status, customer_phone, amount } = req.body;
  console.log('Webhook PaySuite recebido:', { reference, status, customer_phone, amount });
  if (status === 'completed' && customer_phone && amount) {
    try {
      await ativarAssinante(customer_phone, parseInt(amount), customer_phone, reference);
      console.log(`✅ Assinante ativado: ${customer_phone} - ${amount} MT`);
    } catch (error) { console.error('Erro ao ativar assinante:', error); }
  }
  res.sendStatus(200);
});

// ============================================================
// ENDPOINTS
// ============================================================
app.get('/', (req, res) => res.send('🚀 VagasBot API está online!'));

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
  const isDono = (user === DONO_TELEFONE);
  try {
    const ativo = isDono || await isAssinanteAtivo(user);
    const dias = isDono ? 9999 : (ativo ? await getDiasRestantes(user) : 0);
    res.json({ assinante: ativo, dono: isDono, diasRestantes: dias });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/registar-utilizador", (req, res) => {
  const { telefone, nome, area } = req.body;
  if (!telefone) return res.status(400).json({ success: false, error: "Telefone é obrigatório" });
  db.run("INSERT OR REPLACE INTO utilizadores (telefone, nome, area) VALUES (?, ?, ?)", [telefone, nome || '', area || ''], (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

app.get("/utilizadores", (req, res) => {
  db.all("SELECT * FROM utilizadores ORDER BY data_registo DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, utilizadores: rows });
  });
});

const uploadComprovativo = multer({ dest: "uploads/comprovativos/" });
app.post("/upload-comprovativo", uploadComprovativo.single("comprovativo"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Nenhum ficheiro enviado." });
  const { user } = req.body;
  db.run("INSERT INTO comprovativos (user, filename, status) VALUES (?, ?, 'pendente')", [user, req.file.filename], (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, message: "Comprovativo enviado! Aguarde confirmação.", filename: req.file.filename });
  });
});

app.post("/confirmar-comprovativo", (req, res) => {
  const { user, filename } = req.body;
  if (!user || !filename) return res.status(400).json({ success: false, message: "Dados incompletos." });
  db.run("UPDATE comprovativos SET status = 'confirmado' WHERE user = ? AND filename = ?", [user, filename], (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, message: "Comprovativo confirmado! Assinatura ativada." });
  });
});

app.post("/gerar-pdf", async (req, res) => {
  const { user, tipo, conteudo } = req.body;
  if (!user) return res.status(400).json({ success: false, message: "Utilizador obrigatório." });
  const ativo = await isAssinanteAtivo(user);
  if (!ativo && user !== DONO_TELEFONE) return res.status(403).json({ success: false, message: "Assinatura necessária." });
  const filename = `${tipo || 'documento'}_${Date.now()}.txt`;
  fs.writeFileSync(filename, conteudo || 'Conteúdo do documento');
  res.json({ success: true, message: "Documento gerado!", file: filename });
});

app.post("/gerar-imagem", async (req, res) => {
  const { user, descricao } = req.body;
  if (!user) return res.status(400).json({ success: false, message: "Utilizador obrigatório." });
  const ativo = await isAssinanteAtivo(user);
  if (!ativo && user !== DONO_TELEFONE) return res.status(403).json({ success: false, message: "Assinatura necessária." });
  const url = `https://via.placeholder.com/600x400?text=${encodeURIComponent(descricao || 'Imagem VagasBot')}`;
  db.run("INSERT INTO imagens_geradas (user, descricao, url) VALUES (?, ?, ?)", [user, descricao || '', url]);
  res.json({ success: true, message: "Imagem gerada!", url });
});

app.get("/imagens-geradas", (req, res) => {
  db.all("SELECT * FROM imagens_geradas ORDER BY data_geracao DESC LIMIT 20", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, imagens: rows });
  });
});

app.get("/painel-dono", (req, res) => {
  db.get("SELECT COUNT(*) AS total_utilizadores FROM utilizadores", [], (err, row1) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    db.get("SELECT COUNT(*) AS total_assinantes FROM assinantes WHERE dataExpiracao > datetime('now')", [], (err, row2) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      db.get("SELECT COUNT(*) AS total_conversas FROM history", [], (err, row3) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        db.get("SELECT COUNT(*) AS total_pagamentos FROM payments", [], (err, row4) => {
          if (err) return res.status(500).json({ success: false, error: err.message });
          res.json({ success: true, estatisticas: {
            utilizadores: row1.total_utilizadores || 0,
            assinantes_ativos: row2.total_assinantes || 0,
            conversas: row3.total_conversas || 0,
            pagamentos: row4.total_pagamentos || 0
          }});
        });
      });
    });
  });
});

app.post("/chat", async (req, res) => {
  const { prompt, user = "anonimo", modelo = "openrouter", idioma = "pt" } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: "Mensagem vazia." });
  const systemPrompt = idioma === 'en'
    ? `You are Vaga, a job assistant in Mozambique. Be friendly, helpful and use emojis. If the user is new, ask for their name and area of interest.`
    : `Você é a Vaga, uma assistente de empregos em Moçambique. Seja simpática, útil e use emojis. Se o utilizador for novo, pergunte o nome e a área de interesse.`;
  try {
    const resposta = await gerarRespostaIA(`${systemPrompt}\n\nUsuário: ${prompt}`, modelo);
    saveHistory(user, prompt, resposta);
    res.json({ success: true, reply: resposta });
  } catch (error) {
    console.error('Erro no chat:', error);
    res.status(500).json({ success: false, error: 'Erro ao processar a mensagem.' });
  }
});

app.post("/payment", async (req, res) => {
  const { user, amount, phone } = req.body;
  if (!user || !amount || !phone) return res.status(400).json({ success: false, message: "Dados incompletos." });
  const plano = PLANOS[amount.toString()];
  if (!plano) return res.status(400).json({ success: false, message: "Valor inválido." });
  const transactionId = "TX-" + Date.now();
  try {
    await ativarAssinante(user, amount, phone, transactionId);
    res.json({ success: true, message: `Assinatura ${plano.descricao} (${amount} MT) confirmada!`, transactionId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => { if (!fs.existsSync("uploads")) fs.mkdirSync("uploads"); cb(null, "uploads/"); },
  filename: (req, file, cb) => { const ext = file.originalname.split('.').pop(); cb(null, `foto_${Date.now()}.${ext}`); }
});
const upload = multer({ storage });

app.post("/upload-photo", upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "Nenhum ficheiro enviado." });
  res.json({ success: true, message: "Foto recebida!", file: req.file.filename, url: `/uploads/${req.file.filename}` });
});

app.post("/vagas", (req, res) => {
  const { cidade, area } = req.body;
  let sql = "SELECT * FROM vagas";
  const params = [], conditions = [];
  if (cidade) { conditions.push("cidade LIKE ?"); params.push(`%${cidade}%`); }
  if (area) { conditions.push("area LIKE ?"); params.push(`%${area}%`); }
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY data_publicacao DESC LIMIT 50";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, vagas: rows, total: rows.length });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor VagasBot a correr na porta ${PORT}`));
