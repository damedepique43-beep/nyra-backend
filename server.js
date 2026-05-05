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
    version: 'v4-intelligent-memory',
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

    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));

    return {
      ...createEmptyStore(),
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      conversations: Array.isArray(parsed.conversations)
        ? parsed.conversations
        : [],
    };
  } catch (error) {
    console.error('❌ readStore error:', error.message);
    return createEmptyStore();
  }
}

function writeStore(store) {
  try {
    ensureDir(DATA_DIR);

    const safeStore = {
      ...store,
      version: 'v4-intelligent-memory',
      updated_at: nowIso(),
    };

    fs.writeFileSync(STORE_FILE, JSON.stringify(safeStore, null, 2), 'utf8');
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
  const lower = normalizeText(text).toLowerCase();
  return words.some(word => lower.includes(word));
}

function uniqueArray(values) {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function makeTitle(message) {
  const clean = normalizeText(message);

  if (!clean) return 'Capture Nyra';

  const withoutIntro = clean
    .replace(/^je dois\s+/i, '')
    .replace(/^il faut que je\s+/i, '')
    .replace(/^il faut\s+/i, '')
    .replace(/^pense à\s+/i, '')
    .replace(/^penser à\s+/i, '')
    .replace(/^j'ai une idée\s*:?\s*/i, '')
    .replace(/^j’ai une idée\s*:?\s*/i, '');

  const title = withoutIntro.slice(0, 70);

  return title.length < withoutIntro.length ? `${title}…` : title;
}

function detectDueHint(lower) {
  if (includesAny(lower, ["aujourd'hui", 'aujourd’hui', 'ce soir', 'maintenant'])) {
    return 'today';
  }

  if (includesAny(lower, ['demain'])) {
    return 'tomorrow';
  }

  if (includesAny(lower, ['cette semaine', 'dans la semaine'])) {
    return 'this_week';
  }

  if (includesAny(lower, ['ce week-end', 'weekend', 'week-end'])) {
    return 'weekend';
  }

  if (includesAny(lower, ['plus tard', 'un jour', 'quand j’aurai le temps', "quand j'aurai le temps"])) {
    return 'later';
  }

  return null;
}

function detectMood(lower) {
  if (
    includesAny(lower, [
      'angoisse',
      'stress',
      'stressée',
      'stressé',
      'peur',
      'panique',
      'inquiète',
      'inquiet',
    ])
  ) {
    return 'anxious';
  }

  if (
    includesAny(lower, [
      'triste',
      'pleure',
      'pleurer',
      'déprimée',
      'déprimé',
      'vide',
      'mal au coeur',
      'mal au cœur',
    ])
  ) {
    return 'sad';
  }

  if (
    includesAny(lower, [
      'énervée',
      'énervé',
      'agacée',
      'agacé',
      'colère',
      'saoule',
      'soule',
      'marre',
    ])
  ) {
    return 'angry';
  }

  if (
    includesAny(lower, [
      'motivée',
      'motivé',
      'contente',
      'content',
      'fière',
      'fier',
      'heureuse',
      'heureux',
      'excité',
      'excitée',
    ])
  ) {
    return 'positive';
  }

  if (
    includesAny(lower, [
      'fatiguée',
      'fatigué',
      'épuisée',
      'épuisé',
      'crevée',
      'crevé',
    ])
  ) {
    return 'tired';
  }

  return null;
}

function detectProject(lower) {
  if (includesAny(lower, ['nyra', 'ok nyra', 'backend', 'mobile', 'react native'])) {
    return 'nyra';
  }

  if (includesAny(lower, ['novacall', 'voiceflow', 'make', 'airtable', 'clinique'])) {
    return 'novacall';
  }

  if (includesAny(lower, ['tiktok', 'payhip', 'dame de pique', 'brumeardente', 'brume ardente'])) {
    return 'business_content';
  }

  if (includesAny(lower, ['clément', 'clem'])) {
    return 'relationnel';
  }

  return null;
}

function detectTags(lower, analysis) {
  const tags = [];

  if (analysis.is_task) tags.push('tâche');
  if (analysis.is_idea) tags.push('idée');
  if (analysis.is_emotion) tags.push('émotion');
  if (analysis.is_project) tags.push('projet');
  if (analysis.urgency === 'high') tags.push('urgent');
  if (analysis.project) tags.push(analysis.project);
  if (analysis.due_hint) tags.push(analysis.due_hint);
  if (analysis.mood) tags.push(analysis.mood);

  if (includesAny(lower, ['argent', 'revenu', 'payer', 'budget', 'financier'])) {
    tags.push('argent');
  }

  if (includesAny(lower, ['santé', 'médecin', 'docteur', 'rdv médical', 'douleur'])) {
    tags.push('santé');
  }

  if (includesAny(lower, ['enfant', 'enfants', 'fille', 'fils'])) {
    tags.push('famille');
  }

  if (tags.length === 0) tags.push('note');

  return uniqueArray(tags);
}

function analyzeMessage(message) {
  const text = normalizeText(message);
  const lower = text.toLowerCase();

  const analysis = {
    type: 'note',
    bucket: 'inbox',
    title: makeTitle(text),
    is_task: false,
    is_idea: false,
    is_emotion: false,
    is_project: false,
    urgency: 'normal',
    priority_score: 2,
    due_hint: detectDueHint(lower),
    mood: detectMood(lower),
    project: detectProject(lower),
    tags: [],
    next_action: null,
    ai_useful_response_mode: 'capture',
  };

  if (
    includesAny(lower, [
      'je dois',
      'il faut',
      'pense à',
      'penser à',
      'rappelle',
      'rappelle-moi',
      'à faire',
      'a faire',
      'ne pas oublier',
      'j’ai besoin de faire',
      "j'ai besoin de faire",
      'je dois appeler',
      'je dois envoyer',
      'je dois finir',
      'je dois acheter',
      'je dois prendre',
    ])
  ) {
    analysis.type = 'task';
    analysis.bucket = 'tasks';
    analysis.is_task = true;
    analysis.next_action = text;
    analysis.ai_useful_response_mode = 'action';
  }

  if (
    includesAny(lower, [
      'idée',
      'j’ai une idée',
      "j'ai une idée",
      'concept',
      'ça pourrait',
      'on pourrait',
      'je pourrais créer',
      'je pourrais faire',
      'et si',
    ])
  ) {
    analysis.is_idea = true;

    if (analysis.is_task) {
      analysis.type = 'mixed';
      analysis.bucket = 'inbox';
      analysis.ai_useful_response_mode = 'sort';
    } else {
      analysis.type = 'idea';
      analysis.bucket = 'ideas';
      analysis.ai_useful_response_mode = 'idea';
    }
  }

  if (
    includesAny(lower, [
      'je me sens',
      'je ressens',
      'angoisse',
      'stress',
      'triste',
      'énervée',
      'énervé',
      'fatiguée',
      'fatigué',
      'peur',
      'mal',
      'je vais pas bien',
      'ça va pas',
      'je pleure',
      'j’ai envie de pleurer',
      "j'ai envie de pleurer",
    ])
  ) {
    analysis.is_emotion = true;

    if (analysis.is_task || analysis.is_idea) {
      analysis.type = 'mixed';
      analysis.bucket = 'inbox';
      analysis.ai_useful_response_mode = 'sort';
    } else {
      analysis.type = 'emotion';
      analysis.bucket = 'journal';
      analysis.ai_useful_response_mode = 'support';
    }
  }

  if (
    includesAny(lower, [
      'nyra',
      'novacall',
      'projet',
      'app',
      'application',
      'backend',
      'mobile',
      'code',
      'roadmap',
      'react native',
      'railway',
    ])
  ) {
    analysis.is_project = true;

    if (!analysis.is_task && !analysis.is_idea && !analysis.is_emotion) {
      analysis.type = 'project_note';
      analysis.bucket = 'projects';
      analysis.ai_useful_response_mode = 'project';
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
      'important',
      'priorité',
    ])
  ) {
    analysis.urgency = 'high';
  }

  let priority = 2;

  if (analysis.is_task) priority += 2;
  if (analysis.urgency === 'high') priority += 2;
  if (analysis.due_hint === 'today') priority += 2;
  if (analysis.due_hint === 'tomorrow') priority += 1;
  if (analysis.is_emotion && ['anxious', 'sad', 'angry'].includes(analysis.mood)) {
    priority += 1;
  }
  if (analysis.project === 'nyra') priority += 1;

  analysis.priority_score = clamp(priority, 1, 5);
  analysis.tags = detectTags(lower, analysis);

  return analysis;
}

function createStoredItem({ userId, message, analysis }) {
  return {
    id: crypto.randomUUID(),
    user_id: userId,

    type: analysis.type,
    bucket: analysis.bucket,
    title: analysis.title,
    content: message,

    urgency: analysis.urgency,
    priority_score: analysis.priority_score,
    due_hint: analysis.due_hint,
    mood: analysis.mood,
    project: analysis.project,
    tags: analysis.tags,

    status: analysis.is_task ? 'todo' : 'captured',
    done: false,

    next_action: analysis.next_action,

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
    stored_item_id: item.id,
    created_at: nowIso(),
  });

  store.items = store.items.slice(-MAX_ITEMS);
  store.conversations = store.conversations.slice(-MAX_CONVERSATIONS);
  store.updated_at = nowIso();

  writeStore(store);

  return item;
}

function getUserItems(userId) {
  const store = readStore();

  return store.items.filter(item => item.user_id === userId);
}

function sortItemsSmart(items) {
  return [...items].sort((a, b) => {
    const priorityA = Number(a.priority_score || 1);
    const priorityB = Number(b.priority_score || 1);

    if (priorityB !== priorityA) return priorityB - priorityA;

    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

function isOpenTask(item) {
  return item.bucket === 'tasks' && item.status !== 'done' && item.done !== true;
}

function isTodayRelevant(item) {
  if (!isOpenTask(item)) return false;

  const priorityScore = Number(item.priority_score || 1);

  return (
    item.urgency === 'high' ||
    item.due_hint === 'today' ||
    item.due_hint === 'tomorrow' ||
    priorityScore >= 4
  );
}

function getTodayItems(userId) {
  const userItems = getUserItems(userId);

  return sortItemsSmart(userItems.filter(isTodayRelevant));
}

function getStoreSummary(userId) {
  const userItems = getUserItems(userId);

  const openTasks = userItems.filter(isOpenTask);
  const todayItems = getTodayItems(userId);

  return {
    total_items: userItems.length,
    tasks: userItems.filter(item => item.bucket === 'tasks').length,
    open_tasks: openTasks.length,
    today: todayItems.length,
    ideas: userItems.filter(item => item.bucket === 'ideas').length,
    journal: userItems.filter(item => item.bucket === 'journal').length,
    projects: userItems.filter(item => item.bucket === 'projects').length,
    inbox: userItems.filter(item => item.bucket === 'inbox').length,
    urgent: userItems.filter(item => item.urgency === 'high').length,
    nyra_items: userItems.filter(item => item.project === 'nyra').length,
  };
}

function getMemoryContext(userId) {
  const userItems = getUserItems(userId);
  const recentItems = userItems.slice(-12).reverse();

  const openTasks = sortItemsSmart(userItems.filter(isOpenTask)).slice(0, 8);
  const todayItems = getTodayItems(userId).slice(0, 8);

  const importantItems = sortItemsSmart(
    userItems.filter(item => Number(item.priority_score || 0) >= 4)
  ).slice(0, 8);

  return {
    summary: getStoreSummary(userId),
    today_items: todayItems.map(item => ({
      title: item.title,
      urgency: item.urgency,
      due_hint: item.due_hint,
      priority_score: item.priority_score,
    })),
    recent_items: recentItems.map(item => ({
      title: item.title,
      bucket: item.bucket,
      urgency: item.urgency,
      project: item.project,
      created_at: item.created_at,
    })),
    open_tasks: openTasks.map(item => ({
      title: item.title,
      urgency: item.urgency,
      due_hint: item.due_hint,
      priority_score: item.priority_score,
    })),
    important_items: importantItems.map(item => ({
      title: item.title,
      bucket: item.bucket,
      priority_score: item.priority_score,
    })),
  };
}

function buildSystemPrompt(analysis, memoryContext) {
  return `
Tu es Nyra, un cerveau externe intelligent pour une personne TDAH.

Ta mission :
- recevoir ce que l'utilisateur vide de sa tête
- comprendre la nature de la capture
- ranger mentalement l'information
- répondre simplement, sans surcharger
- aider à transformer le chaos mental en action claire

Analyse détectée :
${JSON.stringify(analysis)}

Contexte mémoire :
${JSON.stringify(memoryContext)}

Règles de réponse :
- réponds en français naturel
- ton direct, humain, rassurant
- maximum 120 mots
- pas de long pavé
- ne parle jamais de JSON, d'analyse interne ou de mécanisme technique
- tu peux dire que c'est capturé dans Nyra
- si c'est une tâche : reformule l'action clairement
- si c'est urgent : souligne la priorité sans paniquer
- si c'est une idée : valorise l'idée et dis où elle est rangée
- si c'est une émotion : valide brièvement et aide à déposer la charge
- si c'est mixte : trie en 2 ou 3 points maximum
- si ça concerne Nyra : réponds comme un copilote produit
`.trim();
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    app: 'Nyra backend',
    version: 'v4-intelligent-memory-today',
  });
});

app.get('/store', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const items = sortItemsSmart(getUserItems(userId));

  res.json({
    ok: true,
    userId,
    summary: getStoreSummary(userId),
    items,
  });
});

