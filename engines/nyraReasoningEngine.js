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

function uniqueArray(value) {
  return [...new Set(normalizeArray(value))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function buildCognitiveNeed({ primary, label, confidence = 0.72, source = 'strategy_builder', rationale = '' } = {}) {
  const normalizedPrimary = normalizeCognitiveNeed(primary);

  const defaultLabels = {
    reduce_cognitive_load: 'Réduire la charge cognitive',
    prevent_forgetting: 'Prévenir l’oubli',
    clarify_uncertainty: 'Clarifier l’incertitude',
    support_regulation: 'Soutenir la régulation',
    preserve_context: 'Préserver le contexte',
    structure_idea: 'Structurer une idée',
    organize_information: 'Organiser une information',
    prepare_action: 'Préparer une action',
    capture_without_action: 'Capturer sans action immédiate',
  };

  return {
    primary: normalizedPrimary,
    label: normalizeText(label || defaultLabels[normalizedPrimary] || defaultLabels.preserve_context),
    confidence: clamp01(confidence, 0.72),
    source: normalizeText(source || 'strategy_builder'),
    rationale: normalizeText(rationale || 'Besoin cognitif associé à cette stratégie.'),
  };
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

function calculateAdjustedHypothesisConfidence({ confidence, supportLevel, contradicted }) {
  if (contradicted) return Math.max(0, Math.round((confidence * 0.35) * 1000) / 1000);

  const supportAdjustments = {
    high: 0.12,
    medium: 0.06,
    low: -0.02,
    none: -0.18,
    unknown: -0.08,
  };

  return Math.round(clamp01(confidence + (supportAdjustments[supportLevel] ?? -0.08), confidence) * 1000) / 1000;
}

function explainHypothesisEvaluation({ hypothesis, supportLevel, contradicted, adjustedConfidence, evaluationStatus }) {
  const explanations = [];
  const type = normalizeText(hypothesis?.type || 'hypothesis');

  if (contradicted) {
    explanations.push(`Hypothèse ${type} mise de côté car contredite par les faits disponibles.`);
  } else if (supportLevel === 'high' || supportLevel === 'medium') {
    explanations.push(`Hypothèse ${type} renforcée par un support factuel ${supportLevel}.`);
  } else if (supportLevel === 'low') {
    explanations.push(`Hypothèse ${type} conservée mais avec support factuel faible.`);
  } else if (supportLevel === 'none') {
    explanations.push(`Hypothèse ${type} affaiblie car aucun fait référencé ne la soutient.`);
  } else {
    explanations.push(`Hypothèse ${type} conservée avec support factuel non vérifié.`);
  }

  explanations.push(`Statut ${evaluationStatus}, confiance ajustée ${adjustedConfidence}.`);

  return explanations;
}

function evaluateHypotheses({ hypotheses = [], facts = [] } = {}) {
  return normalizeArray(hypotheses).map(hypothesis => {
    const safeHypothesis = normalizeObject(hypothesis);
    const confidence = clamp01(safeHypothesis.confidence, 0.5);
    const supportLevel = getSupportLevel({ hypothesis: safeHypothesis, facts });
    const contradicted = detectHypothesisContradiction({ hypothesis: safeHypothesis, facts });
    const adjustedConfidence = calculateAdjustedHypothesisConfidence({
      confidence,
      supportLevel,
      contradicted,
    });
    const evaluationStatus = classifyHypothesis({
      hypothesis: { ...safeHypothesis, confidence: adjustedConfidence },
      facts,
    });
    const requiresVerification = ['weak', 'provisional', 'needs_verification', 'contradicted'].includes(evaluationStatus);

    return {
      ...safeHypothesis,
      evaluation: {
        status: evaluationStatus,
        original_confidence: confidence,
        confidence: adjustedConfidence,
        support_level: supportLevel,
        contradicted,
        requires_verification: requiresVerification,
        based_on_fact_count: normalizeArray(safeHypothesis.based_on_facts).length,
        reasoning_notes: explainHypothesisEvaluation({
          hypothesis: safeHypothesis,
          supportLevel,
          contradicted,
          adjustedConfidence,
          evaluationStatus,
        }),
      },
    };
  });
}

function getHypothesisWeight(hypothesis) {
  const status = normalizeText(hypothesis?.evaluation?.status || 'provisional');
  const confidence = clamp01(hypothesis?.evaluation?.confidence ?? hypothesis?.confidence, 0.5);

  const statusWeights = {
    strong: 1,
    plausible: 0.82,
    provisional: 0.58,
    needs_verification: 0.38,
    weak: 0.18,
    contradicted: 0,
  };

  return Math.round((confidence * (statusWeights[status] ?? 0.45)) * 1000) / 1000;
}

function groupHypothesesByType(hypotheses = []) {
  return normalizeArray(hypotheses).reduce((groups, hypothesis) => {
    const type = normalizeText(hypothesis?.type || 'unknown') || 'unknown';
    if (!groups[type]) groups[type] = [];
    groups[type].push(hypothesis);
    return groups;
  }, {});
}

function buildHypothesisReasoningState(hypotheses = []) {
  const groups = groupHypothesesByType(hypotheses);
  const activeHypotheses = [];
  const rejectedHypotheses = [];
  const competingHypotheses = [];

  Object.entries(groups).forEach(([type, typedHypotheses]) => {
    const sortedHypotheses = [...typedHypotheses].sort((a, b) => getHypothesisWeight(b) - getHypothesisWeight(a));
    const usableHypotheses = sortedHypotheses.filter(isUsableHypothesis);
    const bestHypothesis = usableHypotheses[0] || null;

    if (bestHypothesis) {
      activeHypotheses.push(bestHypothesis);
    }

    sortedHypotheses.forEach((hypothesis, index) => {
      const status = normalizeText(hypothesis?.evaluation?.status || 'provisional');
      const hypothesisId = hypothesis?.id || null;

      if (status === 'contradicted' || status === 'weak') {
        rejectedHypotheses.push({
          id: hypothesisId,
          type,
          status,
          reason: status === 'contradicted'
            ? 'contradicted_by_available_facts'
            : 'insufficient_support_or_confidence',
        });
        return;
      }

      if (index > 0 && bestHypothesis) {
        const weightGap = getHypothesisWeight(bestHypothesis) - getHypothesisWeight(hypothesis);
        if (weightGap < 0.18) {
          competingHypotheses.push({
            type,
            primary_hypothesis_id: bestHypothesis.id || null,
            competing_hypothesis_id: hypothesisId,
            weight_gap: Math.round(weightGap * 1000) / 1000,
          });
        }
      }
    });
  });

  return {
    active_hypotheses: activeHypotheses,
    rejected_hypotheses: rejectedHypotheses,
    competing_hypotheses: competingHypotheses,
    has_competing_hypotheses: competingHypotheses.length > 0,
    has_active_hypotheses: activeHypotheses.length > 0,
  };
}


function getUnderstandingDomain(understanding = {}) {
  const intent = normalizeObject(understanding.intent);
  const directDomain = normalizeText(
    understanding.domain ||
    understanding.cognitive_domain ||
    intent.domain ||
    intent.cognitive_domain ||
    ''
  )
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (directDomain) return directDomain;

  const primaryIntent = getPrimaryIntent(understanding);
  const intentDomainMap = {
    create_task: 'task',
    create_reminder: 'task',
    add_to_collection: 'collection',
    capture_idea: 'idea',
    project_thought: 'project',
    reflect_emotion: 'emotion',
    capture_note: 'context',
  };

  return intentDomainMap[primaryIntent] || 'context';
}

function inferCognitiveStateFromText(text = '') {
  const lower = normalizeText(text).toLowerCase();

  if (!lower) return 'neutral';

  if (includesAny(lower, [
    'je ne sais pas par quoi commencer',
    'je sais pas par quoi commencer',
    'je ne sais plus par quoi commencer',
    'je sais plus par quoi commencer',
    'je ne sais pas par où commencer',
    'je sais pas par ou commencer',
    'je ne sais plus par où commencer',
    'je sais plus par ou commencer',
    'trop de choses',
    'trop de trucs',
    'plein de choses à faire',
    'plein de choses a faire',
    'dix trucs à faire',
    '10 trucs à faire',
    'je suis perdue',
    'je suis perdu',
    'je suis débordée',
    'je suis debordee',
    'je suis débordé',
    'je suis deborde',
    'submergée',
    'submergee',
    'charge mentale',
    'surcharge',
  ])) {
    return 'overwhelmed';
  }

  if (includesAny(lower, [
    'ne pas oublier',
    'peur d oublier',
    "peur d'oublier",
    'j ai peur d oublier',
    "j'ai peur d'oublier",
    'il faut que je pense à',
    'il faut que je pense a',
    'pense à',
    'penser à',
  ])) {
    return 'prevent_forgetting';
  }

  if (includesAny(lower, [
    'je me sens',
    'angoisse',
    'stress',
    'panique',
    'triste',
    'peur',
    'mal',
    'épuisée',
    'epuisee',
    'fatiguée',
    'fatiguee',
  ])) {
    return 'emotional_overload';
  }

  if (includesAny(lower, [
    'planifier',
    'organiser',
    'préparer',
    'preparer',
    'étape par étape',
    'etape par etape',
  ])) {
    return 'planning';
  }

  return 'neutral';
}

function normalizeCognitiveStateValue(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getUnderstandingCognitiveState(understanding = {}) {
  const intent = normalizeObject(understanding.intent);
  const metadata = normalizeObject(understanding.metadata);
  const cognitiveStateObject = normalizeObject(understanding.cognitive_state);
  const intentCognitiveStateObject = normalizeObject(intent.cognitive_state);
  const metadataCognitiveStateObject = normalizeObject(metadata.cognitive_state);

  const directState = normalizeCognitiveStateValue(
    cognitiveStateObject.primary ||
    cognitiveStateObject.value ||
    cognitiveStateObject.state ||
    understanding.primary_cognitive_state ||
    understanding.task_state ||
    intentCognitiveStateObject.primary ||
    intentCognitiveStateObject.value ||
    intentCognitiveStateObject.state ||
    intent.cognitive_state ||
    intent.task_state ||
    metadataCognitiveStateObject.primary ||
    metadataCognitiveStateObject.value ||
    metadataCognitiveStateObject.state ||
    metadata.cognitive_state ||
    ''
  );

  if (directState) return directState;

  const stateFromFacts = normalizeArray(understanding.facts).find(fact => {
    return ['cognitive_state_fact', 'task_state_fact'].includes(normalizeText(fact?.type));
  });

  const factCognitiveState = normalizeObject(stateFromFacts?.metadata?.cognitive_state);

  if (stateFromFacts?.metadata?.cognitive_state) {
    const factState = normalizeCognitiveStateValue(
      factCognitiveState.primary ||
      factCognitiveState.value ||
      factCognitiveState.state ||
      stateFromFacts.metadata.cognitive_state
    );

    if (factState) return factState;
  }

  return inferCognitiveStateFromText(understanding.raw_text || understanding.text || '');
}

function buildSituationProfile({ understanding = {}, basis = {} } = {}) {
  const domain = getUnderstandingDomain(understanding);
  const cognitiveState = getUnderstandingCognitiveState(understanding);
  const primaryIntent = normalizeText(basis.primary_intent || getPrimaryIntent(understanding));
  const hasTemporalNeed = basis.temporal_scope && basis.temporal_scope !== 'unspecified';
  const hasEmotion = basis.emotional_intensity && basis.emotional_intensity !== 'none';
  const hasUncertainty = Boolean(
    basis.has_competing_hypotheses ||
    normalizeArray(basis.rejected_hypotheses).length > 0 ||
    normalizeArray(basis.hypotheses).some(hypothesis => {
      return ['weak', 'contradicted', 'needs_verification'].includes(normalizeText(hypothesis?.evaluation?.status));
    })
  );

  const overloadedStates = ['overwhelmed', 'cognitive_overload', 'overload', 'surcharge', 'task_overload'];
  const forgettingStates = ['prevent_forgetting', 'forgetting_risk', 'memory_support', 'remember_later'];
  const planningStates = ['planning', 'action_ready', 'execution_ready', 'ready_to_act', 'simple_task'];
  const emotionalStates = ['emotional_overload', 'reflection', 'regulation', 'distress'];

  const isOverloaded = overloadedStates.includes(cognitiveState);
  const isForgettingRisk = forgettingStates.includes(cognitiveState);
  const isPlanning = planningStates.includes(cognitiveState);
  const isEmotional = emotionalStates.includes(cognitiveState) || hasEmotion;

  let dominantNeed = 'preserve_context';

  if (isOverloaded) dominantNeed = 'reduce_cognitive_load';
  else if (isForgettingRisk || primaryIntent === 'create_reminder') dominantNeed = 'prevent_forgetting';
  else if (isEmotional) dominantNeed = 'support_regulation';
  else if (hasUncertainty) dominantNeed = 'clarify_uncertainty';
  else if (domain === 'idea' || domain === 'project') dominantNeed = 'structure_idea';
  else if (domain === 'collection') dominantNeed = 'organize_information';
  else if (domain === 'task' || primaryIntent === 'create_task') dominantNeed = 'prepare_action';

  const shouldClarifyFirst = Boolean(
    isOverloaded ||
    hasUncertainty ||
    cognitiveState === 'clarification_needed' ||
    cognitiveState === 'uncertain'
  );

  return {
    version: 'situation-profile-v1',
    domain,
    cognitive_state: cognitiveState,
    primary_intent: primaryIntent,
    dominant_need: dominantNeed,
    uncertainty_level: hasUncertainty || shouldClarifyFirst ? 'medium' : 'low',
    should_clarify_first: shouldClarifyFirst,
    should_externalize: Boolean(!isOverloaded && !isEmotional && (isPlanning || primaryIntent === 'create_task')),
    should_prepare_reminder: Boolean(isForgettingRisk || primaryIntent === 'create_reminder' || (hasTemporalNeed && primaryIntent === 'create_task')),
    should_regulate: Boolean(isEmotional || isOverloaded),
    should_preserve_context: Boolean(domain === 'idea' || domain === 'project' || primaryIntent === 'capture_note'),
    should_organize_information: Boolean(domain === 'collection' || primaryIntent === 'add_to_collection'),
    should_defer_action_creation: Boolean(isOverloaded || isEmotional || shouldClarifyFirst),
    rationale: isOverloaded
      ? 'La situation ressemble à une surcharge : clarifier et réduire la charge avant de créer une action.'
      : isForgettingRisk
        ? 'La situation ressemble à un risque d’oubli : préparer un soutien futur.'
        : isEmotional
          ? 'La situation contient un besoin de régulation ou de réflexion avant l’action.'
          : 'Profil cognitif construit à partir du domaine, de l’état cognitif, des hypothèses et des signaux disponibles.',
  };
}


function normalizeCognitiveInterventionId(value, fallback = 'none') {
  const normalized = normalizeText(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const allowedInterventions = [
    'brain_dump',
    'secure_capture',
    'progressive_clarification',
    'emotional_regulation',
    'structured_execution',
    'context_preservation',
    'none',
  ];

  if (allowedInterventions.includes(normalized)) return normalized;
  return fallback;
}

function buildCognitiveIntervention({
  id,
  label,
  goal,
  confidence = 0.72,
  conversationStyle = 'standard_support',
  recommendedBuilders = [],
  nextPromptGoal = '',
  rationale = '',
} = {}) {
  const interventionId = normalizeCognitiveInterventionId(id);

  const defaultLabels = {
    brain_dump: 'Brain Dump guidé',
    secure_capture: 'Capture sécurisée',
    progressive_clarification: 'Clarification progressive',
    emotional_regulation: 'Régulation cognitive et émotionnelle',
    structured_execution: 'Exécution structurée',
    context_preservation: 'Préservation du contexte',
    none: 'Aucune intervention spécialisée',
  };

  return {
    id: interventionId,
    label: normalizeText(label || defaultLabels[interventionId] || defaultLabels.none),
    goal: normalizeCognitiveNeed(goal || 'preserve_context'),
    confidence: clamp01(confidence, 0.72),
    conversation_style: normalizeText(conversationStyle || 'standard_support'),
    recommended_builders: uniqueArray(normalizeArray(recommendedBuilders).map(item => normalizeText(item)).filter(Boolean)),
    next_prompt_goal: normalizeText(nextPromptGoal || ''),
    rationale: normalizeText(rationale || 'Intervention cognitive sélectionnée à partir du profil de situation.'),
  };
}

function selectCognitiveIntervention({ profile = {}, basis = {} } = {}) {
  // Cognitive Intervention Selector V1
  // Responsabilité : choisir une méthode d'accompagnement du fonctionnement mental
  // avant de choisir les stratégies techniques qui la mettront en œuvre.
  // Ce composant reste interne au Reasoning Engine et ne décide ni n'exécute.
  const safeProfile = normalizeObject(profile);
  const cognitiveState = normalizeText(safeProfile.cognitive_state || basis.cognitive_state || 'neutral');
  const dominantNeed = normalizeCognitiveNeed(safeProfile.dominant_need || basis.dominant_cognitive_need || 'preserve_context');

  if (dominantNeed === 'reduce_cognitive_load' || ['overwhelmed', 'cognitive_overload', 'overload', 'surcharge', 'task_overload'].includes(cognitiveState)) {
    return buildCognitiveIntervention({
      id: 'brain_dump',
      label: 'Brain Dump guidé',
      goal: 'reduce_cognitive_load',
      confidence: 0.88,
      conversationStyle: 'guided_dump',
      recommendedBuilders: ['guided_brain_dump', 'clarify_understanding'],
      nextPromptGoal: 'Inviter l’utilisateur à vider tout ce qu’il a en tête sans trier, puis organiser ensuite.',
      rationale: 'La surcharge cognitive demande d’abord de vider la mémoire de travail avant de prioriser ou de créer des tâches.',
    });
  }

  if (dominantNeed === 'prevent_forgetting' || safeProfile.should_prepare_reminder) {
    return buildCognitiveIntervention({
      id: 'secure_capture',
      label: 'Capture sécurisée',
      goal: 'prevent_forgetting',
      confidence: 0.84,
      conversationStyle: 'secure_capture',
      recommendedBuilders: ['schedule_future_prompt', 'externalize_action'],
      nextPromptGoal: 'Sécuriser l’information pour que l’utilisateur n’ait plus à la garder en tête.',
      rationale: 'Le risque d’oubli demande une capture fiable avant toute organisation plus fine.',
    });
  }

  if (dominantNeed === 'support_regulation' || safeProfile.should_regulate) {
    return buildCognitiveIntervention({
      id: 'emotional_regulation',
      label: 'Régulation cognitive et émotionnelle',
      goal: 'support_regulation',
      confidence: 0.82,
      conversationStyle: 'regulation_first',
      recommendedBuilders: ['support_regulation', 'clarify_understanding'],
      nextPromptGoal: 'Réduire la pression interne avant toute demande d’organisation ou d’exécution.',
      rationale: 'Une charge émotionnelle ou cognitive forte rend l’action directe moins adaptée.',
    });
  }

  if (dominantNeed === 'clarify_uncertainty' || safeProfile.should_clarify_first) {
    return buildCognitiveIntervention({
      id: 'progressive_clarification',
      label: 'Clarification progressive',
      goal: 'clarify_uncertainty',
      confidence: 0.78,
      conversationStyle: 'progressive_clarification',
      recommendedBuilders: ['clarify_understanding'],
      nextPromptGoal: 'Clarifier une seule information utile avant de choisir une action.',
      rationale: 'L’incertitude doit être réduite avant de transformer la pensée en action.',
    });
  }

  if (dominantNeed === 'prepare_action' || safeProfile.should_externalize) {
    return buildCognitiveIntervention({
      id: 'structured_execution',
      label: 'Exécution structurée',
      goal: 'prepare_action',
      confidence: 0.76,
      conversationStyle: 'action_preparation',
      recommendedBuilders: ['externalize_action'],
      nextPromptGoal: 'Transformer la pensée en action claire et supportable.',
      rationale: 'Le profil indique une action suffisamment claire pour être préparée.',
    });
  }

  return buildCognitiveIntervention({
    id: 'context_preservation',
    label: 'Préservation du contexte',
    goal: 'preserve_context',
    confidence: 0.68,
    conversationStyle: 'context_capture',
    recommendedBuilders: ['capture_for_context'],
    nextPromptGoal: 'Conserver l’information sans ajouter de pression opérationnelle.',
    rationale: 'Aucune intervention spécialisée plus forte n’est justifiée par le profil actuel.',
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
  const situationProfile = buildSituationProfile({ understanding, basis: provisionalBasis });
  const cognitiveIntervention = selectCognitiveIntervention({
    profile: situationProfile,
    basis: provisionalBasis,
  });

  return {
    ...provisionalBasis,
    domain: situationProfile.domain,
    cognitive_state: situationProfile.cognitive_state,
    dominant_cognitive_need: situationProfile.dominant_need,
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

function buildStrategy({
  id,
  label,
  type = 'cognitive_strategy',
  confidence = 0.5,
  cognitiveCost = 0.2,
  expectedBenefit = 0.5,
  riskLevel = 0.1,
  cognitiveNeed = {},
  reasons = [],
  constraints = {},
  payload = {},
}) {
  const cognitiveNeedPayload = buildCognitiveNeed(cognitiveNeed);

  return {
    id: normalizeText(id),
    label: normalizeText(label),
    type: normalizeText(type) || 'cognitive_strategy',
    confidence: clamp01(confidence, 0.5),
    cognitive_cost: clamp01(cognitiveCost, 0.2),
    expected_benefit: clamp01(expectedBenefit, 0.5),
    risk_level: clamp01(riskLevel, 0.1),
    primary_cognitive_need: cognitiveNeedPayload.primary,
    cognitive_need: cognitiveNeedPayload,
    reasons: normalizeArray(reasons).map(reason => normalizeText(reason)).filter(Boolean),
    constraints: {
      ...normalizeObject(constraints),
      primary_cognitive_need: cognitiveNeedPayload.primary,
    },
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

  const notes = normalizeArray(evaluation.reasoning_notes).map(normalizeText).filter(Boolean);
  if (notes.length > 0) return notes[0];

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
    cognitiveNeed: {
      primary: 'prepare_action',
      label: 'Préparer une action sans saturer la mémoire de travail',
      confidence,
      source: hypothesis ? 'evaluated_hypothesis' : 'intent_fallback',
      rationale: 'La stratégie vise à sortir une action de la tête de l’utilisateur pour la rendre traitable.',
    },
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
    cognitiveNeed: {
      primary: 'prevent_forgetting',
      label: 'Prévenir l’oubli',
      confidence,
      source: hypothesis ? 'evaluated_hypothesis' : 'intent_fallback',
      rationale: 'La stratégie vise à protéger l’utilisateur contre l’oubli d’un élément futur.',
    },
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
    cognitiveNeed: {
      primary: 'organize_information',
      label: 'Organiser une information',
      confidence,
      source: hypothesis ? 'evaluated_hypothesis' : 'intent_fallback',
      rationale: 'La stratégie vise à ranger une information dans un ensemble utile.',
    },
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
    cognitiveNeed: {
      primary: 'support_regulation',
      label: 'Soutenir la régulation cognitive et émotionnelle',
      confidence,
      source: hypothesis ? 'evaluated_hypothesis' : 'emotion_fallback',
      rationale: 'La stratégie vise à réduire la pression interne avant de pousser vers l’action.',
    },
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
    cognitiveNeed: {
      primary: 'structure_idea',
      label: 'Préserver et structurer une pensée',
      confidence,
      source: hypothesis ? 'evaluated_hypothesis' : 'intent_fallback',
      rationale: 'La stratégie vise à conserver une idée ou un projet sans le transformer trop tôt en tâche.',
    },
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
    cognitiveNeed: {
      primary: 'capture_without_action',
      label: 'Capturer sans action immédiate',
      confidence,
      source: hypothesis ? 'evaluated_hypothesis' : 'fallback',
      rationale: 'La stratégie vise à préserver le contexte sans créer de pression opérationnelle.',
    },
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

function buildClarifyUnderstandingStrategy({ basis }) {
  return buildStrategy({
    id: 'clarify_understanding',
    label: 'Clarifier avant toute décision',
    confidence: 0.74,
    cognitiveCost: 0.14,
    expectedBenefit: 0.76,
    riskLevel: 0.08,
    cognitiveNeed: {
      primary: 'clarify_uncertainty',
      label: 'Clarifier avant de décider',
      confidence: 0.78,
      source: 'hypothesis_uncertainty',
      rationale: 'La stratégie vise à éviter une action automatique lorsque le besoin réel reste incertain.',
    },
    reasons: [
      'Les hypothèses disponibles sont trop faibles, contradictoires ou concurrentes.',
      'Une clarification évite de transformer une pensée incertaine en mauvaise action.',
    ],
    constraints: {
      requires_decision: true,
      reasoning_source: 'hypothesis_uncertainty',
      hypothesis_status: 'needs_verification',
      rejected_hypotheses: basis.rejected_hypotheses,
      competing_hypotheses: basis.competing_hypotheses,
    },
    payload: {
      intent: basis.primary_intent,
      clarification_reason: basis.has_competing_hypotheses
        ? 'competing_hypotheses'
        : 'insufficient_supported_hypotheses',
    },
  });
}


function buildBrainDumpStrategy({ basis }) {
  const intervention = normalizeObject(basis.cognitive_intervention);
  const confidence = Math.max(clamp01(intervention.confidence, 0.82), 0.82);

  return buildStrategy({
    id: 'guided_brain_dump',
    label: 'Guider un Brain Dump',
    confidence,
    cognitiveCost: 0.1,
    expectedBenefit: 0.88,
    riskLevel: 0.06,
    cognitiveNeed: {
      primary: 'reduce_cognitive_load',
      label: 'Réduire la charge cognitive par vidage de mémoire de travail',
      confidence,
      source: 'cognitive_intervention',
      rationale: 'Le Brain Dump aide l’utilisateur à sortir les éléments de sa tête avant de trier, prioriser ou agir.',
    },
    reasons: [
      'Le profil de situation indique une surcharge cognitive.',
      'L’intervention recommandée consiste à vider la mémoire de travail avant de choisir une tâche.',
    ],
    constraints: {
      requires_decision: true,
      reasoning_source: 'cognitive_intervention',
      intervention_id: intervention.id || 'brain_dump',
      intervention_label: intervention.label || 'Brain Dump guidé',
      conversation_style: intervention.conversation_style || 'guided_dump',
      next_prompt_goal: intervention.next_prompt_goal || 'Inviter l’utilisateur à vider tout ce qu’il a en tête.',
      hypothesis_status: null,
    },
    payload: {
      intent: basis.primary_intent,
      intervention_id: intervention.id || 'brain_dump',
      cognitive_state: basis.cognitive_state || null,
      domain: basis.domain || null,
      guidance: 'Demander à l’utilisateur d’écrire toutes les choses en tête sans les classer, puis annoncer que Nyra les organisera ensuite.',
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
        internal_analyzers: ['hypothesis_evaluator_v2', 'hypothesis_arbitration_v1', 'situation_profile_v1', 'cognitive_intervention_selector_v1', 'cognitive_layer_strategy_generator_v1', 'alternative_strategy_analyzer_v1', 'cognitive_need_strategy_annotation_v1', 'strategy_evaluator_v1', 'cognitive_questions_v1'],
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
