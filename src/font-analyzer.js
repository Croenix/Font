const fs = require('node:fs/promises');
const path = require('node:path');
const fontkit = require('fontkit');
const opentype = require('opentype.js');
const { classifyFont } = require('./classifier');

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

function textValue(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return textValue(value[0]);
  }
  if (value && typeof value === 'object') {
    const preferred = value.en || value['en-US'] || Object.values(value)[0];
    return textValue(preferred);
  }
  return '';
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function panoseValues(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Array.from(value).slice(0, 10).map(Number);
  }
  if (value && typeof value === 'object') {
    const keys = [
      'bFamilyType', 'bSerifStyle', 'bWeight', 'bProportion', 'bContrast',
      'bStrokeVariation', 'bArmStyle', 'bLetterform', 'bMidline', 'bXHeight'
    ];
    const result = keys.map((key) => Number(value[key] || 0));
    return result.some(Boolean) ? result : [];
  }
  return [];
}

function namedValue(font, directName, opentypeName) {
  return textValue(font?.[directName]) || textValue(font?.names?.[opentypeName]);
}

function inferStyle(fileName, familyName) {
  const stem = path.basename(fileName, path.extname(fileName));
  const remainder = stem.replace(new RegExp(`^${escapeRegExp(familyName)}[\\s_-]*`, 'i'), '');
  return remainder.replace(/[_-]+/g, ' ').trim() || 'Regular';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferWeight(style) {
  const value = style.toLowerCase();
  if (/thin/.test(value)) return 100;
  if (/extra.?light|ultra.?light/.test(value)) return 200;
  if (/\blight\b/.test(value)) return 300;
  if (/\bmedium\b/.test(value)) return 500;
  if (/semi.?bold|demi.?bold/.test(value)) return 600;
  if (/\bbold\b/.test(value)) return 700;
  if (/extra.?bold|ultra.?bold/.test(value)) return 800;
  if (/black|heavy/.test(value)) return 900;
  return 400;
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function readWidthMetrics(font) {
  const points = [0x20, 0x30, 0x41, 0x57, 0x69, 0x6d];
  const widths = points
    .map((codePoint) => {
      try {
        return numberValue(font.glyphForCodePoint(codePoint)?.advanceWidth);
      } catch {
        return undefined;
      }
    })
    .filter((width) => width != null && width > 0);

  if (widths.length < 3) {
    return { averageWidth: 0, widthVariance: 0 };
  }
  const averageWidth = widths.reduce((sum, width) => sum + width, 0) / widths.length;
  const widthVariance = Math.sqrt(
    widths.reduce((sum, width) => sum + (width - averageWidth) ** 2, 0) / widths.length
  );
  return { averageWidth, widthVariance };
}

function analyzeParsedFont(fileName, parsedFont, fallbackFont) {
  const tables = parsedFont.tables || {};
  const os2 = tables.os2 || parsedFont['OS/2'] || {};
  const post = tables.post || parsedFont.post || {};
  const familyName =
    namedValue(parsedFont, 'preferredFamily', 'preferredFamily') ||
    namedValue(parsedFont, 'familyName', 'fontFamily') ||
    path.basename(fileName, path.extname(fileName));
  const subfamily =
    namedValue(parsedFont, 'preferredSubfamily', 'preferredSubfamily') ||
    namedValue(parsedFont, 'subfamilyName', 'fontSubfamily') ||
    inferStyle(fileName, familyName);
  const style = subfamily || inferStyle(fileName, familyName);
  const postscriptName = namedValue(parsedFont, 'postscriptName', 'postScriptName');
  const italicByStyle = /\b(italic|oblique)\b/i.test(style);
  const fsSelection = numberValue(os2.fsSelection) || 0;
  const familyClass = numberValue(os2.sFamilyClass) || 0;
  const italicByTable = (fsSelection & 1) === 1;
  const panose = panoseValues(os2.panose);
  const characterSet = Array.isArray(parsedFont.characterSet) ? parsedFont.characterSet : [];
  const fixedPitch = Boolean(numberValue(post.isFixedPitch));
  const metrics = readWidthMetrics(parsedFont);

  return {
    file_name: fileName,
    family_name: familyName,
    preferred_family: namedValue(parsedFont, 'preferredFamily', 'preferredFamily'),
    subfamily: style,
    postscript_name: postscriptName,
    version: namedValue(parsedFont, 'version', 'version'),
    designer: namedValue(parsedFont, 'designer', 'designer'),
    copyright: namedValue(parsedFont, 'copyright', 'copyright'),
    panose,
    family_class: familyClass,
    weight: numberValue(os2.usWeightClass) || inferWeight(style),
    is_italic: italicByTable || italicByStyle,
    is_fixed_pitch: fixedPitch,
    character_set: characterSet,
    metrics,
    classification: classifyFont({
      familyName,
      preferredFamily: namedValue(parsedFont, 'preferredFamily', 'preferredFamily'),
      subfamily: style,
      fileName,
      panose,
      familyClass,
      isFixedPitch: fixedPitch,
      characterSet,
      metrics
    }),
    fallbackFont
  };
}

async function analyzeFont(filePath) {
  const fileName = path.basename(filePath);
  const buffer = await fs.readFile(filePath);
  const arrayBuffer = toArrayBuffer(buffer);
  let fontkitFont;
  let opentypeFont;
  let fontkitError;
  let opentypeError;

  try {
    fontkitFont = fontkit.create(buffer);
  } catch (error) {
    fontkitError = error;
  }

  try {
    opentypeFont = opentype.parse(arrayBuffer);
  } catch (error) {
    opentypeError = error;
  }

  if (!fontkitFont && !opentypeFont) {
    const reasons = [fontkitError, opentypeError]
      .filter(Boolean)
      .map((error) => error.message)
      .join('; ');
    throw new Error(`Unable to parse ${fileName}: ${reasons || 'unsupported font format'}`);
  }

  const primary = fontkitFont || opentypeFont;
  const supplemental = fontkitFont ? opentypeFont : undefined;
  if (supplemental) {
    primary.tables = { ...supplemental.tables, ...primary.tables };
    primary.names = { ...supplemental.names, ...primary.names };
  }
  return analyzeParsedFont(fileName, primary, Boolean(fontkitFont && opentypeFont));
}

module.exports = { FONT_EXTENSIONS, analyzeFont, inferStyle, inferWeight };
