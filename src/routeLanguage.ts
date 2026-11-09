import type { Data, Fields, Node } from "../core/model";
import { fieldPath, type Condition } from "../core/statements";
function literal(value: unknown): string {
  return typeof value === "boolean"
    ? value
      ? "是"
      : "否"
    : typeof value === "string"
      ? `“${value}”`
      : JSON.stringify(value);
}
export function conditionText(condition: Condition): string {
  if ("left" in condition) {
    const conjunction = condition.op === "&&" ? "且" : "或";
    return `（${conditionText(condition.left)} ${conjunction} ${conditionText(condition.right)}）`;
  }
  if (typeof condition.value === "boolean" && (condition.op === "==" || condition.op === "!=")) {
    const truth = condition.op === "==" ? condition.value : !condition.value;
    return `${condition.field}为${truth ? "真" : "假"}`;
  }
  const verbs = {
    "==": "等于",
    "!=": "不等于",
    "<": "低于",
    "<=": "不高于",
    ">": "高于",
    ">=": "不低于",
  };
  return `${condition.field}${verbs[condition.op]}${fieldPath(condition.value) ?? literal(condition.value)}`;
}
export function routeText(node: Node, index: number): string {
  const branch = node.outputs[index];
  return branch.when
    ? `${index ? "否则，如果" : "如果"}${conditionText(branch.when)}，则${branch.label}`
    : node.outputs.length === 1
      ? branch.reply
        ? "回复调用方"
        : "直接输出"
      : `其余情况，${branch.label}`;
}
export function valueText(value: Data[string], input?: Fields): string {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof value.$ === "string"
  ) {
    const path = value.$;
    if (path.startsWith("input.")) return `沿用输入的${path.slice(6)}`;
    return !input || Object.hasOwn(input, path.split(".")[0])
      ? `沿用输入的${path}`
      : `引用 ${path}`;
  }
  return literal(value);
}
