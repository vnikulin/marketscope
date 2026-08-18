import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import {
  createControls,
  renderEvaluation,
  showParserWarning,
} from '../src/renderer.js';

describe('extension rendering', () => {
  it('renders WHY from the exact verdict using text nodes', () => {
    const dom = new JSDOM('<div id="card"></div>');
    const card = dom.window.document.querySelector<HTMLElement>('#card');
    expect(card).not.toBeNull();
    const malicious = '<img src=x onerror=alert(1)>';
    const root = renderEvaluation(
      card as HTMLElement,
      [
        {
          watchlistId: 'one',
          watchlistName: malicious,
          verdict: {
            passed: false,
            checks: [{ rule: `Excluded: ${malicious}`, passed: false }],
            relevance: 12,
            failedOn: `Excluded: ${malicious}`,
          },
        },
      ],
      { displayMode: 'HIDE', showBlocked: false },
    );
    expect(root).toBeDefined();
    expect(root?.textContent).toContain(`Excluded: ${malicious}: FAIL`);
    expect(root?.textContent).toContain('FINAL: BLOCKED');
    expect(root?.querySelector('img')).toBeNull();
    expect(root?.style.position).toBe('absolute');
    expect((card as HTMLElement).style.display).toBe('');
  });

  it('supports DIM, show-blocked, and a single parser warning', () => {
    const dom = new JSDOM('<body><div id="card"></div></body>');
    const card = dom.window.document.querySelector<HTMLElement>('#card') as HTMLElement;
    const evaluations = [
      {
        watchlistId: 'one',
        watchlistName: 'One',
        verdict: { passed: false, checks: [], relevance: 0, failedOn: 'Price' },
      },
    ];
    renderEvaluation(card, evaluations, { displayMode: 'DIM', showBlocked: false });
    expect(card.style.opacity).toBe('0.35');
    const shown = renderEvaluation(card, evaluations, {
      displayMode: 'HIDE',
      showBlocked: true,
    });
    expect(shown?.style.position).toBe('relative');
    expect(card.style.opacity).toBe('');

    showParserWarning(dom.window.document);
    showParserWarning(dom.window.document);
    expect(
      dom.window.document.querySelectorAll('[data-marketscope-parser-warning]'),
    ).toHaveLength(1);
  });

  it('renders controls for every blocked-listing mode and toggle', () => {
    const dom = new JSDOM('<body></body>');
    const controls = createControls(
      dom.window.document,
      { displayMode: 'SHOW_WITH_WARNING', showBlocked: true },
      () => undefined,
    );
    const select = controls.querySelector<HTMLSelectElement>('select');
    const checkbox = controls.querySelector<HTMLInputElement>('input');
    expect(select?.value).toBe('SHOW_WITH_WARNING');
    expect(select?.options).toHaveLength(3);
    expect(checkbox?.checked).toBe(true);
  });
});