app.get('/store/today', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const todayItems = getTodayItems(userId);

  res.json({
    ok: true,
    userId,
    count: todayItems.length,
    summary: {
      total_today: todayItems.length,
      urgent: todayItems.filter(item => item.urgency === 'high').length,
      today_due: todayItems.filter(item => item.due_hint === 'today').length,
      tomorrow_due: todayItems.filter(item => item.due_hint === 'tomorrow').length,
      high_priority: todayItems.filter(item => Number(item.priority_score || 1) >= 4).length,
    },
    items: todayItems,
  });
});

app.get('/store/tasks', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');

  const tasks = sortItemsSmart(
    getUserItems(userId).filter(item => item.bucket === 'tasks')
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

  const ideas = sortItemsSmart(
    getUserItems(userId).filter(item => item.bucket === 'ideas')
  );

  res.json({
    ok: true,
    userId,
    count: ideas.length,
    ideas,
  });
});

app.get('/store/journal', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');

  const journal = sortItemsSmart(
    getUserItems(userId).filter(item => item.bucket === 'journal')
  );

  res.json({
    ok: true,
    userId,
    count: journal.length,
    journal,
  });
});

app.get('/store/projects', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');

  const projects = sortItemsSmart(
    getUserItems(userId).filter(item => item.bucket === 'projects')
  );

  res.json({
    ok: true,
    userId,
    count: projects.length,
    projects,
  });
});

