export type FontFamilyId = 'inter' | 'mono' | 'serif' | 'display' | 'system';

export interface FontFamily {
  id: FontFamilyId;
  name: string;
  stack: string;
}

export const fontFamilies: FontFamily[] = [
  {
    id: 'inter',
    name: 'Inter (Sans)',
    stack: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  {
    id: 'mono',
    name: 'JetBrains Mono',
    stack: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  },
  {
    id: 'serif',
    name: 'Serif',
    stack: "'Playfair Display', Georgia, 'Times New Roman', serif",
  },
  {
    id: 'display',
    name: 'Display',
    stack: "'Space Grotesk', 'Inter', -apple-system, sans-serif",
  },
  {
    id: 'system',
    name: 'System UI',
    stack: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
];

export function getFontStack(id: FontFamilyId): string {
  return fontFamilies.find((f) => f.id === id)?.stack || fontFamilies[0].stack;
}
