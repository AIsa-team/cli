import ora from "ora";
import chalk from "chalk";
import { error, formatJson, hint, table, truncate } from "../utils/display.js";
import { API_CATEGORIES, categoryOf } from "../constants.js";
import {
  getProviders,
  getProviderDetail,
  getHealth,
  flatEndpoints,
  toRunPath,
  runSlugOf,
  formatPrice,
  type CatalogEndpoint,
  type CatalogDetail,
} from "../catalog.js";

const DEFAULT_ENDPOINT_LIMIT = 40;

function statusBadge(status?: string): string {
  switch (status) {
    case "healthy":
      return chalk.green("healthy");
    case "warning":
      return chalk.yellow("warning");
    case "failed":
      return chalk.red("failed");
    case "not_tested":
      return chalk.gray("not tested");
    default:
      return chalk.gray(status || "—");
  }
}

function shortDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

export async function apiListAction(options: {
  category?: string;
  health?: boolean;
  json?: boolean;
  refresh?: boolean;
}): Promise<void> {
  const spinner = ora("Loading API catalog...").start();

  let providers = await getProviders({ refresh: options.refresh });
  const health = options.health ? await getHealth({ refresh: options.refresh }) : [];
  const healthById = new Map(health.map((h) => [h.id, h]));

  spinner.stop();

  if (options.category) {
    const cat = options.category.toLowerCase();
    providers = providers.filter((p) => categoryOf(p.id) === cat);
    if (providers.length === 0) {
      console.log(`  No APIs in category "${options.category}".`);
      hint(`Categories: ${API_CATEGORIES.join(", ")}`);
      return;
    }
  }

  if (options.json) {
    console.log(
      formatJson(
        providers.map((p) => ({
          ...p,
          category: categoryOf(p.id),
          ...(options.health ? { health: healthById.get(p.id)?.status } : {}),
        }))
      )
    );
    return;
  }

  const headers = ["API", "CATEGORY", "ENDPOINTS", "FROM", "UPDATED"];
  if (options.health) headers.push("STATUS");

  const rows = providers.map((p) => {
    const row = [
      p.id,
      categoryOf(p.id),
      String(p.endpoint_count),
      formatPrice(p.pricing?.normal),
      shortDate(p.updated_at),
    ];
    if (options.health) row.push(statusBadge(healthById.get(p.id)?.status));
    return row;
  });

  const total = providers.reduce((sum, p) => sum + p.endpoint_count, 0);

  console.log();
  console.log(table(headers, rows));
  console.log();
  console.log(chalk.gray(`  ${providers.length} APIs · ${total} endpoints`));
  hint("Details: aisa api show <api>");
  hint("Catalog paths and prices are browsing metadata, not a substitute for aisa schema or aisa quote.");
}

/** Resolve a provider by id, or by the URL slug its endpoints are served under. */
async function findProvider(idOrSlug: string, refresh?: boolean): Promise<CatalogDetail> {
  try {
    return await getProviderDetail(idOrSlug, { refresh });
  } catch (err) {
    const providers = await getProviders({ refresh });
    const candidates = providers.filter((p) => p.id.includes(idOrSlug) || idOrSlug.includes(p.id));
    for (const candidate of candidates) {
      const detail = await getProviderDetail(candidate.id, { refresh }).catch(() => undefined);
      if (detail && runSlugOf(detail) === idOrSlug) return detail;
    }
    throw err;
  }
}

