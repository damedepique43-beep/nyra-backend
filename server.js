require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const OpenAI = require('openai');
const { google } = require('googleapis');
const { buildAdaptiveProfile } = require('./engines/adaptiveCognitiveEngine');
const { buildProactiveSignals } = require('./engines/proactiveAssistantEngine');
const { buildTimelineInsights } = require('./engines/cognitiveTimelineEngine');
const { buildCognitiveMemoryGraph, buildMemoryGraphInsights } = require('./engines/cognitiveMemoryGraphEngine');

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

const STORE_VERSION = 'context-engine-history-v1';

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
    action_events: [],
    conversations: [],
    projects: [],
    relations: [],
    contexts: [],
    connected_accounts: [],
    user_states: [],
    focus_sessions: [],
    adaptive_profiles: [],
    proactive_events: [],
    cognitive_timeline_events: [],
    cognitive_memory_graphs: [],
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
      action_events: Array.isArray(parsed.action_events) ? parsed.action_events : [],
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      contexts: Array.isArray(parsed.contexts) ? parsed.contexts : [],
      connected_accounts: Array.isArray(parsed.connected_accounts)
        ? parsed.connected_accounts
        : [],
      user_states: Array.isArray(parsed.user_states)
        ? parsed.user_states
        : [],
      focus_sessions: Array.isArray(parsed.focus_sessions)
        ? parsed.focus_sessions
        : [],
      adaptive_profiles: Array.isArray(parsed.adaptive_profiles)
        ? parsed.adaptive_profiles
        : [],
      proactive_events: Array.isArray(parsed.proactive_events)
        ? parsed.proactive_events
        : [],
      cognitive_timeline_events: Array.isArray(parsed.cognitive_timeline_events)
        ? parsed.cognitive_timeline_events
        : [],
      cognitive_memory_graphs: Array.isArray(parsed.cognitive_memory_graphs)
        ? parsed.cognitive_memory_graphs
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
      action_events: Array.isArray(store.action_events) ? store.action_events : [],
      user_states: Array.isArray(store.user_states) ? store.user_states : [],
      focus_sessions: Array.isArray(store.focus_sessions) ? store.focus_sessions : [],
      adaptive_profiles: Array.isArray(store.adaptive_profiles) ? store.adaptive_profiles : [],
      proactive_events: Array.isArray(store.proactive_events) ? store.proactive_events : [],
      cognitive_timeline_events: Array.isArray(store.cognitive_timeline_events) ? store.cognitive_timeline_events : [],
      cognitive_memory_graphs: Array.isArray(store.cognitive_memory_graphs) ? store.cognitive_memory_graphs : [],
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


const ACTION_STATUS_VALUES = ['suggested', 'draft', 'executing', 'done', 'failed', 'cancelled'];

function normalizeActionStatus(status, fallback = 'suggested') {
  const normalized = normalizeKey(status || fallback).replace(/-/g, '_');

  if (ACTION_STATUS_VALUES.includes(normalized)) return normalized;
  if (normalized === 'todo') return 'suggested';
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'success') return 'done';
  if (normalized === 'error') return 'failed';
  if (normalized === 'canceled') return 'cancelled';

  return fallback;
}

function buildActionEvent({ userId, actionId, fromStatus, toStatus, reason, metadata, source }) {
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    action_id: actionId,
    from_status: fromStatus || null,
    to_status: normalizeActionStatus(toStatus),
    reason: normalizeText(reason || ''),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    source: source || 'backend',
    created_at: nowIso(),
  };
}

function attachInitialActionHistory(action, reason = 'Action créée par Nyra.') {
  const initialStatus = normalizeActionStatus(action.status || 'suggested');
  const event = buildActionEvent({
    userId: action.user_id,
    actionId: action.id,
    fromStatus: null,
    toStatus: initialStatus,
    reason,
    metadata: {
      action_type: action.action_type || action.type || null,
      provider: action.provider || null,
    },
    source: 'creation',
  });

  action.status = initialStatus;
  action.status_history = Array.isArray(action.status_history) ? action.status_history : [];
  action.status_history.push(event);
  action.execution_count = Number(action.execution_count || 0);
  action.retry_count = Number(action.retry_count || 0);
  action.last_error = action.last_error || null;
  action.updated_at = nowIso();

  if (initialStatus === 'done') action.completed_at = action.completed_at || nowIso();
  if (initialStatus === 'failed') action.failed_at = action.failed_at || nowIso();
  if (initialStatus === 'cancelled') action.cancelled_at = action.cancelled_at || nowIso();

  return event;
}

function ensureActionRuntimeFields(action) {
  action.status = normalizeActionStatus(action.status || 'suggested');
  action.status_history = Array.isArray(action.status_history) ? action.status_history : [];
  action.execution_count = Number(action.execution_count || 0);
  action.retry_count = Number(action.retry_count || 0);
  action.last_error = action.last_error || null;
  action.updated_at = action.updated_at || action.created_at || nowIso();
  return action;
}

function actionBelongsToUser(action, userId) {
  const normalizedUserId = normalizeText(userId || 'local-user');

  if (!normalizedUserId || normalizedUserId === 'local-user') {
    return true;
  }

  return (
    action.user_id === normalizedUserId ||
    action.legacy_user_id === normalizedUserId ||
    action.google_user_id === normalizedUserId
  );
}

function actionMatchesId(action, actionId) {
  const normalizedActionId = normalizeText(actionId);

  if (!normalizedActionId) return false;

  return (
    action.id === normalizedActionId ||
    action.action_id === normalizedActionId ||
    action.item_id === normalizedActionId ||
    action.stored_item_id === normalizedActionId
  );
}

function findUserAction(store, userId, actionId) {
  const normalizedUserId = normalizeText(userId || 'local-user');
  const normalizedActionId = normalizeText(actionId);

  if (!normalizedActionId) return null;

  const safeActions = Array.isArray(store.actions) ? store.actions : [];

  let index = safeActions.findIndex(action => {
    return actionMatchesId(action, normalizedActionId) && actionBelongsToUser(action, normalizedUserId);
  });

  // Robust fallback pour les anciennes cartes déjà affichées dans l'app :
  // elles peuvent envoyer l'id de l'item mémoire au lieu de l'id de l'action,
  // ou un userId local alors que Google a créé un user_id stable.
  if (index === -1) {
    index = safeActions.findIndex(action => actionMatchesId(action, normalizedActionId));
  }

  if (index === -1) return null;

  return {
    index,
    action: ensureActionRuntimeFields(store.actions[index]),
  };
}


function findItemForActionRecovery(store, userId, actionId) {
  const normalizedUserId = normalizeText(userId || 'local-user');
  const normalizedActionId = normalizeText(actionId);

  if (!normalizedActionId) return null;

  const safeItems = Array.isArray(store.items) ? store.items : [];

  let index = safeItems.findIndex(item => {
    return (
      item.user_id === normalizedUserId &&
      (
        item.id === normalizedActionId ||
        item.action_id === normalizedActionId ||
        item.stored_item_id === normalizedActionId
      )
    );
  });

  if (index === -1) {
    index = safeItems.findIndex(item => {
      return (
        item.id === normalizedActionId ||
        item.action_id === normalizedActionId ||
        item.stored_item_id === normalizedActionId
      );
    });
  }

  if (index === -1) return null;

  return {
    index,
    item: safeItems[index],
  };
}

function createRecoverableActionFromItem({ store, userId, actionId, item }) {
  const normalizedUserId = normalizeText(userId || item?.user_id || 'local-user');
  const normalizedActionId = normalizeText(actionId);
  const existingActionId = normalizeText(item?.action_id || '');
  const actionType = normalizeText(item?.action_type || item?.type || 'manual_action') || 'manual_action';
  const recoveredActionId = existingActionId || crypto.randomUUID();

  const recoveredAction = ensureActionRuntimeFields({
    id: recoveredActionId,
    user_id: item?.user_id || normalizedUserId,
    item_id: item?.id || normalizedActionId,
    action_type: actionType,
    type: actionType,
    label: item?.action_label || item?.label || 'Action Nyra',
    title: item?.title || cleanActionTitle(item?.content || item?.target || 'Action Nyra'),
    target: item?.content || item?.target || item?.title || '',
    status: normalizeActionStatus(item?.status || 'suggested'),
    priority: item?.priority || 'normal',
    datetime_hint: item?.datetime_hint || null,
    next_step: item?.next_step || 'Action récupérée depuis la mémoire Nyra.',
    provider: item?.provider || 'local',
    sync_status: item?.sync_status || 'local_only',
    external_id: item?.external_id || null,
    external_link: item?.external_link || null,
    requires_connection: Boolean(item?.requires_connection),
    connection_type: item?.connection_type || null,
    source: 'recovered_from_memory_item',
    source_message: item?.content || item?.title || '',
    recovery_requested_action_id: normalizedActionId,
    created_at: item?.created_at || nowIso(),
    updated_at: nowIso(),
  });

  store.actions = Array.isArray(store.actions) ? store.actions : [];
  store.actions.push(recoveredAction);

  if (item) {
    item.action_id = recoveredAction.id;
    item.action_type = recoveredAction.action_type;
    item.status = recoveredAction.status;
    item.sync_status = recoveredAction.sync_status;
    item.updated_at = nowIso();
  }

  const recoveryEvent = buildActionEvent({
    userId: recoveredAction.user_id,
    actionId: recoveredAction.id,
    fromStatus: null,
    toStatus: recoveredAction.status,
    reason: 'Action reconstruite automatiquement depuis un item mémoire.',
    metadata: {
      requested_user_id: normalizedUserId,
      requested_action_id: normalizedActionId,
      item_id: item?.id || null,
      recovery: true,
    },
    source: 'action_recovery',
  });

  recoveredAction.status_history.push(recoveryEvent);
  store.action_events = Array.isArray(store.action_events) ? store.action_events : [];
  store.action_events.push(recoveryEvent);

  return recoveredAction;
}

