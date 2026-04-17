require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// ✅ Voix forcée ici
const ELEVENLABS_VOICE_ID = "YxrwjAKoUKULGd0g8K9Y";

async function generateSpeechBuffer(text) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.85,
          style: 0.4,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur ElevenLabs: ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

app.get("/", (req, res) => {
  res.send("Nyra backend OK");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    hasApiKey: Boolean(ELEVENLABS_API_KEY),
    voiceId: ELEVENLABS_VOICE_ID,
  });
});

app.get("/test-voice", async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({
        error: "ELEVENLABS_API_KEY manquante dans le fichier .env",
      });
    }

    const audioBuffer = await generateSpeechBuffer(
      "Bonjour, je suis Nyra. Ceci est un test de voix."
    );

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.setHeader("Content-Disposition", 'inline; filename="nyra-test.mp3"');

    return res.send(audioBuffer);
  } catch (error) {
    console.error("Erreur serveur /test-voice :", error);

    return res.status(500).json({
      error: "Erreur serveur",
      details: error.message,
    });
  }
});

app.get("/speak-file", async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({
        error: "ELEVENLABS_API_KEY manquante dans le fichier .env",
      });
    }

    const text = String(req.query.text || "").trim();

    if (!text) {
      return res.status(400).json({
        error: "Le texte est requis.",
      });
    }

    const audioBuffer = await generateSpeechBuffer(text);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.setHeader("Cache-Control", "no-store");

    return res.send(audioBuffer);
  } catch (error) {
    console.error("Erreur serveur /speak-file :", error);

    return res.status(500).json({
      error: "Erreur serveur",
      details: error.message,
    });
  }
});

app.post("/speak", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        error: "Le champ 'text' est requis.",
      });
    }

    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({
        error: "ELEVENLABS_API_KEY manquante dans le fichier .env",
      });
    }

    const audioBuffer = await generateSpeechBuffer(text.trim());

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);

    return res.send(audioBuffer);
  } catch (error) {
    console.error("Erreur serveur /speak :", error);

    return res.status(500).json({
      error: "Erreur serveur",
      details: error.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Nyra backend running on http://localhost:${PORT}`);
});