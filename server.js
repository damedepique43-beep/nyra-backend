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
const { analyzePriorities } = require('./engines/cognitivePriorityEngine');
const { compressTask } = require('./engines/actionCompressionEngine');
const { analyzeMomentumRecovery } = require('./engines/momentumRecoveryEngine');
const { buildNyraCognitiveOrchestration } = require('./engines/nyraCognitiveOrchestrator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const ELEVENLABS_API_KEY =
  process.env.ELEVENLABS_API_KEY ||
  process.env.elevenlabs_api_key ||
  '';

const ELEVENLABS_DEFAULT_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID ||
  process.env.elevenlabs_voice_id ||
  'Ka6yOFdNGhzFuCVW6VyO';

const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID ||
  process.env.elevenlabs_model_id ||
  'eleven_multilingual_v2';

const ELEVENLABS_OUTPUT_FORMAT =
  process.env.ELEVENLABS_OUTPUT_FORMAT ||
  process.env.elevenlabs_output_format ||
  'mp3_44100_128';

const ELEVENLABS_VOICE_SETTINGS = {
  stability: Number(process.env.ELEVENLABS_STABILITY || 0.42),
  similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY_BOOST || 0.82),
  style: Number(process.env.ELEVENLABS_STYLE || 0.35),
  use_speaker_boost: true,
};

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

const STORE_VERSION = 'proactive-assistant-v2';

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
    sessions: [],
    user_states: [],
    focus_sessions: [],
    adaptive_profiles: [],
    proactive_events: [],
    cognitive_timeline_events: [],
    cognitive_memory_graphs: [],
    cognitive_priority_snapshots: [],
    cognitive_history_analyses: [],
    proactive_assistant_v2_events: [],
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

    const normalizedStore = {
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
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions
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
      cognitive_priority_snapshots: Array.isArray(parsed.cognitive_priority_snapshots)
        ? parsed.cognitive_priority_snapshots
        : [],
      cognitive_history_analyses: Array.isArray(parsed.cognitive_history_analyses)
        ? parsed.cognitive_history_analyses
        : [],
      proactive_assistant_v2_events: Array.isArray(parsed.proactive_assistant_v2_events)
        ? parsed.proactive_assistant_v2_events
        : [],
      updated_at: parsed.updated_at || null,
    }

    return migrateLegacyReflectionReprises(cleanupReservedAutoProjects(normalizedStore));  } catch (error) {
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
      sessions: Array.isArray(store.sessions) ? store.sessions : [],
      action_events: Array.isArray(store.action_events) ? store.action_events : [],
      user_states: Array.isArray(store.user_states) ? store.user_states : [],
      focus_sessions: Array.isArray(store.focus_sessions) ? store.focus_sessions : [],
      adaptive_profiles: Array.isArray(store.adaptive_profiles) ? store.adaptive_profiles : [],
      proactive_events: Array.isArray(store.proactive_events) ? store.proactive_events : [],
      cognitive_timeline_events: Array.isArray(store.cognitive_timeline_events) ? store.cognitive_timeline_events : [],
      cognitive_memory_graphs: Array.isArray(store.cognitive_memory_graphs) ? store.cognitive_memory_graphs : [],
      cognitive_priority_snapshots: Array.isArray(store.cognitive_priority_snapshots) ? store.cognitive_priority_snapshots : [],
      cognitive_history_analyses: Array.isArray(store.cognitive_history_analyses) ? store.cognitive_history_analyses : [],
      proactive_assistant_v2_events: Array.isArray(store.proactive_assistant_v2_events) ? store.proactive_assistant_v2_events : [],
      version: STORE_VERSION,
      updated_at: nowIso(),
    };

    const cleanedStore = migrateLegacyReflectionReprises(cleanupReservedAutoProjects(safeStore));

    fs.writeFileSync(STORE_FILE, JSON.stringify(cleanedStore, null, 2), 'utf8');
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


const RESERVED_AUTO_PROJECT_KEYS = new Set([
  'nyra',
  'novacall',
  'nova-call',
  'dame-de-pique',
  'brumeardente',
  'brume-ardente',
]);

function isReservedAutoProjectName(value) {
  const key = normalizeKey(value || '');
  return Boolean(key && RESERVED_AUTO_PROJECT_KEYS.has(key));
}

function removeReservedProjectTags(tags) {
  if (!Array.isArray(tags)) return [];

  return tags.filter(tag => {
    return !isReservedAutoProjectName(tag);
  });
}

function cleanReservedProjectFields(entity) {
  if (!entity || typeof entity !== 'object') return entity;

  if (isReservedAutoProjectName(entity.project_name)) {
    entity.project_name = null;
  }

  entity.tags = removeReservedProjectTags(entity.tags);

  return entity;
}

function cleanupReservedAutoProjects(store) {
  if (!store || typeof store !== 'object') return store;

  const projects = Array.isArray(store.projects) ? store.projects : [];
  const reservedProjectIds = new Set(
    projects
      .filter(project => isReservedAutoProjectName(project.name || project.project_name || project.key))
      .map(project => project.id)
      .filter(Boolean)
  );

  store.projects = projects.filter(project => {
    return !isReservedAutoProjectName(project.name || project.project_name || project.key);
  });

  store.items = (Array.isArray(store.items) ? store.items : []).map(item => {
    cleanReservedProjectFields(item);

    if (reservedProjectIds.has(item.project_id) || isReservedAutoProjectName(item.project_name)) {
      item.project_id = null;
      item.project_name = null;
      item.tags = removeReservedProjectTags(item.tags);
      item.updated_at = item.updated_at || nowIso();
    }

    return item;
  });

  store.actions = (Array.isArray(store.actions) ? store.actions : []).map(action => {
    cleanReservedProjectFields(action);

    if (reservedProjectIds.has(action.project_id) || isReservedAutoProjectName(action.project_name)) {
      action.project_id = null;
      action.project_name = null;
      action.tags = removeReservedProjectTags(action.tags);
      action.updated_at = action.updated_at || nowIso();
    }

    return action;
  });

  store.conversations = (Array.isArray(store.conversations) ? store.conversations : []).map(conversation => {
    cleanReservedProjectFields(conversation);

    if (reservedProjectIds.has(conversation.project_id) || isReservedAutoProjectName(conversation.project_name)) {
      conversation.project_id = null;
      conversation.project_name = null;
      conversation.relation_id = null;
    }

    return conversation;
  });

  store.relations = (Array.isArray(store.relations) ? store.relations : []).filter(relation => {
    const metadataProjectName = relation?.metadata?.project_name || '';

    return !(
      reservedProjectIds.has(relation.target_id) ||
      reservedProjectIds.has(relation.source_id) ||
      isReservedAutoProjectName(metadataProjectName)
    );
  });

  store.contexts = (Array.isArray(store.contexts) ? store.contexts : []).filter(context => {
    return !(
      reservedProjectIds.has(context.project_id) ||
      isReservedAutoProjectName(context.name) ||
      isReservedAutoProjectName(context.project_name)
    );
  });

  return store;
}

function buildGoogleNyraUserId(googleUserId, googleEmail) {
  const stableSource = normalizeText(googleUserId || googleEmail || crypto.randomUUID());
  return `google-${normalizeKey(stableSource)}`;
}


function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function buildEmailNyraUserId(email) {
  const stableEmail = normalizeEmail(email);
  const digest = crypto
    .createHash('sha256')
    .update(stableEmail)
    .digest('hex')
    .slice(0, 24);

  return `email-${digest}`;
}

