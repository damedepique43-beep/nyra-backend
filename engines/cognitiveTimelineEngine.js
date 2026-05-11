function average(values = []) {
  if (!values.length) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + Number(value || 0), 0) /
    values.length
  );
}

function getDayKey(dateValue) {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  return date.toISOString().split('T')[0];
}

function buildTimelineInsights({
  userStates = [],
  focusSessions = [],
  proactiveEvents = [],
}) {
  const insights = [];

  const recentStates = [...userStates]
    .sort((a, b) => {
      return (
        new Date(a.created_at).getTime() -
        new Date(b.created_at).getTime()
      );
    })
    .slice(-14);

  if (recentStates.length >= 3) {
    const overwhelmScores = recentStates.map(
      state => Number(state.overwhelm_score || 0)
    );

    const firstAverage = average(
      overwhelmScores.slice(0, Math.floor(overwhelmScores.length / 2))
    );

    const lastAverage = average(
      overwhelmScores.slice(Math.floor(overwhelmScores.length / 2))
    );

    const delta = Math.round(lastAverage - firstAverage);

    if (delta >= 12) {
      insights.push({
        id: 'overwhelm_increasing',
        type: 'trend',
        priority: 'high',
        title: 'Surcharge en augmentation',
        message:
          'Ta charge cognitive semble augmenter ces derniers jours.',
        recommendation:
          'Réduire les objectifs actifs et prioriser la récupération.',
        delta,
      });
    }

    if (delta <= -12) {
      insights.push({
        id: 'overwhelm_improving',
        type: 'recovery',
        priority: 'medium',
        title: 'Amélioration cognitive détectée',
        message:
          'Ta surcharge semble diminuer progressivement.',
        recommendation:
          'Conserver le rythme actuel sans surcharger.',
        delta,
      });
    }
  }

  const completedSessions = focusSessions.filter(
    session => session.status === 'completed'
  );

  const cancelledSessions = focusSessions.filter(
    session => session.status === 'cancelled'
  );

  if (
    cancelledSessions.length >= 3 &&
    cancelledSessions.length > completedSessions.length
  ) {
    insights.push({
      id: 'focus_instability',
      type: 'focus_pattern',
      priority: 'medium',
      title: 'Instabilité focus détectée',
      message:
        'Les interruptions sont plus fréquentes que les sessions terminées.',
      recommendation:
        'Réduire temporairement les durées de focus.',
    });
  }

  const focusByDay = {};

  completedSessions.forEach(session => {
    const dayKey = getDayKey(
      session.completed_at ||
        session.updated_at ||
        session.created_at
    );

    if (!focusByDay[dayKey]) {
      focusByDay[dayKey] = 0;
    }

    focusByDay[dayKey] += 1;
  });

  const productiveDays = Object.entries(focusByDay)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  if (productiveDays.length > 0) {
    insights.push({
      id: 'productive_days_detected',
      type: 'performance',
      priority: 'low',
      title: 'Moments productifs détectés',
      message:
        'Nyra commence à identifier tes journées les plus efficaces.',
      recommendation:
        'Observer les habitudes associées à ces journées.',
      productive_days: productiveDays,
    });
  }

  const overwhelmSignals = proactiveEvents.filter(event =>
    event?.signals?.some(
      signal => signal.type === 'overwhelm'
    )
  );

  if (overwhelmSignals.length >= 4) {
    insights.push({
      id: 'repeated_overwhelm_alerts',
      type: 'overload_pattern',
      priority: 'high',
      title: 'Surcharge récurrente détectée',
      message:
        'Nyra détecte des signaux de surcharge répétés.',
      recommendation:
        'Introduire davantage de récupération cognitive.',
    });
  }

  return insights.sort((a, b) => {
    const priorityMap = {
      high: 3,
      medium: 2,
      low: 1,
    };

    return (
      (priorityMap[b.priority] || 0) -
      (priorityMap[a.priority] || 0)
    );
  });
}

module.exports = {
  buildTimelineInsights,
};
