import { Link } from 'react-router-dom'
import { Footer } from '../components/Footer'

export function AboutPage() {
  return <main>
    <h1>About Title</h1>
    <Link to="/" data-testid="nav-home">Back to home</Link>
    <Footer />
  </main>
}
