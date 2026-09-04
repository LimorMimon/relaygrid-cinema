export type WebMcpTool = {
  name: string;
  description: string;
  inputSchema?: object;
  execute: (input?: unknown) => unknown;
};

export type WebMcpRegisteredTool = { name: string };

declare global {
  interface Document {
    modelContext?: {
      registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<void>;
      getTools(): Promise<WebMcpRegisteredTool[]>;
      executeTool(tool: WebMcpRegisteredTool, input: string): Promise<unknown>;
    };
  }
}
