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
  const strongestStrategyCognitiveNeed = normalizeObject(strongestStrategy?.cognitive_need);
  const reasoningBasisSituationProfile = normalizeObject(reasoningBasis.situation_profile);
  const reasoningBasisCognitiveIntervention = normalizeObject(reasoningBasis.cognitive_intervention);
  const propagatedCognitiveNeed = normalizeText(
    strongestStrategyCognitiveNeed.primary ||
    strongestStrategy?.primary_cognitive_need ||
    decisionPreparation.cognitive_need ||
    reasoningBasis.dominant_cognitive_need ||
    reasoningBasisSituationProfile.dominant_need ||
    reasoningBasisCognitiveIntervention.goal ||
    reasoningOutput.dominant_cognitive_need ||
    ''
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
    cognitive_need: propagatedCognitiveNeed || null,
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


function resolveDecisionProfileValue(values = [], fallback = null) {
  const foundValue = normalizeArray(values).find(value => {
    if (value === undefined || value === null) return false;

    if (typeof value === 'string') return normalizeText(value).length > 0;

    if (typeof value === 'number') return !Number.isNaN(value);

    if (Array.isArray(value)) return value.length > 0;

    if (typeof value === 'object') return Object.keys(value).length > 0;

    return Boolean(value);
  });

  return foundValue === undefined ? fallback : foundValue;
}

function normalizeDecisionProfileMetric(value, fallback = 'unknown') {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (!normalizedValue) return fallback;

  return normalizedValue;
}

function normalizeDecisionProfileTextList(values = []) {
  return normalizeArray(values)
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => normalizeText(value))
    .filter(Boolean);
}

function includesAnyText(value, patterns = []) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (!normalizedValue) return false;

  return normalizeArray(patterns).some(pattern => {
    return normalizedValue.includes(normalizeText(pattern).toLowerCase());
  });
}

function normalizeCognitiveCostLevel(value, fallback = 3) {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return clampNumber(Math.round(value), 0, 7);
  }

  const normalizedValue = normalizeText(value).toLowerCase();

  if (!normalizedValue) return fallback;

  const directNumber = Number(normalizedValue);

  if (!Number.isNaN(directNumber)) {
    return clampNumber(Math.round(directNumber), 0, 7);
  }

  const costMap = {
    none: 0,
    no_cost: 0,
    zero: 0,
    very_low: 1,
    low: 1,
    minimal: 1,
    light: 2,
    medium: 3,
    moderate: 3,
    high: 5,
    heavy: 5,
    very_high: 6,
    complex: 7,
  };

  return costMap[normalizedValue] ?? fallback;
}

function labelCognitiveCostLevel(level) {
  const normalizedLevel = normalizeCognitiveCostLevel(level, 3);

  if (normalizedLevel <= 0) return 'none';
  if (normalizedLevel === 1) return 'externalisation_only';
  if (normalizedLevel === 2) return 'simple_response';
  if (normalizedLevel === 3) return 'light_sorting';
  if (normalizedLevel === 4) return 'comparison';
  if (normalizedLevel === 5) return 'prioritization';
  if (normalizedLevel === 6) return 'planning';
  return 'complex_decision';
}

