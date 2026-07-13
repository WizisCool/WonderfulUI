/**
 * Canonical 快传 icon (Iconify / Phosphor).
 *
 * Use this everywhere 快传 appears: player toolbar, context menu, ShareModal
 * brand, and any future share-platform menu row. Do not scatter ad-hoc
 * `ph:share` / `ph:share-network` / inline SVGs.
 *
 * `share-network` = three linked nodes — matches LAN/QR “传” semantics better
 * than the generic share-arrow glyph.
 */
export const SHARE_ICON = 'ph:share-network' as const;

/** Default control size for toolbar / modal brand. */
export const SHARE_ICON_SIZE = 16;
