const { buildEngineResult } = require('./nyraEngineResultContract');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function includesAny(text, words) {
  const lower = normalizeText(text).toLowerCase();
  return words.some(word => lower.includes(word));
}

function uniqueArray(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function normalizeThought(thought) {
  const safeThought = thought && typeof thought === 'object' ? thought : {};
  const content = normalizeText(safeThought.content || safeThought.text || safeThought.message || thought || '');
  const userId = normalizeText(safeThought.user_id || safeThought.userId || 'local-user') || 'local-user';

  return {
    id: normalizeText(safeThought.id || ''),
    user_id: userId,
    content,
    source: normalizeText(safeThought.source || 'chat') || 'chat',
    status: normalizeText(safeThought.status || 'received') || 'received',
    metadata: safeThought.metadata && typeof safeThought.metadata === 'object' ? safeThought.metadata : {},
    created_at: normalizeText(safeThought.created_at || safeThought.createdAt || '') || null,
  };
}

function detectPrimaryIntent(text) {
  const lower = normalizeText(text).toLowerCase();

  if (!lower) {
    return {
      primary: 'empty',
      confidence: 1,
      signals: [],
    };
  }

  if (
    includesAny(lower, [
      'rappelle-moi',
      'rappelle moi',
      'rappel',
      'crée un rappel',
      'creer un rappel',
      'créer un rappel',
    ])
  ) {
    return {
      primary: 'create_reminder',
      confidence: 0.92,
      signals: ['reminder_language'],
    };
  }

  if (
    includesAny(lower, ['liste de courses', 'liste des courses']) &&
    includesAny(lower, ['ajoute', 'rajoute', 'mets', 'note'])
  ) {
    return {
      primary: 'add_to_collection',
      collection_hint: 'courses',
      confidence: 0.94,
      signals: ['collection_language', 'shopping_list_language'],
    };
  }

  if (
    includesAny(lower, [
      'je dois',
      'il faut',
      'pense à',
      'penser à',
      'à faire',
      'a faire',
      'ne pas oublier',
      'tâche',
      'tache',
    ]) ||
    /^(appeler|envoyer|répondre|repondre|payer|faire|passer|ranger|nettoyer|laver|acheter|prendre|préparer|preparer|terminer|finir|relancer|contacter|réserver|reserver|annuler|programmer|vérifier|verifier|imprimer|poster|déposer|deposer|chercher|commander|remplir|mettre|sortir)\b/i.test(text)
  ) {
    return {
      primary: 'create_task',
      confidence: 0.86,
      signals: ['task_language'],
    };
  }

  if (
    includesAny(lower, [
      'idée',
      'idee',
      'j’ai une idée',
      "j'ai une idée",
      'concept',
      'ça pourrait',
      'ca pourrait',
      'on pourrait',
      'j’imagine',
      "j'imagine",
    ])
  ) {
    return {
      primary: 'capture_idea',
      confidence: 0.84,
      signals: ['idea_language'],
    };
  }

  if (
    includesAny(lower, [
      'je me sens',
      'angoisse',
      'stress',
      'triste',
      'énervée',
      'énervé',
      'fatiguée',
      'fatigué',
      'peur',
      'mal',
      'surcharge',
    ])
  ) {
    return {
      primary: 'reflect_emotion',
      confidence: 0.82,
      signals: ['emotion_language'],
    };
  }

  if (
    includesAny(lower, [
      'nyra',
      'novacall',
      'projet',
      'app',
      'application',
      'backend',
      'code',
      'roadmap',
      'cahier des charges',
      'mvp',
      'fonctionnalité',
      'fonctionnalite',
    ])
  ) {
    return {
      primary: 'project_thought',
      confidence: 0.78,
      signals: ['project_language'],
    };
  }

  return {
    primary: 'capture_note',
    confidence: 0.62,
    signals: ['fallback_note'],
  };
}

function detectTemporalHints(text) {
  const lower = normalizeText(text).toLowerCase();
  const hints = [];

  const explicitTimeMatch = lower.match(/(?:à|a|vers)?\s*(\d{1,2})\s*(?:h|:|\.)\s*(\d{0,2})/i);

  if (includesAny(lower, ["aujourd'hui", 'aujourd’hui', 'ce soir', 'maintenant'])) {
    hints.push({ type: 'relative_day', value: 'today', confidence: 0.9 });
  }

  if (includesAny(lower, ['demain matin'])) {
    hints.push({ type: 'relative_day_part', value: 'tomorrow_morning', confidence: 0.9 });
  } else if (includesAny(lower, ['demain après-midi', 'demain apres-midi'])) {
    hints.push({ type: 'relative_day_part', value: 'tomorrow_afternoon', confidence: 0.9 });
  } else if (includesAny(lower, ['demain soir'])) {
    hints.push({ type: 'relative_day_part', value: 'tomorrow_evening', confidence: 0.9 });
  } else if (includesAny(lower, ['demain'])) {
    hints.push({ type: 'relative_day', value: 'tomorrow', confidence: 0.9 });
  }

  if (includesAny(lower, ['cette semaine', 'dans la semaine'])) {
    hints.push({ type: 'relative_period', value: 'this_week', confidence: 0.78 });
  }

  if (includesAny(lower, ['ce week-end', 'week-end', 'weekend'])) {
    hints.push({ type: 'relative_period', value: 'weekend', confidence: 0.78 });
  }

  if (explicitTimeMatch?.[1]) {
    const hour = Number(explicitTimeMatch[1]);
    const minute = explicitTimeMatch[2] ? Number(explicitTimeMatch[2]) : 0;

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      hints.push({
        type: 'time_of_day',
        value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        confidence: 0.86,
      });
    }
  }

  const relativeDurationMatch = lower.match(/dans\s+(\d{1,4})\s*(secondes?|sec|secs|s|minutes?|min|mins|mn|mns|heures?|heure|h)\b/i);

  if (relativeDurationMatch?.[1] && relativeDurationMatch?.[2]) {
    hints.push({
      type: 'relative_duration',
      value: {
        amount: Number(relativeDurationMatch[1]),
        unit: relativeDurationMatch[2],
      },
      confidence: 0.92,
    });
  }

  return hints;
}

