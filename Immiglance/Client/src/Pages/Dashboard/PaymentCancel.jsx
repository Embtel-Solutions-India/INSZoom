import { Link } from "react-router-dom";

export default function PaymentCancel() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="bg-card rounded-2xl border border-destructive/30 p-8 text-center shadow-sm max-w-md">
        <h1 className="text-2xl font-extrabold text-destructive">
          Payment Cancelled
        </h1>
        <p className="text-muted-foreground mt-2">
          You cancelled this payment. You can try again anytime.
        </p>
        <Link
          to="/dashboard/payments"
          className="inline-block mt-6 px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold"
        >
          Try Again
        </Link>
      </div>
    </div>
  );
}