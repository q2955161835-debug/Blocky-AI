// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { useModalFocus } from "../../apps/studio-desktop/src/composition/useModalFocus";

function ModalFixture() {
  useModalFocus("confirmation");
  return (
    <>
      <section role="dialog" aria-label="underlying popup">
        <button>background</button>
      </section>
      <div role="alertdialog" aria-label="confirmation">
        <button>confirm</button>
        <button>cancel</button>
      </div>
    </>
  );
}

it("focuses the top alert dialog and traps Tab there when another popup remains", async () => {
  const view = render(<ModalFixture />);
  const confirm = view.getByRole("button", { name: "confirm" });
  const cancel = view.getByRole("button", { name: "cancel" });
  await waitFor(() => expect(document.activeElement).toBe(confirm));
  cancel.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(confirm);
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(cancel);
});
