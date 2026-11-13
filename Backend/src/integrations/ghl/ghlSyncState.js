// What an admin is told about a card whose GoHighLevel sync is not simply "synced". Pure.
//   card_deleted     the card no longer exists in GHL: the case follows it into the recycle bin
//   waiting_email    the case has no e-mail yet, so GHL cannot be given a contact; it is sent as soon as an e-mail exists
//   needs_attention  the change failed 8 times in a row; it keeps being retried (every 30 minutes) and an admin was told once
//   retrying         a change failed and is being retried with a growing pause
// Returns null for a card that is in sync.
const ATTENTION_AFTER = 8;

function describeSync(ghl = {}, job = null) {
  const sync = ghl.sync || {};
  const error = String(job?.lastError || sync.lastError || "");
  const attempts = Number(job?.attempts || sync.attempts || 0);
  if (ghl.flags?.deletedInGhl) return { kind: "card_deleted", text: "Card deleted in GoHighLevel: the case is moving to the recycle bin", attempts };
  if (/no e-?mail/i.test(error)) return { kind: "waiting_email", text: "Waiting for an e-mail: it is sent to GoHighLevel as soon as one is added", attempts };
  if (sync.state === "failed") return { kind: "needs_attention", text: `Could not be sent after ${attempts || ATTENTION_AFTER} tries; still retrying${error ? `: ${error}` : ""}`, attempts };
  if (sync.state === "pending" && error) return { kind: "retrying", text: `Retrying (try ${attempts || 1})${error ? `: ${error}` : ""}`, attempts };
  return null;
}

module.exports = { describeSync, ATTENTION_AFTER };
