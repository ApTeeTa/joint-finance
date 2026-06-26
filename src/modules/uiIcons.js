const ICONS = {
  pencil: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="m2.695 14.763-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z"/></svg>`,
  trash: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 0 0-.584.788 48.065 48.065 0 0 0 .522 7.403.75.75 0 0 0 .43.375A48.112 48.112 0 0 0 8 14.25c0 1.246.124 2.503.38 3.75a.75.75 0 0 0 .75.568h7.5a.75.75 0 0 0 .75-.568c.256-1.247.38-2.504.38-3.75a48.112 48.112 0 0 0-3.439-.908.75.75 0 0 0-.43-.375 48.65 48.65 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM9.5 3.75V5h1V3.75a.25.25 0 0 0-.25-.25h-.5a.25.25 0 0 0-.25.25ZM4.5 6.75v8.5c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75v-8.5h-11Z" clip-rule="evenodd"/></svg>`,
  reserve: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v2.5h-2.5a.75.75 0 0 0 0 1.5h2.5v2.5a.75.75 0 0 0 1.5 0v-2.5h2.5a.75.75 0 0 0 0-1.5h-2.5v-2.5Z" clip-rule="evenodd"/></svg>`,
  unreserve: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM7 9.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"/></svg>`,
  dots: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM10 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM11.5 15.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z"/></svg>`
};

export function renderUiIcon(name) {
  const svg = ICONS[name] ?? '';
  return `<span class="ui-icon">${svg}</span>`;
}