function detectProjectHints(text) {
  const lower = normalizeText(text).toLowerCase();
  const hints = [];
  const explicitProjectMatch = lower.match(/projet\s+([a-z0-9àâçéèêëîïôûùüÿñæœ' -]{2,40})/i);

  if (explicitProjectMatch?.[1]) {
    const projectName = normalizeText(explicitProjectMatch[1]).replace(/[.,!?;:]+$/g, '').trim();

    if (projectName) {
      hints.push({
        type: 'explicit_project_name',
        value: projectName,
        key: normalizeKey(projectName),
        confidence: 0.9,
      });
    }
  }

  ['nyra', 'novacall', 'dame de pique', 'brume ardente'].forEach(projectName => {
    if (lower.includes(projectName)) {
      hints.push({
        type: 'known_project_reference',
        value: projectName,
        key: normalizeKey(projectName),
        confidence: 0.72,
      });
    }
  });

  return hints;
}

function detectEntityHints(text) {
  const entities = [];
  const normalized = normalizeText(text);

  const knownOrganizations = [
    'CAF',
    'CPAM',
    'Pôle Emploi',
    'Pole Emploi',
    'France Travail',
    'impôts',
    'impots',
    'banque',
    'assurance',
  ];

  knownOrganizations.forEach(name => {
    const normalizedName = normalizeText(name).toLowerCase();
    if (normalized.toLowerCase().includes(normalizedName)) {
      entities.push({
        type: 'organization',
        value: name,
        key: normalizeKey(name),
        confidence: 0.82,
      });
    }
  });

  return entities;
}

function detectEmotionalSignals(text) {
  const lower = normalizeText(text).toLowerCase();
  const signals = [];

  const emotionMap = [
    { id: 'stress', words: ['stress', 'angoisse', 'panique', 'surcharge'] },
    { id: 'sadness', words: ['triste', 'pleure', 'pleurer', 'mal au cœur', 'mal au coeur'] },
    { id: 'anger', words: ['colère', 'colere', 'énervée', 'enervee', 'énervé', 'enerve'] },
    { id: 'fatigue', words: ['fatiguée', 'fatiguee', 'fatigué', 'fatigue', 'épuisée', 'epuisee', 'vidée', 'videe'] },
    { id: 'fear', words: ['peur', 'inquiète', 'inquiete', 'inquiet'] },
  ];

  emotionMap.forEach(emotion => {
    if (includesAny(lower, emotion.words)) {
      signals.push({
        type: 'emotion',
        value: emotion.id,
        confidence: 0.76,
      });
    }
  });

  return signals;
}

function deriveUnderstandingType(intent, temporalHints, projectHints, emotionalSignals) {
  if (intent.primary === 'create_task') return 'task_understanding';
  if (intent.primary === 'create_reminder') return 'reminder_understanding';
  if (intent.primary === 'add_to_collection') return 'collection_understanding';
  if (intent.primary === 'capture_idea') return projectHints.length ? 'project_idea_understanding' : 'idea_understanding';
  if (intent.primary === 'reflect_emotion' || emotionalSignals.length) return 'emotional_understanding';
  if (intent.primary === 'project_thought' || projectHints.length) return 'project_understanding';
  if (temporalHints.length) return 'time_bound_note_understanding';
  return 'note_understanding';
}

function understandThought(thoughtInput) {
  const thought = normalizeThought(thoughtInput);
  const text = thought.content;
  const intent = detectPrimaryIntent(text);
  const temporalHints = detectTemporalHints(text);
  const projectHints = detectProjectHints(text);
  const entities = detectEntityHints(text);
  const emotionalSignals = detectEmotionalSignals(text);
  const understandingType = deriveUnderstandingType(intent, temporalHints, projectHints, emotionalSignals);

  const output = {
    thought_id: thought.id || null,
    user_id: thought.user_id,
    source: thought.source,
    type: understandingType,
    intent,
    entities,
    temporal_hints: temporalHints,
    project_hints: projectHints,
    emotional_signals: emotionalSignals,
    ambiguities: [],
    confidence: intent.confidence,
    requires_reasoning: true,
    raw_text: text,
  };

  return {
    ...buildEngineResult({
      engine: 'understanding',
      engineVersion: 'understanding-v1',
      output,
      nextEngine: 'reasoning',
      behaviorChanged: false,
      metadata: {
        legacy_engine_name: 'nyraUnderstandingEngine',
      },
    }),
    ...output,
    engine: 'understanding',
    engine_version: 'understanding-v1',
    behavior_changed: false,
  };
}

module.exports = {
  understandThought,
};
