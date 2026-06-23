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


module.exports = {
  computeStrategyScore,
  classifyStrategyReadiness,
  enrichStrategyForDecisionPreparation,
  buildRankedStrategyReferences,
  summarizeCognitiveNeeds,
  buildDecisionPreparation,
  getCognitiveContextSummary,
};
