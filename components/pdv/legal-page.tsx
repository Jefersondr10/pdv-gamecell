import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export function LegalPage({
  title,
  introduction,
  children,
}: {
  title: string;
  introduction: string;
  children: ReactNode;
}) {
  return (
    <main className="h-dvh overflow-y-auto overscroll-contain bg-[#07182c] px-4 py-8 text-slate-900 sm:py-12">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/20">
        <header className="border-b border-slate-200 px-6 py-7 sm:px-10">
          <Link
            className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"
            href="/"
          >
            <ArrowLeft className="size-4" /> Voltar ao AtacadoApple PDV
          </Link>
          <div className="mt-6 flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700">
              <ShieldCheck className="size-6" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
                AtacadoApple PDV
              </p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
                {title}
              </h1>
              <p className="mt-3 leading-7 text-slate-600">{introduction}</p>
              <p className="mt-2 text-xs text-slate-500">
                Última atualização: 6 de setembro de 2026
              </p>
            </div>
          </div>
        </header>
        <div className="legal-content space-y-7 px-6 py-8 sm:px-10">
          {children}
        </div>
        <footer className="flex flex-wrap gap-4 border-t border-slate-200 bg-slate-50 px-6 py-5 text-sm sm:px-10">
          <Link
            className="font-semibold text-blue-700 hover:underline"
            href="/privacidade"
          >
            Privacidade
          </Link>
          <Link
            className="font-semibold text-blue-700 hover:underline"
            href="/termos"
          >
            Termos de uso
          </Link>
          <a
            className="font-semibold text-blue-700 hover:underline"
            href="mailto:jefersondr10@gmail.com"
          >
            Contato
          </a>
        </footer>
      </article>
    </main>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-3 leading-7 text-slate-600">{children}</div>
    </section>
  );
}
