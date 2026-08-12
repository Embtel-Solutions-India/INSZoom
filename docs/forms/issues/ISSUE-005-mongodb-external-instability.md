# ISSUE-005: MongoDB DNS / Cluster Instability Blocks Browser Acceptance

## Issue

The app still cannot be fully browser-verified because backend startup currently fails on Atlas SRV DNS resolution.

## Evidence

Clean startup stderr:

`failed_to_start_shared_backend`
`querySrv ETIMEOUT _mongodb._tcp.cluster0.eqpju6f.mongodb.net`

Earlier live requests also showed bounded `DATABASE_UNAVAILABLE` responses instead of silent empty-form states.

## Proposed Plan

1. Verify DNS resolution for the Atlas SRV record from the runtime host.
2. Verify Atlas network access/IP allowlist.
3. Use a stable replica set connection string or local Mongo for deterministic development verification.
4. Re-run full browser acceptance once backend health is stable.
5. Keep app-level timeouts/fallbacks; do not hide DB failures.

## Contradictions / Alternatives

Do not keep increasing `maxPoolSize` or adding frontend retries. DNS/cluster availability must be fixed at the environment level.

## Delivered

The backend now reports `DATABASE_UNAVAILABLE` for recognized Mongo failures and no longer starts the document-intelligence recovery loop before HTTP readiness.

## Future Learning

If a feature fails across unrelated collections with pool/timeouts/DNS symptoms, treat the database/runtime path as suspect before narrowing to one Forms query.

