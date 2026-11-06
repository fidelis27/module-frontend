import { useContext } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Modularize,
  Module,
  ModuleContext,
  resetModuleCaches,
} from "../../src/client";
import { CONTRACT_VERSION } from "../../src/shared";

const HOST = "https://provider.example.com";
const PATH = "/modules/__modules_configuration";
const manifest = {
  contractVersion: CONTRACT_VERSION,
  appName: "shop",
  version: "v1",
  modules: { cart: { name: "cart", scripts: ["/modules/cart.js?v=abc"] } },
};
const common = { name: "cart", host: HOST, path: PATH, allowedHosts: [HOST] };

function stub(register: () => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => manifest })),
  );
  vi.spyOn(document.head, "appendChild").mockImplementation(((node: Node) => {
    const script = node as HTMLScriptElement;
    if (script.tagName === "SCRIPT") {
      queueMicrotask(() => {
        register();
        script.onload?.(new Event("load"));
      });
    }
    return node;
  }) as typeof document.head.appendChild);
}

const registerCart = (styles?: string | string[]) => () =>
  void Modularize("cart", () => <p data-testid="cart">cart</p>, {
    appName: "shop",
    styles,
  });

const hostEl = (c: HTMLElement) =>
  c.querySelector<HTMLElement>('[data-module="cart"] > div')!;

beforeEach(() => resetModuleCaches());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  const registry = window as unknown as Record<string, unknown>;
  for (const key of Object.keys(window)) {
    if (key.startsWith("__REMOTE_MODULE__")) delete registry[key];
  }
});

