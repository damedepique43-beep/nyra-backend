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

function getHypothesisByType(hypotheses = [], type) {
  const normalizedType = normalizeText(type);
  return normalizeArray(hypotheses).find(hypothesis => normalizeText(hypothesis?.type) === normalizedType) || null;
}

function getFactIds(facts = []) {
  return normalizeArray(facts)
    .map(fact => normalizeText(fact?.id))
    .filter(Boolean);
}

function getObservationIds(observations = []) {
  return normalizeArray(observations)
    .map(observation => normalizeText(observation?.id))
    .filter(Boolean);
}

function countSupportedFacts({ hypothesis, factIds }) {
  const basedOnFacts = normalizeArray(hypothesis?.based_on_facts)
    .map(factId => normalizeText(factId))
    .filter(Boolean);

  if (basedOnFacts.length === 0) return 0;

  const availableFactIds = new Set(getFactIds(factIds));
  return basedOnFacts.filter(factId => availableFactIds.has(factId)).length;
}

function getSupportLevel({ hypothesis, facts }) {
  const basedOnFacts = normalizeArray(hypothesis?.based_on_facts)
    .map(factId => normalizeText(factId))
    .filter(Boolean);

  if (basedOnFacts.length === 0) return 'unknown';

  const availableFactIds = new Set(getFactIds(facts));
  const supportedCount = basedOnFacts.filter(factId => availableFactIds.has(factId)).length;
  const ratio = supportedCount / basedOnFacts.length;

  if (ratio >= 0.75) return 'high';
  if (ratio >= 0.4) return 'medium';
  if (supportedCount > 0) return 'low';
  return 'none';
}

function detectHypothesisContradiction({ hypothesis, facts }) {
  const hypothesisId = normalizeText(hypothesis?.id);
  const hypothesisType = normalizeText(hypothesis?.type);

  return normalizeArray(facts).some(fact => {
    const metadata = normalizeObject(fact?.metadata);
    const contradictedHypotheses = normalizeArray(metadata.contradicted_hypotheses)
      .map(item => normalizeText(item))
      .filter(Boolean);
    const contradictedTypes = normalizeArray(metadata.contradicted_hypothesis_types)
      .map(item => normalizeText(item))
      .filter(Boolean);

    return (
      (hypothesisId && contradictedHypotheses.includes(hypothesisId)) ||
      (hypothesisType && contradictedTypes.includes(hypothesisType))
    );
  });
}

function classifyHypothesis({ hypothesis, facts }) {
  const confidence = clamp01(hypothesis?.confidence, 0.5);
  const supportLevel = getSupportLevel({ hypothesis, facts });
  const contradicted = detectHypothesisContradiction({ hypothesis, facts });
  const status = normalizeText(hypothesis?.status || 'provisional') || 'provisional';

  if (contradicted) return 'contradicted';
  if (status === 'uncertain') return 'needs_verification';
  if (confidence >= 0.8 && (supportLevel === 'high' || supportLevel === 'medium')) return 'strong';
  if (confidence >= 0.6 && supportLevel !== 'none') return 'plausible';
  if (confidence < 0.45 || supportLevel === 'none') return 'weak';
  return 'provisional';
}

function evaluateHypotheses({ hypotheses = [], facts = [] } = {}) {
  return normalizeArray(hypotheses).map(hypothesis => {
    const safeHypothesis = normalizeObject(hypothesis);
    const confidence = clamp01(safeHypothesis.confidence, 0.5);
    const supportLevel = getSupportLevel({ hypothesis: safeHypothesis, facts });
    const contradicted = detectHypothesisContradiction({ hypothesis: safeHypothesis, facts });
    const evaluationStatus = classifyHypothesis({ hypothesis: safeHypothesis, facts });
    const requiresVerification = ['weak', 'provisional', 'needs_verification', 'contradicted'].includes(evaluationStatus);

    return {
      ...safeHypothesis,
      evaluation: {
        status: evaluationStatus,
        confidence,
        support_level: supportLevel,
        contradicted,
        requires_verification: requiresVerification,
        based_on_fact_count: normalizeArray(safeHypothesis.based_on_facts).length,
      },
    };
  });
}

