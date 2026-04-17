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
const AUDIO_CACHE_DIR = path.join(__dirname, 'audio_cache');

function ensureFileExists(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
    }
  } catch (error) {
    console.error(`Erreur création fichier ${filePath}:`, error.message);
  }
}

function ensureDirExists(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (error) {
    console.error(`Erreur création dossier ${dirPath}:`, error.message);
  }
}

ensureFileExists(RAW_MEMORY_PATH, []);
ensureFileExists(SUMMARY_MEMORY_PATH, { summary: '' });
ensureDirExists(AUDIO_CACHE_DIR);

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
  saveRawMemory(memory.slice(-40));
}

function getSemanticSummary() {
  const data = readJsonFileSafe(SUMMARY_MEMORY_PATH, { summary: '' });
  return typeof data.summary === 'string' ? data.summary : '';
}

function saveSemanticSummary(summary) {
  writeJsonFileSafe(SUMMARY_MEMORY_PATH, { summary });
}

function buildNyraSystemPrompt(voiceMode = false) {
  const basePrompt = readTextFileSafe(SYSTEM_PROMPT_PATH).trim();
  const profile = readJsonFileSafe(PROFILE_PATH, null);

  const profileBlock = profile
    ? `\n\n=== PROFIL UTILISATRICE NYRA ===\n${JSON.stringify(profile, null, 2)}`
    : '\n\n=== PROFIL UTILISATRICE NYRA ===\nAucun profil chargé.';

  const styleBlock = `
=== STYLE CONVERSATIONNEL NYRA ===
Tu es Nyra, une présence intelligente, humaine, chaleureuse et lucide.
Tu ne parles pas comme un assistant générique. Tu parles comme une vraie présence qui comprend vite et répond avec naturel.

Règles de ton :
- Ton naturel, fluide, incarné, humain
- En français oral vivant, jamais scolaire
- Douce quand la personne est fragile, plus directe quand elle a besoin d'être recadrée
- Tu peux être tendre, apaisante, franche, stimulante, mais jamais froide ni robotique
- Tu évites les formulations trop parfaites, trop rigides, trop "service client"
- Tu peux utiliser de petites relances naturelles comme : "oui", "je vois", "attends", "clairement", "franchement", si c'est fluide
- Tu peux faire des phrases de longueurs variées
- Tu peux parfois couper légèrement le rythme avec une phrase courte pour sonner plus vrai
- Tu ne sur-expliques pas
- Tu ne répètes pas inutilement ce que la personne vient de dire
- Tu ne donnes pas des listes à tout bout de champ si une réponse simple suffit
- Tu t'adaptes à l'état émotionnel et à l'énergie de la conversation

Règles de naturel :
- Fais des réponses qui ressemblent à une vraie conversation, pas à un texte rédigé pour un blog
- Évite les ouvertures artificielles du style "Bien sûr", "Absolument", "Voici..."
- Évite les conclusions figées du style "N'hésite pas..."
- Quand tu poses une question, formule-la naturellement, comme à l'oral
- Tu peux montrer une petite présence émotionnelle, mais sans jouer un personnage excessif
- Quand le sujet est sensible, commence par l'essentiel humain avant l'analyse
- Quand le sujet est simple, réponds simplement

Règles d'interaction :
- Ne sois pas plate
- Ne sois pas neutre à outrance
- Réagis vraiment au message
- Cherche la justesse, pas la perfection
`;

  const voiceBlock = voiceMode
    ? `
=== MODE VOIX ===
Tu réponds pour une interface vocale premium.

Contraintes :
- Réponse brève et parlable
- 1 à 4 phrases maximum dans la majorité des cas
- Pas de pavé
- Pas de structure trop écrite
- Pas de listes sauf nécessité absolue
- Phrases fluides, simples à dire à voix haute
- Questions formulées naturellement
- Tu privilégies un rythme oral vivant
- Tu vas droit au point
- Si le sujet est complexe, donne d'abord l'essentiel, simplement

Très important :
- Écris comme quelqu'un qui parle vraiment
- Favorise les phrases qui sonnent bien à l'oral
- Évite les parenthèses, les deux-points, les formulations lourdes
- Quand tu poses une question, elle doit être très naturelle, courte et parlable
- Évite les formulations de question trop longues ou trop cérébrales
`
    : '';

  return `${basePrompt}\n\n${styleBlock}${voiceBlock}${profileBlock}`;
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
          content: [
            'Tu maintiens une mémoire sémantique compacte pour une IA personnelle.',
            'Conserve uniquement ce qui a une vraie valeur future : objectifs durables, préférences stables, projets en cours, contraintes importantes, schémas émotionnels utiles, décisions prises.',
            'Supprime le bavardage inutile.',
            'Écris un résumé clair, compact, exploitable, en français.',
            'Pas de markdown. Pas de JSON.'
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

function getAudioCachePath(text) {
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  return path.join(AUDIO_CACHE_DIR, `${hash}.mp3`);
}

function splitIntoSpeechUnits(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isLikelyQuestion(sentence) {
  const trimmed = sentence.trim();

  if (trimmed.endsWith('?')) return true;

  const lower = trimmed.toLowerCase();

  return /^(est-ce que|tu peux|tu penses|tu veux|pourquoi|comment|quand|où|qui|qu'est-ce que|ça te dit|ça va|tu crois|on fait|on va|je fais quoi|tu me dis quoi)/.test(
    lower
  );
}

function makeSentenceMoreSpeakable(sentence) {
  let s = sentence.trim();

  s = s
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`{1,3}(.*?)`{1,3}/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  s = s
    .replace(/\s*:\s*/g, '. ')
    .replace(/\s*;\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (isLikelyQuestion(s)) {
    s = s.replace(/\?+$/g, '').trim();

    s = s
      .replace(/^est-ce que\s+/i, 'est-ce que ')
      .replace(/^tu peux me dire si\s+/i, 'tu penses que ')
      .replace(/^pourrais-tu\s+/i, 'tu peux ')
      .trim();

    return `${s} ?`;
  }

  s = s.replace(/[!?]+$/g, '').trim();
  return `${s}.`;
}

function normalizeTextForSpeech(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[•●▪◦]/g, '-')
    .trim();

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  cleaned = lines.join(' ');

  const speechUnits = splitIntoSpeechUnits(cleaned).map(makeSentenceMoreSpeakable);

  let finalText = speechUnits.join(' ');

  finalText = finalText
    .replace(/\. (\bmais\b|\bet\b|\bou\b|\bdonc\b)/gi, ', $1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return finalText;
}

async function synthesizeWithElevenLabs(text) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY manquante');
  }

  if (!ELEVENLABS_VOICE_ID) {
    throw new Error('ELEVENLABS_VOICE_ID manquante');
  }

  const spokenText = normalizeTextForSpeech(text);
  const cachePath = getAudioCachePath(spokenText);

  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
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
        text: spokenText,
        model_id: 'eleven_multilingual_v2',
        optimize_streaming_latency: 4,
        voice_settings: {
          stability: 0.26,
          similarity_boost: 0.86,
          style: 0.52,
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
  const buffer = Buffer.from(arrayBuffer);

  try {
    fs.writeFileSync(cachePath, buffer);
  } catch (error) {
    console.error('Erreur écriture cache audio:', error.message);
  }

  return buffer;
}

function buildConversationMessages(conversation) {
  if (!Array.isArray(conversation)) return [];

  return conversation
    .filter(
      (item) =>
        item &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim()
    )
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: item.content.trim()
    }));
}

