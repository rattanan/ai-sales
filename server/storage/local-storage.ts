import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorageService } from "./object-storage";

export class LocalObjectStorageService implements ObjectStorageService {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    if (!/^[a-f0-9-]+$/.test(key)) throw new Error("Invalid storage key");
    return path.join(this.root, key);
  }

  async put({ bytes }: { bytes: Buffer; originalName: string }) {
    await mkdir(this.root, { recursive: true });
    const key = randomUUID();
    await writeFile(this.resolve(key), bytes, { flag: "wx", mode: 0o600 });
    return {
      key,
      size: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  get(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    try {
      await unlink(this.resolve(key));
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
}
