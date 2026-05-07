function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueByKey(items, keyGetter) {
  const seen = new Set();
  const result = [];

  items.forEach(item => {
    const key = keyGetter(item);

    if (!key || seen.has(key)) return;

    seen.add(key);
    result.push(item);
  });

  return result;
}

function createGraphNode({ userId, type, key, label, metadata = {} }) {
  return {
    id: `${type}:${key}`,
    user_id: userId,
    type,
    key,
    label,
    metadata,
    weight: 1,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  };
}

function createGraphEdge({
  userId,
  sourceId,
  targetId,
  relationType,
  weight = 1,
  confidence = 0.65,
  evidence = [],
  metadata = {},
}) {
  return {
    id: `${sourceId}->${relationType}->${targetId}`,
    user_id: userId,
    source_id: sourceId,
    target_id: targetId,
    relation_type: relationType,
    weight,
    confidence,
    evidence,
    metadata,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  };
}

function detectEmotionTags(text) {
  const lower = normalizeText(text).toLowerCase();

  const emotions = [];

  const map = [
    {
      key: 'stress',
      label: 'Stress',
      words: ['stress', 'stressée', 'stressé', 'angoisse', 'angoissée', 'panique'],
    },
    {
      key: 'fatigue',
      label: 'Fatigue',
      words: ['fatigue', 'fatiguée', 'fatigué', 'épuisée', 'épuisé', 'crevée'],
    },
    {
      key: 'overwhelm',
      label: 'Surcharge',
      words: ['surcharge', 'débordée', 'submergée', 'trop', 'charge mentale'],
    },
    {
      key: 'motivation',
      label: 'Motivation',
      words: ['motivée', 'motivé', 'envie', 'élan', 'on avance', 'allons y'],
    },
    {
      key: 'blocage',
      label: 'Blocage',
      words: ['bloquée', 'bloqué', 'j’arrive pas', "j'arrive pas", 'je repousse', 'procrastine'],
    },
  ];

  map.forEach(item => {
    if (item.words.some(word => lower.includes(word))) {
      emotions.push({
        key: item.key,
        label: item.label,
      });
    }
  });

  return emotions;
}

function getTimePeriod(dateValue) {
  const date = new Date(dateValue || '');

  if (Number.isNaN(date.getTime())) return 'unknown';

  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';

  return 'night';
}

function getTimePeriodLabel(period) {
  if (period === 'morning') return 'Matin';
  if (period === 'afternoon') return 'Après-midi';
  if (period === 'evening') return 'Soir';
  if (period === 'night') return 'Nuit';
  return 'Moment inconnu';
}

function upsertNode(nodes, node) {
  const existing = nodes.find(item => item.id === node.id);

  if (!existing) {
    nodes.push(node);
    return node;
  }

  existing.weight = Number(existing.weight || 0) + 1;
  existing.last_seen_at = new Date().toISOString();
  existing.label = existing.label || node.label;
  existing.metadata = {
    ...(existing.metadata || {}),
    ...(node.metadata || {}),
  };

  return existing;
}

function upsertEdge(edges, edge) {
  const existing = edges.find(item => item.id === edge.id);

  if (!existing) {
    edges.push(edge);
    return edge;
  }

  existing.weight = Number(existing.weight || 0) + Number(edge.weight || 1);
  existing.confidence = Math.min(
    0.99,
    Math.max(Number(existing.confidence || 0), Number(edge.confidence || 0))
  );
  existing.last_seen_at = new Date().toISOString();
  existing.evidence = uniqueByKey(
    [...(existing.evidence || []), ...(edge.evidence || [])].slice(-20),
    item => item.id || item.source_id || JSON.stringify(item)
  );
  existing.metadata = {
    ...(existing.metadata || {}),
    ...(edge.metadata || {}),
  };

  return existing;
}

