import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeProject } from './project'
import { sourceProvenPageImpact } from './scope'
import { makeFixtureRoot, removeTree } from './test-fixture-dir'

const directories: string[] = []
function project(files: Record<string, string>, config: Record<string, unknown> = { compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler' }, include: ['src'] }): string {
  const root = makeFixtureRoot('ripple-agent-c')
  directories.push(root)
  const contents = {
    'package.json': JSON.stringify({ name: 'route-proof-test' }),
    'tsconfig.json': JSON.stringify(config),
    'index.html': '<script type="module" src="/src/main.tsx"></script>',
    'src/main.tsx': `import {App} from './App';import {createRoot} from 'react-dom/client';createRoot(document.getElementById('root')!).render(<App/>);`,
    ...files,
  }
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
afterEach(() => { for (const dir of directories.splice(0)) removeTree(dir) })

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

describe('agent C P1 round 2: barrel provenance, JSX child and graph invariants', () => {
  function barrelProject(barrel: string, header: string, importName = 'ProfileHeader') {
    return project({
      'src/main.tsx': `import App from './App';import {createRoot} from 'react-dom/client';createRoot(document.getElementById('root')!).render(<App/>);`,
      'src/App.tsx': `import {createBrowserRouter,RouterProvider} from 'react-router-dom';import Profile from './pages/Profile';
        export default function App(){const router=createBrowserRouter([{path:'/pages/profile',Component:Profile}]);return <RouterProvider router={router}/>}`,
      'src/pages/Profile.tsx': `import {${importName}} from '../sub-components';const Profile=()=> <div><${importName}/></div>;export default Profile;`,
      'src/sub-components/index.ts': barrel,
      'src/sub-components/profile/ProfileHeader.tsx': header,
    })
  }
  const headerComponent = `import {Link} from 'react-router-dom';
    const ProfileHeader=()=> <div><Link to='#'>Overview</Link></div>;export default ProfileHeader;`
  const overview = (graph: ReturnType<typeof analyzeProject>) => {
    const text = graph.nodes.filter(node => node.kind === 'data' && node.value?.trim() === 'Overview')
    expect(text).toHaveLength(1)
    return text[0]
  }
  const expectSafeGraph = (graph: ReturnType<typeof analyzeProject>) => {
    const nodes = new Set(graph.nodes.map(node => node.id))
    expect(graph.edges.filter(edge => edge.certainty === 'source-proven' && (!nodes.has(edge.from) || !nodes.has(edge.to)))).toEqual([])
  }
  it('proves Profile -> barrel imported default ProfileHeader without inventing Link DOM mapping', () => {
    const root = barrelProject(`import ProfileHeader from './profile/ProfileHeader';export {ProfileHeader};`, headerComponent)
    const graph = analyzeProject(root)
    const profile = graph.nodes.find(node => node.kind === 'component' && node.label === 'Profile')!
    const header = graph.nodes.find(node => node.kind === 'component' && node.label === 'ProfileHeader')!
    const text = overview(graph)
    expect(graph.edges).toContainEqual(expect.objectContaining({from:profile.id,to:header.id,kind:'renders',certainty:'source-proven'}))
    expect(graph.edges).toContainEqual(expect.objectContaining({from:header.id,to:text.id,kind:'reads',certainty:'source-proven'}))
    expect(graph.edges.some(edge => edge.id.startsWith('jsx-text:') && edge.to === text.id)).toBe(false)
    expect(graph.nodes.some(node => node.kind === 'jsx-element' && node.label === '<Link>')).toBe(false)
    expect(sourceProvenPageImpact(graph,text.id)).toMatchObject({pageRefs:['page:/pages/profile'],certainty:'partial'})
    expect(sourceProvenPageImpact(graph,text.id).unresolved.join('\n')).toContain('composite-jsx-child')
    expectSafeGraph(graph)
  })
  it('resolves export { default as Name } from a barrel', () => {
    const graph = analyzeProject(barrelProject(`export {default as ProfileHeader} from './profile/ProfileHeader'`,headerComponent))
    const text=overview(graph)
    expect(sourceProvenPageImpact(graph,text.id).pageRefs).toContain('page:/pages/profile')
    expectSafeGraph(graph)
  })
  it('resolves export * through two nested barrels when named component is exported', () => {
    const graph = analyzeProject(project({
      'src/App.tsx': `import {createBrowserRouter,RouterProvider} from 'react-router-dom';import {Profile} from './Profile';const router=createBrowserRouter([{path:'/header',Component:Profile}]);export const App=()=> <RouterProvider router={router}/>;`,
      'src/Profile.tsx': `import {ProfileHeader} from './barrel';export function Profile(){return <ProfileHeader/>}`,
      'src/barrel.ts': `export * from './middle';`,
      'src/middle.ts': `export {ProfileHeader} from './profile/ProfileHeader';`,
      'src/profile/ProfileHeader.tsx': `export function ProfileHeader(){return <h1>Wildcard proof</h1>}`,
    }))
    const text=graph.nodes.find(node=>node.kind==='data'&&node.value==='Wildcard proof')!
    expect(sourceProvenPageImpact(graph,text.id)).toMatchObject({pageRefs:['page:/header'],certainty:'source-proven'})
    expectSafeGraph(graph)
  })
  it('does not replace an unresolved or shadowed barrel import with a same-named component', () => {
    const graph=analyzeProject(project({
      'src/App.tsx': `import {createBrowserRouter,RouterProvider} from 'react-router-dom';import Profile from './pages/Profile';const router=createBrowserRouter([{path:'/profile',Component:Profile}]);export const App=()=> <RouterProvider router={router}/>;`,
      'src/pages/Profile.tsx': `import {ProfileHeader} from '../sub-components';export const Profile=()=> <div><ProfileHeader/></div>;`,
      'src/sub-components/index.ts': `export {FakeHeader as ProfileHeader} from './Fake';`,
      'src/sub-components/Fake.tsx': `export function FakeHeader(){return <p>Incorrect header</p>}`,
      'src/sub-components/profile/ProfileHeader.tsx': headerComponent,
    }))
    const text=overview(graph)
    expect(sourceProvenPageImpact(graph,text.id).pageRefs).toEqual([])
    expect(sourceProvenPageImpact(graph,text.id).certainty).toBe('unknown')
    expectSafeGraph(graph)
  })
  it('does not count an arbitrary object.render(<App/>) as an application root', () => {
    const root=project({
      'src/main.tsx': `import {App} from './App';const fake={render(node:unknown){return node}};fake.render(<App/>);`,
      'src/App.tsx': `import {createBrowserRouter,RouterProvider} from 'react-router-dom';import {Header} from './Header';export const App=()=>{const router=createBrowserRouter([{path:'/header',Component:Header}]);return <RouterProvider router={router}/>}`,
      'src/Header.tsx': `export function Header(){return <h1>Fake root title</h1>}`,
    })
    const graph=analyzeProject(root)
    const target=graph.nodes.find(node=>node.kind==='data'&&node.value==='Fake root title')!
    expect(sourceProvenPageImpact(graph,target.id).certainty).not.toBe('source-proven')
    expectSafeGraph(graph)
  })
})


describe('agent C P1: configured entry and reachable root proof', () => {
  const app = `${routerImports}
const router = createBrowserRouter([{ path:'/profile', Component: Profile }]);
export const App=()=><RouterProvider router={router}/>;`
  const scenarios: Array<{name:string;files:Record<string,string>;expected:'source-proven'|'unknown';diagnostic?:string}> = [
  {
    "name": "custom bootstrap is proven",
    "files": {
      "index.html": "<script type=\"module\" src=\"/src/bootstrap.tsx\"></script>",
      "src/bootstrap.tsx": "import {App} from './App';import {createRoot} from 'react-dom/client';const root=createRoot(null);root.render(<App/>);"
    },
    "expected": "source-proven"
  },
  {
    "name": "actual bootstrap mounts something else",
    "files": {
      "index.html": "<script type=\"module\" src=\"/src/bootstrap.tsx\"></script>",
      "src/bootstrap.tsx": "import {createRoot} from 'react-dom/client';createRoot(null).render(<p>Other</p>);"
    },
    "expected": "unknown",
    "diagnostic": "not proven reachable"
  },
  {
    "name": "missing HTML module entry",
    "files": {
      "index.html": "<html><body></body></html>"
    },
    "expected": "unknown",
    "diagnostic": "entry is missing"
  },
  {
    "name": "missing source module entry",
    "files": {
      "index.html": "<script type=\"module\" src=\"/src/missing.tsx\"></script>"
    },
    "expected": "unknown",
    "diagnostic": "not statically available"
  },
  {
    "name": "two configured HTML entries are ambiguous",
    "files": {
      "index.html": "<script type=\"module\" src=\"/src/main.tsx\"></script><script type=\"module\" src=\"/src/other.tsx\"></script>",
      "src/other.tsx": "export const ready=true"
    },
    "expected": "unknown",
    "diagnostic": "ambiguous"
  },
  {
    "name": "uninvoked bootstrap has no root proof",
    "files": {
      "src/main.tsx": "import {App} from './App';import {createRoot} from 'react-dom/client';function unusedBootstrap(){createRoot(null).render(<App/>);}"
    },
    "expected": "unknown",
    "diagnostic": "not proven reachable"
  },
  {
    "name": "statically dead branch has no root proof",
    "files": {
      "src/main.tsx": "import {App} from './App';import {createRoot} from 'react-dom/client';if(false){createRoot(null).render(<App/>);}"
    },
    "expected": "unknown",
    "diagnostic": "not proven reachable"
  },
  {
    "name": "shadowed createRoot does not prove mount",
    "files": {
      "src/main.tsx": "import {App} from './App';import {createRoot} from 'react-dom/client';function unused(createRoot:any){createRoot(null).render(<App/>);}"
    },
    "expected": "unknown",
    "diagnostic": "not proven reachable"
  },
  {
    "name": "plain object render does not prove React root",
    "files": {
      "src/main.tsx": "import {App} from './App';const obj={render(x:unknown){return x}};obj.render(<App/>);"
    },
    "expected": "unknown",
    "diagnostic": "not proven reachable"
  },
  {
    "name": "top-level React Root direct render is proven",
    "files": {
      "src/main.tsx": "import {App} from './App';import {createRoot} from 'react-dom/client';createRoot(null).render(<App/>);"
    },
    "expected": "source-proven"
  },
  {
    "name": "top-level namespace React Root render is proven",
    "files": {
      "src/main.tsx": "import {App} from './App';import * as DOM from 'react-dom/client';DOM.createRoot(null).render(<App/>);"
    },
    "expected": "source-proven"
  },
  {
    "name": "composite wrapper with ignored children is not proven",
    "files": {
      "src/main.tsx": "import {App} from './App';import {createRoot} from 'react-dom/client';const Discard=({children}:any)=><div>None</div>;createRoot(null).render(<Discard><App/></Discard>);"
    },
    "expected": "unknown",
    "diagnostic": "not proven reachable"
  },
  {
    "name": "React imported StrictMode wrapper preserves mount",
    "files": {
      "src/main.tsx": "import {App} from './App';import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';createRoot(null).render(<StrictMode><App/></StrictMode>);"
    },
    "expected": "source-proven"
  },
  {
    "name": "App only inside JSX callback is not proven",
    "files": {
      "src/main.tsx": "import {App} from './App';import {createRoot} from 'react-dom/client';createRoot(null).render(<div onClick={()=><App/>}/>);"
    },
    "expected": "unknown",
    "diagnostic": "not proven reachable"
  }
]
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const graph = analyzeProject(project({...pages,'src/App.tsx':app,...scenario.files}))
      expect(impact(graph,'Profile Title').certainty).toBe(scenario.expected)
      if (scenario.diagnostic) expect(graph.unresolved.join('\n')).toContain(scenario.diagnostic)
      if (scenario.expected === 'source-proven') expect(graph.nodes.some(node=>node.id==='page:/profile')).toBe(true)
    })
  }
})


