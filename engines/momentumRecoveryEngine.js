/**
 * Nyra — Momentum Recovery Engine V1
 * ------------------------------------------------------------
 * Purpose:
 * Detect cognitive rupture after a focus session is interrupted,
 * abandoned, stopped too early, failed, or fragmented.
 *
 * This engine does NOT blame the user.
 * It reduces friction, protects momentum, and proposes a smaller,
 * safer restart path.
 *
 * Core idea:
 * focus session rupture
 * -> understand what happened
 * -> reduce the next step
 * -> suggest a recovery mode
 * -> preserve execution momentum
 */

function safeString(value, fallback = '') {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value).trim();
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeStatus(status) {
  const cleanStatus = safeString(status).toLowerCase();

  if (['done', 'completed', 'complete', 'success', 'finished'].includes(cleanStatus)) {
    return 'done';
  }

  if (['cancelled', 'canceled', 'abandoned', 'stopped', 'interrupted'].includes(cleanStatus)) {
    return 'interrupted';
  }

  if (['failed', 'error', 'blocked'].includes(cleanStatus)) {
    return 'failed';
  }

  if (['paused', 'pause'].includes(cleanStatus)) {
    return 'paused';
  }

  if (['executing', 'active', 'running', 'in_progress'].includes(cleanStatus)) {
    return 'executing';
  }

  return cleanStatus || 'unknown';
}

function normalizeCognitiveState(cognitiveState = {}) {
  const cognitiveLoad = safeString(cognitiveState.cognitive_load || cognitiveState.cognitiveLoad, 'unknown').toLowerCase();
  const emotionalState = safeString(cognitiveState.emotional_state || cognitiveState.emotionalState, 'unknown').toLowerCase();
  const focusState = safeString(cognitiveState.focus_state || cognitiveState.focusState, 'unknown').toLowerCase();
  const energyLevel = safeString(cognitiveState.energy_level || cognitiveState.energyLevel, 'unknown').toLowerCase();
  const overwhelmScore = clamp(
    safeNumber(cognitiveState.overwhelm_score || cognitiveState.overwhelmScore, 0),
    0,
    100
  );

  return {
    cognitive_load: cognitiveLoad,
    emotional_state: emotionalState,
    focus_state: focusState,
    energy_level: energyLevel,
    overwhelm_score: overwhelmScore,
  };
}

function calculateCompletionRatio(session = {}) {
  const plannedMinutes = safeNumber(
    session.planned_minutes ||
      session.plannedMinutes ||
      session.recommended_focus_duration ||
      session.recommendedFocusDuration,
    0
  );

  const elapsedMinutes = safeNumber(
    session.elapsed_minutes ||
      session.elapsedMinutes ||
      session.completed_minutes ||
      session.completedMinutes ||
      session.duration_done ||
      session.durationDone,
    0
  );

  if (plannedMinutes <= 0) {
    return 0;
  }

  return clamp(elapsedMinutes / plannedMinutes, 0, 1);
}

function detectRuptureType(session = {}, cognitiveState = {}) {
  const status = normalizeStatus(session.status);
  const completionRatio = calculateCompletionRatio(session);
  const normalizedState = normalizeCognitiveState(cognitiveState);

  if (status === 'done') {
    return 'no_rupture';
  }

  if (status === 'paused') {
    return 'temporary_pause';
  }

  if (status === 'failed') {
    return 'blocked_execution';
  }

  if (normalizedState.overwhelm_score >= 85 || normalizedState.cognitive_load === 'very_high') {
    return 'overload_break';
  }

  if (normalizedState.focus_state === 'scattered' || normalizedState.focus_state === 'fragmented') {
    return 'attention_fragmentation';
  }

  if (normalizedState.energy_level === 'low' || normalizedState.energy_level === 'very_low') {
    return 'energy_drop';
  }

  if (status === 'interrupted' && completionRatio < 0.25) {
    return 'entry_resistance';
  }

  if (status === 'interrupted' && completionRatio >= 0.25 && completionRatio < 0.75) {
    return 'mid_session_drop';
  }

  if (status === 'interrupted' && completionRatio >= 0.75) {
    return 'near_completion_drop';
  }

  return 'unknown_rupture';
}

