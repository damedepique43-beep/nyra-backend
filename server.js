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

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Erreur lecture JSON :', error.message);
    return null;
  }
}

function readTextFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error('Erreur lecture TXT :', error.message);
    return '';
  }
}

function buildNyraSystemPrompt() {
  const basePrompt = readTextFileSafe(SYSTEM_PROMPT_PATH).trim();
  const profile = readJsonFileSafe(PROFILE_PATH);

  const profileBlock = profile
    ? `\n\n=== PROFIL UTILISATRICE NYRA ===\n${JSON.stringify(profile, null, 2)}`
    : '\n\n=== PROFIL UTILISATRICE NYRA ===\nAucun profil chargé.';

  return `${basePrompt}${profileBlock}`;
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

function getFallbackNyraReply(message) {
  const clean = String(message || '').trim();

  if (!clean) {
    return "Je suis là. Dis-moi ce que tu as sur le cœur ou ce dont tu as besoin, et on reprend proprement.";
  }

  return `J’ai bien reçu ton message : "${clean}". Pour l’instant je peux encore te répondre en mode secours, mais l’objectif est que mon vrai cerveau OpenAI prenne totalement le relais.`;
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
    hasSystemPrompt: fs.existsSync(SYSTEM_PROMPT_PATH)
  });
});

app.get('/test-voice', async (req, res) => {
  try {
    const text = "Bonjour, je suis Nyra. Le backend voix et le cerveau IA sont en cours d’intégration.";
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

    if (!openai) {
      const fallbackReply = getFallbackNyraReply(message);

      return res.json({
        ok: true,
        source: 'fallback-no-openai-key',
        reply: fallbackReply
      });
    }

    const systemPrompt = buildNyraSystemPrompt();

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...conversation
        .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
        .slice(-12)
        .map((item) => ({
          role: item.role,
          content: item.content
        })),
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
      return res.status(500).json({
        ok: false,
        error: 'Aucune réponse texte générée par OpenAI.'
      });
    }

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

    let reply = '';

    if (!openai) {
      reply = getFallbackNyraReply(message);
    } else {
      const systemPrompt = buildNyraSystemPrompt();

      const messages = [
        {
          role: 'system',
          content: systemPrompt
        },
        ...conversation
          .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
          .slice(-12)
          .map((item) => ({
            role: item.role,
            content: item.content
          })),
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

      reply = completion.choices?.[0]?.message?.content?.trim() || '';
    }

    if (!reply) {
      return res.status(500).json({
        ok: false,
        error: 'Aucune réponse générée.'
      });
    }

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