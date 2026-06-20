export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (
      k.startsWith('data-') ||
      k === 'role' ||
      k === 'tabindex' ||
      k.startsWith('aria-') ||
      k === 'title' ||
      k === 'placeholder' ||
      k === 'type'
    ) {
      node.setAttribute(k, v);
    } else {
      (node as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) node.append(c);
  return node;
}