function findOrRecoverUserAction(store, userId, actionId) {
  const found = findUserAction(store, userId, actionId);

  if (found) {
    return found;
  }

  const foundItem = findItemForActionRecovery(store, userId, actionId);

  if (!foundItem?.item) {
    return null;
  }

  const recoveredAction = createRecoverableActionFromItem({
    store,
    userId,
    actionId,
    item: foundItem.item,
  });

  return {
    index: store.actions.length - 1,
    action: recoveredAction,
    recovered: true,
    recovered_from_item: foundItem.item,
  };
}

function buildActionNotFoundDebug(store, userId, actionId) {
  const normalizedUserId = normalizeText(userId || 'local-user');
  const normalizedActionId = normalizeText(actionId);
  const safeActions = Array.isArray(store.actions) ? store.actions : [];
  const safeItems = Array.isArray(store.items) ? store.items : [];

  return {
    requested_user_id: normalizedUserId,
    requested_action_id: normalizedActionId,
    total_actions: safeActions.length,
    total_items: safeItems.length,
    recent_actions: safeActions.slice(-5).map(action => ({
      id: action.id || null,
      user_id: action.user_id || null,
      item_id: action.item_id || null,
      action_type: action.action_type || action.type || null,
      status: action.status || null,
      title: action.title || null,
    })),
    recent_action_items: safeItems
      .filter(item => item.action_id || item.action_type)
      .slice(-5)
      .map(item => ({
        id: item.id || null,
        user_id: item.user_id || null,
        action_id: item.action_id || null,
        action_type: item.action_type || null,
        status: item.status || null,
        title: item.title || null,
      })),
  };
}

function syncLinkedItemWithAction(store, action) {
  if (!action?.item_id) return null;

  const item = store.items.find(existingItem => {
    return existingItem.id === action.item_id;
  });

  if (!item) return null;

  item.status = action.status;
  item.sync_status = action.sync_status || item.sync_status || 'local_only';
  item.external_id = action.external_id || item.external_id || null;
  item.action_id = action.id;
  item.updated_at = nowIso();

  return item;
}

function updateActionStatusInStore({ store, userId, actionId, status, reason, metadata, source }) {
  const found = findOrRecoverUserAction(store, userId, actionId);

  if (!found) {
    return {
      ok: false,
      error: 'ACTION_NOT_FOUND',
      debug: buildActionNotFoundDebug(store, userId, actionId),
    };
  }

  const action = found.action;
  const previousStatus = action.status;
  const nextStatus = normalizeActionStatus(status, previousStatus);

  if (previousStatus === nextStatus) {
    action.updated_at = nowIso();
    return {
      ok: true,
      changed: false,
      action,
      event: null,
      item: syncLinkedItemWithAction(store, action),
    };
  }

  const event = buildActionEvent({
    userId: action.user_id || userId,
    actionId: action.id || actionId,
    fromStatus: previousStatus,
    toStatus: nextStatus,
    reason,
    metadata: {
      ...(metadata || {}),
      requested_user_id: userId,
      requested_action_id: actionId,
    },
    source: source || 'manual_update',
  });

  action.status = nextStatus;
  action.updated_at = nowIso();
  action.status_history.push(event);

  if (nextStatus === 'executing') {
    action.execution_count = Number(action.execution_count || 0) + 1;
    action.started_at = nowIso();
    action.sync_status = action.requires_connection ? 'pending_sync' : 'local_only';
  }

  if (nextStatus === 'done') {
    action.completed_at = nowIso();
    action.last_error = null;
    action.sync_status = action.requires_connection ? (action.external_id ? 'synced' : action.sync_status || 'pending_sync') : 'local_only';
  }

  if (nextStatus === 'failed') {
    action.failed_at = nowIso();
    action.last_error = normalizeText(metadata?.error || reason || 'Erreur inconnue') || 'Erreur inconnue';
    action.sync_status = 'failed';
  }

  if (nextStatus === 'cancelled') {
    action.cancelled_at = nowIso();
    action.sync_status = 'cancelled';
  }

  if (nextStatus === 'suggested' || nextStatus === 'draft') {
    action.sync_status = action.requires_connection ? 'requires_connection' : 'local_only';
  }

  store.action_events = Array.isArray(store.action_events) ? store.action_events : [];
  store.action_events.push(event);
  store.action_events = store.action_events.slice(-1000);

  return {
    ok: true,
    changed: true,
    action,
    event,
    item: syncLinkedItemWithAction(store, action),
  };
}

function retryActionInStore({ store, userId, actionId, reason, metadata }) {
  const found = findUserAction(store, userId, actionId);

  if (!found) {
    return {
      ok: false,
      error: 'ACTION_NOT_FOUND',
    };
  }

  const action = found.action;
  action.retry_count = Number(action.retry_count || 0) + 1;
  action.last_error = null;

  return updateActionStatusInStore({
    store,
    userId,
    actionId,
    status: 'suggested',
    reason: reason || 'Action remise en attente pour nouvelle tentative.',
    metadata: {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      retry_count: action.retry_count,
    },
    source: 'retry',
  });
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

function saveCapture({ userId, message, reply, analysis, action }) {
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

    const initialActionEvent = attachInitialActionHistory(actionRecord);
    store.action_events = Array.isArray(store.action_events) ? store.action_events : [];
    store.action_events.push(initialActionEvent);

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
    stored_item_id: item.id,
    action_id: actionRecord ? actionRecord.id : null,
    project_id: linkedProject ? linkedProject.id : null,
    project_name: linkedProject ? linkedProject.name : null,
    relation_id: createdRelation ? createdRelation.id : null,
    created_at: nowIso(),
  });

  store.items = store.items.slice(-500);
  store.actions = store.actions.slice(-300);
  store.action_events = Array.isArray(store.action_events) ? store.action_events.slice(-1000) : [];
  store.conversations = store.conversations.slice(-200);
  store.projects = store.projects.slice(-100);
  store.relations = store.relations.slice(-1000);
  store.contexts = store.contexts.slice(-200);

  const userState = saveUserStateSnapshot(store, userId);

  writeStore(store);

  return {
    item,
    action: actionRecord,
    project: linkedProject,
    relation: createdRelation,
    context: updatedContext,
    user_state: userState,
  };
}


function clampNumber(value, min, max) {
  const numeric = Number(value);

  if (Number.isNaN(numeric)) return min;

  return Math.max(min, Math.min(max, numeric));
}

function getRecentUserItems(store, userId, limit = 80) {
  return (Array.isArray(store.items) ? store.items : [])
    .filter(item => item.user_id === userId)
    .slice(-limit);
}

function getRecentUserActions(store, userId, limit = 80) {
  return (Array.isArray(store.actions) ? store.actions : [])
    .filter(action => action.user_id === userId)
    .slice(-limit);
}

function getRecentUserConversations(store, userId, limit = 60) {
  return (Array.isArray(store.conversations) ? store.conversations : [])
    .filter(conversation => conversation.user_id === userId)
    .slice(-limit);
}

function countItemsMatching(items, predicate) {
  return items.reduce((total, item) => {
    return predicate(item) ? total + 1 : total;
  }, 0);
}

