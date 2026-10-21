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
      'src/main.tsx': `import { App } from './App'; import {createRoot} from 'react-dom/client'; createRoot(document.getElementById('root')!).render(<App/>);`,
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


describe('agent C P1: app ownership, lexical binding and mutable route safety', () => {
  it('never turns a route errorElement into an unconditional global page consumer', () => {
    const root = project({
      ...pages,
      'src/pages/NotFound.tsx': 'export function NotFound(){return <p>Error Screen</p>}',
      'src/App.tsx': `${routerImports} import {NotFound} from './pages/NotFound';
        const router=createBrowserRouter([{path:'/profile',Component:Profile,errorElement:<NotFound/>}]);
        export const App=()=> <RouterProvider router={router}/>;`,
    })
    const graph = analyzeProject(root)
    const errorImpact = impact(graph,'Error Screen')
    expect(errorImpact.certainty).not.toBe('source-proven')
    expect(errorImpact.pageRefs).not.toContain('page:/profile')
    expect(graph.unresolved.join('\n')).toContain('conditional route fallback')
    expect(impact(graph,'Profile Title').certainty).toBe('partial')
  })

  it('proves a default-imported route component used by an App-local data router', () => {
    const root = project({
      'src/pages/Profile.tsx': 'const Profile=()=> <h1>Real Default Profile</h1>; export default Profile;',
      'src/App.tsx': `import {createBrowserRouter,RouterProvider} from 'react-router-dom';
        import Profile from './pages/Profile';
        const App=()=>{const router=createBrowserRouter([{path:'/pages/profile',Component:Profile}]);return <RouterProvider router={router}/>};
        export default App;`,
      'src/main.tsx': `import App from './App';import {createRoot} from 'react-dom/client';createRoot(document.getElementById('root')!).render(<App/>);`,
    })
    expect(impact(analyzeProject(root), 'Real Default Profile')).toMatchObject({
      pageRefs:['page:/pages/profile'],certainty:'source-proven'
    })
  })

  const expectUnknown = (root: string, message?: string) => {
    const graph = analyzeProject(root)
    const result = impact(graph, 'Profile Title')
    expect(result.certainty).not.toBe('source-proven')
    if (message) expect(graph.unresolved.join('\n')).toContain(message)
    return graph
  }

  it('proves the real codescandy App-local router layout for /pages/profile', () => {
    const root = project({ ...pages,
      'src/App.tsx': `${routerImports}
        const App = () => {
          const router = createBrowserRouter([{id:'root',path:'/',children:[
            {id:'pages',path:'/pages',children:[{path:'profile',Component:Profile}]}
          ]}]);
          return <RouterProvider router={router} />;
        };
        export default App;`,
      'src/main.tsx': `import App from './App'; import {createRoot} from 'react-dom/client'; createRoot(document.getElementById('root')!).render(<App/>);`,
    })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Profile Title')).toMatchObject({certainty:'source-proven',pageRefs:['page:/pages/profile']})
    expect(graph.edges.some(edge => edge.kind === 'renders' && edge.from === 'page:/pages/profile' && edge.to.startsWith('component:'))).toBe(true)
  })

  it('does not infer mounted pages from a Provider found only in a dead helper', () => {
    const root = project({...pages,'src/App.tsx': `${routerImports}
      function Spare(){const router=createBrowserRouter([{path:'/profile',Component:Profile}]);return <RouterProvider router={router}/>}
      export const App=()=> <main>Nothing mounted</main>;`})
    expect(expectUnknown(root).nodes.filter(x=>x.kind==='route')).toEqual([])
  })

  it('does not infer pages from an alternate screen that App does not render', () => {
    const root = project({...pages,'src/App.tsx': `${routerImports}
      const Alternate=()=> <RouterProvider router={createBrowserRouter([{path:'/profile',Component:Profile}])}/>;
      export const App=()=> <div>Current screen</div>;`})
    expect(expectUnknown(root).nodes.filter(x=>x.kind==='route')).toEqual([])
  })

  it('does not join two identically named router variables from different scopes', () => {
    const root = project({...pages,'src/App.tsx': `${routerImports}
      const router=createBrowserRouter([{path:'/profile',Component:Profile}]);
      export const App=()=> {const router={unused:true};return <RouterProvider router={router}/>}`})
    expect(expectUnknown(root,'binding does not resolve').nodes.filter(x=>x.kind==='route')).toEqual([])
  })

  it('does not confuse a factory or Provider shadow with the imported binding', () => {
    const root = project({...pages,'src/App.tsx': `${routerImports}
      export const App=()=>{const createBrowserRouter=(x:unknown)=>x;const router=createBrowserRouter([{path:'/profile',Component:Profile}]);return <RouterProvider router={router}/>}`})
    expectUnknown(root,'binding does not resolve')
  })

  it('does not prove an App that is not mounted from an available entrypoint', () => {
    const root = project({...pages,'src/App.tsx': `${routerImports}
        const router=createBrowserRouter([{path:'/profile',Component:Profile}]);export default function App(){return <RouterProvider router={router}/>}`,
      'src/main.tsx': `import App from './App';import {createRoot} from 'react-dom/client';function Dead(){return <App/>};createRoot(null).render(<div>Unrelated</div>);`})
    expectUnknown(root,'not proven reachable')
  })

  it('only declares partial impact on a conditionally mounted App-local Provider', () => {
    const root=project({...pages,'src/App.tsx':`${routerImports}
      export const App=({active}:{active:boolean})=>{const router=createBrowserRouter([{path:'/profile',Component:Profile}]);return active?<RouterProvider router={router}/>:<Profile/>}`})
    // The unknown branch cannot be claimed as complete consumer coverage.
    expectUnknown(root,'conditional App RouterProvider')
  })

  for (const [label, statement] of [
    ['push','routes.push({path:"/extra",Component:Profile});'],
    ['splice','routes.splice(0,1);'],
    ['indexed write','routes[0]={path:"/other",Component:Profile};'],
    ['aliased mutation','const alias=routes;alias.push({path:"/other",Component:Profile});'],
    ['aliased index','const alias=routes;alias[0]={path:"/other",Component:Profile};'],
  ]) {
    it(`fails closed on ${label} of a static routes array`, () => {
      const root = project({...pages,'src/App.tsx':`${routerImports}
        const routes=[{path:'/profile',Component:Profile}]; ${statement}
        const router=createBrowserRouter(routes);export const App=()=> <RouterProvider router={router}/>;`})
      expectUnknown(root,'route-coverage:')
    })
  }

  it('fails closed on an unknown route-array spread', () => {
    const root=project({...pages,'src/App.tsx':`${routerImports}
      declare const unknown: any[];
      const routes=[{path:'/profile',Component:Profile},...unknown];
      const router=createBrowserRouter(routes);export const App=()=> <RouterProvider router={router}/>;`})
    expectUnknown(root,'unresolved spread')
  })

  it('fails closed on computed, duplicate, and spread route object keys', () => {
    for(const object of [
      `{path:'/profile',Component:Profile,...extra}`,
      `{path:'/profile',Component:Profile,['Component']:Profile}`,
      `{path:'/profile',Component:Profile,Component:Profile}`,
    ]) {
      const root=project({...pages,'src/App.tsx':`${routerImports}
        declare const extra: any; const router=createBrowserRouter([${object}]);
        export const App=()=> <RouterProvider router={router}/>;`})
      expectUnknown(root,'overlapping or dynamic')
    }
  })
})
