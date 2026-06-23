const { buildEngineResult } = require('./nyraEngineResultContract');
const { detectDirectiveFromUnderstanding, getDirectiveDominantNeed } = require('./reasoning/nyraDirectiveDetector');
const {
  buildExternalizeActionStrategy,
  buildFuturePromptStrategy,
  buildCollectionStrategy,
  buildRegulationStrategy,
  buildPreserveThoughtStrategy,
  buildContextCaptureStrategy,
  buildClarifyUnderstandingStrategy,
  buildBrainDumpStrategy,
} = require('./reasoning/nyraStrategyBuilder');

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

function uniqueArray(value) {
  return [...new Set(normalizeArray(value))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function includesAny(value, patterns = []) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (!normalizedValue) return false;

  return normalizeArray(patterns).some(pattern => {
    return normalizedValue.includes(normalizeText(pattern).toLowerCase());
  });
}

function normalizeCognitiveNeed(value, fallback = 'preserve_context') {
  const normalized = normalizeText(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const allowedNeeds = [
    'reduce_cognitive_load',
    'prevent_forgetting',
    'clarify_uncertainty',
    'support_regulation',
    'preserve_context',
    'structure_idea',
    'organize_information',
    'prepare_action',
    'capture_without_action',
  ];

  if (allowedNeeds.includes(normalized)) return normalized;

  return fallback;
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
  const hypotheses = basis.active_hypotheses.length > 0
    ? basis.active_hypotheses
    : basis.hypotheses.filter(isUsableHypothesis);
  const facts = basis.facts;
  const observations = basis.observations;
  const profile = normalizeObject(basis.situation_profile);
  const intervention = normalizeObject(basis.cognitive_intervention);

  const actionHypothesis = getHypothesisByType(hypotheses, 'action_need_hypothesis');
  const reminderHypothesis = getHypothesisByType(hypotheses, 'reminder_need_hypothesis');
  const collectionHypothesis = getHypothesisByType(hypotheses, 'collection_hypothesis');
  const emotionalHypothesis = getHypothesisByType(hypotheses, 'emotional_support_hypothesis');
  const projectOrIdeaHypothesis = getHypothesisByType(hypotheses, 'project_or_idea_hypothesis');
  const contextNoteHypothesis = getHypothesisByType(hypotheses, 'context_note_hypothesis');

  // Situation Profile V1
  // Responsabilité : décider quels builders de stratégies sont pertinents
  // à partir de l'état cognitif détecté, sans décider ni exécuter.
  // Les builders existants restent la source unique des Strategy.
  if (intervention.id === 'brain_dump') {
    addStrategyOnce(strategies, buildBrainDumpStrategy({ basis }));
  }

  if (profile.should_clarify_first) {
    addStrategyOnce(strategies, buildClarifyUnderstandingStrategy({ basis }));
  }

  if (profile.should_regulate) {
    addStrategyOnce(strategies, buildRegulationStrategy({
      basis,
      hypothesis: emotionalHypothesis,
    }));
  }

  if (profile.should_prepare_reminder) {
    addStrategyOnce(strategies, buildFuturePromptStrategy({
      basis,
      hypothesis: reminderHypothesis,
    }));
  }

  if (profile.should_organize_information && collectionHypothesis) {
    addStrategyOnce(strategies, buildCollectionStrategy({
      basis,
      understanding,
      hypothesis: collectionHypothesis,
    }));
  }

  if (profile.should_preserve_context) {
    addStrategyOnce(strategies, projectOrIdeaHypothesis
      ? buildPreserveThoughtStrategy({ basis, hypothesis: projectOrIdeaHypothesis })
      : buildContextCaptureStrategy({ basis, hypothesis: contextNoteHypothesis })
    );
  }

  if (profile.should_externalize && actionHypothesis) {
    addStrategyOnce(strategies, buildExternalizeActionStrategy({
      basis,
      hypothesis: actionHypothesis,
    }));
  }

  if (strategies.length > 0) {
    return strategies;
  }

  if (actionHypothesis) {
    addStrategyOnce(strategies, buildExternalizeActionStrategy({ basis, hypothesis: actionHypothesis }));
  }

  if (reminderHypothesis) {
    addStrategyOnce(strategies, buildFuturePromptStrategy({ basis, hypothesis: reminderHypothesis }));
  }

  if (collectionHypothesis) {
    addStrategyOnce(strategies, buildCollectionStrategy({ basis, understanding, hypothesis: collectionHypothesis }));
  }

  if (emotionalHypothesis) {
    addStrategyOnce(strategies, buildRegulationStrategy({ basis, hypothesis: emotionalHypothesis }));
  }

  if (projectOrIdeaHypothesis) {
    addStrategyOnce(strategies, buildPreserveThoughtStrategy({ basis, hypothesis: projectOrIdeaHypothesis }));
  }

  if (contextNoteHypothesis) {
    addStrategyOnce(strategies, buildContextCaptureStrategy({ basis, hypothesis: contextNoteHypothesis }));
  }

  if (strategies.length > 0) {
    if (basis.has_competing_hypotheses) {
      addStrategyOnce(strategies, buildClarifyUnderstandingStrategy({ basis }));
    }
    return strategies;
  }

  if (basis.hypotheses.length > 0 && (!basis.has_active_hypotheses || basis.has_competing_hypotheses)) {
    addStrategyOnce(strategies, buildClarifyUnderstandingStrategy({ basis }));
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
  const profile = normalizeObject(basis.situation_profile);
  const intervention = normalizeObject(basis.cognitive_intervention);

  if (intervention.id === 'brain_dump') {
    addStrategyOnce(strategies, buildBrainDumpStrategy({ basis }));
  }

  if (profile.should_clarify_first) {
    addStrategyOnce(strategies, buildClarifyUnderstandingStrategy({ basis }));
  }

  if (profile.should_regulate) {
    addStrategyOnce(strategies, buildRegulationStrategy({ basis }));
  }

  if (profile.should_prepare_reminder) {
    addStrategyOnce(strategies, buildFuturePromptStrategy({ basis }));
  }

  if (profile.should_organize_information) {
    addStrategyOnce(strategies, buildCollectionStrategy({ basis, understanding }));
  }

  if (profile.should_preserve_context) {
    addStrategyOnce(strategies, buildContextCaptureStrategy({ basis }));
  }

  if (profile.should_externalize) {
    addStrategyOnce(strategies, buildExternalizeActionStrategy({ basis }));
  }

  if (strategies.length > 0) {
    return strategies;
  }

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

function hasStrategyId(strategies = [], strategyId) {
  const normalizedStrategyId = normalizeText(strategyId);
  if (!normalizedStrategyId) return false;

  return normalizeArray(strategies).some(strategy => normalizeText(strategy?.id) === normalizedStrategyId);
}

function addAlternativeStrategy({ strategies, strategy, reason, addedAlternatives }) {
  if (!strategy?.id || hasStrategyId(strategies, strategy.id)) return;

  strategies.push({
    ...strategy,
    alternative_strategy: true,
    alternative_reason: normalizeText(reason),
  });

  addedAlternatives.push({
    strategy_id: strategy.id,
    reason: normalizeText(reason),
  });
}

function shouldAddClarificationAlternative({ basis, strategies }) {
  if (hasStrategyId(strategies, 'clarify_understanding')) return false;
  if (basis.has_competing_hypotheses) return true;
  if (basis.rejected_hypotheses.length >= 1 && basis.active_hypotheses.length === 0) return true;

  return basis.hypotheses.some(hypothesis => {
    const status = normalizeText(hypothesis?.evaluation?.status || '');
    return ['needs_verification', 'contradicted', 'weak'].includes(status);
  });
}

function enrichWithAlternativeStrategies({ understanding, basis, strategies = [] }) {
  // Alternative Strategy Analyzer V1
  // Responsabilité : élargir les approches candidates sans décider ni exécuter.
  // Ce composant interne ne remplace aucune stratégie existante et ajoute seulement
  // des alternatives quand une situation cognitive peut raisonnablement être aidée
  // par plusieurs angles d'accompagnement.
  const enrichedStrategies = [...normalizeArray(strategies)];
  const addedAlternatives = [];
  const primaryIntent = normalizeText(basis.primary_intent || 'capture_note');
  const profile = normalizeObject(basis.situation_profile);
  const hasEmotion = basis.emotional_intensity !== 'none';
  const hasTemporalNeed = basis.temporal_scope !== 'unspecified';
  const hasProjectOrIdeaSignal = (
    primaryIntent === 'capture_idea' ||
    primaryIntent === 'project_thought' ||
    hasLayerType(basis.facts, 'project_fact') ||
    hasLayerType(basis.observations, 'project_signal')
  );

  if (hasEmotion && !hasStrategyId(enrichedStrategies, 'support_regulation')) {
    addAlternativeStrategy({
      strategies: enrichedStrategies,
      strategy: buildRegulationStrategy({ basis }),
      reason: 'Signal émotionnel détecté : proposer aussi une approche de régulation.',
      addedAlternatives,
    });
  }

  if (profile.should_clarify_first && !hasStrategyId(enrichedStrategies, 'clarify_understanding')) {
    addAlternativeStrategy({
      strategies: enrichedStrategies,
      strategy: buildClarifyUnderstandingStrategy({ basis }),
      reason: 'Profil de situation : clarifier avant toute action automatique.',
      addedAlternatives,
    });
  }

  if (shouldAddClarificationAlternative({ basis, strategies: enrichedStrategies })) {
    addAlternativeStrategy({
      strategies: enrichedStrategies,
      strategy: buildClarifyUnderstandingStrategy({ basis }),
      reason: 'Hypothèses incertaines ou concurrentes : proposer aussi une clarification.',
      addedAlternatives,
    });
  }

  if (primaryIntent === 'create_task' && !profile.should_defer_action_creation && !hasStrategyId(enrichedStrategies, 'externalize_action')) {
    addAlternativeStrategy({
      strategies: enrichedStrategies,
      strategy: buildExternalizeActionStrategy({ basis }),
      reason: 'Intention opérationnelle détectée : proposer aussi une externalisation.',
      addedAlternatives,
    });
  }

  if (primaryIntent === 'create_reminder' && hasTemporalNeed && !hasStrategyId(enrichedStrategies, 'schedule_future_prompt')) {
    addAlternativeStrategy({
      strategies: enrichedStrategies,
      strategy: buildFuturePromptStrategy({ basis }),
      reason: 'Signal temporel détecté : proposer aussi un soutien futur.',
      addedAlternatives,
    });
  }

  if (hasProjectOrIdeaSignal && !hasStrategyId(enrichedStrategies, 'preserve_and_structure_thought')) {
    addAlternativeStrategy({
      strategies: enrichedStrategies,
      strategy: buildPreserveThoughtStrategy({ basis }),
      reason: 'Signal projet ou idée détecté : proposer aussi une préservation structurée.',
      addedAlternatives,
    });
  }

  return {
    strategies: enrichedStrategies,
    analysis: {
      version: 'alternative-strategy-analyzer-v1',
      behavior_changed: false,
      initial_strategy_count: normalizeArray(strategies).length,
      final_strategy_count: enrichedStrategies.length,
      added_strategy_count: addedAlternatives.length,
      added_alternatives: addedAlternatives,
      principle: 'Le Reasoning Engine enrichit les approches possibles sans choisir à la place du Decision Engine.',
    },
  };
}

function buildStrategiesFromUnderstanding(understanding) {
  const basis = buildReasoningBasis(understanding);
  const layerStrategies = buildStrategiesFromCognitiveLayers({
    understanding,
    basis,
  });
  const initialStrategies = layerStrategies.length > 0
    ? layerStrategies
    : buildStrategiesFromFallbackSignals({
        understanding,
        basis,
      });
  const alternativeAnalysis = enrichWithAlternativeStrategies({
    understanding,
    basis,
    strategies: initialStrategies,
  });

  return {
    basis,
    strategies: alternativeAnalysis.strategies,
    alternative_strategy_analysis: alternativeAnalysis.analysis,
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

  if (riskLevel >= 0.35 || confidence < 0.45 || hypothesisStatus === 'needs_verification' || source === 'hypothesis_uncertainty') {
    return 'clarify_before_decision';
  }

  if (source === 'cognitive_intervention' && score >= 0.68) {
    return 'ready_for_decision';
  }

  if (source === 'evaluated_hypothesis' && score >= 0.72) {
    return 'ready_for_decision';
  }

  if (score >= 0.62) {
    return 'decision_candidate';
  }

  return 'low_priority_candidate';
}

function enrichStrategyForDecisionPreparation(strategy, index, { basis, cognitiveContext } = {}) {
  const score = computeStrategyScore(strategy);
  const readiness = classifyStrategyReadiness(strategy);
  const cognitiveQuestionReview = buildCognitiveQuestionReview({
    strategy,
    basis: basis || {
      primary_intent: 'capture_note',
      has_competing_hypotheses: false,
    },
    cognitiveContext,
  });

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
      cognitive_questions: cognitiveQuestionReview,
      decision_boundary: 'not_decided_by_reasoning_engine',
    },
  };
}

function buildRankedStrategyReferences(strategies = []) {
  return normalizeArray(strategies)
    .map(strategy => ({
      id: strategy.id,
      label: strategy.label,
      primary_cognitive_need: strategy.primary_cognitive_need || strategy.cognitive_need?.primary || null,
      cognitive_need: strategy.cognitive_need || null,
      score: computeStrategyScore(strategy),
      readiness: classifyStrategyReadiness(strategy),
      risk_level: clamp01(strategy?.risk_level, 0.1),
      cognitive_cost: clamp01(strategy?.cognitive_cost, 0.2),
      expected_benefit: clamp01(strategy?.expected_benefit, 0.5),
      confidence: clamp01(strategy?.confidence, 0.5),
    }))
    .sort((a, b) => b.score - a.score);
}

function summarizeCognitiveNeeds(strategies = []) {
  const needs = normalizeArray(strategies).reduce((acc, strategy) => {
    const need = normalizeText(strategy?.primary_cognitive_need || strategy?.cognitive_need?.primary || 'preserve_context');
    if (!acc[need]) {
      acc[need] = {
        need,
        label: strategy?.cognitive_need?.label || need,
        strategy_ids: [],
        highest_score: null,
      };
    }

    const score = computeStrategyScore(strategy);
    acc[need].strategy_ids.push(strategy.id || null);
    acc[need].highest_score = acc[need].highest_score === null
      ? score
      : Math.max(acc[need].highest_score, score);

    return acc;
  }, {});

  return Object.values(needs).sort((a, b) => Number(b.highest_score || 0) - Number(a.highest_score || 0));
}

function buildDecisionPreparation({ strategies = [], basis }) {
  const rankedStrategies = buildRankedStrategyReferences(strategies);
  const strongestCandidate = rankedStrategies[0] || null;
  const clarificationCandidates = rankedStrategies.filter(strategy => strategy.readiness === 'clarify_before_decision');
  const hasHighUncertainty = basis.hypotheses.some(hypothesis => {
    return ['weak', 'contradicted', 'needs_verification'].includes(normalizeText(hypothesis?.evaluation?.status));
  }) || basis.has_competing_hypotheses;

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


function getCognitiveContext(context = {}) {
  const safeContext = normalizeObject(context);
  const directContext = normalizeObject(safeContext.cognitive_context);

  if (Object.keys(directContext).length > 0) return directContext;

  const sharedContext = normalizeObject(safeContext.shared_context);
  const sharedCognitiveContext = normalizeObject(sharedContext.cognitive_context);

  if (Object.keys(sharedCognitiveContext).length > 0) return sharedCognitiveContext;

  return {};
}

function getCognitiveContextSummary(cognitiveContext = {}) {
  const safeContext = normalizeObject(cognitiveContext);
  const summary = normalizeObject(safeContext.summary);
  const regulationMode = normalizeObject(safeContext.regulation_mode);
  const executionGuidance = normalizeObject(safeContext.execution_guidance);

  return {
    cognitive_load: normalizeText(summary.cognitive_load || safeContext.latest_user_state?.cognitive_load || 'unknown') || 'unknown',
    emotional_state: normalizeText(summary.emotional_state || safeContext.latest_user_state?.emotional_state || 'unknown') || 'unknown',
    energy_level: normalizeText(summary.energy_level || safeContext.latest_user_state?.energy_level || 'unknown') || 'unknown',
    focus_state: normalizeText(summary.focus_state || safeContext.latest_user_state?.focus_state || 'unknown') || 'unknown',
    overwhelm_score: normalizeNumber(summary.overwhelm_score ?? safeContext.latest_user_state?.overwhelm_score, null),
    regulation_mode: normalizeText(summary.regulation_mode || regulationMode.mode || 'unknown') || 'unknown',
    regulation_label: normalizeText(summary.regulation_label || regulationMode.label || ''),
    execution_mode: normalizeText(summary.execution_mode || executionGuidance.execution_mode || 'unknown') || 'unknown',
    recommended_focus_minutes: normalizeNumber(summary.recommended_focus_minutes ?? executionGuidance.recommended_focus_minutes, null),
    max_visible_actions: normalizeNumber(executionGuidance.max_visible_actions, null),
  };
}

function isHighLoadState(stateSummary) {
  return (
    stateSummary.regulation_mode === 'regulation_first' ||
    stateSummary.cognitive_load === 'very_high' ||
    stateSummary.cognitive_load === 'high' ||
    normalizeNumber(stateSummary.overwhelm_score, 0) >= 70
  );
}

function isRecoveryState(stateSummary) {
  return (
    stateSummary.regulation_mode === 'recovery_support' ||
    stateSummary.execution_mode === 'gentle_restart' ||
    stateSummary.energy_level === 'low'
  );
}

function estimateFeasibilityNow({ strategy, stateSummary }) {
  const cognitiveCost = clamp01(strategy?.cognitive_cost, 0.2);
  const riskLevel = clamp01(strategy?.risk_level, 0.1);
  const confidence = clamp01(strategy?.confidence, 0.5);
  let feasibility = 0.72;

  feasibility += (confidence - 0.5) * 0.22;
  feasibility -= cognitiveCost * 0.28;
  feasibility -= riskLevel * 0.18;

  if (isHighLoadState(stateSummary)) feasibility -= cognitiveCost >= 0.2 ? 0.16 : 0.06;
  if (isRecoveryState(stateSummary)) feasibility -= cognitiveCost >= 0.22 ? 0.12 : 0.02;
  if (stateSummary.regulation_mode === 'execution_support') feasibility += 0.08;
  if (stateSummary.execution_mode === 'micro_action_only' && cognitiveCost <= 0.18) feasibility += 0.07;

  return Math.round(clamp01(feasibility, 0.5) * 1000) / 1000;
}

function estimateLoadReduction({ strategy, stateSummary }) {
  const strategyId = normalizeText(strategy?.id);
  const expectedBenefit = clamp01(strategy?.expected_benefit, 0.5);
  const cognitiveCost = clamp01(strategy?.cognitive_cost, 0.2);
  let score = expectedBenefit - (cognitiveCost * 0.35);

  if (strategyId === 'guided_brain_dump') score += 0.24;
  if (strategyId === 'support_regulation') score += 0.18;
  if (strategyId === 'clarify_understanding') score += stateSummary.regulation_mode === 'clarification_support' ? 0.18 : 0.08;
  if (strategyId === 'externalize_action' || strategyId === 'schedule_future_prompt') score += 0.08;
  if (isHighLoadState(stateSummary) && cognitiveCost > 0.22) score -= 0.12;

  return Math.round(clamp01(score, 0.5) * 1000) / 1000;
}

function estimateMomentum({ strategy, stateSummary }) {
  const strategyId = normalizeText(strategy?.id);
  const expectedBenefit = clamp01(strategy?.expected_benefit, 0.5);
  const cognitiveCost = clamp01(strategy?.cognitive_cost, 0.2);
  let score = expectedBenefit - (cognitiveCost * 0.25);

  if (['externalize_action', 'schedule_future_prompt', 'organize_into_collection'].includes(strategyId)) {
    score += 0.08;
  }

  if (strategyId === 'guided_brain_dump') {
    score += 0.06;
  }

  if (strategyId === 'support_regulation' && isRecoveryState(stateSummary)) score += 0.1;
  if (stateSummary.regulation_mode === 'execution_support') score += 0.08;
  if (stateSummary.execution_mode === 'micro_action_only' && cognitiveCost <= 0.18) score += 0.1;

  return Math.round(clamp01(score, 0.5) * 1000) / 1000;
}

function detectCognitiveConflict({ strategy, basis, stateSummary }) {
  const cognitiveCost = clamp01(strategy?.cognitive_cost, 0.2);
  const strategyId = normalizeText(strategy?.id);

  if (isHighLoadState(stateSummary) && cognitiveCost >= 0.22) {
    return {
      has_conflict: true,
      type: 'high_load_vs_strategy_cost',
      label: 'La stratégie reste possible mais peut être trop coûteuse si la charge est élevée.',
    };
  }

  if (isRecoveryState(stateSummary) && strategyId !== 'support_regulation' && cognitiveCost >= 0.2) {
    return {
      has_conflict: true,
      type: 'recovery_need_vs_execution_push',
      label: 'L’état suggère une reprise douce plutôt qu’une poussée d’exécution.',
    };
  }

  if (basis.has_competing_hypotheses) {
    return {
      has_conflict: true,
      type: 'competing_hypotheses',
      label: 'Plusieurs hypothèses restent proches : clarifier peut être préférable à supposer.',
    };
  }

  return {
    has_conflict: false,
    type: null,
    label: 'Aucun conflit cognitif fort détecté pour cette stratégie.',
  };
}

function buildCognitiveQuestionAnswer({ id, question, answer, signal = 'neutral', score = null }) {
  return {
    id,
    question,
    answer: normalizeText(answer),
    signal,
    score,
  };
}

function buildCognitiveQuestionReview({ strategy, basis, cognitiveContext }) {
  const stateSummary = getCognitiveContextSummary(cognitiveContext);
  const certaintyScore = clamp01(strategy?.confidence, 0.5);
  const feasibilityScore = estimateFeasibilityNow({ strategy, stateSummary });
  const loadReductionScore = estimateLoadReduction({ strategy, stateSummary });
  const momentumScore = estimateMomentum({ strategy, stateSummary });
  const conflict = detectCognitiveConflict({ strategy, basis, stateSummary });
  const readiness = classifyStrategyReadiness(strategy);
  const primaryIntent = normalizeText(basis.primary_intent || 'capture_note');
  const strategyId = normalizeText(strategy?.id || 'unknown_strategy');

  return {
    version: 'cognitive-questions-v1',
    behavior_changed: false,
    state_summary: stateSummary,
    answers: [
      buildCognitiveQuestionAnswer({
        id: 'true_deposit',
        question: 'Qu’est-ce que l’utilisateur essaie vraiment de déposer ?',
        answer: `Intention principale détectée : ${primaryIntent}. Stratégie candidate : ${strategyId}. Besoin visé : ${strategy?.cognitive_need?.label || strategy?.primary_cognitive_need || 'non précisé'}.`,
        signal: primaryIntent === 'reflect_emotion' ? 'reflection_first' : 'capture_or_action',
      }),
      buildCognitiveQuestionAnswer({
        id: 'action_or_understanding',
        question: 'Est-ce une demande d’action ou un besoin de compréhension ?',
        answer: ['support_regulation', 'guided_brain_dump', 'clarify_understanding'].includes(strategyId) || primaryIntent === 'reflect_emotion'
          ? 'Le besoin semble d’abord être un soutien, un vidage de charge ou une compréhension, pas une action brute.'
          : 'La stratégie reste compatible avec une préparation d’action ou de rangement.',
        signal: ['support_regulation', 'guided_brain_dump', 'clarify_understanding'].includes(strategyId) ? 'understanding_first' : 'action_possible',
      }),
      buildCognitiveQuestionAnswer({
        id: 'certainty_level',
        question: 'Quel est le niveau de certitude réel ?',
        answer: certaintyScore >= 0.72
          ? 'La certitude est suffisante pour préparer une décision sans conclure à la place du futur Decision Engine.'
          : 'La certitude reste modérée : éviter une décision trop automatique.',
        signal: certaintyScore >= 0.72 ? 'sufficient' : 'caution',
        score: certaintyScore,
      }),
      buildCognitiveQuestionAnswer({
        id: 'current_cognitive_state',
        question: 'Quel est l’état cognitif actuel de l’utilisateur ?',
        answer: `Mode ${stateSummary.regulation_mode}, énergie ${stateSummary.energy_level}, charge ${stateSummary.cognitive_load}.`,
        signal: isHighLoadState(stateSummary) ? 'protect_load' : isRecoveryState(stateSummary) ? 'recovery' : 'standard',
      }),
      buildCognitiveQuestionAnswer({
        id: 'load_reduction',
        question: 'Quelle stratégie réduit le plus la charge mentale ?',
        answer: loadReductionScore >= 0.72
          ? 'Cette stratégie devrait aider à réduire ou contenir la charge mentale.'
          : 'Cette stratégie peut être utile, mais ne réduit pas fortement la charge à elle seule.',
        signal: loadReductionScore >= 0.72 ? 'load_reducing' : 'limited_load_reduction',
        score: loadReductionScore,
      }),
      buildCognitiveQuestionAnswer({
        id: 'feasible_now',
        question: 'Quelle stratégie est réellement faisable maintenant ?',
        answer: feasibilityScore >= 0.7
          ? 'La stratégie semble faisable dans l’état actuel.'
          : 'La stratégie demande de la prudence : elle peut être trop coûteuse maintenant.',
        signal: feasibilityScore >= 0.7 ? 'feasible' : 'fragile',
        score: feasibilityScore,
      }),
      buildCognitiveQuestionAnswer({
        id: 'cost_profile',
        question: 'Quel est le coût cognitif et émotionnel de cette stratégie ?',
        answer: `Coût cognitif ${clamp01(strategy?.cognitive_cost, 0.2)}, risque ${clamp01(strategy?.risk_level, 0.1)}.`,
        signal: clamp01(strategy?.cognitive_cost, 0.2) >= 0.25 || clamp01(strategy?.risk_level, 0.1) >= 0.3 ? 'cost_watch' : 'acceptable_cost',
      }),
      buildCognitiveQuestionAnswer({
        id: 'momentum',
        question: 'Cette stratégie crée-t-elle du momentum ?',
        answer: momentumScore >= 0.7
          ? 'Cette stratégie peut créer un élan ou une petite victoire cognitive.'
          : 'L’effet momentum est limité : elle sert surtout à préserver ou clarifier.',
        signal: momentumScore >= 0.7 ? 'momentum_positive' : 'momentum_limited',
        score: momentumScore,
      }),
      buildCognitiveQuestionAnswer({
        id: 'conflict_detection',
        question: 'Y a-t-il un conflit entre ce que l’utilisateur veut et son état réel ?',
        answer: conflict.label,
        signal: conflict.has_conflict ? conflict.type : 'no_conflict',
      }),
      buildCognitiveQuestionAnswer({
        id: 'decision_path',
        question: 'Faut-il agir, clarifier, mémoriser ou simplement soutenir ?',
        answer: readiness === 'clarify_before_decision'
          ? 'Le raisonnement recommande de clarifier avant toute décision opérationnelle.'
          : `Le raisonnement prépare cette stratégie comme ${readiness}.`,
        signal: readiness,
      }),
    ],
    summary: {
      feasibility_score: feasibilityScore,
      load_reduction_score: loadReductionScore,
      momentum_score: momentumScore,
      conflict_type: conflict.type,
      recommended_reasoning_posture: readiness === 'clarify_before_decision'
        ? 'clarify_before_deciding'
        : conflict.has_conflict
          ? 'proceed_with_caution'
          : 'prepare_for_decision',
    },
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

function buildReasoningOutput({ thought, understanding, basis, strategies, alternativeStrategyAnalysis = null, context = {} }) {
  const primaryIntent = getPrimaryIntent(understanding);
  const cognitiveContext = getCognitiveContext(context);
  const enrichedStrategies = normalizeArray(strategies).map((strategy, index) => {
    return enrichStrategyForDecisionPreparation(strategy, index, {
      basis,
      cognitiveContext,
    });
  });
  const rankedStrategies = buildRankedStrategyReferences(enrichedStrategies);
  const cognitiveNeedSummary = summarizeCognitiveNeeds(enrichedStrategies);
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
      active_hypothesis_count: basis.active_hypotheses.length,
      rejected_hypothesis_count: basis.rejected_hypotheses.length,
      competing_hypothesis_count: basis.competing_hypotheses.length,
      observation_types: basis.observation_types,
      fact_types: basis.fact_types,
      hypothesis_types: basis.hypothesis_types,
      domain: basis.domain || null,
      cognitive_state: basis.cognitive_state || null,
      dominant_cognitive_need: basis.dominant_cognitive_need || null,
      directive_detection: basis.directive_detection || null,
      situation_profile: basis.situation_profile || null,
      cognitive_intervention: basis.cognitive_intervention || null,
      hypothesis_evaluation_summary: hypothesisEvaluationSummary,
    },
    evaluated_hypotheses: basis.hypotheses.map(hypothesis => ({
      id: hypothesis.id || null,
      type: hypothesis.type || null,
      confidence: hypothesis.evaluation?.confidence ?? hypothesis.confidence ?? null,
      original_confidence: hypothesis.evaluation?.original_confidence ?? hypothesis.confidence ?? null,
      status: hypothesis.evaluation?.status || null,
      support_level: hypothesis.evaluation?.support_level || null,
      contradicted: Boolean(hypothesis.evaluation?.contradicted),
      requires_verification: Boolean(hypothesis.evaluation?.requires_verification),
      reasoning_notes: normalizeArray(hypothesis.evaluation?.reasoning_notes),
    })),
    active_hypothesis_ids: basis.active_hypotheses.map(hypothesis => hypothesis.id || null).filter(Boolean),
    rejected_hypotheses: basis.rejected_hypotheses,
    competing_hypotheses: basis.competing_hypotheses,
    strategy_count: enrichedStrategies.length,
    strategies: enrichedStrategies,
    ranked_strategies: rankedStrategies,
    directive_detection_analysis: {
      version: 'directive-detection-v1',
      behavior_changed: Boolean(basis.directive_detection?.override_cognitive_intervention),
      directive: basis.directive_detection || null,
      principle: 'Le Reasoning Engine distingue les commandes explicites des besoins cognitifs généraux avant de choisir une intervention.',
    },
    cognitive_intervention_analysis: {
      version: 'cognitive-intervention-selector-v1',
      behavior_changed: false,
      selected_intervention: basis.cognitive_intervention || null,
      principle: 'Le Reasoning Engine choisit une méthode d’accompagnement cognitive avant de générer les stratégies qui la servent.',
    },
    cognitive_need_analysis: {
      version: 'cognitive-need-strategy-annotation-v1',
      behavior_changed: false,
      need_count: cognitiveNeedSummary.length,
      needs: cognitiveNeedSummary,
      principle: 'Le besoin cognitif est porté par chaque stratégie afin que le Decision Engine puisse comparer les approches selon le problème cognitif satisfait.',
    },
    alternative_strategy_analysis: alternativeStrategyAnalysis || {
      version: 'alternative-strategy-analyzer-v1',
      behavior_changed: false,
      initial_strategy_count: enrichedStrategies.length,
      final_strategy_count: enrichedStrategies.length,
      added_strategy_count: 0,
      added_alternatives: [],
      principle: 'Aucune analyse alternative fournie.',
    },
    decision_preparation: decisionPreparation,
    cognitive_decision_questions: {
      version: 'cognitive-questions-v1',
      behavior_changed: false,
      applied_to_strategy_ids: enrichedStrategies.map(strategy => strategy.id).filter(Boolean),
      state_summary: getCognitiveContextSummary(cognitiveContext),
      principle: 'Les stratégies sont évaluées relativement à l’état cognitif actuel sans que le Reasoning Engine ne décide ni n’exécute.',
    },
    assumptions: [],
    conflicts: basis.hypotheses
      .filter(hypothesis => hypothesis.evaluation?.contradicted)
      .map(hypothesis => ({
        type: 'contradicted_hypothesis',
        hypothesis_id: hypothesis.id || null,
        hypothesis_type: hypothesis.type || null,
      })),
    uncertainty: {
      level: hasUnstableHypotheses || basis.has_competing_hypotheses || strategies.some(strategy => strategy.risk_level >= 0.3) ? 'medium' : 'low',
      requires_clarification: decisionPreparation.clarification_candidate_ids.length > 0 || basis.has_competing_hypotheses,
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
    alternativeStrategyAnalysis: reasoning.alternative_strategy_analysis,
    context,
  });

  return {
    ...buildEngineResult({
      engine: 'reasoning',
      engineVersion: 'reasoning-v1',
      output,
      nextEngine: null,
      behaviorChanged: false,
      metadata: {
        internal_analyzers: ['hypothesis_evaluator_v2', 'hypothesis_arbitration_v1', 'directive_detection_v1', 'situation_profile_v1', 'cognitive_intervention_selector_v1', 'cognitive_layer_strategy_generator_v1', 'alternative_strategy_analyzer_v1', 'cognitive_need_strategy_annotation_v1', 'strategy_evaluator_v1', 'cognitive_questions_v1'],
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
