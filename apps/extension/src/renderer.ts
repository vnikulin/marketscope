import type { FilterVerdict } from '@marketscope/shared-types';

import type {
  DisplayMode,
  ExtensionPreferences,
  WatchlistEvaluation,
} from './types.js';

const ROOT_ATTRIBUTE = 'data-marketscope-overlay';
const CARD_STATE_ATTRIBUTE = 'data-marketscope-card-state';
const CARD_STYLES_ATTRIBUTE = 'data-marketscope-card-styles';

function ensureCardStyles(document: Document): void {
  if (document.querySelector(`[${CARD_STYLES_ATTRIBUTE}]`) !== null) return;
  const style = document.createElement('style');
  style.setAttribute(CARD_STYLES_ATTRIBUTE, 'true');
  style.textContent = `
    [${CARD_STATE_ATTRIBUTE}="hidden"] {
      visibility: hidden !important;
      block-size: 2px !important;
      min-block-size: 2px !important;
      max-block-size: 2px !important;
      overflow: hidden !important;
      pointer-events: none !important;
    }
    [${CARD_STATE_ATTRIBUTE}="dim"] {
      opacity: 0.35 !important;
    }
  `;
  document.head.append(style);
}

function textElement(
  document: Document,
  tag: keyof HTMLElementTagNameMap,
  value: string,
): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}

function verdictPanel(document: Document, verdict: FilterVerdict): HTMLElement {
  const panel = document.createElement('div');
  panel.style.marginTop = '8px';
  panel.style.fontSize = '12px';
  panel.style.lineHeight = '1.5';

  for (const check of verdict.checks) {
    const row = document.createElement('div');
    row.textContent = `${check.rule}: ${check.passed ? 'PASS' : 'FAIL'}${
      check.detail === undefined ? '' : `, ${check.detail}`
    }`;
    panel.append(row);
  }
  panel.append(textElement(document, 'div', `Relevance: ${verdict.relevance}`));
  panel.append(
    textElement(
      document,
      'strong',
      `FINAL: ${verdict.passed ? 'PASSED' : 'BLOCKED'}`,
    ),
  );
  if (verdict.failedOn !== undefined) {
    panel.append(textElement(document, 'div', `Reason: ${verdict.failedOn}`));
  }
  return panel;
}

function styleRoot(
  root: HTMLElement,
  mode: DisplayMode,
  blocked: boolean,
): void {
  root.style.boxSizing = 'border-box';
  root.style.border = blocked ? '2px solid #9f1239' : '2px solid #166534';
  root.style.borderRadius = '8px';
  root.style.padding = '8px';
  root.style.color = '#111827';
  root.style.background = blocked && mode === 'HIDE' ? '#fff1f2' : '#f0fdf4';
  root.style.fontFamily = 'system-ui, sans-serif';
  root.style.zIndex = '2147483647';

  root.style.position = 'relative';
  root.style.margin = '4px';
}

function applyCardState(
  card: HTMLElement,
  mode: DisplayMode,
  blocked: boolean,
): void {
  if (!blocked || mode === 'SHOW_WITH_WARNING') {
    card.removeAttribute(CARD_STATE_ATTRIBUTE);
    return;
  }
  card.setAttribute(CARD_STATE_ATTRIBUTE, mode === 'HIDE' ? 'hidden' : 'dim');
}

