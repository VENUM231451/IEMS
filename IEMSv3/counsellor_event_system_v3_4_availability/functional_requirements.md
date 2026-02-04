# System Functional Requirements

## 1. System Overview
The Counsellor Event System is a web-based platform designed to manage event submissions by counsellors and facilitate staffing assignments by administrators. It features a dual-role interface (Admin and Counsellor) with secure authentication and real-time availability tracking.

## 2. User Roles
- **Administrator**: Complete control over the system, including managing counsellors, finalizing event staffing, and generating reports.
- **Counsellor**: Ability to propose events, suggest staffing, and view their own assignments.

## 3. Functional Requirements by Role

### 3.1 Authentication & Security
- **Login**: Secure login with username and password.
- **Role-Based Access Control (RBAC)**: Distinct access levels for Admins and Counsellors.
- **Session Management**: JSON Web Token (JWT) based authentication.
- **Default Accounts**: System automatically seeds default `admin` and `counsellor` accounts if they do not exist.

### 3.2 Counsellor Portal
**Event Management**
- **Create Submission**: Submit new events with the following details:
  - Start Date & End Date (Validation: Start <= End)
  - Organizer Name
  - Location (City, Country)
  - Remarks
  - Proposed Staffing (Free text)
  - **Staffing Suggestions**: Select specific "Suggested Counsellors" from a list of available staff.
- **View Submissions**: Dashboard displaying a list of the counsellor's own submissions, sorted by date.
- **Edit Submission**:
  - Update details of "Pending" submissions.
  - Update "Confirmed" submissions only if the start date is in the future (Effective immediately resets status to "Pending").
- **Delete Submission**: Remove own submissions.

**Availability Tools**
- **Check Availability**: View availability status of other counsellors to make informed staffing suggestions during submission.

### 3.3 Administrator Portal
**Dashboard**
- **Vertical Layout**: Split view for "Event Submissions" (primary) and "Counsellor Accounts" (secondary).
- **Global Filters**: Filter events by:
  - Status (Pending / Confirmed)
  - Counsellor (Assigned)
  - Month
  - City / Country
  - Organizer

**Event Administration**
- **View All Events**: Comprehensive list of all submissions from all counsellors.
- **Metadata Management**:
  - **Payment Status**: Toggle between PAID, UNPAID, FREE.
  - **Event Status**: Toggle between HAPPENING, CANCELLED, POSTPONED.
  - **Sent By**: Manually attribute/reassign the "Sent By" counsellor field.
- **Staffing & Finalization**:
  - **Availability Check**: Visual indicator (Green/Red) showing counsellor availability based on date overlaps.
  - **Conflict Detection**: System alerts if a selected counsellor is already assigned to another *confirmed* event during the same period.
  - **Finalize Staffing**: specific workflow to select counsellors -> Validate Availability -> Save Assignments -> Mark Event as "Confirmed".
  - **Edit Staffing**: Ability to modify assigned counsellors for already confirmed events (re-validates availability).
- **Delete Event**: Hard delete event submissions.

**Counsellor Account Management**
- **List Accounts**: View all registered counsellors with status (Active/Inactive).
- **Create Account**: Add new counsellors (Full Name, Username, Password).
- **Edit Account**: Update details and toggle Active/Inactive status.
- **Delete Account**: Remove counsellor accounts (Cascading delete removes their assignments and suggestions).

**Reporting**
- **CSV Export**: Download a full report of events in CSV format.
- **PDF Export**: Generate a printable PDF report with customizable column selection (Dates, Location, Organizer, Status, Assigned Staff, etc.).

## 4. Technical & Non-Functional Requirements
- **Data Integrity**: SQLite database with foreign key constraints to ensure data consistency (e.g., assignments linked to valid submissions).
- **Concurrency**: Basic transaction support for staffing updates to prevent race conditions.
- **UI/UX**:
  - **Light Theme**: Clean, white-background interface.
  - **Responsive Design**: Adapts to standard screen sizes.
  - **Date Formatting**: Consistent display format (e.g., "29 January 2026").
