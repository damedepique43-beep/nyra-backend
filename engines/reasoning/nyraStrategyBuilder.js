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

function buildSituationProfile({ understanding = {}, basis = {}, directiveDetection = {} } = {}) {
  const domain = getUnderstandingDomain(understanding);
  const cognitiveState = getUnderstandingCognitiveState(understanding);
  const primaryIntent = normalizeText(basis.primary_intent || getPrimaryIntent(understanding));
  const directive = normalizeObject(directiveDetection);
  const hasExplicitActionDirective = directive.directive_type === 'explicit_action' && directive.allow_brain_dump === false;
  const directiveDominantNeed = hasExplicitActionDirective ? getDirectiveDominantNeed(directive) : null;
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

  if (directiveDominantNeed) dominantNeed = directiveDominantNeed;
  else if (isOverloaded) dominantNeed = 'reduce_cognitive_load';
  else if (isForgettingRisk || primaryIntent === 'create_reminder') dominantNeed = 'prevent_forgetting';
  else if (isEmotional) dominantNeed = 'support_regulation';
  else if (hasUncertainty) dominantNeed = 'clarify_uncertainty';
  else if (domain === 'idea' || domain === 'project') dominantNeed = 'structure_idea';
  else if (domain === 'collection') dominantNeed = 'organize_information';
  else if (domain === 'task' || primaryIntent === 'create_task') dominantNeed = 'prepare_action';

  const shouldClarifyFirst = Boolean(
    (!hasExplicitActionDirective && isOverloaded) ||
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
    should_externalize: Boolean(
      (!isOverloaded && !isEmotional && (isPlanning || primaryIntent === 'create_task')) ||
      directive.requested_action === 'create_task'
    ),
    should_prepare_reminder: Boolean(
      isForgettingRisk ||
      primaryIntent === 'create_reminder' ||
      directive.requested_action === 'create_reminder' ||
      (hasTemporalNeed && primaryIntent === 'create_task')
    ),
    should_regulate: Boolean(!hasExplicitActionDirective && (isEmotional || isOverloaded)),
    should_preserve_context: Boolean(
      domain === 'idea' ||
      domain === 'project' ||
      primaryIntent === 'capture_note' ||
      directive.requested_action === 'create_project'
    ),
    should_organize_information: Boolean(
      domain === 'collection' ||
      primaryIntent === 'add_to_collection' ||
      directive.requested_action === 'add_to_collection'
    ),
    should_defer_action_creation: Boolean(!hasExplicitActionDirective && (isOverloaded || isEmotional || shouldClarifyFirst)),
    explicit_directive: directive,
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

function selectCognitiveIntervention({ profile = {}, basis = {}, directiveDetection = {} } = {}) {
  // Cognitive Intervention Selector V1
  // Responsabilité : choisir une méthode d'accompagnement du fonctionnement mental
  // avant de choisir les stratégies techniques qui la mettront en œuvre.
  // Ce composant reste interne au Reasoning Engine et ne décide ni n'exécute.
  const safeProfile = normalizeObject(profile);
  const directive = normalizeObject(directiveDetection || safeProfile.explicit_directive);
  const cognitiveState = normalizeText(safeProfile.cognitive_state || basis.cognitive_state || 'neutral');
  const dominantNeed = normalizeCognitiveNeed(safeProfile.dominant_need || basis.dominant_cognitive_need || 'preserve_context');
  const canUseBrainDump = directive.allow_brain_dump !== false;

  if (canUseBrainDump && (dominantNeed === 'reduce_cognitive_load' || ['overwhelmed', 'cognitive_overload', 'overload', 'surcharge', 'task_overload'].includes(cognitiveState))) {
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


module.exports = {
  buildExternalizeActionStrategy,
  buildFuturePromptStrategy,
  buildCollectionStrategy,
  buildRegulationStrategy,
  buildPreserveThoughtStrategy,
  buildContextCaptureStrategy,
  buildClarifyUnderstandingStrategy,
  buildBrainDumpStrategy,
};
