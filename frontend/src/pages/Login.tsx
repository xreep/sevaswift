import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../contexts/AuthContext';
import AuthShell from '../components/AuthShell';
import { errorMessage } from '../services/api';
import { homeFor } from '../lib/format';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

const DEMO = [
  { label: 'Customer', email: 'customer@demo.sevaswift' },
  { label: 'Technician', email: 'tech@demo.sevaswift' },
  { label: 'Admin', email: 'admin@demo.sevaswift' },
];

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginForm) => {
    setError(null);
    try {
      const user = await login(data.email, data.password);
      navigate(homeFor(user.role));
    } catch (err) {
      setError(errorMessage(err, 'Login failed. Please try again.'));
    }
  };

  return (
    <AuthShell
      title="Sign in to your account"
      subtitle={
        <>
          Or <Link to="/register" className="font-semibold text-route underline-offset-2 hover:underline">create a new account</Link>
        </>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} data-testid="login-form" noValidate>
        {error && (
          <div className="rounded-panel border border-alert/30 bg-alert-soft px-4 py-3 text-sm" role="alert">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="label">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register('email')}
            className={`field ${errors.email ? 'field-error' : ''}`}
            aria-invalid={!!errors.email}
          />
          {errors.email && <p className="mt-1 text-sm text-alert">{errors.email.message}</p>}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="label">Password</label>
            <Link to="/forgot-password" className="text-sm font-semibold text-route hover:underline">
              Forgot your password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
            className={`field ${errors.password ? 'field-error' : ''}`}
            aria-invalid={!!errors.password}
          />
          {errors.password && <p className="mt-1 text-sm text-alert">{errors.password.message}</p>}
        </div>

        <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 text-base">
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <div className="mt-8 rounded-panel border border-dashed border-line p-4">
        <p className="text-sm font-semibold">Demo accounts</p>
        <p className="mt-0.5 text-sm text-ink-muted">Password for all: Demo@123</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO.map(d => (
            <button
              key={d.email}
              type="button"
              className="btn-secondary px-3 py-1.5"
              onClick={() => {
                setValue('email', d.email);
                setValue('password', 'Demo@123');
              }}
            >
              Fill {d.label.toLowerCase()}
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
