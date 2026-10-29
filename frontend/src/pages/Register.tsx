import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import AuthShell from '../components/AuthShell';
import { errorMessage } from '../services/api';
import { homeFor } from '../lib/format';

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    phone: z
      .string()
      .regex(/^\+?[1-9]\d{1,14}$/, 'Use digits only, e.g. +919876543210')
      .optional()
      .or(z.literal('')),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
    role: z.enum(['CUSTOMER', 'TECHNICIAN']),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterForm = z.infer<typeof registerSchema>;

const ROLES = [
  { value: 'CUSTOMER', title: 'I need help at home', body: 'Raise emergency requests and track the technician.' },
  { value: 'TECHNICIAN', title: 'I am a technician', body: 'Receive nearby jobs once an admin verifies you.' },
] as const;

export default function Register() {
  const [error, setError] = useState<string | null>(null);
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: 'CUSTOMER' },
  });
  const role = watch('role');

  const onSubmit = async (data: RegisterForm) => {
    setError(null);
    try {
      const user = await registerUser({
        name: data.name,
        email: data.email,
        phone: data.phone || undefined,
        password: data.password,
        role: data.role,
      });
      toast('Account created. We sent a link to verify your email.', 'success');
      navigate(homeFor(user.role));
    } catch (err) {
      setError(errorMessage(err, 'Registration failed. Please try again.'));
    }
  };

  const field = (name: keyof RegisterForm) => `field ${errors[name] ? 'field-error' : ''}`;
  const fieldError = (name: keyof RegisterForm) =>
    errors[name] && <p className="mt-1 text-sm text-alert">{errors[name]?.message}</p>;

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        <>
          Already registered? <Link to="/login" className="font-semibold text-route hover:underline">Sign in</Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        {error && (
          <div className="rounded-panel border border-alert/30 bg-alert-soft px-4 py-3 text-sm" role="alert">
            {error}
          </div>
        )}

        <fieldset>
          <legend className="label">Account type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map(r => (
              <label
                key={r.value}
                className={`cursor-pointer rounded-panel border-2 p-3 ${role === r.value ? 'border-ink bg-white' : 'border-line bg-white/60'}`}
              >
                <input type="radio" value={r.value} {...register('role')} className="sr-only" />
                <span className="block font-semibold">{r.title}</span>
                <span className="block text-sm text-ink-muted">{r.body}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="name" className="label">Full name</label>
          <input id="name" autoComplete="name" {...register('name')} className={field('name')} />
          {fieldError('name')}
        </div>
        <div>
          <label htmlFor="email" className="label">Email address</label>
          <input id="email" type="email" autoComplete="email" {...register('email')} className={field('email')} />
          {fieldError('email')}
        </div>
        <div>
          <label htmlFor="phone" className="label">
            Phone {role === 'TECHNICIAN' ? '(customers call you on this)' : '(optional)'}
          </label>
          <input id="phone" type="tel" autoComplete="tel" placeholder="+919876543210" {...register('phone')} className={field('phone')} />
          {fieldError('phone')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" type="password" autoComplete="new-password" {...register('password')} className={field('password')} />
            {fieldError('password')}
          </div>
          <div>
            <label htmlFor="confirmPassword" className="label">Confirm password</label>
            <input id="confirmPassword" type="password" autoComplete="new-password" {...register('confirmPassword')} className={field('confirmPassword')} />
            {fieldError('confirmPassword')}
          </div>
        </div>

        <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 text-base">
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}
