const {
  getHypothesisConfidence,
  getHypothesisRiskAdjustment,
  getHypothesisReason,
} = require('./nyraHypothesisEvaluator');

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
