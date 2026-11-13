// Writes MANUAL.md from the in-app guide (src/help.js), so the two always match.
// Run with: npm run manual
const fs = require("fs");
const path = require("path");
global.document = { addEventListener() {} };
const { HELP } = require(path.join(__dirname, "..", "src", "help.js"));

const out = ["# Ship's Log guide", "", "The same guide is inside the app: Settings > Guide, or press F1.", "", "## Contents", ""];
for (const s of HELP) out.push(`- [${s.title}](#${s.title.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-")})`);
for (const s of HELP) {
  out.push("", `## ${s.title}`, "");
  for (const b of s.body) {
    if (typeof b === "string") out.push(b, "");
    else if (Array.isArray(b)) { for (const li of b) out.push(`- ${li}`); out.push(""); }
    else if (b.keys) {
      out.push("| | |", "|---|---|");
      for (const [k, v] of b.keys) out.push(`| ${k.replace(/\|/g, "\\|")} | ${v.replace(/\|/g, "\\|")} |`);
      out.push("");
    }
  }
}
fs.writeFileSync(path.join(__dirname, "..", "MANUAL.md"), out.join("\n").replace(/\n{3,}/g, "\n\n"));
console.log("Wrote MANUAL.md");
