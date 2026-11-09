import { coordinateText } from "../core/coordinate";
import { parse, stringify } from "yaml";
import type { Start } from "../core/engine";

// Shared source fixtures exercise the current language independently of the examples.
export const echoSource = `
name: 回声世界
domain:
  前台:
    type: UI
    color: "#4D7C68"
    view:
      directory: frontend
      width: 320
      height: 360
    node:
      提问:
        packet:
          问题:
            内容: {type: text}
          回声:
            内容: {type: text}
        input: [前台:domain/提问:node/问题:packet]
        logic:
          - 回应 = call([服务:domain/回声:node], {内容:input.内容})
        route:
          - IF input.内容 != '' go([非空:output], {内容:回应.数据.内容})
          - go([为空:output], {内容:""})
        output:
          为空:
            packet: [前台:domain/提问:node/回声:packet]
          非空:
            packet: [前台:domain/提问:node/回声:packet]
            action:
              - write([记录:resource], {内容:output.内容})
  服务:
    color: "#AF714D"
    node:
      回声:
        input: [前台:domain/提问:node/问题:packet]
        route:
          - go([完成:output], {内容:input.内容})
        output:
          完成:
            packet: [前台:domain/提问:node/回声:packet]
            action:
              - return()
resource:
  记录:
    field:
      内容: text
fable:
  - [[前台:domain/提问:node/问题:packet], 输入有明确合同]
`;

export const callSource = `
name: 调用世界
description: 顺序调用、分支收窄与因果回放
domain:
  手表:
    type: UI
    color: "#4D7C68"
    view:
      directory: frontend
      width: 320
      height: 360
    node:
      提交:
        packet:
          文案:
            文案: {type: text}
        input: [手表:domain/提交:node/文案:packet]
        route:
          - go([发送:output], {文案:input.文案})
        output:
          发送:
            packet: [手表:domain/提交:node/文案:packet]
            action:
              - go([业务:domain/朗读:node], output)
      播放:
        input: [语音:domain/合成:node/音频:packet]
        route:
          - go([播放:output], {音频:input.音频})
        output:
          播放:
            packet: [语音:domain/合成:node/音频:packet]
  业务:
    color: "#C2864B"
    node:
      朗读:
        input: [手表:domain/提交:node/文案:packet]
        logic:
          - 准备结果 = call([业务:domain/整理:node], {文案:input.文案})
          - 语音结果 = call([语音:domain/合成:node], {文本:准备结果.数据.文案})
        route:
          - IF 语音结果.分支 == "成功" go([有语音:output], {音频:语音结果.数据.音频})
          - go([无语音:output], {原因:语音结果.数据.原因})
        output:
          无语音:
            packet: [语音:domain/合成:node/错误:packet]
          有语音:
            packet: [语音:domain/合成:node/音频:packet]
            action:
              - write([交付记录:resource], {内容:output.音频})
              - go([手表:domain/播放:node], output)
      整理:
        input: [手表:domain/提交:node/文案:packet]
        route:
          - go([完成:output], {文案:input.文案})
        output:
          完成:
            packet: [手表:domain/提交:node/文案:packet]
            action:
              - return()
  语音:
    color: "#777FA4"
    node:
      合成:
        packet:
          请求:
            文本: text
          音频:
            音频: text
          错误:
            原因: text
        input: [语音:domain/合成:node/请求:packet]
        route:
          - IF input.文本 != '' go([成功:output], {音频:input.文本})
          - go([失败:output], {原因:"没有文案"})
        output:
          成功:
            packet: [语音:domain/合成:node/音频:packet]
            action:
              - return()
          失败:
            packet: [语音:domain/合成:node/错误:packet]
            action:
              - return()
resource:
  交付记录:
    field:
      内容: text
fable:
  - [[业务:domain/朗读:node/无语音:output], 失败分支不能引起播放]
  - [[语音:domain/合成:node/失败:output], 失败回复不能引起播放]
  - [[手表:domain/播放:node], 播放内容不为空]
  - [[语音:domain], 声音是否自然]
`;

export const normalStart: Start = {
  node: "手表/提交",
  input: { 文案: "银杏叶像一把小扇子" },
};
export const emptyStart: Start = { node: "手表/提交", input: { 文案: "" } };
export const echoStart: Start = {
  node: "前台/提问",
  input: { 内容: "实际输入" },
};
export const R = (id: string, type: import("../core/coordinate").SubjectType = "packet") => [coordinateText(id, type).slice(1, -1)];
export const draft = (source = callSource): any => parse(source);
export const sourceOf = (value: unknown) => stringify(value);
