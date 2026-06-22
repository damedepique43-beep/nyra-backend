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


function detectTaskCognitiveState(text) {
  const lower = normalizeText(text).toLowerCase();

  const hasTaskDomain = includesAny(lower, [
    'je dois',
    'il faut',
    'pense à',
    'penser à',
    'à faire',
    'a faire',
    'ne pas oublier',
    'tâche',
    'tache',
    'trucs à faire',
    'trucs a faire',
    'choses à faire',
    'choses a faire',
  ]) || /^(appeler|envoyer|répondre|repondre|payer|faire|passer|ranger|nettoyer|laver|acheter|prendre|préparer|preparer|terminer|finir|relancer|contacter|réserver|reserver|annuler|programmer|vérifier|verifier|imprimer|poster|déposer|deposer|chercher|commander|remplir|mettre|sortir)\b/i.test(text);

  const overloadSignals = [
    'trop de choses',
    'trop de trucs',
    'plein de choses',
    'plein de trucs',
    'beaucoup de choses',
    'beaucoup de trucs',
    'dix trucs',
    '10 trucs',
    'dix choses',
    '10 choses',
    'je ne sais pas par quoi commencer',
    'je sais pas par quoi commencer',
    'je ne sais pas par ou commencer',
    'je sais pas par ou commencer',
    'par quoi commencer',
    'par ou commencer',
    'tout se mélange',
    'tout se melange',
    'je suis perdu',
    'je suis perdue',
    'charge mentale',
    'surcharge',
    'submergé',
    'submerge',
    'submergée',
    'submergee',
    'débordé',
    'deborde',
    'débordée',
    'debordee',
  ];

  const preventForgettingSignals = [
    'pense à',
    'pense a',
    'penser à',
    'penser a',
    'ne pas oublier',
    'pas oublier',
    'faut que je pense',
    'il faut que je pense',
    'que je pense à',
    'que je pense a',
  ];

  if (includesAny(lower, overloadSignals)) {
    return {
      domain: hasTaskDomain ? 'task' : 'cognitive_load',
      primary: 'cognitive_overload',
      confidence: 0.9,
      signals: ['cognitive_overload_language'],
      recommended_handling: 'clarify_and_reduce_load_before_action',
    };
  }

  if (includesAny(lower, preventForgettingSignals)) {
    return {
      domain: 'task',
      primary: 'prevent_forgetting',
      confidence: 0.88,
      signals: ['forgetting_prevention_language'],
      recommended_handling: 'prefer_future_prompt_or_reminder',
    };
  }

  if (hasTaskDomain) {
    return {
      domain: 'task',
      primary: 'simple_action',
      confidence: 0.82,
      signals: ['task_language'],
      recommended_handling: 'prepare_action_if_decision_allows',
    };
  }

  return {
    domain: 'unknown',
    primary: 'unspecified',
    confidence: 0.5,
    signals: [],
    recommended_handling: 'continue_understanding',
  };
}

