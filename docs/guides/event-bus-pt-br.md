# Event bus (Português)

O bus permite que módulos empacotados independentemente troquem notificações
tipadas. Ele não é estado compartilhado, RPC nem uma fronteira de segurança.

## Início rápido

```ts
import { createBus } from "@lib-core-mfe/module-frontend/bus";
import { createBusHooks } from "@lib-core-mfe/module-frontend/client";

type AppEvents = {
  "nav:request": { path: string };
  "student:created": { id: string };
};

export const bus = createBus<AppEvents>();
export const { usePublish, useSubscribe } = createBusHooks(bus);
```

Em um componente, `usePublish()` retorna uma função estável e
`useSubscribe()` cancela a assinatura ao desmontar:

```tsx
function StudentList() {
  const publish = usePublish();
  useSubscribe("student:created", ({ id }) => refreshStudent(id));
  return (
    <button onClick={() => publish("nav:request", { path: "/students" })}>
      Abrir
    </button>
  );
}
```

## Defina e nomeie os canais

Mantenha o mapa de eventos em um módulo de contrato compartilhado pelo host e
por cada remote. Prefira nomes `namespace:ação`, como `nav:request` e
`student:created`. Defina um módulo proprietário para cada namespace e, por
convenção, apenas ele publica nesse namespace. Isso não é uma autorização em
runtime.

O mapa define o tipo do payload. O bus não valida payloads em runtime; valide
dados não confiáveis na fronteira antes de publicá-los.

## Inicialização, retenção e replay

A entrega é síncrona. Uma publicação anterior à montagem de um listener não é
retida por padrão. Informe um `ttl` positivo quando um módulo recém-montado
precisar receber um evento anterior:

```ts
bus.publish("student:created", { id: "42" }, { ttl: 10_000 });
bus.subscribe("student:created", onCreated, { replay: true });
```

São retidos no máximo 100 eventos não expirados por canal; uma nova publicação
retida remove o evento mais antigo. A expiração é verificada em publicações e
assinaturas posteriores, sem timers. O replay entrega eventos retidos por
sequência antes dos eventos novos. `afterSeq` pode ignorar eventos já
processados.

Os hooks React guardam a última sequência por canal para que reexecuções de
efeitos, inclusive no StrictMode de desenvolvimento, não repitam o replay.
Fora do React, cancele a assinatura com a função retornada ou um `AbortSignal`.

## Ordem e erros

Os listeners executam sincronamente na ordem de assinatura. A lista é copiada
antes de cada entrega; adicionar ou remover listener vale a partir do próximo
evento. Publicações aninhadas são entregues imediatamente. Uma exceção não
impede a execução dos demais handlers:

```ts
const stopReporting = bus.onError((error, meta) => {
  Sentry.captureException(error, {
    extra: { channel: meta.channel, source: meta.source },
  });
});
```

Sem listener de erro, o bus reporta a exceção com `console.error`. Exceções
lançadas por um listener de erro também são reportadas dessa forma.

## Payloads e testes

As referências dos payloads são passadas sem alteração a todos os listeners.
Trate-os como imutáveis após a publicação; o bus não os clona nem congela.

Testes podem criar um bus tipado, usar nomes de canal exclusivos e cancelar as
assinaturas no cleanup. `bus.inspect()` informa listeners, eventos retidos e
última sequência sem modificar o estado:

```ts
const snapshot = bus.inspect();
expect(snapshot.channels["student:created"]?.listeners).toBe(1);
```

Todos os handles na mesma realm JavaScript compartilham o núcleo global,
inclusive entre bundles separados. Use canais exclusivos e limpe os listeners
entre testes.

## Depuração e anti-padrões

- Use `inspect()` para consultar contagens e sequências; não altere o objeto
  interno `globalThis.__MFE_BUS__`.
- Não use o bus como fonte da verdade nem como substituto do estado da
  aplicação.
- Evite payloads grandes; envie identificadores e carregue os dados completos
  por uma API.
- Não dependa da ordem dos handlers para coordenar lógica de negócio.
- Não deixe assinaturas ativas fora do React; guarde e chame a função de
  cancelamento.
- Não publique dados sensíveis. Qualquer módulo na página pode publicar em
  qualquer canal, e scripts remotos executam com os privilégios da página.
  Consulte [ADR 0005](../adr/0005-security-model.md).

## Migração de um bus local

Comece definindo um mapa de eventos compartilhado. Mantenha temporariamente as
assinaturas dos wrappers existentes e mapeie seus argumentos para canais
tipados. Torne explícita a retenção quando listeners tardios precisarem de
notificações anteriores. Migre os consumidores aos poucos para
`useSubscribe` e `usePublish`; remova o wrapper quando todos os módulos tiverem
migrado. Revise as mudanças intencionais: erros de handlers não interrompem
mais a distribuição, e o replay habilitado pode entregar eventos publicados
antes da montagem do listener.
