const { buildEngineResult } = require('./nyraEngineResultContract');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value, fallback = 0) {
  return Math.min(1, Math.max(0, normalizeNumber(value, fallback)));
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getUnderstandingOutput(context = {}) {
  const safeContext = normalizeObject(context);
  const engineResults = normalizeObject(safeContext.engine_results);
  const understandingResult = normalizeObject(engineResults.understanding || safeContext.understanding);
  const understandingOutput = normalizeObject(understandingResult.output);

  if (Object.keys(understandingOutput).length > 0) {
    return understandingOutput;
  }

  return understandingResult;
}

function getPrimaryIntent(understanding) {
  const intent = normalizeObject(understanding.intent);
  return normalizeText(intent.primary || understanding.primary_intent || 'capture_note') || 'capture_note';
}

function getIntentConfidence(understanding) {
  const intent = normalizeObject(understanding.intent);
  return clamp01(intent.confidence ?? understanding.confidence, 0.5);
}

function getTemporalScope(understanding) {
  const temporalHints = normalizeArray(understanding.temporal_hints);
  const strongestHint = temporalHints[0] || null;

  if (!strongestHint) return 'unspecified';

  if (strongestHint.type === 'relative_duration') return 'relative_duration';
  if (strongestHint.type === 'time_of_day') return 'time_of_day';

  return normalizeText(strongestHint.value || strongestHint.type || 'unspecified') || 'unspecified';
}

function getEmotionalIntensity(understanding) {
  const emotionalSignals = normalizeArray(understanding.emotional_signals);

  if (emotionalSignals.length === 0) return 'none';
  if (emotionalSignals.length >= 2) return 'medium';

  const confidence = clamp01(emotionalSignals[0]?.confidence, 0.5);
  return confidence >= 0.8 ? 'medium' : 'low';
}

function getCognitiveLayers(understanding) {
  return {
    observations: normalizeArray(understanding.observations).map(normalizeObject),
    facts: normalizeArray(understanding.facts).map(normalizeObject),
    hypotheses: normalizeArray(understanding.hypotheses).map(normalizeObject),
  };
}

function getLayerTypes(items = []) {
  return [
    ...new Set(
      normalizeArray(items)
        .map(item => normalizeText(item?.type))
        .filter(Boolean)
    ),
  ];
}

function hasLayerType(items = [], type) {
  const normalizedType = normalizeText(type);
  return normalizeArray(items).some(item => normalizeText(item?.type) === normalizedType);
}

function hasLayerId(items = [], id) {
  const normalizedId = normalizeText(id);
  return normalizeArray(items).some(item => normalizeText(item?.id) === normalizedId);
}

function getBestLayerConfidence(items = [], fallback = 0.5) {
  const confidences = normalizeArray(items)
    .map(item => clamp01(item?.confidence, 0))
    .filter(value => value > 0);

  if (confidences.length === 0) return clamp01(fallback, 0.5);
  return Math.max(...confidences);
}

function getHypothesisByType(hypotheses = [], type) {
  const normalizedType = normalizeText(type);
  return normalizeArray(hypotheses).find(hypothesis => normalizeText(hypothesis?.type) === normalizedType) || null;
}

function getHypothesisById(hypotheses = [], id) {
  const normalizedId = normalizeText(id);
  return normalizeArray(hypotheses).find(hypothesis => normalizeText(hypothesis?.id) === normalizedId) || null;
}

function buildReasoningBasis(understanding) {
  const layers = getCognitiveLayers(understanding);
  const primaryIntent = getPrimaryIntent(understanding);
  const confidence = getIntentConfidence(understanding);
  const temporalScope = getTemporalScope(understanding);
  const emotionalIntensity = getEmotionalIntensity(understanding);

  return {
    primary_intent: primaryIntent,
    confidence,
    temporal_scope: temporalScope,
    emotional_intensity: emotionalIntensity,
    observations: layers.observations,
    facts: layers.facts,
    hypotheses: layers.hypotheses,
    observation_types: getLayerTypes(layers.observations),
    fact_types: getLayerTypes(layers.facts),
    hypothesis_types: getLayerTypes(layers.hypotheses),
    has_cognitive_layers: layers.observations.length > 0 || layers.facts.length > 0 || layers.hypotheses.length > 0,
  };
}

function buildStrategy({
  id,
  label,
  type = 'cognitive_strategy',
  confidence = 0.5,
  cognitiveCost = 0.2,
  expectedBenefit = 0.5,
  riskLevel = 0.1,
  reasons = [],
  constraints = {},
  payload = {},
}) {
  return {
    id: normalizeText(id),
    label: normalizeText(label),
    type: normalizeText(type) || 'cognitive_strategy',
    confidence: clamp01(confidence, 0.5),
    cognitive_cost: clamp01(cognitiveCost, 0.2),
    expected_benefit: clamp01(expectedBenefit, 0.5),
    risk_level: clamp01(riskLevel, 0.1),
    reasons: normalizeArray(reasons).map(reason => normalizeText(reason)).filter(Boolean),
    constraints: normalizeObject(constraints),
    payload: normalizeObject(payload),
  };
}

function buildExternalizeActionStrategy({ basis, hypothesis = null }) {
  const confidence = hypothesis ? clamp01(hypothesis.confidence, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'externalize_action',
    label: 'Externaliser une action à réaliser',
    confidence,
    cognitiveCost: 0.18,
    expectedBenefit: 0.78,
    riskLevel: basis.temporal_scope === 'unspecified' ? 0.22 : 0.12,
    reasons: [
      hypothesis
        ? 'Hypothèse cognitive : la pensée peut nécessiter la création d’une action.'
        : 'Fallback intent : create_task.',
      'La pensée peut être sortie de la mémoire de travail de l’utilisateur.',
    ],
    constraints: {
      temporal_scope: basis.temporal_scope,
      requires_decision: true,
      reasoning_source: hypothesis ? 'hypothesis' : 'intent_fallback',
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildFuturePromptStrategy({ basis, hypothesis = null }) {
  const confidence = hypothesis ? clamp01(hypothesis.confidence, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'schedule_future_prompt',
    label: 'Préparer un rappel futur',
    confidence,
    cognitiveCost: 0.16,
    expectedBenefit: 0.82,
    riskLevel: basis.temporal_scope === 'unspecified' ? 0.35 : 0.12,
    reasons: [
      hypothesis
        ? 'Hypothèse cognitive : la pensée peut nécessiter un rappel futur.'
        : 'Fallback intent : create_reminder.',
      'La pensée contient ou implique un besoin de soutien temporel.',
    ],
    constraints: {
      temporal_scope: basis.temporal_scope,
      requires_decision: true,
      reasoning_source: hypothesis ? 'hypothesis' : 'intent_fallback',
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildCollectionStrategy({ basis, understanding, hypothesis = null }) {
  const intent = normalizeObject(understanding.intent);
  const confidence = hypothesis ? clamp01(hypothesis.confidence, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'organize_into_collection',
    label: 'Classer un élément dans une collection',
    confidence,
    cognitiveCost: 0.12,
    expectedBenefit: 0.72,
    riskLevel: 0.1,
    reasons: [
      hypothesis
        ? 'Hypothèse cognitive : la pensée peut appartenir à une Collection.'
        : 'Fallback intent : add_to_collection.',
      'La pensée semble viser le rangement d’un élément dans un ensemble existant.',
    ],
    constraints: {
      collection_hint: normalizeText(intent.collection_hint || 'unspecified') || 'unspecified',
      requires_decision: true,
      reasoning_source: hypothesis ? 'hypothesis' : 'intent_fallback',
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildRegulationStrategy({ basis, hypothesis = null }) {
  const confidence = Math.max(
    hypothesis ? clamp01(hypothesis.confidence, basis.confidence) : basis.confidence,
    0.68
  );

  return buildStrategy({
    id: 'support_regulation',
    label: 'Soutenir la régulation cognitive et émotionnelle',
    confidence,
    cognitiveCost: basis.emotional_intensity === 'medium' ? 0.18 : 0.24,
    expectedBenefit: basis.emotional_intensity === 'medium' ? 0.82 : 0.68,
    riskLevel: 0.16,
    reasons: [
      hypothesis
        ? 'Hypothèse cognitive : la pensée peut nécessiter régulation ou réflexion.'
        : 'Fallback émotionnel : signal émotionnel détecté.',
      'La priorité potentielle est d’accompagner avant d’organiser.',
    ],
    constraints: {
      emotional_intensity: basis.emotional_intensity,
      requires_decision: true,
      reasoning_source: hypothesis ? 'hypothesis' : 'emotion_fallback',
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildPreserveThoughtStrategy({ basis, hypothesis = null }) {
  const confidence = hypothesis ? clamp01(hypothesis.confidence, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'preserve_and_structure_thought',
    label: 'Préserver et structurer la pensée',
    confidence,
    cognitiveCost: 0.2,
    expectedBenefit: 0.7,
    riskLevel: 0.18,
    reasons: [
      hypothesis
        ? 'Hypothèse cognitive : la pensée peut avoir une valeur future.'
        : `Fallback intent : ${basis.primary_intent}.`,
      'La pensée peut être conservée et reliée correctement si elle apporte de la valeur future.',
    ],
    constraints: {
      requires_decision: true,
      reasoning_source: hypothesis ? 'hypothesis' : 'intent_fallback',
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildContextCaptureStrategy({ basis, hypothesis = null }) {
  const confidence = hypothesis ? clamp01(hypothesis.confidence, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'capture_for_context',
    label: 'Conserver la pensée comme contexte',
    confidence,
    cognitiveCost: 0.1,
    expectedBenefit: 0.45,
    riskLevel: 0.08,
    reasons: [
      hypothesis
        ? 'Hypothèse cognitive : la pensée peut être préservée comme contexte.'
        : 'Aucune stratégie spécialisée évidente n’a été détectée.',
      'La pensée peut enrichir le contexte futur sans action immédiate.',
    ],
    constraints: {
      requires_decision: true,
      reasoning_source: hypothesis ? 'hypothesis' : 'fallback',
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function addStrategyOnce(strategies, strategy) {
  if (!strategy?.id) return;
  const exists = strategies.some(existingStrategy => existingStrategy.id === strategy.id);
  if (!exists) strategies.push(strategy);
}

function buildStrategiesFromCognitiveLayers({ understanding, basis }) {
  const strategies = [];
  const hypotheses = basis.hypotheses;
  const facts = basis.facts;
  const observations = basis.observations;

  const actionHypothesis = getHypothesisByType(hypotheses, 'action_need_hypothesis');
  if (actionHypothesis) {
    addStrategyOnce(strategies, buildExternalizeActionStrategy({ basis, hypothesis: actionHypothesis }));
  }

  const reminderHypothesis = getHypothesisByType(hypotheses, 'reminder_need_hypothesis');
  if (reminderHypothesis) {
    addStrategyOnce(strategies, buildFuturePromptStrategy({ basis, hypothesis: reminderHypothesis }));
  }

  const collectionHypothesis = getHypothesisByType(hypotheses, 'collection_hypothesis');
  if (collectionHypothesis) {
    addStrategyOnce(strategies, buildCollectionStrategy({ basis, understanding, hypothesis: collectionHypothesis }));
  }

  const emotionalHypothesis = getHypothesisByType(hypotheses, 'emotional_support_hypothesis');
  if (emotionalHypothesis) {
    addStrategyOnce(strategies, buildRegulationStrategy({ basis, hypothesis: emotionalHypothesis }));
  }

  const projectOrIdeaHypothesis = getHypothesisByType(hypotheses, 'project_or_idea_hypothesis');
  if (projectOrIdeaHypothesis) {
    addStrategyOnce(strategies, buildPreserveThoughtStrategy({ basis, hypothesis: projectOrIdeaHypothesis }));
  }

  const contextNoteHypothesis = getHypothesisByType(hypotheses, 'context_note_hypothesis');
  if (contextNoteHypothesis) {
    addStrategyOnce(strategies, buildContextCaptureStrategy({ basis, hypothesis: contextNoteHypothesis }));
  }

  if (strategies.length > 0) {
    return strategies;
  }

  if (hasLayerType(facts, 'emotional_fact') || hasLayerType(observations, 'emotional_signal')) {
    addStrategyOnce(strategies, buildRegulationStrategy({ basis }));
  }

  if (hasLayerType(facts, 'temporal_fact') && basis.primary_intent === 'create_reminder') {
    addStrategyOnce(strategies, buildFuturePromptStrategy({ basis }));
  }

  if (hasLayerType(facts, 'project_fact') || hasLayerType(observations, 'project_signal')) {
    addStrategyOnce(strategies, buildPreserveThoughtStrategy({ basis }));
  }

  if (strategies.length > 0) {
    return strategies;
  }

  return [];
}

function buildStrategiesFromFallbackSignals({ understanding, basis }) {
  const strategies = [];

  if (basis.primary_intent === 'create_task') {
    addStrategyOnce(strategies, buildExternalizeActionStrategy({ basis }));
  } else if (basis.primary_intent === 'create_reminder') {
    addStrategyOnce(strategies, buildFuturePromptStrategy({ basis }));
  } else if (basis.primary_intent === 'add_to_collection') {
    addStrategyOnce(strategies, buildCollectionStrategy({ basis, understanding }));
  } else if (basis.primary_intent === 'reflect_emotion' || basis.emotional_intensity !== 'none') {
    addStrategyOnce(strategies, buildRegulationStrategy({ basis }));
  } else if (basis.primary_intent === 'capture_idea' || basis.primary_intent === 'project_thought') {
    addStrategyOnce(strategies, buildPreserveThoughtStrategy({ basis }));
  }

  if (strategies.length === 0) {
    addStrategyOnce(strategies, buildContextCaptureStrategy({ basis }));
  }

  return strategies;
}

function buildStrategiesFromUnderstanding(understanding) {
  const basis = buildReasoningBasis(understanding);
  const layerStrategies = buildStrategiesFromCognitiveLayers({
    understanding,
    basis,
  });

  if (layerStrategies.length > 0) {
    return layerStrategies;
  }

  return buildStrategiesFromFallbackSignals({
    understanding,
    basis,
  });
}

function buildReasoningOutput({ thought, understanding, strategies }) {
  const primaryIntent = getPrimaryIntent(understanding);
  const basis = buildReasoningBasis(understanding);

  return {
    thought_id: thought?.id || understanding.thought_id || null,
    user_id: thought?.user_id || understanding.user_id || 'local-user',
    source: thought?.source || understanding.source || 'chat',
    type: 'reasoning_result',
    reasoning_version: 'reasoning-v1',
    primary_intent: primaryIntent,
    reasoning_basis: {
      primary_source: basis.hypotheses.length > 0
        ? 'hypotheses'
        : basis.facts.length > 0
          ? 'facts'
          : basis.observations.length > 0
            ? 'observations'
            : 'fallback_signals',
      observation_count: basis.observations.length,
      fact_count: basis.facts.length,
      hypothesis_count: basis.hypotheses.length,
      observation_types: basis.observation_types,
      fact_types: basis.fact_types,
      hypothesis_types: basis.hypothesis_types,
    },
    strategy_count: strategies.length,
    strategies,
    assumptions: [],
    conflicts: [],
    uncertainty: {
      level: strategies.some(strategy => strategy.risk_level >= 0.3) ? 'medium' : 'low',
      requires_clarification: false,
    },
    decision_required: true,
    behavior_changed: false,
  };
}

function reasonAboutThought({ thought, context = {} } = {}) {
  const understanding = getUnderstandingOutput(context);
  const strategies = buildStrategiesFromUnderstanding(understanding);
  const output = buildReasoningOutput({
    thought,
    understanding,
    strategies,
  });

  return {
    ...buildEngineResult({
      engine: 'reasoning',
      engineVersion: 'reasoning-v1',
      output,
      nextEngine: null,
      behaviorChanged: false,
      metadata: {
        internal_analyzers: ['cognitive_layer_strategy_generator_v1'],
        foundation_role: 'construct_strategies_without_deciding',
        reasoning_priority: ['hypotheses', 'facts', 'observations', 'fallback_signals'],
      },
    }),
    ...output,
    engine: 'reasoning',
    engine_version: 'reasoning-v1',
    behavior_changed: false,
  };
}

module.exports = {
  reasonAboutThought,
};
