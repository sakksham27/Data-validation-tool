/**
 * Data Health Lab — Worker backend (optional).
 *
 * Free-tier Cloudflare Workers + Workers AI.
 * Supports Postgres-compatible databases (Neon, Supabase, RDS Postgres, etc)
 * via postgres.js over Cloudflare's native TCP socket support.
 *
 * Endpoints:
 *   POST /api/db/tables   { connectionString }                    -> { tables: [{name, schema, approxRows}] }
 *   POST /api/db/sample   { connectionString, tableName, limit }  -> { rows: [...] }
 *   POST /api/ai/suggest  { profileSummary }                       -> { suggestion: "..." }
 *
 * The connection string is used only for the lifetime of a single request
 * and is never logged or persisted by this Worker.
 */
import postgres from 'postgres';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function isSafeIdentifier(name) {
  // conservative: letters, numbers, underscore only, must start with letter/underscore
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

async function withConnection(connectionString, fn) {
  const sql = postgres(connectionString, {
    ssl: 'require',
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function handleListTables(request) {
  const { connectionString } = await request.json();
  if (!connectionString) return json({ error: 'connectionString is required' }, 400);

  try {
    const tables = await withConnection(connectionString, async (sql) => {
      const rows = await sql`
        SELECT
          schemaname AS schema,
          relname AS name,
          n_live_tup AS approx_rows
        FROM pg_stat_user_tables
        ORDER BY schemaname, relname
      `;
      return rows.map((r) => ({ schema: r.schema, name: r.name, approxRows: Number(r.approx_rows) }));
    });
    return json({ tables });
  } catch (err) {
    return json({ error: `Could not connect or list tables: ${err.message}` }, 500);
  }
}

async function handleSample(request) {
  const { connectionString, tableName, limit } = await request.json();
  if (!connectionString || !tableName) return json({ error: 'connectionString and tableName are required' }, 400);
  if (!isSafeIdentifier(tableName)) return json({ error: 'Invalid table name' }, 400);
  const safeLimit = Math.min(Math.max(Number(limit) || 2000, 1), 5000);

  try {
    const rows = await withConnection(connectionString, async (sql) => {
      // tableName already validated against a strict identifier regex above
      return sql.unsafe(`SELECT * FROM ${tableName} LIMIT ${safeLimit}`);
    });
    return json({ rows });
  } catch (err) {
    return json({ error: `Could not sample table: ${err.message}` }, 500);
  }
}

async function handleAiSuggest(request, env) {
  const { profileSummary } = await request.json();
  if (!profileSummary) return json({ error: 'profileSummary is required' }, 400);
  if (!env.AI) return json({ error: 'Workers AI binding not configured on this Worker.' }, 500);

  const prompt = `You are a data quality assistant. Given this JSON profile of a database table, write a short, plain-English diagnostic note (5-8 sentences) covering: overall health, the most concerning columns, likely root causes for missing/anomalous data, and prioritized next steps. Be specific and reference column names. Do not repeat the raw JSON back.

Profile:
${JSON.stringify(profileSummary, null, 2)}`;

  try {
    const result = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    });
    return json({ suggestion: result.response || JSON.stringify(result) });
  } catch (err) {
    return json({ error: `AI request failed: ${err.message}` }, 500);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/db/tables') return handleListTables(request);
    if (request.method === 'POST' && url.pathname === '/api/db/sample') return handleSample(request);
    if (request.method === 'POST' && url.pathname === '/api/ai/suggest') return handleAiSuggest(request, env);
    return json({ error: 'Not found' }, 404);
  },
};
