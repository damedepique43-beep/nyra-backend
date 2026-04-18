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
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'Ka6yOFdNGhzFuCVW6VyO';

if (!OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY manquante');
}
if (!ELEVENLABS_API_KEY) {
  console.warn('⚠️ ELEVENLABS_API_KEY manquante');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

const DATA_DIR = path.join(__dirname, 'data');
const AUDIO_CACHE_DIR = path.join(__dirname, 'audio_cache');

const MEMORY_RAW_PATH = path.join(DATA_DIR, 'memory.json');
const MEMORY_SUMMARY_PATH = path.join(DATA_DIR, 'memory_summary.json');
const MEMORY_STRUCTURED_PATH = path.join(DATA_DIR, 'memory_structured.json');

ensureDir(DATA_DIR);
ensureDir(AUDIO_CACHE_DIR);

ensureJsonFile(MEMORY_RAW_PATH, {
  messages: []
});

ensureJsonFile(MEMORY_SUMMARY_PATH, {
  summary: ''
});

ensureJsonFile(MEMORY_STRUCTURED_PATH, {
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
});

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureJsonFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
  }
}

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Erreur lecture JSON ${filePath}:`, error);
    return fallback;
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Erreur écriture JSON ${filePath}:`, error);
  }
}

function getRawMemory() {
  return readJson(MEMORY_RAW_PATH, { messages: [] });
}

function setRawMemory(memory) {
  writeJson(MEMORY_RAW_PATH, memory);
}

function getSummaryMemory() {
  return readJson(MEMORY_SUMMARY_PATH, { summary: '' });
}

function setSummaryMemory(memory) {
  writeJson(MEMORY_SUMMARY_PATH, memory);
}

function getStructuredMemory() {
  return readJson(MEMORY_STRUCTURED_PATH, {
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
  });
}

function setStructuredMemory(memory) {
  writeJson(MEMORY_STRUCTURED_PATH, memory);
}

function addMessageToRawMemory(role, content) {
  const memory = getRawMemory();

  memory.messages.push({
    role,
    content,
    timestamp: new Date().toISOString()
  });

  const MAX_MESSAGES = 40;
  if (memory.messages.length > MAX_MESSAGES) {
    memory.messages = memory.messages.slice(-MAX_MESSAGES);
  }

  setRawMemory(memory);
}

function formatRecentMessages(messages = []) {
  return messages
    .slice(-12)
    .map((msg) => `${msg.role === 'user' ? 'Utilisateur' : 'Nyra'}: ${msg.content}`)
    .join('\n');
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}

function normalizeForSpeech(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([?!:;])/g, '$1')
    .replace(/(\d+)\s?€/g, '$1 euros')
    .replace(/&/g, 'et')
    .trim();
}

