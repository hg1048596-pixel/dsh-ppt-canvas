// dsh-ppt-canvas — 模型工具（AI 侧入口）
//
// 工具只做三件事：把「用户选中的元素 + 自然语言需求」交给模型，
// 把模型产出的修改方案校验后落到 .pptx，以及读写撤销/重做历史。
//
// 注意：这里不 import @deepseek-ai/dsh-tools；以 link 方式安装的插件
// 解析不到宿主包，因此直接按 ToolDefinition 的结构注册普通对象。

import { DeckError } from './deck-store.js'

const SYSTEM_HINT = [
  'PPT 画布协同编辑：用户已在画布上选中若干元素（文本框 / 色块 / 图片 / 线条等），',
  '并给出自然语言修改要求。你必须：',
  '1) 先调用 ppt_canvas_context 取回选中元素的完整属性（位置、尺寸、样式、层级、文本）；',
  '2) 据此生成最小必要的 ops，调用 ppt_canvas_apply 应用；',
  '3) 只改用户要求的内容，不要顺手重排整页，也不要改动未选中的元素；',
  '4) 应用后在回复里用一句话说明改了哪几个元素、改了什么。',
].join('\n')

const PATCH_SCHEMA_NOTE = [
  'patch = { summary: string, ops: Op[] }；Op 支持：',
  'setText{id,paragraphs:[{runs:[{text}]}]}、',
  'setTextStyle{id,color?,fontSize?,bold?,italic?,underline?,align?,fontFamily?}、',
  'setFill{id,color}、setLine{id,color,width?,dash?}、',
  'setGeometry{id,x?,y?,w?,h?,rotation?}、move{id,dx,dy}、resize{id,dw,dh}、',
  'align{ids:[...],mode:left|hcenter|right|top|vcenter|bottom|distributeH|distributeV}、',
  'setZ{id,z}、bringToFront{id}、sendToBack{id}、remove{id}、duplicate{id,dx?,dy?}。',
  '颜色用 #RRGGBB；尺寸单位是 px（96 DPI）；字号 fontSize 也是 px。',
  'id 必须来自 ppt_canvas_context 返回的 elements[].id。',
].join('\n')

/**
 * @param {object} tools  DSH 的 tools 服务（ctx.get('tools')）
 * @param {import('./deck-store.js').DeckStore} store
 */
