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

function nowIso() {
  return new Date().toISOString();
}

function createEmptyStore() {
  return {
    version: 'structured-actions-v1',
    items: [],
    actions: [],
    conversations: [],
    connected_accounts: [],
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
      version: parsed.version || 'structured-actions-v1',
      items: Array.isArray(parsed.items) ? parsed.items : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      conversations: Array.isArray(parsed.conversations)
        ? parsed.conversations
        : [],
      connected_accounts: Array.isArray(parsed.connected_accounts)
        ? parsed.connected_accounts
        : [],
      updated_at: parsed.updated_at || null,
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
      version: 'structured-actions-v1',
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

function includesAny(text, words) {
  const lower = normalizeText(text).toLowerCase();
  return words.some(word => lower.includes(word));
}

function uniqueArray(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractContext(text) {
  const match = text.match(/contexte\s*:\s*(.*?)(?:\n|$)/i);

  if (match && match[1]) {
    return normalizeText(match[1]);
  }

  return normalizeText(text);
}

function cleanActionTitle(text) {
  const clean = normalizeText(text)
    .replace(/^contexte\s*:\s*/i, '')
    .replace(/^je dois\s+/i, '')
    .replace(/^il faut que je\s+/i, '')
    .replace(/^il faut\s+/i, '')
    .replace(/^pense à\s+/i, '')
    .replace(/^penser à\s+/i, '')
    .replace(/^aide-moi à\s+/i, '')
    .replace(/^aide moi à\s+/i, '')
    .replace(/^ajoute ça à\s+/i, '')
    .replace(/^crée un rappel pour\s+/i, '')
    .replace(/^créer un rappel pour\s+/i, '')
    .replace(/^transforme cette idée en tâche\s*/i, '')
    .trim();

  if (!clean) return 'Action Nyra';

  const title = clean.charAt(0).toUpperCase() + clean.slice(1);

  return title.length > 80 ? `${title.slice(0, 80)}…` : title;
}

function detectDatetimeHint(text) {
  const lower = normalizeText(text).toLowerCase();

  if (includesAny(lower, ["aujourd'hui", 'aujourd’hui', 'ce soir', 'maintenant'])) {
    return 'today';
  }

  if (includesAny(lower, ['demain matin'])) {
    return 'tomorrow_morning';
  }

  if (includesAny(lower, ['demain après-midi', 'demain apres-midi'])) {
    return 'tomorrow_afternoon';
  }

  if (includesAny(lower, ['demain soir'])) {
    return 'tomorrow_evening';
  }

  if (includesAny(lower, ['demain'])) {
    return 'tomorrow';
  }

  if (includesAny(lower, ['cette semaine', 'dans la semaine'])) {
    return 'this_week';
  }

  if (includesAny(lower, ['ce week-end', 'week-end', 'weekend'])) {
    return 'weekend';
  }

  if (includesAny(lower, ['plus tard', 'un jour', 'quand j’aurai le temps', "quand j'aurai le temps"])) {
    return 'later';
  }

  return null;
}

function detectPriority(text, analysis) {
  const lower = normalizeText(text).toLowerCase();

  if (
    analysis?.urgency === 'high' ||
    includesAny(lower, [
      'urgent',
      'vite',
      'rapidement',
      'important',
      'priorité',
      'maintenant',
      'de toute urgence',
    ])
  ) {
    return 'high';
  }

  if (includesAny(lower, ['plus tard', 'un jour', 'quand j’aurai le temps', "quand j'aurai le temps"])) {
    return 'low';
  }

  return 'normal';
}

function actionToProvider(actionType) {
  if (actionType === 'create_reminder') return 'local';
  if (actionType === 'add_to_today') return 'local';
  if (actionType === 'plan_now') return 'local';
  if (actionType === 'process_now') return 'local';
  if (actionType === 'classify_as_idea') return 'local';
  if (actionType === 'idea_to_task') return 'local';
  if (actionType === 'add_to_roadmap') return 'local';

  return 'local';
}

function actionToConnectionType(actionType) {
  if (actionType === 'create_calendar_event') return 'google_calendar';
  if (actionType === 'create_google_task') return 'google_tasks';
  if (actionType === 'sync_drive_note') return 'google_drive';

  return null;
}

function actionNeedsConnection(actionType) {
  return Boolean(actionToConnectionType(actionType));
}

function actionToBucket(actionType) {
  if (actionType === 'add_to_today') return 'today';
  if (actionType === 'create_reminder') return 'reminders';
  if (actionType === 'plan_now') return 'plans';
  if (actionType === 'process_now') return 'plans';
  if (actionType === 'classify_as_idea') return 'ideas';
  if (actionType === 'idea_to_task') return 'tasks';
  if (actionType === 'add_to_roadmap') return 'projects';
  return 'actions';
}

function buildNextStep(actionType, datetimeHint) {
  if (actionType === 'create_reminder') {
    if (datetimeHint) return 'Choisir ou confirmer l’heure exacte du rappel.';
    return 'Choisir une date et une heure pour le rappel.';
  }

  if (actionType === 'add_to_today') {
    return 'Traiter cette priorité aujourd’hui.';
  }

  if (actionType === 'plan_now') {
    return 'Faire la plus petite première action maintenant.';
  }

  if (actionType === 'process_now') {
    return 'Commencer par une étape simple et immédiate.';
  }

  if (actionType === 'classify_as_idea') {
    return 'Garder cette idée pour la développer plus tard.';
  }

  if (actionType === 'idea_to_task') {
    return 'Faire cette tâche quand elle devient prioritaire.';
  }

  if (actionType === 'add_to_roadmap') {
    return 'Revoir cette entrée lors de la prochaine session projet.';
  }

  return 'Action enregistrée.';
}

function buildStructuredAction({ userId, message, actionType, label, status, analysis }) {
  const target = extractContext(message);
  const datetimeHint = detectDatetimeHint(target || message);
  const priority = detectPriority(target || message, analysis);
  const provider = actionToProvider(actionType);
  const connectionType = actionToConnectionType(actionType);
  const requiresConnection = actionNeedsConnection(actionType);

  return {
    id: crypto.randomUUID(),
    user_id: userId,

    action_type: actionType,
    type: actionType,
    label,
    title: cleanActionTitle(target),
    target,

    status,
    priority,
    datetime_hint: datetimeHint,
    next_step: buildNextStep(actionType, datetimeHint),

    provider,
    sync_status: requiresConnection ? 'requires_connection' : 'local_only',
    external_id: null,

    requires_connection: requiresConnection,
    connection_type: connectionType,

    source: 'user_capture',
    source_message: message,

    created_at: nowIso(),
    updated_at: nowIso(),
  };
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
    datetime_hint: detectDatetimeHint(text),
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
      'demain matin',
      'de toute urgence',
    ])
  ) {
    analysis.urgency = 'high';
    analysis.tags.push('urgent');
  }

  if (analysis.datetime_hint) {
    analysis.tags.push(analysis.datetime_hint);
  }

  if (analysis.tags.length === 0) {
    analysis.tags.push('note');
  }

  analysis.tags = uniqueArray(analysis.tags);

  return analysis;
}

