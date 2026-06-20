const crypto = require('crypto');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);

  if (Number.isNaN(number)) return fallback;

  return number;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function findFirstObject(values = []) {
  return normalizeArray(values).find(value => {
    return value && typeof value === 'object' && !Array.isArray(value);
  }) || null;
}

function getReasoningOutputFromEngineResult(value) {
  const safeValue = normalizeObject(value);

  if (Object.keys(safeValue).length === 0) return null;

  if (safeValue.type === 'reasoning_result' || safeValue.reasoning_version || safeValue.strategies || safeValue.ranked_strategies) {
    return safeValue;
  }

  const output = normalizeObject(safeValue.output);

  if (Object.keys(output).length > 0) {
    return output;
  }

  return null;
}

function extractReasoningOutput(candidateDecision, cognitiveContext = {}) {
  const normalizedDecision = normalizeObject(candidateDecision?.normalized_decision);
  const pipelineContext = normalizeObject(candidateDecision?.pipeline_context || cognitiveContext?.pipelineContext);
  const contextDecision = normalizeObject(cognitiveContext?.decision);
  const thoughtOrchestration = normalizeObject(cognitiveContext?.thoughtOrchestration);
  const engineResults = normalizeObject(
    pipelineContext.engine_results ||
    thoughtOrchestration.engine_results ||
    thoughtOrchestration.pipeline_context?.engine_results
  );

  const directOutput = findFirstObject([
    normalizedDecision.reasoning_output,
    normalizedDecision.reasoning,
    pipelineContext.reasoning_output,
    pipelineContext.reasoning,
    contextDecision.reasoning_output,
    contextDecision.reasoning,
    cognitiveContext?.reasoning_output,
    cognitiveContext?.reasoning,
  ]);

  if (directOutput) {
    return getReasoningOutputFromEngineResult(directOutput) || directOutput;
  }

  return findFirstObject([
    getReasoningOutputFromEngineResult(engineResults.reasoning),
    getReasoningOutputFromEngineResult(engineResults.reasoning_engine),
    getReasoningOutputFromEngineResult(pipelineContext.engine_result),
    getReasoningOutputFromEngineResult(thoughtOrchestration.reasoning),
  ]);
}

function findStrategyById(strategies = [], strategyId) {
  const normalizedStrategyId = normalizeText(strategyId);

  if (!normalizedStrategyId) return null;

  return normalizeArray(strategies).find(strategy => normalizeText(strategy?.id) === normalizedStrategyId) || null;
}

