import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { apiFetch, setToken, UNAUTHORIZED_EVENT } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AuthStatus {
  needsSetup: boolean
  authenticated: boolean
  email: string | null
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}

type AuthMode = 'setup' | 'login' | 'signup'

const COPY: Record<AuthMode, { title: string; subtitle: string; cta: string; busy: string; endpoint: string; pwAutoComplete: string; pwPlaceholder: string }> = {
  setup: {
    title: 'Create your account',
    subtitle: 'Set the email and password that will protect this dashboard.',
    cta: 'Create account', busy: 'Creating…', endpoint: '/api/auth/setup',
    pwAutoComplete: 'new-password', pwPlaceholder: 'at least 8 characters',
  },
  signup: {
    title: 'Create your account',
    subtitle: 'Sign up to get your own isolated keys, routing, and analytics.',
    cta: 'Sign up', busy: 'Creating…', endpoint: '/api/auth/signup',
    pwAutoComplete: 'new-password', pwPlaceholder: 'at least 8 characters',
  },
  login: {
    title: 'Welcome back',
    subtitle: 'Sign in to manage your keys, routing, and analytics.',
    cta: 'Sign in', busy: 'Signing in…', endpoint: '/api/auth/login',
    pwAutoComplete: 'current-password', pwPlaceholder: 'your password',
  },
}

function AuthForm({ initialMode, allowToggle, onAuthed }: { initialMode: AuthMode; allowToggle: boolean; onAuthed: () => void }) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const c = COPY[mode]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch<{ token: string }>(c.endpoint, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      setToken(res.token)
      onAuthed()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <div className="mb-6 flex items-center justify-center gap-2">
        <div className="flex size-6 items-center justify-center rounded-md bg-foreground">
          <Sparkles className="size-3.5 text-background" />
        </div>
        <span className="font-semibold tracking-tight text-sm">MyFreeLLMAPI</span>
      </div>
      <div className="rounded-3xl border bg-card p-6 shadow-sm">
        {/* Sign in / Sign up segmented toggle (hidden during first-run setup) */}
        {allowToggle && (
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm">
            {(['login', 'signup'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError('') }}
                className={`rounded-lg py-1.5 font-medium transition-colors ${
                  mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>
        )}
        <h1 className="text-lg font-semibold tracking-tight">{c.title}</h1>
        <p className="text-xs text-muted-foreground mt-1 mb-4">{c.subtitle}</p>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={c.pwAutoComplete}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={c.pwPlaceholder}
            />
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy ? c.busy : c.cta}
          </Button>
        </form>
      </div>
    </Centered>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery<AuthStatus>({
    queryKey: ['auth-status'],
    queryFn: () => apiFetch('/api/auth/status'),
    retry: false,
  })

  useEffect(() => {
    const handler = () => { refetch() }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [refetch])

  function onAuthed() {
    // New session: drop any cached (unauthenticated) data and re-check status.
    queryClient.invalidateQueries()
    refetch()
  }

  if (isLoading) return <Centered><p className="text-sm text-muted-foreground text-center">Loading…</p></Centered>
  if (isError || !data) {
    return (
      <Centered>
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          Can't reach the server. Make sure the backend is running (<code className="font-mono">npm run dev</code>).
        </div>
      </Centered>
    )
  }

  if (data.needsSetup) return <AuthForm initialMode="setup" allowToggle={false} onAuthed={onAuthed} />
  if (!data.authenticated) return <AuthForm initialMode="login" allowToggle onAuthed={onAuthed} />

  return <>{children}</>
}