function buildCognitiveCostProfile({
  rawCost,
  cognitiveNeed,
  strongestCandidate,
  decisionPreparation,
  analysis,
  cognitiveQuestionsSummary,
} = {}) {
  // Cognitive Cost V1
  // Responsabilité : représenter explicitement l'effort mental demandé à l'utilisateur.
  // Cette structure est informative : elle prépare l'arbitrage sans modifier le choix final.
  const candidateText = [
    cognitiveNeed,
    strongestCandidate?.id,
    strongestCandidate?.label,
    strongestCandidate?.type,
    decisionPreparation?.principle,
    analysis?.conversation_intent,
    analysis?.response_level,
    cognitiveQuestionsSummary?.protocol,
    cognitiveQuestionsSummary?.phase,
  ].join(' ');

  const isBrainDumpCollect = Boolean(
    includesAnyText(candidateText, [
      'brain_dump',
      'brain dump',
      'vide cerveau',
      'vider le cerveau',
      'dévers',
      'devers',
      'externalis',
      'surcharge',
      'mental_overload',
      'cognitive_load',
      'charge mentale',
    ])
  );

  const rawLevel = normalizeCognitiveCostLevel(rawCost, isBrainDumpCollect ? 1 : 3);
  const level = isBrainDumpCollect ? 1 : rawLevel;
  const maxAllowedLevel = isBrainDumpCollect ? 1 : 7;

  if (isBrainDumpCollect) {
    return {
      contract: 'cognitive-cost-v1',
      level,
      label: labelCognitiveCostLevel(level),
      max_allowed_level: maxAllowedLevel,
      rationale: 'Phase de collecte Brain Dump : Nyra doit réduire l’effort mental au minimum et inviter à externaliser sans tri.',
      allowed_operations: [
        'externaliser librement',
        'écrire en vrac',
        'rassurer',
        'annoncer que Nyra fera le tri ensuite',
      ],
      forbidden_operations: [
        'demander de choisir',
        'demander de prioriser',
        'demander de comparer',
        'demander par quoi commencer',
        'demander ce qui est le plus urgent',
        'demander la première chose qui vient',
        'proposer un plan avant collecte',
      ],
      source: 'brain_dump_collect_constraint',
    };
  }

  return {
    contract: 'cognitive-cost-v1',
    level,
    label: labelCognitiveCostLevel(level),
    max_allowed_level: maxAllowedLevel,
    rationale: 'Coût cognitif estimé à partir de la stratégie candidate et du contexte disponible.',
    allowed_operations: normalizeDecisionProfileTextList([
      cognitiveQuestionsSummary?.allowed_operation,
      cognitiveQuestionsSummary?.allowed_operations,
    ]),
    forbidden_operations: normalizeDecisionProfileTextList([
      cognitiveQuestionsSummary?.forbidden_operation,
      cognitiveQuestionsSummary?.forbidden_operations,
    ]),
    source: rawCost ? 'reasoning_strategy' : 'decision_profile_default',
  };
}

