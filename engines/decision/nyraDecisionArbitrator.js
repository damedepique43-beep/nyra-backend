function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildTraceLookup(selectionTrace = []) {
  return normalizeArray(selectionTrace).reduce((acc, trace) => {
    const candidateId = normalizeText(trace?.candidate_id || '');
    if (candidateId) acc[candidateId] = trace;
    return acc;
  }, {});
}

function getCandidateTrace(candidateDecision = {}, traceLookup = {}, fallbackIndex = 0) {
  const candidateId = normalizeText(candidateDecision?.id || '');

  if (candidateId && traceLookup[candidateId]) {
    return traceLookup[candidateId];
  }

  return {
    candidate_id: candidateDecision?.id || null,
    index: fallbackIndex,
    decision_type: candidateDecision?.decision_type || null,
    should_execute: candidateDecision?.should_execute !== false,
    score: normalizeNumber(candidateDecision?.decision_score?.score, 0),
    score_level: candidateDecision?.decision_score?.level || null,
    eligible: candidateDecision?.should_execute !== false,
    rejection_reasons: [],
    constraints: {},
  };
}

function getDecisionProfile(candidateDecision = {}) {
  return normalizeObject(candidateDecision.decision_profile);
}

function getDecisionConstraints(candidateDecision = {}) {
  return normalizeObject(candidateDecision.decision_constraints);
}

function getDecisionScore(candidateDecision = {}) {
  return normalizeObject(candidateDecision.decision_score);
}

function getCognitiveCostLevel(candidateDecision = {}) {
  const profile = getDecisionProfile(candidateDecision);
  const cognitiveCost = normalizeObject(profile.cognitive_cost);
  return normalizeNumber(cognitiveCost.level, 3);
}

function getCognitiveNeed(candidateDecision = {}) {
  const profile = getDecisionProfile(candidateDecision);
  const decisionInput = normalizeObject(candidateDecision.decision_input);
  const strongestCandidate = normalizeObject(decisionInput.strongest_candidate);

  return normalizeText(
    profile.cognitive_need ||
    decisionInput.cognitive_need ||
    strongestCandidate.cognitive_need ||
    strongestCandidate.id ||
    'unknown'
  ) || 'unknown';
}

function getReadiness(candidateDecision = {}) {
  const profile = getDecisionProfile(candidateDecision);
  const decisionInput = normalizeObject(candidateDecision.decision_input);
  const strongestCandidate = normalizeObject(decisionInput.strongest_candidate);

  return normalizeText(
    profile.readiness ||
    strongestCandidate.readiness ||
    'unknown'
  ) || 'unknown';
}

function computeArbitrationPriority(candidateDecision = {}, trace = {}) {
  // Decision Arbitrator V1
  // Responsabilité : classer les décisions candidates de manière informative
  // à partir des scores, contraintes et profils déjà calculés par le Decision Engine.
  // Ce composant ne choisit pas encore en runtime.
  const decisionScore = getDecisionScore(candidateDecision);
  const decisionConstraints = getDecisionConstraints(candidateDecision);
  const score = normalizeNumber(trace.score ?? decisionScore.score, 0);
  const cognitiveCostLevel = getCognitiveCostLevel(candidateDecision);
  const readiness = getReadiness(candidateDecision);
  const eligible = Boolean(trace.eligible);
  let priority = score;
  const factors = [];

  if (eligible) {
    priority += 18;
    factors.push({ id: 'eligible', impact: 18, label: 'La candidate respecte les contraintes minimales.' });
  } else {
    priority -= 24;
    factors.push({ id: 'not_eligible', impact: -24, label: 'La candidate ne respecte pas toutes les contraintes minimales.' });
  }

  if (readiness === 'ready_for_decision') {
    priority += 10;
    factors.push({ id: 'ready_for_decision', impact: 10, label: 'La stratégie est prête pour une décision.' });
  } else if (readiness === 'clarify_before_decision') {
    priority -= 14;
    factors.push({ id: 'clarify_before_decision', impact: -14, label: 'La stratégie demande une clarification avant décision.' });
  }

  if (cognitiveCostLevel <= 1) {
    priority += 6;
    factors.push({ id: 'very_low_cognitive_cost', impact: 6, label: 'La candidate demande très peu d’effort cognitif.' });
  } else if (cognitiveCostLevel >= 5) {
    priority -= 8;
    factors.push({ id: 'high_cognitive_cost', impact: -8, label: 'La candidate demande un effort cognitif élevé.' });
  }

  if (decisionConstraints.requires_clarification) {
    priority -= 12;
    factors.push({ id: 'requires_clarification', impact: -12, label: 'Les contraintes demandent une clarification.' });
  }

  return {
    priority: Math.round(Math.max(0, Math.min(100, priority))),
    factors,
  };
}

