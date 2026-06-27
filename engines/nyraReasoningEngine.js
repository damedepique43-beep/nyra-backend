const { buildEngineResult } = require('./nyraEngineResultContract');
const { detectDirectiveFromUnderstanding } = require('./reasoning/nyraDirectiveDetector');
const {
  evaluateHypotheses,
  buildHypothesisReasoningState,
  getHypothesisByType,
  isUsableHypothesis,
  summarizeHypothesisEvaluations,
} = require('./reasoning/nyraHypothesisEvaluator');
const {
  buildExternalizeActionStrategy,
  buildCreateProjectStrategy,
  buildProjectClarificationStrategy,
  buildFuturePromptStrategy,
  buildCollectionStrategy,
  buildRegulationStrategy,
  buildPreserveThoughtStrategy,
  buildContextCaptureStrategy,
  buildClarifyUnderstandingStrategy,
  buildBrainDumpStrategy,
} = require('./reasoning/nyraStrategyBuilder');
const {
  buildSituationProfile,
  selectCognitiveIntervention,
} = require('./reasoning/nyraSituationProfiler');
const {
  enrichWithAlternativeStrategies,
} = require('./reasoning/nyraAlternativeStrategyAnalyzer');
const {
  enrichStrategyForDecisionPreparation,
  buildRankedStrategyReferences,
  summarizeCognitiveNeeds,
  buildDecisionPreparation,
  getCognitiveContextSummary,
} = require('./reasoning/nyraStrategyEvaluator');

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
  const hypothesisReasoningState = buildHypothesisReasoningState(evaluatedHypotheses);
  const provisionalBasis = {
    primary_intent: primaryIntent,
    confidence,
    temporal_scope: temporalScope,
    emotional_intensity: emotionalIntensity,
    observations: layers.observations,
    facts: layers.facts,
    hypotheses: evaluatedHypotheses,
    active_hypotheses: hypothesisReasoningState.active_hypotheses,
    rejected_hypotheses: hypothesisReasoningState.rejected_hypotheses,
    competing_hypotheses: hypothesisReasoningState.competing_hypotheses,
    has_competing_hypotheses: hypothesisReasoningState.has_competing_hypotheses,
    has_active_hypotheses: hypothesisReasoningState.has_active_hypotheses,
    raw_hypotheses: layers.hypotheses,
    observation_types: getLayerTypes(layers.observations),
    fact_types: getLayerTypes(layers.facts),
    hypothesis_types: getLayerTypes(evaluatedHypotheses),
    has_cognitive_layers: layers.observations.length > 0 || layers.facts.length > 0 || layers.hypotheses.length > 0,
  };
  const directiveDetection = detectDirectiveFromUnderstanding(understanding);
  const situationProfile = buildSituationProfile({
    understanding,
    basis: provisionalBasis,
    directiveDetection,
  });
  const cognitiveIntervention = selectCognitiveIntervention({
    profile: situationProfile,
    basis: provisionalBasis,
    directiveDetection,
  });

  return {
    ...provisionalBasis,
    domain: situationProfile.domain,
    cognitive_state: situationProfile.cognitive_state,
    dominant_cognitive_need: situationProfile.dominant_need,
    directive_detection: directiveDetection,
    situation_profile: situationProfile,
    cognitive_intervention: cognitiveIntervention,
    confidence,
    temporal_scope: temporalScope,
    emotional_intensity: emotionalIntensity,
    observations: layers.observations,
    facts: layers.facts,
    hypotheses: evaluatedHypotheses,
    active_hypotheses: hypothesisReasoningState.active_hypotheses,
    rejected_hypotheses: hypothesisReasoningState.rejected_hypotheses,
    competing_hypotheses: hypothesisReasoningState.competing_hypotheses,
    has_competing_hypotheses: hypothesisReasoningState.has_competing_hypotheses,
    has_active_hypotheses: hypothesisReasoningState.has_active_hypotheses,
    raw_hypotheses: layers.hypotheses,
    observation_types: getLayerTypes(layers.observations),
    fact_types: getLayerTypes(layers.facts),
    hypothesis_types: getLayerTypes(evaluatedHypotheses),
    has_cognitive_layers: layers.observations.length > 0 || layers.facts.length > 0 || layers.hypotheses.length > 0,
  };
}

function addStrategyOnce(strategies, strategy) {
  if (!strategy?.id) return;
  const exists = strategies.some(existingStrategy => existingStrategy.id === strategy.id);
  if (!exists) strategies.push(strategy);
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
  const directive = normalizeObject(basis.directive_detection);
  const requestedAction = normalizeText(directive.requested_action || '');

  if (requestedAction === 'create_project') {
    addStrategyOnce(strategies, buildCreateProjectStrategy({ basis }));
    return strategies;
  }

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

  if (profile.should_clarify_project) {
    addStrategyOnce(strategies, buildProjectClarificationStrategy({
      basis,
      hypothesis: projectOrIdeaHypothesis,
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
  const directive = normalizeObject(basis.directive_detection);
  const requestedAction = normalizeText(directive.requested_action || '');

  if (requestedAction === 'create_project') {
    addStrategyOnce(strategies, buildCreateProjectStrategy({ basis }));
    return strategies;
  }

  if (intervention.id === 'brain_dump') {
    addStrategyOnce(strategies, buildBrainDumpStrategy({ basis }));
  }

  if (profile.should_clarify_first) {
    addStrategyOnce(strategies, buildClarifyUnderstandingStrategy({ basis }));
  }

  if (profile.should_regulate) {
    addStrategyOnce(strategies, buildRegulationStrategy({ basis }));
  }

  if (profile.should_clarify_project) {
    addStrategyOnce(strategies, buildProjectClarificationStrategy({ basis }));
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

function getCognitiveContext(context = {}) {
  const safeContext = normalizeObject(context);
  const directContext = normalizeObject(safeContext.cognitive_context);

  if (Object.keys(directContext).length > 0) return directContext;

  const sharedContext = normalizeObject(safeContext.shared_context);
  const sharedCognitiveContext = normalizeObject(sharedContext.cognitive_context);

  if (Object.keys(sharedCognitiveContext).length > 0) return sharedCognitiveContext;

  return {};
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
        internal_analyzers: ['hypothesis_evaluator_v2', 'hypothesis_arbitration_v1', 'directive_detection_v1', 'situation_profile_v1', 'cognitive_intervention_selector_v1', 'project_clarification_strategy_v1', 'cognitive_layer_strategy_generator_v1', 'alternative_strategy_analyzer_v1', 'cognitive_need_strategy_annotation_v1', 'strategy_evaluator_v1', 'cognitive_questions_v1'],
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
