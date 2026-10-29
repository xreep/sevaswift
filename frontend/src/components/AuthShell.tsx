import { Link } from 'react-router-dom';
import { Logo } from './Layout';
import { HERO_PHOTO } from '../lib/images';

/** Two-column frame for sign-in pages: the promise on the left, the form on the right. */
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink text-white lg:block">
        <img
          src={HERO_PHOTO.src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[65%_center]"
          fetchPriority="high"
        />
        {/* Darken from the bottom so the message stays readable over any part of the photo. */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-ink/20" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-10 xl:p-12">
          <Logo onDark />
          <div>
            <p className="text-5xl font-bold leading-[1.02] tracking-tight xl:text-6xl">
              Burst pipe at 2 a.m.?
              <br />
              <span className="text-signal">Help is already moving.</span>
            </p>
            <p className="mt-5 max-w-md text-lg text-white/80">
              Raise an emergency request and the nearest available verified technician is assigned
              automatically. Then follow them to your door on a live map.
            </p>
            <ul className="mt-10 grid max-w-lg grid-cols-3 gap-6 text-sm text-white/75">
              <li><span className="block text-2xl font-bold text-white">Auto</span>nearest-technician dispatch</li>
              <li><span className="block text-2xl font-bold text-white">Live</span>location and ETA</li>
              <li><span className="block text-2xl font-bold text-white">Verified</span>technicians only</li>
            </ul>
            <p className="mt-6 text-xs text-white/50">Photo is illustrative.</p>
          </div>
        </div>
      </aside>
      <section className="flex items-center justify-center bg-paper px-4 py-12 sm:px-8">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 inline-block lg:hidden">
            <Logo />
          </Link>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
          {subtitle && <p className="mt-2 text-ink-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}
