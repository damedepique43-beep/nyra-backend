/**
 * Nyra — Momentum Recovery Engine V1
 */

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function analyzeMomentumRecovery(input = {}) {
  const session = input.session || {};
  const cognitiveState = input.cognitive_state || {};
  const overwhelmScore = clamp(
    Number(cognitiveState.overwhelm_score || 0),
    0,
    100
  );

  let recoveryMode = 'soft_restart';

  if (overwhelmScore >= 85) {
    recoveryMode = 'ultra_micro_restart';
  }

  if (
    cognitiveState.focus_state === 'scattered' ||
    cognitiveState.focus_state === 'fragmented'
  ) {
    recoveryMode = 'guided_re_entry';
  }

  return {
    ok: true,
    engine: 'momentum_recovery_v1',
    recovery_mode: recoveryMode,
    rupture_type: session.status || 'unknown',
    recommended_recovery_duration:
      recoveryMode === 'ultra_micro_restart' ? 7 : 15,
    recovery_steps:
      recoveryMode === 'ultra_micro_restart'
        ? [
            'Faire UNE micro-action.',
            'Ne pas chercher à finir toute la tâche.',
            'Valider le mouvement.'
          ]
        : [
            'Réduire les distractions.',
            'Reprendre une seule action.',
            'Relancer doucement.'
          ],
    momentum_strategy: {
      label:
        recoveryMode === 'ultra_micro_restart'
          ? 'Réduire'
          : 'Relancer',
      instruction:
        recoveryMode === 'ultra_micro_restart'
          ? 'La prochaine action doit être minuscule.'
          : 'Reprendre sans pression.'
    }
  };
}

module.exports = {
  analyzeMomentumRecovery
};