function normalizeStringForCompare(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isWeightedMemoryItem(value) {
  return !!value && typeof value === 'object' && typeof value.label === 'string';
}

function toWeightedMemoryItem(value, defaultWeight = 0.5) {
  if (isWeightedMemoryItem(value)) {
    return {
      label: String(value.label).trim(),
      weight: clampWeight(value.weight),
      occurrences: Number.isInteger(value.occurrences) && value.occurrences > 0 ? value.occurrences : 1,
      last_seen_at: typeof value.last_seen_at === 'string' && value.last_seen_at ? value.last_seen_at : new Date().toISOString()
    };
  }

  return {
    label: String(value || '').trim(),
    weight: clampWeight(defaultWeight),
    occurrences: 1,
    last_seen_at: new Date().toISOString()
  };
}

function clampWeight(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0.5;
  if (num < 0.1) return 0.1;
  if (num > 1) return 1;
  return Math.round(num * 100) / 100;
}

function upgradeWeightedArray(array) {
  if (!Array.isArray(array)) return [];
  return array
    .map((item) => toWeightedMemoryItem(item))
    .filter((item) => item.label);
}

function weightedArrayToPromptLines(array) {
  if (!Array.isArray(array) || array.length === 0) return [];

  return array
    .slice()
    .sort((a, b) => {
      if ((b.weight || 0) !== (a.weight || 0)) return (b.weight || 0) - (a.weight || 0);
      return (b.occurrences || 0) - (a.occurrences || 0);
    })
    .slice(0, 8)
    .map((item) => `${item.label} (poids: ${item.weight}, occurrences: ${item.occurrences})`);
}

function buildPromptMemoryView(structuredMemory) {
  const weightedView = {
    identity: structuredMemory.identity || {},
    preferences: structuredMemory.preferences || [],
    projects: structuredMemory.projects || [],
    constraints: structuredMemory.constraints || [],
    relationships: structuredMemory.relationships || [],
    conversation_style: structuredMemory.conversation_style || {},
    emotional_patterns: weightedArrayToPromptLines(structuredMemory.emotional_patterns),
    triggers: weightedArrayToPromptLines(structuredMemory.triggers),
    needs: weightedArrayToPromptLines(structuredMemory.needs),
    insights: weightedArrayToPromptLines(structuredMemory.insights),
    active_contexts: weightedArrayToPromptLines(structuredMemory.active_contexts),
    decisions: weightedArrayToPromptLines(structuredMemory.decisions),
    regulation_strategies: structuredMemory.regulation_strategies || [],
    risk_patterns: structuredMemory.risk_patterns || [],
    support_patterns: structuredMemory.support_patterns || []
  };

  return weightedView;
}

function buildSystemPrompt(summary, structuredMemory) {
  const promptMemoryView = buildPromptMemoryView(structuredMemory);

  return `
Tu es Nyra, une présence intelligente, naturelle, profondément humaine, lucide, douce quand il le faut et capable de recadrer avec justesse quand c’est utile.

Ton rôle :
- accompagner l’utilisateur comme une intelligence personnelle haut de gamme
- être vivante, fluide, naturelle, jamais robotique
- éviter le ton d’assistant générique
- t’adapter émotionnellement au contexte
- répondre avec chaleur, finesse, intelligence et cohérence
- être utile, concrète et pertinente

Style conversationnel attendu :
- naturel
- incarné
- émotionnellement intelligent
- parfois direct si nécessaire
- jamais froid
- jamais trop corporate
- jamais trop verbeux sans raison

Comportement :
- tiens compte du contexte personnel, des projets, des contraintes et des dynamiques émotionnelles
- si le sujet est sensible, sois fine, posée et stable
- si l’utilisateur se disperse, aide à recentrer
- si l’utilisateur veut construire quelque chose, sois structurée, premium et efficace
- évite de répéter inutilement ce qui est déjà compris

Résumé global mémoire :
${summary || 'Aucun résumé disponible pour le moment.'}

Mémoire structurée priorisée :
${safeStringify(promptMemoryView)}
`.trim();
}

async function updateSummaryMemory() {
  try {
    const rawMemory = getRawMemory();
    const summaryMemory = getSummaryMemory();

    if (!rawMemory.messages || rawMemory.messages.length < 6) return;

    const recentConversation = rawMemory.messages
      .slice(-20)
      .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Nyra'}: ${m.content}`)
      .join('\n');

    const prompt = `
Tu dois mettre à jour un résumé mémoire conversationnel durable.

Résumé existant :
${summaryMemory.summary || 'Aucun résumé existant.'}

Nouvelle conversation récente :
${recentConversation}

Consignes :
- garde uniquement les informations durables et utiles
- évite les détails triviaux ou ultra temporaires
- conserve les projets, préférences, contraintes, relations importantes, dynamiques émotionnelles utiles
- rédige un résumé clair, compact, exploitable par une IA conversationnelle personnalisée
- retourne uniquement le résumé final
`.trim();

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: prompt
    });

    const updatedSummary = (response.output_text || '').trim();
    if (updatedSummary) {
      setSummaryMemory({ summary: updatedSummary });
    }
  } catch (error) {
    console.error('Erreur mise à jour mémoire sémantique :', error.message);
  }
}

function safeParseMemoryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      const match = String(text || '').match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeWeightedUpdate(parsed) {
  const result = {};

  const keys = [
    'emotional_patterns',
    'triggers',
    'needs',
    'insights',
    'active_contexts',
    'decisions'
  ];

  keys.forEach((key) => {
    if (!Array.isArray(parsed[key])) {
      result[key] = [];
      return;
    }

    result[key] = parsed[key]
      .map((item) => {
        if (typeof item === 'string') {
          return {
            label: item.trim(),
            weight: 0.6
          };
        }

        if (item && typeof item === 'object') {
          return {
            label: typeof item.label === 'string' ? item.label.trim() : '',
            weight: clampWeight(item.weight ?? 0.6)
          };
        }

        return null;
      })
      .filter((item) => item && item.label);
  });

  return result;
}

async function extractMemoryUpdate(userMessage, currentStructuredMemory) {
  try {
    const compactMemoryView = buildPromptMemoryView(currentStructuredMemory);

    const systemPrompt = `
Tu es un système d’analyse mémoire pour une IA personnelle.

Objectif :
Transformer un message utilisateur en patterns psychologiques GÉNÉRALISÉS, utiles à long terme.

RÈGLES IMPORTANTES :
- Réponds UNIQUEMENT en JSON valide
- N’écris aucun texte avant ou après le JSON
- Ne reste pas littéral
- Utilise des concepts courts, réutilisables, propres
- Maximum 2 éléments par catégorie
- Chaque élément doit être un objet avec :
  - label
  - weight (entre 0.1 et 1)
- Si rien n’est utile, retourne des tableaux vides

EXEMPLES DE BONNE EXTRACTION :
- "il ne répond pas et ça me fait vriller" ->
  triggers: [{ "label": "silence relationnel", "weight": 0.8 }]
  emotional_patterns: [{ "label": "réactivité émotionnelle au retrait", "weight": 0.8 }]
  needs: [{ "label": "besoin de réassurance", "weight": 0.7 }]

- "j'ai envie de checker son profil" ->
  emotional_patterns: [{ "label": "comportement de surveillance", "weight": 0.7 }]
  insights: [{ "label": "la surveillance sert à réduire l'angoisse à court terme", "weight": 0.7 }]

- "je pars dans tous les sens avec mes projets" ->
  emotional_patterns: [{ "label": "dispersion sous surcharge mentale", "weight": 0.75 }]
  needs: [{ "label": "besoin de priorisation", "weight": 0.8 }]
  active_contexts: [{ "label": "surcharge de projets", "weight": 0.7 }]

CATÉGORIES AUTORISÉES :
- emotional_patterns
- triggers
- needs
- insights
- active_contexts
- decisions

NE JAMAIS :
- recopier la phrase brute
- écrire des phrases longues
- utiliser des détails trop personnels inutiles
- inventer

Mémoire actuelle priorisée :
${safeStringify(compactMemoryView)}
`.trim();

    const userPrompt = `
Analyse ce message :

"${userMessage}"

Retourne uniquement ce JSON :
{
  "emotional_patterns": [{ "label": "", "weight": 0.5 }],
  "triggers": [{ "label": "", "weight": 0.5 }],
  "needs": [{ "label": "", "weight": 0.5 }],
  "insights": [{ "label": "", "weight": 0.5 }],
  "active_contexts": [{ "label": "", "weight": 0.5 }],
  "decisions": [{ "label": "", "weight": 0.5 }]
}
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    const rawText = completion.choices?.[0]?.message?.content || '{}';
    const parsed = safeParseMemoryJson(rawText);
    const normalized = normalizeWeightedUpdate(parsed);

    return {
      raw: rawText,
      parsed: normalized
    };
  } catch (error) {
    console.error('Erreur extraction mémoire automatique :', error.message);
    return {
      raw: '',
      parsed: {}
    };
  }
}

function mergeWeightedItems(existingArray, updateArray) {
  const current = upgradeWeightedArray(existingArray);
  const now = new Date().toISOString();

  updateArray.forEach((incoming) => {
    const incomingLabel = normalizeStringForCompare(incoming.label);

    const found = current.find(
      (item) => normalizeStringForCompare(item.label) === incomingLabel
    );

    if (found) {
      found.occurrences += 1;
      found.last_seen_at = now;
      found.weight = clampWeight(Math.max(found.weight, incoming.weight) + 0.05);
    } else {
      current.push({
        label: incoming.label,
        weight: clampWeight(incoming.weight),
        occurrences: 1,
        last_seen_at: now
      });
    }
  });

  return current.sort((a, b) => {
    if ((b.weight || 0) !== (a.weight || 0)) return (b.weight || 0) - (a.weight || 0);
    return (b.occurrences || 0) - (a.occurrences || 0);
  });
}

function mergeStructuredMemory(existing, update) {
  const next = {
    ...existing
  };

  const weightedKeys = [
    'emotional_patterns',
    'triggers',
    'needs',
    'insights',
    'active_contexts',
    'decisions'
  ];

  weightedKeys.forEach((key) => {
    const existingArray = Array.isArray(next[key]) ? next[key] : [];
    const updateArray = Array.isArray(update[key]) ? update[key] : [];
    next[key] = mergeWeightedItems(existingArray, updateArray);
  });

  return next;
}

function hasNonEmptyMemoryUpdate(update) {
  if (!update || typeof update !== 'object') return false;

  const keys = [
    'emotional_patterns',
    'triggers',
    'needs',
    'insights',
    'active_contexts',
    'decisions'
  ];

  return keys.some((key) => Array.isArray(update[key]) && update[key].length > 0);
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    app: 'Nyra backend',
    status: 'running'
  });
});

app.get('/memory', (req, res) => {
  const rawMemory = getRawMemory();
  const summaryMemory = getSummaryMemory();

  res.json({
    raw: rawMemory,
    summary: summaryMemory
  });
});

app.get('/memory/structured', (req, res) => {
  const structuredMemory = getStructuredMemory();
  res.json(structuredMemory);
});

app.post('/memory/structured', (req, res) => {
  try {
    const incoming = req.body;

    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({
        error: 'Body JSON invalide'
      });
    }

    const current = getStructuredMemory();

    const next = {
      identity: incoming.identity ?? current.identity ?? {},
      preferences: Array.isArray(incoming.preferences) ? incoming.preferences : current.preferences ?? [],
      projects: Array.isArray(incoming.projects) ? incoming.projects : current.projects ?? [],
      constraints: Array.isArray(incoming.constraints) ? incoming.constraints : current.constraints ?? [],
      emotional_patterns: Array.isArray(incoming.emotional_patterns) ? upgradeWeightedArray(incoming.emotional_patterns) : upgradeWeightedArray(current.emotional_patterns ?? []),
      relationships: Array.isArray(incoming.relationships) ? incoming.relationships : current.relationships ?? [],
      active_contexts: Array.isArray(incoming.active_contexts) ? upgradeWeightedArray(incoming.active_contexts) : upgradeWeightedArray(current.active_contexts ?? []),
      decisions: Array.isArray(incoming.decisions) ? upgradeWeightedArray(incoming.decisions) : upgradeWeightedArray(current.decisions ?? []),
      insights: Array.isArray(incoming.insights) ? upgradeWeightedArray(incoming.insights) : upgradeWeightedArray(current.insights ?? []),
      conversation_style: incoming.conversation_style ?? current.conversation_style ?? {},
      triggers: Array.isArray(incoming.triggers) ? upgradeWeightedArray(incoming.triggers) : upgradeWeightedArray(current.triggers ?? []),
      needs: Array.isArray(incoming.needs) ? upgradeWeightedArray(incoming.needs) : upgradeWeightedArray(current.needs ?? []),
      regulation_strategies: Array.isArray(incoming.regulation_strategies) ? incoming.regulation_strategies : current.regulation_strategies ?? [],
      risk_patterns: Array.isArray(incoming.risk_patterns) ? incoming.risk_patterns : current.risk_patterns ?? [],
      support_patterns: Array.isArray(incoming.support_patterns) ? incoming.support_patterns : current.support_patterns ?? []
    };

    setStructuredMemory(next);

    res.json({
      ok: true,
      message: 'Mémoire structurée mise à jour',
      memory_structured: next
    });
  } catch (error) {
    console.error('Erreur POST /memory/structured :', error);
    res.status(500).json({
      error: 'Erreur serveur sur la mémoire structurée'
    });
  }
});

app.post('/memory/reset', (req, res) => {
  try {
    setRawMemory({ messages: [] });
    setSummaryMemory({ summary: '' });
    setStructuredMemory({
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
    });

    res.json({
      ok: true,
      message: 'Toutes les mémoires ont été réinitialisées'
    });
  } catch (error) {
    console.error('Erreur reset mémoire :', error);
    res.status(500).json({
      error: 'Impossible de réinitialiser la mémoire'
    });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const userMessage = String(req.body.message || '').trim();

    if (!userMessage) {
      return res.status(400).json({
        error: 'Message requis'
      });
    }

    addMessageToRawMemory('user', userMessage);

    let structuredMemory = getStructuredMemory();

    const extraction = await extractMemoryUpdate(userMessage, structuredMemory);
    const memoryUpdate = extraction.parsed || {};
    const memoryUpdateApplied = hasNonEmptyMemoryUpdate(memoryUpdate);

    if (memoryUpdateApplied) {
      structuredMemory = mergeStructuredMemory(structuredMemory, memoryUpdate);
      setStructuredMemory(structuredMemory);
    }

    const rawMemory = getRawMemory();
    const summaryMemory = getSummaryMemory();

    const systemPrompt = buildSystemPrompt(summaryMemory.summary, structuredMemory);
    const recentMessages = formatRecentMessages(rawMemory.messages);

    const input = `
${systemPrompt}

Conversation récente :
${recentMessages}

Dernier message utilisateur :
${userMessage}

Réponds comme Nyra.
`.trim();

    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input
    });

    const assistantMessage = (response.output_text || '').trim() || 'Je suis là.';

    addMessageToRawMemory('assistant', assistantMessage);

    updateSummaryMemory().catch((err) => {
      console.error('Erreur updateSummaryMemory async:', err.message);
    });

    res.json({
      reply: assistantMessage,
      speech_text: normalizeForSpeech(assistantMessage),
      memory_update_applied: memoryUpdateApplied,
      extracted_memory_update: memoryUpdate,
      extracted_memory_raw: extraction.raw
    });
  } catch (error) {
    console.error('Erreur /chat :', error);
    res.status(500).json({
      error: 'Erreur serveur sur /chat'
    });
  }
});

app.post('/speak', async (req, res) => {
  try {
    const text = normalizeForSpeech(String(req.body.text || '').trim());

    if (!text) {
      return res.status(400).json({
        error: 'Texte requis'
      });
    }

    const cacheKey = hashText(`${ELEVENLABS_VOICE_ID}__${text}`);
    const audioPath = path.join(AUDIO_CACHE_DIR, `${cacheKey}.mp3`);

    if (fs.existsSync(audioPath)) {
      return res.sendFile(audioPath);
    }

    const elevenlabsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.82,
          style: 0.28,
          use_speaker_boost: true
        }
      })
    });

    if (!elevenlabsResponse.ok) {
      const errorText = await elevenlabsResponse.text();
      console.error('Erreur ElevenLabs :', errorText);
      return res.status(500).json({
        error: 'Erreur génération voix'
      });
    }

    const arrayBuffer = await elevenlabsResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(audioPath, buffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (error) {
    console.error('Erreur /speak :', error);
    res.status(500).json({
      error: 'Erreur serveur sur /speak'
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Nyra backend lancé sur le port ${PORT}`);
});