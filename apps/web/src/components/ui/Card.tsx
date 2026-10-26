import type { HTMLAttributes } from 'react';

export const Card = ({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    {...props}
  />
);

export const CardHeader = ({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`border-b border-slate-200 px-5 py-4 dark:border-slate-800 ${className}`}
    {...props}
  />
);

export const CardBody = ({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={`px-5 py-4 ${className}`} {...props} />
);
