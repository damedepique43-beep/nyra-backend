function buildProactiveSignals({
  adaptiveProfile = null,
  latestUserState = null,
  focusSessions = [],
  actions = [],
}) {
  const signals = [];

  const overwhelmScore = Number(
    latestUserState?.overwhelm_score || 0
  );

  const cognitiveLoad = String(
    latestUserState?.cognitive_load || ''
  ).toLowerCase();

  const completionRate = Number(
    adaptiveProfile?.average_completion_rate || 0
  );

  const preferredFocusDuration = Number(
    adaptiveProfile?.preferred_focus_duration || 25
  );

  const activeProjects = actions.filter(action =>
    ['suggested', 'executing'].includes(action.status)
  );

  if (
    overwhelmScore >= 75 ||
    cognitiveLoad === 'very_high'
  ) {
    signals.push({
      id: 'high_overwhelm_detected',
      priority: 'high',
      type: 'overwhelm',
      title: 'Surcharge détectée',
      message:
        'Tu sembles mentalement saturée. Réduisons la charge.',
      recommendation:
        'Faire seulement une micro-action pendant 5 minutes.',
    });
  }

  if (completionRate < 0.45) {
    signals.push({
      id: 'high_abandon_risk',
      priority: 'medium',
      type: 'focus',
      title: 'Risque de décrochage',
      message:
        'Les longues sessions semblent difficiles en ce moment.',
      recommendation:
        'Privilégier des micro-focus.',
    });
  }

  if (preferredFocusDuration <= 15) {
    signals.push({
      id: 'micro_focus_profile',
      priority: 'low',
      type: 'adaptive_profile',
      title: 'Profil micro-focus détecté',
      message:
        'Ton cerveau semble mieux fonctionner avec des sessions courtes.',
      recommendation:
        'Fractionner les tâches en petits blocs.',
    });
  }

  if (activeProjects.length >= 4) {
    signals.push({
      id: 'too_many_active_projects',
      priority: 'medium',
      type: 'organization',
      title: 'Trop de projets actifs',
      message:
        'Tu as beaucoup de charge simultanée.',
      recommendation:
        'Finir ou suspendre un projet avant d’en ouvrir un autre.',
    });
  }

  const recentCancelledSessions = focusSessions.filter(
    session =>
      session.status === 'cancelled'
  );

  if (recentCancelledSessions.length >= 3) {
    signals.push({
      id: 'repeated_focus_failures',
      priority: 'medium',
      type: 'focus_pattern',
      title: 'Interruptions fréquentes',
      message:
        'Plusieurs sessions focus ont été interrompues récemment.',
      recommendation:
        'Réduire temporairement les objectifs.',
    });
  }

  return signals.sort((a, b) => {
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
  buildProactiveSignals,
};
