const stl = require("./stlLite");

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
    if (!segs || segs.length < 2) return { invertible: false, reason: "custom reference key could not be resolved" };
    return { invertible: true, target: { ...base, namespace: segs[0], key: segs[1] }, via: "direct-custom" };
  }
  // results
  const tag = segs && segs[0];
  if (!tag) return { invertible: false, reason: "result tag could not be resolved" };
  const scope = getScope ? getScope(ref.handle) : null;
  const echoed = scope && scope.resultEchoes && scope.resultEchoes[tag];
  if (!echoed) {
    return {
      invertible: false,
      reason: `default comes from ${ref.handle}.results.${tag}, a computed result with no static custom echo — set ${ref.handle}'s inputs directly (mode 3) instead`,
      upstreamResult: { handle: ref.handle, tag, periodKey },
    };
  }
  const parts = String(echoed).split("."); // custom.ns.key
  if (parts.length < 3) return { invertible: false, reason: `result ${tag} echoes ${echoed}, which is not a custom` };
  return { invertible: true, target: { ...base, namespace: parts[1], key: parts.slice(2).join(".") }, via: `result-echo:${tag}` };
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
  const directHead = def.split("|")[0].trim();
  const directRef = parseUpstreamRef(directHead);
  if (directRef) {
    const segs = resolveSegments(directRef.tail, ctx.__env || {}, ctx);
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
      const head = rhs.split("|")[0].trim();
      const ref = parseUpstreamRef(head);
      captured = { ref, segs: ref ? resolveSegments(ref.tail, env, ctx) : null, rhs };
    },
  });
  if (!captured) return { invertible: false, reason: `could not find an assignment for ${def} in the template`, chain };
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
