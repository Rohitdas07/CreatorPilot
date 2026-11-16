export interface CountryCodeOption {
  code: string;
  country: string;
}

export const COUNTRY_CODES: CountryCodeOption[] = [
  { code: '+1', country: 'US / CA' },
  { code: '+44', country: 'UK' },
  { code: '+91', country: 'IN' },
  { code: '+61', country: 'AU' },
  { code: '+49', country: 'DE' },
  { code: '+33', country: 'FR' },
  { code: '+81', country: 'JP' },
  { code: '+65', country: 'SG' },
  { code: '+971', country: 'AE' },
  { code: '+55', country: 'BR' },
];

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Email address is required.';
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!pattern.test(trimmed)) return 'Enter a valid email address.';
  return null;
}

export function validateFullName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Full name is required.';
  if (trimmed.length < 2) return 'Full name must be at least 2 characters.';
  if (trimmed.length > 100) return 'Full name must be under 100 characters.';
  return null;
}

export function validatePhoneNumber(phone: string): string | null {
  const digitsOnly = phone.replace(/[\s\-()]/g, '');
  if (!digitsOnly) return 'Phone number is required.';
  if (!/^[0-9]{6,15}$/.test(digitsOnly)) {
    return 'Enter a valid phone number (6 to 15 digits).';
  }
  return null;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Empty' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  colorClass: string;
  hint: string;
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return {
      score: 0,
      label: 'Empty',
      colorClass: 'bg-slate-700',
      hint: 'Use at least 8 characters with letters, numbers, and a symbol.',
    };
  }

  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  if (password.length < 6) {
    return {
      score: 1,
      label: 'Weak',
      colorClass: 'bg-rose-500',
      hint: 'Too short — use at least 8 characters.',
    };
  }

  if (score <= 1) {
    return {
      score: 1,
      label: 'Weak',
      colorClass: 'bg-rose-500',
      hint: 'Add uppercase letters, numbers, or symbols.',
    };
  }
  if (score === 2) {
    return {
      score: 2,
      label: 'Fair',
      colorClass: 'bg-amber-500',
      hint: 'Getting stronger — add a number or special character.',
    };
  }
  if (score === 3) {
    return {
      score: 3,
      label: 'Good',
      colorClass: 'bg-blue-500',
      hint: 'Good strength — add a symbol for maximum security.',
    };
  }
  return {
    score: 4,
    label: 'Strong',
    colorClass: 'bg-emerald-500',
    hint: 'Strong password.',
  };
}
