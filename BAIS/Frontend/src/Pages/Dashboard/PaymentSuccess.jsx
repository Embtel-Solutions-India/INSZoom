import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { paymentsApi } from "../../services/api";
import { useSocket } from "../../context/SocketContext";
import { IconCheckmark } from "../../utils/iconComponents";

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("confirming");
  const [message, setMessage] = useState("Confirming your payment with Stripe...");
  const socket = useSocket();
  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    if (!sessionId) {
      setStatus("warning");
      setMessage("Stripe did not return a session id. Please refresh your payment page.");
      return;
    }

    let cancelled = false;
    const applyPayment = (payment) => {
      if (cancelled) return false;
      const returnedTransaction = (payment?.transactions || []).find(
        (transaction) => transaction.stripeSessionId === sessionId
      );
      const transactionSettled = ["paid", "succeeded"].includes(returnedTransaction?.status);
      // The transaction-by-session lookup is the precise signal, but fall back
      // to the payment's own settled state (nothing left owing, status paid)
      // so a payment that genuinely settled is never stuck showing "processing"
      // purely because this one transaction record didn't come back attached
      // to the session id.
      const paymentFullySettled = Boolean(
        payment
        && (payment.remainingAmount || 0) <= 0
        && (payment.amountPaid || payment.paidAmount || 0) > 0
        && ["paid", "succeeded"].includes(payment.paymentStatus)
      );
      const received = transactionSettled || paymentFullySettled;
      setStatus(received ? "success" : "processing");
      setMessage(
        received
          ? "Your payment was received and your paid amount, remaining balance, and progress have been updated."
          : "Your payment is still processing. This page will update automatically when Stripe confirms it."
      );
      return received;
    };

    const confirm = async () => {
      try {
        const response = await paymentsApi.confirmCheckoutSession(sessionId);
        const payment = response.payment || response.data?.payment;
        applyPayment(payment);
      } catch (error) {
        if (cancelled) return;
        setStatus("warning");
        setMessage(error.message || "We could not confirm the payment yet. Please refresh your payment page.");
      }
    };

    confirm();
    const poll = window.setInterval(async () => {
      try {
        const payment = await paymentsApi.summary();
        if (applyPayment(payment)) window.clearInterval(poll);
      } catch {
        // Stripe webhooks and the next poll remain the source of recovery.
      }
    }, 3000);
    const stopPolling = window.setTimeout(() => window.clearInterval(poll), 60000);
    const handleRealtimeUpdate = async () => {
      try {
        applyPayment(await paymentsApi.summary());
      } catch {
        // Scheduled polling remains active.
      }
    };
    socket?.on("payment:updated", handleRealtimeUpdate);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(stopPolling);
      socket?.off("payment:updated", handleRealtimeUpdate);
    };
  }, [sessionId, socket]);

  const isSuccess = status === "success";
  const isConfirming = status === "confirming";

  return (
    <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-6">
      <div className={`bg-white rounded-2xl border p-8 text-center shadow-sm max-w-md ${
        isSuccess ? "border-emerald-200" : "border-amber-200"
      }`}>
        <div className={`mx-auto mb-4 h-14 w-14 rounded-full flex items-center justify-center text-2xl ${
          isSuccess ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
        }`}>
          {isConfirming ? "…" : isSuccess ? <IconCheckmark size={26} className="text-emerald-700" /> : "!"}
        </div>
        <h1 className={`text-2xl font-extrabold ${isSuccess ? "text-emerald-700" : "text-amber-700"}`}>
          {isConfirming ? "Confirming Payment" : isSuccess ? "Payment Successful" : "Payment Processing"}
        </h1>
        <p className="text-slate-500 mt-2">{message}</p>
        <Link
          to="/dashboard/payments?refresh=1"
          className="inline-block mt-6 px-5 py-3 rounded-xl bg-emerald-600 text-white font-bold"
        >
          View Updated Payments
        </Link>
      </div>
    </div>
  );
}
