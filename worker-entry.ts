import handler from 'vinext/server/fetch-handler';

type WorkerEnvironment = {
  MIGRATION_TARGET_ORIGIN?: string;
  MIGRATION_PROXY_TOKEN?: string;
  MIGRATION_READ_ONLY?: string;
};

const worker = {
  async fetch(request: Request, env: WorkerEnvironment, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith('/api/') &&
      url.pathname !== '/api/system/migration-export'
    ) {
      if (env.MIGRATION_TARGET_ORIGIN) {
        const target = new URL(env.MIGRATION_TARGET_ORIGIN);
        if (
          target.protocol !== 'https:' ||
          target.origin === url.origin ||
          !env.MIGRATION_PROXY_TOKEN
        ) {
          return Response.json(
            { error: 'Serviço temporariamente indisponível.' },
            { status: 503 },
          );
        }
        const headers = new Headers(request.headers);
        for (const name of [
          'connection',
          'keep-alive',
          'proxy-authenticate',
          'proxy-authorization',
          'te',
          'trailer',
          'transfer-encoding',
          'upgrade',
          'host',
        ])
          headers.delete(name);
        headers.set('x-pdv-proxy-token', env.MIGRATION_PROXY_TOKEN);
        headers.set(
          'x-pdv-client-ip',
          request.headers.get('cf-connecting-ip') ?? 'unknown',
        );
        try {
          return await fetch(`${target.origin}${url.pathname}${url.search}`, {
            method: request.method,
            headers,
            body: ['GET', 'HEAD'].includes(request.method)
              ? undefined
              : request.body,
            redirect: 'manual',
            signal: AbortSignal.timeout(120_000),
          });
        } catch {
          // Never fall back to the frozen source database after cutover.
          return Response.json(
            {
              error:
                'O servidor está temporariamente indisponível. Tente novamente.',
              code: 'UPSTREAM_UNAVAILABLE',
            },
            { status: 503, headers: { 'cache-control': 'no-store' } },
          );
        }
      }
      if (env.MIGRATION_READ_ONLY === '1')
        return Response.json(
          {
            error:
              'Transferência segura do sistema em andamento. Aguarde alguns minutos.',
            code: 'MIGRATION_READ_ONLY',
          },
          {
            status: 503,
            headers: { 'cache-control': 'no-store', 'retry-after': '60' },
          },
        );
    }
    return handler.fetch(request, env, ctx);
  },
};
export default worker;
