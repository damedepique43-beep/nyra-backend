function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeEngineName(value, fallback = 'unknown') {
  const normalized = normalizeText(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildEngineResult({
  engine,
  engineVersion = null,
  output = {},
  nextEngine = null,
  behaviorChanged = false,
  metadata = {},
  ok = true,
  error = null,
} = {}) {
  const normalizedEngine = normalizeEngineName(engine);
  const normalizedNextEngine = nextEngine === null || nextEngine === undefined
    ? null
    : normalizeEngineName(nextEngine, null);
  const safeOutput = normalizeObject(output);

  return {
    ok: Boolean(ok) && !error,
    engine: normalizedEngine,
    engine_version: normalizeText(engineVersion || ''),
    output: safeOutput,
    next_engine: normalizedNextEngine,
    behavior_changed: Boolean(behaviorChanged),
    metadata: normalizeObject(metadata),
    error: error
      ? {
          message: normalizeText(error.message || error),
          engine: normalizedEngine,
        }
      : null,
    generated_at: new Date().toISOString(),
  };
}

function normalizeEngineResult({
  engineResult,
  fallbackEngine = 'unknown',
  fallbackVersion = '',
  defaultNextEngine = null,
} = {}) {
  const safeResult = normalizeObject(engineResult);
  const hasStandardOutput = safeResult.output && typeof safeResult.output === 'object' && !Array.isArray(safeResult.output);
  const output = hasStandardOutput
    ? safeResult.output
    : Object.fromEntries(
        Object.entries(safeResult).filter(([key]) => {
          return ![
            'ok',
            'engine',
            'engine_version',
            'output',
            'next_engine',
            'behavior_changed',
            'metadata',
            'error',
            'generated_at',
          ].includes(key);
        })
      );

  const contract = buildEngineResult({
    engine: safeResult.engine || fallbackEngine,
    engineVersion: safeResult.engine_version || fallbackVersion,
    output,
    nextEngine: safeResult.next_engine === undefined ? defaultNextEngine : safeResult.next_engine,
    behaviorChanged: Boolean(safeResult.behavior_changed),
    metadata: safeResult.metadata || {},
    ok: safeResult.ok !== false,
    error: safeResult.error || null,
  });

  return {
    ...safeResult,
    ...contract,
  };
}

module.exports = {
  buildEngineResult,
  normalizeEngineResult,
};
