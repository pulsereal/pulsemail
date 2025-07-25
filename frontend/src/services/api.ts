import axios from 'axios'
import toast from 'react-hot-toast'

export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor
apiClient.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    const { response } = error
    
    if (response?.status === 401) {
      // Handle unauthorized - token expired or invalid
      const authStore = require('../stores/authStore').useAuthStore
      authStore.getState().logout()
      toast.error('Session expired. Please login again.')
    } else if (response?.status === 403) {
      toast.error('Access denied')
    } else if (response?.status === 429) {
      toast.error('Too many requests. Please try again later.')
    } else if (response?.status >= 500) {
      toast.error('Server error. Please try again later.')
    } else if (response?.data?.error) {
      toast.error(response.data.error)
    } else if (error.message === 'Network Error') {
      toast.error('Network error. Please check your connection.')
    } else {
      toast.error('An unexpected error occurred')
    }
    
    return Promise.reject(error)
  }
)

// API endpoints
export const authAPI = {
  login: (email: string, password: string, twoFactorCode?: string) =>
    apiClient.post('/auth/login', { email, password, twoFactorCode }),
  
  logout: () => apiClient.post('/auth/logout'),
  
  refreshToken: () => apiClient.post('/auth/refresh'),
  
  getMe: () => apiClient.get('/auth/me'),
  
  updatePreferences: (preferences: any) =>
    apiClient.put('/auth/preferences', { preferences }),
  
  setup2FA: () => apiClient.post('/auth/2fa/setup'),
  
  verify2FA: (token: string) => apiClient.post('/auth/2fa/verify', { token }),
  
  disable2FA: (token: string, password: string) =>
    apiClient.post('/auth/2fa/disable', { token, password }),
  
  getAppPasswords: () => apiClient.get('/auth/app-passwords'),
  
  createAppPassword: (name: string) =>
    apiClient.post('/auth/app-passwords', { name }),
  
  deleteAppPassword: (id: string) =>
    apiClient.delete(`/auth/app-passwords/${id}`),
  
  getQuota: () => apiClient.get('/auth/quota')
}