function buildDecisionProfile(candidateDecision, cognitiveContext = {}, decisionInputOverride = null) {
  // Decision Profile V1
  // Responsabilité : synthétiser la situation décisionnelle avant le score et le choix.
  // Le profil est informatif en V1 : il ne modifie pas encore le comportement utilisateur.
  const decisionInput = decisionInputOverride || buildDecisionInput(candidateDecision, cognitiveContext);
  const analysis = normalizeObject(candidateDecision?.analysis_summary || cognitiveContext?.analysis);
  const strongestCandidate = normalizeObject(decisionInput.strongest_candidate);
  const cognitiveState = normalizeObject(decisionInput.cognitive_state);
  const cognitiveQuestionsSummary = normalizeObject(strongestCandidate.cognitive_questions_summary);
  const decisionPreparation = normalizeObject(decisionInput.decision_preparation);
  const uncertainty = normalizeObject(decisionInput.uncertainty);
  const reasoningMetadata = normalizeObject(decisionInput.reasoning_metadata);
  const normalizedDecision = normalizeObject(candidateDecision?.normalized_decision);
  const candidateAction = normalizeObject(candidateDecision?.candidate_action);

  const cognitiveNeed = resolveDecisionProfileValue([
    decisionInput.cognitive_need,
    cognitiveQuestionsSummary.cognitive_need,
    cognitiveQuestionsSummary.primary_need,
    strongestCandidate.cognitive_need,
    normalizedDecision.cognitive_need,
    normalizedDecision.primary_cognitive_need,
    cognitiveState.cognitive_need,
    analysis.cognitive_need,
    reasoningMetadata.primary_intent,
    analysis.conversation_intent,
    analysis.suggested_bucket,
    analysis.type,
  ], 'unknown');

  const rawCognitiveCost = resolveDecisionProfileValue([
    strongestCandidate.cognitive_cost,
    cognitiveQuestionsSummary.cognitive_cost,
    decisionPreparation.cognitive_cost,
    normalizedDecision.cognitive_cost,
    candidateAction.cognitive_cost,
  ], null);

  const cognitiveCost = buildCognitiveCostProfile({
    rawCost: rawCognitiveCost,
    cognitiveNeed,
    strongestCandidate,
    decisionPreparation,
    analysis,
    cognitiveQuestionsSummary,
  });

  const expectedBenefit = normalizeDecisionProfileMetric(resolveDecisionProfileValue([
    strongestCandidate.expected_benefit,
    cognitiveQuestionsSummary.expected_benefit,
    decisionPreparation.expected_benefit,
    normalizedDecision.expected_benefit,
    candidateAction.expected_benefit,
  ], null));

  const readiness = normalizeDecisionProfileMetric(resolveDecisionProfileValue([
    strongestCandidate.readiness,
    decisionPreparation.readiness,
    normalizedDecision.readiness,
  ], 'unknown'));

  const riskLevel = normalizeDecisionProfileMetric(resolveDecisionProfileValue([
    strongestCandidate.risk_level,
    cognitiveQuestionsSummary.risk_level,
    decisionPreparation.risk_level,
    normalizedDecision.risk_level,
  ], 'unknown'));

  return {
    contract: 'decision-profile-v1',
    source: 'nyra_decision_engine',
    behavior_impact: 'none',
    available: Boolean(decisionInput.available || strongestCandidate.id || candidateDecision?.candidate_action),
    cognitive_need: normalizeText(cognitiveNeed) || 'unknown',
    cognitive_cost: cognitiveCost,
    expected_benefit: expectedBenefit,
    user_context: {
      cognitive_state: cognitiveState,
      urgency: analysis.urgency || null,
      response_level: analysis.response_level || null,
      conversation_intent: analysis.conversation_intent || null,
      is_task: Boolean(analysis.is_task),
      is_emotion: Boolean(analysis.is_emotion),
      is_idea: Boolean(analysis.is_idea),
      is_project: Boolean(analysis.is_project),
    },
    situation_constraints: {
      should_execute: candidateDecision?.should_execute === false ? false : Boolean(candidateDecision?.should_execute),
      has_candidate_action: Boolean(candidateDecision?.candidate_action),
      decision_boundary: strongestCandidate.decision_boundary || null,
      requires_clarification: Boolean(uncertainty.requires_clarification),
      clarification_candidate_ids: normalizeArray(decisionPreparation.clarification_candidate_ids),
      risk_level: riskLevel,
    },
    uncertainty: {
      level: uncertainty.level || decisionPreparation.uncertainty_level || null,
      requires_clarification: Boolean(uncertainty.requires_clarification),
    },
    readiness,
    arbitration_metadata: {
      decision_input_contract: decisionInput.contract || null,
      strongest_candidate_id: strongestCandidate.id || null,
      strongest_candidate_score: strongestCandidate.score ?? decisionPreparation.strongest_candidate_score ?? null,
      strongest_candidate_confidence: strongestCandidate.confidence ?? null,
      strategy_count: reasoningMetadata.strategy_count ?? normalizeArray(decisionInput.strategies).length,
      ranked_strategy_count: normalizeArray(decisionInput.ranked_strategies).length,
      principle: decisionPreparation.principle || null,
      profile_version: 'decision-profile-v1',
    },
    generated_at: new Date().toISOString(),
  };
}

