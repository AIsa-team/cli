# Known issues — findings from the 0.2.3 CLI audit

Every command documented on the npm page for `@aisa-one/cli` 0.2.2 was executed
against production `api.aisa.one` on 2026-08-06. The CLI-side breakages are
fixed in 0.2.3. What remains below needs someone else's decision or a backend
change.

---

## Needs a backend fix

### 1. The `search` provider's upstream is broken

`GET /apis/v1/search/smart` and `GET /apis/v1/search/full` return an upstream
HTML 404 page (a Rails error page, complete with `csrf-token` meta tags) rather
than JSON. Reproduced with `q`, `query`, and `keyword`, authenticated and
unauthenticated:

```
$ curl -H "Authorization: Bearer $AISA_API_KEY" \
    "https://api.aisa.one/apis/v1/search/smart?q=AI"
<!DOCTYPE html>
<html class="h-full antialiased" lang="en">
  <head>
    <meta name="csrf-param" content="authenticity_token" />
...
```

Both endpoints are listed as active in `/info/apis/category` (2 endpoints,
$0.02/request) and their health status is `not_tested`, so nothing flags them
as down.

**Impact:** this was the CLI's default web-search backend, i.e. the second
command in the README's Quick Start. 0.2.3 switches the default to `tavily`,
which works, but `smart` and `full` remain unusable.

**Likely cause:** the provider's `base_url` or `target_uri` points at a host
that no longer serves that route. Worth checking whether the credential is also
empty — `integrationexec/executor.go` returns early without an auth header when
the credential is blank, so a misconfigured provider fails silently rather than
erroring.

### 2. `financial` crypto endpoints return 403 for standard keys

```
$ aisa run financial /crypto/prices/snapshot -q "ticker=BTC-USD"
403: Crypto access restricted
```

Is this an account tier, a provider credential, or an intentional gate? The
same data is available through the `coingecko` provider at $0.008/request
versus `financial`'s $0.012, and coingecko reports `healthy` — 0.2.3 routes
`aisa crypto` there by default. If the restriction is intentional, the error
should say what unlocks it; if not, the credential needs attention.

### 3. `GET /v1/credits/usage` is not deployed

The route exists in `services/api-service/internal/httpapi/server.go:380` and is
documented in `docs/credits-usage-endpoint.md`, but production returns a plain
404:

```
$ curl -i -H "Authorization: Bearer $AISA_API_KEY" \
    "https://api.aisa.one/v1/credits/usage?limit=2"
HTTP/2 404
content-type: text/plain
404 page not found
```

`GET /v1/credits/balance` on the same middleware group returns 200, so this is
one route missing rather than the whole group.

`aisa usage` therefore remains a stub in 0.2.3 — shipping a client for a route
that does not exist would only produce a more elaborate failure. The client-side
implementation was written and validated against the documented contract using a
local mock gateway (rendering, `--days` / `--start` / `--end` / `--endpoint` /
`--model` / `--status` / `--scope` filters, opaque cursor pagination with
`--all`, and the 400/404/503 branches all check out), so wiring it up once the
route ships is a small, already-verified change.

One finding worth carrying over: per-request costs are micro-dollars — roughly
$0.0012 for a chat call and $0.012 for an integration call. Any UI rendering
`cost_micros_usd` at cent precision shows a solid column of `$0.00`.

### 4. No public MCP endpoint

The CLI has shipped `MCP_URL = "https://docs.aisa.one/mcp"` since 0.1.x.
**`docs.aisa.one` has no DNS A record** (confirmed via `dns.google`: the query
returns only an SOA for `aisa.one`). The only `/mcp` route in the platform is
`/mcp/admin/whoami` on `admin.aisa.one`, which requires an admin delegation
token and is not for end users.

So `aisa mcp setup` writes a server URL that cannot resolve, into the user's
editor config. Either a public MCP endpoint needs to ship, or the command
should be retired. This also blocks fixing the CLI-side bug in item 5 — there
is no correct URL to write.

`docs.aisa.one` is also referenced from the README and from several CLI hint
strings (all removed in 0.2.3). If a docs site is planned, the hostname is
already baked into published packages.

---

## CLI-side, deliberately not fixed in 0.2.3

### 5. `aisa mcp setup` can erase a user's MCP config

`src/commands/mcp.ts:31`:

```ts
try {
  existing = JSON.parse(readFileSync(filePath, "utf-8"));
} catch {
  existing = {};          // <-- unparseable file becomes an empty object
}
// ...
writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
```

If `~/.cursor/mcp.json` (or the Claude Desktop config) cannot be parsed — it has
comments, which is normal in the Cursor/VS Code ecosystem, or a trailing comma,
or is being written by another process — every MCP server the user had
configured is silently deleted and replaced with only the `aisa` entry.

This is reproducible on a developer machine today: `aisa mcp status` reports
`cursor: config unreadable`, and running `setup` from that state would empty the
file.

The fix is a few lines and does not depend on item 4:

1. On a parse failure, refuse to write that file and report it (`continue`,
   then exit non-zero) — "if you can't read it, don't overwrite it".
2. Validate that the parsed value is a plain object; `JSON.parse("null")`,
   `"[]"`, and `"3"` all succeed and are equally destructive.
3. Write atomically (`.tmp` + `rename`) and back up to `.bak` before the first
   modification.
4. Add `aisa mcp remove`, since 0.2.x already wrote the dead URL onto real
   machines and there is currently no way to undo it.

Until then, `aisa mcp setup` should not be recommended anywhere.

---

## Observations that don't block anything

**`/info/apis/:id` endpoint groups carry no meaning.** `endpoint_groups[].id`
and `.name` are identical and come from an operator-entered `api_group` column.
For `financial` the values are `Zero`, `One`, `Two`, `Four`, `Ten`, and
`default`. No UI can organise anything by them; `aisa api show` flattens the
list and hides grouping behind `--group`.

**`/info/apis/:id/health` is provider-level, not endpoint-level.**
`buildCatalogHealth` passes `entry.endpoint.Provider` to `publicAPIHealth`, so
every endpoint in a provider carries the same verdict — `healthy_count` can only
ever be `0` or `endpoint_count`. A per-endpoint health table would be showing
one value repeated N times. Worth either surfacing it honestly as
provider-level, or implementing real per-endpoint checks.

**`/info/apis/category` reports every method as GET.**
`api_catalog_handlers.go:307` hardcodes `http.MethodGet`. Confirmed wrong in
practice: `/apis/v1/financial/financials/search/screener` is listed as GET but
returns `{"detail":"Method \"GET\" not allowed."}` and only works as POST.
Anything generating client code from the catalog — including `aisa api code` —
has to treat the method as advisory.

**Provider `id` is not always the URL slug.** `brave-search` serves
`/apis/v1/brave/...`, `kalshi-unauthorized` and the `polymarket-*` family are
similar. Consumers must derive the callable slug from `endpoints[].path` rather
than from `apis[].id`. Documenting this, or adding an explicit `slug` field,
would save every client the inference.

**Catalog responses have no `description` or `tags`.** The struct fields exist
with `omitempty` but `buildCatalogItem` never populates them, so there is
nothing to categorise or search on server-side. `aisa api list --category` uses
a client-side table as a result, which will drift as providers are added.