function detectUserStateSignals({ items, actions, conversations }) {
  const sourceTexts = [
    ...items.map(item => `${item.title || ''} ${item.content || ''}`),
    ...actions.map(action => `${action.title || ''} ${action.target || ''} ${action.next_step || ''}`),
    ...conversations.map(conversation => `${conversation.user_message || ''} ${conversation.nyra_reply || ''}`),
  ];

  const joinedText = normalizeText(sourceTexts.join(' ')).toLowerCase();

  const openActions = actions.filter(action => {
    const status = normalizeActionStatus(action.status || 'suggested');
    return ['suggested', 'draft', 'executing'].includes(status);
  });

  const doneActions = actions.filter(action => normalizeActionStatus(action.status) === 'done');
  const failedActions = actions.filter(action => normalizeActionStatus(action.status) === 'failed');
  const cancelledActions = actions.filter(action => normalizeActionStatus(action.status) === 'cancelled');

  const projectNames = uniqueArray(
    items
      .map(item => item.project_name)
      .concat(actions.map(action => action.project_name))
      .filter(Boolean)
  );

  const emotionItems = items.filter(item => {
    return item.type === 'emotion' || item.bucket === 'journal' || (Array.isArray(item.tags) && item.tags.includes('émotion'));
  });

  const urgentItems = items.filter(item => {
    return item.urgency === 'high' || item.priority === 'high' || (Array.isArray(item.tags) && item.tags.includes('urgent'));
  });

  const fatigueKeywords = [
    'fatiguée',
    'fatiguee',
    'fatigué',
    'fatigue',
    'épuisée',
    'epuisee',
    'épuisé',
    'epuise',
    'crevée',
    'crevee',
    'vidée',
    'videe',
    'plus d’énergie',
    "plus d'energie",
    'plus de force',
  ];

  const overwhelmKeywords = [
    'surcharge',
    'trop',
    'débordée',
    'debordee',
    'submergée',
    'submergee',
    'je panique',
    'panique',
    'je sais pas par où commencer',
    'je sais pas par ou commencer',
    'tout se mélange',
    'tout se melange',
    'charge mentale',
  ];

  const avoidanceKeywords = [
    'je repousse',
    'procrastine',
    'procrastination',
    'j’évite',
    "j'evite",
    'j’évite',
    "j'évite",
    'pas avancé',
    'pas avance',
    'bloquée',
    'bloquee',
    'bloqué',
    'bloque',
  ];

  const focusKeywords = [
    'focus',
    'concentrée',
    'concentree',
    'concentré',
    'concentre',
    'j’avance',
    "j'avance",
    'on avance',
    'allons y',
    'vas y',
    'c’est fait',
    "c'est fait",
  ];

  const explorationKeywords = [
    'idée',
    'idee',
    'concept',
    'j’imagine',
    "j'imagine",
    'on pourrait',
    'ça pourrait',
    'ca pourrait',
  ];

  const fatigueMentions = countItemsMatching(sourceTexts, text => includesAny(text, fatigueKeywords));
  const overwhelmMentions = countItemsMatching(sourceTexts, text => includesAny(text, overwhelmKeywords));
  const avoidanceMentions = countItemsMatching(sourceTexts, text => includesAny(text, avoidanceKeywords));
  const focusMentions = countItemsMatching(sourceTexts, text => includesAny(text, focusKeywords));
  const explorationMentions = countItemsMatching(sourceTexts, text => includesAny(text, explorationKeywords));

  return {
    item_count: items.length,
    action_count: actions.length,
    conversation_count: conversations.length,
    open_actions: openActions.length,
    done_actions: doneActions.length,
    failed_actions: failedActions.length,
    cancelled_actions: cancelledActions.length,
    project_count: projectNames.length,
    emotion_items: emotionItems.length,
    urgent_items: urgentItems.length,
    fatigue_mentions: fatigueMentions,
    overwhelm_mentions: overwhelmMentions,
    avoidance_mentions: avoidanceMentions,
    focus_mentions: focusMentions,
    exploration_mentions: explorationMentions,
    has_recent_fatigue_language: includesAny(joinedText, fatigueKeywords),
    has_recent_overwhelm_language: includesAny(joinedText, overwhelmKeywords),
    has_recent_avoidance_language: includesAny(joinedText, avoidanceKeywords),
    has_recent_focus_language: includesAny(joinedText, focusKeywords),
    has_recent_exploration_language: includesAny(joinedText, explorationKeywords),
    active_projects: projectNames.slice(0, 8),
  };
}

function scoreUserOverwhelm(signals) {
  let score = 0;

  score += signals.open_actions * 5;
  score += signals.failed_actions * 7;
  score += signals.urgent_items * 6;
  score += signals.emotion_items * 4;
  score += signals.project_count > 2 ? (signals.project_count - 2) * 6 : 0;
  score += signals.fatigue_mentions * 6;
  score += signals.overwhelm_mentions * 8;
  score += signals.avoidance_mentions * 5;

  if (signals.done_actions > 0) {
    score -= Math.min(18, signals.done_actions * 3);
  }

  if (signals.focus_mentions > signals.overwhelm_mentions) {
    score -= 8;
  }

  return clampNumber(score, 0, 100);
}

function deriveCognitiveLoad(overwhelmScore) {
  if (overwhelmScore >= 75) return 'very_high';
  if (overwhelmScore >= 55) return 'high';
  if (overwhelmScore >= 30) return 'moderate';
  return 'low';
}

function deriveEnergyLevel(signals, overwhelmScore) {
  if (signals.has_recent_fatigue_language || signals.fatigue_mentions >= 2) return 'low';
  if (overwhelmScore >= 75) return 'low';
  if (signals.focus_mentions >= 3 && overwhelmScore < 45) return 'high';
  if (signals.done_actions > signals.open_actions && overwhelmScore < 50) return 'good';
  return 'medium';
}

function deriveFocusState(signals, overwhelmScore) {
  if (signals.has_recent_overwhelm_language || overwhelmScore >= 70) return 'scattered';
  if (signals.project_count >= 4 && signals.open_actions >= 4) return 'fragmented';
  if (signals.has_recent_focus_language && signals.focus_mentions >= signals.exploration_mentions) return 'focused';
  if (signals.has_recent_exploration_language) return 'exploratory';
  return 'stable';
}

function deriveEmotionalState(signals, overwhelmScore) {
  if (signals.has_recent_overwhelm_language || overwhelmScore >= 75) return 'overwhelmed';
  if (signals.has_recent_fatigue_language) return 'tired';
  if (signals.has_recent_avoidance_language) return 'blocked';
  if (signals.emotion_items >= 3) return 'emotionally_active';
  if (signals.focus_mentions >= 3) return 'engaged';
  return 'neutral';
}

function buildDetectedPatterns(signals, overwhelmScore) {
  const patterns = [];

  if (signals.project_count >= 3) {
    patterns.push({
      id: 'many_parallel_projects',
      label: 'Plusieurs projets actifs en parallèle.',
      intensity: signals.project_count >= 5 ? 'high' : 'medium',
    });
  }

  if (signals.open_actions >= 5) {
    patterns.push({
      id: 'open_actions_accumulation',
      label: 'Accumulation d’actions ouvertes.',
      intensity: signals.open_actions >= 8 ? 'high' : 'medium',
    });
  }

  if (signals.urgent_items >= 3 || signals.overwhelm_mentions >= 2) {
    patterns.push({
      id: 'high_urgency_language',
      label: 'Langage d’urgence ou de surcharge fréquent.',
      intensity: 'high',
    });
  }

  if (signals.avoidance_mentions >= 1 || signals.failed_actions >= 2) {
    patterns.push({
      id: 'execution_friction',
      label: 'Friction d’exécution ou évitement probable.',
      intensity: signals.failed_actions >= 3 ? 'high' : 'medium',
    });
  }

  if (signals.focus_mentions >= 3 && overwhelmScore < 55) {
    patterns.push({
      id: 'productive_momentum',
      label: 'Dynamique d’avancement détectée.',
      intensity: 'positive',
    });
  }

  if (signals.fatigue_mentions >= 1) {
    patterns.push({
      id: 'fatigue_signal',
      label: 'Signal de fatigue cognitive.',
      intensity: signals.fatigue_mentions >= 2 ? 'high' : 'medium',
    });
  }

  if (patterns.length === 0) {
    patterns.push({
      id: 'stable_baseline',
      label: 'Aucun signal fort détecté pour l’instant.',
      intensity: 'low',
    });
  }

  return patterns;
}

function buildUserStateRecommendations({ cognitiveLoad, energyLevel, focusState, emotionalState, signals }) {
  const recommendations = [];

  if (cognitiveLoad === 'very_high' || cognitiveLoad === 'high') {
    recommendations.push('Réduire l’écran à une seule priorité visible.');
    recommendations.push('Éviter d’ajouter de nouvelles grosses tâches maintenant.');
  }

  if (energyLevel === 'low') {
    recommendations.push('Choisir une micro-action de moins de 5 minutes.');
    recommendations.push('Prévoir une vraie récupération avant une tâche complexe.');
  }

  if (focusState === 'scattered' || focusState === 'fragmented') {
    recommendations.push('Regrouper les captures similaires avant d’agir.');
    recommendations.push('Mettre en pause les projets non prioritaires.');
  }

  if (emotionalState === 'blocked') {
    recommendations.push('Identifier la première action ridiculeusement simple.');
  }

  if (signals.project_count >= 3) {
    recommendations.push('Choisir un seul projet actif pour la prochaine session.');
  }

  if (signals.open_actions >= 5) {
    recommendations.push('Clôturer, annuler ou reporter les actions ouvertes avant d’en créer de nouvelles.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Continuer avec une priorité claire et garder le rythme actuel.');
  }

  return uniqueArray(recommendations).slice(0, 5);
}

