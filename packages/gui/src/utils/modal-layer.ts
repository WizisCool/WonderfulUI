/** Visual modal stack, highest z-index first. Keep aligned with component CSS. */
export const MODAL_LAYER_ORDER = [
  'share',
  'update',
  'settings',
  'player',
  'event',
] as const;

export type ModalLayer = typeof MODAL_LAYER_ORDER[number];

export const MODAL_LAYER_SELECTOR: Record<ModalLayer, string> = {
  share: '.share-modal-backdrop',
  update: '.update-modal-backdrop',
  settings: '.settings-modal-backdrop',
  player: '.player-backdrop',
  event: '.event-list-modal-backdrop',
};

export function topModalLayer(root: ParentNode = document): ModalLayer | null {
  for (const layer of MODAL_LAYER_ORDER) {
    if (root.querySelector(MODAL_LAYER_SELECTOR[layer])) return layer;
  }
  return null;
}

/** Global keyboard listeners act only for the visually topmost modal. */
export function ownsTopModalLayer(
  layer: ModalLayer,
  root: ParentNode = document,
): boolean {
  return topModalLayer(root) === layer;
}
