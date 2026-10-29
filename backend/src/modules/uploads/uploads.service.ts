import { prisma } from '../../common/prisma';
import { badRequest, notFound } from '../../common/errors/index';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Path under which an upload is served; also what jobs store in photoUrls. */
export const uploadPath = (id: string) => `/api/v1/uploads/${id}`;

const UPLOAD_PATH_RE =
  /^\/api\/v1\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function uploadIdFromPath(path: string): string | null {
  return UPLOAD_PATH_RE.exec(path)?.[1] ?? null;
}

/** Checks the first bytes so a renamed file cannot pass as an image. */
function sniffImageType(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export async function createUpload(ownerId: string, file: Express.Multer.File | undefined) {
  if (!file) throw badRequest('NO_FILE', 'Attach an image in the "file" field');
  const mimeType = sniffImageType(file.buffer);
  if (!mimeType) {
    throw badRequest('UNSUPPORTED_FILE', 'Only JPEG, PNG or WebP images are allowed');
  }
  const upload = await prisma.upload.create({
    data: { ownerId, mimeType, size: file.size, data: new Uint8Array(file.buffer) },
    select: { id: true, mimeType: true, size: true },
  });
  return { ...upload, url: uploadPath(upload.id) };
}

export async function getUpload(id: string) {
  const upload = await prisma.upload.findUnique({ where: { id } });
  if (!upload) throw notFound('UPLOAD_NOT_FOUND', 'File not found');
  return upload;
}

/** Throws unless every photo path is an upload owned by this user. */
export async function assertOwnedUploads(ownerId: string, photoUrls: string[]) {
  const ids = photoUrls.map(uploadIdFromPath);
  if (ids.some(id => id === null)) {
    throw badRequest('INVALID_PHOTO', 'Photos must be uploaded first');
  }
  const owned = await prisma.upload.count({
    where: { id: { in: ids as string[] }, ownerId },
  });
  if (owned !== new Set(ids).size) {
    throw badRequest('INVALID_PHOTO', 'One or more photos were not found');
  }
}
