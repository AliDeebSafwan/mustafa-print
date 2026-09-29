import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '../src/http-error';
import { assertFileIsClean, createClamdScanner, disabledScanner, ScannerUnavailable, type FileScanner } from '../src/modules/media/virus-scan';

/** A stand-in clamd that parses INSTREAM exactly as the real one does, so a framing mistake fails here. */
function fakeClamd(behave: (received: Buffer, socket: Socket) => void) {
  const seen: { command: string; chunks: number[]; bytes: Buffer; terminated: boolean } = { command: '', chunks: [], bytes: Buffer.alloc(0), terminated: false };
  const server: Server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    let stage: 'command' | 'chunks' = 'command';
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 'command') {
        const nul = buf.indexOf(0);
        if (nul < 0) return;
        seen.command = buf.subarray(0, nul).toString();
        buf = buf.subarray(nul + 1);
        stage = 'chunks';
      }
      while (stage === 'chunks' && buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) { seen.terminated = true; buf = buf.subarray(4); behave(seen.bytes, socket); return; }
        if (buf.length < 4 + len) return;
        seen.chunks.push(len);
        seen.bytes = Buffer.concat([seen.bytes, buf.subarray(4, 4 + len)]);
        buf = buf.subarray(4 + len);
      }
    });
  });
  return { server, seen };
}
const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));

describe('the ClamAV client', () => {
  let dir: string;
  let servers: Server[] = [];
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'scan-')); servers = []; });
  afterEach(async () => { servers.forEach((s) => s.close()); await rm(dir, { recursive: true, force: true }); });

  const scannerFor = async (behave: (received: Buffer, socket: Socket) => void, timeoutMs = 2000) => {
    const { server, seen } = fakeClamd(behave);
    servers.push(server);
    return { scanner: createClamdScanner({ host: '127.0.0.1', port: await listen(server), timeoutMs }), seen };
  };
  const fileOf = async (bytes: Buffer) => { const p = join(dir, 'upload.bin'); await writeFile(p, bytes); return p; };

  it('streams the whole file in length-prefixed chunks, then ends the stream, and reads "OK" as clean', async () => {
    const payload = Buffer.alloc(200_000, 7);       // several 64 KB chunks
    const { scanner, seen } = await scannerFor((_, socket) => socket.end('stream: OK\0'));
    expect(await scanner.scanFile(await fileOf(payload))).toEqual({ clean: true });
    expect(seen.command).toBe('zINSTREAM');
    expect(seen.chunks.length).toBeGreaterThan(1);
    expect(seen.bytes.equals(payload)).toBe(true);   // every byte arrived, in order
    expect(seen.terminated).toBe(true);
  });

  it('reads "<name> FOUND" as infected and reports the signature', async () => {
    const { scanner } = await scannerFor((_, socket) => socket.end('stream: Win.Test.EICAR_HDB-1 FOUND\0'));
    expect(await scanner.scanFile(await fileOf(Buffer.from('x')))).toEqual({ clean: false, signature: 'Win.Test.EICAR_HDB-1' });
  });

  it('scans an empty file without hanging', async () => {
    const { scanner, seen } = await scannerFor((_, socket) => socket.end('stream: OK\0'));
    expect(await scanner.scanFile(await fileOf(Buffer.alloc(0)))).toEqual({ clean: true });
    expect(seen.terminated).toBe(true);
  });

  it('treats the scanner refusing the file (size limit) as unavailable, never as clean', async () => {
    const { scanner } = await scannerFor((_, socket) => socket.end('INSTREAM size limit exceeded. ERROR\0'));
    await expect(scanner.scanFile(await fileOf(Buffer.from('x')))).rejects.toBeInstanceOf(ScannerUnavailable);
  });

  it('treats a scanner that hangs up without an answer as unavailable', async () => {
    const { scanner } = await scannerFor((_, socket) => socket.end());
    await expect(scanner.scanFile(await fileOf(Buffer.from('x')))).rejects.toBeInstanceOf(ScannerUnavailable);
  });

  it('gives up on a scanner that never answers', async () => {
    const { scanner } = await scannerFor(() => { /* silence */ }, 300);
    await expect(scanner.scanFile(await fileOf(Buffer.from('x')))).rejects.toThrow(/no answer/);
  });

  it('treats a scanner that is not running as unavailable', async () => {
    const closed = createServer(); const port = await listen(closed); await new Promise((r) => closed.close(r));
    await expect(createClamdScanner({ host: '127.0.0.1', port, timeoutMs: 500 }).scanFile(await fileOf(Buffer.from('x')))).rejects.toBeInstanceOf(ScannerUnavailable);
  });
});

describe('the rule every upload applies', () => {
  const scanner = (result: () => Promise<{ clean: true } | { clean: false; signature: string }>): FileScanner => ({ enabled: true, scanFile: result });
  it('lets a clean file through', async () => {
    await expect(assertFileIsClean(scanner(async () => ({ clean: true })), '/x')).resolves.toBeUndefined();
  });
  it('refuses an infected file with a reason the person can act on', async () => {
    await expect(assertFileIsClean(scanner(async () => ({ clean: false, signature: 'Eicar' })), '/x')).rejects.toMatchObject({ status: 400, message: 'infected_file' });
  });
  it('refuses when the scanner cannot answer, instead of waving the file through', async () => {
    const err = await assertFileIsClean(scanner(async () => { throw new ScannerUnavailable('down'); }), '/x').catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 503, message: 'scanner_unavailable' });
  });
  it('does not turn an unexpected bug into a silent pass', async () => {
    await expect(assertFileIsClean(scanner(async () => { throw new TypeError('bug'); }), '/x')).rejects.toBeInstanceOf(TypeError);
  });
  it('does nothing when no scanner is configured', async () => {
    await expect(assertFileIsClean(disabledScanner, '/x')).resolves.toBeUndefined();
  });
});