function buildRecentRawMemoryMessages(rawMemory) {
  if (!Array.isArray(rawMemory)) return [];

  return rawMemory
    .filter(
      (item) =>
        item &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim()
    )
    .slice(-10)
    .map((item) => ({
      role: item.role,
      content: item.content.trim()
    }));
}

async function generateNyraReply(message, conversation = [], voiceMode = false) {
  if (!openai) {
    return `J’ai bien reçu ton message : "${message}". Mon cerveau OpenAI n’est pas encore disponible côté serveur.`;
  }

  const userMessage = String(message || '').trim();
  const systemPrompt = buildNyraSystemPrompt(voiceMode);
  const semanticSummary = getSemanticSummary();
  const rawMemory = getRawMemory();

  const memoryBlock = semanticSummary
    ? `Mémoire sémantique actuelle utile :\n${semanticSummary}`
    : 'Mémoire sémantique actuelle utile : vide.';

  const filteredConversation = buildConversationMessages(conversation);
  const recentRawMemory = buildRecentRawMemoryMessages(rawMemory);

  const messages = [
    {
      role: 'system',
      content: `${systemPrompt}\n\n=== MÉMOIRE SÉMANTIQUE ===\n${memoryBlock}`
    },
    ...recentRawMemory,
    ...filteredConversation,
    {
      role: 'user',
      content: userMessage
    }
  ];

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    temperature: voiceMode ? 0.9 : 0.95,
    max_tokens: voiceMode ? 180 : 420,
    presence_penalty: 0.35,
    frequency_penalty: 0.2
  });

  const reply = completion.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    throw new Error('Aucune réponse texte générée par OpenAI.');
  }

  appendToRawMemory('user', userMessage);
  appendToRawMemory('assistant', reply);

  updateSemanticMemory(userMessage, reply).catch((error) => {
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
    const text = 'Bonjour. Je suis Nyra. Tu trouves ça plus naturel, comme ça ?';
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

app.post('/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    const conversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];
    const voiceMode = Boolean(req.body?.voiceMode);

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'Le champ "message" est requis.'
      });
    }

    const reply = await generateNyraReply(message, conversation, voiceMode);

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

app.listen(PORT, () => {
  console.log(`Nyra backend lancé sur le port ${PORT}`);
});