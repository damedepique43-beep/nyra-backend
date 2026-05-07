function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparableText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(je|tu|il|elle|on|nous|vous|ils|elles|dois|doit|faire|ajoute|ajouter|une|un|le|la|les|des|du|de|d|a|au|aux|ça|ca|ce|cet|cette|demain|matin|soir|projet|tache|tâche)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDeduplicationKey(item = {}) {
  const source = normalizeComparableText(
    `${item.project_name || ''} ${item.title || ''} ${item.content || item.target || ''}`
  );

  if (!source) {
    return item.id || '';
  }

  const words = source
    .split(' ')
    .filter(word => word.length >= 3)
    .slice(0, 12);

  return words.join('-') || source.slice(0, 80);
}

function isCompletedItem(item = {}) {
  const status = normalizeText(item.status || '').toLowerCase();

  return [
    'done',
    'completed',
    'complete',
    'cancelled',
    'canceled',
    'synced',
  ].includes(status);
}

function getItemFreshnessScore(item = {}) {
  const date = new Date(item.updated_at || item.created_at || 0);

  if (Number.isNaN(date.getTime())) {
    return 0;
  }

  return date.getTime();
}

function getItemStatusScore(item = {}) {
  const status = normalizeText(item.status || '').toLowerCase();

  if (status === 'executing') return 40;
  if (status === 'todo') return 35;
  if (status === 'suggested') return 30;
  if (status === 'draft') return 25;
  if (status === 'captured') return 10;
  if (status === 'failed') return 8;
  if (status === 'done') return -50;
  if (status === 'cancelled') return -60;

  return 0;
}

function chooseBestDuplicateItem(current, candidate) {
  const currentScore =
    getItemStatusScore(current) +
    (current.priority === 'high' ? 15 : 0) +
    (current.urgency === 'high' ? 15 : 0) +
    (current.project_name ? 5 : 0);

  const candidateScore =
    getItemStatusScore(candidate) +
    (candidate.priority === 'high' ? 15 : 0) +
    (candidate.urgency === 'high' ? 15 : 0) +
    (candidate.project_name ? 5 : 0);

  if (candidateScore > currentScore) {
    return candidate;
  }

  if (candidateScore < currentScore) {
    return current;
  }

  return getItemFreshnessScore(candidate) > getItemFreshnessScore(current)
    ? candidate
    : current;
}

function deduplicatePriorityItems(items = []) {
  const grouped = new Map();

  items.forEach(item => {
    const key = getDeduplicationKey(item);

    if (!key) return;

    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        item,
        duplicate_count: 1,
        duplicate_ids: item.id ? [item.id] : [],
      });
      return;
    }

    const bestItem = chooseBestDuplicateItem(existing.item, item);

    grouped.set(key, {
      item: bestItem,
      duplicate_count: existing.duplicate_count + 1,
      duplicate_ids: [
        ...existing.duplicate_ids,
        item.id,
      ].filter(Boolean),
    });
  });

  return Array.from(grouped.values()).map(group => ({
    ...group.item,
    duplicate_count: group.duplicate_count,
    duplicate_ids: group.duplicate_ids,
    deduplication_key: getDeduplicationKey(group.item),
  }));
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

  if (isCompletedItem(item)) {
    priorityScore -= 35;
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

  if (isCompletedItem(item)) {
    return {
      type: 'already_done',
      title: 'Déjà traité',
      message:
        'Cette action semble déjà terminée ou clôturée.',
      recommendation:
        'Ne pas la remettre dans les priorités actives.',
    };
  }

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
  const activeSourceItems = items.filter(item => {
    return !isCompletedItem(item);
  });

  const deduplicatedItems = deduplicatePriorityItems(activeSourceItems);

  const analyzed = deduplicatedItems.map(item => {
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
        item.cognitive_cost <= 70 &&
        !isCompletedItem(item)
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
    deduplication: {
      original_item_count: items.length,
      active_item_count: activeSourceItems.length,
      deduplicated_item_count: deduplicatedItems.length,
      removed_duplicate_count: Math.max(0, activeSourceItems.length - deduplicatedItems.length),
      ignored_completed_count: Math.max(0, items.length - activeSourceItems.length),
    },
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
        topPriority
          ? `Garder une seule priorité active : ${topPriority.title || topPriority.content || 'la tâche principale'}.`
          : 'Choisir une seule priorité et transformer le reste en actions minuscules.',
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
  deduplicatePriorityItems,
};
