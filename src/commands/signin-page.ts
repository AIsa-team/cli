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


/** Fixed to the bottom; quiet until the final minute. */
const EXPIRY_MARKUP = [
  '<div class="expiry" id="expiry"></div>',
  "<scr" + "ipt>",
  "(function () {",
  "  var until = __UNTIL__;",
  '  var el = document.getElementById("expiry");',
  "  function tick() {",
  "    var left = Math.ceil((until - Date.now()) / 1000);",
  "    if (left <= 0) {",
  '      el.textContent = "This page has expired. You can close it \u2014 nothing here is needed any more.";',
  '      el.className = "expiry on";',
  "      return;",
  "    }",
  "    if (left > 60) { setTimeout(tick, 1000); return; }",
  '    el.textContent = "This page stops working in " + left + " seconds. You can close it at any time \u2014 your key is already saved.";',
  '    el.className = "expiry on";',
  "    setTimeout(tick, 1000);",
  "  }",
  "  tick();",
  "})();",
  "</scr" + "ipt>",
].join("\n");

export type SignInOutcome = "ok" | "failed" | "expired";

interface Outcome {
  kicker: string;
  title: string;
  body: string;
  cta?: { href: string; domain: string; before: string; after: string };
}

const COPY: Record<SignInOutcome, Outcome> = {
  ok: {
    kicker: "SIGNED IN",
    title: "You're all set",
    body: "Your key was created on the machine you started from — it never travelled through this browser. You can close this tab.",
    /**
     * The one moment a mention of the console is welcome rather than in the
     * way — and a sentence, not a button.
     *
     * A button is a demand for attention, and this person's attention
     * belongs back in the terminal they started from. It also teaches them
     * nothing: they click it once and could not tell you afterwards where
     * they went. The address, written out and worth clicking, is the thing
     * they can still type next week. Carries the source parameter the CLI's
     * other console links use, with its own value, so this surface can be
     * told apart from someone typing it from memory — which is the point.
     */
    cta: {
      href: "https://console.aisa.one?source=aisa_cli_signin",
      domain: "console.aisa.one",
      before: "Usage, spending and API keys live at ",
      after: ".",
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

/**
 * @param closesAt Absolute epoch ms when this page stops being served.
 *   Given one, the page counts itself down near the end.
 */
export function renderSignInPage(outcome: SignInOutcome, closesAt?: number): string {
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
  .cta{margin:22px 0 0;font-size:17px;color:var(--dim);max-width:32em}
  /* Along the bottom, out of the way, and silent until there is something
     worth saying. A countdown running for five minutes is not a warning, it
     is furniture — and this one exists to remove a worry, not create one. */
  .expiry{position:fixed;left:0;right:0;bottom:0;padding:14px 32px;
    font-size:13.5px;color:var(--faint);text-align:center;
    border-top:1px solid var(--line);background:var(--bg);
    opacity:0;transition:opacity .4s ease;pointer-events:none}
  .expiry.on{opacity:1}
  .cta a{color:var(--accent);text-decoration:none;font-family:var(--mono);
    font-size:16px;border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}
  .cta a:hover{border-bottom-color:var(--accent)}
  @media (max-width:760px){
    body{padding:32px 20px} .wrap{width:100%}
    h1{font-size:27px} p{font-size:16.5px}
    .cta{font-size:16px}
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="tick"><span>${good ? "✓" : "!"}</span><b>${c.kicker}</b></div>
    <h1>${c.title}</h1>
    <p>${c.body}</p>
    ${c.cta
      ? `<p class="cta">${c.cta.before}<a href="${c.cta.href}" rel="noopener">${c.cta.domain}</a>${c.cta.after}</p>`
      : ""}
  </div>
  ${closesAt ? EXPIRY_MARKUP.replace("__UNTIL__", String(closesAt)) : ""}
</body>
</html>`;
}
