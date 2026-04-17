require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

const PROFILE_PATH = path.join(__dirname, 'nyra_profile.json');
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'systemPromptNyra.txt');
const RAW_MEMORY_PATH = path.join(__dirname, 'memory_raw.json');
const SUMMARY_MEMORY_PATH = path.join(__dirname, 'memory_summary.json');

function ensureFileExists(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
    }
  } catch (error) {
    console.error(`Erreur création fichier ${filePath}:`, error.message);
  }
}

ensureFileExists(RAW_MEMORY_PATH, []);
ensureFileExists(SUMMARY_MEMORY_PATH, { summary: '' });

function readJsonFileSafe(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Erreur lecture JSON ${filePath}:`, error.message);
    return fallbackValue;
  }
}

function writeJsonFileSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Erreur écriture JSON ${filePath}:`, error.message);
  }
}

function readTextFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Erreur lecture TXT ${filePath}:`, error.message);
    return '';
  }
}

function getRawMemory() {
  const memory = readJsonFileSafe(RAW_MEMORY_PATH, []);
  return Array.isArray(memory) ? memory : [];
}

function saveRawMemory(memory) {
  writeJsonFileSafe(RAW_MEMORY_PATH, memory);
}

function appendToRawMemory(role, content) {
  const memory = getRawMemory();
  memory.push({ role, content });

  const trimmed = memory.slice(-40);
  saveRawMemory(trimmed);
}

function getSemanticSummary() {
  const data = readJsonFileSafe(SUMMARY_MEMORY_PATH, { summary: '' });
  return typeof data.summary === 'string' ? data.summary : '';
}

function saveSemanticSummary(summary) {
  writeJsonFileSafe(SUMMARY_MEMORY_PATH, { summary });
}

function buildNyraSystemPrompt() {
  const basePrompt = readTextFileSafe(SYSTEM_PROMPT_PATH).trim();
  const profile = readJsonFileSafe(PROFILE_PATH, null);

  const profileBlock = profile
    ? `\n\n=== PROFIL UTILISATRICE NYRA ===\n${JSON.stringify(profile, null, 2)}`
    : '\n\n=== PROFIL UTILISATRICE NYRA ===\nAucun profil chargé.';

  return `${basePrompt}${profileBlock}`;
}

async function updateSemanticMemory(lastUserMessage, lastAssistantReply) {
  try {
    if (!openai) return;

    const previousSummary = getSemanticSummary();

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: 350,
      messages: [
        {
          role: 'system',
          content:
            [
              'Tu maintiens une mémoire sémantique compacte pour une IA personnelle.',
              'Ta mission : mettre à jour un résumé durable, utile et structuré de ce qui compte vraiment.',
              'Conserve uniquement ce qui a une vraie valeur future :',
              '- objectifs durables',
              '- préférences stables',
              '- projets en cours',
              '- état émotionnel récurrent',
              '- contraintes importantes',
              '- décisions prises',
              '- éléments relationnels ou psychologiques utiles à la continuité',
              'Ne garde pas le bavardage inutile.',
              'Écris un résumé clair, compact, exploitable, en français.',
              'Pas de markdown. Pas de listes géantes. Pas de JSON.'
            ].join('\n')
        },
        {
          role: 'user',
          content:
            `Résumé sémantique actuel :\n${previousSummary || '(vide)'}\n\n` +
            `Dernier message utilisateur :\n${lastUserMessage}\n\n` +
            `Dernière réponse de Nyra :\n${lastAssistantReply}\n\n` +
            `Mets à jour le résumé sémantique global.`
        }
      ]
    });

    const updatedSummary = completion.choices?.[0]?.message?.content?.trim();
    if (updatedSummary) {
      saveSemanticSummary(updatedSummary);
    }
  } catch (error) {
    console.error('Erreur mise à jour mémoire sémantique:', error.message);
  }
}

async function synthesizeWithElevenLabs(text) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY manquante');
  }

  if (!ELEVENLABS_VOICE_ID) {
    throw new Error('ELEVENLABS_VOICE_ID manquante');
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.35,
          use_speaker_boost: true
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur ElevenLabs: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function generateNyraReply(message, conversation = []) {
  if (!openai) {
    return `J’ai bien reçu ton message : "${message}". Mon cerveau OpenAI n’est pas encore disponible côté serveur.`;
  }

  const systemPrompt = buildNyraSystemPrompt();
  const semanticSummary = getSemanticSummary();
  const rawMemory = getRawMemory();

  const memoryBlock = semanticSummary
    ? `Mémoire sémantique actuelle utile :\n${semanticSummary}`
    : 'Mémoire sémantique actuelle utile : vide.';

  const filteredConversation = Array.isArray(conversation)
    ? conversation
        .filter(
          (item) =>
            item &&
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.content === 'string'
        )
        .slice(-8)
    : [];

  const recentRawMemory = rawMemory.slice(-10);

  const messages = [
    {
      role: 'system',
      content: `${systemPrompt}\n\n=== MÉMOIRE SÉMANTIQUE ===\n${memoryBlock}`
    },
    ...recentRawMemory,
    ...filteredConversation,
    {
      role: 'user',
      content: message
    }
  ];

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    temperature: 0.85,
    max_tokens: 500
  });

  const reply = completion.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    throw new Error('Aucune réponse texte générée par OpenAI.');
  }

  appendToRawMemory('user', message);
  appendToRawMemory('assistant', reply);

  updateSemanticMemory(message, reply).catch((error) => {
    console.error('Erreur async mémoire sémantique:', error.message);
  });

  return reply;
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: 'nyra-backend',
    hasElevenLabsApiKey: !!ELEVENLABS_API_KEY,
    hasElevenLabsVoiceId: !!ELEVENLABS_VOICE_ID,
    hasOpenAiApiKey: !!OPENAI_API_KEY,
    openAiModel: OPENAI_MODEL,
    hasProfile: fs.existsSync(PROFILE_PATH),
    hasSystemPrompt: fs.existsSync(SYSTEM_PROMPT_PATH),
    hasRawMemory: fs.existsSync(RAW_MEMORY_PATH),
    hasSemanticMemory: fs.existsSync(SUMMARY_MEMORY_PATH)
  });
});

app.get('/memory', (req, res) => {
  try {
    res.json({
      ok: true,
      semanticSummary: getSemanticSummary(),
      rawMemory: getRawMemory()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/memory/reset', (req, res) => {
  try {
    saveRawMemory([]);
    saveSemanticSummary('');

    res.json({
      ok: true,
      message: 'Mémoire Nyra réinitialisée.'
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/test-voice', async (req, res) => {
  try {
    const text = 'Bonjour, je suis Nyra.';
    const audioBuffer = await synthesizeWithElevenLabs(text);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (error) {
    console.error('/test-voice error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/speak', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'Le champ "text" est requis.'
      });
    }

    const audioBuffer = await synthesizeWithElevenLabs(text);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (error) {
    console.error('/speak error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/speak-file', async (req, res) => {
  try {
    const text = String(req.query?.text || '').trim();

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'Le paramètre query "text" est requis.'
      });
    }

    const audioBuffer = await synthesizeWithElevenLabs(text);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline; filename="nyra.mp3"');
    res.send(audioBuffer);
  } catch (error) {
    console.error('/speak-file GET error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/speak-file', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'Le champ "text" est requis.'
      });
    }

    const audioBuffer = await synthesizeWithElevenLabs(text);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline; filename="nyra.mp3"');
    res.send(audioBuffer);
  } catch (error) {
    console.error('/speak-file POST error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    const conversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'Le champ "message" est requis.'
      });
    }

    const reply = await generateNyraReply(message, conversation);

    return res.json({
      ok: true,
      source: 'openai',
      model: OPENAI_MODEL,
      reply
    });
  } catch (error) {
    console.error('/chat error:', error);

    return res.status(500).json({
      ok: false,
      error: error.message || 'Erreur serveur sur /chat'
    });
  }
});

app.post('/chat-with-voice', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    const conversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'Le champ "message" est requis.'
      });
    }

    const reply = await generateNyraReply(message, conversation);
    const audioBuffer = await synthesizeWithElevenLabs(reply);

    res.setHeader('X-Nyra-Reply', encodeURIComponent(reply));
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (error) {
    console.error('/chat-with-voice error:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Erreur serveur sur /chat-with-voice'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Nyra backend lancé sur le port ${PORT}`);
});