require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_STRUCTURED_PATH = path.join(DATA_DIR, 'memory_structured.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

if (!fs.existsSync(MEMORY_STRUCTURED_PATH)) {
  fs.writeFileSync(MEMORY_STRUCTURED_PATH, JSON.stringify({
    emotional_patterns: [],
    triggers: [],
    needs: [],
    insights: [],
    active_contexts: [],
    decisions: []
  }, null, 2));
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch {}
  }
  return {};
}

function normalize(str) {
  return str.toLowerCase().trim();
}

function mergeMemory(existing, update) {
  const keys = ["emotional_patterns", "triggers", "needs", "insights", "active_contexts", "decisions"];

  keys.forEach(key => {
    if (!existing[key]) existing[key] = [];

    if (Array.isArray(update[key])) {
      update[key].forEach(item => {
        if (!existing[key].some(e => normalize(e) === normalize(item))) {
          existing[key].push(item);
        }
      });
    }
  });

  return existing;
}

async function extractMemory(message) {
  const prompt = `
Analyse ce message et transforme-le en patterns psychologiques GÉNÉRAUX.

IMPORTANT :
- ne reste pas littéral
- concepts courts uniquement
- JSON uniquement

Format :
{
  "emotional_patterns": [],
  "triggers": [],
  "needs": [],
  "insights": [],
  "active_contexts": [],
  "decisions": []
}

Message :
${message}
`;

  const res = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: prompt
  });

  return safeParseJSON(res.output_text);
}

app.get('/memory/structured', (req, res) => {
  res.json(readJSON(MEMORY_STRUCTURED_PATH));
});

app.post('/chat', async (req, res) => {
  try {
    const message = req.body.message;

    let memory = readJSON(MEMORY_STRUCTURED_PATH);

    const update = await extractMemory(message);

    if (Object.keys(update).length > 0) {
      memory = mergeMemory(memory, update);
      writeJSON(MEMORY_STRUCTURED_PATH, memory);
    }

    const ai = await openai.responses.create({
      model: "gpt-4.1",
      input: message
    });

    res.json({
      reply: ai.output_text,
      memory_update_applied: Object.keys(update).length > 0
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "error" });
  }
});

app.listen(PORT, () => {
  console.log("server running");
});