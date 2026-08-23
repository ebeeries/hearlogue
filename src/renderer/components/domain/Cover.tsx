import { useMemo } from 'react';
import { coverGeometry, coverInitials, type CoverGeometry } from '../../lib/artwork';
import { cx } from '../ui/primitives';

/**
 * Generated cover art.
 *
 * The export carries no artwork and the app never goes online, so a mark is
 * derived from the name instead: same name, same art, every time. Six geometric
 * families keep a long list visually varied without any of them looking random.
 */

export type CoverSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero';

const SIZES: Record<CoverSize, string> = {
  xs: 'h-7 w-7 rounded text-[9px]',
  sm: 'h-9 w-9 rounded text-[10px]',
  md: 'h-11 w-11 rounded-md text-[11px]',
  lg: 'h-16 w-16 rounded-md text-[13px]',
  xl: 'h-24 w-24 rounded-lg text-[17px]',
  hero: 'h-36 w-36 rounded-lg text-[24px]',
};

function Marks({ geometry }: { geometry: CoverGeometry }): JSX.Element {
  const { shape, palette, seeds } = geometry;
  const [a, b, c, d] = seeds;

  switch (shape) {
    case 'arc':
      return (
        <>
          <circle
            cx={50 + (a - 0.5) * 26}
            cy={50 + (b - 0.5) * 26}
            r={20 + c * 22}
            fill="none"
            stroke={palette.ink}
            strokeWidth={1.6 + d * 2.6}
            opacity={0.55}
          />
          <circle cx={50 - (a - 0.5) * 30} cy={50 + (c - 0.5) * 30} r={5 + b * 9} fill={palette.accent} opacity={0.75} />
        </>
      );

    case 'bars':
      return (
        <>
          {[0, 1, 2, 3, 4].map((i) => {
            const height = 16 + ((seeds[i % 4] * 100 + i * 37) % 62);
            return (
              <rect
                key={i}
                x={14 + i * 15}
                y={88 - height}
                width={8}
                height={height}
                rx={1.5}
                fill={i % 2 === 0 ? palette.ink : palette.accent}
                opacity={0.32 + (i % 3) * 0.19}
              />
            );
          })}
        </>
      );

    case 'grid':
      return (
        <>
          {Array.from({ length: 9 }, (_, i) => {
            const row = Math.floor(i / 3);
            const col = i % 3;
            const on = ((seeds[i % 4] * 1000 + i * 131) % 10) > 3.6;
            return (
              <rect
                key={i}
                x={18 + col * 23}
                y={18 + row * 23}
                width={17}
                height={17}
                rx={2}
                fill={on ? palette.accent : palette.ink}
                opacity={on ? 0.72 : 0.17}
              />
            );
          })}
        </>
      );

    case 'orbit':
      return (
        <>
          <ellipse
            cx="50"
            cy="50"
            rx={36}
            ry={12 + a * 20}
            fill="none"
            stroke={palette.ink}
            strokeWidth="1.5"
            opacity="0.45"
            transform={`rotate(${geometry.rotation} 50 50)`}
          />
          <ellipse
            cx="50"
            cy="50"
            rx={22 + b * 12}
            ry={9 + c * 14}
            fill="none"
            stroke={palette.accent}
            strokeWidth="1.5"
            opacity="0.62"
            transform={`rotate(${geometry.rotation + 62} 50 50)`}
          />
          <circle cx="50" cy="50" r={4 + d * 6} fill={palette.accent} opacity="0.85" />
        </>
      );

    case 'wave':
      return (
        <>
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M0 ${40 + i * 16} Q 25 ${40 + i * 16 - (12 + a * 22)} 50 ${40 + i * 16} T 100 ${40 + i * 16}`}
              fill="none"
              stroke={i === 1 ? palette.accent : palette.ink}
              strokeWidth={1.4 + (i === 1 ? 1.2 : 0)}
              opacity={0.3 + i * 0.22}
            />
          ))}
        </>
      );

    case 'split':
    default:
      return (
        <>
          <path
            d={`M0 ${100 * b} L100 ${100 * c} L100 100 L0 100 Z`}
            fill={palette.ink}
            opacity="0.16"
          />
          <path
            d={`M0 ${100 * (b + 0.18)} L100 ${100 * (c + 0.24)} L100 100 L0 100 Z`}
            fill={palette.accent}
            opacity="0.42"
          />
          <circle cx={22 + a * 56} cy={20 + d * 22} r={4 + a * 5} fill={palette.ink} opacity="0.7" />
        </>
      );
  }
}

export interface CoverProps {
  name: string;
  /** Disambiguates two records with the same title by different artists. */
  secondary?: string | null;
  size?: CoverSize;
  className?: string;
  rounded?: 'default' | 'full';
  showInitials?: boolean;
}

export function Cover({
  name,
  secondary,
  size = 'md',
  className,
  rounded = 'default',
  showInitials = true,
}: CoverProps): JSX.Element {
  const seed = `${name}::${secondary ?? ''}`;
  const geometry = useMemo(() => coverGeometry(seed), [seed]);
  const initials = useMemo(() => coverInitials(name), [name]);
  const gradientId = useMemo(() => `cv${Math.abs(hashString(seed))}`, [seed]);

  const small = size === 'xs' || size === 'sm';

  return (
    <div
      aria-hidden
      className={cx(
        'relative shrink-0 overflow-hidden border border-white/[0.07]',
        SIZES[size],
        rounded === 'full' && '!rounded-full',
        className,
      )}
      style={{ backgroundColor: geometry.palette.to }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={geometry.palette.from} />
            <stop offset="100%" stopColor={geometry.palette.to} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${gradientId})`} />
        {!small && <Marks geometry={geometry} />}
      </svg>

      {showInitials && (
        <span
          className="absolute inset-0 flex items-center justify-center font-display font-medium tracking-wide"
          style={{
            color: geometry.palette.ink,
            opacity: small ? 0.92 : 0.55,
            textShadow: '0 1px 3px rgba(0,0,0,0.5)',
          }}
        >
          {initials}
        </span>
      )}

      {/* A faint inner edge keeps the tile from looking pasted on. */}
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -12px 24px rgba(0,0,0,0.35)' }}
      />
    </div>
  );
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (Math.imul(h, 31) + input.charCodeAt(i)) | 0;
  return h;
}
