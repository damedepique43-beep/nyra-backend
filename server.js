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

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createEmptyStore() {
  return {
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
    is_task: false,
    is_idea: false,
    is_emotion: false,
    is_project: false,
    urgency: 'normal',
    suggested_bucket: 'inbox',
    tags: [],
  };

  if (
    includesAny(lower, [
      'je dois',
      'il faut',
      'pense à',
      'penser à',
      'rappelle',
      'à faire',
      'a faire',
      'ne pas oublier',
    ])
  ) {
    analysis.type = 'task';
    analysis.is_task = true;
    analysis.suggested_bucket = 'tasks';
    analysis.tags.push('tâche');
  }

  if (
    includesAny(lower, [
      'idée',
      'j’ai une idée',
      "j'ai une idée",
      'concept',
      'ça pourrait',
      'on pourrait',
    ])
  ) {
    analysis.type = analysis.is_task ? 'mixed' : 'idea';
    analysis.is_idea = true;
    analysis.suggested_bucket = analysis.is_task ? 'inbox' : 'ideas';
    analysis.tags.push('idée');
  }

  if (
    includesAny(lower, [
      'je me sens',
      'angoisse',
      'stress',
      'triste',
      'énervée',
      'énervé',
      'fatiguée',
      'fatigué',
      'peur',
      'mal',
    ])
  ) {
    analysis.type =
      analysis.is_task || analysis.is_idea ? 'mixed' : 'emotion';
    analysis.is_emotion = true;
    analysis.suggested_bucket =
      analysis.is_task || analysis.is_idea ? 'inbox' : 'journal';
    analysis.tags.push('émotion');
  }

  if (
    includesAny(lower, [
      'nyra',
      'projet',
      'app',
      'application',
      'backend',
      'code',
      'roadmap',
    ])
  ) {
    analysis.is_project = true;
    analysis.tags.push('projet');

    if (!analysis.is_task && !analysis.is_idea && !analysis.is_emotion) {
      analysis.type = 'project_note';
      analysis.suggested_bucket = 'projects';
    }
  }

  if (
    includesAny(lower, [
      'urgent',
      'vite',
      'rapidement',
      'aujourd’hui',
      "aujourd'hui",
      'maintenant',
      'ce soir',
      'demain',
    ])
  ) {
    analysis.urgency = 'high';
    analysis.tags.push('urgent');
  }

  if (analysis.tags.length === 0) {
    analysis.tags.push('note');
  }

  return analysis;
}

function createStoredItem({ userId, message, analysis }) {
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    type: analysis.type,
    bucket: analysis.suggested_bucket,
    content: message,
    urgency: analysis.urgency,
    tags: analysis.tags,
    status: analysis.is_task ? 'todo' : 'captured',
    created_at: nowIso(),
    updated_at: nowIso(),
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
    analysis,
    created_at: nowIso(),
  });

  store.items = store.items.slice(-500);
  store.conversations = store.conversations.slice(-200);
  store.updated_at = nowIso();

  writeStore(store);

  return item;
}

function getStoreSummary(userId) {
  const store = readStore();

  const userItems = store.items.filter(item => item.user_id === userId);

  return {
    total_items: userItems.length,
    tasks: userItems.filter(item => item.bucket === 'tasks').length,
    ideas: userItems.filter(item => item.bucket === 'ideas').length,
    journal: userItems.filter(item => item.bucket === 'journal').length,
    projects: userItems.filter(item => item.bucket === 'projects').length,
    inbox: userItems.filter(item => item.bucket === 'inbox').length,
  };
}

function buildSystemPrompt(analysis, memorySummary) {
  return `
Tu es Nyra, un cerveau externe intelligent pour personnes TDAH.

Ta mission :
- accueillir ce que l’utilisateur vide de sa tête
- comprendre si c’est une tâche, une idée, une émotion, un projet ou un mélange
- répondre vite, clairement, sans surcharger
- aider à organiser sans demander trop d’effort mental

Analyse locale détectée :
${JSON.stringify(analysis)}

Résumé mémoire locale :
${JSON.stringify(memorySummary)}

Règles de réponse :
- réponds en français naturel
- sois directe, humaine, chaleureuse
- maximum 120 mots
- pas de long pavé
- si c’est une tâche : reformule clairement l’action
- si c’est une idée : dis que l’idée est capturée et propose où la ranger
- si c’est une émotion : valide brièvement et aide à poser le poids
- si c’est mixte : trie mentalement pour l’utilisateur
- tu peux dire que c’est capturé dans Nyra
- ne parle pas de fichier JSON
- ne parle pas de tes mécanismes internes
`.trim();
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    app: 'Nyra backend',
    version: 'fast-v3-local-memory',
  });
});

app.get('/store', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const items = store.items.filter(item => item.user_id === userId);

  res.json({
    ok: true,
    userId,
    summary: getStoreSummary(userId),
    items,
  });
});

app.get('/store/tasks', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const tasks = store.items.filter(
    item => item.user_id === userId && item.bucket === 'tasks'
  );

  res.json({
    ok: true,
    userId,
    count: tasks.length,
    tasks,
  });
});

app.get('/store/ideas', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const ideas = store.items.filter(
    item => item.user_id === userId && item.bucket === 'ideas'
  );

  res.json({
    ok: true,
    userId,
    count: ideas.length,
    ideas,
  });
});

app.post('/store/reset', (req, res) => {
  writeStore(createEmptyStore());

  res.json({
    ok: true,
    message: 'Mémoire locale Nyra réinitialisée',
  });
});

app.post('/chat', async (req, res) => {
  const startedAt = Date.now();

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
    const memorySummary = getStoreSummary(userId);

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.55,
      max_tokens: 180,
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(analysis, memorySummary),
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const reply =
      normalizeText(completion.choices?.[0]?.message?.content) ||
      'Je l’ai capté. Je le range dans Nyra.';

    const storedItem = saveCapture({
      userId,
      message: userMessage,
      reply,
      analysis,
    });

    res.json({
      ok: true,
      reply,
      analysis,
      stored_item: storedItem,
      memory_summary: getStoreSummary(userId),
      perf: {
        total_ms: Date.now() - startedAt,
      },
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
  console.log(`🚀 Nyra backend FAST V3 local memory lancé sur le port ${PORT}`);
});