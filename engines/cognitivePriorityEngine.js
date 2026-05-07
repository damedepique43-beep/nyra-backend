function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateCognitiveCost(item = {}) {
  const content = normalizeText(
    `${item.title || ''} ${item.content || item.target || ''}`
  ).toLowerCase();

  let score = 20;

  const heavyKeywords = [
    'important',
    'urgent',
    'administratif',
    'appel',
    'papier',
    'dossier',
    'facture',
    'banque',
    'stress',
    'clément',
    'novacall',
  ];

  const lightKeywords = [
    'petit',
    'rapide',
    '5 minutes',
    'simple',
    'micro',
    'test',
  ];

  heavyKeywords.forEach(keyword => {
    if (content.includes(keyword)) {
      score += 12;
    }
  });

  lightKeywords.forEach(keyword => {
    if (content.includes(keyword)) {
      score -= 8;
    }
  });

  if ((item.content || item.target || '').length > 220) {
    score += 10;
  }

  if (item.priority === 'high') {
    score += 10;
  }

  if (item.urgency === 'high') {
    score += 10;
  }

  if (
    item.type === 'emotion' ||
    item.type === 'emotional_task' ||
    item.bucket === 'journal'
  ) {
    score += 15;
  }

  return Math.max(0, Math.min(100, score));
}

function calculateAdaptivePriority({
  item,
  cognitiveState,
}) {
  const cost = estimateCognitiveCost(item);

  const overwhelmScore = Number(
    cognitiveState?.overwhelm_score || 0
  );

  const energyLevel = normalizeText(
    cognitiveState?.energy_level || 'medium'
  );

  let priorityScore = 50;

  if (item.priority === 'high') {
    priorityScore += 20;
  }

  if (item.urgency === 'high') {
    priorityScore += 20;
  }

  if (cost <= 30) {
    priorityScore += 15;
  }

  if (cost >= 70) {
    priorityScore -= 10;
  }

  if (overwhelmScore >= 75 && cost >= 60) {
    priorityScore -= 30;
  }

  if (overwhelmScore >= 85) {
    priorityScore -= 15;
  }

  if (
    energyLevel === 'low' &&
    cost >= 50
  ) {
    priorityScore -= 20;
  }

  return Math.max(
    0,
    Math.min(100, priorityScore)
  );
}

function buildExecutiveRecommendation({
  item,
  cost,
  priorityScore,
  cognitiveState,
}) {
  const overwhelmScore = Number(
    cognitiveState?.overwhelm_score || 0
  );

  if (
    overwhelmScore >= 80 &&
    cost >= 70
  ) {
    return {
      type: 'reduce_scope',
      title: 'Réduire la charge',
      message:
        'Cette tâche semble trop lourde pour ton état cognitif actuel.',
      recommendation:
        'Transformer cette tâche en micro-action.',
    };
  }

  if (
    priorityScore >= 75 &&
    cost <= 45
  ) {
    return {
      type: 'good_focus_target',
      title: 'Bonne cible de focus',
      message:
        'Cette tâche semble adaptée à ton énergie actuelle.',
      recommendation:
        'Avancer dessus maintenant pourrait créer du momentum.',
    };
  }

  if (
    overwhelmScore >= 70 &&
    priorityScore <= 40
  ) {
    return {
      type: 'not_now',
      title: 'Pas maintenant',
      message:
        'Cette tâche risque d’augmenter ta surcharge.',
      recommendation:
        'La reporter ou la simplifier.',
    };
  }

  return {
    type: 'balanced',
    title: 'Charge modérée',
    message:
      'Cette tâche semble faisable avec une approche progressive.',
    recommendation:
      'Limiter le temps de focus pour éviter la fatigue cognitive.',
  };
}

function analyzePriorities({
  items = [],
  cognitiveState = {},
}) {
  const analyzed = items.map(item => {
    const cognitive_cost =
      estimateCognitiveCost(item);

    const adaptive_priority =
      calculateAdaptivePriority({
        item,
        cognitiveState,
      });

    const executive_recommendation =
      buildExecutiveRecommendation({
        item,
        cost: cognitive_cost,
        priorityScore: adaptive_priority,
        cognitiveState,
      });

    return {
      ...item,
      cognitive_cost,
      adaptive_priority,
      executive_recommendation,
    };
  });

  analyzed.sort((a, b) => {
    return (
      b.adaptive_priority -
      a.adaptive_priority
    );
  });

  const topPriority =
    analyzed[0] || null;

  const overloadRiskCount =
    analyzed.filter(
      item =>
        item.cognitive_cost >= 70
    ).length;

  const recommendedToday = analyzed
    .filter(item => {
      return (
        item.adaptive_priority >= 55 &&
        item.cognitive_cost <= 70
      );
    })
    .slice(0, 3);

  const shouldReduceAmbition =
    Number(cognitiveState?.overwhelm_score || 0) >= 75 ||
    overloadRiskCount >= 3;

  return {
    analyzed_items: analyzed,
    top_priority: topPriority,
    recommended_today: recommendedToday,
    overload_risk_count:
      overloadRiskCount,
    should_reduce_ambition: shouldReduceAmbition,
    executive_summary: buildPrioritySummary({
      topPriority,
      recommendedToday,
      overloadRiskCount,
      shouldReduceAmbition,
      cognitiveState,
    }),
    generated_at:
      new Date().toISOString(),
  };
}

function buildPrioritySummary({
  topPriority,
  recommendedToday,
  overloadRiskCount,
  shouldReduceAmbition,
  cognitiveState,
}) {
  const overwhelmScore = Number(cognitiveState?.overwhelm_score || 0);

  if (shouldReduceAmbition) {
    return {
      title: 'Réduire les ambitions aujourd’hui',
      message:
        'Nyra détecte un risque de surcharge. Le plus intelligent est de viser moins, mais mieux.',
      recommendation:
        'Choisir une seule priorité et transformer le reste en actions minuscules.',
      mode: 'protect_energy',
      overwhelm_score: overwhelmScore,
    };
  }

  if (topPriority) {
    return {
      title: 'Priorité cognitive claire',
      message:
        'Nyra a identifié une action adaptée à ton état actuel.',
      recommendation:
        topPriority.executive_recommendation?.recommendation ||
        'Commencer par cette tâche avec un bloc court.',
      mode: 'execute',
      overwhelm_score: overwhelmScore,
    };
  }

  if (!recommendedToday.length) {
    return {
      title: 'Aucune priorité urgente détectée',
      message:
        'Nyra ne voit pas encore de priorité claire dans les données actuelles.',
      recommendation:
        'Capturer une tâche ou une idée pour que Nyra puisse t’aider à trier.',
      mode: 'observe',
      overwhelm_score: overwhelmScore,
    };
  }

  return {
    title: 'Priorités modérées',
    message:
      'Quelques actions semblent faisables sans trop charger ton cerveau.',
    recommendation:
      'En choisir une seule pour commencer.',
    mode: 'steady',
    overwhelm_score: overwhelmScore,
  };
}

module.exports = {
  analyzePriorities,
  estimateCognitiveCost,
  calculateAdaptivePriority,
};
