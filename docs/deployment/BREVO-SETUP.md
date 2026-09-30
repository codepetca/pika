# Brevo Email Setup Guide

Quick guide to configure Brevo for sending verification emails in Pika.

---

## 📋 Template Variables

Your Brevo template should include these variables:

```handlebars
{{ params.code }}         # The 6-character verification code
{{ params.expires }}      # Expiry time in minutes (always 10)
{{ params.type }}         # Either "signup" or "password_reset"
```

**Example template usage:**
```html
<p>Your verification code is: <strong>{{ params.code }}</strong></p>
<p>This code will expire in {{ params.expires }} minutes.</p>
```

---

## ⚙️ Vercel Environment Variables

Configure these in Vercel Dashboard → Settings → Environment Variables for
**Production** only. Development and smoke tests run locally; see the
[canonical flow](../dev-workflow.md#environments-and-release-flow):

```bash
# Disable mock email mode
ENABLE_MOCK_EMAIL=false

# Brevo configuration
BREVO_API_KEY=xkeysib-your-api-key-here
BREVO_TEMPLATE_ID=2
BREVO_FROM_EMAIL=noreply@notify.codepet.ca
BREVO_FROM_NAME=Pika
```

---

## 🔍 How It Works

When `ENABLE_MOCK_EMAIL=false`:
1. User requests verification code
2. App calls `sendBrevoEmail()` with template params
3. Brevo sends email using template ID 2
4. Template renders with `code`, `expires`, and `type` variables
5. User receives email with verification code

When `ENABLE_MOCK_EMAIL=true`:
1. Code is logged to the local dev server console instead
2. No email is sent (development mode)

---

## 🧪 Testing

### Test Locally (Mock Mode)

```bash
# In .env.local
ENABLE_MOCK_EMAIL=true
```

Codes will print to console.

### Controlled Local Test (Real Email)

1. Configure an active Brevo key, template, and verified sender in the local
   runtime; set `ENABLE_MOCK_EMAIL=false` only for this canary.
2. Run the local app against local Supabase with your chosen test account.
3. Sign up and confirm the code arrives and verifies. Restore mock mode for
   ordinary development after the canary.
4. For WorkOS Magic Auth, follow the separately controlled
   [local canary](../guidance/workos-magic-auth-pilot.md#local-canary-with-workos-test-credentials);
   its provider delivery settings differ from password signup/reset email.

Production verification follows the reviewed `main` → `production` promotion,
with production credentials and an explicitly authorized bounded canary. A
hosted Preview deployment is not a testing prerequisite.

---

## 🔧 Troubleshooting

### Email not arriving

**Check:**
1. ✅ `BREVO_API_KEY` is correct
2. ✅ `BREVO_TEMPLATE_ID` matches your template
3. ✅ `BREVO_FROM_EMAIL` is verified in Brevo
4. ✅ `ENABLE_MOCK_EMAIL=false` (not `true`)
5. ✅ Check spam folder
6. ✅ Check Brevo dashboard: https://app.brevo.com/transactional

### Template variables not rendering

Make sure your Brevo template uses:
- `{{ params.code }}` (not `{{ code }}`)
- `{{ params.expires }}` (not `{{ expires }}`)
- `{{ params.type }}` (optional)

### API errors in Vercel logs

```
Failed to send email via Brevo (401): Unauthorized
```
→ API key is incorrect, expired, or disabled. For the local Pika/Bara pilot,
run `pnpm attendance:local:configure` with active Brevo credentials in
`.env.local`, or provide `--brevo-env /absolute/path/local-email.env`; it verifies
the selected key without printing it. Restart Next.js after any environment repair.

```
Failed to send email via Brevo (400): ...
```
→ Template ID doesn't exist or sender email not verified

---

## 📊 Brevo Dashboard

Monitor email delivery:
- **Transactional emails**: https://app.brevo.com/transactional
- **Senders**: https://app.brevo.com/senders
- **API keys**: https://app.brevo.com/settings/keys/api
- **Templates**: https://app.brevo.com/camp/lists/template

---

## ✅ Success Checklist

- [ ] Brevo template created with `{{ params.code }}`, `{{ params.expires }}`
- [ ] Sender email verified in Brevo
- [ ] Production environment variables set in Vercel
- [ ] `ENABLE_MOCK_EMAIL=false` for production; local mock mode is restored after a real-email canary
- [ ] Test email received successfully
- [ ] Verification code works in app

---

Test locally first; release through the reviewed `main` → `production` flow.
