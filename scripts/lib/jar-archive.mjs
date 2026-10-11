/**
 * Is a downloaded body the emulator's JAR?
 *
 * This exists because the first version of the check was wrong in a way that
 * cost a red CI run: it required the ZIP magic `PK` at offset 0, and the
 * published emulator artefact does not have it.
 *
 * `cloud-firestore-emulator-*.jar` is a **self-executing archive**. Its first
 * four bytes are `7f 45 4c 46` -- ELF -- followed by the ZIP payload and, at the
 * very end, the ZIP central directory. That is what lets the same file be run
 * directly on Linux and with `java -jar`; the JVM reads the central directory
 * from the end and never looks at byte 0. So the archive's own magic is at
 * offset 356,575 rather than 0, and a check for `PK` at the start rejects a
 * perfect download.
 *
 * The property that *is* true of any JAR, preamble or not, is the
 * end-of-central-directory record near the end of the file, so that is what is
 * checked. The declared length is checked too when the server gave one: what is
 * cached should be the thing that was sent.
 */

/** `PK\x05\x06` -- the signature that closes a ZIP archive. */
const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

/**
 * How much of the end to search.
 *
 * A ZIP's end-of-central-directory record sits within 65,557 bytes of the end:
 * the format lets a trailing comment push it back by at most 65,535 bytes, and
 * the record itself is 22. Anything further back than this cannot be the record
 * that closes the file.
 */
const TAIL = 65_535 + 22;

/**
 * @param {Uint8Array} bytes what came back from the download
 * @param {number | undefined} declaredLength the response's `Content-Length`, if any
 * @returns {boolean} whether this is a whole JAR
 */
export function looksLikeJar(bytes, declaredLength) {
  if (declaredLength !== undefined && bytes.length !== declaredLength) return false;
  const tail = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).subarray(
    Math.max(0, bytes.length - TAIL),
  );
  return tail.includes(EOCD);
}
