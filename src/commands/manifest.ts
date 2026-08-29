import type { Command, Option, Argument } from "commander";

/**
 * The whole command tree as JSON, for the reader this CLI actually has most of:
 * another agent.
 *
 * `--help` is written for a person who can drill down. An agent gets one shot
 * at a top-level dump, and Commander's default renders every subcommand as a
 * bare `[options]` — the flags exist in its own metadata but never reach the
 * page. Tested on 2026-08-24 by handing an LLM nothing but `aisa --help` and
 * `aisa twitter --help`: it invented `--json` (the real flag is `--raw`) and
 * could not find `api show` at all, because the `api` subtree is invisible
 * from the top. Both are discovery failures, not reasoning failures, and both
 * disappear once the tree is dumped in full.
 *
 * Nothing here is written per command: Commander already holds the flags,
 * defaults, arguments and descriptions used to render help, so this walks that
 * same metadata. New commands appear in the manifest the day they are added,
 * with no second place to update.
 */

interface ManifestOption {
  flags: string;
  description: string;
  default?: unknown;
  /** Must this flag be passed at all. Nearly always false. */
  mandatory: boolean;
  /** "none" for a boolean switch, "required" for --f <v>, "optional" for --f [v]. */
  value: "none" | "required" | "optional";
}

interface ManifestArgument {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
}

interface ManifestCommand {
  path: string;
  description: string;
  usage: string;
  arguments: ManifestArgument[];
  options: ManifestOption[];
  subcommands: ManifestCommand[];
}

/**
 * Commander's `Option.required` means "this flag's *value* is required", not
 * "this flag is required" — `--limit <n>` sets it while being entirely
 * optional. Reporting it as `required` told an agent that almost every flag
 * had to be passed, which is worse than saying nothing: it turns a correct
 * command into an over-specified one. `mandatory` is the field that means
 * what it sounds like, and value-ness gets its own name.
 */
function describeOption(o: Option): ManifestOption {
  return {
    flags: o.flags,
    description: o.description,
    ...(o.defaultValue === undefined ? {} : { default: o.defaultValue }),
    mandatory: Boolean(o.mandatory),
    value: o.required ? "required" : o.optional ? "optional" : "none",
  };
}

function describeArgument(a: Argument): ManifestArgument {
  return {
    name: a.name(),
    description: a.description,
    required: a.required,
    variadic: a.variadic,
  };
}

/** Hidden commands are excluded: `__complete` is shell plumbing, and listing
 *  it invites an agent to call it as if it were a feature. */
function visible(cmd: Command): Command[] {
  return (cmd.commands as Command[]).filter((c) => !(c as unknown as { _hidden?: boolean })._hidden);
}

export function buildManifest(program: Command, prefix = ""): ManifestCommand {
  const path = prefix ? `${prefix} ${program.name()}` : program.name();
  const args = (program as unknown as { registeredArguments?: Argument[] }).registeredArguments ?? [];
  return {
    path,
    description: program.description(),
    usage: `${path} ${program.usage()}`.trim(),
    arguments: args.map(describeArgument),
    options: (program.options as Option[]).map(describeOption),
    subcommands: visible(program).map((c) => buildManifest(c, path)),
  };
}

export function manifestAction(program: Command): void {
  console.log(JSON.stringify(buildManifest(program), null, 2));
}
