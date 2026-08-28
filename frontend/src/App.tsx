import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { Outlet, RouterProvider, createRouter, createRoute, createRootRoute } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import './index.css'
import { Web3Provider } from './context/Web3Context'
import Navbar from './components/Navbar'
import BrandMark from './components/BrandMark'
import EnvironmentBanner from './components/EnvironmentBanner'
import { AppErrorBoundary, ErrorView } from './components/ErrorBoundary'
import AsyncState from './components/AsyncState'

const Landing = lazy(() => import('./pages/Landing'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const TaskBoard = lazy(() => import('./pages/TaskBoard'))
const Agents = lazy(() => import('./pages/Agents'))
const PostTask = lazy(() => import('./pages/PostTask'))
const BidArena = lazy(() => import('./pages/BidArena'))
const TaskDetails = lazy(() => import('./pages/TaskDetails'))
const Profile = lazy(() => import('./pages/Profile'))
const Docs = lazy(() => import('./pages/Docs'))
const Disputes = lazy(() => import('./pages/Disputes'))
const Problems = lazy(() => import('./pages/Problems'))

function routeComponent(Page: LazyExoticComponent<ComponentType>) {
  return function LazyRoute() {
    return <Suspense fallback={<div className="page"><AsyncState kind="loading" title="Loading view" /></div>}><Page /></Suspense>
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})

const rootRoute = createRootRoute({
  component: () => (
    <Web3Provider>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <Navbar />
        <EnvironmentBanner />
        <main className="app-main" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="footer">
          <div className="footer-inner">
            <BrandMark compact className="footer-brand" />
            <nav className="footer-links" aria-label="Footer navigation">
              <a href="/docs">Docs</a>
              <a href="https://github.com/debpalash/agentwork/tree/main/packages/mcp-server" target="_blank" rel="noreferrer">MCP Server</a>
              <a href="https://github.com/debpalash/agentwork" target="_blank" rel="noreferrer">GitHub</a>
              <a href="https://github.com/debpalash/agentwork/blob/main/SECURITY.md" target="_blank" rel="noreferrer">Security</a>
            </nav>
            <span className="footer-tag">Collective intelligence, resolved.</span>
          </div>
        </footer>
      </div>
    </Web3Provider>
  ),
  errorComponent: ({ error, reset }) => <ErrorView error={error} onRetry={reset} />,
  notFoundComponent: () => <ErrorView title="Page not found" error={{ message: 'The requested Collagent page does not exist.' }} />,
})

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: routeComponent(Landing) })
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: routeComponent(Dashboard) })
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: routeComponent(TaskBoard) })
const agentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: routeComponent(Agents) })
const postRoute = createRoute({ getParentRoute: () => rootRoute, path: '/post', component: routeComponent(PostTask) })
const bidRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bid', component: routeComponent(BidArena) })
const detailsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/details', component: routeComponent(TaskDetails) })
const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: '/profile', component: routeComponent(Profile) })
const docsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/docs', component: routeComponent(Docs) })
const disputesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/disputes', component: routeComponent(Disputes) })
const problemsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/problems', component: routeComponent(Problems) })

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  tasksRoute,
  agentsRoute,
  postRoute,
  bidRoute,
  detailsRoute,
  profileRoute,
  docsRoute,
  disputesRoute,
  problemsRoute
])

const router = createRouter({ routeTree })

export default function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppErrorBoundary>
  )
}
