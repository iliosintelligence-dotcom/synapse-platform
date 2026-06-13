/**
 * api/media — the media abstraction layer.
 * UI NEVER talks to Cloudinary directly. Pipeline: validate → upload →
 * derive variants → persist metadata → return typed result. Cloudinary
 * can be swapped without touching a single component.
 */
import { getDb } from '@synapse/database';
import { MediaType, type PropertyMedia, type MediaVariants, type UploadMediaResult } from '@synapse/types';

/* ───────── configuration ───────── */

export interface MediaConfig {
  cloudName: string;
  /** Unsigned upload preset — scoped to the synapse folder, no API secret on clients */
  uploadPreset: string;
}

let config: MediaConfig | null = null;

export function initMedia(c: MediaConfig): void {
  config = c;
}

function getConfig(): MediaConfig {
  if (!config) throw new Error('@synapse/api/media: initMedia() must be called at app boot.');
  return config;
}

/* ───────── validation ───────── */

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const ALLOWED_VIDEO_MIME = ['video/mp4', 'video/quicktime'];

export function validateMedia(mimeType: string, sizeBytes: number, mediaType: MediaType): void {
  if (mediaType === MediaType.IMAGE || mediaType === MediaType.FLOOR_PLAN) {
    if (!ALLOWED_IMAGE_MIME.includes(mimeType)) {
      throw new Error(`Unsupported image type: ${mimeType}`);
    }
    if (sizeBytes > MAX_IMAGE_BYTES) throw new Error('Image exceeds 15MB limit');
  } else if (mediaType === MediaType.VIDEO) {
    if (!ALLOWED_VIDEO_MIME.includes(mimeType)) {
      throw new Error(`Unsupported video type: ${mimeType}`);
    }
    if (sizeBytes > MAX_VIDEO_BYTES) throw new Error('Video exceeds 200MB limit');
  }
}

/* ───────── variants ───────── */

/** Build delivery-URL variants from a public id. Pure — no network. */
export function buildVariants(publicId: string): MediaVariants {
  const { cloudName } = getConfig();
  const base = `https://res.cloudinary.com/${cloudName}/image/upload`;
  return {
    thumbnail: `${base}/c_fill,w_200,h_200,q_auto,f_auto/${publicId}`,
    card: `${base}/c_fill,w_800,q_auto,f_auto/${publicId}`,
    full: `${base}/c_limit,w_1600,q_auto,f_auto/${publicId}`,
    original: `${base}/${publicId}`,
  };
}

/* ───────── upload pipeline ───────── */

interface CloudinaryUploadResponse {
  public_id: string;
  secure_url: string;
  width: number;
  height: number;
}

/**
 * Upload one file and persist its metadata.
 * `file` is a Blob (web) or a { uri, name, type } descriptor (React Native
 * FormData accepts both shapes).
 */
export async function uploadPropertyMedia(params: {
  propertyId: string;
  file: Blob | { uri: string; name: string; type: string };
  mimeType: string;
  sizeBytes: number;
  mediaType: MediaType;
  displayOrder?: number;
}): Promise<UploadMediaResult> {
  const { cloudName, uploadPreset } = getConfig();
  validateMedia(params.mimeType, params.sizeBytes, params.mediaType);

  const form = new FormData();
  // RN's FormData typing accepts the descriptor object at runtime.
  form.append('file', params.file as Blob);
  form.append('upload_preset', uploadPreset);
  form.append('folder', `synapse/properties/${params.propertyId}`);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Cloudinary upload failed: ${res.status} ${await res.text()}`);
  }
  const uploaded = (await res.json()) as CloudinaryUploadResponse;
  const variants = buildVariants(uploaded.public_id);

  const { data, error } = await getDb()
    .from('property_media')
    .insert({
      property_id: params.propertyId,
      url: uploaded.secure_url,
      cloudinary_public_id: uploaded.public_id,
      media_type: params.mediaType,
      display_order: params.displayOrder ?? 0,
      width: uploaded.width,
      height: uploaded.height,
    })
    .select('*')
    .single();
  if (error) throw error;

  return { media: data as PropertyMedia, variants };
}

export async function deletePropertyMedia(mediaId: string): Promise<void> {
  // Soft delete the row. Cloudinary asset destruction requires a signed
  // call — handled by an Edge Function with the API secret.
  // TODO(layer-2): add `media-destroy` Edge Function that deletes the
  // Cloudinary asset via the Admin API when a row is soft-deleted.
  const { error } = await getDb()
    .from('property_media')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', mediaId);
  if (error) throw error;
}

/** Variants for an existing media row — for rendering, no network. */
export function variantsFor(media: PropertyMedia): MediaVariants {
  return buildVariants(media.cloudinary_public_id);
}
