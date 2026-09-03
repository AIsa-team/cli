/**
 * Shared vocabulary of `aisa connect`: brand tokens, inline icons, the
 * try-it-now prompts and the run-state types. Both page templates (T1, the
 * original two-page flow, and T2, the guided six-step flow) render from
 * this one source so a server or a step means the same thing everywhere.
 */

/** Every selection a run was started with — the done tab rebuilds the
 *  earlier steps from it. */
export interface Selection {
  servers: string[];
  clients: string[];
  install: string[];
  llmMode: LlmMode;
}

// ── brand tokens (auth.aisa.one, read live) ─────────────────────────────────
export const RED = "#e5322d";
export const RED_CTA = "#cc2b26";
export const INK = "#0d0d0b";
export const PAPER = "#f9f8f6";

// ── inline icons (lucide, 18px, currentColor — icon-kit) ────────────────────
export const I = {
  search: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m21 21l-4.34-4.34"/><circle cx="11" cy="11" r="8"/></g></svg>`,
  finance: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 7h6v6"/><path d="m22 7l-8.5 8.5l-5-5L2 17"/></g></svg>`,
  social: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/></g></svg>`,
  sales: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></g></svg>`,
  terminal: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19h8M4 17l6-6l-6-6"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12l2 2l4-4"/></g></svg>`,
  check: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"/></svg>`,
  copy: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></g></svg>`,
  arrow: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14m-7-7l7 7l-7 7"/></svg>`,
  sparkles: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/></g></svg>`,
} as const;

/** The official AIsa wordmark (docs/logo/dark.svg — the variant for dark
 *  backgrounds, same as the auth.aisa.one top bar). Inlined verbatim. */
export const LOGO = `<svg width="76" height="26" role="img" aria-label="AIsa" viewBox="0 0 176 60" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_383_646)">
<path d="M131.82 19.3201C134.536 19.0359 138.411 19.8123 140.541 21.5465C143.1 23.6295 143.798 25.5303 144.214 28.6185L137.348 28.6269C136.931 25.9579 135.016 24.9636 132.471 24.9612C130.729 24.9281 128.542 25.5621 128.561 27.671C128.575 29.1596 129.725 29.7727 130.962 30.2626C132.595 30.9098 134.332 31.2902 136.021 31.7531C136.917 32.0003 137.803 32.2832 138.677 32.6009C142.115 33.8805 144.392 36.0809 144.438 39.9316C144.472 41.9722 143.674 43.939 142.227 45.3784C139.874 47.7669 136.365 48.4599 133.144 48.4843C128.189 48.4747 122.897 46.1258 121.279 41.0789C121.081 40.4629 120.987 39.7484 120.89 39.1043C123.046 39.0106 125.925 39.0947 128.135 39.1013C128.668 41.8472 131.083 42.9942 133.72 42.8507C134.919 42.7853 136.131 42.4903 136.976 41.5805C137.837 40.6536 137.796 39.0112 136.735 38.2486C136.048 37.7408 135.2 37.4698 134.402 37.1824C130.863 35.9261 126.904 35.6958 123.935 33.1945C120.9 30.6374 120.867 25.7519 123.437 22.853C125.616 20.3955 128.638 19.5072 131.82 19.3201ZM175.324 20.642C175.261 24.238 175.317 28.4508 175.317 32.0615L175.327 48.2658C173.199 48.3411 170.631 48.2731 168.467 48.2737C168.478 46.963 168.476 45.4421 168.46 44.1314C168.311 44.3023 168.138 44.5396 167.996 44.7234L167.978 44.7435C165.94 47.0297 163.358 48.2988 160.328 48.4618C152.689 48.8723 147.739 42.9526 147.282 35.7245C146.805 28.1634 150.863 21.1881 158.918 20.7303C159.364 20.6713 160.338 20.709 160.803 20.7589C164.132 21.1164 166.375 22.4476 168.467 24.9757C168.523 23.7793 168.462 21.88 168.484 20.6404L175.324 20.642ZM165.691 28.1474C164.239 27.027 162.409 26.5146 160.586 26.7185C160.58 26.7195 160.572 26.7207 160.565 26.7217C151.212 28.0278 152.662 43.2707 162.146 42.4672C162.159 42.4652 162.173 42.4629 162.186 42.4609C166.956 41.866 169.045 37.4817 168.421 33.1347C168.136 31.1445 167.302 29.3886 165.691 28.1474Z" fill="#FFFFFF"/>
<path d="M78.0289 13.5267C80.6702 13.5267 83.5754 13.5364 86.2127 13.5354C86.5222 14.5265 87.0571 15.8691 87.4172 16.8669L89.8901 23.7404L98.8048 48.5169L91.3698 48.5249C91.2837 48.1226 90.9557 47.3326 90.8194 46.8917C90.3085 45.2375 89.5697 43.4991 89.1018 41.8495H86.1714L75.1161 41.8472C74.3126 44.1997 73.6136 46.2007 72.8134 48.5292C70.578 48.5344 67.6979 48.5348 65.4658 48.5348C67.0587 44.0868 67.8658 41.8125 69.0723 38.4674L74.7844 22.5834L76.9855 16.4448C77.2399 15.7423 77.8755 14.1862 78.0289 13.5267ZM82.0944 21.6837C80.3256 26.4589 78.7575 31.4495 77.0142 36.2634L87.1713 36.2683C86.7585 35.0365 82.2554 21.8714 82.0944 21.6837Z" fill="#F76918"/>
<path d="M101.82 13.5045C103.521 13.5045 117.161 13.5045 118.529 13.5045C118.529 14.2596 118.529 17.649 118.529 18.2849C118.068 18.2849 114.74 18.2865 114.206 18.2849C114.206 27.0774 114.2 34.9626 114.199 43.7552C114.844 43.7562 117.157 43.7552 118.593 43.7552C118.593 44.3525 118.601 48.2605 118.601 48.5153C116.908 48.5153 104.675 48.5153 101.701 48.5153C101.701 48.0022 101.693 44.0647 101.693 43.7552C102.405 43.7552 105.794 43.7529 106.633 43.7552L106.649 18.2849C105.774 18.2728 102.75 18.2849 101.82 18.2849C101.82 17.4945 101.82 14.3001 101.82 13.5045Z" fill="#F76918"/>
<path d="M36.5886 39.527C36.9011 39.491 37.0074 39.6587 37.0084 39.9444C37.011 40.8532 37.0103 41.7624 37.01 42.6715L37.0103 47.9718L37.011 50.5985C37.011 50.9836 37.0315 51.7749 36.9724 52.1135C36.6144 52.4758 35.4013 53.1731 34.9215 53.478L31.6211 55.5745C30.924 56.0176 25.8872 59.311 25.5375 59.3859C25.4314 59.4086 25.3426 59.4014 25.244 59.3565C24.9415 59.2199 24.6503 59.0027 24.3697 58.8249L22.7291 57.7795L17.1501 54.2231C16.527 53.8209 15.6563 53.3279 15.0819 52.8613C15.0045 52.7986 14.9969 52.5979 15.0065 52.4937C15.0766 52.3924 15.1832 52.3168 15.2836 52.2458C15.7921 51.8862 19.4322 49.6264 19.792 49.5396C19.8903 49.5158 19.9427 49.5521 20.0289 49.596C20.648 49.9112 21.2523 50.3543 21.8419 50.7243L25.5324 53.0487C26.0599 52.7504 26.7647 52.268 27.2922 51.934C28.7815 50.9717 30.2821 50.027 31.7935 49.0987L31.7922 44.6795C31.7919 44.1875 31.7247 42.9784 31.8396 42.5692C31.8896 42.3969 36.1474 39.7692 36.5886 39.527ZM24.6561 0C24.7858 0.000110369 24.8444 0.0118701 24.9597 0.0776641C25.669 0.482497 26.3813 0.910419 27.0824 1.32705C28.4915 2.15847 29.8919 3.00374 31.2837 3.86258L34.0002 5.5293C34.446 5.80141 34.9232 6.05702 35.3505 6.35428C35.43 6.40965 35.4904 6.48145 35.5152 6.57534C35.5399 6.66872 35.5257 6.74178 35.4759 6.82316C35.4079 6.93414 35.3007 7.02214 35.1944 7.09643C34.7859 7.38177 30.7687 9.80981 30.537 9.83562C30.4222 9.84816 30.249 9.75064 30.1468 9.69735C29.5302 9.37541 28.9378 8.96949 28.3444 8.60587L24.8021 6.43677C24.3481 6.66259 23.2803 7.35989 22.799 7.65553C21.3971 8.52298 19.9892 9.38105 18.5755 10.2297C18.6122 11.1611 18.5799 12.3068 18.5797 13.2515L18.58 19.2449C20.3783 17.9008 22.5416 17.1077 24.7979 16.9655C26.6409 16.8584 28.4849 17.1639 30.1896 17.8588C31.4829 18.3919 32.5254 19.1038 33.6995 19.8398L37.1004 21.9625C40.3248 23.9541 43.5353 25.9676 46.7316 28.0025C47.705 28.6257 48.7277 29.2568 49.6705 29.9196C49.8038 30.0136 49.7576 32.132 49.7576 32.3759L49.7563 36.1225C49.7553 38.5486 49.7586 40.979 49.7582 43.405C49.7582 43.4918 49.7523 43.8195 49.6962 43.8703C49.3573 44.1789 48.8735 44.4666 48.4838 44.7217L46.4781 46.0341L41.7464 49.1324C41.0696 49.5729 40.3977 50.0227 39.7199 50.4619C39.5625 50.5639 39.3464 50.6711 39.218 50.4665C39.1467 50.3527 39.1243 50.2045 39.1127 50.0729C39.0992 49.2139 39.114 48.3536 39.114 47.494L39.1081 45.709C39.1074 45.5388 39.0926 44.659 39.1474 44.5861C39.3856 44.2733 40.7828 43.4479 41.0844 43.2539C42.1912 42.5368 43.302 41.8254 44.4163 41.1202C44.449 38.2872 44.4272 35.377 44.4186 32.5415C42.0975 31.1096 39.8093 29.5387 37.502 28.0821C37.8149 30.7056 37.5746 32.6742 36.4583 35.082C36.2388 35.5242 35.994 35.9535 35.7247 36.3677C34.3288 38.507 32.9425 39.2567 30.8425 40.6057L26.4634 43.4232C22.1698 46.1875 17.8782 48.9601 13.5753 51.7103C13.4314 51.8023 13.1545 51.9868 12.9969 52.0244C12.8937 52.0492 12.7147 51.9759 12.6247 51.9205C11.9422 51.4978 11.258 51.0602 10.5816 50.6292L6.63747 48.1035L2.48422 45.4358C1.77165 44.9804 1.04884 44.532 0.340247 44.072C0.239997 43.9802 0.0426683 43.9119 0.0305592 43.7647C-0.0062054 43.3133 0.00761406 42.8434 0.00735674 42.3907L0.0067122 39.5775L0.0134796 33.899C0.0160529 33.2024 0.0101109 32.5072 0.000911587 31.8109C-0.000965006 31.6671 0.0434144 31.4807 0.134648 31.365C0.304302 31.1495 0.540981 31.3535 0.725023 31.4355C2.23554 32.3775 3.75299 33.3232 5.23953 34.2986C5.29266 34.3333 5.34948 34.4415 5.35295 34.5055C5.37859 35.1414 5.36644 35.7829 5.36585 36.4195L5.36747 40.8189L13.0981 45.7658C13.6992 45.4286 14.3533 45.0141 14.9488 44.6531L18.7505 42.3329C19.3891 41.9432 20.2744 41.3697 20.9254 41.0291C16.04 39.1287 13.0288 34.1683 13.149 29.094C13.1713 28.1533 13.1641 27.2086 13.1638 26.2675L13.1645 18.8069L13.168 11.1211L13.1674 8.65841C13.1672 8.1846 13.1523 7.59151 13.187 7.12639C13.4121 6.89886 14.3467 6.35233 14.6794 6.14674L17.1788 4.59572L22.0575 1.57777C22.8136 1.11169 23.8943 0.408387 24.6561 0ZM32.7084 28.8861C32.4276 24.9017 28.9051 21.8956 24.8427 22.1739C20.7847 22.4519 17.7239 25.9021 18.0041 29.8822C18.2844 33.8624 21.8 36.8676 25.8585 36.5957C29.9212 36.3234 32.9888 32.8709 32.7084 28.8861ZM10.849 8.38867C11.1445 8.36857 11.3019 8.51456 11.2938 8.81083C11.2783 9.37056 11.2804 9.92765 11.2812 10.4875L11.2857 12.9876C11.2862 13.3166 11.3141 14.2566 11.2338 14.5277C11.0548 14.7297 9.10458 15.8843 8.77017 16.0726C7.70298 16.6734 6.43677 17.5341 5.36133 18.0902C5.39472 18.9095 5.36407 19.9453 5.3639 20.7785L5.36648 26.1843C5.51837 26.2531 6.09315 26.6237 6.26557 26.7306C7.77845 25.8852 9.2378 24.8883 10.753 24.0426C11.1039 23.8468 11.2969 24.0745 11.3018 24.4332C11.3099 25.0326 11.2994 25.6366 11.3005 26.2388L11.3031 28.0515C11.3041 29.5463 11.4085 29.2517 10.1159 30.0498L8.10471 31.2905C7.72849 31.5246 6.50607 32.3548 6.13635 32.3868C5.76996 32.2745 0.391039 28.9823 0.0486055 28.6522C-0.0150442 28.4121 0.00500443 27.4908 0.00510092 27.1859L0.00767897 24.5411L0.0067122 18.134C0.00880144 17.3074 -0.00942823 16.4776 0.00993479 15.6514C0.0136618 15.4917 0.00666264 15.1851 0.0772864 15.0449C0.174637 14.855 10.0385 8.81571 10.849 8.38867ZM38.0129 7.53759C38.2755 7.5796 39.3902 8.31746 39.6823 8.4976L42.344 10.1334C44.0114 11.1719 45.6733 12.2189 47.3298 13.2738C48.0208 13.7153 48.7221 14.1454 49.4068 14.5944C49.4979 14.6752 49.7021 14.7596 49.717 14.8857C49.7747 15.3652 49.7563 15.8698 49.7563 16.3519L49.7556 18.902L49.7563 23.7191C49.7569 24.5577 49.7635 25.3974 49.7556 26.2352C49.7427 26.724 49.4048 26.7322 49.0451 26.5121C47.8063 25.7538 46.5949 24.9553 45.3568 24.1957C45.0898 24.0318 44.8028 23.8639 44.5635 23.6604C44.3906 23.5133 44.4246 23.1245 44.4147 22.9183C44.4134 22.5018 44.415 22.089 44.4153 21.6747L44.4137 18.4386L44.4134 17.874C42.2674 16.5298 40.1288 15.1729 37.9993 13.8036L34.2289 16.0726C33.6735 16.4053 33.1217 16.7447 32.5582 17.0635C32.135 17.3029 31.9935 17.1382 31.6288 16.9114C30.4191 16.1591 29.2238 15.3844 28.0131 14.6353C27.7668 14.483 27.6701 14.295 27.7505 14.022C27.9959 13.7774 29.2487 13.0204 29.6498 12.7678L33.4646 10.3589L36.4566 8.46665C36.8279 8.23338 37.6413 7.69734 38.0129 7.53759Z" fill="#F76918"/>
</g>
<defs>
<clipPath id="clip0_383_646">
<rect width="175.328" height="59.3984" fill="white"/>
</clipPath>
</defs>
</svg>`;

export const CATEGORY_ICON: Record<string, string> = {
  "Search & Research": I.search,
  Search: I.search,
  Finance: I.finance,
  Social: I.social,
  Sales: I.sales,
};

/**
 * Try-it-now prompts per server, shown on the success page for what the user
 * actually installed. Each mentions "AIsa" once — enough of an anchor to
 * route the first run to our tools (they are all prefixed aisa-*) without
 * teaching users a scary full-slug incantation; day to day the agent picks
 * AIsa tools on its own and no naming is needed at all.
 */
export const EXAMPLES: Record<string, string[]> = {
  "web-search": [
    "Using AIsa, search the web for this week's biggest AI news and summarize the top 3 results with links.",
    "Using AIsa, research how teams are adopting MCP servers in production and give me a sourced brief.",
  ],
  "twitter-api": [
    "Using AIsa, fetch the latest tweets from @AnthropicAI and summarize the main themes.",
    "Using AIsa, pull @sama's five most recent tweets with their engagement numbers.",
  ],
  "crypto-market-data": [
    "Using AIsa, get Bitcoin's current price and 24h change, then compare it with Ethereum.",
    "Using AIsa's crypto data, list today's trending coins with prices and market caps.",
  ],
  marketpulse: [
    "Using AIsa, pull AAPL's latest income statement and summarize the revenue and margin trend.",
    "Using AIsa's market data, screen for US stocks with a market cap above $1T and compare their P/E ratios.",
  ],
  "stock-pulse": [
    "Using AIsa, show what X/Twitter is saying about NVDA today, joined with its market data.",
    "Using AIsa, find which tickers are trending on X right now and why.",
  ],
  "prediction-market-data": [
    "Using AIsa, list the most active prediction markets right now with their implied probabilities.",
    "Using AIsa, compare what Polymarket and Kalshi imply about the next Fed rate decision.",
  ],
  reddit: [
    "Using AIsa, find today's top posts in r/MachineLearning and summarize the discussion.",
    "Using AIsa, search Reddit for real-world Claude Code workflows people recommend.",
  ],
  "youtube-search": [
    "Using AIsa, find the three most relevant YouTube videos about MCP servers and list their channels.",
    "Using AIsa, find beginner YouTube tutorials for Claude Code and pick the best one to start with.",
  ],
  instagram: [
    "Using AIsa, fetch the Instagram profile and recent posts of @nasa and describe their content strategy.",
    "Using AIsa, compare the recent Instagram engagement of @natgeo and @nasa.",
  ],
  pinterest: [
    "Using AIsa, search Pinterest for 'mid-century interior' and summarize the visual trends.",
    "Using AIsa, find trending home-office ideas on Pinterest and summarize them with links.",
  ],
  apollo: [
    "Using AIsa, enrich the company anthropic.com — size, industry, and key people.",
    "Using AIsa, find five AI infrastructure startups in San Francisco with their CEOs.",
  ],
};

export interface ClientInfo {
  id: string;
  label: string;
  /** cli: its own command writes config · file: we write a JSON file ·
   *  web: nothing to install, the user pastes connector URLs into the site */
  kind: "cli" | "file" | "web";
  detected: boolean;
  detail: string;
}

export const FILE_CLIENT_LABELS: Record<string, string> = {
  cursor: "Cursor",
  "claude-desktop": "Claude Desktop",
  windsurf: "Windsurf",
};

export interface ApplyResult {
  client: string;
  ok: boolean;
  message: string;
}

// ── live run state, served at /status for the page to poll ─────────────────
//
// Every unit of work the page shows is one Step, in the order it will run, so
// the browser can render the whole plan up front — greyed out, then ticking
// over — rather than surprising the user one line at a time. Installing an
// agent takes tens of seconds; a plan that is visible from the start is the
// difference between waiting and wondering.
export type StepState = "pending" | "running" | "ok" | "fail" | "skip";
export interface Step {
  id: string;
  /** Imperative while pending/running ("Install Codex"), so the plan reads as
   *  a list of intentions before anything has happened. */
  label: string;
  state: StepState;
  /** One line under the label: progress, result, or what to do about a
   *  failure. Replaced as the step advances. */
  detail?: string;
}
export type AuthState = "pending" | "authorizing" | "ok" | "fail";
export interface RunState {
  phase: "selecting" | "applying" | "authorizing" | "done" | "failed";
  results: ApplyResult[];
  auth: Record<string, AuthState>; // key: aisa-<slug>
  steps: Step[];
  doneUrl?: string;
  /** In micros USD; null when it could not be read. The done page renders
   *  the number and the top-up nudge from this. */
  balanceMicros?: number | null;
  /** How models were handled — the done page words its guidance from this. */
  llmMode?: LlmMode;
  /** What the run was started with; set at /apply, read by the done tab. */
  selection?: Selection;
  /**
   * The live draft, shared by every surface looking at this run.
   *
   * `selection` is what a run was launched with and never changes after; this
   * is what is currently ticked, before anyone presses go. The page and the
   * terminal both read it from /status and both write it through /select, so
   * a choice made in one appears in the other.
   */
  draft?: Selection;
  /**
   * Bumped on every accepted /select. A writer sends the rev it last saw; a
   * mismatch means someone else moved first, and the writer is handed the
   * current state to redraw from rather than having its stale copy accepted.
   * Last writer wins, but no writer overwrites blind.
   */
  rev?: number;
  /** Which step the surfaces are on, so opening a second one lands in place. */
  currentStep?: number;
  /** Cursor install deeplinks, one per chosen server (T2 only). The config
   *  inside carries the bearer header when a key exists — the page is
   *  local and token-gated, and Cursor shows the config before adding it. */
  deeplinks?: Array<{ slug: string; name: string; url: string }>;
}

/** What to do about models: switch the agent over, add AIsa as a backup
 *  beside the user's own setup, or leave models alone entirely. */
export type LlmMode = "switch" | "backup" | "skip";

/** Small brand marks for the client cards — inline SVG, self-contained. */
export const CLIENT_LOGOS: Record<string, string> = {
  "claude-code": `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="#D97757">${Array.from(
    { length: 8 },
    (_, i) =>
      `<rect x="11" y="1" width="2" height="7.5" rx="1" transform="rotate(${i * 45} 12 12)"/>`
  ).join("")}</g></svg>`,
  codex: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="#0d0d0b" stroke-width="2.1" stroke-linecap="round">${Array.from(
    { length: 6 },
    (_, i) => `<path d="M12 3.4 A8.6 8.6 0 0 1 19.4 7.6" transform="rotate(${i * 60} 12 12)"/>`
  ).join("")}</g></svg>`,
  opencode: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="5" fill="#0d0d0b"/><g fill="#fafafa"><rect x="5" y="8" width="6" height="8"/><rect x="7" y="10" width="2" height="4" fill="#0d0d0b"/><rect x="13" y="8" width="6" height="2"/><rect x="13" y="14" width="6" height="2"/><rect x="13" y="8" width="2" height="8"/></g></svg>`,
};

/** The agents' real first-screen art, so the launch preview looks like what
 *  the button opens: Codex's ASCII face (transcribed from its TUI), Claude
 *  Code's pixel robot, opencode's banner verbatim from --help. */
export const CODEX_FACE = [
  "            __+=++++=+,_",
  "        _=\"\"\\+/;/+\\+;++\"**+_",
  "      ,\\'\\,+*-*\"``  `\"*~*+|,*|,",
  "    _|\"*+____          '*~\\\"|",
  "   ,/_;\\'|\\`\\,.          ^\\.*",
  "  / ,/`   *_ \"|/,         \"\\^*",
  " | ;!`     !\\ \"\\\\         |^|,",
  " ||\\~      _\\ _//!        \\| |",
  " |'\"|     // ,*\"',++_+++++_  |\\~|",
  "  _*|\\  ,|__/~/ !`~_______|| \\/'`",
  "  ' *|\\ +_+/^    \"**^^^^^\" |,\"/",
  "   ',\"\\;.                ,/|\"/",
  "    \\/||+~,           ,++\"/,`",
  "      *,_\"**=^;~_+~;\"-\",;+'",
  "        `*+/~_,,_,,++**\"",
].join("\n");
export const CLAUDE_BOT = [
  "  ▄▄      ▄▄",
  " ████████████",
  " ██ ███ ██ ██",
  " ████████████",
  "  ▀▀  ▀▀  ▀▀",
].join("\n");
// opencode's real banner, verbatim from its --help output.
export const OPENCODE_MARK = [
  "█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█",
  "█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀",
  "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀",
].join("\n");
