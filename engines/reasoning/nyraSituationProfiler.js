const { getDirectiveDominantNeed } = require('./nyraDirectiveDetector');

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

function hasProjectClarificationSignal(understanding = {}, basis = {}) {
  const rawText = normalizeText(understanding.raw_text || understanding.text || basis.raw_text || '').toLowerCase();
  const metadata = normalizeObject(understanding.metadata);
  const analysis = normalizeObject(understanding.analysis || metadata.analysis || metadata.local_analysis);
  const lifecyclePhase = normalizeText(
    understanding.project_lifecycle_phase ||
    analysis.project_lifecycle_phase ||
    metadata.project_lifecycle_phase ||
    ''
  );

  if (['potential_project', 'project_clarification', 'clarification'].includes(lifecyclePhase)) {
    return true;
  }

  return includesAny(rawText, [
    'je veux créer',
    'je veux creer',
    'je veux lancer',
    'je veux ouvrir',
    'je veux monter',
    'j aimerais créer',
    "j'aimerais créer",
    'j aimerais lancer',
    "j'aimerais lancer",
    'j aimerais ouvrir',
    "j'aimerais ouvrir",
    'je voudrais créer',
    'je voudrais creer',
    'je voudrais lancer',
    'je voudrais ouvrir',
    'mon projet c est',
    "mon projet c'est",
    'j ai pour projet',
    "j'ai pour projet",
  ]);
}


function getPrimaryIntent(understanding) {
  const intent = normalizeObject(understanding.intent);
  return normalizeText(intent.primary || understanding.primary_intent || 'capture_note') || 'capture_note';
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
  const hasProjectClarificationNeed = Boolean(
    !hasExplicitActionDirective &&
    (
      domain === 'project' ||
      primaryIntent === 'project_thought' ||
      hasProjectClarificationSignal(understanding, basis)
    )
  );

  let dominantNeed = 'preserve_context';

  if (directiveDominantNeed) dominantNeed = directiveDominantNeed;
  else if (isOverloaded) dominantNeed = 'reduce_cognitive_load';
  else if (isForgettingRisk || primaryIntent === 'create_reminder') dominantNeed = 'prevent_forgetting';
  else if (isEmotional) dominantNeed = 'support_regulation';
  else if (hasUncertainty) dominantNeed = 'clarify_uncertainty';
  else if (hasProjectClarificationNeed || domain === 'idea' || domain === 'project') dominantNeed = 'structure_idea';
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
    should_clarify_project: hasProjectClarificationNeed,
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

  if (dominantNeed === 'structure_idea' && safeProfile.should_clarify_project) {
    return buildCognitiveIntervention({
      id: 'progressive_clarification',
      label: 'Clarification progressive du projet',
      goal: 'structure_idea',
      confidence: 0.8,
      conversationStyle: 'project_clarification',
      recommendedBuilders: ['clarify_project_objective'],
      nextPromptGoal: 'Poser la question dont la réponse ferait le plus progresser la compréhension utile du projet avant toute roadmap.',
      rationale: 'Un objectif pouvant devenir un projet demande de cibler l’information la plus structurante avant toute roadmap.',
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

module.exports = {
  buildSituationProfile,
  selectCognitiveIntervention,
};
