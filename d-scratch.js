const { describeVisualChange } = require("./lib/liquidSamplerCompact");
for (const depth of [2000, 5000, 10000]) {
  const a = "<div>".repeat(depth) + "x";
  const b = "<div>".repeat(depth) + "y";
  try { describeVisualChange(a, b); console.log(depth, "ok"); }
  catch (e) { console.log(depth, "THREW", e.constructor.name, e.message.slice(0, 60)); }
}
const t0 = Date.now();
const nest = (n) => "<table><tr><td>".repeat(n) + "x" + "</td></tr></table>".repeat(n);
try { describeVisualChange(nest(200), nest(200).replace("x","y")); console.log("nested200 ms:", Date.now()-t0); }
catch (e) { console.log("nested200 THREW", e.constructor.name); }
