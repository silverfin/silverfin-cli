const fs = require("fs");
const stl = require("./stlLite");

// Trace ONE hop into an upstream handle's own liquid to see how it produces a
// (possibly dynamically-named) result `tag`: statically match its {% result %}
// whose tag (a literal, or a variable captured as PREFIX_{{…}}) covers `tag`, then
// analyse the result's VALUE. Auto-invertible only when the value is a direct
// custom; otherwise report what it actually is (a computed value) so the caller can
// surface a deeper, actionable chain. Never guesses. No execution, no extra API.
function traceUpstreamResultProduction(handle, tag, getScope) {
  const scope = getScope ? getScope(handle) : null;
  if (!scope || !scope.involvedFiles) return null;
  let liquid = "";
  for (const f of scope.involvedFiles) { try { liquid += "\n" + fs.readFileSync(f, "utf8"); } catch { /* skip */ } }

  // capture VAR -> a regex covering its literal text with {{…}} as wildcards.
  const captures = {};
  const capRe = /\{%-?\s*capture\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*-?%\}([\s\S]*?)\{%-?\s*endcapture\s*-?%\}/g;
  let cm;
  while ((cm = capRe.exec(liquid)) !== null) {
    const esc = cm[2].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{\\\{[\s\S]*?\\\}\\\}/g, ".+");
    captures[cm[1]] = "^" + esc + "$";
  }

  const resRe = /\{%-?\s*result\s+(\S+)\s+([\s\S]+?)\s*-?%\}/g;
  let rm;
  while ((rm = resRe.exec(liquid)) !== null) {
    const tagRef = rm[1];
    const valueRef = rm[2].trim();
    let pattern = null;
    const q = tagRef.match(/^['"](.*)['"]$/);
    if (q) pattern = "^" + q[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
    else {
      const varName = tagRef.replace(/^\[|\]$/g, "");
      if (captures[varName]) pattern = captures[varName];
    }
    if (!pattern) continue;
    let matches = false;
    try { matches = new RegExp(pattern).test(tag); } catch { matches = false; }
    if (!matches) continue;

    const vHead = valueRef.split("|")[0].trim();
    const mCustom = vHead.match(/^custom\.([a-z0-9_]+)\.([a-z0-9_]+)$/i);
    if (mCustom) return { invertible: true, target: { handle, namespace: mCustom[1], key: mCustom[2] }, via: `result-production:${tag}`, valueExpr: valueRef };
    const mDyn = vHead.match(/^custom\.([a-z0-9_]+)\.\[/i);
    if (mDyn) return { invertible: false, reason: `${handle} produces ${tag} from custom.${mDyn[1]}.<dynamic key> — set that custom directly for the matching period/key`, valueExpr: valueRef };
    return { invertible: false, reason: `${handle} produces ${tag} from a computed value (${valueRef.trim()}) — not a single settable custom; set ${handle}'s underlying inputs`, valueExpr: valueRef };
  }
  return null;
}

/**
 * Reverse provenance: given a target input whose value comes from a DEFAULT, find
 * the single upstream CUSTOM that should be set so the default becomes the desired
 * value — or explain why it isn't auto-invertible (computed / branch-gated / a
 * dynamic result with no static echo / account-derived). Never guesses.
 *
 * A default is auto-invertible when it reduces to:
 *   - a direct cross-template custom:  period[.minus_Ny].reconciliations.<h>.custom.<ns>.<key>
 *   - a cross-template result that <h> produces by directly echoing one of its own
 *     customs:  {% result 'tag' custom.<ns>.<key> %}  (resolved via <h>'s data scope)
 */

// period[.minus_Ny].reconciliations.<handle>.(results|custom)<tail>
function parseUpstreamRef(head) {
  let periodOffset = 0;
  let rest = head.trim();
  let m = rest.match(/^period\.minus_(\d+)y\.(.+)$/i);
  if (m) {
    periodOffset = Number(m[1]);
    rest = m[2];
  } else {
    m = rest.match(/^period\.(.+)$/i);
    if (!m) return null;
    rest = m[1];
  }
  m = rest.match(/^reconciliations\.([a-z0-9_]+)\.(results|custom)(.*)$/i);
  if (!m) return null;
  return { periodOffset, handle: m[1], kind: m[2].toLowerCase(), tail: m[3] || "" };
}

// Split on top-level | (respecting [] and quotes).
function splitPipes(s) {
  const out = [];
  let buf = "", depth = 0, q = null;
  for (const ch of s) {
    if (q) { buf += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; buf += ch; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (ch === "|" && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  out.push(buf);
  return out;
}

// The head of an expression, ONLY if it carries no value-changing filter (a
// `| times:2`, `| currency`, `| round`, … makes the default non-invertible — the
// raw upstream custom is not what the field ends up showing). `default` is the one
// safe filter (it no-ops once the upstream custom is set). Returns null if unsafe.
function safeHead(expr) {
  const segs = splitPipes(String(expr));
  for (let i = 1; i < segs.length; i++) {
    const fname = segs[i].trim().split(/[:\s]/)[0].toLowerCase();
    if (fname !== "default") return null;
  }
  return segs[0].trim();
}

// Resolve ".a.[b].c" against an env into ["a", <resolved b>, "c"] (dynamic keys first).
function resolveSegments(tail, env, ctx) {
  const segs = [];
  let i = 0;
  while (i < tail.length) {
    const c = tail[i];
    if (c === ".") { i++; continue; }
    if (c === "[") {
      const end = tail.indexOf("]", i);
      if (end === -1) return null;
      const v = stl.evalExpr(tail.slice(i + 1, end), env, ctx);
      if (v === stl.UNRESOLVED || v == null) return null;
      segs.push(String(v));
      i = end + 1;
    } else {
      let j = i;
      while (j < tail.length && tail[j] !== "." && tail[j] !== "[") j++;
      segs.push(tail.slice(i, j));
      i = j;
    }
  }
  return segs;
}

// Turn a resolved upstream ref into a settable-custom target, resolving a result
// tag to its producing custom via the upstream handle's data scope when needed.
function classify(ref, segs, deep, getScope) {
  const periodKey = (deep.periodOrder || [])[ref.periodOffset] || null;
  const base = { handle: ref.handle, periodOffset: ref.periodOffset, periodKey };
  if (ref.kind === "custom") {
    // A settable custom is exactly namespace.key. More segments (e.g.
    // custom.ns.key.value) is a FIELD access on the custom, not the custom itself
    // — writing custom.ns.key would not change what the field reads, so refuse.
    if (!segs || segs.length !== 2) {
      return { invertible: false, reason: "reference is not a plain custom.namespace.key (dynamic/field access or unresolved) — not auto-invertible" };
    }
    return { invertible: true, target: { ...base, namespace: segs[0], key: segs[1] }, via: "direct-custom" };
  }
  // results
  const tag = segs && segs[0];
  if (!tag) return { invertible: false, reason: "result tag could not be resolved" };
  const scope = getScope ? getScope(ref.handle) : null;
  const echoed = scope && scope.resultEchoes && scope.resultEchoes[tag];
  if (echoed) {
    const parts = String(echoed).split("."); // custom.ns.key
    if (parts.length >= 3) return { invertible: true, target: { ...base, namespace: parts[1], key: parts.slice(2).join(".") }, via: `result-echo:${tag}` };
  }
  // One hop deeper: how does <handle> actually produce this (possibly dynamic) result?
  const prod = traceUpstreamResultProduction(ref.handle, tag, getScope);
  if (prod && prod.invertible) {
    return { invertible: true, target: { ...base, namespace: prod.target.namespace, key: prod.target.key }, via: prod.via };
  }
  return {
    invertible: false,
    reason: (prod && prod.reason) || `default comes from ${ref.handle}.results.${tag}, a computed result with no static custom echo — set ${ref.handle}'s inputs directly (mode 3) instead`,
    upstreamResult: { handle: ref.handle, tag, periodKey, valueExpr: prod && prod.valueExpr },
  };
}

/**
 * @param {Object} input describe-inputs row (has .input, .default)
 * @param {String} involvedLiquid concatenated involved-file liquid
 * @param {Object} ctx offline-evaluator context (from buildContext)
 * @param {Object} deep the deep fixture (for periodOrder)
 * @param {Function} [getScope] handle -> data scope (for result-echo tracing)
 * @returns {Object} { invertible, target?, via?, reason?, chain }
 */
function traceDefault(input, involvedLiquid, ctx, deep, getScope) {
  const def = String(input.default || "").trim();
  const label = input.input || input.path || "input";
  const chain = [`${label} default = ${def || "(none)"}`];
  if (!def) return { invertible: false, reason: "input has no default", chain };

  // Direct reference in the default expression itself.
  const directHead = safeHead(def);
  if (directHead === null) {
    return { invertible: false, reason: `default applies a value-changing filter (${def}) — not auto-invertible`, chain };
  }
  const directRef = parseUpstreamRef(directHead);
  if (directRef) {
    const segs = resolveSegments(directRef.tail, {}, ctx);
    chain.push(`${directRef.handle}.${directRef.kind}${directRef.tail}`);
    return { ...classify(directRef, segs, deep, getScope), chain };
  }

  // Variable default: trace to the RHS of its taken assignment.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(def)) {
    return { invertible: false, reason: "default is a computed expression, not a single reference", chain };
  }
  let captured = null;
  stl.run(involvedLiquid, ctx, {
    onAssign: (name, rhs, value, env) => {
      if (name !== def) return;
      const head = safeHead(rhs);
      if (head === null) { captured = { ref: null, rhs, filtered: true }; return; }
      const ref = parseUpstreamRef(head);
      captured = { ref, segs: ref ? resolveSegments(ref.tail, env, ctx) : null, rhs };
    },
  });
  if (!captured) return { invertible: false, reason: `could not find an assignment for ${def} in the template`, chain };
  if (captured.filtered) {
    chain.push(`${def} = ${captured.rhs}`);
    return { invertible: false, reason: `${def} applies a value-changing filter (${captured.rhs.trim()}) — not auto-invertible`, chain };
  }
  if (!captured.ref) {
    chain.push(`${def} = ${captured.rhs}`);
    return { invertible: false, reason: `${def} is computed (${captured.rhs.trim()}), not a single cross-template reference`, chain };
  }
  chain.push(`${def} = ${captured.ref.handle}.${captured.ref.kind}${captured.ref.tail}`);
  const cls = classify(captured.ref, captured.segs, deep, getScope);
  if (cls.target) chain.push(`set ${cls.target.handle}.custom.${cls.target.namespace}.${cls.target.key}`);
  return { ...cls, chain };
}

module.exports = { traceDefault, parseUpstreamRef, resolveSegments, classify };
