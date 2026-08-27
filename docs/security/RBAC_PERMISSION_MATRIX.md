# RBAC Permission Matrix

## Role Hierarchy (Highest to Lowest)
1. super_admin
2. admin
3. team_lead
4. sales_manager
5. case_manager
6. attorney
7. professor
8. finance
9. employer
10. client

## Role Definitions

### 1. Super Admin
**Access Level:** Full system access
**Can Modify:** All roles including Admin
**Can Access:** All modules, settings, configurations

**Permissions:**
- dashboard: full
- users: create, read, update, delete, assign_roles, assign_teams
- cases: create, read, update, delete, assign
- clients: create, read, update, delete
- finance: create, read, update, delete
- reports: all
- settings: all
- teams: create, read, update, delete
- companies: create, read, update, delete
- documents: all
- notifications: all

### 2. Admin
**Access Level:** High operational access
**Can Modify:** All roles except Super Admin
**Can Access:** Most operational modules, cannot change system configuration

**Permissions:**
- dashboard: full
- users: create, read, update (except super_admin), delete (except super_admin), assign_roles (except super_admin), assign_teams
- cases: create, read, update, delete, assign
- clients: create, read, update, delete
- finance: create, read, update, delete
- reports: all
- settings: operational (not system config)
- teams: create, read, update, delete
- companies: create, read, update, delete
- documents: all
- notifications: all

### 3. Team Lead
**Access Level:** Team management
**Can Modify:** Team members, assigned cases
**Can Access:** Assigned team data, team performance, team activity

**Permissions:**
- dashboard: team_view
- users: read (team members only), update (team members only)
- cases: read (team cases only), update (team cases only)
- clients: read (team clients only)
- finance: read (team finance only)
- reports: team_reports
- teams: read (own team only), update (own team only)
- documents: read (team documents only)
- notifications: team_notifications

**Data Isolation:**
- Can only see users in their team
- Can only see cases assigned to their team
- Can only see clients linked to their team cases
- Cannot access other teams' data

### 4. Sales Manager / Lead Manager
**Access Level:** Sales and lead management
**Can Modify:** Leads, prospects, sales pipeline
**Can Access:** Leads, prospects, consultations, intake status, follow-ups

**Permissions:**
- dashboard: sales_view
- leads: create, read, update, delete
- prospects: create, read, update, delete
- consultations: create, read, update, delete
- sales_pipeline: read, update
- clients: create (from leads), read (own leads), update (own leads)
- reports: sales_reports
- documents: read (sales documents only)

**Data Isolation:**
- Can only see leads they created or are assigned
- Can only see their sales pipeline
- Cannot access case management, finance, or internal operations

### 5. Case Manager
**Access Level:** Case management
**Can Modify:** Assigned cases, clients, documents, tasks
**Can Access:** Assigned cases, linked clients, documents, tasks, case updates

**Permissions:**
- dashboard: case_view
- cases: read (assigned only), update (assigned only)
- clients: read (linked to assigned cases only), update (linked to assigned cases only)
- documents: create (for assigned cases), read (for assigned cases), update (for assigned cases)
- tasks: create (for assigned cases), read (for assigned cases), update (for assigned cases)
- notifications: case_notifications
- reports: case_reports

**Data Isolation:**
- Can only see cases assigned to them
- Can only see clients linked to their assigned cases
- Cannot access other case managers' cases
- Cannot access finance, sales, or admin functions

### 6. Attorney
**Access Level:** Legal case review
**Can Modify:** Assigned legal cases, legal documents, case notes
**Can Access:** Assigned legal cases, legal documents, case notes, client documents, immigration details

**Permissions:**
- dashboard: legal_view
- cases: read (assigned legal cases only), update (assigned legal cases only)
- documents: read (legal documents for assigned cases), update (legal documents for assigned cases)
- attorney_reviews: create, read, update (assigned only)
- case_notes: create, read (assigned cases only)
- notifications: legal_notifications
- reports: legal_reports

**Data Isolation:**
- Can only see cases assigned to them for legal review
- Can only access legal documents and case notes
- Cannot access finance, sales, or admin functions
- Cannot modify case assignment or stage

### 7. Professor / Expert
**Access Level:** Expert review
**Can Modify:** Assigned expert review cases, document reviews, evaluations, comments
**Can Access:** Assigned expert review cases, document reviews, evaluations, comments, expert feedback

**Permissions:**
- dashboard: expert_view
- cases: read (assigned for expert review only)
- documents: read (assigned for review only), update (comments only)
- expert_letters: create, read, update (assigned only)
- evaluations: create, read, update (assigned only)
- comments: create, read (assigned cases only)
- notifications: expert_notifications
- reports: expert_reports

**Data Isolation:**
- Can only see cases assigned for expert review
- Can only access documents assigned for review
- Can only add comments and evaluations
- Cannot access finance, sales, or admin functions
- Cannot modify case assignment or stage

### 8. Finance User
**Access Level:** Finance operations
**Can Modify:** Invoices, payments, billing records
**Can Access:** Invoices, payments, billing records, package amounts, payment status, finance reports