function calculateRecoveryIntensity(ruptureType, cognitiveState = {}, session = {}) {
  const normalizedState = normalizeCognitiveState(cognitiveState);
  const completionRatio = calculateCompletionRatio(session);

  let intensity = 35;

  if (normalizedState.overwhelm_score >= 90) intensity += 35;
  else if (normalizedState.overwhelm_score >= 75) intensity += 25;
  else if (normalizedState.overwhelm_score >= 55) intensity += 15;

  if (normalizedState.cognitive_load === 'very_high') intensity += 25;
  if (normalizedState.cognitive_load === 'high') intensity += 15;

  if (normalizedState.energy_level === 'very_low') intensity += 25;
  if (normalizedState.energy_level === 'low') intensity += 15;

  if (normalizedState.focus_state === 'scattered') intensity += 20;
  if (normalizedState.focus_state === 'fragmented') intensity += 20;

  if (completionRatio < 0.25) intensity += 15;
  if (completionRatio >= 0.75) intensity -= 10;

  if (ruptureType === 'overload_break') intensity += 20;
  if (ruptureType === 'entry_resistance') intensity += 15;
  if (ruptureType === 'near_completion_drop') intensity -= 15;
  if (ruptureType === 'temporary_pause') intensity -= 10;
  if (ruptureType === 'no_rupture') intensity = 0;

  return clamp(Math.round(intensity), 0, 100);
}

function selectRecoveryMode(ruptureType, recoveryIntensity, cognitiveState = {}) {
  const normalizedState = normalizeCognitiveState(cognitiveState);

  if (ruptureType === 'no_rupture') {
    return 'preserve_momentum';
  }

  if (recoveryIntensity >= 85) {
    return 'nervous_system_reset';
  }

  if (
    ruptureType === 'overload_break' ||
    normalizedState.cognitive_load === 'very_high' ||
    normalizedState.overwhelm_score >= 80
  ) {
    return 'ultra_micro_restart';
  }

  if (
    ruptureType === 'attention_fragmentation' ||
    normalizedState.focus_state === 'scattered' ||
    normalizedState.focus_state === 'fragmented'
  ) {
    return 'guided_re_entry';
  }

  if (ruptureType === 'energy_drop' || normalizedState.energy_level === 'low' || normalizedState.energy_level === 'very_low') {
    return 'low_energy_restart';
  }

  if (ruptureType === 'near_completion_drop') {
    return 'finish_line_restart';
  }

  return 'soft_restart';
}

function getRecoveryDuration(recoveryMode) {
  const durations = {
    preserve_momentum: 25,
    nervous_system_reset: 5,
    ultra_micro_restart: 7,
    guided_re_entry: 12,
    low_energy_restart: 10,
    finish_line_restart: 10,
    soft_restart: 15,
  };

  return durations[recoveryMode] || 10;
}

function getRecoveryMessage(recoveryMode, ruptureType) {
  const messages = {
    preserve_momentum:
      "Session terminée. On garde l'élan, sans ajouter de pression inutile.",
    nervous_system_reset:
      "Ton système semble saturé. On ne force pas. On redescend d'abord la pression.",
    ultra_micro_restart:
      "On réduit au minimum. L'objectif n'est pas de tout faire, juste de relancer le mouvement.",
    guided_re_entry:
      "Ton attention semble dispersée. On reprend avec un cadre très simple et guidé.",
    low_energy_restart:
      "Ton énergie semble basse. On choisit une reprise courte, réaliste et légère.",
    finish_line_restart:
      "Tu étais proche de finir. On vise seulement la dernière petite marche.",
    soft_restart:
      "On reprend doucement, sans culpabilité, avec une action plus petite.",
  };

  if (ruptureType === 'blocked_execution') {
    return "Tu n'as pas échoué : quelque chose a bloqué l'exécution. On va réduire et clarifier la prochaine action.";
  }

  return messages[recoveryMode] || messages.soft_restart;
}

function buildRecoverySteps(recoveryMode, task = {}, session = {}) {
  const taskTitle = safeString(task.title || task.name || session.task_title || session.taskTitle, 'la tâche');
  const firstAction = safeString(
    task.first_action ||
      task.firstAction ||
      session.first_action ||
      session.firstAction,
    ''
  );

  const actionLabel = firstAction || `ouvrir ce qui concerne "${taskTitle}"`;

  const stepsByMode = {
    preserve_momentum: [
      "Noter ce qui a été terminé.",
      "Identifier la prochaine action logique.",
      "Ne relancer une session que si l'énergie est encore disponible.",
    ],
    nervous_system_reset: [
      "Respirer lentement pendant 60 secondes.",
      "Boire une gorgée d'eau ou relâcher les épaules.",
      "Écrire en une phrase ce qui bloque.",
      "Choisir une seule micro-action de moins de 2 minutes.",
    ],
    ultra_micro_restart: [
      `Faire uniquement ceci : ${actionLabel}.`,
      "S'arrêter dès que cette micro-action est faite.",
      "Valider le mouvement, même s'il est minuscule.",
    ],
    guided_re_entry: [
      "Fermer ou éloigner une distraction visible.",
      `Revenir uniquement à : ${taskTitle}.`,
      `Faire la première action : ${actionLabel}.`,
      "Continuer seulement pendant la durée courte proposée.",
    ],
    low_energy_restart: [
      "Choisir la version la plus facile de la tâche.",
      `Faire seulement : ${actionLabel}.`,
      "Ne pas chercher la performance.",
      "S'arrêter avant l'épuisement.",
    ],
    finish_line_restart: [
      "Lister ce qu'il reste vraiment à faire.",
      "Choisir le dernier geste utile.",
      `Terminer uniquement : ${actionLabel}.`,
    ],
    soft_restart: [
      `Reprendre avec : ${actionLabel}.`,
      "Mettre un minuteur court.",
      "Faire juste assez pour recréer l'élan.",
    ],
  };

  return stepsByMode[recoveryMode] || stepsByMode.soft_restart;
}

