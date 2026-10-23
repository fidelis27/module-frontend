# module-frontend

Remote modules para micro-frontends: o Provider publica bundles + um manifesto dinâmico, o Consumer carrega o módulo e o monta numa raiz React isolada. Sem Module Federation; o registro é feito na `window`.

```
npm i @core/module-frontend react react-dom
```

## Provider

```tsx
// app/modules/cart/index.tsx
import { Modularize } from '@core/module-frontend/client';

export default Modularize('cart', ({ entityId }) => <p>{entityId}</p>, { appName: 'shop' });
```

Gere um bundle IIFE por módulo (`dist/modules/cart.js`) e sirva com o middleware:

```js
import { serveModules } from '@core/module-frontend/server';

app.use(serveModules({
  modulesPath: './dist/modules',
  appName: 'shop',            // igual ao appName do Modularize
  corsOrigins: ['https://app.example.com'],
}));
// manifesto: GET /modules/__modules_configuration
```

## Consumer

```tsx
import { Module } from '@core/module-frontend/client';

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

## Garantias e limites

- **Allowlist:** por padrão só a mesma origem da página é aceita; qualquer outro host precisa estar em `allowedHosts`. Carregar script remoto é execução de código de terceiros.
- **Cache:** scripts saem com `?v=<hash>` e `immutable`; o manifesto é `no-cache`.
- **Isolamento:** o módulo usa o React do próprio bundle. Estilos CSS **não** são isolados.
- **Falhas:** erro de rede, timeout, módulo ausente e erro de render chegam em `onError`; falhas não ficam em cache.

## Desenvolvimento

```
npm test        # unitários + e2e com bundles reais
npm run build   # tsup (esm + cjs + d.ts)
```
