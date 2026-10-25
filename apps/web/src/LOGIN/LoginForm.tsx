import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui/Button.js';
import { Input, Label } from '../components/ui/Input.js';
import { ErrorBanner } from '../components/ui/ErrorBanner.js';
import { describeLoginError } from './loginErrors.js';
import { validateLoginForm } from './loginValidation.js';
import type { LoginFieldErrors } from './loginValidation.js';

export interface LoginFormProps {
  /** Performs the sign-in. Must reject on failure; the form shows the reason. */
  onSubmit: (loginId: string, password: string) => Promise<void>;
}

export const LoginForm = ({ onSubmit }: LoginFormProps) => {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false); // blocks double submits (Enter + click) even before state re-renders
  const loginIdRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const refocusPassword = useRef(false);

  // The inputs are disabled while a request is in flight and a disabled input cannot take focus, so after a
  // failed attempt we refocus the password field only once it has been re-enabled.
  useEffect(() => {
    if (!submitting && refocusPassword.current) {
      refocusPassword.current = false;
      passwordRef.current?.focus();
    }
  }, [submitting]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;

    const errors = validateLoginForm(loginId, password);
    setFieldErrors(errors);
    setFormError(null);
    if (errors.loginId) {
      loginIdRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    try {
      await onSubmit(loginId.trim(), password);
      // Success: the app swaps this page for the signed-in shell; nothing to do here.
    } catch (err) {
      setFormError(describeLoginError(err));
      setPassword(''); // never keep a rejected password in the field
      refocusPassword.current = true;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate aria-label="Sign in">
      {formError ? <ErrorBanner message={formError} /> : null}

      <div>
        <Label htmlFor="loginId">Login ID</Label>
        <Input
          id="loginId"
          ref={loginIdRef}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          aria-invalid={fieldErrors.loginId ? true : undefined}
          aria-describedby={fieldErrors.loginId ? 'loginId-error' : undefined}
          disabled={submitting}
        />
        {fieldErrors.loginId ? (
          <p id="loginId-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.loginId}
          </p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            ref={passwordRef}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="pr-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            disabled={submitting}
          />
          <button
            type="button"
            className="focus-ring absolute inset-y-0 right-0 flex items-center rounded-md px-2.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={0}
          >
            {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </button>
        </div>
        {fieldErrors.password ? (
          <p id="password-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        Forgot your password or Login ID? Ask your administrator - self-service reset is not part of
        this release.
      </p>
    </form>
  );
};
