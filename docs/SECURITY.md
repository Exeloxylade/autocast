# Security

## How AutoCast protects your accounts

| Thing | How |
|---|---|
| Admin password | Hashed with scrypt. Login is rate-limited (8 tries per 15 minutes). Changing it logs out all other browsers. |
| Session | Signed, `HttpOnly`, `SameSite=Lax` cookie; `Secure` when `PUBLIC_URL` is https |
| Cross-site requests | Every API write needs the `x-autocast` header |
| Tokens, stream keys, app secrets, AI key, Telegram token | Encrypted at rest with AES-256-GCM using `AUTOCAST_SECRET`. Never sent to the browser. |
| Errors | Stream keys are removed from error messages |
| Push tokens | Stored as SHA-256 hashes, shown only once |
| Network | The app listens on `127.0.0.1:7676`; the relay is not exposed; HTTPS comes from your proxy |
| Instagram video links | Signed links that expire in 1 hour |
| Uploaded logos | Re-encoded to PNG, so only real images are used |
| Recording downloads | Strict file name check (no path tricks) |
| AI "Ask" | Only 3 action types, always shown to you first, checked again on the server |

## What you should do

1. Keep `AUTOCAST_SECRET` and a copy of `data/` somewhere safe. Without the secret, saved logins can't be read.
2. Use a strong password.
3. Keep the VPS updated (`apt upgrade`) and AutoCast updated (`git pull && docker compose up -d --build`).
4. Don't open port `7676` to the internet. Use the HTTPS proxy.
5. If other software on the same VPS can run commands (AI agents, panels), know that it could read `data/` and `.env`. Keep it in its own user or container.
6. Delete push tokens you no longer use.

## Reporting a problem

Please don't open a public issue for security problems. Use GitHub's **Security → Report a vulnerability** on this repository.