function buildDecisionInput(candidateDecision, cognitiveContext = {}) {
  // DecisionInput Contract V1
  // Responsabilité : fournir au Decision Engine une entrée stable et lisible,
  // issue du Reasoning Engine, sans exposer partout sa structure interne.
  // Le contrat est informatif en V1 : il ne modifie pas encore le choix final.
  const reasoningOutput = extractReasoningOutput(candidateDecision, cognitiveContext) || {};
  const strategies = normalizeArray(reasoningOutput.strategies);
  const rankedStrategies = normalizeArray(reasoningOutput.ranked_strategies);
  const decisionPreparation = normalizeObject(reasoningOutput.decision_preparation);
  const reasoningBasis = normalizeObject(reasoningOutput.reasoning_basis);
  const uncertainty = normalizeObject(reasoningOutput.uncertainty);
  const cognitiveDecisionQuestions = normalizeObject(reasoningOutput.cognitive_decision_questions);
  const strongestCandidateId = normalizeText(
    decisionPreparation.strongest_candidate_id ||
    rankedStrategies[0]?.id ||
    strategies[0]?.id ||
    ''
  );
  const strongestStrategy =
    findStrategyById(strategies, strongestCandidateId) ||
    findStrategyById(rankedStrategies, strongestCandidateId) ||
    strategies[0] ||
    rankedStrategies[0] ||
    null;
  const strongestStrategyEvaluation = normalizeObject(strongestStrategy?.evaluation);
  const strongestStrategyQuestions = normalizeObject(strongestStrategyEvaluation.cognitive_questions);
  const strongestStrategyQuestionSummary = normalizeObject(strongestStrategyQuestions.summary);
  const hypothesisSummary = normalizeObject(
    reasoningBasis.hypothesis_evaluation_summary ||
    reasoningOutput.hypothesis_evaluation_summary
  );
  const stateSummary = normalizeObject(
    strongestStrategyQuestionSummary.state_summary ||
    strongestStrategyQuestions.state_summary ||
    cognitiveDecisionQuestions.state_summary ||
    cognitiveContext?.latest_user_state ||
    cognitiveContext?.analysis?.cognitive_state
  );

  return {
    contract: 'decision-input-v1',
    source: 'reasoning_engine',
    behavior_impact: 'none',
    available: Boolean(
      reasoningOutput.reasoning_version ||
      strategies.length > 0 ||
      rankedStrategies.length > 0 ||
      Object.keys(decisionPreparation).length > 0
    ),
    reasoning_version: reasoningOutput.reasoning_version || null,
    ranked_strategies: rankedStrategies,
    strategies,
    strongest_candidate: strongestStrategy
      ? {
          id: strongestStrategy.id || strongestCandidateId || null,
          label: strongestStrategy.label || null,
          type: strongestStrategy.type || null,
          score: strongestStrategyEvaluation.score ?? rankedStrategies[0]?.score ?? decisionPreparation.strongest_candidate_score ?? null,
          readiness: strongestStrategyEvaluation.readiness || rankedStrategies[0]?.readiness || null,
          confidence: strongestStrategyEvaluation.confidence ?? strongestStrategy.confidence ?? rankedStrategies[0]?.confidence ?? null,
          expected_benefit: strongestStrategyEvaluation.expected_benefit ?? strongestStrategy.expected_benefit ?? rankedStrategies[0]?.expected_benefit ?? null,
          cognitive_cost: strongestStrategyEvaluation.cognitive_cost ?? strongestStrategy.cognitive_cost ?? rankedStrategies[0]?.cognitive_cost ?? null,
          risk_level: strongestStrategyEvaluation.risk_level ?? strongestStrategy.risk_level ?? rankedStrategies[0]?.risk_level ?? null,
          decision_boundary: strongestStrategyEvaluation.decision_boundary || null,
          cognitive_questions_summary: strongestStrategyQuestionSummary,
        }
      : null,
    decision_preparation: {
      status: decisionPreparation.status || null,
      decision_taken: Boolean(decisionPreparation.decision_taken),
      strongest_candidate_id: strongestCandidateId || null,
      strongest_candidate_score: decisionPreparation.strongest_candidate_score ?? null,
      ranked_strategy_ids: normalizeArray(decisionPreparation.ranked_strategy_ids),
      clarification_candidate_ids: normalizeArray(decisionPreparation.clarification_candidate_ids),
      uncertainty_level: decisionPreparation.uncertainty_level || uncertainty.level || null,
      principle: decisionPreparation.principle || null,
    },
    uncertainty: {
      level: uncertainty.level || decisionPreparation.uncertainty_level || null,
      requires_clarification: Boolean(
        uncertainty.requires_clarification ||
        normalizeArray(decisionPreparation.clarification_candidate_ids).length > 0
      ),
    },
    hypothesis_summary: hypothesisSummary,
    cognitive_state: stateSummary,
    reasoning_metadata: {
      primary_intent: reasoningOutput.primary_intent || reasoningBasis.primary_intent || null,
      strategy_count: reasoningOutput.strategy_count ?? strategies.length,
      evaluated_hypothesis_count: normalizeArray(reasoningOutput.evaluated_hypotheses).length,
      active_hypothesis_count: reasoningBasis.active_hypothesis_count ?? normalizeArray(reasoningOutput.active_hypothesis_ids).length,
      rejected_hypothesis_count: reasoningBasis.rejected_hypothesis_count ?? normalizeArray(reasoningOutput.rejected_hypotheses).length,
      competing_hypothesis_count: reasoningBasis.competing_hypothesis_count ?? normalizeArray(reasoningOutput.competing_hypotheses).length,
      behavior_changed: Boolean(reasoningOutput.behavior_changed),
    },
    generated_at: new Date().toISOString(),
  };
}

