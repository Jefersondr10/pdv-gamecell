import { runtime } from '@/lib/server/runtime';
import { json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const schema = await runtime()
      .DB.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ('sales', 'attachments', 'users', 'inventory_units', 'receipt_ocr_jobs', 'store_backup_alert_settings', 'file_deletion_jobs', 'sale_receipt_payment_sync')",
      )
      .first<{ count: number }>();
    if (Number(schema?.count) !== 8)
      return json({ ok: false }, { status: 503 });
    // Do not advertise a healthy release when its required additive migration is missing.
    await runtime().DB.prepare('SELECT name_key FROM clients LIMIT 0').all();
    await runtime().DB.batch([
      runtime().DB.prepare(
        'SELECT receipt_details_json,receipt_review_reason FROM attachments LIMIT 0',
      ),
      runtime().DB.prepare(
        'SELECT receipt_bank,receipt_recipient_document FROM pix_accounts LIMIT 0',
      ),
      runtime().DB.prepare(
        'SELECT attachment_id,payment_id,transaction_id FROM receipt_payment_links LIMIT 0',
      ),
    ]);
    return json({ ok: true });
  } catch {
    return json({ ok: false }, { status: 503 });
  }
}
