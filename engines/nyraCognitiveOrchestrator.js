function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSignalPriority(priority) {
  const value = normalizeText(priority).toLowerCase();

  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;

  return 0;
}

function getLatestByDate(items, dateFields = ['updated_at', 'created_at']) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return [...items].sort((a, b) => {
    const dateA = dateFields
      .map(field => new Date(a?.[field] || 0).getTime())
      .find(value => !Number.isNaN(value)) || 0;

    const dateB = dateFields
      .map(field => new Date(b?.[field] || 0).getTime())
      .find(value => !Number.isNaN(value)) || 0;

    return dateB - dateA;
  })[0] || null;
}

function buildRegulationMode({ latestUserState, adaptiveProfile, proactiveSignals }) {
  const overwhelmScore = Number(latestUserState?.overwhelm_score || 0);
  const cognitiveLoad = normalizeText(latestUserState?.cognitive_load || '').toLowerCase();
  const energyLevel = normalizeText(latestUserState?.energy_level || '').toLowerCase();
  const focusState = normalizeText(latestUserState?.focus_state || '').toLowerCase();
  const dominantMode = normalizeText(latestUserState?.dominant_mode || '').toLowerCase();

  const hasHighSignal = proactiveSignals.some(signal => {
    return normalizeText(signal.priority).toLowerCase() === 'high';
  });

  if (
    overwhelmScore >= 80 ||
    cognitiveLoad === 'very_high' ||
    dominantMode === 'reduce_load' ||
    hasHighSignal
  ) {
    return {
      mode: 'regulation_first',
      label: 'Régulation prioritaire',
      intensity: 'high',
      instruction: 'Réduire la charge avant de pousser l’exécution.',
    };
  }

  if (
    energyLevel === 'low' ||
    dominantMode === 'recovery'
  ) {
    return {
      mode: 'recovery_support',
      label: 'Récupération douce',
      intensity: 'medium',
      instruction: 'Favoriser les micro-actions et la récupération.',
    };
  }

  if (
    focusState === 'focused' &&
    overwhelmScore < 55
  ) {
    return {
      mode: 'execution_support',
      label: 'Exécution accompagnée',
      intensity: 'positive',
      instruction: 'Aider à avancer sans multiplier les objectifs.',
    };
  }

  if (
    focusState === 'fragmented' ||
    focusState === 'scattered'
  ) {
    return {
      mode: 'clarification_support',
      label: 'Clarification cognitive',
      intensity: 'medium',
      instruction: 'Simplifier, regrouper, réduire le nombre de choix.',
    };
  }

  return {
    mode: 'steady_support',
    label: 'Soutien stable',
    intensity: 'low',
    instruction: 'Maintenir un rythme simple et clair.',
  };
}

function buildPhysiologicalRegulationHints({ latestUserState, proactiveSignals }) {
  const hints = [];

  const overwhelmScore = Number(latestUserState?.overwhelm_score || 0);
  const energyLevel = normalizeText(latestUserState?.energy_level || '').toLowerCase();
  const cognitiveLoad = normalizeText(latestUserState?.cognitive_load || '').toLowerCase();

  if (overwhelmScore >= 75 || cognitiveLoad === 'very_high') {
    hints.push({
      id: 'pause_needed',
      type: 'pause',
      label: 'Pause courte conseillée',
      message: 'Faire une pause de 2 à 5 minutes avant de continuer.',
    });
  }

  if (energyLevel === 'low') {
    hints.push({
      id: 'energy_low_check',
      type: 'body_check',
      label: 'Énergie basse',
      message: 'Vérifier eau, nourriture, fatigue ou besoin de ralentir.',
    });
  }

  const hasOverwhelmSignal = proactiveSignals.some(signal => {
    return signal.type === 'overwhelm';
  });

  if (hasOverwhelmSignal) {
    hints.push({
      id: 'reduce_stimulation',
      type: 'stimulation',
      label: 'Réduire la stimulation',
      message: 'Limiter les nouvelles décisions et revenir à une seule action visible.',
    });
  }

  return hints.slice(0, 3);
}