function isValidEmail(email) {
  const value = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePassword(password) {
  const value = String(password || '');

  if (value.length < 8) {
    return {
      ok: false,
      error: 'PASSWORD_TOO_SHORT',
      message: 'Le mot de passe doit contenir au moins 8 caractères.',
    };
  }

  return {
    ok: true,
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto
    .pbkdf2Sync(String(password || ''), salt, 120000, 64, 'sha512')
    .toString('hex');

  return {
    algorithm: 'pbkdf2_sha512',
    iterations: 120000,
    salt,
    hash,
  };
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || typeof passwordHash !== 'object') {
    return false;
  }

  const salt = normalizeText(passwordHash.salt || '');
  const expectedHash = normalizeText(passwordHash.hash || '');

  if (!salt || !expectedHash) {
    return false;
  }

  const candidate = hashPassword(password, salt).hash;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(candidate, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch {
    return false;
  }
}

function sanitizeUserForClient(user) {
  if (!user) return null;

  const profileName = normalizeText(user.profile_name || '');
  const profilePicture = normalizeText(user.profile_picture || user.profile_picture_url || '');

  return {
    id: user.id,
    provider: user.provider || null,
    auth_providers: Array.isArray(user.auth_providers) ? user.auth_providers : [user.provider || 'unknown'],
    email: user.email || null,
    name: user.name || null,
    picture: user.picture || null,
    profile_name: profileName || null,
    profile_picture: profilePicture || null,
    display_name: profileName || user.name || user.email || null,
    display_picture: profilePicture || user.picture || null,
    google_user_id: user.google_user_id || null,
    legacy_user_id: user.legacy_user_id || null,
    access_type: user.access_type || 'standard',
    onboarding_completed: Boolean(user.onboarding_completed),
    created_at: user.created_at || null,
    updated_at: user.updated_at || null,
  };
}

function createNyraSession(store, user, source = 'email') {
  store.sessions = Array.isArray(store.sessions) ? store.sessions : [];

  const token = crypto.randomBytes(48).toString('hex');
  const session = {
    id: crypto.randomUUID(),
    user_id: user.id,
    token_hash: crypto
      .createHash('sha256')
      .update(token)
      .digest('hex'),
    source,
    status: 'active',
    created_at: nowIso(),
    updated_at: nowIso(),
    last_seen_at: nowIso(),
  };

  store.sessions.push(session);
  store.sessions = store.sessions.slice(-1000);

  return {
    token,
    session,
  };
}

function getSessionTokenFromRequest(req) {
  const authHeader = normalizeText(req.headers?.authorization || '');
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);

  if (bearerMatch?.[1]) {
    return normalizeText(bearerMatch[1]);
  }

  return normalizeText(req.body?.token || req.query?.token || '');
}

function findActiveSession(store, token) {
  const rawToken = normalizeText(token);

  if (!rawToken) return null;

  const tokenHash = crypto
    .createHash('sha256')
    .update(rawToken)
    .digest('hex');

  const sessions = Array.isArray(store.sessions) ? store.sessions : [];
  const session = sessions.find(item => {
    return item.token_hash === tokenHash && item.status === 'active';
  });

  if (!session) return null;

  session.last_seen_at = nowIso();
  session.updated_at = nowIso();

  const user = (Array.isArray(store.users) ? store.users : []).find(existingUser => {
    return existingUser.id === session.user_id;
  });

  if (!user) return null;

  return {
    session,
    user,
  };
}

function findUserForProfileUpdate(store, req) {
  const token = getSessionTokenFromRequest(req);

  if (token) {
    const sessionResult = findActiveSession(store, token);

    if (sessionResult?.user) {
      return sessionResult.user;
    }
  }

  const requestedUserId = normalizeText(req.body?.userId || req.query?.userId || '');

  if (!requestedUserId) return null;

  return (Array.isArray(store.users) ? store.users : []).find(existingUser => {
    return (
      existingUser.id === requestedUserId ||
      existingUser.legacy_user_id === requestedUserId ||
      existingUser.google_user_id === requestedUserId
    );
  }) || null;
}

function sanitizeProfilePicture(value) {
  const picture = normalizeText(value || '');

  if (!picture) return '';

  const isAllowedProfilePicture =
    /^https:\/\//i.test(picture) ||
    /^file:\/\//i.test(picture) ||
    /^content:\/\//i.test(picture) ||
    /^data:image\//i.test(picture);

  if (!isAllowedProfilePicture) {
    return '';
  }

  return picture.slice(0, 4000);
}


function upsertEmailUser(store, email, password, name = '') {
  const normalizedEmail = normalizeEmail(email);
  const emailUserId = buildEmailNyraUserId(normalizedEmail);

  let user = store.users.find(existingUser => {
    return normalizeEmail(existingUser.email || '') === normalizedEmail;
  });

  const passwordHash = hashPassword(password);

  if (!user) {
    user = {
      id: emailUserId,
      provider: 'email',
      auth_providers: ['email'],
      email: normalizedEmail,
      name: normalizeText(name) || null,
      picture: null,
      google_user_id: null,
      legacy_user_id: null,
      access_type: normalizedEmail === 'damedepique43@gmail.com' ? 'founder_or_local' : 'standard',
      password_hash: passwordHash,
      email_verified: false,
      onboarding_completed: false,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    store.users.push(user);
    return {
      user,
      created: true,
    };
  }

  const providers = new Set(Array.isArray(user.auth_providers) ? user.auth_providers : [user.provider || 'email']);
  providers.add('email');

  user.provider = user.provider === 'google' ? 'google' : 'email';
  user.auth_providers = [...providers];
  user.email = normalizedEmail;
  user.name = normalizeText(name) || user.name || null;
  user.password_hash = passwordHash;
  user.access_type = user.access_type || (normalizedEmail === 'damedepique43@gmail.com' ? 'founder_or_local' : 'standard');
  user.updated_at = nowIso();

  return {
    user,
    created: false,
  };
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
    .replace(/^rappelle-moi\s+/i, '')
    .replace(/^rappelle moi\s+/i, '')
    .replace(/^rappelle\s+/i, '')
    .replace(/^ajoute\s+/i, '')
    .replace(/^rajoute\s+/i, '')
    .replace(/^mets\s+/i, '')
    .replace(/^note\s+/i, '')
    .replace(/\s+(à|a|dans)\s+(ma\s+|la\s+)?liste\s+de\s+courses.*$/i, '')
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

function getLocalDateParts(date = new Date(), timeZone = 'Europe/Paris') {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function buildParisDateAt(hour, minute = 0, dayOffset = 0) {
  const baseParts = getLocalDateParts(new Date(), 'Europe/Paris');
  const utcCandidate = new Date(Date.UTC(
    baseParts.year,
    baseParts.month - 1,
    baseParts.day + dayOffset,
    Number(hour || 9) - 1,
    Number(minute || 0),
    0,
    0
  ));

  return utcCandidate.toISOString();
}

function extractExplicitTime(text) {
  const lower = normalizeText(text).toLowerCase();
  const match = lower.match(/(?:à|a|vers)?\s*(\d{1,2})\s*(?:h|:|\.)\s*(\d{0,2})/i);

  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

function resolveReminderSchedule(text, datetimeHint) {
  const lower = normalizeText(text).toLowerCase();
  const explicitTime = extractExplicitTime(lower);

  if (includesAny(lower, ['dans 5 minutes'])) {
    return {
      scheduled_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      precision: 'relative_exact',
      has_exact_date: true,
    };
  }

  const relativeSecondsMatch = lower.match(/dans\s+(\d{1,4})\s*(?:secondes?|sec|secs|s)\b/i);
  if (relativeSecondsMatch?.[1]) {
    const seconds = Number(relativeSecondsMatch[1]);
    if (seconds > 0 && seconds <= 86400) {
      return {
        scheduled_at: new Date(Date.now() + seconds * 1000).toISOString(),
        precision: 'relative_exact',
        has_exact_date: true,
      };
    }
  }

  const relativeMinutesMatch = lower.match(/dans\s+(\d{1,3})\s*(?:minutes?|min|mins)\b/i);
  if (relativeMinutesMatch?.[1]) {
    const minutes = Number(relativeMinutesMatch[1]);
    if (minutes > 0 && minutes <= 720) {
      return {
        scheduled_at: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
        precision: 'relative_exact',
        has_exact_date: true,
      };
    }
  }

  if (datetimeHint === 'today' && explicitTime) {
    const scheduled = buildParisDateAt(explicitTime.hour, explicitTime.minute, 0);
    return {
      scheduled_at: scheduled,
      precision: 'exact',
      has_exact_date: true,
    };
  }

  if (datetimeHint === 'tomorrow' && explicitTime) {
    return {
      scheduled_at: buildParisDateAt(explicitTime.hour, explicitTime.minute, 1),
      precision: 'exact',
      has_exact_date: true,
    };
  }

  if (datetimeHint === 'tomorrow_morning') {
    const time = explicitTime || { hour: 9, minute: 0 };
    return {
      scheduled_at: buildParisDateAt(time.hour, time.minute, 1),
      precision: explicitTime ? 'exact' : 'default_time',
      has_exact_date: true,
    };
  }

  if (datetimeHint === 'tomorrow_afternoon') {
    const time = explicitTime || { hour: 14, minute: 0 };
    return {
      scheduled_at: buildParisDateAt(time.hour, time.minute, 1),
      precision: explicitTime ? 'exact' : 'default_time',
      has_exact_date: true,
    };
  }

  if (datetimeHint === 'tomorrow_evening') {
    const time = explicitTime || { hour: 19, minute: 0 };
    return {
      scheduled_at: buildParisDateAt(time.hour, time.minute, 1),
      precision: explicitTime ? 'exact' : 'default_time',
      has_exact_date: true,
    };
  }

  if (datetimeHint === 'today' && includesAny(lower, ['ce soir'])) {
    const time = explicitTime || { hour: 19, minute: 0 };
    return {
      scheduled_at: buildParisDateAt(time.hour, time.minute, 0),
      precision: explicitTime ? 'exact' : 'default_time',
      has_exact_date: true,
    };
  }

  return {
    scheduled_at: null,
    precision: datetimeHint ? 'date_hint_without_exact_time' : 'unscheduled',
    has_exact_date: false,
  };
}

function extractShoppingListItem(message) {
  const text = normalizeText(message);
  const patterns = [
    /ajoute\s+(.+?)\s+(?:à|a|dans)\s+(?:ma\s+|la\s+)?liste\s+de\s+courses/i,
    /mets\s+(.+?)\s+(?:à|a|dans)\s+(?:ma\s+|la\s+)?liste\s+de\s+courses/i,
    /note\s+(.+?)\s+(?:à|a|dans)\s+(?:ma\s+|la\s+)?liste\s+de\s+courses/i,
    /rajoute\s+(.+?)\s+(?:à|a|dans)\s+(?:ma\s+|la\s+)?liste\s+de\s+courses/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeText(match[1]).replace(/[.!?;:]+$/g, '');
    }
  }

  return '';
}

function isShoppingListRequest(text) {
  const lower = normalizeText(text).toLowerCase();
  return includesAny(lower, [
    'liste de courses',
    'liste des courses',
    'courses',
  ]) && includesAny(lower, [
    'ajoute',
    'mets',
    'note',
    'rajoute',
  ]);
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
  if (actionType === 'add_to_shopping_list') return 'shopping_list';
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
    if (datetimeHint) return 'Rappel enregistré. Une notification sera programmée si une heure exacte est comprise.';
    return 'Rappel enregistré sans date. Tu peux préciser une date plus tard.';
  }

  if (actionType === 'add_to_shopping_list') return 'Élément ajouté à la liste de courses.';
  if (actionType === 'add_to_today') return 'Traiter cette priorité aujourd’hui.';
  if (actionType === 'plan_now') return 'Faire la plus petite première action maintenant.';
  if (actionType === 'process_now') return 'Commencer par une étape simple et immédiate.';
  if (actionType === 'classify_as_idea') return 'Garder cette idée pour la développer plus tard.';
  if (actionType === 'idea_to_task') return 'Faire cette tâche quand elle devient prioritaire.';
  if (actionType === 'add_to_roadmap') return 'Revoir cette entrée lors de la prochaine session projet.';
  if (actionType === 'create_project_spec') return 'Structurer cette idée en cahier des charges.';

  return 'Action enregistrée.';
}

function buildStructuredAction({ userId, message, actionType, label, status, analysis, targetOverride }) {
  const target = normalizeText(targetOverride || extractContext(message));
  const datetimeHint = detectDatetimeHint(target || message);
  const priority = detectPriority(target || message, analysis);
  const reminderSchedule = actionType === 'create_reminder'
    ? resolveReminderSchedule(`${message} ${target}`, datetimeHint)
    : null;
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
    scheduled_at: reminderSchedule?.scheduled_at || null,
    remind_at: reminderSchedule?.scheduled_at || null,
    reminder_at: reminderSchedule?.scheduled_at || null,
    schedule_precision: reminderSchedule?.precision || null,
    has_exact_date: reminderSchedule?.has_exact_date || false,
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
  const explicitProjectMatch = lower.match(/projet\s+([a-z0-9àâçéèêëîïôûùüÿñæœ' -]{2,40})/i);

  if (explicitProjectMatch && explicitProjectMatch[1]) {
    const explicitProjectName = normalizeText(explicitProjectMatch[1])
      .replace(/[.,!?;:]+$/g, '')
      .trim();

    if (isReservedAutoProjectName(explicitProjectName)) {
      return null;
    }

    return explicitProjectName;
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


function looksLikeBareTask(text) {
  const value = normalizeText(text);
  const lower = value.toLowerCase();

  if (!value) return false;
  if (value.length < 3 || value.length > 140) return false;
  if (value.includes('?')) return false;

  if (includesAny(lower, [
    'bonjour',
    'coucou',
    'hello',
    'salut',
    'merci',
    'ok',
    'oui',
    'non',
  ]) && value.split(/\s+/).length <= 3) {
    return false;
  }

  if (includesAny(lower, [
    'je me sens',
    'je suis ko',
    'je suis fatiguée',
    'je suis fatiguee',
    'je suis triste',
    'j ai peur',
    "j'ai peur",
    'angoisse',
    'stress',
  ])) {
    return false;
  }

  if (includesAny(lower, [
    'idée',
    'idee',
    'j ai une idée',
    "j'ai une idée",
    'concept',
    'ça pourrait',
    'ca pourrait',
    'on pourrait',
  ])) {
    return false;
  }

  const startsLikeAction = /^(appeler|envoyer|répondre|repondre|payer|faire|passer|ranger|nettoyer|laver|acheter|prendre|préparer|preparer|terminer|finir|relancer|contacter|réserver|reserver|annuler|programmer|vérifier|verifier|imprimer|poster|déposer|deposer|chercher|commander|remplir|envoyer|mettre|sortir)\b/i.test(value);

  const containsTaskNoun = includesAny(lower, [
    'aspirateur',
    'caf',
    'garage',
    'médecin',
    'medecin',
    'rdv',
    'rendez-vous',
    'facture',
    'assurance',
    'papier',
    'dossier',
    'mail',
    'message',
    'appel',
    'courses',
    'lessive',
    'vaisselle',
    'ménage',
    'menage',
  ]);

  const hasDateHint = Boolean(detectDatetimeHint(value));

  return startsLikeAction || (containsTaskNoun && hasDateHint);
}

function cloneStoredItemAsTaskFromToday({ sourceItem, userId }) {
  if (!sourceItem || sourceItem.bucket !== 'today') return null;

  return {
    ...sourceItem,
    id: crypto.randomUUID(),
    user_id: userId || sourceItem.user_id,
    bucket: 'tasks',
    type: 'task',
    status: 'active',
    action_type: 'idea_to_task',
    action_label: 'Ajouter une tâche',
    created_at: nowIso(),
    updated_at: nowIso(),
    mirrored_from_today_id: sourceItem.id,
  };
}


function safeParseJsonObject(value) {
  const raw = String(value || '').trim();

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);

    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeAIUnderstanding(localAnalysis, aiUnderstanding) {
  if (!aiUnderstanding || typeof aiUnderstanding !== 'object') {
    return localAnalysis;
  }

  const allowedTypes = ['note', 'task', 'idea', 'emotion', 'project_note', 'mixed'];
  const allowedBuckets = ['inbox', 'tasks', 'ideas', 'journal', 'projects', 'today', 'plans', 'reminders'];

  const type = allowedTypes.includes(aiUnderstanding.type)
    ? aiUnderstanding.type
    : localAnalysis.type;

  const suggestedBucket = allowedBuckets.includes(aiUnderstanding.suggested_bucket)
    ? aiUnderstanding.suggested_bucket
    : localAnalysis.suggested_bucket;

  const projectNameFromAI = normalizeText(aiUnderstanding.project_name || '');
  const localProjectName = normalizeText(localAnalysis.project_name || '');
  const projectName = projectNameFromAI || localProjectName || null;

  const tags = uniqueArray([
    ...(Array.isArray(localAnalysis.tags) ? localAnalysis.tags : []),
    ...(Array.isArray(aiUnderstanding.tags)
      ? aiUnderstanding.tags.map(tag => normalizeText(tag)).filter(Boolean)
      : []),
    projectName ? normalizeKey(projectName) : null,
  ]);

  return {
    ...localAnalysis,
    type,
    is_task: Boolean(aiUnderstanding.is_task ?? localAnalysis.is_task),
    is_idea: Boolean(aiUnderstanding.is_idea ?? localAnalysis.is_idea),
    is_emotion: Boolean(aiUnderstanding.is_emotion ?? localAnalysis.is_emotion),
    is_project: Boolean(aiUnderstanding.is_project ?? localAnalysis.is_project ?? projectName),
    project_name: projectName,
    urgency: ['low', 'normal', 'high'].includes(aiUnderstanding.urgency)
      ? aiUnderstanding.urgency
      : localAnalysis.urgency,
    suggested_bucket: suggestedBucket,
    datetime_hint: normalizeText(aiUnderstanding.datetime_hint || '') || localAnalysis.datetime_hint || null,
    response_level: ['capture', 'reflection', 'project'].includes(aiUnderstanding.response_level)
      ? aiUnderstanding.response_level
      : (
          localAnalysis.is_emotion
            ? 'reflection'
            : localAnalysis.is_project
              ? 'project'
              : 'capture'
        ),
    user_intent: normalizeText(aiUnderstanding.user_intent || ''),
    ai_understanding_applied: true,
    tags,
  };
}

function buildAIUnderstandingPrompt(message, localAnalysis, memorySummary) {
  return `
Tu es le moteur de compréhension de Nyra.

Nyra n'est pas un chatbot : c'est un cerveau externe TDAH.
Ta tâche est de comprendre l'intention réelle du message, pas seulement les mots-clés.

Message utilisateur :
${message}

Analyse locale actuelle :
${JSON.stringify(localAnalysis)}

Résumé mémoire :
${JSON.stringify(memorySummary)}

Retourne uniquement un JSON valide, sans texte autour, avec ces clés :
{
  "type": "note|task|idea|emotion|project_note|mixed",
  "is_task": boolean,
  "is_idea": boolean,
  "is_emotion": boolean,
  "is_project": boolean,
  "project_name": string|null,
  "urgency": "low|normal|high",
  "suggested_bucket": "inbox|tasks|ideas|journal|projects|today|plans|reminders",
  "datetime_hint": string|null,
  "response_level": "capture|reflection|project",
  "user_intent": string,
  "tags": string[]
}

Règles importantes :
- Si l'utilisateur exprime une émotion ou demande à comprendre ce qu'il ressent, response_level = "reflection" et suggested_bucket = "journal".
- Si l'utilisateur dit "j'ai une idée pour Nyra/NovaCall/etc", c'est une idée liée à un projet : is_idea=true, is_project=true, project_name doit être rempli.
- Si l'utilisateur demande un rappel avec une durée relative, garde datetime_hint tel quel si utile, mais ne calcule pas la date ici.
- Ne transforme pas une discussion émotionnelle en simple capture.
`.trim();
}

async function analyzeMessageWithAI(message, localAnalysis, memorySummary) {
  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.1,
      max_tokens: 280,
      messages: [
        {
          role: 'system',
          content: buildAIUnderstandingPrompt(message, localAnalysis, memorySummary),
        },
        {
          role: 'user',
          content: message,
        },
      ],
    });

    const raw = normalizeText(completion.choices?.[0]?.message?.content || '');
    const parsed = safeParseJsonObject(raw);

    return normalizeAIUnderstanding(localAnalysis, parsed);
  } catch (error) {
    console.error('⚠️ analyzeMessageWithAI fallback:', error.message);
    return localAnalysis;
  }
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

  if (isReflectionResumeRequest(text)) {
    analysis.type = 'emotion';
    analysis.is_emotion = true;
    analysis.suggested_bucket = 'journal';
    analysis.response_level = 'reflection';
    analysis.tags.push('journal', 'réflexion', 'reprise');
  }

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
      'tâche',
      'tache',
    ]) ||
    looksLikeBareTask(text)
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

  if (isShoppingListRequest(lower)) {
    const shoppingItem = extractShoppingListItem(message) || cleanActionTitle(message);

    return buildStructuredAction({
      userId,
      message,
      targetOverride: shoppingItem,
      actionType: 'add_to_shopping_list',
      label: 'Ajouter à la liste de courses',
      status: 'done',
      analysis,
    });
  }

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
      'rappelle-moi',
      'rappelle moi',
      'rappelle-moi de',
      'rappelle moi de',
      'rappelle-moi demain',
      'rappelle moi demain',
      'rappel moi',
      'rappel-moi',
      'rappel moi demain',
      'rappel-moi demain',
      'rappel',
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

  if (analysis?.is_task) {
    const shouldGoToday =
      analysis.datetime_hint === 'today' ||
      includesAny(lower, ['aujourd’hui', "aujourd'hui", 'maintenant', 'ce soir']);

    if (shouldGoToday) {
      return buildStructuredAction({
        userId,
        message,
        actionType: 'add_to_today',
        label: 'Ajouter à aujourd’hui',
        status: 'done',
        analysis,
      });
    }

    return buildStructuredAction({
      userId,
      message,
      actionType: 'idea_to_task',
      label: 'Ajouter une tâche',
      status: 'done',
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

function getStoredItemStatusForAction(action) {
  const actionType = normalizeText(action?.action_type || action?.type || '');

  // Une action peut être "terminée" techniquement parce que Nyra a bien rangé
  // l'élément, mais l'élément utilisateur doit rester actif dans l'organisation.
  if (actionType === 'add_to_shopping_list') return 'active';
  if (actionType === 'create_reminder') return 'active';
  if (actionType === 'add_to_today') return 'active';
  if (actionType === 'idea_to_task') return 'active';

  return action?.status || 'captured';
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
    scheduled_at: action ? action.scheduled_at || null : null,
    remind_at: action ? action.remind_at || null : null,
    reminder_at: action ? action.reminder_at || null : null,
    schedule_precision: action ? action.schedule_precision || null : null,
    has_exact_date: action ? Boolean(action.has_exact_date) : false,
    tags: action
      ? uniqueArray([
          'action',
          action.action_type,
          action.provider,
          analysis.project_name ? normalizeKey(analysis.project_name) : null,
        ])
      : analysis.tags,
    status: action ? getStoredItemStatusForAction(action) : analysis.is_task ? 'todo' : 'captured',
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


function isJournalConversationCapture(analysis, action) {
  if (action) return false;

  const bucket = normalizeText(analysis?.suggested_bucket || '');
  const type = normalizeText(analysis?.type || '');
  const responseLevel = normalizeText(analysis?.response_level || '');
  const tags = Array.isArray(analysis?.tags) ? analysis.tags : [];

  return (
    bucket === 'journal' ||
    type === 'emotion' ||
    responseLevel === 'reflection' ||
    tags.includes('émotion') ||
    tags.includes('emotion')
  );
}

function buildJournalConversationTitle(message, analysis) {
  const text = normalizeText(message);
  const lower = text.toLowerCase();
  const intent = normalizeText(analysis?.user_intent || '');

  if (includesAny(lower, ['vidée', 'videe', 'épuisée', 'epuisee', 'fatiguée', 'fatiguee', 'crevée', 'crevee'])) {
    return 'Fatigue et besoin de comprendre';
  }

  if (includesAny(lower, ['angoisse', 'stress', 'panique', 'peur'])) {
    return 'Stress, peur ou surcharge émotionnelle';
  }

  if (includesAny(lower, ['triste', 'pleurer', 'pleure', 'mal au cœur', 'mal au coeur'])) {
    return 'Tristesse et besoin de déposer';
  }

  const source = intent || cleanActionTitle(text);
  const cleaned = normalizeText(source)
    .replace(/^je me sens\s+/i, '')
    .replace(/^j['’]ai besoin de\s+/i, '')
    .replace(/^besoin de\s+/i, '')
    .replace(/[.!?;:]+$/g, '')
    .trim();

  if (!cleaned) return 'Journal de réflexion';

  const title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return title.length > 70 ? `${title.slice(0, 70)}…` : title;
}

function findActiveJournalConversationItem(store, userId) {
  const now = Date.now();
  const maxGapMs = 45 * 60 * 1000;

  return (Array.isArray(store.items) ? store.items : [])
    .filter(item => {
      const updatedAt = new Date(item.updated_at || item.created_at || 0).getTime();

      return (
        itemBelongsToUser(item, userId) &&
        item.bucket === 'journal' &&
        item.type === 'journal_conversation' &&
        item.journal_session_status === 'active' &&
        Number.isFinite(updatedAt) &&
        now - updatedAt <= maxGapMs
      );
    })
    .sort((a, b) => {
      return new Date(b.updated_at || b.created_at || 0).getTime() -
        new Date(a.updated_at || a.created_at || 0).getTime();
    })[0] || null;
}

function appendJournalConversationTurn(content, message, reply) {
  const existing = normalizeMultilineText(content || '');
  const turn = normalizeMultilineText([
    `Moi : ${normalizeText(message)}`,
    `Nyra : ${normalizeText(reply)}`,
  ].join('\n'));

  return normalizeMultilineText(existing ? `${existing}

${turn}` : turn);
}


function isReflectionResumeRequest(message) {
  const lower = normalizeText(message).toLowerCase();

  return includesAny(lower, [
    'reprends cette réflexion',
    'reprends cette reflexion',
    'reprendre cette réflexion',
    'reprendre cette reflexion',
    'continuer cette réflexion',
    'continuer cette reflexion',
  ]);
}

function extractReflectionResumeTitle(message) {
  const raw = String(message || '');
  const patterns = [
    /titre\s+du\s+journal\s*:\s*([^\n]+)/i,
    /titre\s+de\s+la\s+réflexion\s*:\s*([^\n]+)/i,
    /titre\s+de\s+la\s+reflexion\s*:\s*([^\n]+)/i,
    /sujet\s*:\s*([^\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);

    if (match?.[1]) {
      return normalizeText(match[1]).replace(/[.!?;:]+$/g, '').trim();
    }
  }

  return '';
}

function normalizeReflectionTitleKey(value) {
  return normalizeKey(value || '').slice(0, 120);
}

function findJournalReflectionSubjectForResume(store, userId, message) {
  const requestedTitle = extractReflectionResumeTitle(message);
  const requestedKey = normalizeReflectionTitleKey(requestedTitle);
  const safeItems = Array.isArray(store.items) ? store.items : [];
  const journalItems = safeItems
    .filter(item => {
      return (
        itemBelongsToUser(item, userId) &&
        item.bucket === 'journal' &&
        (
          item.type === 'journal_conversation' ||
          item.type === 'reflection_subject' ||
          item.reflection_subject_id ||
          item.journal_session_status === 'active'
        )
      );
    })
    .sort((a, b) => {
      return new Date(b.updated_at || b.created_at || 0).getTime() -
        new Date(a.updated_at || a.created_at || 0).getTime();
    });

  if (requestedKey) {
    const exactMatch = journalItems.find(item => {
      const itemKeys = [
        item.title,
        item.journal_topic_title,
        item.reflection_subject_title,
      ].map(normalizeReflectionTitleKey).filter(Boolean);

      return itemKeys.includes(requestedKey);
    });

    if (exactMatch) return exactMatch;
  }

  const itemIdMatch = String(message || '').match(/(?:item_id|journal_id|reflection_id)\s*:\s*([a-z0-9-]{16,})/i);
  const requestedItemId = normalizeText(itemIdMatch?.[1] || '');

  if (requestedItemId) {
    const byId = journalItems.find(item => {
      return item.id === requestedItemId || item.reflection_subject_id === requestedItemId;
    });

    if (byId) return byId;
  }

  return journalItems[0] || null;
}

function buildJournalRepriseTitle(index, createdAt = new Date()) {
  const dateLabel = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(createdAt);

  return `Reprise ${index} — ${dateLabel}`;
}

function buildJournalTurnText(message, reply) {
  return normalizeMultilineText([
    `Moi : ${normalizeText(message)}`,
    `Nyra : ${normalizeText(reply)}`,
  ].join('\n'));
}

function buildReflectionEntryStableId(subjectId, entryId, index, createdAt) {
  const source = normalizeText(`${subjectId || 'reflection'}:${entryId || ''}:${index ?? ''}:${createdAt || ''}`);
  const digest = crypto
    .createHash('sha256')
    .update(source || crypto.randomUUID())
    .digest('hex')
    .slice(0, 28);

  return `reflection-entry-${digest}`;
}

function buildReflectionEntryTitle(entryType, index, createdAt = new Date()) {
  const dateLabel = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(createdAt);

  if (entryType === 'initial') return `${dateLabel} — Entrée initiale`;
  return `${dateLabel} — Reprise ${index}`;
}

function getReflectionEntrySortTime(entry) {
  return new Date(entry?.updated_at || entry?.created_at || 0).getTime();
}

function getReflectionEntriesForSubject(store, userId, subjectId) {
  return (Array.isArray(store.items) ? store.items : [])
    .filter(item => {
      return (
        itemBelongsToUser(item, userId) &&
        item.bucket === 'journal' &&
        item.type === 'reflection_entry' &&
        item.reflection_subject_id === subjectId
      );
    })
    .sort((a, b) => getReflectionEntrySortTime(b) - getReflectionEntrySortTime(a));
}

function syncReflectionSubjectMetadata(store, subject) {
  if (!subject || typeof subject !== 'object') return subject;

  const subjectId = subject.reflection_subject_id || subject.id;
  const entries = getReflectionEntriesForSubject(store, subject.user_id, subjectId);
  const latestEntry = entries[0] || null;
  const repriseEntries = entries.filter(entry => entry.reflection_entry_type === 'reprise');

  subject.type = 'reflection_subject';
  subject.bucket = 'journal';
  subject.reflection_subject_id = subjectId;
  subject.reflection_subject_title = subject.reflection_subject_title || subject.title || 'Réflexion';
  subject.journal_topic_title = subject.journal_topic_title || subject.reflection_subject_title;
  subject.reflection_entry_ids = entries.map(entry => entry.id);
  subject.reflection_entries_count = entries.length;
  subject.reprise_count = repriseEntries.length;
  subject.last_reprise_at = repriseEntries[0]?.created_at || subject.last_reprise_at || null;
  subject.last_reprise_title = repriseEntries[0]?.title || subject.last_reprise_title || null;
  subject.last_entry_id = latestEntry?.id || subject.last_entry_id || null;
  subject.last_user_message = latestEntry?.user_message || subject.last_user_message || null;
  subject.last_nyra_reply = latestEntry?.nyra_reply || subject.last_nyra_reply || null;
  subject.content = subject.content_summary || subject.content || latestEntry?.content || '';
  subject.updated_at = latestEntry?.updated_at || subject.updated_at || nowIso();
  subject.tags = uniqueArray([
    ...(Array.isArray(subject.tags) ? subject.tags : []),
    'journal',
    'réflexion',
    'reflection',
    'subject',
  ]);

  // Compatibilité : l'ancien champ reste disponible, mais ne contient plus de gros bloc.
  subject.reflection_reprises = entries.map(entry => ({
    id: entry.id,
    index: entry.reflection_entry_index,
    title: entry.title,
    content: entry.content,
    user_message: entry.user_message,
    nyra_reply: entry.nyra_reply,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    reflection_entry_type: entry.reflection_entry_type,
  }));

  return subject;
}

function createReflectionEntryItem({ subject, userId, entryType, index, title, content, message, reply, createdAt }) {
  const safeCreatedAt = createdAt || nowIso();
  const subjectId = subject.reflection_subject_id || subject.id;
  const generatedEntryId = crypto.randomUUID();

  return {
    id: generatedEntryId,
    user_id: userId,
    type: 'reflection_entry',
    bucket: 'journal',
    title: title || buildReflectionEntryTitle(entryType, index, new Date(safeCreatedAt)),
    content: normalizeMultilineText(content || buildJournalTurnText(message, reply)),
    urgency: subject.urgency || 'normal',
    priority: subject.priority || 'normal',
    datetime_hint: subject.datetime_hint || null,
    scheduled_at: null,
    remind_at: null,
    reminder_at: null,
    schedule_precision: null,
    has_exact_date: false,
    tags: uniqueArray([
      'journal',
      'réflexion',
      'reflection',
      'reflection-entry',
      entryType === 'initial' ? 'entrée-initiale' : 'reprise',
    ]),
    status: 'captured',
    project_name: null,
    project_id: null,
    action_type: null,
    action_label: null,
    action_id: null,
    provider: 'local',
    sync_status: 'local_only',
    external_id: null,
    requires_connection: false,
    connection_type: null,
    parent_id: subjectId,
    reflection_subject_id: subjectId,
    reflection_subject_title: subject.reflection_subject_title || subject.title || 'Réflexion',
    journal_topic_title: subject.journal_topic_title || subject.reflection_subject_title || subject.title || 'Réflexion',
    reflection_entry_type: entryType,
    reflection_entry_index: index,
    user_message: normalizeText(message),
    nyra_reply: normalizeText(reply),
    created_at: safeCreatedAt,
    updated_at: safeCreatedAt,
  };
}

function ensureReflectionEntryInStore(store, entry) {
  if (!entry?.id) return null;

  store.items = Array.isArray(store.items) ? store.items : [];

  const existingIndex = store.items.findIndex(item => item.id === entry.id);

  if (existingIndex >= 0) {
    store.items[existingIndex] = {
      ...store.items[existingIndex],
      ...entry,
      updated_at: entry.updated_at || nowIso(),
    };
    return store.items[existingIndex];
  }

  store.items.push(entry);
  return entry;
}

function migrateLegacyReflectionReprises(store) {
  if (!store || typeof store !== 'object') return store;

  store.items = Array.isArray(store.items) ? store.items : [];

  const subjects = store.items.filter(item => {
    return (
      item &&
      item.bucket === 'journal' &&
      (
        item.type === 'reflection_subject' ||
        item.type === 'journal_conversation' ||
        item.reflection_subject_id
      ) &&
      item.type !== 'reflection_entry'
    );
  });

  subjects.forEach(subject => {
    const subjectId = subject.reflection_subject_id || subject.id;
    subject.type = 'reflection_subject';
    subject.reflection_subject_id = subjectId;
    subject.reflection_subject_title = subject.reflection_subject_title || subject.title || 'Réflexion';
    subject.journal_topic_title = subject.journal_topic_title || subject.reflection_subject_title;

    const legacyReprises = Array.isArray(subject.reflection_reprises) ? subject.reflection_reprises : [];

    legacyReprises.forEach((legacyEntry, legacyIndex) => {
      const entryType = Number(legacyEntry?.index || 0) === 0 || legacyEntry?.title === 'Entrée initiale'
        ? 'initial'
        : 'reprise';
      const entryIndex = entryType === 'initial' ? 0 : Number(legacyEntry?.index || legacyIndex);
      const createdAt = legacyEntry?.created_at || subject.created_at || nowIso();
      const stableId = buildReflectionEntryStableId(
        subjectId,
        legacyEntry?.id || legacyEntry?.title || '',
        entryIndex,
        createdAt
      );

      const alreadyExists = store.items.some(item => {
        return item.id === stableId || item.legacy_reflection_reprise_id === legacyEntry?.id;
      });

      if (alreadyExists) return;

      const entry = {
        ...createReflectionEntryItem({
          subject,
          userId: subject.user_id,
          entryType,
          index: entryIndex,
          title: entryType === 'initial'
            ? buildReflectionEntryTitle('initial', 0, new Date(createdAt))
            : legacyEntry?.title || buildReflectionEntryTitle('reprise', entryIndex, new Date(createdAt)),
          content: legacyEntry?.content || '',
          message: legacyEntry?.user_message || '',
          reply: legacyEntry?.nyra_reply || '',
          createdAt,
        }),
        id: stableId,
        legacy_reflection_reprise_id: legacyEntry?.id || null,
      };

      store.items.push(entry);
    });

    const hasInitialEntry = store.items.some(item => {
      return (
        item.type === 'reflection_entry' &&
        item.reflection_subject_id === subjectId &&
        item.reflection_entry_type === 'initial'
      );
    });

    if (!hasInitialEntry && normalizeMultilineText(subject.content || '')) {
      const createdAt = subject.created_at || nowIso();
      const stableId = buildReflectionEntryStableId(subjectId, 'initial-content', 0, createdAt);

      if (!store.items.some(item => item.id === stableId)) {
        store.items.push({
          ...createReflectionEntryItem({
            subject,
            userId: subject.user_id,
            entryType: 'initial',
            index: 0,
            title: buildReflectionEntryTitle('initial', 0, new Date(createdAt)),
            content: subject.content,
            message: subject.last_user_message || '',
            reply: subject.last_nyra_reply || '',
            createdAt,
          }),
          id: stableId,
        });
      }
    }

    syncReflectionSubjectMetadata(store, subject);
  });

  return store;
}

function appendJournalRepriseToSubject(store, item, message, reply) {
  const existingEntries = getReflectionEntriesForSubject(store, item.user_id, item.reflection_subject_id || item.id);
  const repriseIndex = existingEntries.filter(entry => entry.reflection_entry_type === 'reprise').length + 1;
  const createdAt = nowIso();
  const entry = createReflectionEntryItem({
    subject: item,
    userId: item.user_id,
    entryType: 'reprise',
    index: repriseIndex,
    message,
    reply,
    createdAt,
  });

  ensureReflectionEntryInStore(store, entry);

  item.type = 'reflection_subject';
  item.reflection_subject_id = item.reflection_subject_id || item.id;
  item.reflection_subject_title = item.reflection_subject_title || item.title || 'Réflexion';
  item.journal_topic_title = item.journal_topic_title || item.reflection_subject_title;
  item.content_summary = item.content_summary || item.content || '';
  item.journal_session_status = 'active';
  item.updated_at = createdAt;
  item.tags = uniqueArray([
    ...(Array.isArray(item.tags) ? item.tags : []),
    'journal',
    'réflexion',
    'reflection',
    'subject',
  ]);

  return syncReflectionSubjectMetadata(store, item);
}

function upsertJournalConversationItem({ store, userId, message, reply, analysis }) {
  const isResume = isReflectionResumeRequest(message);
  const existing = isResume
    ? findJournalReflectionSubjectForResume(store, userId, message)
    : findActiveJournalConversationItem(store, userId);

  if (existing) {
    const updatedExisting = isResume
      ? appendJournalRepriseToSubject(store, existing, message, reply)
      : existing;

    if (!isResume) {
      const subjectId = updatedExisting.reflection_subject_id || updatedExisting.id;
      const entries = getReflectionEntriesForSubject(store, userId, subjectId);
      const initialEntry = entries.find(entry => entry.reflection_entry_type === 'initial') || entries[entries.length - 1] || null;
      const updatedAt = nowIso();
      const nextContent = appendJournalConversationTurn(initialEntry?.content || updatedExisting.content || '', message, reply);

      if (initialEntry) {
        initialEntry.content = nextContent;
        initialEntry.user_message = normalizeText(message);
        initialEntry.nyra_reply = normalizeText(reply);
        initialEntry.updated_at = updatedAt;
      } else {
        ensureReflectionEntryInStore(store, createReflectionEntryItem({
          subject: updatedExisting,
          userId,
          entryType: 'initial',
          index: 0,
          title: buildReflectionEntryTitle('initial', 0, new Date(updatedExisting.created_at || updatedAt)),
          content: nextContent,
          message,
          reply,
          createdAt: updatedExisting.created_at || updatedAt,
        }));
      }

      updatedExisting.content = nextContent;
      updatedExisting.content_summary = updatedExisting.content_summary || nextContent;
      updatedExisting.last_user_message = normalizeText(message);
      updatedExisting.last_nyra_reply = normalizeText(reply);
      updatedExisting.turn_count = Number(updatedExisting.turn_count || 1) + 1;
      updatedExisting.updated_at = updatedAt;
    }

    updatedExisting.type = updatedExisting.reflection_subject_id
      ? 'reflection_subject'
      : updatedExisting.type || 'journal_conversation';
    updatedExisting.reflection_subject_id = updatedExisting.reflection_subject_id || updatedExisting.id;
    updatedExisting.reflection_subject_title = updatedExisting.reflection_subject_title || updatedExisting.title || 'Réflexion';
    updatedExisting.journal_topic_title = updatedExisting.journal_topic_title || updatedExisting.reflection_subject_title;
    updatedExisting.tags = uniqueArray([
      ...(Array.isArray(updatedExisting.tags) ? updatedExisting.tags : []),
      ...(Array.isArray(analysis?.tags) ? analysis.tags : []),
      'journal',
      'réflexion',
      'reflection',
      isResume ? 'reprise' : 'conversation',
    ]);

    return syncReflectionSubjectMetadata(store, updatedExisting);
  }

  const createdAt = nowIso();
  const title = buildJournalConversationTitle(message, analysis);
  const initialContent = appendJournalConversationTurn('', message, reply);
  const subjectId = crypto.randomUUID();

  const subject = {
    id: subjectId,
    user_id: userId,
    type: 'reflection_subject',
    bucket: 'journal',
    title,
    content: initialContent,
    content_summary: initialContent,
    urgency: analysis?.urgency || 'normal',
    priority: detectPriority(message, analysis),
    datetime_hint: analysis?.datetime_hint || null,
    scheduled_at: null,
    remind_at: null,
    reminder_at: null,
    schedule_precision: null,
    has_exact_date: false,
    tags: uniqueArray([
      ...(Array.isArray(analysis?.tags) ? analysis.tags : []),
      'journal',
      'réflexion',
      'reflection',
      'subject',
    ]),
    status: 'captured',
    project_name: analysis?.project_name || null,
    project_id: null,
    action_type: null,
    action_label: null,
    action_id: null,
    provider: 'local',
    sync_status: 'local_only',
    external_id: null,
    requires_connection: false,
    connection_type: null,
    reflection_subject_id: subjectId,
    reflection_subject_title: title,
    journal_topic_title: title,
    journal_session_status: 'active',
    turn_count: 1,
    reprise_count: 0,
    reflection_entry_ids: [],
    reflection_reprises: [],
    last_user_message: normalizeText(message),
    last_nyra_reply: normalizeText(reply),
    created_at: createdAt,
    updated_at: createdAt,
  };

  const initialEntry = createReflectionEntryItem({
    subject,
    userId,
    entryType: 'initial',
    index: 0,
    title: buildReflectionEntryTitle('initial', 0, new Date(createdAt)),
    content: initialContent,
    message,
    reply,
    createdAt,
  });

  ensureReflectionEntryInStore(store, initialEntry);

  return syncReflectionSubjectMetadata(store, subject);
}

function saveCapture({ userId, message, reply, analysis, action }) {
  const store = readStore();

  const shouldUseJournalConversation = isJournalConversationCapture(analysis, action);
  const item = shouldUseJournalConversation
    ? upsertJournalConversationItem({ store, userId, message, reply, analysis })
    : createStoredItem({
        userId,
        message,
        analysis,
        action,
      });

  let linkedProject = null;
  let createdRelation = null;
  let updatedContext = null;

  if (analysis.project_name && !isReservedAutoProjectName(analysis.project_name)) {
    linkedProject = ensureProject(store, userId, analysis.project_name, message);
    item.project_id = linkedProject.id;
    item.project_name = linkedProject.name;
  } else if (isReservedAutoProjectName(analysis.project_name)) {
    analysis.project_name = null;
    item.project_id = null;
    item.project_name = null;
    item.tags = removeReservedProjectTags(item.tags);
  }

  if (shouldUseJournalConversation) {
    const existingItemIndex = store.items.findIndex(existingItem => existingItem.id === item.id);

    if (existingItemIndex >= 0) {
      store.items.splice(existingItemIndex, 1);
    }

    store.items.push(item);
  } else {
    store.items.push(item);
  }

  const mirroredTaskItem = action?.action_type === 'add_to_today' && analysis?.is_task
    ? cloneStoredItemAsTaskFromToday({ sourceItem: item, userId })
    : null;

  if (mirroredTaskItem) {
    if (linkedProject) {
      mirroredTaskItem.project_id = linkedProject.id;
      mirroredTaskItem.project_name = linkedProject.name;
    }

    store.items.push(mirroredTaskItem);
  }

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

  if (linkedProject && mirroredTaskItem && !relationExists(store, userId, mirroredTaskItem.id, linkedProject.id, 'belongs_to_project')) {
    store.relations.push(
      createRelation({
        userId,
        sourceId: mirroredTaskItem.id,
        targetId: linkedProject.id,
        relationType: 'belongs_to_project',
        confidence: 0.9,
        metadata: {
          project_name: linkedProject.name,
          detection: 'today_task_mirror',
        },
      })
    );
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
  let score = 12;

  // Charge de travail réelle : ce que Nyra doit considérer comme "poids mental".
  score += signals.open_actions * 4;
  score += signals.failed_actions * 5;
  score += Math.min(22, signals.urgent_items * 1.5);
  score += signals.emotion_items * 2;

  // Plusieurs projets actifs augmentent la charge, mais seulement au-delà d’un seuil.
  if (signals.project_count > 2) {
    score += (signals.project_count - 2) * 5;
  }

  // Focus + exploration = cerveau très sollicité, même si ce n’est pas forcément négatif.
  score += Math.min(22, signals.focus_mentions * 0.8);
  score += Math.min(12, signals.exploration_mentions * 2);

  // Les signaux de souffrance ajoutent à la charge globale.
  score += signals.fatigue_mentions * 5;
  score += signals.overwhelm_mentions * 7;
  score += signals.avoidance_mentions * 4;

  // Les actions terminées compensent la charge : la personne ne subit pas seulement, elle avance.
  if (signals.done_actions > 0) {
    score -= Math.min(24, signals.done_actions * 1.6);
  }

  // Beaucoup de focus productif sans fatigue ni surcharge explicite = activation, pas effondrement.
  if (
    signals.focus_mentions >= 5 &&
    signals.done_actions >= signals.open_actions &&
    !signals.has_recent_fatigue_language &&
    !signals.has_recent_overwhelm_language
  ) {
    score -= 6;
  }

  return clampNumber(Math.round(score), 0, 100);
}

function scoreUserActivation(signals) {
  let score = 10;

  // Activation cognitive = intensité mentale, vitesse, action, focus, idées.
  score += Math.min(40, signals.focus_mentions * 2);
  score += Math.min(25, signals.urgent_items * 1.5);
  score += Math.min(20, signals.done_actions * 2);
  score += Math.min(15, signals.exploration_mentions * 3);
  score += Math.min(10, signals.open_actions * 2);

  if (signals.has_recent_focus_language) score += 8;
  if (signals.has_recent_exploration_language) score += 5;

  // Fatigue ou évitement réduit l’activation utile, même si la charge reste présente.
  if (signals.has_recent_fatigue_language) score -= 18;
  if (signals.has_recent_avoidance_language) score -= 10;

  return clampNumber(Math.round(score), 0, 100);
}

function scoreUserDistress(signals) {
  let score = 5;

  // Détresse cognitive = souffrance, saturation, blocage, fatigue, confusion.
  score += signals.fatigue_mentions * 14;
  score += signals.overwhelm_mentions * 18;
  score += signals.avoidance_mentions * 10;
  score += signals.failed_actions * 8;
  score += signals.emotion_items * 4;

  // L’urgence seule ne doit jamais faire exploser la détresse.
  score += Math.min(12, signals.urgent_items * 0.5);

  if (signals.open_actions >= 6) score += 8;
  if (signals.open_actions >= 10) score += 10;

  if (signals.has_recent_fatigue_language) score += 12;
  if (signals.has_recent_overwhelm_language) score += 15;
  if (signals.has_recent_avoidance_language) score += 10;

  // Le momentum et les actions terminées protègent contre l’interprétation catastrophiste.
  if (signals.done_actions > 0) {
    score -= Math.min(30, signals.done_actions * 2);
  }

  if (
    signals.focus_mentions > signals.overwhelm_mentions &&
    signals.done_actions >= signals.open_actions &&
    !signals.has_recent_fatigue_language &&
    !signals.has_recent_overwhelm_language
  ) {
    score -= 15;
  }

  return clampNumber(Math.round(score), 0, 100);
}

function deriveScoreLevel(score) {
  if (score >= 75) return 'very_high';
  if (score >= 55) return 'high';
  if (score >= 30) return 'moderate';
  return 'low';
}

function deriveCognitiveLoad(overwhelmScore, activationScore = 0, distressScore = 0) {
  if (distressScore >= 75) return 'very_high';
  if (overwhelmScore >= 75) return 'very_high';
  if (overwhelmScore >= 55 || distressScore >= 55) return 'high';

  // Cas typique TDAH : forte activation productive sans détresse.
  if (activationScore >= 75 && distressScore < 30) return 'moderate';

  if (overwhelmScore >= 30 || activationScore >= 55) return 'moderate';

  return 'low';
}

function deriveCognitiveActivation(activationScore) {
  return deriveScoreLevel(activationScore);
}

function deriveCognitiveDistress(distressScore) {
  return deriveScoreLevel(distressScore);
}

function deriveEnergyLevel(signals, overwhelmScore, activationScore = 0, distressScore = 0) {
  if (signals.has_recent_fatigue_language || signals.fatigue_mentions >= 2) return 'low';
  if (distressScore >= 75) return 'low';
  if (distressScore >= 55 && activationScore < 55) return 'low';
  if (activationScore >= 75 && distressScore < 35) return 'high';
  if (signals.focus_mentions >= 3 && overwhelmScore < 55 && distressScore < 45) return 'good';
  if (signals.done_actions > signals.open_actions && distressScore < 50) return 'good';
  return 'medium';
}

function deriveFocusState(signals, overwhelmScore, activationScore = 0, distressScore = 0) {
  if (distressScore >= 75 || signals.has_recent_overwhelm_language) return 'scattered';
  if (signals.project_count >= 4 && signals.open_actions >= 4) return 'fragmented';
  if (activationScore >= 75 && distressScore < 35 && signals.has_recent_focus_language) return 'focused';
  if (signals.has_recent_focus_language && signals.focus_mentions >= signals.exploration_mentions) return 'focused';
  if (signals.has_recent_exploration_language) return 'exploratory';
  if (overwhelmScore >= 65 && activationScore < 45) return 'fragmented';
  return 'stable';
}

function deriveEmotionalState(signals, overwhelmScore, distressScore = 0) {
  if (distressScore >= 75 || signals.has_recent_overwhelm_language) return 'overwhelmed';
  if (signals.has_recent_fatigue_language) return 'tired';
  if (signals.has_recent_avoidance_language) return 'blocked';
  if (distressScore >= 55) return 'strained';
  if (signals.emotion_items >= 3) return 'emotionally_active';
  if (signals.focus_mentions >= 3 && distressScore < 35) return 'engaged';
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

function buildUserStateRecommendations({ cognitiveLoad, cognitiveActivation, cognitiveDistress, energyLevel, focusState, emotionalState, signals }) {
  const recommendations = [];

  if (cognitiveDistress === 'very_high' || cognitiveDistress === 'high') {
    recommendations.push('Ralentir avant d’ajouter une nouvelle action.');
    recommendations.push('Faire redescendre la pression cognitive avant de continuer.');
  }

  if (cognitiveLoad === 'very_high' || cognitiveLoad === 'high') {
    recommendations.push('Réduire l’écran à une seule priorité visible.');
    recommendations.push('Éviter d’ajouter de nouvelles grosses tâches maintenant.');
  }

  if (
    cognitiveActivation === 'very_high' &&
    (cognitiveDistress === 'low' || cognitiveDistress === 'moderate')
  ) {
    recommendations.push('Garder le momentum, mais prévoir une vraie pause courte.');
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
  const activationScore = scoreUserActivation(signals);
  const distressScore = scoreUserDistress(signals);

  const cognitiveLoad = deriveCognitiveLoad(overwhelmScore, activationScore, distressScore);
  const cognitiveActivation = deriveCognitiveActivation(activationScore);
  const cognitiveDistress = deriveCognitiveDistress(distressScore);
  const energyLevel = deriveEnergyLevel(signals, overwhelmScore, activationScore, distressScore);
  const focusState = deriveFocusState(signals, overwhelmScore, activationScore, distressScore);
  const emotionalState = deriveEmotionalState(signals, overwhelmScore, distressScore);
  const detectedPatterns = buildDetectedPatterns(signals, overwhelmScore);
  const recommendations = buildUserStateRecommendations({
    cognitiveLoad,
    cognitiveActivation,
    cognitiveDistress,
    energyLevel,
    focusState,
    emotionalState,
    signals,
  });

  const dominantMode =
    distressScore >= 65 || cognitiveDistress === 'very_high'
      ? 'reduce_load'
      : energyLevel === 'low'
        ? 'recovery'
        : activationScore >= 75 && distressScore < 35
          ? 'execution'
          : focusState === 'focused'
            ? 'execution'
            : focusState === 'exploratory'
              ? 'exploration'
              : 'steady';

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    cognitive_load: cognitiveLoad,
    cognitive_activation: cognitiveActivation,
    cognitive_distress: cognitiveDistress,
    emotional_state: emotionalState,
    energy_level: energyLevel,
    focus_state: focusState,
    dominant_mode: dominantMode,
    overwhelm_score: overwhelmScore,
    activation_score: activationScore,
    distress_score: distressScore,
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
      cognitive_activation: state.cognitive_activation || null,
      cognitive_distress: state.cognitive_distress || null,
      emotional_state: state.emotional_state,
      energy_level: state.energy_level,
      focus_state: state.focus_state,
      dominant_mode: state.dominant_mode,
      overwhelm_score: state.overwhelm_score,
      activation_score: state.activation_score ?? null,
      distress_score: state.distress_score ?? null,
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
    cognitive_activation: state.cognitive_activation || null,
    cognitive_distress: state.cognitive_distress || null,
    emotional_state: state.emotional_state,
    energy_level: state.energy_level,
    focus_state: state.focus_state,
    dominant_mode: state.dominant_mode,
    overwhelm_score: state.overwhelm_score,
    activation_score: state.activation_score ?? null,
    distress_score: state.distress_score ?? null,
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


// ------------------------------
// Cognitive History Engine V2
// ------------------------------

function getScoreSeries(states, key) {
  return (Array.isArray(states) ? states : [])
    .map(state => Number(state?.[key]))
    .filter(value => !Number.isNaN(value));
}

function getLatestScore(states, key) {
  const scores = getScoreSeries(states, key);
  return scores.length ? scores[scores.length - 1] : null;
}

function getFirstScore(states, key) {
  const scores = getScoreSeries(states, key);
  return scores.length ? scores[0] : null;
}

function countRecentStates(states, predicate, limit = 8) {
  return (Array.isArray(states) ? states : [])
    .slice(-limit)
    .reduce((total, state) => predicate(state) ? total + 1 : total, 0);
}

function countDirectionChanges(values) {
  const numbers = values.filter(value => typeof value === 'number' && !Number.isNaN(value));

  if (numbers.length < 3) return 0;

  let previousDirection = 0;
  let changes = 0;

  for (let index = 1; index < numbers.length; index += 1) {
    const delta = numbers[index] - numbers[index - 1];
    const direction = delta > 5 ? 1 : delta < -5 ? -1 : 0;

    if (direction !== 0 && previousDirection !== 0 && direction !== previousDirection) {
      changes += 1;
    }

    if (direction !== 0) {
      previousDirection = direction;
    }
  }

  return changes;
}

function buildCognitiveHistorySignals(states) {
  const safeStates = Array.isArray(states) ? states : [];
  const recentStates = safeStates.slice(-8);
  const overwhelmScores = getScoreSeries(safeStates, 'overwhelm_score');
  const activationScores = getScoreSeries(safeStates, 'activation_score');
  const distressScores = getScoreSeries(safeStates, 'distress_score');

  const latestOverwhelm = getLatestScore(safeStates, 'overwhelm_score');
  const latestActivation = getLatestScore(safeStates, 'activation_score');
  const latestDistress = getLatestScore(safeStates, 'distress_score');
  const firstOverwhelm = getFirstScore(safeStates, 'overwhelm_score');
  const firstActivation = getFirstScore(safeStates, 'activation_score');
  const firstDistress = getFirstScore(safeStates, 'distress_score');

  const averageOverwhelm = averageNumber(overwhelmScores);
  const averageActivation = averageNumber(activationScores);
  const averageDistress = averageNumber(distressScores);

  return {
    state_count: safeStates.length,
    recent_state_count: recentStates.length,
    latest_overwhelm: latestOverwhelm,
    latest_activation: latestActivation,
    latest_distress: latestDistress,
    first_overwhelm: firstOverwhelm,
    first_activation: firstActivation,
    first_distress: firstDistress,
    average_overwhelm: averageOverwhelm,
    average_activation: averageActivation,
    average_distress: averageDistress,
    overwhelm_delta_from_start:
      latestOverwhelm !== null && firstOverwhelm !== null ? latestOverwhelm - firstOverwhelm : 0,
    activation_delta_from_start:
      latestActivation !== null && firstActivation !== null ? latestActivation - firstActivation : 0,
    distress_delta_from_start:
      latestDistress !== null && firstDistress !== null ? latestDistress - firstDistress : 0,
    high_overwhelm_recent_count: countRecentStates(recentStates, state => Number(state?.overwhelm_score || 0) >= 65, 8),
    high_distress_recent_count: countRecentStates(recentStates, state => Number(state?.distress_score || 0) >= 55, 8),
    high_activation_recent_count: countRecentStates(recentStates, state => Number(state?.activation_score || 0) >= 70, 8),
    low_energy_recent_count: countRecentStates(recentStates, state => state?.energy_level === 'low', 8),
    scattered_recent_count: countRecentStates(recentStates, state => ['scattered', 'fragmented'].includes(state?.focus_state), 8),
    focused_recent_count: countRecentStates(recentStates, state => state?.focus_state === 'focused', 8),
    recovery_mode_recent_count: countRecentStates(recentStates, state => state?.dominant_mode === 'recovery', 8),
    reduce_load_recent_count: countRecentStates(recentStates, state => state?.dominant_mode === 'reduce_load', 8),
    overwhelm_direction_changes: countDirectionChanges(overwhelmScores.slice(-12)),
    activation_direction_changes: countDirectionChanges(activationScores.slice(-12)),
    distress_direction_changes: countDirectionChanges(distressScores.slice(-12)),
  };
}

function addInsight(insights, insight) {
  if (!insight || !insight.id) return;

  if (!insights.some(existingInsight => existingInsight.id === insight.id)) {
    insights.push({
      ...insight,
      created_at: nowIso(),
    });
  }
}

function detectCognitiveCycles(states, signals) {
  const insights = [];

  if (signals.state_count < 3) {
    addInsight(insights, {
      id: 'insufficient_history',
      type: 'history_depth',
      severity: 'low',
      label: 'Historique encore trop court',
      description: 'Nyra a besoin de plus de snapshots pour reconnaître des cycles fiables.',
      confidence: 0.35,
      recommendation: 'Continuer à générer des états cognitifs via les captures, focus et actions.',
    });

    return insights;
  }

  if (signals.high_overwhelm_recent_count >= 4 || signals.reduce_load_recent_count >= 3) {
    addInsight(insights, {
      id: 'chronic_overload_cycle',
      type: 'cycle',
      severity: 'high',
      label: 'Cycle de surcharge persistante',
      description: 'Plusieurs états récents restent en surcharge ou en mode réduction de charge.',
      confidence: 0.82,
      recommendation: 'Nyra doit réduire les priorités visibles, proposer récupération et éviter les sessions longues.',
    });
  }

  if (signals.high_activation_recent_count >= 3 && signals.low_energy_recent_count >= 2) {
    addInsight(insights, {
      id: 'activation_recovery_gap',
      type: 'cycle',
      severity: 'medium',
      label: 'Activation forte avec récupération insuffisante',
      description: 'L’historique suggère une alternance entre forte activation et énergie basse.',
      confidence: 0.76,
      recommendation: 'Prévoir des pauses obligatoires et limiter l’empilement de nouvelles actions.',
    });
  }

  if (signals.overwhelm_direction_changes >= 3 || signals.distress_direction_changes >= 3) {
    addInsight(insights, {
      id: 'unstable_cognitive_oscillation',
      type: 'cycle',
      severity: 'medium',
      label: 'Oscillation cognitive instable',
      description: 'Les scores montent et redescendent souvent sur les derniers états.',
      confidence: 0.72,
      recommendation: 'Nyra doit privilégier des cycles courts et éviter les changements de plan trop fréquents.',
    });
  }

  if (signals.focused_recent_count >= 3 && signals.latest_distress !== null && signals.latest_distress < 45) {
    addInsight(insights, {
      id: 'productive_focus_cycle',
      type: 'cycle',
      severity: 'positive',
      label: 'Cycle de focus productif',
      description: 'Les derniers états montrent une capacité de focus sans détresse élevée.',
      confidence: 0.78,
      recommendation: 'Nyra peut proposer une session structurée, tout en gardant un garde-fou anti-hyperfocus.',
    });
  }

  return insights;
}

function detectRecoveryPatterns(states, signals) {
  const insights = [];
  const recentStates = Array.isArray(states) ? states.slice(-8) : [];

  if (signals.overwhelm_delta_from_start <= -12 && signals.distress_delta_from_start <= -8) {
    addInsight(insights, {
      id: 'recovery_trend_detected',
      type: 'recovery',
      severity: 'positive',
      label: 'Récupération progressive détectée',
      description: 'La surcharge et/ou la détresse diminuent sur la période analysée.',
      confidence: 0.8,
      recommendation: 'Conserver ce qui fonctionne et éviter de réaugmenter brutalement la charge.',
    });
  }

  if (signals.low_energy_recent_count >= 3 && signals.latest_overwhelm !== null && signals.latest_overwhelm >= 55) {
    addInsight(insights, {
      id: 'incomplete_recovery',
      type: 'recovery',
      severity: 'high',
      label: 'Récupération incomplète',
      description: 'L’énergie reste basse alors que la charge demeure significative.',
      confidence: 0.79,
      recommendation: 'Nyra doit proposer un mode récupération, hydratation, repas, pause corporelle ou micro-action.',
    });
  }

  const hasRecentRecoveryMode = recentStates.some(state => state?.dominant_mode === 'recovery');
  const hasLaterExecution = recentStates.some(state => state?.dominant_mode === 'execution');

  if (hasRecentRecoveryMode && hasLaterExecution && signals.latest_distress !== null && signals.latest_distress < 55) {
    addInsight(insights, {
      id: 'recovery_to_execution_bridge',
      type: 'recovery',
      severity: 'positive',
      label: 'Pont récupération → exécution',
      description: 'Nyra observe un passage possible de récupération vers exécution.',
      confidence: 0.68,
      recommendation: 'Proposer une reprise progressive plutôt qu’une grosse session immédiate.',
    });
  }

  return insights;
}

function detectBurnRisk(states, signals) {
  const risks = [];
  let score = 0;

  score += signals.high_overwhelm_recent_count * 12;
  score += signals.high_distress_recent_count * 14;
  score += signals.low_energy_recent_count * 10;
  score += signals.scattered_recent_count * 6;
  score += signals.reduce_load_recent_count * 8;

  if (signals.latest_overwhelm >= 75) score += 15;
  if (signals.latest_distress >= 70) score += 20;
  if (signals.latest_activation >= 75 && signals.latest_distress >= 55) score += 10;
  if (signals.overwhelm_delta_from_start >= 15) score += 10;
  if (signals.distress_delta_from_start >= 12) score += 12;

  const riskScore = clampNumber(Math.round(score), 0, 100);
  const level = riskScore >= 75 ? 'critical' : riskScore >= 55 ? 'high' : riskScore >= 30 ? 'moderate' : 'low';

  if (level === 'critical' || level === 'high') {
    addInsight(risks, {
      id: 'burnout_or_crash_risk',
      type: 'risk',
      severity: level === 'critical' ? 'critical' : 'high',
      label: level === 'critical' ? 'Risque de crash cognitif élevé' : 'Risque de surcharge à surveiller',
      description: 'Les derniers états combinent charge, détresse, énergie basse ou dispersion.',
      confidence: level === 'critical' ? 0.86 : 0.74,
      recommendation: 'Nyra doit réduire la pression, imposer une pause et proposer seulement une micro-action utile.',
    });
  }

  return {
    level,
    score: riskScore,
    insights: risks,
  };
}

function detectActivationInstability(states, signals) {
  const insights = [];

  if (signals.high_activation_recent_count >= 3 && signals.activation_direction_changes >= 2) {
    addInsight(insights, {
      id: 'activation_instability',
      type: 'activation',
      severity: 'medium',
      label: 'Activation cognitive instable',
      description: 'L’activation semble forte mais irrégulière sur les derniers états.',
      confidence: 0.7,
      recommendation: 'Nyra doit canaliser l’énergie sur une seule priorité et éviter la dispersion.',
    });
  }

  if (signals.latest_activation >= 75 && signals.latest_distress < 40 && signals.latest_overwhelm < 60) {
    addInsight(insights, {
      id: 'high_activation_available',
      type: 'activation',
      severity: 'positive',
      label: 'Activation disponible sans détresse forte',
      description: 'Le système semble mobilisé sans signe majeur de détresse immédiate.',
      confidence: 0.75,
      recommendation: 'Nyra peut proposer du deep focus cadré, avec pause obligatoire.',
    });
  }

  return insights;
}

function buildPredictiveInsights({ states, signals, burnRisk }) {
  const predictions = [];

  if (burnRisk.level === 'critical' || burnRisk.level === 'high') {
    addInsight(predictions, {
      id: 'predict_reduce_load_next',
      type: 'prediction',
      severity: burnRisk.level === 'critical' ? 'critical' : 'high',
      label: 'Nyra doit probablement passer en mode réduction de charge',
      description: 'Les signaux récents indiquent qu’ajouter de la pression risque d’aggraver l’état.',
      confidence: burnRisk.level === 'critical' ? 0.84 : 0.72,
      recommendation: 'Limiter l’écran à une priorité, proposer pause corporelle et micro-action de moins de 5 minutes.',
    });
  }

  if (signals.high_activation_recent_count >= 3 && signals.low_energy_recent_count >= 2) {
    addInsight(predictions, {
      id: 'predict_post_hyperfocus_crash',
      type: 'prediction',
      severity: 'high',
      label: 'Risque de crash après hyperfocus',
      description: 'L’historique combine activation élevée et énergie basse récente.',
      confidence: 0.77,
      recommendation: 'Couper les sessions longues en blocs courts avec pauses obligatoires.',
    });
  }

  if (signals.overwhelm_delta_from_start <= -12 && burnRisk.score < 45) {
    addInsight(predictions, {
      id: 'predict_safe_progressive_execution',
      type: 'prediction',
      severity: 'positive',
      label: 'Reprise progressive possible',
      description: 'Les tendances indiquent une baisse de surcharge compatible avec une reprise douce.',
      confidence: 0.7,
      recommendation: 'Proposer une action simple et mesurable plutôt qu’un gros bloc de travail.',
    });
  }

  return predictions;
}

function buildCognitiveHistoryV2Analysis(store, userId, limit = 60) {
  const states = getOrderedUserStates(store, userId, limit);
  const compactStates = states.map(compactUserStateForHistory);
  const signals = buildCognitiveHistorySignals(states);
  const cycleInsights = detectCognitiveCycles(states, signals);
  const recoveryInsights = detectRecoveryPatterns(states, signals);
  const burnRisk = detectBurnRisk(states, signals);
  const activationInsights = detectActivationInstability(states, signals);
  const predictiveInsights = buildPredictiveInsights({ states, signals, burnRisk });

  const insights = uniqueArray([
    ...cycleInsights,
    ...recoveryInsights,
    ...burnRisk.insights,
    ...activationInsights,
    ...predictiveInsights,
  ].map(insight => insight.id))
    .map(id => {
      return [
        ...cycleInsights,
        ...recoveryInsights,
        ...burnRisk.insights,
        ...activationInsights,
        ...predictiveInsights,
      ].find(insight => insight.id === id);
    })
    .filter(Boolean);

  const primaryInsight = insights.find(insight => ['critical', 'high'].includes(insight.severity)) || insights[0] || null;

  const recommendedMode =
    burnRisk.level === 'critical' || burnRisk.level === 'high'
      ? 'reduce_load'
      : insights.some(insight => insight.id === 'high_activation_available')
        ? 'structured_execution'
        : insights.some(insight => insight.id === 'recovery_trend_detected')
          ? 'progressive_recovery'
          : signals.state_count < 3
            ? 'observe'
            : 'steady_support';

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    engine_version: 'cognitive-history-v2',
    generated_at: nowIso(),
    limit,
    summary: {
      state_count: states.length,
      recommended_mode: recommendedMode,
      burn_risk_level: burnRisk.level,
      burn_risk_score: burnRisk.score,
      primary_insight: primaryInsight,
      average_overwhelm_score: signals.average_overwhelm,
      average_activation_score: signals.average_activation,
      average_distress_score: signals.average_distress,
      latest_overwhelm_score: signals.latest_overwhelm,
      latest_activation_score: signals.latest_activation,
      latest_distress_score: signals.latest_distress,
    },
    signals,
    cycles: cycleInsights,
    recovery_patterns: recoveryInsights,
    activation_patterns: activationInsights,
    predictions: predictiveInsights,
    insights,
    states: compactStates,
  };
}

function saveCognitiveHistoryAnalysis(store, analysis) {
  store.cognitive_history_analyses = Array.isArray(store.cognitive_history_analyses)
    ? store.cognitive_history_analyses
    : [];

  store.cognitive_history_analyses.push(analysis);
  store.cognitive_history_analyses = store.cognitive_history_analyses.slice(-500);

  return analysis;
}

function getRecentCognitiveHistoryAnalyses(store, userId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

  return (Array.isArray(store.cognitive_history_analyses) ? store.cognitive_history_analyses : [])
    .filter(analysis => analysis.user_id === userId)
    .sort((a, b) => {
      return new Date(b.generated_at || 0).getTime() -
        new Date(a.generated_at || 0).getTime();
    })
    .slice(0, safeLimit);
}

function buildUserStateHistoryV2Payload(store, userId, limit = 60) {
  const history = buildUserStateHistoryPayload(store, userId, limit);
  const cognitive_history_v2 = buildCognitiveHistoryV2Analysis(store, userId, limit);

  return {
    ...history,
    cognitive_history_v2,
  };
}


function getFrenchRiskLabel(level) {
  if (level === 'critical') return 'Risque critique';
  if (level === 'high') return 'Risque élevé';
  if (level === 'moderate') return 'Risque modéré';
  return 'Risque bas';
}

function getFrenchRecommendedModeLabel(mode) {
  if (mode === 'reduce_load') return 'Réduction de charge';
  if (mode === 'structured_execution') return 'Exécution cadrée';
  if (mode === 'progressive_recovery') return 'Récupération progressive';
  if (mode === 'observe') return 'Observation';
  if (mode === 'steady_support') return 'Soutien stable';
  return 'Adaptation douce';
}

function buildCognitiveHistoryUserFacingSummary(analysis) {
  const summary = analysis?.summary || {};
  const primaryInsight = summary.primary_insight || null;
  const riskLevel = summary.burn_risk_level || 'low';
  const recommendedMode = summary.recommended_mode || 'steady_support';
  const stateCount = Number(summary.state_count || 0);

  let headline = 'Nyra observe ton évolution cognitive.';

  if (riskLevel === 'critical' || riskLevel === 'high') {
    headline = 'Nyra détecte une charge qui mérite d’être réduite.';
  } else if (recommendedMode === 'structured_execution') {
    headline = 'Nyra détecte une bonne disponibilité pour avancer, avec cadre.';
  } else if (recommendedMode === 'progressive_recovery') {
    headline = 'Nyra détecte une récupération progressive.';
  } else if (stateCount < 3) {
    headline = 'Nyra commence à construire ton historique cognitif.';
  }

  return {
    title: 'Évolution cognitive',
    headline,
    state_points_label: 'points d’état récents',
    state_points_count: stateCount,
    recommended_mode_label: getFrenchRecommendedModeLabel(recommendedMode),
    burn_risk_label: getFrenchRiskLabel(riskLevel),
    burn_risk_score: summary.burn_risk_score ?? null,
    main_pattern_label: primaryInsight?.label || 'Aucune tendance forte détectée',
    main_pattern_description: primaryInsight?.description || 'Nyra continue d’observer ton fonctionnement pour mieux adapter ses recommandations.',
    next_best_action: primaryInsight?.recommendation || 'Continuer à avancer avec une priorité claire et une pause prévue.',
    wording: {
      internal_snapshot: 'point d’état',
      public_history: 'historique cognitif',
      public_trend: 'évolution',
      public_prediction: 'anticipation',
    },
  };
}

function buildPredictiveRiskFromCognitiveHistory(analysis) {
  const summary = analysis?.summary || {};
  const signals = analysis?.signals || {};
  const riskLevel = summary.burn_risk_level || 'low';
  const riskScore = Number(summary.burn_risk_score || 0);
  const insights = Array.isArray(analysis?.insights) ? analysis.insights : [];
  const riskInsights = insights.filter(insight => {
    return ['critical', 'high', 'warning'].includes(insight.severity) || String(insight.id || '').includes('risk');
  });

  return {
    level: riskLevel,
    score: riskScore,
    label: getFrenchRiskLabel(riskLevel),
    should_interrupt: riskLevel === 'critical',
    should_reduce_load: riskLevel === 'critical' || riskLevel === 'high',
    should_suggest_recovery: ['critical', 'high', 'moderate'].includes(riskLevel),
    recent_evolution: {
      overwhelm_delta_from_start: signals.overwhelm_delta_from_start ?? null,
      activation_delta_from_start: signals.activation_delta_from_start ?? null,
      distress_delta_from_start: signals.distress_delta_from_start ?? null,
    },
    reasons: riskInsights.slice(0, 3),
  };
}

function buildAdaptiveFocusStrategyFromCognitiveHistory(analysis) {
  const summary = analysis?.summary || {};
  const signals = analysis?.signals || {};
  const recommendedMode = summary.recommended_mode || 'steady_support';
  const riskLevel = summary.burn_risk_level || 'low';
  const latestActivation = Number(summary.latest_activation_score || 0);
  const latestDistress = Number(summary.latest_distress_score || 0);
  const highActivationCount = Number(signals.high_activation_recent_count || 0);

  const shouldReduceLoad = riskLevel === 'critical' || riskLevel === 'high' || recommendedMode === 'reduce_load';
  const shouldProtectFromHyperfocus = latestActivation >= 75 && latestDistress < 35 && highActivationCount >= 2;

  if (shouldReduceLoad) {
    return {
      mode: 'gentle_focus',
      regulation_level: riskLevel === 'critical' ? 'protective' : 'high',
      suggested_duration_bias: 'shorter',
      should_force_break: true,
      should_reduce_load: true,
      should_protect_from_hyperfocus: false,
      rationale: 'L’historique cognitif indique une charge trop élevée pour pousser l’exécution.',
    };
  }

  if (shouldProtectFromHyperfocus || recommendedMode === 'structured_execution') {
    return {
      mode: 'structured_execution',
      regulation_level: 'medium',
      suggested_duration_bias: shouldProtectFromHyperfocus ? 'capped' : 'normal',
      should_force_break: true,
      should_reduce_load: false,
      should_protect_from_hyperfocus: shouldProtectFromHyperfocus,
      rationale: 'L’historique indique une forte activation utile, à cadrer avec des pauses obligatoires.',
    };
  }

  if (recommendedMode === 'progressive_recovery') {
    return {
      mode: 'recovery_focus',
      regulation_level: 'gentle',
      suggested_duration_bias: 'shorter',
      should_force_break: true,
      should_reduce_load: false,
      should_protect_from_hyperfocus: false,
      rationale: 'L’historique montre une récupération en cours : reprise progressive recommandée.',
    };
  }

  return {
    mode: 'steady_support',
    regulation_level: 'normal',
    suggested_duration_bias: 'normal',
    should_force_break: false,
    should_reduce_load: false,
    should_protect_from_hyperfocus: false,
    rationale: 'Aucun signal fort ne demande d’adaptation stricte pour le moment.',
  };
}

function deriveRecommendedRegulationLevel({ predictiveRisk, adaptiveFocusStrategy }) {
  if (predictiveRisk?.level === 'critical') return 'protective';
  if (predictiveRisk?.level === 'high') return 'high';
  if (adaptiveFocusStrategy?.should_protect_from_hyperfocus) return 'medium';
  if (predictiveRisk?.level === 'moderate') return 'medium';
  if (adaptiveFocusStrategy?.mode === 'recovery_focus') return 'gentle';
  return 'normal';
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
    shopping_list: userItems.filter(item => item.bucket === 'shopping_list').length,
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
    cognitive_priority_snapshot_count: (Array.isArray(store.cognitive_priority_snapshots) ? store.cognitive_priority_snapshots : []).filter(snapshot => snapshot.user_id === userId).length,
    cognitive_history_analysis_count: (Array.isArray(store.cognitive_history_analyses) ? store.cognitive_history_analyses : []).filter(analysis => analysis.user_id === userId).length,
    proactive_assistant_v2_event_count: (Array.isArray(store.proactive_assistant_v2_events) ? store.proactive_assistant_v2_events : []).filter(event => event.user_id === userId).length,
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

  if (action.action_type === 'add_to_today') return `✔ Ajouté à aujourd’hui : ${action.title || action.target}.`;
  if (action.action_type === 'add_to_shopping_list') return `✔ Ajouté à ta liste de courses : ${action.title || action.target}.`;
  if (action.action_type === 'create_reminder') {
    if (action.scheduled_at) return '✔ Rappel créé et programmé.';
    return '✔ Rappel enregistré sans date. Tu pourras lui ajouter une date plus tard.';
  }
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
- si response_level = capture : réponds très court, comme une confirmation utile
- si response_level = reflection : fais 1 observation courte + 1 question utile
- si response_level = project : relie clairement au projet concerné et propose la prochaine clarification utile
- si l’utilisateur demande à comprendre une émotion, ne dis pas "c’est capturé" comme réponse principale
- évite les phrases génériques comme "prends un moment pour respirer" sauf si la personne semble en crise
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
      auth_providers: ['google'],
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
    const providers = new Set(Array.isArray(user.auth_providers) ? user.auth_providers : [user.provider || 'google']);
    providers.add('google');

    user.provider = user.provider === 'email' ? 'email' : 'google';
    user.auth_providers = [...providers];
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
    elevenlabs_configured: Boolean(ELEVENLABS_API_KEY),
    elevenlabs_voice_id: ELEVENLABS_DEFAULT_VOICE_ID || null,
    engines: {
      context: true,
      focus: true,
      adaptive: true,
      proactive: true,
      timeline: true,
      memory_graph: true,
      priority: true,
      momentum_recovery: true,
    },
  });
});


function normalizeSpeechText(value) {
  return normalizeText(value)
    .replace(/[-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function resolveElevenLabsVoiceId(voice, voiceId) {
  const explicitVoiceId = normalizeText(voiceId || '');

  if (explicitVoiceId) {
    return explicitVoiceId;
  }

  const requestedVoice = normalizeKey(voice || 'nyra');

  // Voix Nyra par défaut. D'autres alias pourront être ajoutés ici plus tard.
  if (!requestedVoice || requestedVoice === 'nyra' || requestedVoice === 'default') {
    return ELEVENLABS_DEFAULT_VOICE_ID;
  }

  return ELEVENLABS_DEFAULT_VOICE_ID;
}

function buildElevenLabsSpeechPayload(text) {
  return {
    text,
    model_id: ELEVENLABS_MODEL_ID,
    voice_settings: ELEVENLABS_VOICE_SETTINGS,
  };
}

async function generateElevenLabsSpeech({ text, voice, voiceId }) {
  const cleanText = normalizeSpeechText(text);
  const resolvedVoiceId = resolveElevenLabsVoiceId(voice, voiceId);

  if (!ELEVENLABS_API_KEY) {
    return {
      ok: false,
      status: 503,
      error: 'ELEVENLABS_API_KEY_MISSING',
      message: 'Clé ElevenLabs absente côté serveur.',
    };
  }

  if (!cleanText) {
    return {
      ok: false,
      status: 400,
      error: 'TEXT_MISSING',
      message: 'Texte manquant pour la synthèse vocale.',
    };
  }

  if (!resolvedVoiceId) {
    return {
      ok: false,
      status: 400,
      error: 'VOICE_ID_MISSING',
      message: 'Voice ID ElevenLabs manquant.',
    };
  }

  const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolvedVoiceId)}?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;

  const response = await fetch(elevenLabsUrl, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify(buildElevenLabsSpeechPayload(cleanText)),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');

    return {
      ok: false,
      status: response.status,
      error: 'ELEVENLABS_REQUEST_FAILED',
      message: errorBody || `ElevenLabs a répondu avec le statut ${response.status}.`,
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  if (!audioBuffer.length) {
    return {
      ok: false,
      status: 502,
      error: 'EMPTY_AUDIO',
      message: 'ElevenLabs a renvoyé un audio vide.',
    };
  }

  return {
    ok: true,
    audioBuffer,
    voice_id: resolvedVoiceId,
    text: cleanText,
    content_type: 'audio/mpeg',
  };
}

app.post('/speak', async (req, res) => {
  const startedAt = Date.now();

  try {
    const speechResult = await generateElevenLabsSpeech({
      text: req.body?.text || req.body?.message || '',
      voice: req.body?.voice || 'nyra',
      voiceId: req.body?.voiceId || req.body?.voice_id || '',
    });

    if (!speechResult.ok) {
      return res.status(speechResult.status || 500).json({
        ok: false,
        error: speechResult.error,
        message: speechResult.message,
        fallback_recommended: true,
        provider: 'elevenlabs',
        perf: {
          total_ms: Date.now() - startedAt,
        },
      });
    }

    res.setHeader('Content-Type', speechResult.content_type);
    res.setHeader('Content-Length', speechResult.audioBuffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Nyra-Voice-Provider', 'elevenlabs');
    res.setHeader('X-Nyra-Voice-Id', speechResult.voice_id);
    res.setHeader('X-Nyra-Perf-Ms', String(Date.now() - startedAt));

    return res.send(speechResult.audioBuffer);
  } catch (error) {
    console.error('❌ /speak error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur synthèse vocale ElevenLabs',
      details: error.message,
      fallback_recommended: true,
      provider: 'elevenlabs',
    });
  }
});


app.post('/auth/register', (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || '');
    const password = String(req.body?.password || '');
    const name = normalizeText(req.body?.name || '');

    if (!isValidEmail(email)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_EMAIL',
        message: 'Adresse email invalide.',
      });
    }

    const passwordValidation = validatePassword(password);

    if (!passwordValidation.ok) {
      return res.status(400).json({
        ok: false,
        error: passwordValidation.error,
        message: passwordValidation.message,
      });
    }

    const store = readStore();
    const existingUser = store.users.find(user => {
      return normalizeEmail(user.email || '') === email &&
        user.password_hash &&
        Array.isArray(user.auth_providers) &&
        user.auth_providers.includes('email');
    });

    if (existingUser) {
      return res.status(409).json({
        ok: false,
        error: 'EMAIL_ALREADY_REGISTERED',
        message: 'Un compte existe déjà avec cette adresse email.',
      });
    }

    const result = upsertEmailUser(store, email, password, name);
    const sessionResult = createNyraSession(store, result.user, 'email_register');

    writeStore(store);

    return res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      connected: true,
      userId: result.user.id,
      effective_user_id: result.user.id,
      token: sessionResult.token,
      session: {
        id: sessionResult.session.id,
        source: sessionResult.session.source,
        created_at: sessionResult.session.created_at,
      },
      user: sanitizeUserForClient(result.user),
    });
  } catch (error) {
    console.error('❌ /auth/register error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'AUTH_REGISTER_FAILED',
      message: 'Erreur création de compte Nyra.',
      details: error.message,
    });
  }
});

app.post('/auth/login', (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || '');
    const password = String(req.body?.password || '');

    if (!isValidEmail(email)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_EMAIL',
        message: 'Adresse email invalide.',
      });
    }

    if (!password) {
      return res.status(400).json({
        ok: false,
        error: 'PASSWORD_REQUIRED',
        message: 'Mot de passe obligatoire.',
      });
    }

    const store = readStore();
    const user = store.users.find(existingUser => {
      return normalizeEmail(existingUser.email || '') === email;
    });

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({
        ok: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Email ou mot de passe incorrect.',
      });
    }

    const sessionResult = createNyraSession(store, user, 'email_login');
    user.updated_at = nowIso();

    writeStore(store);

    return res.json({
      ok: true,
      connected: true,
      userId: user.id,
      effective_user_id: user.id,
      token: sessionResult.token,
      session: {
        id: sessionResult.session.id,
        source: sessionResult.session.source,
        created_at: sessionResult.session.created_at,
      },
      user: sanitizeUserForClient(user),
    });
  } catch (error) {
    console.error('❌ /auth/login error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'AUTH_LOGIN_FAILED',
      message: 'Erreur connexion Nyra.',
      details: error.message,
    });
  }
});


app.patch('/auth/profile', (req, res) => {
  try {
    const store = readStore();
    const user = findUserForProfileUpdate(store, req);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: 'USER_NOT_FOUND',
        message: 'Utilisateur introuvable ou session invalide.',
      });
    }

    const profileName = normalizeText(
      req.body?.profileName ||
      req.body?.profile_name ||
      req.body?.displayName ||
      req.body?.display_name ||
      ''
    ).slice(0, 60);

    const rawProfilePicture =
      req.body?.profilePicture ||
      req.body?.profile_picture ||
      req.body?.profilePictureUrl ||
      req.body?.profile_picture_url ||
      '';

    const profilePicture = sanitizeProfilePicture(rawProfilePicture);

    if (profileName) {
      user.profile_name = profileName;
    }

    if (rawProfilePicture === '' || rawProfilePicture === null) {
      user.profile_picture = null;
    } else if (profilePicture) {
      user.profile_picture = profilePicture;
    } else if (normalizeText(rawProfilePicture)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_PROFILE_PICTURE_URL',
        message: 'La photo de profil doit être une image valide : https://, file://, content:// ou data:image/.',
      });
    }

    user.updated_at = nowIso();
    writeStore(store);

    return res.json({
      ok: true,
      connected: true,
      userId: user.id,
      effective_user_id: user.id,
      user: sanitizeUserForClient(user),
      message: 'Profil Nyra mis à jour.',
    });
  } catch (error) {
    console.error('❌ /auth/profile error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'PROFILE_UPDATE_FAILED',
      message: 'Erreur mise à jour profil Nyra.',
      details: error.message,
    });
  }
});

