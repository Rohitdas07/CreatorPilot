import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, authReady } = useAuth();
  const location = useLocation();

  if (!authReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-app)] text-[var(--text-secondary)]">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-md">
          <Zap className="h-5 w-5" />
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-violet-600 dark:text-violet-400" />
          <span>Restoring your CreatorPilot workspace...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