function analyzeUserState({ store, userId }) {
  const items = getRecentUserItems(store, userId, 80);
  const actions = getRecentUserActions(store, userId, 80);
  const conversations = getRecentUserConversations(store, userId, 60);

  const signals = detectUserStateSignals({
    items,
    actions,
    conversations,
  });

  const overwhelmScore = scoreUserOverwhelm(signals);
  const cognitiveLoad = deriveCognitiveLoad(overwhelmScore);
  const energyLevel = deriveEnergyLevel(signals, overwhelmScore);
  const focusState = deriveFocusState(signals, overwhelmScore);
  const emotionalState = deriveEmotionalState(signals, overwhelmScore);
  const detectedPatterns = buildDetectedPatterns(signals, overwhelmScore);
  const recommendations = buildUserStateRecommendations({
    cognitiveLoad,
    energyLevel,
    focusState,
    emotionalState,
    signals,
  });

  const dominantMode =
    cognitiveLoad === 'very_high' || cognitiveLoad === 'high'
      ? 'reduce_load'
      : energyLevel === 'low'
        ? 'recovery'
        : focusState === 'focused'
          ? 'execution'
          : focusState === 'exploratory'
            ? 'exploration'
            : 'steady';

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    cognitive_load: cognitiveLoad,
    emotional_state: emotionalState,
    energy_level: energyLevel,
    focus_state: focusState,
    dominant_mode: dominantMode,
    overwhelm_score: overwhelmScore,
    detected_patterns: detectedPatterns,
    active_signals: signals,
    recommendations,
    source_items: items.slice(-20).map(item => item.id).filter(Boolean),
    source_actions: actions.slice(-20).map(action => action.id).filter(Boolean),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function saveUserStateSnapshot(store, userId) {
  store.user_states = Array.isArray(store.user_states) ? store.user_states : [];

  const snapshot = analyzeUserState({
    store,
    userId,
  });

  store.user_states.push(snapshot);

  const userStates = store.user_states.filter(state => state.user_id === userId);
  const otherStates = store.user_states.filter(state => state.user_id !== userId);

  store.user_states = [
    ...otherStates,
    ...userStates.slice(-100),
  ].slice(-500);

  return snapshot;
}

function getLatestUserState(store, userId) {
  const states = Array.isArray(store.user_states)
    ? store.user_states.filter(state => state.user_id === userId)
    : [];

  return states
    .sort((a, b) => {
      return new Date(b.updated_at || b.created_at || 0).getTime() -
        new Date(a.updated_at || a.created_at || 0).getTime();
    })[0] || null;
}

function getUserStateTrend(store, userId, limit = 12) {
  const states = Array.isArray(store.user_states)
    ? store.user_states.filter(state => state.user_id === userId)
    : [];

  return states
    .sort((a, b) => {
      return new Date(a.updated_at || a.created_at || 0).getTime() -
        new Date(b.updated_at || b.created_at || 0).getTime();
    })
    .slice(-limit)
    .map(state => ({
      id: state.id,
      cognitive_load: state.cognitive_load,
      emotional_state: state.emotional_state,
      energy_level: state.energy_level,
      focus_state: state.focus_state,
      dominant_mode: state.dominant_mode,
      overwhelm_score: state.overwhelm_score,
      created_at: state.created_at,
      updated_at: state.updated_at,
    }));
}


function getOrderedUserStates(store, userId, limit = 30) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
  const states = Array.isArray(store.user_states)
    ? store.user_states.filter(state => state.user_id === userId)
    : [];

  return states
    .sort((a, b) => {
      return new Date(a.updated_at || a.created_at || 0).getTime() -
        new Date(b.updated_at || b.created_at || 0).getTime();
    })
    .slice(-safeLimit);
}

function averageNumber(values) {
  const numbers = values.filter(value => typeof value === 'number' && !Number.isNaN(value));

  if (!numbers.length) return null;

  return Math.round(numbers.reduce((total, value) => total + value, 0) / numbers.length);
}

function buildStateVariation(states) {
  if (!Array.isArray(states) || states.length < 2) {
    return {
      direction: 'stable',
      label: 'Pas encore assez d’historique',
      delta_score: 0,
      previous_score: states?.[0]?.overwhelm_score ?? null,
      latest_score: states?.[0]?.overwhelm_score ?? null,
    };
  }

  const latest = states[states.length - 1];
  const previous = states[states.length - 2];
  const latestScore = Number(latest?.overwhelm_score || 0);
  const previousScore = Number(previous?.overwhelm_score || 0);
  const delta = latestScore - previousScore;

  if (delta >= 8) {
    return {
      direction: 'worsening',
      label: 'Surcharge en hausse',
      delta_score: delta,
      previous_score: previousScore,
      latest_score: latestScore,
    };
  }

  if (delta <= -8) {
    return {
      direction: 'improving',
      label: 'Surcharge en baisse',
      delta_score: delta,
      previous_score: previousScore,
      latest_score: latestScore,
    };
  }

  return {
    direction: 'stable',
    label: 'État relativement stable',
    delta_score: delta,
    previous_score: previousScore,
    latest_score: latestScore,
  };
}

function buildStateHistorySummary(states) {
  const latest = states[states.length - 1] || null;
  const previous = states[states.length - 2] || null;
  const scores = states.map(state => Number(state.overwhelm_score)).filter(score => !Number.isNaN(score));
  const averageScore = averageNumber(scores);
  const maxScore = scores.length ? Math.max(...scores) : null;
  const minScore = scores.length ? Math.min(...scores) : null;
  const variation = buildStateVariation(states);

  return {
    count: states.length,
    latest_state_id: latest?.id || null,
    previous_state_id: previous?.id || null,
    average_overwhelm_score: averageScore,
    max_overwhelm_score: maxScore,
    min_overwhelm_score: minScore,
    trend_direction: variation.direction,
    trend_label: variation.label,
    delta_score: variation.delta_score,
    generated_at: nowIso(),
  };
}

function compactUserStateForHistory(state) {
  return {
    id: state.id,
    user_id: state.user_id,
    cognitive_load: state.cognitive_load,
    emotional_state: state.emotional_state,
    energy_level: state.energy_level,
    focus_state: state.focus_state,
    dominant_mode: state.dominant_mode,
    overwhelm_score: state.overwhelm_score,
    detected_patterns: Array.isArray(state.detected_patterns) ? state.detected_patterns : [],
    recommendations: Array.isArray(state.recommendations) ? state.recommendations : [],
    created_at: state.created_at,
    updated_at: state.updated_at,
  };
}