function summarizeDecisionInput(decisionInput) {
  const safeInput = normalizeObject(decisionInput);

  return {
    contract: safeInput.contract || 'decision-input-v1',
    available: Boolean(safeInput.available),
    reasoning_version: safeInput.reasoning_version || null,
    strongest_candidate_id: safeInput.strongest_candidate?.id || null,
    strongest_candidate_score: safeInput.strongest_candidate?.score ?? null,
    strongest_candidate_readiness: safeInput.strongest_candidate?.readiness || null,
    strategy_count: safeInput.reasoning_metadata?.strategy_count ?? normalizeArray(safeInput.strategies).length,
    uncertainty_level: safeInput.uncertainty?.level || null,
    requires_clarification: Boolean(safeInput.uncertainty?.requires_clarification),
  };
}

function extractReasoningPayload(candidateDecision, cognitiveContext = {}) {
  const normalizedDecision = candidateDecision?.normalized_decision || null;
  const pipelineContext = candidateDecision?.pipeline_context || cognitiveContext?.pipelineContext || null;
  const contextDecision = cognitiveContext?.decision || null;
  const contextThoughtOrchestration = cognitiveContext?.thoughtOrchestration || null;

  return {
    normalized_decision: normalizedDecision,
    pipeline_context: pipelineContext,
    cognitive_context_decision: contextDecision,
    thought_orchestration: contextThoughtOrchestration,
  };
}

function getCandidateConfidence(candidateDecision, cognitiveContext = {}) {
  const decisionInput = buildDecisionInput(candidateDecision, cognitiveContext);
  const strongestCandidate = normalizeObject(decisionInput.strongest_candidate);
  const reasoningPayload = extractReasoningPayload(candidateDecision, cognitiveContext);

  const rawConfidenceCandidates = [
    strongestCandidate.confidence,
    strongestCandidate.score,
    candidateDecision?.confidence,
    candidateDecision?.normalized_decision?.confidence,
    candidateDecision?.normalized_decision?.confidence_score,
    candidateDecision?.candidate_action?.confidence,
    candidateDecision?.candidate_action?.confidence_score,
    cognitiveContext?.decision?.confidence,
    cognitiveContext?.decision?.confidence_score,
    cognitiveContext?.analysis?.confidence,
    cognitiveContext?.analysis?.confidence_score,
    reasoningPayload?.pipeline_context?.confidence,
    reasoningPayload?.pipeline_context?.confidence_score,
  ];

  const foundConfidence = rawConfidenceCandidates.find(value => {
    const number = Number(value);
    return !Number.isNaN(number);
  });

  if (foundConfidence === undefined || foundConfidence === null) return 0.5;

  const normalized = normalizeNumber(foundConfidence, 0.5);

  if (normalized > 1) return clampNumber(normalized / 100, 0, 1);

  return clampNumber(normalized, 0, 1);
}

