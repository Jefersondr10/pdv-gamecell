import { runtime } from '@/lib/server/runtime';
import { json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const schema = await runtime().DB.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ('sales', 'attachments', 'users', 'inventory_units')").first<{ count: number }>();
    if (Number(schema?.count) !== 4) return json({ ok: false }, { status: 503 });
    return json({ ok: true });
  } catch {
    return json({ ok: false }, { status: 503 });
  }
}