app.post('/auth/logout', (req, res) => {
  try {
    const token = getSessionTokenFromRequest(req);
    const store = readStore();

    if (token) {
      const tokenHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      store.sessions = Array.isArray(store.sessions) ? store.sessions : [];
      store.sessions = store.sessions.map(session => {
        if (session.token_hash !== tokenHash) return session;

        return {
          ...session,
          status: 'revoked',
          updated_at: nowIso(),
          revoked_at: nowIso(),
        };
      });

      writeStore(store);
    }

    return res.json({
      ok: true,
      connected: false,
      message: 'Session Nyra fermée.',
    });
  } catch (error) {
    console.error('❌ /auth/logout error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'AUTH_LOGOUT_FAILED',
      message: 'Erreur déconnexion Nyra.',
      details: error.message,
    });
  }
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
  const token = getSessionTokenFromRequest(req);
  const store = readStore();

  if (token) {
    const sessionResult = findActiveSession(store, token);

    if (sessionResult?.user) {
      writeStore(store);

      return res.json({
        ok: true,
        connected: true,
        auth_type: 'session',
        userId: sessionResult.user.id,
        effective_user_id: sessionResult.user.id,
        legacy_user_id: sessionResult.user.legacy_user_id || null,
        user: sanitizeUserForClient(sessionResult.user),
        session: {
          id: sessionResult.session.id,
          source: sessionResult.session.source,
          created_at: sessionResult.session.created_at,
          last_seen_at: sessionResult.session.last_seen_at,
        },
        account: null,
      });
    }
  }

  const account = getGoogleDriveAccount(store, userId);

  if (!account) {
    return res.json({
      ok: true,
      connected: false,
      auth_type: null,
      userId,
      effective_user_id: null,
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
    auth_type: 'google',
    userId,
    effective_user_id: account.user_id,
    legacy_user_id: account.legacy_user_id || null,
    user: sanitizeUserForClient(user) || user || null,
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

function buildFocusRegulationProfile({
  mode,
  risk,
  guidanceStyle,
  breakStrategy,
  frictionLevel,
  recoveryNeeded,
  microBreakEveryMin,
  pressureLevel,
  interventionIntensity,
}) {
  return {
    risk: risk || 'normal',
    guidance_style: guidanceStyle || 'balanced_guidance',
    break_strategy: breakStrategy || 'standard_break',
    friction_level: frictionLevel || 'medium',
    recovery_needed: Boolean(recoveryNeeded),
    micro_break_every_min: microBreakEveryMin || null,
    pressure_level: pressureLevel || 'medium',
    intervention_intensity: interventionIntensity || 'normal',
    mode_family: mode || 'standard_focus',
  };
}

function recommendFocusProfile(userState) {
  const overwhelmScore = Number(userState?.overwhelm_score || 0);
  const activationScore = Number(userState?.activation_score || 0);
  const distressScore = Number(userState?.distress_score || 0);
  const cognitiveLoad = normalizeText(userState?.cognitive_load || '');
  const cognitiveActivation = normalizeText(userState?.cognitive_activation || '');
  const cognitiveDistress = normalizeText(userState?.cognitive_distress || '');
  const energyLevel = normalizeText(userState?.energy_level || '');
  const focusState = normalizeText(userState?.focus_state || '');
  const dominantMode = normalizeText(userState?.dominant_mode || '');

  const isVeryHighDistress =
    distressScore >= 75 ||
    cognitiveDistress === 'very_high';

  const isHighDistress =
    distressScore >= 55 ||
    cognitiveDistress === 'high' ||
    cognitiveDistress === 'very_high' ||
    dominantMode === 'reduce_load';

  const isLowEnergy =
    energyLevel === 'low' ||
    dominantMode === 'recovery';

  const isLowActivation =
    activationScore < 30 ||
    cognitiveActivation === 'low';

  const isProductiveHyperactivation =
    (
      activationScore >= 75 ||
      cognitiveActivation === 'very_high'
    ) &&
    distressScore < 35 &&
    (
      cognitiveDistress === 'low' ||
      cognitiveDistress === 'moderate' ||
      !cognitiveDistress
    ) &&
    energyLevel !== 'low';

  if (isVeryHighDistress) {
    return {
      mode: 'gentle_focus',
      focus_duration_min: 10,
      break_duration_min: 7,
      cycles_recommended: 1,
      tone: 'protective',
      reason: 'Nyra détecte une détresse cognitive élevée. La priorité est de réduire la pression avant de performer.',
      opening_message: 'On baisse la charge. Une seule micro-action suffit.',
      break_message: 'Pause de régulation. Respire, bois un peu, relâche les épaules.',
      regulation: buildFocusRegulationProfile({
        mode: 'gentle_focus',
        risk: 'cognitive_distress',
        guidanceStyle: 'regulation_first',
        breakStrategy: 'recovery_break',
        frictionLevel: 'very_low',
        recoveryNeeded: true,
        pressureLevel: 'very_low',
        interventionIntensity: 'high',
      }),
    };
  }

  if (isHighDistress || overwhelmScore >= 70 || cognitiveLoad === 'very_high') {
    return {
      mode: 'gentle_focus',
      focus_duration_min: 15,
      break_duration_min: 7,
      cycles_recommended: 1,
      tone: 'gentle',
      reason: 'Nyra détecte une charge ou une détresse cognitive élevée. La session doit rester courte et contenante.',
      opening_message: 'On fait court, simple, sans se mettre en échec.',
      break_message: 'Pause obligatoire. Ton système doit redescendre avant la suite.',
      regulation: buildFocusRegulationProfile({
        mode: 'gentle_focus',
        risk: 'overload',
        guidanceStyle: 'low_pressure_guidance',
        breakStrategy: 'mandatory_recovery_break',
        frictionLevel: 'low',
        recoveryNeeded: true,
        pressureLevel: 'low',
        interventionIntensity: 'medium',
      }),
    };
  }

  if (isLowEnergy && isLowActivation) {
    return {
      mode: 'recovery_focus',
      focus_duration_min: 8,
      break_duration_min: 7,
      cycles_recommended: 1,
      tone: 'soft',
      reason: 'Nyra détecte une activation basse. Le but n’est pas de forcer, mais de relancer doucement.',
      opening_message: 'On cherche juste un point d’entrée minuscule.',
      break_message: 'Pause longue. Récupération avant performance.',
      regulation: buildFocusRegulationProfile({
        mode: 'recovery_focus',
        risk: 'low_activation',
        guidanceStyle: 'micro_start',
        breakStrategy: 'long_recovery_break',
        frictionLevel: 'very_low',
        recoveryNeeded: true,
        pressureLevel: 'very_low',
        interventionIntensity: 'gentle',
      }),
    };
  }

  if (isProductiveHyperactivation) {
    return {
      mode: 'deep_focus',
      focus_duration_min: 45,
      break_duration_min: 10,
      cycles_recommended: 1,
      tone: 'structured',
      reason: 'Nyra détecte une hyperactivation productive : tu peux avancer en profondeur, mais avec garde-fou anti-hyperfocus.',
      opening_message: 'Tu sembles bien lancé. On garde une seule priorité pour éviter la dispersion, avec une vraie pause prévue.',
      break_message: 'Micro-pause obligatoire. Bois, respire, bouge un peu : on protège ton énergie.',
      regulation: buildFocusRegulationProfile({
        mode: 'deep_focus',
        risk: 'hyperfocus',
        guidanceStyle: 'structured_execution',
        breakStrategy: 'mandatory_micro_breaks',
        frictionLevel: 'medium',
        recoveryNeeded: false,
        microBreakEveryMin: 15,
        pressureLevel: 'medium',
        interventionIntensity: 'normal',
      }),
    };
  }

  if (focusState === 'focused' && energyLevel !== 'low' && overwhelmScore <= 55 && distressScore < 45) {
    return {
      mode: 'deep_focus',
      focus_duration_min: 40,
      break_duration_min: 10,
      cycles_recommended: 1,
      tone: 'direct',
      reason: 'Nyra détecte un état de focus disponible. Une session profonde est possible sans surcharge immédiate.',
      opening_message: 'On lance une vraie session focus, mais sur une seule chose.',
      break_message: 'Pause de récupération. Laisse ton cerveau redescendre avant la suite.',
      regulation: buildFocusRegulationProfile({
        mode: 'deep_focus',
        risk: 'normal',
        guidanceStyle: 'structured_execution',
        breakStrategy: 'standard_deep_break',
        frictionLevel: 'medium',
        recoveryNeeded: false,
        pressureLevel: 'medium',
        interventionIntensity: 'normal',
      }),
    };
  }

  return {
    mode: 'standard_focus',
    focus_duration_min: 25,
    break_duration_min: 5,
    cycles_recommended: 1,
    tone: 'balanced',
    reason: 'Nyra propose une session standard adaptée à une charge stable.',
    opening_message: 'On lance 25 minutes de focus sur une seule chose.',
    break_message: 'Pause de 5 minutes. Reviens ensuite pour décider si on relance un cycle.',
    regulation: buildFocusRegulationProfile({
      mode: 'standard_focus',
      risk: 'normal',
      guidanceStyle: 'balanced_guidance',
      breakStrategy: 'standard_break',
      frictionLevel: 'medium',
      recoveryNeeded: false,
      pressureLevel: 'medium',
      interventionIntensity: 'normal',
    }),
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
    regulation: profile.regulation || buildFocusRegulationProfile({ mode: profile.mode }),
    risk: profile.regulation?.risk || 'normal',
    break_strategy: profile.regulation?.break_strategy || 'standard_break',
    guidance_style: profile.regulation?.guidance_style || 'balanced_guidance',
    friction_level: profile.regulation?.friction_level || 'medium',
    recovery_needed: Boolean(profile.regulation?.recovery_needed),
    micro_break_every_min: profile.regulation?.micro_break_every_min || null,
    pressure_level: profile.regulation?.pressure_level || 'medium',
    intervention_intensity: profile.regulation?.intervention_intensity || 'normal',
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

function buildFocusDecisionContextForRecommendation(store, userId) {
  const latestUserState = getLatestUserState(store, userId) || saveUserStateSnapshot(store, userId);
  const adaptiveProfile = getOrCreateAdaptiveProfile(store, userId);
  const cognitiveHistory = buildCognitiveHistoryV2Analysis(store, userId, 60);
  const cognitiveHistoryUserFacing = buildCognitiveHistoryUserFacingSummary(cognitiveHistory);
  const predictiveRisk = buildPredictiveRiskFromCognitiveHistory(cognitiveHistory);
  const adaptiveFocusStrategy = buildAdaptiveFocusStrategyFromCognitiveHistory(cognitiveHistory);
  const proactivePayload = buildProactivePayload(store, userId);
  const proactiveAssistantV2 = buildProactiveAssistantV2Payload({
    userId,
    latestUserState,
    adaptiveProfile,
    proactivePayload,
    cognitiveHistory,
    cognitiveHistoryUserFacing,
    predictiveRisk,
    adaptiveFocusStrategy,
  });

  return {
    latestUserState,
    adaptiveProfile,
    cognitiveHistory,
    cognitiveHistoryUserFacing,
    predictiveRisk,
    adaptiveFocusStrategy,
    proactivePayload,
    proactiveAssistantV2,
  };
}

function cloneFocusProfile(profile) {
  return {
    ...profile,
    regulation: profile?.regulation && typeof profile.regulation === 'object'
      ? { ...profile.regulation }
      : buildFocusRegulationProfile({ mode: profile?.mode || 'standard_focus' }),
  };
}

function applyProactiveAssistantToFocusRecommendation(profile, decisionContext) {
  const nextProfile = cloneFocusProfile(profile);
  const predictiveRisk = decisionContext?.predictiveRisk || {};
  const adaptiveFocusStrategy = decisionContext?.adaptiveFocusStrategy || {};
  const proactiveAssistantV2 = decisionContext?.proactiveAssistantV2 || {};
  const primaryIntervention = proactiveAssistantV2.primary_intervention || null;
  const adaptiveProfile = decisionContext?.adaptiveProfile || null;

  const riskLevel = normalizeText(predictiveRisk.level || 'low');
  const primaryAction = normalizeText(primaryIntervention?.action || '');
  const shouldReduceLoad = Boolean(
    adaptiveFocusStrategy.should_reduce_load ||
    predictiveRisk.should_reduce_load ||
    riskLevel === 'critical' ||
    riskLevel === 'high' ||
    primaryAction === 'reduce_load_now'
  );
  const shouldForceBreak = Boolean(
    adaptiveFocusStrategy.should_force_break ||
    primaryAction === 'force_break_after_focus'
  );
  const shouldProtectFromHyperfocus = Boolean(
    adaptiveFocusStrategy.should_protect_from_hyperfocus ||
    primaryIntervention?.type === 'hyperfocus_protection'
  );
  const shouldSuggestRecovery = Boolean(
    predictiveRisk.should_suggest_recovery ||
    primaryAction === 'suggest_recovery_or_micro_action'
  );
  const durationBias = normalizeText(adaptiveFocusStrategy.suggested_duration_bias || 'normal');
  const completionRate = Number(adaptiveProfile?.average_completion_rate ?? 1);

  let applied = false;
  const appliedRules = [];

  if (shouldReduceLoad) {
    nextProfile.mode = 'gentle_focus';
    nextProfile.mode_label = getFocusModeLabel(nextProfile.mode);
    nextProfile.focus_duration_min = riskLevel === 'critical' ? 8 : 12;
    nextProfile.break_duration_min = riskLevel === 'critical' ? 10 : 7;
    nextProfile.cycles_recommended = 1;
    nextProfile.tone = riskLevel === 'critical' ? 'protective' : 'gentle';
    nextProfile.reason = 'Nyra réduit la session car l’historique cognitif indique une charge à protéger.';
    nextProfile.opening_message = 'On réduit volontairement : une seule micro-action, sans pression.';
    nextProfile.break_message = 'Pause obligatoire. Bois, respire, relâche les épaules avant la suite.';
    nextProfile.regulation = buildFocusRegulationProfile({
      mode: 'gentle_focus',
      risk: riskLevel === 'critical' ? 'critical_overload' : 'overload',
      guidanceStyle: 'regulation_first',
      breakStrategy: 'mandatory_recovery_break',
      frictionLevel: 'very_low',
      recoveryNeeded: true,
      pressureLevel: 'very_low',
      interventionIntensity: 'high',
    });
    applied = true;
    appliedRules.push('reduce_load_from_predictive_risk');
  } else if (shouldProtectFromHyperfocus) {
    nextProfile.mode = completionRate < 0.5 ? 'gentle_focus' : 'standard_focus';
    nextProfile.mode_label = getFocusModeLabel(nextProfile.mode);
    nextProfile.focus_duration_min = Math.min(Number(nextProfile.focus_duration_min || 25), completionRate < 0.5 ? 15 : 25);
    nextProfile.break_duration_min = Math.max(Number(nextProfile.break_duration_min || 5), 8);
    nextProfile.cycles_recommended = 1;
    nextProfile.tone = 'structured';
    nextProfile.reason = 'Nyra détecte une forte activation utile : focus possible, mais cadré pour éviter l’hyperfocus.';
    nextProfile.opening_message = 'Tu peux avancer, mais sur une seule priorité et avec une pause obligatoire.';
    nextProfile.break_message = 'Pause obligatoire. Même si tu veux continuer, Nyra protège ton énergie.';
    nextProfile.regulation = buildFocusRegulationProfile({
      mode: nextProfile.mode,
      risk: 'hyperfocus',
      guidanceStyle: 'structured_execution',
      breakStrategy: 'mandatory_micro_breaks',
      frictionLevel: completionRate < 0.5 ? 'low' : 'medium',
      recoveryNeeded: shouldSuggestRecovery,
      microBreakEveryMin: 15,
      pressureLevel: 'medium',
      interventionIntensity: 'normal',
    });
    applied = true;
    appliedRules.push('hyperfocus_guardrail_from_proactive_v2');
  } else if (shouldSuggestRecovery || adaptiveFocusStrategy.mode === 'recovery_focus') {
    nextProfile.mode = 'recovery_focus';
    nextProfile.mode_label = getFocusModeLabel(nextProfile.mode);
    nextProfile.focus_duration_min = Math.min(Number(nextProfile.focus_duration_min || 25), 12);
    nextProfile.break_duration_min = Math.max(Number(nextProfile.break_duration_min || 5), 7);
    nextProfile.cycles_recommended = 1;
    nextProfile.tone = 'soft';
    nextProfile.reason = 'Nyra propose une reprise douce pour garder l’élan sans tirer sur le système.';
    nextProfile.opening_message = 'On garde l’élan, mais sans forcer : une micro-action suffit.';
    nextProfile.break_message = 'Pause douce. On récupère avant de relancer.';
    nextProfile.regulation = buildFocusRegulationProfile({
      mode: 'recovery_focus',
      risk: 'recovery_needed',
      guidanceStyle: 'micro_start',
      breakStrategy: 'long_recovery_break',
      frictionLevel: 'very_low',
      recoveryNeeded: true,
      pressureLevel: 'very_low',
      interventionIntensity: 'gentle',
    });
    applied = true;
    appliedRules.push('recovery_from_predictive_risk');
  }

  if (!shouldReduceLoad && durationBias === 'shorter') {
    nextProfile.focus_duration_min = Math.min(Number(nextProfile.focus_duration_min || 25), 15);
    nextProfile.break_duration_min = Math.max(Number(nextProfile.break_duration_min || 5), 7);
    applied = true;
    appliedRules.push('shorter_cycles_from_history');
  }

  if (!shouldReduceLoad && durationBias === 'capped') {
    nextProfile.focus_duration_min = Math.min(Number(nextProfile.focus_duration_min || 25), 25);
    applied = true;
    appliedRules.push('duration_capped_from_history');
  }

  if (shouldForceBreak) {
    nextProfile.break_duration_min = Math.max(Number(nextProfile.break_duration_min || 5), 7);
    nextProfile.regulation = {
      ...(nextProfile.regulation || buildFocusRegulationProfile({ mode: nextProfile.mode })),
      break_strategy: 'mandatory_micro_breaks',
      micro_break_every_min: nextProfile.regulation?.micro_break_every_min || 15,
    };
    applied = true;
    appliedRules.push('mandatory_break_from_proactive_v2');
  }

  nextProfile.focus_duration_min = clampNumber(nextProfile.focus_duration_min, 5, 45);
  nextProfile.break_duration_min = clampNumber(nextProfile.break_duration_min, 3, 15);
  nextProfile.mode_label = getFocusModeLabel(nextProfile.mode);

  return {
    profile: nextProfile,
    applied,
    applied_rules: uniqueArray(appliedRules),
    primary_intervention: primaryIntervention,
  };
}

function buildFocusRecommendation(store, userId) {
  const decisionContext = buildFocusDecisionContextForRecommendation(store, userId);
  const latestUserState = decisionContext.latestUserState;
  const adaptiveProfile = decisionContext.adaptiveProfile;

  const adaptiveProfileProfile = applyAdaptiveProfileToFocusRecommendation(
    recommendFocusProfile(latestUserState),
    adaptiveProfile,
    latestUserState
  );

  const proactiveFocus = applyProactiveAssistantToFocusRecommendation(
    adaptiveProfileProfile,
    decisionContext
  );

  const profile = proactiveFocus.profile;
  const structure = buildFocusStructure(profile, latestUserState, adaptiveProfile);

  if (proactiveFocus.primary_intervention?.user_facing?.next_step) {
    structure.unshift(proactiveFocus.primary_intervention.user_facing.next_step);
  }

  const recommendation = {
    mode: profile.mode,
    focus_minutes: profile.focus_duration_min,
    break_minutes: profile.break_duration_min,
    tone: profile.tone,
    reason: profile.reason,
    message: profile.opening_message,
    structure: uniqueArray(structure).slice(0, 6),
    cycles_recommended: profile.cycles_recommended,
    mode_label: getFocusModeLabel(profile.mode),
    focus_mode: profile.mode,
    recommended_duration: profile.focus_duration_min,
    break_strategy: profile.regulation?.break_strategy || 'standard_break',
    risk: profile.regulation?.risk || 'normal',
    guidance_style: profile.regulation?.guidance_style || 'balanced_guidance',
    friction_level: profile.regulation?.friction_level || 'medium',
    recovery_needed: Boolean(profile.regulation?.recovery_needed),
    micro_break_every_min: profile.regulation?.micro_break_every_min || null,
    pressure_level: profile.regulation?.pressure_level || 'medium',
    intervention_intensity: profile.regulation?.intervention_intensity || 'normal',
    regulation: profile.regulation || buildFocusRegulationProfile({ mode: profile.mode }),
    adaptive_profile_applied: true,
    proactive_assistant_v2_applied: proactiveFocus.applied,
    proactive_applied_rules: proactiveFocus.applied_rules,
    proactive_primary_intervention: proactiveFocus.primary_intervention,
    proactive_user_facing: decisionContext.proactiveAssistantV2?.user_facing || null,
    cognitive_history_user_facing: decisionContext.cognitiveHistoryUserFacing,
    predictive_risk: decisionContext.predictiveRisk,
    adaptive_focus_strategy: decisionContext.adaptiveFocusStrategy,
    should_force_break: Boolean(decisionContext.adaptiveFocusStrategy?.should_force_break),
    should_reduce_load: Boolean(decisionContext.adaptiveFocusStrategy?.should_reduce_load || decisionContext.predictiveRisk?.should_reduce_load),
    should_protect_from_hyperfocus: Boolean(decisionContext.adaptiveFocusStrategy?.should_protect_from_hyperfocus),
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
    cognitive_history_user_facing: decisionContext.cognitiveHistoryUserFacing,
    proactive_assistant_v2: decisionContext.proactiveAssistantV2,
    proactive_assistant_user_facing: decisionContext.proactiveAssistantV2?.user_facing || null,
    predictive_risk: decisionContext.predictiveRisk,
    adaptive_focus_strategy: decisionContext.adaptiveFocusStrategy,
    wording_note: 'Côté utilisateur, utiliser “points d’état”, “historique cognitif” ou “évolution”, jamais “snapshots”.',
  };
}


function applyAdaptiveProfileToFocusRecommendation(profile, adaptiveProfile, userState) {
  if (!adaptiveProfile) return profile;

  const nextProfile = {
    ...profile,
    regulation: profile.regulation || buildFocusRegulationProfile({ mode: profile.mode }),
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
    nextProfile.regulation = buildFocusRegulationProfile({
      mode: 'gentle_focus',
      risk: 'overload',
      guidanceStyle: 'low_pressure_guidance',
      breakStrategy: 'mandatory_recovery_break',
      frictionLevel: 'low',
      recoveryNeeded: true,
      pressureLevel: 'low',
      interventionIntensity: 'medium',
    });
  }

  if (completionRate > 0 && completionRate < 0.45) {
    nextProfile.mode = 'gentle_focus';
    nextProfile.focus_duration_min = Math.min(Number(nextProfile.focus_duration_min || 25), 15);
    nextProfile.reason = 'Nyra adapte la session : les cycles courts semblent plus réalistes pour toi en ce moment.';
    nextProfile.opening_message = 'Objectif réduit : juste commencer, sans te mettre en échec.';
    nextProfile.regulation = buildFocusRegulationProfile({
      mode: 'gentle_focus',
      risk: 'execution_friction',
      guidanceStyle: 'micro_start',
      breakStrategy: 'short_cycle_break',
      frictionLevel: 'very_low',
      recoveryNeeded: false,
      pressureLevel: 'low',
      interventionIntensity: 'gentle',
    });
  }

  if (preferredDuration >= 40 && currentOverwhelm < 50 && completionRate >= 0.65) {
    nextProfile.mode = 'deep_focus';
    nextProfile.focus_duration_min = preferredDuration;
    nextProfile.break_duration_min = Math.max(Number(nextProfile.break_duration_min || 5), 10);
    nextProfile.reason = 'Nyra adapte la session : ton profil semble tolérer les sessions profondes.';
    nextProfile.opening_message = 'Tu peux viser une session plus profonde, mais sans multiplier les objectifs.';
    nextProfile.regulation = buildFocusRegulationProfile({
      mode: 'deep_focus',
      risk: 'hyperfocus',
      guidanceStyle: 'structured_execution',
      breakStrategy: 'mandatory_micro_breaks',
      frictionLevel: 'medium',
      recoveryNeeded: false,
      microBreakEveryMin: 15,
      pressureLevel: 'medium',
      interventionIntensity: 'normal',
    });
  }

  nextProfile.mode_label = getFocusModeLabel(nextProfile.mode);

  return nextProfile;
}

function buildFocusStructure(profile, userState, adaptiveProfile = null) {
  const structure = [];
  const regulation = profile.regulation || buildFocusRegulationProfile({ mode: profile.mode });
  const cognitiveLoad = normalizeText(userState?.cognitive_load || '');
  const cognitiveActivation = normalizeText(userState?.cognitive_activation || '');
  const cognitiveDistress = normalizeText(userState?.cognitive_distress || '');
  const activationScore = Number(userState?.activation_score || 0);
  const distressScore = Number(userState?.distress_score || 0);

  if (regulation.recovery_needed || cognitiveDistress === 'high' || cognitiveDistress === 'very_high' || distressScore >= 55) {
    structure.push('Réduire la session à une seule micro-action.');
    structure.push('Respirer et relâcher la pression avant de commencer.');
    structure.push('S’arrêter dès que le timer indique la pause.');
  } else if (profile.mode === 'recovery_focus') {
    structure.push('Commencer par une micro-action visible.');
    structure.push('Avancer doucement, sans pression de performance.');
    structure.push('Faire une pause longue pour récupérer.');
  } else if (profile.mode === 'deep_focus' && regulation.risk === 'hyperfocus') {
    structure.push('Choisir une seule priorité profonde.');
    structure.push('Couper les distractions visibles.');
    structure.push('Faire une micro-pause obligatoire toutes les 15 minutes.');
    structure.push('Arrêter au timer même si le cerveau veut continuer.');
  } else if (profile.mode === 'deep_focus') {
    structure.push('Bloquer une tâche importante.');
    structure.push('Éliminer les distractions visibles.');
    structure.push('Avancer en profondeur jusqu’à la pause.');
  } else {
    structure.push('Choisir une priorité claire.');
    structure.push('Faire 25 minutes de focus.');
    structure.push('Prendre 5 minutes de pause réelle.');
  }

  if (cognitiveLoad === 'very_high' || cognitiveLoad === 'high') {
    structure.unshift('Réduire la session à l’essentiel.');
  }

  if (cognitiveActivation === 'very_high' || activationScore >= 75) {
    structure.push('Canaliser l’intensité sans ajouter de nouvelle tâche.');
  }

  if (adaptiveProfile?.learned_patterns?.length) {
    const firstPattern = adaptiveProfile.learned_patterns[0];

    if (firstPattern?.label) {
      structure.push(`Profil appris : ${firstPattern.label}`);
    }
  }

  return uniqueArray(structure).slice(0, 5);
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

// ------------------------------
// Proactive Assistant V2
// ------------------------------

function buildProactiveV2Intervention({ id, priority, type, title, message, recommendation, trigger, action, tone, userFacing }) {
  return {
    id,
    priority: priority || 'medium',
    type: type || 'guidance',
    title,
    message,
    recommendation,
    trigger: trigger || null,
    action: action || null,
    tone: tone || 'supportive',
    user_facing: userFacing || {
      title,
      message,
      next_step: recommendation,
    },
    created_at: nowIso(),
  };
}

function getHighestProactivePriority(interventions) {
  const priorityOrder = ['critical', 'high', 'medium', 'low', 'positive'];
  const found = priorityOrder.find(priority => interventions.some(item => item.priority === priority));
  return found || 'low';
}

function deriveProactiveV2Mode({ predictiveRisk, adaptiveFocusStrategy, latestUserState }) {
  const riskLevel = normalizeText(predictiveRisk?.level || 'low');
  const strategyMode = normalizeText(adaptiveFocusStrategy?.mode || 'steady_support');
  const dominantMode = normalizeText(latestUserState?.dominant_mode || '');
  const energyLevel = normalizeText(latestUserState?.energy_level || '');
  const distressScore = Number(latestUserState?.distress_score || 0);

  if (riskLevel === 'critical' || predictiveRisk?.should_interrupt) return 'protective_intervention';
  if (riskLevel === 'high' || predictiveRisk?.should_reduce_load) return 'reduce_load';
  if (energyLevel === 'low' || dominantMode === 'recovery' || distressScore >= 55) return 'recovery_support';
  if (strategyMode === 'structured_execution') return 'structured_execution';
  if (strategyMode === 'progressive_recovery') return 'progressive_recovery';
  return 'steady_guidance';
}

function getFrenchProactiveModeLabel(mode) {
  if (mode === 'protective_intervention') return 'Intervention protectrice';
  if (mode === 'reduce_load') return 'Réduction de charge';
  if (mode === 'recovery_support') return 'Soutien récupération';
  if (mode === 'structured_execution') return 'Exécution cadrée';
  if (mode === 'progressive_recovery') return 'Reprise progressive';
  return 'Guidage stable';
}

function buildProactiveV2Interventions({ latestUserState, adaptiveProfile, proactivePayload, cognitiveHistory, predictiveRisk, adaptiveFocusStrategy }) {
  const interventions = [];
  const latest = latestUserState || {};
  const historySummary = cognitiveHistory?.summary || {};
  const currentSignals = latest.active_signals || {};
  const activationScore = Number(latest.activation_score || historySummary.latest_activation_score || 0);
  const distressScore = Number(latest.distress_score || historySummary.latest_distress_score || 0);
  const overwhelmScore = Number(latest.overwhelm_score || historySummary.latest_overwhelm_score || 0);
  const completionRate = Number(adaptiveProfile?.average_completion_rate || 0);
  const proactiveSignals = Array.isArray(proactivePayload?.signals) ? proactivePayload.signals : [];

  if (predictiveRisk?.should_interrupt || predictiveRisk?.level === 'critical') {
    interventions.push(buildProactiveV2Intervention({
      id: 'protective_pause_now',
      priority: 'critical',
      type: 'regulation',
      title: 'Pause protectrice recommandée',
      message: 'Nyra détecte un risque élevé de surcharge. Il vaut mieux réduire la pression maintenant.',
      recommendation: 'Faire une pause corporelle courte avant toute nouvelle action.',
      trigger: 'predictive_risk_critical',
      action: 'start_regulation_pause',
      tone: 'protective',
      userFacing: {
        title: 'Pause protectrice',
        message: 'Ton système semble proche de la surcharge. On baisse la pression.',
        next_step: 'Bois un peu, respire, puis reviens à une seule micro-action.',
      },
    }));
  }

  if (predictiveRisk?.should_reduce_load || predictiveRisk?.level === 'high') {
    interventions.push(buildProactiveV2Intervention({
      id: 'reduce_visible_load',
      priority: 'high',
      type: 'load_reduction',
      title: 'Réduire la charge visible',
      message: 'L’historique cognitif indique qu’ajouter des objectifs peut augmenter la surcharge.',
      recommendation: 'Limiter l’écran à une priorité et masquer le reste temporairement.',
      trigger: 'history_risk_high',
      action: 'reduce_visible_actions',
      tone: 'calm',
      userFacing: {
        title: 'On réduit la charge',
        message: 'Nyra te propose de ne garder qu’une priorité visible.',
        next_step: 'Choisir une seule action pour les prochaines minutes.',
      },
    }));
  }

  if (adaptiveFocusStrategy?.should_protect_from_hyperfocus || (activationScore >= 85 && distressScore < 35)) {
    interventions.push(buildProactiveV2Intervention({
      id: 'hyperfocus_guardrail',
      priority: 'medium',
      type: 'hyperfocus_protection',
      title: 'Garde-fou anti-hyperfocus',
      message: 'Ton activation est forte et utile, mais Nyra doit protéger ton énergie.',
      recommendation: 'Avancer avec un timer cadré et une pause obligatoire.',
      trigger: 'high_activation_low_distress',
      action: 'force_break_after_focus',
      tone: 'structured',
      userFacing: {
        title: 'Focus oui, mais cadré',
        message: 'Tu peux avancer, mais Nyra garde une pause obligatoire pour éviter l’hyperfocus destructeur.',
        next_step: 'Lancer une session cadrée sans ouvrir de nouveau sujet.',
      },
    }));
  }

  if (predictiveRisk?.should_suggest_recovery || latest.energy_level === 'low' || latest.dominant_mode === 'recovery') {
    interventions.push(buildProactiveV2Intervention({
      id: 'recovery_micro_action',
      priority: predictiveRisk?.level === 'moderate' ? 'medium' : 'low',
      type: 'recovery',
      title: 'Récupération active douce',
      message: 'Nyra détecte qu’une récupération courte peut aider à garder l’élan sans forcer.',
      recommendation: 'Proposer une micro-action ou une pause de régulation.',
      trigger: 'recovery_needed_or_moderate_risk',
      action: 'suggest_recovery_or_micro_action',
      tone: 'gentle',
      userFacing: {
        title: 'Récupération douce',
        message: 'On garde l’élan sans tirer sur le système.',
        next_step: 'Faire une micro-action simple ou une courte pause physique.',
      },
    }));
  }

  if (completionRate > 0 && completionRate < 0.5) {
    interventions.push(buildProactiveV2Intervention({
      id: 'shorter_cycles_due_to_completion_rate',
      priority: 'medium',
      type: 'execution_adaptation',
      title: 'Cycles plus courts conseillés',
      message: 'Les sessions longues semblent moins fiables récemment.',
      recommendation: 'Réduire temporairement la durée des sessions et clarifier la première étape.',
      trigger: 'adaptive_profile_completion_rate_low',
      action: 'shorten_focus_cycle',
      tone: 'practical',
      userFacing: {
        title: 'Cycles plus courts',
        message: 'Nyra adapte le rythme : mieux vaut finir petit que bloquer grand.',
        next_step: 'Commencer par un bloc court et très clair.',
      },
    }));
  }

  const repeatedFocusFailures = proactiveSignals.find(signal => signal.id === 'repeated_focus_failures');

  if (repeatedFocusFailures) {
    interventions.push(buildProactiveV2Intervention({
      id: 'focus_failure_recovery_plan',
      priority: 'medium',
      type: 'focus_recovery',
      title: 'Plan de relance focus',
      message: 'Nyra détecte plusieurs interruptions ou échecs de focus récents.',
      recommendation: 'Réduire l’objectif, clarifier le début, puis relancer doucement.',
      trigger: 'repeated_focus_failures',
      action: 'offer_focus_recovery_plan',
      tone: 'non_judgmental',
      userFacing: {
        title: 'Relance douce',
        message: 'Ce n’est pas un échec : Nyra réduit la marche pour relancer le mouvement.',
        next_step: 'Choisir une tâche minuscule et relancer un cycle court.',
      },
    }));
  }

  if (overwhelmScore < 45 && activationScore >= 70 && currentSignals.open_actions <= 2) {
    interventions.push(buildProactiveV2Intervention({
      id: 'single_priority_momentum',
      priority: 'positive',
      type: 'momentum',
      title: 'Momentum disponible',
      message: 'Nyra détecte une bonne fenêtre d’exécution si la priorité reste unique.',
      recommendation: 'Utiliser l’élan actuel sans ajouter de nouveau sujet.',
      trigger: 'low_overwhelm_high_activation',
      action: 'continue_single_priority',
      tone: 'encouraging',
      userFacing: {
        title: 'Bon moment pour avancer',
        message: 'Tu as de l’élan. Le piège serait d’ouvrir trop de sujets.',
        next_step: 'Garder une seule priorité et avancer dessus maintenant.',
      },
    }));
  }

  const uniqueIds = [];
  return interventions.filter(intervention => {
    if (uniqueIds.includes(intervention.id)) return false;
    uniqueIds.push(intervention.id);
    return true;
  });
}

function buildProactiveV2UserFacing({ mode, priorityLevel, interventions, cognitiveHistoryUserFacing }) {
  const primary = interventions[0] || null;
  const historyHeadline = cognitiveHistoryUserFacing?.headline || '';

  return {
    title: 'Assistant proactif',
    mode_label: getFrenchProactiveModeLabel(mode),
    priority_label:
      priorityLevel === 'critical'
        ? 'Priorité critique'
        : priorityLevel === 'high'
          ? 'Priorité élevée'
          : priorityLevel === 'medium'
            ? 'Priorité moyenne'
            : priorityLevel === 'positive'
              ? 'Signal positif'
              : 'Priorité basse',
    headline: primary?.user_facing?.message || historyHeadline || 'Nyra adapte son accompagnement à ton état actuel.',
    primary_title: primary?.user_facing?.title || 'Guidage Nyra',
    next_best_action: primary?.user_facing?.next_step || 'Continuer avec une seule priorité claire.',
    intervention_count: interventions.length,
    public_terms: {
      history: 'historique cognitif',
      state_point: 'point d’état',
      trend: 'évolution',
      prediction: 'anticipation',
    },
  };
}

function buildProactiveAssistantV2Payload({ userId, latestUserState, adaptiveProfile, proactivePayload, cognitiveHistory, cognitiveHistoryUserFacing, predictiveRisk, adaptiveFocusStrategy }) {
  const mode = deriveProactiveV2Mode({
    predictiveRisk,
    adaptiveFocusStrategy,
    latestUserState,
  });

  const interventions = buildProactiveV2Interventions({
    latestUserState,
    adaptiveProfile,
    proactivePayload,
    cognitiveHistory,
    predictiveRisk,
    adaptiveFocusStrategy,
  });

  const priorityLevel = getHighestProactivePriority(interventions);
  const primaryIntervention = interventions[0] || null;

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    engine_version: 'proactive-assistant-v2',
    generated_at: nowIso(),
    mode,
    mode_label: getFrenchProactiveModeLabel(mode),
    priority_level: priorityLevel,
    primary_intervention: primaryIntervention,
    interventions,
    intervention_count: interventions.length,
    user_facing: buildProactiveV2UserFacing({
      mode,
      priorityLevel,
      interventions,
      cognitiveHistoryUserFacing,
    }),
    recommended_actions: interventions.map(intervention => ({
      id: intervention.id,
      action: intervention.action,
      priority: intervention.priority,
      label: intervention.user_facing?.title || intervention.title,
      next_step: intervention.user_facing?.next_step || intervention.recommendation,
    })),
    decision_context: {
      cognitive_load: latestUserState?.cognitive_load || null,
      cognitive_activation: latestUserState?.cognitive_activation || null,
      cognitive_distress: latestUserState?.cognitive_distress || null,
      energy_level: latestUserState?.energy_level || null,
      focus_state: latestUserState?.focus_state || null,
      dominant_mode: latestUserState?.dominant_mode || null,
      overwhelm_score: latestUserState?.overwhelm_score ?? null,
      activation_score: latestUserState?.activation_score ?? null,
      distress_score: latestUserState?.distress_score ?? null,
      burn_risk_level: predictiveRisk?.level || null,
      burn_risk_score: predictiveRisk?.score ?? null,
      adaptive_focus_mode: adaptiveFocusStrategy?.mode || null,
      should_force_break: Boolean(adaptiveFocusStrategy?.should_force_break),
      should_reduce_load: Boolean(adaptiveFocusStrategy?.should_reduce_load || predictiveRisk?.should_reduce_load),
      should_suggest_recovery: Boolean(predictiveRisk?.should_suggest_recovery),
    },
    safety_rules: {
      never_add_pressure_when_high_risk: true,
      prefer_micro_action_when_overloaded: true,
      force_break_when_hyperfocus_risk: Boolean(adaptiveFocusStrategy?.should_protect_from_hyperfocus),
      do_not_use_word_snapshot_for_user: true,
    },
  };
}

function saveProactiveAssistantV2Payload(store, payload) {
  store.proactive_assistant_v2_events = Array.isArray(store.proactive_assistant_v2_events)
    ? store.proactive_assistant_v2_events
    : [];

  store.proactive_assistant_v2_events.push(payload);
  store.proactive_assistant_v2_events = store.proactive_assistant_v2_events.slice(-500);

  return payload;
}

function getRecentProactiveAssistantV2Events(store, userId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

  return (Array.isArray(store.proactive_assistant_v2_events) ? store.proactive_assistant_v2_events : [])
    .filter(event => event.user_id === userId)
    .sort((a, b) => {
      return new Date(b.generated_at || 0).getTime() -
        new Date(a.generated_at || 0).getTime();
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



function getPrioritySourceItems(store, userId) {
  const memoryItems = Array.isArray(store.items)
    ? store.items
        .filter(item => {
          const status = normalizeText(item.status || '').toLowerCase();

          return (
            item.user_id === userId &&
            ['tasks', 'today', 'plans', 'reminders', 'inbox', 'projects'].includes(item.bucket || '') &&
            !['done', 'completed', 'complete', 'cancelled', 'canceled'].includes(status)
          );
        })
        .slice(-80)
    : [];

  const actionItems = Array.isArray(store.actions)
    ? store.actions
        .filter(action => {
          return (
            action.user_id === userId &&
            ['suggested', 'draft', 'executing', 'failed'].includes(
              normalizeActionStatus(action.status || 'suggested')
            )
          );
        })
        .slice(-80)
    : [];

  const mappedActions = actionItems.map(action => ({
    id: action.id,
    user_id: action.user_id,
    type: action.action_type || action.type || 'action',
    bucket: actionToBucket(action.action_type || action.type || 'actions'),
    title: action.title || action.label || 'Action Nyra',
    content: action.target || action.source_message || action.title || '',
    priority: action.priority || 'normal',
    urgency: action.priority === 'high' ? 'high' : 'normal',
    status: action.status || 'suggested',
    project_id: action.project_id || null,
    project_name: action.project_name || null,
    source: 'action',
    created_at: action.created_at || null,
    updated_at: action.updated_at || null,
  }));

  return [...memoryItems, ...mappedActions];
}

function buildPriorityPayload(store, userId) {
  const latestUserState = getLatestUserState(store, userId) || saveUserStateSnapshot(store, userId);
  const items = getPrioritySourceItems(store, userId);

  const analysis = analyzePriorities({
    items,
    cognitiveState: latestUserState,
  });

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    ...analysis,
    cognitive_state: latestUserState,
    source_snapshot: {
      item_count: items.length,
      analyzed_item_count: analysis.analyzed_items.length,
      deduplicated_item_count: analysis.deduplication?.deduplicated_item_count ?? null,
      removed_duplicate_count: analysis.deduplication?.removed_duplicate_count ?? null,
      ignored_completed_count: analysis.deduplication?.ignored_completed_count ?? null,
      overwhelm_score: latestUserState?.overwhelm_score ?? null,
      activation_score: latestUserState?.activation_score ?? null,
      distress_score: latestUserState?.distress_score ?? null,
      cognitive_load: latestUserState?.cognitive_load || null,
      cognitive_activation: latestUserState?.cognitive_activation || null,
      cognitive_distress: latestUserState?.cognitive_distress || null,
      energy_level: latestUserState?.energy_level || null,
      focus_state: latestUserState?.focus_state || null,
    },
    generated_at: nowIso(),
  };
}

function savePriorityPayload(store, payload) {
  store.cognitive_priority_snapshots = Array.isArray(store.cognitive_priority_snapshots)
    ? store.cognitive_priority_snapshots
    : [];

  store.cognitive_priority_snapshots.push(payload);
  store.cognitive_priority_snapshots = store.cognitive_priority_snapshots.slice(-500);

  return payload;
}

function getRecentPrioritySnapshots(store, userId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

  return (Array.isArray(store.cognitive_priority_snapshots) ? store.cognitive_priority_snapshots : [])
    .filter(snapshot => snapshot.user_id === userId)
    .sort((a, b) => {
      return new Date(b.generated_at || 0).getTime() -
        new Date(a.generated_at || 0).getTime();
    })
    .slice(0, safeLimit);
}


app.get('/priority/analyze', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const persist = normalizeText(req.query?.persist || 'true') !== 'false';
  const store = readStore();

  const payload = buildPriorityPayload(store, userId);

  if (persist) {
    savePriorityPayload(store, payload);
    writeStore(store);
  }

  return res.json({
    ok: true,
    userId,
    ...payload,
  });
});

app.post('/priority/recompute', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const store = readStore();

  const payload = buildPriorityPayload(store, userId);
  savePriorityPayload(store, payload);
  writeStore(store);

  return res.json({
    ok: true,
    userId,
    ...payload,
    message: 'Priorités cognitives recalculées.',
  });
});

app.get('/priority/history', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 20), 100));
  const store = readStore();

  const snapshots = getRecentPrioritySnapshots(store, userId, limit);

  return res.json({
    ok: true,
    userId,
    count: snapshots.length,
    snapshots,
  });
});

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



app.get('/proactive/v2', (req, res) => {
  try {
    const userId = normalizeText(req.query?.userId || 'local-user');
    const persist = normalizeText(req.query?.persist || 'true') !== 'false';
    const historyLimit = Math.max(1, Math.min(Number(req.query?.historyLimit || 60), 120));
    const store = readStore();

    const latestUserState = getLatestUserState(store, userId) || saveUserStateSnapshot(store, userId);
    const adaptiveProfile = getOrCreateAdaptiveProfile(store, userId);
    const proactivePayload = buildProactivePayload(store, userId);
    const cognitiveHistoryV2 = buildCognitiveHistoryV2Analysis(store, userId, historyLimit);
    const cognitiveHistoryUserFacing = buildCognitiveHistoryUserFacingSummary(cognitiveHistoryV2);
    const predictiveRisk = buildPredictiveRiskFromCognitiveHistory(cognitiveHistoryV2);
    const adaptiveFocusStrategy = buildAdaptiveFocusStrategyFromCognitiveHistory(cognitiveHistoryV2);

    const proactiveAssistantV2 = buildProactiveAssistantV2Payload({
      userId,
      latestUserState,
      adaptiveProfile,
      proactivePayload,
      cognitiveHistory: cognitiveHistoryV2,
      cognitiveHistoryUserFacing,
      predictiveRisk,
      adaptiveFocusStrategy,
    });

    if (persist) {
      saveProactivePayload(store, proactivePayload);
      saveCognitiveHistoryAnalysis(store, cognitiveHistoryV2);
      saveProactiveAssistantV2Payload(store, proactiveAssistantV2);
      writeStore(store);
    }

    return res.json({
      ok: true,
      userId,
      proactive_assistant_v2: proactiveAssistantV2,
      user_facing: proactiveAssistantV2.user_facing,
      interventions: proactiveAssistantV2.interventions,
      recommended_actions: proactiveAssistantV2.recommended_actions,
      predictive_risk: predictiveRisk,
      adaptive_focus_strategy: adaptiveFocusStrategy,
      cognitive_history_user_facing: cognitiveHistoryUserFacing,
      persisted: persist,
    });
  } catch (error) {
    console.error('❌ /proactive/v2 error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur assistant proactif V2 Nyra',
      details: error.message,
    });
  }
});

app.post('/proactive/v2/check', (req, res) => {
  try {
    const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
    const historyLimit = Math.max(1, Math.min(Number(req.body?.historyLimit || req.query?.historyLimit || 60), 120));
    const store = readStore();

    const latestUserState = getLatestUserState(store, userId) || saveUserStateSnapshot(store, userId);
    const adaptiveProfile = getOrCreateAdaptiveProfile(store, userId);
    const proactivePayload = buildProactivePayload(store, userId);
    const cognitiveHistoryV2 = buildCognitiveHistoryV2Analysis(store, userId, historyLimit);
    const cognitiveHistoryUserFacing = buildCognitiveHistoryUserFacingSummary(cognitiveHistoryV2);
    const predictiveRisk = buildPredictiveRiskFromCognitiveHistory(cognitiveHistoryV2);
    const adaptiveFocusStrategy = buildAdaptiveFocusStrategyFromCognitiveHistory(cognitiveHistoryV2);

    const proactiveAssistantV2 = buildProactiveAssistantV2Payload({
      userId,
      latestUserState,
      adaptiveProfile,
      proactivePayload,
      cognitiveHistory: cognitiveHistoryV2,
      cognitiveHistoryUserFacing,
      predictiveRisk,
      adaptiveFocusStrategy,
    });

    saveProactivePayload(store, proactivePayload);
    saveCognitiveHistoryAnalysis(store, cognitiveHistoryV2);
    saveProactiveAssistantV2Payload(store, proactiveAssistantV2);
    writeStore(store);

    return res.json({
      ok: true,
      userId,
      proactive_assistant_v2: proactiveAssistantV2,
      user_facing: proactiveAssistantV2.user_facing,
      interventions: proactiveAssistantV2.interventions,
      recommended_actions: proactiveAssistantV2.recommended_actions,
      message: 'Assistant proactif V2 recalculé.',
    });
  } catch (error) {
    console.error('❌ /proactive/v2/check error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur recalcul assistant proactif V2 Nyra',
      details: error.message,
    });
  }
});

