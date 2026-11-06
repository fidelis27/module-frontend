# module-frontend

Remote modules para micro-frontends: o Provider publica bundles + um manifesto dinâmico, o Consumer carrega o módulo e o monta numa raiz React isolada. Sem Module Federation; o registro é feito na `window`.

```
npm i @lib-core-mfe/module-frontend react react-dom
```

## Provider

```tsx
// app/modules/cart/index.tsx
import { Modularize } from '@lib-core-mfe/module-frontend/client';

export default Modularize('cart', ({ entityId }) => <p>{entityId}</p>, { appName: 'shop' });
```

Gere um bundle IIFE por módulo (`dist/modules/cart.js`) e sirva com o middleware:

```js
import { serveModules } from '@lib-core-mfe/module-frontend/server';

app.use(serveModules({
  modulesPath: './dist/modules',
  appName: 'shop',            // igual ao appName do Modularize
  corsOrigins: ['https://app.example.com'],
}));
// manifesto: GET /modules/__modules_configuration
```

## Consumer

```tsx
import { Module } from '@lib-core-mfe/module-frontend/client';

<Module
  name="cart"
  host="https://provider.example.com"
  allowedHosts={['https://provider.example.com']}
  entityId="42"
  onActionEvent={(e) => console.log(e)}
  loading={<Spinner />}
  fallback={<Unavailable />}
  onError={report}
/>
```

Props desconhecidas (`entityId`, callbacks...) vão direto ao módulo remoto.

### Isolamento de CSS (`isolate`)

```tsx
<Module name="cart" host={HOST} allowedHosts={[HOST]} isolate />
```

Com `isolate`, o módulo é montado num **Shadow DOM**: o CSS do host não entra no módulo, o CSS do módulo não vaza para o host e a herança de fonte/cor do host é cortada (`:host { all: initial }`).

O Provider declara o CSS do módulo como texto, e o Consumer o injeta dentro do shadow root:

```tsx
Modularize('cart', Cart, { appName: 'shop', styles: cssText }); // string ou string[]
```

Cuidados:
- `<style>` colocado em `document.head` (style-loader, por exemplo) **não alcança** o shadow root. Em módulos usados com `isolate`, gere o CSS como texto (ex.: `?inline` no Vite, `css-loader` com `exportType: 'string'` no Webpack) e passe em `styles`.
- Portais (modais, tooltips) devem apontar para o shadow root. Ele chega no módulo por `useContext(ModuleContext).shadowRoot`.
- `isolate` isola CSS, não JavaScript: `window`, `localStorage` e eventos globais continuam compartilhados.
- Variáveis CSS (`--cor`) do host **atravessam** a fronteira. Use isso para temas, se quiser.

## Garantias e limites

- **Allowlist:** por padrão só a mesma origem da página é aceita; qualquer outro host precisa estar em `allowedHosts`. Carregar script remoto é execução de código de terceiros.
- **Cache:** scripts saem com `?v=<hash>` e `immutable`; o manifesto é `no-cache`.
- **Isolamento de React:** o módulo usa o React do próprio bundle (o Provider precisa de React ≥ 18, porque usa `react-dom/client`).
- **Isolamento de CSS:** só com `<Module isolate />` (veja acima).
- **Falhas:** erro de rede, timeout, módulo ausente e erro de render chegam em `onError`; falhas não ficam em cache.

## Desenvolvimento

```
npm run typecheck      # valida os tipos
npm run lint           # ESLint, incluindo regras dos Hooks do React
npm run format         # aplica Prettier
npm run format:check   # verifica a formatação sem alterar arquivos
npm test               # unitários + e2e com bundles reais (jsdom)
npm run test:browser   # isolamento de CSS em Chromium real (CHROMIUM_PATH opcional)
npm run build          # tsup (esm + cjs + d.ts)
npm run check:package  # build, publint, attw e npm pack --dry-run
```

O CI também testa os testes unitários com React 18 e React 19.
