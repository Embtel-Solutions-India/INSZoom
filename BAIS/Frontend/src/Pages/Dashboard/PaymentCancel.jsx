import { Link } from "react-router-dom";

export default function PaymentCancel() {
  return (
    <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-amber-200 p-8 text-center shadow-sm max-w-md">
        <h1 className="text-2xl font-extrabold text-amber-700">
          Payment Cancelled
        </h1>
        <p className="text-slate-500 mt-2">
          You cancelled this payment. You can try again anytime.
        </p>
        <Link
          to="/dashboard/payments"
          className="inline-block mt-6 px-5 py-3 rounded-xl bg-emerald-600 text-white font-bold"
        >
          Try Again
        </Link>
      </div>
    </div>
  );
}