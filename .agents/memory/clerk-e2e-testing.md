---
name: Clerk e2e testing limits
description: Why automated testers can't complete Clerk sign-up/sign-in in this project
---

Clerk (Replit-managed) shows a Cloudflare "Verify you are human" challenge during sign-up, which the Playwright testing subagent cannot pass.

**Why:** Bot protection on Clerk dev instances triggers for automated browsers; `+clerk_test` emails with OTP 424242 never get reached.

**How to apply:** For flows behind Clerk auth, test the server side with curl (expect 401/403) and test the UI up to the Clerk card; ask the human testers to verify the signed-in path, or seed a session cookie via DB/API if ever needed. A tester verdict of "unable" at the CAPTCHA is not an app bug.
