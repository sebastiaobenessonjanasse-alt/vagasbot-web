const express = require("express");
const cors = require("cors");
const axios = require("axios");
const app = express();
app.use(express.json());
app.use(cors());

const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  DONO_NOME: "Sebastião Benesson Janasse",
  EMOLA_NUMERO: "879306034",
  PRECO_MENSAL: 150,
  PRECO_SEMANAL: 50,
};

const sessoes = {};

const DICAS = [
  "💡 Atualizar o CV aumenta em 70% as chances de seres chamado para entrevista! Quer mais dicas destas todos os dias? Assina o VagasBot 📄",
  "💡 A maioria das vagas em Moçambique são preenchidas em 48h! Sê o primeiro a saber — assina o VagasBot e recebe vagas em tempo real 🏃",
  "💡 Ter certificados de cursos gratuitos pode aumentar o teu salário em até 40%! Vê os cursos disponíveis assinando o VagasBot 🎓",
  "💡 A melhor hora para enviar candidaturas é entre as 8h e as 10h da manhã! Recebe vagas frescas todas as manhãs assinando o VagasBot ⏰",
  "💡 Uma carta de apresentação bem escrita triplica as tuas chances! O VagasBot ajuda-te a escrevê-la perfeita ✉️",
  "💡 Maputo, Beira e Nampula têm mais vagas disponíveis. O VagasBot filtra por cidade — assina e recebe as vagas certas para ti! 🏙️",
];

const CONVENCIMENTO = [
  "🔥 Hoje temos +20 vagas novas em Moçambique! Não percas — assina por apenas 50 MT (semanal)\n📲 e-Mola: 879306034",
  "⚠️ Uma vaga perto de ti pode expirar hoje! Os primeiros a candidatar têm mais chances. Assina agora: 150 MT/mês\n📲 e-Mola: 879306034",
  "🎯 Já ajudámos +100 pessoas a encontrar emprego em Moçambique! Serás o próximo? Começa por 50 MT\n📲 e-Mola: 879306034",
];

function getDica() {
  return DICAS[Math.floor(Math.random() * DICAS.length)];
}
function getConvencimento() {
  return CONVENCIMENTO[Math.floor(Math.random() * CONVENCIMENTO.length)];
}

function sessaoPaga(sessionId) {
  const s = sessoes[sessionId];
  if (!s || !s.pago) return false;
  if (new Date() > new Date(s.validade)) {
    s.pago = false;
    return false;
  }
  return true;
}

function registarPagamento(sessionId, plano) {
  const dias = plano === "mensal" ? 30 : 7;
  const validade = new Date();
  validade.setDate(validade.getDate() + dias);
  if (!sessoes[sessionId]) sessoes[sessionId] = { historico: [] };
  sessoes[sessionId].pago = true;
  sessoes[sessionId].validade = validade;
}

async function chamarGemini(prompt) {
  try {
    const r = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: 20000 }
    );
    return r.data.candidates[0].content.parts[0].text;
  } catch (e) {
    console.error("Erro Gemini:", e.response?.data || e.message);
    return null;
  }
}

async function buscarVagas(tipo) {
  const r = await chamarGemini(
    `Lista 5 vagas de emprego de "${tipo}" disponíveis em Moçambique. Para cada uma: nome da vaga, empresa, cidade, requisitos básicos, como candidatar. Usa emojis. Responde em Português de Moçambique, de forma direta.`
  );
  return r || "⚠️ Não consegui buscar vagas agora. Tenta novamente em instantes!";
}

async function buscarCursos(area) {
  const r = await chamarGemini(
    `Lista 5 cursos gratuitos ou de baixo custo na área de "${area}" disponíveis em Moçambique. Para cada um: nome, instituição, duração, como inscrever. Usa emojis. Responde em Português de Moçambique.`
  );
  return r || "⚠️ Não consegui buscar cursos agora. Tenta novamente em instantes!";
}

