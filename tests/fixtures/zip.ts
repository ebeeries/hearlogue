import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * A minimal ZIP writer.
 *
 * Exists so the import tests can exercise the real `yauzl` extraction path
 * rather than mocking it — a Spotify export arrives as a ZIP, so that is what
 * the tests should hand the importer. Deflate-compressed entries only, which is
 * what Spotify's own archives use.
 */

interface Entry {
  name: string;
  data: Buffer;
  compressed: Buffer;
  crc: number;
  offset: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS timestamp — fixed, so a generated ZIP is byte-identical run to run. */
const DOS_TIME = 0x6000;
const DOS_DATE = 0x5a21;

function localHeader(entry: Entry): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(8, 8); // method: deflate
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralHeader(entry: Entry): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk
  header.writeUInt16LE(0, 36); // internal attrs
  header.writeUInt32LE(0, 38); // external attrs
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, name]);
}

export function writeZip(target: string, files: { name: string; content: string }[]): string {
  const entries: Entry[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const data = Buffer.from(file.content, 'utf8');
    const entry: Entry = {
      name: file.name,
      data,
      compressed: zlib.deflateRawSync(data),
      crc: crc32(data),
      offset,
    };
    entries.push(entry);
    const header = localHeader(entry);
    chunks.push(header, entry.compressed);
    offset += header.length + entry.compressed.length;
  }

  const central = entries.map(centralHeader);
  const centralSize = central.reduce((sum, buffer) => sum + buffer.length, 0);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(target, Buffer.concat([...chunks, ...central, end]));
  return target;
}
