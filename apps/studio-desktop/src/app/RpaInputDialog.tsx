import { useState } from "react";
export function RpaInputDialog({
  accept,
  stop,
}: {
  accept(value: string): void;
  stop(): void;
}) {
  const [value, setValue] = useState("");
  const valid =
    new TextEncoder().encode(value).length <= 16384 && !value.includes("\0");
  return (
    <div className="popup-backdrop">
      <form
        className="popup"
        role="dialog"
        aria-modal="true"
        aria-label="自动化填写"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) {
            const input = value;
            setValue("");
            accept(input);
          }
        }}
      >
        <h2>自动化填写</h2>
        <p>内容仅用于本次运行。提交后还需在目标窗口的原生提示中确认。</p>
        <label>
          填写内容
          <input
            autoFocus
            type="password"
            autoComplete="off"
            maxLength={16384}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {!valid && <p role="alert">内容不能超过 16 KiB 或包含空字符。</p>}
        <button type="submit" disabled={!valid}>
          继续
        </button>
        <button
          type="button"
          onClick={() => {
            setValue("");
            stop();
          }}
        >
          停止运行
        </button>
      </form>
    </div>
  );
}
