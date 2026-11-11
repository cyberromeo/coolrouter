/**
 * Model servers that run on the user's own computer. Cool Router finds them on
 * their default port; nothing to type. Each becomes an OpenAI-compatible provider.
 */

export interface LocalServer {
  id: "ollama" | "lmstudio" | "llamacpp";
  name: string;
  port: number;
  /** OpenAI-compatible base path on that port */
  basePath: string;
  /** Logo id for ProviderIcon */
  icon: string;
  /** How to start it, shown when nothing answers */
  startCommand: string;
  website: string;
}

export const LOCAL_SERVERS: readonly LocalServer[] = [
  {
    id: "ollama",
    name: "Ollama",
    port: 11434,
    basePath: "/v1",
    icon: "ollama",
    startCommand: "ollama serve",
    website: "https://ollama.com/download",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    port: 1234,
    basePath: "/v1",
    icon: "lmstudio",
    startCommand: "lms server start",
    website: "https://lmstudio.ai",
  },
  {
    id: "llamacpp",
    name: "llama.cpp",
    port: 8080,
    basePath: "/v1",
    icon: "llamacpp",
    startCommand: "llama-server -m your-model.gguf --port 8080",
    website: "https://github.com/ggml-org/llama.cpp",
  },
] as const;

export function getLocalServer(id: string): LocalServer | undefined {
  return LOCAL_SERVERS.find((server) => server.id === id);
}

export function localServerBaseUrl(server: LocalServer): string {
  return `http://127.0.0.1:${server.port}${server.basePath}`;
}
