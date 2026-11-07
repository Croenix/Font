const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CATEGORY } = require('./classifier');
const { analyzeFont, FONT_EXTENSIONS } = require('./font-analyzer');

const CATEGORIES = Object.values(CATEGORY);

function normalizedFamilyName(value) {
  return value.trim().toLocaleLowerCase();
}

function mapGoogleCategory(value) {
  const category = String(value || '').toUpperCase();
  const mapping = {
    SERIF: CATEGORY.SERIF,
    SANS_SERIF: CATEGORY.SANS_SERIF,
    DISPLAY: CATEGORY.DISPLAY,
    HANDWRITING: CATEGORY.SCRIPT,
    MONOSPACE: CATEGORY.MONOSPACE
  };
  return mapping[category];
}

function variantFromFont(font) {
  return {
    file_name: font.file_name,
    style: font.subfamily,
    weight: font.weight,
    is_italic: font.is_italic,
    postscript_name: font.postscript_name,
    version: font.version,
    designer: font.designer,
    copyright: font.copyright,
    panose: font.panose,
    is_fixed_pitch: font.is_fixed_pitch
  };
}

function mainVariant(variants) {
  return [...variants].sort((a, b) => {
    const aRegularity = Number(a.is_italic) * 2 + Number(a.weight !== 400);
    const bRegularity = Number(b.is_italic) * 2 + Number(b.weight !== 400);
    return aRegularity - bRegularity || a.weight - b.weight || a.file_name.localeCompare(b.file_name);
  })[0];
}

class FontCatalog {
  constructor({ fontsDirectory, outputPath, googleFontsApiKey = process.env.GOOGLE_FONTS_API_KEY }) {
    this.fontsDirectory = fontsDirectory;
    this.outputPath = outputPath;
    this.googleFontsApiKey = googleFontsApiKey;
    this.googleFonts = null;
    this.googleFontsRequest = null;
    this.googleFontsErrorLogged = false;
    this.events = new EventEmitter();
    this.snapshot = {
      generated_at: null,
      total_families: 0,
      total_files: 0,
      categories: Object.fromEntries(CATEGORIES.map((category) => [category, []]))
    };
    this.scanErrors = [];
  }

  async loadGoogleFonts() {
    if (!this.googleFontsApiKey) {
      return null;
    }
    if (this.googleFonts) {
      return this.googleFonts;
    }
    const url = new URL('https://www.googleapis.com/webfonts/v1/webfonts');
    url.searchParams.set('key', this.googleFontsApiKey);
    if (!this.googleFontsRequest) {
      this.googleFontsRequest = fetch(url).then((response) => {
        if (!response.ok) {
          throw new Error(`Google Fonts API returned HTTP ${response.status}`);
        }
        return response.json();
      }).then((data) => {
        this.googleFonts = new Map(
          (data.items || []).map((item) => [normalizedFamilyName(item.family), mapGoogleCategory(item.category)])
        );
        return this.googleFonts;
      });
    }
    return this.googleFontsRequest;
  }

  async resolveCategory(font) {
    if (!font.classification.needsLookup || !this.googleFontsApiKey) {
      return font.classification.category;
    }
    try {
      const families = await this.loadGoogleFonts();
      return families.get(normalizedFamilyName(font.family_name)) || font.classification.category;
    } catch (error) {
      if (!this.googleFontsErrorLogged) {
        console.error(`Google Fonts category lookup failed: ${error.message}`);
        this.googleFontsErrorLogged = true;
      }
      return font.classification.category;
    }
  }

  async scan() {
    await fs.mkdir(this.fontsDirectory, { recursive: true });
    const entries = await fs.readdir(this.fontsDirectory, { withFileTypes: true });
    const fontFiles = entries
      .filter((entry) => entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const byFamily = new Map();
    const errors = [];
    for (const fileName of fontFiles) {
      try {
        const font = await analyzeFont(path.join(this.fontsDirectory, fileName));
        const key = normalizedFamilyName(font.family_name);
        if (!byFamily.has(key)) {
          byFamily.set(key, { familyName: font.family_name, fonts: [] });
        }
        byFamily.get(key).fonts.push(font);
      } catch (error) {
        errors.push({ file_name: fileName, message: error.message });
        console.error(`Font analysis failed for "${fileName}": ${error.message}`);
      }
    }

    const categories = Object.fromEntries(CATEGORIES.map((category) => [category, []]));
    for (const group of byFamily.values()) {
      const variants = group.fonts.map(variantFromFont);
      const preferred = group.fonts.find((font) => font.preferred_family);
      const representative = mainVariant(variants);
      const categoryFont =
        group.fonts.find((font) => font.file_name === representative.file_name) || group.fonts[0];
      const category = await this.resolveCategory(categoryFont);
      categories[category].push({
        family_name: preferred?.preferred_family || group.familyName,
        category,
        main_font_file: representative.file_name,
        variants
      });
    }

    for (const families of Object.values(categories)) {
      families.sort((a, b) => a.family_name.localeCompare(b.family_name));
      for (const family of families) {
        family.variants.sort((a, b) =>
          a.weight - b.weight ||
          Number(a.is_italic) - Number(b.is_italic) ||
          a.file_name.localeCompare(b.file_name)
        );
      }
    }

    const snapshot = {
      generated_at: new Date().toISOString(),
      total_families: Object.values(categories).reduce((total, families) => total + families.length, 0),
      total_files: Object.values(categories).reduce(
        (total, families) => total + families.reduce((count, family) => count + family.variants.length, 0),
        0
      ),
      categories
    };
    await fs.writeFile(this.outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    this.snapshot = snapshot;
    this.scanErrors = errors;
    this.events.emit('updated', this.getSnapshot());
    return this.snapshot;
  }

  getSnapshot() {
    return {
      ...this.snapshot,
      scan_errors: [...this.scanErrors]
    };
  }
}

module.exports = { CATEGORIES, FontCatalog, mapGoogleCategory };
