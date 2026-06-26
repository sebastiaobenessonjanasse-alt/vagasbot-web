const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose(); // ✅ CORREÇÃO AQUI
const multer = require("multer");
const fs = require("fs");

// ============================================================
// CONFIGURAÇÃO DO EXPRESS
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ============================================================
// CONFIGURAÇÃO DO SQLITE
// ============================================================
const db = new sqlite3.Database("./vagasbot.db");

db.serialize(() => {
  // Tabela de histórico
  db.run(`CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    message TEXT,
    reply TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tabela de memória (chave-valor)
  db.run(`CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    value TEXT
  )`);

  // Tabela de pagamentos
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
// ENDPOINTS
// ============================================================

// ---------- HISTÓRICO ----------
app.get("/history", (req, res) => {
  db.all("SELECT * FROM history ORDER BY timestamp DESC LIMIT 50", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, history: rows });
  });
});

// ---------- MEMÓRIA ----------
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

// ---------- CHAT (com fallback) ----------
app.post("/chat", (req, res) => {
  const { prompt, user = "Sebastião" } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: "Mensagem vazia." });

  const reply = `🤖 Recebi a tua mensagem: "${prompt}". Em breve teremos respostas com IA integrada!`;

  saveHistory(user, prompt, reply);
  res.json({ success: true, reply });
});

// ---------- PAGAMENTO (simulação) ----------
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
      message: `Pagamento de ${amount} MT confirmado automaticamente! (número: ${phone})`,
      transactionId
    });
  });
});

// ---------- UPLOAD DE FOTOS (GRÁTIS) ----------
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

// ---------- GERAR IMAGEM (PAGO) ----------
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

// ---------- ROTA RAIZ (para evitar "Not Found") ----------
app.get('/', (req, res) => {
  res.send('🚀 VagasBot API está online!');
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor VagasBot a correr na porta ${PORT}`);
});
