'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

type FlowFrameProps = {
  eyebrow: string;
  title: string;
  description: string;
  steps: readonly string[];
  currentStep: number;
  children: ReactNode;
  announcement?: string;
};

export function FlowFrame({
  eyebrow,
  title,
  description,
  steps,
  currentStep,
  children,
  announcement = '',
}: FlowFrameProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [currentStep, description, title]);

  return (
    <div className="flow-shell flex h-full min-h-0 flex-col overflow-hidden px-3 py-2 lg:px-10 lg:py-4">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
        <header className="flow-header shrink-0 pb-2 lg:pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">{eyebrow}</p>
              <h1
                className="mt-0.5 truncate text-xl font-bold tracking-[-0.035em] outline-none lg:text-2xl"
                ref={titleRef}
                tabIndex={-1}
              >
                {title}
              </h1>
              <p className="flow-description mt-1 hidden truncate text-sm text-muted-foreground lg:block">
                {description}
              </p>
            </div>
            <Badge className="mt-1 h-8 shrink-0 bg-primary/8 px-3 text-primary hover:bg-primary/8">
              <span className="lg:hidden">
                {steps[currentStep]} · {currentStep + 1}/{steps.length}
              </span>
              <span className="hidden lg:inline">
                Etapa {currentStep + 1} de {steps.length}
              </span>
            </Badge>
          </div>

          <ol
            aria-label="Progresso do fluxo"
            className="flow-progress mt-2 grid gap-1.5 lg:mt-3"
            style={{
              gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
            }}
          >
            {steps.map((step, index) => {
              const complete = index < currentStep;
              const active = index === currentStep;
              return (
                <li key={step}>
                  <span className="sr-only">
                    {step}:{' '}
                    {complete ? 'concluída' : active ? 'atual' : 'pendente'}
                  </span>
                  <div
                    aria-current={active ? 'step' : undefined}
                    className={`h-1.5 rounded-full transition-colors ${complete ? 'bg-success' : active ? 'bg-primary' : 'bg-border'}`}
                  />
                  <div className="mt-1 hidden items-center gap-1.5 lg:flex">
                    {complete && <Check className="size-3.5 text-success" />}
                    <span
                      className={`truncate text-xs font-semibold ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                    >
                      {step}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </div>
  );
}
