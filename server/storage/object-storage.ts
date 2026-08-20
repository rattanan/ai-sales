export type StoredObject = { key: string; size: number; checksum: string };

export interface ObjectStorageService {
  put(input: { bytes: Buffer; originalName: string }): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
