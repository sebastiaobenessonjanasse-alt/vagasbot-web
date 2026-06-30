const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

// Base de dados SQLite
const db = new sqlite3.Database("./vagasbot.db");

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, user TEXT, message TEXT, reply TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, user TEXT, status TEXT, transactionId TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)");
});

// Guardar histórico
function saveHistory(user, message, reply) {
  db.run("INSERT INTO history (user, message, reply) VALUES (?, ?, ?)", [user, message, reply]);
}

// Endpoints de histórico e memória
app.get("/history", (req, res) => {
  db.all("SELECT * FROM history ORDER BY timestamp DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, history: rows });
  });
});

app.post("/memory", (req, res) => {
  const { key, value } = req.body;
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

// Pagamento (simulação)
app.post("/payment", (req, res) => {
  const { user, amount, phone } = req.body;
  const transactionId = "TX-" + Date.now();
  db.run("INSERT INTO payments (user, status, transactionId) VALUES (?, ?, ?)", [user, "confirmed", transactionId]);
  res.json({ success: true, message: "Pagamento confirmado automaticamente!", transactionId });
});

// Upload de fotos (gratuito)
const upload = multer({ dest: "uploads/" });
app.post("/upload-photo", upload.single("photo"), (req, res) => {
  res.json({ success: true, message: "Foto recebida com sucesso!", file: req.file.filename });
});

// Gerar PDF (pago)
app.post("/generate-pdf", (req, res) => {
  const { user, content } = req.body;
  db.get("SELECT * FROM payments WHERE user = ? AND status = 'confirmed'", [user], (err, row) => {
    if (row) {
      const filename = `pdf_${Date.now()}.txt`; // simulação
      fs.writeFileSync(filename, content);
      res.json({ success: true, message: "PDF gerado com sucesso!", file: filename });
    } else {
      res.status(403).json({ success: false, message: "Pagamento necessário para gerar PDF." });
    }
  });
});

// Gerar imagem (pago)
app.post("/generate-image", (req, res) => {
  const { user, description } = req.body;
  db.get("SELECT * FROM payments WHERE user = ? AND status = 'confirmed'", [user], (err, row) => {
    if (row) {
      res.json({ success: true, message: "Imagem gerada com sucesso!", description });
    } else {
      res.status(403).json({ success: false, message: "Pagamento necessário para gerar imagens." });
    }
  });
});

// Chat
app.post("/chat", (req, res) => {
  const { prompt, user } = req.body;
  const reply = "Aqui entraria a resposta da IA (fallback já configurado)";
  saveHistory(user || "Sebastião", prompt, reply);
  res.json({ success: true, reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor VagasBot a correr na porta ${PORT}`);
});
(Já)
