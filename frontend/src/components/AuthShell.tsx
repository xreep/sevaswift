import { Link } from 'react-router-dom';
import { Logo } from './Layout';

/** Two-column frame for sign-in pages: the promise on the left, the form on the right. */
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo className="[&_rect]:fill-white [&_span]:text-white" />
        <div>
          <p className="font-display text-6xl font-bold leading-[0.95] tracking-tight">
            Burst pipe at 2 a.m.?
            <br />
            <span className="text-signal">Help is already moving.</span>
          </p>
          <p className="mt-6 max-w-md text-lg text-white/75">
            Raise an emergency request and the nearest available verified technician is assigned
            automatically. Then follow them to your door on a live map.
          </p>
        </div>
        <ul className="grid grid-cols-3 gap-6 text-sm text-white/70">
          <li><span className="block font-display text-3xl font-semibold text-white">Auto</span>nearest-technician dispatch</li>
          <li><span className="block font-display text-3xl font-semibold text-white">Live</span>location and ETA</li>
          <li><span className="block font-display text-3xl font-semibold text-white">24/7</span>plumbing, electrical, AC</li>
        </ul>
        <svg className="pointer-events-none absolute -right-24 top-1/3 h-[420px] w-[420px] opacity-[0.07]" viewBox="0 0 32 32" aria-hidden>
          <path d="M18 4 9 18h6l-2 10 10-15h-6z" fill="#FFB000" />
        </svg>
      </aside>
      <section className="flex items-center justify-center bg-paper px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 inline-block lg:hidden">
            <Logo />
          </Link>
          <h2 className="font-display text-4xl font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-2 text-ink-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}
