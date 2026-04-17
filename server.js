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
const MEMORY_PATH = path.join(__dirname, 'memory.json');

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getMemory() {
  const mem = readJson(MEMORY_PATH);
  return Array.isArray(mem) ? mem : [];
}

function saveToMemory(entry) {
  const mem = getMemory();
  mem.push(entry);

  // garde seulement les 50 derniers messages
  const trimmed = mem.slice(-50);
  writeJson(MEMORY_PATH, trimmed);
}

function buildSystemPrompt() {
  const base = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  const profile = readJson(PROFILE_PATH);

  return `${base}\n\n=== PROFIL ===\n${JSON.stringify(profile, null, 2)}`;
}

async function synthesize(text) {
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
        model_id: 'eleven_multilingual_v2'
      })
    }
  );

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    hasOpenAiApiKey: !!OPENAI_API_KEY,
    hasProfile: fs.existsSync(PROFILE_PATH),
    hasSystemPrompt: fs.existsSync(SYSTEM_PROMPT_PATH),
    hasMemory: fs.existsSync(MEMORY_PATH)
  });
});

app.post('/chat-with-voice', async (req, res) => {
  try {
    const message = req.body.message;

    const memory = getMemory();

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...memory,
      { role: 'user', content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.85
    });

    const reply = completion.choices[0].message.content;

    // 💾 sauvegarde mémoire
    saveToMemory({ role: 'user', content: message });
    saveToMemory({ role: 'assistant', content: reply });

    const audio = await synthesize(reply);

    res.setHeader('X-Nyra-Reply', encodeURIComponent(reply));
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});