function buildExecutionGuidance({ regulationMode, latestUserState, adaptiveProfile }) {
  const preferredFocusDuration = Number(adaptiveProfile?.preferred_focus_duration || 25);
  const overwhelmScore = Number(latestUserState?.overwhelm_score || 0);

  if (regulationMode.mode === 'regulation_first') {
    return {
      execution_mode: 'micro_action_only',
      recommended_focus_minutes: 5,
      max_visible_actions: 1,
      guidance: 'Ne proposer qu’une micro-action. Pas de gros plan maintenant.',
    };
  }

  if (regulationMode.mode === 'recovery_support') {
    return {
      execution_mode: 'gentle_restart',
      recommended_focus_minutes: Math.min(preferredFocusDuration, 15),
      max_visible_actions: 1,
      guidance: 'Relancer doucement sans pression de performance.',
    };
  }

  if (regulationMode.mode === 'clarification_support') {
    return {
      execution_mode: 'clarify_then_act',
      recommended_focus_minutes: Math.min(preferredFocusDuration, 25),
      max_visible_actions: 2,
      guidance: 'Clarifier avant d’exécuter. Réduire les choix.',
    };
  }

  if (regulationMode.mode === 'execution_support' && overwhelmScore < 45) {
    return {
      execution_mode: 'focused_execution',
      recommended_focus_minutes: preferredFocusDuration,
      max_visible_actions: 3,
      guidance: 'Avancer sur une priorité claire sans ouvrir de nouveau sujet.',
    };
  }

  return {
    execution_mode: 'standard_support',
    recommended_focus_minutes: preferredFocusDuration,
    max_visible_actions: 2,
    guidance: 'Garder un rythme simple et stable.',
  };
}

function buildCognitiveSummary({
  latestUserState,
  adaptiveProfile,
  proactiveSignals,
  regulationMode,
  executionGuidance,
  physiologicalHints,
}) {
  const mainSignal = proactiveSignals[0] || null;

  return {
    cognitive_load: latestUserState?.cognitive_load || 'unknown',
    emotional_state: latestUserState?.emotional_state || 'unknown',
    energy_level: latestUserState?.energy_level || 'unknown',
    focus_state: latestUserState?.focus_state || 'unknown',
    overwhelm_score: latestUserState?.overwhelm_score ?? null,
    dominant_mode: latestUserState?.dominant_mode || 'unknown',
    regulation_mode: regulationMode.mode,
    regulation_label: regulationMode.label,
    execution_mode: executionGuidance.execution_mode,
    recommended_focus_minutes: executionGuidance.recommended_focus_minutes,
    main_signal: mainSignal
      ? {
          id: mainSignal.id,
          type: mainSignal.type,
          priority: mainSignal.priority,
          title: mainSignal.title,
          recommendation: mainSignal.recommendation,
        }
      : null,
    physiological_hint_count: physiologicalHints.length,
    adaptive_profile_summary: {
      preferred_focus_duration: adaptiveProfile?.preferred_focus_duration || null,
      overload_threshold: adaptiveProfile?.overload_threshold || null,
      average_completion_rate: adaptiveProfile?.average_completion_rate ?? null,
      learned_patterns: adaptiveProfile?.learned_patterns || [],
    },
  };
}

function buildNyraCognitiveOrchestration({
  userId,
  latestUserState = null,
  adaptiveProfile = null,
  proactiveSignals = [],
  focusSessions = [],
  actions = [],
  source = 'backend',
}) {
  const safeSignals = Array.isArray(proactiveSignals)
    ? [...proactiveSignals].sort((a, b) => {
        return normalizeSignalPriority(b.priority) - normalizeSignalPriority(a.priority);
      })
    : [];

  const latestFocusSession = getLatestByDate(focusSessions);
  const latestAction = getLatestByDate(actions);

  const regulationMode = buildRegulationMode({
    latestUserState,
    adaptiveProfile,
    proactiveSignals: safeSignals,
  });

  const physiologicalHints = buildPhysiologicalRegulationHints({
    latestUserState,
    proactiveSignals: safeSignals,
  });

  const executionGuidance = buildExecutionGuidance({
    regulationMode,
    latestUserState,
    adaptiveProfile,
  });

  const summary = buildCognitiveSummary({
    latestUserState,
    adaptiveProfile,
    proactiveSignals: safeSignals,
    regulationMode,
    executionGuidance,
    physiologicalHints,
  });

  return {
    ok: true,
    user_id: userId,
    source,
    generated_at: new Date().toISOString(),

    latest_user_state: latestUserState,
    adaptive_profile: adaptiveProfile,
    proactive_signals: safeSignals,

    regulation_mode: regulationMode,
    physiological_hints: physiologicalHints,
    execution_guidance: executionGuidance,

    latest_focus_session: latestFocusSession,
    latest_action: latestAction,

    summary,
  };
}

module.exports = {
  buildNyraCognitiveOrchestration,
};
