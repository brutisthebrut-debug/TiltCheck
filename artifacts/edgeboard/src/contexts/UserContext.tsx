import { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { useGetCurrentUser, useListUsers } from '@workspace/api-client-react';
import type { User } from '@workspace/api-client-react';

interface UserContextType {
  activeUser: User | null;
  setActiveUser: (user: User) => void;
  allUsers: User[];
  isLoading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const { data: currentUser, isLoading: isCurrentUserLoading } = useGetCurrentUser();
  const { data: allUsers = [], isLoading: isUsersLoading } = useListUsers();
  
  const [activeUser, setActiveUser] = useState<User | null>(null);

  useEffect(() => {
    if (currentUser && !activeUser) {
      setActiveUser(currentUser);
    }
  }, [currentUser, activeUser]);

  return (
    <UserContext.Provider
      value={{
        activeUser,
        setActiveUser,
        allUsers,
        isLoading: isCurrentUserLoading || isUsersLoading,
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
