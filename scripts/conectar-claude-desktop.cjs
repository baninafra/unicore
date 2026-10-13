// Conecta UniCore (MCP) a Claude Desktop. Correlo con Claude Desktop CERRADO: node scripts/conectar-claude-desktop.cjs
const fs = require("fs");
const path = require("path");

const exe = path.join(process.env.LOCALAPPDATA, "UniCore", "unicore.exe");
const files = [
  path.join(process.env.APPDATA, "Claude", "claude_desktop_config.json"),
  // Versión de Microsoft Store: la config vive dentro de su paquete.
  ...require("fs")
    .readdirSync(path.join(process.env.LOCALAPPDATA, "Packages"))
    .filter((d) => d.startsWith("Claude_"))
    .map((d) => path.join(process.env.LOCALAPPDATA, "Packages", d, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json")),
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f + ".bak-unicore", raw);
  const j = JSON.parse(raw);
  j.mcpServers = { ...(j.mcpServers || {}), unicore: { command: exe, args: ["--mcp"] } };
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  console.log("ok", f, JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8")).mcpServers));
}
