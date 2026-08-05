function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const Stripe = require("stripe");
  const options = {
    maxNetworkRetries: Math.max(1, Number(process.env.STRIPE_MAX_NETWORK_RETRIES || 3)),
    timeout: Math.max(5000, Number(process.env.STRIPE_TIMEOUT_MS || 30000)),
  };
  if (process.env.STRIPE_API_VERSION) options.apiVersion = process.env.STRIPE_API_VERSION;
  return new Stripe(process.env.STRIPE_SECRET_KEY, options);
}

function configurationStatus() {
  const required = {
    STRIPE_SECRET_KEY: Boolean(process.env.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    CLIENT_URL: Boolean(process.env.CLIENT_URL || process.env.FRONTEND_URL),
  };
  return {
    configured: Object.values(required).every(Boolean),
    required,
    apiVersion: process.env.STRIPE_API_VERSION || null,
  };
}

function requireStripe() {
  const stripe = getStripe();
  if (stripe) return stripe;
  const error = new Error("Stripe is not configured. STRIPE_SECRET_KEY is required.");
  error.status = 503;
  error.code = "STRIPE_NOT_CONFIGURED";
  throw error;
}

async function createCheckoutSession({ payment, transaction, user, caseData }) {
  const stripe = requireStripe();
  const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL;
  if (!clientUrl) {
    const error = new Error("CLIENT_URL or FRONTEND_URL is required for Stripe checkout redirects");
    error.status = 503;
    error.code = "STRIPE_REDIRECT_URL_MISSING";
    throw error;
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: user.email,
      client_reference_id: payment._id.toString(),
      payment_intent_data: {
        metadata: {
          paymentId: payment._id.toString(),
          transactionId: transaction._id.toString(),
          paymentRequestId: transaction.paymentRequestId || "",
          caseId: (payment.caseId || payment.case || caseData?._id || "").toString(),
        },
      },
      line_items: [
        {
          price_data: {
            currency: payment.currency,
            product_data: { name: `${payment.packageName || "Immigration Services"} - ${transaction.label || "Payment"}` },
            unit_amount: transaction.amount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        paymentId: payment._id.toString(),
        transactionId: transaction._id.toString(),
        paymentRequestId: transaction.paymentRequestId || "",
        idempotencyKey: transaction.idempotencyKey || "",
        caseId: (payment.caseId || payment.case || caseData?._id || "").toString(),
        userId: user._id.toString(),
        scheduleKey: transaction.scheduleKey || payment.planKey || "custom",
      },
      success_url: `${clientUrl.replace(/\/$/, "")}/dashboard/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl.replace(/\/$/, "")}/dashboard/payments/cancel`,
    },
    { idempotencyKey: transaction.idempotencyKey || `checkout_${transaction._id}` }
  );

  return { url: session.url, sessionId: session.id, disabled: false };
}

async function retrieveCheckoutSession(sessionId) {
  const stripe = requireStripe();
  if (!sessionId) return null;
  return stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
}

function constructWebhookEvent(rawBody, signature) {
  const stripe = requireStripe();
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    const error = new Error("STRIPE_WEBHOOK_SECRET is required");
    error.status = 503;
    error.code = "STRIPE_WEBHOOK_SECRET_MISSING";
    throw error;
  }
  if (!signature) {
    const error = new Error("Stripe-Signature header is required");
    error.status = 400;
    error.code = "STRIPE_SIGNATURE_MISSING";
    throw error;
  }
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

async function createRefund({ paymentIntentId, amount, reason, idempotencyKey, metadata = {} }) {
  const stripe = requireStripe();
  if (!paymentIntentId) {
    const error = new Error("Stripe payment intent is required for a gateway refund");
    error.status = 400;
    error.code = "STRIPE_PAYMENT_INTENT_MISSING";
    throw error;
  }
  return stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      amount,
      reason: ["duplicate", "fraudulent", "requested_by_customer"].includes(reason) ? reason : undefined,
      metadata,
    },
    { idempotencyKey }
  );
}

module.exports = {
  configurationStatus,
  constructWebhookEvent,
  createCheckoutSession,
  createRefund,
  getStripe,
  retrieveCheckoutSession,
};
