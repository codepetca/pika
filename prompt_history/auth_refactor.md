# Pika Authentication Refactor

This document defines the new authentication flow for the **Pika** asynchronous learning app. Provide this file to the AI (Claude, Copilot, etc.) so it can implement the full auth refactor.

---

## Goals

- Replace the old flow where students must enter their email and receive a one-time code every login.
- Implement a modern, student‑friendly flow:
  - **First-time signup:** email → emailed email verification code → student creates a long‑lived password.
  - **Subsequent logins:** email + password.
- Verification code: **5‑character alphanumeric** (A–Z, 0–9), short‑lived.
- Password: student‑chosen secret, long‑lived, hashed in DB.
- Session: long‑lived (e.g., 30 days), stored in a secure HTTP‑only cookie.
- Students use their **own devices**, so persistent sessions are acceptable.

---

## Terminology

### Email Verification Code (OTP)
- 5‑character alphanumeric (e.g., `A7Q2F`).
- Used for email ownership verification **only**.
- Short‑lived (10–15 minutes).
- One‑time use.
- Stored hashed.

### Password / Password
- Student-chosen secret.
- Long‑lived.
- Stored hashed in DB.
- Used for all future logins.

### Session
- HTTP‑only secure cookie.
- Contains opaque session token (or JWT ID).
- Valid for 30 days (or project-standard length).
- Used to auto‑log student in on their device.

---

## Required Flows

### 1. Signup (First-Time User)

**Endpoint/UI:** `/signup`

1. Student enters email.
2. Backend:
   - Create or fetch user record.
   - Generate 5‑character alphanumeric email verification code.
   - Store hashed code with fields:
     - `userId`
     - `codeHash`
     - `purpose = "signup"`
     - `expiresAt`
     - `attempts = 0`
   - Send email containing email verification code.
3. Redirect to verification page.

---

### 2. Verify Signup Code

**Endpoint/UI:** `/verify`

1. Student enters email + code.
2. Backend:
   - Lookup email verification code record.
   - Validate:
     - Not expired.
     - Purpose = "signup".
     - Attempts < maximum.
     - Code hash matches.
   - On success:
     - Mark code as used.
     - Mark user as verified.
     - Redirect to "Create Password" page.

---

### 3. Create Password

**Endpoint/UI:** `/create-password`

1. Student enters new password + confirmation.
2. Backend:
   - Validate length/format.
   - Hash password.
   - Save to user record.
   - Create session token and store it in `Session` table.
   - Set HTTP‑only cookie.
   - Redirect to main student dashboard.

---

## Login Flow

**Endpoint/UI:** `/login`

1. Student enters email + password.
2. Backend:
   - Lookup user by email.
   - Verify password hash.
   - Create new session and set cookie.
3. Optionally pre-fill email using localStorage for convenience.

---

## Forgot Password (Reset)

### 1. Request Reset

**Endpoint/UI:** `/forgot-password`

1. Student enters email.
2. Backend:
   - If user exists:
     - Generate 5‑character alphanumeric email verification code.
     - Store hashed code with `purpose = "reset_password"`.
     - Email code.
   - Respond with generic success (“If this email exists, instructions have been sent”).

---

### 2. Verify Reset Code

**Endpoint/UI:** `/reset-password/verify`

1. Student enters email + code.
2. Backend:
   - Validate code same way as signup.
   - Mark code used.
   - Redirect to new password form.

---

### 3. Set New Password

**Endpoint/UI:** `/reset-password/confirm`

1. Student enters new password.
2. Backend:
   - Hash and store password.
   - Optionally revoke all existing sessions.
   - Create fresh session.
   - Redirect to dashboard.

---

## Data Model

### User
- `id`
- `email`
- `emailVerifiedAt`
- `passwordHash`
- timestamps

### VerificationCode
- `id`
- `userId`
- `codeHash`
- `purpose` (`signup` | `reset_password`)
- `expiresAt`
- `attempts`
- `usedAt`
- timestamps

### Session
- `id`
- `userId`
- `token`
- `expiresAt`
- timestamps

---

## Security Requirements

- Hash both passwords and email verification codes (never store raw).
- Set attempt limits (e.g., 5 attempts).
- Rate limit sending email verification codes.
- Use secure HTTP‑only cookies.
- Never log raw passwords or email verification codes.

---

## Cleanup Tasks

- Remove legacy flow where students must enter emailed code every login.
- Remove old 8‑character code logic.
- Update email templates.
- Ensure consistency with existing framework conventions.

---

## Deliverables

The AI should produce:

1. All backend API routes / server functions.
2. All UI pages and transitions.
3. Updated DB schema or migration.
4. Updated email templates.
5. Session middleware or utilities.
6. Basic automated tests for:
   - Signup
   - Login
   - Verification
   - Reset flow

---

## Notes for the AI

- Follow existing project conventions for routing, DB, crypto, and session handling.
- Do not introduce incompatible frameworks.
- If contradictions appear, default to current project style and leave comments in the PR.

