import "@testing-library/jest-dom/vitest";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => ({
    measureText: (text: string) => ({ width: text.length * 8 }),
  }),
});
