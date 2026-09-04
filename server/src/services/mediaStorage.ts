import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MEDIA_CONFIG } from '../config/media';

export type SignedUpload = {
  path: string;
  token: string;
  signedUrl: string;
};

export interface MediaStorage {
  createSignedUpload(bucket: string, key: string): Promise<SignedUpload>;
  download(bucket: string, key: string): Promise<Buffer>;
  upload(bucket: string, key: string, body: Buffer, mime: string, cacheControl: string): Promise<void>;
  copy(sourceBucket: string, sourceKey: string, destinationBucket: string, destinationKey: string): Promise<void>;
  remove(bucket: string, keys: string[]): Promise<void>;
  createSignedReadUrl(bucket: string, key: string, expiresIn: number): Promise<string>;
  getPublicUrl(bucket: string, key: string): string;
  provisionBuckets(): Promise<void>;
}

const requireEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Media storage is not configured: ${name} is missing`);
  }
  return value;
};

export const isMediaStorageConfigured = (): boolean =>
  Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

export class SupabaseMediaStorage implements MediaStorage {
  private readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      requireEnvironment('SUPABASE_URL'),
      requireEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      }
    );
  }

  async createSignedUpload(bucket: string, key: string): Promise<SignedUpload> {
    const { data, error } = await this.client.storage.from(bucket).createSignedUploadUrl(key, { upsert: false });
    if (error || !data) throw new Error(`Storage could not sign upload: ${error?.message || 'unknown error'}`);
    return data;
  }

  async download(bucket: string, key: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(bucket).download(key);
    if (error || !data) throw new Error(`Storage download failed: ${error?.message || 'unknown error'}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async upload(bucket: string, key: string, body: Buffer, mime: string, cacheControl: string): Promise<void> {
    const { error } = await this.client.storage.from(bucket).upload(key, body, {
      contentType: mime,
      cacheControl,
      upsert: true
    });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }

  async copy(sourceBucket: string, sourceKey: string, destinationBucket: string, destinationKey: string): Promise<void> {
    const { error } = await this.client.storage
      .from(sourceBucket)
      .copy(sourceKey, destinationKey, { destinationBucket });
    if (error) throw new Error(`Storage copy failed: ${error.message}`);
  }

  async remove(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { error } = await this.client.storage.from(bucket).remove(keys);
    if (error) throw new Error(`Storage removal failed: ${error.message}`);
  }

  async createSignedReadUrl(bucket: string, key: string, expiresIn: number): Promise<string> {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(key, expiresIn);
    if (error || !data) throw new Error(`Storage could not sign read URL: ${error?.message || 'unknown error'}`);
    return data.signedUrl;
  }

  getPublicUrl(bucket: string, key: string): string {
    return this.client.storage.from(bucket).getPublicUrl(key).data.publicUrl;
  }

  async provisionBuckets(): Promise<void> {
    const definitions = [
      { id: MEDIA_CONFIG.buckets.originals, public: false },
      { id: MEDIA_CONFIG.buckets.private, public: false },
      { id: MEDIA_CONFIG.buckets.public, public: true }
    ];

    for (const definition of definitions) {
      const options = {
        public: definition.public,
        fileSizeLimit: MEDIA_CONFIG.maxInputBytes,
        allowedMimeTypes: definition.id === MEDIA_CONFIG.buckets.originals
          ? [...MEDIA_CONFIG.allowedSourceMimeTypes]
          : [...MEDIA_CONFIG.allowedMimeTypes]
      };
      const { data: existing } = await this.client.storage.getBucket(definition.id);
      const operation = existing
        ? await this.client.storage.updateBucket(definition.id, options)
        : await this.client.storage.createBucket(definition.id, options);
      if (operation.error) {
        throw new Error(`Could not provision bucket ${definition.id}: ${operation.error.message}`);
      }
    }
  }
}

let storage: MediaStorage | undefined;

export const getMediaStorage = (): MediaStorage => {
  if (!storage) storage = new SupabaseMediaStorage();
  return storage;
};

export const setMediaStorageForTests = (replacement?: MediaStorage): void => {
  storage = replacement;
};
