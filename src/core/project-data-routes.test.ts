import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeProject } from './project'
import { sourceProvenPageImpact } from './scope'

const directories: string[] = []
function project(files: Record<string, string>, config: Record<string, unknown> = { compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-agent-c-'))
  directories.push(root)
  const contents = { 'package.json': JSON.stringify({ name: 'route-proof-test' }), 'tsconfig.json': JSON.stringify(config), ...files }
  for (const [name, value] of Object.entries(contents)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, value)
  }
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline'], { cwd: root })
  return root
}
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

const pages = {
  'src/pages/Home.tsx': 'export function Home(){ return <main><h1>Home Title</h1></main> }',
  'src/pages/Profile.tsx': 'export function Profile(){ return <main><h1>Profile Title</h1></main> }',
  'src/pages/Detail.tsx': 'export function Detail(){ return <main><h1>Order Detail</h1></main> }',
}
const routerImports = `import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Home } from './pages/Home'; import { Profile } from './pages/Profile'; import { Detail } from './pages/Detail';`
const impact = (graph: ReturnType<typeof analyzeProject>, label: string) => {
  const source = graph.nodes.find(item => item.kind === 'data' && item.value === label)
  expect(source).toBeDefined()
  return sourceProvenPageImpact(graph, source!.id)
}

describe('agent C: conservative data-router page provenance', () => {
  it('proves nested Component, JSX element, index and relative paths through real router imports and provider', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
    const children = [{ index: true, Component: Home }, { path: 'profile', element: <Profile /> }];
    const routes = [{ path: 'dashboard', children }];
    const router = createBrowserRouter(routes);
    export const App = () => <RouterProvider router={router} />;` })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Home Title')).toMatchObject({ pageRefs: ['page:/dashboard'], certainty: 'source-proven' })
    expect(impact(graph, 'Profile Title')).toMatchObject({ pageRefs: ['page:/dashboard/profile'], certainty: 'source-proven' })
    expect(graph.edges.some(edge => edge.kind === 'renders' && edge.from === 'page:/dashboard/profile' && edge.to.startsWith('component:'))).toBe(true)
  })

  it('includes shared page consumption across two independent static routes', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
    const router = createBrowserRouter([{ path:'/one', Component: Profile }, { path:'/two', element:<Profile/> }]);
    export const App = () => <RouterProvider router={router} />` })
    expect(impact(analyzeProject(root), 'Profile Title')).toMatchObject({ pageRefs: ['page:/one', 'page:/two'], certainty: 'source-proven' })
  })

  it('keeps dynamic parameter routes as unresolved runtime instance coverage', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
    const router=createBrowserRouter([{ path:'/orders/:orderId', Component: Detail }]);
    export const App=()=> <RouterProvider router={router}/>;` })
    const graph = analyzeProject(root)
    expect(graph.nodes.map(item => item.id)).toContain('page:/orders/:orderId')
    expect(impact(graph, 'Order Detail').certainty).not.toBe('source-proven')
  })

  it('records unknown spread consumers and refuses full impact proof', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
    declare const fromPlugins: any[];
    const router=createBrowserRouter([{path:'/home', Component:Home}, ...fromPlugins]);
    export const App=()=> <RouterProvider router={router}/>;` })
    const graph=analyzeProject(root)
    expect(impact(graph,'Home Title')).toMatchObject({ pageRefs:['page:/home'], certainty:'partial' })
    expect(graph.unresolved).toEqual(expect.arrayContaining([expect.stringContaining('route-coverage:')]))
  })

  it('does not trust a bare createBrowserRouter symbol or unmounted route table', () => {
    const root = project({ ...pages, 'src/App.tsx': `import {Home} from './pages/Home';
    const createBrowserRouter=(routes: unknown)=> routes;
    const router=createBrowserRouter([{path:'/fake',Component:Home}]);
    export const App=()=> <Home/>;` })
    expect(analyzeProject(root).nodes.filter(item=>item.kind==='route')).toEqual([])
  })

  it('keeps the established useState route idiom without a React Router dependency', () => {
    const root = project({ ...pages, 'src/App.tsx': `import {useState} from 'react';import {Home} from './pages/Home';
    export function App(){const [page]=useState('home');return <>{page === 'home' && <Home/>}</>}` })
    expect(impact(analyzeProject(root), 'Home Title')).toMatchObject({ pageRefs: ['page:home'], certainty:'source-proven' })
  })

  it('reuses referenced nonstandard app config for aliased imports without marking npm packages unresolved', () => {
    const root = project({ ...pages,
      'index.html': '<script type="module" src="/src/main.tsx"></script>',
      'src/main.tsx': `export { App } from './App'`,
      'src/App.tsx': `import {createBrowserRouter,RouterProvider} from 'react-router-dom';
        import {Profile} from 'widgets/Profile';
        const router=createBrowserRouter([{path:'/profile',Component:Profile}]);
        export const App=()=> <RouterProvider router={router}/>;`,
      'src/widgets/Profile.tsx': `export function Profile(){return <h1>Alias Profile</h1>}`,
      'tsconfig.web.json': JSON.stringify({ compilerOptions:{jsx:'react-jsx',moduleResolution:'Bundler',baseUrl:'.',paths:{'widgets/*':['src/widgets/*']}},include:['src'] }),
    }, { files:[],references:[{path:'./tsconfig.web.json'}] })
    const graph=analyzeProject(root)
    expect(impact(graph,'Alias Profile')).toMatchObject({pageRefs:['page:/profile'],certainty:'source-proven'})
    expect(graph.unresolved.some(x=>x.includes('react-router-dom'))).toBe(false)
  })

  it('attributes an unresolved declared bare alias rather than silently ignoring it', () => {
    const root = project({ 'src/App.tsx': `import {Item} from 'widgets/Missing'; export function App(){return <h1>Hi</h1>}`,
      'tsconfig.web.json': JSON.stringify({compilerOptions:{jsx:'react-jsx',moduleResolution:'Bundler',baseUrl:'.',paths:{'widgets/*':['src/widgets/*']}},include:['src']}) },
      {files:[],references:[{path:'./tsconfig.web.json'}]})
    expect(analyzeProject(root).unresolved).toContain('src/App.tsx → widgets/Missing')
  })
})
