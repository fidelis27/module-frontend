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
  manifestTtlMs={60_000}
  onUpdateAvailable={({ previous, current }) => {
    console.info(`Nova versão disponível: ${previous} → ${current}`);
  }}
  loading={<Spinner />}
  fallback={<Unavailable />}
  onError={report}
/>
```

Props desconhecidas (`entityId`, callbacks...) vão direto ao módulo remoto.
`moduleLifeCycleEvent.onMounted` é chamado uma vez depois do primeiro commit do
componente remoto; `onCriticalFailure` sinaliza erros de renderização.

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

## Compatibilidade do contrato

Provider e Consumer verificam a versão do contrato antes de montar o módulo. Um
contrato ausente ou diferente resulta em erro explícito e chega ao `onError` do
Consumer.

| Versão da biblioteca | Contrato | Compatibilidade |
| --- | ---: | --- |
| `0.1.x` | Não declarado | Rejeitado por Consumers com validação de contrato |
| `0.2.x` | `1` | Compatível com outros módulos de contrato `1` |

Ao alterar a entry global ou o manifesto de forma incompatível, incremente a
`CONTRACT_VERSION`. Atualize Provider e Consumer juntos; consulte
[ADR 0003](./docs/adr/0003-contract-version.md).

## Cache e atualização

O manifesto fica em cache por 60 segundos por padrão. O Consumer revalida
enquanto o módulo permanece montado e chama `onUpdateAvailable` uma vez para
cada nova versão detectada, com `{ previous, current }`. `manifestTtlMs={0}`
desativa o cache e o polling automático; uma chamada posterior a `loadModule`
sempre revalida.

Uma versão recém-publicada **não substitui o módulo já montado**. O registro
global usa a política *first registration wins*: carregar e montar duas versões
do mesmo módulo na mesma página pode misturar contextos e corromper o estado do
React. Use o callback para decidir quando recarregar a página; a versão nova
entra após o reload. Consulte [ADR 0004](./docs/adr/0004-cache-and-versioning.md).

## Modelo de ameaças

Scripts remotos executam com os privilégios da página hospedeira: podem acessar
`window`, storage, cookies acessíveis por JavaScript e APIs disponíveis ao host.
`allowedHosts` é uma lista de confiança, não um sandbox. Shadow DOM isola CSS,
não JavaScript.

O Consumer carrega scripts com `crossOrigin="anonymous"` para permitir que
erros remotos incluam stack traces. Por isso, o Provider precisa autorizar a
origem do Consumer em `corsOrigins`. `serveModules` publica hashes SRI SHA-384;
use `requireIntegrity` para rejeitar módulos sem hash. SRI detecta conteúdo de
script diferente do hash esperado quando o manifesto é confiável, mas não
protege contra um Provider comprometido que possa alterar o bundle e o
manifesto. `nonce` pode ser passado ao `<Module>` para as políticas CSP do host
e também é aplicado aos estilos injetados no Shadow DOM.

`X-Content-Type-Options: nosniff` é enviado para manifesto e bundles JavaScript.
Para recomendações e limites completos, veja
[ADR 0005](./docs/adr/0005-security-model.md).

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
