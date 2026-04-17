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
  apiKey: OPENAI_API_KEY,
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
  conversation_style: {}
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
    conversation_style: {}
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

function buildSystemPrompt(summary, structuredMemory) {
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

Mémoire structurée :
${safeStringify(structuredMemory)}
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

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
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
      emotional_patterns: Array.isArray(incoming.emotional_patterns) ? incoming.emotional_patterns : current.emotional_patterns ?? [],
      relationships: Array.isArray(incoming.relationships) ? incoming.relationships : current.relationships ?? [],
      active_contexts: Array.isArray(incoming.active_contexts) ? incoming.active_contexts : current.active_contexts ?? [],
      decisions: Array.isArray(incoming.decisions) ? incoming.decisions : current.decisions ?? [],
      insights: Array.isArray(incoming.insights) ? incoming.insights : current.insights ?? [],
      conversation_style: incoming.conversation_style ?? current.conversation_style ?? {}
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
      conversation_style: {}
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

    const rawMemory = getRawMemory();
    const summaryMemory = getSummaryMemory();
    const structuredMemory = getStructuredMemory();

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

    const assistantMessage = (response.output_text || '').trim() || "Je suis là.";

    addMessageToRawMemory('assistant', assistantMessage);

    updateSummaryMemory().catch((err) => {
      console.error('Erreur updateSummaryMemory async:', err.message);
    });

    res.json({
      reply: assistantMessage,
      speech_text: normalizeForSpeech(assistantMessage)
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