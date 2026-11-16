import { useState } from 'react';
import { Loader2, Mail, Phone, Save, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  COUNTRY_CODES,
  validateFullName,
  validatePhoneNumber,
} from '../utils/validation';

interface ProfileViewProps {
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

export function ProfileView({ onNotify }: ProfileViewProps) {
  const { user, updateUserProfile } = useAuth();

  const [fullName, setFullName] = useState(user?.fullName || '');
  const [countryCode, setCountryCode] = useState(user?.countryCode || '+1');
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '');
  const [brandHandle, setBrandHandle] = useState(user?.brandHandle || '');
  const [niche, setNiche] = useState(user?.niche || '');
  const [brandVoice, setBrandVoice] = useState(user?.brandVoice || '');
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameErr = validateFullName(fullName);
    if (nameErr) {
      onNotify('Invalid name', nameErr, 'error');
      return;
    }

    const phoneErr = validatePhoneNumber(phoneNumber);
    if (phoneErr) {
      onNotify('Invalid phone number', phoneErr, 'error');
      return;
    }

    setSaving(true);
    const res = await updateUserProfile({
      fullName: fullName.trim(),
      countryCode,
      phoneNumber: phoneNumber.replace(/[\s\-()]/g, ''),
      brandHandle: brandHandle.trim(),
      niche: niche.trim(),
      brandVoice: brandVoice.trim(),
    });
    setSaving(false);

    if (!res.ok) {
      onNotify('Update failed', res.error, 'error');
      return;
    }

    onNotify('Profile updated', 'Your Firestore profile has been saved.', 'success');
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-blue-600 font-display text-lg font-bold text-white shadow-sm">
            {user.fullName
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'CP'}
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-[var(--text-primary)]">
              {user.fullName}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {user.email}
              {user.phoneNumber
                ? ` · ${user.countryCode} ${user.phoneNumber}`
                : ''}
            </p>
          </div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)]">
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span>Firebase Authenticated</span>
        </div>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5"
      >
        <div>
          <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
            My Profile Details
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Update your personal creator information stored in Firestore under{' '}
            <span className="font-mono text-[var(--text-secondary)]">
              users/{user.uid}
            </span>
            .
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="profile-name"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Full Name
            </label>
            <div className="relative mt-1.5">
              <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="profile-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="profile-email"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Email Address
            </label>
            <div className="relative mt-1.5">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="profile-email"
                type="email"
                value={user.email}
                disabled
                className="w-full cursor-not-allowed rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-muted)]"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="profile-phone"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Phone Number
            </label>
            <div className="mt-1.5 flex gap-2">
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
                  id="profile-phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="555 019 2834"
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="profile-handle"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Brand Handle
            </label>
            <input
              id="profile-handle"
              type="text"
              value={brandHandle}
              onChange={(e) => setBrandHandle(e.target.value)}
              placeholder="@alexcreates"
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="profile-niche"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Content Niche
            </label>
            <input
              id="profile-niche"
              type="text"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="Tech, Productivity & Creator Systems"
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="profile-brand-voice"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Customizable Brand Voice
            </label>
            <textarea
              id="profile-brand-voice"
              rows={2}
              maxLength={400}
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              placeholder="Clear, practical, creator-first, conversational without hype"
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>
        </div>

        <div className="flex justify-end border-t border-[var(--border-default)] pt-4">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:from-violet-500 hover:to-blue-500 disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                <span>Save Profile</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
