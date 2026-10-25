import type { ReactNode } from 'react';

type Tone = 'green' | 'red' | 'amber' | 'slate';

const toneClasses: Record<Tone, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const Badge = ({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}
  >
    {children}
  </span>
);
