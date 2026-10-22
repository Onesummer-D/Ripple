import { Link } from 'react-router-dom'
import { Footer } from '../components/Footer'

export function HomePage() {
  return <main>
    <h1>Home Title</h1>
    <Link to="/about" data-testid="nav-about">Go to about</Link>
    <Footer />
  </main>
}
