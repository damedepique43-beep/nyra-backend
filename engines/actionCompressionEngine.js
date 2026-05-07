function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCompressionMode(cognitiveState = {}) {
  const overwhelmScore = Number(
    cognitiveState?.overwhelm_score || 0
  );

  const energyLevel = normalizeText(
    cognitiveState?.energy_level || 'medium'
  ).toLowerCase();

  const focusState = normalizeText(
    cognitiveState?.focus_state || 'normal'
  ).toLowerCase();

  if (
    overwhelmScore >= 80 ||
    energyLevel === 'low'
  ) {
    return 'micro';
  }

  if (
    focusState === 'scattered' ||
    focusState === 'fragmented'
  ) {
    return 'guided';
  }

  if (
    energyLevel === 'high' &&
    focusState === 'deep'
  ) {
    return 'deep_execution';
  }

  return 'standard';
}

function estimateResistance(task = {}) {
  const content = normalizeText(
    `${task.title || ''} ${task.content || ''}`
  ).toLowerCase();

  let resistance = 20;

  const heavyKeywords = [
    'backend',
    'administratif',
    'important',
    'urgent',
    'paperasse',
    'banque',
    'appel',
    'dossier',
    'bug',
    'refactor',
  ];

  heavyKeywords.forEach(keyword => {
    if (content.includes(keyword)) {
      resistance += 12;
    }
  });

  if (content.length > 180) {
    resistance += 10;
  }

  return Math.max(
    0,
    Math.min(100, resistance)
  );
}

function buildMicroSteps(task = {}, mode = 'standard') {
  const title = normalizeText(
    task.title || task.content || 'Tâche'
  );

  if (mode === 'micro') {
    return [
      `Ouvrir ce qui est lié à : ${title}`,
      'Observer sans pression',
      'Faire une seule micro-modification',
      'Tester rapidement',
      'Pause cognitive',
    ];
  }

  if (mode === 'guided') {
    return [
      `Clarifier le résultat attendu pour : ${title}`,
      'Identifier le premier vrai blocage',
      'Traiter une seule partie',
      'Valider le progrès',
      'Noter la prochaine étape',
    ];
  }

  if (mode === 'deep_execution') {
    return [
      'Préparer un bloc sans distraction',
      `Exécuter profondément : ${title}`,
      'Enchaîner immédiatement la sous-étape suivante',
      'Capturer les idées annexes sans interrompre le flow',
      'Faire une fermeture propre de session',
    ];
  }

  return [
    `Commencer : ${title}`,
    'Avancer étape par étape',
    'Tester ou vérifier',
    'Faire une courte pause',
  ];
}

function buildMomentumStrategy(mode) {
  if (mode === 'micro') {
    return 'start_tiny';
  }

  if (mode === 'guided') {
    return 'reduce_confusion';
  }

  if (mode === 'deep_execution') {
    return 'protect_flow';
  }

  return 'steady_progress';
}

function getRecommendedFocusDuration(mode) {
  if (mode === 'micro') {
    return 15;
  }

  if (mode === 'guided') {
    return 25;
  }

  if (mode === 'deep_execution') {
    return 90;
  }

  return 45;
}

function compressTask({
  task = {},
  cognitiveState = {},
}) {
  const mode =
    detectCompressionMode(cognitiveState);

  const resistance =
    estimateResistance(task);

  const microSteps =
    buildMicroSteps(task, mode);

  return {
    task_id: task.id || null,
    original_task:
      task.title ||
      task.content ||
      'Tâche',

    compression_mode: mode,

    estimated_resistance:
      resistance >= 70
        ? 'high'
        : resistance >= 40
        ? 'medium'
        : 'low',

    resistance_score: resistance,

    first_action:
      microSteps[0] || null,

    micro_steps: microSteps,

    recommended_focus_duration:
      getRecommendedFocusDuration(mode),

    momentum_strategy:
      buildMomentumStrategy(mode),

    generated_at:
      new Date().toISOString(),
  };
}

module.exports = {
  compressTask,
};