function detectAction(message, userId, analysis) {
  const text = normalizeText(message);
  const lower = text.toLowerCase();

  if (
    includesAny(lower, [
      'ajoute ça à mes priorités',
      'ajoute ça à aujourd’hui',
      "ajoute ça à aujourd'hui",
      'ajouter à aujourd’hui',
      "ajouter à aujourd'hui",
    ])
  ) {
    return buildStructuredAction({
      userId,
      message,
      actionType: 'add_to_today',
      label: 'Ajouter à aujourd’hui',
      status: 'done',
      analysis,
    });
  }

  if (
    includesAny(lower, [
      'aide-moi à créer un rappel',
      'crée un rappel',
      'créer un rappel',
      'rappel clair',
    ])
  ) {
    return buildStructuredAction({
      userId,
      message,
      actionType: 'create_reminder',
      label: 'Créer un rappel',
      status: 'draft',
      analysis,
    });
  }

  if (
    includesAny(lower, [
      'aide-moi à planifier',
      'planifier ça',
      'planifier maintenant',
      'avec une action simple',
    ])
  ) {
    return buildStructuredAction({
      userId,
      message,
      actionType: 'plan_now',
      label: 'Planifier maintenant',
      status: 'done',
      analysis,
    });
  }

  if (
    includesAny(lower, [
      'aide-moi à traiter ça maintenant',
      'traiter ça maintenant',
      'traiter maintenant',
      'étape par étape',
    ])
  ) {
    return buildStructuredAction({
      userId,
      message,
      actionType: 'process_now',
      label: 'Traiter maintenant',
      status: 'done',
      analysis,
    });
  }

  if (
    includesAny(lower, [
      'classe ça dans mes idées',
      'classer dans idées',
      'classe dans idées',
    ])
  ) {
    return buildStructuredAction({
      userId,
      message,
      actionType: 'classify_as_idea',
      label: 'Classer dans idées',
      status: 'done',
      analysis,
    });
  }

  if (
    includesAny(lower, [
      'transforme cette idée en tâche',
      'transformer en tâche',
      'transforme ça en tâche',
    ])
  ) {
    return buildStructuredAction({
      userId,
      message,
      actionType: 'idea_to_task',
      label: 'Transformer en tâche',
      status: 'done',
      analysis,
    });
  }

  if (
    includesAny(lower, [
      'ajoute ça à la roadmap',
      'ajouter à la roadmap',
      'roadmap du projet',
    ])
  ) {
    return buildStructuredAction({
      userId,
      message,
      actionType: 'add_to_roadmap',
      label: 'Ajouter à la roadmap',
      status: 'done',
      analysis,
    });
  }

  return null;
}

