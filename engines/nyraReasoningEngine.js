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

function buildStrategiesFromUnderstanding(understanding) {
  const primaryIntent = getPrimaryIntent(understanding);
  const confidence = getIntentConfidence(understanding);
  const temporalScope = getTemporalScope(understanding);
  const emotionalIntensity = getEmotionalIntensity(understanding);
  const strategies = [];

  if (primaryIntent === 'create_task') {
    strategies.push(buildStrategy({
      id: 'externalize_action',
      label: 'Externaliser une action à réaliser',
      confidence,
      cognitiveCost: 0.18,
      expectedBenefit: 0.78,
      riskLevel: temporalScope === 'unspecified' ? 0.22 : 0.12,
      reasons: [
        'Intent détecté : create_task.',
        'La pensée contient une action à ne pas garder uniquement en mémoire de travail.',
      ],
      constraints: {
        temporal_scope: temporalScope,
        requires_decision: true,
      },
      payload: {
        intent: primaryIntent,
      },
    }));
  } else if (primaryIntent === 'create_reminder') {
    strategies.push(buildStrategy({
      id: 'schedule_future_prompt',
      label: 'Préparer un rappel futur',
      confidence,
      cognitiveCost: 0.16,
      expectedBenefit: 0.82,
      riskLevel: temporalScope === 'unspecified' ? 0.35 : 0.12,
      reasons: [
        'Intent détecté : create_reminder.',
        'La pensée contient une demande de rappel temporel.',
      ],
      constraints: {
        temporal_scope: temporalScope,
        requires_decision: true,
      },
      payload: {
        intent: primaryIntent,
      },
    }));
  } else if (primaryIntent === 'add_to_collection') {
    strategies.push(buildStrategy({
      id: 'organize_into_collection',
      label: 'Classer un élément dans une collection',
      confidence,
      cognitiveCost: 0.12,
      expectedBenefit: 0.72,
      riskLevel: 0.1,
      reasons: [
        'Intent détecté : add_to_collection.',
        'La pensée semble viser le rangement d’un élément dans un ensemble existant.',
      ],
      constraints: {
        collection_hint: normalizeText(understanding.intent?.collection_hint || 'unspecified') || 'unspecified',
        requires_decision: true,
      },
      payload: {
        intent: primaryIntent,
      },
    }));
  } else if (primaryIntent === 'reflect_emotion' || emotionalIntensity !== 'none') {
    strategies.push(buildStrategy({
      id: 'support_regulation',
      label: 'Soutenir la régulation cognitive et émotionnelle',
      confidence: Math.max(confidence, 0.68),
      cognitiveCost: emotionalIntensity === 'medium' ? 0.18 : 0.24,
      expectedBenefit: emotionalIntensity === 'medium' ? 0.82 : 0.68,
      riskLevel: 0.16,
      reasons: [
        'La pensée contient un signal émotionnel.',
        'La priorité potentielle est d’accompagner avant d’organiser.',
      ],
      constraints: {
        emotional_intensity: emotionalIntensity,
        requires_decision: true,
      },
      payload: {
        intent: primaryIntent,
      },
    }));
  } else if (primaryIntent === 'capture_idea' || primaryIntent === 'project_thought') {
    strategies.push(buildStrategy({
      id: 'preserve_and_structure_thought',
      label: 'Préserver et structurer la pensée',
      confidence,
      cognitiveCost: 0.2,
      expectedBenefit: 0.7,
      riskLevel: 0.18,
      reasons: [
        `Intent détecté : ${primaryIntent}.`,
        'La pensée peut avoir une valeur future si elle est conservée et reliée correctement.',
      ],
      constraints: {
        requires_decision: true,
      },
      payload: {
        intent: primaryIntent,
      },
    }));
  }

  if (strategies.length === 0) {
    strategies.push(buildStrategy({
      id: 'capture_for_context',
      label: 'Conserver la pensée comme contexte',
      confidence,
      cognitiveCost: 0.1,
      expectedBenefit: 0.45,
      riskLevel: 0.08,
      reasons: [
        'Aucune stratégie spécialisée évidente n’a été détectée.',
        'La pensée peut néanmoins enrichir le contexte futur.',
      ],
      constraints: {
        requires_decision: true,
      },
      payload: {
        intent: primaryIntent,
      },
    }));
  }

  return strategies;
}

function buildReasoningOutput({ thought, understanding, strategies }) {
  const primaryIntent = getPrimaryIntent(understanding);

  return {
    thought_id: thought?.id || understanding.thought_id || null,
    user_id: thought?.user_id || understanding.user_id || 'local-user',
    source: thought?.source || understanding.source || 'chat',
    type: 'reasoning_result',
    reasoning_version: 'reasoning-v1',
    primary_intent: primaryIntent,
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
        internal_analyzers: ['strategy_generator_v1'],
        foundation_role: 'construct_strategies_without_deciding',
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
