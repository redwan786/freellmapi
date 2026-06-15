import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  Menu, Moon, Sun, Bot, FlaskConical, KeyRound, BarChart2,
  Database, Sparkles, LogOut, ChevronDown,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AuthGate } from '@/components/auth-gate'
import { logout, apiFetch } from '@/lib/api'
import KeysPage from '@/pages/KeysPage'
import PlaygroundPage from '@/pages/PlaygroundPage'
import FallbackPage from '@/pages/FallbackPage'
import EmbeddingsPage from '@/pages/EmbeddingsPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import DatabasePage from '@/pages/DatabasePage'

const queryClient = new QueryClient()

const navItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/models',     label: 'Models',      icon: Bot },
  { to: '/playground', label: 'Playground',  icon: FlaskConical },
  { to: '/keys',       label: 'Keys',        icon: KeyRound },
  { to: '/analytics',  label: 'Analytics',   icon: BarChart2 },
  { to: '/database',   label: 'Database',    icon: Database },
]

function getPreferredDarkMode() {
  if (typeof window === 'undefined') return false
  const stored = localStorage.getItem('theme')
  return stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

function NavItem({ to, icon: Icon, children }: { to: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative flex items-center gap-1.5 text-sm px-1 py-4 transition-colors ${
          isActive
            ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:bg-foreground after:rounded-full'
            : 'text-muted-foreground hover:text-foreground'
        }`
      }
    >
      <Icon className="size-3.5 shrink-0" />
      {children}
    </NavLink>
  )
}

function useDarkMode() {
  const [dark, setDark] = useState(getPreferredDarkMode)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  function toggle() {
    setDark((current) => {
      const next = !current
      localStorage.setItem('theme', next ? 'dark' : 'light')
      return next
    })
  }
  return { dark, toggle }
}


function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-70 shrink-0">
      <div className="flex size-5 items-center justify-center rounded-md bg-foreground">
        <Sparkles className="size-3 text-background" />
      </div>
      <span className="font-semibold tracking-tight text-sm">MyFreeLLMAPI</span>
    </Link>
  )
}

const isDesktopApp = typeof window !== 'undefined' && (window as any).__FREEAPI_DESKTOP__ === true

if (isDesktopApp) {
  document.documentElement.classList.add('desktop')
}

function UserMenu({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  const { data } = useQuery<{ email: string }>({
    queryKey: ['me'],
    queryFn: () => apiFetch('/api/auth/me'),
    retry: false,
    staleTime: Infinity,
  })

  const initials = data?.email?.slice(0, 2).toUpperCase() ?? '…'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent transition-colors">
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
          {initials}
        </span>
        <span className="hidden max-w-[120px] truncate text-xs text-muted-foreground lg:block">
          {data?.email ?? ''}
        </span>
        <ChevronDown className="size-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {data?.email && (
          <>
            <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{data.email}</div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onToggle} className="justify-between text-sm">
            <span>{dark ? 'Light mode' : 'Dark mode'}</span>
            {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {!isDesktopApp && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => logout()}
              className="text-sm text-destructive focus:text-destructive"
            >
              <LogOut className="size-3.5 mr-2" />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Navbar() {
  const { dark, toggle } = useDarkMode()
  const location = useLocation()
  const navigate = useNavigate()

  function isActiveRoute(to: string) {
    return location.pathname === to
  }

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-md ${isDesktopApp ? 'bg-background/45' : 'bg-background/85'}`}
      style={isDesktopApp ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
    >
      <div
        className={`mx-auto flex max-w-6xl items-center px-4 sm:px-6 ${isDesktopApp ? 'pl-20 sm:pl-20' : ''}`}
        style={isDesktopApp ? { minHeight: 52 } : undefined}
      >
        <Brand />

        {/* Desktop nav */}
        <nav
          className="ml-8 hidden items-center gap-5 md:flex"
          style={isDesktopApp ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined}
        >
          {navItems.map((item) => (
            <NavItem key={item.to} to={item.to} icon={item.icon}>
              {item.label}
            </NavItem>
          ))}
        </nav>

        {/* Desktop right actions */}
        <div
          className="ml-auto hidden items-center gap-1 md:flex"
          style={isDesktopApp ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined}
        >
          <UserMenu dark={dark} onToggle={toggle} />
        </div>

        {/* Mobile hamburger */}
        <div className="ml-auto md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
              aria-label="Open navigation menu"
            >
              <Menu />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuGroup>
                {navItems.map((item) => (
                  <DropdownMenuItem
                    key={item.to}
                    onClick={() => navigate(item.to)}
                    className={`gap-2 ${isActiveRoute(item.to) ? 'bg-accent text-accent-foreground font-medium' : ''}`}
                  >
                    <item.icon className="size-3.5" />
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={toggle} className="justify-between">
                  <span>Theme</span>
                  {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                </DropdownMenuItem>
                {!isDesktopApp && (
                  <DropdownMenuItem
                    onClick={() => logout()}
                    className="text-destructive focus:text-destructive"
                  >
                    <LogOut className="size-3.5 mr-2" />
                    Sign out
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthGate>
          <div className={`min-h-screen ${isDesktopApp ? 'desktop-backdrop' : 'bg-background'}`}>
            <Navbar />
            <main className="max-w-6xl mx-auto px-3 py-5 sm:px-6 sm:py-8">
              <Routes>
                <Route path="/" element={<Navigate to="/models/chat" replace />} />
                <Route path="/models" element={<Navigate to="/models/chat" replace />} />
                <Route path="/models/chat" element={<FallbackPage />} />
                <Route path="/models/embeddings" element={<EmbeddingsPage />} />
                <Route path="/playground" element={<PlaygroundPage />} />
                <Route path="/keys" element={<KeysPage />} />
                <Route path="/fallback" element={<Navigate to="/models/chat" replace />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/database" element={<DatabasePage />} />
                <Route path="/test" element={<Navigate to="/playground" replace />} />
                <Route path="/health" element={<Navigate to="/keys" replace />} />
              </Routes>
            </main>
          </div>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