export function renderEvaluation(
  card: HTMLElement,
  evaluations: readonly WatchlistEvaluation[],
  preferences: ExtensionPreferences,
): HTMLElement | undefined {
  card.querySelector(`[${ROOT_ATTRIBUTE}]`)?.remove();
  if (evaluations.length === 0) {
    card.removeAttribute(CARD_STATE_ATTRIBUTE);
    return undefined;
  }
  const blocked =
    evaluations.length > 0 &&
    !evaluations.some((evaluation) => evaluation.verdict.passed);
  const displayMode =
    blocked && preferences.showBlocked
      ? 'SHOW_WITH_WARNING'
      : preferences.displayMode;

  const document = card.ownerDocument;
  ensureCardStyles(document);
  applyCardState(card, displayMode, blocked);
  const root = document.createElement('div');
  root.setAttribute(ROOT_ATTRIBUTE, 'true');
  styleRoot(root, displayMode, blocked);

  const summary = blocked ? 'Blocked by MarketScope' : 'Matched by MarketScope';
  root.append(textElement(document, 'strong', summary));

  for (const evaluation of evaluations) {
    const section = document.createElement('section');
    section.append(textElement(document, 'div', evaluation.watchlistName));
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'WHY';
    const panel = verdictPanel(document, evaluation.verdict);
    panel.hidden = true;
    button.addEventListener('mousedown', (event) => event.stopPropagation());
    button.addEventListener('mouseup', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      panel.hidden = !panel.hidden;
    });
    section.append(button, panel);
    root.append(section);
  }

  if (blocked && displayMode === 'SHOW_WITH_WARNING') {
    root.append(
      textElement(document, 'div', 'This listing failed every watchlist.'),
    );
  }
  card.append(root);
  return root;
}

export function clearRendering(document: Document): void {
  for (const card of document.querySelectorAll<HTMLElement>(
    `[${CARD_STATE_ATTRIBUTE}]`,
  )) {
    card.removeAttribute(CARD_STATE_ATTRIBUTE);
  }
  for (const selector of [
    `[${ROOT_ATTRIBUTE}]`,
    '[data-marketscope-controls]',
    '[data-marketscope-parser-warning]',
    `[${CARD_STYLES_ATTRIBUTE}]`,
  ]) {
    for (const element of document.querySelectorAll(selector)) element.remove();
  }
}

export function createControls(
  document: Document,
  initial: ExtensionPreferences,
  onChange: (preferences: ExtensionPreferences) => void,
): HTMLElement {
  const root = document.createElement('aside');
  root.setAttribute('data-marketscope-controls', 'true');
  root.style.position = 'fixed';
  root.style.right = '12px';
  root.style.bottom = '12px';
  root.style.padding = '10px';
  root.style.background = '#111827';
  root.style.color = '#ffffff';
  root.style.zIndex = '2147483647';
  root.style.fontFamily = 'system-ui, sans-serif';

  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Blocked listings: ';
  const mode = document.createElement('select');
  for (const [value, label] of [
    ['HIDE', 'Hide'],
    ['DIM', 'Dim'],
    ['SHOW_WITH_WARNING', 'Show with warning'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = initial.displayMode === value;
    mode.append(option);
  }
  modeLabel.append(mode);

  const showLabel = document.createElement('label');
  showLabel.style.marginLeft = '10px';
  const show = document.createElement('input');
  show.type = 'checkbox';
  show.checked = initial.showBlocked;
  showLabel.append(show, document.createTextNode(' Show blocked listings'));

  const notify = (): void => {
    onChange({
      displayMode: mode.value as DisplayMode,
      showBlocked: show.checked,
    });
  };
  mode.addEventListener('change', notify);
  show.addEventListener('change', notify);
  root.append(modeLabel, showLabel);
  document.body.append(root);
  return root;
}

export function showParserWarning(document: Document): void {
  if (document.querySelector('[data-marketscope-parser-warning]') !== null) {
    return;
  }
  const banner = document.createElement('div');
  banner.setAttribute('data-marketscope-parser-warning', 'true');
  banner.textContent =
    'MarketScope stopped annotating because more than 40% of listing cards failed to parse.';
  banner.style.position = 'fixed';
  banner.style.top = '0';
  banner.style.left = '0';
  banner.style.right = '0';
  banner.style.padding = '12px';
  banner.style.background = '#991b1b';
  banner.style.color = '#ffffff';
  banner.style.zIndex = '2147483647';
  document.body.prepend(banner);
}
