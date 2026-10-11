import { describe, expect, it } from 'vitest';

import { looksLikeJar } from '../../scripts/lib/jar-archive.mjs';

/**
 * The check that guards the emulator download, held to both answers.
 *
 * It is here because its first version was wrong in exactly one direction and
 * CI found it: the check demanded the ZIP magic at offset 0, the published
 * emulator artefact is a self-executing archive that begins with an ELF
 * preamble, and a byte-perfect 64,322,030-byte download was refused as corrupt.
 * The guard had been proven to fire -- it just fired on a good file, which is
 * the failure a one-sided test never sees. So every case below comes in a pair:
 * an archive accepted, and the nearest thing to it that must not be.
 */

/** A ZIP's closing record: the signature, then the 18 bytes of fields after it. */
function endOfCentralDirectory(): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x0605_4b50, 0);
  return record;
}

/**
 * The shape the emulator distribution actually publishes: an ELF preamble, a
 * payload, and the central directory at the very end -- no `PK` at offset 0.
 */
function selfExecutingJar(): Buffer {
  const preamble = Buffer.alloc(512, 0);
  preamble.writeUInt32LE(0x464c_457f, 0); // `\x7fELF`
  return Buffer.concat([preamble, Buffer.alloc(1024, 0x41), endOfCentralDirectory()]);
}

describe('the emulator download is checked by its end, not its start', () => {
  it('accepts the self-executing archive, which does not begin with PK', () => {
    const jar = selfExecutingJar();
    expect(jar.subarray(0, 2).toString('latin1')).toBe('\x7fE');
    expect(looksLikeJar(jar)).toBe(true);
  });

  it('accepts an ordinary archive too', () => {
    const zip = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), endOfCentralDirectory()]);
    expect(looksLikeJar(zip)).toBe(true);
  });

  it('rejects a body that is not an archive at all', () => {
    const html = Buffer.from('<html><body>403 Forbidden</body></html>', 'utf8');
    expect(looksLikeJar(html)).toBe(false);
  });

  it('rejects a download that stopped short of the closing record', () => {
    const truncated = selfExecutingJar().subarray(0, 512 + 1024);
    expect(looksLikeJar(truncated)).toBe(false);
  });

  it('rejects a body shorter than the server said it would be', () => {
    const jar = selfExecutingJar();
    expect(looksLikeJar(jar, jar.length)).toBe(true);
    expect(looksLikeJar(jar, jar.length + 1)).toBe(false);
  });
});
