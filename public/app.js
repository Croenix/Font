const categoryFilters = document.querySelector('#category-filters');
const fontGrid = document.querySelector('#font-grid');
const searchInput = document.querySelector('#search');
const previewInput = document.querySelector('#preview-text');
const emptyState = document.querySelector('#empty-state');
const errorState = document.querySelector('#error-state');
const resultsLabel = document.querySelector('#results-label');
const categoryNames = [
  'All',
  'Serif',
  'Sans-Serif',
  'Monospace',
  'Display / Decorative',
  'Handwriting / Script',
  'Symbol / Icon'
];

let catalog = null;
let activeCategory = 'All';
let searchTerm = '';
let nextFontId = 0;
const loadedFonts = new Map();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function allFamilies() {
  return Object.values(catalog?.categories || {}).flat();
}

function createFilters() {
  categoryFilters.replaceChildren();
  for (const category of categoryNames) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `filter-button${category === activeCategory ? ' active' : ''}`;
    button.textContent = category;
    button.addEventListener('click', () => {
      activeCategory = category;
      createFilters();
      renderFamilies();
    });
    categoryFilters.append(button);
  }
}

function getVisibleFamilies() {
  return allFamilies().filter((family) => {
    const categoryMatches = activeCategory === 'All' || family.category === activeCategory;
    const term = searchTerm.toLocaleLowerCase();
    const searchMatches = !term || [
      family.family_name,
      family.category,
      ...family.variants.map((variant) => `${variant.style} ${variant.file_name}`)
    ].some((value) => String(value).toLocaleLowerCase().includes(term));
    return categoryMatches && searchMatches;
  });
}

async function loadFontFace(fileName) {
  if (loadedFonts.has(fileName)) return loadedFonts.get(fileName);
  const familyName = `CatalogFont${nextFontId++}`;
  const promise = new FontFace(
    familyName,
    `url("/api/fonts/${encodeURIComponent(fileName)}")`
  ).load().then((face) => {
    document.fonts.add(face);
    return familyName;
  }).catch((error) => {
    loadedFonts.delete(fileName);
    throw error;
  });
  loadedFonts.set(fileName, promise);
  return promise;
}

function drawPreview(canvas, fontName, text) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.fillStyle = '#1a1923';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#e9e4ed';
  context.textBaseline = 'middle';
  const maxFontSize = 42;
  let fontSize = maxFontSize;
  context.font = `${fontSize}px "${fontName}", serif`;
  while (context.measureText(text).width > width - 34 && fontSize > 17) {
    fontSize -= 1;
    context.font = `${fontSize}px "${fontName}", serif`;
  }
  context.fillText(text || 'Aa', 17, height / 2, width - 34);
}

function renderCard(family) {
  const card = document.createElement('article');
  card.className = 'font-card';
  const canvas = document.createElement('canvas');
  canvas.className = 'font-preview';
  canvas.setAttribute('aria-label', `Live preview of ${family.family_name}`);
  canvas.title = 'Click a variant below to preview it';
  card.append(canvas);

  const body = document.createElement('div');
  body.className = 'card-body';
  const titleRow = document.createElement('div');
  titleRow.className = 'card-title-row';
  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = family.family_name;
  const category = document.createElement('span');
  category.className = 'card-category';
  category.textContent = family.category;
  titleRow.append(title, category);

  const subtitle = document.createElement('p');
  subtitle.className = 'card-subtitle';
  const variants = family.variants;
  const previewVariant = variants.find((variant) => variant.file_name === family.main_font_file) || variants[0];
  subtitle.textContent = `${variants.length} ${variants.length === 1 ? 'style' : 'styles'} · ${previewVariant?.designer || previewVariant?.style || 'Font family'}`;
  const variantList = document.createElement('div');
  variantList.className = 'variant-list';
  body.append(titleRow, subtitle, variantList);
  card.append(body);

  let selected = previewVariant;
  let activeFontName = 'Georgia';
  let previewRequest = 0;
  const renderVariant = async (variant, selectedButton) => {
    const request = ++previewRequest;
    for (const button of variantList.children) {
      button.classList.toggle('selected', button === selectedButton);
    }
    try {
      const faceName = await loadFontFace(variant.file_name);
      if (request !== previewRequest) return;
      activeFontName = faceName;
      drawPreview(canvas, activeFontName, previewInput.value.trim());
    } catch (error) {
      console.error(`Font preview failed for "${variant.file_name}":`, error);
      if (request !== previewRequest) return;
      activeFontName = 'Georgia';
      drawPreview(canvas, 'Georgia', previewInput.value.trim());
    }
  };

  for (const variant of variants) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `variant-chip${variant === selected ? ' selected' : ''}`;
    button.textContent = `${variant.style || 'Regular'}${variant.is_italic ? ' Italic' : ''}`;
    button.title = `${variant.file_name} · ${variant.weight}`;
    button.addEventListener('click', () => renderVariant(variant, button));
    variantList.append(button);
  }
  card._redraw = () => drawPreview(canvas, activeFontName, previewInput.value.trim());

  renderVariant(selected, variantList.firstElementChild);
  return card;
}

function renderFamilies() {
  if (!catalog) return;
  const families = getVisibleFamilies();
  fontGrid.replaceChildren(...families.map(renderCard));
  emptyState.hidden = families.length > 0;
  resultsLabel.textContent = `${families.length} ${families.length === 1 ? 'family' : 'families'} shown`;
}

function updateStats() {
  document.querySelector('#family-count').textContent = catalog.total_families.toLocaleString();
  document.querySelector('#font-count').textContent = catalog.total_files.toLocaleString();
  document.querySelector('#category-count').textContent = Object.values(catalog.categories)
    .filter((items) => items.length > 0).length.toString();
  const errors = catalog.scan_errors || [];
  if (errors.length) {
    errorState.hidden = false;
    errorState.textContent = `${errors.length} font file${errors.length === 1 ? '' : 's'} could not be parsed. See the server log for details.`;
  } else {
    errorState.hidden = true;
  }
  const generated = catalog.generated_at && new Date(catalog.generated_at);
  document.querySelector('#updated-at').textContent = generated && !Number.isNaN(generated.valueOf())
    ? `Updated ${generated.toLocaleString()}`
    : '';
  document.querySelector('#watch-status').textContent = 'Watching Fonts';
}

function updateCatalog(nextCatalog) {
  catalog = nextCatalog;
  updateStats();
  createFilters();
  renderFamilies();
}

async function loadCatalog() {
  try {
    const response = await fetch('/api/catalog');
    if (!response.ok) throw new Error(`Catalog request returned HTTP ${response.status}`);
    updateCatalog(await response.json());
    const events = new EventSource('/api/events');
    events.addEventListener('catalog', (event) => {
      try {
        updateCatalog(JSON.parse(event.data));
      } catch (error) {
        console.error('Unable to apply catalog update:', error);
      }
    });
  } catch (error) {
    console.error('Unable to load font catalog:', error);
    errorState.hidden = false;
    errorState.textContent = 'The font catalog could not be loaded. Check that the local server is running.';
  }
}

searchInput.addEventListener('input', () => {
  searchTerm = searchInput.value.trim();
  renderFamilies();
});
previewInput.addEventListener('input', () => {
  for (const card of fontGrid.children) {
    card._redraw?.();
  }
});
window.addEventListener('resize', () => {
  for (const card of fontGrid.children) card._redraw?.();
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== searchInput && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    searchTerm = '';
    renderFamilies();
    searchInput.blur();
  }
});

createFilters();
loadCatalog();