function buildReasoningBasis(understanding) {
  const layers = getCognitiveLayers(understanding);
  const primaryIntent = getPrimaryIntent(understanding);
  const confidence = getIntentConfidence(understanding);
  const temporalScope = getTemporalScope(understanding);
  const emotionalIntensity = getEmotionalIntensity(understanding);
  const evaluatedHypotheses = evaluateHypotheses({
    hypotheses: layers.hypotheses,
    facts: layers.facts,
  });

  return {
    primary_intent: primaryIntent,
    confidence,
    temporal_scope: temporalScope,
    emotional_intensity: emotionalIntensity,
    observations: layers.observations,
    facts: layers.facts,
    hypotheses: evaluatedHypotheses,
    raw_hypotheses: layers.hypotheses,
    observation_types: getLayerTypes(layers.observations),
    fact_types: getLayerTypes(layers.facts),
    hypothesis_types: getLayerTypes(evaluatedHypotheses),
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

function getHypothesisConfidence(hypothesis, fallback) {
  const evaluation = normalizeObject(hypothesis?.evaluation);
  return clamp01(evaluation.confidence ?? hypothesis?.confidence, fallback);
}

function getHypothesisRiskAdjustment(hypothesis) {
  const evaluation = normalizeObject(hypothesis?.evaluation);
  const status = normalizeText(evaluation.status || 'provisional');

  if (status === 'strong') return -0.03;
  if (status === 'plausible') return 0;
  if (status === 'provisional') return 0.06;
  if (status === 'needs_verification') return 0.12;
  if (status === 'weak') return 0.16;
  if (status === 'contradicted') return 0.3;
  return 0.08;
}

function getHypothesisReason(hypothesis, fallbackReason) {
  if (!hypothesis) return fallbackReason;

  const evaluation = normalizeObject(hypothesis.evaluation);
  const status = normalizeText(evaluation.status || 'provisional');
  const supportLevel = normalizeText(evaluation.support_level || 'unknown');

  return `Hypothèse cognitive ${status} avec support ${supportLevel}.`;
}

function buildExternalizeActionStrategy({ basis, hypothesis = null }) {
  const confidence = hypothesis ? getHypothesisConfidence(hypothesis, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'externalize_action',
    label: 'Externaliser une action à réaliser',
    confidence,
    cognitiveCost: 0.18,
    expectedBenefit: 0.78,
    riskLevel: clamp01((basis.temporal_scope === 'unspecified' ? 0.22 : 0.12) + getHypothesisRiskAdjustment(hypothesis), 0.12),
    reasons: [
      getHypothesisReason(hypothesis, 'Fallback intent : create_task.'),
      'La pensée peut être sortie de la mémoire de travail de l’utilisateur.',
    ],
    constraints: {
      temporal_scope: basis.temporal_scope,
      requires_decision: true,
      reasoning_source: hypothesis ? 'evaluated_hypothesis' : 'intent_fallback',
      hypothesis_status: hypothesis?.evaluation?.status || null,
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildFuturePromptStrategy({ basis, hypothesis = null }) {
  const confidence = hypothesis ? getHypothesisConfidence(hypothesis, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'schedule_future_prompt',
    label: 'Préparer un rappel futur',
    confidence,
    cognitiveCost: 0.16,
    expectedBenefit: 0.82,
    riskLevel: clamp01((basis.temporal_scope === 'unspecified' ? 0.35 : 0.12) + getHypothesisRiskAdjustment(hypothesis), 0.12),
    reasons: [
      getHypothesisReason(hypothesis, 'Fallback intent : create_reminder.'),
      'La pensée contient ou implique un besoin de soutien temporel.',
    ],
    constraints: {
      temporal_scope: basis.temporal_scope,
      requires_decision: true,
      reasoning_source: hypothesis ? 'evaluated_hypothesis' : 'intent_fallback',
      hypothesis_status: hypothesis?.evaluation?.status || null,
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildCollectionStrategy({ basis, understanding, hypothesis = null }) {
  const intent = normalizeObject(understanding.intent);
  const confidence = hypothesis ? getHypothesisConfidence(hypothesis, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'organize_into_collection',
    label: 'Classer un élément dans une collection',
    confidence,
    cognitiveCost: 0.12,
    expectedBenefit: 0.72,
    riskLevel: clamp01(0.1 + getHypothesisRiskAdjustment(hypothesis), 0.1),
    reasons: [
      getHypothesisReason(hypothesis, 'Fallback intent : add_to_collection.'),
      'La pensée semble viser le rangement d’un élément dans un ensemble existant.',
    ],
    constraints: {
      collection_hint: normalizeText(intent.collection_hint || 'unspecified') || 'unspecified',
      requires_decision: true,
      reasoning_source: hypothesis ? 'evaluated_hypothesis' : 'intent_fallback',
      hypothesis_status: hypothesis?.evaluation?.status || null,
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildRegulationStrategy({ basis, hypothesis = null }) {
  const confidence = Math.max(
    hypothesis ? getHypothesisConfidence(hypothesis, basis.confidence) : basis.confidence,
    0.68
  );

  return buildStrategy({
    id: 'support_regulation',
    label: 'Soutenir la régulation cognitive et émotionnelle',
    confidence,
    cognitiveCost: basis.emotional_intensity === 'medium' ? 0.18 : 0.24,
    expectedBenefit: basis.emotional_intensity === 'medium' ? 0.82 : 0.68,
    riskLevel: clamp01(0.16 + getHypothesisRiskAdjustment(hypothesis), 0.16),
    reasons: [
      getHypothesisReason(hypothesis, 'Fallback émotionnel : signal émotionnel détecté.'),
      'La priorité potentielle est d’accompagner avant d’organiser.',
    ],
    constraints: {
      emotional_intensity: basis.emotional_intensity,
      requires_decision: true,
      reasoning_source: hypothesis ? 'evaluated_hypothesis' : 'emotion_fallback',
      hypothesis_status: hypothesis?.evaluation?.status || null,
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildPreserveThoughtStrategy({ basis, hypothesis = null }) {
  const confidence = hypothesis ? getHypothesisConfidence(hypothesis, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'preserve_and_structure_thought',
    label: 'Préserver et structurer la pensée',
    confidence,
    cognitiveCost: 0.2,
    expectedBenefit: 0.7,
    riskLevel: clamp01(0.18 + getHypothesisRiskAdjustment(hypothesis), 0.18),
    reasons: [
      getHypothesisReason(hypothesis, `Fallback intent : ${basis.primary_intent}.`),
      'La pensée peut être conservée et reliée correctement si elle apporte de la valeur future.',
    ],
    constraints: {
      requires_decision: true,
      reasoning_source: hypothesis ? 'evaluated_hypothesis' : 'intent_fallback',
      hypothesis_status: hypothesis?.evaluation?.status || null,
    },
    payload: {
      intent: basis.primary_intent,
      hypothesis_id: hypothesis?.id || null,
    },
  });
}

function buildContextCaptureStrategy({ basis, hypothesis = null }) {
  const confidence = hypothesis ? getHypothesisConfidence(hypothesis, basis.confidence) : basis.confidence;

  return buildStrategy({
    id: 'capture_for_context',
    label: 'Conserver la pensée comme contexte',
    confidence,
    cognitiveCost: 0.1,
    expectedBenefit: 0.45,
    riskLevel: clamp01(0.08 + getHypothesisRiskAdjustment(hypothesis), 0.08),
    reasons: [
      getHypothesisReason(hypothesis, 'Aucune stratégie spécialisée évidente n’a été détectée.'),
      'La pensée peut enrichir le contexte futur sans action immédiate.',
    ],
    constraints: {
      requires_decision: true,
      reasoning_source: hypothesis ? 'evaluated_hypothesis' : 'fallback',
      hypothesis_status: hypothesis?.evaluation?.status || null,
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

function isUsableHypothesis(hypothesis) {
  const status = normalizeText(hypothesis?.evaluation?.status || 'provisional');
  return !['contradicted', 'weak'].includes(status);
}

function buildStrategiesFromCognitiveLayers({ understanding, basis }) {
  const strategies = [];
  const hypotheses = basis.hypotheses.filter(isUsableHypothesis);
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

  return strategies;
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
    return {
      basis,
      strategies: layerStrategies,
    };
  }

  return {
    basis,
    strategies: buildStrategiesFromFallbackSignals({
      understanding,
      basis,
    }),
  };
}

function computeStrategyScore(strategy) {
  const confidence = clamp01(strategy?.confidence, 0.5);
  const expectedBenefit = clamp01(strategy?.expected_benefit, 0.5);
  const cognitiveCost = clamp01(strategy?.cognitive_cost, 0.2);
  const riskLevel = clamp01(strategy?.risk_level, 0.1);

  const rawScore = (
    (expectedBenefit * 0.42) +
    (confidence * 0.32) +
    ((1 - cognitiveCost) * 0.16) +
    ((1 - riskLevel) * 0.10)
  );

  return Math.round(clamp01(rawScore, 0.5) * 1000) / 1000;
}

function classifyStrategyReadiness(strategy) {
  const score = computeStrategyScore(strategy);
  const riskLevel = clamp01(strategy?.risk_level, 0.1);
  const confidence = clamp01(strategy?.confidence, 0.5);
  const source = normalizeText(strategy?.constraints?.reasoning_source || 'unknown');
  const hypothesisStatus = normalizeText(strategy?.constraints?.hypothesis_status || '');

  if (riskLevel >= 0.35 || confidence < 0.45 || hypothesisStatus === 'needs_verification') {
    return 'clarify_before_decision';
  }

  if (source === 'evaluated_hypothesis' && score >= 0.72) {
    return 'ready_for_decision';
  }

  if (score >= 0.62) {
    return 'decision_candidate';
  }

  return 'low_priority_candidate';
}

function enrichStrategyForDecisionPreparation(strategy, index) {
  const score = computeStrategyScore(strategy);
  const readiness = classifyStrategyReadiness(strategy);

  return {
    ...strategy,
    evaluation: {
      rank_hint: index + 1,
      score,
      readiness,
      confidence: clamp01(strategy?.confidence, 0.5),
      expected_benefit: clamp01(strategy?.expected_benefit, 0.5),
      cognitive_cost: clamp01(strategy?.cognitive_cost, 0.2),
      risk_level: clamp01(strategy?.risk_level, 0.1),
      decision_boundary: 'not_decided_by_reasoning_engine',
    },
  };
}

function buildRankedStrategyReferences(strategies = []) {
  return normalizeArray(strategies)
    .map(strategy => ({
      id: strategy.id,
      label: strategy.label,
      score: computeStrategyScore(strategy),
      readiness: classifyStrategyReadiness(strategy),
      risk_level: clamp01(strategy?.risk_level, 0.1),
      cognitive_cost: clamp01(strategy?.cognitive_cost, 0.2),
      expected_benefit: clamp01(strategy?.expected_benefit, 0.5),
      confidence: clamp01(strategy?.confidence, 0.5),
    }))
    .sort((a, b) => b.score - a.score);
}

function buildDecisionPreparation({ strategies = [], basis }) {
  const rankedStrategies = buildRankedStrategyReferences(strategies);
  const strongestCandidate = rankedStrategies[0] || null;
  const clarificationCandidates = rankedStrategies.filter(strategy => strategy.readiness === 'clarify_before_decision');
  const hasHighUncertainty = basis.hypotheses.some(hypothesis => {
    return ['weak', 'contradicted', 'needs_verification'].includes(normalizeText(hypothesis?.evaluation?.status));
  });

  return {
    status: strongestCandidate ? 'prepared_for_future_decision_engine' : 'no_strategy_available',
    decision_taken: false,
    strongest_candidate_id: strongestCandidate?.id || null,
    strongest_candidate_score: strongestCandidate?.score ?? null,
    ranked_strategy_ids: rankedStrategies.map(strategy => strategy.id),
    clarification_candidate_ids: clarificationCandidates.map(strategy => strategy.id),
    uncertainty_level: hasHighUncertainty || clarificationCandidates.length > 0 ? 'medium' : 'low',
    principle: 'Reasoning Engine prépare les stratégies, mais ne choisit pas et n’exécute pas.',
  };
}

function summarizeHypothesisEvaluations(hypotheses = []) {
  const summary = {
    strong: 0,
    plausible: 0,
    provisional: 0,
    needs_verification: 0,
    weak: 0,
    contradicted: 0,
  };

  normalizeArray(hypotheses).forEach(hypothesis => {
    const status = normalizeText(hypothesis?.evaluation?.status || 'provisional') || 'provisional';
    if (summary[status] === undefined) summary[status] = 0;
    summary[status] += 1;
  });

  return summary;
}

function buildReasoningOutput({ thought, understanding, basis, strategies }) {
  const primaryIntent = getPrimaryIntent(understanding);
  const enrichedStrategies = normalizeArray(strategies).map(enrichStrategyForDecisionPreparation);
  const rankedStrategies = buildRankedStrategyReferences(enrichedStrategies);
  const decisionPreparation = buildDecisionPreparation({
    strategies: enrichedStrategies,
    basis,
  });
  const hypothesisEvaluationSummary = summarizeHypothesisEvaluations(basis.hypotheses);
  const hasUnstableHypotheses = basis.hypotheses.some(hypothesis => {
    return ['weak', 'contradicted', 'needs_verification'].includes(normalizeText(hypothesis?.evaluation?.status));
  });

  return {
    thought_id: thought?.id || understanding.thought_id || null,
    user_id: thought?.user_id || understanding.user_id || 'local-user',
    source: thought?.source || understanding.source || 'chat',
    type: 'reasoning_result',
    reasoning_version: 'reasoning-v1',
    primary_intent: primaryIntent,
    reasoning_basis: {
      primary_source: basis.hypotheses.length > 0
        ? 'evaluated_hypotheses'
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
      hypothesis_evaluation_summary: hypothesisEvaluationSummary,
    },
    evaluated_hypotheses: basis.hypotheses.map(hypothesis => ({
      id: hypothesis.id || null,
      type: hypothesis.type || null,
      confidence: hypothesis.evaluation?.confidence ?? hypothesis.confidence ?? null,
      status: hypothesis.evaluation?.status || null,
      support_level: hypothesis.evaluation?.support_level || null,
      contradicted: Boolean(hypothesis.evaluation?.contradicted),
      requires_verification: Boolean(hypothesis.evaluation?.requires_verification),
    })),
    strategy_count: enrichedStrategies.length,
    strategies: enrichedStrategies,
    ranked_strategies: rankedStrategies,
    decision_preparation: decisionPreparation,
    assumptions: [],
    conflicts: basis.hypotheses
      .filter(hypothesis => hypothesis.evaluation?.contradicted)
      .map(hypothesis => ({
        type: 'contradicted_hypothesis',
        hypothesis_id: hypothesis.id || null,
        hypothesis_type: hypothesis.type || null,
      })),
    uncertainty: {
      level: hasUnstableHypotheses || strategies.some(strategy => strategy.risk_level >= 0.3) ? 'medium' : 'low',
      requires_clarification: decisionPreparation.clarification_candidate_ids.length > 0,
    },
    decision_required: true,
    behavior_changed: false,
  };
}

function reasonAboutThought({ thought, context = {} } = {}) {
  const understanding = getUnderstandingOutput(context);
  const reasoning = buildStrategiesFromUnderstanding(understanding);
  const output = buildReasoningOutput({
    thought,
    understanding,
    basis: reasoning.basis,
    strategies: reasoning.strategies,
  });

  return {
    ...buildEngineResult({
      engine: 'reasoning',
      engineVersion: 'reasoning-v1',
      output,
      nextEngine: null,
      behaviorChanged: false,
      metadata: {
        internal_analyzers: ['hypothesis_evaluator_v1', 'cognitive_layer_strategy_generator_v1', 'strategy_evaluator_v1'],
        foundation_role: 'construct_strategies_without_deciding',
        reasoning_priority: ['evaluated_hypotheses', 'facts', 'observations', 'fallback_signals'],
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
