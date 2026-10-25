import { useAuth } from '../state/auth.js';
import { Card, CardBody } from '../components/ui/Card.js';
import { LoginForm } from './LoginForm.js';

/** Full-page sign-in screen. Shown by `App` whenever there is no authenticated session. */
export const LoginPage = () => {
  const { login } = useAuth();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
            MAFK Retail-Flow POS
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Sign in to continue</p>
        </div>
        <Card>
          <CardBody>
            <LoginForm onSubmit={login} />
          </CardBody>
        </Card>
      </div>
    </main>
  );
};