function buildUserStateHistoryPayload(store, userId, limit = 30) {
  const states = getOrderedUserStates(store, userId, limit);

  return {
    summary: buildStateHistorySummary(states),
    trend: buildStateVariation(states),
    states: states.map(compactUserStateForHistory),
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
    suggested_actions: userActions.filter(action => action.status === 'suggested').length,
    draft_actions: userActions.filter(action => action.status === 'draft').length,
    executing_actions: userActions.filter(action => action.status === 'executing').length,
    done_actions: userActions.filter(action => action.status === 'done').length,
    failed_actions: userActions.filter(action => action.status === 'failed').length,
    cancelled_actions: userActions.filter(action => action.status === 'cancelled').length,
    project_count: userProjects.length,
    relation_count: userRelations.length,
    context_count: userContexts.length,
    user_state_count: (Array.isArray(store.user_states) ? store.user_states : []).filter(state => state.user_id === userId).length,
    adaptive_profile_count: (Array.isArray(store.adaptive_profiles) ? store.adaptive_profiles : []).filter(profile => profile.user_id === userId).length,
    proactive_event_count: (Array.isArray(store.proactive_events) ? store.proactive_events : []).filter(event => event.user_id === userId).length,
    cognitive_timeline_event_count: (Array.isArray(store.cognitive_timeline_events) ? store.cognitive_timeline_events : []).filter(event => event.user_id === userId).length,
    cognitive_memory_graph_count: (Array.isArray(store.cognitive_memory_graphs) ? store.cognitive_memory_graphs : []).filter(graph => graph.user_id === userId).length,
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
- si c’est une tâche : reformule clairement l’action
- si c’est une idée : dis que l’idée est capturée et propose où la ranger
- si c’est une émotion : valide brièvement et aide à poser le poids
- si c’est un projet : dis que c’est relié au projet concerné si un projet est détecté
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

    const exportAction = {
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
    };

    const exportActionEvent = attachInitialActionHistory(exportAction, 'Cahier des charges exporté vers Google Drive.');
    store.action_events = Array.isArray(store.action_events) ? store.action_events : [];
    store.action_events.push(exportActionEvent);
    store.actions.push(exportAction);

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

    const calendarAction = {
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
    };

    const calendarActionEvent = attachInitialActionHistory(calendarAction, 'Événement créé dans Google Agenda.');
    store.action_events = Array.isArray(store.action_events) ? store.action_events : [];
    store.action_events.push(calendarActionEvent);
    store.actions.push(calendarAction);

    store.actions = store.actions.slice(-300);
    store.action_events = store.action_events.slice(-1000);

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

    const taskAction = {
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
    };

    const taskActionEvent = attachInitialActionHistory(taskAction, 'Tâche créée dans Google Tasks.');
    store.action_events = Array.isArray(store.action_events) ? store.action_events : [];
    store.action_events.push(taskActionEvent);
    store.actions.push(taskAction);

    store.actions = store.actions.slice(-300);
    store.action_events = store.action_events.slice(-1000);

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
    engines: {
      context: true,
      focus: true,
      adaptive: true,
      proactive: true,
      timeline: true,
      memory_graph: true,
    },
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



// ------------------------------
// Focus Engine V1
// ------------------------------

const FOCUS_SESSION_STATUS_VALUES = [
  'suggested',
  'active',
  'break',
  'paused',
  'completed',
  'cancelled',
];

function normalizeFocusSessionStatus(status, fallback = 'suggested') {
  const normalized = normalizeKey(status || fallback).replace(/-/g, '_');

  if (FOCUS_SESSION_STATUS_VALUES.includes(normalized)) return normalized;
  if (normalized === 'running') return 'active';
  if (normalized === 'done' || normalized === 'finished') return 'completed';
  if (normalized === 'canceled') return 'cancelled';

  return fallback;
}

function getFocusModeLabel(mode) {
  if (mode === 'gentle_focus') return 'Focus doux';
  if (mode === 'standard_focus') return 'Focus standard';
  if (mode === 'deep_focus') return 'Focus profond';
  if (mode === 'recovery_focus') return 'Focus récupération';
  return 'Focus Nyra';
}

function recommendFocusProfile(userState) {
  const overwhelmScore = Number(userState?.overwhelm_score || 0);
  const cognitiveLoad = normalizeText(userState?.cognitive_load || '');
  const energyLevel = normalizeText(userState?.energy_level || '');
  const focusState = normalizeText(userState?.focus_state || '');
  const dominantMode = normalizeText(userState?.dominant_mode || '');

  if (
    overwhelmScore >= 80 ||
    cognitiveLoad === 'very_high' ||
    energyLevel === 'low' ||
    dominantMode === 'reduce_load'
  ) {
    return {
      mode: 'gentle_focus',
      focus_duration_min: 15,
      break_duration_min: 5,
      cycles_recommended: 1,
      tone: 'gentle',
      reason: 'Nyra détecte une surcharge élevée. Une session courte évite d’ajouter de la pression.',
      opening_message: 'On fait juste 15 minutes. Pas besoin de tout finir.',
      break_message: 'Pause de 5 minutes. Bois un peu, respire, puis on reprend doucement.',
    };
  }

  if (focusState === 'focused' && energyLevel !== 'low' && overwhelmScore <= 45) {
    return {
      mode: 'deep_focus',
      focus_duration_min: 45,
      break_duration_min: 10,
      cycles_recommended: 1,
      tone: 'direct',
      reason: 'Nyra détecte une meilleure disponibilité cognitive. Une session plus profonde est possible.',
      opening_message: 'Tu sembles disponible pour avancer. On lance une vraie session focus.',
      break_message: 'Pause de récupération. Laisse ton cerveau redescendre avant la suite.',
    };
  }

  if (energyLevel === 'low' || dominantMode === 'recover') {
    return {
      mode: 'recovery_focus',
      focus_duration_min: 10,
      break_duration_min: 7,
      cycles_recommended: 1,
      tone: 'soft',
      reason: 'Nyra détecte une énergie basse. Le but est de relancer sans forcer.',
      opening_message: 'On fait une mini-session. Juste une petite étape.',
      break_message: 'Pause plus longue. Récupération avant performance.',
    };
  }

  return {
    mode: 'standard_focus',
    focus_duration_min: 25,
    break_duration_min: 5,
    cycles_recommended: 1,
    tone: 'balanced',
    reason: 'Nyra propose une session standard 25/5 adaptée à une charge normale.',
    opening_message: 'On lance 25 minutes de focus sur une seule chose.',
    break_message: 'Pause de 5 minutes. Reviens ensuite pour décider si on relance un cycle.',
  };
}

function buildFocusSession({ userId, taskId, projectId, title, source, userState }) {
  const profile = recommendFocusProfile(userState);

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    task_id: taskId || null,
    project_id: projectId || null,
    title: cleanActionTitle(title || 'Session focus Nyra'),
    mode: profile.mode,
    mode_label: getFocusModeLabel(profile.mode),
    focus_duration_min: profile.focus_duration_min,
    break_duration_min: profile.break_duration_min,
    cycles_recommended: profile.cycles_recommended,
    completed_cycles: 0,
    status: 'suggested',
    tone: profile.tone,
    reason: profile.reason,
    opening_message: profile.opening_message,
    break_message: profile.break_message,
    interruptions: [],
    user_feedback: null,
    cognitive_state_before: userState || null,
    cognitive_state_after: null,
    source: source || 'manual',
    started_at: null,
    break_started_at: null,
    resumed_at: null,
    ended_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function getUserFocusSessions(store, userId) {
  return (Array.isArray(store.focus_sessions) ? store.focus_sessions : [])
    .filter(session => session.user_id === userId)
    .sort((a, b) => {
      return new Date(b.updated_at || b.created_at || 0).getTime() -
        new Date(a.updated_at || a.created_at || 0).getTime();
    });
}

function findFocusSession(store, userId, sessionId) {
  const sessions = Array.isArray(store.focus_sessions) ? store.focus_sessions : [];
  const index = sessions.findIndex(session => {
    return session.id === sessionId && session.user_id === userId;
  });

  if (index === -1) return null;

  return {
    index,
    session: sessions[index],
  };
}

function updateFocusSessionStatus(session, status, metadata = {}) {
  const nextStatus = normalizeFocusSessionStatus(status, session.status || 'suggested');
  session.status = nextStatus;
  session.updated_at = nowIso();

  if (nextStatus === 'active' && !session.started_at) {
    session.started_at = nowIso();
  }

  if (nextStatus === 'break') {
    session.break_started_at = nowIso();
    session.completed_cycles = Number(session.completed_cycles || 0) + 1;
  }

  if (nextStatus === 'active' && metadata.from_break) {
    session.resumed_at = nowIso();
  }

  if (nextStatus === 'completed' || nextStatus === 'cancelled') {
    session.ended_at = nowIso();
  }

  if (metadata.user_feedback) {
    session.user_feedback = metadata.user_feedback;
  }

  if (metadata.cognitive_state_after) {
    session.cognitive_state_after = metadata.cognitive_state_after;
  }

  return session;
}

function buildFocusRecommendation(store, userId) {
  const latestUserState = getLatestUserState(store, userId) || saveUserStateSnapshot(store, userId);
  const adaptiveProfile = getOrCreateAdaptiveProfile(store, userId);
  const profile = applyAdaptiveProfileToFocusRecommendation(
    recommendFocusProfile(latestUserState),
    adaptiveProfile,
    latestUserState
  );

  const recommendation = {
    mode: profile.mode,
    focus_minutes: profile.focus_duration_min,
    break_minutes: profile.break_duration_min,
    tone: profile.tone,
    reason: profile.reason,
    message: profile.opening_message,
    structure: buildFocusStructure(profile, latestUserState, adaptiveProfile),
    cycles_recommended: profile.cycles_recommended,
    mode_label: getFocusModeLabel(profile.mode),
    adaptive_profile_applied: true,
    adaptive_profile_summary: {
      preferred_focus_duration: adaptiveProfile?.preferred_focus_duration || null,
      overload_threshold: adaptiveProfile?.overload_threshold || null,
      average_completion_rate: adaptiveProfile?.average_completion_rate ?? null,
      learned_patterns: adaptiveProfile?.learned_patterns || [],
    },

    // Compatibilité ancienne structure backend
    focus_duration_min: profile.focus_duration_min,
    break_duration_min: profile.break_duration_min,
    opening_message: profile.opening_message,
    break_message: profile.break_message,
  };

  return {
    ok: true,
    userId,
    recommendation,
    recommended_profile: profile,
    adaptive_profile: adaptiveProfile,
    mode_label: getFocusModeLabel(profile.mode),
    user_state: latestUserState,
  };
}

function applyAdaptiveProfileToFocusRecommendation(profile, adaptiveProfile, userState) {
  if (!adaptiveProfile) return profile;

  const nextProfile = {
    ...profile,
  };

  const preferredDuration = Number(adaptiveProfile.preferred_focus_duration || 0);
  const overloadThreshold = Number(adaptiveProfile.overload_threshold || 70);
  const currentOverwhelm = Number(userState?.overwhelm_score || 0);
  const completionRate = Number(adaptiveProfile.average_completion_rate || 0);

  if (preferredDuration > 0 && currentOverwhelm < overloadThreshold) {
    nextProfile.focus_duration_min = preferredDuration;
  }

  if (currentOverwhelm >= overloadThreshold) {
    nextProfile.mode = 'gentle_focus';
    nextProfile.focus_duration_min = Math.min(preferredDuration || 15, 15);
    nextProfile.break_duration_min = Math.max(Number(nextProfile.break_duration_min || 5), 5);
    nextProfile.tone = 'gentle';
    nextProfile.reason = 'Nyra adapte la session à ton profil : surcharge au-dessus de ton seuil habituel.';
    nextProfile.opening_message = 'On réduit volontairement. Une seule micro-action suffit.';
  }

  if (completionRate > 0 && completionRate < 0.45) {
    nextProfile.mode = 'gentle_focus';
    nextProfile.focus_duration_min = Math.min(Number(nextProfile.focus_duration_min || 25), 15);
    nextProfile.reason = 'Nyra adapte la session : les cycles courts semblent plus réalistes pour toi en ce moment.';
    nextProfile.opening_message = 'Objectif réduit : juste commencer, sans te mettre en échec.';
  }

  if (preferredDuration >= 40 && currentOverwhelm < 50 && completionRate >= 0.65) {
    nextProfile.mode = 'deep_focus';
    nextProfile.focus_duration_min = preferredDuration;
    nextProfile.break_duration_min = Math.max(Number(nextProfile.break_duration_min || 5), 10);
    nextProfile.reason = 'Nyra adapte la session : ton profil semble tolérer les sessions profondes.';
    nextProfile.opening_message = 'Tu peux viser une session plus profonde, mais sans multiplier les objectifs.';
  }

  nextProfile.mode_label = getFocusModeLabel(nextProfile.mode);

  return nextProfile;
}

function buildFocusStructure(profile, userState, adaptiveProfile = null) {
  const structure = [];

  if (profile.mode === 'gentle_focus') {
    structure.push('Choisir une seule action simple.');
    structure.push('Faire 15 minutes sans chercher la perfection.');
    structure.push('S’arrêter dès que le timer indique la pause.');
  } else if (profile.mode === 'recovery_focus') {
    structure.push('Commencer par une micro-action.');
    structure.push('Avancer doucement, sans pression de performance.');
    structure.push('Faire une pause plus longue pour récupérer.');
  } else if (profile.mode === 'deep_focus') {
    structure.push('Bloquer une tâche importante.');
    structure.push('Éliminer les distractions visibles.');
    structure.push('Avancer en profondeur jusqu’à la pause.');
  } else {
    structure.push('Choisir une priorité claire.');
    structure.push('Faire 25 minutes de focus.');
    structure.push('Prendre 5 minutes de pause réelle.');
  }

  const cognitiveLoad = normalizeText(userState?.cognitive_load || '');

  if (cognitiveLoad === 'very_high' || cognitiveLoad === 'high') {
    structure.unshift('Réduire la session à l’essentiel.');
  }

  if (adaptiveProfile?.learned_patterns?.length) {
    const firstPattern = adaptiveProfile.learned_patterns[0];

    if (firstPattern?.label) {
      structure.push(`Profil appris : ${firstPattern.label}`);
    }
  }

  return uniqueArray(structure).slice(0, 4);
}

function decorateFocusSessionForMobile(session) {
  if (!session) return session;

  return {
    ...session,
    userId: session.user_id,
    focus_minutes: session.focus_minutes || session.focus_duration_min || 25,
    break_minutes: session.break_minutes || session.break_duration_min || 5,
    focus_duration_min: session.focus_duration_min || session.focus_minutes || 25,
    break_duration_min: session.break_duration_min || session.break_minutes || 5,
    status:
      session.status === 'active'
        ? 'running'
        : session.status === 'suggested'
          ? 'recommended'
          : session.status,
  };
}


function getUserAdaptiveProfile(store, userId) {
  const profiles = Array.isArray(store.adaptive_profiles)
    ? store.adaptive_profiles.filter(profile => profile.user_id === userId)
    : [];

  return profiles
    .sort((a, b) => {
      return new Date(b.updated_at || b.created_at || 0).getTime() -
        new Date(a.updated_at || a.created_at || 0).getTime();
    })[0] || null;
}

function getAdaptiveProfileSourceData(store, userId) {
  const focusSessions = Array.isArray(store.focus_sessions)
    ? store.focus_sessions.filter(session => session.user_id === userId)
    : [];

  const userStates = Array.isArray(store.user_states)
    ? store.user_states.filter(state => state.user_id === userId)
    : [];

  const actions = Array.isArray(store.actions)
    ? store.actions.filter(action => action.user_id === userId)
    : [];

  return {
    focusSessions,
    userStates,
    actions,
  };
}

function saveAdaptiveProfile(store, userId, profile) {
  store.adaptive_profiles = Array.isArray(store.adaptive_profiles)
    ? store.adaptive_profiles
    : [];

  const existingIndex = store.adaptive_profiles.findIndex(existingProfile => {
    return existingProfile.user_id === userId;
  });

  if (existingIndex >= 0) {
    const previous = store.adaptive_profiles[existingIndex];

    store.adaptive_profiles[existingIndex] = {
      ...previous,
      ...profile,
      id: previous.id || profile.id,
      user_id: userId,
      created_at: previous.created_at || profile.created_at || nowIso(),
      updated_at: nowIso(),
    };

    return store.adaptive_profiles[existingIndex];
  }

  const nextProfile = {
    ...profile,
    id: profile.id || crypto.randomUUID(),
    user_id: userId,
    created_at: profile.created_at || nowIso(),
    updated_at: nowIso(),
  };

  store.adaptive_profiles.push(nextProfile);
  store.adaptive_profiles = store.adaptive_profiles.slice(-500);

  return nextProfile;
}

function recomputeAdaptiveProfile(store, userId) {
  const sourceData = getAdaptiveProfileSourceData(store, userId);

  const profile = buildAdaptiveProfile({
    userId,
    focusSessions: sourceData.focusSessions,
    userStates: sourceData.userStates,
    actions: sourceData.actions,
  });

  return saveAdaptiveProfile(store, userId, {
    ...profile,
    source_counts: {
      focus_sessions: sourceData.focusSessions.length,
      user_states: sourceData.userStates.length,
      actions: sourceData.actions.length,
    },
  });
}

function getOrCreateAdaptiveProfile(store, userId) {
  const existingProfile = getUserAdaptiveProfile(store, userId);

  if (existingProfile) {
    return existingProfile;
  }

  return recomputeAdaptiveProfile(store, userId);
}



function getProactiveSourceData(store, userId) {
  const adaptiveProfile = getOrCreateAdaptiveProfile(store, userId);
  const latestUserState = getLatestUserState(store, userId) || saveUserStateSnapshot(store, userId);

  const focusSessions = Array.isArray(store.focus_sessions)
    ? store.focus_sessions
        .filter(session => session.user_id === userId)
        .slice(-30)
    : [];

  const actions = Array.isArray(store.actions)
    ? store.actions
        .filter(action => action.user_id === userId)
        .slice(-80)
    : [];

  return {
    adaptiveProfile,
    latestUserState,
    focusSessions,
    actions,
  };
}

function buildProactivePayload(store, userId) {
  const sourceData = getProactiveSourceData(store, userId);

  const signals = buildProactiveSignals({
    adaptiveProfile: sourceData.adaptiveProfile,
    latestUserState: sourceData.latestUserState,
    focusSessions: sourceData.focusSessions,
    actions: sourceData.actions,
  });

  const primarySignal = signals[0] || null;

  const payload = {
    id: crypto.randomUUID(),
    user_id: userId,
    signals,
    primary_signal: primarySignal,
    signal_count: signals.length,
    generated_at: nowIso(),
    source_snapshot: {
      adaptive_profile_id: sourceData.adaptiveProfile?.id || null,
      user_state_id: sourceData.latestUserState?.id || null,
      focus_session_count: sourceData.focusSessions.length,
      action_count: sourceData.actions.length,
      overwhelm_score: sourceData.latestUserState?.overwhelm_score ?? null,
      preferred_focus_duration: sourceData.adaptiveProfile?.preferred_focus_duration ?? null,
      average_completion_rate: sourceData.adaptiveProfile?.average_completion_rate ?? null,
    },
  };

  return payload;
}

function saveProactivePayload(store, payload) {
  store.proactive_events = Array.isArray(store.proactive_events)
    ? store.proactive_events
    : [];

  store.proactive_events.push(payload);
  store.proactive_events = store.proactive_events.slice(-500);

  return payload;
}

function getRecentProactiveEvents(store, userId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

  return (Array.isArray(store.proactive_events) ? store.proactive_events : [])
    .filter(event => event.user_id === userId)
    .sort((a, b) => {
      return new Date(b.generated_at || b.created_at || 0).getTime() -
        new Date(a.generated_at || a.created_at || 0).getTime();
    })
    .slice(0, safeLimit);
}



function getTimelineSourceData(store, userId) {
  const userStates = Array.isArray(store.user_states)
    ? store.user_states.filter(state => state.user_id === userId)
    : [];

  const focusSessions = Array.isArray(store.focus_sessions)
    ? store.focus_sessions.filter(session => session.user_id === userId)
    : [];

  const proactiveEvents = Array.isArray(store.proactive_events)
    ? store.proactive_events.filter(event => event.user_id === userId)
    : [];

  const actions = Array.isArray(store.actions)
    ? store.actions.filter(action => action.user_id === userId)
    : [];

  return {
    userStates,
    focusSessions,
    proactiveEvents,
    actions,
  };
}

function buildCognitiveTimelinePayload(store, userId) {
  const sourceData = getTimelineSourceData(store, userId);

  const insights = buildTimelineInsights({
    userStates: sourceData.userStates,
    focusSessions: sourceData.focusSessions,
    proactiveEvents: sourceData.proactiveEvents,
  });

  const latestInsight = insights[0] || null;

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    insights,
    latest_insight: latestInsight,
    insight_count: insights.length,
    generated_at: nowIso(),
    source_snapshot: {
      user_state_count: sourceData.userStates.length,
      focus_session_count: sourceData.focusSessions.length,
      proactive_event_count: sourceData.proactiveEvents.length,
      action_count: sourceData.actions.length,
      latest_overwhelm_score:
        sourceData.userStates[sourceData.userStates.length - 1]?.overwhelm_score ?? null,
    },
  };
}

function saveCognitiveTimelinePayload(store, payload) {
  store.cognitive_timeline_events = Array.isArray(store.cognitive_timeline_events)
    ? store.cognitive_timeline_events
    : [];

  store.cognitive_timeline_events.push(payload);
  store.cognitive_timeline_events = store.cognitive_timeline_events.slice(-500);

  return payload;
}

function getRecentCognitiveTimelineEvents(store, userId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

  return (Array.isArray(store.cognitive_timeline_events) ? store.cognitive_timeline_events : [])
    .filter(event => event.user_id === userId)
    .sort((a, b) => {
      return new Date(b.generated_at || 0).getTime() -
        new Date(a.generated_at || 0).getTime();
    })
    .slice(0, safeLimit);
}



function getMemoryGraphSourceData(store, userId) {
  return {
    items: Array.isArray(store.items)
      ? store.items.filter(item => item.user_id === userId).slice(-150)
      : [],
    actions: Array.isArray(store.actions)
      ? store.actions.filter(action => action.user_id === userId).slice(-120)
      : [],
    projects: Array.isArray(store.projects)
      ? store.projects.filter(project => project.user_id === userId)
      : [],
    userStates: Array.isArray(store.user_states)
      ? store.user_states.filter(state => state.user_id === userId).slice(-120)
      : [],
    focusSessions: Array.isArray(store.focus_sessions)
      ? store.focus_sessions.filter(session => session.user_id === userId).slice(-120)
      : [],
    proactiveEvents: Array.isArray(store.proactive_events)
      ? store.proactive_events.filter(event => event.user_id === userId).slice(-80)
      : [],
    timelineEvents: Array.isArray(store.cognitive_timeline_events)
      ? store.cognitive_timeline_events.filter(event => event.user_id === userId).slice(-80)
      : [],
  };
}

function buildMemoryGraphPayload(store, userId) {
  const sourceData = getMemoryGraphSourceData(store, userId);

  const graph = buildCognitiveMemoryGraph({
    userId,
    ...sourceData,
  });

  const insights = buildMemoryGraphInsights(graph);

  return {
    ...graph,
    insights,
    insight_count: insights.length,
    source_snapshot: {
      item_count: sourceData.items.length,
      action_count: sourceData.actions.length,
      project_count: sourceData.projects.length,
      user_state_count: sourceData.userStates.length,
      focus_session_count: sourceData.focusSessions.length,
      proactive_event_count: sourceData.proactiveEvents.length,
      timeline_event_count: sourceData.timelineEvents.length,
    },
  };
}

function saveMemoryGraphPayload(store, payload) {
  store.cognitive_memory_graphs = Array.isArray(store.cognitive_memory_graphs)
    ? store.cognitive_memory_graphs
    : [];

  const existingIndex = store.cognitive_memory_graphs.findIndex(graph => {
    return graph.user_id === payload.user_id;
  });

  if (existingIndex >= 0) {
    store.cognitive_memory_graphs[existingIndex] = {
      ...payload,
      created_at: store.cognitive_memory_graphs[existingIndex].created_at || payload.generated_at,
      updated_at: nowIso(),
    };

    return store.cognitive_memory_graphs[existingIndex];
  }

  store.cognitive_memory_graphs.push({
    ...payload,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  store.cognitive_memory_graphs = store.cognitive_memory_graphs.slice(-200);

  return payload;
}

function getLatestMemoryGraph(store, userId) {
  return (Array.isArray(store.cognitive_memory_graphs) ? store.cognitive_memory_graphs : [])
    .filter(graph => graph.user_id === userId)
    .sort((a, b) => {
      return new Date(b.updated_at || b.generated_at || 0).getTime() -
        new Date(a.updated_at || a.generated_at || 0).getTime();
    })[0] || null;
}


app.get('/memory-graph', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const refresh = normalizeText(req.query?.refresh || '') === 'true';
  const store = readStore();

  let graph = refresh ? null : getLatestMemoryGraph(store, userId);

  if (!graph) {
    graph = buildMemoryGraphPayload(store, userId);
    saveMemoryGraphPayload(store, graph);
    writeStore(store);
  }

  return res.json({
    ok: true,
    userId,
    graph,
  });
});

app.post('/memory-graph/recompute', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const store = readStore();

  const graph = buildMemoryGraphPayload(store, userId);
  saveMemoryGraphPayload(store, graph);
  writeStore(store);

  return res.json({
    ok: true,
    userId,
    graph,
    message: 'Graph mémoire cognitif recalculé.',
  });
});

app.get('/memory-graph/insights', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  let graph = getLatestMemoryGraph(store, userId);

  if (!graph) {
    graph = buildMemoryGraphPayload(store, userId);
    saveMemoryGraphPayload(store, graph);
    writeStore(store);
  }

  return res.json({
    ok: true,
    userId,
    insights: graph.insights || [],
    stats: graph.stats || {},
    source_snapshot: graph.source_snapshot || {},
  });
});

app.get('/timeline/insights', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const persist = normalizeText(req.query?.persist || 'true') !== 'false';
  const store = readStore();

  const payload = buildCognitiveTimelinePayload(store, userId);

  if (persist) {
    saveCognitiveTimelinePayload(store, payload);
    writeStore(store);
  }

  return res.json({
    ok: true,
    userId,
    ...payload,
  });
});

