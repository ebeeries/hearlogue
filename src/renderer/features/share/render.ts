import { coverGeometry } from '../../lib/artwork';

/**
 * Canvas rendering for share cards.
 *
 * Written directly against the 2D context rather than screenshotting DOM: the
 * output has to be crisp at 2160px and identical every time, which
 * html-to-image-style approaches are not. It also keeps the whole feature
 * offline and dependency-free.
 */

export type ShareRatio = '1:1' | '4:5' | '16:9';

export interface ShareCardData {
  kind: 'era' | 'track' | 'obsession' | 'year' | 'graveyard';
  title: string;
  subtitle: string;
  /** Supporting lines — artist names, track titles, a sentence. */
  lines: string[];
  figure: string;
  figureLabel: string;
  accent: string;
  /** Optional single sentence rendered above the figure. */
  statement?: string;
}

const DIMENSIONS: Record<ShareRatio, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1920, height: 1080 },
};

const ACCENTS: Record<string, string> = {
  brass: '#D6B06A',
  sage: '#7E9384',
  haze: '#7C8BA3',
  clay: '#B08268',
  plum: '#96768F',
};

const DISPLAY_FONT = "'Iowan Old Style', 'Palatino Linotype', Georgia, serif";
const UI_FONT = "'Segoe UI', Inter, system-ui, sans-serif";

/** Wraps text to a width, returning the lines that fit within `maxLines`. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    if (ctx.measureText(lines[maxLines - 1]).width > maxWidth) lines[maxLines - 1] = `${last}…`;
  }

  return lines;
}

export function renderShareCard(
  canvas: HTMLCanvasElement,
  card: ShareCardData,
  ratio: ShareRatio,
  watermark: boolean,
): void {
  const { width, height } = DIMENSIONS[ratio];
  const dpr = 2;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width / dpr}px`;
  canvas.style.height = `${height / dpr}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const accent = ACCENTS[card.accent] ?? ACCENTS.brass;
  const pad = Math.round(width * 0.085);
  const contentWidth = width - pad * 2;

  /* ------------------------------ background ----------------------------- */

  ctx.fillStyle = '#0B0D0F';
  ctx.fillRect(0, 0, width, height);

  // A single warm pool, positioned high, mirroring the app's own hero light.
  const glow = ctx.createRadialGradient(
    width * 0.22,
    height * 0.16,
    0,
    width * 0.22,
    height * 0.16,
    width * 0.85,
  );
  glow.addColorStop(0, `${accent}22`);
  glow.addColorStop(0.45, `${accent}0A`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // A geometric mark derived from the title, so two cards never look alike.
  drawMark(ctx, card, width, height, accent);

  // Vignette, to settle the edges.
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.3,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  /* -------------------------------- content ------------------------------ */

  let y = pad + Math.round(height * 0.03);

  // Eyebrow
  ctx.font = `500 ${Math.round(width * 0.019)}px ${UI_FONT}`;
  ctx.fillStyle = accent;
  ctx.textBaseline = 'top';
  const eyebrowText = card.subtitle.toUpperCase();
  ctx.letterSpacing = `${Math.round(width * 0.004)}px`;
  ctx.fillText(eyebrowText, pad, y);
  ctx.letterSpacing = '0px';
  y += Math.round(width * 0.055);

  // Title
  const titleSize = Math.round(width * (ratio === '16:9' ? 0.062 : 0.078));
  ctx.font = `400 ${titleSize}px ${DISPLAY_FONT}`;
  ctx.fillStyle = '#F5F2EB';
  const titleLines = wrapText(ctx, card.title, contentWidth, ratio === '16:9' ? 2 : 3);
  for (const line of titleLines) {
    ctx.fillText(line, pad, y);
    y += Math.round(titleSize * 1.14);
  }

  y += Math.round(height * 0.026);

  // Statement
  if (card.statement) {
    const size = Math.round(width * 0.026);
    ctx.font = `400 ${size}px ${UI_FONT}`;
    ctx.fillStyle = '#B9B3A5';
    for (const line of wrapText(ctx, card.statement, contentWidth * 0.92, 3)) {
      ctx.fillText(line, pad, y);
      y += Math.round(size * 1.5);
    }
    y += Math.round(height * 0.02);
  }

  // Rule
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(pad, y, contentWidth * 0.35, 1);
  y += Math.round(height * 0.035);

  // Supporting lines
  const lineSize = Math.round(width * 0.028);
  ctx.font = `400 ${lineSize}px ${UI_FONT}`;
  const maxLines = ratio === '16:9' ? 3 : 5;
  card.lines.slice(0, maxLines).forEach((line, index) => {
    ctx.fillStyle = index === 0 ? '#EBE7DE' : '#918B7E';
    const [text] = wrapText(ctx, line, contentWidth * 0.85, 1);
    ctx.fillText(text ?? line, pad, y);
    y += Math.round(lineSize * 1.62);
  });

  /* -------------------------------- figure ------------------------------- */

  const figureSize = Math.round(width * (ratio === '16:9' ? 0.11 : 0.135));
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${figureSize}px ${DISPLAY_FONT}`;
  ctx.fillStyle = accent;
  const figureY = height - pad - Math.round(height * 0.045);
  ctx.fillText(card.figure, pad, figureY);

  const figureWidth = ctx.measureText(card.figure).width;
  ctx.font = `500 ${Math.round(width * 0.018)}px ${UI_FONT}`;
  ctx.fillStyle = '#6E6961';
  ctx.letterSpacing = `${Math.round(width * 0.0035)}px`;
  ctx.fillText(card.figureLabel.toUpperCase(), pad + figureWidth + Math.round(width * 0.022), figureY);
  ctx.letterSpacing = '0px';

  /* ------------------------------- watermark ----------------------------- */

  if (watermark) {
    ctx.font = `400 ${Math.round(width * 0.017)}px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(145,139,126,0.6)';
    ctx.letterSpacing = `${Math.round(width * 0.006)}px`;
    const mark = 'HEARLOGUE';
    const markWidth = ctx.measureText(mark).width;
    ctx.fillText(mark, width - pad - markWidth, figureY);
    ctx.letterSpacing = '0px';
  }

  // Fine grain, matching the app's own surface treatment.
  drawGrain(ctx, width, height);
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  card: ShareCardData,
  width: number,
  height: number,
  accent: string,
): void {
  const geometry = coverGeometry(`${card.kind}:${card.title}`);
  const cx = width * 0.78;
  const cy = height * 0.26;
  const scale = Math.min(width, height) * 0.34;

  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, width * 0.0025);

  ctx.beginPath();
  ctx.arc(cx, cy, scale * (0.5 + geometry.seeds[0] * 0.4), 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    scale * (0.8 + geometry.seeds[1] * 0.3),
    scale * (0.3 + geometry.seeds[2] * 0.4),
    (geometry.rotation * Math.PI) / 180,
    0,
    Math.PI * 2,
  );
  ctx.stroke();

  ctx.globalAlpha = 0.08;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, scale * 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawGrain(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const step = 3;
  ctx.save();
  ctx.globalAlpha = 0.028;
  ctx.fillStyle = '#FFFFFF';
  // Deterministic sampling: a stable pattern rather than random per render.
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (((x * 73856093) ^ (y * 19349663)) % 11 === 0) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  ctx.restore();
}
