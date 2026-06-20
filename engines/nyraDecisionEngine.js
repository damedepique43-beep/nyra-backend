const crypto = require('crypto');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
  resolveExecutableActionFromCandidateDecision,
  resolveExecutableActionFromDecision,
};