app.post('/timeline/analyze', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const store = readStore();

  const payload = buildCognitiveTimelinePayload(store, userId);
  saveCognitiveTimelinePayload(store, payload);
  writeStore(store);

  return res.json({
    ok: true,
    userId,
    ...payload,
  });
});

app.get('/timeline/history', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 20), 100));
  const store = readStore();

  const events = getRecentCognitiveTimelineEvents(store, userId, limit);

  return res.json({
    ok: true,
    userId,
    count: events.length,
    events,
  });
});

app.get('/proactive/signals', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const persist = normalizeText(req.query?.persist || 'true') !== 'false';
  const store = readStore();

  const payload = buildProactivePayload(store, userId);

  if (persist) {
    saveProactivePayload(store, payload);
    writeStore(store);
  }

  return res.json({
    ok: true,
    userId,
    ...payload,
  });
});

app.post('/proactive/check', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const store = readStore();

  const payload = buildProactivePayload(store, userId);
  saveProactivePayload(store, payload);
  writeStore(store);

  return res.json({
    ok: true,
    userId,
    ...payload,
  });
});

app.get('/proactive/history', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 20), 100));
  const store = readStore();

  const events = getRecentProactiveEvents(store, userId, limit);

  return res.json({
    ok: true,
    userId,
    count: events.length,
    events,
  });
});