describe('agent C P1 round 3: conditional return paths never earn full source proof', () => {
  const table = `const router = createBrowserRouter([{ path:'/profile', Component: Profile }]);`
  // A single return nested under a conditional construct can be skipped by an
  // implicit-undefined path, so the RouterProvider mount is only conditional.
  for (const [label, body] of [
    ['if statement with implicit undefined on the other path', `if (ready) return <RouterProvider router={router}/>;`],
    ['switch with a single mounting case', `switch (ready) { case 1: return <RouterProvider router={router}/>; }`],
    ['try block whose catch does not remount', `try { return <RouterProvider router={router}/>; } catch (error) { console.error(error); }`],
  ] as Array<[string, string]>) {
    it(`fails closed on a conditional return path: ${label}`, () => {
      const root = project({ ...pages, 'src/App.tsx': `${routerImports}
        ${table}
        export function App({ ready }: { ready: number | boolean }) { ${body} }` })
      const graph = analyzeProject(root)
      expect(impact(graph, 'Profile Title').certainty).not.toBe('source-proven')
      expect(graph.unresolved.join('\n')).toContain('conditional App RouterProvider mount')
    })
  }

  it('fails closed when only some conditional branches mount the RouterProvider', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
      ${table}
      export function App({ ready }: { ready: boolean }) {
        if (ready) return <RouterProvider router={router}/>;
        return <Home/>;
      }` })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Profile Title').certainty).not.toBe('source-proven')
    expect(graph.unresolved.join('\n')).toContain('multiple return paths')
  })

  it('keeps a Provider mounted inside a returned ternary or logical expression conditional', () => {
    for (const body of [
      `return ready ? <RouterProvider router={router}/> : <Home/>;`,
      `return ready && <RouterProvider router={router}/>;`,
    ]) {
      const root = project({ ...pages, 'src/App.tsx': `${routerImports}
        ${table}
        export function App({ ready }: { ready: boolean }) { ${body} }` })
      const graph = analyzeProject(root)
      expect(impact(graph, 'Profile Title').certainty).not.toBe('source-proven')
      expect(graph.unresolved.join('\n')).toContain('conditional App RouterProvider mount')
    }
  })

  it('keeps the unconditional single RouterProvider mount fully source-proven', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
      ${table}
      export function App() { return <RouterProvider router={router}/>; }` })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Profile Title')).toMatchObject({ pageRefs: ['page:/profile'], certainty: 'source-proven' })
    expect(graph.unresolved.filter(entry => entry.includes('data-router'))).toEqual([])
  })

  it('still proves a mount guarded by an early throw, which has no implicit-undefined path', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
      ${table}
      export function App({ ready }: { ready: boolean }) {
        if (!ready) throw new Error('not ready');
        return <RouterProvider router={router}/>;
      }` })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Profile Title')).toMatchObject({ pageRefs: ['page:/profile'], certainty: 'source-proven' })
  })
})

describe('agent C P1 round 3: mutable route table aliases fail closed', () => {
  const declared = `const routes = [{ path:'/profile', Component: Profile }];`
  const mounted = `const router = createBrowserRouter(routes); export const App = () => <RouterProvider router={router}/>;`

  it('detects a mutation through a let alias of the route table', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
      ${declared}
      let alias = routes; alias.push({ path:'/other', Component: Home });
      ${mounted}` })
    const graph = analyzeProject(root)
    // The pushed consumer must not appear, and the table degrades to partial.
    expect(impact(graph, 'Profile Title').certainty).not.toBe('source-proven')
    expect(impact(graph, 'Home Title').pageRefs).not.toContain('page:/other')
    expect(graph.unresolved.join('\n')).toContain('route array mutated through push')
    expect(graph.unresolved.join('\n')).toContain('route-coverage:')
  })

  it('detects an indexed write through a let alias of the route table', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
      ${declared}
      let alias = routes; alias[0] = { path:'/other', Component: Home };
      ${mounted}` })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Profile Title').certainty).not.toBe('source-proven')
    expect(graph.unresolved.join('\n')).toContain('mutated by assignment')
  })

  it('detects an unknown function receiving the route table through a let alias', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
      declare function helper(routes: unknown[]): void;
      ${declared}
      let alias = routes; helper(alias);
      ${mounted}` })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Profile Title').certainty).not.toBe('source-proven')
    expect(graph.unresolved.join('\n')).toContain('escapes to an unknown function')
  })

  it('detects a route object property write through an element reference', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
      ${declared}
      const first = routes[0]; first.Component = Home;
      ${mounted}` })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Profile Title').certainty).not.toBe('source-proven')
    expect(impact(graph, 'Home Title').pageRefs).not.toContain('page:/profile')
    expect(graph.unresolved.join('\n')).toContain('mutated by assignment')
  })

  it('fails closed when a route table alias is reassigned', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
      ${declared}
      const more = [{ path:'/other', Component: Home }];
      let alias = routes; alias = more; alias.push({ path:'/third', Component: Home });
      ${mounted}` })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Profile Title').certainty).not.toBe('source-proven')
    expect(graph.unresolved.join('\n')).toContain('alias reassigned')
  })

  it('keeps an unmodified static const route table fully source-proven', () => {
    const root = project({ ...pages, 'src/App.tsx': `${routerImports}
      ${declared}
      const alias = routes;
      ${mounted.replace('createBrowserRouter(routes)', 'createBrowserRouter(alias)')}` })
    const graph = analyzeProject(root)
    expect(impact(graph, 'Profile Title')).toMatchObject({ pageRefs: ['page:/profile'], certainty: 'source-proven' })
    expect(graph.unresolved.filter(entry => entry.includes('data-router'))).toEqual([])
  })
})