function summarizeDecisionProfile(decisionProfile) {
  const safeProfile = normalizeObject(decisionProfile);
  const cognitiveCost = normalizeObject(safeProfile.cognitive_cost);

  return {
    contract: safeProfile.contract || 'decision-profile-v1',
    available: Boolean(safeProfile.available),
    cognitive_need: safeProfile.cognitive_need || 'unknown',
    cognitive_cost_level: cognitiveCost.level ?? null,
    cognitive_cost_label: cognitiveCost.label || 'unknown',
    cognitive_cost_max_allowed_level: cognitiveCost.max_allowed_level ?? null,
    cognitive_cost_forbidden_operations: normalizeArray(cognitiveCost.forbidden_operations),
    expected_benefit: safeProfile.expected_benefit || 'unknown',
    readiness: safeProfile.readiness || 'unknown',
    uncertainty_level: safeProfile.uncertainty?.level || null,
    requires_clarification: Boolean(safeProfile.uncertainty?.requires_clarification),
    strongest_candidate_id: safeProfile.arbitration_metadata?.strongest_candidate_id || null,
    strategy_count: safeProfile.arbitration_metadata?.strategy_count ?? null,
  };
}

function buildDecisionConstraints(decisionProfile = {}) {
  // Decision Constraints V1
  // Responsabilité : traduire le DecisionProfile en contraintes décisionnelles explicites.
  // Le contrat est informatif en V1 : il ne modifie pas encore le score ni le choix final.
  const safeProfile = normalizeObject(decisionProfile);
  const cognitiveCost = normalizeObject(safeProfile.cognitive_cost);
  const situationConstraints = normalizeObject(safeProfile.situation_constraints);
  const uncertainty = normalizeObject(safeProfile.uncertainty);
  const forbiddenOperations = normalizeArray(cognitiveCost.forbidden_operations);
  const allowedOperations = normalizeArray(cognitiveCost.allowed_operations);
  const maxCognitiveCost = normalizeCognitiveCostLevel(
    cognitiveCost.max_allowed_level ?? cognitiveCost.level,
    7
  );
  const forbiddenText = forbiddenOperations.join(' ').toLowerCase();
  const cognitiveCostSource = normalizeText(cognitiveCost.source || '').toLowerCase();
  const cognitiveCostLabel = normalizeText(cognitiveCost.label || '').toLowerCase();
  const cognitiveNeed = normalizeText(safeProfile.cognitive_need || '').toLowerCase();
  const isBrainDumpConstraint = Boolean(
    cognitiveCostSource.includes('brain_dump') ||
    cognitiveNeed.includes('brain_dump') ||
    cognitiveCostLabel === 'externalisation_only' ||
    maxCognitiveCost <= 1 ||
    includesAnyText(forbiddenText, [
      'demander de choisir',
      'demander de prioriser',
      'demander de comparer',
      'demander par quoi commencer',
      'demander la première chose',
      'demander la premiere chose',
    ])
  );

  const allowSelection = !isBrainDumpConstraint && !includesAnyText(forbiddenText, [
    'choisir',
    'sélection',
    'selection',
  ]);
  const allowPrioritization = !isBrainDumpConstraint && !includesAnyText(forbiddenText, [
    'prioriser',
    'priorité',
    'priorite',
    'urgent',
  ]);
  const allowComparison = !isBrainDumpConstraint && !includesAnyText(forbiddenText, [
    'comparer',
    'comparaison',
  ]);
  const requiresClarification = Boolean(
    uncertainty.requires_clarification ||
    situationConstraints.requires_clarification ||
    normalizeArray(situationConstraints.clarification_candidate_ids).length > 0
  );

  return {
    contract: 'decision-constraints-v1',
    source: 'decision_profile',
    behavior_impact: 'none',
    available: Boolean(safeProfile.available || Object.keys(cognitiveCost).length > 0),
    allow_selection: allowSelection,
    allow_prioritization: allowPrioritization,
    allow_comparison: allowComparison,
    max_cognitive_cost: isBrainDumpConstraint ? 1 : maxCognitiveCost,
    requires_clarification: requiresClarification,
    allowed_operations: allowedOperations,
    forbidden_operations: forbiddenOperations,
    reason: isBrainDumpConstraint
      ? 'brain_dump_or_low_cognitive_cost_constraint'
      : requiresClarification
        ? 'clarification_required'
        : 'default_constraints',
    constraint_flags: {
      is_brain_dump_constraint: isBrainDumpConstraint,
      has_forbidden_operations: forbiddenOperations.length > 0,
      has_allowed_operations: allowedOperations.length > 0,
      has_cost_limit: cognitiveCost.max_allowed_level !== undefined,
    },
    generated_at: new Date().toISOString(),
  };
}

