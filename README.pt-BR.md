# module-frontend (Português Brasileiro)

Uma biblioteca React para micro frontends que publica bundles remotos por meio
de um manifesto dinâmico e os carrega como módulos montados em raízes próprias.
Providers registram entradas de módulos em `window`; a biblioteca não usa
Module Federation.

```sh
npm install @lib-core-mfe/module-frontend react react-dom
```

## Provider

Registre cada módulo remoto no bundle:

```tsx
import { Modularize } from "@lib-core-mfe/module-frontend/client";

type CartProps = { entityId: string };

export default Modularize(
  "cart",
  ({ entityId }: CartProps) => <p>{entityId}</p>,
  { appName: "shop" },
);
```

Gere um bundle IIFE por módulo (por exemplo, `dist/modules/cart.js`) e sirva os
bundles e o manifesto:

```ts
import { serveModules } from "@lib-core-mfe/module-frontend/server";

app.use(
  serveModules({
    modulesPath: "./dist/modules",
    appName: "shop",
    corsOrigins: ["https://app.example.com"],
    include: ["cart", "profile"],
    exclude: ["profile"],
  }),
);
// GET /modules/__modules_configuration
```

`include` e `exclude` são filtros opcionais por nome exato. Sem `include`,
todos os bundles `.js` no diretório são publicados. `exclude` tem precedência
e impede tanto a publicação no manifesto quanto o acesso direto ao script.

## Consumer

Passe as props do módulo remoto como parâmetro de tipo para verificá-las em
tempo de compilação:

```tsx
import { Module } from "@lib-core-mfe/module-frontend/client";

type CartProps = { entityId: string; onActionEvent: (event: Event) => void };

<Module<CartProps>
  name="cart"
  host="https://provider.example.com"
  allowedHosts={["https://provider.example.com"]}
  entityId="42"
  onActionEvent={(event) => console.log(event)}
  manifestTtlMs={60_000}
  onUpdateAvailable={({ previous, current }) => {
    console.info(`Update available: ${previous} → ${current}`);
  }}
  loading={<Spinner />}
  fallback={<Unavailable />}
  onError={report}
/>;
```

Sem um parâmetro de tipo explícito, props adicionais continuam aceitas por
compatibilidade. `moduleLifeCycleEvent.onMounted` é chamado uma vez após o
commit do componente remoto; `onCriticalFailure` informa erros de renderização.

`fallback` pode ser um elemento React ou uma função que recebe `retry`. A nova
tentativa revalida o manifesto e recarrega o script remoto após falha no
carregamento ou na renderização:

```tsx
<Module
  name="cart"
  host={HOST}
  fallback={({ retry }) => <button onClick={retry}>Try again</button>}
/>
```

## CSS isolation

Ative o isolamento de estilos com Shadow DOM usando `isolateStyles`:

```tsx
<Module name="cart" host={HOST} allowedHosts={[HOST]} isolateStyles />
```

O CSS do host não entra no módulo, e o CSS do módulo não vaza para o host.
Variáveis CSS customizadas atravessam essa fronteira intencionalmente.
O host do shadow root começa com `:host { all: initial; display: block }`,
reiniciando estilos herdados do host, como fontes e cores.
JavaScript, `window`, storage, cookies acessíveis por JavaScript e eventos
globais **não** são isolados. O módulo usa um runtime React independente somente
se o bundle do Provider incluir React e React DOM; a biblioteca não impõe essa
configuração de build.

O Provider fornece o CSS do módulo como texto para que o Consumer o injete no
shadow root:

```tsx
Modularize("cart", Cart, { appName: "shop", styles: cssText }); // string or string[]
```

Folhas de estilo inseridas em `document.head` (por exemplo, pelo `style-loader`)
não alcançam o shadow root. Para módulos isolados, gere o CSS como texto (como
o `?inline` do Vite ou `exportType: "string"` em configurações legadas do
`css-loader` do Webpack) e passe-o em `styles`. Portais devem usar o
`shadowRoot` exposto por `ModuleContext`; `ModuleContext.isolateStyles` indica
se esse modo está ativo.

| Fronteira                                                                          | Isolada?                                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Seletores CSS do host e do módulo                                                  | Sim                                                                                     |
| Variáveis CSS customizadas                                                         | Não; herdam intencionalmente entre as fronteiras                                        |
| JavaScript, `window`, storage, cookies acessíveis por JavaScript e eventos globais | Não                                                                                     |
| Runtime React                                                                      | Somente se o bundle remoto incluir seu próprio React; não é efeito do isolamento de CSS |

A prop antiga `isolate` continua temporariamente como alias depreciado e emite
um aviso uma única vez. Prefira `isolateStyles`; a remoção do alias está
planejada para a versão 1.0. Shadow DOM não é um sandbox de JavaScript. Consulte
[ADR 0002](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/0002-isolation-model.md).

## Event bus

Use a entrada independente de framework `/bus` para eventos tipados entre
módulos empacotados separadamente e os hooks de `/client` nos componentes
React:

