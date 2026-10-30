/**
 * Illustrative photos (AI-generated with Google Gemini, watermark cropped) in
 * /public/images. Services not listed here fall back to their line icon.
 */
const SERVICE_PHOTOS = new Set([
  'plumbing',
  'electrical',
  'ac_repair',
  'appliance',
  'carpentry',
  'painting',
  'geyser',
  'ro_purifier',
  'pest_control',
  'deep_cleaning',
]);

export function servicePhoto(serviceId: string): string | null {
  return SERVICE_PHOTOS.has(serviceId) ? `/images/services/${serviceId}.webp` : null;
}

export const HERO_PHOTO = { src: '/images/hero.webp', small: '/images/hero-720.webp' };