function detectReasoningSignals(candidateDecision, cognitiveContext = {}) {
  const decisionInput = buildDecisionInput(candidateDecision, cognitiveContext);
  const reasoningPayload = extractReasoningPayload(candidateDecision, cognitiveContext);
  const normalizedDecision = reasoningPayload.normalized_decision || {};
  const pipelineContext = reasoningPayload.pipeline_context || {};
  const analysis = cognitiveContext?.analysis || {};
  const hypothesisSummary = normalizeObject(decisionInput.hypothesis_summary);
  const strongestCandidate = normalizeObject(decisionInput.strongest_candidate);
  const decisionPreparation = normalizeObject(decisionInput.decision_preparation);

  const hasHypothesisEvaluation = Boolean(
    Object.keys(hypothesisSummary).length > 0 ||
    normalizeNumber(decisionInput.reasoning_metadata?.evaluated_hypothesis_count, 0) > 0 ||
    normalizedDecision.hypothesis_evaluation ||
    normalizedDecision.hypotheses_evaluation ||
    normalizedDecision.hypotheses ||
    pipelineContext.hypothesis_evaluation ||
    pipelineContext.hypotheses_evaluation ||
    pipelineContext.hypotheses ||
    analysis.hypothesis_evaluation ||
    analysis.hypotheses_evaluation ||
    analysis.hypotheses
  );

  const hasStrategy = Boolean(
    decisionInput.available ||
    strongestCandidate.id ||
    normalizeArray(decisionInput.strategies).length > 0 ||
    normalizeArray(decisionInput.ranked_strategies).length > 0
  );

  const hasContradiction = Boolean(
    normalizeNumber(hypothesisSummary.contradicted, 0) > 0 ||
    normalizedDecision.has_contradiction ||
    normalizedDecision.contradiction_detected ||
    pipelineContext.has_contradiction ||
    pipelineContext.contradiction_detected ||
    analysis.has_contradiction ||
    analysis.contradiction_detected
  );

  const needsVerification = Boolean(
    decisionInput.uncertainty?.requires_clarification ||
    normalizeArray(decisionPreparation.clarification_candidate_ids).length > 0 ||
    normalizeNumber(hypothesisSummary.needs_verification, 0) > 0 ||
    normalizedDecision.needs_verification ||
    normalizedDecision.requires_verification ||
    pipelineContext.needs_verification ||
    pipelineContext.requires_verification ||
    analysis.needs_verification ||
    analysis.requires_verification
  );

  return {
    has_hypothesis_evaluation: hasHypothesisEvaluation,
    has_reasoning_strategy: hasStrategy,
    has_contradiction: hasContradiction,
    needs_verification: needsVerification,
    decision_input_available: Boolean(decisionInput.available),
    strongest_candidate_readiness: strongestCandidate.readiness || null,
    strongest_candidate_score: strongestCandidate.score ?? null,
    uncertainty_level: decisionInput.uncertainty?.level || null,
  };
}

function computeDecisionScore(candidateDecision, cognitiveContext = {}) {
  // Decision Score V1.2
  // Responsabilité : commencer à mesurer la qualité cognitive d'une décision candidate
  // sans modifier le comportement utilisateur validé.
  // Le score est informatif pour l'instant : chooseBestDecision continue de choisir
  // la première candidate valide afin d'éviter toute régression.
  const analysis = candidateDecision?.analysis_summary || cognitiveContext?.analysis || {};
  const decisionInput = buildDecisionInput(candidateDecision, cognitiveContext);
  const confidence = getCandidateConfidence(candidateDecision, cognitiveContext);
  const reasoningSignals = detectReasoningSignals(candidateDecision, cognitiveContext);
  const strongestCandidate = normalizeObject(decisionInput.strongest_candidate);

  let score = 50;
  const factors = [];

  if (candidateDecision?.should_execute === false) {
    score -= 20;
    factors.push({ id: 'no_execution', impact: -20, label: 'La décision demande de ne pas exécuter.' });
  }

  if (candidateDecision?.candidate_action) {
    score += 12;
    factors.push({ id: 'has_candidate_action', impact: 12, label: 'Une action candidate existe.' });
  }

  if (analysis?.urgency === 'high') {
    score += 8;
    factors.push({ id: 'high_urgency', impact: 8, label: 'La pensée comporte un signal d’urgence.' });
  }

  if (analysis?.response_level === 'reflection' || analysis?.is_emotion) {
    if (candidateDecision?.should_execute === false || !candidateDecision?.candidate_action) {
      score += 10;
      factors.push({ id: 'reflection_protected', impact: 10, label: 'La réflexion émotionnelle reste protégée de l’exécution automatique.' });
    } else {
      score -= 12;
      factors.push({ id: 'reflection_execution_risk', impact: -12, label: 'Une action existe malgré un contexte de réflexion.' });
    }
  }

  if (analysis?.is_task && candidateDecision?.candidate_action) {
    score += 8;
    factors.push({ id: 'task_action_alignment', impact: 8, label: 'La décision est alignée avec une demande opérationnelle.' });
  }

  if (reasoningSignals.has_hypothesis_evaluation) {
    score += 8;
    factors.push({ id: 'hypothesis_evaluation_available', impact: 8, label: 'Des hypothèses ont été évaluées avant la décision.' });
  }

  if (reasoningSignals.has_reasoning_strategy) {
    score += 10;
    factors.push({ id: 'reasoning_strategy_available', impact: 10, label: 'Une stratégie cognitive est disponible.' });
  }

  if (decisionInput.available) {
    score += 6;
    factors.push({ id: 'decision_input_contract_available', impact: 6, label: 'Le contrat Reasoning → Decision est disponible.' });
  }

  if (strongestCandidate.readiness === 'ready_for_decision') {
    score += 8;
    factors.push({ id: 'strategy_ready_for_decision', impact: 8, label: 'La meilleure stratégie est prête pour une décision.' });
  } else if (strongestCandidate.readiness === 'clarify_before_decision') {
    score -= 10;
    factors.push({ id: 'strategy_requires_clarification', impact: -10, label: 'La meilleure stratégie demande une clarification avant décision.' });
  }

  if (decisionInput.uncertainty?.level === 'medium') {
    score -= 4;
    factors.push({ id: 'medium_uncertainty', impact: -4, label: 'Le raisonnement indique une incertitude moyenne.' });
  }

  if (reasoningSignals.has_contradiction) {
    score -= 14;
    factors.push({ id: 'contradiction_detected', impact: -14, label: 'Une contradiction est détectée.' });
  }

  if (reasoningSignals.needs_verification) {
    score -= 8;
    factors.push({ id: 'verification_needed', impact: -8, label: 'La décision demande une vérification.' });
  }

  const confidenceImpact = Math.round((confidence - 0.5) * 30);

  if (confidenceImpact !== 0) {
    score += confidenceImpact;
    factors.push({
      id: 'confidence_adjustment',
      impact: confidenceImpact,
      label: 'Le niveau de confiance ajuste le score de décision.',
    });
  }

  const normalizedScore = clampNumber(Math.round(score), 0, 100);

  return {
    score: normalizedScore,
    confidence,
    level: normalizedScore >= 75
      ? 'strong'
      : normalizedScore >= 55
        ? 'acceptable'
        : normalizedScore >= 35
          ? 'fragile'
          : 'weak',
    factors,
    reasoning_signals: reasoningSignals,
    decision_input_summary: summarizeDecisionInput(decisionInput),
    scoring_version: 'decision-score-v1.3',
    generated_at: new Date().toISOString(),
  };
}