export const emailAPI = {
  getEmails: (params: {
    folder?: string
    limit?: number
    offset?: number
    search?: string
    category?: string
    unread_only?: boolean
  }) => apiClient.get('/emails', { params }),
  
  getEmail: (uid: string, folder?: string) =>
    apiClient.get(`/emails/${uid}`, { params: { folder } }),
  
  sendEmail: (data: {
    to: string | string[]
    cc?: string | string[]
    bcc?: string | string[]
    subject: string
    content: string
    test_spam?: boolean
    attachments?: File[]
  }) => {
    const formData = new FormData()
    
    // Add email data
    Object.entries(data).forEach(([key, value]) => {
      if (key === 'attachments') return
      if (Array.isArray(value)) {
        formData.append(key, value.join(','))
      } else {
        formData.append(key, value?.toString() || '')
      }
    })
    
    // Add attachments
    if (data.attachments) {
      data.attachments.forEach(file => {
        formData.append('attachments', file)
      })
    }
    
    return apiClient.post('/emails/send', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  
  generateReply: (uid: string, options: {
    folder?: string
    tone?: string
    language?: string
    custom_instructions?: string
  }) => apiClient.post(`/emails/${uid}/reply`, options),
  
  markEmail: (uid: string, action: 'read' | 'unread') =>
    apiClient.patch(`/emails/${uid}/mark`, { action }),
  
  deleteEmail: (uid: string, folder?: string) =>
    apiClient.delete(`/emails/${uid}`, { params: { folder } }),
  
  moveEmail: (uid: string, target_folder: string, source_folder?: string) =>
    apiClient.patch(`/emails/${uid}/move`, { target_folder, source_folder }),
  
  getFolders: () => apiClient.get('/emails/folders/list'),
  
  testSpam: (content: string, subject?: string, recipient?: string) =>
    apiClient.post('/emails/test-spam', { content, subject, recipient }),
  
  getStats: () => apiClient.get('/emails/stats/dashboard'),
  
  searchEmails: (data: {
    query?: string
    folder?: string
    sender?: string
    subject?: string
    date_from?: string
    date_to?: string
    has_attachments?: boolean
    category?: string
  }) => apiClient.post('/emails/search', data),
  
  categorizeEmail: (uid: string, category: string) =>
    apiClient.patch(`/emails/${uid}/categorize`, { category }),
  
  provideLLMFeedback: (log_id: string, rating: number, feedback?: string) =>
    apiClient.post('/emails/llm-feedback', { log_id, rating, feedback })
}

export const campaignAPI = {
  getCampaigns: (params: {
    limit?: number
    offset?: number
    status?: string
  }) => apiClient.get('/campaigns', { params }),
  
  getCampaign: (id: string) => apiClient.get(`/campaigns/${id}`),
  
  createCampaign: (data: {
    name: string
    subject: string
    content: string
    recipients: Array<{ email: string; name?: string }>
    scheduled_at?: string
    template_id?: number
  }) => apiClient.post('/campaigns', data),
  
  updateCampaign: (id: string, data: any) =>
    apiClient.put(`/campaigns/${id}`, data),
  
  deleteCampaign: (id: string) => apiClient.delete(`/campaigns/${id}`),
  
  sendCampaign: (id: string) => apiClient.post(`/campaigns/${id}/send`),
  
  scheduleCampaign: (id: string, scheduled_at: string) =>
    apiClient.post(`/campaigns/${id}/schedule`, { scheduled_at }),
  
  getAnalytics: (id: string) => apiClient.get(`/campaigns/${id}/analytics`),
  
  duplicateCampaign: (id: string, name?: string) =>
    apiClient.post(`/campaigns/${id}/duplicate`, { name }),
  
  getTemplates: () => apiClient.get('/campaigns/templates/list'),
  
  createTemplate: (data: {
    name: string
    content: string
    thumbnail?: string
  }) => apiClient.post('/campaigns/templates', data),
  
  testCampaign: (id: string, test_emails: string[]) =>
    apiClient.post(`/campaigns/${id}/test`, { test_emails }),
  
  importRecipients: (csv_data: string) =>
    apiClient.post('/campaigns/recipients/import', { csv_data }),
  
  getPerformanceSummary: (period?: number) =>
    apiClient.get('/campaigns/performance/summary', { params: { period } }),
  
  cancelCampaign: (id: string) => apiClient.post(`/campaigns/${id}/cancel`)
}

export const automationAPI = {
  getRules: (params: {
    limit?: number
    offset?: number
    active_only?: boolean
  }) => apiClient.get('/automation/rules', { params }),
  
  createRule: (data: {
    name: string
    trigger_type: string
    trigger_conditions: any
    actions: any[]
    active?: boolean
  }) => apiClient.post('/automation/rules', data),
  
  updateRule: (id: string, data: any) =>
    apiClient.put(`/automation/rules/${id}`, data),
  
  deleteRule: (id: string) => apiClient.delete(`/automation/rules/${id}`),
  
  toggleRule: (id: string, active: boolean) =>
    apiClient.patch(`/automation/rules/${id}/toggle`, { active }),
  
  testRule: (id: string, test_email_data: any) =>
    apiClient.post(`/automation/rules/${id}/test`, { test_email_data }),
  
  getStats: () => apiClient.get('/automation/stats'),
  
  getLogs: (params: {
    limit?: number
    offset?: number
    action?: string
  }) => apiClient.get('/automation/logs', { params }),
  
  getFollowUps: (params: {
    status?: string
    limit?: number
    offset?: number
  }) => apiClient.get('/automation/follow-ups', { params }),
  
  scheduleFollowUp: (data: {
    recipient_email: string
    subject: string
    content?: string
    scheduled_at: string
    follow_up_type?: string
    original_email_data?: any
    use_llm?: boolean
    purpose?: string
  }) => apiClient.post('/automation/follow-ups', data),
  
  updateFollowUp: (id: string, data: any) =>
    apiClient.put(`/automation/follow-ups/${id}`, data),
  
  cancelFollowUp: (id: string) =>
    apiClient.delete(`/automation/follow-ups/${id}`),
  
  getTasks: (params: {
    status?: string
    limit?: number
    offset?: number
  }) => apiClient.get('/automation/tasks', { params }),
  
  updateTask: (id: string, status: string, notes?: string) =>
    apiClient.patch(`/automation/tasks/${id}`, { status, notes }),
  
  getTemplates: () => apiClient.get('/automation/templates'),
  
  createRuleFromTemplate: (data: {
    template_id: string
    name: string
    customizations?: any
  }) => apiClient.post('/automation/rules/from-template', data)
}

export default apiClient
