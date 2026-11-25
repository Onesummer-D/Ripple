# Read-only Analysis History v1

Status: A contract freeze for M2 implementation.

The history API stores a result produced by the server-side read-only analysis route. A stored record describes the analysis completed at capture time. Reading a record does not revalidate the current checkout and does not create a current host receipt, Runtime Identity result, VerificationRun result, edit scope, approval, apply, or rollback permission.

## Record contract

The JSON object is ReadOnlyAnalysisHistoryRecordV1.

Fields are schemaVersion, recordId, capturedAt, projectId, repository, gitHead, rootTree, sourceDigest, graphDigest, mappingCount, unresolvedCount, hostReceiptStatus, and producerEvidenceStatus.

schemaVersion is the literal ripple/read-only-analysis-history/v1. hostReceiptStatus is verified. producerEvidenceStatus is available-producer-evidence. capturedAt is a server-generated UTC ISO 8601 timestamp. It is excluded from record identity so repeating a capture for the same immutable analysis version is idempotent.

The server creates recordId as lowercase SHA-256 hex over these canonical bytes:

    ripple/read-only-analysis-history/v1 NUL canonicalJson([
    schemaVersion, projectId, repository, gitHead, rootTree, sourceDigest, graphDigest,
    mappingCount, unresolvedCount, hostReceiptStatus, producerEvidenceStatus
    ])

The canonical JSON serializer is the existing plain-data serializer used by GraphDigestV2. The tuple order is fixed. No path, private key, receipt signature, Build pin, raw Graph, source mapping payload, source code, or caller field is included.

The same record identity must produce byte-identical JSON. A second capture returns the existing record with HTTP 200. A first successful write returns HTTP 201. An existing file with the same recordId and different bytes is a storage conflict and returns history-record-conflict.

## API

POST /__ripple/api/project/read-only-history/capture

The request body must contain exactly one field, projectId. The server repeats the complete trusted analysis flow. It resolves the project only from the server-owned Host Registry, issues and verifies the receipt with the pinned public key, captures the registered checkout, verifies the source binding, replays the pinned Analyzer Build, and compares the raw Graph and GraphDigestV2. The request does not accept a receipt, public key, Build pin, project binding, recordId, or snapshot.

Responses are 200 for an existing immutable version, 201 for a newly stored record, 400 invalid-request, 404 project-unregistered, 409 project-drift or host-receipt-rejected, 503 host-config-unavailable, host-receipt-unavailable, producer-evidence-unavailable, analysis-failed, or history-storage-unavailable, and 409 history-record-conflict. Failed captures never create a record.

GET /__ripple/api/project/read-only-history?projectId=...&limit=1..100

projectId is required. limit defaults to 100. The response contains schemaVersion, projectId, and records. Records are sorted newest first by capturedAt, then by recordId.

A current host registration is required to establish that the caller is selecting a registered project. Listing performs no new source or graph verification and never changes record status. Responses use 400 invalid-request, 404 project-unregistered, 503 host-config-unavailable, 200 with records, or 409 history-record-corrupt when a stored record fails schema or digest validation.

The UI compares two records locally by their fields and displays source-version changes, digest changes, mapping-count changes, and unresolved-count changes. A comparison is a view operation and has no authorization effect.

## Storage contract

History is stored below the server-controlled read-only-analysis-history directory under the configured workbench state root. Candidate session directories are separate. The history root, each project directory, and each record file must be regular directories or files. Symlinks, junctions, non-regular files, path traversal, absolute paths, duplicate separators, NUL bytes, and backslashes are rejected.

Each record is written to a unique temporary file opened with exclusive creation and mode 0600, flushed, then atomically renamed into place. A failed write cannot be listed as a successful record. Reads verify regular-file type, schema, recordId recomputation, and byte length before parsing.

Limits are fixed at 64 KiB per record, 100 records per project, and 16 MiB for the complete history root. The service refuses a new record with history-storage-limit and preserves existing records. Concurrent captures for the same project are serialized. Different projects may proceed independently.

Startup and every read tolerate a missing history root by treating it as empty. A malformed existing record is a hard error for that record request. Restart does not clear records.

The stored object contains no private key, public key, receipt signature, Build pin, raw Graph, source mapping array, source text, or temporary credential.

## Compatibility boundary

The existing POST /__ripple/api/project/read-only-analysis response and failure codes remain unchanged. M2 adds the two history routes and a server-internal verified analysis result that supplies repository, gitHead, and rootTree to the record builder. No existing Candidate, Scope, Verification, Approval, Apply, Rollback, Runtime Identity, or E-H1/D-P1 path consumes history records.