function printEndpointDetail(detail: CatalogDetail, endpoint: CatalogEndpoint): void {
  const runPath = toRunPath(endpoint.path);

  console.log(`\n  ${chalk.cyan.bold(endpoint.name || runPath)}`);
  if (endpoint.description) console.log(`  ${endpoint.description}`);
  console.log(`\n  Path:     ${endpoint.path}`);
  console.log(`  Provider: ${detail.id}`);
  console.log(`  Price:    ${formatPrice(endpoint.pricing?.normal)} per request`);

  const params = [...runPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  if (params.length > 0) {
    console.log(`  Path params: ${params.join(", ")}`);
  }

  console.log();
  hint("Catalog paths and prices are browsing metadata, not a substitute for aisa schema or aisa quote.");
}

export async function apiShowAction(
  idOrSlug: string,
  path?: string,
  options: { group?: boolean; health?: boolean; json?: boolean; all?: boolean; refresh?: boolean } = {}
): Promise<void> {
  const spinner = ora(`Loading ${idOrSlug}...`).start();

  let detail: CatalogDetail;
  try {
    detail = await findProvider(idOrSlug, options.refresh);
  } catch (err) {
    spinner.fail("Not found");
    error((err as Error).message);
    hint("List all: aisa api list");
    return;
  }

  spinner.stop();

  const endpoints = flatEndpoints(detail);

  if (path) {
    const wanted = toRunPath(path).replace(/^\/+/, "");

    // Exact wins outright; a suffix is only usable when it identifies one
    // endpoint. Providers routinely repeat a trailing segment — brave has six
    // endpoints ending in /search — and silently picking the first would show
    // the wrong one.
    const exact = endpoints.filter((e) => {
      const p = toRunPath(e.path);
      return p === wanted || p === `${detail.id}/${wanted}`;
    });
    const matches = exact.length > 0
      ? exact
      : endpoints.filter((e) => toRunPath(e.path).endsWith(`/${wanted}`));

    if (matches.length === 0) {
      error(`No endpoint matching "${path}" in ${detail.id}`);
      hint(`Run 'aisa api show ${detail.id}' to list them`);
      return;
    }
    if (matches.length > 1) {
      error(`"${path}" matches ${matches.length} endpoints in ${detail.id} — be more specific:`);
      for (const e of matches) console.log(`    ${toRunPath(e.path)}`);
      return;
    }
    if (options.json) {
      console.log(formatJson(matches[0]));
      return;
    }
    printEndpointDetail(detail, matches[0]);
    return;
  }

  if (options.json) {
    console.log(formatJson(detail));
    return;
  }

  const health = options.health
    ? (await getHealth({ refresh: options.refresh })).find((h) => h.id === detail.id)
    : undefined;

  console.log(`\n  ${chalk.cyan.bold(detail.id)} ${chalk.gray(`(${categoryOf(detail.id)})`)}`);
  console.log(`  ${detail.endpoint_count} endpoints · from ${formatPrice(detail.pricing?.normal)} per request`);
  console.log(`  Updated ${shortDate(detail.updated_at)}`);
  if (health) {
    // Health is tracked per provider, not per endpoint — the per-endpoint
    // counts are the same value repeated, so only the provider verdict is real.
    console.log(
      `  Status: ${statusBadge(health.status)}${health.checked_at ? chalk.gray(` (checked ${shortDate(health.checked_at)})`) : ""}`
    );
  }
  console.log();

  if (options.group) {
    // Group labels come from an operator-entered column ("Zero", "default"),
    // so this is opt-in rather than the default view.
    for (const group of detail.endpoint_groups || []) {
      console.log(`  ${chalk.bold(group.name || group.id || "ungrouped")}`);
      for (const e of group.endpoints || []) {
        console.log(`    ${chalk.gray(toRunPath(e.path))}  ${truncate(e.name || "", 45)}`);
      }
      console.log();
    }
  } else {
    const shown = options.all ? endpoints : endpoints.slice(0, DEFAULT_ENDPOINT_LIMIT);
    for (const e of shown) {
      console.log(
        `  ${toRunPath(e.path).padEnd(48)} ${chalk.gray(truncate(e.name || e.description || "", 40))}`
      );
    }
    if (shown.length < endpoints.length) {
      console.log(chalk.gray(`\n  … ${endpoints.length - shown.length} more — pass --all to see them`));
    }
  }

  if (runSlugOf(detail)) {
    console.log();
    hint(`Detail: aisa api show ${detail.id} <path>`);
    hint("Catalog paths and prices are browsing metadata, not a substitute for aisa schema or aisa quote.");
  }
}
