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
  const reasoningPayload = extractReasoningPayload(candidateDecision, cognitiveContext);

  const rawConfidenceCandidates = [
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

  if (foundConfidence === undefined) return 0.5;

  const normalized = normalizeNumber(foundConfidence, 0.5);

  if (normalized > 1) return clampNumber(normalized / 100, 0, 1);

  return clampNumber(normalized, 0, 1);
}

function detectReasoningSignals(candidateDecision, cognitiveContext = {}) {
  const reasoningPayload = extractReasoningPayload(candidateDecision, cognitiveContext);
  const normalizedDecision = reasoningPayload.normalized_decision || {};
  const pipelineContext = reasoningPayload.pipeline_context || {};
  const analysis = cognitiveContext?.analysis || {};

  const hypothesisPayload =
    normalizedDecision.hypothesis_evaluation ||
    normalizedDecision.hypotheses_evaluation ||
    normalizedDecision.hypotheses ||
    pipelineContext.hypothesis_evaluation ||
    pipelineContext.hypotheses_evaluation ||
    pipelineContext.hypotheses ||
    analysis.hypothesis_evaluation ||
    analysis.hypotheses_evaluation ||
    analysis.hypotheses ||
    null;

  const strategyPayload =
    normalizedDecision.strategy ||
    normalizedDecision.cognitive_strategy ||
    normalizedDecision.selected_strategy ||
    normalizedDecision.reasoning_strategy ||
    pipelineContext.strategy ||
    pipelineContext.cognitive_strategy ||
    pipelineContext.selected_strategy ||
    pipelineContext.reasoning_strategy ||
    null;

  const reasoningOutput =
    normalizedDecision.reasoning_output ||
    normalizedDecision.reasoning ||
    pipelineContext.reasoning_output ||
    pipelineContext.reasoning ||
    null;

  const hasHypothesisEvaluation = Boolean(hypothesisPayload);
  const hasStrategy = Boolean(strategyPayload || reasoningOutput);
  const hasContradiction = Boolean(
    normalizedDecision.has_contradiction ||
    normalizedDecision.contradiction_detected ||
    pipelineContext.has_contradiction ||
    pipelineContext.contradiction_detected ||
    analysis.has_contradiction ||
    analysis.contradiction_detected
  );
  const needsVerification = Boolean(
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
  };
}

function computeDecisionScore(candidateDecision, cognitiveContext = {}) {
  // Decision Score V1.2
  // Responsabilité : commencer à mesurer la qualité cognitive d'une décision candidate
  // sans modifier le comportement utilisateur validé.
  // Le score est informatif pour l'instant : chooseBestDecision continue de choisir
  // la première candidate valide afin d'éviter toute régression.
  const analysis = candidateDecision?.analysis_summary || cognitiveContext?.analysis || {};
  const confidence = getCandidateConfidence(candidateDecision, cognitiveContext);
  const reasoningSignals = detectReasoningSignals(candidateDecision, cognitiveContext);

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
    scoring_version: 'decision-score-v1.2',
    generated_at: new Date().toISOString(),
  };
}

function attachDecisionScore(candidateDecision, cognitiveContext = {}) {
  if (!candidateDecision || typeof candidateDecision !== 'object') {
    return null;
  }

  const decisionScore = computeDecisionScore(candidateDecision, cognitiveContext);

  return {
    ...candidateDecision,
    decision_score: decisionScore,
    selection_metadata: {
      scoring_available: true,
      scoring_version: decisionScore.scoring_version,
      behavior_impact: 'none',
      note: 'Score calculé sans modifier la stratégie de sélection V1.',
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
  // Nyra Decision Engine V1.2
  // Responsabilité : enrichir les décisions candidates avec un score cognitif
  // tout en conservant strictement le comportement V1 validé.
  // Important : le score est calculé, mais il ne pilote pas encore le choix.
  const candidates = normalizeCandidateDecisionList(candidateDecisions);
  const scoredCandidates = candidates.map(candidateDecision => {
    return attachDecisionScore(candidateDecision, cognitiveContext);
  }).filter(Boolean);
  const chosenDecision = scoredCandidates[0] || null;

  if (!chosenDecision) {
    return {
      id: crypto.randomUUID(),
      source: 'chat',
      decision_layer: 'nyra_decision_engine_v1_2',
      decision_type: 'no_action',
      should_execute: false,
      candidate_action: null,
      normalized_decision: null,
      candidate_count: 0,
      scored_candidate_count: 0,
      selection_strategy: 'first_valid_candidate_with_informative_score',
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
    decision_layer: 'nyra_decision_engine_v1_2',
    candidate_count: candidates.length,
    scored_candidate_count: scoredCandidates.length,
    scored_candidates: scoredCandidates.map(candidateDecision => ({
      id: candidateDecision.id || null,
      decision_type: candidateDecision.decision_type || null,
      should_execute: Boolean(candidateDecision.should_execute),
      score: candidateDecision.decision_score?.score ?? null,
      level: candidateDecision.decision_score?.level || null,
    })),
    selection_strategy: 'first_valid_candidate_with_informative_score',
    selection_reason: 'Comportement V1 conservé : la première décision candidate valide est choisie. Le score est seulement informatif en V1.2.',
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
};
