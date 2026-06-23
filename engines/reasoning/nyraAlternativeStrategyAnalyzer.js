const {
  buildExternalizeActionStrategy,
  buildFuturePromptStrategy,
  buildRegulationStrategy,
  buildPreserveThoughtStrategy,
  buildClarifyUnderstandingStrategy,
} = require('./nyraStrategyBuilder');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasLayerType(items = [], type) {
  const normalizedType = normalizeText(type);
  return normalizeArray(items).some(item => normalizeText(item?.type) === normalizedType);
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


module.exports = {
  enrichWithAlternativeStrategies,
};