app.get('/proactive/v2/history', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 20), 100));
  const store = readStore();
  const events = getRecentProactiveAssistantV2Events(store, userId, limit);

  return res.json({
    ok: true,
    userId,
    count: events.length,
    events,
  });
});

app.get('/cognitive/orchestration', (req, res) => {
  try {
    const userId = normalizeText(req.query?.userId || 'local-user');
    const persist = normalizeText(req.query?.persist || 'true') !== 'false';
    const historyLimit = Math.max(1, Math.min(Number(req.query?.historyLimit || 60), 120));
    const store = readStore();

    const latestUserState = getLatestUserState(store, userId) || saveUserStateSnapshot(store, userId);
    const adaptiveProfile = getOrCreateAdaptiveProfile(store, userId);
    const proactivePayload = buildProactivePayload(store, userId);
    const cognitiveHistoryV2 = buildCognitiveHistoryV2Analysis(store, userId, historyLimit);
    const cognitiveHistoryUserFacing = buildCognitiveHistoryUserFacingSummary(cognitiveHistoryV2);
    const predictiveRisk = buildPredictiveRiskFromCognitiveHistory(cognitiveHistoryV2);
    const adaptiveFocusStrategy = buildAdaptiveFocusStrategyFromCognitiveHistory(cognitiveHistoryV2);
    const recommendedRegulationLevel = deriveRecommendedRegulationLevel({
      predictiveRisk,
      adaptiveFocusStrategy,
    });
    const proactiveAssistantV2 = buildProactiveAssistantV2Payload({
      userId,
      latestUserState,
      adaptiveProfile,
      proactivePayload,
      cognitiveHistory: cognitiveHistoryV2,
      cognitiveHistoryUserFacing,
      predictiveRisk,
      adaptiveFocusStrategy,
    });

    if (persist) {
      saveProactivePayload(store, proactivePayload);
      saveCognitiveHistoryAnalysis(store, cognitiveHistoryV2);
      saveProactiveAssistantV2Payload(store, proactiveAssistantV2);
    }

    const focusSessions = Array.isArray(store.focus_sessions)
      ? store.focus_sessions
          .filter(session => session.user_id === userId)
          .slice(-50)
      : [];

    const actions = Array.isArray(store.actions)
      ? store.actions
          .filter(action => action.user_id === userId)
          .slice(-100)
      : [];

    const orchestration = buildNyraCognitiveOrchestration({
      userId,
      latestUserState,
      adaptiveProfile,
      proactiveSignals: proactivePayload.signals || [],
      focusSessions,
      actions,
      source: 'backend_endpoint',
    });

    const enrichedOrchestration = {
      ...orchestration,
      cognitive_history: {
        engine_version: cognitiveHistoryV2.engine_version,
        generated_at: cognitiveHistoryV2.generated_at,
        summary: cognitiveHistoryV2.summary,
        user_facing: cognitiveHistoryUserFacing,
        insights: cognitiveHistoryV2.insights || [],
        cycles: cognitiveHistoryV2.cycles || [],
        recovery_patterns: cognitiveHistoryV2.recovery_patterns || [],
        activation_patterns: cognitiveHistoryV2.activation_patterns || [],
        predictions: cognitiveHistoryV2.predictions || [],
      },
      predictive_risk: predictiveRisk,
      adaptive_focus_strategy: adaptiveFocusStrategy,
      recommended_regulation_level: recommendedRegulationLevel,
      proactive_assistant_v2: proactiveAssistantV2,
    };

    if (persist) {
      writeStore(store);
    }

    return res.json({
      ok: true,
      userId,
      orchestration: enrichedOrchestration,
      proactive_payload: proactivePayload,
      cognitive_history_v2: cognitiveHistoryV2,
      cognitive_history_user_facing: cognitiveHistoryUserFacing,
      predictive_risk: predictiveRisk,
      adaptive_focus_strategy: adaptiveFocusStrategy,
      recommended_regulation_level: recommendedRegulationLevel,
      proactive_assistant_v2: proactiveAssistantV2,
      proactive_assistant_user_facing: proactiveAssistantV2.user_facing,
      wording_note: 'Côté utilisateur, utiliser “points d’état”, “historique cognitif” ou “évolution”, jamais “snapshots”.',
      persisted: persist,
    });
  } catch (error) {
    console.error('❌ /cognitive/orchestration error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur orchestration cognitive Nyra',
      details: error.message,
    });
  }
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



app.get('/state/history-v2', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 60), 120));
  const refresh = normalizeText(req.query?.refresh || '') === 'true';
  const persist = normalizeText(req.query?.persist || 'true') !== 'false';
  const store = readStore();

  if (refresh || !getLatestUserState(store, userId)) {
    saveUserStateSnapshot(store, userId);
  }

  const payload = buildUserStateHistoryV2Payload(store, userId, limit);

  if (persist) {
    saveCognitiveHistoryAnalysis(store, payload.cognitive_history_v2);
    writeStore(store);
  } else if (refresh) {
    writeStore(store);
  }

  return res.json({
    ok: true,
    userId,
    limit,
    ...payload,
    cognitive_history_user_facing: buildCognitiveHistoryUserFacingSummary(payload.cognitive_history_v2),
    persisted: persist,
  });
});

