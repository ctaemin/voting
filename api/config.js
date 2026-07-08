// GET  /api/config  → { ideas, maxVotes, isOpen }
// POST /api/config  → { secret, ideas, maxVotes, isOpen } → 저장

const TURSO_URL   = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "1234";

async function sql(statements) {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TURSO_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests: [...statements, { type: "close" }] }),
  });
  if (!res.ok) throw new Error(`Turso error: ${res.status}`);
  return res.json();
}

async function init() {
  await sql([
    {
      type: "execute",
      stmt: {
        sql: `CREATE TABLE IF NOT EXISTS config (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
      },
    },
    {
      type: "execute",
      stmt: {
        sql: `INSERT OR IGNORE INTO config VALUES ('ideas','[]'),('maxVotes','2'),('isOpen','false')`,
      },
    },
  ]);
}

async function getConfig() {
  const result = await sql([
    { type: "execute", stmt: { sql: "SELECT key, value FROM config" } },
  ]);
  const rows = result.results[0].response.result.rows;
  const map = Object.fromEntries(rows.map((r) => [r[0].value, r[1].value]));
  return {
    ideas:    JSON.parse(map.ideas    ?? "[]"),
    maxVotes: parseInt(map.maxVotes   ?? "2"),
    isOpen:   map.isOpen === "true",
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    await init();

    if (req.method === "GET") {
      return res.status(200).json(await getConfig());
    }

    if (req.method === "POST") {
      const { secret, ideas, maxVotes, isOpen } = req.body;
      if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "인증 실패" });

      await sql([
        { type: "execute", stmt: { sql: "UPDATE config SET value=? WHERE key='ideas'",    args: [{ type: "text", value: JSON.stringify(ideas) }] } },
        { type: "execute", stmt: { sql: "UPDATE config SET value=? WHERE key='maxVotes'", args: [{ type: "text", value: String(maxVotes) }] } },
        { type: "execute", stmt: { sql: "UPDATE config SET value=? WHERE key='isOpen'",   args: [{ type: "text", value: String(isOpen) }] } },
      ]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