function summarizeDecisionConstraints(decisionConstraints) {
  const safeConstraints = normalizeObject(decisionConstraints);

  return {
    contract: safeConstraints.contract || 'decision-constraints-v1',
    available: Boolean(safeConstraints.available),
    allow_selection: safeConstraints.allow_selection !== false,
    allow_prioritization: safeConstraints.allow_prioritization !== false,
    allow_comparison: safeConstraints.allow_comparison !== false,
    max_cognitive_cost: safeConstraints.max_cognitive_cost ?? null,
    requires_clarification: Boolean(safeConstraints.requires_clarification),
    reason: safeConstraints.reason || null,
    forbidden_operation_count: normalizeArray(safeConstraints.forbidden_operations).length,
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
  const decisionProfile = buildDecisionProfile(candidateDecision, cognitiveContext, decisionInput);
  const decisionConstraints = buildDecisionConstraints(decisionProfile);
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

  const cognitiveCost = normalizeObject(decisionProfile.cognitive_cost);
  const cognitiveCostLevel = normalizeCognitiveCostLevel(cognitiveCost.level, 3);

  if (cognitiveCostLevel <= 1) {
    score += 6;
    factors.push({ id: 'low_cognitive_cost', impact: 6, label: 'La stratégie demande très peu d’effort mental à l’utilisateur.' });
  } else if (cognitiveCostLevel >= 5) {
    score -= 6;
    factors.push({ id: 'high_cognitive_cost', impact: -6, label: 'La stratégie demande un effort cognitif élevé à l’utilisateur.' });
  }

  if (cognitiveCost.max_allowed_level !== undefined && cognitiveCostLevel > cognitiveCost.max_allowed_level) {
    score -= 12;
    factors.push({ id: 'cognitive_cost_limit_exceeded', impact: -12, label: 'La stratégie dépasse le coût cognitif maximal autorisé par le profil décisionnel.' });
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
    decision_profile_summary: summarizeDecisionProfile(decisionProfile),
    decision_constraints_summary: summarizeDecisionConstraints(decisionConstraints),
    scoring_version: 'decision-score-v1.6',
    generated_at: new Date().toISOString(),
  };
}

function attachDecisionScore(candidateDecision, cognitiveContext = {}) {
  if (!candidateDecision || typeof candidateDecision !== 'object') {
    return null;
  }

  const decisionInput = buildDecisionInput(candidateDecision, cognitiveContext);
  const decisionProfile = buildDecisionProfile(candidateDecision, cognitiveContext, decisionInput);
  const decisionConstraints = buildDecisionConstraints(decisionProfile);
  const decisionScore = computeDecisionScore(candidateDecision, cognitiveContext);

  return {
    ...candidateDecision,
    decision_input: decisionInput,
    decision_profile: decisionProfile,
    decision_constraints: decisionConstraints,
    decision_score: decisionScore,
    selection_metadata: {
      scoring_available: true,
      scoring_version: decisionScore.scoring_version,
      decision_input_available: Boolean(decisionInput.available),
      decision_input_contract: decisionInput.contract,
      decision_profile_available: Boolean(decisionProfile.available),
      decision_profile_contract: decisionProfile.contract,
      decision_constraints_available: Boolean(decisionConstraints.available),
      decision_constraints_contract: decisionConstraints.contract,
      behavior_impact: 'none',
      note: 'Contrats DecisionInput, DecisionProfile, DecisionConstraints et score calculés sans modifier la stratégie de sélection V1.',
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


function buildDecisionSelector(scoredCandidates = []) {
  // Decision Selector V1
  // Responsabilité : produire une trace explicite de sélection sans piloter
  // encore le choix final. En V1, chooseBestDecision conserve le comportement
  // validé : première décision candidate valide.
  const candidates = normalizeCandidateDecisionList(scoredCandidates);
  const selectionTrace = candidates.map((candidateDecision, index) => {
    const decisionConstraints = normalizeObject(candidateDecision.decision_constraints);
    const decisionScore = normalizeObject(candidateDecision.decision_score);
    const score = normalizeNumber(decisionScore.score, 0);
    const shouldExecute = candidateDecision.should_execute !== false;
    const requiresClarification = Boolean(decisionConstraints.requires_clarification);
    const maxCognitiveCost = normalizeCognitiveCostLevel(decisionConstraints.max_cognitive_cost, 7);
    const cognitiveCostLevel = normalizeCognitiveCostLevel(
      candidateDecision.decision_profile?.cognitive_cost?.level,
      3
    );
    const exceedsCognitiveCost = cognitiveCostLevel > maxCognitiveCost;
    const eligible = Boolean(
      shouldExecute &&
      !requiresClarification &&
      !exceedsCognitiveCost
    );

    const rejectionReasons = [];

    if (!shouldExecute) rejectionReasons.push('should_execute_false');
    if (requiresClarification) rejectionReasons.push('requires_clarification');
    if (exceedsCognitiveCost) rejectionReasons.push('cognitive_cost_exceeded');

    return {
      candidate_id: candidateDecision.id || null,
      index,
      decision_type: candidateDecision.decision_type || null,
      should_execute: shouldExecute,
      score,
      score_level: decisionScore.level || null,
      eligible,
      rejection_reasons: rejectionReasons,
      constraints: {
        allow_selection: decisionConstraints.allow_selection ?? null,
        allow_prioritization: decisionConstraints.allow_prioritization ?? null,
        allow_comparison: decisionConstraints.allow_comparison ?? null,
        max_cognitive_cost: maxCognitiveCost,
        requires_clarification: requiresClarification,
        reason: decisionConstraints.reason || null,
      },
    };
  });

  const eligibleTraces = selectionTrace.filter(trace => trace.eligible);
  const informativeSelectedTrace = [...eligibleTraces]
    .sort((a, b) => b.score - a.score)[0] || selectionTrace[0] || null;
  const legacySelectedTrace = selectionTrace[0] || null;

  return {
    contract: 'decision-selector-v1',
    source: 'nyra_decision_engine',
    behavior_impact: 'none',
    mode: 'informative_only',
    evaluated_candidates: candidates.length,
    eligible_candidates: eligibleTraces.length,
    rejected_candidates: Math.max(0, selectionTrace.length - eligibleTraces.length),
    selected_candidate_id: informativeSelectedTrace?.candidate_id || null,
    legacy_selected_candidate_id: legacySelectedTrace?.candidate_id || null,
    selection_strategy: 'informative_best_eligible_score',
    runtime_selection_strategy: 'first_valid_candidate_preserved',
    selection_reason: informativeSelectedTrace
      ? 'Sélecteur informatif : meilleure candidate éligible selon le score, sans impact sur le choix runtime.'
      : 'Aucune candidate disponible pour la sélection informative.',
    selection_trace: selectionTrace,
    generated_at: new Date().toISOString(),
  };
}

function summarizeDecisionSelector(decisionSelector) {
  const safeSelector = normalizeObject(decisionSelector);

  return {
    contract: safeSelector.contract || 'decision-selector-v1',
    mode: safeSelector.mode || 'informative_only',
    evaluated_candidates: safeSelector.evaluated_candidates ?? 0,
    eligible_candidates: safeSelector.eligible_candidates ?? 0,
    rejected_candidates: safeSelector.rejected_candidates ?? 0,
    selected_candidate_id: safeSelector.selected_candidate_id || null,
    legacy_selected_candidate_id: safeSelector.legacy_selected_candidate_id || null,
    runtime_selection_strategy: safeSelector.runtime_selection_strategy || null,
  };
}

function chooseBestDecision(candidateDecisions, cognitiveContext = {}) {
  // Nyra Decision Engine V1.7
  // Responsabilité : enrichir les décisions candidates avec DecisionInput,
  // DecisionProfile, DecisionConstraints, DecisionScore et DecisionSelector.
  // Important : le DecisionSelector est informatif ; le choix runtime conserve
  // le comportement validé en V1 : première décision candidate valide.
  const candidates = normalizeCandidateDecisionList(candidateDecisions);
  const scoredCandidates = candidates.map(candidateDecision => {
    return attachDecisionScore(candidateDecision, cognitiveContext);
  }).filter(Boolean);
  const decisionSelector = buildDecisionSelector(scoredCandidates);
  const chosenDecision = scoredCandidates[0] || null;

  if (!chosenDecision) {
    return {
      id: crypto.randomUUID(),
      source: 'chat',
      decision_layer: 'nyra_decision_engine_v1_7',
      decision_type: 'no_action',
      should_execute: false,
      candidate_action: null,
      normalized_decision: null,
      candidate_count: 0,
      scored_candidate_count: 0,
      decision_selector: decisionSelector,
      decision_selector_summary: summarizeDecisionSelector(decisionSelector),
      selection_strategy: 'first_valid_candidate_with_decision_selector_trace',
      selection_reason: 'Aucune décision candidate disponible.',
      selection_metadata: {
        scoring_available: true,
        decision_selector_available: true,
        decision_selector_contract: decisionSelector.contract,
        behavior_impact: 'none',
        note: 'Aucun score utile sans décision candidate. DecisionSelector produit uniquement une trace informative.',
      },
      cognitive_context: cognitiveContext || {},
      created_at: new Date().toISOString(),
    };
  }

  return {
    ...chosenDecision,
    decision_layer: 'nyra_decision_engine_v1_7',
    candidate_count: candidates.length,
    scored_candidate_count: scoredCandidates.length,
    decision_selector: decisionSelector,
    decision_selector_summary: summarizeDecisionSelector(decisionSelector),
    scored_candidates: scoredCandidates.map(candidateDecision => ({
      id: candidateDecision.id || null,
      decision_type: candidateDecision.decision_type || null,
      should_execute: Boolean(candidateDecision.should_execute),
      score: candidateDecision.decision_score?.score ?? null,
      level: candidateDecision.decision_score?.level || null,
      decision_input_available: Boolean(candidateDecision.decision_input?.available),
      strongest_candidate_id: candidateDecision.decision_input?.strongest_candidate?.id || null,
      decision_profile_available: Boolean(candidateDecision.decision_profile?.available),
      cognitive_need: candidateDecision.decision_profile?.cognitive_need || null,
      cognitive_cost_level: candidateDecision.decision_profile?.cognitive_cost?.level ?? null,
      cognitive_cost_label: candidateDecision.decision_profile?.cognitive_cost?.label || null,
      decision_constraints_available: Boolean(candidateDecision.decision_constraints?.available),
      max_cognitive_cost: candidateDecision.decision_constraints?.max_cognitive_cost ?? null,
      allow_selection: candidateDecision.decision_constraints?.allow_selection ?? null,
    })),
    selection_strategy: 'first_valid_candidate_with_decision_selector_trace',
    selection_reason: 'Comportement V1 conservé : la première décision candidate valide est choisie. Le DecisionSelector V1 produit seulement une trace informative en V1.7.',
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
  buildDecisionProfile,
  buildCognitiveCostProfile,
  buildDecisionConstraints,
  buildDecisionSelector,
};
