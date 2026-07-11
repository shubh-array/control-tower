import { createHash } from "node:crypto";
import { canonicalJsonSerialize } from "./canonical-json.js";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256OfCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalJsonSerialize(value));
}
