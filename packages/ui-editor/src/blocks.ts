import * as Blockly from "blockly/core";
import * as Zh from "blockly/msg/zh-hans";
import { catalog, categories } from "@blocky/block-catalog";
let registered = false;
class JsonField extends Blockly.FieldTextInput {
  constructor() {
    super("null", (value) => {
      if (value === null) return null;
      try {
        JSON.parse(value);
        return value;
      } catch {
        return null;
      }
    });
  }
  override saveState(): unknown {
    return JSON.parse(this.getValue() ?? "null");
  }
  override loadState(state: unknown) {
    this.setValue(JSON.stringify(state));
  }
}
const labels: Record<string, string> = {
  ROLE: "角色",
  NAME: "名称",
  MODULE: "模块",
  EXPORT: "导出",
  INPUT: "输入类型",
  OUTPUT: "输出类型",
  RESOURCE: "资源",
  CHANNEL: "通道",
  TARGET: "目标窗口", URL: "网址", ACTION: "动作", LOCATOR: "定位器",
  MILLISECONDS: "毫秒",
  STYLE: "方式",
  TEXT: '内容', STEPS: '最多步数', CALLS: '最多调用', OUTPUT_TOKENS: '输出 Token 预算', TIMEOUT_MS: '总时限毫秒',
  SOURCE: '取值', OP: '判断', VALUE: '值', SCOPE: '范围', KEY: '键', POLICY: '策略', SCHEMA: '输出结构', FORMAT: '格式',
};
export function registerBlocks() {
  if (registered) return;
  registered = true;
  for (const name of ["copy", "cut", "paste", "duplicate", "undo", "redo"])
    Blockly.ShortcutRegistry.registry.unregister(name);
  Blockly.setLocale(
    Object.fromEntries(
      Object.entries(Zh).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  );
  for (const def of catalog) {
    Blockly.Blocks[def.type] = {
      saveExtraState(this: Blockly.Block & { blockyExtraState?: unknown }) {
        return this.blockyExtraState ?? null;
      },
      loadExtraState(
        this: Blockly.Block & { blockyExtraState?: unknown },
        state: unknown,
      ) {
        this.blockyExtraState = structuredClone(state);
      },
      init(this: Blockly.Block) {
        this.appendDummyInput().appendField(def.label);
        if (def.type === "core.data.transform")
          this.appendDummyInput().appendField(new Blockly.FieldLabel("✖ 代码无效", "blocky-code-badge"), "BLOCKY_CODE_STATE");
        const input = this.appendDummyInput();
        for (const field of def.fields) {
          if (def.jsonFields?.includes(field)) {
            input.appendField(labels[field] ?? "值").appendField(new JsonField(), field);
            continue;
          }
          if (field === "INPUT" || field === "OUTPUT") {
            const hidden = new Blockly.FieldLabelSerializable("");
            input.appendField(hidden, field);
            hidden.setVisible(false);
            continue;
          }
          input.appendField(def.type === "core.event.receive" && field === "TIMEOUT_MS" ? "等待毫秒" : labels[field] ?? field);
          if (def.fieldOptions?.[field])
            input.appendField(
              new Blockly.FieldDropdown(
                def.fieldOptions[field].map((value) => [value, value]),
              ),
              field,
            );
          else
            input.appendField(
              new Blockly.FieldTextInput(
                field === "NAME"
                  ? "资料问答"
                  : field === "ROLE"
                    ? "用清晰可靠的中文回答，只引用资料中的事实"
                    : "",
              ),
              field,
            );
        }
        for (const input of def.inputs) {
          const check = def.inputChecks?.[input] ?? "step";
          if (typeof check === "string" && ["json", "message"].includes(check))
            this.appendValueInput(input).setCheck(check);
          else {
            const statement = this.appendStatementInput(input).setCheck(check);
            if (def.type === "core.event.receive") statement.appendField(input === "RECEIVED" ? "收到消息" : "队列为空或等待超时");
            if (def.type === "core.flow.parallel") statement.appendField(input === "LEFT" ? "分支一" : "分支二");
            if (["core.computer.attach","core.browser.navigate"].includes(def.type)) statement.appendField("自动化步骤");
          }
        }
        if (def.output) this.setOutput(true, def.output);
        if (def.statement) {
          this.setPreviousStatement(true, def.statementCheck ?? "step");
          this.setNextStatement(true, def.statementCheck ?? "step");
        }
        this.setColour(def.color);
        this.setTooltip(def.label);
        this.setHelpUrl("");
        this.contextMenu = false;
      },
    };
  }
}
export const toolbox = {
  kind: "categoryToolbox",
  contents: categories.flatMap((name, index) => {
    const blocks = catalog.filter((b) => b.category === index);
    return blocks.length
      ? [
          {
            kind: "category",
            name,
            colour: blocks[0].color,
            contents: blocks.map((b) => ({ kind: "block", type: b.type })),
          },
        ]
      : [];
  }),
};
export const theme = Blockly.Theme.defineTheme("blocky", {
  name: "blocky",
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: "#1d2128",
    toolboxBackgroundColour: "#252a33",
    toolboxForegroundColour: "#eef2f7",
    flyoutBackgroundColour: "#252a33",
    flyoutForegroundColour: "#eef2f7",
    flyoutOpacity: 1,
    scrollbarColour: "#626c7c",
    scrollbarOpacity: 0.55,
    insertionMarkerColour: "#ffffff",
    insertionMarkerOpacity: 0.4,
  },
  fontStyle: { family: "Microsoft YaHei UI, Segoe UI, sans-serif", size: 11 },
});
export { Blockly };