app.get('/history/cognitive-analysis', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 60), 120));
  const persist = normalizeText(req.query?.persist || 'true') !== 'false';
  const store = readStore();

  if (!getLatestUserState(store, userId)) {
    saveUserStateSnapshot(store, userId);
  }

  const analysis = buildCognitiveHistoryV2Analysis(store, userId, limit);

  if (persist) {
    saveCognitiveHistoryAnalysis(store, analysis);
    writeStore(store);
  }

  return res.json({
    ok: true,
    userId,
    analysis,
    cognitive_history_user_facing: buildCognitiveHistoryUserFacingSummary(analysis),
    persisted: persist,
  });
});

app.post('/history/cognitive-analysis/recompute', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.body?.limit || req.query?.limit || 60), 120));
  const store = readStore();

  if (!getLatestUserState(store, userId)) {
    saveUserStateSnapshot(store, userId);
  }

  const analysis = buildCognitiveHistoryV2Analysis(store, userId, limit);
  saveCognitiveHistoryAnalysis(store, analysis);
  writeStore(store);

  return res.json({
    ok: true,
    userId,
    analysis,
    cognitive_history_user_facing: buildCognitiveHistoryUserFacingSummary(analysis),
    message: 'Historique cognitif V2 recalculé.',
  });
});

app.get('/history/cognitive-analysis/history', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 20), 100));
  const store = readStore();
  const analyses = getRecentCognitiveHistoryAnalyses(store, userId, limit);

  return res.json({
    ok: true,
    userId,
    count: analyses.length,
    analyses,
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
    session.regulation = incomingRecommendation.regulation && typeof incomingRecommendation.regulation === 'object'
      ? incomingRecommendation.regulation
      : session.regulation || buildFocusRegulationProfile({ mode: session.mode });
    session.risk = normalizeText(incomingRecommendation.risk || session.regulation?.risk || session.risk || 'normal');
    session.break_strategy = normalizeText(incomingRecommendation.break_strategy || session.regulation?.break_strategy || session.break_strategy || 'standard_break');
    session.guidance_style = normalizeText(incomingRecommendation.guidance_style || session.regulation?.guidance_style || session.guidance_style || 'balanced_guidance');
    session.friction_level = normalizeText(incomingRecommendation.friction_level || session.regulation?.friction_level || session.friction_level || 'medium');
    session.recovery_needed = Boolean(incomingRecommendation.recovery_needed ?? session.regulation?.recovery_needed ?? session.recovery_needed);
    session.micro_break_every_min = incomingRecommendation.micro_break_every_min || session.regulation?.micro_break_every_min || session.micro_break_every_min || null;
    session.pressure_level = normalizeText(incomingRecommendation.pressure_level || session.regulation?.pressure_level || session.pressure_level || 'medium');
    session.intervention_intensity = normalizeText(incomingRecommendation.intervention_intensity || session.regulation?.intervention_intensity || session.intervention_intensity || 'normal');
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
      focus_mode: session.mode,
      recommended_duration: session.focus_duration_min,
      break_strategy: session.break_strategy || session.regulation?.break_strategy || 'standard_break',
      risk: session.risk || session.regulation?.risk || 'normal',
      guidance_style: session.guidance_style || session.regulation?.guidance_style || 'balanced_guidance',
      friction_level: session.friction_level || session.regulation?.friction_level || 'medium',
      recovery_needed: Boolean(session.recovery_needed ?? session.regulation?.recovery_needed),
      micro_break_every_min: session.micro_break_every_min || session.regulation?.micro_break_every_min || null,
      pressure_level: session.pressure_level || session.regulation?.pressure_level || 'medium',
      intervention_intensity: session.intervention_intensity || session.regulation?.intervention_intensity || 'normal',
      regulation: session.regulation || buildFocusRegulationProfile({ mode: session.mode }),
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

  let archivedItems = [];

  if (normalizedStatus === 'done') {
    const linkedItem = result.item || (Array.isArray(store.items)
      ? store.items.find(item => item.id === result.action?.item_id || item.action_id === result.action?.id)
      : null);

    if (linkedItem) {
      archivedItems = completeMatchingOrganizationItems(store, userId, linkedItem);
    }
  }

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    changed: result.changed,
    action: result.action,
    event: result.event,
    linked_item: result.item,
    archived_items: archivedItems,
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


function itemBelongsToUser(item, userId) {
  const normalizedUserId = normalizeText(userId || 'local-user');

  if (!normalizedUserId || normalizedUserId === 'local-user') {
    return true;
  }

  return (
    item.user_id === normalizedUserId ||
    item.legacy_user_id === normalizedUserId ||
    item.google_user_id === normalizedUserId
  );
}

function itemMatchesId(item, itemId) {
  const normalizedItemId = normalizeText(itemId || '');

  if (!normalizedItemId) return false;

  return (
    item.id === normalizedItemId ||
    item.item_id === normalizedItemId ||
    item.stored_item_id === normalizedItemId ||
    item.action_id === normalizedItemId
  );
}

function findUserStoreItem(store, userId, itemId) {
  const normalizedUserId = normalizeText(userId || 'local-user');
  const normalizedItemId = normalizeText(itemId || '');

  if (!normalizedItemId) return null;

  const items = Array.isArray(store.items) ? store.items : [];

  let index = items.findIndex(item => {
    return itemMatchesId(item, normalizedItemId) && itemBelongsToUser(item, normalizedUserId);
  });

  if (index === -1) {
    index = items.findIndex(item => itemMatchesId(item, normalizedItemId));
  }

  if (index === -1) return null;

  return {
    index,
    item: items[index],
  };
}

function isCompletedStatus(status) {
  const normalized = normalizeText(status || '').toLowerCase();

  return ['done', 'completed', 'complete', 'cancelled', 'canceled'].includes(normalized);
}


function getItemUserFacingKey(item) {
  return normalizeKey(
    item?.title ||
    item?.content ||
    item?.target ||
    item?.label ||
    ''
  );
}

function completeAndArchiveItem(store, item, category = null) {
  if (!item) return null;

  item.status = 'done';
  item.checked = true;
  item.checked_at = item.checked_at || nowIso();
  item.completed_at = item.completed_at || nowIso();
  item.updated_at = nowIso();

  return archiveCompletedOrganizationItem(store, item) || item;
}

function completeMatchingOrganizationItems(store, userId, sourceItem) {
  if (!sourceItem) return [];

  const sourceKey = getItemUserFacingKey(sourceItem);
  const sourceActionId = normalizeText(sourceItem.action_id || '');
  const sourceItemId = normalizeText(sourceItem.id || '');

  if (!sourceKey && !sourceActionId && !sourceItemId) return [];

  const items = Array.isArray(store.items) ? store.items : [];
  const completed = [];

  items.forEach(item => {
    if (!itemBelongsToUser(item, userId)) return;
    if (item.bucket === 'memory') return;
    if (isCompletedStatus(item.status) || item.checked || item.archived_at) return;

    const bucket = normalizeText(item.bucket || '');
    const actionType = normalizeText(item.action_type || item.type || '');
    const isOrganizationItem =
      bucket === 'tasks' ||
      bucket === 'today' ||
      bucket === 'reminders' ||
      actionType === 'idea_to_task' ||
      actionType === 'add_to_today' ||
      actionType === 'create_reminder';

    if (!isOrganizationItem) return;

    const itemKey = getItemUserFacingKey(item);
    const sameText = Boolean(sourceKey && itemKey && itemKey === sourceKey);
    const sameAction = Boolean(sourceActionId && item.action_id === sourceActionId);
    const sameItem = Boolean(sourceItemId && item.id === sourceItemId);

    if (!sameText && !sameAction && !sameItem) return;

    completed.push(completeAndArchiveItem(store, item, bucket));
  });

  return completed;
}

function syncActionFromUpdatedItem(store, item) {
  if (!item?.action_id) return null;

  const actions = Array.isArray(store.actions) ? store.actions : [];
  const action = actions.find(existingAction => {
    return existingAction.id === item.action_id || existingAction.item_id === item.id;
  });

  if (!action) return null;

  action.title = item.title || action.title;
  action.target = item.content || item.target || action.target;
  action.status = item.status || action.status;
  action.priority = item.priority || action.priority;
  action.datetime_hint = item.datetime_hint ?? action.datetime_hint ?? null;
  action.scheduled_at = item.scheduled_at ?? action.scheduled_at ?? null;
  action.remind_at = item.remind_at ?? action.remind_at ?? null;
  action.reminder_at = item.reminder_at ?? action.reminder_at ?? null;
  action.checked = item.checked ?? action.checked ?? false;
  action.updated_at = nowIso();

  if (isCompletedStatus(action.status)) {
    action.completed_at = action.completed_at || nowIso();
  }

  return action;
}

function moveItemToMemory(item, category = null) {
  if (!item || item.bucket === 'memory') return item;

  item.previous_bucket = item.previous_bucket || item.bucket || null;
  item.memory_category = category || item.previous_bucket || item.bucket || item.type || 'item';
  item.bucket = 'memory';
  item.archived_at = item.archived_at || nowIso();
  item.updated_at = nowIso();

  return item;
}

function shouldArchiveCompletedItem(item) {
  if (!item) return false;

  const bucket = normalizeText(item.bucket || '');
  const type = normalizeText(item.type || '');

  if (bucket === 'memory') return false;

  return ['tasks', 'today', 'reminders', 'routines', 'routine'].includes(bucket) || type === 'routine';
}

function archiveCompletedOrganizationItem(store, item) {
  if (!item || !shouldArchiveCompletedItem(item)) return null;

  if (item.checked || isCompletedStatus(item.status)) {
    return moveItemToMemory(item, item.bucket);
  }

  return null;
}

function archiveShoppingListIfFullyChecked(store, userId) {
  const items = Array.isArray(store.items) ? store.items : [];
  const shoppingItems = items.filter(item => {
    return itemBelongsToUser(item, userId) && item.bucket === 'shopping_list';
  });

  if (!shoppingItems.length) return null;

  const allChecked = shoppingItems.every(item => {
    return Boolean(item.checked) || isCompletedStatus(item.status);
  });

  if (!allChecked) return null;

  const archivedItems = shoppingItems.map(item => {
    item.checked = true;
    item.checked_at = item.checked_at || nowIso();
    item.status = 'done';
    item.completed_at = item.completed_at || nowIso();
    return moveItemToMemory(item, 'shopping_list');
  });

  return {
    archived: true,
    archived_count: archivedItems.length,
    archived_items: archivedItems,
    archived_at: nowIso(),
  };
}

app.get('/store/memory', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const items = (Array.isArray(store.items) ? store.items : [])
    .filter(item => {
      const bucket = normalizeText(item?.bucket || '');
      const type = normalizeText(item?.type || '');
      const tags = Array.isArray(item?.tags) ? item.tags : [];
      const isJournalItem =
        bucket === 'journal' ||
        type === 'emotion' ||
        tags.includes('émotion') ||
        tags.includes('emotion');

      return (
        itemBelongsToUser(item, userId) &&
        (
          bucket === 'memory' ||
          isJournalItem ||
          Boolean(item.archived_at) ||
          isCompletedStatus(item.status)
        )
      );
    })
    .sort((a, b) => {
      return new Date(b.archived_at || b.completed_at || b.updated_at || b.created_at || 0).getTime() -
        new Date(a.archived_at || a.completed_at || a.updated_at || a.created_at || 0).getTime();
    });

  return res.json({
    ok: true,
    userId,
    count: items.length,
    items,
    memory_items: items,
  });
});


app.get('/store/journal', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const items = (Array.isArray(store.items) ? store.items : [])
    .filter(item => {
      const bucket = normalizeText(item?.bucket || '');
      const type = normalizeText(item?.type || '');
      const tags = Array.isArray(item?.tags) ? item.tags : [];

      return (
        itemBelongsToUser(item, userId) &&
        (
          bucket === 'journal' ||
          type === 'emotion' ||
          tags.includes('émotion') ||
          tags.includes('emotion')
        )
      );
    })
    .sort((a, b) => {
      return new Date(b.updated_at || b.created_at || 0).getTime() -
        new Date(a.updated_at || a.created_at || 0).getTime();
    });

  return res.json({
    ok: true,
    userId,
    count: items.length,
    items,
    journal_items: items,
  });
});