app.post('/store/item/:id/done', (req, res) => {
  const itemId = normalizeText(req.params.id);
  const store = readStore();

  const item = store.items.find(entry => entry.id === itemId);

  if (!item) {
    return res.status(404).json({
      ok: false,
      error: 'Item introuvable',
    });
  }

  item.status = 'done';
  item.done = true;
  item.updated_at = nowIso();

  writeStore(store);

  res.json({
    ok: true,
    item,
  });
});

app.post('/store/item/:id/todo', (req, res) => {
  const itemId = normalizeText(req.params.id);
  const store = readStore();

  const item = store.items.find(entry => entry.id === itemId);

  if (!item) {
    return res.status(404).json({
      ok: false,
      error: 'Item introuvable',
    });
  }

  item.status = 'todo';
  item.done = false;
  item.updated_at = nowIso();

  writeStore(store);

  res.json({
    ok: true,
    item,
  });
});

app.delete('/store/item/:id', (req, res) => {
  const itemId = normalizeText(req.params.id);
  const store = readStore();

  const before = store.items.length;
  store.items = store.items.filter(item => item.id !== itemId);
  const deleted = before - store.items.length;

  writeStore(store);

  res.json({
    ok: true,
    deleted,
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
    const memoryContext = getMemoryContext(userId);

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.55,
      max_tokens: 180,
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(analysis, memoryContext),
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const reply =
      normalizeText(completion.choices?.[0]?.message?.content) ||
      'C’est capturé dans Nyra. Je le garde au bon endroit.';

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
  console.log(`🚀 Nyra backend V4 intelligent memory + today lancé sur le port ${PORT}`);
});