// GET  /api/votes  → { totals:[n,n,...], totalVoters, ideas, isOpen }
// POST /api/votes  → { userId, selectedIdeas:[0,2] } → 저장
// DELETE /api/votes + secret → 전체 초기화

const TURSO_URL    = process.env.TURSO_URL;
const TURSO_TOKEN  = process.env.TURSO_TOKEN;
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
        sql: `CREATE TABLE IF NOT EXISTS votes (
          user_id        TEXT PRIMARY KEY,
          selected_ideas TEXT NOT NULL,
          created_at     INTEGER NOT NULL
        )`,
      },
    },
    {
      type: "execute",
      stmt: { sql: "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)" },
    },
    {
      type: "execute",
      stmt: { sql: "INSERT OR IGNORE INTO config VALUES ('ideas','[]'),('maxVotes','2'),('isOpen','false')" },
    },
  ]);
}

async function getConfigMap() {
  const result = await sql([
    { type: "execute", stmt: { sql: "SELECT key, value FROM config" } },
  ]);
  const rows = result.results[0].response.result.rows;
  return Object.fromEntries(rows.map((r) => [r[0].value, r[1].value]));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    await init();

    if (req.method === "GET") {
      const cfg = await getConfigMap();
      const ideas    = JSON.parse(cfg.ideas ?? "[]");
      const isOpen   = cfg.isOpen === "true";

      const result   = await sql([
        { type: "execute", stmt: { sql: "SELECT selected_ideas FROM votes" } },
      ]);
      const rows = result.results[0].response.result.rows;

      const totals = new Array(ideas.length).fill(0);
      for (const row of rows) {
        const selected = JSON.parse(row[0].value);
        for (const idx of selected) {
          if (idx >= 0 && idx < totals.length) totals[idx]++;
        }
      }

      return res.status(200).json({ totals, totalVoters: rows.length, ideas, isOpen });
    }

    if (req.method === "POST") {
      const { userId, selectedIdeas } = req.body;
      if (!userId || !Array.isArray(selectedIdeas)) {
        return res.status(400).json({ error: "userId, selectedIdeas 필요" });
      }

      const cfg      = await getConfigMap();
      const isOpen   = cfg.isOpen === "true";
      const maxVotes = parseInt(cfg.maxVotes ?? "2");
      const ideaCount = JSON.parse(cfg.ideas ?? "[]").length;

      if (!isOpen) return res.status(403).json({ error: "투표가 열려있지 않습니다" });
      if (selectedIdeas.length > maxVotes) return res.status(400).json({ error: `최대 ${maxVotes}개 선택 가능` });
      if (selectedIdeas.some((i) => i < 0 || i >= ideaCount)) return res.status(400).json({ error: "잘못된 선택" });

      await sql([
        {
          type: "execute",
          stmt: {
            sql: "INSERT OR REPLACE INTO votes (user_id, selected_ideas, created_at) VALUES (?,?,?)",
            args: [
              { type: "text", value: userId },
              { type: "text", value: JSON.stringify(selectedIdeas) },
              { type: "text", value: String(Date.now()) },
            ],
          },
        },
      ]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { secret } = req.body;
      if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "인증 실패" });
      await sql([{ type: "execute", stmt: { sql: "DELETE FROM votes" } }]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
