import { requireSession } from '@/lib/server/auth';
import { apiError, HttpError, json } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { backupStatus } from '@/lib/backup-status';
export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    if (!['owner', 'admin'].includes(session.role!))
      throw new HttpError(403, 'Acesso restrito à administração.', 'FORBIDDEN');
    const raw = await runtime().READ_BACKUP_STATUS?.();
    return json(backupStatus(raw?.successAt, Boolean(raw?.failed)));
  } catch (error) {
    return apiError(error);
  }
}
