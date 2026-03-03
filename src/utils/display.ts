import chalk from "chalk";

export function table(
  headers: string[],
  rows: string[][]
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || "").length))
  );

  const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const headerLine = headers
    .map((h, i) => ` ${chalk.bold(h.padEnd(widths[i]))} `)
    .join("│");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => ` ${(cell || "").padEnd(widths[i])} `).join("│")
  );

  return [headerLine, sep, ...dataLines].join("\n");
}

export function badge(text: string, color: "green" | "blue" | "yellow" | "red" | "gray" = "blue"): string {
  return chalk[color](`[${text}]`);
}

export function success(msg: string): void {
  console.log(chalk.green("✓") + " " + msg);
}

export function error(msg: string): void {
  console.error(chalk.red("✗") + " " + msg);
}

export function info(msg: string): void {
  console.log(chalk.blue("ℹ") + " " + msg);
}

export function hint(msg: string): void {
  console.log(chalk.gray("  " + msg));
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
