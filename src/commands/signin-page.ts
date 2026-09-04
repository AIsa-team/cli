import { SIGNIN_PAGE, t, type Lang } from "./flow.js";

/**
 * The page the browser lands on when a sign-in finishes on this machine.
 *
 * For a long time this was one unstyled line of HTML served without a
 * charset, which is two faults in one: it looked like a crash, and a browser
 * in a Chinese locale decoded the em dash as GBK and rendered it as mojibake.
 * The person reading it has just finished trusting us with their account.
 *
 * Self-contained on purpose. It is served by a socket that closes moments
 * later, so anything it referenced would already be gone by the time the
 * browser asked for it — and a stylesheet fetched from anywhere carries the
 * URL of this page, which is the authorization code.
 */
export function renderSignInPage(ok: boolean, lang: Lang): string {
  const c = ok ? SIGNIN_PAGE.ok : SIGNIN_PAGE.failed;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>AIsa CLI</title>
<style>
  :root{--bg:#fbfaf9;--fg:#1c1917;--dim:#78716c;--line:#e7e5e4;--card:#fff;--accent:${ok ? "#b4451f" : "#9a3412"}}
  @media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--dim:#a8a29e;--line:#292524;--card:#161312}}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    background:var(--bg);color:var(--fg);
    font:16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue","PingFang SC","Microsoft YaHei",sans-serif}
  .card{width:100%;max-width:460px;background:var(--card);border:1px solid var(--line);
    border-radius:14px;padding:32px;text-align:center}
  .mark{width:44px;height:44px;border-radius:50%;background:var(--accent);color:#fff;display:flex;
    align-items:center;justify-content:center;font-size:23px;margin:0 auto 18px}
  h1{font-size:21px;margin:0 0 8px;letter-spacing:-.01em}
  p{margin:0;color:var(--dim);font-size:14.5px}
</style>
</head>
<body>
  <div class="card">
    <div class="mark">${ok ? "✓" : "!"}</div>
    <h1>${t(c.title, lang)}</h1>
    <p>${t(c.body, lang)}</p>
  </div>
</body>
</html>`;
}
