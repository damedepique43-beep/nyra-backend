function clampNumber(value, min, max) {
  const numeric = Number(value);

  if (Number.isNaN(numeric)) return min;

  return Math.max(min, Math.min(max, numeric));
}

function averageNumber(values) {
  const numbers = values.filter(
    value => typeof value === 'number' && !Number.isNaN(value)
  );

  if (!numbers.length) return null;

  return Math.round(
    numbers.reduce((total, value) => total + value, 0) / numbers.length
  );
}

function buildAdaptiveProfile({
  userId,
  focusSessions = [],
  userStates = [],
  actions = [],
}) {
  const completedSessions = focusSessions.filter(
    session => session.status === 'completed'
  );

  const failedSessions = focusSessions.filter(
    session => session.status === 'cancelled'
  );

  const averageFocusDuration = averageNumber(
    completedSessions.map(session =>
      Number(session.focus_duration_min || session.focus_minutes || 0)
    )
  );

  const overwhelmScores = userStates.map(state =>
    Number(state.overwhelm_score || 0)
  );

  const averageOverwhelm = averageNumber(overwhelmScores);

  let preferredFocusDuration = 25;

  if (averageFocusDuration && averageFocusDuration <= 15) {
    preferredFocusDuration = 15;
  } else if (averageFocusDuration && averageFocusDuration >= 40) {
    preferredFocusDuration = 45;
  }

  const completionRate =
    focusSessions.length > 0
      ? completedSessions.length / focusSessions.length
      : 0;

  const overloadThreshold = clampNumber(
    averageOverwhelm || 60,
    30,
    95
  );

  const learnedPatterns = [];

  if (preferredFocusDuration === 15) {
    learnedPatterns.push({
      id: 'micro_focus_better',
      label: 'Les sessions courtes semblent mieux fonctionner.',
    });
  }

  if (preferredFocusDuration === 45) {
    learnedPatterns.push({
      id: 'deep_focus_better',
      label: 'Les longues sessions semblent efficaces.',
    });
  }

  if (completionRate < 0.4 && focusSessions.length >= 3) {
    learnedPatterns.push({
      id: 'high_abandon_rate',
      label: 'Beaucoup de sessions sont interrompues.',
    });
  }

  if ((averageOverwhelm || 0) >= 70) {
    learnedPatterns.push({
      id: 'high_overwhelm_pattern',
      label: 'Surcharge cognitive élevée détectée.',
    });
  }

  const successfulFocusModes = getModeStats(completedSessions);
  const failedFocusModes = getModeStats(failedSessions);

  return {
    id: `adaptive-${userId}`,

    user_id: userId,

    preferred_focus_duration: preferredFocusDuration,

    optimal_focus_window: detectOptimalFocusWindow(completedSessions),

    overload_threshold: overloadThreshold,

    best_energy_periods: detectBestEnergyPeriods(completedSessions),
    worst_energy_periods: detectBestEnergyPeriods(failedSessions),

    successful_focus_modes: successfulFocusModes,

    failed_focus_modes: failedFocusModes,

    interruption_patterns: detectInterruptionPatterns(focusSessions),

    recovery_patterns: detectRecoveryPatterns(focusSessions),

    average_completion_rate: Number(
      completionRate.toFixed(2)
    ),

    average_focus_score: averageOverwhelm,

    learned_patterns: learnedPatterns,

    stats: {
      total_focus_sessions: focusSessions.length,
      completed_focus_sessions:
        completedSessions.length,
      failed_focus_sessions:
        failedSessions.length,
      total_actions: actions.length,
      total_user_states: userStates.length,
    },

    last_learning_update: new Date().toISOString(),

    created_at: new Date().toISOString(),

    updated_at: new Date().toISOString(),
  };
}

function getModeStats(sessions) {
  const counts = {};

  sessions.forEach(session => {
    const mode = session.mode || 'unknown';
    counts[mode] = (counts[mode] || 0) + 1;
  });

  return Object.entries(counts)
    .map(([mode, count]) => ({
      mode,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

function getHourFromIso(value) {
  const date = new Date(value || '');

  if (Number.isNaN(date.getTime())) return null;

  return date.getHours();
}

function getPeriodFromHour(hour) {
  if (hour === null) return 'unknown';
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

function detectOptimalFocusWindow(completedSessions) {
  const periods = detectBestEnergyPeriods(completedSessions);

  return periods[0]?.period || 'unknown';
}

function detectBestEnergyPeriods(sessions) {
  const counts = {};

  sessions.forEach(session => {
    const hour = getHourFromIso(
      session.started_at ||
        session.created_at ||
        session.updated_at
    );

    const period = getPeriodFromHour(hour);
    counts[period] = (counts[period] || 0) + 1;
  });

  return Object.entries(counts)
    .map(([period, count]) => ({
      period,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

function detectInterruptionPatterns(focusSessions) {
  const totalInterruptions = focusSessions.reduce((total, session) => {
    const metadataInterruptions =
      Number(session?.learning_metadata?.metadata_snapshot?.interruption_count || 0);

    const legacyInterruptions = Array.isArray(session.interruptions)
      ? session.interruptions.length
      : 0;

    return total + metadataInterruptions + legacyInterruptions;
  }, 0);

  if (totalInterruptions === 0) return [];

  return [
    {
      id: 'interruptions_detected',
      label: 'Des décrochages ont été signalés pendant les sessions.',
      count: totalInterruptions,
    },
  ];
}

function detectRecoveryPatterns(focusSessions) {
  const overloadCount = focusSessions.reduce((total, session) => {
    return total + Number(session?.learning_metadata?.metadata_snapshot?.overload_count || 0);
  }, 0);

  if (overloadCount === 0) return [];

  return [
    {
      id: 'overload_recovery_needed',
      label: 'Des phases de surcharge ont nécessité une réduction en micro-focus.',
      count: overloadCount,
    },
  ];
}

module.exports = {
  buildAdaptiveProfile,
};
