import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { validateEmail } from '../../utils/validation';
import { AuthLayout } from './AuthLayout';

interface LoginPageProps {
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

export function LoginPage({ onNotify }: LoginPageProps) {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state || {}) as {
    registeredEmail?: string;
    from?: string;
  };

  const [email, setEmail] = useState(locationState.registeredEmail || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setFormError(null);
    setIsGoogleSubmitting(true);
    const result = await loginWithGoogle();
    setIsGoogleSubmitting(false);

    if (!result.ok) {
      setFormError(result.error || 'Unable to sign in with Google.');
      onNotify('Google sign-in failed', result.error, 'error');
      return;
    }

    onNotify('Welcome back!', 'Signed in to CreatorPilot AI.', 'success');
    const target =
      locationState.from && locationState.from !== '/login'
        ? locationState.from
        : '/dashboard';
    navigate(target, { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const emailErr = validateEmail(email);
    if (emailErr) {
      setFormError(emailErr);
      return;
    }
    if (!password) {
      setFormError('Password is required.');
      return;
    }

    setIsSubmitting(true);
    const result = await login({ email, password, rememberMe });
    setIsSubmitting(false);

    if (!result.ok) {
      setFormError(result.error || 'Unable to sign in.');
      onNotify('Sign in failed', result.error, 'error');
      return;
    }

    onNotify('Welcome back!', 'Signed in to CreatorPilot AI.', 'success');
    const target =
      locationState.from && locationState.from !== '/login'
        ? locationState.from
        : '/dashboard';
    navigate(target, { replace: true });
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to access your CreatorPilot AI workspace."
    >
      {locationState.registeredEmail && (
        <div className="mb-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200">
          Account created for{' '}
          <span className="font-semibold">{locationState.registeredEmail}</span>.
          Sign in to continue to your dashboard.
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-xs text-rose-800 dark:text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <p className="leading-relaxed">{formError}</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isSubmitting || isGoogleSubmitting}
        className="mb-4 flex w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isGoogleSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Connecting to Google...</span>
          </>
        ) : (
          <>
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.09.73-2.48 1.16-4.22 1.16-3.24 0-5.99-2.19-6.97-5.13H1.04v3.14C3.05 21.14 7.21 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.03 14.02A7.18 7.18 0 0 1 4.65 12c0-.7.13-1.38.38-2.02V6.84H1.04A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.04 5.16l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.8 0 3.41.62 4.68 1.84l3.51-3.51C18.07 1.19 15.3 0 12 0 7.21 0 3.05 2.86 1.04 6.84l3.99 3.14C6.01 6.94 8.76 4.75 12 4.75Z"
              />
            </svg>
            <span>Continue with Google</span>
          </>
        )}
      </button>

      <div className="relative mb-4 flex items-center">
        <div className="flex-1 border-t border-[var(--border-default)]" />
        <span className="px-3 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          or sign in with email
        </span>
        <div className="flex-1 border-t border-[var(--border-default)]" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Email */}
        <div>
          <label
            htmlFor="login-email"
            className="block text-xs font-medium text-[var(--text-secondary)]"
          >
            Email Address
          </label>
          <div className="relative mt-1.5">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="creator@example.com"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label
            htmlFor="login-password"
            className="block text-xs font-medium text-[var(--text-secondary)]"
          >
            Password
          </label>
          <div className="relative mt-1.5">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] py-2.5 pl-10 pr-11 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Remember Me & Forgot Password */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--bg-input)] text-violet-600 focus:ring-violet-500"
            />
            <span>Remember Me</span>
          </label>

          <Link
            to="/forgot-password"
            className="text-xs font-medium text-violet-600 dark:text-violet-400 transition-colors hover:text-violet-700 dark:hover:text-violet-300"
          >
            Forgot Password?
          </Link>
        </div>

        {/* Sign In Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-violet-600/20 transition-all duration-150 hover:from-violet-500 hover:to-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Signing In...</span>
            </>
          ) : (
            <span>Sign In</span>
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
        Don&apos;t have an account?{' '}
        <Link
          to="/signup"
          className="font-semibold text-violet-600 dark:text-violet-400 transition-colors hover:text-violet-700 dark:hover:text-violet-300"
        >
          Create Account
        </Link>
      </p>
    </AuthLayout>
  );
}
