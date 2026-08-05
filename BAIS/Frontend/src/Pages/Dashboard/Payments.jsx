import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { paymentsApi } from "../../services/api";
import { getInstallmentPlans, formatCents } from "../../config/pricingCatalog";
import { useSocket } from "../../context/SocketContext";
import { IconGift, IconCelebrate } from "../../utils/iconComponents";

function money(cents, currency = "USD") {
  return formatCents(cents, currency);
}

function StatCard({ label, value }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <p className="text-[0.68rem] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-2xl font-extrabold text-slate-800 mt-1">{value}</p>
    </div>
  );
}

/**
 * Mark each installment as paid / due now / upcoming based on how much has
 * already been collected (installments are settled in sequence).
 */
function coverInstallments(installments, amountPaidCents) {
  let paid = amountPaidCents;
  let dueAssigned = false;
  return installments.map((inst) => {
    if (paid >= inst.amount) {
      paid -= inst.amount;
      return { ...inst, state: "paid", outstanding: 0 };
    }
    const outstanding = inst.amount - paid;
    paid = 0;
    const state = dueAssigned ? "upcoming" : "due";
    dueAssigned = true;
    return { ...inst, state, outstanding };
  });
}

const STATE_BADGE = {
  paid:     "bg-emerald-100 text-emerald-700 border-emerald-200",
  due:      "bg-amber-100 text-amber-700 border-amber-200",
  upcoming: "bg-slate-100 text-slate-500 border-slate-200",
};
const STATE_LABEL = { paid: "Paid", due: "Due now", upcoming: "Upcoming" };
const PAYMENT_STATUS_BADGE = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partially_paid: "bg-amber-50 text-amber-700 border-amber-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  pending: "bg-blue-50 text-blue-700 border-blue-200",
  processing: "bg-blue-50 text-blue-700 border-blue-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  not_started: "bg-slate-50 text-slate-600 border-slate-200",
};

