require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_PATH = path.join(DATA_DIR, 'memory_structured.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

if (!fs.existsSync(MEMORY_PATH)) {
  fs.writeFileSync(MEMORY_PATH, JSON.stringify({
    emotional_patterns: [],
    triggers: [],
    needs: [],
    insights: [],
    active_contexts: [],
    decisions: []
  }, null, 2));
}

function readMemory() {
  return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8'));
}

function writeMemory(data) {
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(data, null, 2));
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
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
Tu es un système d’analyse mémoire.

Objectif :
Extraire des patterns psychologiques utiles et généralisés.

IMPORTANT :
- Ne reste pas littéral
- Utilise des concepts courts
- Max 2 éléments par catégorie

Exemples :
"il répond pas" → "silence relationnel"
"je check" → "comportement de surveillance"

Réponds UNIQUEMENT en JSON valide.
`
        },
        {
          role: "user",
          content: `
Message :
${message}

Format attendu :
{
  "emotional_patterns": [],
  "triggers": [],
  "needs": [],
  "insights": [],
  "active_contexts": [],
  "decisions": []
}
`
        }
      ]
    });

    let text = response.choices[0].message.content;

    // Nettoyage si l'IA ajoute du texte autour
    const match = text.match(/\{[\s\S]*\}/);
    if (match) text = match[0];

    return JSON.parse(text);

  } catch (err) {
    console.log("extract error", err.message);
    return {};
  }
}

app.get('/memory/structured', (req, res) => {
  res.json(readMemory());
});

app.post('/chat', async (req, res) => {
  try {
    const message = req.body.message;

    let memory = readMemory();

    const update = await extractMemory(message);

    if (Object.keys(update).length > 0) {
      memory = mergeMemory(memory, update);
      writeMemory(memory);
    }

    const ai = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Tu es Nyra, une IA naturelle, subtile, humaine, profonde."
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    res.json({
      reply: ai.choices[0].message.content,
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