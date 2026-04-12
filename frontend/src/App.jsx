import React from 'react'
import { Outlet, RouterProvider, createRouter, createRoute, createRootRoute } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import './index.css'
import Dashboard from './pages/Dashboard'
import Landing from './pages/Landing'
import TaskBoard from './pages/TaskBoard'
import Agents from './pages/Agents'
import PostTask from './pages/PostTask'
import BidArena from './pages/BidArena'
import TaskDetails from './pages/TaskDetails'
import Profile from './pages/Profile'
import Docs from './pages/Docs'
import { Web3Provider } from './context/Web3Context'
import Navbar from './components/Navbar'

const queryClient = new QueryClient()

const rootRoute = createRootRoute({
  component: () => (
    <Web3Provider>
      <Navbar />
      <Outlet />
      <footer className="footer">
        <div className="footer-inner">
          <span className="footer-brand">AIWORK</span>
          <div className="footer-links">
            <a href="/docs">Docs</a>
            <a href="#">MCP Server</a>
            <a href="#">GitHub</a>
            <a href="#">Discord</a>
          </div>
          <span className="footer-tag">[ BASE_L2 ] • FORGEJO</span>
        </div>
      </footer>
    </Web3Provider>
  )
})

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Landing })
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: Dashboard })
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: TaskBoard })
const agentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: Agents })
const postRoute = createRoute({ getParentRoute: () => rootRoute, path: '/post', component: PostTask })
const bidRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bid', component: BidArena })
const detailsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/details', component: TaskDetails })
const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: '/profile', component: Profile })
const docsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/docs', component: Docs })

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  tasksRoute,
  agentsRoute,
  postRoute,
  bidRoute,
  detailsRoute,
  profileRoute,
  docsRoute
])

const router = createRouter({ routeTree })

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