export function registerTools(tools, store, bus, logger) {
  const disposers = []

  disposers.push(tools.register({
    name: 'ppt_canvas_open',
    description: [
      '在 PPT 协同编辑画布中打开一个 .pptx 文件（绝对路径）。',
      '打开后画布会显示每一页的元素；用户选中元素并下达指令时，用 ppt_canvas_context 取回选区。',
      '不传 path 时创建/打开一份内置演示文稿，便于试用整条链路。',
    ].join('\n'),
    parameters: {
      path: { type: 'string', description: '要打开的 .pptx 绝对路径；留空则打开内置演示文稿。' },
    },
    output: {
      // 宿主 assertSupportedJsonSchema 的类型白名单不含 'json'（实测 2026-10-14：4 工具全因
      // {type:'json'} 注册失败）。根节点必须用白名单内的类型；'object' + 开放属性是最小可行写法。
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const deck = args.path === undefined || args.path === ''
        ? await store.openDemo()
        : await store.open(args.path)
      bus.emit({ type: 'deck-opened', file: deck.file, rev: deck.rev, by: 'ai' })
      return {
        file: deck.file,
        rev: deck.rev,
        slideCount: deck.slides.length,
        slideSize: { w: deck.slideWidth, h: deck.slideHeight },
        shapes: deck.slides.map(slide => ({ index: slide.index, name: slide.name, shapeCount: slide.shapes.length })),
      }
    },
  }))

  disposers.push(tools.register({
    name: 'ppt_canvas_context',
    description: [
      '取回一次「选区 + 用户指令」的完整上下文：用户选中的每个元素及其属性',
      '（位置、尺寸、样式、层级 z、文本内容），以及用户的自然语言指令原文。',
      'requestId 来自用户在画布上发送指令时生成的请求（也会出现在用户消息里）。',
      '必须先调用本工具拿到 elements，再生成 ops。',
    ].join('\n'),
    parameters: {
      requestId: { type: 'string', required: true, description: '画布请求 id，形如 req_xxx。' },
    },
    output: {
      // 宿主 assertSupportedJsonSchema 的类型白名单不含 'json'（实测 2026-10-14：4 工具全因
      // {type:'json'} 注册失败）。根节点必须用白名单内的类型；'object' + 开放属性是最小可行写法。
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args) {
      const context = store.consumeContext(args.requestId)
      return { context, guidance: PATCH_SCHEMA_NOTE }
    },
  }))

  disposers.push(tools.register({
    name: 'ppt_canvas_apply',
    description: [
      '把修改方案（patch）应用到当前打开的 PPT 上。校验先于写入：任何一条 op 失败则整份方案不落盘。',
      'dryRun: true 只做校验与试算，返回将要执行的 ops 与告警，不改文件 —— 方案复杂或不确定时先用它。',
      '应用成功后 Host 会写盘、记录一次撤销点，并返回新的 rev；画布会自动刷新到新版本。',
      SYSTEM_HINT,
      '',
      PATCH_SCHEMA_NOTE,
    ].join('\n'),
    parameters: {
      // patch 必须**完整声明结构**且 object 一律 additionalProperties:false：
      // ① 布尔 additionalProperties:true 会被模型 API 的严格校验判为
      //    "got 'type: null'"（2026-10-15 实测，request_id dc48fd7f…）；
      // ② 运行时 validateArgs 按这个 schema 严格校验模型参数，声明即约束。
      // 字段清单与 PATCH_SCHEMA_NOTE 一一对应；items 内不允许 required。
      patch: {
        type: 'object',
        additionalProperties: false,
        required: true,
        description: '修改方案对象：{ summary, ops: [...] }。',
        properties: {
          summary: { type: 'string', description: '一句话说明改了什么。' },
          ops: {
            type: 'array',
            required: true,
            description: '修改操作列表，按顺序执行；任何一条失败则整份方案不落盘。',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                op: { type: 'string', description: 'setText/setTextStyle/setFill/setLine/setGeometry/move/resize/align/setZ/bringToFront/sendToBack/remove/duplicate 之一。' },
                id: { type: 'string', description: '目标元素 id，来自 ppt_canvas_context 返回的 elements[].id。' },
                ids: { type: 'array', items: { type: 'string' }, description: 'align 批量操作的目标 id 列表。' },
                mode: { type: 'string', description: 'align 的模式：left/hcenter/right/top/vcenter/bottom/distributeH/distributeV。' },
                paragraphs: {
                  type: 'array',
                  description: 'setText 的段落，每段 { runs: [{ text }] }。',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      align: { type: 'string' },
                      runs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: { text: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
                color: { type: 'string', description: '#RRGGBB。' },
                fontSize: { type: 'number', description: 'px。' },
                bold: { type: 'boolean' },
                italic: { type: 'boolean' },
                underline: { type: 'boolean' },
                align: { type: 'string', description: 'left/center/right。' },
                fontFamily: { type: 'string' },
                width: { type: 'number', description: 'setLine 的线宽 px。' },
                dash: { type: 'string', description: 'solid/dash。' },
                x: { type: 'number' },
                y: { type: 'number' },
                w: { type: 'number' },
                h: { type: 'number' },
                rotation: { type: 'number', description: '度。' },
                dx: { type: 'number' },
                dy: { type: 'number' },
                dw: { type: 'number' },
                dh: { type: 'number' },
                z: { type: 'number' },
              },
            },
          },
        },
      },
      dryRun: { type: 'boolean', description: '仅校验与试算，不写盘。' },
      requestId: { type: 'string', description: '本次修改对应的画布请求 id（用于版本冲突检测）。' },
    },
    output: {
      // 宿主 assertSupportedJsonSchema 的类型白名单不含 'json'（实测 2026-10-14：4 工具全因
      // {type:'json'} 注册失败）。根节点必须用白名单内的类型；'object' + 开放属性是最小可行写法。
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const result = await store.apply(args.patch, {
        dryRun: args.dryRun === true,
        source: 'ai',
        requestId: typeof args.requestId === 'string' ? args.requestId : undefined,
      })
      if (result.dryRun !== true) {
        bus.emit({ type: 'applied', rev: result.rev, summary: result.summary, changedIds: result.changedIds, by: 'ai' })
      }
      // deck 太大，不塞进模型上下文；画布通过 HTTP 拉新版本。
      const { deck, ...rest } = result
      return { ...rest, slideCount: deck?.slides?.length ?? null }
    },
  }))

  disposers.push(tools.register({
    name: 'ppt_canvas_history',
    description: [
      '查看/操作当前 PPT 的编辑历史。action=status 返回 rev 与能否撤销重做；',
      'action=undo / action=redo 回退或重做 steps 步（默认 1），文件会被真正改写回对应版本。',
      '用户说「撤销」「恢复」「刚才那步不要了」时用它。',
    ].join('\n'),
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'undo', 'redo'], description: '要执行的历史操作。' },
      steps: { type: 'number', description: '撤销/重做的步数，默认 1。' },
    },
    output: {
      // 宿主 assertSupportedJsonSchema 的类型白名单不含 'json'（实测 2026-10-14：4 工具全因
      // {type:'json'} 注册失败）。根节点必须用白名单内的类型；'object' + 开放属性是最小可行写法。
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      if (args.action === 'status') {
        const open = store.requireCurrent()
        const status = store.historyStatus()
        return { file: open.filePath, rev: status.rev, canUndo: status.canUndo, canRedo: status.canRedo, entries: status.entries }
      }
      const steps = typeof args.steps === 'number' ? args.steps : 1
      const deck = args.action === 'undo' ? await store.undo(steps) : await store.redo(steps)
      bus.emit({ type: 'applied', rev: deck.rev, summary: args.action, changedIds: [], by: 'ai' })
      return { file: deck.file, rev: deck.rev, action: args.action, slideCount: deck.slides.length }
    },
  }))

  return () => { for (const dispose of disposers) dispose() }
}

export { SYSTEM_HINT, PATCH_SCHEMA_NOTE, DeckError }
