import { act } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modularize, Module, resetModuleCaches } from "../../src/client";
import { CONTRACT_VERSION, getRegistryKey } from "../../src/shared";

const HOST = "https://provider.example.com";
const MANIFEST_URL = `${HOST}/modules/__modules_configuration`;

type Registrar = () => void;

/** Simula o browser baixando scripts: roda o "bundle" do módulo e dispara onload. */
function stubScripts(bundles: Record<string, Registrar | "fail">) {
  const loaded: string[] = [];
  vi.spyOn(document.head, "appendChild").mockImplementation(((node: Node) => {
    const script = node as HTMLScriptElement;
    if (script.tagName === "SCRIPT") {
      loaded.push(script.src);
      const bundle = Object.entries(bundles).find(([k]) =>
        script.src.includes(k),
      )?.[1];
      queueMicrotask(() => {
        if (bundle === "fail" || !bundle) script.onerror?.(new Event("error"));
        else {
          bundle();
          script.onload?.(new Event("load"));
        }
      });
    }
    return node;
  }) as typeof document.head.appendChild);
  return loaded;
}

function stubManifest(manifest: unknown, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok: status === 200,
    status,
    json: async () => manifest,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const manifest = {
  contractVersion: CONTRACT_VERSION,
  appName: "shop",
  version: "v1",
  modules: {
    cart: { name: "cart", scripts: ["/modules/cart.js?v=abc"] },
  },
};

const registerCart: Registrar = () =>
  void Modularize<{ entityId?: string }>(
    "cart",
    ({ entityId }) => <p data-testid="cart">cart:{entityId ?? "none"}</p>,
    { appName: "shop" },
  );

beforeEach(() => {
  resetModuleCaches();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  const registry = window as unknown as Record<string, unknown>;
  for (const key of Object.keys(window)) {
    if (key.startsWith("__REMOTE_MODULE__")) delete registry[key];
  }
});

describe("<Module />", () => {
  it("revalida enquanto montado e avisa sem trocar o módulo em uso", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const updatedManifest = { ...manifest, version: "v2" };
    const manifests = [manifest, updatedManifest];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => manifests.shift() ?? updatedManifest,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const loaded = stubScripts({ "cart.js": registerCart });
    const onUpdateAvailable = vi.fn();

    const view = render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        manifestTtlMs={100}
        onUpdateAvailable={onUpdateAvailable}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("cart").textContent).toBe("cart:none");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).toHaveBeenCalledWith({
      previous: "v1",
      current: "v2",
    });
    expect(loaded).toHaveLength(1);
    expect(screen.getByTestId("cart").textContent).toBe("cart:none");
    view.unmount();
  });

  it("rejeita manifestos sem contrato ou com versão incompatível", async () => {
    for (const contractVersion of [undefined, CONTRACT_VERSION + 1]) {
      resetModuleCaches();
      const onError = vi.fn();
      const loaded = stubScripts({});
      stubManifest({ ...manifest, contractVersion });

      const view = render(
        <Module
          name="cart"
          host={HOST}
          path="/modules/__modules_configuration"
          allowedHosts={[HOST]}
          onError={onError}
        />,
      );
      await waitFor(() => expect(onError).toHaveBeenCalled());
      expect(onError.mock.calls[0]![0].message).toMatch(
        /Contrato incompatível/,
      );
      expect(loaded).toHaveLength(0);
      view.unmount();
      vi.restoreAllMocks();
    }
  });

  it("carrega manifesto + script e monta o componente remoto com as props", async () => {
    const fetchMock = stubManifest(manifest);
    const loaded = stubScripts({ "cart.js": registerCart });

    render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        entityId="42"
      />,
    );

    expect((await screen.findByTestId("cart")).textContent).toBe("cart:42");
    expect(fetchMock).toHaveBeenCalledWith(MANIFEST_URL, expect.anything());
    expect(loaded).toEqual([`${HOST}/modules/cart.js?v=abc`]);
  });

  it("re-renderiza o módulo remoto quando as props mudam", async () => {
    stubManifest(manifest);
    stubScripts({ "cart.js": registerCart });
    const props = {
      name: "cart",
      host: HOST,
      path: "/modules/__modules_configuration",
      allowedHosts: [HOST],
    };

    const { rerender } = render(<Module {...props} entityId="1" />);
    await screen.findByText("cart:1");
    rerender(<Module {...props} entityId="2" />);
    await screen.findByText("cart:2");
  });

  it("desmonta a raiz remota quando o consumer desmonta", async () => {
    stubManifest(manifest);
    stubScripts({ "cart.js": registerCart });
    const { unmount, container } = render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
      />,
    );
    await screen.findByTestId("cart");
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.innerHTML).toBe("");
  });

  it("não baixa o mesmo script duas vezes para duas instâncias", async () => {
    const fetchMock = stubManifest(manifest);
    const loaded = stubScripts({ "cart.js": registerCart });
    const common = {
      name: "cart",
      host: HOST,
      path: "/modules/__modules_configuration",
      allowedHosts: [HOST],
    };

    render(
      <>
        <Module {...common} entityId="a" />
        <Module {...common} entityId="b" />
      </>,
    );
    await screen.findByText("cart:a");
    await screen.findByText("cart:b");
    expect(loaded).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mostra o fallback e chama onError quando o script falha", async () => {
    stubManifest(manifest);
    stubScripts({ "cart.js": "fail" });
    const onError = vi.fn();

    render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        onError={onError}
        fallback={<span>indisponível</span>}
      />,
    );
    await screen.findByText("indisponível");
    expect(onError.mock.calls[0]![0].message).toMatch(
      /Falha ao carregar script/,
    );
  });

  it("rejeita manifestos sem SRI quando requireIntegrity está ativo", async () => {
    const onError = vi.fn();
    const loaded = stubScripts({});
    stubManifest(manifest);

    render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        requireIntegrity
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].message).toMatch(/não fornece hashes SRI/);
    expect(loaded).toHaveLength(0);
  });

  it("permite tentar de novo depois de uma falha (erro não fica em cache)", async () => {
    stubManifest(manifest);
    const loaded = stubScripts({ "cart.js": "fail" });
    const props = {
      name: "cart",
      host: HOST,
      path: "/modules/__modules_configuration",
      allowedHosts: [HOST],
    };

    const first = render(<Module {...props} fallback={<span>erro</span>} />);
    await screen.findByText("erro");
    first.unmount();

    vi.restoreAllMocks();
    stubScripts({ "cart.js": registerCart });
    render(<Module {...props} />);
    await screen.findByTestId("cart");
    expect(loaded).toHaveLength(1);
  });

  it("falha quando o módulo não está no manifesto", async () => {
    stubManifest(manifest);
    stubScripts({});
    const onError = vi.fn();
    render(
      <Module
        name="ghost"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].message).toMatch(
      /não existe no manifesto/,
    );
  });

  it("falha quando o script carrega mas o módulo não se registra (appName errado)", async () => {
    stubManifest(manifest);
    stubScripts({
      "cart.js": () =>
        void Modularize("cart", () => null, { appName: "outro-app" }),
    });
    const onError = vi.fn();
    render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].message).toMatch(/não se registrou/);
  });

  it("rejeita entries sem versão ou com contrato incompatível", async () => {
    for (const contractVersion of [undefined, CONTRACT_VERSION + 1]) {
      resetModuleCaches();
      const register = () => {
        const validEntry = Modularize("cart", () => null, {
          appName: "shop",
        });
        const entry = validEntry as unknown as Record<string, unknown>;
        if (contractVersion === undefined) delete entry.contractVersion;
        else entry.contractVersion = contractVersion;
      };
      const onError = vi.fn();
      stubManifest(manifest);
      stubScripts({ "cart.js": register });

      const view = render(
        <Module
          name="cart"
          host={HOST}
          path="/modules/__modules_configuration"
          allowedHosts={[HOST]}
          onError={onError}
        />,
      );
      await waitFor(() => expect(onError).toHaveBeenCalled());
      expect(onError.mock.calls[0]![0].message).toMatch(
        /Contrato incompatível/,
      );
      view.unmount();
      vi.restoreAllMocks();
    }
  });

  it("rejeita uma entry malformada antes de montá-la", async () => {
    const onError = vi.fn();
    stubManifest(manifest);
    stubScripts({
      "cart.js": () => {
        const validEntry = Modularize("cart", () => null, { appName: "shop" });
        const registry = window as unknown as Record<string, unknown>;
        registry[getRegistryKey("shop", "cart")] = {
          ...validEntry,
          createRoot: undefined,
        };
      },
    });

    render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].message).toMatch(/malformada/);
  });

  it("bloqueia origens fora da allowlist sem nem buscar o manifesto", async () => {
    const fetchMock = stubManifest(manifest);
    const onError = vi.fn();
    render(
      <Module name="cart" host="https://evil.example.com" onError={onError} />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].message).toMatch(/Origem não autorizada/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bloqueia scripts de outra origem mesmo que o manifesto seja de origem permitida", async () => {
    stubManifest({
      ...manifest,
      modules: {
        cart: { name: "cart", scripts: ["https://evil.example.com/x.js"] },
      },
    });
    const loaded = stubScripts({});
    const onError = vi.fn();
    render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].message).toMatch(/Origem não autorizada/);
    expect(loaded).toHaveLength(0);
  });

  it("dá timeout quando o carregamento trava", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const onError = vi.fn();
    render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        timeoutMs={30}
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].message).toMatch(/Timeout/);
  });

  it("propaga falha crítica do render remoto para onError", async () => {
    stubManifest(manifest);
    stubScripts({
      "cart.js": () =>
        void Modularize(
          "cart",
          () => {
            throw new Error("render quebrou");
          },
          { appName: "shop" },
        ),
    });
    const onError = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Module
        name="cart"
        host={HOST}
        path="/modules/__modules_configuration"
        allowedHosts={[HOST]}
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    spy.mockRestore();
    expect(onError.mock.calls[0]![0].message).toBe("render quebrou");
  });
});
