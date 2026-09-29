import { createReadStream } from 'node:fs';
import { connect } from 'node:net';
import { HttpError } from '../../http-error';

export type ScanResult = { clean: true } | { clean: false; signature: string };

/** The scanner could not give an answer (not running, timed out, refused the file). NOT the same as "infected". */
export class ScannerUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'ScannerUnavailable'; }
}

export interface FileScanner {
  /** False when no scanner is configured: uploads are then accepted on the strength of their real file type alone. */
  readonly enabled: boolean;
  scanFile(path: string): Promise<ScanResult>;
}

export const disabledScanner: FileScanner = { enabled: false, scanFile: async () => ({ clean: true }) };

const CHUNK = 64 * 1024;

/**
 * Talks to a running `clamd` using its INSTREAM command: the file is streamed as length-prefixed chunks, so the
 * scanner never needs to share a filesystem with the API (it runs in its own container). Answers are read exactly:
 * "OK" is clean, "<name> FOUND" is infected, and anything else — including "size limit exceeded" — is treated as
 * "could not scan", never as "clean".
 */
export function createClamdScanner({ host, port, timeoutMs }: { host: string; port: number; timeoutMs: number }): FileScanner {
  function scanFile(path: string): Promise<ScanResult> {
    return new Promise<ScanResult>((resolve, reject) => {
      const socket = connect({ host, port });
      let reply = '';
      let settled = false;
      const done = (fn: () => void) => { if (settled) return; settled = true; socket.destroy(); fn(); };
      const fail = (message: string) => done(() => reject(new ScannerUnavailable(message)));

      socket.setTimeout(timeoutMs, () => fail(`no answer from the scanner within ${timeoutMs} ms`));
      socket.on('error', (err) => fail(`scanner connection failed: ${err.message}`));
      socket.on('data', (d) => { reply += d.toString('utf8'); });
      socket.on('end', () => {
        const text = reply.replace(/\0/g, '').trim();
        const found = /^stream:\s*(.+?)\s+FOUND$/.exec(text);
        if (text === 'stream: OK') return done(() => resolve({ clean: true }));
        if (found) return done(() => resolve({ clean: false, signature: found[1]! }));
        fail(`the scanner could not check the file: ${text || 'empty reply'}`);
      });

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const file = createReadStream(path, { highWaterMark: CHUNK });
        file.on('data', (chunk) => {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          const size = Buffer.alloc(4);
          size.writeUInt32BE(buf.length);
          if (!socket.write(Buffer.concat([size, buf]))) { file.pause(); socket.once('drain', () => file.resume()); }
        });
        file.on('end', () => socket.write(Buffer.alloc(4)));   // a zero-length chunk ends the stream
        file.on('error', (err) => fail(`could not read the upload: ${err.message}`));
      });
    });
  }
  return { enabled: true, scanFile };
}

/**
 * The rule every upload path applies. An infected file is refused with a reason the person can act on. If the
 * scanner is configured but cannot answer, the upload is refused too — never waved through — because the whole
 * point of scanning is that an unchecked file does not reach the shop's staff.
 */
export async function assertFileIsClean(scanner: FileScanner, path: string): Promise<void> {
  if (!scanner.enabled) return;
  try {
    const result = await scanner.scanFile(path);
    if (!result.clean) throw new HttpError(400, 'invalid_request', 'infected_file');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof ScannerUnavailable) throw new HttpError(503, 'internal_error', 'scanner_unavailable');
    throw err;
  }
}