function attachDecisionScore(candidateDecision, cognitiveContext = {}) {
  if (!candidateDecision || typeof candidateDecision !== 'object') {
    return null;
  }

  const decisionInput = buildDecisionInput(candidateDecision, cognitiveContext);
  const decisionScore = computeDecisionScore(candidateDecision, cognitiveContext);

  return {
    ...candidateDecision,
    decision_input: decisionInput,
    decision_score: decisionScore,
    selection_metadata: {
      scoring_available: true,
      scoring_version: decisionScore.scoring_version,
      decision_input_available: Boolean(decisionInput.available),
      decision_input_contract: decisionInput.contract,
      behavior_impact: 'none',
      note: 'Contrat DecisionInput et score calculés sans modifier la stratégie de sélection V1.',
    },
  };
}

function buildChatCandidateDecision({ thought, analysis, detectedAction, decision, pipelineContext } = {}) {
  // Nyra Decision Engine V1
  // Responsabilité : construire l'objet de décision candidat entre Reasoning et Execution.
  // Cette première extraction reproduit exactement le comportement validé dans server.js :
  // - si la décision cognitive interdit l'exécution, aucune action ne passe ;
  // - sinon, l'action candidate détectée reste exécutable ;
  // - aucun comportement utilisateur visible n'est modifié.
  const normalizedDecision = decision && typeof decision === 'object'
    ? decision
    : null;

  const candidateAction = detectedAction || null;
  const shouldExecute = normalizedDecision?.should_execute === false
    ? false
    : Boolean(candidateAction);

  const decisionType = normalizeText(
    normalizedDecision?.decision_type ||
    normalizedDecision?.type ||
    (shouldExecute ? 'execute_candidate_action' : 'no_action')
  ) || (shouldExecute ? 'execute_candidate_action' : 'no_action');

  return {
    id: crypto.randomUUID(),
    source: 'chat',
    decision_layer: 'nyra_decision_engine_v1',
    thought_id: thought?.id || null,
    decision_type: decisionType,
    should_execute: shouldExecute,
    candidate_action: candidateAction,
    normalized_decision: normalizedDecision,
    analysis_summary: {
      type: analysis?.type || null,
      suggested_bucket: analysis?.suggested_bucket || null,
      response_level: analysis?.response_level || null,
      conversation_intent: analysis?.conversation_intent || null,
      urgency: analysis?.urgency || null,
      is_task: Boolean(analysis?.is_task),
      is_idea: Boolean(analysis?.is_idea),
      is_emotion: Boolean(analysis?.is_emotion),
      is_project: Boolean(analysis?.is_project),
    },
    pipeline_context: pipelineContext || null,
    created_at: new Date().toISOString(),
  };
}

