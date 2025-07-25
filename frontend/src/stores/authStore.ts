import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { apiClient } from '../services/api'

interface User {
  email: string
  name: string
  quota?: number
  language?: string
  has2FA: boolean
  preferences?: any
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string, twoFactorCode?: string) => Promise<void>
  logout: () => void
  refreshToken: () => Promise<void>
  updateUser: (userData: Partial<User>) => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string, twoFactorCode?: string) => {
        set({ isLoading: true })
        
        try {
          const response = await apiClient.post('/auth/login', {
            email,
            password,
            twoFactorCode
          })

          const { token, user } = response.data

          // Set token in API client
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`

          set({
            user,
            token,
            isAuthenticated: true,
            isLoading: false
          })
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      logout: () => {
        // Remove token from API client
        delete apiClient.defaults.headers.common['Authorization']
        
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false
        })
      },

      refreshToken: async () => {
        try {
          const response = await apiClient.post('/auth/refresh')
          const { token } = response.data

          // Update token in API client
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`

          set({ token })
        } catch (error) {
          // If refresh fails, logout
          get().logout()
          throw error
        }
      },

      updateUser: (userData: Partial<User>) => {
        set(state => ({
          user: state.user ? { ...state.user, ...userData } : null
        }))
      },

      setLoading: (loading: boolean) => {
        set({ isLoading: loading })
      }
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated
      }),
      onRehydrateStorage: () => (state) => {
        // Set token in API client when rehydrating
        if (state?.token) {
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${state.token}`
        }
      }
    }
  )
)

// Auto-refresh token setup
const setupTokenRefresh = () => {
  const { refreshToken, logout, token } = useAuthStore.getState()
  
  if (!token) return

  // Decode JWT to get expiration time
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const expiresAt = payload.exp * 1000 // Convert to milliseconds
    const now = Date.now()
    const timeToRefresh = expiresAt - now - 5 * 60 * 1000 // Refresh 5 minutes before expiry

    if (timeToRefresh > 0) {
      setTimeout(async () => {
        try {
          await refreshToken()
          setupTokenRefresh() // Setup next refresh
        } catch (error) {
          console.error('Token refresh failed:', error)
          logout()
        }
      }, timeToRefresh)
    } else {
      // Token already expired, logout
      logout()
    }
  } catch (error) {
    console.error('Error parsing token:', error)
    logout()
  }
}

// Initialize token refresh on store creation
if (typeof window !== 'undefined') {
  useAuthStore.subscribe(
    (state) => state.token,
    (token) => {
      if (token) {
        setupTokenRefresh()
      }
    }
  )
}
