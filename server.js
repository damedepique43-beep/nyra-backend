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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'Ka6yOFdNGhzFuCVW6VyO';

if (!OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY manquante');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const MEMORY_SUMMARY_FILE = path.join(DATA_DIR, 'memory_summary.json');
const MEMORY_STRUCTURED_FILE = path.join(DATA_DIR, 'memory_structured.json');
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

function rankMemoryItems(items, limit = 5) {
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
    top_emotional_patterns: rankMemoryItems(memory.emotional_patterns, 5),
    top_triggers: rankMemoryItems(memory.triggers, 5),
    top_needs: rankMemoryItems(memory.needs, 5),
    top_risk_patterns: rankMemoryItems(memory.risk_patterns, 5),
    top_support_patterns: rankMemoryItems(memory.support_patterns, 5),
    top_active_contexts: rankMemoryItems(memory.active_contexts, 5),
    top_regulation_strategies: rankMemoryItems(memory.regulation_strategies, 5),
    top_projects: rankMemoryItems(memory.projects, 5),
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

function analyzeUserState(message, structuredMemory) {
  const text = normalizeText(message);
  const lower = text.toLowerCase();
  const relevantMemory = extractRelevantMemory(structuredMemory);

  const strongVulnerabilityPatterns = [
    { phrase: 'je me sens mal', weight: 0.45 },
    { phrase: 'je vais mal', weight: 0.5 },
    { phrase: 'j’en peux plus', weight: 0.6 },
    { phrase: 'j en peux plus', weight: 0.6 },
    { phrase: 'je craque', weight: 0.55 },
    { phrase: 'je suis perdue', weight: 0.45 },
    { phrase: 'je suis perdu', weight: 0.45 },
    { phrase: 'je me sens seule', weight: 0.42 },
    { phrase: 'je me sens vide', weight: 0.5 },
    { phrase: 'ça me fait mal', weight: 0.35 },
    { phrase: 'ça me détruit', weight: 0.65 },
    { phrase: 'je suis au bout', weight: 0.7 }
  ];

  const strongRuminationPatterns = [
    { phrase: 'je tourne en boucle', weight: 0.72 },
    { phrase: 'je suis en boucle', weight: 0.68 },
    { phrase: 'je n’arrive pas à décrocher', weight: 0.58 },
    { phrase: 'je n\'arrive pas à décrocher', weight: 0.58 },
    { phrase: 'je n’arrive pas à lâcher', weight: 0.55 },
    { phrase: 'je n\'arrive pas à lâcher', weight: 0.55 },
    { phrase: 'je repense sans arrêt', weight: 0.62 },
    { phrase: 'je pense à ça en boucle', weight: 0.7 },
    { phrase: 'ça m’obsède', weight: 0.65 },
    { phrase: 'ça m\'obsède', weight: 0.65 },
    { phrase: 'je rumine', weight: 0.62 },
    { phrase: 'je me demande sans arrêt', weight: 0.55 }
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
    { phrase: 'j\'ai besoin maintenant', weight: 0.72 }
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
    { phrase: 'concret', weight: 0.18 }
  ];

  const strongIntensityPatterns = [
    { phrase: 'catastrophe', weight: 0.55 },
    { phrase: 'insupportable', weight: 0.55 },
    { phrase: 'horrible', weight: 0.45 },
    { phrase: 'je déteste', weight: 0.38 },
    { phrase: 'je souffre', weight: 0.55 },
    { phrase: 'ça m’explose', weight: 0.62 },
    { phrase: 'ça m\'explose', weight: 0.62 },
    { phrase: 'ça m’obsède', weight: 0.58 },
    { phrase: 'ça m\'obsède', weight: 0.58 },
    { phrase: 'je suis détruite', weight: 0.72 },
    { phrase: 'je suis détruit', weight: 0.72 },
    { phrase: 'jamais', weight: 0.08 },
    { phrase: 'toujours', weight: 0.08 }
  ];

  const vulnerabilityLight = countKeywordMatches(lower, [
    'mal', 'peur', 'fragile', 'seule', 'vide', 'triste', 'pleure', 'douleur'
  ]) * 0.05;

  const ruminationLight = countKeywordMatches(lower, [
    'boucle', 'obsède', 'obsession', 'repense', 'pourquoi', 'et si', 'rumine'
  ]) * 0.06;

  const dispersionLight = countKeywordMatches(lower, [
    'éparpille', 'disperse', 'concentrer', 'bloque', 'commencer'
  ]) * 0.07;

  const avoidanceLight = countKeywordMatches(lower, [
    'évite', 'fuis', 'reporte', 'procrastine', 'plus tard'
  ]) * 0.06;

  const urgencyLight = countKeywordMatches(lower, [
    'urgent', 'vite', 'rapidement', 'maintenant'
  ]) * 0.06;

  const activationLight = countKeywordMatches(lower, [
    'avance', 'go', 'motiv', 'propre', 'premium', 'concret'
  ]) * 0.06;

  const intensityLight = countKeywordMatches(lower, [
    'catastrophe', 'horrible', 'insupportable', 'détruit', 'souffre'
  ]) * 0.06;

  let vulnerability =
    countWeightedMatches(lower, strongVulnerabilityPatterns) + vulnerabilityLight;

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

  if (wordCount >= 12 && hasAny(lower, ['je', 'j’ai', 'j\'ai'])) {
    emotionalIntensity += 0.04;
  }

  if (rumination > 0.5 && vulnerability > 0.25) {
    vulnerability += 0.12;
    emotionalIntensity += 0.08;
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

  if (memoryNeeds.some((x) => x.includes('rassurance') || x.includes('sécurité') || x.includes('apaisement'))) {
    vulnerability += 0.06;
  }

  vulnerability = clamp(Number(vulnerability.toFixed(3)), 0, 1);
  rumination = clamp(Number(rumination.toFixed(3)), 0, 1);
  dispersion = clamp(Number(dispersion.toFixed(3)), 0, 1);
  avoidance = clamp(Number(avoidance.toFixed(3)), 0, 1);
  urgency = clamp(Number(urgency.toFixed(3)), 0, 1);
  activation = clamp(Number(activation.toFixed(3)), 0, 1);
  emotionalIntensity = clamp(Number(emotionalIntensity.toFixed(3)), 0, 1);

  let responseMode = 'clarifying';

  if (vulnerability >= 0.55 && emotionalIntensity >= 0.32) {
    responseMode = 'grounding';
  } else if (rumination >= 0.55) {
    responseMode = 'firm_support';
  } else if (dispersion >= 0.55 || avoidance >= 0.55) {
    responseMode = 'directive';
  } else if (activation >= 0.55) {
    responseMode = 'directive';
  } else if (vulnerability >= 0.35) {
    responseMode = 'supportive';
  }

  let primaryState = 'stable';
  let secondaryState = null;

  const stateEntries = [
    ['vulnerability', vulnerability],
    ['rumination', rumination],
    ['dispersion', dispersion],
    ['avoidance', avoidance],
    ['urgency', urgency],
    ['activation', activation],
    ['emotional_intensity', emotionalIntensity]
  ].sort((a, b) => b[1] - a[1]);

  if (stateEntries[0][1] >= 0.35) {
    primaryState = stateEntries[0][0];
  }

  if (stateEntries[1][1] >= 0.3) {
    secondaryState = stateEntries[1][0];
  }

  const shouldRecadre =
    rumination >= 0.5 ||
    dispersion >= 0.5 ||
    avoidance >= 0.5 ||
    activation >= 0.65;

  const shouldReduceCognitiveLoad =
    vulnerability >= 0.45 ||
    emotionalIntensity >= 0.4 ||
    responseMode === 'grounding';

  const shouldPushToAction =
    activation >= 0.45 ||
    dispersion >= 0.45 ||
    avoidance >= 0.45;

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
    should_reduce_cognitive_load: shouldReduceCognitiveLoad,
    should_push_to_action: shouldPushToAction,
    directives: responseDirectives[responseMode]
  };
}

function buildResponseProfile(userStateAnalysis) {
  const mode = userStateAnalysis.response_mode;
  const vulnerability = userStateAnalysis.state.vulnerability;
  const rumination = userStateAnalysis.state.rumination;
  const dispersion = userStateAnalysis.state.dispersion;
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
    maxWords = 110;
    paragraphStyle = '1 à 3 paragraphes très courts';
    bulletPolicy = 'évite les listes';
    actionStyle = 'donne une seule micro-action d’ancrage si utile';
    emotionalValidation = 'plus présente, contenante';
    questionCount = '0 ou 1 question très simple maximum';
    cognitiveLoad = 'très faible';
    pacing = 'lent, rassurant, stable';
    forbiddenPatterns.push('pas de plan complexe', 'pas de trop nombreuses options');
  } else if (mode === 'firm_support') {
    maxWords = 140;
    paragraphStyle = '2 à 3 paragraphes courts';
    bulletPolicy = 'évite les listes sauf si une seule mini séquence utile';
    actionStyle = 'propose une action simple et immédiate';
    emotionalValidation = 'courte mais réelle';
    questionCount = '0 ou 1 question utile maximum';
    cognitiveLoad = 'faible';
    pacing = 'net, rassurant, lucide';
    forbiddenPatterns.push('ne nourris pas la rumination', 'pas d’analyse interminable');
  } else if (mode === 'directive') {
    maxWords = activation >= 0.75 ? 220 : 170;
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
    maxWords = 160;
    paragraphStyle = '2 à 4 petits paragraphes';
    bulletPolicy = 'évite les listes longues';
    actionStyle = 'propose une petite avancée concrète';
    emotionalValidation = 'présente';
    questionCount = '1 question maximum';
    cognitiveLoad = shouldReduceCognitiveLoad ? 'faible' : 'modéré';
    pacing = 'doux, clair, soutenant';
  }

  if (vulnerability >= 0.6) {
    maxWords = Math.min(maxWords, 120);
    cognitiveLoad = 'très faible';
  }

  if (rumination >= 0.8) {
    maxWords = Math.min(maxWords, 130);
    forbiddenPatterns.push('pas d’exploration théorique de la boucle');
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
    forbidden_patterns: forbiddenPatterns
  };
}

function buildCoreSystemPrompt() {
  return `
Tu es Nyra, une présence intelligente, naturelle, profondément personnalisée.

Ta mission :
- comprendre l’état réel de l’utilisatrice
- répondre avec chaleur, justesse, lucidité et intelligence
- réguler quand nécessaire
- recadrer quand nécessaire
- aider à avancer concrètement

Règles de style :
- sois naturelle, humaine, fluide
- évite le ton robotique, scolaire ou trop lisse
- ne fais pas de listes interminables sauf si c’est clairement utile
- privilégie l’impact, la précision et la sincérité
- quand l’utilisatrice est en boucle mentale, ne nourris pas la boucle
- quand elle est dispersée, recentre-la
- quand elle est vulnérable, stabilise-la d’abord
- quand elle a besoin d’action, donne du concret
- utilise la mémoire seulement si elle aide vraiment la réponse
- n’invente jamais de souvenirs ou de faits
- n’explique pas tes mécanismes internes
- reste cohérente avec sa personnalité, son fonctionnement TDAH, et son besoin de structure intelligente
- si un recadrage est utile, fais-le avec chaleur mais sans mollesse
`.trim();
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

  return `
ÉTAT UTILISATRICE DÉTECTÉ :
- vulnerability: ${state.vulnerability}
- rumination: ${state.rumination}
- dispersion: ${state.dispersion}
- avoidance: ${state.avoidance}
- urgency: ${state.urgency}
- activation: ${state.activation}
- emotional_intensity: ${state.emotional_intensity}

SYNTHÈSE COMPORTEMENTALE :
- primary_state: ${primary_state}
- secondary_state: ${secondary_state || 'none'}
- response_mode: ${response_mode}
- should_recadre: ${should_recadre}
- should_reduce_cognitive_load: ${should_reduce_cognitive_load}
- should_push_to_action: ${should_push_to_action}

MODE DE RÉPONSE À ADOPTER :
- tone: ${directives.tone}
- structure: ${directives.structure}
- recadrage_level: ${directives.recadrage_level}
- priority: ${directives.priority}

Consignes d’exécution :
- si should_reduce_cognitive_load = true, simplifie la réponse et évite de surcharger
- si should_recadre = true, recadre avec chaleur mais sans tourner autour du pot
- si should_push_to_action = true, donne une action simple, claire, faisable immédiatement
`.trim();
}

function buildExecutionPrompt(responseProfile) {
  return `
PROFIL D’EXÉCUTION DE LA RÉPONSE :
- max_words: ${responseProfile.max_words}
- paragraph_style: ${responseProfile.paragraph_style}
- bullet_policy: ${responseProfile.bullet_policy}
- action_style: ${responseProfile.action_style}
- emotional_validation: ${responseProfile.emotional_validation}
- question_count: ${responseProfile.question_count}
- cognitive_load: ${responseProfile.cognitive_load}
- pacing: ${responseProfile.pacing}

INTERDICTIONS / GARDE-FOUS :
${responseProfile.forbidden_patterns.map((x) => `- ${x}`).join('\n')}

Contraintes finales :
- reste sous la limite de mots demandée autant que possible
- une seule idée forte par segment
- si une action est donnée, elle doit être simple, spécifique, faisable maintenant
- n’ajoute pas de métadiscours sur le fait que tu analyses son état
- écris comme une présence premium, humaine, nette, utile
`.trim();
}

function buildMemoryPrompt(relevantMemory) {
  return `
MÉMOIRE PERTINENTE :
${JSON.stringify(relevantMemory, null, 2)}

Utilise cette mémoire avec discernement :
- seulement si elle améliore la pertinence
- priorise les patterns, triggers, besoins et contextes actifs les plus forts
- ne surcharge pas la réponse
- ne cite pas mécaniquement la mémoire
`.trim();
}

function getRecentConversationMemory(limit = 10) {
  const memory = readJsonSafe(MEMORY_FILE, { messages: [] });
  return safeArray(memory.messages).slice(-limit);
}

function saveRecentConversationMessage(sender, text) {
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
}

function summarizeRecentConversationForPrompt(limit = 8) {
  const recent = getRecentConversationMemory(limit);
  return recent.map((m) => `${m.sender === 'user' ? 'UTILISATRICE' : 'NYRA'}: ${m.text}`).join('\n');
}

async function extractStructuredMemoryFromMessage(userMessage) {
  const currentStructured = readJsonSafe(MEMORY_STRUCTURED_FILE, createEmptyStructuredMemory());

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
    const shortMemory = readJsonSafe(MEMORY_FILE, { messages: [] });
    const existingSummary = readJsonSafe(MEMORY_SUMMARY_FILE, {
      summary: '',
      updated_at: null
    });

    const recentMessages = safeArray(shortMemory.messages).slice(-20);
    if (recentMessages.length === 0) return;

    const prompt = `
Tu mets à jour une mémoire sémantique synthétique.

Ancien résumé :
${existingSummary.summary || ''}

Derniers messages :
${recentMessages.map((m) => `${m.sender}: ${m.text}`).join('\n')}

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

    writeJsonSafe(MEMORY_SUMMARY_FILE, {
      summary,
      updated_at: nowIso()
    });
  } catch (error) {
    console.error('❌ Erreur updateSemanticSummaryAsync:', error.message);
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
    timestamp: nowIso()
  });
});

app.get('/memory', (req, res) => {
  const memory = readJsonSafe(MEMORY_FILE, { messages: [] });
  res.json(memory);
});

app.get('/memory/structured', (req, res) => {
  const structured = readJsonSafe(MEMORY_STRUCTURED_FILE, createEmptyStructuredMemory());
  res.json(structured);
});

app.post('/memory/reset', (req, res) => {
  writeJsonSafe(MEMORY_FILE, { messages: [] });
  writeJsonSafe(MEMORY_SUMMARY_FILE, { summary: '', updated_at: nowIso() });
  writeJsonSafe(MEMORY_STRUCTURED_FILE, createEmptyStructuredMemory());

  res.json({
    ok: true,
    message: 'Mémoire réinitialisée'
  });
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
  try {
    const userMessage = normalizeText(req.body?.message || '');
    if (!userMessage) {
      return res.status(400).json({
        ok: false,
        error: 'Message manquant'
      });
    }

    saveRecentConversationMessage('user', userMessage);

    const currentStructuredMemory = readJsonSafe(MEMORY_STRUCTURED_FILE, createEmptyStructuredMemory());

    const extractedStructured = await extractStructuredMemoryFromMessage(userMessage);
    const mergedStructured = mergeStructuredMemory(currentStructuredMemory, extractedStructured);
    writeJsonSafe(MEMORY_STRUCTURED_FILE, mergedStructured);

    const relevantMemory = extractRelevantMemory(mergedStructured);
    const userStateAnalysis = analyzeUserState(userMessage, mergedStructured);
    const responseProfile = buildResponseProfile(userStateAnalysis);

    const semanticSummary = readJsonSafe(MEMORY_SUMMARY_FILE, {
      summary: '',
      updated_at: null
    });

    const recentConversation = summarizeRecentConversationForPrompt(8);

    const systemPrompt = [
      buildCoreSystemPrompt(),
      buildBehaviorPrompt(userStateAnalysis),
      buildExecutionPrompt(responseProfile),
      buildMemoryPrompt(relevantMemory),
      `RÉSUMÉ SÉMANTIQUE:\n${semanticSummary.summary || 'Aucun résumé disponible pour le moment.'}`,
      `CONTEXTE CONVERSATION RÉCENTE:\n${recentConversation || 'Aucun historique récent.'}`
    ].join('\n\n');

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.75,
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

    const assistantReply = normalizeText(completion.choices?.[0]?.message?.content || 'Je suis là.');
    saveRecentConversationMessage('nyra', assistantReply);

    updateSemanticSummaryAsync().catch((error) => {
      console.error('❌ Erreur async semantic summary:', error.message);
    });

    return res.json({
      ok: true,
      reply: assistantReply,
      behavioral_state: userStateAnalysis,
      response_profile: responseProfile,
      memory: {
        structured_updated: true
      }
    });
  } catch (error) {
    console.error('❌ /chat error:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message || 'Erreur interne'
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Nyra backend lancé sur le port ${PORT}`);
});