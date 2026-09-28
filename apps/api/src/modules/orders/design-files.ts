import { open } from 'node:fs/promises';
import type { DESIGN_FILE_KINDS } from '@mpe/shared';

export type DesignKind = (typeof DESIGN_FILE_KINDS)[number];

/**
 * The type of a customer's design file, read from its first bytes. The name and what the browser claims are ignored:
 * a renamed program must never be stored as a "pdf". Illustrator files are PDF inside, so they are accepted as pdf.
 */
const SIGNATURES: { kind: DesignKind; bytes: number[] }[] = [
  { kind: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },                // %PDF
  { kind: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { kind: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { kind: 'tiff', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { kind: 'tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { kind: 'psd', bytes: [0x38, 0x42, 0x50, 0x53] },                // 8BPS
  { kind: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
];

export async function detectDesignKind(filePath: string): Promise<DesignKind | null> {
  const handle = await open(filePath, 'r');
  try {
    const head = Buffer.alloc(8);
    await handle.read(head, 0, 8, 0);
    return SIGNATURES.find((s) => s.bytes.every((b, i) => head[i] === b))?.kind ?? null;
  } finally {
    await handle.close();
  }
}
