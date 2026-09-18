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
    <div className="bg-card rounded-2xl border border-card-border shadow-sm p-5">
      <p className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-extrabold text-foreground mt-1">{value}</p>
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
  paid:     "bg-primary/10 text-primary border-primary/20",
  due:      "bg-accent text-accent-foreground border-accent-foreground/20",
  upcoming: "bg-secondary text-muted-foreground border-border",
};
const STATE_LABEL = { paid: "Paid", due: "Due now", upcoming: "Upcoming" };
const PAYMENT_STATUS_BADGE = {
  paid: "bg-primary/10 text-primary border-primary/20",
  partially_paid: "bg-accent text-accent-foreground border-accent-foreground/20",
  partial: "bg-accent text-accent-foreground border-accent-foreground/20",
  pending: "bg-secondary text-muted-foreground border-border",
  processing: "bg-secondary text-muted-foreground border-border",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  not_started: "bg-secondary text-muted-foreground border-border",
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
  const loadInFlightRef = useRef(false); // avoid piling up concurrent polls if one call is slow

  const loadPayment = useCallback(async () => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    try {
      setErrorMessage("");
      const summary = await paymentsApi.summary();
      // Show what we already have immediately instead of holding the page on
      // a full-screen spinner through the Stripe confirm round-trip below —
      // that call can be slow (Stripe SDK retries up to its own timeout), and
      // the already-fetched summary is correct to show either way; confirm
      // just patches it in-place once Stripe actually responds.
      setPayment(summary);
      setLoading(false);
      const shouldConfirm = refreshRequested || ["processing", "pending"].includes(summary?.paymentStatus);
      const pendingTransaction = [...(summary?.transactions || [])]
        .reverse()
        .find((txn) => txn.stripeSessionId && ["processing", "pending"].includes(txn.status));

      if (shouldConfirm && pendingTransaction?.stripeSessionId && !confirmedSessionsRef.current.has(pendingTransaction.stripeSessionId)) {
        confirmedSessionsRef.current.add(pendingTransaction.stripeSessionId);
        await paymentsApi.confirmCheckoutSession(pendingTransaction.stripeSessionId).catch(() => null);
        const confirmedSummary = await paymentsApi.summary();
        setPayment(confirmedSummary);
      }
    } catch (error) {
      setErrorMessage(error.message || "Unable to load payment details.");
    } finally {
      setLoading(false);
      loadInFlightRef.current = false;
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground font-semibold">Loading payment details...</p>
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="bg-card rounded-2xl border border-card-border shadow-sm p-6">
          <p className="font-extrabold text-foreground">No payment plan found</p>
          <p className="text-sm text-muted-foreground mt-1">Complete your intake and select a package first.</p>
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
    <div className="min-h-screen bg-background">
      <div className="bg-primary text-primary-foreground">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7">
          <p className="text-primary-foreground/70 text-xs font-bold uppercase tracking-widest">Payment Center</p>
          <h1 className="text-2xl font-extrabold mt-1">Your Payment Summary</h1>
          <p className="text-primary-foreground/80 text-sm mt-1">Pay your selected package in full or in installments.</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 space-y-6">
        {errorMessage && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
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
          <div className="bg-primary/10 border border-primary/20 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <IconGift size={22} className="text-primary shrink-0" />
              <div>
                <p className="font-extrabold text-primary text-sm">
                  {payment.discountLabel || "Referral discount applied"}
                  {payment.appliedReferralCode ? ` · ${payment.appliedReferralCode}` : ""}
                </p>
                <p className="text-xs text-primary/80">
                  Package {money(payment.baseAmount, currency)} − {money(payment.discountAmount, currency)} discount
                </p>
              </div>
            </div>
            <p className="text-lg font-extrabold text-primary">You pay {money(total, currency)}</p>
          </div>
        )}

        {/* Progress + status */}
        <div className="bg-card rounded-2xl border border-card-border shadow-sm p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-extrabold text-foreground">Payment Progress</h2>
              <p className="text-sm text-muted-foreground mt-1">{progress}% of your package fee has been paid.</p>
            </div>
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full border ${PAYMENT_STATUS_BADGE[payment.paymentStatus] || PAYMENT_STATUS_BADGE.not_started}`}>
              {statusLabel(payment.paymentStatus || payment.status)}
            </span>
          </div>
          <div className="mt-5 h-3 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Make a payment */}
        {remaining > 0 ? (
          <div className="bg-card rounded-2xl border border-card-border shadow-sm p-6">
            <h2 className="text-lg font-extrabold text-foreground">Make a Payment</h2>
            <p className="text-sm text-muted-foreground mt-1">Choose how you'd like to pay your remaining balance.</p>

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
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:border-border hover:bg-secondary"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Installment schedule */}
            {(scheduleKey === "two_installments" || scheduleKey === "four_installments") && (
              <div className="mt-5 border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-secondary border-b border-border">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{selectedPlan?.description}</p>
                </div>
                <ul className="divide-y divide-border">
                  {coveredInstallments.map((inst) => (
                    <li key={inst.sequence} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground">{inst.label} · {money(inst.amount, currency)}</p>
                        <p className="text-xs text-muted-foreground">{inst.description}</p>
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
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border pt-5">
              <div>
                <p className="text-sm text-muted-foreground">You will be charged now</p>
                <p className="text-2xl font-extrabold text-foreground">{money(payNowCents, currency)}</p>
              </div>
              <button
                onClick={handlePay}
                disabled={!canPay}
                className="px-7 py-3 rounded-xl bg-primary text-primary-foreground font-extrabold hover:opacity-90 transition
                  disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {paying ? "Redirecting to Stripe…" : `Pay ${money(payNowCents, currency)} with Stripe`}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-primary/10 border border-primary/20 rounded-2xl p-6">
            <p className="font-extrabold text-primary flex items-center gap-2">Your package is fully paid. <IconCelebrate size={18} className="text-primary" /></p>
            <p className="text-sm text-primary/80 mt-1">Thank you — there is no remaining balance.</p>
          </div>
        )}

        {/* History */}
        <div className="bg-card rounded-2xl border border-card-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-extrabold text-foreground">Payment History</h2>
          </div>
          <div className="divide-y divide-border">
            {successfulTransactions.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No payments made yet.</p>
            ) : (
              successfulTransactions
                .slice()
                .reverse()
                .map((txn) => (
                  <div key={txn._id} className="p-5 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-foreground">{money(txn.amount, currency)}</p>
                      <p className="text-xs text-muted-foreground">
                        {txn.label ? `${txn.label} · ` : ""}
                        {txn.paidAt ? new Date(txn.paidAt).toLocaleString() : new Date(txn.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-secondary text-muted-foreground">{txn.status}</span>
                    {["paid", "succeeded"].includes(txn.status) && (
                      <button
                        type="button"
                        onClick={() => paymentsApi.downloadReceipt(payment._id, txn._id).catch((error) => setErrorMessage(error.message))}
                        className="text-xs font-bold text-primary hover:opacity-80"
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