app.get('/adaptive/profile', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const refresh = normalizeText(req.query?.refresh || '') === 'true';
  const store = readStore();

  let profile = refresh
    ? recomputeAdaptiveProfile(store, userId)
    : getOrCreateAdaptiveProfile(store, userId);

  if (refresh || !getUserAdaptiveProfile(store, userId)) {
    writeStore(store);
  }

  return res.json({
    ok: true,
    userId,
    profile,
  });
});

app.post('/adaptive/recompute', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const store = readStore();

  const profile = recomputeAdaptiveProfile(store, userId);

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    profile,
    message: 'Profil cognitif adaptatif recalculé.',
  });
});

app.get('/adaptive/summary', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const profile = getOrCreateAdaptiveProfile(store, userId);
  const sourceData = getAdaptiveProfileSourceData(store, userId);

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    summary: {
      preferred_focus_duration: profile.preferred_focus_duration,
      optimal_focus_window: profile.optimal_focus_window,
      overload_threshold: profile.overload_threshold,
      average_completion_rate: profile.average_completion_rate,
      average_focus_score: profile.average_focus_score,
      learned_patterns: profile.learned_patterns || [],
      total_focus_sessions: sourceData.focusSessions.length,
      total_user_states: sourceData.userStates.length,
      total_actions: sourceData.actions.length,
    },
    profile,
  });
});

app.get('/state/user', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const forceRefresh = normalizeText(req.query?.refresh || '') === 'true';
  const store = readStore();

  let userState = getLatestUserState(store, userId);

  if (!userState || forceRefresh) {
    userState = saveUserStateSnapshot(store, userId);
    writeStore(store);
  }

  return res.json({
    ok: true,
    userId,
    user_state: userState,
    trend: getUserStateTrend(store, userId),
    summary: getStoreSummary(userId),
  });
});

app.get('/state/history', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 30), 100));
  const refresh = normalizeText(req.query?.refresh || '') === 'true';
  const store = readStore();

  if (refresh || !getLatestUserState(store, userId)) {
    saveUserStateSnapshot(store, userId);
    writeStore(store);
  }

  const history = buildUserStateHistoryPayload(store, userId, limit);

  return res.json({
    ok: true,
    userId,
    limit,
    ...history,
  });
});


app.get('/focus/recommendation', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const recommendation = buildFocusRecommendation(store, userId);
  writeStore(store);

  return res.json(recommendation);
});

app.get('/focus/sessions', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 20), 100));
  const store = readStore();

  const sessions = getUserFocusSessions(store, userId).slice(0, limit);

  return res.json({
    ok: true,
    userId,
    count: sessions.length,
    sessions,
  });
});

