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
/**
 * What every ending looks like, here and in the connect page.
 *
 * This was a line along the bottom, silent until the last minute. It was
 * honest and it was also easy to miss — a page nobody is watching any more
 * ends without saying so, and the reader comes back to a tab that has
 * quietly stopped working. A dialog cannot be missed, and it is the shape
 * the connect page already uses when its own time runs out, so the two
 * surfaces end the same way.
 *
 * It carries the two lines every ending carries: where the account lives,
 * and the command that starts the next one. Addresses rather than buttons —
 * a button is clicked once and forgotten; `console.aisa.one` and
 * `aisa connect` are things someone can still type next week.
 */
const ENDING_MARKUP = [
  '<div class="ending" id="ending" hidden><div class="endbox">',
  '  <h2 id="endtitle"></h2>',
  '  <p id="endbody"></p>',
  '  <div class="endcta">',
  '    <p>Usage, spending and top-ups live at <a href="https://console.aisa.one?source=aisa_cli_signin">console.aisa.one</a>.</p>',
  '    <p>Run <code>aisa connect</code> any time \u2014 add servers, switch models, or connect another agent.</p>',
  "  </div>",
  "</div></div>",
  "<scr" + "ipt>",
  "(function () {",
  "  var until = __UNTIL__;",
  '  var box = document.getElementById("ending");',
  '  var t = document.getElementById("endtitle"), b = document.getElementById("endbody");',
  "  function show(title, body) {",
  "    t.textContent = title; b.textContent = body; box.hidden = false;",
  "  }",
  "  function tick() {",
  "    var left = Math.ceil((until - Date.now()) / 1000);",
  "    if (left <= 0) {",
  '      show("This page has closed", "Nothing here is needed any more \u2014 your key was saved on the machine you signed in from.");',
  "      return;",
  "    }",
  // Silent until the last minute, as before: a countdown running for five
  // minutes is furniture. What changed is that it ends in a dialog rather
  // than in a line nobody was looking at.
  "    if (left > 60) { setTimeout(tick, 1000); return; }",
  '    show("This page closes in " + left + " seconds", "You can close it now \u2014 your key is already saved.");',
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
  .ending{position:fixed;inset:0;z-index:9;display:flex;align-items:center;justify-content:center;
    padding:32px;background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(3px)}
  .ending[hidden]{display:none}
  .endbox{width:min(520px,100%);background:var(--bg);border:1px solid var(--line);
    border-radius:14px;padding:26px 28px;box-shadow:0 18px 48px rgba(0,0,0,.14)}
  .endbox h2{font-size:21px;margin:0 0 10px;letter-spacing:-.012em}
  .endbox p{font-size:15.5px;margin:0}
  .endcta{margin:18px 0 0;padding:15px 0 0;border-top:1px solid var(--line)}
  .endcta p{font-size:14px;line-height:1.55;margin:0 0 6px;color:var(--dim)}
  .endcta p:last-child{margin-bottom:0}
  .endcta a{color:var(--accent);font-family:var(--mono);text-decoration:none;
    border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}
  .endcta a:hover{border-bottom-color:var(--accent)}
  .endcta code{font-family:var(--mono);font-size:13.5px;color:var(--fg);
    background:color-mix(in srgb,var(--fg) 6%,transparent);border-radius:5px;padding:1px 5px}
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
  ${closesAt ? ENDING_MARKUP.replace("__UNTIL__", String(closesAt)) : ""}
</body>
</html>`;
}

/**
 * The page a sign-in started from inside `connect` lands on.
 *
 * The difference from the one above is entirely about what happens next.
 * Standalone `aisa login` is finished when the browser lands: "you can close
 * this tab" is the whole of the remaining instruction. Inside a run it is
 * not — a setup is still going one tab over, and the user has just been sent
 * away from it by a redirect they did not choose. Leaving them on a
 * congratulations page with a close button makes finding the way back their
 * problem.
 *
 * So this one goes back on its own, after a beat long enough to read the
 * tick. window.close() is tried first and will almost always fail — the tab
 * was opened by the operating system, not by a script, and browsers do not
 * let a page close what it did not open — which is exactly why the redirect
 * cannot be left to it. A plain link sits underneath for anyone whose
 * browser blocks both.
 */
export type ReturnOutcome = "ok" | "failed" | "stale";

const RETURN_DWELL_MS = 1400;

export function renderReturnPage(
  outcome: ReturnOutcome,
  back: string,
  copy: { title: string; body: string; link: string }
): string {
  const good = outcome === "ok";
  // Only a successful sign-in is sent back on its own. A failure has
  // something to read, and bouncing someone off an explanation before they
  // have read it is how a run becomes a mystery.
  const auto = good;
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
  h1{font-size:34px;line-height:1.25;margin:0 0 16px;letter-spacing:-.021em;font-weight:650}
  p{margin:0;font-size:18px;color:var(--dim);max-width:32em}
  .cta{margin:22px 0 0;font-size:17px}
  .cta a{color:var(--accent);text-decoration:none;font-family:var(--mono);font-size:16px;
    border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}
  .cta a:hover{border-bottom-color:var(--accent)}
  @media (max-width:760px){
    body{padding:32px 20px} .wrap{width:100%}
    h1{font-size:27px} p{font-size:16.5px} .cta{font-size:16px}
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="tick"><span>${good ? "✓" : "!"}</span></div>
    <h1>${copy.title}</h1>
    <p>${copy.body}</p>
    ${back ? `<p class="cta"><a id="back" href="${back}">${copy.link}</a></p>` : ""}
  </div>
<script>
(function () {
  var el = document.getElementById("back");
  if (!el) return;
  var back = el.getAttribute("href");
  ${auto ? `setTimeout(function () {
    try { window.close(); } catch (e) { /* not ours to close */ }
    location.replace(back);
  }, ${RETURN_DWELL_MS});` : ""}
})();
</script>
</body>
</html>`;
}
