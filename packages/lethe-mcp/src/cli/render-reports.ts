// Human text for `check` findings, capped for hook delivery (Req 15.5, 15.6).
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function side(s: unknown): string {
  return isRecord(s) ? `${String(s["id"])} [${String(s["stance"])}]` : "?";
}

function resolutionText(r: unknown): string {
  if (!isRecord(r)) return "";
  if (r["kind"] === "resolved") return `winner ${String(r["winner"])} (${String(r["reason"])})`;
  return `unresolvable (${String(r["reason"])})`;
}

/** One line per report. */
export function reportLine(r: unknown): string {
  if (!isRecord(r)) return "- (unreadable report)";
  const head = `- [${String(r["severity"])}] ${String(r["axis"])}: ${side(r["a"])} vs ${side(r["b"])}`;
  return `${head}; ${resolutionText(r["resolution"])}`;
}

/** Summary line plus as many report lines as fit in `cap`; the last line names how many were cut. */
export function formatReports(summary: string, data: unknown, cap: number): string {
  const reports = isRecord(data) && Array.isArray(data["reports"]) ? (data["reports"] as unknown[]) : [];
  const footer = (n: number): string => `... +${n} more report${n === 1 ? "" : "s"} cut\n`;
  const lines: string[] = [];
  let used = summary.length + 1;
  for (let i = 0; i < reports.length; i += 1) {
    const line = reportLine(reports[i]) + "\n";
    const remaining = reports.length - i - 1;
    const reserve = remaining > 0 ? footer(remaining).length : 0;
    if (used + line.length + reserve > cap) {
      let cut = reports.length - i;
      while (lines.length > 0 && `${summary}\n${lines.join("")}${footer(cut)}`.length > cap) {
        lines.pop();
        cut += 1;
      }
      return `${summary}\n${lines.join("")}${footer(cut)}`.slice(0, cap);
    }
    lines.push(line);
    used += line.length;
  }
  return `${summary}\n${lines.join("")}`;
}