function buildCognitiveMemoryGraph({
  userId,
  items = [],
  actions = [],
  projects = [],
  userStates = [],
  focusSessions = [],
  proactiveEvents = [],
  timelineEvents = [],
}) {
  const nodes = [];
  const edges = [];

  projects.forEach(project => {
    const key = normalizeKey(project.name || project.key || project.id);

    if (!key) return;

    upsertNode(
      nodes,
      createGraphNode({
        userId,
        type: 'project',
        key,
        label: project.name || key,
        metadata: {
          project_id: project.id,
          status: project.status || null,
        },
      })
    );
  });

  items.forEach(item => {
    const itemKey = normalizeKey(item.id || item.title || item.content);

    if (!itemKey) return;

    const itemNode = upsertNode(
      nodes,
      createGraphNode({
        userId,
        type: item.type || item.bucket || 'memory_item',
        key: itemKey,
        label: item.title || item.content || 'Capture Nyra',
        metadata: {
          item_id: item.id,
          bucket: item.bucket || null,
          priority: item.priority || null,
          urgency: item.urgency || null,
        },
      })
    );

    if (item.project_name || item.project_id) {
      const projectKey = normalizeKey(item.project_name || item.project_id);
      const projectNode = upsertNode(
        nodes,
        createGraphNode({
          userId,
          type: 'project',
          key: projectKey,
          label: item.project_name || 'Projet détecté',
          metadata: {
            project_id: item.project_id || null,
          },
        })
      );

      upsertEdge(
        edges,
        createGraphEdge({
          userId,
          sourceId: itemNode.id,
          targetId: projectNode.id,
          relationType: 'belongs_to_project',
          confidence: 0.9,
          evidence: [
            {
              id: item.id,
              type: 'item',
              preview: item.content || item.title || '',
            },
          ],
        })
      );
    }

    const emotionTags = detectEmotionTags(`${item.title || ''} ${item.content || ''}`);

    emotionTags.forEach(emotion => {
      const emotionNode = upsertNode(
        nodes,
        createGraphNode({
          userId,
          type: 'emotion_signal',
          key: emotion.key,
          label: emotion.label,
        })
      );

      upsertEdge(
        edges,
        createGraphEdge({
          userId,
          sourceId: itemNode.id,
          targetId: emotionNode.id,
          relationType: 'contains_emotional_signal',
          confidence: 0.72,
          evidence: [
            {
              id: item.id,
              type: 'item',
              preview: item.content || item.title || '',
            },
          ],
        })
      );

      if (item.project_name || item.project_id) {
        const projectKey = normalizeKey(item.project_name || item.project_id);

        upsertEdge(
          edges,
          createGraphEdge({
            userId,
            sourceId: `project:${projectKey}`,
            targetId: emotionNode.id,
            relationType: 'associated_with_emotion',
            confidence: 0.62,
            evidence: [
              {
                id: item.id,
                type: 'item_project_emotion',
                preview: item.content || item.title || '',
              },
            ],
          })
        );
      }
    });
  });

  actions.forEach(action => {
    const actionKey = normalizeKey(action.id || action.title || action.target);

    if (!actionKey) return;

    const actionNode = upsertNode(
      nodes,
      createGraphNode({
        userId,
        type: 'action',
        key: actionKey,
        label: action.title || action.label || 'Action Nyra',
        metadata: {
          action_id: action.id,
          status: action.status || null,
          action_type: action.action_type || action.type || null,
          priority: action.priority || null,
        },
      })
    );

    if (action.project_name || action.project_id) {
      const projectKey = normalizeKey(action.project_name || action.project_id);
      const projectNode = upsertNode(
        nodes,
        createGraphNode({
          userId,
          type: 'project',
          key: projectKey,
          label: action.project_name || 'Projet détecté',
          metadata: {
            project_id: action.project_id || null,
          },
        })
      );

      upsertEdge(
        edges,
        createGraphEdge({
          userId,
          sourceId: actionNode.id,
          targetId: projectNode.id,
          relationType: 'action_for_project',
          confidence: 0.88,
          evidence: [
            {
              id: action.id,
              type: 'action',
              preview: action.title || action.target || '',
            },
          ],
        })
      );
    }

    if (['failed', 'cancelled'].includes(action.status)) {
      const frictionNode = upsertNode(
        nodes,
        createGraphNode({
          userId,
          type: 'execution_signal',
          key: 'execution_friction',
          label: 'Friction d’exécution',
        })
      );

      upsertEdge(
        edges,
        createGraphEdge({
          userId,
          sourceId: actionNode.id,
          targetId: frictionNode.id,
          relationType: 'may_indicate_friction',
          confidence: 0.68,
          evidence: [
            {
              id: action.id,
              type: 'action_status',
              status: action.status,
            },
          ],
        })
      );
    }
  });

  userStates.forEach(state => {
    const period = getTimePeriod(state.created_at || state.updated_at);
    const periodNode = upsertNode(
      nodes,
      createGraphNode({
        userId,
        type: 'time_period',
        key: period,
        label: getTimePeriodLabel(period),
      })
    );

    const stateNode = upsertNode(
      nodes,
      createGraphNode({
        userId,
        type: 'cognitive_state',
        key: normalizeKey(`${state.cognitive_load}-${state.focus_state}-${state.emotional_state}`),
        label: `${state.cognitive_load || 'charge'} / ${state.focus_state || 'focus'}`,
        metadata: {
          cognitive_load: state.cognitive_load || null,
          focus_state: state.focus_state || null,
          emotional_state: state.emotional_state || null,
          overwhelm_score: state.overwhelm_score ?? null,
        },
      })
    );

    upsertEdge(
      edges,
      createGraphEdge({
        userId,
        sourceId: periodNode.id,
        targetId: stateNode.id,
        relationType: 'time_associated_with_state',
        confidence: 0.58,
        evidence: [
          {
            id: state.id,
            type: 'user_state',
            overwhelm_score: state.overwhelm_score,
          },
        ],
      })
    );

    if (Number(state.overwhelm_score || 0) >= 70) {
      const overloadNode = upsertNode(
        nodes,
        createGraphNode({
          userId,
          type: 'cognitive_signal',
          key: 'high_overwhelm',
          label: 'Surcharge élevée',
        })
      );

      upsertEdge(
        edges,
        createGraphEdge({
          userId,
          sourceId: stateNode.id,
          targetId: overloadNode.id,
          relationType: 'indicates',
          confidence: 0.82,
          evidence: [
            {
              id: state.id,
              type: 'user_state_overwhelm',
              overwhelm_score: state.overwhelm_score,
            },
          ],
        })
      );
    }
  });

  focusSessions.forEach(session => {
    const modeKey = normalizeKey(session.mode || 'focus');
    const modeNode = upsertNode(
      nodes,
      createGraphNode({
        userId,
        type: 'focus_mode',
        key: modeKey,
        label: session.mode_label || session.mode || 'Focus',
      })
    );

    const resultKey = session.status === 'completed'
      ? 'focus_success'
      : session.status === 'cancelled'
        ? 'focus_cancelled'
        : 'focus_in_progress';

    const resultNode = upsertNode(
      nodes,
      createGraphNode({
        userId,
        type: 'focus_result',
        key: resultKey,
        label:
          resultKey === 'focus_success'
            ? 'Session terminée'
            : resultKey === 'focus_cancelled'
              ? 'Session annulée'
              : 'Session en cours',
      })
    );

    upsertEdge(
      edges,
      createGraphEdge({
        userId,
        sourceId: modeNode.id,
        targetId: resultNode.id,
        relationType: 'produces_focus_result',
        confidence: 0.66,
        evidence: [
          {
            id: session.id,
            type: 'focus_session',
            status: session.status,
          },
        ],
      })
    );
  });

  proactiveEvents.forEach(event => {
    (event.signals || []).forEach(signal => {
      const signalKey = normalizeKey(signal.id || signal.title || signal.type);

      if (!signalKey) return;

      const signalNode = upsertNode(
        nodes,
        createGraphNode({
          userId,
          type: 'proactive_signal',
          key: signalKey,
          label: signal.title || signal.type || 'Signal proactif',
          metadata: {
            priority: signal.priority || null,
            type: signal.type || null,
          },
        })
      );

      if (signal.type === 'overwhelm') {
        const overloadNode = upsertNode(
          nodes,
          createGraphNode({
            userId,
            type: 'cognitive_signal',
            key: 'high_overwhelm',
            label: 'Surcharge élevée',
          })
        );

        upsertEdge(
          edges,
          createGraphEdge({
            userId,
            sourceId: signalNode.id,
            targetId: overloadNode.id,
            relationType: 'confirms',
            confidence: 0.78,
            evidence: [
              {
                id: event.id,
                type: 'proactive_event',
                signal_id: signal.id || null,
              },
            ],
          })
        );
      }
    });
  });

  timelineEvents.forEach(event => {
    (event.insights || []).forEach(insight => {
      const insightKey = normalizeKey(insight.id || insight.title || insight.type);

      if (!insightKey) return;

      upsertNode(
        nodes,
        createGraphNode({
          userId,
          type: 'timeline_insight',
          key: insightKey,
          label: insight.title || insight.type || 'Insight temporel',
          metadata: {
            priority: insight.priority || null,
            type: insight.type || null,
          },
        })
      );
    });
  });

  const sortedNodes = nodes.sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
  const sortedEdges = edges.sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));

  return {
    id: `memory-graph-${userId}`,
    user_id: userId,
    nodes: sortedNodes.slice(0, 250),
    edges: sortedEdges.slice(0, 500),
    stats: {
      node_count: sortedNodes.length,
      edge_count: sortedEdges.length,
      project_nodes: sortedNodes.filter(node => node.type === 'project').length,
      emotion_nodes: sortedNodes.filter(node => node.type === 'emotion_signal').length,
      cognitive_signal_nodes: sortedNodes.filter(node => node.type === 'cognitive_signal').length,
      strongest_relations: sortedEdges.slice(0, 5).map(edge => ({
        source_id: edge.source_id,
        target_id: edge.target_id,
        relation_type: edge.relation_type,
        weight: edge.weight,
      })),
    },
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function buildMemoryGraphInsights(graph) {
  const insights = [];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  const overloadNode = nodes.find(node => node.id === 'cognitive_signal:high_overwhelm');

  if (overloadNode && Number(overloadNode.weight || 0) >= 3) {
    insights.push({
      id: 'overload_is_recurrent',
      priority: 'high',
      title: 'Surcharge récurrente',
      message: 'Nyra voit que la surcharge revient souvent dans ta mémoire récente.',
      recommendation: 'Réduire les projets visibles et privilégier les micro-actions.',
    });
  }

  const projectEmotionEdges = edges.filter(edge => edge.relation_type === 'associated_with_emotion');

  if (projectEmotionEdges.length > 0) {
    insights.push({
      id: 'project_emotion_links_detected',
      priority: 'medium',
      title: 'Liens projet / émotion détectés',
      message: 'Certains projets semblent associés à des signaux émotionnels.',
      recommendation: 'Observer quels projets chargent le plus ton système nerveux.',
    });
  }

  const focusEdges = edges.filter(edge => edge.relation_type === 'produces_focus_result');

  if (focusEdges.length > 0) {
    insights.push({
      id: 'focus_result_links_detected',
      priority: 'low',
      title: 'Résultats focus reliés',
      message: 'Nyra commence à relier tes modes de focus à leurs résultats.',
      recommendation: 'Continuer les sessions pour affiner l’apprentissage.',
    });
  }

  return insights;
}

module.exports = {
  buildCognitiveMemoryGraph,
  buildMemoryGraphInsights,
};
