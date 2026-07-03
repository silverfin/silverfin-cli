/**
 * Collects the exact custom writes performed to satisfy a request and renders them
 * as a human table + machine JSON, so the user always sees WHAT was changed, WHERE,
 * from WHICH old value, and WHY (which target field the upstream write was for).
 */

function fmt(v) {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

class ChangeReport {
  constructor() {
    this.changes = [];
    this.notes = [];
  }

  // change: { target, level, namespace, key, oldValue, newValue, why, applied }
  add(change) {
    this.changes.push(change);
    return this;
  }

  note(message) {
    this.notes.push(message);
    return this;
  }

  toJSON() {
    return { changes: this.changes, notes: this.notes };
  }

  toTable() {
    if (this.changes.length === 0) return "(no custom changes)";
    const headers = ["Target", "Level", "namespace.key", "old → new", "Why"];
    const rows = this.changes.map((c) => [
      String(c.target || ""),
      String(c.level || ""),
      `${c.namespace}.${c.key}`,
      `${fmt(c.oldValue)} → ${fmt(c.newValue)}`,
      String(c.why || ""),
    ]);
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
    const out = [line(headers), widths.map((w) => "─".repeat(w)).join("  "), ...rows.map(line)];
    if (this.notes.length) out.push("", ...this.notes.map((n) => "• " + n));
    return out.join("\n");
  }
}

module.exports = { ChangeReport, fmt };