app.get('/store/shopping-list', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const items = (Array.isArray(store.items) ? store.items : []).filter(item => {
    return (
      itemBelongsToUser(item, userId) &&
      item.bucket === 'shopping_list' &&
      !item.archived_at &&
      !isCompletedStatus(item.status)
    );
  });

  return res.json({
    ok: true,
    userId,
    count: items.length,
    items,
    shopping_list: items,
  });
});

app.patch('/store/items/:itemId', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const itemId = normalizeText(req.params.itemId);
  const store = readStore();
  const found = findUserStoreItem(store, userId, itemId);

  if (!found) {
    return res.status(404).json({
      ok: false,
      error: 'ITEM_NOT_FOUND',
      message: 'Élément introuvable.',
    });
  }

  const item = found.item;
  const allowedStatuses = ['captured', 'todo', 'active', 'done', 'completed', 'cancelled', 'canceled', 'draft'];

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'title')) {
    const title = normalizeText(req.body.title).slice(0, 120);
    if (title) item.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'content')) {
    const content = normalizeText(req.body.content).slice(0, 1000);
    if (content) item.content = content;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'target')) {
    const target = normalizeText(req.body.target).slice(0, 1000);
    if (target) item.target = target;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'checked')) {
    item.checked = Boolean(req.body.checked);
    item.checked_at = item.checked ? nowIso() : null;

    if (item.checked) {
      item.status = 'done';
      item.completed_at = item.completed_at || nowIso();
    } else if (item.status === 'done' || item.status === 'completed') {
      item.status = 'todo';
      item.completed_at = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
    const status = normalizeText(req.body.status).toLowerCase();

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_STATUS',
        allowed_statuses: allowedStatuses,
      });
    }

    item.status = status;

    if (isCompletedStatus(status)) {
      item.completed_at = item.completed_at || nowIso();
      item.checked = true;
      item.checked_at = item.checked_at || nowIso();
    }

    if (!isCompletedStatus(status) && status !== 'done') {
      item.cancelled_at = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'scheduled_at')) {
    const scheduledAt = normalizeText(req.body.scheduled_at || '');

    if (scheduledAt) {
      const parsed = new Date(scheduledAt);

      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({
          ok: false,
          error: 'INVALID_SCHEDULED_AT',
          message: 'Date de rappel invalide.',
        });
      }

      item.scheduled_at = scheduledAt;
      item.remind_at = scheduledAt;
      item.reminder_at = scheduledAt;
      item.has_exact_date = true;
      item.schedule_precision = item.schedule_precision || 'manual_exact';
    } else {
      item.scheduled_at = null;
      item.remind_at = null;
      item.reminder_at = null;
      item.has_exact_date = false;
      item.schedule_precision = 'unscheduled';
    }
  }

  item.updated_at = nowIso();

  const previousBucket = item.previous_bucket || item.bucket;
  const archivedItem = archiveCompletedOrganizationItem(store, item);
  const shoppingArchive = previousBucket === 'shopping_list'
    ? archiveShoppingListIfFullyChecked(store, userId)
    : null;
  const action = syncActionFromUpdatedItem(store, item);

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    item,
    action,
    archived_item: archivedItem,
    shopping_archive: shoppingArchive,
    message: archivedItem ? 'Élément terminé et archivé dans la mémoire.' : 'Élément mis à jour.',
  });
});

