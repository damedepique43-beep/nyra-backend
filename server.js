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

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'Ka6yOFdNGhzFuCVW6VyO';

const DATA_DIR = path.join(__dirname, 'data');
const AUDIO_CACHE_DIR = path.join(__dirname, 'audio_cache');

const MEMORY_RAW_PATH = path.join(DATA_DIR, 'memory.json');
const MEMORY_SUMMARY_PATH = path.join(DATA_DIR, 'memory_summary.json');
const MEMORY_STRUCTURED_PATH = path.join(DATA_DIR, 'memory_structured.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(AUDIO_CACHE_DIR)) fs.mkdirSync(AUDIO_CACHE_DIR);

if (!fs.existsSync(MEMORY_RAW_PATH)) fs.writeFileSync(MEMORY_RAW_PATH, JSON.stringify({ messages: [] }, null, 2));
if (!fs.existsSync(MEMORY_SUMMARY_PATH)) fs.writeFileSync(MEMORY_SUMMARY_PATH, JSON.stringify({ summary: '' }, null, 2));
if (!fs.existsSync(MEMORY_STRUCTURED_PATH)) {
  fs.writeFileSync(MEMORY_STRUCTURED_PATH, JSON.stringify({
    identity: {},
    preferences: [],
    projects: [],
    constraints: [],
    emotional_patterns: [],
    relationships: [],
    active_contexts: [],
    decisions: [],
    insights: [],
    conversation_style: {},
    triggers: [],
    needs: [],
    regulation_strategies: [],
    risk_patterns: [],
    support_patterns: []
  }, null, 2));
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function addMessage(role, content) {
  const memory = readJSON(MEMORY_RAW_PATH);
  memory.messages.push({ role, content, ts: Date.now() });
  if (memory.messages.length > 40) memory.messages.shift();
  writeJSON(MEMORY_RAW_PATH, memory);
}

function normalizeForSpeech(text) {
  return text.replace(/\n+/g, '\n').trim();
}

function buildPrompt(summary, structured) {
  return `
Tu es Nyra, une IA personnelle intelligente, naturelle, profonde.

Résumé mémoire :
${summary}

Mémoire structurée :
${JSON.stringify(structured, null, 2)}

Comportement :
- naturel
- humain
- subtil mais ferme
- jamais robotique
- adapte ton ton

Réponds comme Nyra.
`;
}

function normalizeString(str) {
  return str.toLowerCase().trim();
}

function mergeMemory(existing, update) {
  const keys = ["emotional_patterns", "triggers", "needs", "insights", "active_contexts", "decisions"];

  keys.forEach(key => {
    if (!existing[key]) existing[key] = [];

    if (Array.isArray(update[key])) {
      update[key].forEach(item => {
        const exists = existing[key].some(e => normalizeString(e) === normalizeString(item));
        if (!exists) existing[key].push(item);
      });
    }
  });

  return existing;
}

async function extractMemoryUpdate(message, currentMemory) {
  try {
    const prompt = `
Tu es un système d’analyse mémoire avancé.

OBJECTIF :
Transformer un message en PATTERNS GÉNÉRALISÉS.

NE PAS rester littéral.

Exemples :
"il répond pas" → "silence relationnel"
"je veux checker" → "comportement de surveillance"

Réponds uniquement en JSON :

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

    return JSON.parse(res.output_text.trim());

  } catch (err) {
    console.log("memory error", err.message);
    return {};
  }
}

app.get('/memory/structured', (req, res) => {
  res.json(readJSON(MEMORY_STRUCTURED_PATH));
});

app.post('/chat', async (req, res) => {
  try {
    const message = req.body.message;

    addMessage('user', message);

    let structured = readJSON(MEMORY_STRUCTURED_PATH);

    const update = await extractMemoryUpdate(message, structured);

    if (Object.keys(update).length > 0) {
      structured = mergeMemory(structured, update);
      writeJSON(MEMORY_STRUCTURED_PATH, structured);
    }

    const raw = readJSON(MEMORY_RAW_PATH);
    const summary = readJSON(MEMORY_SUMMARY_PATH).summary;

    const history = raw.messages.map(m => `${m.role}: ${m.content}`).join('\n');

    const prompt = buildPrompt(summary, structured) + `\n\nConversation:\n${history}`;

    const ai = await openai.responses.create({
      model: "gpt-4.1",
      input: prompt
    });

    const reply = ai.output_text;

    addMessage('assistant', reply);

    res.json({
      reply,
      speech_text: normalizeForSpeech(reply),
      memory_update_applied: Object.keys(update).length > 0
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "error" });
  }
});

app.listen(PORT, () => {
  console.log("Nyra running on port", PORT);
});