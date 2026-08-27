/**
 * LegacyHolding — Shown to client accounts that existed before the new
 * architecture and have no case linked to them.
 *
 * These accounts are identified by migrationStatus: 'flagged' and
 * legacyNoCaseAccount: true, set by the Phase 3 migration script
 * (Backend/scripts/migrateAccounts.js).
 *
 * The AuthGate routes here when isLegacyNoCaseAccount is true.
 */
export default function LegacyHolding() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center bg-[#f3f4f6]">
      <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-8">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-slate-400">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M12 3l9 16H3l9-16z" />
        </svg>
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-3">Account Migration in Progress</h1>
      <p className="text-slate-500 text-base max-w-md mb-2">
        Your account is being migrated to our new system. Please contact your case manager for assistance. Once your
        account has been set up, you will be able to access your full immigration portal.
      </p>
      <p className="mt-4 text-sm text-slate-400 max-w-sm">
        If you believe this is an error, please reach out to support.
      </p>
      <p className="mt-8 text-xs text-slate-400">BAIS · Bay Area Immigration Services (BAIS) · Secure Portal</p>
    </div>
  );
}
