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
app.use(express.json({ limit: '1mb' }));

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'nyra_store.json');

const MAX_ITEMS = 1000;
const MAX_CONVERSATIONS = 300;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createEmptyStore() {
  return {
    version: 'v5-suggestions',
    items: [],
    conversations: [],
    updated_at: null,
  };
}

function readStore() {
  try {
    ensureDir(DATA_DIR);

    if (!fs.existsSync(STORE_FILE)) {
      const empty = createEmptyStore();
      fs.writeFileSync(STORE_FILE, JSON.stringify(empty, null, 2), 'utf8');
      return empty;
    }

    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (error) {
    console.error('❌ readStore error:', error.message);
    return createEmptyStore();
  }
}

function writeStore(store) {
  try {
    ensureDir(DATA_DIR);
    store.updated_at = new Date().toISOString();
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('❌ writeStore error:', error.message);
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function includesAny(text, words) {
  const lower = text.toLowerCase();
  return words.some(word => lower.includes(word));
}

function analyzeMessage(message) {
  const text = normalizeText(message);
  const lower = text.toLowerCase();

  const analysis = {
    type: 'note',
    bucket: 'inbox',
    is_task: false,
    is_idea: false,
    is_emotion: false,
    urgency: 'normal',
    priority_score: 2,
    due_hint: null,
    tags: [],
  };

  if (includesAny(lower, ['je dois', 'il faut', 'pense à'])) {
    analysis.type = 'task';
    analysis.bucket = 'tasks';
    analysis.is_task = true;
  }

  if (includesAny(lower, ['idée', "j'ai une idée"])) {
    analysis.is_idea = true;
    analysis.type = analysis.is_task ? 'mixed' : 'idea';
    analysis.bucket = analysis.is_task ? 'inbox' : 'ideas';
  }

  if (includesAny(lower, ['je me sens', 'triste', 'stress', 'fatigué'])) {
    analysis.is_emotion = true;
    analysis.type =
      analysis.is_task || analysis.is_idea ? 'mixed' : 'emotion';
    analysis.bucket =
      analysis.is_task || analysis.is_idea ? 'inbox' : 'journal';
  }

  if (includesAny(lower, ['urgent', 'vite', 'demain', 'maintenant'])) {
    analysis.urgency = 'high';
  }

  return analysis;
}

// 🔥 NOUVEAU
function buildSuggestions(analysis) {
  const suggestions = [];

  if (analysis.is_task) {
    suggestions.push('Ajouter à aujourd’hui');
    suggestions.push('Créer un rappel');
    suggestions.push('Planifier maintenant');
  }

  if (analysis.is_idea) {
    suggestions.push('Classer dans idées');
    suggestions.push('Transformer en tâche');
  }

  if (analysis.is_emotion) {
    suggestions.push('Prendre 5 min pour toi');
    suggestions.push('Respirer');
  }

  if (analysis.type === 'mixed') {
    suggestions.push('Trier mentalement');
  }

  if (analysis.urgency === 'high') {
    suggestions.unshift('Traiter maintenant');
  }

  return suggestions.slice(0, 4);
}

function createStoredItem({ userId, message, analysis }) {
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    type: analysis.type,
    bucket: analysis.bucket,
    content: message,
    urgency: analysis.urgency,
    status: analysis.is_task ? 'todo' : 'captured',
    created_at: nowIso(),
  };
}

function saveCapture({ userId, message, reply, analysis }) {
  const store = readStore();

  const item = createStoredItem({
    userId,
    message,
    analysis,
  });

  store.items.push(item);

  store.conversations.push({
    id: crypto.randomUUID(),
    user_id: userId,
    user_message: message,
    nyra_reply: reply,
    created_at: nowIso(),
  });

  store.items = store.items.slice(-MAX_ITEMS);
  store.conversations = store.conversations.slice(-MAX_CONVERSATIONS);

  writeStore(store);

  return item;
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    app: 'Nyra backend',
    version: 'v5-suggestions',
  });
});

app.post('/chat', async (req, res) => {
  const userMessage = normalizeText(req.body?.message || '');
  const userId = normalizeText(req.body?.userId || 'local-user');

  if (!userMessage) {
    return res.status(400).json({
      ok: false,
      error: 'Message manquant',
    });
  }

  try {
    const analysis = analyzeMessage(userMessage);

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.55,
      max_tokens: 150,
      messages: [
        {
          role: 'system',
          content:
            'Tu es Nyra, un cerveau externe. Réponds simplement et clairement.',
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const reply =
      normalizeText(completion.choices?.[0]?.message?.content) ||
      'C’est capté.';

    const storedItem = saveCapture({
      userId,
      message: userMessage,
      reply,
      analysis,
    });

    const suggestions = buildSuggestions(analysis);

    res.json({
      ok: true,
      reply,
      analysis,
      suggestions,
      stored_item: storedItem,
    });
  } catch (error) {
    console.error('❌ /chat error:', error.message);

    res.status(500).json({
      ok: false,
      error: 'Erreur serveur',
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Nyra backend V5 suggestions lancé`);
});