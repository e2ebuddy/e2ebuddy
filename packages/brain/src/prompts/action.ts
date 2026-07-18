export function actionSchemaText(): string {
  return `AgentAction JSON union:
{"type":"navigate","url":"https://same-origin.example/path"}
{"type":"click","ref":"e12"}
{"type":"type","ref":"e4","text":"text","pressEnter":false}
{"type":"scroll","direction":"down"}
{"type":"select","ref":"e7","value":"option-value"}
{"type":"wait","ms":1000}
{"type":"setViewport","preset":"desktop"}
{"type":"done","reason":"Exploration is complete"}`;
}