function buildCandidateArbitration(candidateDecision = {}, trace = {}) {
  const decisionScore = getDecisionScore(candidateDecision);
  const decisionProfile = getDecisionProfile(candidateDecision);
  const decisionConstraints = getDecisionConstraints(candidateDecision);
  const arbitrationPriority = computeArbitrationPriority(candidateDecision, trace);

  return {
    candidate_id: candidateDecision.id || trace.candidate_id || null,
    index: trace.index ?? null,
    decision_type: candidateDecision.decision_type || trace.decision_type || null,
    eligible: Boolean(trace.eligible),
    should_execute: trace.should_execute !== false,
    score: normalizeNumber(trace.score ?? decisionScore.score, 0),
    score_level: decisionScore.level || trace.score_level || null,
    arbitration_priority: arbitrationPriority.priority,
    cognitive_need: getCognitiveNeed(candidateDecision),
    cognitive_cost_level: getCognitiveCostLevel(candidateDecision),
    readiness: getReadiness(candidateDecision),
    rejection_reasons: normalizeArray(trace.rejection_reasons),
    constraint_reason: decisionConstraints.reason || trace.constraints?.reason || null,
    strongest_candidate_id: candidateDecision.decision_input?.strongest_candidate?.id || null,
    factors: arbitrationPriority.factors,
    profile_available: Boolean(decisionProfile.available),
    constraints_available: Boolean(decisionConstraints.available),
  };
}

function sortArbitrationRanking(a, b) {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (b.arbitration_priority !== a.arbitration_priority) return b.arbitration_priority - a.arbitration_priority;
  if (b.score !== a.score) return b.score - a.score;
  return normalizeNumber(a.index, 0) - normalizeNumber(b.index, 0);
}

function arbitrateDecisionCandidates({ candidates = [], selectionTrace = [] } = {}) {
  const safeCandidates = normalizeArray(candidates);
  const traceLookup = buildTraceLookup(selectionTrace);
  const ranking = safeCandidates
    .map((candidateDecision, index) => {
      return buildCandidateArbitration(
        candidateDecision,
        getCandidateTrace(candidateDecision, traceLookup, index)
      );
    })
    .sort(sortArbitrationRanking);

  const bestCandidate = ranking[0] || null;
  const legacyCandidate = normalizeArray(selectionTrace)[0] || null;
  const bestCandidateTrace = bestCandidate
    ? normalizeArray(selectionTrace).find(trace => trace.candidate_id === bestCandidate.candidate_id) || null
    : null;

  return {
    contract: 'decision-arbitrator-v1',
    source: 'nyra_decision_engine',
    behavior_impact: 'none',
    mode: 'informative_only',
    evaluated_candidates: safeCandidates.length,
    best_candidate_id: bestCandidate?.candidate_id || null,
    best_candidate_trace: bestCandidateTrace,
    legacy_candidate_id: legacyCandidate?.candidate_id || null,
    recommended_runtime_switch: false,
    ranking,
    arbitration_reason: bestCandidate
      ? 'Arbitrage informatif : candidate classée selon éligibilité, score, coût cognitif, readiness et contraintes.'
      : 'Aucune candidate disponible pour arbitrage informatif.',
    principle: 'Le DecisionArbitrator prépare le futur choix argumenté sans modifier le comportement runtime validé.',
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  arbitrateDecisionCandidates,
};
