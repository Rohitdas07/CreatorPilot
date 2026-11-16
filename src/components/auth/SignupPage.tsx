import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Phone,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  COUNTRY_CODES,
  evaluatePasswordStrength,
  validateEmail,
  validateFullName,
  validatePhoneNumber,
} from '../../utils/validation';
import { AuthLayout } from './AuthLayout';

interface SignupPageProps {
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

export function SignupPage({ onNotify }: SignupPageProps) {
  const { signup, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  const handleGoogleSignUp = async () => {
    setFormError(null);
    setIsGoogleSubmitting(true);
    const result = await loginWithGoogle();
    setIsGoogleSubmitting(false);

    if (!result.ok) {
      setFormError(result.error || 'Unable to continue with Google.');
      onNotify('Google sign-in failed', result.error, 'error');
      return;
    }

    onNotify('Welcome to CreatorPilot AI!', 'Signed in with Google.', 'success');
    navigate('/dashboard', { replace: true });
  };

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);
  const passwordsMatch =
    confirmPassword.length === 0 || password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const nameErr = validateFullName(fullName);
    if (nameErr) {
      setFormError(nameErr);
      return;
    }

    const emailErr = validateEmail(email);
    if (emailErr) {
      setFormError(emailErr);
      return;
    }

    const phoneErr = validatePhoneNumber(phoneNumber);
    if (phoneErr) {
      setFormError(phoneErr);
      return;
    }

    if (password.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    if (!agreedTerms) {
      setFormError(
        'Please agree to the Terms & Conditions and Privacy Policy to create an account.'
      );
      return;
    }

    setIsSubmitting(true);
    const result = await signup({
      fullName,
      email,
      countryCode,
      phoneNumber,
      password,
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setFormError(result.error || 'Could not create account.');
      onNotify('Registration failed', result.error, 'error');
      return;
    }

    onNotify(
      'Account created!',
      'Your profile was saved. Please sign in to continue.',
      'success'
    );
    navigate('/login', {
      replace: true,
      state: { registeredEmail: email.trim().toLowerCase() },
    });
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join CreatorPilot AI and publish across every platform in minutes."
    >
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
        onClick={handleGoogleSignUp}
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
          or register with email
        </span>
        <div className="flex-1 border-t border-[var(--border-default)]" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
        {/* Full Name */}
        <div>
          <label
            htmlFor="signup-name"
            className="block text-xs font-medium text-[var(--text-secondary)]"
          >
            Full Name
          </label>
          <div className="relative mt-1">
            <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="signup-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Alex Rivera"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
            />
          </div>
        </div>

        {/* Email Address */}
        <div>
          <label
            htmlFor="signup-email"
            className="block text-xs font-medium text-[var(--text-secondary)]"
          >
            Email Address
          </label>
          <div className="relative mt-1">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="creator@example.com"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
            />
          </div>
        </div>

        {/* Phone Number with Country Code */}
        <div>
          <label
            htmlFor="signup-phone"
            className="block text-xs font-medium text-[var(--text-secondary)]"
          >
            Phone Number
          </label>
          <div className="mt-1 flex gap-2">
            <select
              aria-label="Country code"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="w-28 shrink-0 rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
            >
              {COUNTRY_CODES.map((c) => (
                <option key={`${c.code}-${c.country}`} value={c.code}>
                  {c.code} {c.country}
                </option>
              ))}
            </select>
            <div className="relative flex-1">
              <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="signup-phone"
                type="tel"
                autoComplete="tel-national"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="555 019 2834"
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
              />
            </div>
          </div>
        </div>

        {/* Password + Strength Indicator */}
        <div>
          <div className="flex items-center justify-between">
            <label
              htmlFor="signup-password"
              className="block text-xs font-medium text-[var(--text-secondary)]"
            >
              Password
            </label>
            {password && (
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                Strength: {strength.label}
              </span>
            )}
          </div>
          <div className="relative mt-1">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a strong password"
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

          <div className="mt-2 space-y-1">
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 2, 3, 4].map((step) => (
                <div
                  key={step}
                  className={`h-1.5 rounded-full transition-colors ${
                    strength.score >= step
                      ? strength.colorClass
                      : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                />
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">{strength.hint}</p>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label
            htmlFor="signup-confirm-password"
            className="block text-xs font-medium text-[var(--text-secondary)]"
          >
            Confirm Password
          </label>
          <div className="relative mt-1">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="signup-confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              className={`w-full rounded-xl border bg-[var(--bg-input)] py-2.5 pl-10 pr-11 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 ${
                passwordsMatch
                  ? 'border-[var(--border-default)] focus:border-violet-500 focus:ring-violet-500/25'
                  : 'border-rose-500/60 focus:border-rose-500 focus:ring-rose-500/25'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((v) => !v)}
              aria-label={
                showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'
              }
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {showConfirmPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {!passwordsMatch && (
            <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
              Passwords do not match.
            </p>
          )}
        </div>

        {/* Terms & Privacy Checkbox */}
        <div className="pt-1">
          <label className="flex cursor-pointer items-start gap-2.5 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={agreedTerms}
              onChange={(e) => setAgreedTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border-strong)] bg-[var(--bg-input)] text-violet-600 focus:ring-violet-500"
            />
            <span className="leading-relaxed">
              I agree to{' '}
              <button
                type="button"
                onClick={() => setShowPolicyModal(true)}
                className="font-medium text-violet-600 dark:text-violet-400 underline-offset-2 hover:underline"
              >
                Terms &amp; Conditions and Privacy Policy
              </button>
              .
            </span>
          </label>
        </div>

        {/* Sign Up Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-violet-600/20 transition-all duration-150 hover:from-violet-500 hover:to-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Creating Account...</span>
            </>
          ) : (
            <span>Sign Up</span>
          )}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-[var(--text-muted)]">
        Already have an account?{' '}
        <Link
          to="/login"
          className="font-semibold text-violet-600 dark:text-violet-400 transition-colors hover:text-violet-700 dark:hover:text-violet-300"
        >
          Sign In
        </Link>
      </p>

      {/* Policy Preview Modal */}
      {showPolicyModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="policy-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-popover)]">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-3">
              <h3
                id="policy-modal-title"
                className="font-display text-base font-semibold text-[var(--text-primary)]"
              >
                Terms &amp; Privacy Summary
              </h3>
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                aria-label="Close modal"
                className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              <p>
                CreatorPilot AI stores your profile details (full name, email, and phone number) securely in Cloud Firestore for account identification and workspace personalization.
              </p>
              <p>
                Passwords are handled strictly by Firebase Authentication and are never stored in Firestore documents.
              </p>
              <p>
                You retain full ownership over all scripts, captions, hashtags, and projects generated in your workspace.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAgreedTerms(true);
                  setShowPolicyModal(false);
                }}
                className="rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white"
              >
                Accept &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
