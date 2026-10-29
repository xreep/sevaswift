import { useEffect, useRef } from 'react';

const ROUTE = 'M70 250 H150 V170 H250 V110 H318';
/** One drive takes this long, then the technician waits at the door before the loop restarts. */
const DRIVE_MS = 5600;
const PAUSE_MS = 1400;

/**
 * The brand's one illustration: a street grid seen from above, technicians as
 * dots, and the dispatched one driving the dashed route to a customer's door.
 * Drawn for dark backgrounds. With reduced motion the technician stays parked
 * part-way along the route and nothing moves.
 */
export default function RouteMotif({ className = '' }: { className?: string }) {
  const route = useRef<SVGPathElement>(null);
  const tech = useRef<SVGGElement>(null);

  useEffect(() => {
    const path = route.current;
    const dot = tech.current;
    // Decoration only: skip quietly where SVG geometry is unavailable (e.g. jsdom).
    if (!path || !dot || typeof path.getTotalLength !== 'function') return;
    const length = path.getTotalLength();
    const place = (fraction: number) => {
      const p = path.getPointAtLength(length * fraction);
      dot.setAttribute('transform', `translate(${p.x} ${p.y})`);
    };

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      place(0.6);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) % (DRIVE_MS + PAUSE_MS);
      const x = Math.min(1, t / DRIVE_MS);
      place(x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2); // ease in-out
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg
      viewBox="0 0 400 300"
      className={className}
      role="img"
      aria-label="A technician driving to a customer on a city map"
    >
      <g stroke="#FFFFFF" strokeOpacity="0.09" strokeWidth="10" strokeLinecap="square" fill="none">
        <path d="M0 50 H400 M0 110 H400 M0 170 H400 M0 250 H400" />
        <path d="M30 0 V300 M150 0 V300 M250 0 V300 M360 0 V300" />
        <path d="M0 300 L210 0" strokeOpacity="0.06" strokeWidth="14" />
      </g>
      <g stroke="#FFFFFF" strokeOpacity="0.05" strokeWidth="2" fill="none">
        <path d="M90 50 V110 M200 170 V250 M300 50 V110 M90 170 V250 M305 170 V250" />
      </g>

      {/* Other technicians on duty */}
      {[
        [30, 75],
        [205, 50],
        [360, 205],
        [100, 170],
        [250, 280],
        [330, 50],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" fill="#1E8E5A" stroke="#17202B" strokeWidth="2" />
      ))}

      <path
        d={ROUTE}
        fill="none"
        stroke="#FFB000"
        strokeOpacity="0.25"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        ref={route}
        d={ROUTE}
        className="motif-route"
        fill="none"
        stroke="#FFB000"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="8 8"
      />

      {/* Customer's home */}
      <g transform="translate(318 110)">
        <circle r="20" fill="#FFB000" fillOpacity="0.18" className="motif-pulse" />
        <rect x="-13" y="-13" width="26" height="26" rx="6" fill="#FFFFFF" />
        <path d="M0 -7 -8 0h2.5v7h4v-4h3v4h4V0H8z" fill="#17202B" />
      </g>

      {/* The dispatched technician */}
      <g ref={tech} transform="translate(70 250)">
        <circle r="9" fill="#FFB000" stroke="#17202B" strokeWidth="3" />
      </g>
    </svg>
  );
}
