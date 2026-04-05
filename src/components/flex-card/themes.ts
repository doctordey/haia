export type ThemeId = 'dark-geometric' | 'gold-crystalline' | 'neon-abstract' | 'matrix-code' | 'clean-minimal' | 'custom';

export interface Theme {
  id: ThemeId;
  name: string;
  css: string; // CSS background value
}

export const themes: Theme[] = [
  {
    id: 'dark-geometric',
    name: 'Dark Geometric',
    css: `linear-gradient(135deg, #0B0C10 0%, #141720 50%, #0B0C10 100%),
      repeating-linear-gradient(60deg, transparent, transparent 20px, rgba(108,92,231,0.03) 20px, rgba(108,92,231,0.03) 21px),
      repeating-linear-gradient(-60deg, transparent, transparent 20px, rgba(108,92,231,0.03) 20px, rgba(108,92,231,0.03) 21px)`,
  },
  {
    id: 'gold-crystalline',
    name: 'Gold Crystalline',
    css: `linear-gradient(135deg, #1a1200 0%, #2d1f00 25%, #3d2a00 50%, #2d1f00 75%, #1a1200 100%),
      repeating-linear-gradient(45deg, transparent, transparent 30px, rgba(255,179,71,0.04) 30px, rgba(255,179,71,0.04) 31px),
      repeating-linear-gradient(-45deg, transparent, transparent 30px, rgba(255,179,71,0.04) 30px, rgba(255,179,71,0.04) 31px)`,
  },
  {
    id: 'neon-abstract',
    name: 'Neon Abstract',
    css: `linear-gradient(135deg, #0a0015 0%, #1a0030 25%, #0d1b3e 50%, #001a2e 75%, #0a0015 100%),
      radial-gradient(ellipse at 30% 50%, rgba(108,92,231,0.15) 0%, transparent 60%),
      radial-gradient(ellipse at 70% 50%, rgba(0,180,216,0.1) 0%, transparent 60%)`,
  },
  {
    id: 'matrix-code',
    name: 'Matrix Code',
    css: `linear-gradient(180deg, #000a00 0%, #001200 50%, #000a00 100%),
      repeating-linear-gradient(90deg, transparent, transparent 18px, rgba(0,220,130,0.04) 18px, rgba(0,220,130,0.04) 19px)`,
  },
  {
    id: 'clean-minimal',
    name: 'Clean Minimal',
    css: `linear-gradient(180deg, #0B0C10 0%, #12141A 50%, #1A1D26 100%)`,
  },
];

export function getThemeCss(themeId: ThemeId, customBgUrl?: string): string {
  if (themeId === 'custom' && customBgUrl) {
    return `url(${customBgUrl}) center/cover no-repeat`;
  }
  const theme = themes.find((t) => t.id === themeId);
  return theme?.css || themes[4].css;
}
