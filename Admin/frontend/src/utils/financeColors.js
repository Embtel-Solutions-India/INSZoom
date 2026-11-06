// One vivid palette for every payment figure in the Admin portal (charts, status dots, legends). The text stays neutral and a bright dot / series colour carries
// the meaning. Change a colour here and it changes everywhere.
export const FINANCE_COLORS = {
  paid: '#10B981', // collected / paid (emerald)
  total: '#3B82F6', // total fees (bright blue)
  outstanding: '#F43F5E', // still to be paid (rose)
  partial: '#F59E0B', // partly paid, collection rate (amber)
  uscis: '#8B5CF6', // USCIS fees (violet)
  previous: '#F59E0B', // last month's dashed line (amber)
  neutral: '#94A3B8', // no fee set / unknown
}

// colours for categories (case types, case managers): vivid and distinct
export const CATEGORY_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#F43F5E', '#06B6D4', '#EC4899', '#84CC16', '#F97316', '#6366F1', '#14B8A6', '#EAB308']

// payment status -> label and dot colour (paid, partially_paid, pending = unpaid, no_fee)
export const FINANCE_STATUS = {
  paid: { label: 'Paid', color: FINANCE_COLORS.paid },
  partially_paid: { label: 'Partially paid', color: FINANCE_COLORS.partial },
  pending: { label: 'Unpaid', color: FINANCE_COLORS.outstanding },
  not_started: { label: 'Unpaid', color: FINANCE_COLORS.outstanding },
  overdue: { label: 'Overdue', color: FINANCE_COLORS.outstanding },
  refunded: { label: 'Refunded', color: FINANCE_COLORS.uscis },
  no_fee: { label: 'No fee set', color: FINANCE_COLORS.neutral },
}

// colours for the team performance charts
export const TEAM_COLORS = {
  assigned: '#6366F1', // all assigned cases (indigo)
  active: '#3B82F6', // active (bright blue)
  onHold: '#F43F5E', // on hold (rose)
  closed: '#10B981', // closed (emerald)
  tasks: '#F59E0B', // open tasks (amber)
  overdue: '#EF4444', // overdue tasks (red)
}
