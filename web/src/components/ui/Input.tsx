import type { ComponentPropsWithRef, LabelHTMLAttributes } from 'react';

// React 19: `ref` is an ordinary prop on function components, so forms can focus inputs without forwardRef.
export const Input = ({ className = '', ...props }: ComponentPropsWithRef<'input'>) => (
  <input
    className={`focus-ring w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${className}`}
    {...props}
  />
);

export const Label = ({ className = '', ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label
    className={`mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300 ${className}`}
    {...props}
  />
);
