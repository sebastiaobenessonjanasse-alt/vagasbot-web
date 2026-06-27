const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ============================================================
// BASE DE DADOS SQLITE
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
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================
function saveHistory(user, message, reply) {
  db.run("INSERT INTO history (user, message, reply) VALUES (?, ?, ?)", [user, message, reply]);
}

function hasPaymentConfirmed(user) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM payments WHERE user = ? AND status = 'confirmed' ORDER BY timestamp DESC LIMIT 1", [user], (err, row) => {
      if (err) return reject(err);
      resolve(!!row);
    });
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

// ============================================================
// FUNÇÃO PARA CHAMAR IA COM FALLBACK
// ============================================================
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

app.post("/payment", (req, res) => {
  const { user, amount, phone } = req.body;
  if (!user || !amount || !phone) {
    return res.status(400).json({ success: false, message: "Dados incompletos." });
  }
  const transactionId = "TX-" + Date.now();
  db.run("INSERT INTO payments (user, status, transactionId) VALUES (?, ?, ?)", [user, "confirmed", transactionId], (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({
      success: true,
      message: `Pagamento de ${amount} MT confirmado! (número: ${phone})`,
      transactionId
    });
  });
});

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

app.post("/generate-pdf", async (req, res) => {
  const { user, content } = req.body;
  if (!user || !content) return res.status(400).json({ success: false, message: "Dados incompletos." });
  try {
    const hasPayment = await hasPaymentConfirmed(user);
    if (!hasPayment) {
      return res.status(403).json({ success: false, message: "Pagamento necessário para gerar PDF." });
    }
    const filename = `pdf_${Date.now()}.txt`;
    fs.writeFileSync(filename, content);
    res.json({ success: true, message: "PDF gerado com sucesso!", file: filename });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/generate-image", async (req, res) => {
  const { user, description } = req.body;
  if (!user || !description) return res.status(400).json({ success: false, message: "Dados incompletos." });
  try {
    const hasPayment = await hasPaymentConfirmed(user);
    if (!hasPayment) {
      return res.status(403).json({ success: false, message: "Pagamento necessário para gerar imagens." });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor VagasBot a correr na porta ${PORT}`);
});
