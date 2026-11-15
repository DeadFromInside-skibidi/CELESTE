import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initStore } from './state/store.ts';

/**
 * Fine grain for the chassis, generated once as a small bitmap tile. (An SVG turbulence filter
 * looks the same but is re-rasterised on every repaint, which costs frames during playback.)
 */
function grainTile(): string {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(size, size);
  let seed = 20261114;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = seed >>> 24;
    const tone = v < 128 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = tone;
    img.data[i + 3] = (Math.abs(v - 128) / 128) * 20;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
const grain = grainTile();
if (grain) document.documentElement.style.setProperty('--grain', `url(${grain})`);

void initStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
