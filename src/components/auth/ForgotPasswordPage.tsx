import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { validateEmail } from '../../utils/validation';
import { AuthLayout } from './AuthLayout';

interface ForgotPasswordPageProps {
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

export function ForgotPasswordPage({ onNotify }: ForgotPasswordPageProps) {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const emailErr = validateEmail(email);
    if (emailErr) {
      setFormError(emailErr);
      return;
    }

    setIsSubmitting(true);
    const result = await resetPassword(email);
    setIsSubmitting(false);

    if (!result.ok) {
      setFormError(result.error || 'Could not send reset email.');
      onNotify('Reset failed', result.error, 'error');
      return;
    }

    setSent(true);
    onNotify(
      'Reset email sent',
      'Check your inbox for password reset instructions.',
      'success'
    );
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your registered email address and we will send password reset instructions."
    >
      {sent ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-xs text-emerald-800 dark:text-emerald-200">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="space-y-1">
                <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                  Password Reset Email Sent
                </p>
                <p className="leading-relaxed">
                  We sent a password reset link to{' '}
                  <span className="font-semibold">{email}</span>. Follow the link
                  in your inbox, then return here to sign in.
                </p>
              </div>
            </div>
          </div>

          <Link
            to="/login"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Sign In</span>
          </Link>
        </div>
      ) : (
        <>
          {formError && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-xs text-rose-800 dark:text-rose-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <p>{formError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="reset-email"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Email Address
              </label>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="creator@example.com"
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white transition-all hover:from-violet-500 hover:to-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Sending Reset Link...</span>
                </>
              ) : (
                <span>Send Reset Link</span>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
            Remembered your password?{' '}
            <Link
              to="/login"
              className="font-semibold text-violet-600 dark:text-violet-400 transition-colors hover:text-violet-700 dark:hover:text-violet-300"
            >
              Back to Sign In
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
