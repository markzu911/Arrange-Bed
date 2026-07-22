import type { PlacementSettings, PerspectiveOption, VirtualRoomStyle } from "./types";

export const TOOL_ID = "villa-bedding-placement";
export const TOOL_NAME = "AI 床具摆放助手";
export const TOOL_COST = 10;

export const defaultSettings: PlacementSettings = {
  position: "auto",
  customPosition: "",
  perspectives: ["medium"],
  blendStrength: "medium",
  ratio: "16:9",
  model: "gemini-3",
  clarity: "1K",
  addHumanModel: false,
  humanModelGender: "any",
  humanModelAge: "adult",
  virtualRoomStyle: "modern",
  notes: ""
};

export const perspectiveLabels: Record<PerspectiveOption, string> = {
  wide: "远景（卧室全景）",
  medium: "中近景（床区核心）",
  close: "近景（床具细节）"
};

export const virtualRoomStyleLabels: Record<VirtualRoomStyle, string> = {
  modern: "现代简约",
  italian: "意式轻奢",
  cream: "奶油风",
  "new-chinese": "新中式",
  "wabi-sabi": "侘寂风",
  american: "美式",
  nordic: "北欧",
  minimal: "极简黑白"
};

export const beddingPlacementSystemPrompt = `你是专业的卧室软装与床具摆放视觉设计助手。你的任务是把用户上传的床具照片真实自然地摆放到用户上传的卧室照片中，或在虚拟卧室里生成床具摆放效果图。

必须遵守：
1. 不能把床具换成相似款；必须保留用户上传床具的颜色、材质、床头造型、床架轮廓、床垫厚度、可见纹理和整体比例。
2. 根据卧室照片自动匹配透视、尺度、地面接触关系、光照方向、阴影、反射和环境色，床必须贴合地面，不能漂浮、穿模或比例失真。
3. 不得改变卧室主体结构，不得改动门、窗、衣柜、床头墙、梁柱、墙地面材质、主要采光和固定家具。
4. 不得遮挡门、衣柜、窗户和主要通道；床边、床尾必须留下合理通行空间，并兼顾床头柜、插座和开门动线。
5. 根据用户的自然语言要求、视角、融合强度和备注说明调整生成效果；没有用户位置要求时，优先选择床头靠实墙、动线顺畅、采光自然的位置。
6. 这是“编辑原卧室图”的任务，不允许直接返回未改动的卧室原图。新床具必须在最终图中清楚可见，并依照已确认的位置、朝向和保留/移除策略产生可见改变。
7. 输出尽量结构化，分析阶段返回 JSON；生成阶段返回图片。`;


