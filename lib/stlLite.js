/**
 * stlLite — a deliberately MINIMAL, SAFE evaluator for a bounded subset of STL,
 * used only to resolve input-default variables that reduce to a *lookup into
 * already-captured live data* (a cross-template result/custom indexed by a
 * date-derived dynamic key, with branch selection).
 *
 * Design rules:
 *  - It supports only a whitelist of constructs (assign, capture, if/elsif/else,
 *    comment) and filters (date, default, a few string/arith helpers). Anything
 *    it does not understand (currency, MAX(), infix math, for-loops, includes)
 *    is SKIPPED — the affected variable stays undefined. It NEVER fabricates a
 *    value, so a resolved value is always derived entirely from captured data.
 *  - Block boundaries for unsupported constructs (for/case/tablerow/unless) are
 *    still tracked so nesting never desyncs; their bodies are just not executed.
 *
 * This is NOT a Silverfin engine. Values it produces MUST still be validated
 * against a live render/results (silent `default:0` masking is real).
 */

const UNRESOLVED = Symbol("unresolved");

// ---- tokenizer -------------------------------------------------------------
function tokenize(src) {
  const tokens = [];
  const re = /\{\{-?\s*([\s\S]*?)\s*-?\}\}|\{%-?\s*([\s\S]*?)\s*-?%\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: src.slice(last, m.index) });
    if (m[1] !== undefined) {
      tokens.push({ type: "output", expr: m[1] });
    } else {
      const body = m[2].trim();
      const name = body.split(/\s+/, 1)[0];
      tokens.push({ type: "tag", name, body, rest: body.slice(name.length).trim() });
    }
    last = re.lastIndex;
  }
  if (last < src.length) tokens.push({ type: "text", value: src.slice(last) });
  return tokens;
}

// ---- parser (block tree) ---------------------------------------------------
const BLOCK_OPENERS = { if: "endif", unless: "endunless", for: "endfor", case: "endcase", capture: "endcapture", comment: "endcomment", tablerow: "endtablerow", ifi: "endifi", fori: "endfori" };

function parse(tokens) {
  let i = 0;
  function parseUntil(closers) {
    const nodes = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.type === "tag" && closers.includes(t.name)) return nodes;
      if (t.type === "text" || t.type === "output") { nodes.push(t); i++; continue; }
      const closer = BLOCK_OPENERS[t.name];
      if (closer) {
        i++;
        if (t.name === "if" || t.name === "unless" || t.name === "ifi") {
          const branches = [{ cond: t.rest, negate: t.name === "unless", body: parseUntil(["elsif", "else", closer]) }];
          while (i < tokens.length && tokens[i].type === "tag" && (tokens[i].name === "elsif" || tokens[i].name === "else")) {
            const b = tokens[i]; i++;
            branches.push({ cond: b.name === "else" ? null : b.rest, body: parseUntil(["elsif", "else", closer]) });
          }
          if (i < tokens.length) i++; // consume endif
          nodes.push({ type: "if", branches });
        } else if (t.name === "capture") {
          const body = parseUntil([closer]);
          if (i < tokens.length) i++;
          nodes.push({ type: "capture", name: t.rest, body });
        } else {
          // unsupported block (for/case/comment/...): track nesting, don't execute
          const body = parseUntil([closer]);
          if (i < tokens.length) i++;
          nodes.push({ type: "skip", name: t.name, body });
        }
      } else {
        nodes.push(t); i++;
      }
    }
    return nodes;
  }
  return parseUntil([]);
}

// ---- date (strftime subset) ------------------------------------------------
function strftime(dateStr, fmt) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return UNRESOLVED;
  const [, Y, Mo, D] = m;
  return fmt.replace(/%([YymdA-Za-z])/g, (_, c) => {
    switch (c) {
      case "Y": return Y;
      case "y": return Y.slice(2);
      case "m": return Mo;
      case "d": return D;
      default: return "%" + c;
    }
  });
}