function statusLabel(status = "not_started") {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function Payments() {
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [scheduleKey, setScheduleKey] = useState("pay_in_full");
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [searchParams] = useSearchParams();
  const refreshRequested = searchParams.get("refresh") === "1";
  const socket = useSocket();
  const payingRef = useRef(false); // hard guard against double-submit
  const confirmedSessionsRef = useRef(new Set());

  const loadPayment = useCallback(async () => {
    try {
      setErrorMessage("");
      let summary = await paymentsApi.summary();
      const shouldConfirm = refreshRequested || ["processing", "pending"].includes(summary?.paymentStatus);
      const pendingTransaction = [...(summary?.transactions || [])]
        .reverse()
        .find((txn) => txn.stripeSessionId && ["processing", "pending"].includes(txn.status));

      if (shouldConfirm && pendingTransaction?.stripeSessionId && !confirmedSessionsRef.current.has(pendingTransaction.stripeSessionId)) {
        confirmedSessionsRef.current.add(pendingTransaction.stripeSessionId);
        await paymentsApi.confirmCheckoutSession(pendingTransaction.stripeSessionId).catch(() => null);
        summary = await paymentsApi.summary();
      }
      setPayment(summary);
    } catch (error) {
      setErrorMessage(error.message || "Unable to load payment details.");
    } finally {
      setLoading(false);
    }
  }, [refreshRequested]);

  useEffect(() => {
    loadPayment();
    const intervalId = setInterval(loadPayment, 15000);
    const refreshOnFocus = () => {
      if (!document.hidden) loadPayment();
    };
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [loadPayment]);

  useEffect(() => {
    if (!socket) return undefined;
    const handlePaymentUpdate = () => loadPayment();
    socket.on("payment:updated", handlePaymentUpdate);
    return () => socket.off("payment:updated", handlePaymentUpdate);
  }, [socket, loadPayment]);

  useEffect(() => {
    if (!scheduleTouched && payment?.planKey) setScheduleKey(payment.planKey);
  }, [payment?.planKey, scheduleTouched]);

  const total     = payment?.totalAmount || 0;
  const paidCents = payment?.amountPaid || 0;
  const computedRemaining = Math.max(total - paidCents, 0);
  const remaining = payment?.remainingAmount > 0 ? payment.remainingAmount : computedRemaining;

  // Installment schedules are computed from the catalog on the TOTAL package fee.
  const plans = useMemo(() => getInstallmentPlans(total), [total]);
  const selectedPlan = plans.find((p) => p.key === scheduleKey);

  const coveredInstallments = useMemo(
    () => (selectedPlan ? coverInstallments(selectedPlan.installments, paidCents) : []),
    [selectedPlan, paidCents]
  );
  const dueInstallment = coveredInstallments.find((i) => i.state === "due");

  // How much the "Pay now" button will charge, in cents.
  const payNowCents = useMemo(() => {
    if (scheduleKey === "pay_in_full") return remaining;
    return Math.min(dueInstallment?.outstanding || 0, remaining);
  }, [scheduleKey, remaining, dueInstallment]);

  const canPay = remaining > 0 && payNowCents >= 100 && payNowCents <= remaining && !paying;

  const handlePay = async () => {
    if (payingRef.current || !canPay) return; // ignore rapid repeat clicks
    payingRef.current = true;
    setPaying(true);
    try {
      const label =
        scheduleKey === "pay_in_full" ? "Full payment" : dueInstallment?.label || "Installment";
      const paymentRequestId = globalThis.crypto?.randomUUID?.()
        || `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await paymentsApi.createPartialCheckoutSession(payNowCents, {
        amountUnit: "cents",
        scheduleKey,
        label,
        paymentRequestId,
        idempotencyKey: paymentRequestId,
      });
      if (!res?.url) throw new Error(res?.message || "Stripe checkout is unavailable.");
      window.location.href = res.url;
    } catch (error) {
      alert(error.message || "Could not start payment");
      payingRef.current = false;
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center">
        <p className="text-slate-500 font-semibold">Loading payment details...</p>
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="min-h-screen bg-[#f1f5f9] p-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <p className="font-extrabold text-slate-800">No payment plan found</p>
          <p className="text-sm text-slate-500 mt-1">Complete your intake and select a package first.</p>
        </div>
      </div>
    );
  }

  const progress = total > 0 ? Math.round((paidCents / total) * 100) : 0;
  const currency = payment.currency?.toUpperCase() || "USD";
  const successfulTransactions = (payment.transactions || []).filter((txn) => ["paid", "succeeded"].includes(txn.status));

  const PLAN_OPTIONS = [
    { key: "pay_in_full", label: "Pay in full" },
    { key: "two_installments", label: "2 installments" },
    { key: "four_installments", label: "4 installments" },
  ];

  return (
    <div className="min-h-screen bg-[#f1f5f9]">
      <div className="bg-linear-to-r from-[#1D9E75] via-teal-600 to-blue-700 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7">
          <p className="text-white/70 text-xs font-bold uppercase tracking-widest">Payment Center</p>
          <h1 className="text-2xl font-extrabold mt-1">Your Payment Summary</h1>
          <p className="text-white/80 text-sm mt-1">Pay your selected package in full or in installments.</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 space-y-6">
        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {errorMessage}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Package" value={payment.packageName} />
          <StatCard label="Total Fee" value={money(total, currency)} />
          <StatCard label="Paid Amount" value={money(paidCents, currency)} />
          <StatCard label="Remaining" value={money(remaining, currency)} />
        </div>

        {/* Applied referral / coupon discount */}
        {payment.discountAmount > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <IconGift size={22} className="text-emerald-600 shrink-0" />
              <div>
                <p className="font-extrabold text-emerald-800 text-sm">
                  {payment.discountLabel || "Referral discount applied"}
                  {payment.appliedReferralCode ? ` · ${payment.appliedReferralCode}` : ""}
                </p>
                <p className="text-xs text-emerald-700">
                  Package {money(payment.baseAmount, currency)} − {money(payment.discountAmount, currency)} discount
                </p>
              </div>
            </div>
            <p className="text-lg font-extrabold text-emerald-800">You pay {money(total, currency)}</p>
          </div>
        )}

        {/* Progress + status */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-extrabold text-slate-800">Payment Progress</h2>
              <p className="text-sm text-slate-500 mt-1">{progress}% of your package fee has been paid.</p>
            </div>
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full border ${PAYMENT_STATUS_BADGE[payment.paymentStatus] || PAYMENT_STATUS_BADGE.not_started}`}>
              {statusLabel(payment.paymentStatus || payment.status)}
            </span>
          </div>
          <div className="mt-5 h-3 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Make a payment */}
        {remaining > 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-extrabold text-slate-800">Make a Payment</h2>
            <p className="text-sm text-slate-500 mt-1">Choose how you'd like to pay your remaining balance.</p>

            {/* Plan selector */}
            <div className="mt-5 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:gap-3">
              {PLAN_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setScheduleTouched(true);
                    setScheduleKey(opt.key);
                  }}
                  className={`flex-1 min-w-0 py-3 px-4 rounded-xl border-2 text-sm font-extrabold text-center transition cursor-pointer
                    ${scheduleKey === opt.key
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Installment schedule */}
            {(scheduleKey === "two_installments" || scheduleKey === "four_installments") && (
              <div className="mt-5 border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{selectedPlan?.description}</p>
                </div>
                <ul className="divide-y divide-slate-100">
                  {coveredInstallments.map((inst) => (
                    <li key={inst.sequence} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800">{inst.label} · {money(inst.amount, currency)}</p>
                        <p className="text-xs text-slate-400">{inst.description}</p>
                      </div>
                      <span className={`text-[0.62rem] font-bold px-2 py-1 rounded-full border shrink-0 ${STATE_BADGE[inst.state]}`}>
                        {STATE_LABEL[inst.state]}
                        {inst.state === "due" && inst.outstanding !== inst.amount ? ` · ${money(inst.outstanding, currency)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pay action */}
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 pt-5">
              <div>
                <p className="text-sm text-slate-500">You will be charged now</p>
                <p className="text-2xl font-extrabold text-slate-900">{money(payNowCents, currency)}</p>
              </div>
              <button
                onClick={handlePay}
                disabled={!canPay}
                className="px-7 py-3 rounded-xl bg-emerald-600 text-white font-extrabold hover:bg-emerald-700 transition
                  disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-200/60"
              >
                {paying ? "Redirecting to Stripe…" : `Pay ${money(payNowCents, currency)} with Stripe`}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
            <p className="font-extrabold text-emerald-800 flex items-center gap-2">Your package is fully paid. <IconCelebrate size={18} className="text-emerald-600" /></p>
            <p className="text-sm text-emerald-700 mt-1">Thank you — there is no remaining balance.</p>
          </div>
        )}

        {/* History */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-extrabold text-slate-800">Payment History</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {successfulTransactions.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No payments made yet.</p>
            ) : (
              successfulTransactions
                .slice()
                .reverse()
                .map((txn) => (
                  <div key={txn._id} className="p-5 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-slate-800">{money(txn.amount, currency)}</p>
                      <p className="text-xs text-slate-400">
                        {txn.label ? `${txn.label} · ` : ""}
                        {txn.paidAt ? new Date(txn.paidAt).toLocaleString() : new Date(txn.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-600">{txn.status}</span>
                    {["paid", "succeeded"].includes(txn.status) && (
                      <button
                        type="button"
                        onClick={() => paymentsApi.downloadReceipt(payment._id, txn._id).catch((error) => setErrorMessage(error.message))}
                        className="text-xs font-bold text-emerald-700 hover:text-emerald-800"
                      >
                        Download receipt
                      </button>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