app.delete('/store/items/:itemId', (req, res) => {
  const userId = normalizeText(req.body?.userId || req.query?.userId || 'local-user');
  const itemId = normalizeText(req.params.itemId);
  const store = readStore();
  const found = findUserStoreItem(store, userId, itemId);

  if (!found) {
    return res.status(404).json({
      ok: false,
      error: 'ITEM_NOT_FOUND',
      message: 'Élément introuvable.',
    });
  }

  const [deletedItem] = store.items.splice(found.index, 1);

  let deletedAction = null;
  if (deletedItem?.action_id && Array.isArray(store.actions)) {
    const actionIndex = store.actions.findIndex(action => {
      return action.id === deletedItem.action_id || action.item_id === deletedItem.id;
    });

    if (actionIndex >= 0) {
      [deletedAction] = store.actions.splice(actionIndex, 1);
    }
  }

  if (Array.isArray(store.relations)) {
    store.relations = store.relations.filter(relation => {
      return relation.source_id !== deletedItem.id &&
        relation.target_id !== deletedItem.id &&
        relation.source_id !== deletedItem.action_id &&
        relation.target_id !== deletedItem.action_id;
    });
  }

  writeStore(store);

  return res.json({
    ok: true,
    userId,
    deleted_item: deletedItem,
    deleted_action: deletedAction,
    message: 'Élément supprimé.',
  });
});


