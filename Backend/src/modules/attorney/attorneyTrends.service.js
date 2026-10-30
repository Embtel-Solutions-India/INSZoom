// Week-over-week figures for the attorney dashboard cards, rebuilt from timestamps the database
// already stores - nothing is estimated:
//   assigned : grants with assignedAt <= t and not yet revoked at t (revokedAt)
//   active   : of those, cases the attorney had started working on by t (engagedAt <= t) and not yet marked reviewed by t
//   reviewed : those whose reviewedAt <= t (a count; the dashboard shows the week-over-week % change of each count)
// Pure: the caller passes every case this attorney has (or had) a grant on - revoked grants included, so past weeks are not
// undercounted. Each series has 8 points: 7 days ago ... now. "previous" is the value 7 days ago.
const DAY = 24 * 60 * 60 * 1000;
const POINTS = 8;

const time = (value) => (value ? new Date(value).getTime() : null);
const atOrBefore = (value, t) => time(value) !== null && time(value) <= t;

function grantActiveAt(grant, t) {
  if (!atOrBefore(grant.assignedAt, t)) return false;
  if (grant.status === "active") return true;
  const revoked = time(grant.revokedAt);
  return revoked !== null && revoked > t;
}

function computeTrends({ cases, userId, now = new Date() }) {
  const end = now.getTime();
  const stamps = Array.from({ length: POINTS }, (_, i) => end - (POINTS - 1 - i) * DAY);

  const grants = [];
  for (const caseDoc of cases) {
    for (const grant of caseDoc.attorneyAccess || []) {
      if (String(grant.attorneyId) === String(userId)) grants.push(grant);
    }
  }

  const reviewedBy = (g, t) => g.reviewStatus === "reviewed" && atOrBefore(g.reviewedAt, t);
  const assigned = stamps.map((t) => grants.filter((g) => grantActiveAt(g, t)).length);
  const active = stamps.map((t) => grants.filter((g) => grantActiveAt(g, t) && atOrBefore(g.engagedAt, t) && !reviewedBy(g, t)).length);
  const reviewed = stamps.map((t) => grants.filter((g) => grantActiveAt(g, t) && reviewedBy(g, t)).length);

  const metric = (series) => ({ series, current: series[series.length - 1], previous: series[0] });
  return { assigned: metric(assigned), active: metric(active), reviewed: metric(reviewed) };
}

module.exports = { computeTrends };