function buildMomentumStrategy(recoveryMode, ruptureType) {
  const strategies = {
    preserve_momentum: {
      label: 'Préserver',
      instruction: "Ne surcharge pas la suite. Capitalise sur ce qui vient d'être fait.",
    },
    nervous_system_reset: {
      label: 'Réguler',
      instruction: "Priorité au retour au calme avant toute relance d'action.",
    },
    ultra_micro_restart: {
      label: 'Réduire',
      instruction: "La prochaine action doit être si petite qu'elle semble presque trop simple.",
    },
    guided_re_entry: {
      label: 'Recadrer',
      instruction: "Réduis les choix visibles et reprends dans un cadre guidé.",
    },
    low_energy_restart: {
      label: 'Alléger',
      instruction: "Garde l'action courte pour éviter de transformer la fatigue en blocage.",
    },
    finish_line_restart: {
      label: 'Finaliser',
      instruction: "Ne relance pas tout le chantier. Vise seulement la fermeture de boucle.",
    },
    soft_restart: {
      label: 'Relancer',
      instruction: "Recrée un mouvement simple, sans chercher une session parfaite.",
    },
  };

  const selected = strategies[recoveryMode] || strategies.soft_restart;

  return {
    ...selected,
    rupture_type: ruptureType,
  };
}

function shouldSuggestBreak(recoveryMode, recoveryIntensity) {
  return recoveryMode === 'nervous_system_reset' || recoveryIntensity >= 85;
}

function shouldSuggestRestart(recoveryMode, ruptureType) {
  if (ruptureType === 'no_rupture') {
    return false;
  }

  return recoveryMode !== 'nervous_system_reset';
}

function analyzeMomentumRecovery(input = {}) {
  const session = input.session || {};
  const task = input.task || {};
  const cognitiveState = input.cognitive_state || input.cognitiveState || {};
  const priority = input.priority || {};

  const ruptureType = detectRuptureType(session, cognitiveState);
  const recoveryIntensity = calculateRecoveryIntensity(ruptureType, cognitiveState, session);
  const recoveryMode = selectRecoveryMode(ruptureType, recoveryIntensity, cognitiveState);
  const recommendedRecoveryDuration = getRecoveryDuration(recoveryMode);
  const recoveryMessage = getRecoveryMessage(recoveryMode, ruptureType);
  const recoverySteps = buildRecoverySteps(recoveryMode, task || priority, session);
  const momentumStrategy = buildMomentumStrategy(recoveryMode, ruptureType);

  return {
    ok: true,
    engine: 'momentum_recovery_v1',
    rupture_type: ruptureType,
    recovery_mode: recoveryMode,
    recovery_intensity: recoveryIntensity,
    recommended_recovery_duration: recommendedRecoveryDuration,
    should_suggest_break: shouldSuggestBreak(recoveryMode, recoveryIntensity),
    should_suggest_restart: shouldSuggestRestart(recoveryMode, ruptureType),
    recovery_message: recoveryMessage,
    recovery_steps: recoverySteps,
    momentum_strategy: momentumStrategy,
    source: {
      session_id: session.id || session.session_id || null,
      task_id: task.id || priority.id || null,
      task_title: task.title || priority.title || session.task_title || null,
      session_status: normalizeStatus(session.status),
      completion_ratio: calculateCompletionRatio(session),
    },
  };
}

module.exports = {
  analyzeMomentumRecovery,
  detectRuptureType,
  calculateRecoveryIntensity,
  selectRecoveryMode,
  buildRecoverySteps,
  buildMomentumStrategy,
};