**Permissions:**
- dashboard: finance_view
- payments: create, read, update, delete
- invoices: create, read, update, delete
- billing_records: create, read, update, delete
- finance_reports: read
- clients: read (for billing only)
- documents: read (billing documents only)
- notifications: finance_notifications

**Data Isolation:**
- Can only access finance-related data
- Can see client information only for billing purposes
- Cannot access case details, documents (unless billing-related), or internal operations
- Cannot modify case assignments or stages

### 9. Employer / HR Manager
**Access Level:** Company management
**Can Modify:** Company cases, employee/client records linked to company
**Can Access:** Company dashboard, company cases, employee/client records, documents, case status

**Permissions:**
- dashboard: company_view
- cases: read (company cases only)
- clients: read (company employees/clients only), update (company employees/clients only)
- documents: read (company documents only)
- company_settings: read (own company only), update (own company only)
- notifications: company_notifications
- reports: company_reports

**Data Isolation:**
- Can only access records connected to their organization
- Can only see cases linked to their company
- Can only see documents for their company
- Cannot access other companies' data
- Cannot access finance, sales, or admin functions

### 10. Client
**Access Level:** Self-service
**Can Modify:** Own profile, own questionnaire, own documents
**Can Access:** Own dashboard, profile, questionnaire, documents, payments, case status, notifications, support

**Permissions:**
- dashboard: client_view
- profile: read (own only), update (own only)
- questionnaire: read (own only), update (own only)
- documents: create (own only), read (own only), delete (own only)
- payments: read (own only)
- case_status: read (own only)
- notifications: read (own only)
- support: create (tickets only)

**Data Isolation:**
- Can only access their own data
- Cannot access any other client's data
- Cannot access admin, team, finance, attorney, or internal case management pages
- Cannot see other cases, clients, or internal operations
- Direct URL access to admin pages must be blocked

## Permission Categories

### Dashboard Access
- super_admin: full
- admin: full
- team_lead: team_view
- sales_manager: sales_view
- case_manager: case_view
- attorney: legal_view
- professor: expert_view
- finance: finance_view
- employer: company_view
- client: client_view

### Module Access
| Module | Super Admin | Admin | Team Lead | Sales Manager | Case Manager | Attorney | Professor | Finance | Employer | Client |
|--------|-------------|-------|-----------|---------------|--------------|----------|-----------|---------|----------|--------|
| Users | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cases | ✅ | ✅ | Team | ❌ | Assigned | Assigned Legal | Assigned Review | ❌ | Company | Own |
| Clients | ✅ | ✅ | Team | Leads | Assigned | ❌ | ❌ | Billing | Company | Own |
| Finance | ✅ | ✅ | Team | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | Own |
| Reports | ✅ | ✅ | Team | Sales | Case | Legal | Expert | Finance | Company | ❌ |
| Settings | ✅ | Operational | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Company | ❌ |
| Teams | ✅ | ✅ | Own | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Companies | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Own | ❌ |
| Documents | ✅ | ✅ | Team | Sales | Assigned | Legal | Review | Billing | Company | Own |
| Leads | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Notifications | ✅ | ✅ | Team | ❌ | Case | Legal | Expert | Finance | Company | Own |

### CRUD Permissions by Role

| Action | Super Admin | Admin | Team Lead | Sales Manager | Case Manager | Attorney | Professor | Finance | Employer | Client |
|--------|-------------|-------|-----------|---------------|--------------|----------|-----------|---------|----------|--------|
| Create Users | ✅ | ✅ (not SA) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Edit Users | ✅ | ✅ (not SA) | Team only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Delete Users | ✅ | ✅ (not SA) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Assign Roles | ✅ | ✅ (not SA) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Assign Teams | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create Cases | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Edit Cases | ✅ | ✅ | Team only | ❌ | Assigned only | Assigned Legal | ❌ | ❌ | ❌ | ❌ |
| Delete Cases | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create Clients | ✅ | ✅ | ❌ | From leads | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Edit Clients | ✅ | ✅ | Team only | Own leads | Assigned only | ❌ | ❌ | Billing | Company | Own |
| Delete Clients | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create Payments | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Edit Payments | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Delete Payments | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |

## Security Rules

1. **Never rely on frontend-only hiding** - All protected APIs must check authentication and authorization
2. **Proper error responses** - 401 for unauthenticated, 403 for unauthorized
3. **Sidebar visibility** - Show only if role has permission
4. **Direct URL blocking** - Block direct URL access if permission missing
5. **Role hierarchy enforcement** - Lower roles cannot create/edit/delete/assign higher roles
6. **Client isolation** - Clients cannot access admin, team, finance, attorney, or internal pages
7. **Finance isolation** - Finance users cannot access unrelated client documents
8. **Employer isolation** - Employer users can only access records connected to their organization
9. **Team Lead isolation** - Team Leads can only access assigned team data
10. **Case isolation** - Case Managers and Attorneys can only access assigned cases unless Admin/Super Admin