function buildSuggestions(analysis, action) {
  if (action) return [];

  const suggestions = [];

  if (analysis.urgency === 'high') {
    suggestions.push('Traiter maintenant');
  }

  if (analysis.is_task) {
    suggestions.push('Ajouter à aujourd’hui');
    suggestions.push('Créer un rappel');
    suggestions.push('Planifier maintenant');
  }

  if (analysis.is_idea) {
    suggestions.push('Classer dans idées');
    suggestions.push('Transformer en tâche');
    suggestions.push('Développer plus tard');
  }

  if (analysis.is_emotion) {
    suggestions.push('Prendre 5 minutes pour toi');
    suggestions.push('Écrire ce que tu ressens');
    suggestions.push('Respirer et ralentir');
  }

  if (analysis.type === 'mixed') {
    suggestions.push('Trier tâche / idée / émotion');
    suggestions.push('Garder l’essentiel');
  }

  if (analysis.is_project) {
    suggestions.push('Ajouter à la roadmap');
    suggestions.push('Créer une tâche projet');
  }

  return uniqueArray(suggestions).slice(0, 4);
}

function createStoredItem({ userId, message, analysis, action }) {
  const bucket = action ? actionToBucket(action.action_type) : analysis.suggested_bucket;

  return {
    id: crypto.randomUUID(),
    user_id: userId,

    type: action ? 'action_result' : analysis.type,
    bucket,

    title: action ? action.title : cleanActionTitle(message),
    content: action ? action.target : message,

    urgency: analysis.urgency,
    priority: action ? action.priority : detectPriority(message, analysis),
    datetime_hint: action ? action.datetime_hint : analysis.datetime_hint,

    tags: action ? ['action', action.action_type, action.provider] : analysis.tags,
    status: action ? action.status : analysis.is_task ? 'todo' : 'captured',

    action_type: action ? action.action_type : null,
    action_label: action ? action.label : null,
    action_id: action ? action.id : null,

    provider: action ? action.provider : 'local',
    sync_status: action ? action.sync_status : 'local_only',
    external_id: action ? action.external_id : null,
    requires_connection: action ? action.requires_connection : false,
    connection_type: action ? action.connection_type : null,

    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function saveCapture({ userId, message, reply, analysis, action }) {
  const store = readStore();

  const item = createStoredItem({
    userId,
    message,
    analysis,
    action,
  });

  store.items.push(item);

  let actionRecord = null;

  if (action) {
    actionRecord = {
      ...action,
      item_id: item.id,
      updated_at: nowIso(),
    };

    store.actions.push(actionRecord);
  }

  store.conversations.push({
    id: crypto.randomUUID(),
    user_id: userId,
    user_message: message,
    nyra_reply: reply,
    analysis,
    action,
    stored_item_id: item.id,
    action_id: actionRecord ? actionRecord.id : null,
    created_at: nowIso(),
  });

  store.items = store.items.slice(-500);
  store.actions = store.actions.slice(-300);
  store.conversations = store.conversations.slice(-200);

  writeStore(store);

  return {
    item,
    action: actionRecord,
  };
}

function getStoreSummary(userId) {
  const store = readStore();

  const userItems = store.items.filter(item => item.user_id === userId);
  const userActions = store.actions.filter(action => action.user_id === userId);

  return {
    total_items: userItems.length,
    tasks: userItems.filter(item => item.bucket === 'tasks').length,
    ideas: userItems.filter(item => item.bucket === 'ideas').length,
    journal: userItems.filter(item => item.bucket === 'journal').length,
    projects: userItems.filter(item => item.bucket === 'projects').length,
    today: userItems.filter(item => item.bucket === 'today').length,
    reminders: userItems.filter(item => item.bucket === 'reminders').length,
    plans: userItems.filter(item => item.bucket === 'plans').length,
    inbox: userItems.filter(item => item.bucket === 'inbox').length,
    actions: userActions.length,
    local_only: userActions.filter(action => action.sync_status === 'local_only').length,
    pending_sync: userActions.filter(action => action.sync_status === 'pending_sync').length,
    synced: userActions.filter(action => action.sync_status === 'synced').length,
    failed: userActions.filter(action => action.sync_status === 'failed').length,
    requires_connection: userActions.filter(
      action => action.sync_status === 'requires_connection'
    ).length,
  };
}

function buildActionReply(action) {
  if (!action) return null;

  if (action.requires_connection) {
    if (action.connection_type === 'google_calendar') {
      return '✔ Action préparée. Il faudra connecter Google Agenda pour la synchroniser.';
    }

    if (action.connection_type === 'google_tasks') {
      return '✔ Action préparée. Il faudra connecter Google Tasks pour la synchroniser.';
    }

    return '✔ Action préparée. Une connexion externe sera nécessaire pour la synchroniser.';
  }

  if (action.action_type === 'add_to_today') {
    return '✔ Ajouté à tes priorités d’aujourd’hui.';
  }

  if (action.action_type === 'create_reminder') {
    return '✔ Rappel préparé. Prochaine étape : choisir l’heure exacte.';
  }

  if (action.action_type === 'plan_now') {
    return '✔ Plan créé : fais une seule action simple maintenant.';
  }

  if (action.action_type === 'process_now') {
    return '✔ On traite maintenant : commence par la plus petite action possible.';
  }

  if (action.action_type === 'classify_as_idea') {
    return '✔ Classé dans tes idées.';
  }

  if (action.action_type === 'idea_to_task') {
    return '✔ Transformé en tâche concrète.';
  }

  if (action.action_type === 'add_to_roadmap') {
    return '✔ Ajouté à la roadmap projet.';
  }

  return '✔ Action enregistrée.';
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
- maximum 90 mots
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
    version: 'structured-actions-v1',
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

app.get('/store/actions', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const actions = store.actions.filter(action => action.user_id === userId);

  res.json({
    ok: true,
    userId,
    count: actions.length,
    actions,
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

app.get('/store/today', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const today = store.items.filter(
    item => item.user_id === userId && item.bucket === 'today'
  );

  res.json({
    ok: true,
    userId,
    count: today.length,
    today,
  });
});

app.get('/store/reminders', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const reminders = store.items.filter(
    item => item.user_id === userId && item.bucket === 'reminders'
  );

  res.json({
    ok: true,
    userId,
    count: reminders.length,
    reminders,
  });
});

app.get('/store/connected-accounts', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const accounts = store.connected_accounts.filter(
    account => account.user_id === userId
  );

  res.json({
    ok: true,
    userId,
    count: accounts.length,
    accounts,
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
    const action = detectAction(userMessage, userId, analysis);
    const suggestions = buildSuggestions(analysis, action);
    const memorySummary = getStoreSummary(userId);

    let reply = buildActionReply(action);

    if (!reply) {
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.45,
        max_tokens: 150,
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

      reply =
        normalizeText(completion.choices?.[0]?.message?.content) ||
        'Je l’ai capté. Je le range dans Nyra.';
    }

    const saved = saveCapture({
      userId,
      message: userMessage,
      reply,
      analysis,
      action,
    });

    res.json({
      ok: true,
      reply,
      message: reply,
      analysis,
      action,
      suggestions,
      stored_item: saved.item,
      stored_action: saved.action,
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
  console.log(`🚀 Nyra backend structured actions lancé sur le port ${PORT}`);
});