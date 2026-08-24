import { execFile, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import chalk from "chalk";
import { success, error, info, hint } from "../utils/display.js";
import { expandHome } from "../utils/file.js";
import { MCP_CONFIGS, MCP_DEFAULT_SLUGS, AISA_PROVIDER_ID } from "../constants.js";
import { getApiKey } from "../config.js";
import { fetchLiveServers, writeClientConfig, stripped, type LiveServer } from "./mcp.js";
import { INSTALLERS, installAgent, isInstalled, supported } from "./install.js";
import {
  writeCodexLLM,
  writeClaudeCodeLLM,
  writeOpencodeLLM,
  writeCodexAisaProfile,
  writeOpencodeAisaBackup,
  defaultModelsFor,
  patchCodexMCPAuth,
  DEFAULT_MODELS,
} from "./llm-config.js";
import { writeClaudeAisaSettings, installWrappers } from "./wrappers.js";
import { mintCliKey } from "./oauth-login.js";
import { formatMicrosUSD } from "./account.js";
import { apiRequest } from "../api.js";

/**
 * `aisa connect` — a one-shot local web page that wires AIsa's MCP servers
 * into the coding agents installed on this machine.
 *
 * The shape is deliberate, learned from studying how others solve "install an
 * MCP from a web page":
 *
 * - A remote page cannot touch the local machine, and Claude Code has no
 *   install deeplink (Cursor and VS Code do). The only bridge that works for
 *   every client is a local process serving a page on 127.0.0.1 — so that is
 *   all this is.
 * - It is a *visitor*, not a resident: pick servers, pick clients, apply,
 *   sign in, exit. No daemon, no terminal takeover, no prompt or skill
 *   injection into the user's agent. The user stays in their own Claude Code.
 * - Sign-in is one OAuth round for everything: with no key stored, the run
 *   starts with the same browser approval `aisa login` uses, which mints the
 *   durable "aisa cli" key (POST /v1/keys/mint). Every MCP entry is then
 *   written as a bearer and the model provider gets the same key — zero
 *   per-server authorization popups. Only if that sign-in fails do we fall
 *   back to each client's own OAuth machinery (`claude mcp login <name>` per
 *   server; `codex mcp add` runs its own flow), which still works but costs
 *   one browser round per server. A key configured beforehand skips the
 *   sign-in entirely.
 * - The page reports the whole journey live (GET /status polling), and a
 *   dedicated success page opens at the end — spawned by this process via
 *   the OS browser command, so no popup blocker is involved — because users
 *   who tabbed away to the authorization rarely come back to the first tab.
 *
 * Page style matches the AIsa Console sign-in (auth.aisa.one, tokens read
 * off the live page 2026-08-20): warm #f9f8f6 dot-grid background, black
 * #0d0d0b top bar, Inter with 800-weight headlines, #e5322d headline red,
 * #cc2b26 CTA red at 6px radius. Capability groups follow the pattern of
 * Sentry's OAuth approval screen: checkbox + name + tool-count badge + a
 * real description of what the capability gives the agent.
 */

const execFileP = promisify(execFile);

/** How long the page may sit untouched before we give up and exit. */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** How long the success page stays served before the process exits. Copy
 *  buttons are client-side, so the page keeps working after exit. */
const LINGER_AFTER_DONE_MS = 5 * 60 * 1000;

// ── brand tokens (auth.aisa.one, read live) ─────────────────────────────────
const RED = "#e5322d";
const RED_CTA = "#cc2b26";
const INK = "#0d0d0b";
const PAPER = "#f9f8f6";

// ── inline icons (lucide, 18px, currentColor — icon-kit) ────────────────────
const I = {
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
const LOGO = `<svg width="76" height="26" role="img" aria-label="AIsa" viewBox="0 0 176 60" fill="none" xmlns="http://www.w3.org/2000/svg">
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

const CATEGORY_ICON: Record<string, string> = {
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
const EXAMPLES: Record<string, string[]> = {
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

interface ClientInfo {
  id: string;
  label: string;
  kind: "cli" | "file";
  detected: boolean;
  detail: string;
}

const FILE_CLIENT_LABELS: Record<string, string> = {
  cursor: "Cursor",
  "claude-desktop": "Claude Desktop",
  windsurf: "Windsurf",
};

export function detectClients(): ClientInfo[] {
  const clients: ClientInfo[] = [];

  // Claude Code: presence means the `claude` binary answers on PATH. Its MCP
  // entries live in user scope managed by the binary itself, not in a config
  // file we own — hence kind "cli".
  const probe = spawnSync("claude", ["--version"], { timeout: 5_000, encoding: "utf8" });
  const claudeVersion = probe.status === 0 ? probe.stdout.trim() : "";
  clients.push({
    id: "claude-code",
    label: "Claude Code",
    kind: "cli",
    detected: probe.status === 0,
    detail: claudeVersion || "claude not found on PATH",
  });

  // Codex keeps its MCP servers in ~/.codex/config.toml, so like Claude Code
  // it is detected by asking the binary rather than by looking for a file we
  // own.
  const codex = spawnSync("codex", ["--version"], { timeout: 5_000, encoding: "utf8" });
  clients.push({
    id: "codex",
    label: "Codex",
    kind: "cli",
    detected: codex.status === 0,
    detail: codex.status === 0 ? codex.stdout.trim() : "codex not found on PATH",
  });

  // opencode: no `mcp add`, no login command — one JSON config file drives
  // everything. Detection stays the same discipline: actually run the binary.
  const oc = spawnSync("opencode", ["--version"], { timeout: 5_000, encoding: "utf8" });
  clients.push({
    id: "opencode",
    label: "opencode",
    kind: "cli",
    detected: oc.status === 0,
    detail: oc.status === 0 ? `opencode ${oc.stdout.trim()}` : "opencode not found on PATH",
  });

  for (const [id, cfg] of Object.entries(MCP_CONFIGS)) {
    // "Installed" here means the client's config directory exists. Coarse,
    // but the false-positive cost is one harmless config file.
    const detected = existsSync(dirname(expandHome(cfg.path)));
    clients.push({
      id,
      label: FILE_CLIENT_LABELS[id] ?? id,
      kind: "file",
      detected,
      detail: cfg.path,
    });
  }

  return clients;
}

/**
 * Configure one server entry in Claude Code's user scope. Remove-then-add
 * because `claude mcp add` refuses to overwrite an existing name; removing a
 * name that is not there fails too, which is exactly why that failure is
 * ignored. The result is idempotent either way.
 */
async function claudeCodeAdd(name: string, endpoint: string, key: string | undefined): Promise<void> {
  await execFileP("claude", ["mcp", "remove", "-s", "user", name], { timeout: 15_000 }).catch(
    () => {}
  );
  const args = ["mcp", "add", "-s", "user", "--transport", "http", name, endpoint];
  if (key) args.push("--header", `Authorization: Bearer ${key}`);
  await execFileP("claude", args, { timeout: 15_000 });
}

/**
 * Add one server to Codex, letting Codex do the authorising.
 *
 * `codex mcp add --url` detects that the endpoint speaks OAuth and starts the
 * flow itself — one command instead of the add-then-login pair Claude Code
 * needs. Writing config.toml directly, as an earlier version did, skips that
 * detection entirely and leaves entries that list as "Not logged in": present,
 * enabled, and 401 on first use.
 *
 * stdio is inherited because the flow prints an authorisation URL and waits.
 */
function codexAdd(name: string, endpoint: string, key: string | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ["mcp", "add", name, "--url", endpoint];
    // Codex takes the *name* of an environment variable, never the token
    // itself — so a key never reaches the process table or a shell history.
    // With one configured we point every server at the same variable; without
    // one, add detects OAuth support and authorises instead.
    if (key) args.push("--bearer-token-env-var", CODEX_KEY_ENV_VAR);
    const child = spawn("codex", args, { stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGTERM"), 180_000);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Drive Claude Code's own OAuth for one server: `claude mcp login` opens the
 * browser authorization and stores the tokens in Claude Code's own store,
 * where Claude Code also refreshes them. stdio is inherited on purpose — the
 * login needs the user's real terminal (it prompts on stdin as a headless
 * fallback), and its progress lines belong in front of the user.
 */
function claudeCodeLogin(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["mcp", "login", name], { stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 180_000);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

interface ApplyResult {
  client: string;
  ok: boolean;
  message: string;
}

async function applySelection(
  clientIds: string[],
  chosen: LiveServer[],
  key: string | undefined,
  dryRun: boolean
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const id of clientIds) {
    if (id === "claude-code") {
      if (dryRun) {
        results.push({ client: id, ok: true, message: `would run claude mcp add for ${chosen.length} servers` });
        continue;
      }
      try {
        for (const s of chosen) {
          await claudeCodeAdd(`aisa-${s.slug}`, s.endpoint, key);
        }
        results.push({
          client: id,
          ok: true,
          message: `${chosen.length} servers added (user scope)${key ? "" : " — browser authorization starts next"}`,
        });
      } catch (e) {
        results.push({ client: id, ok: false, message: (e as Error).message });
      }
    } else if (id === "codex") {
      if (dryRun) {
        results.push({ client: id, ok: true, message: `would run codex mcp add for ${chosen.length} servers` });
        continue;
      }
      let added = 0;
      for (const s of chosen) {
        const name = `aisa-${s.slug}`;
        // Remove first: codex mcp add refuses an existing name, and removing
        // one that is absent is a no-op we do not care about either way.
        await execFileP("codex", ["mcp", "remove", name], { timeout: 15_000 }).catch(() => {});
        if (!(await codexAdd(name, s.endpoint, key))) continue;
        // The add stored only the env-var NAME; swap it for the literal
        // header so the entry works in every terminal, exported or not.
        if (key && !patchCodexMCPAuth(name, key).ok) continue;
        added++;
      }
      results.push(
        added === chosen.length
          ? {
              client: id,
              ok: true,
              message: key
                ? `${added} servers added with your key`
                : `${added} servers added and authorized`,
            }
          : { client: id, ok: false, message: `only ${added} of ${chosen.length} servers were added` }
      );
    } else if (id === "opencode") {
      // The official command (1.18+): non-interactive, idempotent on the
      // name, writes opencode.jsonc in the exact schema shape. Same doctrine
      // as the other CLI agents — never hand-write what the vendor's own
      // command can write.
      if (dryRun) {
        results.push({ client: id, ok: true, message: `would run opencode mcp add for ${chosen.length} servers` });
        continue;
      }
      let added = 0;
      for (const s of chosen) {
        const args = ["mcp", "add", `aisa-${s.slug}`, "--url", s.endpoint];
        if (key) args.push("--header", `Authorization=Bearer ${key}`);
        try {
          await execFileP("opencode", args, { timeout: 30_000 });
          added++;
        } catch {
          /* counted below */
        }
      }
      results.push(
        added === chosen.length
          ? {
              client: id,
              ok: true,
              message: key
                ? `${added} servers added with your key`
                : `${added} servers added — opencode runs its own OAuth on first start`,
            }
          : { client: id, ok: false, message: `only ${added} of ${chosen.length} servers were added` }
      );
    } else if (MCP_CONFIGS[id]) {
      if (dryRun) {
        results.push({ client: id, ok: true, message: `would write ${chosen.length + 1} entries to ${MCP_CONFIGS[id].path}` });
        continue;
      }
      const r = writeClientConfig(id, chosen, key);
      results.push(
        r.ok
          ? { client: id, ok: true, message: `${r.written} servers → ${MCP_CONFIGS[id].path}` }
          : { client: id, ok: false, message: r.reason }
      );
    } else {
      results.push({ client: id, ok: false, message: "unknown client" });
    }
  }
  return results;
}

// ── live run state, served at /status for the page to poll ─────────────────
//
// Every unit of work the page shows is one Step, in the order it will run, so
// the browser can render the whole plan up front — greyed out, then ticking
// over — rather than surprising the user one line at a time. Installing an
// agent takes tens of seconds; a plan that is visible from the start is the
// difference between waiting and wondering.
type StepState = "pending" | "running" | "ok" | "fail" | "skip";
interface Step {
  id: string;
  /** Imperative while pending/running ("Install Codex"), so the plan reads as
   *  a list of intentions before anything has happened. */
  label: string;
  state: StepState;
  /** One line under the label: progress, result, or what to do about a
   *  failure. Replaced as the step advances. */
  detail?: string;
}
type AuthState = "pending" | "authorizing" | "ok" | "fail";
interface RunState {
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
}

/** Long enough to read one sentence before the screen changes under you.
 *  Every handoff to the browser or to a slow command gets one. */
const BEFORE_HANDOFF_MS = 3000;

/** Passed to `codex mcp add --bearer-token-env-var` so the add does not start
 *  its own OAuth flow; the entry is then patched to carry the literal header
 *  (see applySelection), because nothing guarantees a shell exports this.
 *  Matches the CLI's own variable so an exported key also just works. */
const CODEX_KEY_ENV_VAR = "AISA_API_KEY";

/** The manual fallback when the inline sign-in cannot mint a key. */
const CONSOLE_KEYS_URL = "https://console.aisa.one/api-keys";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mutate one step in place; the page picks it up on its next poll. */
function setStep(state: RunState, id: string, patch: Partial<Step>): void {
  const step = state.steps.find((s) => s.id === id);
  if (step) Object.assign(step, patch);
}

/** What to do about models: switch the agent over, add AIsa as a backup
 *  beside the user's own setup, or leave models alone entirely. */
type LlmMode = "switch" | "backup" | "skip";

interface PlanInput {
  install: string[];
  clients: string[];
  servers: LiveServer[];
  keyed: boolean;
  dryRun: boolean;
  llmMode: LlmMode;
}

/**
 * The plan the page renders before anything runs.
 *
 * Order matters and mirrors what a person would do by hand: get the agent on
 * the machine, prove who you are, see whether you can pay for anything, then
 * wire the capabilities up. A later step that depends on an earlier one is
 * marked skipped rather than failed when its prerequisite did not happen —
 * "skipped" is information, "failed" is alarm.
 */
function buildPlan(input: PlanInput): Step[] {
  const steps: Step[] = [];
  for (const id of input.install) {
    const label = INSTALLERS[id]?.label ?? id;
    steps.push({
      id: `install:${id}`,
      label: `Install ${label}`,
      state: "pending",
      detail: INSTALLERS[id]?.command,
    });
  }
  // The aisa command itself, so the npx visitor leaves with the full
  // toolbox (balance, topup, login/key rotation) — shown as its own step,
  // never a silent side effect. Skipped when already installed.
  if (!input.dryRun && !isInstalled("aisa")) {
    steps.push({
      id: "install:aisa-cli",
      label: "Install the AIsa CLI",
      state: "pending",
      detail: "npm install -g @aisa-one/cli — the aisa command for balance, top-up and key rotation",
    });
  }
  // One sign-in, before anything that wants a credential: the browser
  // approval mints the durable CLI key, and with it every MCP entry is a
  // bearer and the model provider can be written — no per-server popups.
  // If it fails at run time the per-server OAuth rounds come back as a
  // fallback (added to the plan then, not promised now).
  if (!input.keyed && !input.dryRun) {
    steps.push({
      id: "signin",
      label: "Sign in to AIsa",
      state: "pending",
      detail: "one browser approval — it mints your CLI key",
    });
  }
  steps.push({
    id: "mcp",
    label: `Add ${input.servers.length} MCP server${input.servers.length === 1 ? "" : "s"}`,
    state: "pending",
    detail: input.clients.join(", "),
  });
  if (input.llmMode === "switch") {
    steps.push({
      id: "llm",
      label: "Point its models at AIsa",
      state: "pending",
      detail: "writes the agent's own provider settings; reversible",
    });
  } else if (input.llmMode === "backup") {
    const target = input.clients[0];
    steps.push({
      id: "llm-backup",
      label:
        target === "claude-code"
          ? "Install the claude-aisa command"
          : target === "codex"
            ? "Add the aisa profile and codex-aisa command"
            : "Add AIsa as a backup provider",
      state: "pending",
      detail: "your current models and settings stay untouched",
    });
  }
  steps.push({
    id: "balance",
    label: "Check your AIsa balance",
    state: "pending",
    detail: "so an empty account is not a surprise at the first call",
  });
  return steps;
}

interface RunInput {
  install: string[];
  clients: string[];
  servers: LiveServer[];
  key: string | undefined;
  dryRun: boolean;
  llmMode: LlmMode;
}

/**
 * Run the plan, updating state as each step settles. Returns how many failed.
 *
 * Nothing here throws: one broken step must not cost the user the rest of the
 * run, so every failure is recorded on its own row and the plan continues.
 */
async function runPlan(state: RunState, input: RunInput): Promise<number> {
  let failures = 0;
  const fail = (id: string, detail: string) => {
    failures++;
    setStep(state, id, { state: "fail", detail });
    console.log(`  ${chalk.red("✗")} ${id}: ${detail}`);
  };
  const ok = (id: string, detail: string) => {
    setStep(state, id, { state: "ok", detail });
    console.log(`  ${chalk.green("✓")} ${id}: ${detail}`);
  };

  // ── install ──
  for (const id of input.install) {
    const stepId = `install:${id}`;
    const label = INSTALLERS[id]?.label ?? id;
    setStep(state, stepId, {
      state: "running",
      detail: `about to run ${INSTALLERS[id]?.command}`,
    });
    info(`Installing ${label}…`);
    await pause(BEFORE_HANDOFF_MS);
    setStep(state, stepId, {
      state: "running",
      detail: `installing — this usually takes under a minute`,
    });
    if (input.dryRun) {
      ok(stepId, "dry run — nothing installed");
      continue;
    }
    const outcome = await installAgent(id);
    if (outcome.ok) {
      ok(stepId, outcome.alreadyInstalled ? "already installed" : "installed");
    } else {
      // Not a hard failure: the user can run the command themselves and the
      // rest of the plan still applies to whatever they already have.
      setStep(state, stepId, {
        state: "fail",
        detail: `${outcome.detail} — run: ${outcome.command}`,
      });
      failures++;
      error(`${label}: ${outcome.detail}`);
      hint(`Run this yourself, then re-run connect: ${outcome.command}`);
    }
  }

  // ── the CLI itself, so the npx visitor keeps the toolbox ──
  if (state.steps.some((s) => s.id === "install:aisa-cli")) {
    setStep(state, "install:aisa-cli", { state: "running", detail: "npm install -g @aisa-one/cli" });
    const outcome = await installAgent("aisa-cli");
    if (outcome.ok) {
      ok("install:aisa-cli", outcome.alreadyInstalled ? "already installed" : "installed — try `aisa balance` anytime");
    } else {
      // Not fatal: everything else still applies; the user just keeps npx.
      failures++;
      setStep(state, "install:aisa-cli", {
        state: "fail",
        detail: `${outcome.detail} — run: ${outcome.command}`,
      });
    }
  }

  // ── sign in once, before anything that wants a credential ──
  let key = input.key;
  if (state.steps.some((s) => s.id === "signin")) {
    setStep(state, "signin", {
      state: "running",
      detail: "your browser will open — approve the sign-in there…",
    });
    info("Signing you in to AIsa…");
    await pause(BEFORE_HANDOFF_MS);
    setStep(state, "signin", {
      state: "running",
      detail: "waiting for you to approve it in the browser tab",
    });
    try {
      key = await mintCliKey({ open: true });
      ok("signin", "signed in — your CLI key is stored");
    } catch (e) {
      // Not fatal: the per-server OAuth path still works, it is just one
      // browser round per server instead of none.
      failures++;
      setStep(state, "signin", {
        state: "fail",
        detail: `${(e as Error).message} — continuing without a key; retry later with 'aisa login'`,
      });
      error(`Sign-in failed: ${(e as Error).message}`);
      if (input.clients.includes("claude-code")) {
        // Claude Code separates add from login, so give the plan its
        // authorization rounds back, in front of the balance step.
        const at = state.steps.findIndex((s) => s.id === "balance");
        const authSteps: Step[] = input.servers.map((s) => ({
          id: `auth:${s.slug}`,
          label: `Authorize aisa-${s.slug}`,
          state: "pending",
          detail: "opens the AIsa sign-in in your browser",
        }));
        state.steps.splice(at === -1 ? state.steps.length : at, 0, ...authSteps);
      }
    }
  }

  // ── MCP entries ──
  const willAuthorize = !key && input.clients[0] === "codex";
  setStep(state, "mcp", {
    state: "running",
    detail: willAuthorize
      ? "adding each server — your browser will open to authorize them"
      : "writing client configuration",
  });
  if (willAuthorize) await pause(BEFORE_HANDOFF_MS);
  const results = await applySelection(input.clients, input.servers, key, input.dryRun);
  state.results = results;
  for (const r of results) {
    console.log(`  ${r.ok ? chalk.green("✓") : chalk.red("✗")} ${r.client}: ${r.message}`);
  }
  const mcpOk = results.length > 0 && results.every((r) => r.ok);
  if (mcpOk) {
    setStep(state, "mcp", { state: "ok", detail: results.map((r) => r.client).join(", ") });
  } else {
    failures++;
    setStep(state, "mcp", {
      state: "fail",
      detail: results.filter((r) => !r.ok).map((r) => `${r.client}: ${r.message}`).join("; "),
    });
  }

  // ── LLM backup: AIsa beside the user's own setup, nothing switched ──
  if (state.steps.some((s) => s.id === "llm-backup")) {
    const target = input.clients[0];
    setStep(state, "llm-backup", { state: "running", detail: "adding AIsa without touching your setup" });
    if (input.dryRun) {
      ok("llm-backup", "dry run — nothing written");
    } else if (!key) {
      setStep(state, "llm-backup", { state: "skip", detail: "needs a key — run 'aisa login', then 'aisa connect' again" });
    } else if (target === "claude-code") {
      writeClaudeAisaSettings(key, DEFAULT_MODELS);
      const w = installWrappers(["claude-aisa"]);
      if (w.ok) {
        ok("llm-backup", `claude-aisa → ${w.dir}${w.pathHint ? " (add it to PATH: " + w.pathHint + ")" : ""}`);
      } else fail("llm-backup", `could not write the wrapper into ${w.dir}`);
    } else if (target === "codex") {
      const r = writeCodexAisaProfile(key);
      const w = r.ok ? installWrappers(["codex-aisa"]) : { ok: false as const, dir: "", wrote: [] };
      if (r.ok && w.ok) {
        ok("llm-backup", `codex-aisa → ${w.dir}${"pathHint" in w && w.pathHint ? " (add it to PATH: " + w.pathHint + ")" : ""}`);
      } else fail("llm-backup", r.ok ? `could not write the wrapper` : r.reason);
    } else if (target === "opencode") {
      const r = writeOpencodeAisaBackup(key);
      if (r.ok) ok("llm-backup", `aisa provider added — pick aisa/${DEFAULT_MODELS.model} in opencode`);
      else fail("llm-backup", r.reason);
    } else {
      setStep(state, "llm-backup", { state: "skip", detail: "not available for this client" });
    }
  }

  // ── LLM provider ──
  if (state.steps.some((s) => s.id === "llm")) {
    setStep(state, "llm", { state: "running", detail: "writing provider settings" });
    if (input.dryRun) {
      ok("llm", "dry run — nothing written");
    } else if (!key) {
      // Only reachable when the sign-in above failed (or was declined): the
      // normal path mints a key before this step runs. A provider entry has
      // nowhere to put an OAuth token, so without a key the fallback is the
      // console page that hands them out, with exact instructions.
      setStep(state, "llm", {
        state: "running",
        detail: "opening console.aisa.one/api-keys — copy a key from there…",
      });
      await pause(BEFORE_HANDOFF_MS);
      openBrowser(CONSOLE_KEYS_URL);
      setStep(state, "llm", {
        state: "skip",
        detail:
          "waiting on a key — run 'aisa login --key <key>' with the one you just copied, then 'aisa connect' again",
      });
      error("No API key yet, so the model provider was not written.");
      hint(`Copy a key from ${CONSOLE_KEYS_URL}`);
      hint("Then: aisa login --key <key>   and run connect again");
    } else {
      const target = input.clients[0];
      const models = defaultModelsFor(target);
      const res =
        target === "codex"
          ? writeCodexLLM(key, models)
          : target === "opencode"
            ? writeOpencodeLLM(key, models)
            : writeClaudeCodeLLM(key, models);
      if (res.ok) {
        ok("llm", `${models.model} via ${res.path}`);
        if (target === "codex") {
          // A freshly installed Codex offers to sign in to OpenAI on first
          // run. Nothing here needs that account, and picking one of those
          // options sends the user down a path that ignores this config.
          hint("Start it with 'codex' in a new terminal — skip any OpenAI sign-in prompt, it is not needed");
        } else {
          hint("Start it with 'claude' in a new terminal to pick up the new models");
        }
      } else fail("llm", res.reason);
    }
  }

  // ── authorization, one browser round per server ──
  const authSteps = state.steps.filter((s) => s.id.startsWith("auth:"));
  if (authSteps.length > 0) {
    if (!mcpOk) {
      for (const step of authSteps) {
        setStep(state, step.id, { state: "skip", detail: "the entries were not added" });
      }
    } else {
      state.phase = "authorizing";
      info("Starting browser authorization for each server…");
      for (const step of authSteps) {
        const slug = step.id.slice("auth:".length);
        const name = `aisa-${slug}`;
        // Say what is about to happen, then pause long enough to read it.
        // A browser tab that appears with no warning reads as something going
        // wrong; a sentence and a beat make it an expected step.
        setStep(state, step.id, {
          state: "running",
          detail: "opening the AIsa sign-in in your browser — approve it there…",
        });
        await pause(BEFORE_HANDOFF_MS);
        setStep(state, step.id, {
          state: "running",
          detail: "waiting for you to approve it in the browser tab",
        });
        state.auth[name] = "authorizing";
        const authorized = await claudeCodeLogin(name);
        state.auth[name] = authorized ? "ok" : "fail";
        if (authorized) ok(step.id, "authorized");
        else fail(step.id, `not authorized — retry with: claude mcp login ${name}`);
      }
    }
  }

  // ── balance, the last thing before the success page ──
  setStep(state, "balance", { state: "running", detail: "reading your account" });
  const balance = await readBalance(key);
  state.balanceMicros = balance;
  if (balance === null) {
    // Not a failure: an unknown balance costs nothing.
    setStep(state, "balance", {
      state: "skip",
      detail: key
        ? "could not read the balance right now"
        : "needs a key — run 'aisa login', then 'aisa balance'",
    });
  } else if (balance <= 0) {
    setStep(state, "balance", {
      state: "ok",
      detail: "no credit yet — add some with 'aisa topup' before your first call",
    });
    hint("No credit yet — run 'aisa topup' to add some");
  } else {
    setStep(state, "balance", { state: "ok", detail: `${formatMicrosUSD(balance)} available` });
  }

  return failures;
}

/** Account balance in micros, or null when it cannot be read. */
async function readBalance(key: string | undefined): Promise<number | null> {
  if (!key) return null;
  try {
    const res = await apiRequest<{ account_balance_micros_usd: number }>(key, "credits/balance");
    if (!res.success || !res.data) return null;
    return Number(res.data.account_balance_micros_usd);
  } catch {
    return null;
  }
}

// ── shared page shell (brand: auth.aisa.one) ────────────────────────────────
function shell(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --paper: ${PAPER}; --ink: #1c1b1a; --muted: #6d6a66; --line: #e7e4df;
    --card: #ffffff; --red: ${RED}; --red-cta: ${RED_CTA}; --bar: ${INK};
    --tint: #fdf1ef; --ok: #2e7d43;
  }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #141312; --ink: #f0eeeb; --muted: #9b9792; --line: #2c2a27;
            --card: #1d1c1a; --tint: #2a1917; --ok: #57b06f; }
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--paper); color: var(--ink);
    font: 16px/1.6 Inter, "Inter Fallback", "PingFang SC", ui-sans-serif, system-ui, sans-serif;
    background-image: radial-gradient(color-mix(in srgb, var(--muted) 22%, transparent) 1px, transparent 1px);
    background-size: 22px 22px; }
  .bar { background: var(--bar); color: #fff; display: flex; align-items: center;
    gap: .55rem; padding: .8rem 1.4rem; font-weight: 600; }
  .bar .tag { margin-left: .4rem; font-weight: 400; opacity: .55; font-size: .85rem; }
  .bar .local { margin-left: auto; font-weight: 400; font-size: .78rem; opacity: .5; }
  main { padding: 1.7rem 12% 4rem; }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 552px; gap: 2.6rem;
    align-items: start; margin-top: 1rem; }
  .rail { position: sticky; top: 1.4rem; }
  .rail h2:first-child { margin-top: .4rem; }
  @media (max-width: 1180px) {
    main { padding: 2.4rem 6% 4rem; }
    .cols { grid-template-columns: 1fr; }
    .rail { position: static; }
  }
  .eyebrow { display: flex; align-items: center; gap: .55rem; color: var(--muted);
    font-size: .74rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
  .eyebrow::before { content: ""; width: 26px; height: 3px; background: var(--red); }
  h1 { font-size: 2.05rem; font-weight: 800; letter-spacing: -.02em; margin: .4rem 0 .35rem; }
  h1 em { font-style: normal; color: var(--red); }
  .lede { color: var(--muted); max-width: none; font-size: .98rem; }
  h2 { display: flex; align-items: center; gap: .55rem; font-size: 1.08rem; font-weight: 700;
    margin: 2rem 0 .9rem; }
  h2 .n { display: inline-flex; align-items: center; justify-content: center; width: 24px;
    height: 24px; border-radius: 50%; background: var(--red); color: #fff; font-size: .8rem; }
  .cat { display: flex; align-items: center; gap: .45rem; color: var(--muted);
    font-size: .8rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
    margin: 1.2rem 0 .5rem; }
  .cat svg { width: 15px; height: 15px; }
  .card { display: flex; gap: .9rem; align-items: flex-start; background: var(--card);
    border: 1px solid var(--line); border-left: 3px solid var(--line); border-radius: 8px;
    padding: 1rem 1.1rem; margin-bottom: .6rem; cursor: pointer; transition: border-color .15s; }
  .card:hover { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); }
  .card.on { border-left-color: var(--red); background: color-mix(in srgb, var(--tint) 55%, var(--card)); }
  .card.off { opacity: .55; cursor: default; }
  .card input { width: 20px; height: 20px; margin-top: .2rem; accent-color: var(--red-cta); flex: none; }
  .card .body { min-width: 0; }
  .card .head { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
  .card .name { font-weight: 700; }
  .clogo { display: inline-flex; align-items: center; margin-right: .55rem; flex: none; }
  .clogo svg { display: block; }
  .badge { font-size: .74rem; font-weight: 700; padding: .18rem .62rem; border-radius: 99px;
    border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
  .badge.ok { background: var(--ok); border-color: var(--ok); color: #fff; }
  .badge.todo { background: #f59e0b; border-color: #f59e0b; color: #fff; }
  /* The no-model warning: the one place on the page allowed to shout. A
     freshly installed agent with no backend is a broken first-run. */
  .modelwarn { margin-top: .7rem; border: 2px solid #f59e0b; border-radius: 10px;
    background: color-mix(in srgb, #f59e0b 12%, var(--card)); padding: .9rem 1rem; }
  .modelwarn .mw-head { font-weight: 800; font-size: 1rem; color: color-mix(in srgb, #b45309 60%, var(--ink));
    margin-bottom: .35rem; }
  .modelwarn .mw-body { font-size: .92rem; color: color-mix(in srgb, #92400e 45%, var(--ink)); line-height: 1.5; }
  .modelwarn .mw-fix { margin-top: .7rem; background: var(--cta); color: #fff;
    border: 0; border-radius: 6px; padding: .55rem 1.3rem; font-weight: 700;
    font-size: .95rem; cursor: pointer; }
  .modelwarn .mw-fix:hover { filter: brightness(1.08); }
  @keyframes mwshake { 0%,100% { transform: translateX(0); }
    25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
  /* The loud state a card jumps to the moment its install step succeeds. */
  .badge.installed { background: var(--ok); border-color: var(--ok); color: #fff; }
  .card.freshly-installed { border-color: var(--ok);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
  .card .brief { color: var(--muted); font-size: .93rem; }
  .card .desc { color: var(--muted); font-size: .93rem; margin-top: .25rem;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .card.open .desc { display: block; -webkit-line-clamp: unset; }
  .card .more { display: inline-block; margin-top: .15rem; color: var(--red); font-weight: 600;
    font-size: .82rem; cursor: pointer; }
  .chips { color: var(--muted); font-size: .82rem; margin: .2rem 0 .4rem; line-height: 1.9; }
  .chips b { color: var(--ink); font-weight: 600; }
  .authnote { display: flex; gap: .7rem; align-items: flex-start; background: var(--card);
    border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.1rem; color: var(--muted);
    font-size: .93rem; }
  .authnote svg { flex: none; margin-top: .1rem; color: var(--red); }
  .authnote b { color: var(--ink); }
  .cta { display: flex; width: 100%; align-items: center; justify-content: center; gap: .6rem;
    margin-top: 1.6rem; background: var(--red-cta); color: #fff; border: none; border-radius: 6px;
    font: inherit; font-weight: 600; font-size: 1.12rem; padding: .95rem 2.2rem; cursor: pointer; }
  .cta:hover { background: color-mix(in srgb, var(--red-cta) 88%, black); }
  .cta:disabled { opacity: .55; cursor: default; }
  a.cta { text-decoration: none; margin-top: .9rem; }
  .fine { color: var(--muted); font-size: .84rem; margin-top: .8rem; }
  #progress { margin-top: 1.6rem; display: none; }
  .step { display: flex; align-items: flex-start; gap: .7rem; padding: .6rem .2rem;
    border-bottom: 1px dashed var(--line); font-size: .95rem;
    opacity: .5; transition: opacity .3s; }
  .step.running, .step.ok, .step.fail { opacity: 1; }
  .step .body { min-width: 0; }
  .step .lbl { display: block; font-weight: 500; }
  .step .det { display: block; color: var(--muted); font-size: .84rem; margin-top: .15rem; }
  .step .st { margin-left: auto; font-size: .8rem; font-weight: 600; color: var(--muted);
    white-space: nowrap; padding-left: .6rem; }
  .step.ok .st { color: var(--ok); } .step.fail .st { color: var(--red); }
  /* The marker carries the state: an empty ring waiting, a spinner working,
     a tick or cross when settled. Position is fixed so rows never jump. */
  .step .mark { flex: none; width: 16px; height: 16px; margin-top: .15rem;
    border-radius: 50%; border: 2px solid var(--line); display: flex;
    align-items: center; justify-content: center; font-size: 11px; font-weight: 700;
    color: #fff; transition: background .25s, border-color .25s; }
  .step.running .mark { border-color: var(--red); border-top-color: transparent;
    animation: r .8s linear infinite; }
  .step.ok .mark { background: var(--ok); border-color: var(--ok); }
  .step.ok .mark::after { content: "\\2713"; }
  .step.fail .mark { background: var(--red); border-color: var(--red); }
  .step.fail .mark::after { content: "\\2715"; }
  .step.skip .mark { border-style: dotted; }
  .spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--line);
    border-top-color: var(--red); border-radius: 50%; animation: r 1s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  /* Overall progress: one bar so a long run reads at a glance. */
  .bar-wrap { height: 4px; background: var(--line); border-radius: 99px; overflow: hidden;
    margin: .9rem 0 .3rem; }
  .bar-fill { height: 100%; width: 0; background: var(--red); border-radius: 99px;
    transition: width .4s ease; }
  .bar-note { color: var(--muted); font-size: .8rem; }
  .bigcheck { width: 64px; height: 64px; border-radius: 50%; background: var(--red);
    color: #fff; display: flex; align-items: center; justify-content: center; margin-bottom: 1.2rem; }
  .bigcheck svg { width: 34px; height: 34px; }
  .examples { display: grid; grid-template-columns: 1fr; gap: .8rem; max-width: 62rem; }
  .example { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
    padding: 1rem 1.1rem; display: flex; gap: .9rem; align-items: flex-start; }
  .example .txt { font-size: .95rem; }
  .example .srv { color: var(--red); font-weight: 600; font-size: .74rem; letter-spacing: .06em;
    text-transform: uppercase; display: block; margin-bottom: .25rem; }
  .example button { margin-left: auto; flex: none; display: inline-flex; align-items: center;
    gap: .35rem; font: inherit; font-size: .8rem; font-weight: 600; color: var(--ink);
    background: transparent; border: 1px solid var(--line); border-radius: 6px;
    padding: .35rem .7rem; cursor: pointer; }
  .example button:hover { border-color: var(--red); color: var(--red); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em;
    background: color-mix(in srgb, var(--muted) 12%, transparent); padding: .1em .35em;
    border-radius: 4px; }
</style></head><body>
<div class="bar">${LOGO}
<span class="tag">MCP Connect</span><span class="local">local · 127.0.0.1</span></div>
<main>${body}</main>
</body></html>`;
}

// ── page A: selection + live progress ───────────────────────────────────────

/** Small brand marks for the client cards — inline SVG, self-contained. */
const CLIENT_LOGOS: Record<string, string> = {
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

function renderPage(
  servers: LiveServer[],
  clients: ClientInfo[],
  token: string,
  keyed: boolean,
  canInstall: boolean
): string {
  const byCategory = new Map<string, LiveServer[]>();
  for (const s of servers) {
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }
  const serverGroups = [...byCategory.entries()]
    .map(([cat, list]) => {
      const rows = list
        .map((s) => {
          const checked = MCP_DEFAULT_SLUGS.includes(s.slug) ? "checked" : "";
          // The full manifest description, CSS-clamped to two lines; "more"
          // expands it and is hidden by the page script when the text already
          // fits — so short cards carry no dead link and long ones stay tidy.
          return `<label class="card ${checked ? "on" : ""}" data-kind="server">
  <input type="checkbox" name="server" value="${s.slug}" ${checked}>
  <span class="body"><span class="head"><span class="name">${stripped(s.name)}</span>
    <span class="badge">${s.toolCount} tools</span></span>
    <span class="desc">${s.description}</span>
    <span class="more" data-more>more</span></span></label>`;
        })
        .join("\n");
      return `<div class="cat">${CATEGORY_ICON[cat] ?? I.sparkles}${cat}</div>\n${rows}`;
    })
    .join("\n");

  const usable = clients.filter((c) => c.detected);
  const installable = clients.filter((c) => !c.detected && INSTALLERS[c.id] && canInstall);
  const rest = clients.filter(
    (c) => !c.detected && !installable.some((i) => i.id === c.id)
  );
  // One target per run, on purpose. Each client has its own install, config
  // format and authorisation dance; doing several at once turns one failure
  // into a puzzle about which of them failed and what state the rest are in.
  const clientRows =
    usable
      .map(
        (c, i) => `<label class="card${i === 0 ? " on" : ""}" data-kind="client">
  <input type="radio" name="client" value="${c.id}"${i === 0 ? " checked" : ""}>
  <span class="body"><span class="head">${CLIENT_LOGOS[c.id] ? `<span class="clogo">${CLIENT_LOGOS[c.id]}</span>` : ""}<span class="name">${c.label}</span>
    <span class="badge ok">✓ detected</span></span>
    <span class="brief">${c.detail}</span></span></label>`
      )
      .join("\n") +
    installable
      .map(
        (c) => `<label class="card" data-kind="client" data-cid="${c.id}">
  <input type="radio" name="client" value="${c.id}" data-install="1">
  <span class="body"><span class="head">${CLIENT_LOGOS[c.id] ? `<span class="clogo">${CLIENT_LOGOS[c.id]}</span>` : ""}<span class="name">${c.label}</span>
    <span class="badge todo" data-badge>not installed</span></span>
    <span class="brief" data-brief>Install <b>and</b> connect it \u2014 <code>${INSTALLERS[c.id].command}</code></span></span></label>`
      )
      .join("\n") +
    (rest.length
      ? `<div class="chips">${rest.map((c) => `${c.label} <i>· not found</i>`).join(" &nbsp;&nbsp; ")}</div>`
      : "");

  const totalTools = servers.reduce((n, s) => n + s.toolCount, 0);
  // Named per client so the page can say which model a pick actually gets.
  const modelByClient = Object.fromEntries(
    clients.map((c) => [c.id, defaultModelsFor(c.id).model])
  );
  const authCopy = keyed
    ? `Your configured AIsa API key is written into each entry — <b>no sign-in needed</b>.`
    : `<b>One sign-in, nothing to paste.</b> Your browser opens the AIsa approval
       <b>once</b>; it issues a long-lived key for this machine, and every server
       and model below is configured with it — no further popups.`;

  const body = `
<div class="eyebrow">Connect</div>
<h1><em>AIsa MCP</em> — powerful real-world reach for your agent</h1>
<p class="lede">One connection puts <b>${totalTools} live tools</b> — web search &amp; research,
X/Twitter, Reddit, Instagram, stocks, crypto, prediction markets and B2B data — inside the
coding agent you already use. Pick what you need, press Connect, approve in the browser. Done.</p>

<div class="cols">
<div class="left">
<h2><span class="n">1</span>Choose capabilities</h2>
${serverGroups}
</div>

<aside class="rail">
<h2><span class="n">2</span>Install into</h2>
${clientRows}

<button class="cta" id="apply">Connect ${I.arrow}</button>

<h2 style="margin-top:1.6rem"><span class="n">3</span>Models</h2>
<label class="card" data-kind="llm" id="llmcard">
  <input type="checkbox" id="llm">
  <span class="body"><span class="head"><span class="name">Run it on AIsa models</span></span>
    <span class="brief" id="llmbrief">Points the agent's model traffic at AIsa.
    Reversible \u2014 it writes the agent's own provider settings and nothing else.</span></span></label>

<div id="backupmodes" style="display:none">
<label class="card on" data-kind="lmode">
  <input type="radio" name="lmode" value="backup" checked>
  <span class="body"><span class="head"><span class="name">Add AIsa as a backup — recommended</span></span>
  <span class="brief" id="backupbrief"></span></span></label>
<label class="card" data-kind="lmode">
  <input type="radio" name="lmode" value="switch">
  <span class="body"><span class="head"><span class="name">Switch its models to AIsa</span></span>
  <span class="brief">Points this agent's model traffic at AIsa. Reversible — it writes the
  agent's own provider settings and nothing else.</span></span></label>
<label class="card" data-kind="lmode">
  <input type="radio" name="lmode" value="skip">
  <span class="body"><span class="head"><span class="name">Not now</span></span>
  <span class="brief">Leave models exactly as they are.</span></span></label>
</div>

<div id="modelwarn" class="modelwarn" style="display:none">
  <div class="mw-head">\u26a0\ufe0e Installing without a model backend</div>
  <div class="mw-body">A fresh install <b>cannot answer a single prompt</b> until you
  configure a model provider by hand. Turn on AIsa models and it leaves here ready to
  work: <b>Claude, GPT, Gemini, DeepSeek, Kimi, GLM</b> and the rest, one key,
  prices well below going direct.</div>
  <button type="button" class="mw-fix" id="modelfix">Use AIsa models \u2192</button>
</div>

<h2 style="margin-top:1.6rem"><span class="n">4</span>Authorize</h2>
<div class="authnote">${I.shield}<div>${authCopy}</div></div>
<p class="fine">Served by the local <code>aisa connect</code> process — nothing leaves your
machine except the OAuth you approve. The process exits when everything is connected.</p>

<div id="progress"></div>
<div id="result" class="fine"></div>
</aside>
</div>

<script>
(function () {
  var TOKEN = ${JSON.stringify(token)};
  var btn = document.getElementById("apply");
  var ARROW = btn.innerHTML.replace(/^[^<]*/, "");
  var progress = document.getElementById("progress");
  var result = document.getElementById("result");

  // The button says what pressing it will do: installing is slower and more
  // invasive than writing config, so it should never be a surprise.
  var llmBox = document.getElementById("llm");
  var llmBrief = document.getElementById("llmbrief");
  var LLM_BRIEF = llmBrief.innerHTML;
  var lastClient = null;
  var MODEL_FOR = ${JSON.stringify(modelByClient)};

  function syncButton() {
    if (btn.disabled) return;
    var chosen = document.querySelector('input[name="client"]:checked');
    var installing = chosen && chosen.dataset.install === "1";
    btn.innerHTML = (installing ? "Install &amp; connect " : "Connect ") + ARROW;

    // An agent being installed right now has no model backend at all, so this
    // is on by default there and off for one already in use — changing a
    // working setup should be the user's decision, not ours. Only re-applied
    // when the target changes, so a deliberate tick is never undone.
    if (chosen && chosen.value !== lastClient) {
      lastClient = chosen.value;
      llmBox.checked = Boolean(installing);
      llmBox.closest(".card").classList.toggle("on", llmBox.checked);
      var model = MODEL_FOR[chosen.value] || "";
      llmBrief.innerHTML = (installing
        ? "<b>Recommended \\u2014 a fresh install has no model backend yet.</b> "
        : "") + (model ? "Runs it on <b>" + model + "</b> through AIsa. " : "") + LLM_BRIEF;
      // The warning is derived from this checkbox, so it has to be recomputed
      // here rather than left to the client-radio listener. A client radio
      // matches both '.card input' and 'input[name="client"]', so both
      // listeners fire, in registration order: the one that recomputes the
      // warning runs before this one flips the box. Without this line the
      // warning is decided from the previous target's state, and picking an
      // install target left it showing next to an already-ticked box.
      updateModelWarn();
    }
  }

  // Informed consent is the whole point of backup mode: say exactly what
  // gets installed, that nothing of theirs changes, how to use it, how to
  // remove it. Copy varies per client because the mechanism does.
  var BACKUP_COPY = {
    "claude-code": "Installs one small command, <b><code>claude-aisa</code></b>, next to your other tools. Your original <b><code>claude</code></b> command keeps its login, models and settings <b>exactly as they are</b>. Run <b><code>claude-aisa</code></b> whenever you want <b>Claude, GPT, Gemini, DeepSeek, Kimi, GLM</b> and the rest, at lower prices. Remove it anytime by deleting that one file.",
    codex: "Adds an <b>aisa profile</b> inside codex's own config and a <b>codex-aisa</b> command. Your default codex setup is <b>untouched</b> — <code>codex-aisa</code> (or <code>codex --profile aisa</code>) uses AIsa for that session only. Remove anytime.",
    opencode: "Adds AIsa as an <b>extra provider</b> in opencode's config. Your default model is <b>untouched</b> — pick <code>aisa/\u2026</code> from opencode's model list whenever you want it."
  };
  var backupModes = document.getElementById("backupmodes");
  var llmCard = document.getElementById("llmcard");
  function updateModelsUI() {
    var chosen = document.querySelector('input[name="client"]:checked');
    var detectedCli = chosen && chosen.dataset.install !== "1" && BACKUP_COPY[chosen.value];
    backupModes.style.display = detectedCli ? "block" : "none";
    llmCard.style.display = detectedCli ? "none" : "";
    if (detectedCli) document.getElementById("backupbrief").innerHTML = BACKUP_COPY[chosen.value];
  }
  document.querySelectorAll('input[name="lmode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      document.querySelectorAll('[data-kind="lmode"]').forEach(function (c) {
        c.classList.toggle("on", c.querySelector("input").checked);
      });
    });
  });

  var modelWarn = document.getElementById("modelwarn");
  var armed = false;
  function updateModelWarn() {
    var chosen = document.querySelector('input[name="client"]:checked');
    var need = chosen && chosen.dataset.install === "1" && !llmBox.checked;
    modelWarn.style.display = need ? "block" : "none";
    if (!need) armed = false;
  }
  document.getElementById("modelfix").addEventListener("click", function () {
    llmBox.checked = true;
    llmBox.closest(".card").classList.add("on");
    updateModelWarn();
  });
  document.querySelectorAll('input[name="client"]').forEach(function (r) {
    r.addEventListener("change", function () { updateModelWarn(); updateModelsUI(); });
  });
  updateModelsUI();

  llmBox.addEventListener("change", function () {
    updateModelWarn();
    llmBox.closest(".card").classList.toggle("on", llmBox.checked);
  });

  document.querySelectorAll(".card input").forEach(function (cb) {
    cb.addEventListener("change", function () {
      if (cb.type === "radio") {
        // A radio unchecks its siblings without firing their events, so the
        // whole group is repainted rather than just this row.
        document.querySelectorAll('input[name="' + cb.name + '"]').forEach(function (r) {
          r.closest(".card").classList.toggle("on", r.checked);
        });
      } else {
        cb.closest(".card").classList.toggle("on", cb.checked);
      }
      syncButton();
    });
  });

  document.querySelectorAll("[data-more]").forEach(function (m) {
    var d = m.previousElementSibling;
    if (d && d.scrollHeight <= d.clientHeight + 8) { m.style.display = "none"; return; }
    m.addEventListener("click", function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var card = m.closest(".card");
      var open = card.classList.toggle("open");
      m.textContent = open ? "less" : "more";
    });
  });

  function picked(name) {
    return Array.prototype.map.call(
      document.querySelectorAll('input[name="' + name + '"]:checked'),
      function (i) { return i.value; });
  }

  var STATE_WORD = { pending: "waiting", running: "working\\u2026", ok: "done",
                     fail: "failed", skip: "skipped" };

  // The moment an install step succeeds, its client card flips to a loud
  // installed state — the card is where the user read "not installed", so
  // the card is where the success must land.
  function syncClientCards(steps) {
    steps.forEach(function (s) {
      if (s.id.indexOf("install:") !== 0 || s.state !== "ok") return;
      var card = document.querySelector('[data-cid="' + s.id.slice(8) + '"]');
      if (!card || card.className.indexOf("freshly-installed") !== -1) return;
      card.className += " freshly-installed";
      var badge = card.querySelector("[data-badge]");
      if (badge) { badge.className = "badge installed"; badge.textContent = "\\u2713 installed"; }
      var brief = card.querySelector("[data-brief]");
      if (brief) brief.innerHTML = "<b>Installed successfully</b> \\u2014 " + (s.detail || "ready to use");
    });
  }

  function renderSteps(steps) {
    if (!steps || !steps.length) return;
    syncClientCards(steps);
    progress.style.display = "block";
    var settled = steps.filter(function (s) {
      return s.state === "ok" || s.state === "skip";
    }).length;
    var failed = steps.filter(function (s) { return s.state === "fail"; }).length;
    var pct = Math.round(((settled + failed) / steps.length) * 100);
    var running = steps.filter(function (s) { return s.state === "running"; })[0];

    var rows = steps.map(function (s) {
      return "<div class='step " + s.state + "'>" +
        "<span class='mark'></span>" +
        "<span class='body'><span class='lbl'>" + s.label + "</span>" +
        (s.detail ? "<span class='det'>" + s.detail + "</span>" : "") +
        "</span><span class='st'>" + (STATE_WORD[s.state] || s.state) + "</span></div>";
    }).join("");

    progress.innerHTML = "<h2><span class='n'>5</span>Setting things up</h2>" +
      "<div class='bar-wrap'><div class='bar-fill' style='width:" + pct + "%'></div></div>" +
      "<div class='bar-note'>" + (settled + failed) + " of " + steps.length + " \\u00b7 " +
      (running ? running.label : (pct === 100 ? "finished" : "starting\\u2026")) + "</div>" +
      rows;

    // The button narrates the phase it is actually in — "Connecting…" over a
    // minute-long install reads as a hang, or worse, as a lie.
    if (running) {
      var BTN_WORD = { install: "Installing\\u2026", signin: "Signing in\\u2026",
        mcp: "Connecting\\u2026", llm: "Configuring models\\u2026",
        auth: "Authorizing\\u2026", balance: "Finishing\\u2026" };
      btn.textContent = BTN_WORD[running.id.split(":")[0]] || "Working\\u2026";
    }

    // The list grows as steps settle; keep the live edge in view, but only
    // when progress actually advanced — re-scrolling on every poll would
    // fight the user's own scrolling. While running, center the active row;
    // once everything settled, go all the way down so the final ticks and
    // the completion note are fully visible before the summary tab opens.
    var sig = steps.map(function (s) { return s.state; }).join(",");
    if (sig !== lastSig) {
      lastSig = sig;
      if (running) {
        var edge = progress.querySelector(".step.running");
        if (edge && edge.scrollIntoView) edge.scrollIntoView({ block: "center", behavior: "smooth" });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }
    }
  }
  var lastSig = "";

  function poll() {
    fetch("/status?token=" + TOKEN).then(function (r) { return r.json(); }).then(function (s) {
      renderSteps(s.steps);
      if (s.phase === "done") {
        document.title = "\\u2713 AIsa Connected";
        // The big CTA is the bridge between the two pages: the summary tab
        // opened itself, but this is where the user is looking.
        var link = s.doneUrl
          ? "<a class='cta' href='" + s.doneUrl + "'>See how to use it \\u2192</a>"
          : "";
        result.innerHTML = "<b>All connected.</b> A summary page with try-it-now examples just opened in a new tab." + link;
        btn.textContent = "Connected";
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        return;
      }
      if (s.phase === "failed") {
        result.innerHTML = "Some steps did not complete — see the list above; the summary page has the details and how to retry.";
        return;
      }
      setTimeout(poll, 1000);
    }).catch(function () { setTimeout(poll, 1500); });
  }

  btn.addEventListener("click", function () {
    var servers = picked("server");
    var chosen = document.querySelector('input[name="client"]:checked');
    if (!servers.length || !chosen) {
      result.textContent = "Pick at least one capability and one client."; return;
    }
    var clients = [chosen.value];
    var install = chosen.dataset.install === "1" ? [chosen.value] : [];
    // Soft block: a fresh install with no model is almost certainly a
    // mistake. First press stops here and points at the warning; a second
    // press is an informed choice and goes through.
    if (install.length && !llmBox.checked && !armed) {
      armed = true;
      updateModelWarn();
      modelWarn.scrollIntoView({ block: "center", behavior: "smooth" });
      modelWarn.style.animation = "none"; void modelWarn.offsetWidth;
      modelWarn.style.animation = "mwshake .45s";
      btn.textContent = "Install anyway, without a model \u2192";
      return;
    }
    btn.disabled = true;
    btn.textContent = install.length ? "Installing\\u2026" : "Connecting\\u2026";
    fetch("/apply", { method: "POST",
      headers: { "content-type": "application/json", "x-connect-token": TOKEN },
      body: JSON.stringify({ servers: servers, clients: clients, install: install,
        llmMode: install.length || backupModes.style.display === "none"
          ? (llmBox.checked ? "switch" : "skip")
          : (document.querySelector('input[name="lmode"]:checked') || {}).value || "skip" })
    }).then(function (r) { return r.json(); }).then(function (data) {
      renderSteps(data.steps);
      poll();
    });
  });
})();
</script>`;
  return shell("AIsa Connect", body);
}

// ── page C: success + try-it-now examples ───────────────────────────────────
function renderDone(
  chosen: LiveServer[],
  clientIds: string[],
  steps: Step[],
  allServers: LiveServer[],
  balanceMicros: number | null,
  llmMode: LlmMode | undefined
): string {
  const clientNames = clientIds
    .map((id) => (id === "claude-code" ? "Claude Code" : FILE_CLIENT_LABELS[id] ?? id))
    .join(", ");
  // One selected server gets two prompts so the page never feels thin; two or
  // more get one prompt each (capped at four cards).
  const withEx = chosen.filter((s) => EXAMPLES[s.slug]);
  const cards =
    withEx.length === 1
      ? EXAMPLES[withEx[0].slug].slice(0, 2).map((text) => ({ slug: withEx[0].slug, text }))
      : withEx.slice(0, 4).map((s) => ({ slug: s.slug, text: EXAMPLES[s.slug][0] }));
  const examples = cards
    .map(
      (c) => `<div class="example"><div><span class="srv">aisa-${c.slug}</span>
<div class="txt">${c.text}</div></div>
<button data-copy="${c.text.replace(/"/g, "&quot;")}">${I.copy} Copy</button></div>`
    )
    .join("\n");
  // The page tells the truth about the run: a failed MCP step means no tools
  // were added, and a page that congratulates anyway (as an earlier version
  // did, over a 0-of-1 add) teaches the user to distrust every later success.
  const failed = steps.filter((s) => s.state === "fail");
  const mcpFailed = failed.some((s) => s.id === "mcp");
  const failBlock = failed.length
    ? `<div class="authnote" style="margin-bottom:1.2rem">${I.shield}<div>
       <b>${failed.length} step${failed.length > 1 ? "s" : ""} did not complete:</b>
       <ul style="margin:.4rem 0 0 1.1rem">${failed
         .map((s) => `<li><b>${s.label}</b> — ${s.detail ?? "failed"}</li>`)
         .join("")}</ul>
       Fix the above, then run <code>npx @aisa-one/cli connect</code> again — it is
       safe to re-run and picks up where things stand.</div></div>`
    : "";
  const toolCount = chosen.reduce((n, s) => n + s.toolCount, 0);
  const remaining = allServers.length - chosen.length;
  const remainingTools = allServers.reduce((n, s) => n + s.toolCount, 0) - toolCount;

  // A run that installed an agent is a much bigger deal than one that only
  // added tools, and the headline must say so: the user walked in with
  // nothing and walked out with a working coding agent on AIsa models.
  const installedAgents = steps
    .filter((s) => s.id.startsWith("install:") && s.state === "ok")
    .map((s) => INSTALLERS[s.id.slice("install:".length)]?.label ?? s.id.slice("install:".length));
  const llmOk = steps.some((s) => s.id === "llm" && s.state === "ok");
  const model = defaultModelsFor(clientIds[0] ?? "");
  const successHeadline = installedAgents.length
    ? `<h1>Congratulations — <em>${installedAgents.join(" & ")}</em> is installed and armed
with <em>${toolCount} powerful tool${toolCount > 1 ? "s" : ""}</em></h1>
<p class="lede"><b>${installedAgents.join(" & ")}</b> is now on this machine, signed in to
AIsa${llmOk ? `, running on <b>${model.model}</b> through AIsa,` : ","} with
${chosen.length} MCP server${chosen.length > 1 ? "s" : ""} wired in — a complete AI setup,
nothing else to configure.</p>`
    : `<h1>Congratulations — your agent just got <em>${toolCount} powerful new tool${toolCount > 1 ? "s" : ""}</em></h1>
<p class="lede">${chosen.length} AIsa MCP server${chosen.length > 1 ? "s are" : " is"} now
installed and signed in for <b>${clientNames}</b> — nothing else to configure.</p>`;
  // Launchable only for the CLI agents, and only while the local process is
  // still alive (it lingers a few minutes) — the button degrades to a
  // "run it yourself" hint once the process has exited.
  //
  // The card mimics each agent's real first screen — Codex's ASCII face
  // (transcribed from its TUI; the binary stores it as fragments) and Claude
  // Code's pixel robot — so the terminal the button opens looks exactly like
  // what the user just previewed. Familiarity is the whole point.
  const backup = llmMode === "backup";
  const launchBin =
    clientIds[0] === "codex" ? (backup ? "codex-aisa" : "codex")
    : clientIds[0] === "claude-code" ? (backup ? "claude-aisa" : "claude")
    : clientIds[0] === "opencode" ? "opencode" : null;
  // Backup mode's one-line contract, repeated where the user will act on it.
  const backupNote = backup
    ? clientIds[0] === "opencode"
      ? `<p class="fine" style="margin:0 0 1.2rem"><b>Your usual setup is untouched.</b> Pick
<code>aisa/\u2026</code> from opencode's model list whenever you want AIsa.</p>`
      : `<p class="fine" style="margin:0 0 1.2rem"><b>Your usual <code>${clientIds[0] === "codex" ? "codex" : "claude"}</code> is untouched.</b> Run
<code>${launchBin}</code> whenever you want AIsa's models; delete that one file to remove it.</p>`
    : "";
  const cwd = process.cwd();
  const CODEX_FACE = [
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
  const CLAUDE_BOT = [
    "  ▄▄      ▄▄",
    " ████████████",
    " ██ ███ ██ ██",
    " ████████████",
    "  ▀▀  ▀▀  ▀▀",
  ].join("\n");
  // opencode's real banner, verbatim from its --help output.
  const OPENCODE_MARK = [
    "█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█",
    "█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀",
    "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀",
  ].join("\n");
  const termPreview =
    launchBin === "opencode"
      ? `<pre class="termlogo oc">${OPENCODE_MARK}</pre>
<div class="termline">Welcome to <b>opencode</b></div>
<div class="termline dim">model: <b>${AISA_PROVIDER_ID}/${model.model}</b> · via AIsa</div>
<div class="termline dim">config: ~/.config/opencode/opencode.json</div>`
      : launchBin === "codex"
      ? `<pre class="termlogo codex">${CODEX_FACE}</pre>
<div class="termline">Welcome to <b>Codex</b>, OpenAI's command-line coding agent</div>
<div class="termline dim">model: <b>${model.model}</b> · via AIsa</div>`
      : `<pre class="termlogo claude">${CLAUDE_BOT}</pre>
<div class="termline"><b class="ccname">Claude Code</b></div>
<div class="termline dim">${model.model} · via AIsa</div>
<div class="termline dim">${cwd}</div>
<div class="termline accent">Using ${model.model} (from .claude/settings.json)</div>`;
  const launchBlock =
    !mcpFailed && launchBin
      ? `<div class="termcard">
  <div class="termwin">
    <div class="termbar"><span class="tdot r"></span><span class="tdot y"></span><span class="tdot g"></span></div>
    <div class="termbody">${termPreview}</div>
  </div>
  <div class="termside">
    <button class="cta act" id="launch">Launch ${launchBin} →</button>
    <span class="fine" id="launchnote"></span>
  </div>
</div>`
      : "";

  const headline = mcpFailed
    ? `<div class="eyebrow">Almost there</div>
<h1>Your agent is <em>not connected yet</em></h1>
<p class="lede">The MCP entries could not be added to <b>${clientNames}</b> — details below.</p>`
    : `<div class="bigcheck">${I.check}</div>
<div class="eyebrow">Connected</div>
${successHeadline}`;

  // ── the recap: the same journey the first page showed live, replayed as a
  // settled checklist, so the fresh tab connects visually to what the user
  // just watched happen. Every step, including the failed and skipped ones.
  const STEP_ICON: Record<StepState, string> = {
    ok: "✓",
    fail: "✕",
    skip: "–",
    pending: "·",
    running: "·",
  };
  // Check mark at the END of the row: the row reads as a capability gained
  // ("Install Codex — installed ✓"), not as a checklist item to do.
  const recapRows = steps
    .map(
      (s) => `<div class="rstep ${s.state}"><span class="rl">${s.label}</span>
<span class="rd">${s.detail ?? ""}</span><span class="ri">${STEP_ICON[s.state]}</span></div>`
    )
    .join("\n");
  const recap = `
<h2>Everything you just gained</h2>
<div class="recap">
  <div class="rsum">${chosen.length} capabilit${chosen.length === 1 ? "y" : "ies"} · ${toolCount} tools · ${clientNames}</div>
${recapRows}
</div>`;

  // ── the balance card: always shown, always with the top-up button — money
  // is the one thing a user should never have to hunt for. Below $5 the card
  // turns warm and suggests (never demands) a top-up.
  const TOPUP_URL = "https://console.aisa.one/billing?source=aisa_cli";
  const low = balanceMicros !== null && balanceMicros < 5_000_000;
  const balanceCard = `
<div class="balcard${low ? " low" : ""}">
  <div><div class="balnum">${balanceMicros === null ? "—" : formatMicrosUSD(balanceMicros)}</div>
  <div class="ballbl">AIsa balance</div></div>
  <div class="balright">${
    low
      ? `<div class="lownote">Running a little low — a small top-up now keeps your first calls flowing smoothly.</div>`
      : balanceMicros === null
        ? `<div class="lownote">Could not read it just now — <code>aisa balance</code> will.</div>`
        : ""
  }
  <a class="cta topup" href="${TOPUP_URL}" target="_blank" rel="noopener">Top up now →</a></div>
</div>`;

  const body = `
<style>
  h1 { font-size: 2.5rem; }
  .lede { font-size: 1.08rem; }
  .example .txt { font-size: 1.02rem; }
  .example .srv { font-size: .8rem; }
  h2 { font-size: 1.2rem; }
  .fine { font-size: .9rem; }
  .recap { border: 1px solid var(--line); border-radius: 12px; background: var(--card);
    padding: 1rem 1.2rem; margin: 0 0 1.4rem; max-width: 62rem; }
  .rsum { font-weight: 600; padding-bottom: .55rem; border-bottom: 1px dashed var(--line);
    margin-bottom: .55rem; }
  .rstep { display: flex; gap: .7rem; align-items: baseline; padding: .4rem 0;
    font-size: 1.06rem; border-bottom: 1px solid var(--line); }
  .rstep:last-child { border-bottom: 0; }
  .rstep .ri { font-weight: 800; font-size: 1.15rem; flex: none; margin-left: auto; }
  .rstep.ok .ri { color: var(--ok); }
  .rstep.fail .ri { color: #dc2626; }
  .rstep.skip .ri, .rstep.pending .ri { color: #9ca3af; }
  .rstep .rl { font-weight: 700; flex: none; }
  .rstep .rd { color: var(--muted); font-size: .95rem; overflow-wrap: anywhere; }
  .balcard { display: flex; justify-content: space-between; align-items: center;
    gap: 1rem; border: 1px solid var(--line); border-radius: 12px; background: var(--card);
    padding: 1rem 1.2rem; margin: 0 0 1.8rem; max-width: 62rem; flex-wrap: wrap; }
  .balcard.low { border-color: #f59e0b; background: color-mix(in srgb, #f59e0b 12%, var(--card)); }
  .balnum { font-size: 1.6rem; font-weight: 800; }
  .ballbl { font-size: .8rem; color: var(--muted); }
  .balright { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .lownote { font-size: .92rem; color: color-mix(in srgb, #b45309 70%, var(--ink)); max-width: 26rem; }
  .cta.topup, .cta.act { display: inline-block; width: auto; padding: .7rem 1.8rem; }
  /* The launch card: a believable little terminal, agent branding intact,
     with the launch button on the right edge — same edge as Top up above. */
  .termcard { display: flex; justify-content: space-between; align-items: center;
    gap: 1.2rem; border: 1px solid var(--line); border-radius: 12px; background: var(--card);
    padding: 1rem 1.2rem; margin: 0 0 1.8rem; max-width: 62rem; flex-wrap: wrap; }
  .termwin { background: #0d0d0b; border-radius: 10px; overflow: hidden;
    flex: 1 1 24rem; min-width: 0; box-shadow: inset 0 0 0 1px #262622; }
  .termbar { display: flex; gap: .38rem; padding: .5rem .7rem; background: #1a1a17; }
  .tdot { width: .62rem; height: .62rem; border-radius: 50%; }
  .tdot.r { background: #ff5f57; } .tdot.y { background: #febc2e; } .tdot.g { background: #28c840; }
  .termbody { padding: .8rem 1rem 1rem; font-family: ui-monospace, SFMono-Regular,
    Menlo, monospace; font-size: .78rem; line-height: 1.35; }
  .termlogo { margin: 0 0 .6rem; font-size: .35rem; line-height: 1.15; overflow-x: auto; }
  .termlogo.codex { color: #33d17a; }
  .termlogo.oc { color: #fafafa; font-size: .62rem; line-height: 1.2; }
  .termlogo.claude { color: #e07b54; font-size: .56rem; line-height: 1.05; }
  .termline { color: #d8d8d2; padding: .08rem 0; overflow-wrap: anywhere; }
  .termline b { color: #fff; }
  .termline.dim { color: #8a8a82; }
  .termline.accent { color: #d8d8d2; border-left: 2px solid #33d17a; padding-left: .5rem; }
  .termline .prompt { color: #33d17a; font-weight: 700; }
  .ccname { color: #33d17a !important; }
  .termside { display: flex; flex-direction: column; align-items: flex-end;
    gap: .5rem; flex: none; }
</style>
${headline}
${
    mcpFailed
      ? failBlock + recap + balanceCard
      : `<p class="lede" style="margin-top:.6rem">You are now connected to <b>AIsa</b> — a powerful capability layer for agents: one account for
<b>Claude, GPT, Gemini, DeepSeek, Kimi, GLM</b> and the live data behind them: <b>Twitter, SimilarWeb, CoinGecko, Apollo, Polymarket</b> and more.${
          remaining > 0
            ? ` ${remaining} more MCP server${remaining > 1 ? "s" : ""} (${remainingTools} tools) are one
<code>npx @aisa-one/cli connect</code> away.`
            : ""
        }
Explore the platform at <a href="https://aisa.one" target="_blank" rel="noopener">aisa.one</a> ·
usage &amp; billing at <a href="https://console.aisa.one" target="_blank" rel="noopener">console.aisa.one</a>.</p>
${failBlock}
${recap}
${balanceCard}
${backupNote}
${launchBlock}
<h2>${I.sparkles} Try it now — paste one of these into ${clientNames.split(",")[0]}</h2>
<div class="examples">
${examples || '<p class="fine">Ask your agent to use any of the aisa-* MCP tools.</p>'}
</div>
<p class="fine">These first-run prompts mention <b>AIsa</b> once so the demo reliably lands on
your new tools. After that, plain natural language is enough — your agent reaches for AIsa on
its own whenever a task needs live data. Verify anytime with <code>/mcp</code> inside
Claude Code — the entries should show <b>Connected</b>.</p>`
  }
<p class="fine">This page keeps working after the local process exits.</p>
<script>
document.querySelectorAll("[data-copy]").forEach(function (b) {
  b.addEventListener("click", function () {
    navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function () {
      b.textContent = "Copied \\u2713"; setTimeout(function () { b.innerHTML = ${JSON.stringify(I.copy + " Copy")}; }, 1600);
    });
  });
});
var launch = document.getElementById("launch");
if (launch) launch.addEventListener("click", function () {
  var token = new URLSearchParams(location.search).get("token");
  var note = document.getElementById("launchnote");
  launch.disabled = true;
  fetch("/launch?token=" + token, { method: "POST" })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function () {
      launch.textContent = "\\u2713 Opened in Terminal";
      note.textContent = "";
    })
    .catch(function () {
      // Process exited, or no terminal emulator could be started (headless
      // Linux) — the agent is installed either way, one command starts it.
      launch.style.display = "none";
      note.innerHTML = "Could not open a terminal automatically \\u2014 just run <code>${launchBin ?? ""}</code> in any terminal.";
    });
});
</script>`;
  return shell(mcpFailed ? "AIsa \u2014 almost connected" : "\u2713 AIsa Connected", body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Open a real terminal window running the freshly connected agent. The
 * command is a fixed whitelist entry — nothing from the request reaches the
 * shell — and the working directory is where connect was launched, which is
 * almost always the project the user wants the agent in.
 */
function launchAgentTerminal(
  binary: "codex" | "claude" | "opencode" | "claude-aisa" | "codex-aisa"
): Promise<boolean> {
  if (process.platform === "darwin") {
    // osascript ships with macOS — no dependency of ours. First use may show
    // a one-time automation permission prompt; Terminal.app starts a fresh
    // shell, so the cd is explicit.
    const dir = process.cwd().replace(/'/g, "'\\''");
    return new Promise((resolve) =>
      execFile(
        "osascript",
        [
          "-e",
          `tell application "Terminal" to do script "cd '${dir}' && ${binary}"`,
          "-e",
          'tell application "Terminal" to activate',
        ],
        (err) => resolve(!err)
      )
    );
  }
  // Linux: only meaningful in a graphical session, and there is no single
  // terminal — walk the common ones until one starts. The spawned terminal
  // inherits our cwd, so the agent opens in the right directory without a cd.
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return Promise.resolve(false);
  const candidates: Array<[string, string[]]> = [
    ["x-terminal-emulator", ["-e", binary]],
    ["gnome-terminal", ["--", binary]],
    ["konsole", ["-e", binary]],
    ["xfce4-terminal", ["-e", binary]],
    ["xterm", ["-e", binary]],
  ];
  return candidates.reduce<Promise<boolean>>(
    (chain, [cmd, args]) =>
      chain.then(
        (ok) => ok || new Promise((resolve) => execFile(cmd, args, (err) => resolve(!err)))
      ),
    Promise.resolve(false)
  );
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(cmd, [url], () => {});
}

export async function connectAction(options: {
  open?: boolean;
  port?: string;
  dryRun?: boolean;
}): Promise<void> {
  let servers: LiveServer[];
  try {
    servers = await fetchLiveServers();
  } catch (e) {
    error(`Could not read the MCP manifest: ${(e as Error).message}`);
    hint("Check your network and try again.");
    process.exitCode = 1;
    return;
  }
  const clients = detectClients();
  const detected = clients.filter((c) => c.detected);
  if (detected.length === 0) {
    error("No supported client found (Claude Code, Cursor, Claude Desktop, Windsurf).");
    hint("Install one, or use 'aisa mcp setup --agent <client>' to write a config anyway.");
    process.exitCode = 1;
    return;
  }
  const key = getApiKey();

  // One random token per run: the page and every endpoint require it, so
  // another local process cannot drive this server blind.
  const token = randomBytes(16).toString("hex");
  const page = renderPage(servers, clients, token, Boolean(key), supported());

  const state: RunState = { phase: "selecting", results: [], auth: {}, steps: [] };
  let chosenServers: LiveServer[] = [];
  let chosenClients: string[] = [];
  let port = 0;

  let settled = false;
  const idle = setTimeout(() => {
    if (settled) return;
    error("No response from the browser in 10 minutes — giving up.");
    process.exit(1);
  }, IDLE_TIMEOUT_MS);

  const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const tokenOk =
      url.searchParams.get("token") === token || req.headers["x-connect-token"] === token;

    if (req.method === "GET" && url.pathname === "/") {
      if (!tokenOk) {
        res.writeHead(403).end("forbidden");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      if (!tokenOk) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
      return;
    }
    if (req.method === "GET" && url.pathname === "/done") {
      if (!tokenOk) {
        res.writeHead(403).end("forbidden");
        return;
      }
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(renderDone(chosenServers, chosenClients, state.steps, servers, state.balanceMicros ?? null, state.llmMode));
      return;
    }
    if (req.method === "POST" && url.pathname === "/launch") {
      if (!tokenOk) {
        res.writeHead(403).end();
        return;
      }
      // Whitelist only — the client name selects a fixed binary, and no part
      // of the request ever reaches a shell.
      const backup = state.llmMode === "backup";
      const bin =
        chosenClients[0] === "codex" ? (backup ? "codex-aisa" : "codex")
        : chosenClients[0] === "claude-code" ? (backup ? "claude-aisa" : "claude")
        : chosenClients[0] === "opencode" ? "opencode" : null;
      if (!bin) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ ok: false }));
        return;
      }
      // Wait for the real outcome: a 200 over a failed launch would leave the
      // page claiming success it never checked (headless Linux, no terminal
      // emulator found). The page's catch shows the run-it-yourself hint.
      const launched = await launchAgentTerminal(bin);
      res
        .writeHead(launched ? 200 : 500, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: launched }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/apply") {
      if (!tokenOk) {
        res.writeHead(403).end();
        return;
      }
      let body: {
        servers?: string[];
        clients?: string[];
        install?: string[];
        llm?: boolean;
        llmMode?: string;
      };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        res.writeHead(400).end();
        return;
      }
      chosenServers = servers.filter((s) => body.servers?.includes(s.slug));
      chosenClients = body.clients ?? [];
      const wantInstall = new Set(body.install ?? []);
      // Ticking "install" means "and connect it": nobody installs an agent
      // here except to put AIsa servers in it, and asking twice for the same
      // intention is how a user ends up with an empty Codex.
      for (const id of wantInstall) {
        if (!chosenClients.includes(id)) chosenClients.push(id);
      }
      state.phase = "applying";
      const llmMode: LlmMode =
        body.llmMode === "switch" || body.llmMode === "backup" || body.llmMode === "skip"
          ? body.llmMode
          : body.llm
            ? "switch"
            : "skip";
      state.llmMode = llmMode;

      // The whole plan, in order, before any of it runs — the page renders it
      // greyed out so a long install reads as progress rather than a hang.
      state.steps = buildPlan({
        install: [...wantInstall],
        clients: chosenClients,
        servers: chosenServers,
        keyed: Boolean(key),
        dryRun: Boolean(options.dryRun),
        llmMode,
      });
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ started: true, steps: state.steps })
      );

      if (settled) return;
      settled = true;
      clearTimeout(idle);
      const failures = await runPlan(state, {
        install: [...wantInstall],
        clients: chosenClients,
        servers: chosenServers,
        key,
        dryRun: Boolean(options.dryRun),
        llmMode,
      });
      const results = state.results;
      {
        state.phase = failures > 0 ? "failed" : "done";
        if (failures > 0) {
          error(`${failures} step(s) did not complete — see the notes above.`);
        }
        success(
          options.dryRun
            ? "Dry run complete — nothing was written."
            : `Connected ${chosenServers.length} server(s) for ${results.length} client(s)`
        );
        if (!options.dryRun) {
          // The success page opens as a fresh tab from this process (an OS
          // browser launch, so no popup blocker applies) — users who tabbed
          // away to the authorization rarely come back to the first tab.
          const doneUrl = `http://127.0.0.1:${port}/done?token=${token}`;
          state.doneUrl = doneUrl;
          info("Opening a success page with try-it-now examples…");
          await pause(BEFORE_HANDOFF_MS);
          openBrowser(doneUrl);
          hint("A success page with try-it-now examples just opened in your browser");
          hint("Verify anytime with /mcp inside Claude Code — entries should show Connected");
          info("Keeping the success page alive for 5 minutes (Ctrl-C to finish now)…");
          setTimeout(() => {
            srv.close();
            process.exit(failures > 0 ? 1 : 0);
          }, LINGER_AFTER_DONE_MS);
        } else {
          setTimeout(() => {
            srv.close();
            process.exit(0);
          }, 300);
        }
      }
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    srv.listen(options.port ? Number(options.port) : 0, "127.0.0.1", resolve);
  });
  const addr = srv.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
  const pageUrl = `http://127.0.0.1:${port}/?token=${token}`;

  info(
    `${servers.length} live servers · detected: ${detected.map((c) => c.label).join(", ")}`
  );
  console.log(`  ${chalk.cyan(pageUrl)}`);
  if (options.open === false) {
    hint("Open the URL above in your browser to continue (Ctrl-C to cancel)");
  } else {
    info("Opening your browser… (Ctrl-C to cancel)");
    openBrowser(pageUrl);
  }
}
