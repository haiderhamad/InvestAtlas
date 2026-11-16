import { deflateRawSync } from 'node:zlib';

const CRC32_TABLE = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1
      ? 0xedb88320 ^ (value >>> 1)
      : value >>> 1;
  }
  return value >>> 0;
});

function crc32(input: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of input) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function createSingleEntryZip(
  content: string,
  fileName = 'eurofxref-hist.csv',
): ArrayBuffer {
  const name = Buffer.from(fileName, 'utf8');
  const source = Buffer.from(content, 'utf8');
  const compressed = deflateRawSync(source);
  const checksum = crc32(source);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.byteLength, 18);
  local.writeUInt32LE(source.byteLength, 22);
  local.writeUInt16LE(name.byteLength, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.byteLength, 20);
  central.writeUInt32LE(source.byteLength, 24);
  central.writeUInt16LE(name.byteLength, 28);

  const centralOffset = local.byteLength + name.byteLength
    + compressed.byteLength;
  const centralSize = central.byteLength + name.byteLength;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  const archive = Buffer.concat([
    local,
    name,
    compressed,
    central,
    name,
    eocd,
  ]);
  return Uint8Array.from(archive).buffer;
}
