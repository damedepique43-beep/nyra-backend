require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function getApiKey() {
  return (process.env.ELEVENLABS_API_KEY || "").trim();
}

function getVoiceId() {
  return (process.env.ELEVENLABS_VOICE_ID || "YxrwjAKoUKULGd0g8K9Y").trim();
}

function getPort() {
  return Number(process.env.PORT) || 3000;
}

async function synthesizeSpeech(text) {
  const apiKey = getApiKey();
  const voiceId = getVoiceId();

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY manquante");
  }

  if (!text || !String(text).trim()) {
    throw new Error("Texte manquant");
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: String(text).trim(),
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur ElevenLabs ${response.status} : ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Nyra backend running",
  });
});

app.get("/health", (req, res) => {
  const apiKey = getApiKey();
  const voiceId = getVoiceId();

  res.json({
    ok: true,
    hasApiKey: Boolean(apiKey),
    voiceId,
    port: getPort(),
  });
});

app.get("/test-voice", async (req, res) => {
  try {
    const audioBuffer = await synthesizeSpeech(
      "Bonjour, je suis Nyra. Le backend Railway fonctionne correctement."
    );

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    return res.send(audioBuffer);
  } catch (error) {
    console.error("Erreur /test-voice :", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Erreur inconnue",
    });
  }
});

app.post("/speak", async (req, res) => {
  try {
    const { text } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({
        ok: false,
        error: "Le champ 'text' est requis",
      });
    }

    const audioBuffer = await synthesizeSpeech(text);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    return res.send(audioBuffer);
  } catch (error) {
    console.error("Erreur /speak :", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Erreur inconnue",
    });
  }
});

app.post("/speak-file", async (req, res) => {
  try {
    const { text } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({
        ok: false,
        error: "Le champ 'text' est requis",
      });
    }

    const audioBuffer = await synthesizeSpeech(text);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="nyra-response.mp3"'
    );
    res.setHeader("Content-Length", audioBuffer.length);

    return res.send(audioBuffer);
  } catch (error) {
    console.error("Erreur /speak-file :", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Erreur inconnue",
    });
  }
});

app.listen(getPort(), "0.0.0.0", () => {
  console.log(`Nyra backend running on http://0.0.0.0:${getPort()}`);
});