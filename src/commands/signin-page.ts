/**
 * The page the browser lands on when a sign-in finishes on this machine.
 *
 * For a long time this was one unstyled line of HTML served without a
 * charset: two faults in one, because a browser in a Chinese locale decoded
 * the em dash as GBK and rendered it as mojibake. The person reading it has
 * just finished trusting us with their account, and it looked like a crash.
 *
 * Same proportions as https://aisa.one/cli/auth — the other page a sign-in
 * can land on. One of the two is always the last thing a user sees, and they
 * should not look like they came from different products. English on both,
 * for the same reason: one language read by everyone beats two read by
 * halves.
 *
 * Self-contained on purpose. The socket serving it closes moments later, so
 * anything it referenced would already be gone by the time the browser asked
 * — and a stylesheet from another origin carries this page's URL, which is
 * the authorization code.
 */

export type SignInOutcome = "ok" | "failed" | "expired";

interface Outcome {
  kicker: string;
  title: string;
  body: string;
  cta?: { href: string; label: string; note: string };
}

const COPY: Record<SignInOutcome, Outcome> = {
  ok: {
    kicker: "SIGNED IN",
    title: "You're all set",
    body: "Your key was created on the machine you started from — it never travelled through this browser. You can close this tab.",
    /**
     * The one moment a link to the console is welcome rather than in the way.
     *
     * The thing they came to do is done, the tab is about to be closed
     * anyway, and they have just acquired an account they have probably
     * never looked at. Anywhere earlier in the flow this would be a
     * distraction; here it is the only thing left to offer. Carries the
     * same source parameter the CLI's other console links use, so the
     * traffic can be told apart from someone typing the address.
     */
    cta: {
      href: "https://console.aisa.one?source=aisa_cli_signin",
      label: "Open your console",
      note: "Usage, spending and API keys live there.",
    },
  },
  failed: {
    kicker: "NOT COMPLETED",
    title: "Sign-in was not completed",
    body: "Nothing was changed. Return to your terminal and run <code>aisa login</code> again.",
  },
  expired: {
    kicker: "EXPIRED",
    title: "This sign-in timed out",
    body: "The terminal stopped waiting before you got here, so this approval has nowhere to go. Nothing was changed — run <code>aisa login</code> again and it will take a few seconds.",
  },
};

export function renderSignInPage(outcome: SignInOutcome): string {
  const c = COPY[outcome];
  const good = outcome === "ok";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex,nofollow">
<title>AIsa CLI</title>
<style>
  :root{
    --bg:#faf9f7; --fg:#1c1917; --dim:#6f6864; --faint:#a8a29e;
    --line:#e7e4e0; --accent:${good ? "#c2410c" : "#9a3412"};
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  }
  @media (prefers-color-scheme:dark){
    :root{--bg:#0d0c0b; --fg:#f5f4f2; --dim:#a09a95; --faint:#6f6864;
          --line:#282523; --accent:${good ? "#e2703a" : "#c2410c"}}
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;display:flex;align-items:center;justify-content:center;
    padding:48px 32px;background:var(--bg);color:var(--fg);
    font:17px/1.65 ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{width:min(720px,74vw)}
  .tick{display:flex;align-items:center;gap:12px;margin-bottom:28px}
  .tick span{width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;
    display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto}
  .tick b{font-size:15px;font-weight:600;letter-spacing:.02em;color:var(--dim)}
  h1{font-size:34px;line-height:1.25;margin:0 0 16px;letter-spacing:-.021em;font-weight:650}
  p{margin:0;font-size:18px;color:var(--dim);max-width:32em}
  code{font-family:var(--mono);font-size:16px;color:var(--fg)}
  .cta{margin-top:36px;padding-top:28px;border-top:1px solid var(--line);
    display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  .cta a{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;
    border-radius:10px;padding:15px 30px;font-weight:600;font-size:16px;letter-spacing:.01em}
  .cta a:hover{filter:brightness(1.07)}
  .cta span{font-size:15px;color:var(--faint)}
  @media (max-width:760px){
    body{padding:32px 20px} .wrap{width:100%}
    h1{font-size:27px} p{font-size:16.5px}
    .cta{flex-direction:column;align-items:flex-start;gap:12px}
    .cta a{width:100%;text-align:center}
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="tick"><span>${good ? "✓" : "!"}</span><b>${c.kicker}</b></div>
    <h1>${c.title}</h1>
    <p>${c.body}</p>
    ${c.cta
      ? `<div class="cta">
      <a href="${c.cta.href}" rel="noopener">${c.cta.label}</a>
      <span>${c.cta.note}</span>
    </div>`
      : ""}
  </div>
</body>
</html>`;
}