// ---- value helpers ---------------------------------------------------------
function unquote(s) {
  const q = s.match(/^["']([\s\S]*)["']$/);
  return q ? q[1] : null;
}
function toNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

// ---- expression evaluation -------------------------------------------------
function resolvePath(path, env, ctx) {
  // path like a.b.[c].d  — supports .key, .[var-or-literal] dynamic access
  const parts = [];
  let buf = "";
  for (let k = 0; k < path.length; k++) {
    const ch = path[k];
    if (ch === ".") { if (buf) { parts.push({ key: buf }); buf = ""; } }
    else if (ch === "[") {
      if (buf) { parts.push({ key: buf }); buf = ""; }
      const end = path.indexOf("]", k);
      if (end === -1) return UNRESOLVED;
      parts.push({ dyn: path.slice(k + 1, end) });
      k = end;
    } else buf += ch;
  }
  if (buf) parts.push({ key: buf });

  let cur = undefined;
  for (let p = 0; p < parts.length; p++) {
    let key;
    if (parts[p].dyn !== undefined) {
      const dv = evalExpr(parts[p].dyn, env, ctx);
      if (dv === UNRESOLVED || dv == null) return UNRESOLVED;
      key = String(dv);
    } else key = parts[p].key;

    if (p === 0) {
      if (key in env) cur = env[key];
      else if (key in ctx) cur = ctx[key];
      else return UNRESOLVED;
    } else {
      if (cur == null || typeof cur !== "object") return UNRESOLVED;
      if (!(key in cur)) return undefined; // known object, absent key -> undefined (feeds default)
      cur = cur[key];
    }
  }
  return cur;
}

function applyFilter(value, name, args, env, ctx) {
  const a = args.map((x) => {
    const u = unquote(x);
    if (u !== null) return u;
    const n = toNum(x);
    if (n !== null) return n;
    const v = evalExpr(x, env, ctx);
    return v === UNRESOLVED ? undefined : v;
  });
  switch (name) {
    case "default": return value === undefined || value === null || value === "" ? a[0] : value;
    case "date": return value == null ? value : strftime(value, a[0]);
    case "upcase": return String(value).toUpperCase();
    case "downcase": return String(value).toLowerCase();
    case "strip": return String(value).trim();
    case "append": return String(value) + String(a[0]);
    case "prepend": return String(a[0]) + String(value);
    case "plus": return toNum(value) + toNum(a[0]);
    case "minus": return toNum(value) - toNum(a[0]);
    case "times": return toNum(value) * toNum(a[0]);
    case "divided_by": return toNum(value) / toNum(a[0]);
    case "round": { const n = toNum(value); return a[0] != null ? Number(n.toFixed(a[0])) : Math.round(n); }
    case "integer": case "floor": return Math.floor(toNum(value));
    default: return UNRESOLVED; // unsupported filter -> unresolved (never fabricate)
  }
}

function splitTopLevel(str, sep) {
  const out = [];
  let buf = "", depth = 0, q = null;
  for (const ch of str) {
    if (q) { buf += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; buf += ch; continue; }
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  out.push(buf);
  return out;
}

function evalExpr(expr, env, ctx) {
  expr = expr.trim();
  if (expr === "") return "";
  const segments = splitTopLevel(expr, "|").map((s) => s.trim());
  const head = segments[0];
  let value;
  const u = unquote(head);
  if (u !== null) value = u;
  else if (/^-?\d+(\.\d+)?$/.test(head)) value = Number(head);
  else if (head === "true" || head === "false") value = head === "true";
  else if (head === "blank" || head === "empty" || head === "nil" || head === "null") value = "";
  else if (/[+\-*/]/.test(head) && !/^[\w.[\]]+$/.test(head)) return UNRESOLVED; // infix math -> unsupported
  else value = resolvePath(head, env, ctx);
  if (value === UNRESOLVED) return UNRESOLVED;

  for (let s = 1; s < segments.length; s++) {
    const fm = segments[s].match(/^([a-z_]+)\s*:?\s*([\s\S]*)$/i);
    if (!fm) return UNRESOLVED;
    const fname = fm[1];
    const fargs = fm[2].trim() === "" ? [] : splitTopLevel(fm[2], ",").map((x) => x.trim());
    value = applyFilter(value, fname, fargs, env, ctx);
    if (value === UNRESOLVED) return UNRESOLVED;
  }
  return value;
}

function evalCondition(cond, env, ctx) {
  if (cond == null) return true;
  // handle 'or' then 'and' (no parens support)
  const ors = splitTopLevel(cond, "\n").length > 1 ? [cond] : cond.split(/\s+or\s+/i);
  for (const orPart of ors) {
    const ands = orPart.split(/\s+and\s+/i);
    let all = true;
    for (const clause of ands) {
      if (!evalClause(clause.trim(), env, ctx)) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

function evalClause(clause, env, ctx) {
  const m = clause.match(/^([\s\S]+?)\s*(==|!=|>=|<=|>|<|contains)\s*([\s\S]+)$/);
  if (!m) {
    const v = evalExpr(clause, env, ctx);
    return v !== UNRESOLVED && v !== undefined && v !== null && v !== false && v !== "";
  }
  const l = evalExpr(m[1].trim(), env, ctx);
  const r = evalExpr(m[3].trim(), env, ctx);
  if (l === UNRESOLVED || r === UNRESOLVED) return false;
  const ln = toNum(l), rn = toNum(r);
  const num = ln !== null && rn !== null;
  switch (m[2]) {
    case "==": return String(l) === String(r);
    case "!=": return String(l) !== String(r);
    case ">=": return num ? ln >= rn : String(l) >= String(r);
    case "<=": return num ? ln <= rn : String(l) <= String(r);
    case ">": return num ? ln > rn : String(l) > String(r);
    case "<": return num ? ln < rn : String(l) < String(r);
    case "contains": return String(l).includes(String(r));
    default: return false;
  }
}

// ---- evaluator -------------------------------------------------------------
function renderText(nodes, env, ctx) {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") out += n.value;
    else if (n.type === "output") { const v = evalExpr(n.expr, env, ctx); if (v === UNRESOLVED) return UNRESOLVED; out += v == null ? "" : String(v); }
    else return UNRESOLVED; // capture body with logic -> unsupported
  }
  return out;
}

function evaluate(nodes, env, ctx) {
  for (const n of nodes) {
    if (n.type === "tag" && n.name === "assign") {
      const eq = n.rest.indexOf("=");
      if (eq === -1) continue;
      const name = n.rest.slice(0, eq).trim();
      const v = evalExpr(n.rest.slice(eq + 1).trim(), env, ctx);
      if (v !== UNRESOLVED) env[name] = v; // else: leave undefined (never fabricate)
    } else if (n.type === "capture") {
      const v = renderText(n.body, env, ctx);
      if (v !== UNRESOLVED) env[n.name] = v;
    } else if (n.type === "if") {
      for (const b of n.branches) {
        let take;
        if (b.cond === null) take = true;
        else { take = evalCondition(b.cond, env, ctx); if (b.negate) take = !take; }
        if (take) { evaluate(b.body, env, ctx); break; }
      }
    }
    // text/output/skip: no effect on variable state
  }
  return env;
}

/**
 * Execute `liquid` against `ctx` and return the resulting variable environment.
 * Only variables derivable from the supported subset + captured data are set.
 */
function run(liquid, ctx) {
  const env = {};
  evaluate(parse(tokenize(liquid)), env, ctx);
  return env;
}

module.exports = { run, tokenize, parse, evaluate, evalExpr, evalCondition, strftime, UNRESOLVED };