describe("<Module isolateStyles />", () => {
  it("monta o módulo dentro do shadow root, não no DOM comum", async () => {
    stub(registerCart());
    const { container } = render(<Module {...common} isolateStyles />);

    await waitFor(() =>
      expect(
        hostEl(container).shadowRoot?.querySelector('[data-testid="cart"]'),
      ).toBeTruthy(),
    );
    expect(container.querySelector('[data-testid="cart"]')).toBeNull();
  });

  it("sem isolateStyles não cria shadow root", async () => {
    stub(registerCart());
    const { container } = render(<Module {...common} />);

    await waitFor(() =>
      expect(container.querySelector('[data-testid="cart"]')).not.toBeNull(),
    );
    expect(hostEl(container).shadowRoot).toBeNull();
  });

  it("injeta os styles do módulo no shadow root e nada no document", async () => {
    stub(registerCart(["p{color:red}", ".x{margin:0}"]));
    const { container } = render(<Module {...common} isolateStyles />);

    await waitFor(() =>
      expect(
        hostEl(container).shadowRoot?.querySelector('[data-testid="cart"]'),
      ).toBeTruthy(),
    );
    const css = [
      ...hostEl(container).shadowRoot!.querySelectorAll("style"),
    ].map((s) => s.textContent);
    expect(css).toContain("p{color:red}");
    expect(css).toContain(".x{margin:0}");
    expect(css[0]).toBe(":host{all:initial;display:block}");
    expect(document.head.querySelector("style")).toBeNull();
    expect(document.body.innerHTML).not.toContain("color:red");
  });

  it("aceita styles como string única", async () => {
    stub(registerCart("b{font-weight:700}"));
    const { container } = render(<Module {...common} isolateStyles />);
    await waitFor(() =>
      expect(
        hostEl(container).shadowRoot?.querySelector('[data-testid="cart"]'),
      ).toBeTruthy(),
    );
    expect(hostEl(container).shadowRoot!.innerHTML).toContain(
      "b{font-weight:700}",
    );
  });

  it("aplica o CSP nonce aos estilos do Shadow DOM", async () => {
    stub(registerCart("b{font-weight:700}"));
    const { container } = render(
      <Module {...common} isolateStyles nonce="csp-token" />,
    );
    await waitFor(() =>
      expect(
        hostEl(container).shadowRoot?.querySelector('[data-testid="cart"]'),
      ).toBeTruthy(),
    );

    const styles = [...hostEl(container).shadowRoot!.querySelectorAll("style")];
    expect(styles).toHaveLength(2);
    expect(styles.every((style) => style.nonce === "csp-token")).toBe(true);
  });

  it("seletores do documento não alcançam o módulo (e vice-versa)", async () => {
    stub(registerCart());
    const hostStyle = document.createElement("style");
    hostStyle.textContent = "p{color:red}";
    document.head.appendChild(hostStyle);
    const { container } = render(
      <>
        <p data-testid="host-p">host</p>
        <Module {...common} isolateStyles />
      </>,
    );
    await waitFor(() =>
      expect(hostEl(container).shadowRoot?.querySelector("p")).toBeTruthy(),
    );

    // O `p` do módulo está atrás da fronteira: nenhum seletor do documento o encontra.
    expect(document.querySelectorAll("p")).toHaveLength(1);
    expect(document.querySelector("p")!.dataset.testid).toBe("host-p");
    // E o shadow root só enxerga o próprio conteúdo.
    expect(hostEl(container).shadowRoot!.querySelectorAll("p")).toHaveLength(1);
    hostStyle.remove();
  });

  it("expõe o shadowRoot via ModuleContext (alvo para portais)", async () => {
    let seen: ShadowRoot | null | undefined;
    let seenIsolation: boolean | undefined;
    const Probe = () => {
      const context = useContext(ModuleContext);
      seen = context?.shadowRoot;
      seenIsolation = context?.isolateStyles;
      return <i data-testid="probe" />;
    };
    stub(() => void Modularize("cart", Probe, { appName: "shop" }));
    const { container } = render(<Module {...common} isolateStyles />);

    await waitFor(() => expect(seen).toBeTruthy());
    expect(seen).toBe(hostEl(container).shadowRoot);
    expect(seenIsolation).toBe(true);
  });

  it("sem isolateStyles, shadowRoot no contexto é null", async () => {
    let seen: ShadowRoot | null | undefined = undefined;
    let seenIsolation: boolean | undefined;
    const Probe = () => {
      const context = useContext(ModuleContext);
      seen = context?.shadowRoot;
      seenIsolation = context?.isolateStyles;
      return null;
    };
    stub(() => void Modularize("cart", Probe, { appName: "shop" }));
    render(<Module {...common} />);
    await waitFor(() => expect(seen).toBe(null));
    expect(seenIsolation).toBe(false);
  });

  it("a prop isolateStyles não vaza para o componente remoto", async () => {
    const received: Record<string, unknown>[] = [];
    stub(
      () =>
        void Modularize(
          "cart",
          (p: Record<string, unknown>) => (received.push(p), null),
          { appName: "shop" },
        ),
    );
    render(<Module {...common} isolateStyles entityId="1" />);
    await waitFor(() => expect(received.length).toBeGreaterThan(0));
    expect(received[0]).toMatchObject({ entityId: "1" });
    expect(received[0]).not.toHaveProperty("isolateStyles");
  });

  it("alternar isolateStyles recria o container e remonta no lugar certo", async () => {
    stub(registerCart());
    const { container, rerender } = render(
      <Module {...common} isolateStyles />,
    );
    await waitFor(() =>
      expect(
        hostEl(container).shadowRoot?.querySelector('[data-testid="cart"]'),
      ).toBeTruthy(),
    );

    rerender(<Module {...common} isolateStyles={false} />);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="cart"]')).not.toBeNull(),
    );
    expect(hostEl(container).shadowRoot).toBeNull();

    rerender(<Module {...common} isolateStyles />);
    await waitFor(() =>
      expect(
        hostEl(container).shadowRoot?.querySelector('[data-testid="cart"]'),
      ).toBeTruthy(),
    );
    expect(container.querySelector('[data-testid="cart"]')).toBeNull();
  });

  it("mantém o alias isolate com um aviso único de depreciação", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    stub(registerCart());
    const { container } = render(
      <>
        <Module {...common} isolate />
        <Module {...common} isolate />
      </>,
    );

    await waitFor(() =>
      expect(
        hostEl(container).shadowRoot?.querySelector('[data-testid="cart"]'),
      ).toBeTruthy(),
    );
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]![0]).toMatch(/isolateStyles/);
  });

  it("chama onError e mostra fallback se o ambiente não suporta Shadow DOM", async () => {
    stub(registerCart());
    const original = Element.prototype.attachShadow;
    // @ts-expect-error simulando ambiente sem Shadow DOM
    Element.prototype.attachShadow = undefined;
    const onError = vi.fn();
    try {
      const { findByText } = render(
        <Module
          {...common}
          isolateStyles
          onError={onError}
          fallback={<span>sem shadow</span>}
        />,
      );
      await findByText("sem shadow");
      expect(onError.mock.calls[0]![0].message).toMatch(/Shadow DOM/);
    } finally {
      Element.prototype.attachShadow = original;
    }
  });
});
