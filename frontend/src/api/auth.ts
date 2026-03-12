/**
 * Authentication API client
 */
import apiClient from './client'

// Types matching backend schemas
export type UserRole = 'consumer' | 'analyst' | 'dev'
export type AuthProvider = 'local' | 'google' | 'guest'

export interface User {
  id: string
  email: string
  full_name: string | null
  username: string | null
  role: UserRole
  is_active: boolean
  auth_provider: AuthProvider
  avatar_url: string | null
  created_at: string
  last_login_at: string | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: User
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export interface RegisterRequest {
  email: string
  password: string
  username: string
  full_name?: string
  role?: UserRole
}

export interface GoogleAuthRequest {
  id_token: string
  username?: string
}

export interface UsernameCheckResponse {
  username: string
  available: boolean
}

// Auth API functions
export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/login', {
    email,
    password,
  })
  return response.data
}

export async function googleAuth(idToken: string, username?: string): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/google', {
    id_token: idToken,
    username,
  })
  return response.data
}

export async function guestLogin(): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/guest')
  return response.data
}

export interface SendOTPResponse {
  message: string
  email: string
  expires_in_seconds: number
  dev_otp?: string // Only present in dev mode (no Resend API key)
}

export async function sendOtp(email: string, password: string): Promise<SendOTPResponse> {
  const response = await apiClient.post<SendOTPResponse>('/auth/send-otp', { email, password })
  return response.data
}

export async function signup(email: string, password: string, otpCode: string): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/signup', {
    email,
    password,
    otp_code: otpCode,
  })
  return response.data
}

export async function registerSimple(email: string, password: string): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/register-simple', {
    email,
    password,
  })
  return response.data
}

export async function setUsername(username: string): Promise<User> {
  const response = await apiClient.post<User>('/auth/set-username', { username })
  return response.data
}

export async function checkUsername(username: string): Promise<UsernameCheckResponse> {
  const response = await apiClient.get<UsernameCheckResponse>(`/auth/check-username/${encodeURIComponent(username)}`)
  return response.data
}

export async function refreshToken(refresh_token: string): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>('/auth/refresh', {
    refresh_token,
  })
  return response.data
}

export async function getCurrentUser(): Promise<User> {
  const response = await apiClient.get<User>('/auth/me')
  return response.data
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await apiClient.post('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
}

// Admin functions (dev only)
export async function registerUser(data: RegisterRequest): Promise<User> {
  const response = await apiClient.post<User>('/auth/register', data)
  return response.data
}

export async function listUsers(params?: {
  role?: UserRole
  is_active?: boolean
  skip?: number
  limit?: number
}): Promise<User[]> {
  const response = await apiClient.get<User[]>('/auth/users', { params })
  return response.data
}

export async function updateUser(
  userId: string,
  data: { full_name?: string; role?: UserRole; is_active?: boolean }
): Promise<User> {
  const response = await apiClient.patch<User>(`/auth/users/${userId}`, data)
  return response.data
}

export async function deactivateUser(userId: string): Promise<void> {
  await apiClient.delete(`/auth/users/${userId}`)
}
