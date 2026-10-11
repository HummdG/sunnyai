# The operational database

The API keeps every record behind one interface, `Store` in
`apps/api/src/store.ts`, and there are two implementations of it:

| Store            | Where                             | Which deployment                                    |
| ---------------- | --------------------------------- | --------------------------------------------------- |
| `FileStore`      | `apps/api/src/store.ts`           | Development, and a production run that opts into it |
| `FirestoreStore` | `apps/api/src/firestore-store.ts` | Production (`SUNNY_STORE=firestore`)                |

Choosing between them is one environment variable. `SUNNY_STORE` must be `file`
or `firestore`, and in production it must be set to one of them: a deployment
that never chose would get the file store, which on Cloud Run is a container's
own filesystem, and every enquiry would be gone at the next deploy with nothing
in the configuration afterwards to point at. `assertStoreConfigured` in
`apps/api/src/config.ts` refuses that boot, and refuses
`SUNNY_STORE=firestore` with no `GOOGLE_CLOUD_PROJECT` rather than falling back
to local files. See the tables below and D-52.

## Where the data lives

Every tenant-owned record is under its own tenant's path. The tenant is a path
segment, so a read that crossed tenants is not something the code has to
remember _not_ to do — there is no query in the store that can name two
tenants.

```
tenants/{tenantId}/conversations/{s_<sessionId>}          one conversation
tenants/{tenantId}/conversations/{s_<sessionId>}/turns/…  its transcript, one document per turn
tenants/{tenantId}/leads/{…}                              enquiries
tenants/{tenantId}/products/{…}                           the installer's catalogue
tenants/{tenantId}/knowledge/{…}                          ingested sources and their passages
tenants/{tenantId}/jobs/{…}                               ingestion jobs
tenants/{tenantId}/audit/{…}                              the audit trail
unscoped_audit/{…}                                        events that belong to no tenant
_meta/health                                              the round trip `/healthz` makes
```

`unscoped_audit` is the one top-level collection, and it holds the events for a
request that named no valid credential — there is no tenant to file those under,
and a record of a refused request is worth keeping.

## Running the store's tests

```
npm run test:firestore
```

That boots the Cloud Firestore emulator on a free port, points the suite at it
and tears it down. It is the same 21-case contract the file store is held to —
44 tests — so "the two stores answer the same questions the same way" is
something the run checks rather than something a comment claims.

The emulator is the official JAR, fetched from the URL the emulator distribution
publishes and cached in `.cache/` (already gitignored). Nothing depends on
`firebase-tools` being installed. What it does need is a **Java runtime**, which
`scripts/firestore-emulator.mjs` looks for in this order:

1. `SUNNY_JAVA` — the path to a `java` executable.
2. `.cache/jre/<name>/bin/java` — a JRE dropped there, for a machine that has
   none on `PATH` (the script does not download one: fetching and extracting a
   JDK is platform-specific enough that a wrong guess is worse than a message).
3. `java` on `PATH` — a developer with Java installed, and CI, where
   `actions/setup-java` provides it.

If none of the three is present the script says so and exits rather than
starting a run that cannot work.

**The download is checked by its end, not its start.** The artefact is a
_self-executing archive_: its first four bytes are `7f 45 4c 46` (ELF) and the
ZIP payload sits behind that preamble, with the central directory at the very
end. That is what lets the same file run directly on Linux and under
`java -jar`, and it means a check for the ZIP magic at offset 0 rejects a perfect
download. The first version of this check did exactly that, and the first CI run
of the `firestore` job failed on it: a byte-for-byte correct 64,322,030-byte
download, refused as corrupt. So the check looks for the end-of-central-directory
record in the file's last 65,557 bytes, which is true of any JAR with or without
a preamble, and compares the length against the response's `Content-Length` when
the server sent one. `tests/tooling/jar-archive.test.ts` holds it to both
answers — an archive accepted, and the nearest thing to it refused — because a
guard tested in one direction is how this one came to be wrong.

**Skipped is not passed.** Without an emulator the Firestore half of the suite is
reported as **skipped, with the reason in the suite's own name**, pointing at
this command. A green `npm test` that had silently skipped the production store
would be the most expensive kind of green there is, which is why the skip is
loud and why CI runs `firestore` as its own job
(`.github/workflows/ci.yml`).

