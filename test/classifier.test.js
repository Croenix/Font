const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORY, classifyFont } = require('../src/classifier');
const { inferWeight } = require('../src/font-analyzer');
const { mapGoogleCategory } = require('../src/catalog');

test('classifies text PANOSE serif and sans-serif families', () => {
  assert.equal(classifyFont({ panose: [2, 2] }).category, CATEGORY.SERIF);
  assert.equal(classifyFont({ panose: [2, 11] }).category, CATEGORY.SANS_SERIF);
  assert.equal(classifyFont({ familyName: 'Miller' }).category, CATEGORY.SERIF);
  assert.equal(classifyFont({ familyClass: 0x0800 }).category, CATEGORY.SANS_SERIF);
});

test('prioritizes symbols, handwriting, and fixed pitch metadata', () => {
  assert.equal(classifyFont({ panose: [5], familyName: 'Example' }).category, CATEGORY.SYMBOL);
  assert.equal(classifyFont({ characterSet: [...Array(40).keys()].map((value) => 0xe000 + value) }).category, CATEGORY.SYMBOL);
  assert.equal(classifyFont({ panose: [3], familyName: 'Example' }).category, CATEGORY.SCRIPT);
  assert.equal(classifyFont({ isFixedPitch: true, familyName: 'Example' }).category, CATEGORY.MONOSPACE);
});

test('uses family naming heuristics and marks uncertain classifications', () => {
  assert.equal(classifyFont({ familyName: 'Sample Serif' }).category, CATEGORY.SERIF);
  assert.equal(classifyFont({ familyName: 'Sample Calligraphy' }).category, CATEGORY.SCRIPT);
  assert.equal(classifyFont({ familyName: 'Unknown Typeface' }).needsLookup, true);
});

test('maps Google Fonts categories and infers common font weights', () => {
  assert.equal(mapGoogleCategory('SANS_SERIF'), CATEGORY.SANS_SERIF);
  assert.equal(mapGoogleCategory('HANDWRITING'), CATEGORY.SCRIPT);
  assert.equal(inferWeight('ExtraBold Italic'), 800);
  assert.equal(inferWeight('Light'), 300);
  assert.equal(inferWeight('Regular'), 400);
});
