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


function isUsableHypothesis(hypothesis) {
  const status = normalizeText(hypothesis?.evaluation?.status || 'provisional');
  return !['contradicted', 'weak'].includes(status);
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


module.exports = {
  evaluateHypotheses,
  buildHypothesisReasoningState,
  getHypothesisByType,
  isUsableHypothesis,
  getHypothesisConfidence,
  getHypothesisRiskAdjustment,
  getHypothesisReason,
  summarizeHypothesisEvaluations,
};
