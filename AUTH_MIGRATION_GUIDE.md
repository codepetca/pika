# Authentication Refactor Migration Guide

This guide explains the changes made in the authentication refactor and how to deploy them.

## Overview

The authentication system has been refactored from a **passwordless email code system** (where users receive a code for every login) to a **modern password-based system** with email verification during signup.

### New Authentication Flow

1. **Signup (First-Time Users)**
   - User enters email → receives 5-character verification code
   - User enters code to verify email
   - User creates a password
   - User is logged in with a long-lived session (30 days)

2. **Login (Returning Users)**
   - User enters email + password
   - User is logged in immediately

3. **Password Reset**
   - User enters email → receives 5-character reset code
   - User enters code → sets new password
   - User is logged in

## Changes Made

### Database Migration

**File:** `supabase/migrations/005_auth_refactor.sql`

- Added `email_verified_at` and `password_hash` columns to `users` table
- Created `verification_codes` table for signup and password reset codes
- Created `sessions` table for session tracking (future use)
- Legacy `login_codes` table remains for backward compatibility

### Backend Changes

#### New API Endpoints

1. **`/api/auth/signup`** - Request signup verification code
2. **`/api/auth/verify-signup`** - Verify signup code
3. **`/api/auth/create-password`** - Create initial password
4. **`/api/auth/login`** - Login with email + password
5. **`/api/auth/forgot-password`** - Request password reset code
6. **`/api/auth/reset-password/verify`** - Verify reset code
7. **`/api/auth/reset-password/confirm`** - Set new password

#### Legacy Endpoints (Still Present)

- `/api/auth/request-code` - Legacy passwordless login
- `/api/auth/verify-code` - Legacy code verification

These remain for backward compatibility during migration.

#### Updated Libraries

**`src/lib/crypto.ts`**
- Added `generateVerificationCode()` - 5-character alphanumeric codes
- Added `hashPassword()` and `verifyPassword()` - password hashing
- Added `validatePassword()` - password validation
- Legacy `generateCode()` remains for backward compatibility

**`src/lib/email.ts`**
- Added `sendSignupCode()` - signup verification email
- Added `sendPasswordResetCode()` - password reset email
- Legacy `sendLoginCode()` marked as legacy

**`src/types/index.ts`**
- Updated `User` interface with `email_verified_at` and `password_hash`
- Added `VerificationCode` interface
- Added `Session` interface
- Added `VerificationPurpose` type

### Frontend Changes

#### New Pages

1. **`/signup`** - Signup page (request verification code)
2. **`/verify-signup`** - Verify signup code
3. **`/create-password`** - Create password after verification
4. **`/forgot-password`** - Request password reset
5. **`/reset-password`** - Verify reset code and set new password

#### Updated Pages

1. **`/login`** - Now uses email + password instead of requesting a code

#### Legacy Pages (Still Present)

- `/verify-code` - Legacy code verification page

## Deployment Steps

### 1. Apply Database Migration

If using Supabase locally:
```bash
supabase db reset
```

If using hosted Supabase:
```bash
supabase db push
```

Or apply the migration manually in the Supabase dashboard.

### 2. Verify Environment Variables

Ensure these are set in `.env.local` or production environment:

```env
# Required
SESSION_SECRET=<32+ character secret>
ENABLE_MOCK_EMAIL=true  # For development
```

### 3. Deploy Application

```bash
npm run build
npm start  # or deploy to Vercel
```

### 4. Test the Flows

#### Test Signup Flow
1. Navigate to `/signup`
2. Enter an email
3. Check console for 5-character verification code
4. Enter code on `/verify-signup`
5. Create password on `/create-password`
6. Should be logged in and redirected

#### Test Login Flow
1. Navigate to `/login`
2. Enter email + password from signup
3. Should be logged in and redirected

#### Test Password Reset
1. Navigate to `/forgot-password`
2. Enter email
3. Check console for 5-character reset code
4. Enter code on `/reset-password`
5. Set new password
6. Should be logged in and redirected

## Migration Strategy for Existing Users

### Option 1: Force Password Reset (Recommended)

All existing users will need to set a password on their next login:

1. When user visits `/login`, they should click "Forgot password?"
2. They receive a reset code and create a password
3. Future logins use email + password

### Option 2: Gradual Migration

Keep both login methods active:

1. Add a "Login with code" link on `/login` page that redirects to `/verify-code`
2. Existing users can continue using codes
3. New users must create passwords
4. Eventually deprecate code-based login

### Implementation for Option 1

Add this to the login page:

```tsx
<div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
  <p className="text-sm text-blue-800">
    <strong>New login system:</strong> We now use passwords instead of email codes.
    If this is your first time logging in with a password, click "Forgot password?" to set one up.
  </p>
</div>
```

## Security Improvements

1. **Password Hashing**: All passwords are hashed with bcrypt (10 rounds)
2. **Code Hashing**: Verification codes are hashed before storage
3. **Rate Limiting**:
   - Max 5 signup codes per hour
   - Max 3 reset codes per hour
   - Login attempt limiting (5 attempts, 15-minute lockout)
4. **Attempt Tracking**: Verification codes track failed attempts (max 5)
5. **Email Enumeration Prevention**: Forgot password always returns success
6. **Short-lived Codes**: 10-minute expiry on all verification codes
7. **Long-lived Sessions**: 30-day sessions stored in secure HTTP-only cookies

## Testing Checklist

- [ ] Signup flow works end-to-end
- [ ] Login with password works
- [ ] Forgot password flow works
- [ ] Email verification codes are 5 characters
- [ ] Codes expire after 10 minutes
- [ ] Rate limiting works (try requesting multiple codes)
- [ ] Invalid code shows error
- [ ] Password validation works (min 8 characters)
- [ ] Session persists across page reloads
- [ ] Logout works
- [ ] Teacher vs student role detection works
- [ ] Redirects work correctly (student → /student/today, teacher → /teacher/dashboard)

## Rollback Plan

If issues arise, you can roll back by:

1. Revert the database migration:
   ```sql
   ALTER TABLE users DROP COLUMN email_verified_at;
   ALTER TABLE users DROP COLUMN password_hash;
   DROP TABLE IF EXISTS verification_codes;
   DROP TABLE IF EXISTS sessions;
   ```

2. Revert code changes:
   ```bash
   git checkout main
   ```

3. Redeploy the previous version

## Future Improvements

- [ ] Implement session table tracking (currently using iron-session only)
- [ ] Add "Remember me" option for extended sessions
- [ ] Add email change verification flow
- [ ] Add 2FA support
- [ ] Implement rate limiting with Redis (currently in-memory)
- [ ] Add password strength indicator in UI
- [ ] Send actual emails in production (currently using console logs)
- [ ] Add account lockout after multiple failed login attempts
- [ ] Implement proper session revocation on password reset

## Notes

- The legacy passwordless flow is still present but not linked in the UI
- All verification codes are 5 characters (A-Z, 0-9)
- Sessions are valid for 30 days (configurable in `src/lib/auth.ts`)
- Email sending is mocked in development (check console for codes)
- Password requirements: minimum 8 characters (can be enhanced later)
