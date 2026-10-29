/**
 * One consistent line-icon family for the service catalogue (24px grid, 1.75
 * stroke, round joins). Services an admin adds later fall back to their emoji.
 */
const PATHS: Record<string, React.ReactNode> = {
  plumbing: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" />
  ),
  electrical: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  ac_repair: (
    <>
      <rect x="3" y="4" width="18" height="8" rx="2" />
      <path d="M7 9h10" />
      <path d="M8 15v1.5M12 15v4M16 15v1.5" />
    </>
  ),
  appliance: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2" />
      <path d="M4.5 7.5h15" />
      <circle cx="12" cy="14" r="4" />
      <path d="M7.5 5.25h.01M10 5.25h.01" />
    </>
  ),
  carpentry: (
    <>
      <path d="m14 4 6 6" />
      <path d="M17 7 7.5 16.5" />
      <path d="M4 20l3.5-3.5 2 2L6 22z" />
      <path d="m12 4 2-2 6 6-2 2" />
    </>
  ),
  painting: (
    <>
      <rect x="4" y="3" width="14" height="6" rx="1.5" />
      <path d="M18 6h2v5h-8v3" />
      <rect x="10.5" y="14" width="3" height="7" rx="1" />
    </>
  ),
  geyser: (
    <>
      <rect x="6" y="3" width="12" height="14" rx="3" />
      <path d="M9.5 17v4M14.5 17v4" />
      <path d="M12 7.5c1.1 1.3 1.7 2.2 1.7 3.2a1.7 1.7 0 0 1-3.4 0c0-1 .6-1.9 1.7-3.2Z" />
    </>
  ),
  ro_purifier: (
    <>
      <path d="M12 3s5 5.5 5 9.5a5 5 0 0 1-10 0C7 8.5 12 3 12 3Z" />
      <path d="M9.5 13.5a2.5 2.5 0 0 0 2.5 2.5" />
    </>
  ),
  pest_control: (
    <>
      <ellipse cx="12" cy="13.5" rx="4" ry="6" />
      <path d="M12 7.5V4M9.5 4.5 11 7M14.5 4.5 13 7" />
      <path d="M8 11H4.5M8 15H4M16 11h3.5M16 15h4" />
    </>
  ),
  deep_cleaning: (
    <>
      <path d="M9 21h6l-1-9h-4z" />
      <path d="M10 12V8h4v4" />
      <path d="M14 8h3l1.5-2" />
      <path d="M19 10.5h.01M21 8.5h.01M21 12.5h.01" />
    </>
  ),
};

const BY_CATEGORY: Record<string, string> = {
  Plumbing: 'plumbing',
  Electrical: 'electrical',
  HVAC: 'ac_repair',
  Appliance: 'appliance',
  Carpentry: 'carpentry',
  Painting: 'painting',
  Cleaning: 'deep_cleaning',
};

export default function ServiceIcon({
  service,
  className = 'h-6 w-6',
}: {
  service: { id: string; category?: string; icon?: string | null };
  className?: string;
}) {
  const key = PATHS[service.id] ? service.id : service.category ? BY_CATEGORY[service.category] : undefined;
  if (!key) {
    return (
      <span className={`inline-flex items-center justify-center leading-none ${className}`} aria-hidden>
        {service.icon ?? '•'}
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[key]}
    </svg>
  );
}
