import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yauzl from 'yauzl';
import { HearlogueError } from '../../utils/errors';

/**
 * Resolving whatever the user dropped on the import target into a flat list of
 * JSON payloads.
 *
 * Accepts a Spotify ZIP, an extracted export folder, loose JSON files, or any
 * mixture of the three. Folders are walked, ZIPs are read entry by entry, and
 * everything that is not plausibly streaming history is filtered out before it
 * costs a JSON parse.
 */

export interface ResolvedSource {
  /** Display name, e.g. "Streaming_History_Audio_2019_5.json". */
  name: string;
  /** Where it came from, for the report: a path or "archive.zip -> entry". */
  origin: string;
  sizeBytes: number;
  read: () => Promise<string>;
}

/** File names Spotify has used for streaming history, across export generations. */
const HISTORY_NAME_PATTERNS = [
  /streaming[_-]?history/i,
  /^endsong[_-]?\d*\.json$/i,
  /StreamingHistory[_-]?music/i,
];

const MAX_JSON_BYTES = 512 * 1024 * 1024;

function looksLikeHistoryName(name: string): boolean {
  const base = path.basename(name);
  if (!base.toLowerCase().endsWith('.json')) return false;
  return HISTORY_NAME_PATTERNS.some((re) => re.test(base));
}

function isJsonName(name: string): boolean {
  return path.basename(name).toLowerCase().endsWith('.json');
}

/** Entries we never want to open even though they are JSON. */
const IGNORED_NAME_PATTERNS = [
  /Userdata\.json$/i,
  /Identity\.json$/i,
  /Payments\.json$/i,
  /Follow\.json$/i,
  /Inferences\.json$/i,
  /SearchQueries\.json$/i,
  /Playlist\d*\.json$/i,
  /YourLibrary\.json$/i,
  /Marquee\.json$/i,
  /^__MACOSX\//,
  /\/\._/,
];

function isIgnored(name: string): boolean {
  return IGNORED_NAME_PATTERNS.some((re) => re.test(name));
}

export function sha256OfFile(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead = 0;
    let position = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

export function sha256OfString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function walkDirectory(dir: string, out: string[], depth = 0): void {
  if (depth > 8) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__MACOSX' || entry.name.startsWith('.')) continue;
      walkDirectory(full, out, depth + 1);
    } else if (entry.isFile() && isJsonName(entry.name) && !isIgnored(full)) {
      out.push(full);
    }
  }
}

function readZipEntries(zipPath: string): Promise<ResolvedSource[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(
          new HearlogueError('CORRUPT_ARCHIVE', 'error.badZip', path.basename(zipPath), err),
        );
        return;
      }

      const sources: ResolvedSource[] = [];
      const zipName = path.basename(zipPath);

      zipfile.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        const isDir = name.endsWith('/');
        if (isDir || !isJsonName(name) || isIgnored(name)) {
          zipfile.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_JSON_BYTES) {
          zipfile.readEntry();
          return;
        }
        sources.push({
          name: path.basename(name),
          origin: `${zipName} -> ${name}`,
          sizeBytes: entry.uncompressedSize,
          read: () =>
            new Promise<string>((res, rej) => {
              zipfile.openReadStream(entry, (streamErr, stream) => {
                if (streamErr || !stream) {
                  rej(
                    new HearlogueError('CORRUPT_ARCHIVE', 'error.badZipEntry', name, streamErr),
                  );
                  return;
                }
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('error', (e) =>
                  rej(new HearlogueError('CORRUPT_ARCHIVE', 'error.badZipEntry', name, e)),
                );
                stream.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
              });
            }),
        });
        zipfile.readEntry();
      });

      zipfile.on('error', (zipErr) => {
        reject(new HearlogueError('CORRUPT_ARCHIVE', 'error.badZip', zipName, zipErr));
      });

      zipfile.on('end', () => resolve(sources));
      zipfile.readEntry();
    });
  });
}

/** True when a path is a ZIP by extension. */
export function isZipPath(p: string): boolean {
  return p.toLowerCase().endsWith('.zip');
}

/**
 * Expands user-selected paths into readable JSON sources.
 *
 * When the selection contains files whose names match Spotify's streaming-history
 * conventions, only those are used. Otherwise every JSON file is offered and the
 * parser decides by inspecting the content — that is what makes "I renamed my
 * files" and "I only kept one file" work.
 */
export async function resolveSources(paths: string[]): Promise<{
  sources: ResolvedSource[];
  zipCount: number;
  folderCount: number;
  fileCount: number;
}> {
  const sources: ResolvedSource[] = [];
  const looseFiles: string[] = [];
  let zipCount = 0;
  let folderCount = 0;

  for (const input of paths) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(input);
    } catch {
      throw new HearlogueError('NOT_FOUND', 'error.fileMissing', path.basename(input));
    }

    if (stat.isDirectory()) {
      folderCount += 1;
      walkDirectory(input, looseFiles);
    } else if (isZipPath(input)) {
      zipCount += 1;
      const zipSources = await readZipEntries(input);
      sources.push(...zipSources);
    } else if (isJsonName(input)) {
      looseFiles.push(input);
    }
  }

  for (const file of looseFiles) {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_JSON_BYTES) continue;
    sources.push({
      name: path.basename(file),
      origin: file,
      sizeBytes: size,
      read: async () => fs.promises.readFile(file, 'utf8'),
    });
  }

  // Prefer canonically named history files when the selection contains any.
  const named = sources.filter((s) => looksLikeHistoryName(s.name));
  const chosen = named.length > 0 ? named : sources;

  // Deterministic order: chronological file names sort naturally, which keeps
  // import progress and the resulting ids stable across runs.
  chosen.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

  return {
    sources: chosen,
    zipCount,
    folderCount,
    fileCount: looseFiles.length,
  };
}

export function describeSourceSelection(paths: string[]): { type: string; name: string } {
  if (paths.length === 0) return { type: 'files', name: 'empty selection' };
  if (paths.length === 1) {
    const single = paths[0];
    let isDir = false;
    try {
      isDir = fs.statSync(single).isDirectory();
    } catch {
      /* fall through to name-based description */
    }
    if (isDir) return { type: 'folder', name: path.basename(single) };
    if (isZipPath(single)) return { type: 'zip', name: path.basename(single) };
    return { type: 'files', name: path.basename(single) };
  }
  return { type: 'files', name: `${paths.length} files` };
}
