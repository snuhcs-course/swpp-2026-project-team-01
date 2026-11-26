// A reader for the one binary property list shape the relay needs:
// NTChatRoom.displayMemberIds, a bplist00 array of integer user IDs
// (host-kakaotalk-mac-relay design 3). kakaocli's query returns BLOBs as
// nothing useful, so the relay selects hex(displayMemberIds) and decodes it
// here. Anything that is not an array of integers is refused with null, so a
// format change shows as "no members" rather than as wrong ones.

function readUInt(bytes: Uint8Array, offset: number, size: number): bigint {
  let value = 0n;
  for (let index = 0; index < size; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) throw new RangeError("Truncated property list.");
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function hexBytes(hex: string) {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

// The integers of a binary property list whose top object is an array of
// integers, as decimal strings (user IDs do not fit a JavaScript number), or
// null when the data is not one. An empty string decodes as an empty list.
export function decodeIntegerArray(hex: string): string[] | null {
  if (hex === "") return [];
  const bytes = hexBytes(hex);
  if (!bytes || bytes.length < 8 + 32) return null;
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== "bplist00") return null;

  try {
    const trailer = bytes.length - 32;
    const offsetSize = bytes[trailer + 6]!;
    const refSize = bytes[trailer + 7]!;
    const objectCount = Number(readUInt(bytes, trailer + 8, 8));
    const top = Number(readUInt(bytes, trailer + 16, 8));
    const tableOffset = Number(readUInt(bytes, trailer + 24, 8));
    if (offsetSize < 1 || offsetSize > 8 || refSize < 1 || refSize > 8 || top >= objectCount) return null;

    const objectOffset = (ref: number) => Number(readUInt(bytes, tableOffset + ref * offsetSize, offsetSize));
    const markerAt = (offset: number) => bytes[offset]!;

    const start = objectOffset(top);
    const marker = markerAt(start);
    if (marker >> 4 !== 0xa) return null;
    let count = marker & 0x0f;
    let refsStart = start + 1;
    if (count === 0x0f) {
      // The count follows as an integer object.
      const intMarker = markerAt(start + 1);
      if (intMarker >> 4 !== 0x1) return null;
      const size = 1 << (intMarker & 0x0f);
      count = Number(readUInt(bytes, start + 2, size));
      refsStart = start + 2 + size;
    }

    const values: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const ref = Number(readUInt(bytes, refsStart + index * refSize, refSize));
      if (ref >= objectCount) return null;
      const at = objectOffset(ref);
      const intMarker = markerAt(at);
      if (intMarker >> 4 !== 0x1) return null;
      const size = 1 << (intMarker & 0x0f);
      if (size > 8) return null;
      let value = readUInt(bytes, at + 1, size);
      // Eight-byte integers are signed.
      if (size === 8 && value >= 1n << 63n) value -= 1n << 64n;
      values.push(value.toString());
    }
    return values;
  } catch {
    return null;
  }
}