function normalizeCandidateDecisionList(candidateDecisions) {
  if (!Array.isArray(candidateDecisions)) {
    return candidateDecisions ? [candidateDecisions].filter(Boolean) : [];
  }

  return candidateDecisions.filter(candidateDecision => {
    return candidateDecision && typeof candidateDecision === 'object';
  });
}

function chooseBestDecision(candidateDecisions, cognitiveContext = {}) {
  // Nyra Decision Engine V1.3
  // Responsabilité : consommer un contrat DecisionInput issu du Reasoning Engine
  // et enrichir les décisions candidates avec un score cognitif.
  // Important : le contrat et le score sont calculés, mais ils ne pilotent pas encore le choix.
  const candidates = normalizeCandidateDecisionList(candidateDecisions);
  const scoredCandidates = candidates.map(candidateDecision => {
    return attachDecisionScore(candidateDecision, cognitiveContext);
  }).filter(Boolean);
  const chosenDecision = scoredCandidates[0] || null;

  if (!chosenDecision) {
    return {
      id: crypto.randomUUID(),
      source: 'chat',
      decision_layer: 'nyra_decision_engine_v1_3',
      decision_type: 'no_action',
      should_execute: false,
      candidate_action: null,
      normalized_decision: null,
      candidate_count: 0,
      scored_candidate_count: 0,
      selection_strategy: 'first_valid_candidate_with_decision_input',
      selection_reason: 'Aucune décision candidate disponible.',
      selection_metadata: {
        scoring_available: true,
        behavior_impact: 'none',
        note: 'Aucun score utile sans décision candidate.',
      },
      cognitive_context: cognitiveContext || {},
      created_at: new Date().toISOString(),
    };
  }

  return {
    ...chosenDecision,
    decision_layer: 'nyra_decision_engine_v1_3',
    candidate_count: candidates.length,
    scored_candidate_count: scoredCandidates.length,
    scored_candidates: scoredCandidates.map(candidateDecision => ({
      id: candidateDecision.id || null,
      decision_type: candidateDecision.decision_type || null,
      should_execute: Boolean(candidateDecision.should_execute),
      score: candidateDecision.decision_score?.score ?? null,
      level: candidateDecision.decision_score?.level || null,
      decision_input_available: Boolean(candidateDecision.decision_input?.available),
      strongest_candidate_id: candidateDecision.decision_input?.strongest_candidate?.id || null,
    })),
    selection_strategy: 'first_valid_candidate_with_decision_input',
    selection_reason: 'Comportement V1 conservé : la première décision candidate valide est choisie. Le DecisionInput et le score sont seulement informatifs en V1.3.',
    cognitive_context: cognitiveContext || {},
    selected_at: new Date().toISOString(),
  };
}

function resolveExecutableActionFromCandidateDecision(candidateDecision) {
  if (!candidateDecision || typeof candidateDecision !== 'object') {
    return null;
  }

  if (candidateDecision.should_execute === false) {
    return null;
  }

  return candidateDecision.candidate_action || null;
}

function resolveExecutableActionFromDecision(action, decision) {
  if (!decision || typeof decision !== 'object') {
    return action || null;
  }

  if (decision.should_execute === false) {
    return null;
  }

  return action || null;
}

module.exports = {
  buildChatCandidateDecision,
  chooseBestDecision,
  resolveExecutableActionFromCandidateDecision,
  resolveExecutableActionFromDecision,
  buildDecisionInput,
};
