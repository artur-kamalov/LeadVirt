# LeadVirt.com Domain Migration

Status on 2026-07-10: complete and live at `https://leadvirt.com`. Apex and `www` resolve to `193.187.92.88`, Let's Encrypt TLS is active, release `1b5246588620` passed public verification, and Telegram OAuth opens with the `.com` origin.

## 1. DNS

In Beget DNS, replace the current A records with:

```text
leadvirt.com      A  193.187.92.88
www.leadvirt.com  A  193.187.92.88
```

Wait until both names return the VPS IP from public resolvers.

## 2. Deploy

Run `.github/workflows/deploy-leadvirt-com.yml` after DNS propagation. Before changing the active release, it:

1. verifies DNS and HTTP ACME routing;
2. issues the `.com` certificate;
3. updates public URL/CORS values in the server env;
4. validates the candidate nginx configuration.

The equivalent manual command from a release containing the migration files is:

```bash
cd /opt/leadvirt/current
sh deploy/enable-leadvirt-com-https.sh
```

## 3. External Services

- BotFather `/setdomain` is set to `leadvirt.com` for `@LeadVirtAi_bot`.
- Replace `.ru` OAuth callbacks, Telegram/webhook endpoints, widget embeds, bookmarks, and operator links with `.com`.
- Keep `.ru` DNS and certificate active during the compatibility window.

## 4. Verify

```bash
curl -fsS https://leadvirt.com/health
curl -sS -o /dev/null -w '%{http_code}\n' https://leadvirt.com/api/auth/me
curl -sSI https://www.leadvirt.com/
curl -sSI https://leadvirt.ru/
curl -sS -o /dev/null -w '%{http_code}\n' https://leadvirt.ru/api/auth/me
```

Expected: `.com` health `200`, both auth checks `401`, and browser origins redirect `308` to the `.com` apex. Then run `qa:pilot:public` against `.com` and smoke Telegram login plus the website widget.
