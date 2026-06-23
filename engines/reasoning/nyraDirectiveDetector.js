function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function includesAny(value, patterns = []) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (!normalizedValue) return false;

  return normalizeArray(patterns).some(pattern => {
    return normalizedValue.includes(normalizeText(pattern).toLowerCase());
  });
}

function getPrimaryIntent(understanding = {}) {
  const intent = normalizeObject(understanding.intent);
  return normalizeText(intent.primary || understanding.primary_intent || 'capture_note') || 'capture_note';
}

function getUnderstandingText(understanding = {}) {
  const intent = normalizeObject(understanding.intent);
  const metadata = normalizeObject(understanding.metadata);

  return normalizeText(
    understanding.raw_text ||
    understanding.text ||
    understanding.message ||
    understanding.user_message ||
    intent.raw_text ||
    intent.text ||
    metadata.raw_text ||
    metadata.text ||
    ''
  );
}

function detectRequestedActionFromText(text = '', primaryIntent = '') {
  const lower = normalizeText(text).toLowerCase();
  const normalizedIntent = normalizeText(primaryIntent).toLowerCase();

  if (
    normalizedIntent === 'create_reminder' ||
    /\b(rappelle[- ]?moi|rappel[- ]?moi|crée un rappel|créer un rappel|cree un rappel)\b/i.test(lower)
  ) {
    return 'create_reminder';
  }

  if (
    /\b(crée|cree|créer|creer|créé|cree|fais|ouvre|lance)\b[\s\S]{0,40}\b(projet)\b/i.test(lower) ||
    /\b(je veux juste que tu|je veux que tu)\b[\s\S]{0,40}\b(crées|crees|crée|cree|créer|creer)\b[\s\S]{0,40}\b(projet)\b/i.test(lower)
  ) {
    return 'create_project';
  }

  if (
    normalizedIntent === 'add_to_collection' ||
    /\b(ajoute|rajoute|mets|note)\b[\s\S]{0,80}\b(liste|collection|courses)\b/i.test(lower)
  ) {
    return 'add_to_collection';
  }

  if (
    normalizedIntent === 'create_task' ||
    /\b(crée|cree|créer|creer|ajoute|transforme)\b[\s\S]{0,60}\b(tâche|tache|action)\b/i.test(lower)
  ) {
    return 'create_task';
  }

  return null;
}

function detectDirectiveFromUnderstanding(understanding = {}) {
  // Directive Detection V1
  // Responsabilité : distinguer une commande explicite de l'utilisateur
  // d'un besoin cognitif général. Ce composant reste interne au Reasoning Engine.
  // En V1, il empêche surtout une intervention Brain Dump de remplacer
  // une action explicitement demandée.
  const primaryIntent = getPrimaryIntent(understanding);
  const text = getUnderstandingText(understanding);
  const requestedAction = detectRequestedActionFromText(text, primaryIntent);
  const lower = normalizeText(text).toLowerCase();
  const explicitlyAsksBrainDump = includesAny(lower, [
    'brain dump',
    'braindump',
    'vide mon cerveau',
    'vider mon cerveau',
    'déverse',
    'deverse',
    'j ai trop de choses dans la tête',
    "j'ai trop de choses dans la tête",
    'j ai trop de choses en tête',
    "j'ai trop de choses en tête",
  ]);

  if (requestedAction) {
    return {
      contract: 'directive-detection-v1',
      behavior_impact: 'reasoning_guardrail_only',
      available: true,
      directive_type: 'explicit_action',
      requested_action: requestedAction,
      override_cognitive_intervention: true,
      allow_brain_dump: false,
      allow_clarification: true,
      reason: 'explicit_user_command',
      evidence: {
        primary_intent: primaryIntent,
        text_preview: text.slice(0, 180),
      },
      generated_at: new Date().toISOString(),
    };
  }

  if (explicitlyAsksBrainDump) {
    return {
      contract: 'directive-detection-v1',
      behavior_impact: 'reasoning_guardrail_only',
      available: true,
      directive_type: 'free_externalization',
      requested_action: null,
      override_cognitive_intervention: false,
      allow_brain_dump: true,
      allow_clarification: true,
      reason: 'explicit_externalization_request',
      evidence: {
        primary_intent: primaryIntent,
        text_preview: text.slice(0, 180),
      },
      generated_at: new Date().toISOString(),
    };
  }

  return {
    contract: 'directive-detection-v1',
    behavior_impact: 'none',
    available: Boolean(text || primaryIntent),
    directive_type: 'implicit_context',
    requested_action: null,
    override_cognitive_intervention: false,
    allow_brain_dump: true,
    allow_clarification: true,
    reason: 'no_explicit_action_directive',
    evidence: {
      primary_intent: primaryIntent,
      text_preview: text.slice(0, 180),
    },
    generated_at: new Date().toISOString(),
  };
}

function getDirectiveDominantNeed(directiveDetection = {}) {
  const requestedAction = normalizeText(directiveDetection.requested_action || '');

  if (requestedAction === 'create_reminder') return 'prevent_forgetting';
  if (requestedAction === 'create_project') return 'structure_idea';
  if (requestedAction === 'add_to_collection') return 'organize_information';
  if (requestedAction === 'create_task') return 'prepare_action';

  return null;
}

module.exports = {
  detectDirectiveFromUnderstanding,
  getDirectiveDominantNeed,
};