function detectPrimaryIntent(text) {
  const lower = normalizeText(text).toLowerCase();

  if (!lower) {
    return {
      primary: 'empty',
      domain: 'empty',
      cognitive_state: 'unspecified',
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
      domain: 'time_support',
      cognitive_state: 'prevent_forgetting',
      cognitive_state_confidence: 0.9,
      confidence: 0.92,
      signals: ['reminder_language', 'forgetting_prevention_language'],
      recommended_handling: 'prepare_future_prompt_or_reminder',
    };
  }

  if (
    includesAny(lower, ['liste de courses', 'liste des courses']) &&
    includesAny(lower, ['ajoute', 'rajoute', 'mets', 'note'])
  ) {
    return {
      primary: 'add_to_collection',
      domain: 'collection',
      cognitive_state: 'organize_information',
      cognitive_state_confidence: 0.86,
      collection_hint: 'courses',
      confidence: 0.94,
      signals: ['collection_language', 'shopping_list_language'],
      recommended_handling: 'organize_into_collection',
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
    const taskCognitiveState = detectTaskCognitiveState(text);

    if (taskCognitiveState.primary === 'cognitive_overload') {
      return {
        primary: 'reflect_emotion',
        domain: taskCognitiveState.domain,
        cognitive_state: 'cognitive_overload',
        cognitive_state_confidence: taskCognitiveState.confidence,
        confidence: 0.88,
        signals: ['task_language', ...taskCognitiveState.signals],
        original_primary_intent: 'create_task',
        recommended_handling: taskCognitiveState.recommended_handling,
      };
    }

    if (taskCognitiveState.primary === 'prevent_forgetting') {
      return {
        primary: 'create_reminder',
        domain: 'task',
        cognitive_state: 'prevent_forgetting',
        cognitive_state_confidence: taskCognitiveState.confidence,
        confidence: 0.88,
        signals: ['task_language', ...taskCognitiveState.signals],
        original_primary_intent: 'create_task',
        recommended_handling: taskCognitiveState.recommended_handling,
      };
    }

    return {
      primary: 'create_task',
      domain: 'task',
      cognitive_state: 'simple_action',
      cognitive_state_confidence: taskCognitiveState.confidence,
      confidence: 0.86,
      signals: ['task_language'],
      recommended_handling: 'prepare_action_if_decision_allows',
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
      domain: 'idea',
      cognitive_state: 'preserve_thought',
      cognitive_state_confidence: 0.82,
      confidence: 0.84,
      signals: ['idea_language'],
      recommended_handling: 'preserve_and_structure_thought',
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
      domain: 'emotion',
      cognitive_state: 'emotional_regulation',
      cognitive_state_confidence: 0.82,
      confidence: 0.82,
      signals: ['emotion_language'],
      recommended_handling: 'support_regulation_before_action',
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
      domain: 'project',
      cognitive_state: 'preserve_project_context',
      cognitive_state_confidence: 0.78,
      confidence: 0.78,
      signals: ['project_language'],
      recommended_handling: 'preserve_and_structure_thought',
    };
  }

  return {
    primary: 'capture_note',
    domain: 'note',
    cognitive_state: 'preserve_context',
    cognitive_state_confidence: 0.62,
    confidence: 0.62,
    signals: ['fallback_note'],
    recommended_handling: 'preserve_context',
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
  if (intent.cognitive_state === 'cognitive_overload') return 'task_overload_understanding';
  if (intent.cognitive_state === 'prevent_forgetting') return 'forgetting_prevention_understanding';
  if (intent.primary === 'create_task') return 'task_understanding';
  if (intent.primary === 'create_reminder') return 'reminder_understanding';
  if (intent.primary === 'add_to_collection') return 'collection_understanding';
  if (intent.primary === 'capture_idea') return projectHints.length ? 'project_idea_understanding' : 'idea_understanding';
  if (intent.primary === 'reflect_emotion' || emotionalSignals.length) return 'emotional_understanding';
  if (intent.primary === 'project_thought' || projectHints.length) return 'project_understanding';
  if (temporalHints.length) return 'time_bound_note_understanding';
  return 'note_understanding';
}

function buildObservation({
  id,
  type,
  value,
  confidence = 0.5,
  evidence = [],
  metadata = {},
}) {
  return {
    id: normalizeKey(id || type || 'observation'),
    type: normalizeText(type || 'observation') || 'observation',
    value,
    confidence: Math.min(1, Math.max(0, Number(confidence) || 0)),
    evidence: uniqueArray(evidence.map(item => normalizeText(item)).filter(Boolean)),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };
}

function buildFact({
  id,
  type,
  statement,
  confidence = 0.5,
  observationIds = [],
  metadata = {},
}) {
  return {
    id: normalizeKey(id || type || 'fact'),
    type: normalizeText(type || 'fact') || 'fact',
    statement: normalizeText(statement),
    confidence: Math.min(1, Math.max(0, Number(confidence) || 0)),
    based_on_observations: uniqueArray(observationIds.map(item => normalizeText(item)).filter(Boolean)),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };
}

function buildHypothesis({
  id,
  type,
  statement,
  confidence = 0.5,
  factIds = [],
  status = 'provisional',
  metadata = {},
}) {
  return {
    id: normalizeKey(id || type || 'hypothesis'),
    type: normalizeText(type || 'hypothesis') || 'hypothesis',
    statement: normalizeText(statement),
    confidence: Math.min(1, Math.max(0, Number(confidence) || 0)),
    status: normalizeText(status || 'provisional') || 'provisional',
    based_on_facts: uniqueArray(factIds.map(item => normalizeText(item)).filter(Boolean)),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };
}

function buildObservations({
  thought,
  intent,
  temporalHints,
  projectHints,
  entities,
  emotionalSignals,
}) {
  const observations = [];

  if (thought.content) {
    observations.push(buildObservation({
      id: 'raw_text_received',
      type: 'raw_content',
      value: thought.content,
      confidence: 1,
      evidence: ['Thought contains normalized textual content.'],
      metadata: {
        source: thought.source,
        character_count: thought.content.length,
      },
    }));
  }

  observations.push(buildObservation({
    id: `intent_signal_${intent.primary}`,
    type: 'intent_signal',
    value: intent.primary,
    confidence: intent.confidence,
    evidence: intent.signals || [],
    metadata: {
      domain: intent.domain || null,
      cognitive_state: intent.cognitive_state || null,
      original_primary_intent: intent.original_primary_intent || null,
      recommended_handling: intent.recommended_handling || null,
      collection_hint: intent.collection_hint || null,
    },
  }));

  if (intent.cognitive_state && intent.cognitive_state !== 'unspecified') {
    observations.push(buildObservation({
      id: `cognitive_state_signal_${intent.cognitive_state}`,
      type: 'cognitive_state_signal',
      value: intent.cognitive_state,
      confidence: intent.cognitive_state_confidence || intent.confidence || 0.5,
      evidence: intent.signals || [],
      metadata: {
        domain: intent.domain || null,
        recommended_handling: intent.recommended_handling || null,
      },
    }));
  }

  temporalHints.forEach((hint, index) => {
    observations.push(buildObservation({
      id: `temporal_signal_${index + 1}_${hint.type}`,
      type: 'temporal_signal',
      value: hint.value,
      confidence: hint.confidence,
      evidence: [hint.type],
    }));
  });

  projectHints.forEach((hint, index) => {
    observations.push(buildObservation({
      id: `project_signal_${index + 1}_${hint.key || hint.type}`,
      type: 'project_signal',
      value: hint.value,
      confidence: hint.confidence,
      evidence: [hint.type],
      metadata: {
        key: hint.key || null,
      },
    }));
  });

  entities.forEach((entity, index) => {
    observations.push(buildObservation({
      id: `entity_signal_${index + 1}_${entity.key || entity.type}`,
      type: 'entity_signal',
      value: entity.value,
      confidence: entity.confidence,
      evidence: [entity.type],
      metadata: {
        key: entity.key || null,
      },
    }));
  });

  emotionalSignals.forEach((signal, index) => {
    observations.push(buildObservation({
      id: `emotional_signal_${index + 1}_${signal.value}`,
      type: 'emotional_signal',
      value: signal.value,
      confidence: signal.confidence,
      evidence: [signal.type],
    }));
  });

  return observations;
}

function buildFacts({
  thought,
  intent,
  temporalHints,
  projectHints,
  entities,
  emotionalSignals,
  observations,
}) {
  const observationsByType = observations.reduce((acc, observation) => {
    acc[observation.type] = acc[observation.type] || [];
    acc[observation.type].push(observation.id);
    return acc;
  }, {});

  const facts = [];

  if (thought.content) {
    facts.push(buildFact({
      id: 'thought_has_textual_content',
      type: 'content_fact',
      statement: 'The Thought contains textual content that can be understood by the cognitive pipeline.',
      confidence: 1,
      observationIds: observationsByType.raw_content || [],
      metadata: {
        source: thought.source,
      },
    }));
  }

  facts.push(buildFact({
    id: `primary_intent_is_${intent.primary}`,
    type: 'intent_fact',
    statement: `The current best explicit intent is "${intent.primary}".`,
    confidence: intent.confidence,
    observationIds: observationsByType.intent_signal || [],
    metadata: {
      domain: intent.domain || null,
      cognitive_state: intent.cognitive_state || null,
      original_primary_intent: intent.original_primary_intent || null,
      recommended_handling: intent.recommended_handling || null,
      signals: intent.signals || [],
      collection_hint: intent.collection_hint || null,
    },
  }));

  if (intent.cognitive_state && intent.cognitive_state !== 'unspecified') {
    facts.push(buildFact({
      id: `thought_cognitive_state_is_${intent.cognitive_state}`,
      type: 'cognitive_state_fact',
      statement: `The Thought appears to express the cognitive state "${intent.cognitive_state}" within domain "${intent.domain || 'unknown'}".`,
      confidence: intent.cognitive_state_confidence || intent.confidence || 0.5,
      observationIds: observationsByType.cognitive_state_signal || [],
      metadata: {
        domain: intent.domain || null,
        cognitive_state: intent.cognitive_state || null,
        recommended_handling: intent.recommended_handling || null,
      },
    }));
  }

  if (temporalHints.length > 0) {
    facts.push(buildFact({
      id: 'thought_contains_temporal_information',
      type: 'temporal_fact',
      statement: 'The Thought contains temporal information that may influence future decisions.',
      confidence: Math.max(...temporalHints.map(hint => Number(hint.confidence) || 0)),
      observationIds: observationsByType.temporal_signal || [],
      metadata: {
        temporal_hint_count: temporalHints.length,
      },
    }));
  }

  if (projectHints.length > 0) {
    facts.push(buildFact({
      id: 'thought_mentions_project_context',
      type: 'project_fact',
      statement: 'The Thought mentions or implies a project context.',
      confidence: Math.max(...projectHints.map(hint => Number(hint.confidence) || 0)),
      observationIds: observationsByType.project_signal || [],
      metadata: {
        project_keys: uniqueArray(projectHints.map(hint => hint.key).filter(Boolean)),
      },
    }));
  }

  if (entities.length > 0) {
    facts.push(buildFact({
      id: 'thought_mentions_known_entities',
      type: 'entity_fact',
      statement: 'The Thought mentions one or more known entities.',
      confidence: Math.max(...entities.map(entity => Number(entity.confidence) || 0)),
      observationIds: observationsByType.entity_signal || [],
      metadata: {
        entity_keys: uniqueArray(entities.map(entity => entity.key).filter(Boolean)),
      },
    }));
  }

  if (emotionalSignals.length > 0) {
    facts.push(buildFact({
      id: 'thought_contains_emotional_signal',
      type: 'emotional_fact',
      statement: 'The Thought contains at least one emotional signal.',
      confidence: Math.max(...emotionalSignals.map(signal => Number(signal.confidence) || 0)),
      observationIds: observationsByType.emotional_signal || [],
      metadata: {
        emotion_values: uniqueArray(emotionalSignals.map(signal => signal.value).filter(Boolean)),
      },
    }));
  }

  return facts;
}

function buildHypotheses({
  intent,
  temporalHints,
  projectHints,
  emotionalSignals,
  facts,
}) {
  const factIds = facts.map(fact => fact.id);
  const hypotheses = [];

  if (intent.cognitive_state === 'cognitive_overload') {
    hypotheses.push(buildHypothesis({
      id: 'thought_may_need_load_reduction',
      type: 'emotional_support_hypothesis',
      statement: 'The Thought may primarily need cognitive load reduction or regulation before any operational action.',
      confidence: intent.cognitive_state_confidence || 0.84,
      factIds,
      metadata: {
        domain: intent.domain || 'task',
        cognitive_state: intent.cognitive_state,
        recommended_handling: intent.recommended_handling || 'clarify_and_reduce_load_before_action',
      },
    }));

    hypotheses.push(buildHypothesis({
      id: 'thought_may_need_clarification_before_action',
      type: 'uncertainty_hypothesis',
      statement: 'The Thought may require clarification before becoming an action because the user expresses overload or not knowing where to start.',
      confidence: 0.76,
      factIds,
      status: 'uncertain',
      metadata: {
        domain: intent.domain || 'task',
        cognitive_state: intent.cognitive_state,
        recommended_handling: 'clarify_before_action_creation',
      },
    }));
  }

  if (intent.cognitive_state === 'prevent_forgetting' && intent.primary === 'create_reminder') {
    hypotheses.push(buildHypothesis({
      id: 'thought_may_need_future_prompt_from_forgetting_prevention',
      type: 'reminder_need_hypothesis',
      statement: 'The Thought may need a future prompt because the user is trying to prevent forgetting an action.',
      confidence: intent.cognitive_state_confidence || intent.confidence || 0.82,
      factIds,
      metadata: {
        domain: intent.domain || 'task',
        cognitive_state: intent.cognitive_state,
        temporal_hint_count: temporalHints.length,
      },
    }));
  }

  if (intent.primary === 'create_task') {
    hypotheses.push(buildHypothesis({
      id: 'thought_may_need_action_creation',
      type: 'action_need_hypothesis',
      statement: 'The Thought may need to become an action so the user does not keep it in working memory.',
      confidence: intent.confidence,
      factIds,
      metadata: {
        intent: intent.primary,
      },
    }));
  }

  if (intent.primary === 'create_reminder') {
    hypotheses.push(buildHypothesis({
      id: 'thought_may_need_future_prompt',
      type: 'reminder_need_hypothesis',
      statement: 'The Thought may need a future prompt because it contains reminder language.',
      confidence: temporalHints.length > 0 ? intent.confidence : Math.min(intent.confidence, 0.72),
      factIds,
      metadata: {
        temporal_hint_count: temporalHints.length,
      },
    }));
  }

  if (intent.primary === 'add_to_collection') {
    hypotheses.push(buildHypothesis({
      id: 'thought_may_belong_to_collection',
      type: 'collection_hypothesis',
      statement: 'The Thought may need to be organized into a Collection.',
      confidence: intent.confidence,
      factIds,
      metadata: {
        collection_hint: intent.collection_hint || 'unspecified',
      },
    }));
  }

  if (intent.primary === 'capture_idea' || intent.primary === 'project_thought' || projectHints.length > 0) {
    hypotheses.push(buildHypothesis({
      id: 'thought_may_have_project_or_idea_value',
      type: 'project_or_idea_hypothesis',
      statement: 'The Thought may have future value as an idea, project element, or structured reflection.',
      confidence: Math.max(intent.confidence || 0, projectHints.length > 0 ? 0.72 : 0),
      factIds,
      metadata: {
        project_hint_count: projectHints.length,
      },
    }));
  }

  if (intent.primary === 'reflect_emotion' || emotionalSignals.length > 0) {
    hypotheses.push(buildHypothesis({
      id: 'thought_may_need_regulation_or_reflection',
      type: 'emotional_support_hypothesis',
      statement: 'The Thought may need emotional regulation support or reflective accompaniment before operational action.',
      confidence: Math.max(intent.confidence || 0, emotionalSignals.length > 0 ? 0.76 : 0),
      factIds,
      metadata: {
        emotional_signal_count: emotionalSignals.length,
      },
    }));
  }

  if (intent.primary === 'capture_note' || hypotheses.length === 0) {
    hypotheses.push(buildHypothesis({
      id: 'thought_may_be_contextual_note',
      type: 'context_note_hypothesis',
      statement: 'The Thought may be best preserved as contextual information until more context is available.',
      confidence: intent.confidence || 0.62,
      factIds,
      metadata: {
        intent: intent.primary,
      },
    }));
  }

  if ((intent.confidence || 0) < 0.7) {
    hypotheses.push(buildHypothesis({
      id: 'thought_may_require_later_reinterpretation',
      type: 'uncertainty_hypothesis',
      statement: 'The Thought has limited intent confidence and may need later reinterpretation with more context.',
      confidence: 1 - (intent.confidence || 0.5),
      factIds,
      status: 'uncertain',
      metadata: {
        intent_confidence: intent.confidence,
      },
    }));
  }

  return hypotheses;
}

function extractObservationInputs(thought) {
  const text = thought.content;
  const intent = detectPrimaryIntent(text);
  const temporalHints = detectTemporalHints(text);
  const projectHints = detectProjectHints(text);
  const entities = detectEntityHints(text);
  const emotionalSignals = detectEmotionalSignals(text);
  const understandingType = deriveUnderstandingType(intent, temporalHints, projectHints, emotionalSignals);

  return {
    thought,
    text,
    intent,
    temporalHints,
    projectHints,
    entities,
    emotionalSignals,
    understandingType,
  };
}

function buildCognitiveLayers(observationInputs) {
  const {
    thought,
    intent,
    temporalHints,
    projectHints,
    entities,
    emotionalSignals,
  } = observationInputs;

  const observations = buildObservations({
    thought,
    intent,
    temporalHints,
    projectHints,
    entities,
    emotionalSignals,
  });

  const facts = buildFacts({
    thought,
    intent,
    temporalHints,
    projectHints,
    entities,
    emotionalSignals,
    observations,
  });

  const hypotheses = buildHypotheses({
    intent,
    temporalHints,
    projectHints,
    emotionalSignals,
    facts,
  });

  return {
    observations,
    facts,
    hypotheses,
  };
}

function understandThought(thoughtInput) {
  const thought = normalizeThought(thoughtInput);
  const observationInputs = extractObservationInputs(thought);
  const {
    text,
    intent,
    temporalHints,
    projectHints,
    entities,
    emotionalSignals,
    understandingType,
  } = observationInputs;
  const cognitiveLayers = buildCognitiveLayers(observationInputs);

  const output = {
    thought_id: thought.id || null,
    user_id: thought.user_id,
    source: thought.source,
    type: understandingType,
    intent,
    cognitive_state: {
      domain: intent.domain || null,
      primary: intent.cognitive_state || null,
      confidence: intent.cognitive_state_confidence ?? intent.confidence ?? null,
      recommended_handling: intent.recommended_handling || null,
      original_primary_intent: intent.original_primary_intent || null,
    },
    entities,
    temporal_hints: temporalHints,
    project_hints: projectHints,
    emotional_signals: emotionalSignals,
    observations: cognitiveLayers.observations,
    facts: cognitiveLayers.facts,
    hypotheses: cognitiveLayers.hypotheses,
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
        cognitive_layers: ['observations', 'facts', 'hypotheses'],
        internal_analyzers: ['primary_intent_detector_v2', 'task_cognitive_state_detector_v1'],
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
