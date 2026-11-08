const paths = {
  plus: 'M12 5v14M5 12h14',
  'zoom-in': 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-2 6 6 6M6 10h8M10 6v8',
  'zoom-out': 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-2 6 6 6M6 10h8',
  highlight: 'm15 3 6 6-9 9H6v-6l9-9ZM6 18l-3 3M3 22h10M12 6l6 6',
  settings: 'M10 3h4l1 3 3 1 3 2v4l-3 2-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3 3-3ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  refresh: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7',
  external: 'M14 4h6v6M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-5 3V11.5a9.5 9.5 0 0 1 19 0ZM7 10h10M7 14h6',
  'file-pen': 'M14 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10M14 3v6h6M14 3l6 6M8 8h2M8 12h3M15 19l6-6-3-3-6 6-1 4 4-1Z',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  'chevron-down': 'm7 10 5 5 5-5',
  'chevron-left': 'm14 6-6 6 6 6',
  'chevron-right': 'm10 6 6 6-6 6',
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 11v6M12 7h.01',
  scan: 'M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M21 16v4a1 1 0 0 1-1 1h-4M8 21H4a1 1 0 0 1-1-1v-4M7 8h10M7 12h10M7 16h6',
  file: 'M14 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M14 3v6h6M14 3l6 6M8 13h8M8 17h6',
  'file-json': 'M14 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M14 3v6h6M14 3l6 6M10 12H9v2l-1 1 1 1v2h1M14 12h1v2l1 1-1 1v2h-1',
  copy: 'M9 9h12v12H9ZM5 15H3V3h12v2',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  queue: 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
  pause: 'M8 5v14M16 5v14', play: 'm8 4 13 8-13 8V4Z', check: 'm5 12 4 4L19 6',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2',
  link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  close: 'm6 6 12 12M6 18 18 6', upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5'
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] || paths.file);
  svg.append(path);
  return svg;
}

export function renderIcons(root = document) {
  for (const placeholder of root.querySelectorAll('[data-icon]')) placeholder.replaceWith(icon(placeholder.dataset.icon));
}