The emulator address is read from `SUNNY_FIRESTORE_EMULATOR`, not from the
conventional `FIRESTORE_EMULATOR_HOST` that the client library honours on its
own. That is deliberate: an ambient variable should not be enough to point a
process at a throwaway database. `FirestoreStore`'s `emulatorHost` option makes
the same choice for the same reason — its docblock calls `null` the safe
direction for the default to fail in — and `config.test.ts` pins the variable
name: setting only the conventional name leaves `firestore.emulatorHost` null,
so the address the server acts on is the one the server was told.

## Two things the emulator cannot prove

Both of these pass locally and fail on the deployment that matters, so they are
recorded here rather than left to a green tick.

### 1. The emulator does not check indexes

A query that both filters and orders needs a **composite index**. Real Firestore
refuses the query until that index exists; the emulator runs it either way. So a
passing run says nothing about whether the deployment has the indexes it needs.

Every query in `FirestoreStore` is therefore written to need only single-field
indexes, which Firestore maintains automatically. The rule that keeps that true
is: **no query both filters and orders.** A `where` alone and an `orderBy` alone
each use one automatic index; it is the pair that demands a composite one. Where
a caller's order and a filter are both wanted, they are two reads or one
in-memory sort rather than one query.

That is a property of the source, which no emulator can be asked to check, so the
guard is `apps/api/test/firestore-indexes.test.ts`: it reads
`firestore-store.ts`, fails when a `where` and an `orderBy` land in the same
statement, and is itself tested against a source that violates the rule — a guard
that has only ever said "clean" is a guard nobody knows works. When it does fail,
either add the index to the deployment or take the ordering in memory.

### 2. Deleting a document does not delete its subcollections

Firestore leaves a document's subcollections behind, orphaned, when the document
is deleted. In this schema that would mean a visitor's transcript surviving the
erasure they asked for, while the API reported the erasure as having happened —
and `deleteConversation` is the one operation a caller cannot verify by looking
afterwards, because a blank success is indistinguishable from a request that did
nothing.

So every deletion that removes a conversation removes its turns in the same
operation, in `deleteConversation` and in `purgeExpired` alike. Two tests hold
this: the contract's, which reads the transcript back through a second client
after an erase, and a Firestore-specific one that asserts a purged
conversation's `turns` subcollection is empty rather than merely unreachable.

## How the two stores differ

The contract suite is the same for both, so these are the places where the same
answer is reached by different means, or where one store's answer is genuinely
not identical.

- **Insertion order is stored.** Firestore has no "as I inserted them" order: a
  query over two rows written in the same millisecond returns them in whatever
  order the backend likes. Every list this API returns would then be free to
  shuffle between two reads, which a caller would see. So insertion order is
  written down (`_seq` for a turn, `_ord` for a supplied row), and stripped again
  on the way out.
- **Lists are sorted in the process, not by the query.** A Firestore `orderBy`
  silently _excludes_ documents that lack the field being ordered by, so a row
  written without one would be invisible rather than merely last.
- **A duplicated product id leaves one row; the file store leaves two.** Rows are
  keyed by their own id, so an upload naming the same id twice collapses. That is
  the id behaving as an identity, and it is the one place where a caller could
  observe a difference.
- **Audit events in the same millisecond may come back in either order.** The
  file store returns them in the order they were written; Firestore orders by
  `at` and leaves ties to the backend. One request cannot tell them apart; two
  events in one millisecond can.
- **`listLeads` orders by `createdAt`, the file store by position in the file.**
  For rows this API wrote they are the same order, because `createdAt` is the
  clock at insertion.
- **A lead filed into a session while that session is being erased can survive.**
  The erase transaction locks the lead documents it read, not the collection. The
  file store has the same race for the same reason; it is recorded rather than
  papered over (D-52).
- **A retention sweep larger than one commit is not atomic.** A batch and a
  transaction alike cap at 500 writes, so a sweep is sent in commits of 400. A
  commit that fails leaves the earlier ones applied, which for a deletion is the
  harmless direction: the next run finishes the job.

## What is not here yet

- **No deployment has run against real Firestore.** The store is exercised
  against the emulator, which is a real server but not a real project: the
  project, its location, its security rules and its indexes are all still to be
  chosen and created (D-52, blocker 3).
- **Nothing is deployed**, so no Firestore database exists. The emulator proves
  the code, not the deployment.
- **No Security Rules are written.** The store is reached only by the API's own
  service-account credential, so a client SDK is the only thing that could be
  given access — and none exists. Rules become a real question the day a browser
  talks to Firestore directly, which nothing here does.
- **Analytics counters and BigQuery aggregates** (§3.1) are not built; the
  dashboard's figures are counted from the records themselves (D-46).
