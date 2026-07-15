import { createContext, useContext, useEffect, ReactNode } from 'react';
import { syncOddsFormatFromServer } from '@/hooks/use-odds-format';
import {
  useGetCurrentUser,
  useListUsers,
  getGetCurrentUserQueryKey,
  getListUsersQueryKey,
} from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

interface UserContextType {
  /** The signed-in user's bettor profile (null while loading or unclaimed) */
  activeUser: User | null;
  allUsers: User[];
  isLoading: boolean;
  /** Signed in, but no bettor profile linked yet — show the claim screen */
  needsClaim: boolean;
  /** Re-fetch the current user (e.g. after profile edits) */
  refreshUser: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const {
    data: currentUser,
    isLoading: isCurrentUserLoading,
    error,
  } = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const needsClaim = (error as { status?: number } | null)?.status === 404;

  const { data: allUsers = [], isLoading: isUsersLoading } = useListUsers({
    query: { enabled: !!currentUser, queryKey: getListUsersQueryKey() },
  });

  // The profile's saved odds-format preference is the source of truth across
  // devices — hydrate the local cache whenever the profile arrives.
  useEffect(() => {
    if (currentUser?.oddsFormat) syncOddsFormatFromServer(currentUser.oddsFormat);
  }, [currentUser?.oddsFormat]);

  return (
    <UserContext.Provider
      value={{
        activeUser: currentUser ?? null,
        allUsers,
        isLoading: isCurrentUserLoading || (!!currentUser && isUsersLoading),
        needsClaim,
        refreshUser: () => {
          queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        },
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
