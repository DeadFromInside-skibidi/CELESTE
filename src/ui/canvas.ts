// Shared plumbing for the 2D canvases: device-pixel-ratio aware sizing and coalesced redraws.

export interface CanvasHandle {
  /** Requests a redraw on the next animation frame (multiple calls coalesce into one). */
  schedule(): void;
  dispose(): void;
  readonly width: number;
  readonly height: number;
}

export function setupCanvas(canvas: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): CanvasHandle {
  const ctx = canvas.getContext('2d')!;
  let raf = 0, width = 0, height = 0, dpr = 1;

  const render = () => {
    raf = 0;
    if (width < 2 || height < 2) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, width, height);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(render);
  };
  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.round(rect.width);
    height = Math.round(rect.height);
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    schedule();
  };
  const ro = new ResizeObserver(measure);
  ro.observe(canvas);
  measure();
  // Web fonts arriving after first paint change text metrics.
  document.fonts?.ready.then(schedule).catch(() => {});
  document.fonts?.addEventListener('loadingdone', schedule);

  return {
    schedule,
    dispose() {
      ro.disconnect();
      document.fonts?.removeEventListener('loadingdone', schedule);
      cancelAnimationFrame(raf);
    },
    get width() { return width; },
    get height() { return height; },
  };
}

/** Display palette (matches the CSS tokens in styles.css). */
export const COLORS = {
  bg: '#0a0d12',
  panel: '#10141b',
  /** Empty band / plot background. */
  track: '#171c25',
  plot: '#05070a',
  line: '#222932',
  line2: '#343d4b',
  text: '#ece6d6',
  muted: '#9aa0a8',
  faint: '#626973',
  sun: '#ffab2e',
  earth: '#56c4ff',
  dsn: '#63d471',
  danger: '#ff5a36',
  mission: '#ff7a45',
};
/** "r,g,b" triplets for rgba() fills. */
export const RGB = { sun: '255,171,46', earth: '86,196,255', dsn: '99,212,113', mission: '255,122,69', text: '236,230,214', grid: '147,160,180' };

export const FONT_UI = '"Titillium Web", "IBM Plex Mono", system-ui, sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

/** Picks a "nice" tick step (1, 2, 5 x 10^n) giving roughly `target` ticks across `span`. */
export function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}
