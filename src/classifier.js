const CATEGORY = Object.freeze({
  SERIF: 'Serif',
  SANS_SERIF: 'Sans-Serif',
  MONOSPACE: 'Monospace',
  DISPLAY: 'Display / Decorative',
  SCRIPT: 'Handwriting / Script',
  SYMBOL: 'Symbol / Icon'
});

const PANoseCategory = Object.freeze({
  TEXT: 2,
  HANDWRITTEN: 3,
  DECORATIVE: 4,
  SYMBOL: 5
});

function classifyFont(font) {
  const panose = font.panose || [];
  const familyType = Number(panose[0]);
  const serifStyle = Number(panose[1]);
  const familyClass = (Number(font.familyClass) >>> 8) & 0xff;
  const name = [
    font.familyName,
    font.preferredFamily,
    font.subfamily,
    font.fileName
  ].filter(Boolean).join(' ').toLowerCase();

  if (familyType === PANoseCategory.SYMBOL || isSymbolFont(font, name)) {
    return { category: CATEGORY.SYMBOL, confidence: 0.98, needsLookup: false };
  }

  if (familyType === PANoseCategory.HANDWRITTEN || isScriptName(name)) {
    return { category: CATEGORY.SCRIPT, confidence: familyType === PANoseCategory.HANDWRITTEN ? 0.95 : 0.82, needsLookup: false };
  }

  if ((familyClass >= 1 && familyClass <= 5) || familyClass === 7) {
    return { category: CATEGORY.SERIF, confidence: 0.88, needsLookup: false };
  }
  if (familyClass === 8) {
    return { category: CATEGORY.SANS_SERIF, confidence: 0.88, needsLookup: false };
  }
  if (familyClass === 9) {
    return { category: CATEGORY.DISPLAY, confidence: 0.82, needsLookup: false };
  }
  if (familyClass === 10) {
    return { category: CATEGORY.SCRIPT, confidence: 0.88, needsLookup: false };
  }
  if (familyClass === 12) {
    return { category: CATEGORY.SYMBOL, confidence: 0.88, needsLookup: false };
  }

  if (font.isFixedPitch) {
    return { category: CATEGORY.MONOSPACE, confidence: 0.96, needsLookup: false };
  }

  if (familyType === PANoseCategory.TEXT) {
    if (serifStyle >= 2 && serifStyle <= 10) {
      return { category: CATEGORY.SERIF, confidence: 0.94, needsLookup: false };
    }
    if (serifStyle >= 11 && serifStyle <= 15) {
      return { category: CATEGORY.SANS_SERIF, confidence: 0.94, needsLookup: false };
    }
  }

  if (/\b(serif|slab|roman|times|georgia|garamond|baskerville|bodoni|caslon|miller|didot|palatino|bookman|clarendon|century)\b/.test(name)) {
    return { category: CATEGORY.SERIF, confidence: 0.84, needsLookup: false };
  }
  if (/\b(sans|grotesk|gothic)\b/.test(name)) {
    return { category: CATEGORY.SANS_SERIF, confidence: 0.78, needsLookup: false };
  }
  if (/\b(display|decorative|stencil|outline|3d|spooky|horror|fantasy|novelty)\b/.test(name)) {
    return { category: CATEGORY.DISPLAY, confidence: 0.8, needsLookup: false };
  }

  if (font.metrics?.averageWidth && font.metrics.widthVariance != null) {
    const ratio = font.metrics.widthVariance / font.metrics.averageWidth;
    if (ratio < 0.08) {
      return { category: CATEGORY.MONOSPACE, confidence: 0.78, needsLookup: false };
    }
    if (ratio > 0.62) {
      return { category: CATEGORY.DISPLAY, confidence: 0.68, needsLookup: true };
    }
  }

  return { category: CATEGORY.DISPLAY, confidence: 0.35, needsLookup: true };
}

function isScriptName(name) {
  return /\b(script|handwriting|handwritten|cursive|calligraphy|signature|brush)\b/.test(name);
}

function isSymbolFont(font, name) {
  if (/\b(icon|symbol|dingbat|emoji|webdings|font awesome)\b/.test(name)) {
    return true;
  }
  const codePoints = font.characterSet || [];
  if (codePoints.length < 8) {
    return false;
  }
  const privateUseCount = codePoints.filter((codePoint) =>
    (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
    (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
    (codePoint >= 0x100000 && codePoint <= 0x10fffd)
  ).length;
  return privateUseCount >= 32 && privateUseCount / codePoints.length > 0.25;
}

module.exports = { CATEGORY, classifyFont };
