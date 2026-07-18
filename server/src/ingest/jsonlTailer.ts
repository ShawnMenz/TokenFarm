import fs from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Adapter } from './types.js';

interface JsonlTailerOpts {
  root: string;
  source: string;
  // Mutated in place so the engine can persist resume positions in game state.
  offsets: Record<string, number>;
  onRecord: (record: unknown) => void;
}

// Recursively tails complete JSONL records without rewarding history that was
// already present the first time TokenFarm sees a directory.
export class JsonlTailer implements Adapter {
  private watcher: FSWatcher | null = null;
  private ready = false;

  constructor(private readonly opts: JsonlTailerOpts) {}

  start(): void {
    this.watcher = chokidar.watch(this.opts.root, { ignoreInitial: false });
    this.watcher
      .on('add', (filePath: string) => {
        if (!filePath.endsWith('.jsonl')) return;
        if (this.opts.offsets[filePath] === undefined) {
          // Existing files are history; a file created after ready is a new session.
          this.opts.offsets[filePath] = this.ready ? 0 : this.sizeOf(filePath);
        }
        this.readNew(filePath);
      })
      .on('change', (filePath: string) => {
        if (filePath.endsWith('.jsonl')) this.readNew(filePath);
      })
      .on('ready', () => {
        this.ready = true;
      })
      .on('error', (error: unknown) => {
        console.warn(`[${this.opts.source}] log watcher error`, error);
      });
    console.log(
      `[${this.opts.source}] watching ${this.opts.root} (recursive, *.jsonl)`,
    );
  }

  stop(): void {
    void this.watcher?.close();
    this.watcher = null;
  }

  private sizeOf(filePath: string): number {
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  }

  private readNew(filePath: string): void {
    const size = this.sizeOf(filePath);
    let from = this.opts.offsets[filePath] ?? 0;
    if (from > size) from = 0; // The file was truncated or rotated in place.
    if (from >= size) return;

    let fd: number | null = null;
    let buffer: Buffer;
    try {
      fd = fs.openSync(filePath, 'r');
      buffer = Buffer.alloc(size - from);
      fs.readSync(fd, buffer, 0, buffer.length, from);
    } catch {
      return;
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }

    // Leave an incomplete trailing record for the next change notification.
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline === -1) return;
    const consumable = buffer.subarray(0, lastNewline + 1);
    this.opts.offsets[filePath] = from + consumable.length;

    for (const line of consumable.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        this.opts.onRecord(JSON.parse(line) as unknown);
      } catch {
        // A malformed line or provider parser must not stop future ingestion.
      }
    }
  }
}
