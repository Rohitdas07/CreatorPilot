export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  countryCode: string;
  phoneNumber: string;
  brandHandle?: string;
  niche?: string;
  brandVoice?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SignupInput {
  fullName: string;
  email: string;
  countryCode: string;
  phoneNumber: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface AuthActionResult {
  ok: boolean;
  error?: string;
  code?: string;
}
