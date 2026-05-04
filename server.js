require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL || OPENAI_MODEL;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'Ka6yOFdNGhzFuCVW6VyO';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY manquante');
}

if (!SUPABASE_ENABLED) {
  console.warn('⚠️ Supabase non configuré, fallback local activé');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const supabase = SUPABASE_ENABLED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const MEMORY_SUMMARY_FILE = path.join(DATA_DIR, 'memory_summary.json');
const MEMORY_STRUCTURED_FILE = path.join(DATA_DIR, 'memory_structured.json');
const MEMORY_BEHAVIOR_FILE = path.join(DATA_DIR, 'memory_behavior.json');
const MEMORY_TOPICS_FILE = path.join(DATA_DIR, 'memory_topics.json');
const REMINDER_EVENTS_FILE = path.join(DATA_DIR, 'pending_reminder_events.json');
const AUDIO_CACHE_DIR = path.join(DATA_DIR, 'audio-cache');

ensureDir(DATA_DIR);
ensureDir(AUDIO_CACHE_DIR);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`❌ Erreur lecture JSON ${filePath}:`, error.message);
    return fallback;
  }
}

function writeJsonSafe(filePath, value) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  } catch (error) {
    console.error(`❌ Erreur écriture JSON ${filePath}:`, error.message);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, maxLength = 220) {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function labelsOnly(items, limit = 3) {
  return safeArray(items)
    .filter(isWeightedItem)
    .slice(0, limit)
    .map((item) => item.label);
}

function boolToFlag(value) {
  return value ? 'yes' : 'no';
}

function createEmptyStructuredMemory() {
  return {
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
  };
}

function createEmptyBehaviorMemory() {
  return {
    recent_states: [],
    updated_at: null
  };
}

function createEmptyTopicMemory() {
  return {
    topics: []
  };
}

function createEmptySemanticSummary() {
  return {
    summary: '',
    updated_at: null
  };
}

function createEmptyReminderEventStore() {
  return {
    pending: []
  };
}

function isWeightedItem(item) {
  return item && typeof item === 'object' && typeof item.label === 'string';
}

function mergeWeightedCollections(existingItems, incomingItems) {
  const result = Array.isArray(existingItems) ? [...existingItems] : [];
  const indexByLabel = new Map();

  result.forEach((item, index) => {
    if (isWeightedItem(item)) {
      indexByLabel.set(item.label.toLowerCase(), index);
    }
  });

  for (const incoming of safeArray(incomingItems)) {
    if (!isWeightedItem(incoming)) continue;

    const label = normalizeText(incoming.label);
    if (!label) continue;

    const key = label.toLowerCase();
    const incomingWeight = clamp(Number(incoming.weight) || 0.6, 0, 1);
    const incomingOccurrences = Math.max(1, Number(incoming.occurrences) || 1);
    const incomingLastSeen = incoming.last_seen_at || nowIso();

    if (indexByLabel.has(key)) {
      const idx = indexByLabel.get(key);
      const current = result[idx];

      const newOccurrences = Math.max(1, Number(current.occurrences) || 1) + incomingOccurrences;
      const boostedWeight = clamp(
        (Number(current.weight) || 0.5) * 0.65 +
          incomingWeight * 0.35 +
          Math.min(0.15, newOccurrences * 0.01),
        0,
        1
      );

      result[idx] = {
        label,
        weight: Number(boostedWeight.toFixed(3)),
        occurrences: newOccurrences,
        last_seen_at: incomingLastSeen
      };
    } else {
      const newItem = {
        label,
        weight: Number(incomingWeight.toFixed(3)),
        occurrences: incomingOccurrences,
        last_seen_at: incomingLastSeen
      };
      indexByLabel.set(key, result.length);
      result.push(newItem);
    }
  }

  return result
    .filter(isWeightedItem)
    .sort((a, b) => {
      if ((b.weight || 0) !== (a.weight || 0)) return (b.weight || 0) - (a.weight || 0);
      return (b.occurrences || 0) - (a.occurrences || 0);
    });
}

function mergeUniqueObjectsByKey(existingItems, incomingItems, key = 'label') {
  const result = Array.isArray(existingItems) ? [...existingItems] : [];
  const seen = new Map();

  result.forEach((item, index) => {
    if (item && typeof item === 'object' && item[key]) {
      seen.set(String(item[key]).toLowerCase(), index);
    }
  });

  for (const item of safeArray(incomingItems)) {
    if (!item || typeof item !== 'object' || !item[key]) continue;
    const normalizedKey = String(item[key]).toLowerCase();
    if (seen.has(normalizedKey)) {
      result[seen.get(normalizedKey)] = { ...result[seen.get(normalizedKey)], ...item };
    } else {
      seen.set(normalizedKey, result.length);
      result.push(item);
    }
  }

  return result;
}

function mergeStructuredMemory(existingMemory, incomingMemory) {
  const base = existingMemory && typeof existingMemory === 'object'
    ? existingMemory
    : createEmptyStructuredMemory();

  const incoming = incomingMemory && typeof incomingMemory === 'object'
    ? incomingMemory
    : {};

  return {
    identity: {
      ...(base.identity || {}),
      ...(incoming.identity || {})
    },
    preferences: mergeWeightedCollections(base.preferences, incoming.preferences),
    projects: mergeWeightedCollections(base.projects, incoming.projects),
    constraints: mergeWeightedCollections(base.constraints, incoming.constraints),
    emotional_patterns: mergeWeightedCollections(base.emotional_patterns, incoming.emotional_patterns),
    relationships: mergeUniqueObjectsByKey(base.relationships, incoming.relationships, 'label'),
    active_contexts: mergeWeightedCollections(base.active_contexts, incoming.active_contexts),
    decisions: mergeWeightedCollections(base.decisions, incoming.decisions),
    insights: mergeWeightedCollections(base.insights, incoming.insights),
    conversation_style: {
      ...(base.conversation_style || {}),
      ...(incoming.conversation_style || {})
    },
    triggers: mergeWeightedCollections(base.triggers, incoming.triggers),
    needs: mergeWeightedCollections(base.needs, incoming.needs),
    regulation_strategies: mergeWeightedCollections(base.regulation_strategies, incoming.regulation_strategies),
    risk_patterns: mergeWeightedCollections(base.risk_patterns, incoming.risk_patterns),
    support_patterns: mergeWeightedCollections(base.support_patterns, incoming.support_patterns)
  };
}

function recencyScore(lastSeenAt) {
  if (!lastSeenAt) return 0;
  const then = new Date(lastSeenAt).getTime();
  const now = Date.now();
  if (Number.isNaN(then)) return 0;
  const diffHours = Math.max(0, (now - then) / (1000 * 60 * 60));
  if (diffHours <= 24) return 1;
  if (diffHours <= 72) return 0.8;
  if (diffHours <= 168) return 0.6;
  if (diffHours <= 720) return 0.35;
  return 0.15;
}

function rankMemoryItems(items, limit = 3) {
  return safeArray(items)
    .filter(isWeightedItem)
    .map((item) => ({
      ...item,
      priority_score: Number((((item.weight || 0) * 0.7) + (recencyScore(item.last_seen_at) * 0.3)).toFixed(3))
    }))
    .sort((a, b) => {
      if ((b.priority_score || 0) !== (a.priority_score || 0)) {
        return (b.priority_score || 0) - (a.priority_score || 0);
      }
      return (b.occurrences || 0) - (a.occurrences || 0);
    })
    .slice(0, limit);
}

function extractRelevantMemory(structuredMemory) {
  const memory = structuredMemory || createEmptyStructuredMemory();

  return {
    top_emotional_patterns: rankMemoryItems(memory.emotional_patterns, 3),
    top_triggers: rankMemoryItems(memory.triggers, 3),
    top_needs: rankMemoryItems(memory.needs, 3),
    top_risk_patterns: rankMemoryItems(memory.risk_patterns, 3),
    top_support_patterns: rankMemoryItems(memory.support_patterns, 3),
    top_active_contexts: rankMemoryItems(memory.active_contexts, 3),
    top_regulation_strategies: rankMemoryItems(memory.regulation_strategies, 3),
    top_projects: rankMemoryItems(memory.projects, 3),
    conversation_style: memory.conversation_style || {},
    identity: memory.identity || {}
  };
}

function countKeywordMatches(text, keywords) {
  const lower = text.toLowerCase();
  let score = 0;

  for (const keyword of keywords) {
    if (lower.includes(keyword.toLowerCase())) {
      score += 1;
    }
  }

  return score;
}

function countWeightedMatches(text, patterns) {
  const lower = text.toLowerCase();
  let score = 0;

  for (const pattern of patterns) {
    if (lower.includes(pattern.phrase.toLowerCase())) {
      score += pattern.weight;
    }
  }

  return score;
}

function hasAny(text, patterns) {
  const lower = text.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

function hasExplicitRecadreRequest(text) {
  const lower = normalizeText(text).toLowerCase();
  return hasAny(lower, [
    'recadre-moi',
    'recadre moi',
    'recadre',
    'recadrer',
    'recadrage',
    'cadre-moi',
    'cadre moi'
  ]);
}

function analyzeUserState(message, structuredMemory) {
  const text = normalizeText(message);
  const lower = text.toLowerCase();
  const relevantMemory = extractRelevantMemory(structuredMemory);
  const explicitRecadreRequest = hasExplicitRecadreRequest(lower);

  const strongVulnerabilityPatterns = [
    { phrase: 'je me sens mal', weight: 0.45 },
    { phrase: 'je vais mal', weight: 0.5 },
    { phrase: 'j’en peux plus', weight: 0.72 },
    { phrase: 'j en peux plus', weight: 0.72 },
    { phrase: 'je craque', weight: 0.78 },
    { phrase: 'je suis perdue', weight: 0.45 },
    { phrase: 'je suis perdu', weight: 0.45 },
    { phrase: 'je me sens seule', weight: 0.42 },
    { phrase: 'je me sens vide', weight: 0.72 },
    { phrase: 'ça me fait mal', weight: 0.35 },
    { phrase: 'ça me détruit', weight: 0.7 },
    { phrase: 'je suis au bout', weight: 0.8 },
    { phrase: 'j’ai juste besoin que ça s’arrête', weight: 0.85 },
    { phrase: 'j\'ai juste besoin que ça s’arrête', weight: 0.85 },
    { phrase: 'j’ai juste besoin que ça s\'arrête', weight: 0.85 },
    { phrase: 'j\'ai juste besoin que ça s\'arrête', weight: 0.85 },
    { phrase: 'ça s’arrête dans ma tête', weight: 0.82 },
    { phrase: 'ça s\'arrête dans ma tête', weight: 0.82 }
  ];

  const softVulnerabilityPatterns = [
    { phrase: 'je me sens fragile', weight: 0.42 },
    { phrase: 'fragile aujourd’hui', weight: 0.28 },
    { phrase: 'fragile aujourd\'hui', weight: 0.28 },
    { phrase: 'sans me brusquer', weight: 0.36 },
    { phrase: 'doucement', weight: 0.18 },
    { phrase: 'à mon rythme', weight: 0.32 },
    { phrase: 'a mon rythme', weight: 0.32 },
    { phrase: 'j’ai besoin que tu m’aides', weight: 0.26 },
    { phrase: 'j\'ai besoin que tu m’aides', weight: 0.26 },
    { phrase: 'j’ai besoin que tu m\'aides', weight: 0.26 },
    { phrase: 'j\'ai besoin que tu m\'aides', weight: 0.26 },
    { phrase: 'pas trop fort', weight: 0.24 },
    { phrase: 'j’ai besoin de douceur', weight: 0.4 },
    { phrase: 'j\'ai besoin de douceur', weight: 0.4 },
    { phrase: 'je suis un peu mal', weight: 0.3 },
    { phrase: 'j’ai besoin de soutien', weight: 0.32 },
    { phrase: 'j\'ai besoin de soutien', weight: 0.32 },
    { phrase: 'aide-moi doucement', weight: 0.4 },
    { phrase: 'aide moi doucement', weight: 0.4 }
  ];

  const strongRuminationPatterns = [
    { phrase: 'je tourne en boucle', weight: 0.72 },
    { phrase: 'je tourne encore en boucle', weight: 0.86 },
    { phrase: 'je tourne toujours en boucle', weight: 0.84 },
    { phrase: 'je suis en boucle', weight: 0.68 },
    { phrase: 'encore en boucle', weight: 0.42 },
    { phrase: 'tourne en boucle', weight: 0.52 },
    { phrase: 'je n’arrive pas à décrocher', weight: 0.58 },
    { phrase: 'je n\'arrive pas à décrocher', weight: 0.58 },
    { phrase: 'je n’arrive pas à lâcher', weight: 0.55 },
    { phrase: 'je n\'arrive pas à lâcher', weight: 0.55 },
    { phrase: 'je repense sans arrêt', weight: 0.62 },
    { phrase: 'je pense à ça en boucle', weight: 0.7 },
    { phrase: 'ça m’obsède', weight: 0.65 },
    { phrase: 'ça m\'obsède', weight: 0.65 },
    { phrase: 'je rumine', weight: 0.62 },
    { phrase: 'je me demande sans arrêt', weight: 0.55 },
    { phrase: 'je recommence à tourner', weight: 0.42 },
    { phrase: 'je recommence à tourner dans mes vieux schémas', weight: 0.76 },
    { phrase: 'je retombe dans mes vieux schémas', weight: 0.78 },
    { phrase: 'mes vieux schémas', weight: 0.42 },
    { phrase: 'mes anciens schémas', weight: 0.42 },
    { phrase: 'je repars dans mes schémas', weight: 0.7 },
    { phrase: 'les mêmes schémas', weight: 0.7 },
    { phrase: 'les memes schemas', weight: 0.7 },
    { phrase: 'je repars dans les mêmes schémas', weight: 0.85 },
    { phrase: 'je repars dans les memes schemas', weight: 0.85 }
  ];

  const strongDispersionPatterns = [
    { phrase: 'je pars dans tous les sens', weight: 0.78 },
    { phrase: 'je m’éparpille', weight: 0.68 },
    { phrase: 'je m\'éparpille', weight: 0.68 },
    { phrase: 'je me disperse', weight: 0.62 },
    { phrase: 'je ne sais plus par quoi commencer', weight: 0.68 },
    { phrase: 'je sais plus par quoi commencer', weight: 0.68 },
    { phrase: 'je bloque sur tout', weight: 0.55 },
    { phrase: 'je n’arrive pas à me concentrer', weight: 0.55 },
    { phrase: 'je n\'arrive pas à me concentrer', weight: 0.55 },
    { phrase: 'je saute du coq à l’âne', weight: 0.6 },
    { phrase: 'je saute du coq à l\'âne', weight: 0.6 }
  ];

  const strongAvoidancePatterns = [
    { phrase: 'j’évite', weight: 0.48 },
    { phrase: 'j\'évite', weight: 0.48 },
    { phrase: 'je fuis', weight: 0.52 },
    { phrase: 'je reporte', weight: 0.5 },
    { phrase: 'je procrastine', weight: 0.48 },
    { phrase: 'plus tard', weight: 0.22 },
    { phrase: 'demain peut-être', weight: 0.4 },
    { phrase: 'je n’ose pas', weight: 0.42 },
    { phrase: 'je n\'ose pas', weight: 0.42 },
    { phrase: 'j’ai pas envie de faire', weight: 0.45 },
    { phrase: 'j\'ai pas envie de faire', weight: 0.45 }
  ];

  const strongUrgencyPatterns = [
    { phrase: 'urgent', weight: 0.75 },
    { phrase: 'vite', weight: 0.45 },
    { phrase: 'rapidement', weight: 0.4 },
    { phrase: 'tout de suite', weight: 0.6 },
    { phrase: 'immédiatement', weight: 0.7 },
    { phrase: 'immédiat', weight: 0.6 },
    { phrase: 'au plus vite', weight: 0.72 },
    { phrase: 'maintenant', weight: 0.25 },
    { phrase: 'j’ai besoin maintenant', weight: 0.72 },
    { phrase: 'j\'ai besoin maintenant', weight: 0.72 },
    { phrase: 'j’ai besoin d’avancer vite', weight: 0.82 },
    { phrase: 'j\'ai besoin d’avancer vite', weight: 0.82 },
    { phrase: 'j’ai besoin d\'avancer vite', weight: 0.82 },
    { phrase: 'j\'ai besoin d\'avancer vite', weight: 0.82 },
    { phrase: 'je veux un plan concret maintenant', weight: 0.82 },
    { phrase: 'il me faut un plan maintenant', weight: 0.76 }
  ];

  const strongActivationPatterns = [
    { phrase: 'je suis chaude', weight: 0.82 },
    { phrase: 'on avance', weight: 0.48 },
    { phrase: 'go', weight: 0.22 },
    { phrase: 'on y va', weight: 0.52 },
    { phrase: 'je suis motivée', weight: 0.65 },
    { phrase: 'je suis motivé', weight: 0.65 },
    { phrase: 'je veux avancer', weight: 0.55 },
    { phrase: 'je veux qu’on fasse', weight: 0.52 },
    { phrase: 'je veux qu\'on fasse', weight: 0.52 },
    { phrase: 'je veux quelque chose de propre', weight: 0.38 },
    { phrase: 'premium', weight: 0.18 },
    { phrase: 'concret', weight: 0.18 },
    { phrase: 'je veux un plan concret', weight: 0.34 }
  ];

  const strongIntensityPatterns = [
    { phrase: 'catastrophe', weight: 0.55 },
    { phrase: 'insupportable', weight: 0.65 },
    { phrase: 'horrible', weight: 0.45 },
    { phrase: 'je déteste', weight: 0.38 },
    { phrase: 'je souffre', weight: 0.62 },
    { phrase: 'ça m’explose', weight: 0.7 },
    { phrase: 'ça m\'explose', weight: 0.7 },
    { phrase: 'ça m’obsède', weight: 0.58 },
    { phrase: 'ça m\'obsède', weight: 0.58 },
    { phrase: 'je suis détruite', weight: 0.78 },
    { phrase: 'je suis détruit', weight: 0.78 },
    { phrase: 'j’en peux plus', weight: 0.72 },
    { phrase: 'j en peux plus', weight: 0.72 },
    { phrase: 'je craque', weight: 0.72 },
    { phrase: 'ça s’arrête dans ma tête', weight: 0.82 },
    { phrase: 'ça s\'arrête dans ma tête', weight: 0.82 },
    { phrase: 'j’ai juste besoin que ça s’arrête', weight: 0.82 },
    { phrase: 'j\'ai juste besoin que ça s’arrête', weight: 0.82 },
    { phrase: 'j’ai juste besoin que ça s\'arrête', weight: 0.82 },
    { phrase: 'j\'ai juste besoin que ça s\'arrête', weight: 0.82 },
    { phrase: 'jamais', weight: 0.08 },
    { phrase: 'toujours', weight: 0.08 }
  ];

  const vulnerabilityLight = countKeywordMatches(lower, [
    'mal', 'peur', 'fragile', 'seule', 'vide', 'triste', 'pleure', 'douleur',
    'douceur', 'soutien', 'brusquer'
  ]) * 0.06;

  const ruminationLight = countKeywordMatches(lower, [
    'boucle', 'obsède', 'obsession', 'repense', 'pourquoi', 'et si', 'rumine',
    'schémas', 'schemas', 'tourne'
  ]) * 0.07;

  const dispersionLight = countKeywordMatches(lower, [
    'éparpille', 'disperse', 'concentrer', 'bloque', 'commencer'
  ]) * 0.07;

  const avoidanceLight = countKeywordMatches(lower, [
    'évite', 'fuis', 'reporte', 'procrastine', 'plus tard'
  ]) * 0.06;

  const urgencyLight = countKeywordMatches(lower, [
    'urgent', 'vite', 'rapidement', 'maintenant'
  ]) * 0.07;

  const activationLight = countKeywordMatches(lower, [
    'avance', 'go', 'motiv', 'propre', 'premium', 'concret', 'plan'
  ]) * 0.06;

  const intensityLight = countKeywordMatches(lower, [
    'catastrophe', 'horrible', 'insupportable', 'détruit', 'souffre',
    'craque', 'vide', 'stop', 'arrête'
  ]) * 0.08;

  let vulnerability =
    countWeightedMatches(lower, strongVulnerabilityPatterns) +
    countWeightedMatches(lower, softVulnerabilityPatterns) +
    vulnerabilityLight;

  let rumination =
    countWeightedMatches(lower, strongRuminationPatterns) + ruminationLight;

  let dispersion =
    countWeightedMatches(lower, strongDispersionPatterns) + dispersionLight;

  let avoidance =
    countWeightedMatches(lower, strongAvoidancePatterns) + avoidanceLight;

  let urgency =
    countWeightedMatches(lower, strongUrgencyPatterns) + urgencyLight;

  let activation =
    countWeightedMatches(lower, strongActivationPatterns) + activationLight;

  let emotionalIntensity =
    countWeightedMatches(lower, strongIntensityPatterns) + intensityLight;

  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  if (wordCount >= 12 && hasAny(lower, ['je', 'j’ai', 'j\'ai', 'besoin'])) {
    emotionalIntensity += 0.04;
  }

  if (hasAny(lower, ['sans me noyer', 'sans me brusquer', 'à mon rythme', 'a mon rythme'])) {
    vulnerability += 0.16;
  }

  if (explicitRecadreRequest) {
    activation += 0.18;
    rumination += 0.08;
  }

  if (hasAny(lower, ['sans me noyer'])) {
    vulnerability += 0.2;
    emotionalIntensity += 0.08;
  }

  if (lower.includes('tourne') && lower.includes('boucle')) {
    rumination += 0.25;
  }

  if (explicitRecadreRequest && lower.includes('boucle')) {
    rumination += 0.18;
  }

  if (hasAny(lower, ['vieux schémas', 'vieux schemas', 'anciens schémas', 'anciens schemas', 'les mêmes schémas', 'les memes schemas'])) {
    rumination += 0.22;
  }

  if (rumination > 0.5 && vulnerability > 0.25) {
    vulnerability += 0.12;
    emotionalIntensity += 0.12;
  }

  if (dispersion > 0.5 && activation > 0.25) {
    activation += 0.12;
  }

  if (avoidance > 0.35 && vulnerability > 0.2) {
    vulnerability += 0.08;
  }

  if (urgency > 0.4 && activation > 0.25) {
    activation += 0.08;
  }

  if (urgency > 0.7) {
    activation += 0.14;
  }

  if (vulnerability > 0.65 && hasAny(lower, ['ça s’arrête', 'ça s\'arrête', 'j’en peux plus', 'j en peux plus', 'je craque'])) {
    emotionalIntensity += 0.22;
  }

  const memoryBoosts = relevantMemory.top_risk_patterns.map((x) => x.label.toLowerCase());
  const memorySupports = relevantMemory.top_support_patterns.map((x) => x.label.toLowerCase());
  const memoryNeeds = relevantMemory.top_needs.map((x) => x.label.toLowerCase());

  if (memoryBoosts.some((x) => x.includes('boucle') || x.includes('rumination') || x.includes('obsession'))) {
    rumination += 0.12;
  }

  if (memoryBoosts.some((x) => x.includes('dispersion') || x.includes('éparpillement') || x.includes('éparpille'))) {
    dispersion += 0.12;
  }

  if (memoryBoosts.some((x) => x.includes('évitement') || x.includes('fuite') || x.includes('procrastination'))) {
    avoidance += 0.12;
  }

  if (memorySupports.some((x) => x.includes('recadrage') || x.includes('structure') || x.includes('cadrage'))) {
    activation += 0.08;
  }

  if (memoryNeeds.some((x) => x.includes('rassurance') || x.includes('sécurité') || x.includes('apaisement') || x.includes('douceur'))) {
    vulnerability += 0.08;
  }

  vulnerability = clamp(Number(vulnerability.toFixed(3)), 0, 1);
  rumination = clamp(Number(rumination.toFixed(3)), 0, 1);
  dispersion = clamp(Number(dispersion.toFixed(3)), 0, 1);
  avoidance = clamp(Number(avoidance.toFixed(3)), 0, 1);
  urgency = clamp(Number(urgency.toFixed(3)), 0, 1);
  activation = clamp(Number(activation.toFixed(3)), 0, 1);
  emotionalIntensity = clamp(Number(emotionalIntensity.toFixed(3)), 0, 1);

  const shouldRecadre =
    explicitRecadreRequest ||
    rumination >= 0.45 ||
    dispersion >= 0.5 ||
    avoidance >= 0.5 ||
    activation >= 0.65 ||
    urgency >= 0.7;

  const shouldReduceCognitiveLoad =
    vulnerability >= 0.4 ||
    emotionalIntensity >= 0.38 ||
    hasAny(lower, ['sans me noyer', 'sans me brusquer']);

  const shouldPushToAction =
    explicitRecadreRequest ||
    activation >= 0.45 ||
    dispersion >= 0.45 ||
    avoidance >= 0.45 ||
    urgency >= 0.65;

  let responseMode = 'clarifying';

  if (
    (vulnerability >= 0.65 && emotionalIntensity >= 0.45) ||
    hasAny(lower, ['j’en peux plus', 'j en peux plus', 'je craque', 'ça s’arrête dans ma tête', 'ça s\'arrête dans ma tête'])
  ) {
    responseMode = 'grounding';
  } else if (
    (explicitRecadreRequest && (rumination >= 0.38 || dispersion >= 0.38 || avoidance >= 0.38)) ||
    rumination >= 0.68 ||
    (rumination >= 0.55 && shouldRecadre)
  ) {
    responseMode = 'firm_support';
  } else if (
    (explicitRecadreRequest && activation >= 0.34) ||
    dispersion >= 0.55 ||
    avoidance >= 0.55
  ) {
    responseMode = 'directive';
  } else if (activation >= 0.55 || urgency >= 0.65) {
    responseMode = 'directive';
  } else if (vulnerability >= 0.3) {
    responseMode = 'supportive';
  }

  let primaryState = 'stable';
  let secondaryState = null;

  if (rumination >= 0.45 && vulnerability >= 0.25) {
    primaryState = 'rumination';
    secondaryState = 'vulnerability';
  } else if (urgency >= 0.6 && activation >= 0.25) {
    primaryState = 'urgency';
    secondaryState = 'activation';
  } else {
    const stateEntries = [
      ['vulnerability', vulnerability],
      ['rumination', rumination],
      ['dispersion', dispersion],
      ['avoidance', avoidance],
      ['urgency', urgency],
      ['activation', activation],
      ['emotional_intensity', emotionalIntensity]
    ].sort((a, b) => b[1] - a[1]);

    if (stateEntries[0][1] >= 0.3) {
      primaryState = stateEntries[0][0];
    }

    if (stateEntries[1][1] >= 0.25) {
      secondaryState = stateEntries[1][0];
    }
  }

  const responseDirectives = {
    grounding: {
      tone: 'calme, contenante, très rassurante, structurée',
      structure: 'phrases courtes, peu de surcharge, recentrage immédiat',
      recadrage_level: 'doux mais présent',
      priority: 'apaiser, stabiliser, sécuriser émotionnellement avant tout'
    },
    supportive: {
      tone: 'chaleureux, empathique, sincère, encourageant',
      structure: 'réponse fluide avec soutien émotionnel puis petite avancée concrète',
      recadrage_level: 'léger à modéré',
      priority: 'faire sentir qu’elle est comprise tout en l’aidant à avancer'
    },
    directive: {
      tone: 'clair, cadrant, motivant, concret',
      structure: 'étapes nettes, actionnable, sans blabla',
      recadrage_level: 'modéré à fort',
      priority: 'réduire le flou et remettre du mouvement'
    },
    firm_support: {
      tone: 'chaleureux mais lucide, franc, protecteur',
      structure: 'valider brièvement puis recadrer vite la boucle mentale',
      recadrage_level: 'fort mais bienveillant',
      priority: 'couper la rumination, revenir au réel, redonner du pouvoir d’action'
    },
    clarifying: {
      tone: 'naturel, intelligent, adaptable',
      structure: 'souple, utile, fluide',
      recadrage_level: 'adaptatif',
      priority: 'répondre juste et efficacement'
    }
  };

  return {
    state: {
      vulnerability,
      rumination,
      dispersion,
      avoidance,
      urgency,
      activation,
      emotional_intensity: emotionalIntensity
    },
    primary_state: primaryState,
    secondary_state: secondaryState,
    response_mode: responseMode,
    should_recadre: shouldRecadre,
    should_reduce_cognitive_load:
      shouldReduceCognitiveLoad || responseMode === 'grounding',
    should_push_to_action: shouldPushToAction,
    directives: responseDirectives[responseMode]
  };
}

function buildBehaviorStateSnapshot(userStateAnalysis) {
  return {
    timestamp: nowIso(),
    primary_state: userStateAnalysis.primary_state,
    secondary_state: userStateAnalysis.secondary_state,
    response_mode: userStateAnalysis.response_mode,
    scores: {
      vulnerability: userStateAnalysis.state.vulnerability,
      rumination: userStateAnalysis.state.rumination,
      dispersion: userStateAnalysis.state.dispersion,
      avoidance: userStateAnalysis.state.avoidance,
      urgency: userStateAnalysis.state.urgency,
      activation: userStateAnalysis.state.activation,
      emotional_intensity: userStateAnalysis.state.emotional_intensity
    }
  };
}

function computeAverageScore(states, key) {
  const validStates = safeArray(states);
  if (validStates.length === 0) return 0;

  const total = validStates.reduce((sum, state) => {
    return sum + (Number(state?.scores?.[key]) || 0);
  }, 0);

  return Number((total / validStates.length).toFixed(3));
}

function computeRecentHalfAverage(states, key, half = 'last') {
  const validStates = safeArray(states);
  if (validStates.length === 0) return 0;

  const mid = Math.max(1, Math.ceil(validStates.length / 2));
  const slice = half === 'first'
    ? validStates.slice(0, mid)
    : validStates.slice(-mid);

  return computeAverageScore(slice, key);
}

function computeDominantState(states) {
  const candidates = [
    'vulnerability',
    'rumination',
    'dispersion',
    'avoidance',
    'urgency',
    'activation',
    'emotional_intensity'
  ];

  const ranked = candidates
    .map((key) => ({
      state: key,
      avg: computeAverageScore(states, key)
    }))
    .sort((a, b) => b.avg - a.avg);

  return {
    dominant_state: ranked[0]?.avg >= 0.25 ? ranked[0].state : 'stable',
    dominant_score: Number((ranked[0]?.avg || 0).toFixed(3)),
    secondary_dominant_state: ranked[1]?.avg >= 0.22 ? ranked[1].state : null,
    secondary_dominant_score: Number((ranked[1]?.avg || 0).toFixed(3))
  };
}

function computeConsecutivePrimaryState(states) {
  const validStates = safeArray(states);
  if (validStates.length === 0) {
    return {
      state: 'stable',
      count: 0
    };
  }

  const lastState = validStates[validStates.length - 1]?.primary_state || 'stable';
  let count = 0;

  for (let i = validStates.length - 1; i >= 0; i -= 1) {
    if ((validStates[i]?.primary_state || 'stable') === lastState) {
      count += 1;
    } else {
      break;
    }
  }

  return {
    state: lastState,
    count
  };
}

function computeBehaviorTrend(recentStates) {
  const states = safeArray(recentStates).slice(-8);

  if (states.length === 0) {
    return {
      window_size: 0,
      dominant_state: 'stable',
      dominant_score: 0,
      secondary_dominant_state: null,
      secondary_dominant_score: 0,
      repeated_primary_state: null,
      repeated_primary_count: 0,
      rumination_trend: 'stable',
      vulnerability_trend: 'stable',
      activation_trend: 'stable',
      cognitive_load_pressure: 'low',
      recadre_pressure: 'low',
      action_pressure: 'low',
      cycle_detected: false
    };
  }

  const dominant = computeDominantState(states);
  const repeated = computeConsecutivePrimaryState(states);

  let ruminationTrend = 'stable';
  let vulnerabilityTrend = 'stable';
  let activationTrend = 'stable';

  if (states.length >= 3) {
    const firstRumination = computeRecentHalfAverage(states, 'rumination', 'first');
    const lastRumination = computeRecentHalfAverage(states, 'rumination', 'last');

    const firstVulnerability = computeRecentHalfAverage(states, 'vulnerability', 'first');
    const lastVulnerability = computeRecentHalfAverage(states, 'vulnerability', 'last');

    const firstActivation = computeRecentHalfAverage(states, 'activation', 'first');
    const lastActivation = computeRecentHalfAverage(states, 'activation', 'last');

    function classifyTrend(first, last) {
      const diff = last - first;
      if (diff >= 0.12) return 'increasing';
      if (diff <= -0.12) return 'decreasing';
      return 'stable';
    }

    ruminationTrend = classifyTrend(firstRumination, lastRumination);
    vulnerabilityTrend = classifyTrend(firstVulnerability, lastVulnerability);
    activationTrend = classifyTrend(firstActivation, lastActivation);
  }

  const avgVulnerability = computeAverageScore(states, 'vulnerability');
  const avgRumination = computeAverageScore(states, 'rumination');
  const avgDispersion = computeAverageScore(states, 'dispersion');
  const avgAvoidance = computeAverageScore(states, 'avoidance');
  const avgUrgency = computeAverageScore(states, 'urgency');
  const avgActivation = computeAverageScore(states, 'activation');
  const avgEmotionalIntensity = computeAverageScore(states, 'emotional_intensity');

  let cognitiveLoadPressure = 'low';
  if (
    avgVulnerability >= 0.45 ||
    avgEmotionalIntensity >= 0.4 ||
    vulnerabilityTrend === 'increasing'
  ) {
    cognitiveLoadPressure = 'high';
  } else if (
    avgVulnerability >= 0.3 ||
    avgEmotionalIntensity >= 0.28
  ) {
    cognitiveLoadPressure = 'medium';
  }

  let recadrePressure = 'low';
  if (
    avgRumination >= 0.5 ||
    avgDispersion >= 0.45 ||
    avgAvoidance >= 0.45 ||
    repeated.count >= 3
  ) {
    recadrePressure = 'high';
  } else if (
    avgRumination >= 0.32 ||
    avgDispersion >= 0.3 ||
    avgAvoidance >= 0.3
  ) {
    recadrePressure = 'medium';
  }

  let actionPressure = 'low';
  if (
    avgActivation >= 0.5 ||
    avgUrgency >= 0.5 ||
    activationTrend === 'increasing'
  ) {
    actionPressure = 'high';
  } else if (
    avgActivation >= 0.32 ||
    avgUrgency >= 0.32
  ) {
    actionPressure = 'medium';
  }

  const cycleDetected =
    repeated.count >= 3 ||
    (
      states.length >= 3 &&
      (
        (dominant.dominant_state === 'rumination' && dominant.dominant_score >= 0.45) ||
        (dominant.dominant_state === 'vulnerability' && dominant.dominant_score >= 0.42) ||
        (dominant.dominant_state === 'dispersion' && dominant.dominant_score >= 0.4) ||
        (dominant.dominant_state === 'avoidance' && dominant.dominant_score >= 0.4)
      )
    );

  return {
    window_size: states.length,
    dominant_state: dominant.dominant_state,
    dominant_score: dominant.dominant_score,
    secondary_dominant_state: dominant.secondary_dominant_state,
    secondary_dominant_score: dominant.secondary_dominant_score,
    repeated_primary_state: repeated.state,
    repeated_primary_count: repeated.count,
    rumination_trend: ruminationTrend,
    vulnerability_trend: vulnerabilityTrend,
    activation_trend: activationTrend,
    cognitive_load_pressure: cognitiveLoadPressure,
    recadre_pressure: recadrePressure,
    action_pressure: actionPressure,
    cycle_detected: cycleDetected
  };
}

function getResponseDirectivesByMode(mode) {
  const responseDirectives = {
    grounding: {
      tone: 'calme, contenante, très rassurante, structurée',
      structure: 'phrases courtes, peu de surcharge, recentrage immédiat',
      recadrage_level: 'doux mais présent',
      priority: 'apaiser, stabiliser, sécuriser émotionnellement avant tout'
    },
    supportive: {
      tone: 'chaleureux, empathique, sincère, encourageant',
      structure: 'réponse fluide avec soutien émotionnel puis petite avancée concrète',
      recadrage_level: 'léger à modéré',
      priority: 'faire sentir qu’elle est comprise tout en l’aidant à avancer'
    },
    directive: {
      tone: 'clair, cadrant, motivant, concret',
      structure: 'étapes nettes, actionnable, sans blabla',
      recadrage_level: 'modéré à fort',
      priority: 'réduire le flou et remettre du mouvement'
    },
    firm_support: {
      tone: 'chaleureux mais lucide, franc, protecteur',
      structure: 'valider brièvement puis recadrer vite la boucle mentale',
      recadrage_level: 'fort mais bienveillant',
      priority: 'couper la rumination, revenir au réel, redonner du pouvoir d’action'
    },
    clarifying: {
      tone: 'naturel, intelligent, adaptable',
      structure: 'souple, utile, fluide',
      recadrage_level: 'adaptatif',
      priority: 'répondre juste et efficacement'
    }
  };

  return responseDirectives[mode] || responseDirectives.clarifying;
}

function applyBehaviorTrendToAnalysis(userStateAnalysis, behaviorTrend) {
  const analysis = JSON.parse(JSON.stringify(userStateAnalysis || {}));
  const trend = behaviorTrend || {};

  if (!analysis.state) {
    analysis.state = {
      vulnerability: 0,
      rumination: 0,
      dispersion: 0,
      avoidance: 0,
      urgency: 0,
      activation: 0,
      emotional_intensity: 0
    };
  }

  if ((Number(trend.window_size) || 0) < 3) {
    analysis.directives = getResponseDirectivesByMode(analysis.response_mode);
    return analysis;
  }

  const dominantState = trend.dominant_state || 'stable';
  const repeatedPrimaryState = trend.repeated_primary_state || null;
  const repeatedPrimaryCount = Number(trend.repeated_primary_count) || 0;

  if (
    dominantState === 'rumination' ||
    (repeatedPrimaryState === 'rumination' && repeatedPrimaryCount >= 2) ||
    trend.rumination_trend === 'increasing'
  ) {
    analysis.should_recadre = true;
    analysis.should_reduce_cognitive_load = true;

    if (analysis.response_mode !== 'grounding') {
      analysis.response_mode = 'firm_support';
    }
  }

  if (
    dominantState === 'vulnerability' ||
    trend.vulnerability_trend === 'increasing' ||
    trend.cognitive_load_pressure === 'high'
  ) {
    analysis.should_reduce_cognitive_load = true;

    if (analysis.response_mode === 'clarifying') {
      analysis.response_mode = 'supportive';
    }
  }

  if (
    dominantState === 'dispersion' ||
    dominantState === 'avoidance' ||
    (repeatedPrimaryState === 'dispersion' && repeatedPrimaryCount >= 2) ||
    (repeatedPrimaryState === 'avoidance' && repeatedPrimaryCount >= 2)
  ) {
    analysis.should_recadre = true;
    analysis.should_push_to_action = true;

    if (analysis.response_mode !== 'grounding' && analysis.response_mode !== 'firm_support') {
      analysis.response_mode = 'directive';
    }
  }

  if (
    dominantState === 'activation' ||
    dominantState === 'urgency' ||
    trend.action_pressure === 'high' ||
    trend.activation_trend === 'increasing'
  ) {
    analysis.should_push_to_action = true;

    if (analysis.response_mode === 'clarifying' || analysis.response_mode === 'supportive') {
      analysis.response_mode = 'directive';
    }
  }

  if (
    trend.cycle_detected &&
    analysis.response_mode === 'clarifying' &&
    analysis.state.rumination >= 0.35
  ) {
    analysis.response_mode = 'firm_support';
    analysis.should_recadre = true;
  }

  if (
    trend.recadre_pressure === 'high' &&
    analysis.response_mode === 'supportive' &&
    analysis.state.rumination >= 0.38
  ) {
    analysis.response_mode = 'firm_support';
    analysis.should_recadre = true;
  }

  if (
    trend.cognitive_load_pressure === 'high' &&
    analysis.state.vulnerability >= 0.55 &&
    analysis.state.emotional_intensity >= 0.38
  ) {
    analysis.response_mode = 'grounding';
    analysis.should_reduce_cognitive_load = true;
  }

  analysis.directives = getResponseDirectivesByMode(analysis.response_mode);

  return analysis;
}

function buildResponseProfile(userStateAnalysis, behaviorTrend = null) {
  const mode = userStateAnalysis.response_mode;
  const vulnerability = userStateAnalysis.state.vulnerability;
  const rumination = userStateAnalysis.state.rumination;
  const dispersion = userStateAnalysis.state.dispersion;
  const urgency = userStateAnalysis.state.urgency;
  const activation = userStateAnalysis.state.activation;
  const shouldReduceCognitiveLoad = userStateAnalysis.should_reduce_cognitive_load;
  const shouldPushToAction = userStateAnalysis.should_push_to_action;

  let maxWords = 170;
  let paragraphStyle = '2 à 4 petits paragraphes';
  let bulletPolicy = 'pas de liste sauf si c’est clairement utile';
  let actionStyle = 'pas forcément d’action finale obligatoire';
  let emotionalValidation = 'brève mais sincère';
  let questionCount = '0 ou 1 question maximum';
  let cognitiveLoad = 'modéré';
  let pacing = 'fluide';
  let forbiddenPatterns = [
    'pas de ton robotique',
    'pas de répétitions inutiles',
    'pas de généralités creuses',
    'pas de paraphrase inutile du message'
  ];

  if (mode === 'grounding') {
    maxWords = 95;
    paragraphStyle = '1 à 3 paragraphes très courts';
    bulletPolicy = 'évite les listes';
    actionStyle = 'donne une seule micro-action d’ancrage si utile';
    emotionalValidation = 'plus présente, contenante';
    questionCount = '0 ou 1 question très simple maximum';
    cognitiveLoad = 'très faible';
    pacing = 'lent, rassurant, stable';
    forbiddenPatterns.push('pas de plan complexe', 'pas de trop nombreuses options', 'pas de longue analyse');
  } else if (mode === 'firm_support') {
    maxWords = 115;
    paragraphStyle = '2 à 3 paragraphes courts';
    bulletPolicy = 'évite les listes sauf si une seule mini séquence utile';
    actionStyle = 'propose une action simple et immédiate';
    emotionalValidation = 'courte mais réelle';
    questionCount = '0 ou 1 question utile maximum';
    cognitiveLoad = 'très faible';
    pacing = 'net, rassurant, lucide';
    forbiddenPatterns.push('ne nourris pas la rumination', 'pas d’analyse interminable', 'pas d’exploration théorique de la boucle');
  } else if (mode === 'directive') {
    maxWords = activation >= 0.75 || urgency >= 0.75 ? 160 : 150;
    paragraphStyle = '1 à 3 blocs nets';
    bulletPolicy = 'liste courte autorisée si elle sert l’exécution';
    actionStyle = shouldPushToAction
      ? 'termine par une action claire, faisable maintenant'
      : 'action concrète si pertinente';
    emotionalValidation = 'courte';
    questionCount = '0 ou 1 question ciblée maximum';
    cognitiveLoad = dispersion >= 0.6 ? 'faible à modéré' : 'modéré';
    pacing = 'franc, propre, orienté mouvement';
    forbiddenPatterns.push('pas de 10 options', 'pas de blabla motivationnel');
  } else if (mode === 'supportive') {
    maxWords = 135;
    paragraphStyle = '2 à 4 petits paragraphes';
    bulletPolicy = 'évite les listes longues';
    actionStyle = 'propose une petite avancée concrète';
    emotionalValidation = 'présente';
    questionCount = '1 question maximum';
    cognitiveLoad = shouldReduceCognitiveLoad ? 'très faible' : 'faible à modéré';
    pacing = 'doux, clair, soutenant';
  }

  if (vulnerability >= 0.6) {
    maxWords = Math.min(maxWords, 110);
    cognitiveLoad = 'très faible';
  }

  if (rumination >= 0.8) {
    maxWords = Math.min(maxWords, 105);
    forbiddenPatterns.push('pas d’exploration théorique de la boucle');
  }

  if (urgency >= 0.75 && mode !== 'grounding') {
    maxWords = Math.min(maxWords, 145);
  }

  if (behaviorTrend && (Number(behaviorTrend.window_size) || 0) >= 3) {
    if (behaviorTrend.cognitive_load_pressure === 'high') {
      maxWords = Math.min(maxWords, 105);
      cognitiveLoad = 'très faible';
      questionCount = '0 ou 1 question très simple maximum';
      bulletPolicy = 'évite les listes';
    } else if (behaviorTrend.cognitive_load_pressure === 'medium') {
      maxWords = Math.min(maxWords, 125);
      cognitiveLoad = cognitiveLoad === 'très faible' ? 'très faible' : 'faible';
    }

    if (behaviorTrend.recadre_pressure === 'high') {
      forbiddenPatterns.push('ne laisse pas la réponse devenir trop molle');
    }

    if (behaviorTrend.action_pressure === 'high' && mode !== 'grounding') {
      actionStyle = 'termine par une action claire, simple et faisable maintenant';
      questionCount = '0 ou 1 question ciblée maximum';
    }

    if (
      behaviorTrend.cycle_detected &&
      (behaviorTrend.dominant_state === 'rumination' || behaviorTrend.repeated_primary_state === 'rumination')
    ) {
      maxWords = Math.min(maxWords, 105);
      forbiddenPatterns.push('ne valide pas longuement la boucle');
    }

    if (
      behaviorTrend.cycle_detected &&
      (behaviorTrend.dominant_state === 'dispersion' || behaviorTrend.dominant_state === 'avoidance')
    ) {
      bulletPolicy = mode === 'directive'
        ? 'liste très courte autorisée si elle sert l’exécution'
        : bulletPolicy;
      actionStyle = 'termine par une action unique, nette et immédiate';
    }
  }

  return {
    max_words: maxWords,
    paragraph_style: paragraphStyle,
    bullet_policy: bulletPolicy,
    action_style: actionStyle,
    emotional_validation: emotionalValidation,
    question_count: questionCount,
    cognitive_load: cognitiveLoad,
    pacing,
    forbidden_patterns: [...new Set(forbiddenPatterns)]
  };
}

function buildCoreSystemPrompt() {
  return [
    'Tu es Nyra.',
    'Réponds avec chaleur, justesse, lucidité et naturel.',
    'Priorités : comprendre l’état réel, réguler si besoin, recadrer si utile, aider à avancer concrètement.',
    'Style : humain, fluide, précis, sans ton robotique.',
    'Ne nourris pas la rumination.',
    'Si vulnérabilité forte : stabilise d’abord.',
    'Si dispersion : recentre.',
    'Si action nécessaire : donne du concret.',
    'Utilise la mémoire seulement si elle aide vraiment.',
    'N’invente jamais de souvenirs ou de faits.',
    'N’explique pas tes mécanismes internes.'
  ].join('\n');
}

function buildBehaviorPrompt(userStateAnalysis) {
  const {
    state,
    primary_state,
    secondary_state,
    response_mode,
    should_recadre,
    should_reduce_cognitive_load,
    should_push_to_action,
    directives
  } = userStateAnalysis;

  return [
    'STATE',
    `p=${primary_state}`,
    `s=${secondary_state || 'none'}`,
    `mode=${response_mode}`,
    `vuln=${state.vulnerability}`,
    `rum=${state.rumination}`,
    `disp=${state.dispersion}`,
    `avoid=${state.avoidance}`,
    `urg=${state.urgency}`,
    `act=${state.activation}`,
    `int=${state.emotional_intensity}`,
    `recadre=${boolToFlag(should_recadre)}`,
    `low_cognitive_load=${boolToFlag(should_reduce_cognitive_load)}`,
    `push_action=${boolToFlag(should_push_to_action)}`,
    `tone=${directives.tone}`,
    `structure=${directives.structure}`,
    `priority=${directives.priority}`
  ].join(' | ');
}

function buildBehaviorTrendPrompt(behaviorTrend) {
  return [
    'TREND',
    `window=${behaviorTrend.window_size}`,
    `dominant=${behaviorTrend.dominant_state}`,
    `secondary=${behaviorTrend.secondary_dominant_state || 'none'}`,
    `repeat=${behaviorTrend.repeated_primary_state || 'none'}:${behaviorTrend.repeated_primary_count}`,
    `rum_trend=${behaviorTrend.rumination_trend}`,
    `vuln_trend=${behaviorTrend.vulnerability_trend}`,
    `act_trend=${behaviorTrend.activation_trend}`,
    `cognitive_pressure=${behaviorTrend.cognitive_load_pressure}`,
    `recadre_pressure=${behaviorTrend.recadre_pressure}`,
    `action_pressure=${behaviorTrend.action_pressure}`,
    `cycle=${boolToFlag(behaviorTrend.cycle_detected)}`,
    'Apply trend silently. If cycle=yes, be less naive and more structuring.'
  ].join(' | ');
}

function buildExecutionPrompt(responseProfile) {
  return [
    'EXECUTION',
    `max_words=${responseProfile.max_words}`,
    `paragraphs=${responseProfile.paragraph_style}`,
    `bullets=${responseProfile.bullet_policy}`,
    `action=${responseProfile.action_style}`,
    `validation=${responseProfile.emotional_validation}`,
    `questions=${responseProfile.question_count}`,
    `cognitive_load=${responseProfile.cognitive_load}`,
    `pacing=${responseProfile.pacing}`,
    `forbidden=${responseProfile.forbidden_patterns.join('; ')}`
  ].join(' | ');
}

function buildMemoryPrompt(relevantMemory) {
  const identity = relevantMemory.identity || {};
  const style = relevantMemory.conversation_style || {};

  const compactMemory = {
    identity: {
      preferred_name: identity.preferred_name || identity.first_name || null,
      language_primary: identity.language_primary || null
    },
    conversation_style: {
      prefers_structure: Boolean(style.prefers_structure),
      prefers_gentle_reframing: Boolean(style.prefers_gentle_reframing),
      needs_clarity: Boolean(style.needs_clarity),
      dislikes_overwhelm: Boolean(style.dislikes_overwhelm)
    },
    active_contexts: labelsOnly(relevantMemory.top_active_contexts, 3),
    needs: labelsOnly(relevantMemory.top_needs, 3),
    risk_patterns: labelsOnly(relevantMemory.top_risk_patterns, 3),
    support_patterns: labelsOnly(relevantMemory.top_support_patterns, 3),
    emotional_patterns: labelsOnly(relevantMemory.top_emotional_patterns, 3),
    regulation_strategies: labelsOnly(relevantMemory.top_regulation_strategies, 3),
    projects: labelsOnly(relevantMemory.top_projects, 3)
  };

  return `MEMORY ${JSON.stringify(compactMemory)}`;
}

function normalizeReminderActionId(action) {
  const normalized = normalizeText(action).toLowerCase();

  if (normalized === 'done' || normalized === 'fait') return 'done';
  if (normalized === 'snooze' || normalized === 'plus_tard' || normalized === 'plus tard') return 'snooze';
  if (normalized === 'ignore' || normalized === 'ignorer') return 'ignore';

  return '';
}

function getReminderEventStore() {
  return readJsonSafe(REMINDER_EVENTS_FILE, createEmptyReminderEventStore());
}

function saveReminderEventStore(store) {
  writeJsonSafe(REMINDER_EVENTS_FILE, store);
}

function cleanupResolvedReminderEvents(store, maxResolvedToKeep = 50) {
  const pending = [];
  const resolved = [];

  for (const item of safeArray(store.pending)) {
    if (item?.status === 'pending') {
      pending.push(item);
    } else {
      resolved.push(item);
    }
  }

  const trimmedResolved = resolved
    .sort((a, b) => {
      const aTime = new Date(a?.resolved_at || a?.updated_at || 0).getTime();
      const bTime = new Date(b?.resolved_at || b?.updated_at || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, maxResolvedToKeep);

  return {
    pending: [...pending, ...trimmedResolved]
  };
}

function upsertPendingReminderEvent(payload) {
  const store = getReminderEventStore();
  const reminderId = normalizeText(payload?.reminder_id || '');
  const title = normalizeText(payload?.title || '');
  const message = normalizeText(payload?.message || title);
  const reminderTime = normalizeText(payload?.reminder_time || '');
  const type = normalizeText(payload?.type || 'REMINDER_DUE') || 'REMINDER_DUE';
  const actions = safeArray(payload?.actions);
  const voiceEnabled = Boolean(payload?.voice_enabled);
  const voiceText = normalizeText(payload?.voice_text || message);

  if (!reminderId || !title) {
    return {
      ok: false,
      error: 'reminder_id ou title manquant'
    };
  }

  const existingIndex = safeArray(store.pending).findIndex(
    (item) => item?.reminder_id === reminderId && item?.status === 'pending'
  );

  const baseEvent = {
    event_id: existingIndex >= 0
      ? store.pending[existingIndex].event_id
      : crypto.randomUUID(),
    type,
    reminder_id: reminderId,
    title,
    message,
    reminder_time: reminderTime,
    actions,
    voice_enabled: voiceEnabled,
    voice_text: voiceText,
    status: 'pending',
    triggered_at: nowIso(),
    updated_at: nowIso()
  };

  if (existingIndex >= 0) {
    store.pending[existingIndex] = {
      ...store.pending[existingIndex],
      ...baseEvent
    };
  } else {
    store.pending.push(baseEvent);
  }

  saveReminderEventStore(cleanupResolvedReminderEvents(store));

  return {
    ok: true,
    event: baseEvent
  };
}

function getPendingReminderEvents() {
  const store = getReminderEventStore();

  return safeArray(store.pending)
    .filter((item) => item?.status === 'pending')
    .sort((a, b) => {
      const aTime = new Date(a?.triggered_at || 0).getTime();
      const bTime = new Date(b?.triggered_at || 0).getTime();
      return bTime - aTime;
    });
}

function resolvePendingReminderEvent(reminderId, actionId) {
  const store = getReminderEventStore();
  const normalizedReminderId = normalizeText(reminderId);
  let resolvedEvent = null;

  store.pending = safeArray(store.pending).map((item) => {
    if (item?.reminder_id !== normalizedReminderId || item?.status !== 'pending') {
      return item;
    }

    resolvedEvent = {
      ...item,
      status: 'resolved',
      resolved_action: actionId,
      resolved_at: nowIso(),
      updated_at: nowIso()
    };

    return resolvedEvent;
  });

  saveReminderEventStore(cleanupResolvedReminderEvents(store));

  return resolvedEvent;
}

function addMinutesToNowIso(minutes) {
  const safeMinutes = clamp(Number(minutes) || 20, 1, 1440);
  return new Date(Date.now() + safeMinutes * 60 * 1000).toISOString();
}

async function updateReminderAfterActionInSupabase(reminderId, actionId, options = {}) {
  if (!SUPABASE_ENABLED) {
    return {
      ok: false,
      reason: 'supabase_disabled'
    };
  }

  try {
    const { data: reminder, error: selectError } = await supabase
      .from('reminders')
      .select('*')
      .eq('id', reminderId)
      .limit(1)
      .maybeSingle();

    if (selectError) {
      console.error('❌ Supabase select reminder action:', selectError.message);
      return {
        ok: false,
        reason: selectError.message
      };
    }

    if (!reminder) {
      return {
        ok: false,
        reason: 'reminder_not_found'
      };
    }

    const now = nowIso();
    const scheduleType = normalizeText(reminder.schedule_type || '').toLowerCase();
    const updatePayload = {
      updated_at: now
    };

    if (actionId === 'done') {
      if (scheduleType === 'recurring') {
        updatePayload.last_triggered_at = now;
        updatePayload.snoozed_until = null;
      } else {
        updatePayload.last_triggered_at = now;
        updatePayload.completed_at = now;
        updatePayload.status = 'done';
        updatePayload.snoozed_until = null;
      }
    } else if (actionId === 'snooze') {
      updatePayload.last_triggered_at = now;
      updatePayload.snoozed_until = addMinutesToNowIso(options.snooze_minutes || 20);
      updatePayload.status = 'active';
    } else if (actionId === 'ignore') {
      updatePayload.last_triggered_at = now;
    } else {
      return {
        ok: false,
        reason: 'invalid_action'
      };
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from('reminders')
      .update(updatePayload)
      .eq('id', reminderId)
      .select('*');

    if (updateError) {
      console.error('❌ Supabase update reminder action:', updateError.message);
      return {
        ok: false,
        reason: updateError.message
      };
    }

    return {
      ok: true,
      reminder: updatedRows?.[0] || null,
      applied_update: updatePayload
    };
  } catch (error) {
    console.error('❌ updateReminderAfterActionInSupabase catch:', error.message);
    return {
      ok: false,
      reason: error.message
    };
  }
}

// =========================
// SUPABASE HELPERS
// =========================

async function getLatestSingletonRow(tableName) {
  if (!SUPABASE_ENABLED) return null;

  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1);

    if (error) {
      console.error(`❌ Supabase select ${tableName}:`, error.message);
      return null;
    }

    return data?.[0] || null;
  } catch (error) {
    console.error(`❌ Supabase select catch ${tableName}:`, error.message);
    return null;
  }
}

async function saveSingletonRow(tableName, payload) {
  if (!SUPABASE_ENABLED) return false;

  try {
    const latest = await getLatestSingletonRow(tableName);

    if (latest?.id) {
      const { error } = await supabase
        .from(tableName)
        .update({
          ...payload,
          updated_at: nowIso()
        })
        .eq('id', latest.id);

      if (error) {
        console.error(`❌ Supabase update ${tableName}:`, error.message);
        return false;
      }

      return true;
    }

    const { error } = await supabase
      .from(tableName)
      .insert([
        {
          ...payload,
          updated_at: nowIso()
        }
      ]);

    if (error) {
      console.error(`❌ Supabase insert ${tableName}:`, error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`❌ Supabase save catch ${tableName}:`, error.message);
    return false;
  }
}

async function getRecentConversationMemory(limit = 10) {
  const localMemory = readJsonSafe(MEMORY_FILE, { messages: [] });

  if (!SUPABASE_ENABLED) {
    return safeArray(localMemory.messages).slice(-limit);
  }

  try {
    const { data, error } = await supabase
      .from('nyra_conversations')
      .select('id, sender, text_content, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('❌ Supabase conversations select:', error.message);
      return safeArray(localMemory.messages).slice(-limit);
    }

    return safeArray(data)
      .map((row) => ({
        id: row.id,
        sender: row.sender,
        text: row.text_content,
        created_at: row.created_at
      }))
      .reverse();
  } catch (error) {
    console.error('❌ Supabase conversations catch:', error.message);
    return safeArray(localMemory.messages).slice(-limit);
  }
}

async function saveRecentConversationMessage(sender, text) {
  const memory = readJsonSafe(MEMORY_FILE, { messages: [] });
  const messages = safeArray(memory.messages);

  messages.push({
    id: crypto.randomUUID(),
    sender,
    text: normalizeText(text),
    created_at: nowIso()
  });

  const trimmed = messages.slice(-40);
  writeJsonSafe(MEMORY_FILE, { messages: trimmed });

  if (!SUPABASE_ENABLED) return;

  try {
    const { error } = await supabase
      .from('nyra_conversations')
      .insert([
        {
          sender,
          text_content: normalizeText(text),
          created_at: nowIso()
        }
      ]);

    if (error) {
      console.error('❌ Supabase insert nyra_conversations:', error.message);
    }
  } catch (error) {
    console.error('❌ Supabase insert catch nyra_conversations:', error.message);
  }
}

async function summarizeRecentConversationForPrompt(limit = 4) {
  const recent = await getRecentConversationMemory(limit);
  return recent
    .map((m) => `${m.sender === 'user' ? 'U' : 'N'}: ${truncateText(m.text, 180)}`)
    .join('\n');
}

async function getBehaviorMemory() {
  const localBehavior = readJsonSafe(MEMORY_BEHAVIOR_FILE, createEmptyBehaviorMemory());

  if (!SUPABASE_ENABLED) {
    return localBehavior;
  }

  const latest = await getLatestSingletonRow('nyra_behavior_memory');
  if (!latest) return localBehavior;

  return {
    recent_states: safeArray(latest.recent_states),
    updated_at: latest.updated_at || null
  };
}

async function saveBehaviorStateSnapshot(snapshot, maxStates = 8) {
  const memory = await getBehaviorMemory();
  const recentStates = safeArray(memory.recent_states);

  recentStates.push(snapshot);

  const trimmed = recentStates.slice(-maxStates);

  const payload = {
    recent_states: trimmed,
    updated_at: nowIso()
  };

  writeJsonSafe(MEMORY_BEHAVIOR_FILE, payload);

  if (SUPABASE_ENABLED) {
    await saveSingletonRow('nyra_behavior_memory', payload);
  }
}

async function getStructuredMemory() {
  const localStructured = readJsonSafe(MEMORY_STRUCTURED_FILE, createEmptyStructuredMemory());

  if (!SUPABASE_ENABLED) {
    return localStructured;
  }

  const latest = await getLatestSingletonRow('nyra_structured_memory');
  if (!latest?.memory || typeof latest.memory !== 'object') {
    return localStructured;
  }

  return latest.memory;
}

async function saveStructuredMemory(memory) {
  writeJsonSafe(MEMORY_STRUCTURED_FILE, memory);

  if (SUPABASE_ENABLED) {
    await saveSingletonRow('nyra_structured_memory', {
      memory
    });
  }
}

async function getSemanticSummary() {
  const localSummary = readJsonSafe(MEMORY_SUMMARY_FILE, createEmptySemanticSummary());

  if (!SUPABASE_ENABLED) {
    return localSummary;
  }

  const latest = await getLatestSingletonRow('nyra_semantic_summary');
  if (!latest) return localSummary;

  return {
    summary: latest.summary || '',
    updated_at: latest.updated_at || null
  };
}

async function saveSemanticSummary(summaryPayload) {
  writeJsonSafe(MEMORY_SUMMARY_FILE, summaryPayload);

  if (SUPABASE_ENABLED) {
    await saveSingletonRow('nyra_semantic_summary', {
      summary: summaryPayload.summary || ''
    });
  }
}

async function getTopicMemory() {
  const localTopics = readJsonSafe(MEMORY_TOPICS_FILE, createEmptyTopicMemory());

  if (!SUPABASE_ENABLED) {
    return localTopics;
  }

  const latest = await getLatestSingletonRow('nyra_topic_memory');
  if (!latest) return localTopics;

  return {
    topics: safeArray(latest.topics),
    updated_at: latest.updated_at || null
  };
}

async function saveTopicMemory(memory) {
  writeJsonSafe(MEMORY_TOPICS_FILE, memory);

  if (SUPABASE_ENABLED) {
    await saveSingletonRow('nyra_topic_memory', {
      topics: safeArray(memory.topics)
    });
  }
}

function detectTopic(message) {
  const text = normalizeText(message).toLowerCase();

  if (
    text.includes('clem') ||
    text.includes('clément') ||
    text.includes('clement') ||
    text.includes('relation')
  ) {
    return 'relationship_clement';
  }

  if (
    text.includes('argent') ||
    text.includes('money') ||
    text.includes('€') ||
    text.includes('payer') ||
    text.includes('revenu')
  ) {
    return 'money';
  }

  if (
    text.includes('nyra') ||
    text.includes('app') ||
    text.includes('backend') ||
    text.includes('code') ||
    text.includes('voiceflow')
  ) {
    return 'project_nyra';
  }

  if (
    text.includes('ma fille') ||
    text.includes('mes enfants')
  ) {
    return 'children';
  }

  return 'generic';
}

function sanitizeStateScore(value, fallback = 0) {
  const num = Number(value);
  if (Number.isNaN(num)) return clamp(Number(fallback) || 0, 0, 1);
  return clamp(Number(num.toFixed(3)), 0, 1);
}

function normalizePrimaryState(value, fallback = 'stable') {
  const allowed = new Set([
    'stable',
    'vulnerability',
    'rumination',
    'dispersion',
    'avoidance',
    'urgency',
    'activation',
    'emotional_intensity'
  ]);

  const normalized = normalizeText(value).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeSecondaryState(value) {
  if (value === null || value === undefined || value === '') return null;
  return normalizePrimaryState(value, null);
}

function normalizeResponseMode(value, fallback = 'clarifying') {
  const allowed = new Set([
    'grounding',
    'supportive',
    'directive',
    'firm_support',
    'clarifying'
  ]);

  const normalized = normalizeText(value).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeTopicLabel(value, fallback = 'generic') {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function buildCompactStateMemoryContext(structuredMemory) {
  const relevant = extractRelevantMemory(structuredMemory);
  const identity = relevant.identity || {};
  const style = relevant.conversation_style || {};

  return {
    identity: {
      preferred_name: identity.preferred_name || identity.first_name || null,
      language_primary: identity.language_primary || null
    },
    conversation_style: {
      prefers_structure: Boolean(style.prefers_structure),
      prefers_gentle_reframing: Boolean(style.prefers_gentle_reframing),
      needs_clarity: Boolean(style.needs_clarity),
      dislikes_overwhelm: Boolean(style.dislikes_overwhelm)
    },
    top_active_contexts: relevant.top_active_contexts.slice(0, 3).map((x) => x.label),
    top_needs: relevant.top_needs.slice(0, 3).map((x) => x.label),
    top_risk_patterns: relevant.top_risk_patterns.slice(0, 3).map((x) => x.label),
    top_support_patterns: relevant.top_support_patterns.slice(0, 3).map((x) => x.label),
    top_emotional_patterns: relevant.top_emotional_patterns.slice(0, 3).map((x) => x.label)
  };
}

function validateLLMUserStateAnalysis(payload, fallbackAnalysis, fallbackTopic) {
  const fallback = fallbackAnalysis || analyzeUserState('', createEmptyStructuredMemory());

  const statePayload = payload?.state || {};

  const state = {
    vulnerability: sanitizeStateScore(statePayload.vulnerability, fallback.state.vulnerability),
    rumination: sanitizeStateScore(statePayload.rumination, fallback.state.rumination),
    dispersion: sanitizeStateScore(statePayload.dispersion, fallback.state.dispersion),
    avoidance: sanitizeStateScore(statePayload.avoidance, fallback.state.avoidance),
    urgency: sanitizeStateScore(statePayload.urgency, fallback.state.urgency),
    activation: sanitizeStateScore(statePayload.activation, fallback.state.activation),
    emotional_intensity: sanitizeStateScore(
      statePayload.emotional_intensity,
      fallback.state.emotional_intensity
    )
  };

  const primaryState = normalizePrimaryState(payload?.primary_state, fallback.primary_state);
  let secondaryState = normalizeSecondaryState(payload?.secondary_state);

  if (!secondaryState && fallback.secondary_state) {
    secondaryState = normalizeSecondaryState(fallback.secondary_state);
  }

  const responseMode = normalizeResponseMode(payload?.response_mode, fallback.response_mode);

  return {
    topic: normalizeTopicLabel(payload?.topic, fallbackTopic || 'generic'),
    state,
    primary_state: primaryState,
    secondary_state: secondaryState,
    response_mode: responseMode,
    should_recadre:
      typeof payload?.should_recadre === 'boolean'
        ? payload.should_recadre
        : fallback.should_recadre,
    should_reduce_cognitive_load:
      typeof payload?.should_reduce_cognitive_load === 'boolean'
        ? payload.should_reduce_cognitive_load
        : fallback.should_reduce_cognitive_load,
    should_push_to_action:
      typeof payload?.should_push_to_action === 'boolean'
        ? payload.should_push_to_action
        : fallback.should_push_to_action,
    directives: getResponseDirectivesByMode(responseMode)
  };
}

function getStateRanking(state) {
  return Object.entries(state || {})
    .map(([key, value]) => ({
      key,
      score: Number(value) || 0
    }))
    .sort((a, b) => b.score - a.score);
}

function getWordCount(text) {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

function hasContrastMarkers(text) {
  const lower = normalizeText(text).toLowerCase();
return hasAny(lower, [
  'mais',
  'sauf que',
  'en meme temps',
  "d'un cote",
  'je sais pas',
  'je ne sais pas',
  "j'hesite",
  'je suis partagee',
  'je suis partage'
]);
}

function shouldUseLLMStateAnalysis(userMessage, localAnalysis) {
  return {
    use_llm: false,
    reason: 'fast_mode_disabled_llm_analysis',
    confidence: 1
  };
}

async function analyzeUserStateWithLLM(userMessage, structuredMemory) {
  const fallbackTopic = detectTopic(userMessage);
  const fallbackAnalysis = analyzeUserState(userMessage, structuredMemory);
  const compactMemory = buildCompactStateMemoryContext(structuredMemory);

  const prompt = [
    'Analyse le message utilisateur pour piloter un assistant émotionnel/personnalisé.',
    'Renvoie uniquement une analyse structurée du message actuel.',
    'Utilise la mémoire seulement comme aide légère, sans surinterpréter.',
    'Règles :',
    '- topic = sujet principal concret',
    '- state = scores entre 0 et 1',
    '- primary_state = état dominant',
    '- secondary_state = état secondaire pertinent ou null',
    '- response_mode ∈ grounding | supportive | directive | firm_support | clarifying',
    '- should_recadre = true si la réponse doit recadrer / couper une boucle / remettre du cadre',
    '- should_reduce_cognitive_load = true si la réponse doit rester très simple mentalement',
    '- should_push_to_action = true si la réponse doit pousser à une action claire',
    `Mémoire utile: ${JSON.stringify(compactMemory)}`,
    `Topic fallback: ${fallbackTopic}`,
    `Message: ${userMessage}`
  ].join('\n');

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_ANALYSIS_MODEL,
      temperature: 0.1,
      max_tokens: 220,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'nyra_user_state_analysis',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              topic: {
                type: 'string'
              },
              state: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  vulnerability: { type: 'number' },
                  rumination: { type: 'number' },
                  dispersion: { type: 'number' },
                  avoidance: { type: 'number' },
                  urgency: { type: 'number' },
                  activation: { type: 'number' },
                  emotional_intensity: { type: 'number' }
                },
                required: [
                  'vulnerability',
                  'rumination',
                  'dispersion',
                  'avoidance',
                  'urgency',
                  'activation',
                  'emotional_intensity'
                ]
              },
              primary_state: { type: 'string' },
              secondary_state: {
                anyOf: [
                  { type: 'string' },
                  { type: 'null' }
                ]
              },
              response_mode: { type: 'string' },
              should_recadre: { type: 'boolean' },
              should_reduce_cognitive_load: { type: 'boolean' },
              should_push_to_action: { type: 'boolean' }
            },
            required: [
              'topic',
              'state',
              'primary_state',
              'secondary_state',
              'response_mode',
              'should_recadre',
              'should_reduce_cognitive_load',
              'should_push_to_action'
            ]
          }
        }
      },
      messages: [
        {
          role: 'system',
          content: 'Tu es un moteur d’analyse d’état utilisateur. Tu réponds uniquement en JSON valide, strict, sans texte autour.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const content = completion.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);

    return validateLLMUserStateAnalysis(parsed, fallbackAnalysis, fallbackTopic);
  } catch (error) {
    console.error('❌ Erreur analyzeUserStateWithLLM:', error.message);
    throw error;
  }
}

async function updateTopicMemory(topic, primaryState) {
  const memory = await getTopicMemory();

  let topicEntry = safeArray(memory.topics).find((t) => t.topic === topic);

  if (!topicEntry) {
    topicEntry = {
      topic,
      last_seen_at: nowIso(),
      occurrences: 0,
      states: {
        rumination: 0,
        vulnerability: 0,
        urgency: 0,
        avoidance: 0,
        activation: 0,
        dispersion: 0
      },
      last_state: null
    };

    memory.topics.push(topicEntry);
  }

  topicEntry.occurrences += 1;
  topicEntry.last_seen_at = nowIso();
  topicEntry.last_state = primaryState;

  if (topicEntry.states[primaryState] !== undefined) {
    topicEntry.states[primaryState] += 1;
  }

  await saveTopicMemory({
    topics: memory.topics,
    updated_at: nowIso()
  });
}

async function extractStructuredMemoryFromMessage(userMessage) {
  const currentStructured = await getStructuredMemory();

  const prompt = `
Tu extrais uniquement la mémoire durable ou semi-durable utile d’un message utilisateur.

Tu dois répondre en JSON strict, sans texte autour.

Contraintes :
- ne garde que ce qui a une vraie valeur future
- si une info n’est pas utile à mémoriser, n’inclus rien
- utilise des objets pondérés pour les listes concernées :
  { "label": "...", "weight": 0.6, "occurrences": 1, "last_seen_at": "${nowIso()}" }

Structure attendue :
{
  "identity": {},
  "preferences": [],
  "projects": [],
  "constraints": [],
  "emotional_patterns": [],
  "relationships": [],
  "active_contexts": [],
  "decisions": [],
  "insights": [],
  "conversation_style": {},
  "triggers": [],
  "needs": [],
  "regulation_strategies": [],
  "risk_patterns": [],
  "support_patterns": []
}

Contexte mémoire existant :
${JSON.stringify(extractRelevantMemory(currentStructured), null, 2)}

Message utilisateur :
${userMessage}
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Tu es un moteur d’extraction mémoire ultra strict. Tu réponds uniquement en JSON valide.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const content = completion.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);

    const normalized = {
      identity: parsed.identity || {},
      preferences: safeArray(parsed.preferences),
      projects: safeArray(parsed.projects),
      constraints: safeArray(parsed.constraints),
      emotional_patterns: safeArray(parsed.emotional_patterns),
      relationships: safeArray(parsed.relationships),
      active_contexts: safeArray(parsed.active_contexts),
      decisions: safeArray(parsed.decisions),
      insights: safeArray(parsed.insights),
      conversation_style: parsed.conversation_style || {},
      triggers: safeArray(parsed.triggers),
      needs: safeArray(parsed.needs),
      regulation_strategies: safeArray(parsed.regulation_strategies),
      risk_patterns: safeArray(parsed.risk_patterns),
      support_patterns: safeArray(parsed.support_patterns)
    };

    return normalized;
  } catch (error) {
    console.error('❌ Erreur extraction mémoire structurée:', error.message);
    return createEmptyStructuredMemory();
  }
}

async function updateSemanticSummaryAsync() {
  try {
    const shortMemory = await getRecentConversationMemory(20);
    const existingSummary = await getSemanticSummary();

    if (shortMemory.length === 0) return;

    const prompt = `
Tu mets à jour une mémoire sémantique synthétique.

Ancien résumé :
${existingSummary.summary || ''}

Derniers messages :
${shortMemory.map((m) => `${m.sender}: ${m.text}`).join('\n')}

Objectif :
- produire un résumé utile, compact, à long terme
- garder seulement ce qui aide à comprendre durablement l’utilisatrice, ses projets, ses enjeux, ses patterns, ses préférences
- éviter le bavard
- max 300 mots
`.trim();

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'Tu rédiges une mémoire sémantique concise et utile.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const summary = normalizeText(completion.choices?.[0]?.message?.content || '');

    await saveSemanticSummary({
      summary,
      updated_at: nowIso()
    });
  } catch (error) {
    console.error('❌ Erreur updateSemanticSummaryAsync:', error.message);
  }
}

async function processPostResponseMemoryUpdate(userMessage, currentStructuredMemory) {
  try {
    const extractedStructured = await extractStructuredMemoryFromMessage(userMessage);
    const mergedStructured = mergeStructuredMemory(currentStructuredMemory, extractedStructured);
    await saveStructuredMemory(mergedStructured);
    await updateSemanticSummaryAsync();
  } catch (error) {
    console.error('❌ Erreur processPostResponseMemoryUpdate:', error.message);
  }
}

function optimizeTextForSpeech(text) {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/•/g, '-')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function audioCachePathForText(text) {
  const hash = crypto.createHash('md5').update(text).digest('hex');
  return path.join(AUDIO_CACHE_DIR, `${hash}.mp3`);
}

async function generateSpeech(text) {
  const cleanText = optimizeTextForSpeech(text);
  const cachePath = audioCachePathForText(cleanText);

  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    throw new Error('Configuration ElevenLabs manquante');
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({
      text: cleanText,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.85,
        style: 0.28,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs error: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(cachePath, audioBuffer);

  return audioBuffer;
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    app: 'Nyra backend',
    status: 'running',
    timestamp: nowIso(),
    supabase_enabled: SUPABASE_ENABLED
  });
});

app.get('/memory', async (req, res) => {
  const memory = await getRecentConversationMemory(40);
  res.json({ messages: memory });
});

app.get('/memory/structured', async (req, res) => {
  const structured = await getStructuredMemory();
  res.json(structured);
});

app.get('/memory/behavior', async (req, res) => {
  const behavior = await getBehaviorMemory();
  res.json(behavior);
});

app.get('/memory/topics', async (req, res) => {
  const topics = await getTopicMemory();
  res.json(topics);
});

app.get('/test-db', async (req, res) => {
  if (!SUPABASE_ENABLED) {
    return res.status(400).json({
      ok: false,
      error: 'Supabase non configuré'
    });
  }

  try {
    const { data, error } = await supabase
      .from('nyra_conversations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      throw error;
    }

    return res.json({
      ok: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/memory/reset', async (req, res) => {
  const emptyMemory = { messages: [] };
  const emptySummary = createEmptySemanticSummary();
  const emptyStructured = createEmptyStructuredMemory();
  const emptyBehavior = createEmptyBehaviorMemory();
  const emptyTopics = createEmptyTopicMemory();
  const emptyReminderEvents = createEmptyReminderEventStore();

  writeJsonSafe(MEMORY_FILE, emptyMemory);
  writeJsonSafe(MEMORY_SUMMARY_FILE, emptySummary);
  writeJsonSafe(MEMORY_STRUCTURED_FILE, emptyStructured);
  writeJsonSafe(MEMORY_BEHAVIOR_FILE, emptyBehavior);
  writeJsonSafe(MEMORY_TOPICS_FILE, emptyTopics);
  writeJsonSafe(REMINDER_EVENTS_FILE, emptyReminderEvents);

  if (SUPABASE_ENABLED) {
    try {
      await supabase.from('nyra_conversations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await saveSemanticSummary(emptySummary);
      await saveStructuredMemory(emptyStructured);
      await saveSingletonRow('nyra_behavior_memory', emptyBehavior);
      await saveTopicMemory(emptyTopics);
    } catch (error) {
      console.error('❌ Erreur reset Supabase:', error.message);
    }
  }

  res.json({
    ok: true,
    message: 'Mémoire réinitialisée'
  });
});

app.post('/reminder-trigger', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = upsertPendingReminderEvent(payload);

    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error || 'Payload reminder invalide'
      });
    }

    return res.json({
      ok: true,
      queued: true,
      event: result.event
    });
  } catch (error) {
    console.error('❌ /reminder-trigger error:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message || 'Erreur interne reminder-trigger'
    });
  }
});

app.get('/reminders/pending', async (req, res) => {
  try {
    const pending = getPendingReminderEvents();

    return res.json({
      ok: true,
      count: pending.length,
      reminders: pending
    });
  } catch (error) {
    console.error('❌ /reminders/pending error:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message || 'Erreur récupération reminders pending'
    });
  }
});

app.post('/reminders/:reminderId/action', async (req, res) => {
  try {
    const reminderId = normalizeText(req.params?.reminderId || '');
    const action = normalizeReminderActionId(req.body?.action || '');
    const snoozeMinutes = clamp(Number(req.body?.snooze_minutes) || 20, 1, 1440);

    if (!reminderId) {
      return res.status(400).json({
        ok: false,
        error: 'reminderId manquant'
      });
    }

    if (!action) {
      return res.status(400).json({
        ok: false,
        error: 'action invalide'
      });
    }

    const resolvedEvent = resolvePendingReminderEvent(reminderId, action);
    const updateResult = await updateReminderAfterActionInSupabase(reminderId, action, {
      snooze_minutes: snoozeMinutes
    });

    return res.json({
      ok: true,
      reminder_id: reminderId,
      action,
      snooze_minutes: action === 'snooze' ? snoozeMinutes : null,
      pending_event_resolved: Boolean(resolvedEvent),
      supabase_updated: updateResult.ok,
      supabase_result: updateResult
    });
  } catch (error) {
    console.error('❌ /reminders/:reminderId/action error:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message || 'Erreur action reminder'
    });
  }
});

app.post('/speak', async (req, res) => {
  try {
    const text = normalizeText(req.body?.text || '');

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'Texte manquant'
      });
    }

    const audio = await generateSpeech(text);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (error) {
    console.error('❌ /speak error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message || 'Erreur génération audio'
    });
  }
});

app.post('/chat', async (req, res) => {
  const requestStartedAt = Date.now();

  try {
    const userMessage = normalizeText(req.body?.message || '');

    if (!userMessage) {
      return res.status(400).json({
        ok: false,
        error: 'Message manquant'
      });
    }

    await saveRecentConversationMessage('user', userMessage);
    const afterUserSaveAt = Date.now();

    const [
      currentStructuredMemory,
      behaviorMemory,
      semanticSummary,
      recentConversation
    ] = await Promise.all([
      getStructuredMemory(),
      getBehaviorMemory(),
      getSemanticSummary(),
      summarizeRecentConversationForPrompt(4)
    ]);
    const afterMemoryLoadAt = Date.now();

    const relevantMemory = extractRelevantMemory(currentStructuredMemory);

    const rulesAnalysis = analyzeUserState(userMessage, currentStructuredMemory);
    const analysisStrategy = shouldUseLLMStateAnalysis(userMessage, rulesAnalysis);

    let rawUserStateAnalysis = rulesAnalysis;
    let topic = detectTopic(userMessage);
    let stateAnalysisSource = 'rules_fast_path';

    if (analysisStrategy.use_llm) {
      try {
        const llmStateAnalysis = await analyzeUserStateWithLLM(
          userMessage,
          currentStructuredMemory
        );

        rawUserStateAnalysis = {
          state: {
            vulnerability: Math.max(rulesAnalysis.state.vulnerability, llmStateAnalysis.state.vulnerability),
            rumination: Math.max(rulesAnalysis.state.rumination, llmStateAnalysis.state.rumination),
            dispersion: Math.max(rulesAnalysis.state.dispersion, llmStateAnalysis.state.dispersion),
            avoidance: Math.max(rulesAnalysis.state.avoidance, llmStateAnalysis.state.avoidance),
            urgency: Math.max(rulesAnalysis.state.urgency, llmStateAnalysis.state.urgency),
            activation: Math.max(rulesAnalysis.state.activation, llmStateAnalysis.state.activation),
            emotional_intensity: Math.max(
              rulesAnalysis.state.emotional_intensity,
              llmStateAnalysis.state.emotional_intensity
            )
          },
          primary_state: rulesAnalysis.primary_state,
          secondary_state: rulesAnalysis.secondary_state,
          response_mode: rulesAnalysis.response_mode,
          should_recadre: rulesAnalysis.should_recadre || llmStateAnalysis.should_recadre,
          should_reduce_cognitive_load:
            rulesAnalysis.should_reduce_cognitive_load || llmStateAnalysis.should_reduce_cognitive_load,
          should_push_to_action:
            rulesAnalysis.should_push_to_action || llmStateAnalysis.should_push_to_action,
          directives: getResponseDirectivesByMode(rulesAnalysis.response_mode)
        };

        topic = llmStateAnalysis.topic || detectTopic(userMessage);
        stateAnalysisSource = 'hybrid_rules_priority';
      } catch (error) {
        rawUserStateAnalysis = rulesAnalysis;
        topic = detectTopic(userMessage);
        stateAnalysisSource = 'rules_fallback';
      }
    }

    const afterAnalysisAt = Date.now();

    const currentBehaviorSnapshot = buildBehaviorStateSnapshot(rawUserStateAnalysis);

    const previewBehaviorStates = [
      ...safeArray(behaviorMemory.recent_states).slice(-7),
      currentBehaviorSnapshot
    ];

    const behaviorTrend = computeBehaviorTrend(previewBehaviorStates);
    const userStateAnalysis = applyBehaviorTrendToAnalysis(rawUserStateAnalysis, behaviorTrend);

    await updateTopicMemory(topic, userStateAnalysis.primary_state);
    const afterTopicUpdateAt = Date.now();

    const responseProfile = buildResponseProfile(userStateAnalysis, behaviorTrend);

    const systemPrompt = [
      buildCoreSystemPrompt(),
      buildBehaviorPrompt(userStateAnalysis),
      buildBehaviorTrendPrompt(behaviorTrend),
      buildExecutionPrompt(responseProfile),
      buildMemoryPrompt(relevantMemory),
      `SUMMARY: ${truncateText(semanticSummary.summary || 'none', 320)}`,
      `RECENT:\n${recentConversation || 'none'}`
    ].join('\n\n');

    const generationMaxTokens = Math.min(
      260,
      Math.max(110, Math.round(responseProfile.max_words * 1.85))
    );

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.72,
      max_tokens: generationMaxTokens,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userMessage
        }
      ]
    });
    const afterGenerationAt = Date.now();

    const assistantReply = normalizeText(completion.choices?.[0]?.message?.content || 'Je suis là.');
    await saveRecentConversationMessage('nyra', assistantReply);

    await saveBehaviorStateSnapshot({
      ...currentBehaviorSnapshot,
      response_mode: userStateAnalysis.response_mode
    });
    const afterSavesAt = Date.now();

    const perf = {
      total_ms: Date.now() - requestStartedAt,
      save_user_message_ms: afterUserSaveAt - requestStartedAt,
      preload_memory_ms: afterMemoryLoadAt - afterUserSaveAt,
      analysis_ms: afterAnalysisAt - afterMemoryLoadAt,
      topic_update_ms: afterTopicUpdateAt - afterAnalysisAt,
      generation_ms: afterGenerationAt - afterTopicUpdateAt,
      final_saves_ms: afterSavesAt - afterGenerationAt
    };

    console.log('⚡ /chat perf:', perf);
    console.log('🧠 /chat analysis strategy:', {
      source: stateAnalysisSource,
      strategy_reason: analysisStrategy.reason,
      strategy_confidence: analysisStrategy.confidence
    });

    res.json({
      ok: true,
      reply: assistantReply,
      detected_topic: topic,
      state_analysis_source: stateAnalysisSource,
      analysis_strategy: analysisStrategy,
      behavioral_state: userStateAnalysis,
      behavior_trend: behaviorTrend,
      response_profile: responseProfile,
      perf,
      memory: {
        structured_update_queued: true,
        behavior_updated: true,
        topic_updated: true,
        supabase_enabled: SUPABASE_ENABLED
      }
    });

    processPostResponseMemoryUpdate(userMessage, currentStructuredMemory).catch((error) => {
      console.error('❌ Erreur post-response queued memory update:', error.message);
    });
  } catch (error) {
    console.error('❌ /chat error:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message || 'Erreur interne'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 VERSION NYRA: MEMORY V2 + REMINDER BRIDGE + BEHAVIOR ACTIVE');
  console.log('⚡ PERF PHASE 2 ACTIVE: rules fast path + llm gating + hybrid rules priority');
  console.log('🛠️ RUMINATION FIX ACTIVE: encore en boucle + tourne/boucle + recadre guard');
  console.log('🔔 REMINDER ENDPOINTS ACTIVE: /reminder-trigger + /reminders/pending + /reminders/:id/action');
  console.log(`✅ Nyra backend lancé sur le port ${PORT}`);
});