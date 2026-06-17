function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeEngineName(value, fallback = 'understanding') {
  const normalized = normalizeText(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function normalizeCompletedEngines(completedEngines) {
  if (!Array.isArray(completedEngines)) return [];

  return [
    ...new Set(
      completedEngines
        .map(engine => normalizeEngineName(engine, ''))
        .filter(Boolean)
    ),
  ];
}

function createEngineRegistry(engines = {}) {
  const registry = {};

  Object.entries(engines || {}).forEach(([engineName, engine]) => {
    const normalizedName = normalizeEngineName(engineName, '');

    if (!normalizedName || !engine) return;

    registry[normalizedName] = engine;
  });

  return registry;
}

function resolvePipelineEngine({ pipelineContext, registry }) {
  const currentEngine = normalizeEngineName(
    pipelineContext?.current_engine || pipelineContext?.next_engine || 'understanding'
  );

  const engine = registry?.[currentEngine] || null;

  return {
    current_engine: currentEngine,
    engine,
  };
}

function buildPipelineRunnerResult({
  thought,
  pipelineContext,
  currentEngine,
  engineResult = null,
  completed = false,
  nextEngine = null,
  status = 'ready',
  error = null,
}) {
  const completedEngines = normalizeCompletedEngines(pipelineContext?.completed_engines || []);
  const normalizedCurrentEngine = normalizeEngineName(currentEngine || pipelineContext?.current_engine || 'understanding');
  const normalizedNextEngine = nextEngine === null ? null : normalizeEngineName(nextEngine, normalizedCurrentEngine);
  const updatedCompletedEngines = completed
    ? [...new Set([...completedEngines, normalizedCurrentEngine])]
    : completedEngines;

  return {
    ok: !error,
    thought,
    engine_result: engineResult,
    pipeline: {
      ...(pipelineContext && typeof pipelineContext === 'object' ? pipelineContext : {}),
      thought_id: thought?.id || pipelineContext?.thought_id || null,
      status: error ? 'failed' : status,
      current_engine: normalizedNextEngine || normalizedCurrentEngine,
      completed_engines: updatedCompletedEngines,
      next_engine: normalizedNextEngine,
      behavior_changed: false,
      error: error
        ? {
            message: normalizeText(error.message || error),
            engine: normalizedCurrentEngine,
          }
        : null,
      updated_at: new Date().toISOString(),
    },
    generated_at: new Date().toISOString(),
  };
}

async function runPipelineStep({
  thought,
  pipelineContext,
  registry = {},
  sharedContext = {},
} = {}) {
  const safeRegistry = createEngineRegistry(registry);
  const resolved = resolvePipelineEngine({
    pipelineContext,
    registry: safeRegistry,
  });

  if (!resolved.engine) {
    return buildPipelineRunnerResult({
      thought,
      pipelineContext,
      currentEngine: resolved.current_engine,
      engineResult: null,
      completed: false,
      nextEngine: resolved.current_engine,
      status: 'waiting_for_engine',
      error: null,
    });
  }

  try {
    const engineRunner = typeof resolved.engine === 'function'
      ? resolved.engine
      : resolved.engine.run;

    if (typeof engineRunner !== 'function') {
      return buildPipelineRunnerResult({
        thought,
        pipelineContext,
        currentEngine: resolved.current_engine,
        engineResult: null,
        completed: false,
        nextEngine: resolved.current_engine,
        status: 'invalid_engine',
        error: new Error(`Engine ${resolved.current_engine} is not runnable.`),
      });
    }

    const engineResult = await engineRunner({
      thought,
      pipeline: pipelineContext,
      context: sharedContext,
    });

    return buildPipelineRunnerResult({
      thought,
      pipelineContext,
      currentEngine: resolved.current_engine,
      engineResult,
      completed: true,
      nextEngine: engineResult?.next_engine || null,
      status: engineResult?.next_engine ? 'ready' : 'completed',
      error: null,
    });
  } catch (error) {
    return buildPipelineRunnerResult({
      thought,
      pipelineContext,
      currentEngine: resolved.current_engine,
      engineResult: null,
      completed: false,
      nextEngine: resolved.current_engine,
      status: 'failed',
      error,
    });
  }
}


async function runPipeline({
  thought,
  pipelineContext,
  registry = {},
  sharedContext = {},
  maxSteps = 6,
} = {}) {
  const steps = [];
  const engineResults = {};
  let currentPipelineContext = pipelineContext;
  let lastStep = null;

  for (let index = 0; index < maxSteps; index += 1) {
    const step = await runPipelineStep({
      thought,
      pipelineContext: currentPipelineContext,
      registry,
      sharedContext: {
        ...(sharedContext && typeof sharedContext === 'object' ? sharedContext : {}),
        engine_results: engineResults,
        pipeline_steps: steps,
      },
    });

    steps.push(step);
    lastStep = step;

    if (step?.engine_result?.engine) {
      engineResults[step.engine_result.engine] = step.engine_result;
    }

    currentPipelineContext = step?.pipeline || currentPipelineContext;

    if (!step?.ok || !currentPipelineContext?.next_engine) {
      break;
    }
  }

  return {
    ok: Boolean(lastStep?.ok ?? true),
    thought,
    pipeline: currentPipelineContext,
    steps,
    engine_results: engineResults,
    last_step: lastStep,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  createEngineRegistry,
  runPipelineStep,
  runPipeline,
};
