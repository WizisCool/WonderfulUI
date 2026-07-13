import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import { defineComponent, h, nextTick } from 'vue';
import UpdateModal from '../src/components/update/UpdateModal.vue';
import { useUpdateStore, FRIENDLY_CHECK_ERROR, FRIENDLY_UPDATE_ERROR } from '../src/stores/update.ts';
import { useUiStore } from '../src/stores/ui.ts';

const checkMock = vi.fn();
const downloadAndInstallMock = vi.fn();
const relaunchMock = vi.fn();

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));
vi.mock('../src/components/common/WIcon.vue', () => ({
  default: defineComponent({
    name: 'WIcon',
    props: { icon: String, size: Number },
    setup: (p) => () => h('span', { 'data-icon': p.icon }),
  }),
}));

function enableTauri() {
  (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
}

function disableTauri() {
  delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
}

function mountModal(initialState: Record<string, unknown> = {}) {
  return mount(UpdateModal, {
    attachTo: document.body,
    global: {
      plugins: [
        createTestingPinia({
          createSpy: vi.fn,
          stubActions: false,
          initialState: {
            update: {
              status: 'available',
              update: {
                version: '0.1.6',
                date: '2026-07-14',
                body: 'test notes',
              },
              progress: { downloaded: 0, total: 0, pct: 0 },
              error: null,
              errorKind: null,
              badge: true,
              modalOpen: true,
              ...initialState,
            },
            ui: {},
          },
        }),
      ],
    },
  });
}

describe('UpdateModal', () => {
  beforeEach(() => {
    enableTauri();
    checkMock.mockReset();
    downloadAndInstallMock.mockReset();
    relaunchMock.mockReset();
  });

  afterEach(() => {
    disableTauri();
    document.body.innerHTML = '';
  });

  test('available state uses btn-primary on the update CTA', () => {
    const w = mountModal();
    // Teleport → body：用 document 查询
    const primary = document.body.querySelector('button.btn-primary');
    expect(primary).not.toBeNull();
    expect(primary!.textContent).toContain('立即更新');
    w.unmount();
  });

  test('downloading without contentLength shows indeterminate shimmer', () => {
    const w = mountModal({
      status: 'downloading',
      progress: { downloaded: 1_500_000, total: 0, pct: 0 },
    });
    expect(document.body.querySelector('.update-modal-progress-shimmer')).not.toBeNull();
    expect(document.body.querySelector('.update-modal-progress-fill')).toBeNull();
    expect(document.body.textContent).toContain('已下载');
    w.unmount();
  });

  test('downloading with total shows percent fill', () => {
    const w = mountModal({
      status: 'downloading',
      progress: { downloaded: 50, total: 100, pct: 50 },
    });
    expect(document.body.querySelector('.update-modal-progress-fill')).not.toBeNull();
    expect(document.body.textContent).toContain('50%');
    w.unmount();
  });

  test('Esc dismisses available modal but not downloading', async () => {
    const w = mountModal({ status: 'available' });
    const store = useUpdateStore();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(store.modalOpen).toBe(false);
    w.unmount();

    const w2 = mountModal({
      status: 'downloading',
      modalOpen: true,
      progress: { downloaded: 0, total: 10, pct: 0 },
    });
    const store2 = useUpdateStore();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(store2.modalOpen).toBe(true);
    w2.unmount();
  });
});

describe('useUpdateStore', () => {
  beforeEach(() => {
    enableTauri();
    checkMock.mockReset();
    downloadAndInstallMock.mockReset();
    relaunchMock.mockReset();
    // pinia for each test
    mountModal({
      status: 'idle',
      update: null,
      badge: false,
      modalOpen: false,
      error: null,
      errorKind: null,
    }).unmount();
  });

  afterEach(() => {
    disableTauri();
    document.body.innerHTML = '';
  });

  test('manual check failure sets errorKind=check and retry re-checks', async () => {
    checkMock.mockRejectedValueOnce(new Error('network down'));
    const w = mountModal({
      status: 'idle',
      update: null,
      badge: false,
      modalOpen: false,
    });
    const store = useUpdateStore();
    await store.checkForUpdate(false);
    await flushPromises();
    expect(store.status).toBe('error');
    expect(store.errorKind).toBe('check');
    expect(store.error).toBe(FRIENDLY_CHECK_ERROR);
    expect(store.modalOpen).toBe(true);

    checkMock.mockResolvedValueOnce(null);
    await store.retry();
    await flushPromises();
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(store.status).toBe('uptodate');
    w.unmount();
  });

  test('silent check failure keeps idle and does not toast as error status', async () => {
    checkMock.mockRejectedValueOnce(new Error('offline'));
    const w = mountModal({
      status: 'idle',
      update: null,
      badge: false,
      modalOpen: false,
    });
    const store = useUpdateStore();
    await store.checkForUpdate(true);
    await flushPromises();
    expect(store.status).toBe('idle');
    expect(store.modalOpen).toBe(false);
    expect(store.errorKind).toBeNull();
    w.unmount();
  });

  test('silent check with update sets badge and toasts once', async () => {
    checkMock.mockResolvedValueOnce({
      version: '9.9.9',
      date: '2026-07-14',
      body: 'notes',
      downloadAndInstall: downloadAndInstallMock,
    });
    const w = mountModal({
      status: 'idle',
      update: null,
      badge: false,
      modalOpen: false,
    });
    const store = useUpdateStore();
    const ui = useUiStore();
    await store.checkForUpdate(true);
    await flushPromises();
    expect(store.status).toBe('available');
    expect(store.badge).toBe(true);
    expect(store.modalOpen).toBe(false);
    expect(ui.toastMessage).toContain('9.9.9');
    w.unmount();
  });

  test('retry after download error calls startUpdate path (re-check + install)', async () => {
    checkMock.mockResolvedValue({
      version: '0.1.6',
      date: '',
      body: '',
      downloadAndInstall: downloadAndInstallMock,
    });
    downloadAndInstallMock.mockRejectedValueOnce(new Error('disk full'));
    const w = mountModal({
      status: 'available',
      update: { version: '0.1.6', date: '', body: '' },
      badge: true,
      modalOpen: true,
    });
    const store = useUpdateStore();
    await store.startUpdate();
    await flushPromises();
    expect(store.status).toBe('error');
    expect(store.errorKind).toBe('download');
    expect(store.error).toBe(FRIENDLY_UPDATE_ERROR);

    downloadAndInstallMock.mockImplementationOnce(async (cb?: (e: unknown) => void) => {
      cb?.({ event: 'Started', data: { contentLength: 100 } });
      cb?.({ event: 'Progress', data: { chunkLength: 100 } });
      cb?.({ event: 'Finished' });
    });
    relaunchMock.mockResolvedValueOnce(undefined);
    await store.retry();
    await flushPromises();
    expect(downloadAndInstallMock).toHaveBeenCalled();
    expect(relaunchMock).toHaveBeenCalled();
    w.unmount();
  });

  test('concurrent checkForUpdate shares one inflight promise', async () => {
    let resolveCheck: (v: null) => void = () => {};
    checkMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const w = mountModal({
      status: 'idle',
      update: null,
      badge: false,
      modalOpen: false,
    });
    const store = useUpdateStore();
    const p1 = store.checkForUpdate(false);
    const p2 = store.checkForUpdate(false);
    expect(checkMock).toHaveBeenCalledTimes(1);
    resolveCheck(null);
    await Promise.all([p1, p2]);
    expect(store.status).toBe('uptodate');
    w.unmount();
  });
});
