import { afterEach, describe, expect, test } from 'vitest';
import { dialogFocusables, trapDialogTab } from '../src/utils/dialog-focus.ts';

let root: HTMLDivElement | null = null;

afterEach(() => {
  root?.remove();
  root = null;
});

function buildDialog(): HTMLDivElement {
  const dialog = document.createElement('div');
  dialog.tabIndex = -1;
  for (const label of ['first', 'middle', 'last']) {
    const button = document.createElement('button');
    button.textContent = label;
    dialog.append(button);
  }
  document.body.append(dialog);
  root = dialog;
  return dialog;
}

describe('dialog focus loop', () => {
  test('wraps only at boundaries and preserves native interior Tab', () => {
    const dialog = buildDialog();
    const [first, middle, last] = dialogFocusables(dialog);

    first!.focus();
    const backward = new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: true, cancelable: true,
    });
    expect(trapDialogTab(backward, dialog)).toBe(true);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    middle!.focus();
    const interior = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    expect(trapDialogTab(interior, dialog)).toBe(false);
    expect(interior.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(middle);

    last!.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    expect(trapDialogTab(forward, dialog)).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  test('moves outside focus into the dialog', () => {
    const dialog = buildDialog();
    document.body.tabIndex = -1;
    document.body.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    expect(trapDialogTab(event, dialog)).toBe(true);
    expect(document.activeElement).toBe(dialogFocusables(dialog)[0]);
  });
});
