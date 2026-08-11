import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UnsavedChangesDialog } from "../../src/app/UnsavedChangesDialog";

describe("UnsavedChangesDialog", () => {
  it("names the document, focuses the safe action, and returns explicit decisions", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(
      <UnsavedChangesDialog
        documentName="weather.blocky"
        onDecision={onDecision}
      />,
    );

    expect(screen.getByRole("dialog", { name: "保存更改？" }))
      .toHaveTextContent("weather.blocky");
    expect(screen.getByRole("button", { name: "保存并继续" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onDecision).toHaveBeenCalledWith("cancel");
  });

  it("traps keyboard focus, supports Escape, and restores the previous focus", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    const launch = document.createElement("button");
    launch.textContent = "launch";
    document.body.append(launch);
    launch.focus();

    const { unmount } = render(
      <UnsavedChangesDialog
        documentName="未命名 Agent"
        onDecision={onDecision}
      />,
    );
    const save = screen.getByRole("button", { name: "保存并继续" });
    const discard = screen.getByRole("button", { name: "不保存" });
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(save).toHaveFocus();

    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(discard).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onDecision).toHaveBeenCalledWith("cancel");

    unmount();
    expect(launch).toHaveFocus();
    launch.remove();
  });
});
