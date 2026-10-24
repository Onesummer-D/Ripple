import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { AboutPage } from './pages/AboutPage'

const router = createBrowserRouter([
  { path: '/', Component: HomePage },
  { path: '/about', Component: AboutPage },
])

export function App() {
  return <RouterProvider router={router} />
}
