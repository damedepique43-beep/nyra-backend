require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const OpenAI = require('openai');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  'https://nyra-backend-production-d168.up.railway.app/auth/google/callback';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
];

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'nyra_store.json');

const STORE_VERSION = 'executable-actions-v1';

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
    version: STORE_VERSION,
    users: [],
    items: [],
    actions: [],
    conversations: [],
    projects: [],
    relations: [],
    contexts: [],
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
      version: parsed.version || STORE_VERSION,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      contexts: Array.isArray(parsed.contexts) ? parsed.contexts : [],
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
      users: Array.isArray(store.users) ? store.users : [],
      version: STORE_VERSION,
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

function normalizeMultilineText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildGoogleNyraUserId(googleUserId, googleEmail) {
  const stableSource = normalizeText(googleUserId || googleEmail || crypto.randomUUID());
  return `google-${normalizeKey(stableSource)}`;
}

function buildSafeFileName(value) {
  const safe = normalizeKey(value || 'nyra-projet');
  if (!safe) return 'nyra-projet';
  return safe.slice(0, 80);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function markdownInlineToHtml(value) {
  return escapeHtml(value)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

function markdownToGoogleDocHtml(markdown, projectName) {
  const normalized = normalizeMultilineText(markdown);
  const lines = normalized.split('\n');

  const htmlParts = [];
  let listOpen = false;

  function closeListIfNeeded() {
    if (listOpen) {
      htmlParts.push('</ul>');
      listOpen = false;
    }
  }

  lines.forEach(rawLine => {
    const line = rawLine.trim();

    if (!line) {
      closeListIfNeeded();
      htmlParts.push('<p></p>');
      return;
    }

    if (line.startsWith('# ')) {
      closeListIfNeeded();
      htmlParts.push(`<h1>${markdownInlineToHtml(line.replace(/^#\s+/, ''))}</h1>`);
      return;
    }

    if (line.startsWith('## ')) {
      closeListIfNeeded();
      htmlParts.push(`<h2>${markdownInlineToHtml(line.replace(/^##\s+/, ''))}</h2>`);
      return;
    }

    if (line.startsWith('### ')) {
      closeListIfNeeded();
      htmlParts.push(`<h3>${markdownInlineToHtml(line.replace(/^###\s+/, ''))}</h3>`);
      return;
    }

    if (/^[-•]\s+/.test(line)) {
      if (!listOpen) {
        htmlParts.push('<ul>');
        listOpen = true;
      }

      htmlParts.push(`<li>${markdownInlineToHtml(line.replace(/^[-•]\s+/, ''))}</li>`);
      return;
    }

    if (/^\d+\.\s+/.test(line)) {
      closeListIfNeeded();
      htmlParts.push(`<p>${markdownInlineToHtml(line)}</p>`);
      return;
    }

    closeListIfNeeded();
    htmlParts.push(`<p>${markdownInlineToHtml(line)}</p>`);
  });

  closeListIfNeeded();

  return `
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(projectName || 'Cahier des charges Nyra')}</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        color: #111827;
        line-height: 1.6;
      }
      h1 {
        font-size: 28px;
        margin: 0 0 18px;
        color: #111827;
      }
      h2 {
        font-size: 20px;
        margin: 26px 0 10px;
        color: #4c1d95;
      }
      h3 {
        font-size: 16px;
        margin: 18px 0 8px;
        color: #6d28d9;
      }
      p {
        margin: 0 0 10px;
      }
      ul {
        margin: 0 0 14px 22px;
        padding: 0;
      }
      li {
        margin: 0 0 6px;
      }
    </style>
  </head>
  <body>
    ${htmlParts.join('\n')}
  </body>
</html>
`.trim();
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

  if (includesAny(lower, ['demain matin'])) return 'tomorrow_morning';
  if (includesAny(lower, ['demain après-midi', 'demain apres-midi'])) return 'tomorrow_afternoon';
  if (includesAny(lower, ['demain soir'])) return 'tomorrow_evening';
  if (includesAny(lower, ['demain'])) return 'tomorrow';
  if (includesAny(lower, ['cette semaine', 'dans la semaine'])) return 'this_week';
  if (includesAny(lower, ['ce week-end', 'week-end', 'weekend'])) return 'weekend';

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

function detectDurationMinutes(text) {
  const lower = normalizeText(text).toLowerCase();

  const hourMatch = lower.match(/(\d+(?:[,.]\d+)?)\s*(h|heure|heures)/i);
  if (hourMatch && hourMatch[1]) {
    const hours = Number(String(hourMatch[1]).replace(',', '.'));
    if (!Number.isNaN(hours) && hours > 0) {
      return Math.round(hours * 60);
    }
  }

  const minuteMatch = lower.match(/(\d+)\s*(min|minute|minutes)/i);
  if (minuteMatch && minuteMatch[1]) {
    const minutes = Number(minuteMatch[1]);
    if (!Number.isNaN(minutes) && minutes > 0) {
      return minutes;
    }
  }

  if (includesAny(lower, ['session focus', 'deep work', 'concentration'])) return 60;

  return null;
}

function detectEnergyMode(text) {
  const lower = normalizeText(text).toLowerCase();

  if (includesAny(lower, ['focus', 'deep work', 'concentration', 'session profonde', 'sprint'])) {
    return 'deep_work';
  }

  if (includesAny(lower, ['fatiguée', 'fatigué', 'épuisée', 'épuisé', 'doucement', 'petite étape'])) {
    return 'low_energy';
  }

  if (includesAny(lower, ['urgent', 'vite', 'rapidement', 'maintenant'])) {
    return 'activation';
  }

  if (includesAny(lower, ['angoisse', 'stress', 'peur', 'panique', 'mal'])) {
    return 'emotional_regulation';
  }

  return 'neutral';
}

function detectExecutionMode(text, analysis) {
  const lower = normalizeText(text).toLowerCase();

  if (includesAny(lower, ['faire maintenant', 'traiter maintenant', 'attaque maintenant', 'on le fait maintenant'])) {
    return 'execute_now';
  }

  if (includesAny(lower, ['rappelle', 'rappel', 'ne pas oublier', 'demain', 'ce soir', 'cette semaine'])) {
    return 'schedule_or_remind';
  }

  if (analysis?.is_project) return 'project_planning';
  if (analysis?.is_emotion) return 'regulate';
  if (analysis?.is_task) return 'capture_then_execute';

  return 'capture';
}

function detectRoadmapMilestone(text, projectName) {
  const lower = normalizeText(text).toLowerCase();

  if (includesAny(lower, ['voix', 'vocal', 'wake word', 'ok nyra', 'micro'])) {
    return 'Couche vocale et activation mains libres';
  }

  if (includesAny(lower, ['renderer', 'interface', 'ui', 'carte', 'cartes'])) {
    return 'Interface cognitive et rendu des actions';
  }

  if (includesAny(lower, ['mémoire', 'memoire', 'relation', 'contexte'])) {
    return 'Mémoire relationnelle profonde';
  }

  if (includesAny(lower, ['backend', 'api', 'architecture', 'serveur'])) {
    return 'Architecture backend et orchestration';
  }

  if (includesAny(lower, ['google', 'drive', 'agenda', 'tasks'])) {
    return 'Intégrations Google';
  }

  if (projectName) return `Roadmap ${projectName}`;

  return 'Roadmap projet';
}

function buildActionSubtitle(executiveActionType, datetimeHint, durationMin) {
  if (executiveActionType === 'focus_session') {
    return durationMin
      ? `Session focus de ${durationMin} min`
      : 'Session focus à planifier';
  }

  if (executiveActionType === 'create_calendar_event') {
    return datetimeHint
      ? 'Événement à caler dans Google Agenda'
      : 'Événement à planifier';
  }

  if (executiveActionType === 'create_google_task') return 'Tâche exécutable dans Google Tasks';
  if (executiveActionType === 'roadmap_action') return 'Action à ajouter à la roadmap';
  if (executiveActionType === 'create_project_spec') return 'Structuration projet';
  if (executiveActionType === 'add_to_today') return 'Priorité du jour';
  if (executiveActionType === 'breathing_reset') return 'Recentrage rapide';
  if (executiveActionType === 'clarify_time') return 'Heure à préciser';

  return 'Action proposée par Nyra';
}

function buildExecutiveNextStep(executiveActionType, payload) {
  if (executiveActionType === 'focus_session') {
    return payload?.needs_exact_time
      ? 'Choisir l’heure exacte de la session focus.'
      : 'Lancer la session focus au moment prévu.';
  }

  if (executiveActionType === 'create_calendar_event') {
    return payload?.needs_exact_time
      ? 'Confirmer l’heure exacte avant création dans Google Agenda.'
      : 'Créer l’événement dans Google Agenda.';
  }

  if (executiveActionType === 'create_google_task') {
    return 'Créer cette tâche dans Google Tasks ou la garder dans Nyra.';
  }

  if (executiveActionType === 'roadmap_action') {
    return 'Ajouter cette action à la roadmap du projet.';
  }

  if (executiveActionType === 'create_project_spec') {
    return 'Générer ou mettre à jour le cahier des charges du projet.';
  }

  if (executiveActionType === 'add_to_today') {
    return 'Traiter cette action aujourd’hui.';
  }

  if (executiveActionType === 'breathing_reset') {
    return 'Faire un reset de 2 minutes avant de reprendre.';
  }

  if (executiveActionType === 'clarify_time') {
    return 'Demander une heure précise à l’utilisateur.';
  }

  return 'Valider ou ignorer cette action.';
}

function getActionProvider(executiveActionType) {
  if (executiveActionType === 'create_google_task') return 'google_tasks';
  if (executiveActionType === 'create_calendar_event') return 'google_calendar';
  if (executiveActionType === 'create_project_spec') return 'google_drive';
  return 'local';
}

function actionToProvider() {
  return 'local';
}

function actionToConnectionType(actionType) {
  if (actionType === 'create_calendar_event') return 'google_calendar';
  if (actionType === 'create_google_task') return 'google_tasks';
  if (actionType === 'sync_drive_note') return 'google_drive';
  if (actionType === 'export_project_spec_to_drive') return 'google_drive';

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
  if (actionType === 'create_project_spec') return 'projects';
  return 'actions';
}

function buildNextStep(actionType, datetimeHint) {
  if (actionType === 'create_reminder') {
    if (datetimeHint) return 'Choisir ou confirmer l’heure exacte du rappel.';
    return 'Choisir une date et une heure pour le rappel.';
  }

  if (actionType === 'add_to_today') return 'Traiter cette priorité aujourd’hui.';
  if (actionType === 'plan_now') return 'Faire la plus petite première action maintenant.';
  if (actionType === 'process_now') return 'Commencer par une étape simple et immédiate.';
  if (actionType === 'classify_as_idea') return 'Garder cette idée pour la développer plus tard.';
  if (actionType === 'idea_to_task') return 'Faire cette tâche quand elle devient prioritaire.';
  if (actionType === 'add_to_roadmap') return 'Revoir cette entrée lors de la prochaine session projet.';
  if (actionType === 'create_project_spec') return 'Structurer cette idée en cahier des charges.';

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

function detectKnownProjectName(text) {
  const lower = normalizeText(text).toLowerCase();

  const knownProjects = [
    {
      name: 'Nyra',
      keywords: ['nyra', 'ok nyra', 'cerveau externe', 'mémoire intelligente', 'react native', 'app mobile'],
    },
    {
      name: 'NovaCall',
      keywords: ['novacall', 'nova call', 'agent vocal', 'voiceflow', 'make', 'clinique', 'cliniques'],
    },
    {
      name: 'Dame de Pique',
      keywords: ['dame de pique', 'tiktok spirituel', 'spiritualité', 'méditation', 'numérologie'],
    },
    {
      name: 'BrumeArdente',
      keywords: ['brumeardente', 'brume ardente', 'payhip', 'ebook', 'e-book', 'carnet'],
    },
  ];

  const found = knownProjects.find(project =>
    project.keywords.some(keyword => lower.includes(keyword))
  );

  if (found) return found.name;

  const explicitProjectMatch = lower.match(/projet\s+([a-z0-9àâçéèêëîïôûùüÿñæœ' -]{2,40})/i);

  if (explicitProjectMatch && explicitProjectMatch[1]) {
    return normalizeText(explicitProjectMatch[1])
      .replace(/[.,!?;:]+$/g, '')
      .trim();
  }

  return null;
}

function ensureProject(store, userId, projectName, sourceText) {
  if (!projectName) return null;

  const projectKey = normalizeKey(projectName);

  let project = store.projects.find(existingProject => {
    return (
      existingProject.user_id === userId &&
      normalizeKey(existingProject.name) === projectKey
    );
  });

  if (project) {
    project.updated_at = nowIso();

    if (sourceText) {
      project.last_source_preview = normalizeText(sourceText).slice(0, 180);
    }

    return project;
  }

  project = {
    id: crypto.randomUUID(),
    user_id: userId,
    name: projectName,
    key: projectKey,
    description: 'Projet détecté automatiquement à partir des captures Nyra.',
    status: 'active',
    tags: ['project', projectKey],
    source: 'auto_detection',
    last_source_preview: normalizeText(sourceText).slice(0, 180),
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  store.projects.push(project);

  return project;
}

function createRelation({ userId, sourceId, targetId, relationType, confidence, metadata }) {
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    source_id: sourceId,
    target_id: targetId,
    relation_type: relationType,
    confidence,
    metadata: metadata || {},
    created_at: nowIso(),
  };
}

function relationExists(store, userId, sourceId, targetId, relationType) {
  return store.relations.some(relation => {
    return (
      relation.user_id === userId &&
      relation.source_id === sourceId &&
      relation.target_id === targetId &&
      relation.relation_type === relationType
    );
  });
}

function getProjectRelatedItems(store, userId, projectId) {
  const relations = store.relations.filter(relation => {
    return (
      relation.user_id === userId &&
      relation.target_id === projectId &&
      relation.relation_type === 'belongs_to_project'
    );
  });

  const relatedItemIds = relations.map(relation => relation.source_id);

  const items = store.items.filter(item => {
    return item.user_id === userId && relatedItemIds.includes(item.id);
  });

  return {
    relations,
    items,
  };
}

function buildContextSummary(project, relatedItems) {
  const recentItems = relatedItems
    .slice(-8)
    .map(item => `- ${item.title || item.content}`)
    .join('\n');

  if (!recentItems) {
    return `${project.name} est un projet actif dans Nyra.`;
  }

  return `${project.name} est un projet actif dans Nyra. Éléments récents liés :\n${recentItems}`;
}

function updateProjectContext(store, userId, project) {
  if (!project) return null;

  const { relations, items } = getProjectRelatedItems(store, userId, project.id);
  const relatedItemIds = relations.map(relation => relation.source_id);

  let context = store.contexts.find(existingContext => {
    return (
      existingContext.user_id === userId &&
      existingContext.context_type === 'project' &&
      existingContext.project_id === project.id
    );
  });

  if (!context) {
    context = {
      id: crypto.randomUUID(),
      user_id: userId,
      context_type: 'project',
      project_id: project.id,
      name: `Contexte — ${project.name}`,
      summary: '',
      related_items: [],
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    store.contexts.push(context);
  }

  context.related_items = relatedItemIds;
  context.summary = buildContextSummary(project, items);
  context.updated_at = nowIso();

  return context;
}

function analyzeMessage(message) {
  const text = normalizeText(message);
  const lower = text.toLowerCase();

  const detectedProjectName = detectKnownProjectName(text);

  const analysis = {
    type: 'note',
    is_task: false,
    is_idea: false,
    is_emotion: false,
    is_project: false,
    project_name: detectedProjectName,
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
      'j’imagine',
      "j'imagine",
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
    analysis.type = analysis.is_task || analysis.is_idea ? 'mixed' : 'emotion';
    analysis.is_emotion = true;
    analysis.suggested_bucket =
      analysis.is_task || analysis.is_idea ? 'inbox' : 'journal';
    analysis.tags.push('émotion');
  }

  if (
    detectedProjectName ||
    includesAny(lower, [
      'nyra',
      'novacall',
      'projet',
      'app',
      'application',
      'backend',
      'code',
      'roadmap',
      'cahier des charges',
      'mvp',
      'fonctionnalité',
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

  if (analysis.project_name) {
    analysis.tags.push(normalizeKey(analysis.project_name));
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

  if (
    includesAny(lower, [
      'cahier des charges',
      'transforme ça en cahier des charges',
      'prépare un cahier des charges',
      'génère un cahier des charges',
      'structure ce projet',
    ])
  ) {
    return buildStructuredAction({
      userId,
      message,
      actionType: 'create_project_spec',
      label: 'Créer un cahier des charges',
      status: 'draft',
      analysis,
    });
  }

  return null;
}

function buildSuggestions(analysis, action) {
  if (action) return [];

  const suggestions = [];

  if (analysis.urgency === 'high') suggestions.push('Traiter maintenant');

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
    suggestions.push('Préparer un cahier des charges');
  }

  return uniqueArray(suggestions).slice(0, 4);
}

function buildExecutiveAction({
  userId,
  type,
  title,
  description,
  priority,
  datetimeHint,
  projectName,
  provider,
  confidence,
  reason,
  payload,
  display,
}) {
  const safePayload = payload || {};
  const durationMin = safePayload.duration_min || safePayload.duration_minutes || null;

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    type,
    action_type: type,
    title: cleanActionTitle(title || description || 'Action Nyra'),
    subtitle: display?.subtitle || buildActionSubtitle(type, datetimeHint, durationMin),
    description: normalizeMultilineText(description || ''),
    priority: priority || 'normal',
    datetime_hint: datetimeHint || null,
    project_name: projectName || null,
    provider: provider || getActionProvider(type),
    status: 'suggested',
    execution_status: 'not_executed',
    requires_confirmation: true,
    confidence: typeof confidence === 'number' ? confidence : 0.75,
    reason: normalizeText(reason || ''),
    next_step: display?.next_step || buildExecutiveNextStep(type, safePayload),
    display: {
      icon: display?.icon || '✨',
      color: display?.color || 'purple',
      category: display?.category || 'action',
      cta_label: display?.cta_label || 'Valider',
      secondary_label: display?.secondary_label || 'Plus tard',
    },
    payload: safePayload,
    source: 'executive_layer',
    created_at: nowIso(),
  };
}

function buildExecutiveActions({ userId, message, analysis, action }) {
  const executiveActions = [];
  const text = normalizeText(message);
  const lower = text.toLowerCase();
  const priority = detectPriority(text, analysis);
  const datetimeHint = analysis.datetime_hint || detectDatetimeHint(text);
  const projectName = analysis.project_name || null;
  const durationMin = detectDurationMinutes(text);
  const energyMode = detectEnergyMode(text);
  const executionMode = detectExecutionMode(text, analysis);
  const roadmapMilestone = detectRoadmapMilestone(text, projectName);

  if (action) {
    executiveActions.push(
      buildExecutiveAction({
        userId,
        type: action.action_type || action.type || 'local_action',
        title: action.title || action.label || text,
        description: action.target || text,
        priority: action.priority || priority,
        datetimeHint: action.datetime_hint || datetimeHint,
        projectName: action.project_name || projectName,
        provider: action.provider || 'local',
        confidence: 0.94,
        reason: 'Action structurée déjà détectée par Nyra.',
        payload: {
          action_id: action.id || null,
          label: action.label || null,
          target: action.target || null,
          execution_mode: executionMode,
        },
        display: {
          icon: '✔️',
          color: 'purple',
          category: 'local_action',
          cta_label: 'Voir action',
          secondary_label: 'Ignorer',
        },
      })
    );
  }

  if (
    includesAny(lower, ['focus', 'session focus', 'deep work', 'concentration', 'sprint']) ||
    (durationMin && analysis.is_project)
  ) {
    executiveActions.push(
      buildExecutiveAction({
        userId,
        type: 'focus_session',
        title: projectName
          ? `Session focus — ${projectName}`
          : cleanActionTitle(text),
        description: text,
        priority: priority === 'normal' && datetimeHint ? 'high' : priority,
        datetimeHint,
        projectName,
        provider: 'local',
        confidence: 0.9,
        reason: 'Le message indique une session de concentration ou un bloc de travail.',
        payload: {
          duration_min: durationMin || 60,
          energy_mode: energyMode,
          project_name: projectName,
          needs_exact_time: Boolean(datetimeHint && !includesAny(lower, ['14h', '15h', '16h', '17h', '18h', '19h', '20h'])),
          suggested_structure: [
            'Clarifier le résultat attendu',
            'Couper les distractions',
            'Travailler en bloc unique',
            'Noter la prochaine action',
          ],
        },
        display: {
          icon: '🎯',
          color: 'indigo',
          category: 'focus',
          cta_label: 'Planifier focus',
          secondary_label: 'Garder en tâche',
        },
      })
    );
  }

  if (analysis.is_task) {
    executiveActions.push(
      buildExecutiveAction({
        userId,
        type: 'create_google_task',
        title: text,
        description: text,
        priority,
        datetimeHint,
        projectName,
        provider: 'google_tasks',
        confidence: 0.9,
        reason: 'Le message contient une tâche ou une action à faire.',
        payload: {
          title: cleanActionTitle(text),
          notes: text,
          due_hint: datetimeHint,
          project_name: projectName,
          energy_mode: energyMode,
        },
        display: {
          icon: '✅',
          color: 'amber',
          category: 'task',
          cta_label: 'Créer la tâche',
          secondary_label: 'Garder local',
        },
      })
    );
  }

  if (analysis.urgency === 'high' || datetimeHint === 'today') {
    executiveActions.push(
      buildExecutiveAction({
        userId,
        type: 'add_to_today',
        title: text,
        description: text,
        priority: 'high',
        datetimeHint: datetimeHint || 'today',
        projectName,
        provider: 'local',
        confidence: 0.86,
        reason: 'Le message semble important ou à traiter rapidement.',
        payload: {
          bucket: 'today',
          content: text,
          project_name: projectName,
          energy_mode: energyMode,
        },
        display: {
          icon: '📌',
          color: 'red',
          category: 'today',
          cta_label: 'Ajouter à aujourd’hui',
          secondary_label: 'Pas maintenant',
        },
      })
    );
  }

  if (
    datetimeHint &&
    includesAny(lower, ['planifie', 'planning', 'agenda', 'calendrier', 'créneau', 'creneau', 'rendez-vous', 'rdv', 'session', 'demain', 'ce soir'])
  ) {
    executiveActions.push(
      buildExecutiveAction({
        userId,
        type: 'create_calendar_event',
        title: text,
        description: text,
        priority,
        datetimeHint,
        projectName,
        provider: 'google_calendar',
        confidence: 0.82,
        reason: 'Le message contient un indice de planification ou de moment.',
        payload: {
          title: cleanActionTitle(text),
          description: text,
          datetime_hint: datetimeHint,
          timezone: 'Europe/Paris',
          duration_minutes: durationMin || 60,
          needs_exact_time: true,
          project_name: projectName,
        },
        display: {
          icon: '📅',
          color: 'green',
          category: 'calendar',
          cta_label: 'Créer événement',
          secondary_label: 'Choisir heure',
        },
      })
    );
  }

  if (analysis.is_project) {
    executiveActions.push(
      buildExecutiveAction({
        userId,
        type: 'roadmap_action',
        title: text,
        description: text,
        priority,
        datetimeHint,
        projectName,
        provider: 'local',
        confidence: 0.86,
        reason: 'Le message est lié à un projet actif et peut nourrir la roadmap.',
        payload: {
          project_name: projectName,
          milestone: roadmapMilestone,
          content: text,
          dependency_hint: includesAny(lower, ['avant', 'après', 'apres', 'dépend', 'depend']) ? 'has_dependency' : null,
          recommended_order: includesAny(lower, ['avant']) ? 'before_next_phase' : 'normal',
        },
        display: {
          icon: '🗺️',
          color: 'blue',
          category: 'roadmap',
          cta_label: 'Ajouter roadmap',
          secondary_label: 'Voir projet',
        },
      })
    );

    if (includesAny(lower, ['cahier des charges', 'structure', 'structurer', 'fonctionnalité', 'fonctionnalite', 'mvp', 'roadmap', 'architecture'])) {
      executiveActions.push(
        buildExecutiveAction({
          userId,
          type: 'create_project_spec',
          title: projectName ? `Cahier des charges — ${projectName}` : text,
          description: text,
          priority,
          datetimeHint,
          projectName,
          provider: 'google_drive',
          confidence: 0.82,
          reason: 'Le message contient une intention de structuration projet.',
          payload: {
            project_name: projectName,
            content: text,
            exportable_to_drive: true,
            suggested_sections: [
              'Vision',
              'Objectifs',
              'Fonctionnalités',
              'Roadmap',
              'Questions à clarifier',
            ],
          },
          display: {
            icon: '📄',
            color: 'purple',
            category: 'project_spec',
            cta_label: 'Générer cahier',
            secondary_label: 'Voir projet',
          },
        })
      );
    }
  }

  if (analysis.is_emotion && energyMode === 'emotional_regulation') {
    executiveActions.push(
      buildExecutiveAction({
        userId,
        type: 'breathing_reset',
        title: 'Reset émotionnel rapide',
        description: text,
        priority,
        datetimeHint,
        projectName,
        provider: 'local',
        confidence: 0.76,
        reason: 'Le message contient une charge émotionnelle à poser avant d’agir.',
        payload: {
          duration_min: 2,
          protocol: [
            'Respirer lentement 3 fois',
            'Nommer ce qui est là',
            'Choisir une micro-action',
          ],
        },
        display: {
          icon: '🌬️',
          color: 'cyan',
          category: 'regulation',
          cta_label: 'Me recentrer',
          secondary_label: 'Plus tard',
        },
      })
    );
  }

  if (
    datetimeHint &&
    executiveActions.some(item => item.type === 'create_calendar_event') &&
    !includesAny(lower, ['0h', '1h', '2h', '3h', '4h', '5h', '6h', '7h', '8h', '9h', '10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h', '18h', '19h', '20h', '21h', '22h', '23h'])
  ) {
    executiveActions.push(
      buildExecutiveAction({
        userId,
        type: 'clarify_time',
        title: 'Préciser l’heure',
        description: 'Nyra a compris le moment, mais pas encore l’heure exacte.',
        priority,
        datetimeHint,
        projectName,
        provider: 'local',
        confidence: 0.88,
        reason: 'Une action agenda nécessite une heure précise.',
        payload: {
          question: 'À quelle heure veux-tu que je le planifie ?',
          datetime_hint: datetimeHint,
        },
        display: {
          icon: '🕒',
          color: 'gray',
          category: 'clarification',
          cta_label: 'Choisir heure',
          secondary_label: 'Pas maintenant',
        },
      })
    );
  }

  const typePriority = {
    focus_session: 1,
    create_calendar_event: 2,
    create_google_task: 3,
    add_to_today: 4,
    roadmap_action: 5,
    create_project_spec: 6,
    breathing_reset: 7,
    clarify_time: 8,
  };

  const seen = new Set();

  return executiveActions
    .filter(executiveAction => {
      const key = `${executiveAction.type}:${normalizeKey(executiveAction.title)}:${executiveAction.provider}`;

      if (seen.has(key)) return false;
      seen.add(key);

      return true;
    })
    .sort((a, b) => {
      return (typePriority[a.type] || 99) - (typePriority[b.type] || 99);
    })
    .slice(0, 6);
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
    tags: action
      ? uniqueArray([
          'action',
          action.action_type,
          action.provider,
          analysis.project_name ? normalizeKey(analysis.project_name) : null,
        ])
      : analysis.tags,
    status: action ? action.status : analysis.is_task ? 'todo' : 'captured',
    project_name: analysis.project_name || null,
    project_id: null,
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

function saveCapture({ userId, message, reply, analysis, action, executiveActions }) {
  const store = readStore();

  const item = createStoredItem({
    userId,
    message,
    analysis,
    action,
  });

  let linkedProject = null;
  let createdRelation = null;
  let updatedContext = null;

  if (analysis.project_name) {
    linkedProject = ensureProject(store, userId, analysis.project_name, message);
    item.project_id = linkedProject.id;
    item.project_name = linkedProject.name;
  }

  store.items.push(item);

  if (linkedProject && !relationExists(store, userId, item.id, linkedProject.id, 'belongs_to_project')) {
    createdRelation = createRelation({
      userId,
      sourceId: item.id,
      targetId: linkedProject.id,
      relationType: 'belongs_to_project',
      confidence: 0.92,
      metadata: {
        project_name: linkedProject.name,
        detection: 'keyword_or_explicit_project',
      },
    });

    store.relations.push(createdRelation);
    updatedContext = updateProjectContext(store, userId, linkedProject);
  }

  let actionRecord = null;

  if (action) {
    actionRecord = {
      ...action,
      item_id: item.id,
      project_id: linkedProject ? linkedProject.id : null,
      project_name: linkedProject ? linkedProject.name : null,
      updated_at: nowIso(),
    };

    store.actions.push(actionRecord);

    if (linkedProject && !relationExists(store, userId, actionRecord.id, linkedProject.id, 'action_for_project')) {
      store.relations.push(
        createRelation({
          userId,
          sourceId: actionRecord.id,
          targetId: linkedProject.id,
          relationType: 'action_for_project',
          confidence: 0.9,
          metadata: {
            action_type: actionRecord.action_type,
            project_name: linkedProject.name,
          },
        })
      );
    }
  }

  store.conversations.push({
    id: crypto.randomUUID(),
    user_id: userId,
    user_message: message,
    nyra_reply: reply,
    analysis,
    action,
    executive_actions: Array.isArray(executiveActions) ? executiveActions : [],
    stored_item_id: item.id,
    action_id: actionRecord ? actionRecord.id : null,
    project_id: linkedProject ? linkedProject.id : null,
    project_name: linkedProject ? linkedProject.name : null,
    relation_id: createdRelation ? createdRelation.id : null,
    created_at: nowIso(),
  });

  store.items = store.items.slice(-500);
  store.actions = store.actions.slice(-300);
  store.conversations = store.conversations.slice(-200);
  store.projects = store.projects.slice(-100);
  store.relations = store.relations.slice(-1000);
  store.contexts = store.contexts.slice(-200);

  writeStore(store);

  return {
    item,
    action: actionRecord,
    project: linkedProject,
    relation: createdRelation,
    context: updatedContext,
  };
}

function getStoreSummary(userId) {
  const store = readStore();

  const userItems = store.items.filter(item => item.user_id === userId);
  const userActions = store.actions.filter(action => action.user_id === userId);
  const userProjects = store.projects.filter(project => project.user_id === userId);
  const userRelations = store.relations.filter(relation => relation.user_id === userId);
  const userContexts = store.contexts.filter(context => context.user_id === userId);

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
    project_count: userProjects.length,
    relation_count: userRelations.length,
    context_count: userContexts.length,
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

    if (action.connection_type === 'google_drive') {
      return '✔ Action préparée. Il faudra connecter Google Drive pour l’exporter.';
    }

    return '✔ Action préparée. Une connexion externe sera nécessaire pour la synchroniser.';
  }

  if (action.action_type === 'add_to_today') return '✔ Ajouté à tes priorités d’aujourd’hui.';
  if (action.action_type === 'create_reminder') return '✔ Rappel préparé. Prochaine étape : choisir l’heure exacte.';
  if (action.action_type === 'plan_now') return '✔ Plan créé : fais une seule action simple maintenant.';
  if (action.action_type === 'process_now') return '✔ On traite maintenant : commence par la plus petite action possible.';
  if (action.action_type === 'classify_as_idea') return '✔ Classé dans tes idées.';
  if (action.action_type === 'idea_to_task') return '✔ Transformé en tâche concrète.';
  if (action.action_type === 'add_to_roadmap') return '✔ Ajouté à la roadmap projet.';
  if (action.action_type === 'create_project_spec') {
    return '✔ Idée capturée. Prochaine étape : la transformer en cahier des charges structuré.';
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
- si c’est une tâche : reformule clairement l’action et la prochaine étape
- si c’est une idée : dis que l’idée est capturée et propose où la ranger
- si c’est une émotion : valide brièvement et aide à poser le poids
- si c’est un projet : dis que c’est relié au projet concerné si un projet est détecté
- si c’est une session de travail : aide à cadrer le focus simplement
- si c’est mixte : trie mentalement pour l’utilisateur
- tu peux dire que c’est capturé dans Nyra
- ne parle pas de fichier JSON
- ne parle pas de tes mécanismes internes
`.trim();
}

function buildProjectSpecPrompt(project, items, existingContext) {
  const captures = items
    .slice(-40)
    .map((item, index) => {
      return `${index + 1}. [${item.type || item.bucket || 'note'}] ${item.content || item.title}`;
    })
    .join('\n');

  return `
Tu es Nyra, une IA de structuration projet.

Tu dois transformer des captures brutes en cahier des charges clair, exploitable, premium et structuré.

Projet :
${project.name}

Description actuelle :
${project.description || 'Aucune description.'}

Contexte existant :
${existingContext?.summary || 'Aucun contexte existant.'}

Captures liées au projet :
${captures || 'Aucune capture liée.'}

Génère un cahier des charges en français, au format Markdown.

Structure obligatoire :

# Cahier des charges — ${project.name}

## 1. Vision du projet
Explique l’intention globale du projet.

## 2. Problème à résoudre
Décris le problème principal.

## 3. Objectif principal
Décris le résultat recherché.

## 4. Utilisateurs concernés
Liste les types d’utilisateurs.

## 5. Fonctionnalités principales
Liste les fonctionnalités importantes.

## 6. Fonctionnalités MVP
Liste ce qui doit être construit en premier.

## 7. Parcours utilisateur
Décris le parcours simple.

## 8. Données à stocker
Liste les données importantes.

## 9. Automatisations intelligentes
Liste ce que l’IA doit comprendre, organiser ou proposer.

## 10. Contraintes importantes
Liste les contraintes techniques, UX ou produit.

## 11. Roadmap recommandée
Découpe en étapes claires.

## 12. Questions à clarifier
Liste les zones encore floues.

## 13. Prochaine meilleure action
Donne une seule action concrète à faire ensuite.

Règles :
- sois structuré
- sois concret
- ne fais pas semblant d’avoir des informations absentes
- quand une info manque, mets-la dans “Questions à clarifier”
- ne parle pas de JSON
- ne parle pas de mécanismes internes
`.trim();
}

async function generateProjectSpec({ project, items, existingContext }) {
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.35,
    max_tokens: 1800,
    messages: [
      {
        role: 'system',
        content: 'Tu es une IA experte en cahiers des charges produit, UX, architecture fonctionnelle et structuration de projets.',
      },
      {
        role: 'user',
        content: buildProjectSpecPrompt(project, items, existingContext),
      },
    ],
  });

  return normalizeMultilineText(completion.choices?.[0]?.message?.content) ||
    `# Cahier des charges — ${project.name}\n\nImpossible de générer le cahier des charges pour le moment.`;
}

function saveProjectSpecContext({ store, userId, project, specMarkdown, relatedItems }) {
  let specContext = store.contexts.find(context => {
    return (
      context.user_id === userId &&
      context.context_type === 'project_spec' &&
      context.project_id === project.id
    );
  });

  if (!specContext) {
    specContext = {
      id: crypto.randomUUID(),
      user_id: userId,
      context_type: 'project_spec',
      project_id: project.id,
      name: `Cahier des charges — ${project.name}`,
      summary: '',
      content: '',
      format: 'markdown',
      version_number: 1,
      related_items: [],
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    store.contexts.push(specContext);
  } else {
    specContext.version_number = Number(specContext.version_number || 1) + 1;
  }

  specContext.summary = `Cahier des charges généré pour le projet ${project.name}.`;
  specContext.content = normalizeMultilineText(specMarkdown);
  specContext.format = 'markdown';
  specContext.related_items = relatedItems.map(item => item.id);
  specContext.updated_at = nowIso();

  project.updated_at = nowIso();
  project.has_project_spec = true;
  project.project_spec_context_id = specContext.id;

  return specContext;
}

function getLatestProjectSpec(store, userId, projectId) {
  const specs = store.contexts
    .filter(context => {
      return (
        context.user_id === userId &&
        context.context_type === 'project_spec' &&
        context.project_id === projectId
      );
    })
    .sort((a, b) => {
      return new Date(b.updated_at || b.created_at || 0).getTime() -
        new Date(a.updated_at || a.created_at || 0).getTime();
    });

  return specs[0] || null;
}

function createGoogleOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function findGoogleAccountByIdentity(store, { userId, googleUserId, email }) {
  return store.connected_accounts.find(account => {
    const sameProvider =
      account.provider === 'google' &&
      account.connection_type === 'google_drive';

    if (!sameProvider) return false;

    return (
      account.user_id === userId ||
      account.legacy_user_id === userId ||
      account.google_user_id === googleUserId ||
      account.email === email
    );
  });
}

function getGoogleDriveAccount(store, userId) {
  return store.connected_accounts.find(account => {
    return (
      account.provider === 'google' &&
      account.connection_type === 'google_drive' &&
      account.status === 'connected' &&
      (
        account.user_id === userId ||
        account.legacy_user_id === userId ||
        account.google_user_id === userId
      )
    );
  });
}

function upsertGoogleUser(store, googleProfile, requestedUserId) {
  const googleUserId = normalizeText(googleProfile.id || '');
  const email = normalizeText(googleProfile.email || '');
  const realUserId = buildGoogleNyraUserId(googleUserId, email);

  let user = store.users.find(existingUser => {
    return (
      existingUser.id === realUserId ||
      existingUser.google_user_id === googleUserId ||
      existingUser.email === email
    );
  });

  if (!user) {
    user = {
      id: realUserId,
      provider: 'google',
      google_user_id: googleUserId || null,
      email: email || null,
      name: googleProfile.name || null,
      picture: googleProfile.picture || null,
      legacy_user_id: requestedUserId || null,
      access_type: requestedUserId === 'local-user' ? 'founder_or_local' : 'standard',
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    store.users.push(user);
  } else {
    user.provider = 'google';
    user.google_user_id = googleUserId || user.google_user_id || null;
    user.email = email || user.email || null;
    user.name = googleProfile.name || user.name || null;
    user.picture = googleProfile.picture || user.picture || null;
    user.legacy_user_id = user.legacy_user_id || requestedUserId || null;
    user.updated_at = nowIso();
  }

  return user;
}

async function getAuthenticatedGoogleClient(userId) {
  const store = readStore();
  const account = getGoogleDriveAccount(store, userId);

  if (!account || !account.tokens) {
    return {
      ok: false,
      error: 'GOOGLE_NOT_CONNECTED',
    };
  }

  const oauth2Client = createGoogleOAuthClient();

  oauth2Client.setCredentials(account.tokens);

  oauth2Client.on('tokens', tokens => {
    const freshStore = readStore();
    const freshAccount = getGoogleDriveAccount(freshStore, userId);

    if (freshAccount) {
      freshAccount.tokens = {
        ...freshAccount.tokens,
        ...tokens,
      };
      freshAccount.updated_at = nowIso();
      writeStore(freshStore);
    }
  });

  return {
    ok: true,
    oauth2Client,
    account,
  };
}

async function getAuthenticatedDriveClient(userId) {
  const authResult = await getAuthenticatedGoogleClient(userId);

  if (!authResult.ok) {
    return {
      ok: false,
      error: 'GOOGLE_DRIVE_NOT_CONNECTED',
    };
  }

  const drive = google.drive({
    version: 'v3',
    auth: authResult.oauth2Client,
  });

  return {
    ok: true,
    drive,
    account: authResult.account,
  };
}

async function getAuthenticatedCalendarClient(userId) {
  const authResult = await getAuthenticatedGoogleClient(userId);

  if (!authResult.ok) {
    return {
      ok: false,
      error: 'GOOGLE_CALENDAR_NOT_CONNECTED',
    };
  }

  const calendar = google.calendar({
    version: 'v3',
    auth: authResult.oauth2Client,
  });

  return {
    ok: true,
    calendar,
    account: authResult.account,
  };
}

async function getAuthenticatedTasksClient(userId) {
  const authResult = await getAuthenticatedGoogleClient(userId);

  if (!authResult.ok) {
    return {
      ok: false,
      error: 'GOOGLE_TASKS_NOT_CONNECTED',
    };
  }

  const tasks = google.tasks({
    version: 'v1',
    auth: authResult.oauth2Client,
  });

  return {
    ok: true,
    tasks,
    account: authResult.account,
  };
}

async function findOrCreateDriveFolder(drive, folderName) {
  const safeFolderName = normalizeText(folderName || 'Nyra');

  const search = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${safeFolderName.replace(/'/g, "\\'")}' and trashed=false`,
    spaces: 'drive',
    fields: 'files(id, name)',
    pageSize: 1,
  });

  const existingFolder = search.data.files?.[0];

  if (existingFolder?.id) {
    return existingFolder;
  }

  const created = await drive.files.create({
    requestBody: {
      name: safeFolderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id, name',
  });

  return created.data;
}

async function uploadProjectSpecAsGoogleDoc({ userId, project, markdown }) {
  const authResult = await getAuthenticatedDriveClient(userId);

  if (!authResult.ok) {
    return authResult;
  }

  const drive = authResult.drive;
  const rootFolder = await findOrCreateDriveFolder(drive, 'Nyra');
  const specsFolder = await findOrCreateDriveFolder(drive, 'Nyra - Cahiers des charges');

  const fileName = `${buildSafeFileName(project.name)}-cahier-des-charges`;
  const html = markdownToGoogleDocHtml(markdown, `Cahier des charges — ${project.name}`);

  const uploaded = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [specsFolder.id || rootFolder.id],
      mimeType: 'application/vnd.google-apps.document',
    },
    media: {
      mimeType: 'text/html',
      body: Readable.from([html]),
    },
    fields: 'id, name, mimeType, webViewLink, webContentLink, createdTime',
  });

  return {
    ok: true,
    file: uploaded.data,
    fileName,
  };
}

async function handleExportProjectSpecToDrive(req, res, routeLabel) {
  const startedAt = Date.now();

  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const projectId = normalizeText(req.params.projectId);

  try {
    const store = readStore();

    const project = store.projects.find(item => {
      return item.user_id === userId && item.id === projectId;
    });

    if (!project) {
      return res.status(404).json({
        ok: false,
        error: 'Projet introuvable',
      });
    }

    const projectSpec = getLatestProjectSpec(store, userId, project.id);

    if (!projectSpec || !projectSpec.content) {
      return res.status(404).json({
        ok: false,
        error: 'Aucun cahier des charges trouvé pour ce projet',
      });
    }

    const uploadResult = await uploadProjectSpecAsGoogleDoc({
      userId,
      project,
      markdown: projectSpec.content,
    });

    if (!uploadResult.ok) {
      return res.status(401).json({
        ok: false,
        error: uploadResult.error,
        connect_url: `/auth/google?userId=${encodeURIComponent(userId)}`,
        full_connect_url: `https://nyra-backend-production-d168.up.railway.app/auth/google?userId=${encodeURIComponent(userId)}`,
      });
    }

    project.last_drive_export = {
      file_id: uploadResult.file.id,
      file_name: uploadResult.file.name,
      mime_type: uploadResult.file.mimeType || null,
      web_view_link: uploadResult.file.webViewLink || null,
      web_content_link: uploadResult.file.webContentLink || null,
      exported_at: nowIso(),
      route_used: routeLabel,
      export_format: 'google_doc',
    };
    project.updated_at = nowIso();

    store.actions.push({
      id: crypto.randomUUID(),
      user_id: userId,
      action_type: 'export_project_spec_to_drive',
      type: 'export_project_spec_to_drive',
      label: 'Exporter vers Google Drive',
      title: `Exporter ${project.name} vers Google Drive`,
      target: project.name,
      status: 'done',
      priority: 'normal',
      datetime_hint: null,
      next_step: 'Le cahier des charges est sauvegardé dans Google Drive au format Google Docs.',
      provider: 'google_drive',
      sync_status: 'synced',
      external_id: uploadResult.file.id,
      requires_connection: true,
      connection_type: 'google_drive',
      project_id: project.id,
      project_name: project.name,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    writeStore(store);

    return res.json({
      ok: true,
      userId,
      project,
      drive_file: uploadResult.file,
      file_name: uploadResult.fileName,
      drive_link: uploadResult.file.webViewLink || null,
      file_id: uploadResult.file.id,
      export_format: 'google_doc',
      message: 'Cahier des charges exporté vers Google Drive au format Google Docs.',
      perf: {
        total_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error(`❌ ${routeLabel} error:`, error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur export Google Drive',
      details: error.message,
    });
  }
}

async function handleCreateCalendarEvent(req, res) {
  const startedAt = Date.now();

  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const title = normalizeText(req.body?.title || '');
  const description = normalizeMultilineText(req.body?.description || '');
  const startTime = normalizeText(req.body?.startTime || '');
  const endTime = normalizeText(req.body?.endTime || '');
  const timezone = normalizeText(req.body?.timezone || 'Europe/Paris');
  const location = normalizeText(req.body?.location || '');
  const calendarId = normalizeText(req.body?.calendarId || 'primary');

  if (!title) {
    return res.status(400).json({
      ok: false,
      error: 'Titre manquant',
    });
  }

  if (!startTime || !endTime) {
    return res.status(400).json({
      ok: false,
      error: 'startTime et endTime sont obligatoires',
    });
  }

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({
      ok: false,
      error: 'Format de date invalide',
    });
  }

  if (endDate <= startDate) {
    return res.status(400).json({
      ok: false,
      error: 'La date de fin doit être après la date de début',
    });
  }

  try {
    const authResult = await getAuthenticatedCalendarClient(userId);

    if (!authResult.ok) {
      return res.status(401).json({
        ok: false,
        error: authResult.error,
        connect_url: `/auth/google?userId=${encodeURIComponent(userId)}`,
        full_connect_url: `https://nyra-backend-production-d168.up.railway.app/auth/google?userId=${encodeURIComponent(userId)}`,
      });
    }

    const eventBody = {
      summary: title,
      description: description || 'Événement créé depuis Nyra.',
      location: location || undefined,
      start: {
        dateTime: startTime,
        timeZone: timezone,
      },
      end: {
        dateTime: endTime,
        timeZone: timezone,
      },
      reminders: {
        useDefault: true,
      },
    };

    const created = await authResult.calendar.events.insert({
      calendarId,
      requestBody: eventBody,
    });

    const store = readStore();

    store.actions.push({
      id: crypto.randomUUID(),
      user_id: userId,
      action_type: 'create_calendar_event',
      type: 'create_calendar_event',
      label: 'Créer un événement Google Agenda',
      title,
      target: description || title,
      status: 'done',
      priority: 'normal',
      datetime_hint: null,
      next_step: 'L’événement est créé dans Google Agenda.',
      provider: 'google_calendar',
      sync_status: 'synced',
      external_id: created.data.id || null,
      external_link: created.data.htmlLink || null,
      requires_connection: true,
      connection_type: 'google_calendar',
      calendar_id: calendarId,
      event_start: startTime,
      event_end: endTime,
      event_timezone: timezone,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    store.actions = store.actions.slice(-300);

    writeStore(store);

    return res.json({
      ok: true,
      userId,
      calendar_event: created.data,
      event_id: created.data.id || null,
      event_link: created.data.htmlLink || null,
      message: 'Événement créé dans Google Agenda.',
      perf: {
        total_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error('❌ /calendar/create-event error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur création événement Google Agenda',
      details: error.message,
    });
  }
}

async function handleCreateGoogleTask(req, res) {
  const startedAt = Date.now();

  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const title = normalizeText(req.body?.title || '');
  const notes = normalizeMultilineText(req.body?.notes || req.body?.description || '');
  const due = normalizeText(req.body?.due || '');
  const taskListId = normalizeText(req.body?.taskListId || '@default');

  if (!title) {
    return res.status(400).json({
      ok: false,
      error: 'Titre manquant',
    });
  }

  if (due) {
    const dueDate = new Date(due);

    if (Number.isNaN(dueDate.getTime())) {
      return res.status(400).json({
        ok: false,
        error: 'Format de date due invalide',
      });
    }
  }

  try {
    const authResult = await getAuthenticatedTasksClient(userId);

    if (!authResult.ok) {
      return res.status(401).json({
        ok: false,
        error: authResult.error,
        connect_url: `/auth/google?userId=${encodeURIComponent(userId)}`,
        full_connect_url: `https://nyra-backend-production-d168.up.railway.app/auth/google?userId=${encodeURIComponent(userId)}`,
      });
    }

    const taskBody = {
      title,
      notes: notes || undefined,
      due: due || undefined,
      status: 'needsAction',
    };

    const created = await authResult.tasks.tasks.insert({
      tasklist: taskListId,
      requestBody: taskBody,
    });

    const store = readStore();

    store.actions.push({
      id: crypto.randomUUID(),
      user_id: userId,
      action_type: 'create_google_task',
      type: 'create_google_task',
      label: 'Créer une tâche Google Tasks',
      title,
      target: notes || title,
      status: 'done',
      priority: 'normal',
      datetime_hint: due ? 'scheduled' : null,
      next_step: 'La tâche est créée dans Google Tasks.',
      provider: 'google_tasks',
      sync_status: 'synced',
      external_id: created.data.id || null,
      external_link: created.data.webViewLink || null,
      requires_connection: true,
      connection_type: 'google_tasks',
      task_list_id: taskListId,
      task_due: due || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    store.actions = store.actions.slice(-300);

    writeStore(store);

    return res.json({
      ok: true,
      userId,
      google_task: created.data,
      task_id: created.data.id || null,
      task_link: created.data.webViewLink || null,
      message: 'Tâche créée dans Google Tasks.',
      perf: {
        total_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error('❌ /tasks/create-task error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur création tâche Google Tasks',
      details: error.message,
    });
  }
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    app: 'Nyra backend',
    version: STORE_VERSION,
    google_configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
  });
});

app.get('/auth/google', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Google OAuth non configuré côté serveur.');
  }

  const oauth2Client = createGoogleOAuthClient();

  const state = Buffer.from(
    JSON.stringify({
      userId,
      nonce: crypto.randomUUID(),
      created_at: nowIso(),
    })
  ).toString('base64url');

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  });

  return res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const code = normalizeText(req.query?.code || '');
    const rawState = normalizeText(req.query?.state || '');

    if (!code) {
      return res.status(400).send('Code Google manquant.');
    }

    let requestedUserId = 'local-user';

    if (rawState) {
      try {
        const parsedState = JSON.parse(Buffer.from(rawState, 'base64url').toString('utf8'));
        requestedUserId = normalizeText(parsedState.userId || 'local-user');
      } catch {
        requestedUserId = 'local-user';
      }
    }

    const oauth2Client = createGoogleOAuthClient();
    const tokenResponse = await oauth2Client.getToken(code);
    const tokens = tokenResponse.tokens;

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      version: 'v2',
      auth: oauth2Client,
    });

    const userInfo = await oauth2.userinfo.get();

    const store = readStore();

    const googleUser = upsertGoogleUser(store, userInfo.data, requestedUserId);
    const googleUserId = normalizeText(userInfo.data.id || '');
    const googleEmail = normalizeText(userInfo.data.email || '');

    let account = findGoogleAccountByIdentity(store, {
      userId: requestedUserId,
      googleUserId,
      email: googleEmail,
    });

    if (!account) {
      account = {
        id: crypto.randomUUID(),
        user_id: googleUser.id,
        legacy_user_id: requestedUserId,
        provider: 'google',
        connection_type: 'google_drive',
        status: 'connected',
        google_user_id: googleUserId || null,
        email: googleEmail || null,
        name: userInfo.data.name || null,
        picture: userInfo.data.picture || null,
        scopes: GOOGLE_SCOPES,
        tokens,
        created_at: nowIso(),
        updated_at: nowIso(),
      };

      store.connected_accounts.push(account);
    } else {
      account.user_id = googleUser.id;
      account.legacy_user_id = account.legacy_user_id || requestedUserId;
      account.status = 'connected';
      account.google_user_id = googleUserId || account.google_user_id || null;
      account.email = googleEmail || account.email || null;
      account.name = userInfo.data.name || account.name || null;
      account.picture = userInfo.data.picture || account.picture || null;
      account.scopes = GOOGLE_SCOPES;
      account.tokens = {
        ...account.tokens,
        ...tokens,
        refresh_token: tokens.refresh_token || account.tokens?.refresh_token,
      };
      account.updated_at = nowIso();
    }

    writeStore(store);

    console.log('✅ GOOGLE USER CONNECTED:', {
      user_id: googleUser.id,
      legacy_user_id: requestedUserId,
      email: googleEmail,
      scopes: GOOGLE_SCOPES,
    });

    return res.send(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Nyra — Google connecté</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              background: #050505;
              color: #fff;
              font-family: Arial, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
            }
            .card {
              max-width: 520px;
              background: #111;
              border: 1px solid #7c3aed;
              border-radius: 24px;
              padding: 28px;
              box-shadow: 0 0 28px rgba(168, 85, 247, 0.25);
            }
            h1 {
              margin: 0 0 12px;
              font-size: 26px;
            }
            p {
              color: #d4d4d8;
              line-height: 1.5;
            }
            .email {
              color: #d8b4fe;
              font-weight: 700;
            }
            .small {
              font-size: 12px;
              color: #a1a1aa;
              word-break: break-all;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Google est connecté à Nyra ✅</h1>
            <p>Compte connecté : <span class="email">${googleEmail || 'Google'}</span></p>
            <p>Drive, Agenda et Tasks sont maintenant autorisés côté backend.</p>
            <p class="small">User ID Nyra : ${googleUser.id}</p>
            <p>Tu peux revenir dans Nyra.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ /auth/google/callback error:', error.message);

    return res.status(500).send(`
      <h1>Erreur connexion Google</h1>
      <p>${error.message}</p>
    `);
  }
});

app.get('/auth/me', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const account = getGoogleDriveAccount(store, userId);

  if (!account) {
    return res.json({
      ok: true,
      connected: false,
      userId,
      user: null,
      account: null,
      connect_url: `/auth/google?userId=${encodeURIComponent(userId)}`,
      full_connect_url: `https://nyra-backend-production-d168.up.railway.app/auth/google?userId=${encodeURIComponent(userId)}`,
    });
  }

  const user = store.users.find(existingUser => {
    return (
      existingUser.id === account.user_id ||
      existingUser.google_user_id === account.google_user_id ||
      existingUser.email === account.email
    );
  });

  return res.json({
    ok: true,
    connected: true,
    userId,
    effective_user_id: account.user_id,
    legacy_user_id: account.legacy_user_id || null,
    user: user || null,
    account: {
      id: account.id,
      user_id: account.user_id,
      legacy_user_id: account.legacy_user_id || null,
      provider: account.provider,
      connection_type: account.connection_type,
      status: account.status,
      google_user_id: account.google_user_id || null,
      email: account.email || null,
      name: account.name || null,
      picture: account.picture || null,
      scopes: account.scopes || [],
      has_tokens: Boolean(account.tokens),
      has_refresh_token: Boolean(account.tokens?.refresh_token),
      created_at: account.created_at,
      updated_at: account.updated_at,
    },
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

app.get('/store/projects', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const projects = store.projects.filter(project => project.user_id === userId);

  res.json({
    ok: true,
    userId,
    count: projects.length,
    projects,
  });
});

app.get('/store/relations', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const relations = store.relations.filter(relation => relation.user_id === userId);

  res.json({
    ok: true,
    userId,
    count: relations.length,
    relations,
  });
});

app.get('/store/contexts', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const contexts = store.contexts.filter(context => context.user_id === userId);

  res.json({
    ok: true,
    userId,
    count: contexts.length,
    contexts,
  });
});

app.get('/store/connected-accounts', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const accounts = store.connected_accounts
    .filter(account => {
      return (
        account.user_id === userId ||
        account.legacy_user_id === userId ||
        account.google_user_id === userId
      );
    })
    .map(account => ({
      id: account.id,
      user_id: account.user_id,
      legacy_user_id: account.legacy_user_id || null,
      provider: account.provider,
      connection_type: account.connection_type,
      status: account.status,
      google_user_id: account.google_user_id || null,
      email: account.email || null,
      name: account.name || null,
      picture: account.picture || null,
      scopes: account.scopes || [],
      created_at: account.created_at,
      updated_at: account.updated_at,
      has_tokens: Boolean(account.tokens),
      has_refresh_token: Boolean(account.tokens?.refresh_token),
    }));

  res.json({
    ok: true,
    userId,
    count: accounts.length,
    accounts,
  });
});

app.get('/store/project/:projectId', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const projectId = normalizeText(req.params.projectId);
  const store = readStore();

  const project = store.projects.find(item => {
    return item.user_id === userId && item.id === projectId;
  });

  if (!project) {
    return res.status(404).json({
      ok: false,
      error: 'Projet introuvable',
    });
  }

  const { relations, items } = getProjectRelatedItems(store, userId, project.id);

  const context = store.contexts.find(existingContext => {
    return (
      existingContext.user_id === userId &&
      existingContext.context_type === 'project' &&
      existingContext.project_id === project.id
    );
  });

  const projectSpec = getLatestProjectSpec(store, userId, project.id);

  res.json({
    ok: true,
    userId,
    project,
    context: context || null,
    project_spec: projectSpec || null,
    relations,
    items,
  });
});

app.post('/store/project/:projectId/spec', async (req, res) => {
  const startedAt = Date.now();

  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const projectId = normalizeText(req.params.projectId);

  try {
    const store = readStore();

    const project = store.projects.find(item => {
      return item.user_id === userId && item.id === projectId;
    });

    if (!project) {
      return res.status(404).json({
        ok: false,
        error: 'Projet introuvable',
      });
    }

    const { items } = getProjectRelatedItems(store, userId, project.id);

    const existingContext = store.contexts.find(context => {
      return (
        context.user_id === userId &&
        context.context_type === 'project' &&
        context.project_id === project.id
      );
    });

    const specMarkdown = await generateProjectSpec({
      project,
      items,
      existingContext,
    });

    const specContext = saveProjectSpecContext({
      store,
      userId,
      project,
      specMarkdown,
      relatedItems: items,
    });

    writeStore(store);

    res.json({
      ok: true,
      userId,
      project,
      project_spec: specContext,
      markdown: specMarkdown,
      perf: {
        total_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error('❌ /store/project/:projectId/spec error:', error.message);

    res.status(500).json({
      ok: false,
      error: 'Erreur génération cahier des charges',
    });
  }
});

app.get('/store/project/:projectId/export-markdown', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const projectId = normalizeText(req.params.projectId);

  try {
    const store = readStore();

    const project = store.projects.find(item => {
      return item.user_id === userId && item.id === projectId;
    });

    if (!project) {
      return res.status(404).json({
        ok: false,
        error: 'Projet introuvable',
      });
    }

    const projectSpec = getLatestProjectSpec(store, userId, project.id);

    if (!projectSpec || !projectSpec.content) {
      return res.status(404).json({
        ok: false,
        error: 'Aucun cahier des charges trouvé pour ce projet',
      });
    }

    const fileName = `${buildSafeFileName(project.name)}-cahier-des-charges.md`;

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Nyra-File-Name', fileName);

    return res.send(projectSpec.content);
  } catch (error) {
    console.error('❌ /store/project/:projectId/export-markdown error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur export markdown',
    });
  }
});

app.post('/store/project/:projectId/export-google-drive', async (req, res) => {
  return handleExportProjectSpecToDrive(req, res, '/store/project/:projectId/export-google-drive');
});

app.post('/store/project/:projectId/export-drive', async (req, res) => {
  return handleExportProjectSpecToDrive(req, res, '/store/project/:projectId/export-drive');
});

app.post('/calendar/create-event', async (req, res) => {
  return handleCreateCalendarEvent(req, res);
});

app.post('/tasks/create-task', async (req, res) => {
  return handleCreateGoogleTask(req, res);
});


function resolveExecutionDateRange(datetimeHint, durationMinutes) {
  const duration = Number(durationMinutes || 60);
  const now = new Date();
  const start = new Date(now);

  if (datetimeHint === 'tomorrow_morning') {
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
  } else if (datetimeHint === 'tomorrow_afternoon') {
    start.setDate(start.getDate() + 1);
    start.setHours(14, 0, 0, 0);
  } else if (datetimeHint === 'tomorrow_evening') {
    start.setDate(start.getDate() + 1);
    start.setHours(19, 0, 0, 0);
  } else if (datetimeHint === 'tomorrow') {
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
  } else if (datetimeHint === 'today') {
    start.setHours(start.getHours() + 1, 0, 0, 0);
  } else if (datetimeHint === 'this_week') {
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
  } else if (datetimeHint === 'weekend') {
    const day = start.getDay();
    const daysUntilSaturday = day === 6 ? 0 : (6 - day + 7) % 7;
    start.setDate(start.getDate() + daysUntilSaturday);
    start.setHours(10, 0, 0, 0);
  } else {
    start.setHours(start.getHours() + 1, 0, 0, 0);
  }

  const end = new Date(start.getTime() + duration * 60 * 1000);

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function getActionExecutionKey(action) {
  return `${action?.type || action?.action_type || 'action'}:${normalizeKey(action?.title || action?.description || '')}`;
}

function saveExecutedActionRecord({ userId, action, provider, status, externalId, externalLink, resultMessage, payload }) {
  const store = readStore();
  const actionType = action?.type || action?.action_type || 'executive_action';

  const record = {
    id: crypto.randomUUID(),
    user_id: userId,
    action_type: actionType,
    type: actionType,
    label: action?.display?.cta_label || action?.subtitle || 'Action exécutée',
    title: action?.title || 'Action Nyra',
    target: action?.description || action?.title || '',
    status,
    priority: action?.priority || 'normal',
    datetime_hint: action?.datetime_hint || null,
    next_step: resultMessage || 'Action exécutée.',
    provider: provider || action?.provider || 'local',
    sync_status: status === 'done' ? 'synced' : 'failed',
    external_id: externalId || null,
    external_link: externalLink || null,
    requires_connection: Boolean(action?.provider && action.provider !== 'local'),
    connection_type: action?.provider || null,
    project_name: action?.project_name || action?.payload?.project_name || null,
    execution_key: getActionExecutionKey(action),
    executive_action_id: action?.id || null,
    payload: payload || action?.payload || {},
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  store.actions.push(record);
  store.actions = store.actions.slice(-500);
  writeStore(store);

  return record;
}

async function executeGoogleTaskAction(userId, action) {
  const authResult = await getAuthenticatedTasksClient(userId);

  if (!authResult.ok) {
    return {
      ok: false,
      status: 401,
      error: authResult.error,
    };
  }

  const payload = action?.payload || {};
  const title = normalizeText(payload.title || action?.title || 'Action Nyra');
  const notes = normalizeMultilineText(payload.notes || action?.description || action?.reason || '');

  const created = await authResult.tasks.tasks.insert({
    tasklist: '@default',
    requestBody: {
      title,
      notes: notes || undefined,
      status: 'needsAction',
    },
  });

  const record = saveExecutedActionRecord({
    userId,
    action,
    provider: 'google_tasks',
    status: 'done',
    externalId: created.data.id || null,
    externalLink: created.data.webViewLink || null,
    resultMessage: 'La tâche a été créée dans Google Tasks.',
    payload: {
      ...payload,
      google_task: created.data,
    },
  });

  return {
    ok: true,
    message: 'Tâche créée dans Google Tasks.',
    record,
    result: created.data,
    external_link: created.data.webViewLink || null,
  };
}

async function executeCalendarAction(userId, action) {
  const authResult = await getAuthenticatedCalendarClient(userId);

  if (!authResult.ok) {
    return {
      ok: false,
      status: 401,
      error: authResult.error,
    };
  }

  const payload = action?.payload || {};
  const duration = Number(payload.duration_minutes || payload.duration_min || 60);
  const range = resolveExecutionDateRange(action?.datetime_hint || payload.datetime_hint, duration);

  const title = normalizeText(payload.title || action?.title || 'Événement Nyra');
  const description = normalizeMultilineText(payload.description || action?.description || 'Événement créé depuis Nyra.');

  const created = await authResult.calendar.events.insert({
    calendarId: normalizeText(payload.calendarId || 'primary'),
    requestBody: {
      summary: title,
      description: description || 'Événement créé depuis Nyra.',
      start: {
        dateTime: range.startTime,
        timeZone: payload.timezone || 'Europe/Paris',
      },
      end: {
        dateTime: range.endTime,
        timeZone: payload.timezone || 'Europe/Paris',
      },
      reminders: {
        useDefault: true,
      },
    },
  });

  const record = saveExecutedActionRecord({
    userId,
    action,
    provider: 'google_calendar',
    status: 'done',
    externalId: created.data.id || null,
    externalLink: created.data.htmlLink || null,
    resultMessage: 'L’événement a été créé dans Google Agenda.',
    payload: {
      ...payload,
      startTime: range.startTime,
      endTime: range.endTime,
      calendar_event: created.data,
    },
  });

  return {
    ok: true,
    message: 'Événement créé dans Google Agenda.',
    record,
    result: created.data,
    external_link: created.data.htmlLink || null,
  };
}

function executeLocalAction(userId, action) {
  const store = readStore();
  const actionType = action?.type || action?.action_type || 'local_action';
  const title = cleanActionTitle(action?.title || action?.description || 'Action Nyra');
  const content = normalizeMultilineText(action?.description || action?.payload?.content || title);
  const projectName = action?.project_name || action?.payload?.project_name || null;

  let bucket = 'actions';
  let itemType = 'action_result';
  let status = 'done';

  if (actionType === 'add_to_today') {
    bucket = 'today';
    itemType = 'task';
    status = 'todo';
  }

  if (actionType === 'roadmap_action') {
    bucket = 'projects';
    itemType = 'roadmap_action';
  }

  if (actionType === 'focus_session') {
    bucket = 'plans';
    itemType = 'focus_session';
  }

  const item = {
    id: crypto.randomUUID(),
    user_id: userId,
    type: itemType,
    bucket,
    title,
    content,
    urgency: action?.priority === 'high' ? 'high' : 'normal',
    priority: action?.priority || 'normal',
    datetime_hint: action?.datetime_hint || null,
    tags: uniqueArray([
      'executed_action',
      actionType,
      projectName ? normalizeKey(projectName) : null,
    ]),
    status,
    project_name: projectName,
    project_id: null,
    action_type: actionType,
    provider: 'local',
    sync_status: 'local_only',
    external_id: null,
    requires_connection: false,
    connection_type: null,
    payload: action?.payload || {},
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  let linkedProject = null;

  if (projectName) {
    linkedProject = ensureProject(store, userId, projectName, content);
    item.project_id = linkedProject.id;
    item.project_name = linkedProject.name;
  }

  store.items.push(item);

  if (linkedProject && !relationExists(store, userId, item.id, linkedProject.id, 'belongs_to_project')) {
    store.relations.push(
      createRelation({
        userId,
        sourceId: item.id,
        targetId: linkedProject.id,
        relationType: 'belongs_to_project',
        confidence: 0.94,
        metadata: {
          project_name: linkedProject.name,
          detection: 'executed_action',
          action_type: actionType,
        },
      })
    );

    updateProjectContext(store, userId, linkedProject);
  }

  store.items = store.items.slice(-500);
  writeStore(store);

  const record = saveExecutedActionRecord({
    userId,
    action,
    provider: 'local',
    status: 'done',
    externalId: item.id,
    externalLink: null,
    resultMessage: 'Action exécutée dans Nyra.',
    payload: {
      ...(action?.payload || {}),
      stored_item_id: item.id,
    },
  });

  return {
    ok: true,
    message: 'Action exécutée dans Nyra.',
    record,
    stored_item: item,
  };
}

async function executeProjectSpecAction(userId, action) {
  const store = readStore();
  const projectName = action?.project_name || action?.payload?.project_name;

  const project = store.projects.find(item => {
    return item.user_id === userId && normalizeKey(item.name) === normalizeKey(projectName);
  });

  if (!project) {
    return {
      ok: false,
      status: 404,
      error: 'Projet introuvable pour générer le cahier des charges',
    };
  }

  const { items } = getProjectRelatedItems(store, userId, project.id);

  const existingContext = store.contexts.find(context => {
    return (
      context.user_id === userId &&
      context.context_type === 'project' &&
      context.project_id === project.id
    );
  });

  const specMarkdown = await generateProjectSpec({
    project,
    items,
    existingContext,
  });

  const specContext = saveProjectSpecContext({
    store,
    userId,
    project,
    specMarkdown,
    relatedItems: items,
  });

  writeStore(store);

  const record = saveExecutedActionRecord({
    userId,
    action,
    provider: 'google_drive',
    status: 'done',
    externalId: specContext.id,
    externalLink: null,
    resultMessage: 'Cahier des charges généré dans Nyra.',
    payload: {
      ...(action?.payload || {}),
      project_spec_context_id: specContext.id,
    },
  });

  return {
    ok: true,
    message: 'Cahier des charges généré dans Nyra.',
    record,
    project_spec: specContext,
  };
}

async function handleExecuteExecutiveAction(req, res) {
  const startedAt = Date.now();
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const action = req.body?.action;

  if (!action || typeof action !== 'object') {
    return res.status(400).json({
      ok: false,
      error: 'Action manquante',
    });
  }

  const actionType = action.type || action.action_type;

  try {
    let result;

    if (actionType === 'create_google_task') {
      result = await executeGoogleTaskAction(userId, action);
    } else if (actionType === 'create_calendar_event') {
      result = await executeCalendarAction(userId, action);
    } else if (actionType === 'create_project_spec') {
      result = await executeProjectSpecAction(userId, action);
    } else {
      result = executeLocalAction(userId, action);
    }

    if (!result.ok) {
      return res.status(result.status || 500).json({
        ok: false,
        error: result.error || 'Erreur exécution action',
        connect_url: `/auth/google?userId=${encodeURIComponent(userId)}`,
        full_connect_url: `https://nyra-backend-production-d168.up.railway.app/auth/google?userId=${encodeURIComponent(userId)}`,
      });
    }

    return res.json({
      ok: true,
      userId,
      action_type: actionType,
      message: result.message || 'Action exécutée.',
      execution_result: result,
      external_link: result.external_link || null,
      memory_summary: getStoreSummary(userId),
      perf: {
        total_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error('❌ /actions/execute error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur exécution action',
      details: error.message,
    });
  }
}

app.post('/actions/execute', async (req, res) => {
  return handleExecuteExecutiveAction(req, res);
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
    const executiveActions = buildExecutiveActions({
      userId,
      message: userMessage,
      analysis,
      action,
    });
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
      executiveActions,
    });

    res.json({
      ok: true,
      reply,
      message: reply,
      analysis,
      action,
      executive_actions: executiveActions,
      suggestions,
      stored_item: saved.item,
      stored_action: saved.action,
      linked_project: saved.project,
      created_relation: saved.relation,
      updated_context: saved.context,
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
  console.log(`🚀 Nyra backend Google Tasks Create Task lancé sur le port ${PORT}`);
});