```ts
import { createBus } from "@lib-core-mfe/module-frontend/bus";
import { createBusHooks } from "@lib-core-mfe/module-frontend/client";

type AppEvents = {
  "nav:request": { path: string };
  "student:created": { id: string };
};

const bus = createBus<AppEvents>();
export const { usePublish, useSubscribe } = createBusHooks(bus);
```

`usePublish` atribui o evento ao módulo atual; `useSubscribe` cancela a
assinatura ao desmontar. A entrega é síncrona. Retenção e replay são opcionais:
`publish(channel, payload, { ttl })` retém um evento e
`subscribe(channel, handler, { replay: true })` reproduz eventos não expirados.
Erros de handlers não impedem a entrega aos outros assinantes. Consulte o
[guia do event bus](./docs/guides/event-bus-pt-br.md) e as
[ADRs 0006–0007](./docs/adr/README.md).

## Guarantees and limits

- **Allowlist:** por padrão, somente a mesma origem da página é aceita; adicione
  outras origens a `allowedHosts`. Carregar um script remoto executa código de
  terceiros na página hospedeira.
- **Cache:** scripts usam `?v=<hash>` e cache imutável; o manifesto é servido
  com `no-cache`.
- **Padrões:** `basePath` é `/modules`, `corsOrigins` é vazio, o TTL do
  manifesto é 60 segundos e o carregamento do módulo expira após 15 segundos.
- **Runtime React:** um runtime React independente é possível quando o bundle
  remoto inclui seu próprio React; essa configuração é controlada pelo Provider.
- **Contexto React:** o contexto da raiz React do host não atravessa a raiz
  separada do módulo remoto; passe os valores necessários por props ou por uma
  integração explícita.
- **Isolamento de CSS:** ativado somente por `<Module isolateStyles />`.
- **Falhas:** erros de rede, timeout, módulo ausente e renderização chegam a
  `onError`; requisições com falha de manifesto ou script não ficam em cache.
- **Integridade:** hashes SRI são aplicados quando presentes;
  `requireIntegrity` é `false` por padrão e torna os hashes obrigatórios quando
  ativado.

## Contract compatibility

Provider e Consumer validam a versão `1` do contrato no manifesto e na entry
registrada. Um contrato ausente ou incompatível chega pelo caminho `onError`
do Consumer. Atualize Provider e Consumer juntos e incremente
`CONTRACT_VERSION` para alterações incompatíveis no manifesto ou na entry.
Consulte
[ADR 0003](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/0003-contract-version.md).

| Valor verificado                      | Onde             | Comportamento                            |
| ------------------------------------- | ---------------- | ---------------------------------------- |
| Versão do contrato                    | Manifesto        | Verificada antes de baixar os scripts    |
| Versão do contrato e formato da entry | Entry registrada | Verificados antes de montar o componente |

## Manifest cache and updates

Por padrão, manifestos ficam em cache por 60 segundos. Enquanto está montado,
`<Module>` revalida a cada intervalo de TTL e, se `onUpdateAvailable` for
fornecido, notifica uma vez por nova versão observada do Provider com
`{ previous, current }`. `manifestTtlMs={0}` desativa o polling automático e
ignora respostas concluídas em cache nas chamadas seguintes.

Uma versão recém-publicada não substitui um módulo já montado na página. O
registro global segue _first registration wins_ para não trocar silenciosamente
seu runtime React e contexto; recarregue a página para ativar uma atualização.
A ação explícita `retry` do fallback serve para recuperação após uma falha,
não para adotar uma versão nova no fluxo normal. Consulte
[ADR 0004](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/0004-cache-and-versioning.md).

## Threat model

Scripts remotos executam com os privilégios da página hospedeira e podem
acessar `window`, storage, cookies acessíveis por JavaScript e APIs disponíveis
ao host. `allowedHosts` é uma lista de confiança, não um sandbox. Shadow DOM
isola CSS, não JavaScript.

O Consumer carrega scripts com `crossOrigin="anonymous"` para diagnóstico de
erros remotos; o Provider precisa autorizar a origem do Consumer em
`corsOrigins`. `serveModules` publica hashes SRI SHA-384. Use
`requireIntegrity` para rejeitar módulos sem hash. SRI detecta bytes de script
diferentes de um manifesto confiável, mas não protege contra um Provider
comprometido que possa alterar tanto o bundle quanto o manifesto.

Passe `nonce` a `<Module>` para CSP; ele é aplicado aos scripts remotos e aos
estilos injetados no shadow root. Manifesto e respostas JavaScript incluem
`X-Content-Type-Options: nosniff`. Consulte
[ADR 0005](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/0005-security-model.md).

## Development

```sh
npm run typecheck
npm run lint
npm run format
npm run format:check
npm run check:docs
npm test
npm run test:browser
npm run build
npm run measure:bus
npm run check:package
```

O workflow de CI executa verificações de qualidade, testes com as versões
suportadas do React e a suíte em navegador real. Consulte o
[índice de ADRs](https://github.com/fidelis27/module-frontend/blob/main/docs/adr/README.md)
e o
[índice da documentação](https://github.com/fidelis27/module-frontend/blob/main/docs/README.md).
