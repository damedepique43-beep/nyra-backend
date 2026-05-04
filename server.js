require('dotenv').config();

const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get('/', (req, res) => {
  res.json({
    ok: true,
    app: 'Nyra backend',
  });
});

app.post('/chat', async (req, res) => {
  const userMessage = req.body?.message;

  if (!userMessage) {
    return res.status(400).json({
      ok: false,
      error: 'Message manquant',
    });
  }

  try {
    // ⚡ Réponse rapide (pas de mémoire, pas de supabase)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.7,
      max_tokens: 150,
      messages: [
        {
          role: 'system',
          content: "Tu es Nyra, une IA humaine, naturelle, directe, intelligente.",
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const reply = completion.choices?.[0]?.message?.content || "Je suis là.";

    // ⚡ réponse immédiate
    res.json({
      ok: true,
      reply,
    });

    // 🔥 (OPTIONNEL PLUS TARD)
    // ici tu pourras remettre la mémoire en async

  } catch (error) {
    console.error('❌ ERROR:', error.message);

    res.status(500).json({
      ok: false,
      error: 'Erreur serveur',
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Nyra backend lancé sur le port ${PORT}`);
});