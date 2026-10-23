// Real React/Vite visual-evidence fixture. RIPPLE_TRIAL_* tokens are replaced
// per build (baseline vs candidate); the runtime annotations are the same
// data-ripple-source/instance/certainty attributes the production preview
// injects, so the DOM geometry sampler sees a real annotated React tree.
const TITLE = '__RIPPLE_TRIAL_TITLE__'
const CTA_TOP = '__RIPPLE_TRIAL_CTA_TOP__'

export default function App() {
  return (
    <main data-ripple-source="src/App.jsx#main" data-ripple-instance="App" data-ripple-identity-certainty="stable-react-instance"
      style={{ position: 'relative', width: 420, height: 420 }}>
      <h1 data-ripple-source="src/App.jsx#h1" data-ripple-instance="App/h1" data-ripple-identity-certainty="stable-react-instance"
        style={{ position: 'absolute', margin: 0, left: 20, top: 20, width: 300, height: 44, fontSize: 32, lineHeight: '44px', color: '#111827' }}>
        {TITLE}
      </h1>
      <div data-ripple-source="src/components/Media.jsx#frame" data-ripple-instance="App/media" data-ripple-identity-certainty="stable-keyed-instance"
        style={{ position: 'absolute', left: 20, top: 90, width: 240, height: 110, overflow: 'hidden' }}>
        <div data-ripple-source="src/components/Media.jsx#img" data-ripple-instance="App/media/img" data-ripple-identity-certainty="stable-keyed-instance"
          style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg,#2563eb 0%,#60a5fa 50%,#93c5fd 100%)' }} />
      </div>
      <a data-ripple-source="src/components/Cta.jsx#button" data-ripple-instance="App/cta" data-ripple-identity-certainty="stable-react-instance"
        style={{ position: 'absolute', left: 20, top: Number(CTA_TOP), width: 120, height: 36, background: '#f97316', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', fontSize: 14 }}>
        Shop now
      </a>
      <footer data-ripple-source="src/components/Footer.jsx#bar" data-ripple-instance="App/footer" data-ripple-identity-certainty="stable-react-instance"
        style={{ position: 'absolute', left: 0, top: 360, width: 420, height: 60, background: '#0f766e' }} />
    </main>
  )
}
