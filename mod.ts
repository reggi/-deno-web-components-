
import { debounce } from "https://deno.land/std@0.103.0/async/debounce.ts";
import { ensureDir } from "https://deno.land/std@0.151.0/fs/ensure_dir.ts";
import { exists } from "https://deno.land/std@0.151.0/fs/exists.ts";
import { bundle } from "https://deno.land/x/emit@0.4.0/mod.ts";
import pascalCase from "https://deno.land/x/case@2.1.1/pascalCase.ts"
import { extname, join } from "https://deno.land/std@0.151.0/path/mod.ts";

export async function readWebComponents (webcomponentsDir: string) {
  const webComponents = [];
  for await (const file of Deno.readDir(webcomponentsDir)) {
    const parsed = extname(file.name)
    const match = new RegExp(`${parsed}` + "$")
    const importName = pascalCase(file.name.replace(match, ''))
    webComponents.push({ path: join(file.name), importName });
  }
  return webComponents;
}

export function appTsx (bundleName: string) {
return `
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { AppProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts"

export default function App({ Component }: AppProps) {
  return (
    <>
      <Head>
        <script src="${bundleName}"></script>
      </Head>
      <Component />
    </>
  );
}
`
}

export function indexTemplate (webComponents: {path: string, importName: string }[], pathPrefix?: string) {

  const imports = webComponents.map((v) => {
    return `import * as ${v.importName} from '${pathPrefix}${v.path}'`
  }).join('\n')

  const exports = webComponents.map((v) => {
    return `  ${v.importName}`
  }).join(',\n')

return `
${imports}

const c: { default: any, name: string }[] = [
${exports}
]

export default c
`
}


export function typesTemplate (webComponents: {path: string, importName: string }[], pathPrefix?: string) {

  const imports = webComponents.map((v) => {
    return `import * as ${v.importName} from '${pathPrefix}${v.path}'`
  }).join('\n')


  const types = webComponents.map((v) => {
    return `        [${v.importName}.name]: ${v.importName}.props;`
  }).join('\n')

return `
/// <reference types="https://esm.sh/preact@10.10.0" />
${imports}

declare module 'https://esm.sh/preact@10.10.0' {
  namespace JSX {
    interface IntrinsicElements {
${types}
    }
  }
}

`
}

const saveDir = './.denowebcomponents'

const entrypointTemplate = () => {
return `
import webComponents from "./index.ts";

const CE = window.customElements || { define: () => {} };

webComponents.forEach((module) => {
  CE.define(module.name, module.default);
})
`
}

const compileWebComponents = async () => {
  
  console.log(
    new URL(`${saveDir}/entry.ts`, import.meta.url),
    new URL(`${saveDir}/entry.ts`, Deno.mainModule),
  )

  const url = new URL(`${saveDir}/entry.ts`, Deno.mainModule);
  const result = await bundle(url);
  const code = result.code;
  await Deno.writeFile("./static/web-components.js", new TextEncoder().encode(code))
}

export async function pipeline () {
  await ensureDir('./web-components');
  await ensureDir('./.denowebcomponents');
  await ensureDir('./static');
  const webComponents = await readWebComponents('./web-components');
  const indexFile = indexTemplate(webComponents, `../web-components/`)
  const entrypointFile = entrypointTemplate();

  await Deno.writeFile(`${saveDir}/index.ts`, new TextEncoder().encode(indexFile))
  await Deno.writeFile(`${saveDir}/entry.ts`, new TextEncoder().encode(entrypointFile))
  await compileWebComponents()

  const typesFile = typesTemplate(webComponents, `./web-components/`)
  await Deno.writeFile(`./web-component-types.d.ts`, new TextEncoder().encode(typesFile))
}

export function devWebComponents () {
  const watcher = Deno.watchFs('./web-components');

  const run = debounce(() => {
    pipeline()
  }, 200);

  (async () => {
    for await (const changes of watcher) {
      run()
    }
  })();
}

export async function createAppTsx () {
  const file = await exists(`./routes/_app.tsx`)
  const content = appTsx('/web-components.js');
  if (!file) {
    await Deno.writeFile(`./routes/_app.tsx`, new TextEncoder().encode(content)) 
  } else {
    console.log('could not append to app.tsx already exists')
    console.log(content)
  }
}

export async function initialize () {
  await createAppTsx();
  await pipeline();
}