app.post('/focus/sessions', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const taskId = normalizeText(req.body?.taskId || '');
  const projectId = normalizeText(req.body?.projectId || '');
  const incomingRecommendation =
    req.body?.recommendation && typeof req.body.recommendation === 'object'
      ? req.body.recommendation
      : null;
  const title = normalizeText(
    req.body?.title ||
      req.body?.taskTitle ||
      incomingRecommendation?.message ||
      incomingRecommendation?.reason ||
      'Session focus Nyra'
  );
  const source = normalizeText(req.body?.source || 'mobile_ui');

  const store = readStore();
  const latestUserState = getLatestUserState(store, userId) || saveUserStateSnapshot(store, userId);

  const session = buildFocusSession({
    userId,
    taskId,
    projectId,
    title,
    source,
    userState: latestUserState,
  });

  if (incomingRecommendation) {
    session.mode = normalizeText(incomingRecommendation.mode || session.mode) || session.mode;
    session.mode_label = getFocusModeLabel(session.mode);
    session.focus_duration_min = Number(incomingRecommendation.focus_minutes || incomingRecommendation.focus_duration_min || session.focus_duration_min);
    session.break_duration_min = Number(incomingRecommendation.break_minutes || incomingRecommendation.break_duration_min || session.break_duration_min);
    session.focus_minutes = session.focus_duration_min;
    session.break_minutes = session.break_duration_min;
    session.tone = normalizeText(incomingRecommendation.tone || session.tone) || session.tone;
    session.reason = normalizeText(incomingRecommendation.reason || session.reason) || session.reason;
    session.opening_message = normalizeText(incomingRecommendation.message || incomingRecommendation.opening_message || session.opening_message) || session.opening_message;
    session.structure = Array.isArray(incomingRecommendation.structure)
      ? incomingRecommendation.structure
      : buildFocusStructure(
          {
            mode: session.mode,
            focus_duration_min: session.focus_duration_min,
            break_duration_min: session.break_duration_min,
          },
          latestUserState
        );
  } else {
    session.focus_minutes = session.focus_duration_min;
    session.break_minutes = session.break_duration_min;
    session.structure = buildFocusStructure(
      {
        mode: session.mode,
        focus_duration_min: session.focus_duration_min,
        break_duration_min: session.break_duration_min,
      },
      latestUserState
    );
  }

  store.focus_sessions = Array.isArray(store.focus_sessions) ? store.focus_sessions : [];
  store.focus_sessions.push(session);

  const userSessions = store.focus_sessions.filter(existingSession => existingSession.user_id === userId);
  const otherSessions = store.focus_sessions.filter(existingSession => existingSession.user_id !== userId);

  store.focus_sessions = [
    ...otherSessions,
    ...userSessions.slice(-100),
  ].slice(-500);

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    session: decorateFocusSessionForMobile(session),
    recommendation: {
      mode: session.mode,
      mode_label: session.mode_label,
      focus_minutes: session.focus_duration_min,
      break_minutes: session.break_duration_min,
      focus_duration_min: session.focus_duration_min,
      break_duration_min: session.break_duration_min,
      tone: session.tone,
      reason: session.reason,
      message: session.opening_message,
      structure: session.structure || [],
    },
  });
});

app.patch('/focus/sessions/:sessionId/status', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const sessionId = normalizeText(req.params.sessionId);
  const status = normalizeText(req.body?.status || '');
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object'
    ? req.body.metadata
    : {};

  if (!status) {
    return res.status(400).json({
      ok: false,
      error: 'Statut focus manquant',
      allowed_statuses: FOCUS_SESSION_STATUS_VALUES,
    });
  }

  const normalizedStatus = normalizeFocusSessionStatus(status, '');

  if (!FOCUS_SESSION_STATUS_VALUES.includes(normalizedStatus)) {
    return res.status(400).json({
      ok: false,
      error: 'Statut focus invalide',
      allowed_statuses: FOCUS_SESSION_STATUS_VALUES,
    });
  }

  const store = readStore();
  const found = findFocusSession(store, userId, sessionId);

  if (!found) {
    return res.status(404).json({
      ok: false,
      error: 'Session focus introuvable',
    });
  }

  const updatedSession = updateFocusSessionStatus(found.session, normalizedStatus, metadata);

  if (normalizedStatus === 'completed' || normalizedStatus === 'cancelled') {
    updatedSession.cognitive_state_after = getLatestUserState(store, userId) || null;
    updatedSession.learning_metadata = {
      ...(updatedSession.learning_metadata || {}),
      final_status: normalizedStatus,
      completed_at: normalizedStatus === 'completed' ? nowIso() : updatedSession.completed_at || null,
      cancelled_at: normalizedStatus === 'cancelled' ? nowIso() : updatedSession.cancelled_at || null,
      metadata_snapshot: metadata,
    };
    recomputeAdaptiveProfile(store, userId);
  }

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    session: decorateFocusSessionForMobile(updatedSession),
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


app.get('/store/action-events', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const actionId = normalizeText(req.query?.actionId || '');
  const store = readStore();

  let events = Array.isArray(store.action_events)
    ? store.action_events.filter(event => event.user_id === userId)
    : [];

  if (actionId) {
    events = events.filter(event => event.action_id === actionId);
  }

  res.json({
    ok: true,
    userId,
    actionId: actionId || null,
    count: events.length,
    events,
  });
});

app.get('/store/actions/:actionId', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const actionId = normalizeText(req.params.actionId);
  const store = readStore();
  const found = findOrRecoverUserAction(store, userId, actionId);

  if (!found) {
    return res.status(404).json({
      ok: false,
      error: 'Action introuvable',
      debug: buildActionNotFoundDebug(store, userId, actionId),
    });
  }

  if (found.recovered) {
    writeStore(store);
  }

  const events = Array.isArray(store.action_events)
    ? store.action_events.filter(event => event.action_id === found.action.id)
    : [];

  return res.json({
    ok: true,
    userId,
    effective_user_id: found.action.user_id || userId,
    action: found.action,
    events,
  });
});

app.patch('/store/actions/:actionId/status', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const actionId = normalizeText(req.params.actionId);
  const status = normalizeText(req.body?.status || '');
  const reason = normalizeText(req.body?.reason || 'Mise à jour manuelle du statut.');
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object'
    ? req.body.metadata
    : {};

  if (!status) {
    return res.status(400).json({
      ok: false,
      error: 'Statut manquant',
      allowed_statuses: ACTION_STATUS_VALUES,
    });
  }

  const normalizedStatus = normalizeActionStatus(status, '');

  if (!ACTION_STATUS_VALUES.includes(normalizedStatus)) {
    return res.status(400).json({
      ok: false,
      error: 'Statut invalide',
      allowed_statuses: ACTION_STATUS_VALUES,
    });
  }

  const store = readStore();
  let result = updateActionStatusInStore({
    store,
    userId,
    actionId,
    status: normalizedStatus,
    reason,
    metadata,
    source: 'api_status_update',
  });

  if (!result.ok) {
    return res.status(404).json({
      ok: false,
      error: 'Action introuvable',
      debug: result.debug || buildActionNotFoundDebug(store, userId, actionId),
    });
  }

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    changed: result.changed,
    action: result.action,
    event: result.event,
    linked_item: result.item,
  });
});

app.post('/store/actions/:actionId/retry', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const actionId = normalizeText(req.params.actionId);
  const reason = normalizeText(req.body?.reason || 'Nouvelle tentative demandée.');
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object'
    ? req.body.metadata
    : {};

  const store = readStore();
  const result = retryActionInStore({
    store,
    userId,
    actionId,
    reason,
    metadata,
  });

  if (!result.ok) {
    return res.status(404).json({
      ok: false,
      error: 'Action introuvable',
    });
  }

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    action: result.action,
    event: result.event,
    linked_item: result.item,
    message: 'Action remise en attente pour une nouvelle tentative.',
  });
});

app.post('/store/actions/:actionId/complete', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const actionId = normalizeText(req.params.actionId);
  const reason = normalizeText(req.body?.reason || 'Action marquée comme terminée.');
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object'
    ? req.body.metadata
    : {};

  const store = readStore();
  const result = updateActionStatusInStore({
    store,
    userId,
    actionId,
    status: 'done',
    reason,
    metadata,
    source: 'api_complete',
  });

  if (!result.ok) {
    return res.status(404).json({
      ok: false,
      error: 'Action introuvable',
    });
  }

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    action: result.action,
    event: result.event,
    linked_item: result.item,
  });
});

app.post('/store/actions/:actionId/cancel', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const actionId = normalizeText(req.params.actionId);
  const reason = normalizeText(req.body?.reason || 'Action annulée.');
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object'
    ? req.body.metadata
    : {};

  const store = readStore();
  const result = updateActionStatusInStore({
    store,
    userId,
    actionId,
    status: 'cancelled',
    reason,
    metadata,
    source: 'api_cancel',
  });

  if (!result.ok) {
    return res.status(404).json({
      ok: false,
      error: 'Action introuvable',
    });
  }

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    action: result.action,
    event: result.event,
    linked_item: result.item,
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
      linked_project: saved.project,
      created_relation: saved.relation,
      updated_context: saved.context,
      user_state: saved.user_state,
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