async function respostaIA(mensagem, historico, isPago) {
  const prompt = `És a "Vaga", assistente de emprego e cursos do VagasBot Moçambique. Respondes como uma pessoa real, simpática e profissional, nunca revelando que és uma IA.

Regras:
- Responde em Português de Moçambique, frases curtas e diretas.
- Se perguntarem quem te criou, diz: "Fui criada por ${CONFIG.DONO_NOME}".
- Se a pessoa ainda não pagou, sê simpática mas tenta convencê-la a assinar: Semanal ${CONFIG.PRECO_SEMANAL} MT ou Mensal ${CONFIG.PRECO_MENSAL} MT, via e-Mola ${CONFIG.EMOLA_NUMERO}.
- Dá sempre uma dica útil relacionada com emprego quando fizer sentido.
- Nunca inventes vagas específicas nesta resposta livre — sugere usar os botões/comandos para buscar vagas reais.

Estado do cliente: ${isPago ? "JÁ PAGOU - acesso completo" : "AINDA NÃO PAGOU"}

Histórico recente:
${historico}

Mensagem do cliente: ${mensagem}`;

  const r = await chamarGemini(prompt);
  return r || "Olá! Estou aqui para ajudar com vagas e cursos em Moçambique 😊 Responde *VER* para um exemplo grátis!";
}

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: "sessionId e message são obrigatórios" });
    }

    if (!sessoes[sessionId]) {
      sessoes[sessionId] = { pago: false, validade: null, historico: [] };
    }
    const sessao = sessoes[sessionId];
    const msg = message.toLowerCase().trim();
    const pago = sessaoPaga(sessionId);

    sessao.historico.push(`Cliente: ${message}`);
    const historicoTexto = sessao.historico.slice(-8).join("\n");

    let respostas = [];

    if (msg.includes("ver") && !pago) {
      const vaga = await buscarVagas("geral, exemplo");
      respostas.push(`🎁 *Exemplo grátis:*\n\n${vaga.substring(0, 500)}...\n\n🔐 Esta é só uma amostra! Assina para ver todas as vagas atualizadas.\n💰 ${CONFIG.PRECO_SEMANAL} MT semanal | ${CONFIG.PRECO_MENSAL} MT mensal\n📲 e-Mola: ${CONFIG.EMOLA_NUMERO}`);
      respostas.push(getDica());
    }
    else if (msg.includes("dica")) {
      respostas.push(getDica());
      if (!pago) respostas.push(getConvencimento());
    }
    else if (msg.includes("paguei") || msg.includes("comprovativo") || msg.includes("transferi")) {
      respostas.push(`✅ Obrigado! O teu comprovativo foi registado.\n\n⏳ A tua conta será ativada em breve (normalmente até 30 min). Qualquer dúvida, contacta ${CONFIG.EMOLA_NUMERO}.`);
    }
    else if (pago && (msg === "1" || msg.includes("vaga"))) {
      const vagas = await buscarVagas(msg.includes("vaga") && msg !== "1" ? message : "geral");
      respostas.push(`💼 *Vagas encontradas:*\n\n${vagas}`);
    }
    else if (pago && (msg === "2" || msg.includes("curso"))) {
      const cursos = await buscarCursos(msg.includes("curso") && msg !== "2" ? message : "geral");
      respostas.push(`📚 *Cursos encontrados:*\n\n${cursos}`);
    }
    else {
      const resposta = await respostaIA(message, historicoTexto, pago);
      respostas.push(resposta);
    }

    sessao.historico.push(`Vaga: ${respostas.join(" | ")}`);

    res.json({ respostas, pago });
  } catch (error) {
    console.error("Erro /api/chat:", error.message);
    res.status(500).json({ error: "Erro interno", respostas: ["⚠️ Algo correu mal. Tenta novamente!"] });
  }
});

app.post("/api/ativar", async (req, res) => {
  try {
    const { sessionId, plano, senhaDono } = req.body;
    if (senhaDono !== (process.env.SENHA_DONO || "879306034")) {
      return res.status(403).json({ error: "Senha incorreta" });
    }
    registarPagamento(sessionId, plano || "mensal");
    res.json({ ok: true, mensagem: `Sessão ${sessionId} ativada (${plano || "mensal"})` });
  } catch (e) {
    res.status(500).json({ error: "Erro ao ativar" });
  }
});

app.get("/api/stats", (req, res) => {
  const total = Object.keys(sessoes).length;
  const pagos = Object.values(sessoes).filter((s) => s.pago).length;
  res.json({ total, pagos, receitaEstimada: pagos * CONFIG.PRECO_MENSAL });
});

app.get("/", (req, res) => {
  res.send(`
    <h1>✅ VagasBot API Online</h1>
    <p>👑 Dono: ${CONFIG.DONO_NOME}</p>
    <p>📲 e-Mola: ${CONFIG.EMOLA_NUMERO}</p>
    <p>Endpoint do chat: POST /api/chat</p>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ VagasBot Web API iniciado na porta ${PORT}`);
  console.log(`👑 Dono: ${CONFIG.DONO_NOME}`);
});
