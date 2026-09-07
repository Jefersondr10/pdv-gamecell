'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SalesPeriod } from '@/lib/server/sales-filters';

const options: { value: SalesPeriod; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: '7d', label: 'Semana' },
  { value: '15d', label: '15 dias' },
  { value: 'day', label: 'Escolher dia' },
  { value: 'month', label: 'Escolher mês' },
  { value: 'all', label: 'Todo período' },
];

export function localDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function PeriodFilter({
  period,
  day,
  month,
  onPeriod,
  onDay,
  onMonth,
}: {
  period: SalesPeriod;
  day: string;
  month: string;
  onPeriod: (value: SalesPeriod) => void;
  onDay: (value: string) => void;
  onMonth: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Select
        value={period}
        onValueChange={(value) => {
          if (value) onPeriod(value as SalesPeriod);
        }}
      >
        <SelectTrigger
          size="lg"
          aria-label="Período do ranking"
          className="h-11 min-w-40 flex-1 rounded-xl font-bold"
        >
          <SelectValue>
            {options.find((item) => item.value === period)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="rounded-xl p-1.5">
          {options.map((item) => (
            <SelectItem
              className="min-h-11 rounded-lg text-sm font-semibold"
              key={item.value}
              value={item.value}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {period === 'day' && (
        <Input
          aria-label="Dia do ranking"
          className="h-11 w-full sm:w-44"
          type="date"
          value={day}
          onChange={(event) => onDay(event.target.value)}
        />
      )}
      {period === 'month' && (
        <Input
          aria-label="Mês do ranking"
          className="h-11 w-full sm:w-44"
          type="month"
          value={month}
          onChange={(event) => onMonth(event.target.value)}
        />
      )}
    </div>
  );
}
