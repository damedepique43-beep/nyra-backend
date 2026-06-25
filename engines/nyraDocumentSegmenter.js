function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function normalizeSegmentTitle(value, fallback = '') {
  const title = normalizeText(value || fallback);

  if (!title) return '';

  return title
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-–—•*]\s*/, '')
    .replace(/[.:：]+$/g, '')
    .trim()
    .slice(0, 120);
}

function estimateTokens(text) {
  const value = normalizeText(text || '');

  if (!value) return 0;

  return Math.ceil(value.length / 4);
}

function isProbableTitle(line) {
  const value = normalizeText(line || '');

  if (!value) return false;
  if (value.length > 120) return false;
  if (/[.!?]$/.test(value)) return false;

  if (/^#{1,6}\s+/.test(value)) return true;
  if (/^(partie|section|chapitre|module|étape|etape)\s+\d+/i.test(value)) return true;
  if (/^\d{1,2}[.)-]\s+\S+/.test(value)) return true;
  if (/^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ][A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ0-9 '\-]{3,}$/.test(value)) return true;
  if (value.length <= 60 && /[:：]$/.test(line || '')) return true;

  const words = value.split(/\s+/).filter(Boolean);
  const hasFewWords = words.length >= 2 && words.length <= 8;
  const startsWithUppercase = /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ]/.test(value);

  return Boolean(hasFewWords && startsWithUppercase && value.length <= 80);
}

function splitLongParagraph(paragraph, maxCharacters) {
  const normalized = normalizeText(paragraph || '');

  if (!normalized) return [];
  if (normalized.length <= maxCharacters) return [normalized];

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map(sentence => normalizeText(sentence))
    .filter(Boolean);

  if (sentences.length <= 1) {
    const chunks = [];

    for (let index = 0; index < normalized.length; index += maxCharacters) {
      chunks.push(normalized.slice(index, index + maxCharacters).trim());
    }

    return chunks.filter(Boolean);
  }

  const chunks = [];
  let current = '';

  sentences.forEach(sentence => {
    const next = current ? `${current} ${sentence}` : sentence;

    if (next.length > maxCharacters && current) {
      chunks.push(current.trim());
      current = sentence;
      return;
    }

    current = next;
  });

  if (current) chunks.push(current.trim());

  return chunks.filter(Boolean);
}

function buildRawBlocks(text, options = {}) {
  const normalizedText = normalizeMultilineText(text || '');
  const maxParagraphCharacters = Math.max(800, Number(options.maxParagraphCharacters || 3000));

  if (!normalizedText) return [];

  const lines = normalizedText.split('\n');
  const blocks = [];
  let currentLines = [];
  let currentTitle = '';

  function flushCurrent() {
    const rawText = normalizeMultilineText(currentLines.join('\n'));

    if (rawText) {
      splitLongParagraph(rawText, maxParagraphCharacters).forEach(part => {
        blocks.push({
          title: currentTitle,
          text: part,
        });
      });
    }

    currentLines = [];
  }

  lines.forEach(rawLine => {
    const line = rawLine.trim();

    if (!line) {
      flushCurrent();
      return;
    }

    if (isProbableTitle(line)) {
      flushCurrent();
      currentTitle = normalizeSegmentTitle(line, currentTitle);
      return;
    }

    currentLines.push(rawLine);
  });

  flushCurrent();

  return blocks;
}

function packBlocksIntoSegments(blocks, options = {}) {
  const maxSegmentCharacters = Math.max(1200, Number(options.maxSegmentCharacters || 5000));
  const minSegmentCharacters = Math.max(300, Number(options.minSegmentCharacters || 900));
  const maxSegments = Math.max(1, Number(options.maxSegments || 40));

  const segments = [];
  let current = null;

  function flushCurrent() {
    if (!current || !normalizeText(current.text)) {
      current = null;
      return;
    }

    segments.push(current);
    current = null;
  }

  blocks.forEach(block => {
    const blockText = normalizeMultilineText(block?.text || '');
    if (!blockText) return;

    const blockTitle = normalizeSegmentTitle(block?.title || '');

    if (!current) {
      current = {
        title: blockTitle,
        text: blockText,
      };
      return;
    }

    const nextText = normalizeMultilineText(`${current.text}\n\n${blockText}`);
    const titleChanged = blockTitle && current.title && blockTitle !== current.title;
    const currentIsSubstantial = current.text.length >= minSegmentCharacters;
    const wouldBeTooLong = nextText.length > maxSegmentCharacters;

    if ((titleChanged && currentIsSubstantial) || wouldBeTooLong) {
      flushCurrent();
      current = {
        title: blockTitle,
        text: blockText,
      };
      return;
    }

    current = {
      title: current.title || blockTitle,
      text: nextText,
    };
  });

  flushCurrent();

  return segments.slice(0, maxSegments).map((segment, index) => {
    const text = normalizeMultilineText(segment.text || '');
    const title = normalizeSegmentTitle(segment.title || '', `Segment ${index + 1}`);

    return {
      id: `segment_${index + 1}`,
      index,
      title: title || `Segment ${index + 1}`,
      text,
      character_count: text.length,
      estimated_tokens: estimateTokens(text),
    };
  });
}

function segmentDocumentText(text, options = {}) {
  const startedAt = Date.now();
  const normalizedText = normalizeMultilineText(text || '');

  if (!normalizedText) {
    return {
      ok: false,
      status: 'empty_text',
      segments: [],
      metadata: {
        engine: 'nyra-document-segmenter-v1',
        reason: 'NO_TEXT_TO_SEGMENT',
        duration_ms: Date.now() - startedAt,
      },
    };
  }

  const blocks = buildRawBlocks(normalizedText, options);
  const segments = packBlocksIntoSegments(blocks, options);
  const totalCharacters = segments.reduce((total, segment) => total + Number(segment.character_count || 0), 0);
  const totalEstimatedTokens = segments.reduce((total, segment) => total + Number(segment.estimated_tokens || 0), 0);

  return {
    ok: true,
    status: 'document_segmented',
    segments,
    metadata: {
      engine: 'nyra-document-segmenter-v1',
      source_text_length: normalizedText.length,
      raw_block_count: blocks.length,
      segment_count: segments.length,
      total_segment_characters: totalCharacters,
      total_estimated_tokens: totalEstimatedTokens,
      max_segment_characters: Math.max(1200, Number(options.maxSegmentCharacters || 5000)),
      max_segments: Math.max(1, Number(options.maxSegments || 40)),
      duration_ms: Date.now() - startedAt,
    },
  };
}

module.exports = {
  segmentDocumentText,
};