app.get('/store/tasks', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const tasks = (Array.isArray(store.items) ? store.items : [])
    .filter(item => {
      if (!itemBelongsToUser(item, userId)) return false;
      if (item.archived_at || item.bucket === 'memory') return false;
      if (item.checked || isCompletedStatus(item.status)) return false;

      const bucket = normalizeText(item.bucket || '');
      const type = normalizeText(item.type || '');
      const actionType = normalizeText(item.action_type || '');

      return (
        bucket === 'tasks' ||
        type === 'task' ||
        actionType === 'idea_to_task' ||
        actionType === 'add_to_today'
      );
    })
    .sort((a, b) => {
      return new Date(b.updated_at || b.created_at || 0).getTime() -
        new Date(a.updated_at || a.created_at || 0).getTime();
    });

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

  const today = (Array.isArray(store.items) ? store.items : [])
    .filter(item => {
      return (
        itemBelongsToUser(item, userId) &&
        item.bucket === 'today' &&
        !item.archived_at &&
        !item.checked &&
        !isCompletedStatus(item.status)
      );
    });

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

app.get('/store/shopping-list', (req, res) => {
  const userId = normalizeText(req.query?.userId || 'local-user');
  const store = readStore();

  const items = store.items.filter(
    item => item.user_id === userId && item.bucket === 'shopping_list'
  );

  res.json({
    ok: true,
    userId,
    count: items.length,
    items,
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
    const memorySummary = getStoreSummary(userId);
    const localAnalysis = analyzeMessage(userMessage);
    const analysis = await analyzeMessageWithAI(userMessage, localAnalysis, memorySummary);
    const action = detectAction(userMessage, userId, analysis);
    const suggestions = buildSuggestions(analysis, action);

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



app.post('/compression/analyze', (req, res) => {
  try {
    const task = req.body?.task || {};
    const cognitiveState = req.body?.cognitiveState || {};

    const compression = compressTask({
      task,
      cognitiveState,
    });

    return res.json({
      ok: true,
      compression,
    });
  } catch (error) {
    console.error('❌ /compression/analyze error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur compression cognitive',
      details: error.message,
    });
  }
});

app.post('/compression/from-priority', (req, res) => {
  try {
    const userId = normalizeText(
      req.body?.userId || req.query?.userId || 'local-user'
    );

    const taskId = normalizeText(
      req.body?.taskId || ''
    );

    const store = readStore();

    const latestUserState =
      getLatestUserState(store, userId) ||
      saveUserStateSnapshot(store, userId);

    const priorityPayload =
      buildPriorityPayload(store, userId);

    let selectedTask = null;

    if (taskId) {
      selectedTask =
        priorityPayload.analyzed_items.find(
          item => item.id === taskId
        ) || null;
    }

    if (!selectedTask) {
      selectedTask =
        priorityPayload.top_priority || null;
    }

    if (!selectedTask) {
      return res.status(404).json({
        ok: false,
        error: 'Aucune priorité trouvée',
      });
    }

    const compression = compressTask({
      task: selectedTask,
      cognitiveState: latestUserState,
    });

    return res.json({
      ok: true,
      userId,
      selected_task: selectedTask,
      cognitive_state: latestUserState,
      compression,
    });
  } catch (error) {
    console.error('❌ /compression/from-priority error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur compression depuis priorité',
      details: error.message,
    });
  }
});


app.post('/momentum/recovery/analyze', (req, res) => {
  try {
    const session = req.body?.session || {};
    const task = req.body?.task || {};
    const cognitiveState =
      req.body?.cognitiveState ||
      req.body?.cognitive_state ||
      {};

    const recovery = analyzeMomentumRecovery({
      session,
      task,
      cognitive_state: cognitiveState,
    });

    return res.json({
      ok: true,
      recovery,
    });
  } catch (error) {
    console.error('❌ /momentum/recovery/analyze error:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'Erreur analyse momentum recovery',
      details: error.message,
    });
  }
});



app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Nyra backend Google Tasks Create Task lancé sur le port ${PORT}`);
});